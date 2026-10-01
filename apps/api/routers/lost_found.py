from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from typing import Literal, Optional
from datetime import datetime, timedelta, timezone
import logging
import re
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import (
    ApproveLostFoundDispositionRequest,
    CompleteLostFoundPickupRequest,
    CreateLostFoundCustodyEventRequest,
    CreateLostFoundClaimRequest,
    CreateLostFoundRequest,
    CancelLostFoundClaimRequest,
    ConfirmLostFoundMatchRequest,
    MarkLostFoundShippedRequest,
    PrepareLostFoundReturnRequest,
    RejectLostFoundMatchRequest,
    RemoveLostFoundMatchRequest,
    SetLostFoundPickupDetailsRequest,
    SetLostFoundShippingDetailsRequest,
    UpdateLostFoundClaimRequest,
    UpdateLostFoundRequest,
    UpdateLostFoundReturnMethodRequest,
    VoidLostFoundRequest,
)
from core.database import supabase
from core.config import settings
from services.guest_recovery.contracts import (
    MissingCustodyVerificationError,
    validate_lost_found_custody_event,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/lost-found", tags=["lost-found"])

ALLOWED_PHOTO_TYPES = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
MAX_PHOTO_BYTES = 5 * 1024 * 1024
RETENTION_PERIOD_DAYS = 90  # D-10: fixed retention window, not per-tenant configurable in this phase
LOST_FOUND_MANAGER_ROLES = ("front_desk", "housekeeping_supervisor", "gm")
LOST_FOUND_CLAIM_ROLES = ("front_desk", "housekeeping_supervisor", "gm")
# D-12: disposition and void are corrective/destructive-adjacent actions, restricted to
# supervisory roles only (narrower than the general manager-roles set above).
LOST_FOUND_DISPOSITION_ROLES = ("housekeeping_supervisor", "gm")
LOST_FOUND_VOID_ROLES = ("housekeeping_supervisor", "gm")
# Non-terminal return states: exactly one of these may exist per item at a time.
RETURN_ACTIVE_STATUSES = ("awaiting_details", "ready_for_pickup", "shipping_preparation", "shipped")


def _match_tokens(value: str | None) -> set[str]:
    """Normalize descriptive text without sending guest or item data to an AI service."""
    if not value:
        return set()
    return {
        token
        for token in re.findall(r"[a-z0-9]+", value.casefold())
        if len(token) > 1 and token not in {"the", "and", "with", "for", "from"}
    }


def _match_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _text_points(left: str | None, right: str | None, maximum: int) -> int:
    left_tokens, right_tokens = _match_tokens(left), _match_tokens(right)
    if not left_tokens or not right_tokens:
        return 0
    overlap = len(left_tokens & right_tokens)
    if not overlap:
        return 0
    # Jaccard similarity avoids treating a generic one-word overlap as a strong match.
    return round(maximum * overlap / len(left_tokens | right_tokens))


def rank_lost_found_matches(claim: dict, items: list[dict]) -> list[dict]:
    """Return explainable, deterministic candidates for one tenant's open claim.

    The caller owns tenant scoping. Physical custody stays independent: only
    currently held items are candidates and this function never changes status.
    """
    ranked: list[dict] = []
    claim_last_seen = _match_date(claim.get("last_seen_at"))
    claim_category = claim.get("category")
    for item in items:
        if item.get("status") != "unclaimed":
            continue
        signals: list[dict] = []
        score = 0
        category_matches = bool(claim_category and claim_category == item.get("category"))
        if category_matches:
            score += 25
            signals.append({"key": "category", "label": "Same category", "detail": str(claim_category).replace("_", " "), "points": 25})
        elif claim_category and item.get("category"):
            signals.append({"key": "category", "label": "Different category", "detail": f"Claim: {str(claim_category).replace('_', ' ')}; item: {str(item['category']).replace('_', ' ')}", "points": 0})

        if claim.get("room_id") and claim.get("room_id") == item.get("room_id"):
            score += 25
            signals.append({"key": "room", "label": "Same room", "detail": "Room record matches", "points": 25})

        found_at = _match_date(item.get("found_at") or item.get("created_at"))
        if claim_last_seen and found_at:
            days_apart = abs((found_at.date() - claim_last_seen.date()).days)
            date_points = 20 if days_apart == 0 else 16 if days_apart <= 1 else 10 if days_apart <= 3 else 4 if days_apart <= 7 else 0
            if date_points:
                score += date_points
                signals.append({"key": "date", "label": "Timing is close", "detail": "Same day" if days_apart == 0 else f"{days_apart} days apart", "points": date_points})

        description_points = _text_points(claim.get("description"), item.get("description"), 20)
        if description_points:
            score += description_points
            signals.append({"key": "description", "label": "Description overlap", "detail": "Shared descriptive terms", "points": description_points})

        details_points = _text_points(claim.get("distinguishing_details"), item.get("distinguishing_details"), 10)
        if details_points:
            score += details_points
            signals.append({"key": "details", "label": "Distinguishing details overlap", "detail": "Shared identifying details", "points": details_points})

        # A room or stay alone cannot establish ownership. Different categories
        # substantially reduce the rank while preserving a reviewable lead.
        if claim_category and item.get("category") and not category_matches:
            score = round(score * 0.35)
        if score:
            ranked.append({"item": item, "score": min(score, 100), "signals": signals})

    return sorted(ranked, key=lambda candidate: (-candidate["score"], candidate["item"].get("found_at") or candidate["item"].get("created_at") or ""))


def _claim_code(claim: dict) -> str:
    number = claim.get("claim_number")
    if number is None:
        fallback = re.search(r"(\d+)$", str(claim.get("id", "")))
        number = fallback.group(1) if fallback else "0"
    return f"CL-{int(number):04d}"


def _serialize_claim(claim: dict) -> dict:
    return {**claim, "claim_code": _claim_code(claim)}


def _get_claim(claim_id: str, hotel_id: str) -> dict:
    claim = _single(
        supabase.table("lost_found_claims")
        .select("*")
        .eq("id", claim_id)
        .eq("tenant_id", hotel_id)
        .maybe_single()
    )
    if not claim:
        raise HTTPException(status_code=404, detail="Guest claim not found")
    return claim


def _claim_capabilities(role: str) -> dict[str, bool]:
    """Centralized Lost & Found role/capability model (D-13). Backend routes remain
    independently authoritative via require_role; this only informs UI affordances."""
    can_manage = role in LOST_FOUND_MANAGER_ROLES
    can_claims = role in LOST_FOUND_CLAIM_ROLES
    can_disposition = role in LOST_FOUND_DISPOSITION_ROLES
    can_void = role in LOST_FOUND_VOID_ROLES
    return {
        "canViewInventory": True,
        "canLogFoundItem": can_manage,
        "canEditFoundItem": can_manage,
        "canMoveFoundItem": can_manage,
        "canViewClaims": can_claims,
        "canCreateClaim": can_claims,
        "canEditClaim": can_claims,
        "canManageClaims": can_claims,
        "canReviewMatch": can_claims,
        "canConfirmMatch": can_claims,
        "canCancelClaim": can_claims,
        "canPrepareReturn": can_manage,
        "canReleaseItem": can_manage,
        "canShipItem": can_manage,
        "canApproveDisposition": can_disposition,
        "canVoidRecord": can_void,
    }


def _validate_claim_room(room_id: str | None, hotel_id: str) -> dict | None:
    if not room_id:
        return None
    room = _single(
        supabase.table("rooms")
        .select("id, room_number")
        .eq("id", room_id)
        .eq("tenant_id", hotel_id)
        .maybe_single()
    )
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


def _claim_match_candidates(claim: dict, hotel_id: str) -> list[dict]:
    items = (
        supabase.table("lost_found_items")
        .select("*, rooms(room_number)")
        .eq("tenant_id", hotel_id)
        .eq("status", "unclaimed")
        .order("found_at", desc=True)
        .execute()
        .data
        or []
    )
    rejected_rows = (
        supabase.table("lost_found_match_rejections")
        .select("item_id")
        .eq("tenant_id", hotel_id)
        .eq("claim_id", claim["id"])
        .execute()
        .data
        or []
    )
    rejected_ids = {row.get("item_id") for row in rejected_rows}
    matched_rows = (
        supabase.table("lost_found_claims")
        .select("matched_item_id")
        .eq("tenant_id", hotel_id)
        .eq("status", "matched")
        .execute()
        .data
        or []
    )
    unavailable_ids = {row.get("matched_item_id") for row in matched_rows}
    available = [item for item in items if item.get("id") not in rejected_ids | unavailable_ids]
    return rank_lost_found_matches(claim, available)


def _attach_finder_profiles(items: list[dict], hotel_id: str) -> list[dict]:
    """Hydrate only the finder display fields, scoped to the item's tenant."""
    finder_ids = list({item.get("found_by") for item in items if item.get("found_by")})
    if not finder_ids:
        return items

    profiles = (
        supabase.table("user_profiles")
        .select("id, preferred_name, full_name")
        .eq("tenant_id", hotel_id)
        .in_("id", finder_ids)
        .execute()
        .data
        or []
    )
    profiles_by_id = {
        profile["id"]: {
            "preferred_name": profile.get("preferred_name"),
            "full_name": profile.get("full_name"),
        }
        for profile in profiles
    }
    return [
        {**item, "user_profiles": profiles_by_id[item["found_by"]]}
        if item.get("found_by") in profiles_by_id
        else item
        for item in items
    ]


def _active_tag_exists(tag_identifier: str, hotel_id: str, excluding_item_id: str | None = None) -> bool:
    """Check the same tenant's active inventory before relying on the DB index."""
    query = (
        supabase.table("lost_found_items")
        .select("id")
        .eq("tenant_id", hotel_id)
        .ilike("tag_identifier", tag_identifier)
        .eq("status", "unclaimed")
    )
    if excluding_item_id:
        query = query.neq("id", excluding_item_id)
    return bool(_single(query.maybe_single()))


def _intake_note(location_found: str | None, storage_location: str | None, notes: str | None) -> str | None:
    """Keep the existing note field useful while making intake custody readable."""
    lines = []
    if location_found:
        lines.append(f"Found: {location_found}")
    if storage_location:
        lines.append(f"Stored: {storage_location}")
    if notes:
        lines.append(notes)
    return "\n".join(lines) or None


# --- Phase 4: centralized lifecycle derivation, returns, disposition, void ---

def _single(query) -> dict | None:
    """supabase-py 2.31's maybe_single().execute() returns a bare `None` (not a
    SingleAPIResponse(data=None)) whenever zero rows match — accessing `.data` directly
    on that crashes with AttributeError on every legitimate "not found" lookup, not just
    an edge case. Every maybe_single() read in this router must be routed through here
    instead of chaining `.execute().data` directly. `query` is the already-chained
    `<table query>.maybe_single()` builder, not yet executed."""
    result = query.execute()
    return result.data if result else None


def _get_item_row(item_id: str, hotel_id: str, columns: str = "*") -> dict:
    item = _single(
        supabase.table("lost_found_items").select(columns)
        .eq("id", item_id).eq("tenant_id", hotel_id).maybe_single()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


def _get_return_row(return_id: str, hotel_id: str) -> dict:
    row = _single(
        supabase.table("lost_found_returns").select("*")
        .eq("id", return_id).eq("tenant_id", hotel_id).maybe_single()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Return not found")
    return row


def _hydrate_return_context(row: dict, hotel_id: str) -> dict:
    """Attach the item/claim display fields the drawer needs, without a joined select
    (kept consistent with _get_return_row's simple select so mutations stay uniform)."""
    item = _single(supabase.table("lost_found_items").select(
        "description, tag_identifier, retention_due_at"
    ).eq("id", row["item_id"]).eq("tenant_id", hotel_id).maybe_single())
    claim = _single(supabase.table("lost_found_claims").select(
        "claim_number, guest_name, room_number"
    ).eq("id", row["claim_id"]).eq("tenant_id", hotel_id).maybe_single())
    return {**row, "lost_found_items": item, "lost_found_claims": claim}


def _get_confirmed_claim_for_item(item_id: str, hotel_id: str) -> dict | None:
    return _single(
        supabase.table("lost_found_claims").select("*")
        .eq("tenant_id", hotel_id).eq("matched_item_id", item_id).eq("status", "matched")
        .maybe_single()
    )


def _get_active_return_for_item(item_id: str, hotel_id: str) -> dict | None:
    return _single(
        supabase.table("lost_found_returns").select("*")
        .eq("tenant_id", hotel_id).eq("item_id", item_id)
        .in_("status", list(RETURN_ACTIVE_STATUSES)).maybe_single()
    )


def _record_return_event(hotel_id: str, return_id: str, event_type: str, actor_id: str, note: str | None = None) -> None:
    supabase.table("lost_found_return_events").insert({
        "tenant_id": hotel_id, "return_id": return_id, "event_type": event_type,
        "actor_id": actor_id, "note": note,
    }).execute()


def _derive_item_status(item: dict, now: datetime, has_confirmed_claim: bool, has_active_return: bool) -> str:
    """D-44: single source of truth for user-facing lifecycle status. Priority order
    matches the product spec exactly; never reimplement this independently elsewhere."""
    if item.get("voided_at"):
        return "voided"
    status = item.get("status")
    if status == "claimed":
        return "returned"
    if status in ("donated", "discarded"):
        return status
    if has_active_return:
        return "return_in_progress"
    if has_confirmed_claim:
        return "matched"
    if status == "unclaimed":
        due_at = _match_date(item.get("retention_due_at"))
        if due_at and due_at < now:
            return "due_for_disposition"
    return "held"


def _attach_item_lifecycle(items: list[dict], hotel_id: str) -> list[dict]:
    if not items:
        return items
    matched_item_ids = {
        row.get("matched_item_id")
        for row in supabase.table("lost_found_claims").select("matched_item_id").eq(
            "tenant_id", hotel_id
        ).eq("status", "matched").execute().data or []
    }
    active_return_item_ids = {
        row.get("item_id")
        for row in supabase.table("lost_found_returns").select("item_id").eq(
            "tenant_id", hotel_id
        ).in_("status", list(RETURN_ACTIVE_STATUSES)).execute().data or []
    }
    now = datetime.now(timezone.utc)
    return [
        {
            **item,
            "has_confirmed_match": item.get("id") in matched_item_ids,
            "has_active_return": item.get("id") in active_return_item_ids,
            "derived_status": _derive_item_status(
                item, now, item.get("id") in matched_item_ids, item.get("id") in active_return_item_ids
            ),
        }
        for item in items
    ]


def _disposition_eligible_items(items: list[dict], hotel_id: str) -> list[dict]:
    """D-31: never surface a matched, actively-returning, or already-terminal item for disposition."""
    item_ids = [item["id"] for item in items]
    if not item_ids:
        return []
    matched_ids = {
        row.get("matched_item_id")
        for row in supabase.table("lost_found_claims").select("matched_item_id").eq(
            "tenant_id", hotel_id
        ).eq("status", "matched").execute().data or []
    }
    active_return_ids = {
        row.get("item_id")
        for row in supabase.table("lost_found_returns").select("item_id").eq(
            "tenant_id", hotel_id
        ).in_("status", list(RETURN_ACTIVE_STATUSES)).execute().data or []
    }
    return [item for item in items if item["id"] not in matched_ids and item["id"] not in active_return_ids]


def _disposition_candidate_items(hotel_id: str) -> list[dict]:
    items = (
        supabase.table("lost_found_items").select("*, rooms(room_number)")
        .eq("tenant_id", hotel_id).eq("status", "unclaimed").is_("voided_at", "null")
        .execute().data or []
    )
    items = [item for item in items if item.get("retention_due_at")]
    return _disposition_eligible_items(items, hotel_id)


@router.post("/upload-photo")
async def upload_photo(
    file: UploadFile = File(...), current_user: CurrentUser = Depends(get_current_user)
):
    """Upload a photo for a lost & found item and return its public URL."""
    if file.content_type not in ALLOWED_PHOTO_TYPES:
        raise HTTPException(
            status_code=400, detail="Only JPEG, PNG, or WebP images are allowed"
        )

    ext = ALLOWED_PHOTO_TYPES[file.content_type]
    path = f"{current_user.hotel_id}/{int(datetime.now(timezone.utc).timestamp() * 1000)}.{ext}"

    contents = await file.read(MAX_PHOTO_BYTES + 1)
    if len(contents) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Photo must be 5 MB or smaller")

    try:
        supabase.storage.from_("lost-found-photos").upload(
            path, contents, {"content-type": file.content_type, "upsert": "false"}
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Photo upload failed")

    public_url = (
        f"{settings.supabase_url}/storage/v1/object/public/lost-found-photos/{path}"
    )
    return {"data": {"url": public_url}}


@router.post("", dependencies=[Depends(require_role(*LOST_FOUND_MANAGER_ROLES))])
async def create_lost_found_item(
    request: CreateLostFoundRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Log a found item."""
    now = datetime.now(timezone.utc)
    if request.tag_identifier and _active_tag_exists(request.tag_identifier, current_user.hotel_id):
        raise HTTPException(status_code=409, detail="This tag ID is already in use.")
    data = {
        "tenant_id": current_user.hotel_id,
        "description": request.description,
        "room_id": str(request.room_id) if request.room_id else None,
        "location_found": request.location_found,
        "notes": request.notes,
        "photo_url": request.photo_url,
        "tag_identifier": request.tag_identifier,
        "storage_location": request.storage_location,
        "category": request.category,
        "classification": request.classification,
        "distinguishing_details": request.distinguishing_details,
        "found_at": (request.found_at or now).isoformat(),
        "found_by": current_user.user_id,
        "status": "unclaimed",
        "retention_due_at": (now + timedelta(days=RETENTION_PERIOD_DAYS)).isoformat(),
    }
    result = supabase.table("lost_found_items").insert(data).execute()
    item = result.data[0] if result.data else None
    if item:
        supabase.table("lost_found_custody_events").insert({
            "tenant_id": current_user.hotel_id,
            "lost_found_item_id": item["id"],
            "event_type": "intake",
            "storage_location": request.storage_location,
            "actor_id": current_user.user_id,
            "note": _intake_note(request.location_found, request.storage_location, request.notes),
        }).execute()
    return {"data": item}


@router.get("")
async def list_lost_found_items(
    status: Optional[Literal["unclaimed", "claimed", "donated", "discarded"]] = Query(
        None
    ),
    date_from: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    search: Optional[str] = Query(None, min_length=1, max_length=120),
    category: Optional[Literal[
        "electronics", "clothing", "jewelry", "bags_luggage", "keys",
        "wallets_cards", "documents", "medical", "toiletries", "accessories", "other",
    ]] = None,
    storage: Optional[str] = None,
    disposition_due: bool = Query(False),
    include_voided: bool = Query(False),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
):
    """List lost & found items with optional filters."""
    query = (
        supabase.table("lost_found_items")
        .select("*, rooms(room_number)")
        .eq("tenant_id", current_user.hotel_id)
        .order("found_at", desc=True)
        .range((page - 1) * per_page, page * per_page - 1)
    )

    if not include_voided:
        query = query.is_("voided_at", "null")
    if status:
        query = query.eq("status", status)
    if date_from:
        query = query.gte("found_at", date_from)
    if date_to:
        query = query.lte("found_at", date_to + "T23:59:59")
    if search:
        term = search.replace(",", " ").replace("(", " ").replace(")", " ")
        query = query.or_(
            f"description.ilike.%{term}%,tag_identifier.ilike.%{term}%,"
            f"location_found.ilike.%{term}%,storage_location.ilike.%{term}%,category.ilike.%{term}%"
        )
    if category:
        query = query.eq("category", category)
    if storage:
        query = query.ilike("storage_location", f"%{storage}%")
    if disposition_due:
        query = query.eq("status", "unclaimed").lt(
            "retention_due_at", datetime.now(timezone.utc).isoformat()
        ).order("retention_due_at")

    result = query.execute()
    items = _attach_finder_profiles(result.data or [], current_user.hotel_id)
    items = _attach_item_lifecycle(items, current_user.hotel_id)

    return {"data": items, "meta": {"page": page, "per_page": per_page}}


@router.get("/tag-suggestion")
async def suggest_lost_found_tag(current_user: CurrentUser = Depends(get_current_user)):
    """Suggest a concise tenant-facing tag without exposing UUIDs."""
    latest = _single(
        supabase.table("lost_found_items")
        .select("item_number")
        .eq("tenant_id", current_user.hotel_id)
        .order("item_number", desc=True)
        .limit(1)
        .maybe_single()
    ) or {}
    return {"data": {"tag_identifier": f"LF-{int(latest.get('item_number') or 0) + 1:04d}"}}


@router.get("/capabilities")
async def lost_found_capabilities(current_user: CurrentUser = Depends(get_current_user)):
    """Presentation capabilities; every mutation below remains independently role-gated."""
    return {"data": _claim_capabilities(current_user.role)}


@router.get("/claims/summary", dependencies=[Depends(require_role(*LOST_FOUND_CLAIM_ROLES))])
async def lost_found_claim_summary(current_user: CurrentUser = Depends(get_current_user)):
    claims = (
        supabase.table("lost_found_claims").select("*").eq("tenant_id", current_user.hotel_id).execute().data
        or []
    )
    open_claims = [claim for claim in claims if claim.get("status") == "open"]
    return {"data": {
        "open": len(open_claims),
        "matched": sum(claim.get("status") == "matched" for claim in claims),
        "possible_matches": sum(bool(_claim_match_candidates(claim, current_user.hotel_id)) for claim in open_claims),
    }}


@router.get("/claims", dependencies=[Depends(require_role(*LOST_FOUND_CLAIM_ROLES))])
async def list_lost_found_claims(
    status: Optional[Literal["open", "matched", "closed", "cancelled"]] = Query(None),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None, min_length=1, max_length=120),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
):
    query = (
        supabase.table("lost_found_claims").select("*, rooms(room_number)")
        .eq("tenant_id", current_user.hotel_id).order("created_at", desc=True)
        .range((page - 1) * per_page, page * per_page - 1)
    )
    if status:
        query = query.eq("status", status)
    if category:
        query = query.eq("category", category)
    if search:
        term = search.replace(",", " ").replace("(", " ").replace(")", " ")
        query = query.or_(
            f"guest_name.ilike.%{term}%,guest_phone.ilike.%{term}%,guest_email.ilike.%{term}%,"
            f"room_number.ilike.%{term}%,description.ilike.%{term}%,category.ilike.%{term}%"
        )
    claims = query.execute().data or []
    return {"data": [_serialize_claim(claim) for claim in claims], "meta": {"page": page, "per_page": per_page}}


@router.post("/claims", dependencies=[Depends(require_role(*LOST_FOUND_CLAIM_ROLES))])
async def create_lost_found_claim(
    request: CreateLostFoundClaimRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    room = _validate_claim_room(str(request.room_id) if request.room_id else None, current_user.hotel_id)
    data = request.model_dump(exclude_none=True)
    data.update({
        "tenant_id": current_user.hotel_id,
        "created_by": current_user.user_id,
        "room_id": str(request.room_id) if request.room_id else None,
        "room_number": room.get("room_number") if room else request.room_number,
        "status": "open",
    })
    for field in ("stay_start", "stay_end", "last_seen_at"):
        if data.get(field):
            data[field] = data[field].isoformat()
    claim_rows = supabase.table("lost_found_claims").insert(data).execute().data or []
    claim = claim_rows[0] if claim_rows else None
    if not claim:
        raise HTTPException(status_code=500, detail="Could not create guest claim")
    supabase.table("lost_found_claim_events").insert({
        "tenant_id": current_user.hotel_id,
        "claim_id": claim["id"],
        "event_type": "created",
        "actor_id": current_user.user_id,
    }).execute()
    return {"data": _serialize_claim(claim)}


@router.get("/claims/{claim_id}", dependencies=[Depends(require_role(*LOST_FOUND_CLAIM_ROLES))])
async def get_lost_found_claim(claim_id: str, current_user: CurrentUser = Depends(get_current_user)):
    return {"data": _serialize_claim(_get_claim(claim_id, current_user.hotel_id))}


@router.patch("/claims/{claim_id}", dependencies=[Depends(require_role(*LOST_FOUND_CLAIM_ROLES))])
async def update_lost_found_claim(
    claim_id: str,
    request: UpdateLostFoundClaimRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    claim = _get_claim(claim_id, current_user.hotel_id)
    if claim.get("status") in ("closed", "cancelled"):
        raise HTTPException(status_code=409, detail="Closed or cancelled claims cannot be edited")
    update = request.model_dump(exclude_unset=True)
    if request.room_id:
        room = _validate_claim_room(str(request.room_id), current_user.hotel_id)
        update["room_id"] = str(request.room_id)
        update["room_number"] = room.get("room_number") if room else update.get("room_number")
    for field in ("stay_start", "stay_end", "last_seen_at"):
        if update.get(field):
            update[field] = update[field].isoformat()
    result = supabase.table("lost_found_claims").update(update).eq("id", claim_id).eq(
        "tenant_id", current_user.hotel_id
    ).execute().data or []
    updated = result[0] if result else None
    if not updated:
        raise HTTPException(status_code=404, detail="Guest claim not found")
    supabase.table("lost_found_claim_events").insert({
        "tenant_id": current_user.hotel_id, "claim_id": claim_id, "event_type": "updated", "actor_id": current_user.user_id,
    }).execute()
    return {"data": _serialize_claim(updated)}


@router.get("/claims/{claim_id}/events", dependencies=[Depends(require_role(*LOST_FOUND_CLAIM_ROLES))])
async def list_lost_found_claim_events(claim_id: str, current_user: CurrentUser = Depends(get_current_user)):
    _get_claim(claim_id, current_user.hotel_id)
    events = supabase.table("lost_found_claim_events").select("*").eq("tenant_id", current_user.hotel_id).eq(
        "claim_id", claim_id
    ).order("created_at", desc=True).execute().data or []
    return {"data": events}


@router.get("/claims/{claim_id}/matches", dependencies=[Depends(require_role(*LOST_FOUND_CLAIM_ROLES))])
async def list_lost_found_claim_matches(claim_id: str, current_user: CurrentUser = Depends(get_current_user)):
    claim = _get_claim(claim_id, current_user.hotel_id)
    if claim.get("status") != "open":
        return {"data": []}
    return {"data": _claim_match_candidates(claim, current_user.hotel_id)}


@router.post("/claims/{claim_id}/reject-match", dependencies=[Depends(require_role(*LOST_FOUND_CLAIM_ROLES))])
async def reject_lost_found_match(
    claim_id: str,
    request: RejectLostFoundMatchRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    claim = _get_claim(claim_id, current_user.hotel_id)
    item = _single(supabase.table("lost_found_items").select("id").eq("id", str(request.item_id)).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single())
    if not item:
        raise HTTPException(status_code=404, detail="Found item not found")
    existing = _single(supabase.table("lost_found_match_rejections").select("id").eq("tenant_id", current_user.hotel_id).eq(
        "claim_id", claim["id"]
    ).eq("item_id", str(request.item_id)).maybe_single())
    if not existing:
        supabase.table("lost_found_match_rejections").insert({
            "tenant_id": current_user.hotel_id, "claim_id": claim["id"], "item_id": str(request.item_id),
            "rejected_by": current_user.user_id, "reason": request.reason,
        }).execute()
        supabase.table("lost_found_claim_events").insert({
            "tenant_id": current_user.hotel_id, "claim_id": claim["id"], "item_id": str(request.item_id),
            "event_type": "possible_match_reviewed", "actor_id": current_user.user_id, "note": request.reason,
        }).execute()
    return {"data": {"rejected": True}}


@router.post("/claims/{claim_id}/match", dependencies=[Depends(require_role(*LOST_FOUND_CLAIM_ROLES))])
async def confirm_lost_found_match(
    claim_id: str,
    request: ConfirmLostFoundMatchRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    claim = _get_claim(claim_id, current_user.hotel_id)
    if claim.get("status") != "open":
        raise HTTPException(status_code=409, detail="Only open claims can be matched")
    item = _single(supabase.table("lost_found_items").select("id, status").eq("id", str(request.item_id)).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single())
    if not item or item.get("status") != "unclaimed":
        raise HTTPException(status_code=409, detail="This found item is no longer available for matching")
    existing_match = _single(supabase.table("lost_found_claims").select("id").eq("tenant_id", current_user.hotel_id).eq(
        "matched_item_id", str(request.item_id)
    ).eq("status", "matched").maybe_single())
    if existing_match:
        raise HTTPException(status_code=409, detail="This item was matched to another claim while you were reviewing it. Refresh to see the latest status.")
    now = datetime.now(timezone.utc).isoformat()
    try:
        result = supabase.table("lost_found_claims").update({
            "status": "matched", "matched_item_id": str(request.item_id), "matched_at": now,
            "matched_by": current_user.user_id, "verification_notes": request.verification_notes,
        }).eq("id", claim_id).eq("tenant_id", current_user.hotel_id).eq("status", "open").execute().data or []
    except Exception as exc:
        raise HTTPException(status_code=409, detail="This item was matched to another claim while you were reviewing it. Refresh to see the latest status.") from exc
    if not result:
        raise HTTPException(status_code=409, detail="This claim changed while you were reviewing it. Refresh to see the latest status.")
    supabase.table("lost_found_claim_events").insert({
        "tenant_id": current_user.hotel_id, "claim_id": claim_id, "item_id": str(request.item_id),
        "event_type": "match_confirmed", "actor_id": current_user.user_id, "note": request.verification_notes,
    }).execute()
    return {"data": _serialize_claim(result[0])}


@router.post("/claims/{claim_id}/remove-match", dependencies=[Depends(require_role(*LOST_FOUND_CLAIM_ROLES))])
async def remove_lost_found_match(
    claim_id: str,
    request: RemoveLostFoundMatchRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    claim = _get_claim(claim_id, current_user.hotel_id)
    if claim.get("status") != "matched":
        raise HTTPException(status_code=409, detail="This claim does not have a confirmed match")
    item_id = claim.get("matched_item_id")
    result = supabase.table("lost_found_claims").update({
        "status": "open", "matched_item_id": None, "matched_at": None, "matched_by": None, "verification_notes": None,
    }).eq("id", claim_id).eq("tenant_id", current_user.hotel_id).execute().data or []
    supabase.table("lost_found_claim_events").insert({
        "tenant_id": current_user.hotel_id, "claim_id": claim_id, "item_id": item_id,
        "event_type": "match_removed", "actor_id": current_user.user_id, "note": request.reason,
    }).execute()
    return {"data": _serialize_claim(result[0])}


@router.post("/claims/{claim_id}/cancel", dependencies=[Depends(require_role(*LOST_FOUND_CLAIM_ROLES))])
async def cancel_lost_found_claim(
    claim_id: str,
    request: CancelLostFoundClaimRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    claim = _get_claim(claim_id, current_user.hotel_id)
    if claim.get("status") in ("closed", "cancelled"):
        raise HTTPException(status_code=409, detail="This claim is already closed")
    item_id = claim.get("matched_item_id")
    result = supabase.table("lost_found_claims").update({
        "status": "cancelled", "cancelled_at": datetime.now(timezone.utc).isoformat(),
        "cancelled_by": current_user.user_id, "cancellation_reason": request.reason,
        "matched_item_id": None, "matched_at": None, "matched_by": None, "verification_notes": None,
    }).eq("id", claim_id).eq("tenant_id", current_user.hotel_id).execute().data or []
    supabase.table("lost_found_claim_events").insert({
        "tenant_id": current_user.hotel_id, "claim_id": claim_id, "item_id": item_id,
        "event_type": "cancelled", "actor_id": current_user.user_id, "note": request.reason,
    }).execute()
    return {"data": _serialize_claim(result[0])}


# --- Returns (Phase 4) ---

@router.get("/returns/summary", dependencies=[Depends(require_role(*LOST_FOUND_MANAGER_ROLES))])
async def lost_found_returns_summary(current_user: CurrentUser = Depends(get_current_user)):
    returns = supabase.table("lost_found_returns").select("*").eq(
        "tenant_id", current_user.hotel_id
    ).execute().data or []
    month_start = datetime.now(timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    ).isoformat()
    return {"data": {
        "awaiting_return": sum(row.get("status") == "awaiting_details" for row in returns),
        "ready_for_pickup": sum(row.get("status") == "ready_for_pickup" for row in returns),
        "shipping": sum(row.get("status") in ("shipping_preparation", "shipped") for row in returns),
        "completed_this_month": sum(
            row.get("status") == "completed" and (row.get("completed_at") or "") >= month_start
            for row in returns
        ),
    }}


@router.get("/returns", dependencies=[Depends(require_role(*LOST_FOUND_MANAGER_ROLES))])
async def list_lost_found_returns(
    status: Optional[Literal[
        "awaiting_details", "ready_for_pickup", "shipping_preparation", "shipped", "completed", "cancelled",
    ]] = Query(None),
    method: Optional[Literal["pickup", "shipping", "other"]] = Query(None),
    item_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None, min_length=1, max_length=120),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
):
    query = (
        supabase.table("lost_found_returns")
        .select("*, lost_found_items(description, tag_identifier), lost_found_claims(claim_number, guest_name)")
        .eq("tenant_id", current_user.hotel_id)
        .order("created_at", desc=True)
        .range((page - 1) * per_page, page * per_page - 1)
    )
    if status:
        query = query.eq("status", status)
    if method:
        query = query.eq("method", method)
    if item_id:
        query = query.eq("item_id", item_id)
    if search:
        term = search.replace(",", " ").replace("(", " ").replace(")", " ")
        query = query.or_(
            f"recipient_name.ilike.%{term}%,tracking_number.ilike.%{term}%,shipping_name.ilike.%{term}%"
        )
    rows = query.execute().data or []
    return {"data": rows, "meta": {"page": page, "per_page": per_page}}


@router.get("/returns/{return_id}", dependencies=[Depends(require_role(*LOST_FOUND_MANAGER_ROLES))])
async def get_lost_found_return(return_id: str, current_user: CurrentUser = Depends(get_current_user)):
    row = _get_return_row(return_id, current_user.hotel_id)
    return {"data": _hydrate_return_context(row, current_user.hotel_id)}


@router.get("/returns/{return_id}/events", dependencies=[Depends(require_role(*LOST_FOUND_MANAGER_ROLES))])
async def list_lost_found_return_events(return_id: str, current_user: CurrentUser = Depends(get_current_user)):
    _get_return_row(return_id, current_user.hotel_id)
    events = supabase.table("lost_found_return_events").select("*").eq(
        "tenant_id", current_user.hotel_id
    ).eq("return_id", return_id).order("created_at", desc=True).execute().data or []
    return {"data": events}


@router.post("/{item_id}/returns", dependencies=[Depends(require_role(*LOST_FOUND_MANAGER_ROLES))])
async def prepare_lost_found_return(
    item_id: str,
    request: PrepareLostFoundReturnRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """D-7: a return can only be prepared once a guest claim is confirmed to this item."""
    item = _get_item_row(item_id, current_user.hotel_id, columns="id, status, voided_at")
    if item.get("voided_at"):
        raise HTTPException(status_code=409, detail="This record has been voided")
    if item.get("status") != "unclaimed":
        raise HTTPException(status_code=409, detail="This item is no longer available to return")
    claim = _get_confirmed_claim_for_item(item_id, current_user.hotel_id)
    if not claim:
        raise HTTPException(status_code=409, detail="This item does not have a confirmed guest claim yet")
    if _get_active_return_for_item(item_id, current_user.hotel_id):
        raise HTTPException(status_code=409, detail="A return is already in progress for this item")
    data = {
        "tenant_id": current_user.hotel_id, "item_id": item_id, "claim_id": claim["id"],
        "method": request.method or "pickup", "status": "awaiting_details",
        "created_by": current_user.user_id,
    }
    try:
        rows = supabase.table("lost_found_returns").insert(data).execute().data or []
    except Exception as exc:
        raise HTTPException(status_code=409, detail="A return is already in progress for this item") from exc
    created = rows[0] if rows else None
    if not created:
        raise HTTPException(status_code=500, detail="Could not create return")
    _record_return_event(current_user.hotel_id, created["id"], "started", current_user.user_id)
    return {"data": created}


@router.patch("/returns/{return_id}/method", dependencies=[Depends(require_role(*LOST_FOUND_MANAGER_ROLES))])
async def update_lost_found_return_method(
    return_id: str,
    request: UpdateLostFoundReturnMethodRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """D-9: switching method is only allowed before any downstream pickup/shipping data exists."""
    _get_return_row(return_id, current_user.hotel_id)
    rows = supabase.table("lost_found_returns").update({"method": request.method}).eq(
        "id", return_id
    ).eq("tenant_id", current_user.hotel_id).eq("status", "awaiting_details").execute().data or []
    if not rows:
        raise HTTPException(
            status_code=409,
            detail="This return's method can no longer be switched without starting over",
        )
    _record_return_event(current_user.hotel_id, return_id, "method_changed", current_user.user_id, note=request.method)
    return {"data": rows[0]}


@router.post("/returns/{return_id}/pickup-details", dependencies=[Depends(require_role(*LOST_FOUND_MANAGER_ROLES))])
async def set_lost_found_pickup_details(
    return_id: str,
    request: SetLostFoundPickupDetailsRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    existing = _get_return_row(return_id, current_user.hotel_id)
    if existing.get("method") != "pickup":
        raise HTTPException(status_code=409, detail="This return is not set up for pickup")
    if existing.get("status") not in ("awaiting_details", "ready_for_pickup"):
        raise HTTPException(status_code=409, detail="This return is no longer awaiting pickup details")
    update = {
        "recipient_name": request.recipient_name, "pickup_location": request.pickup_location,
        "pickup_notes": request.pickup_notes,
        "pickup_verification_method_required": request.verification_method_required,
    }
    rows = supabase.table("lost_found_returns").update(update).eq("id", return_id).eq(
        "tenant_id", current_user.hotel_id
    ).execute().data or []
    _record_return_event(current_user.hotel_id, return_id, "pickup_details_set", current_user.user_id)
    return {"data": rows[0] if rows else existing}


@router.post("/returns/{return_id}/pickup-ready", dependencies=[Depends(require_role(*LOST_FOUND_MANAGER_ROLES))])
async def mark_lost_found_pickup_ready(return_id: str, current_user: CurrentUser = Depends(get_current_user)):
    existing = _get_return_row(return_id, current_user.hotel_id)
    if existing.get("method") != "pickup":
        raise HTTPException(status_code=409, detail="This return is not set up for pickup")
    if not existing.get("recipient_name") or not existing.get("pickup_location"):
        raise HTTPException(status_code=422, detail="Add pickup details before marking this ready")
    now = datetime.now(timezone.utc).isoformat()
    rows = supabase.table("lost_found_returns").update({
        "status": "ready_for_pickup", "pickup_ready_at": now,
    }).eq("id", return_id).eq("tenant_id", current_user.hotel_id).eq(
        "status", "awaiting_details"
    ).execute().data or []
    if not rows:
        raise HTTPException(status_code=409, detail="This return changed while you were viewing it")
    _record_return_event(current_user.hotel_id, return_id, "ready_for_pickup", current_user.user_id)
    return {"data": rows[0]}


@router.post("/returns/{return_id}/pickup-complete", dependencies=[Depends(require_role(*LOST_FOUND_MANAGER_ROLES))])
async def complete_lost_found_pickup(
    return_id: str,
    request: CompleteLostFoundPickupRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """D-13/D-52: item release is the authoritative, irreversible fact — it is written first and
    guarded by an optimistic status check, so two staff releasing the same item cannot both succeed."""
    existing = _get_return_row(return_id, current_user.hotel_id)
    if existing.get("method") != "pickup":
        raise HTTPException(status_code=409, detail="This return is not set up for pickup")
    if existing.get("status") != "ready_for_pickup":
        raise HTTPException(status_code=409, detail="This item is not ready for pickup")
    now = datetime.now(timezone.utc).isoformat()
    item_rows = supabase.table("lost_found_items").update({
        "status": "claimed", "claimed_by_name": request.recipient_name, "claimed_at": now,
        "release_verified_at": now, "release_verification_method": request.verification_method,
    }).eq("id", existing["item_id"]).eq("tenant_id", current_user.hotel_id).eq(
        "status", "unclaimed"
    ).execute().data or []
    if not item_rows:
        raise HTTPException(status_code=409, detail="This item was already released by another staff member")
    return_rows = supabase.table("lost_found_returns").update({
        "status": "completed", "picked_up_at": now, "completed_at": now, "completed_by": current_user.user_id,
        "verification_method": request.verification_method, "verification_notes": request.verification_notes,
    }).eq("id", return_id).eq("tenant_id", current_user.hotel_id).eq(
        "status", "ready_for_pickup"
    ).execute().data or []
    if not return_rows:
        logger.error(
            "Lost & Found pickup: item %s released but return %s failed to complete",
            existing["item_id"], return_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Item was released but the return record could not be finalized. Check this item's custody history.",
        )
    supabase.table("lost_found_claims").update({"status": "closed"}).eq(
        "id", existing["claim_id"]
    ).eq("tenant_id", current_user.hotel_id).eq("status", "matched").execute()
    supabase.table("lost_found_custody_events").insert({
        "tenant_id": current_user.hotel_id, "lost_found_item_id": existing["item_id"], "event_type": "released",
        "recipient_name": request.recipient_name, "verification_method": request.verification_method,
        "note": request.verification_notes, "actor_id": current_user.user_id,
    }).execute()
    _record_return_event(current_user.hotel_id, return_id, "completed", current_user.user_id, note=request.verification_notes)
    return {"data": return_rows[0]}


@router.post("/returns/{return_id}/shipping-details", dependencies=[Depends(require_role(*LOST_FOUND_MANAGER_ROLES))])
async def set_lost_found_shipping_details(
    return_id: str,
    request: SetLostFoundShippingDetailsRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    existing = _get_return_row(return_id, current_user.hotel_id)
    if existing.get("method") != "shipping":
        raise HTTPException(status_code=409, detail="This return is not set up for shipping")
    if existing.get("status") not in ("awaiting_details", "shipping_preparation"):
        raise HTTPException(status_code=409, detail="This return is no longer awaiting shipping details")
    update = {
        "shipping_name": request.recipient_name, "shipping_address_line1": request.address_line1,
        "shipping_address_line2": request.address_line2, "shipping_city": request.city,
        "shipping_region": request.region, "shipping_postal_code": request.postal_code,
        "shipping_country": request.country, "shipping_paid_by": request.shipping_paid_by,
        "status": "shipping_preparation",
    }
    rows = supabase.table("lost_found_returns").update(update).eq("id", return_id).eq(
        "tenant_id", current_user.hotel_id
    ).execute().data or []
    _record_return_event(current_user.hotel_id, return_id, "shipping_details_set", current_user.user_id)
    return {"data": rows[0] if rows else existing}


@router.post("/returns/{return_id}/ship", dependencies=[Depends(require_role(*LOST_FOUND_MANAGER_ROLES))])
async def mark_lost_found_shipped(
    return_id: str,
    request: MarkLostFoundShippedRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """D-19: the hotel's physical custody ends at shipment, so the item and claim close here;
    `shipped` remains a distinct, non-terminal return status until staff confirms completion."""
    existing = _get_return_row(return_id, current_user.hotel_id)
    if existing.get("method") != "shipping":
        raise HTTPException(status_code=409, detail="This return is not set up for shipping")
    if existing.get("status") != "shipping_preparation":
        raise HTTPException(status_code=409, detail="This return is not ready to ship")
    if not existing.get("shipping_address_line1"):
        raise HTTPException(status_code=422, detail="Add a shipping address before marking this shipped")
    now = datetime.now(timezone.utc).isoformat()
    item_rows = supabase.table("lost_found_items").update({
        "status": "claimed", "claimed_by_name": existing.get("shipping_name"), "claimed_at": now,
        "release_verified_at": now, "release_verification_method": f"Shipped via {request.carrier}",
    }).eq("id", existing["item_id"]).eq("tenant_id", current_user.hotel_id).eq(
        "status", "unclaimed"
    ).execute().data or []
    if not item_rows:
        raise HTTPException(status_code=409, detail="This item was already released by another staff member")
    return_rows = supabase.table("lost_found_returns").update({
        "status": "shipped", "carrier": request.carrier, "tracking_number": request.tracking_number,
        "shipping_cost_cents": request.shipping_cost_cents, "shipped_at": now,
    }).eq("id", return_id).eq("tenant_id", current_user.hotel_id).eq(
        "status", "shipping_preparation"
    ).execute().data or []
    if not return_rows:
        logger.error(
            "Lost & Found shipping: item %s released but return %s failed to update",
            existing["item_id"], return_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Item was released but the return record could not be finalized. Check this item's custody history.",
        )
    supabase.table("lost_found_claims").update({"status": "closed"}).eq(
        "id", existing["claim_id"]
    ).eq("tenant_id", current_user.hotel_id).eq("status", "matched").execute()
    supabase.table("lost_found_custody_events").insert({
        "tenant_id": current_user.hotel_id, "lost_found_item_id": existing["item_id"], "event_type": "released",
        "recipient_name": existing.get("shipping_name"), "verification_method": f"Shipped via {request.carrier}",
        "note": f"Tracking: {request.tracking_number}" if request.tracking_number else None,
        "actor_id": current_user.user_id,
    }).execute()
    _record_return_event(current_user.hotel_id, return_id, "shipped", current_user.user_id, note=request.tracking_number)
    return {"data": return_rows[0]}


@router.post("/returns/{return_id}/complete-shipment", dependencies=[Depends(require_role(*LOST_FOUND_MANAGER_ROLES))])
async def complete_lost_found_shipment(return_id: str, current_user: CurrentUser = Depends(get_current_user)):
    existing = _get_return_row(return_id, current_user.hotel_id)
    if existing.get("status") != "shipped":
        raise HTTPException(status_code=409, detail="This return has not been shipped yet")
    now = datetime.now(timezone.utc).isoformat()
    rows = supabase.table("lost_found_returns").update({
        "status": "completed", "completed_at": now, "completed_by": current_user.user_id,
    }).eq("id", return_id).eq("tenant_id", current_user.hotel_id).eq("status", "shipped").execute().data or []
    if not rows:
        raise HTTPException(status_code=409, detail="This return changed while you were viewing it")
    _record_return_event(current_user.hotel_id, return_id, "completed", current_user.user_id)
    return {"data": rows[0]}


# --- Disposition (Phase 4) ---

@router.get("/disposition/summary", dependencies=[Depends(require_role(*LOST_FOUND_DISPOSITION_ROLES))])
async def lost_found_disposition_summary(current_user: CurrentUser = Depends(get_current_user)):
    eligible = _disposition_candidate_items(current_user.hotel_id)
    now = datetime.now(timezone.utc)
    soon_cutoff = now + timedelta(days=7)
    due_now = sum(1 for item in eligible if (_match_date(item["retention_due_at"]) or now) < now)
    due_soon = sum(
        1 for item in eligible if now <= (_match_date(item["retention_due_at"]) or now) < soon_cutoff
    )
    completed = supabase.table("lost_found_items").select("id").eq(
        "tenant_id", current_user.hotel_id
    ).in_("status", ["donated", "discarded"]).execute().data or []
    return {"data": {"due_now": due_now, "due_soon": due_soon, "completed": len(completed)}}


@router.get("/disposition", dependencies=[Depends(require_role(*LOST_FOUND_DISPOSITION_ROLES))])
async def list_lost_found_disposition_queue(
    bucket: Literal["due_now", "due_soon", "completed"] = Query("due_now"),
    search: Optional[str] = Query(None, min_length=1, max_length=120),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    soon_cutoff = now + timedelta(days=7)
    if bucket == "completed":
        rows = (
            supabase.table("lost_found_items").select("*, rooms(room_number)")
            .eq("tenant_id", current_user.hotel_id).in_("status", ["donated", "discarded"])
            .order("claimed_at", desc=True).range((page - 1) * per_page, page * per_page - 1)
            .execute().data or []
        )
    else:
        eligible = _disposition_candidate_items(current_user.hotel_id)
        if bucket == "due_now":
            rows = [item for item in eligible if (_match_date(item["retention_due_at"]) or now) < now]
        else:
            rows = [
                item for item in eligible
                if now <= (_match_date(item["retention_due_at"]) or now) < soon_cutoff
            ]
        rows.sort(key=lambda item: item["retention_due_at"])
    if search:
        needle = search.strip().lower()
        rows = [
            item for item in rows
            if needle in (item.get("description") or "").lower()
            or needle in (item.get("tag_identifier") or "").lower()
            or needle in (item.get("storage_location") or "").lower()
            or needle in (item.get("location_found") or "").lower()
        ]
    return {"data": rows, "meta": {"page": page, "per_page": per_page}}


@router.post("/{item_id}/disposition", dependencies=[Depends(require_role(*LOST_FOUND_DISPOSITION_ROLES))])
async def approve_lost_found_disposition(
    item_id: str,
    request: ApproveLostFoundDispositionRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    item = _get_item_row(item_id, current_user.hotel_id)
    if item.get("voided_at"):
        raise HTTPException(status_code=409, detail="This record has been voided")
    if item.get("status") != "unclaimed":
        raise HTTPException(status_code=409, detail="This item has already reached a final outcome")
    if _get_confirmed_claim_for_item(item_id, current_user.hotel_id):
        raise HTTPException(
            status_code=409,
            detail="This item now has an active guest match and can no longer be disposed",
        )
    if _get_active_return_for_item(item_id, current_user.hotel_id):
        raise HTTPException(
            status_code=409,
            detail="This item has an active return in progress and can no longer be disposed",
        )
    now = datetime.now(timezone.utc).isoformat()
    rows = supabase.table("lost_found_items").update({
        "status": request.outcome, "disposition_approved_by": current_user.user_id, "disposed_at": now,
    }).eq("id", item_id).eq("tenant_id", current_user.hotel_id).eq("status", "unclaimed").execute().data or []
    if not rows:
        raise HTTPException(status_code=409, detail="This item changed while you were reviewing it")
    supabase.table("lost_found_custody_events").insert({
        "tenant_id": current_user.hotel_id, "lost_found_item_id": item_id, "event_type": "disposition",
        "disposition": request.outcome, "note": request.reason, "actor_id": current_user.user_id,
    }).execute()
    return {"data": _attach_item_lifecycle([rows[0]], current_user.hotel_id)[0]}


# --- Void Record (Phase 4) ---

@router.post("/{item_id}/void", dependencies=[Depends(require_role(*LOST_FOUND_VOID_ROLES))])
async def void_lost_found_item(
    item_id: str,
    request: VoidLostFoundRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """D-39/D-41: a non-destructive correction path. The record and its custody history are
    preserved; voiding only hides it from active inventory, matching, and disposition."""
    item = _get_item_row(item_id, current_user.hotel_id)
    if item.get("voided_at"):
        raise HTTPException(status_code=409, detail="This record has already been voided")
    if item.get("status") != "unclaimed":
        raise HTTPException(
            status_code=409,
            detail="This record already reached a final outcome (returned, donated, or discarded) and cannot be voided",
        )
    if _get_confirmed_claim_for_item(item_id, current_user.hotel_id):
        raise HTTPException(status_code=409, detail="This item has an active guest match and cannot be voided")
    if _get_active_return_for_item(item_id, current_user.hotel_id):
        raise HTTPException(status_code=409, detail="This item has an active return and cannot be voided")
    now = datetime.now(timezone.utc).isoformat()
    rows = supabase.table("lost_found_items").update({
        "voided_at": now, "voided_by": current_user.user_id,
        "void_reason": f"{request.reason}: {request.notes}",
    }).eq("id", item_id).eq("tenant_id", current_user.hotel_id).is_("voided_at", "null").execute().data or []
    if not rows:
        raise HTTPException(status_code=409, detail="This item changed while you were reviewing it")
    return {"data": _attach_item_lifecycle([rows[0]], current_user.hotel_id)[0]}


@router.get("/{item_id}/matches", dependencies=[Depends(require_role(*LOST_FOUND_CLAIM_ROLES))])
async def list_lost_found_item_matches(item_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """Expose the inverse view using the same deterministic claim-to-item matcher."""
    item = _single(supabase.table("lost_found_items").select("*, rooms(room_number)").eq("id", item_id).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single())
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    confirmed = _single(supabase.table("lost_found_claims").select("*").eq("tenant_id", current_user.hotel_id).eq(
        "matched_item_id", item_id
    ).eq("status", "matched").maybe_single())
    claims = supabase.table("lost_found_claims").select("*").eq("tenant_id", current_user.hotel_id).eq(
        "status", "open"
    ).execute().data or []
    possible_claims = []
    for claim in claims:
        rejected = _single(supabase.table("lost_found_match_rejections").select("id").eq("tenant_id", current_user.hotel_id).eq(
            "claim_id", claim["id"]
        ).eq("item_id", item_id).maybe_single())
        if rejected:
            continue
        ranked = rank_lost_found_matches(claim, [item])
        if ranked:
            possible_claims.append({"claim": _serialize_claim(claim), "score": ranked[0]["score"], "signals": ranked[0]["signals"]})
    possible_claims.sort(key=lambda candidate: -candidate["score"])
    return {"data": {"confirmed_claim": _serialize_claim(confirmed) if confirmed else None, "possible_claims": possible_claims}}


@router.get("/{item_id}")
async def get_lost_found_item(
    item_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    """Get a specific lost & found item."""
    result = (
        supabase.table("lost_found_items")
        .select("*, rooms(room_number)")
        .eq("id", item_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Item not found")

    item = _attach_finder_profiles(result.data, current_user.hotel_id)[0]
    item = _attach_item_lifecycle([item], current_user.hotel_id)[0]
    return {"data": item}


@router.get("/{item_id}/custody-events")
async def list_lost_found_custody_events(
    item_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    item = _single(supabase.table("lost_found_items").select("id, storage_location").eq("id", item_id).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single())
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    events = supabase.table("lost_found_custody_events").select("*").eq(
        "lost_found_item_id", item_id
    ).eq("tenant_id", current_user.hotel_id).order("created_at").execute().data or []
    return {"data": events}


@router.post("/{item_id}/custody-events")
async def record_lost_found_custody_event(
    item_id: str,
    request: CreateLostFoundCustodyEventRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    if current_user.role not in LOST_FOUND_MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized to change item custody")
    item = _single(supabase.table("lost_found_items").select("id, storage_location, voided_at").eq("id", item_id).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single())
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.get("voided_at"):
        raise HTTPException(status_code=409, detail="This record has been voided")
    try:
        validate_lost_found_custody_event(
            event_type=request.event_type,
            verification_method=request.verification_method,
            recipient_name=request.recipient_name,
        )
    except MissingCustodyVerificationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if request.event_type == "moved":
        if not request.storage_location:
            raise HTTPException(status_code=422, detail="A destination storage location is required.")
        current_location = item.get("storage_location")
        if (
            current_location
            and request.storage_location.casefold() == current_location.casefold()
            and not request.note
        ):
            raise HTTPException(
                status_code=422,
                detail="Choose a different storage location or add a reason for this move.",
            )
    event_payload = request.model_dump(exclude_none=True)
    if request.event_type == "moved":
        event_payload["previous_storage_location"] = item.get("storage_location")
    event = supabase.table("lost_found_custody_events").insert({
        "tenant_id": current_user.hotel_id,
        "lost_found_item_id": item_id,
        **event_payload,
        "actor_id": current_user.user_id,
    }).execute().data[0]
    update: dict[str, str] = {}
    if request.storage_location:
        update["storage_location"] = request.storage_location
    if request.event_type == "released":
        now = datetime.now(timezone.utc).isoformat()
        update.update({
            "status": "claimed",
            "claimed_by_name": request.recipient_name or "",
            "claimed_at": now,
            "release_verified_at": now,
            "release_verification_method": request.verification_method or "",
        })
    if request.event_type == "disposition" and request.disposition:
        update["status"] = request.disposition
        update["disposition_approved_by"] = current_user.user_id
    if update:
        supabase.table("lost_found_items").update(update).eq("id", item_id).eq(
            "tenant_id", current_user.hotel_id
        ).execute()
    return {"data": event}


@router.patch("/{item_id}")
async def update_lost_found_item(
    item_id: str, body: UpdateLostFoundRequest, current_user: CurrentUser = Depends(get_current_user)
):
    """Update item facts; storage movement is always recorded as custody."""
    if current_user.role not in LOST_FOUND_MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized to update this item")
    update_data = body.model_dump(exclude_unset=True)
    if update_data.get("room_id"):
        update_data["room_id"] = str(update_data["room_id"])
    if update_data.get("found_at"):
        update_data["found_at"] = update_data["found_at"].isoformat()
    if update_data.get("claimed_at"):
        update_data["claimed_at"] = update_data["claimed_at"].isoformat()
    if (
        update_data.get("status") in ("claimed", "donated", "discarded")
        and "claimed_at" not in update_data
    ):
        update_data["claimed_at"] = datetime.now(timezone.utc).isoformat()
    if update_data.get("tag_identifier") and _active_tag_exists(
        update_data["tag_identifier"], current_user.hotel_id, excluding_item_id=item_id
    ):
        raise HTTPException(status_code=409, detail="This tag ID is already in use.")

    result = (
        supabase.table("lost_found_items")
        .update(update_data)
        .eq("id", item_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Item not found")

    return {"data": result.data[0] if result.data else None}


@router.delete("/{item_id}", status_code=204, dependencies=[Depends(require_role("gm"))])
async def delete_lost_found_item(
    item_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    """D-42: permanent delete is intentionally narrowed to GM-only and removed from the
    operational UI entirely. Routine corrections use Void Record (POST /{item_id}/void)."""
    result = (
        supabase.table("lost_found_items")
        .delete()
        .eq("id", item_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Item not found")

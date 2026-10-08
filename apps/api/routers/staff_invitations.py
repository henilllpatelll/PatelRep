"""Staff invitation lifecycle: create, list, resend, revoke, reissue and accept.

A staff_invitations row is a *request to onboard*, not proof an email arrived. Every send records the
email provider's outcome (`delivery_status`: requested | failed | existing_account) and returns it.
Acceptance is bound to the signed-in, email-confirmed auth user whose address matches the invitation.
"""
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core.database import supabase
from middleware.auth import CurrentUser, get_current_user_no_hotel, require_role
from models.requests import InviteStaffRequest, ReissueInvitationRequest
from routers.staff import _departments_map, validate_department

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/staff", tags=["staff"])

INVITATION_TTL_DAYS = 7
RESEND_COOLDOWN_SECONDS = 60
MAX_SENDS_PER_INVITATION = 10
MAX_INVITATIONS_PER_DAY = 50
INVITATION_STATUSES = ("open", "pending", "expired", "revoked", "accepted", "all")
_INVITATION_COLUMNS = (
    "id, tenant_id, email, role, department_id, invited_by, expires_at, accepted_at, created_at, "
    "full_name, phone, revoked_at, last_sent_at, send_count, delivery_status, delivery_error"
)
_DELIVERY_NOTE = "Reflects the email provider's response to our request, not confirmed inbox delivery."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def invitation_status(inv: dict, now: Optional[datetime] = None) -> str:
    if inv.get("accepted_at"):
        return "accepted"
    if inv.get("revoked_at"):
        return "revoked"
    expires = _parse_ts(inv.get("expires_at"))
    if expires is not None and expires <= (now or _now()):
        return "expired"
    return "pending"


def _public_invitation(inv: dict, dept_map: Optional[dict] = None) -> dict:
    """Shape sent to clients. The raw token is never included."""
    return {
        "id": inv["id"],
        "hotel_id": inv["tenant_id"],
        "email": inv["email"],
        "full_name": inv.get("full_name"),
        "phone": inv.get("phone"),
        "role": inv["role"],
        "department_id": inv.get("department_id"),
        "department_name": (dept_map or {}).get(inv.get("department_id")),
        "status": invitation_status(inv),
        "invited_at": inv.get("created_at"),
        "created_at": inv.get("created_at"),
        "expires_at": inv.get("expires_at"),
        "accepted_at": inv.get("accepted_at"),
        "revoked_at": inv.get("revoked_at"),
        "last_sent_at": inv.get("last_sent_at"),
        "send_count": inv.get("send_count"),
        "delivery": {
            "status": inv.get("delivery_status"),
            "error": inv.get("delivery_error"),
            "note": _DELIVERY_NOTE,
        },
    }


def _request_invite_email(email: str, user_metadata: dict) -> tuple:
    """Ask Supabase Auth to email the invite. Returns (delivery_status, error_message)."""
    try:
        supabase.auth.admin.invite_user_by_email(email, options={"data": user_metadata})
        return "requested", None
    except Exception as exc:
        detail = str(exc).lower()
        if "already been registered" in detail or "already registered" in detail or "email_exists" in detail:
            return "existing_account", "This email already has a sign-in; the invitation is recorded but no email was sent."
        logger.warning("invite email request failed: %s", exc)
        return "failed", "The email provider rejected the request. Resend the invitation to retry."


def _record_delivery(invitation_id: str, status: str, error: Optional[str]) -> dict:
    result = supabase.table("staff_invitations")\
        .update({"delivery_status": status, "delivery_error": error})\
        .eq("id", invitation_id)\
        .execute()
    return result.data[0] if result.data else {}


def _metadata_for(inv: dict) -> dict:
    metadata = {"hotel_id": inv["tenant_id"], "role": inv["role"], "full_name": inv.get("full_name") or ""}
    if inv.get("phone"):
        metadata["phone"] = inv["phone"]
    return metadata


def _get_invitation(invitation_id: str, hotel_id: str) -> dict:
    result = supabase.table("staff_invitations")\
        .select(_INVITATION_COLUMNS)\
        .eq("id", invitation_id)\
        .eq("tenant_id", hotel_id)\
        .execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Invitation not found")
    return result.data[0]


def _create_staff_invitation(body: InviteStaffRequest, hotel_id: str, invited_by: str) -> dict:
    email = body.email.lower()
    department_id = validate_department(body.department_id, hotel_id) if body.department_id else None

    since = (_now() - timedelta(days=1)).isoformat()
    recent = supabase.table("staff_invitations")\
        .select("id")\
        .eq("tenant_id", hotel_id)\
        .gte("created_at", since)\
        .execute()
    if len(recent.data or []) >= MAX_INVITATIONS_PER_DAY:
        raise HTTPException(status_code=429, detail="Too many invitations created today; try again tomorrow")

    live = supabase.table("staff_invitations")\
        .select(_INVITATION_COLUMNS)\
        .eq("tenant_id", hotel_id)\
        .eq("email", email)\
        .is_("accepted_at", "null")\
        .is_("revoked_at", "null")\
        .execute()
    for existing in (live.data or []):
        if invitation_status(existing) == "pending":
            raise HTTPException(
                status_code=409,
                detail="A pending invitation already exists for this email; resend or revoke it instead",
            )
        # Expired and never used: supersede it so exactly one live invitation remains.
        supabase.table("staff_invitations")\
            .update({"revoked_at": _now().isoformat(), "revoked_by": invited_by})\
            .eq("id", existing["id"])\
            .execute()

    now = _now()
    row = {
        "tenant_id": hotel_id,
        "email": email,
        "role": body.role,
        "invited_by": invited_by,
        "full_name": body.full_name,
        "token": secrets.token_urlsafe(32),
        "expires_at": (now + timedelta(days=INVITATION_TTL_DAYS)).isoformat(),
        "last_sent_at": now.isoformat(),
        "send_count": 1,
    }
    if department_id:
        row["department_id"] = department_id
    if body.phone:
        row["phone"] = body.phone

    try:
        inserted = supabase.table("staff_invitations").insert(row).execute()
    except Exception as exc:
        if "uq_staff_invitations_live_email" in str(exc) or "23505" in str(exc):
            raise HTTPException(status_code=409, detail="A pending invitation already exists for this email")
        raise
    if not inserted.data:
        raise HTTPException(status_code=500, detail="Failed to create invitation record")
    invitation = inserted.data[0]

    status, error = _request_invite_email(email, _metadata_for(invitation))
    invitation = {**invitation, **_record_delivery(invitation["id"], status, error),
                  "delivery_status": status, "delivery_error": error}
    return _public_invitation(invitation, _departments_map(hotel_id))


@router.post("/invite")
async def invite_staff(
    body: InviteStaffRequest,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Invite a new staff member by email. The response reports the email-provider outcome."""
    return {"data": _create_staff_invitation(body, current_user.hotel_id, current_user.user_id)}


@router.post("/onboarding-invite")
async def invite_staff_during_onboarding(
    body: InviteStaffRequest,
    current_user: CurrentUser = Depends(get_current_user_no_hotel)
):
    """
    Invite staff during first-run onboarding before the user's refreshed JWT has hotel_id.
    The body hotel_id is accepted only after proving this caller is that hotel's active GM.
    """
    if not body.hotel_id:
        raise HTTPException(status_code=400, detail="hotel_id required")

    owner_role = supabase.table("user_roles")\
        .select("id")\
        .eq("tenant_id", body.hotel_id)\
        .eq("user_id", current_user.user_id)\
        .eq("role", "gm")\
        .eq("is_active", True)\
        .maybe_single()\
        .execute()

    if not owner_role or not owner_role.data:
        raise HTTPException(status_code=403, detail="Not authorized to invite staff for this hotel")

    return {"data": _create_staff_invitation(body, body.hotel_id, current_user.user_id)}


@router.get("/invitations")
async def list_invitations(
    status: str = "open",
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """List invitations with a computed status.

    `open` (default) = not accepted and not revoked (pending + expired), matching the earlier
    "not yet accepted" contract. Also: pending, expired, revoked, accepted, all.
    """
    if status not in INVITATION_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of: {', '.join(INVITATION_STATUSES)}")
    result = supabase.table("staff_invitations")\
        .select(_INVITATION_COLUMNS)\
        .eq("tenant_id", current_user.hotel_id)\
        .order("created_at", desc=True)\
        .execute()
    dept_map = _departments_map(current_user.hotel_id)
    now = _now()
    invitations = []
    for inv in (result.data or []):
        computed = invitation_status(inv, now)
        if status == "all" or computed == status or (status == "open" and computed in ("pending", "expired")):
            invitations.append(_public_invitation(inv, dept_map))
    return {"data": {"invitations": invitations, "total": len(invitations)}}


@router.post("/invitations/accept")
async def accept_invitation(current_user: CurrentUser = Depends(get_current_user_no_hotel)):
    """Attach the signed-in, email-confirmed user to the hotel that invited their address.

    Refuses revoked, expired and already-accepted invitations. Idempotent for people who already hold
    an active role. The caller must refresh their session afterwards to receive hotel/role claims.
    """
    email = (current_user.email or "").lower()
    if not email:
        raise HTTPException(status_code=403, detail="No email on this account")

    auth_user = None
    try:
        auth_user = supabase.auth.admin.get_user_by_id(current_user.user_id)
        auth_user = getattr(auth_user, "user", auth_user)
    except Exception:
        raise HTTPException(status_code=403, detail="Could not verify this account")
    if not getattr(auth_user, "email_confirmed_at", None):
        raise HTTPException(status_code=403, detail="Email address is not confirmed")

    active = supabase.table("user_roles")\
        .select("tenant_id, role")\
        .eq("user_id", current_user.user_id)\
        .eq("is_active", True)\
        .execute()
    if active.data:
        return {"data": {"accepted": False, "already_member": True, "hotel_id": active.data[0]["tenant_id"]}}

    found = supabase.table("staff_invitations")\
        .select(_INVITATION_COLUMNS)\
        .eq("email", email)\
        .order("created_at", desc=True)\
        .execute()
    candidates = [inv for inv in (found.data or []) if not inv.get("accepted_at")]
    if not candidates:
        raise HTTPException(status_code=404, detail="No invitation found for this email")

    pending = [inv for inv in candidates if invitation_status(inv) == "pending"]
    latest = pending[0] if pending else candidates[0]
    state = invitation_status(latest)
    if state == "revoked":
        raise HTTPException(status_code=403, detail="This invitation was revoked")
    if state == "expired":
        raise HTTPException(status_code=410, detail="This invitation has expired; ask your manager to resend it")

    hotel_id = latest["tenant_id"]
    # A profile row is keyed by user id; never re-point someone who belongs to another hotel.
    profile = supabase.table("user_profiles").select("id, tenant_id").eq("id", current_user.user_id).execute()
    if profile.data and str(profile.data[0]["tenant_id"]) != str(hotel_id):
        raise HTTPException(status_code=409, detail="This account already belongs to another hotel")

    # Atomically claim the invitation: only one caller can flip accepted_at from NULL.
    claimed = supabase.table("staff_invitations")\
        .update({"accepted_at": _now().isoformat()})\
        .eq("id", latest["id"])\
        .eq("tenant_id", hotel_id)\
        .is_("accepted_at", "null")\
        .is_("revoked_at", "null")\
        .execute()
    if not claimed.data:
        raise HTTPException(status_code=409, detail="This invitation is no longer available")

    try:
        if not profile.data:
            full_name = latest.get("full_name") or email.split("@")[0]
            profile_row = {
                "id": current_user.user_id,
                "tenant_id": hotel_id,
                "full_name": full_name,
                "preferred_name": full_name.split()[0],
            }
            if latest.get("phone"):
                profile_row["phone"] = latest["phone"]
            supabase.table("user_profiles").insert(profile_row).execute()
        role_row = {
            "user_id": current_user.user_id,
            "tenant_id": hotel_id,
            "role": latest["role"],
            "is_active": True,
        }
        if latest.get("department_id"):
            role_row["department_id"] = latest["department_id"]
        supabase.table("user_roles").upsert(role_row, on_conflict="user_id,tenant_id,role").execute()
    except Exception:
        supabase.table("staff_invitations").update({"accepted_at": None}).eq("id", latest["id"]).execute()
        logger.exception("invitation acceptance failed after claim; claim released")
        raise HTTPException(status_code=500, detail="Could not complete invitation; please try again")

    return {"data": {"accepted": True, "already_member": False, "hotel_id": hotel_id, "role": latest["role"]}}


@router.post("/invitations/{invitation_id}/resend")
async def resend_invitation(
    invitation_id: str,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Re-send a pending or expired invitation. Rotates the token and starts a fresh 7-day window."""
    inv = _get_invitation(invitation_id, current_user.hotel_id)
    state = invitation_status(inv)
    if state == "accepted":
        raise HTTPException(status_code=409, detail="This invitation was already accepted")
    if state == "revoked":
        raise HTTPException(status_code=409, detail="This invitation was revoked; create a new one")

    now = _now()
    last_sent = _parse_ts(inv.get("last_sent_at"))
    if last_sent is not None:
        wait = RESEND_COOLDOWN_SECONDS - int((now - last_sent).total_seconds())
        if wait > 0:
            raise HTTPException(
                status_code=429,
                detail=f"Invitation was just sent; try again in {wait}s",
                headers={"Retry-After": str(wait)},
            )
    if (inv.get("send_count") or 0) >= MAX_SENDS_PER_INVITATION:
        raise HTTPException(status_code=429, detail="Resend limit reached; revoke and create a new invitation")

    updated = supabase.table("staff_invitations")\
        .update({
            "token": secrets.token_urlsafe(32),
            "expires_at": (now + timedelta(days=INVITATION_TTL_DAYS)).isoformat(),
            "last_sent_at": now.isoformat(),
            "send_count": (inv.get("send_count") or 0) + 1,
        })\
        .eq("id", invitation_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .is_("accepted_at", "null")\
        .is_("revoked_at", "null")\
        .execute()
    if not updated.data:
        raise HTTPException(status_code=409, detail="This invitation is no longer available")
    inv = {**inv, **updated.data[0]}

    status, error = _request_invite_email(inv["email"], _metadata_for(inv))
    inv = {**inv, **_record_delivery(invitation_id, status, error), "delivery_status": status, "delivery_error": error}
    return {"data": _public_invitation(inv, _departments_map(current_user.hotel_id))}


@router.delete("/invitations/{invitation_id}")
async def revoke_invitation(
    invitation_id: str,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Revoke a pending/expired invitation. A revoked invitation can never be accepted."""
    inv = _get_invitation(invitation_id, current_user.hotel_id)
    if inv.get("accepted_at"):
        raise HTTPException(status_code=409, detail="This invitation was already accepted")
    if inv.get("revoked_at"):
        return {"data": _public_invitation(inv, _departments_map(current_user.hotel_id))}

    revoked = supabase.table("staff_invitations")\
        .update({"revoked_at": _now().isoformat(), "revoked_by": current_user.user_id})\
        .eq("id", invitation_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .is_("accepted_at", "null")\
        .execute()
    if not revoked.data:
        raise HTTPException(status_code=409, detail="This invitation is no longer available")
    return {"data": _public_invitation({**inv, **revoked.data[0]}, _departments_map(current_user.hotel_id))}


@router.post("/invitations/{invitation_id}/reissue")
async def reissue_invitation(
    invitation_id: str,
    body: ReissueInvitationRequest,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Revoke-and-reissue: safely 'edit' an outstanding invitation's role/department/name/phone."""
    inv = _get_invitation(invitation_id, current_user.hotel_id)
    if inv.get("accepted_at"):
        raise HTTPException(status_code=409, detail="This invitation was already accepted")

    changes = body.model_dump(exclude_unset=True)
    new_request = InviteStaffRequest(
        email=inv["email"],
        role=changes.get("role") or inv["role"],
        full_name=changes.get("full_name") or inv.get("full_name") or inv["email"].split("@")[0],
        department_id=changes.get("department_id") or inv.get("department_id"),
        phone=changes.get("phone") if "phone" in changes else inv.get("phone"),
    )
    if new_request.department_id:
        validate_department(new_request.department_id, current_user.hotel_id)

    if not inv.get("revoked_at"):
        supabase.table("staff_invitations")\
            .update({"revoked_at": _now().isoformat(), "revoked_by": current_user.user_id})\
            .eq("id", invitation_id)\
            .eq("tenant_id", current_user.hotel_id)\
            .is_("accepted_at", "null")\
            .execute()
    return {"data": _create_staff_invitation(new_request, current_user.hotel_id, current_user.user_id)}

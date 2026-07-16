from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from typing import Literal, Optional
from datetime import datetime, timezone
from middleware.auth import get_current_user, CurrentUser
from models.requests import CreateLostFoundCustodyEventRequest, CreateLostFoundRequest
from core.database import supabase
from core.config import settings
from services.guest_recovery.contracts import (
    MissingCustodyVerificationError,
    validate_lost_found_custody_event,
)

router = APIRouter(prefix="/lost-found", tags=["lost-found"])

ALLOWED_PHOTO_TYPES = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
MAX_PHOTO_BYTES = 5 * 1024 * 1024


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


@router.post("")
async def create_lost_found_item(
    request: CreateLostFoundRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Log a found item."""
    data = {
        "tenant_id": current_user.hotel_id,
        "description": request.description,
        "room_id": str(request.room_id) if request.room_id else None,
        "location_found": request.location_found,
        "notes": request.notes,
        "photo_url": request.photo_url,
        "tag_identifier": request.tag_identifier,
        "storage_location": request.storage_location,
        "found_by": current_user.user_id,
        "status": "unclaimed",
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
            "note": request.notes,
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
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
):
    """List lost & found items with optional filters."""
    query = (
        supabase.table("lost_found_items")
        .select("*, rooms(room_number)")
        .eq("tenant_id", current_user.hotel_id)
        .order("created_at", desc=True)
        .range((page - 1) * per_page, page * per_page - 1)
    )

    if status:
        query = query.eq("status", status)
    if date_from:
        query = query.gte("created_at", date_from)
    if date_to:
        query = query.lte("created_at", date_to + "T23:59:59")
    if search:
        query = query.ilike("description", f"%{search}%")

    result = query.execute()
    items = result.data or []

    return {"data": items, "meta": {"page": page, "per_page": per_page}}


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

    return {"data": result.data[0]}


@router.get("/{item_id}/custody-events")
async def list_lost_found_custody_events(
    item_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    item = supabase.table("lost_found_items").select("id").eq("id", item_id).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single().execute().data
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
    if current_user.role not in {"front_desk", "housekeeping_supervisor", "gm"}:
        raise HTTPException(status_code=403, detail="Not authorized to change item custody")
    item = supabase.table("lost_found_items").select("id").eq("id", item_id).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single().execute().data
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    try:
        validate_lost_found_custody_event(
            event_type=request.event_type,
            verification_method=request.verification_method,
            recipient_name=request.recipient_name,
        )
    except MissingCustodyVerificationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    event = supabase.table("lost_found_custody_events").insert({
        "tenant_id": current_user.hotel_id,
        "lost_found_item_id": item_id,
        **request.model_dump(),
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
    item_id: str, body: dict, current_user: CurrentUser = Depends(get_current_user)
):
    """Update lost & found item status (unclaimed → claimed/donated/discarded)."""
    allowed_fields = {
        "description",
        "location_found",
        "room_id",
        "notes",
        "status",
        "claimed_by_name",
        "claimed_by_contact",
        "claimed_at",
    }
    update_data = {k: v for k, v in body.items() if k in allowed_fields}

    if (
        update_data.get("status") in ("claimed", "donated", "discarded")
        and "claimed_at" not in update_data
    ):
        update_data["claimed_at"] = datetime.now(timezone.utc).isoformat()

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


@router.delete("/{item_id}", status_code=204)
async def delete_lost_found_item(
    item_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    result = (
        supabase.table("lost_found_items")
        .delete()
        .eq("id", item_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Item not found")

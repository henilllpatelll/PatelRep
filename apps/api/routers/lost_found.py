from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from typing import Optional
from datetime import datetime, timezone
from middleware.auth import get_current_user, CurrentUser
from models.requests import CreateLostFoundRequest
from core.database import supabase
from core.config import settings

router = APIRouter(prefix="/lost-found", tags=["lost-found"])


@router.post("/upload-photo")
async def upload_photo(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user)
):
    """Upload a photo for a lost & found item and return its public URL."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    ext_map = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp"}
    ext = ext_map.get(file.content_type, "jpg")
    path = f"{current_user.hotel_id}/{int(datetime.now(timezone.utc).timestamp() * 1000)}.{ext}"

    contents = await file.read()

    try:
        supabase.storage.from_("lost-found-photos").upload(
            path, contents, {"content-type": file.content_type, "upsert": "false"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Photo upload failed: {e}")

    public_url = f"{settings.supabase_url}/storage/v1/object/public/lost-found-photos/{path}"
    return {"data": {"url": public_url}}


@router.post("")
async def create_lost_found_item(
    request: CreateLostFoundRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Log a found item."""
    data = {
        "tenant_id": current_user.hotel_id,
        "description": request.description,
        "room_id": str(request.room_id) if request.room_id else None,
        "location_found": request.location_found,
        "notes": request.notes,
        "photo_url": request.photo_url,
        "found_by": current_user.user_id,
        "status": "unclaimed",
    }
    result = supabase.table("lost_found_items").insert(data).execute()
    return {"data": result.data[0] if result.data else None}


@router.get("")
async def list_lost_found_items(
    status: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1),
    per_page: int = Query(20),
    current_user: CurrentUser = Depends(get_current_user)
):
    """List lost & found items with optional filters."""
    query = supabase.table("lost_found_items")\
        .select("*, rooms(room_number)")\
        .eq("tenant_id", current_user.hotel_id)\
        .order("created_at", desc=True)\
        .range((page - 1) * per_page, page * per_page - 1)

    if status:
        query = query.eq("status", status)
    if date_from:
        query = query.gte("created_at", date_from)
    if date_to:
        query = query.lte("created_at", date_to + "T23:59:59")

    result = query.execute()
    items = result.data or []

    # Client-side search filter (simple substring match on description)
    if search:
        search_lower = search.lower()
        items = [item for item in items if search_lower in item.get("description", "").lower()]

    return {"data": items, "meta": {"page": page, "per_page": per_page}}


@router.get("/{item_id}")
async def get_lost_found_item(
    item_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Get a specific lost & found item."""
    result = supabase.table("lost_found_items")\
        .select("*, rooms(room_number)")\
        .eq("id", item_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Item not found")

    return {"data": result.data[0]}


@router.patch("/{item_id}")
async def update_lost_found_item(
    item_id: str,
    body: dict,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Update lost & found item status (unclaimed → claimed/donated/discarded)."""
    allowed_fields = {
        "description", "location_found", "room_id", "notes",
        "status", "claimed_by_name", "claimed_by_contact", "claimed_at",
    }
    update_data = {k: v for k, v in body.items() if k in allowed_fields}

    if update_data.get("status") in ("claimed", "donated", "discarded") and "claimed_at" not in update_data:
        update_data["claimed_at"] = datetime.now(timezone.utc).isoformat()

    result = supabase.table("lost_found_items")\
        .update(update_data)\
        .eq("id", item_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Item not found")

    return {"data": result.data[0] if result.data else None}


@router.delete("/{item_id}", status_code=204)
async def delete_lost_found_item(
    item_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    result = supabase.table("lost_found_items") \
        .delete() \
        .eq("id", item_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Item not found")

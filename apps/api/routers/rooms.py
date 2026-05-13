import logging
from fastapi import APIRouter, Depends, Query, HTTPException
from typing import Optional
from datetime import datetime, timezone, date
from pydantic import BaseModel
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import UpdateRoomStatusRequest, ImportRoomsRequest
from core.database import supabase

logger = logging.getLogger(__name__)


class AddRoomNoteRequest(BaseModel):
    text: str

router = APIRouter(prefix="/rooms", tags=["rooms"])

# ---------------------------------------------------------------------------
# Status transition rules
# ---------------------------------------------------------------------------
# Keys are (from_status, to_status). Value is a set of roles that may perform
# the transition. None means any authenticated staff member may do it.
ALLOWED_TRANSITIONS: dict[tuple[str, str], set[str] | None] = {
    ("DIRTY",     "IN_PROGRESS"): None,
    ("IN_PROGRESS", "CLEAN"):     None,
    ("CLEAN",     "INSPECTED"):   {"gm", "housekeeping_supervisor"},
    ("CLEAN",     "DIRTY"):       {"gm", "housekeeping_supervisor"},
    ("DIRTY",     "PICKUP"):      None,
    ("PICKUP",    "CLEAN"):       None,
    ("INSPECTED", "DIRTY"):       {"gm", "housekeeping_supervisor"},
}

# Any status → OOO and OOO → DIRTY are supervisor/GM only
OOO_SOURCES = {s for s in ("DIRTY", "IN_PROGRESS", "CLEAN", "INSPECTED", "PICKUP")}
for _s in OOO_SOURCES:
    ALLOWED_TRANSITIONS[(_s, "OOO")] = {"gm", "housekeeping_supervisor"}
ALLOWED_TRANSITIONS[("OOO", "DIRTY")] = {"gm", "housekeeping_supervisor"}


def _validate_transition(from_status: str | None, to_status: str, role: str) -> None:
    """Raises HTTPException(400) if the transition is not allowed for the role."""
    key = (from_status, to_status)
    if key not in ALLOWED_TRANSITIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status transition: {from_status} -> {to_status}",
        )
    required_roles = ALLOWED_TRANSITIONS[key]
    if required_roles is not None and role not in required_roles:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Role '{role}' is not allowed to transition "
                f"{from_status} -> {to_status}"
            ),
        )


def _update_housekeeper_profile(
    hotel_id: str,
    room_id: str,
    user_id: str | None,
    room_status_data: dict,
) -> None:
    """Update the housekeeper's average cleaning speed for this room type."""
    if not user_id:
        return

    # Find the room type
    room = supabase.table("rooms")\
        .select("room_type_id")\
        .eq("id", room_id)\
        .eq("tenant_id", hotel_id)\
        .maybe_single()\
        .execute()

    room_data = (room.data if room else None) or {}
    if not room_data.get("room_type_id"):
        return

    room_type_id = room_data["room_type_id"]

    # Estimate time from last status change to now
    # We approximate using the room_status.updated_at as the IN_PROGRESS start time
    # (Not perfect, but avoids a history query on every room completion)
    started_approx = room_status_data.get("updated_at")
    if not started_approx:
        return

    try:
        start_dt = datetime.fromisoformat(started_approx.replace("Z", "+00:00"))
        elapsed_minutes = (datetime.now(timezone.utc).replace(tzinfo=start_dt.tzinfo) - start_dt).total_seconds() / 60
    except (ValueError, TypeError):
        return

    if elapsed_minutes <= 0 or elapsed_minutes > 240:
        return  # Ignore unrealistic durations

    # Upsert housekeeper_profiles with rolling average
    existing = supabase.table("housekeeper_profiles")\
        .select("id, avg_clean_minutes, completion_count")\
        .eq("user_id", user_id)\
        .eq("tenant_id", hotel_id)\
        .eq("room_type_id", room_type_id)\
        .maybe_single()\
        .execute()

    existing_data = (existing.data if existing else None) or {}
    if existing_data:
        old_avg = float(existing_data.get("avg_clean_minutes") or elapsed_minutes)
        old_count = int(existing_data.get("completion_count") or 0)
        new_count = old_count + 1
        new_avg = (old_avg * old_count + elapsed_minutes) / new_count

        supabase.table("housekeeper_profiles")\
            .update({
                "avg_clean_minutes": round(new_avg, 2),
                "completion_count": new_count,
                "last_updated_at": datetime.now(timezone.utc).isoformat(),
            })\
            .eq("id", existing_data["id"])\
            .execute()
    else:
        supabase.table("housekeeper_profiles").insert({
            "user_id": user_id,
            "tenant_id": hotel_id,
            "room_type_id": room_type_id,
            "avg_clean_minutes": round(elapsed_minutes, 2),
            "completion_count": 1,
            "last_updated_at": datetime.now(timezone.utc).isoformat(),
        }).execute()


# ---------------------------------------------------------------------------
# GET /rooms
# ---------------------------------------------------------------------------

@router.get("")
async def list_rooms(
    status: Optional[str] = Query(None),
    floor: Optional[int] = Query(None),
    assigned_to: Optional[str] = Query(None),
    risk_level: Optional[str] = Query(None),
    include_predictions: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
):
    query = (
        supabase.table("room_status")
        .select(
            "*, "
            "rooms(id, room_number, floor, building, room_type_id, "
            "room_types(name, code, base_clean_minutes))"
        )
        .eq("tenant_id", current_user.hotel_id)
    )

    if status:
        query = query.eq("status", status)
    if risk_level:
        query = query.eq("risk_level", risk_level)

    result = query.execute()
    rows = result.data or []

    # Apply Python-side filters that cannot be pushed to supabase-py joined cols
    if floor is not None:
        rows = [
            r for r in rows
            if r.get("rooms") and r["rooms"].get("floor") == floor
        ]
    if assigned_to is not None:
        rows = [r for r in rows if r.get("assigned_to") == assigned_to]

    return {"data": rows}


# ---------------------------------------------------------------------------
# GET /rooms/{room_id}
# ---------------------------------------------------------------------------

@router.get("/{room_id}")
async def get_room(
    room_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    result = (
        supabase.table("rooms")
        .select("*, room_status(*), room_types(*)")
        .eq("id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"data": result.data[0]}


# ---------------------------------------------------------------------------
# PATCH /rooms/{room_id}/status
# ---------------------------------------------------------------------------

@router.patch("/{room_id}/status")
async def update_room_status(
    room_id: str,
    request: UpdateRoomStatusRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    # 1. Fetch current status — also verify room belongs to tenant
    current_row = (
        supabase.table("room_status")
        .select("*")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not current_row or not current_row.data:
        raise HTTPException(status_code=404, detail="Room status record not found")

    from_status: str = current_row.data.get("status")
    to_status: str = request.status

    # 2. Validate transition
    _validate_transition(from_status, to_status, current_user.role)

    # 3. Build the update payload
    now_iso = datetime.now(timezone.utc).isoformat()
    update_payload: dict = {
        "status": to_status,
        "notes": request.notes,
        "updated_at": now_iso,
    }

    if to_status == "CLEAN":
        update_payload["last_cleaned_at"] = now_iso

    if to_status == "INSPECTED":
        update_payload["last_inspected_at"] = now_iso
        update_payload["last_inspected_by"] = current_user.user_id

    # 4. Persist
    update_result = (
        supabase.table("room_status")
        .update(update_payload)
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )

    # 5. Write history explicitly — the DB trigger was dropped in migration 024.
    supabase.table("room_status_history").insert({
        "room_id": room_id,
        "tenant_id": current_user.hotel_id,
        "from_status": from_status,
        "to_status": to_status,
        "changed_by": current_user.user_id,
        "change_source": "app",
        "notes": request.notes,
    }).execute()

    # 6. Update housekeeper speed profile (IN_PROGRESS → CLEAN)
    if from_status == "IN_PROGRESS" and to_status == "CLEAN":
        try:
            _update_housekeeper_profile(
                hotel_id=current_user.hotel_id,
                room_id=room_id,
                user_id=current_row.data.get("assigned_to"),
                room_status_data=current_row.data,
            )
        except Exception:
            logger.warning(
                "Failed to update housekeeper profile for room_id=%s hotel_id=%s",
                room_id,
                current_user.hotel_id,
                exc_info=True,
            )

    updated_rows = update_result.data or []
    return {"data": updated_rows[0] if updated_rows else {}}


# ---------------------------------------------------------------------------
# GET /rooms/{room_id}/history
# ---------------------------------------------------------------------------

@router.get("/{room_id}/history")
async def get_room_history(
    room_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    result = (
        supabase.table("room_status_history")
        .select("*")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    return {"data": result.data or []}


# ---------------------------------------------------------------------------
# POST /rooms/{room_id}/notes
# ---------------------------------------------------------------------------

@router.post("/{room_id}/notes")
async def add_room_note(
    room_id: str,
    request: AddRoomNoteRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Add a note to a room without triggering a status change."""
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Note text cannot be empty")

    # Verify room belongs to tenant and get current status
    current_row = (
        supabase.table("room_status")
        .select("status")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not current_row or not current_row.data:
        raise HTTPException(status_code=404, detail="Room not found")

    current_status = current_row.data.get("status", "DIRTY")

    # Write directly to history — from_status == to_status marks this as a note-only entry
    supabase.table("room_status_history").insert({
        "room_id": room_id,
        "tenant_id": current_user.hotel_id,
        "from_status": current_status,
        "to_status": current_status,
        "notes": request.text.strip(),
        "changed_by": current_user.user_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    return {"data": {"ok": True}}


# ---------------------------------------------------------------------------
# POST /rooms/import
# ---------------------------------------------------------------------------

@router.post("/import")
async def import_rooms(
    request: ImportRoomsRequest,
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
    """
    Import rooms from CSV or manual entry.

    Each entry in request.rooms may contain:
        room_number (required), floor (required), room_type_code (required),
        room_type_name (optional), building (optional)
    """
    rooms_input = request.rooms or []
    imported_count = 0
    skipped_count = 0
    errors: list[dict] = []

    for room_data in rooms_input:
        room_number = room_data.get("room_number")
        floor = room_data.get("floor")
        room_type_code = room_data.get("room_type_code")
        room_type_name = room_data.get("room_type_name")
        building = room_data.get("building")

        # --- Basic validation ---
        if not room_number:
            errors.append({"room_number": room_number, "reason": "room_number is required"})
            continue
        if floor is None:
            errors.append({"room_number": room_number, "reason": "floor is required"})
            continue
        if not room_type_code:
            errors.append({"room_number": room_number, "reason": "room_type_code is required"})
            continue

        # --- Resolve or create room_type ---
        rt_result = (
            supabase.table("room_types")
            .select("id")
            .eq("tenant_id", current_user.hotel_id)
            .eq("code", room_type_code)
            .limit(1)
            .execute()
        )

        if rt_result.data:
            room_type_id = rt_result.data[0]["id"]
        elif room_type_name:
            # Create the room type on the fly
            new_rt = supabase.table("room_types").insert({
                "tenant_id": current_user.hotel_id,
                "code": room_type_code,
                "name": room_type_name,
                "base_clean_minutes": 30,
            }).execute()
            if not new_rt.data:
                errors.append({
                    "room_number": room_number,
                    "reason": f"Failed to create room_type with code '{room_type_code}'",
                })
                continue
            room_type_id = new_rt.data[0]["id"]
        else:
            errors.append({
                "room_number": room_number,
                "reason": (
                    f"room_type_code '{room_type_code}' not found and "
                    "room_type_name not provided to create it"
                ),
            })
            continue

        # --- Duplicate check (tenant_id + room_number) ---
        existing = (
            supabase.table("rooms")
            .select("id")
            .eq("tenant_id", current_user.hotel_id)
            .eq("room_number", str(room_number))
            .limit(1)
            .execute()
        )
        if existing.data:
            skipped_count += 1
            continue

        # --- Insert room ---
        room_insert_payload: dict = {
            "tenant_id": current_user.hotel_id,
            "room_number": str(room_number),
            "floor": int(floor),
            "room_type_id": room_type_id,
        }
        if building:
            room_insert_payload["building"] = building

        new_room = supabase.table("rooms").insert(room_insert_payload).execute()

        if not new_room.data:
            errors.append({
                "room_number": room_number,
                "reason": "Database insert for room failed",
            })
            continue

        new_room_id = new_room.data[0]["id"]

        # --- Insert initial room_status ---
        supabase.table("room_status").insert({
            "room_id": new_room_id,
            "tenant_id": current_user.hotel_id,
            "status": "DIRTY",
        }).execute()

        imported_count += 1

    return {
        "data": {
            "imported_count": imported_count,
            "skipped_count": skipped_count,
            "errors": errors,
        }
    }

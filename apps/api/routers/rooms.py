import logging
import asyncio
import httpx
from fastapi import APIRouter, Depends, Query, HTTPException
from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import ManualCheckoutRequest, UpdateCheckoutTimeRequest, UpdateRoomStatusRequest, UndoRoomStatusRequest, ImportRoomsRequest
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
    ("PICKUP",    "IN_PROGRESS"): None,
    ("PICKUP",    "CLEAN"):       None,
    ("OCCUPIED",  "IN_PROGRESS"): None,
    ("INSPECTED", "DIRTY"):       {"gm", "housekeeping_supervisor"},
}

# Any status → OOO and OOO → DIRTY are supervisor/GM only
OOO_SOURCES = {s for s in ("DIRTY", "IN_PROGRESS", "CLEAN", "INSPECTED", "PICKUP")}
for _s in OOO_SOURCES:
    ALLOWED_TRANSITIONS[(_s, "OOO")] = {"gm", "housekeeping_supervisor"}
ALLOWED_TRANSITIONS[("OOO", "DIRTY")] = {"gm", "housekeeping_supervisor"}

UNDO_ALL_ROLES = {"gm", "housekeeping_supervisor", "front_desk"}
CHECKOUT_PRESERVE_STATUS = {"IN_PROGRESS", "CLEAN", "INSPECTED", "OOO"}


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


def _find_latest_matching_status_change(history_rows: list[dict], current_status: str | None) -> dict | None:
    for row in history_rows:
        from_status = row.get("from_status")
        to_status = row.get("to_status")
        notes = row.get("notes") or ""
        if not from_status or not to_status or from_status == to_status:
            continue
        if isinstance(notes, str) and notes.startswith("Undo "):
            continue
        if to_status == current_status:
            return row
    return None


def _validate_undo_permission(history_row: dict, current_user: CurrentUser, room_status_data: dict) -> None:
    if current_user.role in UNDO_ALL_ROLES:
        return
    if history_row.get("changed_by") == current_user.user_id:
        return
    if current_user.role == "housekeeper" and room_status_data.get("assigned_to") == current_user.user_id:
        return
    raise HTTPException(
        status_code=403,
        detail="Housekeepers can only undo their own latest room status change",
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


async def _send_checkout_push(housekeeper_id: str, room_number: str, room_id: str) -> None:
    """Fire-and-forget push notification when front desk marks an assigned departure checked out."""
    try:
        profile = (
            supabase.table("user_profiles")
            .select("expo_push_token")
            .eq("id", housekeeper_id)
            .maybe_single()
            .execute()
        )
        token = (profile.data or {}).get("expo_push_token")
        if not token:
            logger.debug("No push token for housekeeper=%s, skipping checkout push", housekeeper_id)
            return
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post("https://exp.host/--/api/v2/push/send", json={
                "to": token,
                "title": "Room Checked Out",
                "body": f"Room {room_number} checked out. Departure clean is ready.",
                "data": {
                    "type": "room_checked_out",
                    "room_id": room_id,
                    "room_number": room_number,
                    "url": f"/(app)/my-rooms/{room_id}",
                },
            })
    except Exception:
        pass


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

    # 2. Validate transition — GMs can force any status from settings
    if not (request.force and current_user.role == "gm"):
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
# POST /rooms/{room_id}/checkout
# ---------------------------------------------------------------------------

@router.post("/{room_id}/checkout")
async def manual_checkout_room(
    room_id: str,
    request: ManualCheckoutRequest | None = None,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor", "front_desk")),
):
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

    room_result = (
        supabase.table("rooms")
        .select("room_number")
        .eq("id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not room_result or not room_result.data:
        raise HTTPException(status_code=404, detail="Room not found")

    from_status: str | None = current_row.data.get("status")
    prev_clean_type: str | None = current_row.data.get("clean_type")
    assigned_to = current_row.data.get("assigned_to")
    was_already_checked_out = bool(current_row.data.get("actual_checkout_at"))
    prior_fo_status = current_row.data.get("fo_status")
    to_status = from_status if from_status in CHECKOUT_PRESERVE_STATUS else "DIRTY"
    now_iso = datetime.now(timezone.utc).isoformat()
    actual_checkout_at = (request.actual_checkout_at if request else None) or datetime.now(timezone.utc)
    notes = (request.notes if request else None) or "Guest checked out"

    update_payload: dict = {
        "status": to_status,
        "fo_status": "VAC",
        "actual_checkout_at": actual_checkout_at.isoformat(),
        "clean_type": "DEP",
        "guest_name": None,
        "vip_flag": False,
        "dnd_flag": False,
        "updated_at": now_iso,
        "notes": notes,
    }
    if request and request.checkout_time is not None:
        update_payload["checkout_time"] = request.checkout_time.isoformat()

    update_result = (
        supabase.table("room_status")
        .update(update_payload)
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )

    # Encode prev_clean_type in notes so undo can restore it
    history_notes = f"{notes}|prev_clean_type={prev_clean_type}" if prev_clean_type else notes
    supabase.table("room_status_history").insert({
        "room_id": room_id,
        "tenant_id": current_user.hotel_id,
        "from_status": from_status,
        "to_status": to_status,
        "changed_by": current_user.user_id,
        "change_source": "app",
        "notes": history_notes,
    }).execute()

    room_number = room_result.data.get("room_number") or ""
    should_notify = (
        bool(assigned_to)
        and to_status == "DIRTY"
        and not was_already_checked_out
        and (from_status != "DIRTY" or prior_fo_status == "OCC")
    )
    if should_notify:
        supabase.table("notifications").insert({
            "tenant_id": current_user.hotel_id,
            "user_id": assigned_to,
            "type": "room_checked_out",
            "title": f"Room {room_number} checked out",
            "body": "Departure clean is ready.",
            "data": {"room_id": room_id, "room_number": room_number},
            "is_read": False,
            "push_sent": False,
        }).execute()
        asyncio.create_task(_send_checkout_push(assigned_to, room_number, room_id))

    updated_rows = update_result.data or []
    return {"data": updated_rows[0] if updated_rows else {}}


# ---------------------------------------------------------------------------
# DELETE /rooms/{room_id}/checkout  (undo checkout)
# ---------------------------------------------------------------------------

@router.delete("/{room_id}/checkout")
async def undo_checkout(
    room_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor", "front_desk")),
):
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
    if not current_row.data.get("actual_checkout_at"):
        raise HTTPException(status_code=400, detail="Room has not been checked out")

    # Find the checkout history row to restore pre-checkout status and clean_type
    history_result = (
        supabase.table("room_status_history")
        .select("from_status, notes")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .like("notes", "Guest checked out%")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    history_rows = (history_result.data or []) if history_result else []
    restore_status = history_rows[0].get("from_status") if history_rows else None

    # Parse the pre-checkout clean_type encoded in history notes
    prev_clean_type: str | None = None
    if history_rows:
        history_notes = history_rows[0].get("notes") or ""
        if "|prev_clean_type=" in history_notes:
            prev_clean_type = history_notes.split("|prev_clean_type=", 1)[1].strip() or None

    now_iso = datetime.now(timezone.utc).isoformat()
    from_status = current_row.data.get("status")

    update_payload: dict = {
        "actual_checkout_at": None,
        "checkout_time": None,
        "fo_status": "OCC",
        "clean_type": prev_clean_type,
        "updated_at": now_iso,
        "notes": "Checkout undone",
    }
    if restore_status:
        update_payload["status"] = restore_status

    supabase.table("room_status")\
        .update(update_payload)\
        .eq("room_id", room_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    supabase.table("room_status_history").insert({
        "room_id": room_id,
        "tenant_id": current_user.hotel_id,
        "from_status": from_status,
        "to_status": restore_status or from_status,
        "changed_by": current_user.user_id,
        "change_source": "app",
        "notes": "Checkout undone",
    }).execute()

    return {"data": {"room_id": room_id, "undone": True}}


# ---------------------------------------------------------------------------
# POST /rooms/{room_id}/stayover  (guest extended — flip DEP → OCCUPIED)
# ---------------------------------------------------------------------------

@router.post("/{room_id}/stayover")
async def mark_stayover(
    room_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor", "front_desk")),
):
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

    room_result = (
        supabase.table("rooms")
        .select("room_number")
        .eq("id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not room_result or not room_result.data:
        raise HTTPException(status_code=404, detail="Room not found")

    from_status: str | None = current_row.data.get("status")
    now_iso = datetime.now(timezone.utc).isoformat()
    today = datetime.now(timezone.utc).date().isoformat()

    # Remove today's housekeeping assignment (was a DEP clean)
    assignment_row = (
        supabase.table("room_assignments")
        .select("id, assigned_to")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .eq("assignment_date", today)
        .maybe_single()
        .execute()
    )
    assigned_to: str | None = None
    if assignment_row and assignment_row.data:
        assigned_to = assignment_row.data.get("assigned_to")
        supabase.table("room_assignments")\
            .delete()\
            .eq("id", assignment_row.data["id"])\
            .eq("tenant_id", current_user.hotel_id)\
            .execute()

    update_result = (
        supabase.table("room_status")
        .update({
            "status": "OCCUPIED",
            "clean_type": None,
            "updated_at": now_iso,
        })
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )

    supabase.table("room_status_history").insert({
        "room_id": room_id,
        "tenant_id": current_user.hotel_id,
        "from_status": from_status,
        "to_status": "OCCUPIED",
        "changed_by": current_user.user_id,
        "change_source": "app",
        "notes": "stayover_override",
    }).execute()

    if assigned_to:
        room_number = room_result.data.get("room_number") or ""
        supabase.table("notifications").insert({
            "tenant_id": current_user.hotel_id,
            "user_id": assigned_to,
            "type": "room_stayover",
            "title": f"Room {room_number} — guest extended",
            "body": "Departure clean cancelled. Guest is staying.",
            "data": {"room_id": room_id, "room_number": room_number},
            "is_read": False,
            "push_sent": False,
        }).execute()

    updated_rows = update_result.data or []
    return {"data": updated_rows[0] if updated_rows else {}}


# ---------------------------------------------------------------------------
# PATCH /rooms/{room_id}/checkout-time
# ---------------------------------------------------------------------------

@router.patch("/{room_id}/checkout-time")
async def update_checkout_time(
    room_id: str,
    request: UpdateCheckoutTimeRequest,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor", "chief_engineer", "front_desk")),
):
    current_row = (
        supabase.table("room_status")
        .select("room_id")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not current_row or not current_row.data:
        raise HTTPException(status_code=404, detail="Room not found")

    update_payload: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if request.checkout_time is not None:
        update_payload["checkout_time"] = request.checkout_time.isoformat()

    supabase.table("room_status")\
        .update(update_payload)\
        .eq("room_id", room_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    return {"data": {"ok": True}}


# ---------------------------------------------------------------------------
# POST /rooms/{room_id}/status/undo
# ---------------------------------------------------------------------------

@router.post("/{room_id}/status/undo")
async def undo_room_status(
    room_id: str,
    request: UndoRoomStatusRequest | None = None,
    current_user: CurrentUser = Depends(get_current_user),
):
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

    current_status: str | None = current_row.data.get("status")
    history_result = (
        supabase.table("room_status_history")
        .select("*")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .order("created_at", desc=True)
        .limit(10)
        .execute()
    )
    history_row = _find_latest_matching_status_change(history_result.data or [], current_status)
    if not history_row:
        raise HTTPException(status_code=409, detail="No matching status change to undo")

    _validate_undo_permission(history_row, current_user, current_row.data)

    undo_to_status = history_row["from_status"]
    now_iso = datetime.now(timezone.utc).isoformat()
    notes = (request.notes if request else None) or f"Undo {current_status} back to {undo_to_status}"
    update_result = (
        supabase.table("room_status")
        .update({
            "status": undo_to_status,
            "notes": notes,
            "updated_at": now_iso,
        })
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )

    supabase.table("room_status_history").insert({
        "room_id": room_id,
        "tenant_id": current_user.hotel_id,
        "from_status": current_status,
        "to_status": undo_to_status,
        "changed_by": current_user.user_id,
        "change_source": "app",
        "notes": notes,
    }).execute()

    updated_rows = update_result.data or []
    updated_row = updated_rows[0] if updated_rows else {}
    return {
        "data": {
            **updated_row,
            "undo": {
                "history_id": history_row.get("id"),
                "from_status": current_status,
                "to_status": undo_to_status,
            },
        },
    }


# ---------------------------------------------------------------------------
# GET /rooms/{room_id}/history
# ---------------------------------------------------------------------------

@router.get("/{room_id}/history")
async def get_room_history(
    room_id: str,
    limit: int = Query(50, ge=1, le=50),
    current_user: CurrentUser = Depends(get_current_user),
):
    result = (
        supabase.table("room_status_history")
        .select("*")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .order("created_at", desc=True)
        .limit(limit)
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
# DELETE /rooms/{room_id}
# ---------------------------------------------------------------------------

@router.delete("/{room_id}")
async def delete_room(
    room_id: str,
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
    existing = (
        supabase.table("rooms")
        .select("id")
        .eq("id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not existing or not existing.data:
        raise HTTPException(status_code=404, detail="Room not found")

    supabase.table("rooms").delete().eq("id", room_id).eq("tenant_id", current_user.hotel_id).execute()
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
    _ROOM_STATUS_RESET = {
        "status": "DIRTY",
        "assigned_to": None,
        "notes": None,
        "dnd_flag": False,
        "do_not_service": False,
        "priority": 5,
        "risk_level": None,
        "predicted_ready_at": None,
        "room_type_category": None,
        "guest_name": None,
        "vip_flag": False,
        "checkin_time": None,
        "checkout_time": None,
        "actual_checkout_at": None,
        "clean_type": None,
        "last_cleaned_at": None,
        "last_inspected_at": None,
        "last_inspected_by": None,
    }

    rooms_input = request.rooms or []
    imported_count = 0
    reset_count = 0
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
            # Reset every status field; work orders (separate table) are untouched
            supabase.table("room_status").update(_ROOM_STATUS_RESET).eq(
                "room_id", existing.data[0]["id"]
            ).execute()
            reset_count += 1
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
            "reset_count": reset_count,
            "errors": errors,
        }
    }

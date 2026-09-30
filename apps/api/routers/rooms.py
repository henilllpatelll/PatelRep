import logging
import asyncio
import httpx
from fastapi import APIRouter, Depends, Query, HTTPException
from typing import Optional
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import (
    ManualCheckoutRequest,
    UpdateCheckoutTimeRequest,
    UpdateRoomStatusRequest,
    UndoRoomStatusRequest,
    ImportRoomsRequest,
    SetRoomPriorityRequest,
    RecordServiceAttemptRequest,
    ServiceDeclinedRequest,
    ReportOccupancyDiscrepancyRequest,
    ResolveOccupancyDiscrepancyRequest,
)
from core.database import supabase
from core.roles import HOUSEKEEPING_EXCEPTION_REPORT_ROLES, RUSH_MANAGER_ROLES, DISCREPANCY_RESOLVER_ROLES
from services.room_status_transitions import (
    close_active_sessions_for_room,
    update_housekeeper_profile,
    validate_transition as _validate_transition,
)

logger = logging.getLogger(__name__)


class AddRoomNoteRequest(BaseModel):
    text: str

class ReCleanRequest(BaseModel):
    note: Optional[str] = None
    reassign_to: Optional[str] = None

router = APIRouter(prefix="/rooms", tags=["rooms"])

# Status transition rules live in services/room_status_transitions.py
# (shared with the clean-sessions router).

UNDO_ALL_ROLES = {"gm", "housekeeping_supervisor", "front_desk"}
CHECKOUT_PRESERVE_STATUS = {"IN_PROGRESS", "CLEAN", "INSPECTED", "OOO"}


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


def _record_audit_event(
    *, current_user: CurrentUser, resource_type: str, resource_id: str,
    action: str, old_state: dict | None = None, new_state: dict | None = None,
    reason_code: str | None = None, reason_note: str | None = None,
) -> None:
    """Append-only operational audit write — mirrors routers/programs.py's
    _record_audit_event column set (no parallel audit mechanism)."""
    supabase.table("operational_audit_events").insert({
        "tenant_id": current_user.hotel_id,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "action": action,
        "actor_id": current_user.user_id,
        "actor_role": current_user.role,
        "old_state": old_state or {},
        "new_state": new_state or {},
        "reason_code": reason_code,
        "reason_note": reason_note,
        "source": "api",
    }).execute()


def _log_room_activity(room_id: str, hotel_id: str, current_status: str, note: str, actor_id: str) -> None:
    """Note-only room_status_history row (from_status == to_status) — the same
    pattern add_room_note() uses, so it shows up in the existing Room Activity
    feed without a parallel history mechanism."""
    supabase.table("room_status_history").insert({
        "room_id": room_id,
        "tenant_id": hotel_id,
        "from_status": current_status,
        "to_status": current_status,
        "notes": note,
        "changed_by": actor_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }).execute()


def _notify_role(hotel_id: str, target_role: str, notif_type: str, title: str, body: str, data: dict) -> None:
    """Insert an in-app notification for every active user of target_role in the hotel.
    Mirrors routers/internal.py's _notify_role (no parallel notification mechanism)."""
    users = supabase.table("user_roles")\
        .select("user_id")\
        .eq("tenant_id", hotel_id)\
        .eq("role", target_role)\
        .eq("is_active", True)\
        .execute()
    for row in (users.data or []):
        notification = supabase.table("notifications").insert({
            "tenant_id": hotel_id,
            "user_id": row["user_id"],
            "type": notif_type,
            "title": title,
            "body": body,
            "data": data,
        }).execute()
        notification_row = (notification.data or [None])[0]
        if notification_row:
            supabase.table("notification_deliveries").insert({
                "tenant_id": hotel_id,
                "notification_id": notification_row["id"],
                "user_id": row["user_id"],
                "channel": "in_app",
                "status": "delivered",
            }).execute()


def _approx_elapsed_minutes(room_status_data: dict) -> float | None:
    """Approximate clean time from room_status.updated_at (IN_PROGRESS start).

    Legacy fallback for status changes made outside a clean session.
    """
    started_approx = room_status_data.get("updated_at")
    if not started_approx:
        return None
    try:
        start_dt = datetime.fromisoformat(started_approx.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc).replace(tzinfo=start_dt.tzinfo) - start_dt).total_seconds() / 60
    except (ValueError, TypeError):
        return None


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

    # Preserve mobile and legacy web callers while centralizing OOO episodes.
    # The RPC changes the episode, current room state, and status history in one
    # database transaction, so an old status-only client cannot create a half
    # completed OOO transition.
    if to_status == "OOO" and from_status != "OOO":
        result = supabase.rpc("create_room_unavailability", {
            "p_room_id": room_id,
            "p_tenant_id": current_user.hotel_id,
            "p_reason_code": "LEGACY_UNKNOWN",
            "p_reason_label": "Unknown / legacy",
            "p_details": request.notes,
            "p_expected_return_at": None,
            "p_owner_id": None,
            "p_work_order_id": None,
            "p_created_by": current_user.user_id,
            "p_source": "MOBILE",
        }).execute()
        payload = result.data or {}
        return {"data": payload.get("room_status", payload)}

    if from_status == "OOO" and to_status == "DIRTY":
        active = supabase.table("room_unavailability_periods").select("id").eq("tenant_id", current_user.hotel_id).eq("room_id", room_id).eq("status", "ACTIVE").maybe_single().execute()
        active_period = (active.data if active else None) or None
        if active_period:
            result = supabase.rpc("release_room_unavailability", {
                "p_period_id": active_period["id"],
                "p_tenant_id": current_user.hotel_id,
                "p_released_by": current_user.user_id,
                "p_release_notes": request.notes,
                "p_source": "MOBILE",
            }).execute()
            payload = result.data or {}
            return {"data": payload.get("room_status", payload)}

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
        if current_row.data.get("clean_type") == "DEP":
            update_payload["stay_reset_at"] = now_iso

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

    # 6. Update housekeeper speed profile (IN_PROGRESS → CLEAN) and defensively
    #    close any active clean session so a stale offline queue flush through
    #    this legacy endpoint never orphans a session.
    if from_status == "IN_PROGRESS" and to_status == "CLEAN":
        try:
            update_housekeeper_profile(
                hotel_id=current_user.hotel_id,
                room_id=room_id,
                user_id=current_row.data.get("assigned_to"),
                elapsed_minutes=_approx_elapsed_minutes(current_row.data),
            )
        except Exception:
            logger.warning(
                "Failed to update housekeeper profile for room_id=%s hotel_id=%s",
                room_id,
                current_user.hotel_id,
                exc_info=True,
            )
        close_active_sessions_for_room(current_user.hotel_id, room_id)

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
        "stripped": False,
        "stripped_by": None,
        "stripped_at": None,
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

    # Clear stayover note so it doesn't linger on the card after checkout
    supabase.table("room_status_history").delete()\
        .eq("room_id", room_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("notes", "stayover")\
        .execute()

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
        "notes": "stayover",
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
# POST /rooms/{room_id}/checkin
# ---------------------------------------------------------------------------

@router.post("/{room_id}/checkin")
async def check_in_room(
    room_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor", "front_desk")),
):
    """Mark a room as OCCUPIED when a guest checks in (from INSPECTED state)."""
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

    from_status: str | None = current_row.data.get("status")
    if from_status != "INSPECTED":
        raise HTTPException(status_code=400, detail="Room must be INSPECTED before check-in")

    now_iso = datetime.now(timezone.utc).isoformat()
    update_result = (
        supabase.table("room_status")
        .update({
            "status": "OCCUPIED",
            "fo_status": "OCC",
            "checkin_time": now_iso,
            "actual_checkout_at": None,
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
        "notes": "Guest checked in",
    }).execute()

    updated_rows = update_result.data or []
    return {"data": updated_rows[0] if updated_rows else {}}


# ---------------------------------------------------------------------------
# POST /rooms/{room_id}/welfare-check
# ---------------------------------------------------------------------------

@router.post("/{room_id}/welfare-check")
async def request_welfare_check(
    room_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor", "front_desk")),
):
    """Escalate a DND room for a welfare check — creates a supervisor task and sends notifications."""
    current_row = (
        supabase.table("room_status")
        .select("room_id, status, dnd_flag")
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

    room_number = room_result.data.get("room_number") or ""
    now = datetime.now(timezone.utc)

    # Find a supervisor to assign to
    supervisor_result = (
        supabase.table("user_roles")
        .select("user_id")
        .eq("tenant_id", current_user.hotel_id)
        .eq("role", "housekeeping_supervisor")
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    supervisor_id = (supervisor_result.data[0]["user_id"] if supervisor_result.data else None)

    task_payload = {
        "tenant_id": current_user.hotel_id,
        "title": f"Welfare check — Room {room_number}",
        "description": f"Room {room_number} has had DND active for an extended period. Please perform a welfare check.",
        "task_type": "housekeeping",
        "priority": "urgent",
        "room_id": room_id,
        "created_by": current_user.user_id,
        "due_at": (now + timedelta(minutes=30)).isoformat(),
    }
    if supervisor_id:
        task_payload["assigned_to"] = supervisor_id

    task_result = supabase.table("tasks").insert(task_payload).execute()
    task_id = (task_result.data[0]["id"] if task_result.data else None)

    notif_data = {"room_id": room_id, "room_number": room_number, "task_id": task_id}
    for target_role in ("housekeeping_supervisor", "front_desk"):
        users = (
            supabase.table("user_roles")
            .select("user_id")
            .eq("tenant_id", current_user.hotel_id)
            .eq("role", target_role)
            .eq("is_active", True)
            .execute()
        )
        for row in (users.data or []):
            supabase.table("notifications").insert({
                "tenant_id": current_user.hotel_id,
                "user_id": row["user_id"],
                "type": "welfare_check_requested",
                "title": f"Welfare check — Room {room_number}",
                "body": "DND flag has been active. Please check on the guest.",
                "data": notif_data,
                "is_read": False,
                "push_sent": False,
            }).execute()

    return {"data": {"room_id": room_id, "task_id": task_id, "notified": True}}


# ---------------------------------------------------------------------------
# POST /rooms/{room_id}/re-clean


@router.post("/{room_id}/re-clean")
async def dispatch_re_clean(
    room_id: str,
    request: ReCleanRequest,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Set a CLEAN/INSPECTED room back to DIRTY after a failed inspection and notify the housekeeper."""
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

    from_status: str | None = current_row.data.get("status")
    if from_status not in ("CLEAN", "INSPECTED"):
        # A failed inspection's AFTER INSERT trigger (migration 017,
        # handle_inspection_complete) synchronously flips room_status to
        # DIRTY the moment the inspection row is written -- before the
        # frontend's InspectionModal "Dispatch Re-Clean" step (the only
        # caller of this endpoint) ever gets a chance to call it. Without
        # this bypass, the endpoint 400s on every single real failed
        # inspection, unconditionally. Only allow it when the room's most
        # recent inspection genuinely failed, and recently, so unrelated
        # DIRTY rooms (departure, mid-cleaning) still get rejected as before.
        allow_dirty_bypass = False
        if from_status == "DIRTY":
            latest_inspection = (
                supabase.table("inspections")
                .select("overall_result, created_at")
                .eq("room_id", room_id)
                .eq("tenant_id", current_user.hotel_id)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            latest = (latest_inspection.data or [None])[0]
            if latest and latest.get("overall_result") == "failed":
                created_at = latest.get("created_at")
                if created_at:
                    inspected_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                    if datetime.now(timezone.utc) - inspected_at < timedelta(hours=24):
                        allow_dirty_bypass = True
        if not allow_dirty_bypass:
            raise HTTPException(status_code=400, detail="Room must be CLEAN or INSPECTED to dispatch a re-clean")

    room_result = (
        supabase.table("rooms")
        .select("room_number")
        .eq("id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    room_number = (room_result.data or {}).get("room_number", "") if room_result else ""

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    # Determine who to notify — reassign_to overrides existing assigned_to
    assigned_to: str | None = request.reassign_to or current_row.data.get("assigned_to")

    update_payload: dict = {
        "status": "DIRTY",
        "updated_at": now_iso,
        "notes": request.note or "Failed inspection — re-clean required",
    }
    if request.reassign_to:
        update_payload["assigned_to"] = request.reassign_to

    supabase.table("room_status")\
        .update(update_payload)\
        .eq("room_id", room_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    supabase.table("room_status_history").insert({
        "room_id": room_id,
        "tenant_id": current_user.hotel_id,
        "from_status": from_status,
        "to_status": "DIRTY",
        "changed_by": current_user.user_id,
        "change_source": "app",
        "notes": f"Failed inspection — re-clean dispatched{': ' + request.note if request.note else ''}",
    }).execute()

    # Create an urgent housekeeping task for the housekeeper
    task_payload: dict = {
        "tenant_id": current_user.hotel_id,
        "title": f"Re-clean required — Room {room_number}",
        "description": request.note or "Room failed inspection and requires re-cleaning.",
        "task_type": "housekeeping",
        "priority": "urgent",
        "room_id": room_id,
        "created_by": current_user.user_id,
        "due_at": (now + timedelta(minutes=60)).isoformat(),
    }
    if assigned_to:
        task_payload["assigned_to"] = assigned_to

    task_result = supabase.table("tasks").insert(task_payload).execute()
    task_id = (task_result.data[0]["id"] if task_result.data else None)

    if assigned_to:
        supabase.table("notifications").insert({
            "tenant_id": current_user.hotel_id,
            "user_id": assigned_to,
            "type": "re_clean_dispatched",
            "title": f"Re-clean — Room {room_number}",
            "body": request.note or "Room failed inspection. Please re-clean.",
            "data": {"room_id": room_id, "room_number": room_number, "task_id": task_id},
            "is_read": False,
            "push_sent": False,
        }).execute()

    return {"data": {"room_id": room_id, "task_id": task_id, "assigned_to": assigned_to}}


# ---------------------------------------------------------------------------
# POST /rooms/{room_id}/strip
# ---------------------------------------------------------------------------

@router.post("/{room_id}/strip")
async def strip_room(
    room_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Mark a DIRTY departure room as stripped (linens removed) by a supervisor."""
    current_row = (
        supabase.table("room_status")
        .select("room_id, status")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not current_row or not current_row.data:
        raise HTTPException(status_code=404, detail="Room not found")
    if current_row.data.get("status") != "DIRTY":
        raise HTTPException(status_code=400, detail="Room must be DIRTY to be stripped")

    now_iso = datetime.now(timezone.utc).isoformat()
    supabase.table("room_status").update({
        "stripped": True,
        "stripped_by": current_user.user_id,
        "stripped_at": now_iso,
    }).eq("room_id", room_id).eq("tenant_id", current_user.hotel_id).execute()

    supabase.table("room_status_history").insert({
        "room_id": room_id,
        "tenant_id": current_user.hotel_id,
        "from_status": "DIRTY",
        "to_status": "DIRTY",
        "changed_by": current_user.user_id,
        "change_source": "app",
        "notes": "Stripped",
    }).execute()

    return {"data": {"room_id": room_id, "stripped": True}}


# ---------------------------------------------------------------------------
# PATCH /rooms/{room_id}/dnd
# ---------------------------------------------------------------------------

class DndToggleRequest(BaseModel):
    dnd: bool

@router.patch("/{room_id}/dnd")
async def update_room_dnd(
    room_id: str,
    body: DndToggleRequest,
    current_user: CurrentUser = Depends(require_role("housekeeper", "housekeeping_supervisor", "gm")),
):
    current_row = (
        supabase.table("room_status")
        .select("room_id, dnd_flag")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not current_row or not current_row.data:
        raise HTTPException(status_code=404, detail="Room not found")

    now_iso = datetime.now(timezone.utc).isoformat()
    update_payload: dict = {"dnd_flag": body.dnd, "updated_at": now_iso}
    was_dnd = current_row.data.get("dnd_flag") is True
    if body.dnd and not was_dnd:
        # Anchors the welfare-escalation clock on the real transition instead
        # of the prior updated_at proxy, which reset on any unrelated write.
        update_payload["dnd_started_at"] = now_iso
    elif not body.dnd:
        update_payload["dnd_started_at"] = None
        update_payload["dnd_retry_at"] = None

    supabase.table("room_status").update(update_payload)\
        .eq("room_id", room_id).eq("tenant_id", current_user.hotel_id).execute()

    return {"data": {"room_id": room_id, "dnd_flag": body.dnd}}


# ---------------------------------------------------------------------------
# PATCH /rooms/{room_id}/decline-service
# ---------------------------------------------------------------------------

class DeclineServiceRequest(BaseModel):
    decline: bool

@router.patch("/{room_id}/decline-service")
async def update_room_decline_service(
    room_id: str,
    body: DeclineServiceRequest,
    current_user: CurrentUser = Depends(require_role("housekeeper", "housekeeping_supervisor", "gm")),
):
    current_row = (
        supabase.table("room_status")
        .select("room_id, status")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not current_row or not current_row.data:
        raise HTTPException(status_code=404, detail="Room not found")
    if current_row.data.get("status") != "PICKUP":
        raise HTTPException(status_code=400, detail="Decline service only applies to PICKUP rooms")

    supabase.table("room_status").update({
        "do_not_service": body.decline,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("room_id", room_id).eq("tenant_id", current_user.hotel_id).execute()

    return {"data": {"room_id": room_id, "do_not_service": body.decline}}


# ---------------------------------------------------------------------------
# Phase 8: Rush/priority, DND attempts, service declined, occupancy discrepancy
# ---------------------------------------------------------------------------

PRIORITY_REASON_LABELS = {
    "early_arrival": "Early arrival",
    "vip": "VIP",
    "guest_waiting": "Guest waiting",
    "front_desk_request": "Front Desk request",
    "operational_priority": "Operational priority",
    "other": "Other",
}
ATTEMPT_RESULT_LABELS = {
    "dnd_no_response": "No response · DND",
    "return_later": "Guest asked to return later",
    "guest_answered": "Guest answered",
    "dnd_cleared": "DND cleared",
    "other": "Other",
}
DECLINE_REASON_LABELS = {
    "guest_declined_housekeeping": "Guest declined housekeeping",
    "guest_no_service_today": "Guest requested no service today",
    "privacy_request": "Privacy request",
    "other": "Other",
}
RUSH_PRIORITY_VALUE = 1
NORMAL_PRIORITY_VALUE = 5


@router.patch("/{room_id}/priority")
async def set_room_priority(
    room_id: str,
    body: SetRoomPriorityRequest,
    current_user: CurrentUser = Depends(require_role(*RUSH_MANAGER_ROLES)),
):
    """Manual Rush/priority override — distinct from AI readiness-risk prediction.
    Reuses room_status.priority (1=highest, migration 004) as the Rush trigger,
    which deriveRoomAttentionItems()/sortHousekeepingRooms() in the web app
    already key off of; this endpoint just gives it a reason-bearing write path."""
    current_row = (
        supabase.table("room_status")
        .select("room_id, status, priority, priority_reason")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not current_row or not current_row.data:
        raise HTTPException(status_code=404, detail="Room not found")

    now_iso = datetime.now(timezone.utc).isoformat()
    old_state = {"priority": current_row.data.get("priority"), "priority_reason": current_row.data.get("priority_reason")}

    if body.priority_state == "rush":
        update_payload: dict = {
            "priority": RUSH_PRIORITY_VALUE,
            "priority_reason": body.reason,
            "priority_needed_by": body.needed_by.isoformat() if body.needed_by else None,
            "priority_note": body.note,
            "priority_set_by": current_user.user_id,
            "priority_set_at": now_iso,
            "updated_at": now_iso,
        }
        action, note = "rush_set", f"Rush set: {PRIORITY_REASON_LABELS.get(body.reason, body.reason)}"
    else:
        update_payload = {
            "priority": NORMAL_PRIORITY_VALUE,
            "priority_reason": None,
            "priority_needed_by": None,
            "priority_note": None,
            "priority_set_by": None,
            "priority_set_at": None,
            "updated_at": now_iso,
        }
        action, note = "rush_cleared", "Rush cleared"

    supabase.table("room_status").update(update_payload)\
        .eq("room_id", room_id).eq("tenant_id", current_user.hotel_id).execute()

    _record_audit_event(
        current_user=current_user, resource_type="room", resource_id=room_id,
        action=action, old_state=old_state, new_state=update_payload,
        reason_code=body.reason, reason_note=body.note,
    )
    _log_room_activity(room_id, current_user.hotel_id, current_row.data.get("status", "DIRTY"), note, current_user.user_id)

    return {"data": {"room_id": room_id, **update_payload}}


@router.post("/{room_id}/service-attempts")
async def record_service_attempt(
    room_id: str,
    body: RecordServiceAttemptRequest,
    current_user: CurrentUser = Depends(require_role(*HOUSEKEEPING_EXCEPTION_REPORT_ROLES)),
):
    current_row = (
        supabase.table("room_status")
        .select("room_id, status, dnd_flag, dnd_attempt_count")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not current_row or not current_row.data:
        raise HTTPException(status_code=404, detail="Room not found")

    now = datetime.now(timezone.utc)
    attempted_at_iso = (body.attempted_at or now).isoformat()
    return_at_iso = body.return_at.isoformat() if body.return_at else None

    attempt_result = supabase.table("room_service_attempts").insert({
        "tenant_id": current_user.hotel_id,
        "room_id": room_id,
        "result": body.result,
        "attempted_at": attempted_at_iso,
        "return_at": return_at_iso,
        "note": body.note,
        "recorded_by": current_user.user_id,
    }).execute()

    was_dnd = current_row.data.get("dnd_flag") is True
    update_payload: dict = {
        "dnd_attempt_count": (current_row.data.get("dnd_attempt_count") or 0) + 1,
        "dnd_last_attempt_at": attempted_at_iso,
        "updated_at": now.isoformat(),
    }
    if body.result == "dnd_no_response":
        update_payload["dnd_flag"] = True
        if not was_dnd:
            update_payload["dnd_started_at"] = attempted_at_iso
        update_payload["dnd_retry_at"] = None
    elif body.result == "return_later":
        update_payload["dnd_retry_at"] = return_at_iso
    elif body.result in ("guest_answered", "dnd_cleared"):
        update_payload["dnd_flag"] = False
        update_payload["dnd_started_at"] = None
        update_payload["dnd_retry_at"] = None

    supabase.table("room_status").update(update_payload)\
        .eq("room_id", room_id).eq("tenant_id", current_user.hotel_id).execute()

    _record_audit_event(
        current_user=current_user, resource_type="room", resource_id=room_id,
        action="dnd_attempt_recorded",
        new_state={"result": body.result, "return_at": return_at_iso},
        reason_code=body.result, reason_note=body.note,
    )
    _log_room_activity(
        room_id, current_user.hotel_id, current_row.data.get("status", "DIRTY"),
        f"Attempt recorded: {ATTEMPT_RESULT_LABELS.get(body.result, body.result)}", current_user.user_id,
    )

    rows = attempt_result.data or []
    return {"data": rows[0] if rows else None}


@router.get("/{room_id}/service-attempts")
async def list_service_attempts(
    room_id: str,
    limit: int = Query(20, ge=1, le=50),
    current_user: CurrentUser = Depends(get_current_user),
):
    result = (
        supabase.table("room_service_attempts")
        .select("*")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .order("attempted_at", desc=True)
        .limit(limit)
        .execute()
    )
    return {"data": result.data or []}


@router.post("/{room_id}/service-declined")
async def set_service_declined(
    room_id: str,
    body: ServiceDeclinedRequest,
    current_user: CurrentUser = Depends(require_role(*HOUSEKEEPING_EXCEPTION_REPORT_ROLES)),
):
    """Deliberate, reason-bearing Service Declined. Distinct from the bare
    PATCH /{room_id}/decline-service toggle mobile already calls (kept
    unchanged for backward compatibility); this is the richer web workflow."""
    current_row = (
        supabase.table("room_status")
        .select("room_id, status")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not current_row or not current_row.data:
        raise HTTPException(status_code=404, detail="Room not found")

    now_iso = datetime.now(timezone.utc).isoformat()
    supabase.table("room_status").update({
        "do_not_service": True,
        "service_declined_reason": body.reason,
        "service_declined_note": body.note,
        "service_declined_at": now_iso,
        "service_declined_by": current_user.user_id,
        "updated_at": now_iso,
    }).eq("room_id", room_id).eq("tenant_id", current_user.hotel_id).execute()

    _record_audit_event(
        current_user=current_user, resource_type="room", resource_id=room_id,
        action="service_declined", reason_code=body.reason, reason_note=body.note,
    )
    _log_room_activity(
        room_id, current_user.hotel_id, current_row.data.get("status", "DIRTY"),
        f"Service declined: {DECLINE_REASON_LABELS.get(body.reason, body.reason)}", current_user.user_id,
    )

    return {"data": {"room_id": room_id, "do_not_service": True}}


@router.post("/{room_id}/discrepancies")
async def report_occupancy_discrepancy(
    room_id: str,
    body: ReportOccupancyDiscrepancyRequest,
    current_user: CurrentUser = Depends(require_role(*HOUSEKEEPING_EXCEPTION_REPORT_ROLES)),
):
    """Records the housekeeping-observed occupancy state against the
    PMS-authoritative fo_status snapshot and routes to Front Desk for
    verification. Never writes fo_status itself — PMS stays authoritative."""
    current_row = (
        supabase.table("room_status")
        .select("room_id, status, fo_status")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not current_row or not current_row.data:
        raise HTTPException(status_code=404, detail="Room not found")

    room_result = (
        supabase.table("rooms")
        .select("room_number")
        .eq("id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    room_number = (room_result.data or {}).get("room_number", "") if room_result else ""
    pms_status = current_row.data.get("fo_status")

    insert_result = supabase.table("room_occupancy_discrepancies").insert({
        "tenant_id": current_user.hotel_id,
        "room_id": room_id,
        "housekeeping_observed": body.housekeeping_observed,
        "pms_status_at_report": pms_status,
        "note": body.note,
        "reported_by": current_user.user_id,
        "status": "open",
    }).execute()
    rows = insert_result.data or []
    row = rows[0] if rows else None

    _record_audit_event(
        current_user=current_user, resource_type="room", resource_id=room_id,
        action="discrepancy_reported",
        new_state={"housekeeping_observed": body.housekeeping_observed, "pms_status_at_report": pms_status},
        reason_note=body.note,
    )
    _log_room_activity(
        room_id, current_user.hotel_id, current_row.data.get("status", "DIRTY"),
        f"Occupancy discrepancy reported: observed {body.housekeeping_observed}", current_user.user_id,
    )

    notif_data = {"room_id": room_id, "room_number": room_number, "discrepancy_id": row.get("id") if row else None}
    title = f"Occupancy discrepancy — Room {room_number}"
    notif_body = f"Housekeeping observed the room as {body.housekeeping_observed}; PMS shows {pms_status or 'unknown'}."
    for target_role in ("front_desk", "housekeeping_supervisor"):
        _notify_role(current_user.hotel_id, target_role, "occupancy_discrepancy_reported", title, notif_body, notif_data)

    return {"data": row}


@router.get("/{room_id}/discrepancies")
async def list_room_discrepancies(
    room_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    result = (
        supabase.table("room_occupancy_discrepancies")
        .select("*")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .order("reported_at", desc=True)
        .execute()
    )
    return {"data": result.data or []}


@router.post("/discrepancies/{discrepancy_id}/resolve")
async def resolve_occupancy_discrepancy(
    discrepancy_id: str,
    body: ResolveOccupancyDiscrepancyRequest,
    current_user: CurrentUser = Depends(require_role(*DISCREPANCY_RESOLVER_ROLES)),
):
    current_row = (
        supabase.table("room_occupancy_discrepancies")
        .select("*")
        .eq("id", discrepancy_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not current_row or not current_row.data:
        raise HTTPException(status_code=404, detail="Discrepancy not found")
    if current_row.data.get("status") == "resolved":
        return {"data": current_row.data}  # idempotent

    room_id = current_row.data.get("room_id")
    now_iso = datetime.now(timezone.utc).isoformat()
    update_result = supabase.table("room_occupancy_discrepancies").update({
        "status": "resolved",
        "resolution": body.resolution,
        "resolution_note": body.note,
        "resolved_by": current_user.user_id,
        "resolved_at": now_iso,
    }).eq("id", discrepancy_id).eq("tenant_id", current_user.hotel_id).execute()

    _record_audit_event(
        current_user=current_user, resource_type="room", resource_id=room_id,
        action="discrepancy_resolved", new_state={"resolution": body.resolution}, reason_note=body.note,
    )
    status_row = (
        supabase.table("room_status").select("status")
        .eq("room_id", room_id).eq("tenant_id", current_user.hotel_id)
        .maybe_single().execute()
    )
    resolution_label = body.resolution.replace("_", " ")
    _log_room_activity(
        room_id, current_user.hotel_id, (status_row.data or {}).get("status", "DIRTY"),
        f"Discrepancy resolved: {resolution_label}", current_user.user_id,
    )
    _notify_role(
        current_user.hotel_id, "housekeeping_supervisor", "occupancy_discrepancy_resolved",
        "Occupancy discrepancy resolved", f"Resolution: {resolution_label}",
        {"room_id": room_id, "discrepancy_id": discrepancy_id},
    )

    rows = update_result.data or []
    return {"data": rows[0] if rows else current_row.data}


# ---------------------------------------------------------------------------
# PATCH /rooms/{room_id}/checkout-time
# ---------------------------------------------------------------------------

@router.patch("/{room_id}/checkout-time")
async def update_checkout_time(
    room_id: str,
    request: UpdateCheckoutTimeRequest,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor", "engineer", "front_desk")),
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
    rs = (
        supabase.table("room_status")
        .select("stay_reset_at")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    stay_reset_at = (rs.data or {}).get("stay_reset_at") if rs else None

    query = (
        supabase.table("room_status_history")
        .select("*")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .order("created_at", desc=True)
        .limit(limit)
    )
    if stay_reset_at:
        query = query.gte("created_at", stay_reset_at)
    history = query.execute().data or []

    changed_by_ids = list({h["changed_by"] for h in history if h.get("changed_by")})
    profiles_map: dict = {}
    if changed_by_ids:
        profiles_result = (
            supabase.table("user_profiles")
            .select("id, full_name, preferred_name")
            .in_("id", changed_by_ids)
            .execute()
        )
        profiles_map = {p["id"]: p for p in (profiles_result.data or [])}

    for h in history:
        profile = profiles_map.get(h.get("changed_by"))
        h["user_profiles"] = profile
        h["actor_name"] = (profile.get("preferred_name") or profile.get("full_name")) if profile else None

    return {"data": history}


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

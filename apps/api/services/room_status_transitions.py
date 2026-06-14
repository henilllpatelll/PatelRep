"""Room status transition rules shared by the rooms and clean-sessions routers.

Extracted from routers/rooms.py so that clean sessions can drive the same
validated transitions (start clean -> IN_PROGRESS, finish -> CLEAN) without
duplicating the rules or the history bookkeeping.
"""

import logging
from datetime import datetime, timezone

from fastapi import HTTPException

from core.database import supabase

logger = logging.getLogger(__name__)

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

# Statuses a housekeeper may start a cleaning session from
SESSION_STARTABLE_STATUSES = {"DIRTY", "PICKUP", "OCCUPIED"}


def validate_transition(from_status: str | None, to_status: str, role: str) -> None:
    """Raises HTTPException(400/403) if the transition is not allowed for the role."""
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


def apply_status_transition(
    *,
    room_id: str,
    hotel_id: str,
    user_id: str,
    role: str,
    to_status: str,
    notes: str | None = None,
    force: bool = False,
    current_row: dict | None = None,
    change_source: str = "app",
) -> dict:
    """Validate and persist a room status change, writing the history row.

    Returns the updated room_status row. Raises 404 if the room is unknown,
    400/403 on invalid transitions (unless force=True for GMs).
    """
    if current_row is None:
        result = (
            supabase.table("room_status")
            .select("*")
            .eq("room_id", room_id)
            .eq("tenant_id", hotel_id)
            .maybe_single()
            .execute()
        )
        current_row = (result.data if result else None) or None
    if not current_row:
        raise HTTPException(status_code=404, detail="Room status record not found")

    from_status: str | None = current_row.get("status")
    if not (force and role == "gm"):
        validate_transition(from_status, to_status, role)

    now_iso = datetime.now(timezone.utc).isoformat()
    update_payload: dict = {
        "status": to_status,
        "notes": notes,
        "updated_at": now_iso,
    }
    if to_status == "CLEAN":
        update_payload["last_cleaned_at"] = now_iso
    if to_status == "INSPECTED":
        update_payload["last_inspected_at"] = now_iso
        update_payload["last_inspected_by"] = user_id

    update_result = (
        supabase.table("room_status")
        .update(update_payload)
        .eq("room_id", room_id)
        .eq("tenant_id", hotel_id)
        .execute()
    )

    # History is written explicitly — the DB trigger was dropped in migration 024.
    supabase.table("room_status_history").insert({
        "room_id": room_id,
        "tenant_id": hotel_id,
        "from_status": from_status,
        "to_status": to_status,
        "changed_by": user_id,
        "change_source": change_source,
        "notes": notes,
    }).execute()

    updated_rows = update_result.data or []
    return updated_rows[0] if updated_rows else {}


def update_housekeeper_profile(
    hotel_id: str,
    room_id: str,
    user_id: str | None,
    elapsed_minutes: float | None,
) -> None:
    """Update the housekeeper's rolling average clean time for this room type.

    Callers supply elapsed_minutes explicitly: clean sessions pass the true
    timer duration; the legacy status endpoint approximates from updated_at.
    """
    if not user_id or elapsed_minutes is None:
        return
    if elapsed_minutes <= 0 or elapsed_minutes > 240:
        return  # Ignore unrealistic durations

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


def close_active_sessions_for_room(
    hotel_id: str, room_id: str, ended_at_iso: str | None = None
) -> None:
    """Defensively complete any active clean session for a room.

    Called when a legacy PATCH /rooms/{id}/status flips IN_PROGRESS -> CLEAN
    (e.g. a stale offline queue flush) so sessions are never orphaned.
    """
    now_iso = ended_at_iso or datetime.now(timezone.utc).isoformat()
    try:
        active = (
            supabase.table("room_clean_sessions")
            .select("id, started_at")
            .eq("tenant_id", hotel_id)
            .eq("room_id", room_id)
            .eq("status", "active")
            .execute()
        )
        for session in (active.data or []):
            duration = None
            try:
                start_dt = datetime.fromisoformat(
                    str(session["started_at"]).replace("Z", "+00:00")
                )
                end_dt = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
                duration = max(0, int((end_dt - start_dt).total_seconds()))
            except (ValueError, TypeError, KeyError):
                pass
            supabase.table("room_clean_sessions").update({
                "status": "completed",
                "ended_at": now_iso,
                "duration_seconds": duration,
            }).eq("id", session["id"]).eq("tenant_id", hotel_id).execute()
    except Exception:
        logger.warning(
            "Failed to close active clean sessions for room_id=%s", room_id,
            exc_info=True,
        )

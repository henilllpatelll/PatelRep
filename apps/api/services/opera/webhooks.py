from datetime import datetime, timezone
from core.database import supabase


def handle_checkout(hotel_id: str, payload: dict) -> None:
    """RESERVATION.CHECKED_OUT → mark room DIRTY."""
    room_number = payload.get("roomNumber")
    if not room_number:
        return

    room = supabase.table("rooms").select("id")\
        .eq("tenant_id", hotel_id).eq("room_number", room_number)\
        .maybe_single().execute()
    if not room.data:
        return

    room_id = room.data["id"]

    # Get current status for history
    current = supabase.table("room_status").select("status")\
        .eq("room_id", room_id).maybe_single().execute()
    from_status = current.data["status"] if current.data else None

    supabase.table("room_status").update({
        "status": "DIRTY",
        "guest_name": None,
        "checkin_time": None,
        "checkout_time": None,
        "vip_flag": False,
        "dnd_flag": False,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("room_id", room_id).execute()

    supabase.table("room_status_history").insert({
        "room_id": room_id,
        "tenant_id": hotel_id,
        "from_status": from_status,
        "to_status": "DIRTY",
        "change_source": "opera_webhook",
    }).execute()


def handle_checkin(hotel_id: str, payload: dict) -> None:
    """RESERVATION.CHECKED_IN → update room with guest info."""
    room_number = payload.get("roomNumber")
    reservation = payload.get("reservation", {})
    if not room_number:
        return

    room = supabase.table("rooms").select("id")\
        .eq("tenant_id", hotel_id).eq("room_number", room_number)\
        .maybe_single().execute()
    if not room.data:
        return

    room_id = room.data["id"]
    guest = reservation.get("guestProfile", {})
    guest_name = f"{guest.get('firstName', '')} {guest.get('lastName', '')}".strip()
    vip_flag = bool(guest.get("vipCode"))

    supabase.table("room_status").update({
        "guest_name": guest_name or None,
        "vip_flag": vip_flag,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("room_id", room_id).execute()

    reservation_id = reservation.get("reservationId")
    if reservation_id:
        supabase.table("opera_reservations").upsert({
            "tenant_id": hotel_id,
            "opera_reservation_id": reservation_id,
            "room_id": room_id,
            "room_number_opera": room_number,
            "guest_name": guest_name or None,
            "guest_email": guest.get("email"),
            "vip_code": guest.get("vipCode"),
            "status": "CHECKED_IN",
            "synced_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="tenant_id,opera_reservation_id").execute()


def handle_reservation_modified(hotel_id: str, payload: dict) -> None:
    """RESERVATION.MODIFIED → update checkin/checkout times."""
    room_number = payload.get("roomNumber")
    reservation = payload.get("reservation", {})
    if not room_number:
        return

    room = supabase.table("rooms").select("id")\
        .eq("tenant_id", hotel_id).eq("room_number", room_number)\
        .maybe_single().execute()
    if not room.data:
        return

    updates = {}
    if reservation.get("arrivalDateTime"):
        updates["checkin_time"] = reservation["arrivalDateTime"]
    if reservation.get("departureDateTime"):
        updates["checkout_time"] = reservation["departureDateTime"]
    if updates:
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        supabase.table("room_status").update(updates)\
            .eq("room_id", room.data["id"]).execute()


def handle_dnd(hotel_id: str, payload: dict) -> None:
    """ROOM_STATUS.DO_NOT_DISTURB → set dnd_flag=True."""
    room_number = payload.get("roomNumber")
    if not room_number:
        return

    room = supabase.table("rooms").select("id")\
        .eq("tenant_id", hotel_id).eq("room_number", room_number)\
        .maybe_single().execute()
    if room.data:
        supabase.table("room_status").update({
            "dnd_flag": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("room_id", room.data["id"]).execute()


def handle_make_up_room(hotel_id: str, payload: dict) -> None:
    """ROOM_STATUS.MAKE_UP_ROOM → auto-create a housekeeping task."""
    room_number = payload.get("roomNumber")
    if not room_number:
        return

    room = supabase.table("rooms").select("id, room_number")\
        .eq("tenant_id", hotel_id).eq("room_number", room_number)\
        .maybe_single().execute()
    if not room.data:
        return

    # Check if an open task already exists for this room
    existing = supabase.table("tasks")\
        .select("id")\
        .eq("tenant_id", hotel_id)\
        .eq("room_id", room.data["id"])\
        .eq("task_type", "housekeeping")\
        .in_("status", ["open", "in_progress"])\
        .maybe_single().execute()

    if existing.data:
        return  # Already has an active task

    system_user_id = "00000000-0000-0000-0000-000000000000"
    supabase.table("tasks").insert({
        "tenant_id": hotel_id,
        "title": f"Make Up Room - {room_number}",
        "task_type": "housekeeping",
        "priority": "normal",
        "status": "open",
        "room_id": room.data["id"],
        "created_by": system_user_id,
        "is_ai_created": True,
        "sla_minutes": 240,
    }).execute()

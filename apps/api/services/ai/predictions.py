import logging
from datetime import datetime, timedelta, date

from core.database import supabase

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Industry-standard cleaning time defaults (minutes) by room type code/name
# Used when no housekeeper profile exists for that staff member × room type.
# ---------------------------------------------------------------------------
ROOM_TYPE_DEFAULTS: dict[str, int] = {
    "king_suite": 40,
    "double_queen": 30,
    "king": 35,
    "queen": 28,
    "standard": 25,
    "studio": 20,
}
DEFAULT_CLEAN_MINUTES = 30  # final fallback when no profile and no type match


def _parse_iso(dt_str: str) -> datetime:
    """
    Parse an ISO-8601 datetime string returned by Supabase.
    Handles both 'Z' suffix and '+00:00' offset forms.
    Returns a timezone-aware datetime in UTC.
    """
    if not dt_str:
        raise ValueError("Empty datetime string")
    # Replace 'Z' with '+00:00' so fromisoformat() handles it on Python 3.10
    return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))


def _default_minutes_for_room_type(room_type_name: str, base_clean_minutes: int) -> float:
    """
    Return the best default cleaning time for a room type.
    Prefer the DB's base_clean_minutes if it is set; otherwise fall back to
    ROOM_TYPE_DEFAULTS keyed by a normalised room type name, and finally to
    DEFAULT_CLEAN_MINUTES.
    """
    if base_clean_minutes and base_clean_minutes > 0:
        return float(base_clean_minutes)
    if room_type_name:
        normalised = room_type_name.lower().replace(" ", "_")
        for key, minutes in ROOM_TYPE_DEFAULTS.items():
            if key in normalised:
                return float(minutes)
    return float(DEFAULT_CLEAN_MINUTES)


# ---------------------------------------------------------------------------
# get_at_risk_rooms
# ---------------------------------------------------------------------------

def get_at_risk_rooms(hotel_id: str) -> list[dict]:
    """
    Return room_status rows for rooms that:
    - Are DIRTY or IN_PROGRESS
    - Have a checkin_time set in the future
    - Have a checkin_time within the next 12 hours

    Each row includes nested rooms + room_types data.
    """
    now = datetime.utcnow()
    cutoff = now + timedelta(hours=12)

    result = (
        supabase.table("room_status")
        .select(
            "room_id, status, assigned_to, vip_flag, checkin_time, "
            "rooms!inner(id, room_number, floor, room_type_id, "
            "room_types(name, code, base_clean_minutes))"
        )
        .eq("tenant_id", hotel_id)
        .in_("status", ["DIRTY", "IN_PROGRESS"])
        .not_.is_("checkin_time", "null")
        .gte("checkin_time", now.isoformat())
        .lte("checkin_time", cutoff.isoformat())
        .execute()
    )

    rows = result.data or []

    # Secondary Python filter: ensure checkin_time parses correctly and is
    # genuinely within the window (guards against timezone edge cases).
    at_risk = []
    for row in rows:
        try:
            ci = _parse_iso(row["checkin_time"])
            # Make now tz-aware for comparison if ci is tz-aware
            now_aware = datetime.utcnow().replace(tzinfo=ci.tzinfo) if ci.tzinfo else datetime.utcnow()
            cutoff_aware = now_aware + timedelta(hours=12)
            if now_aware <= ci <= cutoff_aware:
                at_risk.append(row)
        except Exception as exc:
            logger.warning("Could not parse checkin_time for room %s: %s", row.get("room_id"), exc)

    return at_risk


# ---------------------------------------------------------------------------
# get_housekeeper_profile
# ---------------------------------------------------------------------------

def get_housekeeper_profile(user_id: str, room_type_id: str, hotel_id: str) -> tuple[float, int]:
    """
    Look up the housekeeper's average cleaning speed for this room type.

    Returns (avg_clean_minutes, completion_count).
    Falls back to (DEFAULT_CLEAN_MINUTES, 0) when no profile exists.
    """
    try:
        result = (
            supabase.table("housekeeper_profiles")
            .select("avg_clean_minutes, completion_count")
            .eq("user_id", user_id)
            .eq("room_type_id", room_type_id)
            .eq("tenant_id", hotel_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        if rows:
            row = rows[0]
            avg = float(row.get("avg_clean_minutes") or 0)
            count = int(row.get("completion_count") or 0)
            if avg > 0:
                return avg, count
    except Exception as exc:
        logger.warning(
            "Failed to fetch housekeeper profile user=%s room_type=%s: %s",
            user_id, room_type_id, exc,
        )
    return float(DEFAULT_CLEAN_MINUTES), 0


# ---------------------------------------------------------------------------
# count_rooms_ahead
# ---------------------------------------------------------------------------

def count_rooms_ahead(
    housekeeper_id: str,
    room_id: str,
    hotel_id: str,
    target_date: str,
) -> int:
    """
    Count how many rooms assigned to this housekeeper today are still
    DIRTY or IN_PROGRESS (i.e. not yet cleaned), excluding the room we
    are currently predicting.

    Returns minimum 0.
    """
    try:
        # Get all room_ids assigned to this housekeeper today
        assignments = (
            supabase.table("room_assignments")
            .select("room_id")
            .eq("tenant_id", hotel_id)
            .eq("assignment_date", target_date)
            .eq("assigned_to", housekeeper_id)
            .execute()
        )
        assigned_room_ids = [
            r["room_id"] for r in (assignments.data or [])
            if r.get("room_id") and r["room_id"] != room_id
        ]

        if not assigned_room_ids:
            return 0

        # Count how many of those rooms are still dirty/in-progress
        status_result = (
            supabase.table("room_status")
            .select("room_id", count="exact")
            .eq("tenant_id", hotel_id)
            .in_("room_id", assigned_room_ids)
            .in_("status", ["DIRTY", "IN_PROGRESS"])
            .execute()
        )
        count = status_result.count or 0
        return max(0, count)

    except Exception as exc:
        logger.warning(
            "Failed to count rooms ahead for housekeeper=%s room=%s: %s",
            housekeeper_id, room_id, exc,
        )
        return 0


# ---------------------------------------------------------------------------
# notify_supervisors_high_risk
# ---------------------------------------------------------------------------

def notify_supervisors_high_risk(
    hotel_id: str,
    room_number: str,
    room_id: str,
    predicted_ready_at_str: str,
) -> int:
    """
    Insert in-app notifications for all housekeeping supervisors and GMs
    for a HIGH-risk room readiness prediction.

    Returns the number of notifications inserted.
    """
    # Format the predicted_ready_at time nicely (e.g. "2:30 PM")
    try:
        dt = _parse_iso(predicted_ready_at_str)
        formatted_time = dt.strftime("%-I:%M %p")  # e.g. "2:30 PM" (Linux/Mac)
    except Exception:
        try:
            # Windows-compatible strftime
            dt = _parse_iso(predicted_ready_at_str)
            formatted_time = dt.strftime("%I:%M %p").lstrip("0")
        except Exception:
            formatted_time = predicted_ready_at_str

    # Get supervisors and GMs for this hotel
    try:
        supervisors_result = (
            supabase.table("user_profiles")
            .select("user_id")
            .eq("tenant_id", hotel_id)
            .in_("role", ["housekeeping_supervisor", "gm"])
            .execute()
        )
        supervisors = supervisors_result.data or []
    except Exception as exc:
        logger.error("Failed to fetch supervisors for hotel=%s: %s", hotel_id, exc)
        return 0

    if not supervisors:
        return 0

    notifications = [
        {
            "tenant_id": hotel_id,
            "user_id": s["user_id"],
            "type": "room_risk_high",
            "title": f"Room {room_number} at risk",
            "body": (
                f"Room {room_number} may not be ready before check-in. "
                f"Predicted ready: {formatted_time}"
            ),
            "data": {"room_id": room_id, "risk_level": "HIGH"},
            "is_read": False,
            "push_sent": False,
        }
        for s in supervisors
        if s.get("user_id")
    ]

    if not notifications:
        return 0

    try:
        supabase.table("notifications").insert(notifications).execute()
        return len(notifications)
    except Exception as exc:
        logger.error("Failed to insert high-risk notifications for hotel=%s: %s", hotel_id, exc)
        return 0


# ---------------------------------------------------------------------------
# run_room_predictions
# ---------------------------------------------------------------------------

def run_room_predictions(hotel_id: str) -> dict:
    """
    Run the full room readiness prediction engine for a single hotel.

    Algorithm per room:
    1. Determine housekeeper speed (from profile or defaults).
    2. Count rooms ahead in today's assignment queue.
    3. Estimate ETA based on status (DIRTY vs IN_PROGRESS) and queue depth.
    4. Calculate buffer against checkin_time.
    5. Assign risk_level and risk_factors.
    6. Upsert prediction row.
    7. Notify supervisors for new HIGH-risk elevations.

    Returns {"rooms_updated": int, "high_risk_count": int, "notifications_sent": int}
    """
    rooms_updated = 0
    high_risk_count = 0
    notifications_sent = 0

    today_str = date.today().isoformat()

    # Fetch current predictions to detect new HIGH-risk escalations
    try:
        existing_preds_result = (
            supabase.table("room_readiness_predictions")
            .select("room_id, risk_level")
            .eq("tenant_id", hotel_id)
            .execute()
        )
        existing_risk_map: dict[str, str] = {
            r["room_id"]: r.get("risk_level", "LOW")
            for r in (existing_preds_result.data or [])
        }
    except Exception as exc:
        logger.warning("Could not fetch existing predictions for hotel=%s: %s", hotel_id, exc)
        existing_risk_map = {}

    at_risk_rooms = get_at_risk_rooms(hotel_id)

    for room in at_risk_rooms:
        room_id: str = room["room_id"]
        status: str = room.get("status", "DIRTY")
        assigned_to: str | None = room.get("assigned_to")
        vip_flag: bool = bool(room.get("vip_flag", False))
        checkin_time_str: str = room.get("checkin_time", "")

        # Nested room info
        room_info: dict = room.get("rooms") or {}
        room_number: str = room_info.get("room_number", "?")
        room_type_info: dict = room_info.get("room_types") or {}
        room_type_id: str = room_info.get("room_type_id", "")
        room_type_name: str = room_type_info.get("name", "")
        base_clean_minutes: int = room_type_info.get("base_clean_minutes") or 0

        # --- Step 1: Housekeeper speed ---
        completion_count = 0
        if assigned_to and room_type_id:
            avg_speed, completion_count = get_housekeeper_profile(
                assigned_to, room_type_id, hotel_id
            )
        else:
            avg_speed = _default_minutes_for_room_type(room_type_name, base_clean_minutes)

        # Guard against zero speed
        if avg_speed <= 0:
            avg_speed = float(DEFAULT_CLEAN_MINUTES)

        # --- Step 2: Workload / queue depth ---
        if assigned_to:
            rooms_ahead = count_rooms_ahead(assigned_to, room_id, hotel_id, today_str)
        else:
            rooms_ahead = 3  # assume moderate workload when unassigned

        # --- Step 3: ETA calculation ---
        if status == "IN_PROGRESS":
            # Room is already being cleaned — estimate half the avg time remains
            minutes_remaining = avg_speed * 0.5
        else:
            # DIRTY: all rooms ahead must finish, then this room
            minutes_remaining = rooms_ahead * avg_speed + (avg_speed / 2)

        now_utc = datetime.utcnow()
        predicted_ready_at = now_utc + timedelta(minutes=minutes_remaining)

        # --- Step 4: Buffer against checkin_time ---
        try:
            checkin_dt = _parse_iso(checkin_time_str)
            # Normalise both to UTC naive for arithmetic
            checkin_naive = checkin_dt.replace(tzinfo=None) if checkin_dt.tzinfo else checkin_dt
            buffer_minutes = (checkin_naive - predicted_ready_at).total_seconds() / 60
        except Exception as exc:
            logger.warning(
                "Could not parse checkin_time for room %s: %s — skipping", room_id, exc
            )
            continue

        # --- Step 5: Risk factors and level ---
        risk_factors: list[str] = []
        if vip_flag:
            risk_factors.append("vip_room")
        if buffer_minutes < 0:
            risk_factors.append("will_be_late")
        elif buffer_minutes < 30:
            risk_factors.append("tight_timeline")
        if rooms_ahead > 4:
            risk_factors.append("overloaded_housekeeper")
        if not assigned_to:
            risk_factors.append("no_housekeeper_assigned")

        if buffer_minutes < 0:
            risk_level = "HIGH"
        elif buffer_minutes < 30:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"

        # --- Step 6: Confidence score ---
        if completion_count > 5:
            confidence_score = 0.9
        elif completion_count > 0:
            confidence_score = 0.7
        else:
            confidence_score = 0.5

        # --- Step 7: Derived metrics ---
        avg_speed_rooms_per_hr = round(60 / avg_speed, 2) if avg_speed > 0 else 0.0
        # minutes_to_checkin = total minutes from now until checkin (not the buffer)
        minutes_to_checkin = int(buffer_minutes + minutes_remaining)

        # --- Step 8: Upsert prediction ---
        try:
            supabase.table("room_readiness_predictions").upsert(
                {
                    "room_id": room_id,
                    "tenant_id": hotel_id,
                    "housekeeper_id": assigned_to,
                    "predicted_ready_at": predicted_ready_at.isoformat(),
                    "confidence_score": confidence_score,
                    "risk_level": risk_level,
                    "checkin_time": checkin_time_str,
                    "minutes_to_checkin": minutes_to_checkin,
                    "rooms_remaining_for_hk": rooms_ahead,
                    "avg_speed_rooms_per_hr": avg_speed_rooms_per_hr,
                    "risk_factors": risk_factors,
                    "last_calculated_at": now_utc.isoformat(),
                },
                on_conflict="room_id",
            ).execute()
            rooms_updated += 1
        except Exception as exc:
            logger.error("Failed to upsert prediction for room=%s hotel=%s: %s", room_id, hotel_id, exc)
            continue

        if risk_level == "HIGH":
            high_risk_count += 1

        # --- Step 9: Notify supervisors on new HIGH-risk escalations ---
        previous_risk = existing_risk_map.get(room_id, "LOW")
        if risk_level == "HIGH" and previous_risk != "HIGH":
            sent = notify_supervisors_high_risk(
                hotel_id,
                room_number,
                room_id,
                predicted_ready_at.isoformat(),
            )
            notifications_sent += sent

    return {
        "rooms_updated": rooms_updated,
        "high_risk_count": high_risk_count,
        "notifications_sent": notifications_sent,
    }


# ---------------------------------------------------------------------------
# run_all_hotel_predictions
# ---------------------------------------------------------------------------

def run_all_hotel_predictions() -> dict:
    """
    Run room readiness predictions for every active hotel (tenant).

    Returns:
        {
            "hotels_processed": int,
            "total_rooms_updated": int,
            "errors": [{"hotel_id": str, "error": str}, ...]
        }
    """
    hotels_processed = 0
    total_rooms_updated = 0
    errors: list[dict] = []

    try:
        tenants_result = supabase.table("tenants").select("id").eq("is_active", True).execute()
        tenant_rows = tenants_result.data or []
    except Exception as exc:
        logger.error("Failed to fetch tenants for prediction run: %s", exc)
        return {
            "hotels_processed": 0,
            "total_rooms_updated": 0,
            "errors": [{"hotel_id": "ALL", "error": str(exc)}],
        }

    for row in tenant_rows:
        hotel_id = row.get("id")
        if not hotel_id:
            continue
        try:
            result = run_room_predictions(hotel_id)
            hotels_processed += 1
            total_rooms_updated += result.get("rooms_updated", 0)
        except Exception as exc:
            logger.error("Prediction run failed for hotel=%s: %s", hotel_id, exc)
            errors.append({"hotel_id": hotel_id, "error": str(exc)})

    return {
        "hotels_processed": hotels_processed,
        "total_rooms_updated": total_rooms_updated,
        "errors": errors,
    }

"""Database reads behind the housekeeping staffing forecast (see services/staffing_forecast.py for the rules).

Every query is tenant-scoped and bounded (a date window of at most 7 days, row caps), and nothing is read per employee
or per room: one query per table. A source that fails degrades only what depends on it -- except the shift plan, which
is the forecast's spine, so that failure is an error rather than a guess.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from core.database import supabase
from routers.shifts import load_roster
from services.scheduling_access import Departments, err, load_staff
from services.staffing_capacity import classify_person
from services.staffing_forecast import ForecastData

logger = logging.getLogger(__name__)

ASSIGNMENT_CAP = 5000
ROOM_CAP = 5000
ROW_CAP = 2000
FORECAST_COLUMNS = "id, user_id, shift_id, work_date, shift_name, start_time, end_time, starts_at, ends_at, publication_state, version"


def _read(label: str, build) -> Optional[list[dict]]:
    """A read that may fail without sinking the forecast: None means 'could not be read', never 'empty'."""
    try:
        return list(build().execute().data or [])
    except Exception:
        logger.warning("staffing forecast: %s read failed", label)
        return None


def load_forecast_data(
    hotel_id: str, departments: Departments, zone, start: date, days: int, now: datetime, today: date, break_minutes: int,
) -> ForecastData:
    end = start + timedelta(days=days - 1)
    first = datetime.combine(start, time.min, tzinfo=zone).astimezone(timezone.utc).isoformat()
    after = datetime.combine(end + timedelta(days=1), time.min, tzinfo=zone).astimezone(timezone.utc).isoformat()
    hk_department = departments.id_for_code("HK")

    try:
        assignments = list(
            supabase.table("shift_assignments").select(FORECAST_COLUMNS)
            .eq("tenant_id", hotel_id).neq("publication_state", "cancelled")
            .gte("work_date", start.isoformat()).lte("work_date", end.isoformat())
            .order("work_date").order("starts_at").limit(ASSIGNMENT_CAP).execute().data or []
        )
        staff = load_staff(hotel_id, departments)
    except Exception:
        logger.warning("staffing forecast: shift plan read failed hotel_id=%s", hotel_id)
        raise err(503, "forecast_unavailable", "The schedule could not be read, so staffing cannot be forecast. Try again shortly.")

    def person_kind(user_id: str) -> str:
        member = staff.get(user_id)
        if member is None:
            return "unknown_department"
        return classify_person(departments.code_by_id.get(member.department_id or ""), member.roles)

    absences = _read("absences", lambda: (
        supabase.table("absence_records").select("id, assignment_id, user_id, kind, status, leaving_at, version")
        .eq("tenant_id", hotel_id).in_("status", ["reported", "confirmed", "covered"])
        .gte("work_date", start.isoformat()).lte("work_date", end.isoformat()).limit(ROW_CAP)))
    leaves = _read("time off", lambda: (
        supabase.table("time_off_requests").select("id, user_id, status, starts_at, ends_at, version")
        .eq("tenant_id", hotel_id).in_("status", ["pending", "approved"])
        .lt("starts_at", after).gt("ends_at", first).limit(ROW_CAP)))
    gaps = _read("coverage gaps", lambda: (
        supabase.table("coverage_gaps")
        .select("id, status, source, shift_name, work_date, start_time, end_time, filled_assignment_id, version")
        .eq("tenant_id", hotel_id).eq("department_id", hk_department or "")
        .gte("work_date", start.isoformat()).lte("work_date", end.isoformat()).limit(ROW_CAP))) or []

    board = board_assignments = None
    room_info: dict[str, dict] = {}
    attendance = None
    if start <= today <= end:
        board, board_assignments, room_info = _load_board(hotel_id, today)
        try:
            attendance = {str(r["user_id"]): r for r in load_roster(hotel_id, today, zone) if r.get("user_id")}
        except Exception:
            logger.warning("staffing forecast: attendance read failed hotel_id=%s", hotel_id)

    learned, learned_available = _learned(hotel_id)
    return ForecastData(
        now=now, today=today, assignments=assignments, person_kind=person_kind, absences=absences, leaves=leaves, gaps=gaps,
        board=board, board_assignments=board_assignments or {}, room_info=room_info, learned=learned,
        learned_available=learned_available, pms_connected=_pms_connected(hotel_id), attendance=attendance,
        break_minutes=break_minutes,
    )


def _load_board(hotel_id: str, today: date):
    """Rooms still to clean today, pre-joined to their room type, plus today's dated assignments (clean type + owner)."""
    statuses = _read("room status", lambda: (
        supabase.table("room_status")
        .select("room_id, status, fo_status, clean_type, actual_checkout_at, do_not_service, assigned_to, updated_at")
        .eq("tenant_id", hotel_id).limit(ROOM_CAP)))
    rooms = _read("rooms", lambda: supabase.table("rooms").select("id, is_active, room_type_id").eq("tenant_id", hotel_id).limit(ROOM_CAP))
    types = _read("room types", lambda: supabase.table("room_types").select("id, code, base_clean_minutes").eq("tenant_id", hotel_id).limit(ROW_CAP))
    if statuses is None or rooms is None or types is None:
        return None, None, {}
    assigned = _read("room assignments", lambda: (
        supabase.table("room_assignments").select("room_id, assigned_to, clean_type")
        .eq("tenant_id", hotel_id).eq("assignment_date", today.isoformat()).limit(ROOM_CAP)))
    if assigned is None:
        return None, None, {}
    type_by_id = {str(t["id"]): t for t in types}
    room_by_id = {str(r["id"]): r for r in rooms}
    info: dict[str, dict] = {}
    for room_id, room in room_by_id.items():
        kind = type_by_id.get(str(room.get("room_type_id"))) or {}
        info[room_id] = {"is_active": room.get("is_active"), "room_type_code": kind.get("code"), "base_clean_minutes": kind.get("base_clean_minutes")}
    board = [{**row, **info.get(str(row.get("room_id")), {"is_active": False})} for row in statuses if str(row.get("room_id")) in room_by_id]
    return board, {str(a["room_id"]): a for a in assigned if a.get("room_id")}, info


def _learned(hotel_id: str):
    try:
        from routers.clean_sessions import _load_estimates   # shared with GET /clean-sessions/estimates (6h cache)

        table = {(e["room_type_code"].strip().upper(), e["clean_type"]): float(e["minutes"]) for e in _load_estimates(hotel_id)["estimates"]}
    except Exception:
        logger.warning("staffing forecast: learned estimates unavailable hotel_id=%s", hotel_id)
        return None, False
    return (lambda code, clean: table.get((str(code or "").strip().upper(), clean))), True


def _pms_connected(hotel_id: str) -> Optional[bool]:
    """Whether the Opera integration is on. It only explains why future demand is missing; it is never demand itself."""
    try:
        row = supabase.table("tenants").select("opera_pilot_enabled").eq("id", hotel_id).maybe_single().execute()
        data = row.data if row else None
    except Exception:
        return None
    return None if data is None else bool(data.get("opera_pilot_enabled"))

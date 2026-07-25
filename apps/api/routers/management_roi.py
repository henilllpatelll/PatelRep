"""Phase 5 management ROI aggregation. GM-only (D-06). Math lives in contracts.py."""

import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query

from core.database import supabase
from middleware.auth import CurrentUser, require_role
from services.guest_recovery.contracts import (
    calculate_downtime_revenue_impact,
    calculate_housekeeping_efficiency,
    calculate_inspection_trends,
    calculate_pm_compliance,
    calculate_repeat_failures,
    calculate_room_downtime_hours,
    calculate_training_readiness,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reports/roi", tags=["management-roi"])

DEFAULT_WINDOW_DAYS = 90  # D-08


def _window(start_date: Optional[date], end_date: Optional[date], *, days: int = DEFAULT_WINDOW_DAYS):
    today = date.today()
    start = start_date or (today - timedelta(days=days))
    end = end_date or today
    return start, end


def _bounds(start: date, end: date) -> tuple[datetime, datetime]:
    """Inclusive end-of-day upper bound, in UTC."""
    return (
        datetime.combine(start, time.min, tzinfo=timezone.utc),
        datetime.combine(end, time.max, tzinfo=timezone.utc),
    )


def _period(start: date, end: date) -> dict:
    return {"start": start.isoformat(), "end": end.isoformat()}


def _average_daily_rate_cents(hotel_id: str) -> Optional[int]:
    """D-07: GM-configured ADR from Settings > General. None means not configured."""
    tenant = supabase.table("tenants").select("average_daily_rate_cents").eq(
        "id", hotel_id
    ).maybe_single().execute()
    if not tenant or not tenant.data:
        return None
    return tenant.data.get("average_daily_rate_cents")


CLEAN_SESSION_OPEN = "IN_PROGRESS"
CLEAN_SESSION_CLOSE = ("CLEAN", "INSPECTED")


def _parse_transition_at(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _build_clean_sessions(transitions: list[dict], room_type_by_room: dict[str, str]) -> list[dict]:
    """Pair IN_PROGRESS -> CLEAN/INSPECTED transitions into timed clean sessions.

    Each produced session is {"room_id", "room_type_id", "date", "minutes"}. An
    unmatched open at the end of the window is discarded (an in-flight clean is
    not a measurable session).
    """
    by_room: dict[str, list[dict]] = {}
    for transition in transitions:
        room_id = transition.get("room_id")
        at = _parse_transition_at(transition.get("at"))
        if room_id is None or at is None:
            continue
        by_room.setdefault(room_id, []).append({"to_status": transition.get("to_status"), "at": at})

    sessions: list[dict] = []
    for room_id, room_transitions in by_room.items():
        room_transitions.sort(key=lambda entry: entry["at"])
        open_at: Optional[datetime] = None
        for entry in room_transitions:
            if entry["to_status"] == CLEAN_SESSION_OPEN:
                open_at = entry["at"]
            elif entry["to_status"] in CLEAN_SESSION_CLOSE and open_at is not None:
                minutes = (entry["at"] - open_at).total_seconds() / 60
                sessions.append({
                    "room_id": room_id,
                    "room_type_id": room_type_by_room.get(room_id),
                    "date": open_at.date().isoformat(),
                    "minutes": round(minutes, 1),
                })
                open_at = None
    return sessions


@router.get("/repeat-failures")
async def get_repeat_failures(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """D-08: same asset or room, 2+ work orders inside a trailing 90-day window."""
    start, end = _window(start_date, end_date)
    window_start, window_end = _bounds(start, end)
    work_orders = supabase.table("work_orders").select(
        "id, asset_id, room_id, category, created_at"
    ).eq("tenant_id", current_user.hotel_id).gte(
        "created_at", window_start.isoformat()
    ).lte("created_at", window_end.isoformat()).execute().data or []
    metrics = calculate_repeat_failures(
        work_orders, window_start=window_start, window_end=window_end,
        window_days=(end - start).days or DEFAULT_WINDOW_DAYS,
    )
    return {"data": {"period": _period(start, end), **metrics}}


@router.get("/downtime-revenue")
async def get_downtime_revenue(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """D-07: room downtime hours x (GM-configured ADR / 24). No external PMS dependency."""
    start, end = _window(start_date, end_date, days=30)
    window_start, window_end = _bounds(start, end)
    history = supabase.table("room_status_history").select(
        "room_id, to_status, created_at"
    ).eq("tenant_id", current_user.hotel_id).gte(
        "created_at", window_start.isoformat()
    ).lte("created_at", window_end.isoformat()).order("created_at").execute().data or []
    transitions = [
        {"room_id": row["room_id"], "to_status": row["to_status"], "at": row["created_at"]}
        for row in history
    ]
    downtime = calculate_room_downtime_hours(transitions, window_end=window_end)
    revenue = calculate_downtime_revenue_impact(
        downtime_hours=downtime["total_downtime_hours"],
        average_daily_rate_cents=_average_daily_rate_cents(current_user.hotel_id),
    )
    return {"data": {"period": _period(start, end), "downtime": downtime, "revenue": revenue}}


@router.get("/housekeeping-efficiency")
async def get_housekeeping_efficiency(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """Minutes per occupied room and per-room-type variance vs. base_clean_minutes."""
    start, end = _window(start_date, end_date, days=30)
    window_start, window_end = _bounds(start, end)
    rooms = supabase.table("rooms").select("id, room_type_id").eq(
        "tenant_id", current_user.hotel_id
    ).execute().data or []
    room_type_by_room = {row["id"]: row["room_type_id"] for row in rooms}
    history = supabase.table("room_status_history").select(
        "room_id, to_status, created_at"
    ).eq("tenant_id", current_user.hotel_id).gte(
        "created_at", window_start.isoformat()
    ).lte("created_at", window_end.isoformat()).order("created_at").execute().data or []
    transitions = [
        {"room_id": row["room_id"], "to_status": row["to_status"], "at": row["created_at"]}
        for row in history
    ]
    clean_sessions = _build_clean_sessions(transitions, room_type_by_room)
    room_types = supabase.table("room_types").select("id, base_clean_minutes").eq(
        "tenant_id", current_user.hotel_id
    ).execute().data or []
    baselines = {row["id"]: row["base_clean_minutes"] for row in room_types}
    metrics = calculate_housekeeping_efficiency(clean_sessions, room_type_baselines=baselines)
    return {"data": {"period": _period(start, end), **metrics}}


@router.get("/inspection-trends")
async def get_inspection_trends(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """Pass rate and repeat-defect ranking for inspections completed in the window."""
    start, end = _window(start_date, end_date, days=30)
    window_start, window_end = _bounds(start, end)
    inspections = supabase.table("inspections").select(
        "id, room_id, overall_result, completed_at"
    ).eq("tenant_id", current_user.hotel_id).gte(
        "completed_at", window_start.isoformat()
    ).lte("completed_at", window_end.isoformat()).execute().data or []
    inspection_ids = [row["id"] for row in inspections]
    results = []
    if inspection_ids:
        results = supabase.table("inspection_results").select(
            "inspection_id, template_item_id, result"
        ).eq("tenant_id", current_user.hotel_id).in_(
            "inspection_id", inspection_ids
        ).execute().data or []
    metrics = calculate_inspection_trends(inspections, results)
    return {"data": {"period": _period(start, end), **metrics}}


@router.get("/pm-compliance")
async def get_pm_compliance(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """Completion/deferral rates sourced from the real completion and deferral record tables."""
    start, end = _window(start_date, end_date, days=30)
    window_start, window_end = _bounds(start, end)
    schedules = supabase.table("pm_schedules").select("id, asset_id, name, next_due_at").eq(
        "tenant_id", current_user.hotel_id
    ).eq("is_active", True).execute().data or []
    completions = supabase.table("pm_completion_records").select(
        "pm_schedule_id, labor_minutes, completed_at"
    ).eq("tenant_id", current_user.hotel_id).gte(
        "completed_at", window_start.isoformat()
    ).lte("completed_at", window_end.isoformat()).execute().data or []
    deferrals = supabase.table("pm_deferrals").select(
        "pm_schedule_id, deferred_until, created_at"
    ).eq("tenant_id", current_user.hotel_id).gte(
        "created_at", window_start.isoformat()
    ).lte("created_at", window_end.isoformat()).execute().data or []
    metrics = calculate_pm_compliance(schedules, completions, deferrals)
    return {"data": {"period": _period(start, end), **metrics}}


@router.get("/training-readiness")
async def get_training_readiness(
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """Point-in-time training readiness state — no date range, matching /safety/training/status."""
    assignments = supabase.table("safety_training_assignments").select(
        "id, course_id, employee_id, due_date, completed_at"
    ).eq("tenant_id", current_user.hotel_id).execute().data or []
    metrics = calculate_training_readiness(assignments, as_of=date.today())
    return {"data": {"generated_for": date.today().isoformat(), **metrics}}

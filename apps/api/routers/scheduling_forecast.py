"""GET /schedules/forecast -- the housekeeping staffing forecast behind the supervisor's Team Schedule.

Server-side and authoritative: one calculation (services/staffing_forecast.py) over the hotel's own records, so every
supervisor sees the same answer and no device's cached model decides hotel-wide staffing. Read-only: it never
publishes a schedule, assigns anyone or moves a room.

The response is computed fresh on every request (no server cache), so a changed shift, call-out, leave decision, room
status or workload setting is reflected on the next read. `meta.revision` fingerprints the inputs so a client can tell
a changed forecast from the same one. Visibility: the schedule viewers, but only people whose scope includes
Housekeeping (the gm and the housekeeping supervisor).
"""
import logging
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query

from core.roles import SCHEDULE_VIEWER_ROLES
from middleware.auth import CurrentUser, require_role
from services.forecast_store import load_forecast_data
from services.scheduling_access import err, hotel_today, hotel_zone, load_departments, manager_scope
from services.staffing_forecast import MAX_BREAK_MINUTES, MAX_FORECAST_DAYS, forecast_day, revision, utc_now, window

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/schedules", tags=["scheduling"])

MAX_DAYS_AHEAD = 60


def _build(current_user: CurrentUser, start: Optional[date], days: int, break_minutes: int):
    scope = manager_scope(current_user)
    if scope is not None and "HK" not in scope:
        raise err(403, "department_forbidden", "The staffing forecast covers Housekeeping, which your role does not manage.")
    hotel_id = current_user.hotel_id
    zone = hotel_zone(hotel_id)
    now = utc_now()
    today = hotel_today(zone, now)
    first = start or today
    if first < today:
        raise err(422, "past_date", "The forecast starts today. Earlier days are not forecast.")
    if first > today + timedelta(days=MAX_DAYS_AHEAD):
        raise err(422, "date_too_far", f"Ask for a date within {MAX_DAYS_AHEAD} days.", max_days_ahead=MAX_DAYS_AHEAD)
    data = load_forecast_data(hotel_id, load_departments(hotel_id), zone, first, days, now, today, break_minutes)
    meta = {
        "generated_at": now.isoformat(), "hotel_today": today.isoformat(), "hotel_name": data.hotel_name,
        "date_from": first.isoformat(), "days": days, "max_days": MAX_FORECAST_DAYS, "revision": revision(data),
        "break_policy": "scenario" if break_minutes else "unknown", "break_minutes_per_shift": break_minutes,
    }
    return [forecast_day(day, data) for day in window(first, days)], meta


@router.get("/forecast")
async def get_staffing_forecast(
    date_from: Optional[date] = Query(None),
    days: int = Query(MAX_FORECAST_DAYS, ge=1, le=MAX_FORECAST_DAYS),
    break_minutes: int = Query(0, ge=0, le=MAX_BREAK_MINUTES),
    current_user: CurrentUser = Depends(require_role(*SCHEDULE_VIEWER_ROLES)),
):
    """Today (or `date_from`) and up to six following hotel-local days. `break_minutes` is a what-if only; it is never stored."""
    forecasts, meta = _build(current_user, date_from, days, break_minutes)
    return {"data": {"days": forecasts}, "meta": meta}


@router.get("/forecast/{day}")
async def get_staffing_forecast_day(
    day: date,
    break_minutes: int = Query(0, ge=0, le=MAX_BREAK_MINUTES),
    current_user: CurrentUser = Depends(require_role(*SCHEDULE_VIEWER_ROLES)),
):
    """One day's forecast with its full breakdown (demand, capacity, shifts, sources, recommendations)."""
    forecasts, meta = _build(current_user, day, 1, break_minutes)
    return {"data": forecasts[0], "meta": meta}

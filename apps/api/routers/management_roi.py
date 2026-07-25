"""Phase 5 management ROI aggregation. GM-only (D-06). Math lives in contracts.py."""

import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query

from core.database import supabase
from middleware.auth import CurrentUser, require_role
from services.guest_recovery.contracts import (
    calculate_downtime_revenue_impact,
    calculate_repeat_failures,
    calculate_room_downtime_hours,
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

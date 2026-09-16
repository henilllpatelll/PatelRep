"""Preventive-maintenance schedule advancement.

Shared by routers/internal.py (pm.check-due cron) and routers/work_orders.py
(completion path) so a schedule advances exactly once per cycle regardless of
which recurrence basis it uses. See migration 101 for the recurrence_basis
column this module reads/writes.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from dateutil.relativedelta import relativedelta

from core.database import supabase

_INTERVAL_DELTAS = {
    "daily": relativedelta(days=1),
    "weekly": relativedelta(weeks=1),
    "monthly": relativedelta(months=1),
    "quarterly": relativedelta(months=3),
    "annual": relativedelta(years=1),
}

_OPEN_WORK_ORDER_STATUSES_EXCLUDED = ["completed", "cancelled"]


def compute_next_due_at(
    base: datetime, interval_type: str, interval_days: int | None
) -> datetime:
    if interval_type == "custom":
        return base + timedelta(days=interval_days or 1)
    return base + _INTERVAL_DELTAS.get(interval_type, relativedelta(days=1))


def has_open_pm_work_order(pm_schedule_id: str, tenant_id: str) -> bool:
    """True if a work order for this PM cycle is still open (not completed/cancelled).

    This is what actually stops the cron from regenerating a duplicate work
    order every day it stays overdue — recurrence_basis only controls when
    next_due_at itself moves.
    """
    existing = (
        supabase.table("work_orders")
        .select("id")
        .eq("pm_schedule_id", pm_schedule_id)
        .eq("tenant_id", tenant_id)
        .not_.in_("status", _OPEN_WORK_ORDER_STATUSES_EXCLUDED)
        .limit(1)
        .execute()
    )
    return bool(existing.data)


def advance_pm_schedule_on_generate(pm_schedule: dict) -> None:
    """Call right after the cron creates a WO for an overdue schedule.

    scheduled_date basis advances next_due_at immediately from the old due
    date so the calendar cadence doesn't slip while the WO is worked.
    completion_date basis leaves next_due_at untouched here — it only moves
    in advance_pm_schedule_on_completion, once the generated WO is completed.
    """
    if pm_schedule.get("recurrence_basis") == "completion_date":
        return
    next_due = compute_next_due_at(
        datetime.fromisoformat(pm_schedule["next_due_at"]),
        pm_schedule["interval_type"],
        pm_schedule.get("interval_days"),
    )
    supabase.table("pm_schedules").update(
        {"next_due_at": next_due.isoformat()}
    ).eq("id", pm_schedule["id"]).execute()


def advance_pm_schedule_on_completion(pm_schedule_id: str, tenant_id: str) -> None:
    """Call when a PM-generated work order is marked completed."""
    result = (
        supabase.table("pm_schedules")
        .select("id, interval_type, interval_days, recurrence_basis")
        .eq("id", pm_schedule_id)
        .eq("tenant_id", tenant_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        return
    schedule = result.data
    now = datetime.now(timezone.utc)
    patch: dict = {"last_completed_at": now.isoformat()}
    if schedule.get("recurrence_basis") == "completion_date":
        patch["next_due_at"] = compute_next_due_at(
            now, schedule["interval_type"], schedule.get("interval_days")
        ).isoformat()
    supabase.table("pm_schedules").update(patch).eq("id", pm_schedule_id).eq(
        "tenant_id", tenant_id
    ).execute()

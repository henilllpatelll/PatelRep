"""Recurring Internal Task advancement.

Shared by routers/internal.py (tasks.generate-recurring cron) and
routers/tasks.py (schedule creation, which generates the first occurrence
through the same path). Mirrors services/pm_schedules.py's proven cadence
model instead of inventing a second one — see migration 116.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from dateutil.relativedelta import relativedelta

from core.database import supabase

_INTERVAL_DELTAS = {
    "daily": relativedelta(days=1),
    "weekly": relativedelta(weeks=1),
    "monthly": relativedelta(months=1),
}

_OPEN_TASK_STATUSES_EXCLUDED = ["completed", "cancelled"]


def compute_next_due_at(base: datetime, interval_type: str, interval_days: int | None) -> datetime:
    if interval_type == "custom":
        return base + timedelta(days=interval_days or 1)
    return base + _INTERVAL_DELTAS.get(interval_type, relativedelta(days=1))


def has_open_generated_task(schedule_id: str, tenant_id: str) -> bool:
    """True if a task for this cycle is still open — the actual duplicate-generation
    guard, same role as pm_schedules.has_open_pm_work_order."""
    existing = (
        supabase.table("tasks")
        .select("id")
        .eq("task_schedule_id", schedule_id)
        .eq("tenant_id", tenant_id)
        .not_.in_("status", _OPEN_TASK_STATUSES_EXCLUDED)
        .limit(1)
        .execute()
    )
    return bool(existing.data)


def schedule_has_ended(schedule: dict, *, today: date | None = None) -> bool:
    end_type = schedule.get("end_type", "never")
    if end_type == "count":
        return (schedule.get("occurrences_generated") or 0) >= (schedule.get("end_count") or 0)
    if end_type == "date":
        end_date = schedule.get("end_date")
        if not end_date:
            return False
        return (today or date.today()).isoformat() >= end_date
    return False


def generate_task_from_schedule(schedule: dict) -> dict | None:
    """Create the next occurrence for one due, active, not-yet-ended schedule.

    Returns the created task row, or None if generation was skipped (an open
    occurrence already exists, or the schedule already ended).
    """
    tenant_id = schedule["tenant_id"]
    if schedule_has_ended(schedule):
        supabase.table("task_schedules").update({"is_active": False}).eq("id", schedule["id"]).eq(
            "tenant_id", tenant_id
        ).execute()
        return None
    if has_open_generated_task(schedule["id"], tenant_id):
        return None

    sla = {"urgent": 60, "normal": 240, "low": 480}.get(schedule["priority"], 240)
    now = datetime.now(timezone.utc)
    task_result = (
        supabase.table("tasks")
        .insert(
            {
                "tenant_id": tenant_id,
                "title": schedule["title"],
                "description": schedule.get("description"),
                "task_type": schedule["task_type"],
                "priority": schedule["priority"],
                "room_id": schedule.get("room_id"),
                "location_text": schedule.get("location_text"),
                "assigned_to": schedule.get("assigned_to"),
                "assigned_by": schedule.get("created_by") if schedule.get("assigned_to") else None,
                "created_by": schedule["created_by"],
                "sla_minutes": sla,
                "due_at": (now + timedelta(minutes=sla)).isoformat(),
                "task_schedule_id": schedule["id"],
            }
        )
        .execute()
    )
    if not task_result.data:
        return None

    next_due = compute_next_due_at(
        datetime.fromisoformat(schedule["next_due_at"]), schedule["interval_type"], schedule.get("interval_days")
    )
    supabase.table("task_schedules").update(
        {
            "next_due_at": next_due.isoformat(),
            "occurrences_generated": (schedule.get("occurrences_generated") or 0) + 1,
        }
    ).eq("id", schedule["id"]).eq("tenant_id", tenant_id).execute()

    return task_result.data[0]

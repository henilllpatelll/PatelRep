"""Recurrence math for scheduled reports, evaluated in the hotel-local wall clock.

DST rules (deterministic, never skipped, never duplicated):
* A wall-clock time that does not exist (spring-forward gap) fires at the first valid
  instant after the gap (zoneinfo ``fold=0`` semantics map it forward).
* A wall-clock time that occurs twice (fall-back) fires once, at its first occurrence.
Each occurrence has a durable idempotency key ``<schedule_id>:<occurrence UTC ISO>`` so a
retry, a second worker or a clock change can never produce a second send.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

FREQUENCIES = ("daily", "weekly", "monthly")
WINDOWS = ("previous_day", "previous_7_days", "previous_month")
DEFAULT_WINDOW = {"daily": "previous_day", "weekly": "previous_7_days", "monthly": "previous_month"}


def occurrence_at(day: date, local_time: time, tz: ZoneInfo) -> datetime:
    """UTC instant for hotel-local ``day`` at ``local_time`` (fold=0 on ambiguity / gap)."""
    naive = datetime.combine(day, local_time.replace(tzinfo=None))
    return naive.replace(tzinfo=tz, fold=0).astimezone(timezone.utc)


def _add_month(day: date) -> date:
    return (day.replace(day=1) + timedelta(days=32)).replace(day=1)


def next_run(
    frequency: str,
    local_time: time,
    tz: ZoneInfo,
    *,
    day_of_week: Optional[int] = None,
    day_of_month: Optional[int] = None,
    after: Optional[datetime] = None,
) -> datetime:
    """First scheduled UTC instant strictly after ``after`` (default: now)."""
    after = (after or datetime.now(timezone.utc)).astimezone(timezone.utc)
    start_day = after.astimezone(tz).date() - timedelta(days=1)  # one day of slack covers tz edge cases
    if frequency == "daily":
        day = start_day
        for _ in range(4):
            candidate = occurrence_at(day, local_time, tz)
            if candidate > after:
                return candidate
            day += timedelta(days=1)
    elif frequency == "weekly":
        if day_of_week is None:
            raise ValueError("weekly schedules need day_of_week")
        day = start_day + timedelta(days=(day_of_week - start_day.weekday()) % 7)
        for _ in range(4):
            candidate = occurrence_at(day, local_time, tz)
            if candidate > after:
                return candidate
            day += timedelta(days=7)
    elif frequency == "monthly":
        if day_of_month is None:
            raise ValueError("monthly schedules need day_of_month")
        month = start_day.replace(day=1)
        for _ in range(4):
            candidate = occurrence_at(month.replace(day=day_of_month), local_time, tz)
            if candidate > after:
                return candidate
            month = _add_month(month)
    else:
        raise ValueError(f"unknown frequency {frequency}")
    raise RuntimeError("could not compute next run")  # pragma: no cover


def window_for(reporting_window: str, occurrence: datetime, tz: ZoneInfo) -> tuple[date, date]:
    """Previous COMPLETED local days relative to the occurrence (never a frozen historical range)."""
    today = occurrence.astimezone(tz).date()
    if reporting_window == "previous_day":
        day = today - timedelta(days=1)
        return day, day
    if reporting_window == "previous_7_days":
        return today - timedelta(days=7), today - timedelta(days=1)
    if reporting_window == "previous_month":
        last = today.replace(day=1) - timedelta(days=1)
        return last.replace(day=1), last
    raise ValueError(f"unknown reporting window {reporting_window}")


def idempotency_key(schedule_id: str, occurrence: datetime) -> str:
    return f"{schedule_id}:{occurrence.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}"


def describe(frequency: str, local_time: time, tz_name: str, day_of_week: Optional[int], day_of_month: Optional[int]) -> str:
    when = local_time.strftime("%I:%M %p").lstrip("0")
    if frequency == "daily":
        return f"Every day at {when} ({tz_name})"
    if frequency == "weekly":
        names = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
        return f"Every {names[day_of_week or 0]} at {when} ({tz_name})"
    return f"Day {day_of_month} of every month at {when} ({tz_name})"

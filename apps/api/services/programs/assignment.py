"""Who is the technician for a PM schedule's CURRENT inspection.

A schedule is one recurring row whose `next_due_at` moves forward when an inspection is completed; there is no
occurrence table. An assignment is therefore stored together with the due date it was made for
(`assigned_for_due_at`). When the schedule has advanced, the stored assignment has lapsed and is NOT the current
assignee: it never carries silently into the next cycle and never grants anything.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional


def _moment(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def effective_assignee(schedule: dict) -> Optional[str]:
    """The assigned technician id, only while the assignment still belongs to the schedule's current due date."""
    assignee = schedule.get("assigned_to")
    if not assignee:
        return None
    assigned_for = _moment(schedule.get("assigned_for_due_at"))
    due = _moment(schedule.get("next_due_at"))
    if assigned_for is None or due is None or assigned_for != due:
        return None
    return str(assignee)


def annotate_assignee(schedule: dict) -> dict:
    """Adds `effective_assigned_to` (None when unassigned or lapsed) and `assignment_lapsed` to a schedule row."""
    effective = effective_assignee(schedule)
    schedule["effective_assigned_to"] = effective
    schedule["assignment_lapsed"] = bool(schedule.get("assigned_to")) and effective is None
    return schedule

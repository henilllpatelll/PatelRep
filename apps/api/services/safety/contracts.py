"""Pure policies for Texas safety training and controlled incidents."""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime


TRAINING_DUE_SOON_DAYS = 14
MANAGEMENT_ROLES = {"gm", "housekeeping_supervisor", "chief_engineer"}


def calculate_next_training_due_date(completed_on: date, recurrence_months: int) -> date:
    """Keep recurring course due dates on a calendar boundary, including leap years."""
    if recurrence_months < 1:
        raise ValueError("Training recurrence must be at least one month.")

    month_index = completed_on.month - 1 + recurrence_months
    year = completed_on.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, min(completed_on.day, monthrange(year, month)[1]))


def get_training_status(
    *, required: bool, completed_at: datetime | None, due_date: date | None, today: date
) -> str:
    """Return the floor-friendly compliance state without mutating assignment history."""
    if not required:
        return "not_applicable"
    if completed_at:
        return "compliant"
    if due_date is None or due_date < today:
        return "overdue"
    if (due_date - today).days <= TRAINING_DUE_SOON_DAYS:
        return "due_soon"
    return "compliant"


def should_schedule_training_assignment(
    *, employee_role: str, covered_roles: list[str], existing_open_due_dates: list[date],
    last_completed_on: date | None, recurrence_months: int, today: date,
) -> bool:
    """Keep one open requirement per employee/course and schedule recurrence before it is due."""
    if employee_role not in covered_roles or existing_open_due_dates:
        return False
    if last_completed_on is None:
        return True
    return calculate_next_training_due_date(last_completed_on, recurrence_months) <= (
        today.fromordinal(today.toordinal() + TRAINING_DUE_SOON_DAYS)
    )


def is_incident_visible_to(*, incident_creator_id: str, requester_id: str, requester_role: str) -> bool:
    """Management has oversight; other staff can only read their own controlled report."""
    return requester_role in MANAGEMENT_ROLES or requester_id == incident_creator_id


def build_incident_event(
    *, incident_id: str, event_type: str, detail: str, actor_id: str,
    actor_role: str, now: datetime,
) -> dict[str, str]:
    """Build an immutable event row; incident facts are never overwritten in place."""
    allowed_event_types = {"created", "correction", "manager_review", "follow_up", "closed"}
    if event_type not in allowed_event_types:
        raise ValueError("Unsupported controlled incident event type.")
    if not detail.strip():
        raise ValueError("A controlled incident event requires a detail.")

    return {
        "incident_id": incident_id,
        "event_type": event_type,
        "detail": detail.strip(),
        "actor_id": actor_id,
        "actor_role": actor_role,
        "occurred_at": now.isoformat(),
    }

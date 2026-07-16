"""Phase 3 Texas compliance and staff-safety policy contracts."""

from datetime import date, datetime, timezone

from services.safety.contracts import (
    build_incident_event,
    calculate_next_training_due_date,
    get_training_status,
)


TODAY = date(2026, 7, 16)


def test_annual_training_completion_sets_the_next_annual_deadline():
    assert calculate_next_training_due_date(date(2026, 7, 16), 12) == date(2027, 7, 16)


def test_training_status_is_due_soon_within_fourteen_days():
    status = get_training_status(
        required=True,
        completed_at=None,
        due_date=date(2026, 7, 24),
        today=TODAY,
    )

    assert status == "due_soon"


def test_training_status_is_overdue_when_completion_is_missing_after_deadline():
    status = get_training_status(
        required=True,
        completed_at=None,
        due_date=date(2026, 7, 15),
        today=TODAY,
    )

    assert status == "overdue"


def test_training_status_is_not_applicable_for_uncovered_employees():
    status = get_training_status(
        required=False,
        completed_at=None,
        due_date=None,
        today=TODAY,
    )

    assert status == "not_applicable"


def test_incident_corrections_append_an_auditable_event_instead_of_rewriting_the_record():
    event = build_incident_event(
        incident_id="incident-1",
        event_type="correction",
        detail="Witness phone number corrected after manager verification.",
        actor_id="manager-1",
        actor_role="gm",
        now=datetime(2026, 7, 16, 16, tzinfo=timezone.utc),
    )

    assert event == {
        "incident_id": "incident-1",
        "event_type": "correction",
        "detail": "Witness phone number corrected after manager verification.",
        "actor_id": "manager-1",
        "actor_role": "gm",
        "occurred_at": "2026-07-16T16:00:00+00:00",
    }

"""Phase 3 Texas compliance and staff-safety policy contracts."""

from datetime import date, datetime, timezone

from services.safety.contracts import (
    build_incident_event,
    calculate_next_training_due_date,
    get_training_status,
    is_incident_visible_to,
    should_schedule_training_assignment,
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


def test_training_scheduler_creates_new_hire_work_once_and_waits_for_recurrence():
    assert should_schedule_training_assignment(
        employee_role="housekeeper", covered_roles=["housekeeper"], existing_open_due_dates=[],
        last_completed_on=None, recurrence_months=12, today=TODAY,
    ) is True
    assert should_schedule_training_assignment(
        employee_role="housekeeper", covered_roles=["housekeeper"], existing_open_due_dates=[date(2026, 8, 1)],
        last_completed_on=None, recurrence_months=12, today=TODAY,
    ) is False
    assert should_schedule_training_assignment(
        employee_role="housekeeper", covered_roles=["housekeeper"], existing_open_due_dates=[],
        last_completed_on=date(2026, 1, 1), recurrence_months=12, today=TODAY,
    ) is False


def test_incident_visibility_allows_management_and_the_filer_but_not_other_floor_staff():
    assert is_incident_visible_to(incident_creator_id="filer", requester_id="filer", requester_role="housekeeper")
    assert is_incident_visible_to(incident_creator_id="filer", requester_id="gm", requester_role="gm")
    assert not is_incident_visible_to(incident_creator_id="filer", requester_id="other", requester_role="engineer")


class _NullMaybeSingleQuery:
    """Mimics supabase-py: maybe_single().execute() returns None when no row matches."""

    def __init__(self, insert_sink):
        self._insert_sink = insert_sink
        self._action = "select"

    def select(self, *_a, **_k):
        return self

    def insert(self, payload):
        self._action = "insert"
        self._payload = payload
        return self

    def eq(self, *_a, **_k):
        return self

    def contains(self, *_a, **_k):
        return self

    def gte(self, *_a, **_k):
        return self

    def maybe_single(self):
        return self

    def execute(self):
        if self._action == "insert":
            self._insert_sink.append(self._payload)
            return type("R", (), {"data": [{"id": "generated-id", **self._payload}]})()
        # real supabase returns None (not an object) when maybe_single finds nothing
        return None


class _NullSupabase:
    def __init__(self):
        self.inserts = []

    def table(self, _name):
        return _NullMaybeSingleQuery(self.inserts)


def test_safety_notification_queue_handles_absent_prior_notification(monkeypatch):
    """Regression: maybe_single().execute() returns None on no match; must not raise (bug-449)."""
    import routers.internal as internal

    fake = _NullSupabase()
    monkeypatch.setattr(internal, "supabase", fake)

    queued = internal._queue_safety_notification(
        "tenant-1", "user-1", "safety_training_overdue", "Safety training due", "body", {"assignment_id": "a1"}
    )

    assert queued is True
    # one notification + one delivery row inserted
    assert len(fake.inserts) == 2

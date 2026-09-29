"""Recurring Internal Task generation (migration 116): mirrors
test_pm_schedules.py's fake-db pattern to prove the tasks.generate-recurring
cron is idempotent (no duplicate task per cycle), advances next_due_at only
after a real generation, and respects end_type bounds (count/date/never).
"""
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from routers import internal as internal_router
from services import task_schedules as svc


# ---------------------------------------------------------------------------
# compute_next_due_at — pure function
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "interval_type,interval_days,expected",
    [
        ("daily", None, datetime(2026, 1, 2, tzinfo=timezone.utc)),
        ("weekly", None, datetime(2026, 1, 8, tzinfo=timezone.utc)),
        ("monthly", None, datetime(2026, 2, 1, tzinfo=timezone.utc)),
        ("custom", 10, datetime(2026, 1, 11, tzinfo=timezone.utc)),
    ],
)
def test_compute_next_due_at(interval_type, interval_days, expected):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert svc.compute_next_due_at(base, interval_type, interval_days) == expected


# ---------------------------------------------------------------------------
# schedule_has_ended
# ---------------------------------------------------------------------------

def test_schedule_has_ended_never_is_always_false():
    assert svc.schedule_has_ended({"end_type": "never"}) is False


def test_schedule_has_ended_count_reached():
    schedule = {"end_type": "count", "end_count": 3, "occurrences_generated": 3}
    assert svc.schedule_has_ended(schedule) is True
    schedule["occurrences_generated"] = 2
    assert svc.schedule_has_ended(schedule) is False


def test_schedule_has_ended_date_passed():
    schedule = {"end_type": "date", "end_date": "2026-01-01"}
    assert svc.schedule_has_ended(schedule, today=date(2026, 1, 2)) is True
    assert svc.schedule_has_ended(schedule, today=date(2025, 12, 31)) is False


# ---------------------------------------------------------------------------
# Fakes shared by generate_task_from_schedule / check_due_task_schedules tests
# (same shape as test_pm_schedules.py's FakeQuery/FakeDB)
# ---------------------------------------------------------------------------

class FakeQuery:
    def __init__(self, db, table_name):
        self.db = db
        self.table_name = table_name
        self.mode = "select"
        self.payload = None
        self.filters = []
        self.in_filters = []
        self.not_in_filters = []
        self.limit_n = None
        self.single = False
        self._negate_next = False

    def select(self, *_a, **_kw):
        self.mode = "select"
        return self

    def insert(self, payload):
        self.mode = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.mode = "update"
        self.payload = payload
        return self

    def eq(self, column, value):
        self.filters.append(("eq", column, value))
        return self

    def lte(self, column, value):
        self.filters.append(("lte", column, value))
        return self

    def in_(self, column, values):
        if self._negate_next:
            self.not_in_filters.append((column, set(values)))
            self._negate_next = False
        else:
            self.in_filters.append((column, set(values)))
        return self

    @property
    def not_(self):
        self._negate_next = True
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def maybe_single(self):
        self.single = True
        return self

    def _matched(self, rows):
        matched = rows
        for op, column, value in self.filters:
            if op == "eq":
                matched = [r for r in matched if r.get(column) == value]
            elif op == "lte":
                matched = [r for r in matched if (r.get(column) or "") <= value]
        for column, values in self.in_filters:
            matched = [r for r in matched if r.get(column) in values]
        for column, values in self.not_in_filters:
            matched = [r for r in matched if r.get(column) not in values]
        return matched

    def execute(self):
        rows = self.db.rows.setdefault(self.table_name, [])
        if self.mode == "insert":
            new_row = dict(self.payload)
            new_row.setdefault("id", f"{self.table_name}-{len(rows) + 1}")
            new_row.setdefault("status", "open")
            rows.append(new_row)
            return SimpleNamespace(data=[new_row])
        matched = self._matched(rows)
        if self.mode == "update":
            for row in matched:
                row.update(self.payload)
            return SimpleNamespace(data=matched)
        if self.limit_n is not None:
            matched = matched[: self.limit_n]
        if self.single:
            return SimpleNamespace(data=matched[0] if matched else None)
        return SimpleNamespace(data=matched)


class FakeDB:
    def __init__(self, rows=None):
        self.rows = rows or {}

    def table(self, name):
        return FakeQuery(self, name)


def _schedule(**overrides):
    base = {
        "id": "sched-1", "tenant_id": "hotel-1",
        "title": "Deep clean lobby", "description": None,
        "task_type": "housekeeping", "priority": "normal",
        "room_id": None, "location_text": "Lobby", "assigned_to": None,
        "interval_type": "weekly", "interval_days": None,
        "next_due_at": "2026-01-01T00:00:00+00:00",
        "end_type": "never", "end_count": None, "end_date": None,
        "occurrences_generated": 0,
        "is_active": True, "created_by": "gm-1",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# has_open_generated_task
# ---------------------------------------------------------------------------

def test_has_open_generated_task_true_while_open(monkeypatch):
    db = FakeDB({"tasks": [{"id": "task-1", "tenant_id": "hotel-1", "task_schedule_id": "sched-1", "status": "open"}]})
    monkeypatch.setattr(svc, "supabase", db)
    assert svc.has_open_generated_task("sched-1", "hotel-1") is True


def test_has_open_generated_task_false_once_completed(monkeypatch):
    db = FakeDB({"tasks": [{"id": "task-1", "tenant_id": "hotel-1", "task_schedule_id": "sched-1", "status": "completed"}]})
    monkeypatch.setattr(svc, "supabase", db)
    assert svc.has_open_generated_task("sched-1", "hotel-1") is False


# ---------------------------------------------------------------------------
# generate_task_from_schedule — the actual duplicate-generation guard
# ---------------------------------------------------------------------------

def test_generate_creates_task_and_advances_schedule_when_none_open(monkeypatch):
    db = FakeDB({"task_schedules": [_schedule()], "tasks": []})
    monkeypatch.setattr(svc, "supabase", db)

    task = svc.generate_task_from_schedule(db.rows["task_schedules"][0])

    assert task is not None
    assert task["task_schedule_id"] == "sched-1"
    assert task["title"] == "Deep clean lobby"
    assert db.rows["task_schedules"][0]["next_due_at"] == "2026-01-08T00:00:00+00:00"
    assert db.rows["task_schedules"][0]["occurrences_generated"] == 1


def test_generate_skips_when_a_generated_task_is_still_open(monkeypatch):
    db = FakeDB({
        "task_schedules": [_schedule()],
        "tasks": [{"id": "task-existing", "tenant_id": "hotel-1", "task_schedule_id": "sched-1", "status": "open"}],
    })
    monkeypatch.setattr(svc, "supabase", db)

    task = svc.generate_task_from_schedule(db.rows["task_schedules"][0])

    assert task is None
    assert len(db.rows["tasks"]) == 1  # still just the original
    assert db.rows["task_schedules"][0]["next_due_at"] == "2026-01-01T00:00:00+00:00"  # untouched


def test_generate_deactivates_schedule_once_end_count_reached(monkeypatch):
    db = FakeDB({"task_schedules": [_schedule(end_type="count", end_count=1, occurrences_generated=1)], "tasks": []})
    monkeypatch.setattr(svc, "supabase", db)

    task = svc.generate_task_from_schedule(db.rows["task_schedules"][0])

    assert task is None
    assert db.rows["tasks"] == []
    assert db.rows["task_schedules"][0]["is_active"] is False


def test_generate_carries_assignment_through_to_the_task(monkeypatch):
    db = FakeDB({"task_schedules": [_schedule(assigned_to="staff-1")], "tasks": []})
    monkeypatch.setattr(svc, "supabase", db)

    task = svc.generate_task_from_schedule(db.rows["task_schedules"][0])

    assert task["assigned_to"] == "staff-1"
    assert task["assigned_by"] == "gm-1"  # the schedule's creator, stamped at generation


# ---------------------------------------------------------------------------
# check_due_task_schedules cron
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_check_due_task_schedules_creates_and_skips_correctly(monkeypatch):
    db = FakeDB({
        "task_schedules": [
            _schedule(id="sched-due", next_due_at="2020-01-01T00:00:00+00:00"),
            _schedule(id="sched-not-due", next_due_at="2999-01-01T00:00:00+00:00"),
        ],
        "tasks": [],
    })
    monkeypatch.setattr(internal_router, "supabase", db)
    monkeypatch.setattr(svc, "supabase", db)

    response = await internal_router.check_due_task_schedules(x_cron_secret=internal_router.settings.cron_secret)

    assert response["tasks_created"] == 1
    assert response["tasks_skipped"] == 0
    assert len(db.rows["tasks"]) == 1
    assert db.rows["tasks"][0]["task_schedule_id"] == "sched-due"


@pytest.mark.asyncio
async def test_check_due_task_schedules_is_idempotent_across_repeated_runs(monkeypatch):
    """The actual regression this guards against: running the cron twice in a
    row (e.g. after a redeploy) must not create a second task for the same cycle."""
    db = FakeDB({
        "task_schedules": [_schedule(next_due_at="2020-01-01T00:00:00+00:00")],
        "tasks": [],
    })
    monkeypatch.setattr(internal_router, "supabase", db)
    monkeypatch.setattr(svc, "supabase", db)

    first = await internal_router.check_due_task_schedules(x_cron_secret=internal_router.settings.cron_secret)
    assert first["tasks_created"] == 1

    # Second run: the schedule's next_due_at moved into the future by the first
    # run's advance, but even if it were still due, the still-open generated
    # task blocks a second insert.
    db.rows["task_schedules"][0]["next_due_at"] = "2020-01-01T00:00:00+00:00"
    second = await internal_router.check_due_task_schedules(x_cron_secret=internal_router.settings.cron_secret)

    assert second["tasks_created"] == 0
    assert second["tasks_skipped"] == 1
    assert len(db.rows["tasks"]) == 1

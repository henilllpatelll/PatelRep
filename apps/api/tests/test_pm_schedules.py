"""PM schedule advancement: fixes pm.check-due regenerating a duplicate work
order every day for the same overdue schedule (next_due_at was never
advanced), and covers the scheduled-date vs completion-date recurrence bases
added in migration 101.
"""
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from routers import internal as internal_router
from services import pm_schedules as svc


# ---------------------------------------------------------------------------
# compute_next_due_at — pure function
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "interval_type,interval_days,expected",
    [
        ("daily", None, datetime(2026, 1, 2, tzinfo=timezone.utc)),
        ("weekly", None, datetime(2026, 1, 8, tzinfo=timezone.utc)),
        ("monthly", None, datetime(2026, 2, 1, tzinfo=timezone.utc)),
        ("quarterly", None, datetime(2026, 4, 1, tzinfo=timezone.utc)),
        ("annual", None, datetime(2027, 1, 1, tzinfo=timezone.utc)),
        ("custom", 10, datetime(2026, 1, 11, tzinfo=timezone.utc)),
    ],
)
def test_compute_next_due_at(interval_type, interval_days, expected):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert svc.compute_next_due_at(base, interval_type, interval_days) == expected


# ---------------------------------------------------------------------------
# Fakes shared by has_open_pm_work_order / advance_* / check_due_pm tests
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


# ---------------------------------------------------------------------------
# has_open_pm_work_order
# ---------------------------------------------------------------------------

def test_has_open_pm_work_order_true_when_wo_still_open(monkeypatch):
    db = FakeDB({
        "work_orders": [
            {"id": "wo-1", "tenant_id": "hotel-1", "pm_schedule_id": "pm-1", "status": "open"},
        ],
    })
    monkeypatch.setattr(svc, "supabase", db)
    assert svc.has_open_pm_work_order("pm-1", "hotel-1") is True


def test_has_open_pm_work_order_false_once_completed(monkeypatch):
    db = FakeDB({
        "work_orders": [
            {"id": "wo-1", "tenant_id": "hotel-1", "pm_schedule_id": "pm-1", "status": "completed"},
        ],
    })
    monkeypatch.setattr(svc, "supabase", db)
    assert svc.has_open_pm_work_order("pm-1", "hotel-1") is False


# ---------------------------------------------------------------------------
# advance_pm_schedule_on_generate
# ---------------------------------------------------------------------------

def test_advance_on_generate_moves_next_due_at_for_scheduled_date_basis(monkeypatch):
    db = FakeDB({
        "pm_schedules": [
            {
                "id": "pm-1", "tenant_id": "hotel-1",
                "interval_type": "monthly", "interval_days": None,
                "next_due_at": "2026-01-01T00:00:00+00:00",
                "recurrence_basis": "scheduled_date",
            },
        ],
    })
    monkeypatch.setattr(svc, "supabase", db)

    svc.advance_pm_schedule_on_generate(db.rows["pm_schedules"][0])

    assert db.rows["pm_schedules"][0]["next_due_at"] == "2026-02-01T00:00:00+00:00"


def test_advance_on_generate_leaves_next_due_at_for_completion_date_basis(monkeypatch):
    db = FakeDB({
        "pm_schedules": [
            {
                "id": "pm-1", "tenant_id": "hotel-1",
                "interval_type": "monthly", "interval_days": None,
                "next_due_at": "2026-01-01T00:00:00+00:00",
                "recurrence_basis": "completion_date",
            },
        ],
    })
    monkeypatch.setattr(svc, "supabase", db)

    svc.advance_pm_schedule_on_generate(db.rows["pm_schedules"][0])

    assert db.rows["pm_schedules"][0]["next_due_at"] == "2026-01-01T00:00:00+00:00"


# ---------------------------------------------------------------------------
# advance_pm_schedule_on_completion
# ---------------------------------------------------------------------------

def test_advance_on_completion_moves_next_due_at_for_completion_date_basis(monkeypatch):
    db = FakeDB({
        "pm_schedules": [
            {
                "id": "pm-1", "tenant_id": "hotel-1",
                "interval_type": "weekly", "interval_days": None,
                "next_due_at": "2026-01-01T00:00:00+00:00",
                "recurrence_basis": "completion_date",
            },
        ],
    })
    monkeypatch.setattr(svc, "supabase", db)

    svc.advance_pm_schedule_on_completion("pm-1", "hotel-1")

    row = db.rows["pm_schedules"][0]
    assert row["last_completed_at"] is not None
    assert row["next_due_at"] != "2026-01-01T00:00:00+00:00"


def test_advance_on_completion_only_stamps_last_completed_for_scheduled_date_basis(monkeypatch):
    db = FakeDB({
        "pm_schedules": [
            {
                "id": "pm-1", "tenant_id": "hotel-1",
                "interval_type": "weekly", "interval_days": None,
                "next_due_at": "2026-03-01T00:00:00+00:00",
                "recurrence_basis": "scheduled_date",
            },
        ],
    })
    monkeypatch.setattr(svc, "supabase", db)

    svc.advance_pm_schedule_on_completion("pm-1", "hotel-1")

    row = db.rows["pm_schedules"][0]
    assert row["last_completed_at"] is not None
    assert row["next_due_at"] == "2026-03-01T00:00:00+00:00"


# ---------------------------------------------------------------------------
# check_due_pm cron — the actual duplicate-WO bug
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_check_due_pm_creates_wo_and_advances_schedule_when_none_open(monkeypatch):
    db = FakeDB({
        "pm_schedules": [
            {
                "id": "pm-1", "name": "Quarterly HVAC Filter Change", "description": "",
                "interval_type": "monthly", "interval_days": None,
                "next_due_at": "2026-01-01T00:00:00+00:00",
                "recurrence_basis": "scheduled_date",
                "is_active": True,
                "assets": {"tenant_id": "hotel-1", "id": "asset-1", "name": "Rooftop AHU"},
            },
        ],
        "work_orders": [],
        "user_roles": [
            {"tenant_id": "hotel-1", "user_id": "gm-1", "role": "gm", "is_active": True},
        ],
    })
    monkeypatch.setattr(internal_router, "supabase", db)
    monkeypatch.setattr(svc, "supabase", db)

    response = await internal_router.check_due_pm(x_cron_secret=internal_router.settings.cron_secret)

    assert response["pm_work_orders_created"] == 1
    assert response["pm_work_orders_skipped"] == 0
    assert len(db.rows["work_orders"]) == 1
    assert db.rows["work_orders"][0]["pm_schedule_id"] == "pm-1"
    assert db.rows["work_orders"][0]["created_by"] == "gm-1"
    assert db.rows["pm_schedules"][0]["next_due_at"] == "2026-02-01T00:00:00+00:00"


@pytest.mark.asyncio
async def test_check_due_pm_falls_back_to_any_active_staff_when_no_gm(monkeypatch):
    db = FakeDB({
        "pm_schedules": [
            {
                "id": "pm-1", "name": "Boiler Check", "description": "",
                "interval_type": "monthly", "interval_days": None,
                "next_due_at": "2026-01-01T00:00:00+00:00",
                "recurrence_basis": "scheduled_date",
                "is_active": True,
                "assets": {"tenant_id": "hotel-1", "id": "asset-1", "name": "Boiler"},
            },
        ],
        "work_orders": [],
        "user_roles": [
            {"tenant_id": "hotel-1", "user_id": "eng-1", "role": "engineer", "is_active": True},
        ],
    })
    monkeypatch.setattr(internal_router, "supabase", db)
    monkeypatch.setattr(svc, "supabase", db)

    response = await internal_router.check_due_pm(x_cron_secret=internal_router.settings.cron_secret)

    assert response["pm_work_orders_created"] == 1
    assert db.rows["work_orders"][0]["created_by"] == "eng-1"


@pytest.mark.asyncio
async def test_check_due_pm_skips_tenant_with_no_active_staff_at_all(monkeypatch):
    """Was the actual production failure: the old hardcoded all-zeros
    created_by wasn't a real auth.users row, so every PM work-order insert
    hit a foreign-key violation (23503). Now it skips cleanly instead of
    crashing the whole cron run when a tenant genuinely has no active staff."""
    db = FakeDB({
        "pm_schedules": [
            {
                "id": "pm-1", "name": "Boiler Check", "description": "",
                "interval_type": "monthly", "interval_days": None,
                "next_due_at": "2026-01-01T00:00:00+00:00",
                "recurrence_basis": "scheduled_date",
                "is_active": True,
                "assets": {"tenant_id": "hotel-1", "id": "asset-1", "name": "Boiler"},
            },
        ],
        "work_orders": [],
        "user_roles": [],
    })
    monkeypatch.setattr(internal_router, "supabase", db)
    monkeypatch.setattr(svc, "supabase", db)

    response = await internal_router.check_due_pm(x_cron_secret=internal_router.settings.cron_secret)

    assert response["pm_work_orders_created"] == 0
    assert response["pm_work_orders_skipped"] == 1
    assert db.rows["work_orders"] == []


@pytest.mark.asyncio
async def test_check_due_pm_skips_schedule_with_a_still_open_generated_wo(monkeypatch):
    """The actual duplicate-WO regression: a completion_date schedule whose
    generated WO is still open must not get a second WO on the next cron run."""
    db = FakeDB({
        "pm_schedules": [
            {
                "id": "pm-1", "name": "Elevator Inspection", "description": "",
                "interval_type": "monthly", "interval_days": None,
                "next_due_at": "2026-01-01T00:00:00+00:00",
                "recurrence_basis": "completion_date",
                "is_active": True,
                "assets": {"tenant_id": "hotel-1", "id": "asset-1", "name": "Elevator 1"},
            },
        ],
        "work_orders": [
            {"id": "wo-existing", "tenant_id": "hotel-1", "pm_schedule_id": "pm-1", "status": "open"},
        ],
    })
    monkeypatch.setattr(internal_router, "supabase", db)
    monkeypatch.setattr(svc, "supabase", db)

    response = await internal_router.check_due_pm(x_cron_secret=internal_router.settings.cron_secret)

    assert response["pm_work_orders_created"] == 0
    assert response["pm_work_orders_skipped"] == 1
    assert len(db.rows["work_orders"]) == 1  # still just the original
    # completion_date basis: untouched until the WO is actually completed.
    assert db.rows["pm_schedules"][0]["next_due_at"] == "2026-01-01T00:00:00+00:00"

"""Contract tests for GET /work-orders/stats (engineering command-center KPIs).

Proves: status counts, overdue/unassigned/urgent aggregation, completed-today
count, avg-resolution, tenant isolation, archived exclusion, engineer scoping
(own + claimable only), and GM-only cost_this_month visibility. Uses a fake
Supabase query builder in the style of test_work_order_archive.py, extended
with .gte() and count="exact" support.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from middleware.auth import CurrentUser
from routers import work_orders as work_orders_router

_NOW = datetime.now(timezone.utc)
_TODAY_START = _NOW.replace(hour=0, minute=0, second=0, microsecond=0)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


ENGINEER = CurrentUser(user_id="eng-1", hotel_id="hotel-1", role="engineer", email="e@example.com")
GM = CurrentUser(user_id="gm-1", hotel_id="hotel-1", role="gm", email="g@example.com")

OPEN_ID = str(uuid.uuid4())
INPROG_ID = str(uuid.uuid4())
ESC_ID = str(uuid.uuid4())
HOLD_ID = str(uuid.uuid4())
DONE_TODAY_ID = str(uuid.uuid4())
DONE_5D_ID = str(uuid.uuid4())
CANCELLED_ID = str(uuid.uuid4())
ARCHIVED_ID = str(uuid.uuid4())
OTHER_TENANT_ID = str(uuid.uuid4())


class _NotProxy:
    def __init__(self, query):
        self._query = query

    def is_(self, column, _value):
        self._query.filters.append(("not_null", column))
        return self._query


class _StatsQuery:
    def __init__(self, database, table):
        self.database = database
        self.table_name = table
        self.filters: list[tuple] = []
        self._count = False

    def select(self, *_args, count=None, **_kwargs):
        self._count = count == "exact"
        return self

    def eq(self, column, value):
        self.filters.append(("eq", column, value))
        return self

    def in_(self, column, values):
        self.filters.append(("in", column, list(values)))
        return self

    def is_(self, column, _value):
        self.filters.append(("null", column))
        return self

    @property
    def not_(self):
        return _NotProxy(self)

    def gte(self, column, value):
        self.filters.append(("gte", column, value))
        return self

    def _matches(self):
        matched = []
        for row in self.database.tables.get(self.table_name, []):
            ok = True
            for f in self.filters:
                kind = f[0]
                if kind == "eq" and row.get(f[1]) != f[2]:
                    ok = False
                elif kind == "in" and row.get(f[1]) not in f[2]:
                    ok = False
                elif kind == "null" and row.get(f[1]) is not None:
                    ok = False
                elif kind == "not_null" and row.get(f[1]) is None:
                    ok = False
                elif kind == "gte":
                    val = row.get(f[1])
                    if val is None or val < f[2]:
                        ok = False
                if not ok:
                    break
            if ok:
                matched.append(row)
        return matched

    def execute(self):
        matched = self._matches()
        return type("Result", (), {"data": matched, "count": len(matched)})()


class _StatsDatabase:
    def __init__(self):
        self.tables = {
            "work_orders": [
                {"id": OPEN_ID, "tenant_id": "hotel-1", "status": "open", "priority": "urgent",
                 "assigned_to": None, "due_at": _iso(_NOW + timedelta(hours=2)), "archived_at": None},
                {"id": INPROG_ID, "tenant_id": "hotel-1", "status": "in_progress", "priority": "normal",
                 "assigned_to": "eng-1", "due_at": _iso(_NOW - timedelta(hours=1)), "archived_at": None},
                {"id": ESC_ID, "tenant_id": "hotel-1", "status": "escalated", "priority": "emergency",
                 "assigned_to": "eng-2", "due_at": _iso(_NOW - timedelta(hours=3)), "archived_at": None},
                {"id": HOLD_ID, "tenant_id": "hotel-1", "status": "on_hold", "priority": "low",
                 "assigned_to": "eng-1", "due_at": _iso(_NOW + timedelta(hours=5)), "archived_at": None},
                {"id": DONE_TODAY_ID, "tenant_id": "hotel-1", "status": "completed", "priority": "normal",
                 "assigned_to": "eng-1", "due_at": None, "archived_at": None,
                 "started_at": _iso(_NOW - timedelta(hours=2)), "completed_at": _iso(_NOW),
                 "total_cost": 100},
                {"id": DONE_5D_ID, "tenant_id": "hotel-1", "status": "completed", "priority": "normal",
                 "assigned_to": "eng-1", "due_at": None, "archived_at": None,
                 "started_at": _iso(_NOW - timedelta(days=5, hours=1)),
                 "completed_at": _iso(_NOW - timedelta(days=5)), "total_cost": None},
                {"id": CANCELLED_ID, "tenant_id": "hotel-1", "status": "cancelled", "priority": "normal",
                 "assigned_to": "eng-1", "due_at": None, "archived_at": None},
                {"id": ARCHIVED_ID, "tenant_id": "hotel-1", "status": "open", "priority": "urgent",
                 "assigned_to": None, "due_at": _iso(_NOW - timedelta(hours=1)),
                 "archived_at": _iso(_NOW - timedelta(days=1))},
                {"id": OTHER_TENANT_ID, "tenant_id": "hotel-2", "status": "open", "priority": "urgent",
                 "assigned_to": None, "due_at": _iso(_NOW - timedelta(hours=1)), "archived_at": None},
            ]
        }

    def table(self, table_name):
        return _StatsQuery(self, table_name)


@pytest.mark.asyncio
async def test_gm_stats_aggregate_across_tenant_excluding_archived(monkeypatch):
    monkeypatch.setattr(work_orders_router, "supabase", _StatsDatabase())

    stats = (await work_orders_router.work_order_stats(GM))["data"]

    assert stats["open"] == 1  # ARCHIVED open row excluded
    assert stats["escalated"] == 1
    assert stats["in_progress"] == 1
    assert stats["on_hold"] == 1
    assert stats["overdue"] == 2  # in_progress + escalated past due (archived excluded)
    assert stats["unassigned"] == 1
    assert stats["urgent"] == 2  # open(urgent) + escalated(emergency)
    assert stats["completed_today"] == 1
    assert stats["avg_resolution_minutes"] == 90  # (120 + 60) / 2
    assert stats["cost_this_month"] == 100.0  # only DONE_TODAY has a cost


@pytest.mark.asyncio
async def test_engineer_stats_scoped_to_own_plus_claimable_and_no_cost(monkeypatch):
    monkeypatch.setattr(work_orders_router, "supabase", _StatsDatabase())

    stats = (await work_orders_router.work_order_stats(ENGINEER))["data"]

    assert stats["open"] == 1  # claimable unassigned open
    assert stats["escalated"] == 0  # ESC assigned to eng-2, not visible
    assert stats["in_progress"] == 1
    assert stats["on_hold"] == 1
    assert stats["overdue"] == 1  # only their own in_progress
    assert stats["urgent"] == 1  # only the claimable open urgent
    assert stats["completed_today"] == 1
    assert stats["cost_this_month"] is None  # GM-only

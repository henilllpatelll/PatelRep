"""Enrichment coverage for generate_shift_summary (Phase 39-02): VIP arrivals,
pending guest issues, low-stock engineering parts, and SLA breaches feed the
prompt and four additive `stats` count keys. The anthropic client is stubbed so
no real API call is made.
"""
from types import SimpleNamespace

import pytest

from services.ai import shift_summary as shift_summary_module

HOTEL = "hotel-1"
SHIFT = "shift-1"
SHIFT_DATE = "2026-09-16"
NOW_ISO = "2026-09-16T12:00:00+00:00"
PAST = "2026-09-16T06:00:00+00:00"
FUTURE = "2026-09-16T23:00:00+00:00"


class _NotBuilder:
    def __init__(self, query):
        self._query = query

    def in_(self, column, values):
        self._query.not_in_filters.append((column, set(values)))
        return self._query


class FakeQuery:
    def __init__(self, db, table_name):
        self.db = db
        self.table_name = table_name
        self.mode = "select"
        self.payload = None
        self.filters = []
        self.in_filters = []
        self.not_in_filters = []
        self.gte_filters = []
        self.lte_filters = []
        self.lt_filters = []
        self.order_col = None
        self.single = False

    def select(self, *_a, **_kw):
        self.mode = "select"
        return self

    def insert(self, payload):
        self.mode = "insert"
        self.payload = payload
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def in_(self, column, values):
        self.in_filters.append((column, set(values)))
        return self

    @property
    def not_(self):
        return _NotBuilder(self)

    def gte(self, column, value):
        self.gte_filters.append((column, value))
        return self

    def lte(self, column, value):
        self.lte_filters.append((column, value))
        return self

    def lt(self, column, value):
        self.lt_filters.append((column, value))
        return self

    def order(self, column, desc=False):
        self.order_col = column
        return self

    def maybe_single(self):
        self.single = True
        return self

    def _matched(self, rows):
        matched = rows
        for column, value in self.filters:
            matched = [r for r in matched if r.get(column) == value]
        for column, values in self.in_filters:
            matched = [r for r in matched if r.get(column) in values]
        for column, values in self.not_in_filters:
            matched = [r for r in matched if r.get(column) not in values]
        for column, value in self.gte_filters:
            matched = [r for r in matched if r.get(column) is not None and r.get(column) >= value]
        for column, value in self.lte_filters:
            matched = [r for r in matched if r.get(column) is not None and r.get(column) <= value]
        for column, value in self.lt_filters:
            matched = [r for r in matched if r.get(column) is not None and r.get(column) < value]
        return matched

    def execute(self):
        rows = self.db.rows.setdefault(self.table_name, [])
        if self.mode == "insert":
            self.db.inserts.setdefault(self.table_name, []).append(self.payload)
            new_row = dict(self.payload)
            new_row.setdefault("id", f"{self.table_name}-{len(rows) + 1}")
            rows.append(new_row)
            return SimpleNamespace(data=[new_row])
        matched = self._matched(rows)
        if self.order_col:
            matched = sorted(matched, key=lambda r: r.get(self.order_col) or "")
        if self.single:
            return SimpleNamespace(data=matched[0] if matched else None)
        return SimpleNamespace(data=matched)


class FakeDB:
    def __init__(self, rows=None):
        self.rows = rows or {}
        self.inserts = {}

    def table(self, name):
        return FakeQuery(self, name)


class _FakeMessages:
    def create(self, **_kw):
        return SimpleNamespace(content=[SimpleNamespace(text="AI summary text.")])


class _FakeAnthropic:
    def __init__(self, *_a, **_kw):
        self.messages = _FakeMessages()


class _FixedNow:
    def isoformat(self):
        return NOW_ISO


class _FakeDatetime:
    @staticmethod
    def now(_tz=None):
        return _FixedNow()


def _patch(monkeypatch, db):
    monkeypatch.setattr(shift_summary_module, "supabase", db)
    monkeypatch.setattr(shift_summary_module, "datetime", _FakeDatetime)
    monkeypatch.setattr(shift_summary_module.anthropic, "Anthropic", _FakeAnthropic)


def _seed():
    return {
        "shifts": [
            {"id": SHIFT, "name": "Night", "start_time": "23:00", "end_time": "07:00",
             "department_id": None, "departments": None}
        ],
        "logbook_entries": [
            {"tenant_id": HOTEL, "shift_id": SHIFT, "content": "Quiet night", "created_at": PAST}
        ],
        "room_status": [
            {"tenant_id": HOTEL, "clean_type": "DEP", "vip_flag": True, "rooms": {"room_number": "101"}},
            {"tenant_id": HOTEL, "clean_type": "DEP", "vip_flag": True, "rooms": {"room_number": "102"}},
            {"tenant_id": HOTEL, "clean_type": "DEP", "vip_flag": False, "rooms": {"room_number": "103"}},
            {"tenant_id": HOTEL, "clean_type": "STAY", "vip_flag": True, "rooms": {"room_number": "104"}},
            {"tenant_id": "hotel-2", "clean_type": "DEP", "vip_flag": True, "rooms": {"room_number": "999"}},
        ],
        "guest_requests": [
            {"tenant_id": HOTEL, "status": "new", "title": "Extra towels"},
            {"tenant_id": HOTEL, "status": "in_progress", "title": "AC not cooling"},
            {"tenant_id": HOTEL, "status": "open", "title": "Late checkout"},
            {"tenant_id": HOTEL, "status": "resolved", "title": "Done thing"},
            {"tenant_id": HOTEL, "status": "verified", "title": "Verified thing"},
            {"tenant_id": HOTEL, "status": "cancelled", "title": "Cancelled thing"},
        ],
        "engineering_parts": [
            {"id": "part-1", "tenant_id": HOTEL, "name": "HVAC Filter", "minimum_stock": 10, "is_active": True},
            {"id": "part-2", "tenant_id": HOTEL, "name": "Fan Belt", "minimum_stock": 8, "is_active": True},
            {"id": "part-3", "tenant_id": HOTEL, "name": "Light Bulb", "minimum_stock": 5, "is_active": True},
            {"id": "part-4", "tenant_id": HOTEL, "name": "Screws", "minimum_stock": None, "is_active": True},
            {"id": "part-5", "tenant_id": HOTEL, "name": "Retired Pump", "minimum_stock": 99, "is_active": False},
        ],
        "engineering_part_stock": [
            {"tenant_id": HOTEL, "part_id": "part-1", "quantity": 3},
            {"tenant_id": HOTEL, "part_id": "part-2", "quantity": 1},
            {"tenant_id": HOTEL, "part_id": "part-3", "quantity": 10},
            {"tenant_id": HOTEL, "part_id": "part-4", "quantity": 0},
        ],
        "work_orders": [
            {"tenant_id": HOTEL, "title": "Overdue WO", "status": "open", "priority": "high",
             "category": "hvac", "due_at": PAST},
            {"tenant_id": HOTEL, "title": "Future WO", "status": "open", "priority": "low",
             "category": "plumbing", "due_at": FUTURE},
            {"tenant_id": HOTEL, "title": "Completed WO", "status": "completed", "priority": "low",
             "category": "elec", "due_at": PAST},
        ],
        "tasks": [
            {"tenant_id": HOTEL, "title": "Cleaned lobby", "status": "completed", "priority": "normal",
             "task_type": "cleaning", "completed_at": f"{SHIFT_DATE}T05:00:00", "due_at": None},
            {"tenant_id": HOTEL, "title": "Overdue task", "status": "in_progress", "priority": "high",
             "task_type": "maintenance", "completed_at": None, "due_at": PAST},
            {"tenant_id": HOTEL, "title": "Future task", "status": "open", "priority": "low",
             "task_type": "maintenance", "completed_at": None, "due_at": FUTURE},
        ],
    }


def _run(monkeypatch, db):
    _patch(monkeypatch, db)
    shift_summary_module.generate_shift_summary(HOTEL, SHIFT, SHIFT_DATE)
    return db.inserts["shift_summaries"][0]["stats"]


def test_all_four_signals_counted():
    db = FakeDB(_seed())
    with pytest.MonkeyPatch().context() as mp:
        stats = _run(mp, db)
    assert stats["vip_arrivals_count"] == 2
    assert stats["pending_guest_issues_count"] == 3
    assert stats["low_stock_parts_count"] == 2
    assert stats["sla_breaches_count"] == 2


def test_terminal_guest_requests_excluded():
    db = FakeDB(_seed())
    with pytest.MonkeyPatch().context() as mp:
        stats = _run(mp, db)
    # 3 non-terminal (new/in_progress/open); resolved/verified/cancelled excluded
    assert stats["pending_guest_issues_count"] == 3


def test_low_stock_predicate_boundaries():
    db = FakeDB(_seed())
    with pytest.MonkeyPatch().context() as mp:
        stats = _run(mp, db)
    # part-1 (3<10) and part-2 (1<8) low; part-3 (10>=5) not; part-4 (0<0 false, null->0) not;
    # part-5 inactive excluded from the active-parts query entirely.
    assert stats["low_stock_parts_count"] == 2


def test_sla_breach_predicate_excludes_future_and_non_open():
    db = FakeDB(_seed())
    with pytest.MonkeyPatch().context() as mp:
        stats = _run(mp, db)
    # 1 overdue open WO + 1 overdue in_progress task; future + completed excluded
    assert stats["sla_breaches_count"] == 2


def test_existing_stats_keys_unchanged_and_additive():
    db = FakeDB(_seed())
    with pytest.MonkeyPatch().context() as mp:
        stats = _run(mp, db)
    assert stats["tasks_completed"] == 1
    assert stats["open_work_orders"] == 2  # both open WOs (overdue + future), not the completed one
    assert stats["logbook_entries_count"] == 1
    assert stats["model_used"] == "claude-sonnet-4-6"
    # additive keys present alongside originals
    for key in ("vip_arrivals_count", "pending_guest_issues_count",
                "low_stock_parts_count", "sla_breaches_count"):
        assert key in stats


def test_full_count_stored_when_list_exceeds_cap():
    seed = _seed()
    seed["guest_requests"] = [
        {"tenant_id": HOTEL, "status": "new", "title": f"Issue {i}"} for i in range(12)
    ]
    db = FakeDB(seed)
    with pytest.MonkeyPatch().context() as mp:
        stats = _run(mp, db)
    # 12 seeded — stored count is the full length even though the prompt caps at 10
    assert stats["pending_guest_issues_count"] == 12

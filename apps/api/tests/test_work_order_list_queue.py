"""Contract tests for GET /work-orders as the engineering mobile queue uses it.

An in-memory query builder that really evaluates filters, ordering and ranges
stands in for Supabase, so these prove behaviour (who sees what, how pages and
priority order work), not just that a call was made.
"""

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from middleware.auth import CurrentUser, get_current_user
from routers import work_orders as work_orders_router

TENANT = "hotel-1"
ME = "eng-me"
OTHER = "eng-other"
_BASE = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


def _iso(minutes: int) -> str:
    return (_BASE + timedelta(minutes=minutes)).isoformat()


def _wo(n: int, **over) -> dict:
    row = {
        "id": f"wo-{n:04d}",
        "tenant_id": TENANT,
        "work_order_number": n,
        "title": f"Job {n}",
        "description": None,
        "location_text": None,
        "status": "open",
        "priority": "normal",
        "category": "general",
        "assigned_to": None,
        "room_id": None,
        "asset_id": None,
        "due_at": None,
        "created_at": _iso(n),
        "updated_at": _iso(n),
        "archived_at": None,
    }
    row.update(over)
    return row


class _Not:
    def __init__(self, query):
        self.q = query

    def is_(self, column, value):
        self.q.filters.append(lambda r: (r.get(column) is None) != (value == "null"))
        return self.q


class _Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters, self.orders = [], []
        self.window = None
        self.max_rows = None

    @property
    def not_(self):
        return _Not(self)

    def select(self, *_a, **_k):
        return self

    def eq(self, column, value):
        self.filters.append(lambda r: r.get(column) == value)
        return self

    def neq(self, column, value):
        self.filters.append(lambda r: r.get(column) != value)
        return self

    def in_(self, column, values):
        values = list(values)
        self.filters.append(lambda r: r.get(column) in values or str(r.get(column)) in values)
        return self

    def is_(self, column, value):
        self.filters.append(lambda r: (r.get(column) is None) == (value == "null"))
        return self

    def lt(self, column, value):
        self.filters.append(lambda r: r.get(column) is not None and r[column] < value)
        return self

    def gte(self, column, value):
        self.filters.append(lambda r: r.get(column) is not None and r[column] >= value)
        return self

    def ilike(self, column, pattern):
        needle = pattern.strip("%").lower()
        self.filters.append(lambda r: needle in str(r.get(column) or "").lower())
        return self

    def or_(self, expression):
        clauses, depth, current = [], 0, ""
        for ch in expression:
            depth += ch == "("
            depth -= ch == ")"
            if ch == "," and depth == 0:
                clauses.append(current)
                current = ""
            else:
                current += ch
        clauses.append(current)

        def matches(row, clause):
            column, op, value = clause.split(".", 2)
            if op == "ilike":
                return value.strip("%").lower() in str(row.get(column) or "").lower()
            if op == "eq":
                return str(row.get(column)) == value
            if op == "in":
                return str(row.get(column)) in value.strip("()").split(",")
            raise AssertionError(f"unsupported or_ clause {clause}")

        self.filters.append(lambda r: any(matches(r, c) for c in clauses))
        return self

    def order(self, column, desc=False, nullsfirst=None, **_k):
        self.orders.append((column, desc))
        return self

    def range(self, start, end):
        self.window = (start, end)
        return self

    def limit(self, n):
        self.max_rows = n
        return self

    def execute(self):
        self.db.calls.append(self)
        rows = [dict(r) for r in self.db.tables.get(self.table, []) if all(f(r) for f in self.filters)]
        for column, desc in reversed(self.orders):
            present = [r for r in rows if r.get(column) is not None]
            missing = [r for r in rows if r.get(column) is None]
            present.sort(key=lambda r: r[column], reverse=desc)
            rows = present + missing
        if self.window:
            rows = rows[self.window[0] : self.window[1] + 1]
        if self.max_rows is not None:
            rows = rows[: self.max_rows]
        return type("Result", (), {"data": rows})()


class _Db:
    def __init__(self, **tables):
        self.tables = tables
        self.calls = []

    def table(self, name):
        return _Query(self, name)


def _client(monkeypatch, db, role="engineer", user_id=ME):
    monkeypatch.setattr(work_orders_router, "supabase", db)
    app = FastAPI()
    app.include_router(work_orders_router.router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id=user_id, hotel_id=TENANT, role=role, email="x@example.com"
    )
    return TestClient(app)


def _ids(response):
    assert response.status_code == 200, response.text
    return [r["id"] for r in response.json()["data"]]


def test_engineer_sees_only_mine_and_unassigned_never_colleagues(monkeypatch):
    db = _Db(
        work_orders=[
            _wo(1, assigned_to=ME, status="in_progress"),
            _wo(2),
            _wo(3, assigned_to=OTHER, status="in_progress"),
        ]
    )
    client = _client(monkeypatch, db)
    assert sorted(_ids(client.get("/work-orders", params={"per_page": 50}))) == ["wo-0001", "wo-0002"]
    # Asking for colleagues' work as an engineer returns nothing rather than leaking it.
    assert _ids(client.get("/work-orders", params={"assigned_to_others": True})) == []
    assert _ids(client.get("/work-orders", params={"assigned_to": OTHER})) == ["wo-0002", "wo-0001"]


def test_engineer_mine_and_unassigned_flags_pick_one_side(monkeypatch):
    db = _Db(work_orders=[_wo(1, assigned_to=ME, status="in_progress"), _wo(2), _wo(3, assigned_to=OTHER)])
    client = _client(monkeypatch, db)
    assert _ids(client.get("/work-orders", params={"mine": True})) == ["wo-0001"]
    assert _ids(client.get("/work-orders", params={"unassigned": True})) == ["wo-0002"]


def test_chief_engineer_team_view_excludes_self_and_unassigned(monkeypatch):
    db = _Db(
        work_orders=[
            _wo(1, assigned_to=ME, status="in_progress"),
            _wo(2),
            _wo(3, assigned_to=OTHER, status="in_progress"),
        ]
    )
    client = _client(monkeypatch, db, role="chief_engineer", user_id=ME)
    assert _ids(client.get("/work-orders", params={"assigned_to_others": True})) == ["wo-0003"]


def test_statuses_filter_accepts_a_list_and_rejects_unknown_values(monkeypatch):
    db = _Db(
        work_orders=[
            _wo(1, status="open"),
            _wo(2, status="on_hold"),
            _wo(3, status="completed"),
            _wo(4, status="cancelled"),
        ]
    )
    client = _client(monkeypatch, db, role="gm")
    assert sorted(_ids(client.get("/work-orders", params={"statuses": "open,on_hold"}))) == ["wo-0001", "wo-0002"]
    assert client.get("/work-orders", params={"statuses": "open,bogus"}).status_code == 422


def test_category_filter_accepts_doors_locks_and_painting(monkeypatch):
    db = _Db(work_orders=[_wo(1, category="doors_locks"), _wo(2, category="painting"), _wo(3)])
    client = _client(monkeypatch, db, role="gm")
    assert _ids(client.get("/work-orders", params={"category": "doors_locks"})) == ["wo-0001"]
    assert _ids(client.get("/work-orders", params={"category": "painting"})) == ["wo-0002"]


def test_pagination_past_100_has_no_gaps_or_duplicates_and_reports_has_more(monkeypatch):
    db = _Db(work_orders=[_wo(n) for n in range(1, 251)])
    client = _client(monkeypatch, db, role="gm")
    seen, page, has_more = [], 1, True
    while has_more:
        body = client.get("/work-orders", params={"page": page, "per_page": 100}).json()
        seen += [r["id"] for r in body["data"]]
        has_more = body["meta"]["has_more"]
        page += 1
    assert len(seen) == 250 and len(set(seen)) == 250
    assert page == 4  # 100 + 100 + 50, last page reports has_more False


def test_engineer_merged_pagination_is_consistent_across_pages(monkeypatch):
    rows = [_wo(n, assigned_to=ME if n % 2 else None) for n in range(1, 41)]
    client = _client(monkeypatch, _Db(work_orders=rows))
    first = client.get("/work-orders", params={"per_page": 15, "page": 1}).json()
    second = client.get("/work-orders", params={"per_page": 15, "page": 2}).json()
    third = client.get("/work-orders", params={"per_page": 15, "page": 3}).json()
    ids = [r["id"] for body in (first, second, third) for r in body["data"]]
    assert len(ids) == len(set(ids)) == 40
    assert [first["meta"]["has_more"], second["meta"]["has_more"], third["meta"]["has_more"]] == [True, True, False]


def test_priority_sort_orders_emergency_urgent_normal_low_across_pages(monkeypatch):
    db = _Db(
        work_orders=[
            _wo(1, priority="low"),
            _wo(2, priority="normal"),
            _wo(3, priority="urgent"),
            _wo(4, priority="emergency"),
            _wo(5, priority="urgent", due_at=_iso(-30)),
            _wo(6, priority="emergency", due_at=_iso(60)),
        ]
    )
    client = _client(monkeypatch, db, role="gm")
    full = _ids(client.get("/work-orders", params={"sort_by": "priority", "per_page": 50}))
    # Emergency first (due soonest first, undated last), then urgent, normal, low.
    assert full == ["wo-0006", "wo-0004", "wo-0005", "wo-0003", "wo-0002", "wo-0001"]
    paged = []
    for page in (1, 2, 3):
        paged += _ids(client.get("/work-orders", params={"sort_by": "priority", "per_page": 2, "page": page}))
    assert paged == full


def test_search_matches_room_number_wo_number_title_and_asset(monkeypatch):
    db = _Db(
        work_orders=[
            _wo(1042, title="AC not cooling", room_id="room-312"),
            _wo(7, title="Leaking tap", location_text="Pool deck"),
            _wo(9, title="Noisy unit", asset_id="asset-1"),
        ],
        rooms=[{"id": "room-312", "tenant_id": TENANT, "room_number": "312", "floor": 3}],
        assets=[{"id": "asset-1", "tenant_id": TENANT, "name": "Walk-in cooler"}],
    )
    client = _client(monkeypatch, db, role="gm")
    assert _ids(client.get("/work-orders", params={"q": "312"})) == ["wo-1042"]
    assert _ids(client.get("/work-orders", params={"q": "WO-1042"})) == ["wo-1042"]
    assert _ids(client.get("/work-orders", params={"q": "leaking"})) == ["wo-0007"]
    assert _ids(client.get("/work-orders", params={"q": "pool"})) == ["wo-0007"]
    assert _ids(client.get("/work-orders", params={"q": "walk-in"})) == ["wo-0009"]
    # PostgREST syntax characters in user input cannot break the filter.
    assert client.get("/work-orders", params={"q": "a),b(("}).status_code == 200


def test_floor_filter_resolves_rooms_and_empty_floor_returns_nothing(monkeypatch):
    db = _Db(
        work_orders=[_wo(1, room_id="r3"), _wo(2, room_id="r4")],
        rooms=[
            {"id": "r3", "tenant_id": TENANT, "room_number": "301", "floor": 3},
            {"id": "r4", "tenant_id": TENANT, "room_number": "401", "floor": 4},
        ],
    )
    client = _client(monkeypatch, db, role="gm")
    assert _ids(client.get("/work-orders", params={"floor": 3})) == ["wo-0001"]
    assert _ids(client.get("/work-orders", params={"floor": 9})) == []


def test_due_window_and_created_after_filters(monkeypatch):
    db = _Db(
        work_orders=[
            _wo(1, due_at=_iso(10)),
            _wo(2, due_at=_iso(500)),
            _wo(3),
        ]
    )
    client = _client(monkeypatch, db, role="gm")
    window = {"due_from": _iso(0), "due_to": _iso(100)}
    assert _ids(client.get("/work-orders", params=window)) == ["wo-0001"]
    assert sorted(_ids(client.get("/work-orders", params={"created_after": _iso(2)}))) == ["wo-0002", "wo-0003"]
    assert sorted(_ids(client.get("/work-orders", params={"updated_after": _iso(2)}))) == ["wo-0002", "wo-0003"]


def test_held_orders_carry_the_recorded_reason_and_assignee_name(monkeypatch):
    db = _Db(
        work_orders=[_wo(1, status="on_hold", assigned_to=OTHER), _wo(2, status="on_hold")],
        user_profiles=[{"id": OTHER, "tenant_id": TENANT, "full_name": "Sam Ortiz", "preferred_name": None}],
        operational_audit_events=[
            {
                "tenant_id": TENANT,
                "resource_type": "work_order",
                "resource_id": "wo-0001",
                "action": "work_order.transitioned",
                "new_state": {"status": "on_hold"},
                "reason_code": "awaiting_parts",
                "reason_note": "Compressor on order",
                "created_at": _iso(5),
            }
        ],
    )
    client = _client(monkeypatch, db, role="gm")
    rows = {r["id"]: r for r in client.get("/work-orders", params={"status": "on_hold"}).json()["data"]}
    assert rows["wo-0001"]["hold_reason_code"] == "awaiting_parts"
    assert rows["wo-0001"]["held_since"] == _iso(5)
    assert rows["wo-0001"]["assigned_to_name"] == "Sam Ortiz"
    # No audit row recorded: the field is absent, never guessed.
    assert "hold_reason_code" not in rows["wo-0002"]


def test_enrichment_failure_does_not_fail_the_queue(monkeypatch):
    db = _Db(work_orders=[_wo(1, status="on_hold", assigned_to=OTHER)])
    original = db.table

    def flaky(name):
        if name in ("user_profiles", "operational_audit_events"):
            raise RuntimeError("boom")
        return original(name)

    db.table = flaky
    client = _client(monkeypatch, db, role="gm")
    body = client.get("/work-orders").json()
    assert [r["id"] for r in body["data"]] == ["wo-0001"]
    assert "hold_reason_code" not in body["data"][0]


def test_archived_orders_stay_out_of_the_default_list(monkeypatch):
    db = _Db(work_orders=[_wo(1), _wo(2, archived_at=_iso(1))])
    client = _client(monkeypatch, db, role="gm")
    assert _ids(client.get("/work-orders")) == ["wo-0001"]

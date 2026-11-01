"""GET /engineering/team/* - the chief engineer's server-computed team view.

Plain counts from real rows: no shift or presence data exists, so none is invented.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middleware.auth import CurrentUser, get_current_user
from routers import engineering_team as team_router
from routers import work_orders as wo_router
from tests.smoke.fake_supabase import FakeDB

H1, H2 = "hotel-1", "hotel-2"
NOW = datetime.now(timezone.utc)
ALEX, BEA, IDLE = "eng-alex", "eng-bea", "eng-idle"


def _t(hours):
    return (NOW + timedelta(hours=hours)).isoformat()


def _wo(n, tenant=H1, **over):
    row = {"id": f"wo-{n}", "tenant_id": tenant, "work_order_number": n, "title": f"Job {n}", "priority": "normal",
           "status": "open", "assigned_to": None, "due_at": _t(5), "room_id": None, "archived_at": None}
    row.update(over)
    return row


def _db(orders, **extra):
    rows = {
        "work_orders": orders,
        "user_roles": [
            {"tenant_id": H1, "user_id": ALEX, "role": "engineer", "is_active": True},
            {"tenant_id": H1, "user_id": BEA, "role": "engineer", "is_active": True},
            {"tenant_id": H1, "user_id": IDLE, "role": "engineer", "is_active": True},
            {"tenant_id": H1, "user_id": "chief", "role": "chief_engineer", "is_active": True},
            {"tenant_id": H1, "user_id": "gone", "role": "engineer", "is_active": False},
            {"tenant_id": H2, "user_id": "other-hotel-eng", "role": "engineer", "is_active": True},
        ],
        "user_profiles": [
            {"id": ALEX, "tenant_id": H1, "full_name": "Alex Moreno", "preferred_name": "Alex M."},
            {"id": BEA, "tenant_id": H1, "full_name": "Bea Chen", "preferred_name": None},
            {"id": IDLE, "tenant_id": H1, "full_name": "Ida Lee", "preferred_name": None},
        ],
        "tenants": [{"id": H1, "timezone": "America/Chicago"}],
        "pm_schedules": [], "room_unavailability_periods": [], "operational_audit_events": [],
    }
    rows.update(extra)
    return FakeDB(rows)


def _client(monkeypatch, db, role="chief_engineer", hotel=H1):
    for module in (team_router, wo_router):
        monkeypatch.setattr(module, "supabase", db)
    app = FastAPI()
    app.include_router(team_router.router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id="chief", hotel_id=hotel, role=role, email="c@h.com")
    return TestClient(app)


def test_summary_counts_are_exact(monkeypatch):
    orders = [
        _wo(1, status="open", priority="emergency"),                               # emergency + unassigned
        _wo(2, status="in_progress", assigned_to=ALEX, priority="urgent", due_at=_t(-2)),  # overdue urgent
        _wo(3, status="on_hold", assigned_to=ALEX, due_at=_t(-9)),                # held: never "overdue"
        _wo(4, status="open", assigned_to=BEA),
        _wo(5, status="completed", assigned_to=BEA),                               # closed: not counted
        _wo(6, status="open", archived_at=_t(-1)),                                 # archived: not counted
        _wo(7, tenant=H2, status="open"),                                          # other hotel: not counted
    ]
    data = _client(monkeypatch, _db(orders)).get("/engineering/team/overview").json()["data"]
    assert data["counts"] == {"open": 4, "overdue": 1, "on_hold": 1, "emergency": 1, "unassigned": 1, "needs_owner": 1, "in_progress": 1, "pm_overdue": 0}
    assert data["truncated"] is False


def test_queue_counts_match_the_work_tab_views(monkeypatch):
    orders = [
        _wo(1, status="open"),                                   # Available
        _wo(2, status="escalated"),                              # Available
        _wo(3, status="on_hold"),                                # unassigned but held: Waiting, not Available
        _wo(4, status="in_progress", assigned_to=ALEX),          # In progress
        _wo(5, status="open", assigned_to=BEA),                  # assigned, not started
        _wo(6, status="open", tenant=H2),                        # other hotel
    ]
    counts = _client(monkeypatch, _db(orders)).get("/engineering/team/overview").json()["data"]["counts"]
    assert (counts["needs_owner"], counts["in_progress"], counts["unassigned"], counts["on_hold"]) == (2, 1, 3, 1)


def test_engineer_cannot_read_team_counts(monkeypatch):
    assert _client(monkeypatch, _db([_wo(1)]), role="engineer").get("/engineering/team/overview").status_code == 403


def test_technician_workload_is_plain_counts_and_includes_people_with_no_work(monkeypatch):
    orders = [
        _wo(1, status="in_progress", assigned_to=ALEX, priority="emergency"),
        _wo(2, status="open", assigned_to=ALEX, priority="urgent", due_at=_t(-1)),
        _wo(3, status="open", assigned_to=ALEX),
        _wo(4, status="on_hold", assigned_to=ALEX),
        _wo(5, status="open", assigned_to=BEA),
    ]
    techs = {t["user_id"]: t for t in _client(monkeypatch, _db(orders)).get("/engineering/team/overview").json()["data"]["technicians"]}
    assert set(techs) == {ALEX, BEA, IDLE}  # not the chief, not the deactivated engineer, not another hotel
    assert (techs[ALEX]["active"], techs[ALEX]["urgent"], techs[ALEX]["on_hold"], techs[ALEX]["overdue"]) == (3, 2, 1, 1)
    assert techs[IDLE] == {"user_id": IDLE, "name": "Ida Lee", "active": 0, "urgent": 0, "on_hold": 0, "overdue": 0}
    assert techs[ALEX]["name"] == "Alex M." and techs[BEA]["name"] == "Bea Chen"
    assert not any(key in techs[IDLE] for key in ("available", "clocked_in", "on_break", "online"))


def test_needs_attention_is_ranked_and_carries_the_hold_reason(monkeypatch):
    orders = [
        _wo(1, status="on_hold", assigned_to=ALEX),
        _wo(2, status="escalated", assigned_to=BEA),
        _wo(3, status="in_progress", assigned_to=ALEX, priority="urgent", due_at=_t(-3)),
        _wo(4, status="open", priority="emergency"),
        _wo(5, status="open", assigned_to=BEA),  # nothing wrong
    ]
    audit = [{"tenant_id": H1, "resource_type": "work_order", "resource_id": "wo-1", "action": "work_order.transitioned",
              "new_state": {"status": "on_hold"}, "reason_code": "awaiting_parts", "reason_note": "Compressor on order",
              "created_at": _t(-4)}]
    data = _client(monkeypatch, _db(orders, operational_audit_events=audit)).get("/engineering/team/overview").json()["data"]
    assert [i["kind"] for i in data["needs_attention"]] == ["emergency_unassigned", "urgent_overdue", "escalated", "on_hold"]
    held = data["needs_attention"][-1]
    assert (held["hold_reason_code"], held["hold_reason_note"], held["assigned_to_name"]) == ("awaiting_parts", "Compressor on order", "Alex M.")
    assert data["attention_counts"] == {"emergency_unassigned": 1, "urgent_overdue": 1, "escalated": 1, "on_hold": 1}


def test_pm_overdue_uses_the_hotel_calendar_day_and_rooms_down_are_counted(monkeypatch):
    pm = [
        {"tenant_id": H1, "is_active": True, "next_due_at": _t(-48)},   # overdue
        {"tenant_id": H1, "is_active": True, "next_due_at": _t(48)},    # not due
        {"tenant_id": H2, "is_active": True, "next_due_at": _t(-48)},   # other hotel
    ]
    periods = [
        {"tenant_id": H1, "id": "p1", "status": "ACTIVE", "expected_return_at": _t(-1)},
        {"tenant_id": H1, "id": "p2", "status": "ACTIVE", "expected_return_at": _t(30)},
        {"tenant_id": H1, "id": "p3", "status": "RELEASED", "expected_return_at": _t(-9)},
    ]
    data = _client(monkeypatch, _db([], pm_schedules=pm, room_unavailability_periods=periods)).get("/engineering/team/overview").json()["data"]
    assert data["counts"]["pm_overdue"] == 1
    assert data["rooms_down"] == {"total": 2, "past_expected_return": 1}


def test_a_failed_optional_lookup_is_reported_as_unknown_not_zero(monkeypatch):
    db = _db([_wo(1)])
    real_table = db.table

    def table(name):
        if name in ("pm_schedules", "room_unavailability_periods"):
            raise RuntimeError("down")
        return real_table(name)

    monkeypatch.setattr(db, "table", table)
    data = _client(monkeypatch, db).get("/engineering/team/overview").json()["data"]
    assert data["counts"]["pm_overdue"] is None and data["rooms_down"] is None
    assert data["counts"]["open"] == 1


@pytest.mark.parametrize("role", ["engineer", "housekeeper", "front_desk", "housekeeping_supervisor"])
def test_only_chief_engineer_and_gm_can_read_the_team_view(monkeypatch, role):
    client = _client(monkeypatch, _db([]), role=role)
    assert client.get("/engineering/team/overview").status_code == 403
    assert client.get("/engineering/team/technicians").status_code == 403


def test_technicians_endpoint_lists_the_assignable_people(monkeypatch):
    data = _client(monkeypatch, _db([_wo(1, assigned_to=ALEX, status="open")]), role="gm").get("/engineering/team/technicians").json()["data"]
    assert {t["user_id"] for t in data["technicians"]} == {ALEX, BEA, IDLE}


def test_another_hotels_manager_sees_only_their_own_hotel(monkeypatch):
    db = _db([_wo(1, assigned_to=ALEX), _wo(2, tenant=H2)])
    data = _client(monkeypatch, db, hotel=H2).get("/engineering/team/overview").json()["data"]
    assert data["counts"]["open"] == 1
    assert [t["user_id"] for t in data["technicians"]] == ["other-hotel-eng"]  # never hotel 1's engineers


def test_pm_oversight_lists_overdue_inspections_and_repeat_defects(monkeypatch):
    pm = [
        {"id": "pm-old", "tenant_id": H1, "name": "Boiler check", "is_active": True, "next_due_at": _t(-96), "assets": {"name": "Boiler"}},
        {"id": "pm-new", "tenant_id": H1, "name": "Filter swap", "is_active": True, "next_due_at": _t(-48), "assets": {"name": "AHU"}},
        {"id": "pm-future", "tenant_id": H1, "name": "Roof", "is_active": True, "next_due_at": _t(72), "assets": {"name": "Roof"}},
        {"id": "pm-h2", "tenant_id": H2, "name": "Other hotel", "is_active": True, "next_due_at": _t(-96), "assets": {"name": "X"}},
    ]
    done = [
        {"tenant_id": H1, "asset_id": "a-ahu", "defects": 2, "completed_at": _t(-24 * 10), "assets": {"name": "AHU"}},
        {"tenant_id": H1, "asset_id": "a-ahu", "defects": 1, "completed_at": _t(-24 * 30), "assets": {"name": "AHU"}},
        {"tenant_id": H1, "asset_id": "a-ahu", "defects": 0, "completed_at": _t(-24 * 5), "assets": {"name": "AHU"}},
        {"tenant_id": H1, "asset_id": "a-once", "defects": 3, "completed_at": _t(-24), "assets": {"name": "Pump"}},
        {"tenant_id": H1, "asset_id": "a-old", "defects": 1, "completed_at": _t(-24 * 200), "assets": {"name": "Old"}},
        {"tenant_id": H1, "asset_id": "a-old", "defects": 1, "completed_at": _t(-24 * 201), "assets": {"name": "Old"}},
    ]
    db = _db([], pm_schedules=pm, pm_completion_records=done)
    data = _client(monkeypatch, db).get("/engineering/team/overview").json()["data"]
    oversight = data["pm_oversight"]
    assert [i["id"] for i in oversight["overdue"]] == ["pm-old", "pm-new"] and oversight["overdue_total"] == 2
    assert oversight["overdue"][0]["asset_name"] == "Boiler"
    assert oversight["repeat_defects"] == [{"asset_id": "a-ahu", "asset_name": "AHU", "count": 2}]  # one defect, or an old window, is not "repeated"


def test_unreadable_pm_tables_are_unknown_not_clear(monkeypatch):
    db = _db([_wo(1)])
    real_table = db.table

    def table(name):
        if name == "pm_completion_records":
            raise RuntimeError("down")
        return real_table(name)

    monkeypatch.setattr(db, "table", table)
    assert _client(monkeypatch, db).get("/engineering/team/overview").json()["data"]["pm_oversight"] is None

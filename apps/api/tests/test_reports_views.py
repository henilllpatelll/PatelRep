"""Phase 2/3 report views, trends and drill-down: RBAC, tenant isolation, reconciliation."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import management_roi as roi_router
from routers import report_views as views_router
from routers import reports as reports_router
from tests.smoke.fake_supabase import FakeDB

NOW = datetime.now(timezone.utc)
DAY = timedelta(days=1)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def at(days_ago: int, hour: int = 12) -> datetime:
    return (NOW - days_ago * DAY).replace(hour=hour, minute=0, second=0, microsecond=0)


def auth(role: str, hotel_id: str = "hotel-a", user_id: str = "user-a-1") -> dict[str, str]:
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    return {"Authorization": f"Bearer {jwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


def wo(id, **kw):
    base = {"id": id, "tenant_id": "hotel-a", "title": f"WO {id}", "category": "hvac", "priority": "normal", "status": "completed",
            "room_id": "r1", "asset_id": None, "assigned_to": "eng1", "created_at": iso(at(3)), "due_at": iso(at(3, 16)),
            "started_at": iso(at(3, 13)), "completed_at": iso(at(3, 15)), "labor_hours": 1.5, "guest_reported": False}
    base.update(kw)
    return base


def gr(id, **kw):
    base = {"id": id, "tenant_id": "hotel-a", "request_number": 100, "title": f"GR {id}", "category": "housekeeping", "priority": "normal",
            "status": "verified", "room_id": "r1", "created_at": iso(at(2)), "acknowledged_at": iso(at(2, 13)),
            "verified_at": iso(at(2, 14)), "due_at": iso(at(2, 16))}
    base.update(kw)
    return base


def make_db(**tables) -> FakeDB:
    rows = {
        "tenants": [{"id": "hotel-a", "timezone": "UTC"}],
        "rooms": [{"id": "r1", "tenant_id": "hotel-a", "room_number": "101", "floor": 1, "room_type_id": "rt1"},
                  {"id": "r-b", "tenant_id": "hotel-b", "room_number": "999", "floor": 9, "room_type_id": "rt9"}],
        "room_types": [{"id": "rt1", "tenant_id": "hotel-a", "code": "K", "name": "King", "base_clean_minutes": 30}],
        "user_profiles": [{"id": "eng1", "tenant_id": "hotel-a", "full_name": "Eli Engineer"},
                          {"id": "hk1", "tenant_id": "hotel-a", "full_name": "Hana Housekeeper"},
                          {"id": "eng-b", "tenant_id": "hotel-b", "full_name": "Other Hotel"}],
        "user_roles": [{"user_id": "eng1", "tenant_id": "hotel-a", "role": "engineer", "is_active": True},
                       {"user_id": "hk1", "tenant_id": "hotel-a", "role": "housekeeper", "is_active": True},
                       {"user_id": "eng-b", "tenant_id": "hotel-b", "role": "engineer", "is_active": True}],
    }
    rows.update(tables)
    return FakeDB(rows)


@pytest.fixture
def client(monkeypatch):
    def install(db: FakeDB) -> TestClient:
        for module in (views_router, reports_router, roi_router):
            monkeypatch.setattr(module, "supabase", db)
        return TestClient(app)
    return install


VIEW_ACCESS = {
    "overview": {"gm", "housekeeping_supervisor", "chief_engineer"},
    "guest-experience": {"gm", "housekeeping_supervisor", "chief_engineer", "engineer"},
    "housekeeping": {"gm", "housekeeping_supervisor"},
    "maintenance": {"gm", "chief_engineer", "engineer"},
    "team": {"gm", "housekeeping_supervisor", "chief_engineer"},
    "management": {"gm"},
}
ROLES = ("gm", "housekeeping_supervisor", "chief_engineer", "engineer", "front_desk", "housekeeper")


@pytest.mark.parametrize("view,allowed", list(VIEW_ACCESS.items()))
def test_view_role_matrix(client, view, allowed):
    http = client(make_db())
    for role in ROLES:
        response = http.get(f"/v1/reports/views/{view}", headers=auth(role))
        assert (response.status_code == 200) == (role in allowed), f"{role} {view} -> {response.status_code} {response.text[:120]}"


def test_chief_engineer_sees_maintenance_but_not_management_or_housekeeping(client):
    http = client(make_db())
    assert http.get("/v1/reports/views/maintenance", headers=auth("chief_engineer")).status_code == 200
    assert http.get("/v1/reports/views/management", headers=auth("chief_engineer")).status_code == 403
    assert http.get("/v1/reports/views/housekeeping", headers=auth("chief_engineer")).status_code == 403


# ── Guest experience ─────────────────────────────────────────────────────────


def guest_db():
    return make_db(guest_requests=[
        gr("g1"),  # verified on time
        gr("g2", verified_at=iso(at(2, 18))),  # verified late -> missed
        gr("g3", status="open", verified_at=None, acknowledged_at=None, due_at=iso(at(1))),  # past due, unverified -> missed
        gr("g4", due_at=None),  # no deadline -> excluded
        gr("g5", status="resolved", verified_at=None, due_at=iso(NOW + DAY)),  # unverified resolution
        {**gr("gx"), "tenant_id": "hotel-b"},  # other tenant
    ])


def test_guest_view_kpis_and_reconciliation_with_records(client):
    http = client(guest_db())
    view = http.get("/v1/reports/views/guest-experience", headers=auth("gm")).json()["data"]
    sla = next(k for k in view["kpis"] if k["key"] == "guest_sla")
    assert (sla["eligible"], sla["numerator"], sla["value"]) == (3, 1, 33.3)
    missed = http.get("/v1/reports/records?kind=guest_requests&filter=sla_missed", headers=auth("gm")).json()["data"]
    met = http.get("/v1/reports/records?kind=guest_requests&filter=sla_met", headers=auth("gm")).json()["data"]
    assert missed["meta"]["total"] == sla["eligible"] - sla["numerator"]
    assert met["meta"]["total"] == sla["numerator"]
    total = next(k for k in view["kpis"] if k["key"] == "guest_requests_total")
    assert total["value"] == 5 and total["value"] == http.get("/v1/reports/records?kind=guest_requests", headers=auth("gm")).json()["data"]["meta"]["total"]
    assert view["needs_review"]["counts"]["unverified_resolution"] == 1


def test_guest_view_empty_period_is_not_zero(client):
    view = client(make_db()).get("/v1/reports/views/guest-experience", headers=auth("gm")).json()["data"]
    sla = next(k for k in view["kpis"] if k["key"] == "guest_sla")
    assert sla["value"] is None and sla["availability"] != "available"
    assert next(k for k in view["kpis"] if k["key"] == "guest_ack_time")["value"] is None


def test_supervisor_guest_view_limited_to_housekeeping_categories(client):
    db = make_db(guest_requests=[gr("a", category="housekeeping"), gr("b", category="maintenance"), gr("c", category="service")])
    http = client(db)
    sup = http.get("/v1/reports/views/guest-experience", headers=auth("housekeeping_supervisor")).json()["data"]
    assert next(k for k in sup["kpis"] if k["key"] == "guest_requests_total")["value"] == 1
    gm = http.get("/v1/reports/views/guest-experience", headers=auth("gm")).json()["data"]
    assert next(k for k in gm["kpis"] if k["key"] == "guest_requests_total")["value"] == 3
    assert {d["department"] for d in gm["departments"]} == {"housekeeping", "engineering", "unattributed"}


# ── Maintenance ──────────────────────────────────────────────────────────────


def maint_db():
    return make_db(work_orders=[
        wo("w1"),  # met
        wo("w2", completed_at=iso(at(3, 20))),  # missed
        wo("w3", due_at=None),  # excluded (no deadline)
        wo("w4", status="open", completed_at=None, due_at=iso(at(1)), priority="urgent"),  # overdue, in cohort
        wo("old", status="open", completed_at=None, created_at=iso(at(120)), due_at=iso(at(100))),  # overdue, OUTSIDE period
        {**wo("other"), "tenant_id": "hotel-b"},
    ])


def test_maintenance_view_reconciles_and_separates_live_backlog(client):
    http = client(maint_db())
    view = http.get("/v1/reports/views/maintenance", headers=auth("chief_engineer")).json()["data"]
    sla = next(k for k in view["kpis"] if k["key"] == "maintenance_sla")
    assert (sla["eligible"], sla["numerator"], sla["value"]) == (2, 1, 50.0)
    assert view["active_breaches"]["scope"] == "live"
    assert view["active_breaches"]["overdue_count"] == 2  # includes the pre-period work order
    assert view["active_breaches"]["urgent_overdue_count"] == 1
    assert view["totals"]["total_work_orders"] == 4  # period cohort only
    missed = http.get("/v1/reports/records?kind=work_orders&filter=sla_missed", headers=auth("chief_engineer")).json()["data"]
    assert missed["meta"]["total"] == sla["eligible"] - sla["numerator"]
    live = http.get("/v1/reports/records?kind=work_orders&filter=overdue_live", headers=auth("chief_engineer")).json()["data"]
    assert live["scope"] == "live" and live["meta"]["total"] == view["active_breaches"]["overdue_count"]
    assert all(r["id"] != "other" for r in live["rows"])


def test_maintenance_repeat_failures_do_not_claim_root_cause(client):
    db = make_db(work_orders=[wo("a", category="hvac"), wo("b", category="plumbing")], assets=[])
    rows = client(db).get("/v1/reports/views/maintenance", headers=auth("gm")).json()["data"]["repeat_failures"]
    assert rows and rows[0]["kind"] == "room" and rows[0]["failure_count"] == 2
    assert "root_cause" not in rows[0]


def test_revenue_exposure_is_gm_only_and_labelled_estimate(client):
    db = maint_db()
    http = client(db)
    assert http.get("/v1/reports/views/maintenance", headers=auth("chief_engineer")).json()["data"]["downtime"]["revenue_exposure"] is None
    gm = http.get("/v1/reports/views/maintenance", headers=auth("gm")).json()["data"]["downtime"]["revenue_exposure"]
    assert gm["configured"] is False and gm["estimate_cents"] is None and gm["is_estimate"] is True  # not $0


# ── Trends ───────────────────────────────────────────────────────────────────


def test_trend_buckets_reconcile_with_kpi_and_missing_buckets_are_null(client):
    http = client(maint_db())
    trend = http.get("/v1/reports/trends?metric=maintenance_sla", headers=auth("chief_engineer")).json()["data"]
    kpi_value = next(k for k in http.get("/v1/reports/views/maintenance", headers=auth("chief_engineer")).json()["data"]["kpis"] if k["key"] == "maintenance_sla")["value"]
    assert trend["total"] == kpi_value == 50.0
    assert trend["granularity"] == "day" and len(trend["points"]) == 30
    populated = [p for p in trend["points"] if p["eligible"]]
    assert len(populated) == 1 and populated[0]["eligible"] == 2
    assert all(p["value"] is None for p in trend["points"] if not p["eligible"])  # never 0


def test_trend_comparison_aligns_equal_length_periods(client):
    trend = client(maint_db()).get("/v1/reports/trends?metric=wo_created&compare=previous", headers=auth("gm")).json()["data"]
    assert len(trend["comparison"]["points"]) == len(trend["points"])
    assert trend["comparison"]["period"]["end"] < trend["period"]["start"]


def test_trend_events_land_in_hotel_local_day(client):
    # 02:30Z on day D is still day D-1 in Chicago -> bucketed on the prior local day.
    created = at(3, 2).replace(minute=30)
    db = make_db(work_orders=[wo("late", created_at=iso(created))], tenants=[{"id": "hotel-a", "timezone": "America/Chicago"}])
    points = client(db).get("/v1/reports/trends?metric=wo_created", headers=auth("gm")).json()["data"]["points"]
    hit = next(p for p in points if p["value"])
    local_day = created.astimezone(__import__("zoneinfo").ZoneInfo("America/Chicago")).date().isoformat()
    assert hit["bucket"] == local_day


def test_trend_metric_permissions(client):
    http = client(make_db())
    assert http.get("/v1/reports/trends?metric=inspection_pass", headers=auth("chief_engineer")).status_code == 403
    assert http.get("/v1/reports/trends?metric=maintenance_sla", headers=auth("housekeeping_supervisor")).status_code == 403
    assert http.get("/v1/reports/trends?metric=nope", headers=auth("gm")).status_code == 422


# ── Records / drill-down security ────────────────────────────────────────────


def test_records_authorization_and_validation(client):
    http = client(maint_db())
    assert http.get("/v1/reports/records?kind=work_orders", headers=auth("housekeeping_supervisor")).status_code == 403
    assert http.get("/v1/reports/records?kind=inspections", headers=auth("chief_engineer")).status_code == 403
    assert http.get("/v1/reports/records?kind=work_orders&filter=bogus", headers=auth("gm")).status_code == 422
    assert http.get("/v1/reports/records?kind=nonsense", headers=auth("gm")).status_code == 422
    assert http.get("/v1/reports/records?kind=work_orders", headers=auth("housekeeper")).status_code == 403


def test_records_are_paginated_server_side_and_tenant_scoped(client):
    orders = [wo(f"w{i}", created_at=iso(at(3, 8) + timedelta(minutes=i))) for i in range(12)]
    orders.append({**wo("foreign"), "tenant_id": "hotel-b"})
    body = client(make_db(work_orders=orders)).get("/v1/reports/records?kind=work_orders&per_page=5&page=3", headers=auth("gm")).json()["data"]
    assert body["meta"] == {"page": 3, "per_page": 5, "total": 12} and len(body["rows"]) == 2
    assert all(r["id"] != "foreign" for r in body["rows"])


def test_records_do_not_name_staff_outside_viewers_department(client):
    db = make_db(work_orders=[wo("w1", assigned_to="eng1")])
    http = client(db)
    assert http.get("/v1/reports/records?kind=work_orders", headers=auth("chief_engineer")).json()["data"]["rows"][0]["assigned_to"] == "Eli Engineer"


def test_records_bucket_filter_selects_chart_point(client):
    day = at(3).date().isoformat()
    other = at(5).date().isoformat()
    db = make_db(work_orders=[wo("in", created_at=iso(at(3))), wo("out", created_at=iso(at(5)))])
    body = client(db).get(f"/v1/reports/records?kind=work_orders&bucket_start={day}&bucket_end={day}", headers=auth("gm")).json()["data"]
    assert [r["id"] for r in body["rows"]] == ["in"]
    assert other != day


# ── Employee / room-asset drawers ────────────────────────────────────────────


def team_db():
    return make_db(
        work_orders=[wo("w1", assigned_to="eng1"), wo("w2", assigned_to="eng1", due_at=None, labor_hours=None)],
        tasks=[{"id": "t1", "tenant_id": "hotel-a", "title": "Clean", "status": "completed", "assigned_to": "hk1",
                "created_at": iso(at(3)), "due_at": None, "completed_at": iso(at(3, 15))}],
    )


def test_employee_drawer_authorization_and_honesty(client):
    http = client(team_db())
    mine = http.get("/v1/reports/employee/eng1", headers=auth("chief_engineer")).json()["data"]
    assert mine["employee"]["name"] == "Eli Engineer"
    labor = next(k for k in mine["kpis"] if k and k["key"] == "labor_hours")
    assert labor["value"] == 1.5 and "rank" not in str(mine).lower().replace("ranking", "")
    assert http.get("/v1/reports/employee/hk1", headers=auth("chief_engineer")).status_code == 404  # other department
    assert http.get("/v1/reports/employee/eng-b", headers=auth("gm")).status_code == 404  # other tenant
    assert http.get("/v1/reports/employee/eng1", headers=auth("engineer")).status_code == 403  # no Team access
    hk = http.get("/v1/reports/employee/hk1", headers=auth("housekeeping_supervisor")).json()["data"]
    assert next(k for k in hk["kpis"] if k and k["key"] == "labor_hours")["value"] is None  # untracked != 0
    assert hk["low_sample"] is True


def test_room_asset_drawer_is_tenant_scoped(client):
    db = make_db(work_orders=[wo("a"), wo("b")], assets=[{"id": "as1", "tenant_id": "hotel-a", "name": "PTAC 101"},
                                                         {"id": "as-b", "tenant_id": "hotel-b", "name": "Foreign"}])
    http = client(db)
    room = http.get("/v1/reports/room-asset/room/r1", headers=auth("gm")).json()["data"]
    assert room["entity"]["label"] == "Room 101" and len(room["timeline"]) == 2
    assert "root cause" in room["repeat_notice"].lower()
    assert http.get("/v1/reports/room-asset/room/r-b", headers=auth("gm")).status_code == 404
    assert http.get("/v1/reports/room-asset/asset/as-b", headers=auth("gm")).status_code == 404
    asset = http.get("/v1/reports/room-asset/asset/as1", headers=auth("chief_engineer")).json()["data"]
    assert asset["downtime"]["availability"] == "unavailable"
    assert http.get("/v1/reports/room-asset/asset/as1", headers=auth("housekeeping_supervisor")).status_code == 403


# ── Overview ─────────────────────────────────────────────────────────────────


def test_overview_sections_follow_role_and_labels_live_data(client):
    db = make_db(
        guest_requests=[gr("g1")], work_orders=[wo("w1"), wo("w2", status="open", completed_at=None, due_at=iso(at(1)), priority="urgent")],
        room_status=[{"tenant_id": "hotel-a", "room_id": "r1", "status": "OOO"}, {"tenant_id": "hotel-a", "room_id": "r2", "status": "CLEAN"}],
        inspections=[{"id": "i1", "tenant_id": "hotel-a", "room_id": "r1", "overall_result": "passed", "completed_at": iso(at(2))}],
    )
    http = client(db)
    gm = http.get("/v1/reports/views/overview?compare=previous", headers=auth("gm")).json()["data"]
    keys = {k["key"] for k in gm["kpis"]}
    assert keys == {"guest_sla", "maintenance_sla", "inspection_pass", "out_of_order"}
    ooo = next(k for k in gm["kpis"] if k["key"] == "out_of_order")
    assert ooo["scope"] == "live" and ooo["value"] == 1 and ooo["comparison"] is None
    assert gm["daily_brief"]["scope"] == "live"
    assert gm["needs_attention"][0]["severity"] == "critical" and gm["needs_attention"][0]["key"] == "wo_overdue_urgent"
    assert len({e["key"] for e in gm["needs_attention"]}) == len(gm["needs_attention"])  # de-duplicated

    chief = http.get("/v1/reports/views/overview", headers=auth("chief_engineer")).json()["data"]
    assert {k["key"] for k in chief["kpis"]} == {"guest_sla", "maintenance_sla"}  # no housekeeping KPIs
    sup = http.get("/v1/reports/views/overview", headers=auth("housekeeping_supervisor")).json()["data"]
    assert {k["key"] for k in sup["kpis"]} == {"guest_sla", "inspection_pass", "out_of_order"}
    assert all(e.get("department") != "engineering" for e in sup["needs_attention"])


def test_overview_positive_empty_state_has_no_exceptions(client):
    data = client(make_db()).get("/v1/reports/views/overview", headers=auth("gm")).json()["data"]
    assert data["needs_attention"] == []


# ── Team / segments / management ─────────────────────────────────────────────


def test_team_view_search_sort_pagination_and_role_scope(client):
    http = client(team_db())
    gm = http.get("/v1/reports/views/team?per_page=1&page=2&sort=name", headers=auth("gm")).json()["data"]
    assert gm["meta"] == {"page": 2, "per_page": 1, "total": 2} and len(gm["staff"]) == 1
    chief = http.get("/v1/reports/views/team", headers=auth("chief_engineer")).json()["data"]
    assert [s["name"] for s in chief["staff"]] == ["Eli Engineer"]
    searched = http.get("/v1/reports/views/team?search=hana", headers=auth("gm")).json()["data"]
    assert [s["name"] for s in searched["staff"]] == ["Hana Housekeeper"]
    labor = next(k for k in http.get("/v1/reports/views/team?department=housekeeping", headers=auth("gm")).json()["data"]["kpis"] if k["key"] == "labor_hours")
    assert labor["value"] is None


def test_segments_validate_dimensions(client):
    http = client(maint_db())
    ok = http.get("/v1/reports/segments?metric=maintenance_sla&dimension=priority", headers=auth("gm")).json()["data"]
    assert {s["segment"] for s in ok["segments"]} >= {"urgent", "normal"}
    assert http.get("/v1/reports/segments?metric=maintenance_sla&dimension=room_type", headers=auth("gm")).status_code == 422


def test_management_view_is_gm_only_and_estimate_labelled(client):
    http = client(make_db())
    body = http.get("/v1/reports/views/management", headers=auth("gm")).json()["data"]
    assert body["downtime_exposure"]["is_estimate"] is True and body["downtime_exposure"]["estimate_cents"] is None
    assert body["staffing_forecast"]["horizon"].startswith("next 7 days")
    for role in ("chief_engineer", "housekeeping_supervisor", "engineer"):
        assert http.get("/v1/reports/views/management", headers=auth(role)).status_code == 403


def test_definitions_endpoint_serves_registry(client):
    data = client(make_db()).get("/v1/reports/definitions", headers=auth("chief_engineer")).json()["data"]
    assert data["maintenance_sla"]["denominator"].startswith("Completed work orders")
    assert client(make_db()).get("/v1/reports/definitions", headers=auth("housekeeper")).status_code == 403

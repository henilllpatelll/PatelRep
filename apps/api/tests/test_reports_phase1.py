"""Phase 1 reporting correctness: date boundaries, SLA eligibility, RBAC, tenant isolation."""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import reports as reports_router
from services.reporting import access
from services.reporting.metrics import compare, guest_stats, maintenance_stats
from services.reporting.periods import (
    build_buckets,
    comparison_period,
    resolve_period,
    same_period_last_year,
)
from tests.smoke.fake_supabase import FakeDB

CHI = ZoneInfo("America/Chicago")
NOW = datetime(2026, 10, 7, 18, 0, tzinfo=timezone.utc)  # 13:00 in Chicago (CDT)


def _auth(role: str, hotel_id: str = "hotel-a", user_id: str = "user-a-1") -> dict[str, str]:
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    return {"Authorization": f"Bearer {jwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


# ── periods ──────────────────────────────────────────────────────────────────


def test_period_includes_entire_final_local_day():
    period = resolve_period(date(2026, 10, 1), date(2026, 10, 3), CHI, now=NOW)
    # Oct 1 00:00 CDT = 05:00Z; exclusive end = Oct 4 00:00 CDT = 05:00Z
    assert period.start_utc == datetime(2026, 10, 1, 5, tzinfo=timezone.utc)
    assert period.end_utc == datetime(2026, 10, 4, 5, tzinfo=timezone.utc)
    assert period.days == 3
    # 23:30 local on the final day is inside; 00:00 local the next day is not.
    assert period.start_utc <= datetime(2026, 10, 4, 4, 30, tzinfo=timezone.utc) < period.end_utc
    assert not (datetime(2026, 10, 4, 5, tzinfo=timezone.utc) < period.end_utc)


def test_period_handles_dst_fall_back_day_length():
    period = resolve_period(date(2026, 11, 1), date(2026, 11, 1), CHI, now=datetime(2026, 11, 5, tzinfo=timezone.utc))
    assert (period.end_utc - period.start_utc) == timedelta(hours=25)


@pytest.mark.parametrize(
    "start,end",
    [(date(2026, 10, 5), date(2026, 10, 1)), (date(2026, 10, 1), date(2026, 10, 9)), (date(2025, 1, 1), date(2026, 10, 7))],
)
def test_period_rejects_invalid_ranges(start, end):
    with pytest.raises(HTTPException) as exc:
        resolve_period(start, end, CHI, now=NOW)
    assert exc.value.status_code == 422


def test_default_period_is_last_30_local_days_ending_today():
    period = resolve_period(None, None, CHI, now=NOW)
    assert period.end == date(2026, 10, 7)
    assert period.days == 30


def test_local_today_uses_hotel_timezone_not_utc():
    # 02:00Z on Oct 8 is still Oct 7 in Chicago.
    period = resolve_period(None, None, CHI, now=datetime(2026, 10, 8, 2, tzinfo=timezone.utc))
    assert period.end == date(2026, 10, 7)


def test_comparison_periods_are_equivalent_length():
    period = resolve_period(date(2026, 9, 1), date(2026, 9, 30), CHI, now=NOW)
    previous = comparison_period(period, "previous", CHI)
    assert previous.days == period.days and previous.end == date(2026, 8, 31)
    last_year = same_period_last_year(period, CHI)
    assert last_year.start == date(2025, 9, 1) and last_year.end == date(2025, 9, 30)
    assert comparison_period(period, "none", CHI) is None
    with pytest.raises(HTTPException):
        comparison_period(period, "bogus", CHI)


def test_buckets_cover_period_exactly_with_clipped_edges():
    period = resolve_period(date(2026, 8, 5), date(2026, 10, 7), CHI, now=NOW)
    buckets = build_buckets(period, CHI)  # 64 days -> weekly
    assert buckets[0].start == period.start and buckets[-1].end == period.end
    for a, b in zip(buckets, buckets[1:]):
        assert b.start == a.end + timedelta(days=1)
    assert buckets[0].end.weekday() == 6  # clipped first bucket ends Sunday


# ── SLA / metrics ────────────────────────────────────────────────────────────


def _wo(status="completed", due=None, done=None, created="2026-10-01T10:00:00+00:00", **extra):
    return {"status": status, "due_at": due, "completed_at": done, "created_at": created, **extra}


def test_maintenance_sla_excludes_records_without_deadline_from_denominator():
    stats = maintenance_stats([
        _wo(due="2026-10-01T12:00:00+00:00", done="2026-10-01T11:00:00+00:00"),  # met
        _wo(due="2026-10-01T12:00:00+00:00", done="2026-10-01T13:00:00+00:00"),  # missed
        _wo(due=None, done="2026-10-01T11:00:00+00:00"),  # no deadline -> excluded
    ])
    assert stats["sla_eligible"] == 2 and stats["sla_met"] == 1
    assert stats["sla_compliance_pct"] == 50.0
    assert stats["sla_excluded_no_deadline"] == 1


def test_zero_eligible_is_null_not_zero_percent():
    stats = maintenance_stats([_wo(due=None, done="2026-10-01T11:00:00+00:00"), _wo(status="open")])
    assert stats["sla_eligible"] == 0
    assert stats["sla_compliance_pct"] is None
    assert maintenance_stats([])["completion_rate_pct"] is None
    assert maintenance_stats([])["avg_repair_hours"] is None


def test_sla_boundary_exactly_at_deadline_is_met():
    stats = maintenance_stats([_wo(due="2026-10-01T12:00:00+00:00", done="2026-10-01T12:00:00+00:00")])
    assert stats["sla_compliance_pct"] == 100.0


def test_labor_hours_none_when_untracked():
    assert maintenance_stats([_wo(labor_hours=None)])["total_labor_hours"] is None
    assert maintenance_stats([_wo(labor_hours=2.5), _wo(labor_hours=1)])["total_labor_hours"] == 3.5


def test_guest_sla_only_counts_eligible_requests():
    now = datetime(2026, 10, 7, tzinfo=timezone.utc)
    requests = [
        {"status": "verified", "created_at": "2026-10-01T10:00:00+00:00", "verified_at": "2026-10-01T10:30:00+00:00", "due_at": "2026-10-01T11:00:00+00:00"},
        {"status": "open", "created_at": "2026-10-01T10:00:00+00:00", "due_at": "2026-10-02T10:00:00+00:00"},  # past due, unverified -> missed
        {"status": "open", "created_at": "2026-10-07T10:00:00+00:00", "due_at": "2026-10-08T10:00:00+00:00"},  # still running -> ignored
        {"status": "verified", "created_at": "2026-10-01T10:00:00+00:00", "verified_at": "2026-10-01T10:30:00+00:00", "due_at": None},  # no deadline
    ]
    stats = guest_stats(requests, now)
    assert (stats["sla_eligible"], stats["sla_met"], stats["sla_compliance_pct"]) == (2, 1, 50.0)
    assert guest_stats([], now)["sla_compliance_pct"] is None
    assert guest_stats([], now)["avg_acknowledgement_minutes"] is None


def test_compare_distinguishes_percentage_points_from_percent():
    pp = compare(80.0, 90.0, kind="rate", higher_is_better=True)
    assert pp == {"previous": 90.0, "change": -10.0, "change_kind": "percentage_points", "direction": "unfavorable"}
    rel = compare(60.0, 50.0, kind="value", higher_is_better=False)
    assert rel["change_kind"] == "percent" and rel["change"] == 20.0 and rel["direction"] == "unfavorable"
    assert compare(None, 5, kind="rate", higher_is_better=True) is None
    assert compare(5, 0, kind="value", higher_is_better=True) is None  # no relative change from zero
    assert compare(5, 5, kind="rate", higher_is_better=True)["direction"] == "neutral"


# ── access matrix ────────────────────────────────────────────────────────────


def test_role_view_matrix():
    assert access.views_for_role("gm") == access.VIEWS
    assert access.views_for_role("housekeeping_supervisor") == ("overview", "guest-experience", "housekeeping", "team")
    assert access.views_for_role("chief_engineer") == ("overview", "guest-experience", "maintenance", "team")
    assert access.views_for_role("engineer") == ("guest-experience", "maintenance")
    assert access.views_for_role("housekeeper") == () and access.views_for_role("front_desk") == ()
    assert "management" not in access.views_for_role("chief_engineer")


def test_staff_visibility_is_department_scoped():
    assert access.staff_visible_to("housekeeping_supervisor", "housekeeper")
    assert not access.staff_visible_to("housekeeping_supervisor", "engineer")
    assert access.staff_visible_to("chief_engineer", "engineer")
    assert not access.staff_visible_to("chief_engineer", "housekeeper")
    assert not access.staff_visible_to("chief_engineer", "front_desk")
    assert access.staff_visible_to("gm", "front_desk")


def test_effective_departments_blocks_cross_department_filters():
    assert access.effective_departments("gm", None) == ("housekeeping", "engineering")
    assert access.effective_departments("chief_engineer", "engineering") == ("engineering",)
    with pytest.raises(HTTPException) as exc:
        access.effective_departments("chief_engineer", "housekeeping")
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        access.effective_departments("gm", "front-office")
    assert exc.value.status_code == 422


# ── endpoints: role matrix, tenant isolation ─────────────────────────────────

REPORT_ENDPOINTS = {
    "/v1/reports/guest-recovery": {"gm", "housekeeping_supervisor", "chief_engineer", "engineer"},
    "/v1/reports/daily-summary": {"gm", "housekeeping_supervisor", "chief_engineer", "engineer"},
    "/v1/reports/staff-performance": {"gm", "housekeeping_supervisor", "chief_engineer"},
    "/v1/reports/maintenance": {"gm", "chief_engineer", "engineer"},
    "/v1/reports/ai-usage": {"gm"},
}
ALL_ROLES = ("gm", "housekeeping_supervisor", "chief_engineer", "engineer", "front_desk", "housekeeper")


def _db(**rows):
    base = {"tenants": [{"id": "hotel-a", "timezone": "America/Chicago"}]}
    base.update(rows)
    return FakeDB(base)


@pytest.mark.parametrize("path,allowed", list(REPORT_ENDPOINTS.items()))
def test_report_endpoint_role_matrix(monkeypatch, path, allowed):
    monkeypatch.setattr(reports_router, "supabase", _db())
    client = TestClient(app)
    for role in ALL_ROLES:
        response = client.get(path, headers=_auth(role))
        assert (response.status_code == 200) == (role in allowed), f"{role} on {path}: {response.status_code}"


def test_capabilities_endpoint_reflects_matrix():
    client = TestClient(app)
    chief = client.get("/v1/reports/capabilities", headers=_auth("chief_engineer")).json()["data"]
    assert chief["views"] == ["overview", "guest-experience", "maintenance", "team"]
    assert chief["departments"] == ["engineering"] and chief["financial_access"] is False
    assert client.get("/v1/reports/capabilities", headers=_auth("housekeeper")).json()["data"]["views"] == []


def test_invalid_range_and_future_dates_return_422(monkeypatch):
    monkeypatch.setattr(reports_router, "supabase", _db())
    client = TestClient(app)
    assert client.get("/v1/reports/maintenance?start_date=2026-10-05&end_date=2026-10-01", headers=_auth("gm")).status_code == 422
    future = (date.today() + timedelta(days=5)).isoformat()
    assert client.get(f"/v1/reports/maintenance?end_date={future}", headers=_auth("gm")).status_code == 422


def test_maintenance_report_is_tenant_scoped_and_sla_eligible(monkeypatch):
    today = datetime.now(timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)
    iso = lambda dt: dt.isoformat()
    created = today - timedelta(days=2)
    db = _db(work_orders=[
        {"id": "a1", "tenant_id": "hotel-a", "status": "completed", "category": "hvac", "priority": "urgent",
         "created_at": iso(created), "due_at": iso(created + timedelta(hours=4)), "completed_at": iso(created + timedelta(hours=2))},
        {"id": "a2", "tenant_id": "hotel-a", "status": "completed", "category": "hvac", "priority": "normal",
         "created_at": iso(created), "due_at": None, "completed_at": iso(created + timedelta(hours=2))},
        {"id": "b1", "tenant_id": "hotel-b", "status": "completed", "category": "hvac", "priority": "urgent",
         "created_at": iso(created), "due_at": iso(created + timedelta(hours=1)), "completed_at": iso(created + timedelta(hours=9))},
    ])
    monkeypatch.setattr(reports_router, "supabase", db)
    body = TestClient(app).get("/v1/reports/maintenance", headers=_auth("chief_engineer")).json()["data"]
    assert body["total_work_orders"] == 2  # hotel-b row never leaks
    assert (body["sla_eligible"], body["sla_met"], body["sla_compliance_pct"]) == (1, 1, 100.0)
    assert body["by_category"] == {"hvac": 2}


def test_daily_summary_past_date_does_not_present_current_counts_as_historical(monkeypatch):
    db = _db(
        room_status=[{"tenant_id": "hotel-a", "status": "DIRTY"}],
        work_orders=[{"tenant_id": "hotel-a", "status": "open", "created_at": "2026-01-01T00:00:00+00:00"}],
        tasks=[{"tenant_id": "hotel-a", "status": "completed", "completed_at": "2026-10-02T15:00:00+00:00"}],
    )
    monkeypatch.setattr(reports_router, "supabase", db)
    client = TestClient(app)
    past = client.get("/v1/reports/daily-summary?date=2026-10-02", headers=_auth("gm")).json()["data"]
    assert past["is_live"] is False
    assert past["tasks_completed_today"] == 1  # real historical record
    assert past["room_status_breakdown"] is None and past["open_work_orders"] is None
    assert past["availability"]["open_work_orders"] == "unavailable"
    live = client.get("/v1/reports/daily-summary", headers=_auth("gm")).json()["data"]
    assert live["is_live"] is True and live["room_status_breakdown"] == {"DIRTY": 1} and live["open_work_orders"] == 1
    future = (date.today() + timedelta(days=3)).isoformat()
    assert client.get(f"/v1/reports/daily-summary?date={future}", headers=_auth("gm")).status_code == 422


def test_staff_performance_scopes_staff_by_viewer_department(monkeypatch):
    now = datetime.now(timezone.utc) - timedelta(days=1)
    stamp = now.isoformat()
    db = _db(
        user_profiles=[
            {"id": "u-hk", "tenant_id": "hotel-a", "full_name": "Hana Housekeeper"},
            {"id": "u-eng", "tenant_id": "hotel-a", "full_name": "Eli Engineer"},
        ],
        user_roles=[
            {"user_id": "u-hk", "tenant_id": "hotel-a", "role": "housekeeper", "is_active": True},
            {"user_id": "u-eng", "tenant_id": "hotel-a", "role": "engineer", "is_active": True},
        ],
        tasks=[{"tenant_id": "hotel-a", "assigned_to": "u-hk", "status": "completed", "created_at": stamp, "due_at": None, "completed_at": stamp}],
        work_orders=[{"tenant_id": "hotel-a", "assigned_to": "u-eng", "status": "completed", "created_at": stamp, "due_at": None, "completed_at": stamp, "labor_hours": None}],
    )
    monkeypatch.setattr(reports_router, "supabase", db)
    client = TestClient(app)
    names = lambda role: [m["name"] for m in client.get("/v1/reports/staff-performance", headers=_auth(role)).json()["data"]["metrics"]]
    assert names("housekeeping_supervisor") == ["Hana Housekeeper"]
    assert names("chief_engineer") == ["Eli Engineer"]
    assert sorted(names("gm")) == ["Eli Engineer", "Hana Housekeeper"]
    gm = client.get("/v1/reports/staff-performance", headers=_auth("gm")).json()["data"]["metrics"]
    eli = next(m for m in gm if m["name"] == "Eli Engineer")
    assert eli["total_labor_hours"] is None  # untracked labor is not 0
    assert eli["sla_compliance_pct"] is None  # no eligible items is not 0%
    assert client.get("/v1/reports/staff-performance?department=housekeeping", headers=_auth("chief_engineer")).status_code == 403


def test_staff_csv_neutralises_formula_injection(monkeypatch):
    stamp = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    db = _db(
        user_profiles=[{"id": "u1", "tenant_id": "hotel-a", "full_name": "=HYPERLINK(\"http://evil\")"}],
        user_roles=[{"user_id": "u1", "tenant_id": "hotel-a", "role": "housekeeper", "is_active": True}],
        tasks=[{"tenant_id": "hotel-a", "assigned_to": "u1", "status": "open", "created_at": stamp}],
    )
    monkeypatch.setattr(reports_router, "supabase", db)
    response = TestClient(app).get("/v1/reports/staff-performance?format=csv", headers=_auth("gm"))
    assert response.status_code == 200
    assert "'=HYPERLINK" in response.text and "\n=HYPERLINK" not in response.text

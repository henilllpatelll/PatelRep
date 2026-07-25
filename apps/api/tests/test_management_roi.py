"""Fixture-reconcilable coverage for Phase 5 management ROI calculators.

Style follows test_guest_recovery.py: direct imports, literal fixture dicts,
plain asserts, no mocks.
"""

from datetime import date, datetime, timedelta, timezone

from services.guest_recovery.contracts import (
    calculate_downtime_revenue_impact,
    calculate_housekeeping_efficiency,
    calculate_inspection_trends,
    calculate_pm_compliance,
    calculate_repeat_failures,
    calculate_room_downtime_hours,
    calculate_training_readiness,
    project_seven_day_labor_forecast,
)


# ---------------------------------------------------------------------------
# calculate_repeat_failures (D-08)
# ---------------------------------------------------------------------------


def test_repeat_failure_requires_two_within_window():
    window_start = datetime(2026, 5, 1, tzinfo=timezone.utc)
    window_end = datetime(2026, 7, 30, tzinfo=timezone.utc)
    work_orders = [
        # asset-a1: day 1 and day 40 of the 90-day window -> repeat (2 work orders)
        {"asset_id": "asset-a1", "room_id": None, "created_at": "2026-05-01T08:00:00+00:00"},
        {"asset_id": "asset-a1", "room_id": None, "created_at": "2026-06-10T08:00:00+00:00"},
        # asset-a2: single work order in window -> not a repeat
        {"asset_id": "asset-a2", "room_id": None, "created_at": "2026-05-05T08:00:00+00:00"},
    ]

    result = calculate_repeat_failures(
        work_orders, window_start=window_start, window_end=window_end
    )

    assert result["repeat_asset_count"] == 1
    assert result["repeat_assets"] == [{"asset_id": "asset-a1", "failure_count": 2}]
    assert result["repeat_room_count"] == 0
    assert result["repeat_rooms"] == []
    assert result["total_repeat_work_orders"] == 2
    assert result["window_days"] == 90


def test_repeat_failure_ignores_work_orders_outside_window():
    window_start = datetime(2026, 5, 1, tzinfo=timezone.utc)
    window_end = datetime(2026, 7, 30, tzinfo=timezone.utc)
    work_orders = [
        {"asset_id": "asset-b1", "room_id": None, "created_at": "2026-05-02T08:00:00+00:00"},
        # outside the window entirely -> must not count toward asset-b1's total
        {"asset_id": "asset-b1", "room_id": None, "created_at": "2026-01-01T08:00:00+00:00"},
        # null grouping key -> skipped, never counted under "None"
        {"asset_id": None, "room_id": None, "created_at": "2026-05-03T08:00:00+00:00"},
    ]

    result = calculate_repeat_failures(
        work_orders, window_start=window_start, window_end=window_end
    )

    assert result["repeat_asset_count"] == 0
    assert result["repeat_assets"] == []
    assert result["total_repeat_work_orders"] == 0


def test_repeat_failure_empty_input_returns_zero_shape():
    window_start = datetime(2026, 5, 1, tzinfo=timezone.utc)
    window_end = datetime(2026, 7, 30, tzinfo=timezone.utc)

    result = calculate_repeat_failures(
        [], window_start=window_start, window_end=window_end
    )

    assert result == {
        "window_days": 90,
        "repeat_asset_count": 0,
        "repeat_room_count": 0,
        "repeat_assets": [],
        "repeat_rooms": [],
        "total_repeat_work_orders": 0,
    }


def test_repeat_failure_room_grouping_independent_of_asset_grouping():
    window_start = datetime(2026, 5, 1, tzinfo=timezone.utc)
    window_end = datetime(2026, 7, 30, tzinfo=timezone.utc)
    work_orders = [
        {"asset_id": None, "room_id": "room-101", "created_at": "2026-05-01T08:00:00+00:00"},
        {"asset_id": None, "room_id": "room-101", "created_at": "2026-05-15T08:00:00+00:00"},
        {"asset_id": None, "room_id": "room-101", "created_at": "2026-06-01T08:00:00+00:00"},
    ]

    result = calculate_repeat_failures(
        work_orders, window_start=window_start, window_end=window_end
    )

    assert result["repeat_room_count"] == 1
    assert result["repeat_rooms"] == [{"room_id": "room-101", "failure_count": 3}]
    assert result["total_repeat_work_orders"] == 3


# ---------------------------------------------------------------------------
# calculate_room_downtime_hours
# ---------------------------------------------------------------------------


def test_room_downtime_closes_open_interval_at_window_end():
    window_end = datetime(2026, 7, 1, 12, 0, 0)
    transitions = [
        {"room_id": "room-201", "to_status": "DIRTY", "at": "2026-06-28T08:00:00"},
        {"room_id": "room-201", "to_status": "OOO", "at": "2026-06-30T00:00:00"},
        # never transitions away from OOO before window_end -> closed at window_end
    ]

    result = calculate_room_downtime_hours(transitions, window_end=window_end)

    # OOO opened 2026-06-30T00:00:00, closed at window_end 2026-07-01T12:00:00 = 36 hours
    assert result["total_downtime_hours"] == 36.0
    assert result["rooms"] == [{"room_id": "room-201", "downtime_hours": 36.0}]
    assert result["rooms_affected"] == 1


def test_room_downtime_ignores_unmatched_close():
    window_end = datetime(2026, 7, 1, 0, 0, 0)
    transitions = [
        # a close event ("CLEAN") with no preceding OOO open -> ignored
        {"room_id": "room-202", "to_status": "CLEAN", "at": "2026-06-01T08:00:00"},
    ]

    result = calculate_room_downtime_hours(transitions, window_end=window_end)

    assert result["total_downtime_hours"] == 0.0
    assert result["rooms"] == []
    assert result["rooms_affected"] == 0


def test_room_downtime_closed_interval_sums_correctly():
    window_end = datetime(2026, 7, 1, 0, 0, 0)
    transitions = [
        {"room_id": "room-203", "to_status": "OOO", "at": "2026-06-10T00:00:00"},
        {"room_id": "room-203", "to_status": "CLEAN", "at": "2026-06-12T00:00:00"},
    ]

    result = calculate_room_downtime_hours(transitions, window_end=window_end)

    # 2 full days = 48 hours, interval already closed so window_end is irrelevant
    assert result["total_downtime_hours"] == 48.0
    assert result["rooms"] == [{"room_id": "room-203", "downtime_hours": 48.0}]


# ---------------------------------------------------------------------------
# calculate_downtime_revenue_impact (D-07)
# ---------------------------------------------------------------------------


def test_revenue_impact_is_hours_times_adr_over_24():
    result = calculate_downtime_revenue_impact(
        downtime_hours=48.0, average_daily_rate_cents=12000
    )

    assert result == {
        "configured": True,
        "average_daily_rate_cents": 12000,
        "downtime_hours": 48.0,
        "revenue_impact_cents": 24000,
    }


def test_revenue_impact_reports_unconfigured_when_adr_is_null():
    result = calculate_downtime_revenue_impact(
        downtime_hours=48.0, average_daily_rate_cents=None
    )

    assert result == {
        "configured": False,
        "average_daily_rate_cents": None,
        "downtime_hours": 48.0,
        "revenue_impact_cents": None,
    }


# ---------------------------------------------------------------------------
# calculate_housekeeping_efficiency
# ---------------------------------------------------------------------------


def test_housekeeping_efficiency_minutes_per_occupied_room():
    clean_sessions = [
        {"room_id": "room-1", "room_type_id": "standard", "date": "2026-07-01", "minutes": 30},
        {"room_id": "room-2", "room_type_id": "standard", "date": "2026-07-01", "minutes": 40},
    ]
    baselines = {"standard": 35.0}

    result = calculate_housekeeping_efficiency(
        clean_sessions, room_type_baselines=baselines
    )

    assert result["occupied_room_days"] == 2
    assert result["total_clean_minutes"] == 70.0
    assert result["minutes_per_occupied_room"] == 35.0
    assert result["by_room_type"] == [
        {
            "room_type_id": "standard",
            "sessions": 2,
            "avg_minutes": 35.0,
            "baseline_minutes": 35.0,
            "variance_minutes": 0.0,
            "variance_pct": 0.0,
        }
    ]
    assert "definition" in result


def test_housekeeping_efficiency_missing_baseline_reports_none():
    clean_sessions = [
        {"room_id": "room-3", "room_type_id": "suite", "date": "2026-07-01", "minutes": 60},
    ]

    result = calculate_housekeeping_efficiency(clean_sessions, room_type_baselines={})

    assert result["by_room_type"] == [
        {
            "room_type_id": "suite",
            "sessions": 1,
            "avg_minutes": 60.0,
            "baseline_minutes": None,
            "variance_minutes": None,
            "variance_pct": None,
        }
    ]


def test_housekeeping_efficiency_empty_input_returns_zero_shape():
    result = calculate_housekeeping_efficiency([], room_type_baselines={})

    assert result["occupied_room_days"] == 0
    assert result["total_clean_minutes"] == 0.0
    assert result["minutes_per_occupied_room"] == 0.0
    assert result["by_room_type"] == []


# ---------------------------------------------------------------------------
# calculate_inspection_trends
# ---------------------------------------------------------------------------


def test_inspection_trends_conditional_is_not_a_pass():
    inspections = [
        {"id": "i1", "overall_result": "passed"},
        {"id": "i2", "overall_result": "conditional"},
        {"id": "i3", "overall_result": "failed"},
    ]

    result = calculate_inspection_trends(inspections, [])

    assert result["total_inspections"] == 3
    assert result["passed"] == 1
    assert result["conditional"] == 1
    assert result["failed"] == 1
    assert result["pass_rate_pct"] == 33.3


def test_inspection_trends_repeat_defect_requires_two_inspections():
    inspections = [
        {"id": "i1", "overall_result": "failed"},
        {"id": "i2", "overall_result": "failed"},
        {"id": "i3", "overall_result": "failed"},
    ]
    inspection_results = [
        {"inspection_id": "i1", "template_item_id": "item-a", "result": "fail"},
        {"inspection_id": "i2", "template_item_id": "item-a", "result": "fail"},
        {"inspection_id": "i3", "template_item_id": "item-b", "result": "fail"},
    ]

    result = calculate_inspection_trends(inspections, inspection_results)

    assert result["repeat_defect_count"] == 1
    assert result["repeat_defects"] == [
        {"template_item_id": "item-a", "fail_count": 2, "inspection_count": 2}
    ]


# ---------------------------------------------------------------------------
# calculate_pm_compliance
# ---------------------------------------------------------------------------


def test_pm_compliance_rates_from_completion_and_deferral_tables():
    active_schedules = [{"id": "sched-1"}, {"id": "sched-2"}]
    completions = [{"pm_schedule_id": "sched-1"}]
    deferrals = [
        {"pm_schedule_id": "sched-2"},
        {"pm_schedule_id": "sched-2"},
    ]

    result = calculate_pm_compliance(active_schedules, completions, deferrals)

    assert result["active_schedules"] == 2
    assert result["completed_schedules"] == 1
    assert result["completion_rate_pct"] == 50.0
    assert result["deferred_schedules"] == 1
    assert result["deferral_rate_pct"] == 50.0
    assert result["repeated_deferrals"] == [{"pm_schedule_id": "sched-2", "deferral_count": 2}]
    assert result["repeated_deferral_count"] == 1


def test_pm_compliance_zero_active_schedules_does_not_divide_by_zero():
    result = calculate_pm_compliance([], [], [])

    assert result["completion_rate_pct"] == 0.0
    assert result["deferral_rate_pct"] == 0.0
    assert result["active_schedules"] == 0


# ---------------------------------------------------------------------------
# calculate_training_readiness
# ---------------------------------------------------------------------------


def test_training_readiness_counts_overdue():
    as_of = date(2026, 7, 24)
    assignments = [
        {"id": "a1", "completed_at": "2026-07-01T00:00:00+00:00", "due_date": "2026-07-05"},
        {"id": "a2", "completed_at": None, "due_date": "2026-07-01"},
        {"id": "a3", "completed_at": None, "due_date": "2026-08-01"},
    ]

    result = calculate_training_readiness(assignments, as_of=as_of)

    assert result["total_assignments"] == 3
    assert result["completed"] == 1
    assert result["outstanding"] == 2
    assert result["overdue"] == 1
    assert result["readiness_pct"] == 33.3


def test_training_readiness_empty_input_returns_zero_shape():
    result = calculate_training_readiness([], as_of=date(2026, 7, 24))

    assert result["total_assignments"] == 0
    assert result["readiness_pct"] == 0.0
    assert result["overdue"] == 0


# ---------------------------------------------------------------------------
# project_seven_day_labor_forecast (D-09)
# ---------------------------------------------------------------------------


def test_forecast_returns_seven_consecutive_days():
    result = project_seven_day_labor_forecast([], {}, start_date=date(2026, 8, 1))

    assert len(result) == 7
    assert [entry["date"] for entry in result] == [
        "2026-08-01",
        "2026-08-02",
        "2026-08-03",
        "2026-08-04",
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
    ]


def test_forecast_uses_trailing_weekday_average():
    # Four prior Mondays (2026-08-03 is a Monday) with 10, 12, 14, 16 rooms
    # of one room type whose avg clean time is 30 minutes.
    historical_completions = [
        {"date": "2026-07-27", "room_type_id": "standard", "rooms": 10},
        {"date": "2026-07-20", "room_type_id": "standard", "rooms": 12},
        {"date": "2026-07-13", "room_type_id": "standard", "rooms": 14},
        {"date": "2026-07-06", "room_type_id": "standard", "rooms": 16},
    ]

    result = project_seven_day_labor_forecast(
        historical_completions, {"standard": 30.0}, start_date=date(2026, 8, 1)
    )
    monday_entry = next(entry for entry in result if entry["date"] == "2026-08-03")

    # mean(10, 12, 14, 16) = 13 rooms; 13 rooms x 30 min / 60 = 6.5 hours
    assert monday_entry["projected_rooms"] == 13
    assert monday_entry["projected_labor_hours"] == 6.5
    assert monday_entry["confidence"] == "high"


def test_forecast_labor_hours_use_room_type_clean_minutes():
    historical_completions = [
        {"date": "2026-07-27", "room_type_id": "standard", "rooms": 10},
        {"date": "2026-07-27", "room_type_id": "suite", "rooms": 4},
    ]

    result = project_seven_day_labor_forecast(
        historical_completions,
        {"standard": 30.0, "suite": 60.0},
        start_date=date(2026, 8, 1),
    )
    monday_entry = next(entry for entry in result if entry["date"] == "2026-08-03")

    # standard: 10 rooms x 30min/60 = 5.0h; suite: 4 rooms x 60min/60 = 4.0h
    assert monday_entry["projected_rooms"] == 14
    assert monday_entry["projected_labor_hours"] == 9.0
    by_type = {row["room_type_id"]: row for row in monday_entry["by_room_type"]}
    assert by_type["standard"] == {
        "room_type_id": "standard",
        "projected_rooms": 10,
        "projected_labor_hours": 5.0,
    }
    assert by_type["suite"] == {
        "room_type_id": "suite",
        "projected_rooms": 4,
        "projected_labor_hours": 4.0,
    }


def test_forecast_falls_back_to_default_clean_minutes():
    historical_completions = [
        {"date": "2026-07-27", "room_type_id": "economy", "rooms": 8},
    ]

    result = project_seven_day_labor_forecast(
        historical_completions, {}, start_date=date(2026, 8, 1)
    )
    monday_entry = next(entry for entry in result if entry["date"] == "2026-08-03")

    # no baseline for "economy" -> falls back to default_clean_minutes=30
    assert monday_entry["projected_rooms"] == 8
    assert monday_entry["projected_labor_hours"] == 4.0


def test_forecast_confidence_low_with_single_observation():
    historical_completions = [
        {"date": "2026-07-27", "room_type_id": "standard", "rooms": 10},
    ]

    result = project_seven_day_labor_forecast(
        historical_completions, {"standard": 30.0}, start_date=date(2026, 8, 1)
    )
    monday_entry = next(entry for entry in result if entry["date"] == "2026-08-03")

    assert monday_entry["confidence"] == "low"


def test_forecast_empty_history_returns_seven_zero_days():
    result = project_seven_day_labor_forecast([], {}, start_date=date(2026, 8, 1))

    assert len(result) == 7
    for entry in result:
        assert entry["projected_rooms"] == 0
        assert entry["projected_labor_hours"] == 0.0
        assert entry["confidence"] == "low"


# ---------------------------------------------------------------------------
# Router-level tests: apps/api/routers/management_roi.py
#
# Mirrors the TestClient + monkeypatch(supabase, FakeDB) harness from
# test_programs_routes.py — real router, real RBAC, fake in-memory DB.
# ---------------------------------------------------------------------------

import json

from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import management_roi as management_roi_router
from tests.smoke.fake_supabase import FakeDB

NON_GM_ROLES = ("engineer", "housekeeping_supervisor", "front_desk", "housekeeper")


def _auth_header(role: str, hotel_id: str = "hotel-a", user_id: str = "user-a-1") -> dict[str, str]:
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _roi_url(path: str) -> str:
    return f"/v1{management_roi_router.router.prefix}{path}"


def test_roi_repeat_failures_requires_gm_role(monkeypatch):
    monkeypatch.setattr(management_roi_router, "supabase", FakeDB())
    client = TestClient(app)

    for role in NON_GM_ROLES:
        response = client.get(_roi_url("/repeat-failures"), headers=_auth_header(role))
        assert response.status_code == 403, f"{role} should be blocked from ROI endpoints"

    gm_response = client.get(_roi_url("/repeat-failures"), headers=_auth_header("gm"))
    assert gm_response.status_code == 200


def test_roi_repeat_failures_defaults_to_ninety_day_window(monkeypatch):
    db = FakeDB({
        "work_orders": [
            {"id": "wo-1", "tenant_id": "hotel-a", "asset_id": "asset-1", "room_id": None, "category": "hvac", "created_at": "2026-06-01T00:00:00+00:00"},
        ],
    })
    monkeypatch.setattr(management_roi_router, "supabase", db)
    client = TestClient(app)
    response = client.get(_roi_url("/repeat-failures"), headers=_auth_header("gm"))

    assert response.status_code == 200
    body = response.json()["data"]
    today = date.today()
    expected_start = (today - timedelta(days=90)).isoformat()
    assert body["period"]["start"] == expected_start
    assert body["period"]["end"] == today.isoformat()
    assert body["window_days"] == 90


def test_roi_downtime_revenue_uses_tenant_adr(monkeypatch):
    db = FakeDB({
        "tenants": [{"id": "hotel-a", "average_daily_rate_cents": 12000}],
        "room_status_history": [
            {"room_id": "room-201", "tenant_id": "hotel-a", "to_status": "OOO", "created_at": "2026-07-01T00:00:00+00:00"},
            {"room_id": "room-201", "tenant_id": "hotel-a", "to_status": "CLEAN", "created_at": "2026-07-03T00:00:00+00:00"},
        ],
    })
    monkeypatch.setattr(management_roi_router, "supabase", db)
    client = TestClient(app)

    response = client.get(_roi_url("/downtime-revenue"), headers=_auth_header("gm"))

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["downtime"]["total_downtime_hours"] == 48.0
    assert body["revenue"]["configured"] is True
    assert body["revenue"]["revenue_impact_cents"] == 24000


def test_roi_downtime_revenue_reports_unconfigured_adr(monkeypatch):
    db = FakeDB({
        "tenants": [{"id": "hotel-a", "average_daily_rate_cents": None}],
        "room_status_history": [],
    })
    monkeypatch.setattr(management_roi_router, "supabase", db)
    client = TestClient(app)

    response = client.get(_roi_url("/downtime-revenue"), headers=_auth_header("gm"))

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["revenue"]["configured"] is False
    assert body["revenue"]["revenue_impact_cents"] is None


def test_roi_endpoints_are_tenant_scoped(monkeypatch):
    db = FakeDB({
        "work_orders": [
            {"id": "wo-b1", "tenant_id": "hotel-b", "asset_id": "TENANT-B-LEAK-asset", "room_id": None, "category": "hvac", "created_at": "2026-07-01T00:00:00+00:00"},
            {"id": "wo-b2", "tenant_id": "hotel-b", "asset_id": "TENANT-B-LEAK-asset", "room_id": None, "category": "hvac", "created_at": "2026-07-05T00:00:00+00:00"},
        ],
    })
    monkeypatch.setattr(management_roi_router, "supabase", db)
    client = TestClient(app)

    response = client.get(_roi_url("/repeat-failures"), headers=_auth_header("gm", hotel_id="hotel-a"))

    assert response.status_code == 200
    assert "TENANT-B-LEAK" not in json.dumps(response.json())


# ---------------------------------------------------------------------------
# Task 2 router tests: housekeeping-efficiency, inspection-trends,
# pm-compliance, training-readiness
# ---------------------------------------------------------------------------


def test_roi_housekeeping_efficiency_pairs_in_progress_to_clean(monkeypatch):
    db = FakeDB({
        "rooms": [{"id": "room-1", "tenant_id": "hotel-a", "room_type_id": "standard"}],
        "room_types": [{"id": "standard", "tenant_id": "hotel-a", "base_clean_minutes": 30}],
        "room_status_history": [
            {"room_id": "room-1", "tenant_id": "hotel-a", "to_status": "IN_PROGRESS", "created_at": "2026-07-01T08:00:00+00:00"},
            {"room_id": "room-1", "tenant_id": "hotel-a", "to_status": "CLEAN", "created_at": "2026-07-01T08:30:00+00:00"},
        ],
    })
    monkeypatch.setattr(management_roi_router, "supabase", db)
    client = TestClient(app)

    response = client.get(_roi_url("/housekeeping-efficiency"), headers=_auth_header("gm"))

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["occupied_room_days"] == 1
    assert body["total_clean_minutes"] == 30.0
    assert body["by_room_type"][0]["room_type_id"] == "standard"
    assert body["by_room_type"][0]["baseline_minutes"] == 30


def test_roi_inspection_trends_skips_result_query_when_no_inspections(monkeypatch):
    class _CountingDB(FakeDB):
        def __init__(self, rows=None):
            super().__init__(rows)
            self.table_calls: list[str] = []

        def table(self, name):
            self.table_calls.append(name)
            return super().table(name)

    db = _CountingDB({"inspections": []})
    monkeypatch.setattr(management_roi_router, "supabase", db)
    client = TestClient(app)

    response = client.get(_roi_url("/inspection-trends"), headers=_auth_header("gm"))

    assert response.status_code == 200
    assert "inspection_results" not in db.table_calls


def test_roi_pm_compliance_reads_pm_deferrals_table(monkeypatch):
    db = FakeDB({
        "pm_schedules": [
            {"id": "sched-1", "tenant_id": "hotel-a", "asset_id": "asset-1", "name": "HVAC PM", "next_due_at": "2026-08-01T00:00:00+00:00", "is_active": True},
            {"id": "sched-2", "tenant_id": "hotel-a", "asset_id": "asset-2", "name": "Boiler PM", "next_due_at": "2026-08-01T00:00:00+00:00", "is_active": True},
        ],
        "pm_completion_records": [
            {"pm_schedule_id": "sched-1", "tenant_id": "hotel-a", "labor_minutes": 60, "completed_at": "2026-07-10T00:00:00+00:00"},
        ],
        "pm_deferrals": [
            {"pm_schedule_id": "sched-2", "tenant_id": "hotel-a", "deferred_until": "2026-08-01T00:00:00+00:00", "created_at": "2026-07-10T00:00:00+00:00"},
            {"pm_schedule_id": "sched-2", "tenant_id": "hotel-a", "deferred_until": "2026-08-05T00:00:00+00:00", "created_at": "2026-07-15T00:00:00+00:00"},
        ],
    })
    monkeypatch.setattr(management_roi_router, "supabase", db)
    client = TestClient(app)

    response = client.get(_roi_url("/pm-compliance"), headers=_auth_header("gm"))

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["active_schedules"] == 2
    assert body["completed_schedules"] == 1
    assert body["repeated_deferrals"] == [{"pm_schedule_id": "sched-2", "deferral_count": 2}]


def test_roi_training_readiness_returns_point_in_time_state(monkeypatch):
    db = FakeDB({
        "safety_training_assignments": [
            {"id": "a1", "tenant_id": "hotel-a", "course_id": "c1", "employee_id": "e1", "due_date": "2026-07-01", "completed_at": "2026-06-30T00:00:00+00:00"},
            {"id": "a2", "tenant_id": "hotel-a", "course_id": "c1", "employee_id": "e2", "due_date": "2026-07-01", "completed_at": None},
        ],
    })
    monkeypatch.setattr(management_roi_router, "supabase", db)
    client = TestClient(app)

    response = client.get(_roi_url("/training-readiness"), headers=_auth_header("gm"))

    assert response.status_code == 200
    body = response.json()["data"]
    assert "generated_for" in body
    assert body["total_assignments"] == 2
    assert body["completed"] == 1
    assert body["readiness_pct"] == 50.0


def test_roi_empty_tenant_returns_zero_shapes_not_500(monkeypatch):
    monkeypatch.setattr(management_roi_router, "supabase", FakeDB())
    client = TestClient(app)

    for path in (
        "/repeat-failures",
        "/downtime-revenue",
        "/housekeeping-efficiency",
        "/inspection-trends",
        "/pm-compliance",
        "/training-readiness",
    ):
        response = client.get(_roi_url(path), headers=_auth_header("gm"))
        assert response.status_code == 200, f"{path} should return 200 for an empty tenant, got {response.status_code}"

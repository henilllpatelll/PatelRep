"""Fixture-reconcilable coverage for Phase 5 management ROI calculators.

Style follows test_guest_recovery.py: direct imports, literal fixture dicts,
plain asserts, no mocks.
"""

from datetime import date, datetime, timezone

from services.guest_recovery.contracts import (
    calculate_downtime_revenue_impact,
    calculate_housekeeping_efficiency,
    calculate_inspection_trends,
    calculate_pm_compliance,
    calculate_repeat_failures,
    calculate_room_downtime_hours,
    calculate_training_readiness,
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

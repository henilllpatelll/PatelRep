"""Deterministic, tenant-scoped Engineering reporting calculations.

The router is responsible for fetching only records belonging to one tenant.
This module deliberately contains no database access, which keeps KPI definitions
testable and prevents browser-side reimplementation of operational metrics.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Any


FIRST_TIME_FIX_MATURITY_DAYS = 30


def _timestamp(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _in_window(value: Any, start: datetime, end: datetime) -> bool:
    instant = _timestamp(value)
    return bool(instant and start <= instant <= end)


def _minutes(start: Any, end: Any) -> int | None:
    left, right = _timestamp(start), _timestamp(end)
    if not left or not right or right < left:
        return None
    return int((right - left).total_seconds() // 60)


def _median(values: list[int | float]) -> int | None:
    return int(median(values)) if values else None


def _overlap_minutes(started_at: Any, ended_at: Any, window_start: datetime, window_end: datetime) -> int:
    started = _timestamp(started_at)
    ended = _timestamp(ended_at) or window_end
    if not started or ended <= window_start or started >= window_end:
        return 0
    return max(0, int((min(ended, window_end) - max(started, window_start)).total_seconds() // 60))


def _money(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def build_engineering_insights(
    *,
    work_orders: list[dict],
    vendor_engagements: list[dict],
    room_periods: list[dict],
    asset_downtime: list[dict],
    pm_completions: list[dict],
    condition_readings: list[dict],
    vendors: list[dict],
    relationships: list[dict],
    labor_sessions: list[dict],
    start: datetime,
    end: datetime,
    now: datetime | None = None,
    assets: list[dict] | None = None,
    pm_schedules: list[dict] | None = None,
) -> dict:
    """Build an honest reporting snapshot for one tenant and date window.

    Missing timestamp/cost fields are excluded from their own metric population;
    they never become zero. Durations crossing a reporting boundary are clipped,
    while asset failure events remain scoped to an unplanned downtime *start*.
    """
    now = now or datetime.now(timezone.utc)
    created_in_window = [wo for wo in work_orders if _in_window(wo.get("created_at"), start, end)]
    completed_in_window = [wo for wo in work_orders if _in_window(wo.get("completed_at"), start, end)]

    response = [_minutes(wo.get("created_at"), wo.get("acknowledged_at")) for wo in created_in_window]
    arrival = [_minutes(wo.get("created_at"), wo.get("arrived_at")) for wo in created_in_window]
    resolution = [_minutes(wo.get("created_at"), wo.get("completed_at")) for wo in completed_in_window]
    response = [value for value in response if value is not None]
    arrival = [value for value in arrival if value is not None]
    resolution = [value for value in resolution if value is not None]
    active_labor = [
        float(session["duration_minutes"])
        for session in labor_sessions
        if session.get("ended_at") and _in_window(session.get("ended_at"), start, end)
        and session.get("duration_minutes") is not None
    ]

    repeat_parent_ids = {
        relationship.get("parent_work_order_id")
        for relationship in relationships
        if relationship.get("relationship_type") == "repeat_failure"
    }
    mature_completed = [
        wo for wo in completed_in_window
        if wo.get("verification_result") == "passed"
        and (_timestamp(wo.get("completed_at")) or now) <= now - timedelta(days=FIRST_TIME_FIX_MATURITY_DAYS)
    ]
    first_time_fixed = [wo for wo in mature_completed if wo.get("id") not in repeat_parent_ids]

    cost_rows = [
        wo for wo in completed_in_window
        if any(_money(wo.get(key)) is not None for key in ("labor_cost", "parts_cost", "vendor_cost"))
    ]
    labor = sum(_money(wo.get("labor_cost")) or 0 for wo in cost_rows)
    parts = sum(_money(wo.get("parts_cost")) or 0 for wo in cost_rows)
    vendor_cost = sum(_money(wo.get("vendor_cost")) or 0 for wo in cost_rows)

    overlapping_rooms = [
        period for period in room_periods
        if _overlap_minutes(period.get("started_at"), period.get("actual_return_at"), start, end) > 0
    ]
    room_durations = [
        _overlap_minutes(period.get("started_at"), period.get("actual_return_at"), start, end)
        for period in overlapping_rooms
        if period.get("actual_return_at")
    ]
    post_repair = [
        _minutes(period.get("repair_completed_at"), period.get("actual_return_at"))
        for period in room_periods
        if _in_window(period.get("actual_return_at"), start, end)
    ]
    room_reasons: dict[str, int] = {}
    for period in overlapping_rooms:
        label = period.get("reason_label") or "Other"
        room_reasons[label] = room_reasons.get(label, 0) + 1

    unplanned = [period for period in asset_downtime if period.get("downtime_type") == "unplanned"]
    failure_periods = [period for period in unplanned if _in_window(period.get("started_at"), start, end)]
    asset_minutes = sum(_overlap_minutes(period.get("started_at"), period.get("restored_at"), start, end) for period in unplanned)
    current_asset_ids = {
        period.get("asset_id") for period in asset_downtime
        if period.get("restored_at") is None and _timestamp(period.get("started_at")) and _timestamp(period.get("started_at")) <= now
    }
    asset_index = {asset.get("id"): asset for asset in assets or []}
    asset_aggregate: dict[str, dict] = {}
    for period in unplanned:
        asset_id = period.get("asset_id")
        if not asset_id:
            continue
        bucket = asset_aggregate.setdefault(asset_id, {"asset_id": asset_id, "failures": 0, "downtime_minutes": 0})
        if _in_window(period.get("started_at"), start, end):
            bucket["failures"] += 1
        bucket["downtime_minutes"] += _overlap_minutes(period.get("started_at"), period.get("restored_at"), start, end)
    attention = []
    for item in asset_aggregate.values():
        asset = asset_index.get(item["asset_id"], {})
        attention.append({**item, "name": asset.get("name") or "Asset", "currently_down": item["asset_id"] in current_asset_ids})
    attention.sort(key=lambda item: (not item["currently_down"], -item["downtime_minutes"], -item["failures"], item["name"]))

    completed_pm = [record for record in pm_completions if _in_window(record.get("completed_at"), start, end)]
    overdue_pm = [schedule for schedule in pm_schedules or [] if schedule.get("is_active", True) and _timestamp(schedule.get("next_due_at")) and _timestamp(schedule.get("next_due_at")) < now]
    due_pm = [schedule for schedule in pm_schedules or [] if _timestamp(schedule.get("next_due_at")) and _timestamp(schedule.get("next_due_at")) <= end]
    pm_compliance = round((len(completed_pm) / len(due_pm)) * 100, 1) if due_pm else None

    readings_in_window = [reading for reading in condition_readings if _in_window(reading.get("recorded_at"), start, end)]
    critical = [reading for reading in readings_in_window if reading.get("status_at_recording") == "critical"]
    warning = [reading for reading in readings_in_window if reading.get("status_at_recording") == "warning"]
    corrective_ids = {reading.get("corrective_work_order_id") for reading in readings_in_window if reading.get("corrective_work_order_id")}

    completed_vendor_jobs = [engagement for engagement in vendor_engagements if _in_window(engagement.get("completed_at"), start, end)]
    vendor_arrivals = [_minutes(item.get("requested_at"), item.get("arrived_at")) for item in completed_vendor_jobs]
    vendor_responses = [_minutes(item.get("requested_at"), item.get("accepted_at")) for item in completed_vendor_jobs]
    vendor_service = [_minutes(item.get("arrived_at"), item.get("completed_at")) for item in completed_vendor_jobs]
    vendor_arrivals = [value for value in vendor_arrivals if value is not None]
    vendor_responses = [value for value in vendor_responses if value is not None]
    vendor_service = [value for value in vendor_service if value is not None]
    vendor_index = {vendor.get("id"): vendor for vendor in vendors}
    vendor_rollups: dict[str, dict] = {}
    for engagement in completed_vendor_jobs:
        vendor_id = engagement.get("vendor_id")
        if not vendor_id:
            continue
        rollup = vendor_rollups.setdefault(vendor_id, {"vendor_id": vendor_id, "jobs": 0, "spend": 0.0})
        rollup["jobs"] += 1
        rollup["spend"] += _money(engagement.get("invoice_amount")) or 0
    vendor_top = [
        {**rollup, "name": vendor_index.get(vendor_id, {}).get("name") or "Vendor"}
        for vendor_id, rollup in vendor_rollups.items()
    ]
    vendor_top.sort(key=lambda item: (-item["jobs"], -item["spend"], item["name"]))

    return {
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "work_orders": {
            "created": len(created_in_window), "completed": len(completed_in_window),
            "median_response_minutes": _median(response), "median_arrival_minutes": _median(arrival),
            "median_resolution_minutes": _median(resolution), "median_active_labor_minutes": _median(active_labor),
            "response_coverage": {"tracked": len(response), "eligible": len(created_in_window)},
            "arrival_coverage": {"tracked": len(arrival), "eligible": len(created_in_window)},
            "resolution_coverage": {"tracked": len(resolution), "eligible": len(completed_in_window)},
            "first_time_fix": {"passed": len(first_time_fixed), "eligible": len(mature_completed), "percentage": round((len(first_time_fixed) / len(mature_completed)) * 100, 1) if mature_completed else None},
        },
        "rooms": {
            "affected": len(overlapping_rooms), "downtime_minutes": sum(room_durations), "median_downtime_minutes": _median(room_durations),
            "past_eta": sum(1 for period in room_periods if period.get("status") == "ACTIVE" and _timestamp(period.get("expected_return_at")) and _timestamp(period.get("expected_return_at")) < now),
            "median_post_repair_turnaround_minutes": _median([value for value in post_repair if value is not None]),
            "reasons": sorted(({"label": label, "count": count} for label, count in room_reasons.items()), key=lambda item: (-item["count"], item["label"])),
        },
        "assets": {"failures": len(failure_periods), "unplanned_downtime_minutes": asset_minutes, "assets_down_now": len(current_asset_ids), "attention": attention[:5]},
        "preventive": {"completed": len(completed_pm), "overdue": len(overdue_pm), "compliance_percentage": pm_compliance, "due": len(due_pm)},
        "condition": {"critical_readings": len(critical), "warning_readings": len(warning), "corrective_work_orders": len(corrective_ids)},
        "costs": {"labor": labor, "parts": parts, "vendors": vendor_cost, "total": labor + parts + vendor_cost, "coverage": {"tracked": len(cost_rows), "eligible": len(completed_in_window)}},
        "vendors": {"jobs": len(completed_vendor_jobs), "spend": sum(_money(item.get("invoice_amount")) or 0 for item in completed_vendor_jobs), "median_response_minutes": _median(vendor_responses), "median_arrival_minutes": _median(vendor_arrivals), "median_service_minutes": _median(vendor_service), "awaiting": sum(1 for item in vendor_engagements if item.get("status") in {"requested", "accepted", "en_route"}), "top": vendor_top[:5]},
    }

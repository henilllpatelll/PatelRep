"""Pure Phase 5 guest recovery, custody, and ROI policy contracts."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any


class InvalidGuestRequestTransition(ValueError):
    """Raised when a request skips a required service milestone."""


class AccessibilityPriorityError(ValueError):
    """Raised when accessibility work is not treated as urgent."""


class MissingCustodyVerificationError(ValueError):
    """Raised when an item release has no identity-verification evidence."""


GUEST_REQUEST_STATUSES = (
    "open",
    "acknowledged",
    "dispatched",
    "arrived",
    "guest_contacted",
    "resolved",
    "verified",
    "reopened",
    "cancelled",
)

_ALLOWED_TRANSITIONS = {
    "open": {"acknowledged", "cancelled"},
    "acknowledged": {"dispatched", "cancelled"},
    "dispatched": {"arrived", "resolved", "cancelled"},
    "arrived": {"guest_contacted", "resolved", "cancelled"},
    "guest_contacted": {"resolved", "cancelled"},
    "resolved": {"verified", "reopened"},
    "verified": {"reopened"},
    "reopened": {"acknowledged", "cancelled"},
    "cancelled": set(),
}


def resolve_sla_minutes(
    policies: list[dict[str, Any]], *, category: str, priority: str, guest_impact: str
) -> int:
    """Choose the most specific matching tenant SLA policy, defaulting to four hours."""
    candidates = [
        policy for policy in policies
        if all(
            policy.get(field) in (None, value)
            for field, value in (("category", category), ("priority", priority), ("guest_impact", guest_impact))
        )
    ]
    if not candidates:
        return 240
    candidates.sort(
        key=lambda policy: sum(policy.get(field) is not None for field in ("category", "priority", "guest_impact")),
        reverse=True,
    )
    return int(candidates[0]["sla_minutes"])


def validate_guest_request_transition(
    *, current_status: str, next_status: str, category: str, priority: str
) -> None:
    if category == "accessibility" and priority != "urgent":
        raise AccessibilityPriorityError("Accessibility-related requests must use urgent priority")
    if next_status not in _ALLOWED_TRANSITIONS.get(current_status, set()):
        raise InvalidGuestRequestTransition(
            f"Cannot transition guest request from {current_status} to {next_status}"
        )


def validate_lost_found_custody_event(
    *, event_type: str, verification_method: str | None, recipient_name: str | None
) -> None:
    if event_type == "released" and (not verification_method or not recipient_name):
        raise MissingCustodyVerificationError(
            "Identity verification method and recipient name are required before release"
        )


def calculate_guest_request_metrics(requests: list[dict[str, Any]]) -> dict[str, float | int]:
    """Return deterministic, fixture-reconcilable guest recovery metrics."""
    total_requests = len(requests)
    if not total_requests:
        return {
            "total_requests": 0,
            "verified_resolution_rate_pct": 0.0,
            "sla_met_rate_pct": 0.0,
            "average_acknowledgement_minutes": 0.0,
            "average_verified_resolution_minutes": 0.0,
        }

    acknowledgement_minutes: list[float] = []
    verified_resolution_minutes: list[float] = []
    sla_met = 0
    verified = 0
    for request in requests:
        created_at = _parse_timestamp(request.get("created_at"))
        acknowledged_at = _parse_timestamp(request.get("acknowledged_at"))
        verified_at = _parse_timestamp(request.get("verified_at"))
        due_at = _parse_timestamp(request.get("due_at"))
        if created_at and acknowledged_at:
            acknowledgement_minutes.append((acknowledged_at - created_at).total_seconds() / 60)
        if request.get("status") == "verified" and verified_at:
            verified += 1
            if created_at:
                verified_resolution_minutes.append((verified_at - created_at).total_seconds() / 60)
            if due_at and verified_at <= due_at:
                sla_met += 1

    return {
        "total_requests": total_requests,
        "verified_resolution_rate_pct": round(verified / total_requests * 100, 1),
        "sla_met_rate_pct": round(sla_met / total_requests * 100, 1),
        "average_acknowledgement_minutes": _average(acknowledgement_minutes),
        "average_verified_resolution_minutes": _average(verified_resolution_minutes),
    }


def _parse_timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _average(values: list[float]) -> float:
    return round(sum(values) / len(values), 1) if values else 0.0


def calculate_repeat_failures(
    work_orders: list[dict[str, Any]],
    *,
    window_start: datetime,
    window_end: datetime,
    window_days: int = 90,
    minimum_failures: int = 2,
) -> dict[str, Any]:
    """D-08: an asset or room with 2+ work orders inside a trailing window is a repeat failure."""
    asset_counts: dict[str, int] = {}
    room_counts: dict[str, int] = {}

    for work_order in work_orders:
        created_at = _parse_timestamp(work_order.get("created_at"))
        if created_at is None or not (window_start <= created_at <= window_end):
            continue
        asset_id = work_order.get("asset_id")
        if asset_id is not None:
            asset_counts[asset_id] = asset_counts.get(asset_id, 0) + 1
        room_id = work_order.get("room_id")
        if room_id is not None:
            room_counts[room_id] = room_counts.get(room_id, 0) + 1

    repeat_assets = sorted(
        (
            {"asset_id": asset_id, "failure_count": count}
            for asset_id, count in asset_counts.items()
            if count >= minimum_failures
        ),
        key=lambda entry: entry["failure_count"],
        reverse=True,
    )
    repeat_rooms = sorted(
        (
            {"room_id": room_id, "failure_count": count}
            for room_id, count in room_counts.items()
            if count >= minimum_failures
        ),
        key=lambda entry: entry["failure_count"],
        reverse=True,
    )
    total_repeat_work_orders = sum(entry["failure_count"] for entry in repeat_assets) + sum(
        entry["failure_count"] for entry in repeat_rooms
    )

    return {
        "window_days": window_days,
        "repeat_asset_count": len(repeat_assets),
        "repeat_room_count": len(repeat_rooms),
        "repeat_assets": repeat_assets,
        "repeat_rooms": repeat_rooms,
        "total_repeat_work_orders": total_repeat_work_orders,
    }


def calculate_room_downtime_hours(
    transitions: list[dict[str, Any]],
    *,
    window_end: datetime,
    downtime_status: str = "OOO",
) -> dict[str, Any]:
    """Total out-of-order hours per room. `transitions` items: {"room_id", "to_status", "at"}."""
    by_room: dict[str, list[dict[str, Any]]] = {}
    for transition in transitions:
        room_id = transition.get("room_id")
        at = _parse_timestamp(transition.get("at"))
        if room_id is None or at is None:
            continue
        by_room.setdefault(room_id, []).append({"to_status": transition.get("to_status"), "at": at})

    room_hours: dict[str, float] = {}
    for room_id, room_transitions in by_room.items():
        room_transitions.sort(key=lambda entry: entry["at"])
        open_at: datetime | None = None
        total_hours = 0.0
        for entry in room_transitions:
            if entry["to_status"] == downtime_status:
                if open_at is None:
                    open_at = entry["at"]
            elif open_at is not None:
                delta_hours = (entry["at"] - open_at).total_seconds() / 3600
                total_hours += max(delta_hours, 0.0)
                open_at = None
        if open_at is not None:
            delta_hours = (window_end - open_at).total_seconds() / 3600
            total_hours += max(delta_hours, 0.0)
        if total_hours > 0:
            room_hours[room_id] = round(total_hours, 1)

    rooms = sorted(
        (
            {"room_id": room_id, "downtime_hours": hours}
            for room_id, hours in room_hours.items()
        ),
        key=lambda entry: entry["downtime_hours"],
        reverse=True,
    )
    total_downtime_hours = round(sum(room_hours.values()), 1)

    return {
        "total_downtime_hours": total_downtime_hours,
        "rooms": rooms,
        "rooms_affected": len(rooms),
    }


def calculate_downtime_revenue_impact(
    *, downtime_hours: float, average_daily_rate_cents: int | None
) -> dict[str, Any]:
    """D-07: revenue impact = downtime hours x (GM-configured ADR / 24). No external PMS dependency."""
    if average_daily_rate_cents is None:
        return {
            "configured": False,
            "average_daily_rate_cents": None,
            "downtime_hours": downtime_hours,
            "revenue_impact_cents": None,
        }
    revenue_impact_cents = int(round(downtime_hours * (average_daily_rate_cents / 24)))
    return {
        "configured": True,
        "average_daily_rate_cents": average_daily_rate_cents,
        "downtime_hours": downtime_hours,
        "revenue_impact_cents": revenue_impact_cents,
    }


def calculate_housekeeping_efficiency(
    clean_sessions: list[dict[str, Any]],
    *,
    room_type_baselines: dict[str, float],
) -> dict[str, Any]:
    """Minutes per occupied room and per-room-type cleaning-time variance.

    An 'occupied room day' is one distinct (room_id, date) pair with a completed clean
    session — this is the definition surfaced to the GM and must be stated in the payload.
    """
    occupied_room_days: set[tuple[Any, Any]] = set()
    total_clean_minutes = 0.0
    minutes_by_type: dict[str, list[float]] = {}

    for session in clean_sessions:
        room_id = session.get("room_id")
        session_date = session.get("date")
        minutes = float(session.get("minutes") or 0)
        occupied_room_days.add((room_id, session_date))
        total_clean_minutes += minutes
        room_type_id = session.get("room_type_id")
        if room_type_id is not None:
            minutes_by_type.setdefault(room_type_id, []).append(minutes)

    occupied_room_day_count = len(occupied_room_days)
    minutes_per_occupied_room = (
        round(total_clean_minutes / occupied_room_day_count, 1) if occupied_room_day_count else 0.0
    )

    by_room_type = []
    for room_type_id, minutes_list in minutes_by_type.items():
        avg_minutes = _average(minutes_list)
        baseline_minutes = room_type_baselines.get(room_type_id)
        if baseline_minutes is None:
            variance_minutes = None
            variance_pct = None
        else:
            variance_minutes = round(avg_minutes - baseline_minutes, 1)
            variance_pct = round((variance_minutes / baseline_minutes) * 100, 1) if baseline_minutes else 0.0
        by_room_type.append(
            {
                "room_type_id": room_type_id,
                "sessions": len(minutes_list),
                "avg_minutes": avg_minutes,
                "baseline_minutes": baseline_minutes,
                "variance_minutes": variance_minutes,
                "variance_pct": variance_pct,
            }
        )

    return {
        "occupied_room_days": occupied_room_day_count,
        "total_clean_minutes": round(total_clean_minutes, 1),
        "minutes_per_occupied_room": minutes_per_occupied_room,
        "by_room_type": by_room_type,
        "definition": "minutes_per_occupied_room = total clean minutes / distinct (room, day) clean sessions",
    }


def calculate_inspection_trends(
    inspections: list[dict[str, Any]],
    inspection_results: list[dict[str, Any]],
    *,
    repeat_threshold: int = 2,
) -> dict[str, Any]:
    """Pass rate and repeat-defect ranking. 'conditional' is not a pass."""
    total_inspections = len(inspections)
    passed = sum(1 for i in inspections if i.get("overall_result") == "passed")
    failed = sum(1 for i in inspections if i.get("overall_result") == "failed")
    conditional = sum(1 for i in inspections if i.get("overall_result") == "conditional")
    pass_rate_pct = round(passed / total_inspections * 100, 1) if total_inspections else 0.0

    fail_inspections_by_item: dict[str, set[str]] = {}
    for result in inspection_results:
        if result.get("result") != "fail":
            continue
        template_item_id = result.get("template_item_id")
        inspection_id = result.get("inspection_id")
        if template_item_id is None or inspection_id is None:
            continue
        fail_inspections_by_item.setdefault(template_item_id, set()).add(inspection_id)

    repeat_defects = sorted(
        (
            {
                "template_item_id": template_item_id,
                "fail_count": len(inspection_ids),
                "inspection_count": len(inspection_ids),
            }
            for template_item_id, inspection_ids in fail_inspections_by_item.items()
            if len(inspection_ids) >= repeat_threshold
        ),
        key=lambda entry: entry["fail_count"],
        reverse=True,
    )

    return {
        "total_inspections": total_inspections,
        "passed": passed,
        "failed": failed,
        "conditional": conditional,
        "pass_rate_pct": pass_rate_pct,
        "repeat_defects": repeat_defects,
        "repeat_defect_count": len(repeat_defects),
    }


def calculate_pm_compliance(
    active_schedules: list[dict[str, Any]],
    completions: list[dict[str, Any]],
    deferrals: list[dict[str, Any]],
    *,
    repeated_threshold: int = 2,
) -> dict[str, Any]:
    """Completion and deferral rates over pm_schedules / pm_completion_records / pm_deferrals."""
    active_count = len(active_schedules)

    completed_schedule_ids = {
        c.get("pm_schedule_id") for c in completions if c.get("pm_schedule_id") is not None
    }

    deferral_counts: dict[str, int] = {}
    for deferral in deferrals:
        pm_schedule_id = deferral.get("pm_schedule_id")
        if pm_schedule_id is None:
            continue
        deferral_counts[pm_schedule_id] = deferral_counts.get(pm_schedule_id, 0) + 1

    repeated_deferrals = sorted(
        (
            {"pm_schedule_id": pm_schedule_id, "deferral_count": count}
            for pm_schedule_id, count in deferral_counts.items()
            if count >= repeated_threshold
        ),
        key=lambda entry: entry["deferral_count"],
        reverse=True,
    )

    completion_rate_pct = round(len(completed_schedule_ids) / active_count * 100, 1) if active_count else 0.0
    deferral_rate_pct = round(len(deferral_counts) / active_count * 100, 1) if active_count else 0.0

    return {
        "active_schedules": active_count,
        "completed_schedules": len(completed_schedule_ids),
        "completion_rate_pct": completion_rate_pct,
        "deferred_schedules": len(deferral_counts),
        "deferral_rate_pct": deferral_rate_pct,
        "repeated_deferrals": repeated_deferrals,
        "repeated_deferral_count": len(repeated_deferrals),
    }


def calculate_training_readiness(
    assignments: list[dict[str, Any]], *, as_of: date
) -> dict[str, Any]:
    """Training/compliance readiness from safety_training_assignments."""
    total_assignments = len(assignments)
    completed = 0
    overdue = 0

    for assignment in assignments:
        completed_at = assignment.get("completed_at")
        if completed_at:
            completed += 1
            continue
        due_date_raw = assignment.get("due_date")
        if due_date_raw:
            due_date = due_date_raw if isinstance(due_date_raw, date) else date.fromisoformat(str(due_date_raw))
            if due_date < as_of:
                overdue += 1

    outstanding = total_assignments - completed
    readiness_pct = round(completed / total_assignments * 100, 1) if total_assignments else 0.0

    return {
        "total_assignments": total_assignments,
        "completed": completed,
        "outstanding": outstanding,
        "overdue": overdue,
        "readiness_pct": readiness_pct,
    }


def project_seven_day_labor_forecast(
    historical_completions: list[dict[str, Any]],
    avg_clean_minutes_by_room_type: dict[str, float],
    *,
    start_date: date,
    horizon_days: int = 7,
    lookback_weeks: int = 4,
    default_clean_minutes: float = 30.0,
) -> list[dict[str, Any]]:
    """D-09: trailing weekday-average capacity projection.

    `historical_completions` items: {"date": "YYYY-MM-DD", "room_type_id": str, "rooms": int}.
    Deliberately NOT occupancy-based: no reliable multi-day-forward check-in data exists
    outside the pilot-gated PMS sync, so an occupancy projection would read as zero for
    every standalone hotel. This projects turnover capacity from observed history instead.
    """
    lookback_days = lookback_weeks * 7
    buckets: dict[tuple[int, str], list[float]] = {}

    for row in historical_completions:
        row_date_raw = row.get("date")
        room_type_id = row.get("room_type_id")
        rooms = row.get("rooms")
        if not row_date_raw or room_type_id is None or rooms is None:
            continue
        row_date = row_date_raw if isinstance(row_date_raw, date) else date.fromisoformat(str(row_date_raw))
        delta_days = (start_date - row_date).days
        if delta_days < 0 or delta_days > lookback_days:
            continue
        buckets.setdefault((row_date.weekday(), room_type_id), []).append(float(rooms))

    results: list[dict[str, Any]] = []
    for offset in range(horizon_days):
        target_date = start_date + timedelta(days=offset)
        weekday = target_date.weekday()

        by_room_type: list[dict[str, Any]] = []
        total_rooms = 0.0
        total_labor_hours = 0.0
        max_observations = 0

        for (bucket_weekday, room_type_id), rooms_observations in buckets.items():
            if bucket_weekday != weekday:
                continue
            avg_rooms = sum(rooms_observations) / len(rooms_observations)
            clean_minutes = avg_clean_minutes_by_room_type.get(room_type_id, default_clean_minutes)
            labor_hours = avg_rooms * clean_minutes / 60
            by_room_type.append(
                {
                    "room_type_id": room_type_id,
                    "projected_rooms": round(avg_rooms),
                    "projected_labor_hours": round(labor_hours, 1),
                }
            )
            total_rooms += avg_rooms
            total_labor_hours += labor_hours
            max_observations = max(max_observations, len(rooms_observations))

        if max_observations >= 4:
            confidence = "high"
        elif max_observations >= 2:
            confidence = "medium"
        else:
            confidence = "low"

        results.append(
            {
                "date": target_date.isoformat(),
                "weekday": weekday,
                "projected_rooms": round(total_rooms),
                "projected_labor_hours": round(total_labor_hours, 1),
                "confidence": confidence,
                "by_room_type": by_room_type,
            }
        )

    return results

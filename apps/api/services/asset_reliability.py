"""Tenant-scoped asset downtime mutations and reliability calculations."""

from datetime import datetime, timedelta, timezone
from typing import Any

REPORTING_DAYS = 365
FIRST_TIME_FIX_MATURITY_DAYS = 30


def start_asset_downtime(*, db: Any, asset_id: str, tenant_id: str, actor_id: str, payload: dict) -> dict:
    return db.rpc("start_asset_downtime", {
        "p_asset_id": asset_id, "p_tenant_id": tenant_id, "p_work_order_id": payload.get("work_order_id"),
        "p_downtime_type": payload.get("downtime_type", "unplanned"), "p_impact_level": payload.get("impact_level", "out_of_service"),
        "p_reason_code": payload.get("reason_code"), "p_notes": payload.get("notes"), "p_started_by": actor_id,
    }).execute().data


def restore_asset_downtime(*, db: Any, asset_id: str, downtime_id: str, tenant_id: str, actor_id: str, notes: str | None) -> dict:
    return db.rpc("restore_asset_downtime", {
        "p_asset_id": asset_id, "p_downtime_id": downtime_id, "p_tenant_id": tenant_id,
        "p_restored_by": actor_id, "p_notes": notes,
    }).execute().data


def restore_active_work_order_downtime(*, db: Any, work_order_id: str, tenant_id: str, actor_id: str) -> dict | None:
    active = (db.table("asset_downtime_periods").select("id, asset_id").eq("tenant_id", tenant_id)
              .eq("work_order_id", work_order_id).is_("restored_at", "null").maybe_single().execute())
    if not active or not active.data:
        return None
    return restore_asset_downtime(db=db, asset_id=str(active.data["asset_id"]), downtime_id=str(active.data["id"]),
        tenant_id=tenant_id, actor_id=actor_id, notes=None)


def _as_datetime(value: datetime | str | None) -> datetime | None:
    if value is None:
        return None
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _minutes_between(start: datetime, end: datetime) -> int:
    return max(0, int((end - start).total_seconds() // 60))


def _windowed_minutes(period: dict, window_start: datetime, now: datetime) -> int:
    started_at = _as_datetime(period.get("started_at"))
    restored_at = _as_datetime(period.get("restored_at")) or now
    if not started_at or restored_at <= window_start or started_at >= now:
        return 0
    return _minutes_between(max(started_at, window_start), min(restored_at, now))


def with_elapsed_minutes(period: dict, now: datetime | None = None) -> dict:
    """Return an API-safe period with a server-derived elapsed duration."""
    result = dict(period)
    started_at = _as_datetime(period.get("started_at"))
    if started_at:
        result["elapsed_minutes"] = _minutes_between(
            started_at, _as_datetime(period.get("restored_at")) or now or datetime.now(timezone.utc)
        )
    else:
        result["elapsed_minutes"] = None
    return result


def calculate_asset_reliability(*, periods: list[dict], work_orders: list[dict], relationships: list[dict], reopen_events: list[dict], now: datetime | None = None) -> dict:
    """Calculate twelve-month metrics from explicit downtime, never WO elapsed time.

    MTTR averages completed unplanned periods. MTBF averages operating time
    from one unplanned restoration to the next unplanned start. First-time-fix
    requires a passed verification and 30 days without reopen/repeat failure.
    """
    now = now or datetime.now(timezone.utc)
    window_start = now - timedelta(days=REPORTING_DAYS)
    normalized = []
    for period in periods:
        started_at = _as_datetime(period.get("started_at"))
        if started_at:
            normalized.append({**period, "_started_at": started_at, "_restored_at": _as_datetime(period.get("restored_at"))})
    active = next((period for period in sorted(normalized, key=lambda item: item["_started_at"], reverse=True) if period["_restored_at"] is None), None)
    completed_unplanned = [period for period in normalized if period.get("downtime_type") == "unplanned" and period["_restored_at"] and period["_restored_at"] > window_start and period["_started_at"] < now]
    unplanned_minutes = sum(_windowed_minutes(period, window_start, now) for period in normalized if period.get("downtime_type") == "unplanned")
    planned_minutes = sum(_windowed_minutes(period, window_start, now) for period in normalized if period.get("downtime_type") == "planned")
    mttr_minutes = round(sum(_windowed_minutes(period, window_start, now) for period in completed_unplanned) / len(completed_unplanned)) if completed_unplanned else None
    failures = sorted([period for period in normalized if period.get("downtime_type") == "unplanned" and window_start <= period["_started_at"] < now], key=lambda item: item["_started_at"])
    intervals = [_minutes_between(previous["_restored_at"], current["_started_at"]) for previous, current in zip(failures, failures[1:]) if previous["_restored_at"] and current["_started_at"] >= previous["_restored_at"]]
    mtbf_minutes = round(sum(intervals) / len(intervals)) if intervals else None
    completed = [wo for wo in work_orders if (completed_at := _as_datetime(wo.get("completed_at"))) and window_start <= completed_at <= now]
    ids = {str(wo["id"]) for wo in completed}
    repeats = {str(row["parent_work_order_id"]) for row in relationships if row.get("relationship_type") == "repeat_failure" and str(row.get("parent_work_order_id")) in ids}
    reopens = {str(row["work_order_id"]) for row in reopen_events if row.get("event_type") == "reopened" and str(row.get("work_order_id")) in ids}
    mature = [wo for wo in completed if _as_datetime(wo.get("completed_at")) <= now - timedelta(days=FIRST_TIME_FIX_MATURITY_DAYS)]
    first_time_fix_successes = sum(wo.get("verification_result") == "passed" and str(wo["id"]) not in repeats and str(wo["id"]) not in reopens for wo in mature)
    active_downtime = None
    if active:
        active_downtime = {key: active.get(key) for key in ("id", "started_at", "downtime_type", "impact_level", "work_order_id")}
        active_downtime["elapsed_minutes"] = _minutes_between(active["_started_at"], now)
    tracking_started = min((period["_started_at"] for period in normalized), default=None)
    denominator = len(completed)
    return {
        "tracking_started_at": tracking_started.isoformat() if tracking_started else None, "active_downtime": active_downtime,
        "downtime_12mo_minutes": planned_minutes + unplanned_minutes, "planned_downtime_12mo_minutes": planned_minutes,
        "unplanned_downtime_12mo_minutes": unplanned_minutes, "failure_count_12mo": len(failures),
        "mttr_minutes": mttr_minutes, "mtbf_minutes": mtbf_minutes, "repeat_failure_count": len(repeats),
        "repeat_failure_rate": len(repeats) / denominator if denominator else None, "reopen_count": len(reopens),
        "reopen_rate": len(reopens) / denominator if denominator else None, "first_time_fix_eligible": len(mature),
        "first_time_fix_successes": first_time_fix_successes, "first_time_fix_rate": first_time_fix_successes / len(mature) if mature else None,
    }

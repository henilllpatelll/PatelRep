"""Hotel-local bucketed trend series over the SAME cohorts as the KPIs.

For rate metrics the series carries eligible/met per bucket so
``sum(met)/sum(eligible)`` equals the KPI value exactly (reconciliation).
Missing buckets are ``value: null`` — never 0.
"""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

from services.reporting import data as report_data
from services.reporting import housekeeping as hk
from services.reporting.definitions import DEFINITIONS
from services.reporting.kpi import ReportContext
from services.reporting.metrics import (
    average_series,
    count_series,
    guest_sla_outcome,
    minutes_between,
    hours_between,
    pct,
    rate_series,
    work_order_sla_outcome,
)
from services.reporting.periods import ReportPeriod, build_buckets, parse_timestamp

# metric -> (required view, definition key, kind, department needed for the department filter)
TREND_METRICS: dict[str, dict] = {
    "guest_sla": {"view": "guest-experience", "definition": "guest_sla", "kind": "rate"},
    "guest_ack_time": {"view": "guest-experience", "definition": "guest_ack_time", "kind": "average"},
    "maintenance_sla": {"view": "maintenance", "definition": "maintenance_sla", "kind": "rate", "department": "engineering"},
    "maintenance_response": {"view": "maintenance", "definition": "maintenance_response", "kind": "average", "department": "engineering"},
    "maintenance_repair": {"view": "maintenance", "definition": "maintenance_repair", "kind": "average", "department": "engineering"},
    "wo_created": {"view": "maintenance", "definition": None, "kind": "count", "label": "Work orders created", "unit": "count", "department": "engineering"},
    "wo_completed": {"view": "maintenance", "definition": None, "kind": "count", "label": "Work orders completed", "unit": "count", "department": "engineering"},
    "inspection_pass": {"view": "housekeeping", "definition": "inspection_pass", "kind": "rate", "department": "housekeeping"},
    "cleaning_minutes": {"view": "housekeeping", "definition": "cleaning_minutes", "kind": "average", "department": "housekeeping"},
}


def _points_for(ctx: ReportContext, metric: str, period: ReportPeriod, granularity: Optional[str]) -> list[dict]:
    buckets = build_buckets(period, ctx.tz, granularity)
    sb, hid = ctx.supabase, ctx.hotel_id

    if metric in ("guest_sla", "guest_ack_time"):
        requests, _ = report_data.guest_requests_created(sb, hid, period, departments=ctx.departments)
        if metric == "guest_sla":
            return rate_series(buckets, requests, when="created_at", outcome=lambda r: guest_sla_outcome(r, ctx.now))
        return average_series(
            buckets, requests, when="created_at",
            measure=lambda r: minutes_between(parse_timestamp(r.get("created_at")), parse_timestamp(r.get("acknowledged_at"))),
        )

    if metric in ("maintenance_sla", "maintenance_response", "maintenance_repair", "wo_created"):
        orders, _ = report_data.work_orders_created(sb, hid, period)
        if metric == "maintenance_sla":
            return rate_series(buckets, orders, when="created_at", outcome=work_order_sla_outcome)
        if metric == "wo_created":
            return count_series(buckets, orders, when="created_at")
        if metric == "maintenance_response":
            return average_series(buckets, orders, when="created_at", digits=1,
                                  measure=lambda w: hours_between(parse_timestamp(w.get("created_at")), parse_timestamp(w.get("started_at"))))
        completed = [w for w in orders if w.get("status") == "completed"]
        return average_series(buckets, completed, when="created_at", digits=1,
                              measure=lambda w: hours_between(parse_timestamp(w.get("started_at")), parse_timestamp(w.get("completed_at"))))

    if metric == "wo_completed":
        rows, _ = report_data.fetch_all(
            lambda: sb.table("work_orders").select("id, completed_at").eq("tenant_id", hid).eq("status", "completed")
            .gte("completed_at", period.start_iso).lt("completed_at", period.end_iso)
        )
        return count_series(buckets, rows, when="completed_at")

    if metric == "inspection_pass":
        inspections, _ = report_data.inspections_completed(sb, hid, period)
        return rate_series(buckets, inspections, when="completed_at", outcome=lambda i: i.get("overall_result") == "passed")

    if metric == "cleaning_minutes":
        rooms = report_data.room_lookup(sb, hid)
        sessions = hk.clean_sessions(sb, hid, period, ctx.tz, {rid: r.get("room_type_id") for rid, r in rooms.items()})
        return average_series(buckets, sessions, when="closed_at", measure=lambda s: s["minutes"])

    raise HTTPException(status_code=422, detail=f"Unknown trend metric '{metric}'")


def _total(kind: str, points: list[dict]) -> Optional[float]:
    if kind == "rate":
        return pct(sum(p["met"] for p in points), sum(p["eligible"] for p in points))
    if kind == "count":
        return sum(p["value"] or 0 for p in points)
    n = sum(p["sample_size"] for p in points)
    if not n:
        return None
    return round(sum((p["value"] or 0) * p["sample_size"] for p in points) / n, 1)


def trend_series(ctx: ReportContext, metric: str, granularity: Optional[str] = None) -> dict:
    spec = TREND_METRICS.get(metric)
    if spec is None:
        raise HTTPException(status_code=422, detail=f"Unknown trend metric '{metric}'")
    definition = DEFINITIONS.get(spec["definition"] or "", {})
    points = _points_for(ctx, metric, ctx.period, granularity)
    result = {
        "metric": metric,
        "label": spec.get("label") or definition.get("label", metric),
        "unit": spec.get("unit") or definition.get("unit"),
        "definition_key": spec["definition"],
        "granularity": granularity or ("day" if ctx.period.days <= 31 else "week" if ctx.period.days <= 120 else "month"),
        "period": ctx.period.as_dict(),
        "points": points,
        "total": _total(spec["kind"], points),
        "comparison": None,
    }
    if ctx.compare_period:
        compare_points = _points_for(ctx, metric, ctx.compare_period, granularity)
        result["comparison"] = {
            "period": ctx.compare_period.as_dict(),
            "points": compare_points,
            "total": _total(spec["kind"], compare_points),
        }
    return result

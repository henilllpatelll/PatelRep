"""Legacy report endpoints (kept, additive-only) + report capabilities/definitions.

Phase-1 contract changes vs. the original implementation (all additive for existing
consumers; nullable where a value used to be a misleading ``0``):
  * Dates: hotel-local calendar days, inclusive start / exclusive end-of-day, shared helper.
  * SLA: only records with a valid deadline are eligible; zero eligible => ``null`` (not 0%).
  * Daily summary: a historical date no longer mixes in CURRENT room/work-order counts.
"""
import csv
import io
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from core.database import supabase
from middleware.auth import CurrentUser, get_current_user, require_role
from services.guest_recovery.contracts import calculate_guest_request_metrics
from services.reporting import data as report_data
from services.reporting.access import (
    capabilities,
    effective_departments,
    require_view,
)
from services.reporting.definitions import DEFINITIONS
from services.reporting.exports import csv_safe
from services.reporting.team import build_staff_metrics
from services.reporting.metrics import guest_stats, maintenance_stats
from services.reporting.periods import (
    hotel_timezone,
    local_midnight_utc,
    local_today,
    parse_timestamp,
    resolve_period,
)

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/capabilities")
async def get_report_capabilities(current_user: CurrentUser = Depends(get_current_user)):
    """Which report views / departments the caller may use. Single source for the web tabs."""
    return {"data": capabilities(current_user.role)}


@router.get("/definitions")
async def get_metric_definitions(current_user: CurrentUser = Depends(require_view("overview", "guest-experience", "housekeeping", "maintenance", "team", "management"))):
    """Metric definition registry (what each KPI measures and how it is calculated)."""
    return {"data": DEFINITIONS}


@router.get("/guest-recovery")
async def get_guest_recovery_report(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    department: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(require_view("guest-experience")),
):
    """Guest-response performance from immutable lifecycle timestamps."""
    tz = hotel_timezone(supabase, current_user.hotel_id)
    period = resolve_period(start_date, end_date, tz)
    departments = effective_departments(current_user.role, department)
    requests, truncated = report_data.guest_requests_created(
        supabase, current_user.hotel_id, period, departments=departments
    )
    by_category: dict[str, int] = {}
    for request in requests:
        category = request.get("category") or "service"
        by_category[category] = by_category.get(category, 0) + 1
    now = datetime.now(timezone.utc)
    return {"data": {
        "period": period.as_dict(),
        # Corrected, SLA-eligible metrics (rates are null, never 0, when nothing is eligible).
        **guest_stats(requests, now),
        # Legacy fields last so their historical values are untouched
        # (`sla_met_rate_pct` divides by ALL requests; empty period => 0.0).
        **calculate_guest_request_metrics(requests),
        "by_category": by_category,
        "truncated": truncated,
    }}


@router.get("/daily-summary")
async def get_daily_summary(
    report_date: Optional[date] = Query(None, alias="date"),
    current_user: CurrentUser = Depends(require_view("overview", "housekeeping", "maintenance", "team")),
):
    """Daily operational summary.

    Today (hotel-local) is live. A past date only reports what can be reconstructed from
    dated records (tasks completed that local day). Room statuses and open work orders are
    CURRENT snapshots with no history, so for a past date they are returned as unavailable.
    """
    tz = hotel_timezone(supabase, current_user.hotel_id)
    today = local_today(tz)
    target = report_date or today
    if target > today:
        raise HTTPException(status_code=422, detail="date cannot be in the future")
    is_live = target == today

    day_start = local_midnight_utc(target, tz)
    day_end = local_midnight_utc(target + timedelta(days=1), tz)
    completed_tasks = (
        supabase.table("tasks")
        .select("id", count="exact")
        .eq("tenant_id", current_user.hotel_id)
        .eq("status", "completed")
        .gte("completed_at", day_start.isoformat())
        .lt("completed_at", day_end.isoformat())
        .execute()
    )
    result = {
        "date": target.isoformat(),
        "timezone": getattr(tz, "key", "UTC"),
        "is_live": is_live,
        "tasks_completed_today": completed_tasks.count or 0,
        "availability": {"tasks_completed_today": "available"},
    }
    if is_live:
        status_counts = report_data.current_room_status_counts(supabase, current_user.hotel_id)
        open_work_orders = (
            supabase.table("work_orders")
            .select("id", count="exact")
            .eq("tenant_id", current_user.hotel_id)
            .in_("status", ["open", "in_progress"])
            .execute()
        )
        result.update(
            room_status_breakdown=status_counts,
            open_work_orders=open_work_orders.count or 0,
        )
        result["availability"].update(room_status_breakdown="available", open_work_orders="available")
    else:
        result.update(room_status_breakdown=None, open_work_orders=None)
        result["availability"].update(
            room_status_breakdown="unavailable",
            open_work_orders="unavailable",
        )
        result["unavailable_reason"] = (
            "Room status and open work order counts are live snapshots; no daily history is stored, "
            "so they cannot be reconstructed for a past date."
        )
    return {"data": result}


@router.get("/staff-performance")
async def get_staff_performance(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    department: Optional[str] = Query(None),
    format: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(require_view("team")),
):
    """Staff workload/SLA metrics, limited to the departments the caller manages."""
    tz = hotel_timezone(supabase, current_user.hotel_id)
    period = resolve_period(start_date, end_date, tz)
    metrics, truncated = build_staff_metrics(supabase, current_user.hotel_id, current_user.role, period, department)

    if format == "csv":
        output = io.StringIO()
        fields = [
            "name", "role", "tasks_completed", "tasks_total", "wo_completed", "wo_total",
            "sla_eligible", "sla_met", "sla_compliance_pct", "total_labor_hours",
        ]
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for m in metrics:
            writer.writerow({k: csv_safe("" if m.get(k) is None else m.get(k)) for k in fields})
        filename = f"staff-performance-{period.start.isoformat()}-to-{period.end.isoformat()}.csv"
        return StreamingResponse(
            iter(["﻿" + output.getvalue()]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    return {"data": {
        "period": period.as_dict(),
        "metrics": metrics,
        "total_staff": len(metrics),
        "truncated": truncated,
    }}


@router.get("/maintenance")
async def get_maintenance_report(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(require_view("maintenance")),
):
    """Work-order KPIs for work orders created in the period + live overdue inventory."""
    tz = hotel_timezone(supabase, current_user.hotel_id)
    period = resolve_period(start_date, end_date, tz)
    work_orders, truncated = report_data.work_orders_created(supabase, current_user.hotel_id, period)
    stats = maintenance_stats(work_orders)
    now = datetime.now(timezone.utc)

    by_category: dict[str, int] = {}
    by_priority: dict = {"urgent": 0, "normal": 0, "low": 0}
    for wo in work_orders:
        by_category[wo.get("category") or "general"] = by_category.get(wo.get("category") or "general", 0) + 1
        priority = wo.get("priority") or "normal"
        by_priority[priority] = by_priority.get(priority, 0) + 1

    # Legacy semantics kept for existing consumers: open+overdue within the period cohort.
    cohort_breaches = sum(
        1 for wo in work_orders
        if wo.get("status") in ("open", "in_progress")
        and (parse_timestamp(wo.get("due_at")) or now) < now
    )
    open_orders, open_truncated = report_data.work_orders_open(supabase, current_user.hotel_id)
    overdue = [
        wo for wo in open_orders
        if (due := parse_timestamp(wo.get("due_at"))) is not None and due < now
    ]
    oldest = min((parse_timestamp(w["due_at"]) for w in overdue), default=None)

    return {"data": {
        "period": period.as_dict(),
        **stats,
        "active_sla_breaches": cohort_breaches,
        "live_active_sla_breaches": len(overdue),
        "live_urgent_sla_breaches": sum(1 for w in overdue if w.get("priority") == "urgent"),
        "live_oldest_overdue_due_at": oldest.isoformat() if oldest else None,
        "live_open_work_orders": len(open_orders),
        "guest_reported_count": sum(1 for wo in work_orders if wo.get("guest_reported")),
        "by_category": by_category,
        "by_priority": by_priority,
        "truncated": truncated or open_truncated,
    }}


@router.get("/ai-usage")
async def get_ai_usage_report(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    format: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """AI credit consumption and interaction breakdown (GM only)."""
    tz = hotel_timezone(supabase, current_user.hotel_id)
    today = local_today(tz)
    period = resolve_period(
        start_date, end_date, tz, default_days=(today - today.replace(day=1)).days + 1
    )
    interactions, truncated = report_data.fetch_all(
        lambda: supabase.table("ai_interactions")
        .select("interaction_type, credits_charged, model_used, success")
        .eq("tenant_id", current_user.hotel_id)
        .gte("created_at", period.start_iso)
        .lt("created_at", period.end_iso)
    )
    total_credits = sum(i.get("credits_charged") or 0 for i in interactions)
    breakdown: dict = {}
    for i in interactions:
        key = i.get("interaction_type") or "unknown"
        breakdown[key] = breakdown.get(key, 0) + (i.get("credits_charged") or 0)

    if format == "csv":
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=["interaction_type", "credits"])
        writer.writeheader()
        for interaction_type, credits in breakdown.items():
            writer.writerow({"interaction_type": csv_safe(interaction_type), "credits": credits})
        filename = f"ai-usage-{period.start.isoformat()}-to-{period.end.isoformat()}.csv"
        return StreamingResponse(
            iter(["﻿" + output.getvalue()]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    return {"data": {
        "period": period.as_dict(),
        "total_credits_used": total_credits,
        "total_interactions": len(interactions),
        "breakdown_by_type": breakdown,
        "truncated": truncated,
    }}

"""Operations Overview (Phase 2): headline KPIs, needs-attention list, trends, department
breakdown and a clearly-labelled live daily brief. Each section appears only if the
caller's role may see the underlying view (no new data is exposed here)."""
from __future__ import annotations

from typing import Optional

from services.guest_recovery.contracts import calculate_repeat_failures
from services.reporting import data as report_data
from services.reporting.access import OVERVIEW_REQUIRES, can_view
from services.reporting.kpi import ReportContext, exception, kpi, rank_exceptions
from services.reporting.metrics import guest_stats, maintenance_stats, work_order_is_active_breach
from services.reporting.periods import build_period, parse_timestamp, previous_period
from services.reporting.trends import trend_series
from services.reporting.views import FINAL_GUEST_STATUSES, NEAR_DEADLINE
from services.reporting.views_hk import period_numbers


def _allowed(ctx: ReportContext, key: str) -> bool:
    return can_view(ctx.role, OVERVIEW_REQUIRES[key])


def _guest_exceptions(ctx: ReportContext) -> list[dict]:
    """LIVE guest requests that are past due / nearing deadline / resolved but unverified."""
    categories = report_data.categories_for(ctx.departments)

    def make():
        query = (
            ctx.supabase.table("guest_requests")
            .select(report_data.GUEST_REQUEST_COLUMNS)
            .eq("tenant_id", ctx.hotel_id)
            .in_("status", ["open", "acknowledged", "dispatched", "arrived", "guest_contacted", "reopened", "resolved"])
        )
        return query.in_("category", categories or ["__none__"]) if categories is not None else query

    rows, _ = report_data.fetch_all(make)
    breached = near = unverified = 0
    for r in rows:
        if r.get("status") == "resolved":
            unverified += 1
            continue
        due = parse_timestamp(r.get("due_at"))
        if due is None or r.get("status") in FINAL_GUEST_STATUSES:
            continue
        if due < ctx.now:
            breached += 1
        elif due - ctx.now <= NEAR_DEADLINE:
            near += 1
    return [
        exception("guest_breached", "critical", "Guest requests past their SLA", "Open requests whose deadline has passed.", breached,
                  target={"type": "records", "kind": "guest_requests", "filter": "breached_live"}),
        exception("guest_near", "high", "Guest requests nearing SLA", "Due within the next 60 minutes.", near,
                  target={"type": "records", "kind": "guest_requests", "filter": "near_deadline_live"}),
        exception("guest_unverified", "medium", "Resolved but not verified", "Resolutions awaiting guest verification.", unverified,
                  target={"type": "records", "kind": "guest_requests", "filter": "unverified_live"}),
    ]


def _maintenance_exceptions(ctx: ReportContext, period_orders: list[dict]) -> list[dict]:
    open_orders, _ = report_data.work_orders_open(ctx.supabase, ctx.hotel_id)
    overdue = [w for w in open_orders if work_order_is_active_breach(w, ctx.now)]
    urgent = [w for w in overdue if w.get("priority") == "urgent"]
    items = [
        exception("wo_overdue_urgent", "critical", "Urgent work orders overdue", "Urgent open work orders past their due time.", len(urgent),
                  department="engineering", target={"type": "records", "kind": "work_orders", "filter": "overdue_live", "priority": "urgent"}),
        # Disjoint from the urgent row (non-urgent only) so one work order is never counted twice.
        exception("wo_overdue", "high", "Overdue work orders", "Other open work orders past their due time.", len(overdue) - len(urgent),
                  department="engineering", target={"type": "records", "kind": "work_orders", "filter": "overdue_live", "priority_not": "urgent"}),
    ]
    repeats = calculate_repeat_failures(
        period_orders, window_start=ctx.period.start_utc, window_end=ctx.period.end_utc, window_days=ctx.period.days
    )
    n = repeats["repeat_asset_count"] + repeats["repeat_room_count"]
    items.append(exception("repeat_failures", "medium", "Repeat room or asset failures",
                           "Rooms/assets with 2+ work orders in the selected period.", n, department="engineering",
                           target={"type": "view", "view": "maintenance"}))
    deferrals, _ = report_data.fetch_all(
        lambda: ctx.supabase.table("pm_deferrals").select("pm_schedule_id, created_at").eq("tenant_id", ctx.hotel_id)
        .gte("created_at", ctx.period.start_iso).lt("created_at", ctx.period.end_iso)
    )
    counts: dict[str, int] = {}
    for d in deferrals:
        counts[d["pm_schedule_id"]] = counts.get(d["pm_schedule_id"], 0) + 1
    items.append(exception("pm_repeat_deferrals", "medium", "Preventive maintenance repeatedly deferred",
                           "Schedules deferred 2+ times in the selected period.", sum(1 for c in counts.values() if c >= 2),
                           department="engineering", target={"type": "view", "view": "maintenance"}))
    return items


def _inspection_exception(ctx: ReportContext, quality: dict) -> list[dict]:
    """Quality deterioration: pass rate fell 10+ percentage points vs the immediately preceding period."""
    prior = previous_period(ctx.period, ctx.tz)
    prior_quality = period_numbers(ctx, prior)["quality"] if quality.get("pass_rate_pct") is not None else {}
    cur, old = quality.get("pass_rate_pct"), prior_quality.get("pass_rate_pct")
    if cur is None or old is None or old - cur < 10:
        return []
    return [exception("inspection_decline", "high", "Inspection pass rate declined",
                      f"Pass rate fell from {old}% to {cur}% versus the previous period.", 1,
                      department="housekeeping", target={"type": "view", "view": "housekeeping"})]


def _staffing_exception(forecast: Optional[dict]) -> list[dict]:
    if not forecast:
        return []
    days = (forecast.get("data", forecast)).get("days", [])
    short = [d for d in days if (d.get("staffing_gap") or 0) > 0]
    return [exception("staffing_shortfall", "high", "Forecast staffing shortfall",
                      "Days in the next week where scheduled housekeepers are below the forecast requirement.", len(short),
                      department="housekeeping", target={"type": "route", "href": "/scheduling"})]


def overview_view(ctx: ReportContext, forecast: Optional[dict] = None) -> dict:
    kpis: list[dict] = []
    exceptions: list[dict] = []
    trends: dict[str, dict] = {}
    departments: list[dict] = []

    prev_ctx_period = ctx.compare_period

    guest_cur = guest_prev = work_cur = work_prev = None
    if _allowed(ctx, "guest_sla"):
        reqs, _ = report_data.guest_requests_created(ctx.supabase, ctx.hotel_id, ctx.period, departments=ctx.departments)
        guest_cur = guest_stats(reqs, ctx.now)
        if prev_ctx_period:
            prev_reqs, _ = report_data.guest_requests_created(ctx.supabase, ctx.hotel_id, prev_ctx_period, departments=ctx.departments)
            guest_prev = guest_stats(prev_reqs, ctx.now)
        kpis.append(kpi("guest_sla", guest_cur["sla_compliance_pct"], previous=(guest_prev or {}).get("sla_compliance_pct"),
                        eligible=guest_cur["sla_eligible"], numerator=guest_cur["sla_met"],
                        absent="not_applicable" if guest_cur["total_requests"] else "not_enough_data"))
        exceptions += _guest_exceptions(ctx)
        trends["guest_sla"] = trend_series(ctx, "guest_sla")

    period_orders: list[dict] = []
    if _allowed(ctx, "maintenance_sla") and ctx.has_department("engineering"):
        period_orders, _ = report_data.work_orders_created(ctx.supabase, ctx.hotel_id, ctx.period)
        work_cur = maintenance_stats(period_orders)
        if prev_ctx_period:
            work_prev = maintenance_stats(report_data.work_orders_created(ctx.supabase, ctx.hotel_id, prev_ctx_period)[0])
        kpis.append(kpi("maintenance_sla", work_cur["sla_compliance_pct"], previous=(work_prev or {}).get("sla_compliance_pct"),
                        eligible=work_cur["sla_eligible"], numerator=work_cur["sla_met"],
                        absent="not_applicable" if work_cur["completed"] else "not_enough_data"))
        exceptions += _maintenance_exceptions(ctx, period_orders)
        trends["maintenance_sla"] = trend_series(ctx, "maintenance_sla")

    quality_cur = None
    if _allowed(ctx, "inspection_pass") and ctx.has_department("housekeeping"):
        cur = period_numbers(ctx, ctx.period)
        quality_cur = cur["quality"]
        prev_quality = period_numbers(ctx, prev_ctx_period)["quality"] if prev_ctx_period else {}
        kpis.append(kpi("inspection_pass", quality_cur.get("pass_rate_pct"), previous=prev_quality.get("pass_rate_pct"),
                        eligible=quality_cur.get("total_inspections"), numerator=quality_cur.get("passed")))
        exceptions += _inspection_exception(ctx, quality_cur)
        exceptions += _staffing_exception(forecast) if ctx.role == "gm" else []

    status_counts: Optional[dict] = None
    if _allowed(ctx, "out_of_order"):
        status_counts = report_data.current_room_status_counts(ctx.supabase, ctx.hotel_id)
        kpis.append(kpi("out_of_order", status_counts.get("OOO", 0),
                        note="Live status right now. Historical out-of-order counts are not stored, so there is no period comparison."))

    # Department breakdown: only the department's own measures (no forced common scale).
    if guest_cur is not None or work_cur is not None or quality_cur is not None:
        if ctx.has_department("housekeeping") and quality_cur is not None:
            departments.append({"department": "housekeeping", "measures": [
                kpi("inspection_pass", quality_cur.get("pass_rate_pct"), eligible=quality_cur.get("total_inspections"), numerator=quality_cur.get("passed")),
            ]})
        if ctx.has_department("engineering") and work_cur is not None:
            departments.append({"department": "engineering", "measures": [
                kpi("maintenance_sla", work_cur["sla_compliance_pct"], eligible=work_cur["sla_eligible"], numerator=work_cur["sla_met"], absent="not_applicable"),
                kpi("maintenance_completion", work_cur["completion_rate_pct"], eligible=work_cur["total_work_orders"], numerator=work_cur["completed"]),
            ]})

    brief = None
    if any(can_view(ctx.role, v) for v in ("housekeeping", "maintenance")):
        today = build_period(ctx.now.astimezone(ctx.tz).date(), ctx.now.astimezone(ctx.tz).date(), ctx.tz)
        done = ctx.supabase.table("tasks").select("id", count="exact").eq("tenant_id", ctx.hotel_id).eq("status", "completed") \
            .gte("completed_at", today.start_iso).lt("completed_at", today.end_iso).execute()
        open_wo = ctx.supabase.table("work_orders").select("id", count="exact").eq("tenant_id", ctx.hotel_id) \
            .in_("status", ["open", "in_progress"]).execute()
        brief = {
            "scope": "live",
            "as_of_date": today.start.isoformat(),
            "tasks_completed_today": done.count or 0,
            "open_work_orders": open_wo.count or 0,
            "room_status": status_counts if status_counts is not None else report_data.current_room_status_counts(ctx.supabase, ctx.hotel_id),
        }

    return {
        "view": "overview",
        "period": ctx.period.as_dict(),
        "comparison_period": ctx.compare_period.as_dict() if ctx.compare_period else None,
        "kpis": kpis,
        "needs_attention": rank_exceptions(exceptions),
        "trends": trends,
        "departments": departments,
        "daily_brief": brief,
    }


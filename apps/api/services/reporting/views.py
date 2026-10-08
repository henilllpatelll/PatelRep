"""Guest Experience, Maintenance and Team report views (Phase 2).

Every number comes from ``metrics.py`` over the cohort queries in ``data.py``;
drill-down (``drilldown.py``) uses the same predicates so totals reconcile.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Optional

from services.guest_recovery.contracts import calculate_pm_compliance, calculate_repeat_failures
from services.reporting import data as report_data
from services.reporting import housekeeping as hk
from services.reporting.kpi import ReportContext, kpi
from services.reporting.metrics import (
    guest_stats,
    maintenance_stats,
    pct,
    work_order_is_active_breach,
)
from services.reporting.periods import parse_timestamp
from services.reporting.team import build_staff_metrics

NEAR_DEADLINE = timedelta(minutes=60)
FINAL_GUEST_STATUSES = ("verified", "cancelled")


def _ranked(counts: dict[str, int]) -> list[dict]:
    total = sum(counts.values())
    return [
        {"key": key, "count": count, "share_pct": pct(count, total)}
        for key, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]


def _comparison_guest(ctx: ReportContext) -> Optional[dict]:
    if not ctx.compare_period:
        return None
    previous, _ = report_data.guest_requests_created(ctx.supabase, ctx.hotel_id, ctx.compare_period, departments=ctx.departments)
    return guest_stats(previous, ctx.now)


def guest_review_state(request: dict, ctx_now) -> Optional[str]:
    """Why a request needs review (None = no action needed). Shared with drill-down."""
    status = request.get("status")
    if status == "cancelled":
        return None
    if status == "resolved":
        return "unverified_resolution"
    if status == "verified":
        return None
    due = parse_timestamp(request.get("due_at"))
    if due is None:
        return None
    if due < ctx_now:
        return "breached"
    if due - ctx_now <= NEAR_DEADLINE:
        return "near_deadline"
    return None


def guest_view(ctx: ReportContext) -> dict:
    requests, truncated = report_data.guest_requests_created(ctx.supabase, ctx.hotel_id, ctx.period, departments=ctx.departments)
    stats = guest_stats(requests, ctx.now)
    prev = _comparison_guest(ctx)
    p = lambda k: (prev or {}).get(k)  # noqa: E731

    kpis = [
        kpi("guest_verified_resolution", stats["verified_resolution_pct"], previous=p("verified_resolution_pct"),
            eligible=stats["total_requests"], numerator=stats["verified_count"]),
        kpi("guest_sla", stats["sla_compliance_pct"], previous=p("sla_compliance_pct"),
            eligible=stats["sla_eligible"], numerator=stats["sla_met"],
            absent="not_applicable" if stats["total_requests"] else "not_enough_data",
            note=None if stats["sla_eligible"] else "No requests with a due time were eligible in this period."),
        kpi("guest_ack_time", stats["avg_acknowledgement_minutes"], previous=p("avg_acknowledgement_minutes"), kind="value",
            sample_size=stats["acknowledgement_sample_size"]),
        kpi("guest_resolution_time", stats["avg_verified_resolution_minutes"], previous=p("avg_verified_resolution_minutes"), kind="value",
            sample_size=stats["resolution_sample_size"]),
        kpi("guest_requests_total", stats["total_requests"], previous=p("total_requests"), kind="value"),
    ]

    rooms = report_data.room_lookup(ctx.supabase, ctx.hotel_id)
    categories: dict[str, int] = {}
    by_department: dict[str, list[dict]] = {"housekeeping": [], "engineering": [], "unattributed": []}
    review: list[dict] = []
    review_counts = {"breached": 0, "near_deadline": 0, "unverified_resolution": 0}
    for r in requests:
        category = r.get("category") or "service"
        categories[category] = categories.get(category, 0) + 1
        by_department[report_data.CATEGORY_DEPARTMENT.get(category, "unattributed")].append(r)
        state = guest_review_state(r, ctx.now)
        if state:
            review_counts[state] += 1
            review.append({
                "id": r["id"],
                "request_number": r.get("request_number"),
                "room": (rooms.get(r.get("room_id")) or {}).get("room_number"),
                "category": category,
                "summary": r.get("title"),
                "created_at": r.get("created_at"),
                "department": report_data.CATEGORY_DEPARTMENT.get(category),
                "sla_state": state,
                "status": r.get("status"),
            })
    order = {"breached": 0, "near_deadline": 1, "unverified_resolution": 2}
    review.sort(key=lambda row: (order[row["sla_state"]], row["created_at"] or ""))

    department_rows = []
    for dept, items in by_department.items():
        if not items:
            continue
        s = guest_stats(items, ctx.now)
        department_rows.append({
            "department": dept,
            "label": "Unattributed (no department on record)" if dept == "unattributed" else dept,
            "total_requests": s["total_requests"],
            "sla_eligible": s["sla_eligible"],
            "sla_compliance_pct": s["sla_compliance_pct"],
            "avg_acknowledgement_minutes": s["avg_acknowledgement_minutes"],
            "low_sample": s["total_requests"] < 5,
        })

    return {
        "view": "guest-experience",
        "period": ctx.period.as_dict(),
        "comparison_period": ctx.compare_period.as_dict() if ctx.compare_period else None,
        "kpis": kpis,
        "categories": _ranked(categories),
        "needs_review": {"counts": review_counts, "total": sum(review_counts.values()), "rows": review[:25]},
        "departments": department_rows,
        "truncated": truncated,
    }


# ── Maintenance ──────────────────────────────────────────────────────────────


def _label_assets(ctx: ReportContext, asset_ids: list[str]) -> dict[str, str]:
    if not asset_ids:
        return {}
    rows = ctx.supabase.table("assets").select("id, name").eq("tenant_id", ctx.hotel_id).in_("id", asset_ids).execute().data or []
    return {r["id"]: r["name"] for r in rows}


def repeat_failure_rows(ctx: ReportContext, work_orders: list[dict]) -> list[dict]:
    """Repeat failures from the cohort (2+ work orders on the same room/asset in the period).

    No root cause is implied: rows only state that several work orders were recorded.
    """
    result = calculate_repeat_failures(
        work_orders, window_start=ctx.period.start_utc, window_end=ctx.period.end_utc, window_days=ctx.period.days
    )
    rooms = report_data.room_lookup(ctx.supabase, ctx.hotel_id)
    asset_ids = [e["asset_id"] for e in result["repeat_assets"]]
    asset_names = _label_assets(ctx, asset_ids)
    rows = []

    def build(kind: str, target_id: str, label: str, count: int):
        related = [w for w in work_orders if w.get("asset_id" if kind == "asset" else "room_id") == target_id]
        cats: dict[str, int] = {}
        for w in related:
            cats[w.get("category") or "general"] = cats.get(w.get("category") or "general", 0) + 1
        latest = max((parse_timestamp(w.get("created_at")) for w in related if w.get("created_at")), default=None)
        rows.append({
            "kind": kind,
            "id": target_id,
            "label": label,
            "failure_count": count,
            "categories": _ranked(cats),
            "most_recent_at": latest.isoformat() if latest else None,
        })

    for entry in result["repeat_assets"]:
        build("asset", entry["asset_id"], asset_names.get(entry["asset_id"], "Unnamed asset"), entry["failure_count"])
    for entry in result["repeat_rooms"]:
        room = rooms.get(entry["room_id"]) or {}
        build("room", entry["room_id"], f"Room {room.get('room_number', '?')}", entry["failure_count"])
    rows.sort(key=lambda r: (-r["failure_count"], r["label"]))
    return rows


def pm_section(ctx: ReportContext) -> dict:
    """PM compliance, deferrals, top deferred schedules (period records; schedules are live)."""
    sb = ctx.supabase
    schedules = sb.table("pm_schedules").select("id, asset_id, name, next_due_at").eq("tenant_id", ctx.hotel_id).eq("is_active", True).execute().data or []
    completions, _ = report_data.fetch_all(lambda: sb.table("pm_completion_records").select("pm_schedule_id, completed_at").eq("tenant_id", ctx.hotel_id).gte("completed_at", ctx.period.start_iso).lt("completed_at", ctx.period.end_iso))
    deferrals, _ = report_data.fetch_all(lambda: sb.table("pm_deferrals").select("id, pm_schedule_id, deferred_until, reason, created_at").eq("tenant_id", ctx.hotel_id).gte("created_at", ctx.period.start_iso).lt("created_at", ctx.period.end_iso))
    metrics = calculate_pm_compliance(schedules, completions, deferrals)
    names = {s["id"]: s for s in schedules}
    counts: dict[str, list[dict]] = {}
    for d in deferrals:
        counts.setdefault(d["pm_schedule_id"], []).append(d)
    top = []
    for sid, items in sorted(counts.items(), key=lambda kv: -len(kv[1]))[:10]:
        latest = max(items, key=lambda d: d.get("created_at") or "")
        top.append({
            "pm_schedule_id": sid,
            "name": (names.get(sid) or {}).get("name", "Inactive schedule"),
            "asset_id": (names.get(sid) or {}).get("asset_id"),
            "deferral_count": len(items),
            "deferred_until": latest.get("deferred_until"),
            "reason": latest.get("reason"),
        })
    active = metrics["active_schedules"]
    return {
        "active_schedules": active,
        "completed_schedules": metrics["completed_schedules"],
        "compliance_pct": metrics["completion_rate_pct"] if active else None,
        "deferred_schedules": metrics["deferred_schedules"],
        "repeated_deferral_count": metrics["repeated_deferral_count"],
        "top_deferrals": top,
    }


def maintenance_view(ctx: ReportContext) -> dict:
    work_orders, truncated = report_data.work_orders_created(ctx.supabase, ctx.hotel_id, ctx.period)
    stats = maintenance_stats(work_orders)
    prev = None
    if ctx.compare_period:
        previous, _ = report_data.work_orders_created(ctx.supabase, ctx.hotel_id, ctx.compare_period)
        prev = maintenance_stats(previous)
    p = lambda k: (prev or {}).get(k)  # noqa: E731

    kpis = [
        kpi("maintenance_sla", stats["sla_compliance_pct"], previous=p("sla_compliance_pct"),
            eligible=stats["sla_eligible"], numerator=stats["sla_met"],
            absent="not_applicable" if stats["completed"] else "not_enough_data",
            note=f"{stats['sla_excluded_no_deadline']} completed work order(s) without a due time are excluded." if stats["sla_excluded_no_deadline"] else None),
        kpi("maintenance_response", stats["avg_response_hours"], previous=p("avg_response_hours"), kind="value", sample_size=stats["response_sample_size"]),
        kpi("maintenance_repair", stats["avg_repair_hours"], previous=p("avg_repair_hours"), kind="value", sample_size=stats["repair_sample_size"]),
        kpi("maintenance_completion", stats["completion_rate_pct"], previous=p("completion_rate_pct"),
            eligible=stats["total_work_orders"], numerator=stats["completed"]),
    ]

    open_orders, open_truncated = report_data.work_orders_open(ctx.supabase, ctx.hotel_id)
    overdue = [w for w in open_orders if work_order_is_active_breach(w, ctx.now)]
    oldest = min(overdue, key=lambda w: parse_timestamp(w["due_at"]), default=None)
    rooms = report_data.room_lookup(ctx.supabase, ctx.hotel_id)
    active = {
        "scope": "live",
        "overdue_count": len(overdue),
        "urgent_overdue_count": sum(1 for w in overdue if w.get("priority") == "urgent"),
        "open_work_orders": len(open_orders),
        "oldest": None if oldest is None else {
            "id": oldest["id"], "title": oldest.get("title"), "due_at": oldest["due_at"],
            "room": (rooms.get(oldest.get("room_id")) or {}).get("room_number"),
        },
    }

    categories: dict[str, int] = {}
    priorities: dict[str, int] = {}
    for w in work_orders:
        categories[w.get("category") or "general"] = categories.get(w.get("category") or "general", 0) + 1
        priorities[w.get("priority") or "normal"] = priorities.get(w.get("priority") or "normal", 0) + 1

    downtime = hk.downtime(ctx.supabase, ctx.hotel_id, ctx.period)
    downtime_rows = [
        {"room_id": r["room_id"], "room": (rooms.get(r["room_id"]) or {}).get("room_number"), "downtime_hours": r["downtime_hours"]}
        for r in downtime["rooms"][:10]
    ]
    exposure = None
    if ctx.role == "gm":  # revenue-sensitive: GM only, estimate only, never $0 when unconfigured
        from services.guest_recovery.contracts import calculate_downtime_revenue_impact

        tenant = ctx.supabase.table("tenants").select("average_daily_rate_cents").eq("id", ctx.hotel_id).maybe_single().execute()
        adr = ((tenant.data if tenant else None) or {}).get("average_daily_rate_cents")
        impact = calculate_downtime_revenue_impact(downtime_hours=downtime["total_downtime_hours"], average_daily_rate_cents=adr)
        exposure = {"configured": impact["configured"], "estimate_cents": impact["revenue_impact_cents"], "is_estimate": True}

    return {
        "view": "maintenance",
        "period": ctx.period.as_dict(),
        "comparison_period": ctx.compare_period.as_dict() if ctx.compare_period else None,
        "kpis": kpis,
        "totals": {"total_work_orders": stats["total_work_orders"], "completed": stats["completed"], "labor_hours": stats["total_labor_hours"]},
        "active_breaches": active,
        "by_category": _ranked(categories),
        "by_priority": _ranked(priorities),
        "repeat_failures": repeat_failure_rows(ctx, work_orders),
        "preventive_maintenance": pm_section(ctx),
        "downtime": {
            "total_hours": downtime["total_downtime_hours"] if downtime["rooms"] else None,
            "rooms_affected": downtime["rooms_affected"],
            "rooms": downtime_rows,
            "return_to_service": {"availability": "unavailable", "reason": "Return-to-service timing is not recorded separately from room status changes."},
            "revenue_exposure": exposure,
        },
        "truncated": truncated or open_truncated,
    }


# ── Team ─────────────────────────────────────────────────────────────────────

TEAM_SORTS = {"name", "role", "tasks_completed", "wo_completed", "sla_compliance_pct", "total_labor_hours"}


def team_view(
    ctx: ReportContext,
    *,
    page: int = 1,
    per_page: int = 25,
    search: Optional[str] = None,
    role_filter: Optional[str] = None,
    sort: str = "name",
    descending: bool = False,
    department: Optional[str] = None,
) -> dict:
    metrics, truncated = build_staff_metrics(ctx.supabase, ctx.hotel_id, ctx.role, ctx.period, department)
    previous = None
    if ctx.compare_period:
        previous, _ = build_staff_metrics(ctx.supabase, ctx.hotel_id, ctx.role, ctx.compare_period, department)

    def totals(rows: list[dict]) -> dict:
        eligible = sum(m["sla_eligible"] for m in rows)
        met = sum(m["sla_met"] for m in rows)
        tracked = [m["total_labor_hours"] for m in rows if m["total_labor_hours"] is not None]
        return {
            "tasks_completed": sum(m["tasks_completed"] for m in rows),
            "wo_completed": sum(m["wo_completed"] for m in rows),
            "sla_eligible": eligible, "sla_met": met, "sla_pct": pct(met, eligible),
            "labor_hours": round(sum(tracked), 1) if tracked else None,
            "labor_tracked_staff": len(tracked),
        }

    cur = totals(metrics)
    prev = totals(previous) if previous is not None else {}
    kpis = [
        kpi("tasks_completed", cur["tasks_completed"], previous=prev.get("tasks_completed"), kind="value"),
        kpi("wo_completed", cur["wo_completed"], previous=prev.get("wo_completed"), kind="value"),
        kpi("team_sla", cur["sla_pct"], previous=prev.get("sla_pct"), eligible=cur["sla_eligible"], numerator=cur["sla_met"], absent="not_applicable"),
        kpi("labor_hours", cur["labor_hours"], previous=prev.get("labor_hours"), kind="value", absent="not_applicable",
            note="Only engineering work-order labor is recorded; housekeeping task labor is not tracked and is not counted as zero."),
    ]

    rows = metrics
    if search:
        needle = search.strip().lower()
        rows = [m for m in rows if needle in (m["name"] or "").lower()]
    if role_filter:
        rows = [m for m in rows if m["role"] == role_filter]
    sort_key = sort if sort in TEAM_SORTS else "name"
    # None sorts last regardless of direction so "unknown" is never ranked as best/worst.
    present = [m for m in rows if m.get(sort_key) is not None]
    absent = [m for m in rows if m.get(sort_key) is None]
    present.sort(key=lambda m: (m[sort_key].lower() if isinstance(m[sort_key], str) else m[sort_key]), reverse=descending)
    rows = present + absent
    per_page = max(1, min(per_page, 100))
    page = max(1, page)
    start = (page - 1) * per_page
    return {
        "view": "team",
        "period": ctx.period.as_dict(),
        "comparison_period": ctx.compare_period.as_dict() if ctx.compare_period else None,
        "kpis": kpis,
        "staff": rows[start:start + per_page],
        "meta": {"page": page, "per_page": per_page, "total": len(rows)},
        "roles": sorted({m["role"] for m in metrics}),
        "notes": [
            "Assignment complexity and workload differ by role. Compare people within the same department and read low-sample rows with caution.",
        ],
        "truncated": truncated,
    }

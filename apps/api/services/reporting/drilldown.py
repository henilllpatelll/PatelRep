"""Filtered record lists behind KPIs, charts and exceptions.

Reconciliation guarantee: each filter below uses the SAME cohort query and the SAME
outcome predicate as the KPI it explains (``metrics.py``), so e.g. the
``sla_missed`` list length equals ``sla_eligible - sla_met``. Lists are bounded
(MAX_ROWS) and paginated server-side; ``truncated`` is reported if the cap is hit.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Callable, Optional

from fastapi import HTTPException

from services.reporting import data as report_data
from services.reporting.access import staff_visible_to
from services.reporting.kpi import ReportContext
from services.reporting.metrics import guest_sla_outcome, work_order_is_active_breach, work_order_sla_outcome
from services.reporting.periods import local_midnight_utc, parse_timestamp
from services.reporting.views import guest_review_state, repeat_failure_rows

KINDS = ("work_orders", "guest_requests", "inspections", "pm_deferrals", "tasks")
KIND_VIEW = {
    "work_orders": "maintenance",
    "guest_requests": "guest-experience",
    "inspections": "housekeeping",
    "pm_deferrals": "maintenance",
    "tasks": "team",
}
MAX_PER_PAGE = 100


def _next_midnight(ctx: ReportContext, day: date):
    return local_midnight_utc(day + timedelta(days=1), ctx.tz)


def _in_bucket(ctx: ReportContext, row: dict, field: str, start: Optional[date], end: Optional[date]) -> bool:
    """True if ``row[field]`` falls in the hotel-local days ``[start, end]`` (or no bucket is set)."""
    if start is None or end is None:
        return True
    moment = parse_timestamp(row.get(field))
    return moment is not None and local_midnight_utc(start, ctx.tz) <= moment < _next_midnight(ctx, end)


def _staff_names(ctx: ReportContext) -> dict[str, dict]:
    """Only staff the viewer is allowed to see by name (department scoping)."""
    return {
        uid: p for uid, p in report_data.staff_directory(ctx.supabase, ctx.hotel_id).items()
        if staff_visible_to(ctx.role, p["role"])
    }


def _page(rows: list[dict], page: int, per_page: int) -> tuple[list[dict], dict]:
    per_page = max(1, min(per_page, MAX_PER_PAGE))
    page = max(1, page)
    start = (page - 1) * per_page
    return rows[start:start + per_page], {"page": page, "per_page": per_page, "total": len(rows)}


def _wo_state(wo: dict, now) -> str:
    outcome = work_order_sla_outcome(wo)
    if outcome is True:
        return "met"
    if outcome is False:
        return "missed"
    if wo.get("status") == "completed":
        return "not_eligible"
    return "open_overdue" if work_order_is_active_breach(wo, now) else "open"


def work_order_records(ctx: ReportContext, flt: str, f: dict) -> tuple[list[dict], bool]:
    if "engineering" not in ctx.departments:
        raise HTTPException(status_code=403, detail="Not authorised for engineering records")
    live = flt.endswith("_live")
    if live:
        rows, truncated = report_data.work_orders_open(ctx.supabase, ctx.hotel_id)
    else:
        rows, truncated = report_data.work_orders_created(ctx.supabase, ctx.hotel_id, ctx.period)
    rows = [w for w in rows if _in_bucket(ctx, w, "created_at", f.get("bucket_start"), f.get("bucket_end"))]

    predicates: dict[str, Callable[[dict], bool]] = {
        "all": lambda w: True,
        "sla_met": lambda w: work_order_sla_outcome(w) is True,
        "sla_missed": lambda w: work_order_sla_outcome(w) is False,
        "sla_excluded": lambda w: w.get("status") == "completed" and work_order_sla_outcome(w) is None,
        "completed": lambda w: w.get("status") == "completed",
        "open": lambda w: w.get("status") in ("open", "in_progress", "on_hold"),
        "overdue_live": lambda w: work_order_is_active_breach(w, ctx.now),
        "open_live": lambda w: True,
    }
    if flt == "repeat":
        groups = repeat_failure_rows(ctx, rows)
        keys = {(g["kind"], g["id"]) for g in groups}
        predicate = lambda w: ("asset", w.get("asset_id")) in keys or ("room", w.get("room_id")) in keys  # noqa: E731
    elif flt in predicates:
        predicate = predicates[flt]
    else:
        raise HTTPException(status_code=422, detail=f"Unknown work order filter '{flt}'")
    rows = [w for w in rows if predicate(w)]
    for key in ("status", "priority", "category", "room_id", "asset_id", "assigned_to"):
        if f.get(key):
            rows = [w for w in rows if w.get(key) == f[key]]
    if f.get("priority_not"):
        rows = [w for w in rows if w.get("priority") != f["priority_not"]]
    if f.get("search"):
        needle = f["search"].lower()
        rows = [w for w in rows if needle in (w.get("title") or "").lower()]
    rows.sort(key=lambda w: w.get("created_at") or "", reverse=True)
    rooms, staff = report_data.room_lookup(ctx.supabase, ctx.hotel_id), _staff_names(ctx)
    return [
        {
            "id": w["id"], "title": w.get("title"),
            "room": (rooms.get(w.get("room_id")) or {}).get("room_number"), "room_id": w.get("room_id"), "asset_id": w.get("asset_id"),
            "category": w.get("category"), "priority": w.get("priority"), "status": w.get("status"),
            "assigned_to": (staff.get(w.get("assigned_to")) or {}).get("name"),
            "created_at": w.get("created_at"), "due_at": w.get("due_at"), "completed_at": w.get("completed_at"),
            "sla_state": _wo_state(w, ctx.now),
        }
        for w in rows
    ], truncated


def guest_request_records(ctx: ReportContext, flt: str, f: dict) -> tuple[list[dict], bool]:
    live = flt.endswith("_live")
    base = flt[:-5] if live else flt
    if live:
        categories = report_data.categories_for(ctx.departments)

        def make():
            query = ctx.supabase.table("guest_requests").select(report_data.GUEST_REQUEST_COLUMNS).eq("tenant_id", ctx.hotel_id).in_(
                "status", ["open", "acknowledged", "dispatched", "arrived", "guest_contacted", "reopened", "resolved"])
            return query.in_("category", categories or ["__none__"]) if categories is not None else query

        rows, truncated = report_data.fetch_all(make)
        live_map = {"breached": "breached", "near_deadline": "near_deadline", "unverified": "unverified_resolution"}
        wanted = live_map.get(base)
        if wanted is None:
            raise HTTPException(status_code=422, detail=f"Unknown guest request filter '{flt}'")
        rows = [r for r in rows if guest_review_state(r, ctx.now) == wanted]
    else:
        rows, truncated = report_data.guest_requests_created(ctx.supabase, ctx.hotel_id, ctx.period, departments=ctx.departments)
        rows = [r for r in rows if _in_bucket(ctx, r, "created_at", f.get("bucket_start"), f.get("bucket_end"))]
        predicates = {
            "all": lambda r: True,
            "sla_met": lambda r: guest_sla_outcome(r, ctx.now) is True,
            "sla_missed": lambda r: guest_sla_outcome(r, ctx.now) is False,
            "verified": lambda r: r.get("status") == "verified",
            "breached": lambda r: guest_review_state(r, ctx.now) == "breached",
            "near_deadline": lambda r: guest_review_state(r, ctx.now) == "near_deadline",
            "unverified_resolution": lambda r: guest_review_state(r, ctx.now) == "unverified_resolution",
        }
        if flt not in predicates:
            raise HTTPException(status_code=422, detail=f"Unknown guest request filter '{flt}'")
        rows = [r for r in rows if predicates[flt](r)]
    for key in ("status", "priority", "category", "room_id"):
        if f.get(key):
            rows = [r for r in rows if r.get(key) == f[key]]
    if f.get("search"):
        needle = f["search"].lower()
        rows = [r for r in rows if needle in (r.get("title") or "").lower()]
    rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    rooms = report_data.room_lookup(ctx.supabase, ctx.hotel_id)
    return [
        {
            "id": r["id"], "request_number": r.get("request_number"), "summary": r.get("title"),
            "room": (rooms.get(r.get("room_id")) or {}).get("room_number"), "category": r.get("category"),
            "priority": r.get("priority"), "status": r.get("status"), "created_at": r.get("created_at"), "due_at": r.get("due_at"),
            "department": report_data.CATEGORY_DEPARTMENT.get(r.get("category") or ""),
            "sla_state": {True: "met", False: "missed", None: "not_eligible"}[guest_sla_outcome(r, ctx.now)],
            "review_state": guest_review_state(r, ctx.now),
        }
        for r in rows
    ], truncated


def inspection_records(ctx: ReportContext, flt: str, f: dict) -> tuple[list[dict], bool]:
    if "housekeeping" not in ctx.departments:
        raise HTTPException(status_code=403, detail="Not authorised for housekeeping records")
    rows, truncated = report_data.inspections_completed(ctx.supabase, ctx.hotel_id, ctx.period)
    rows = [i for i in rows if _in_bucket(ctx, i, "completed_at", f.get("bucket_start"), f.get("bucket_end"))]
    allowed = {"all": None, "passed": "passed", "failed": "failed", "conditional": "conditional"}
    if flt not in allowed:
        raise HTTPException(status_code=422, detail=f"Unknown inspection filter '{flt}'")
    if allowed[flt]:
        rows = [i for i in rows if i.get("overall_result") == allowed[flt]]
    if f.get("room_id"):
        rows = [i for i in rows if i.get("room_id") == f["room_id"]]
    rows.sort(key=lambda i: i.get("completed_at") or "", reverse=True)
    rooms = report_data.room_lookup(ctx.supabase, ctx.hotel_id)
    return [
        {"id": i["id"], "room": (rooms.get(i.get("room_id")) or {}).get("room_number"), "room_id": i.get("room_id"),
         "result": i.get("overall_result"), "completed_at": i.get("completed_at")}
        for i in rows
    ], truncated


def pm_deferral_records(ctx: ReportContext, flt: str, f: dict) -> tuple[list[dict], bool]:
    if "engineering" not in ctx.departments:
        raise HTTPException(status_code=403, detail="Not authorised for engineering records")
    rows, truncated = report_data.fetch_all(
        lambda: ctx.supabase.table("pm_deferrals").select("id, pm_schedule_id, deferred_until, reason, created_at")
        .eq("tenant_id", ctx.hotel_id).gte("created_at", ctx.period.start_iso).lt("created_at", ctx.period.end_iso)
    )
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["pm_schedule_id"]] = counts.get(r["pm_schedule_id"], 0) + 1
    if flt == "repeated":
        rows = [r for r in rows if counts[r["pm_schedule_id"]] >= 2]
    elif flt != "all":
        raise HTTPException(status_code=422, detail=f"Unknown PM deferral filter '{flt}'")
    names = {
        s["id"]: s for s in ctx.supabase.table("pm_schedules").select("id, name, asset_id").eq("tenant_id", ctx.hotel_id).execute().data or []
    }
    rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return [
        {"id": r["id"], "pm_schedule_id": r["pm_schedule_id"], "name": (names.get(r["pm_schedule_id"]) or {}).get("name"),
         "asset_id": (names.get(r["pm_schedule_id"]) or {}).get("asset_id"), "deferred_until": r.get("deferred_until"),
         "reason": r.get("reason"), "created_at": r.get("created_at"), "deferral_count": counts[r["pm_schedule_id"]]}
        for r in rows
    ], truncated


def task_records(ctx: ReportContext, flt: str, f: dict) -> tuple[list[dict], bool]:
    staff = _staff_names(ctx)
    rows, truncated = report_data.tasks_created(ctx.supabase, ctx.hotel_id, ctx.period)
    rows = [t for t in rows if t.get("assigned_to") in staff]  # visible staff only
    if f.get("assigned_to"):
        rows = [t for t in rows if t.get("assigned_to") == f["assigned_to"]]
    if flt == "completed":
        rows = [t for t in rows if t.get("status") == "completed"]
    elif flt == "open":
        rows = [t for t in rows if t.get("status") != "completed"]
    elif flt != "all":
        raise HTTPException(status_code=422, detail=f"Unknown task filter '{flt}'")
    rows.sort(key=lambda t: t.get("created_at") or "", reverse=True)
    return [
        {"id": t["id"], "title": t.get("title"), "status": t.get("status"), "priority": t.get("priority"),
         "assigned_to": staff[t["assigned_to"]]["name"], "created_at": t.get("created_at"), "due_at": t.get("due_at"),
         "completed_at": t.get("completed_at")}
        for t in rows
    ], truncated


_BUILDERS = {
    "work_orders": work_order_records,
    "guest_requests": guest_request_records,
    "inspections": inspection_records,
    "pm_deferrals": pm_deferral_records,
    "tasks": task_records,
}


def records(ctx: ReportContext, kind: str, flt: str = "all", *, page: int = 1, per_page: int = 25, **filters) -> dict:
    builder = _BUILDERS.get(kind)
    if builder is None:
        raise HTTPException(status_code=422, detail=f"kind must be one of: {', '.join(KINDS)}")
    rows, truncated = builder(ctx, flt, {k: v for k, v in filters.items() if v not in (None, "")})
    visible, meta = _page(rows, page, per_page)
    return {
        "kind": kind, "filter": flt, "period": ctx.period.as_dict(), "rows": visible, "meta": meta,
        "truncated": truncated,
        "scope": "live" if flt.endswith("_live") else "period",
    }

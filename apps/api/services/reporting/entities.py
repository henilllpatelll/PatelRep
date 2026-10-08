"""Entity drill-downs (employee, room/asset) and metric segment breakdowns."""
from __future__ import annotations


from fastapi import HTTPException

from services.reporting import data as report_data
from services.reporting import housekeeping as hk
from services.reporting.access import STAFF_ROLE_DEPARTMENT, staff_visible_to
from services.reporting.kpi import ReportContext, kpi
from services.reporting.metrics import (
    LOW_SAMPLE_THRESHOLD,
    avg,
    count_series,
    guest_stats,
    hours_between,
    maintenance_stats,
    pct,
    rate_series,
    work_order_sla_outcome,
)
from services.reporting.periods import build_buckets, parse_timestamp
from services.reporting.team import _task_sla


def _not_found():
    # 404 (never 403) so IDs outside the viewer's tenant/department cannot be enumerated.
    return HTTPException(status_code=404, detail="Not found")


# ── Employee ─────────────────────────────────────────────────────────────────


def employee_view(ctx: ReportContext, user_id: str) -> dict:
    directory = report_data.staff_directory(ctx.supabase, ctx.hotel_id)
    person = directory.get(user_id)
    if person is None or not staff_visible_to(ctx.role, person["role"]):
        raise _not_found()

    tasks = [t for t in report_data.tasks_created(ctx.supabase, ctx.hotel_id, ctx.period)[0] if t.get("assigned_to") == user_id]
    orders = [w for w in report_data.work_orders_created(ctx.supabase, ctx.hotel_id, ctx.period)[0] if w.get("assigned_to") == user_id]
    done_tasks = [t for t in tasks if t.get("status") == "completed"]
    wo_stats = maintenance_stats(orders)

    task_out = [_task_sla(t) for t in tasks]
    eligible = wo_stats["sla_eligible"] + sum(1 for o in task_out if o is not None)
    met = wo_stats["sla_met"] + sum(1 for o in task_out if o is True)
    volume = len(tasks) + len(orders)

    buckets = build_buckets(ctx.period, ctx.tz)
    completed_items = [
        {"when": t["completed_at"], "ok": _task_sla(t)} for t in done_tasks if t.get("completed_at")
    ] + [{"when": w["completed_at"], "ok": work_order_sla_outcome(w)} for w in orders if w.get("status") == "completed" and w.get("completed_at")]
    completed_series = count_series(buckets, [{"completed_at": i["when"]} for i in completed_items], when="completed_at")
    sla_series = rate_series(buckets, [{"completed_at": i["when"], "ok": i["ok"]} for i in completed_items], when="completed_at", outcome=lambda i: i["ok"])

    breakdown: dict[str, int] = {}
    for w in orders:
        breakdown[w.get("category") or "general"] = breakdown.get(w.get("category") or "general", 0) + 1
    is_engineering = STAFF_ROLE_DEPARTMENT.get(person["role"]) == "engineering"
    now = ctx.now
    misses = [w for w in orders if work_order_sla_outcome(w) is False] + [t for t in tasks if _task_sla(t) is False]
    open_items = [w for w in orders if w.get("status") != "completed"] + [t for t in tasks if t.get("status") != "completed"]
    response = [h for h in (hours_between(parse_timestamp(w.get("created_at")), parse_timestamp(w.get("started_at"))) for w in orders) if h is not None]

    return {
        "view": "employee",
        "employee": {"user_id": user_id, "name": person["name"], "role": person["role"], "department": STAFF_ROLE_DEPARTMENT.get(person["role"])},
        "period": ctx.period.as_dict(),
        "kpis": [
            kpi("tasks_completed", len(done_tasks), kind="value", note=f"{len(done_tasks)} of {len(tasks)} assigned"),
            kpi("wo_completed", wo_stats["completed"], kind="value", note=f"{wo_stats['completed']} of {wo_stats['total_work_orders']} assigned"),
            kpi("team_sla", pct(met, eligible), eligible=eligible, numerator=met, absent="not_applicable"),
            kpi("labor_hours", wo_stats["total_labor_hours"], kind="value", absent="not_applicable",
                note=None if wo_stats["total_labor_hours"] is not None else "No labor hours were recorded for this person in the period."),
            kpi("maintenance_response", avg(response), kind="value", sample_size=len(response)) if is_engineering else None,
        ],
        "trend": {"completed": completed_series, "sla": sla_series},
        "work_breakdown": {
            "type": "work_order_category" if is_engineering else "assignment_status",
            "rows": (
                [{"key": k, "count": v} for k, v in sorted(breakdown.items(), key=lambda kv: -kv[1])]
                if is_engineering
                else [{"key": "assigned", "count": len(tasks)}, {"key": "completed", "count": len(done_tasks)}]
            ),
        },
        "exceptions": {
            "sla_misses": len(misses),
            "open_assignments": len(open_items),
            "overdue_open": sum(1 for w in orders if w.get("status") in ("open", "in_progress", "on_hold") and (parse_timestamp(w.get("due_at")) or now) < now),
        },
        "low_sample": volume < LOW_SAMPLE_THRESHOLD,
        "notes": [
            "Workload, assignment complexity and role differ between people. Treat this as context for a conversation, not a ranking.",
        ],
    }


# ── Room / asset ─────────────────────────────────────────────────────────────


def room_asset_view(ctx: ReportContext, kind: str, entity_id: str) -> dict:
    sb, hid = ctx.supabase, ctx.hotel_id
    if kind == "room":
        row = sb.table("rooms").select("id, room_number, floor, room_type_id").eq("tenant_id", hid).eq("id", entity_id).maybe_single().execute()
        entity = row.data if row else None
        label = f"Room {entity['room_number']}" if entity else ""
    elif kind == "asset":
        row = sb.table("assets").select("id, name, room_id").eq("tenant_id", hid).eq("id", entity_id).maybe_single().execute()
        entity = row.data if row else None
        label = entity["name"] if entity else ""
    else:
        raise HTTPException(status_code=422, detail="kind must be 'room' or 'asset'")
    if not entity:
        raise _not_found()

    column = "room_id" if kind == "room" else "asset_id"
    orders = [w for w in report_data.work_orders_created(sb, hid, ctx.period)[0] if w.get(column) == entity_id]
    timeline = [
        {"at": w.get("created_at"), "type": "work_order", "id": w["id"], "title": w.get("title"),
         "category": w.get("category"), "status": w.get("status"), "priority": w.get("priority")}
        for w in orders
    ]
    downtime = None
    current_status = None
    if kind == "room":
        inspections = [i for i in report_data.inspections_completed(sb, hid, ctx.period)[0] if i.get("room_id") == entity_id]
        timeline += [{"at": i.get("completed_at"), "type": "inspection", "id": i["id"], "title": f"Inspection {i.get('overall_result')}", "status": i.get("overall_result")} for i in inspections]
        down = hk.downtime(sb, hid, ctx.period)
        mine = next((r for r in down["rooms"] if r["room_id"] == entity_id), None)
        downtime = {"availability": "available", "hours": mine["downtime_hours"] if mine else 0.0}
        status_row = sb.table("room_status").select("status").eq("tenant_id", hid).eq("room_id", entity_id).maybe_single().execute()
        current_status = (status_row.data if status_row else None) or {}
        current_status = current_status.get("status")
    else:
        downtime = {"availability": "unavailable", "reason": "Asset downtime is not recorded; work order timestamps are not treated as downtime."}
    timeline.sort(key=lambda e: e.get("at") or "", reverse=True)

    categories: dict[str, int] = {}
    for w in orders:
        categories[w.get("category") or "general"] = categories.get(w.get("category") or "general", 0) + 1
    top = max(categories.items(), key=lambda kv: kv[1], default=None)
    labor = [float(w["labor_hours"]) for w in orders if w.get("status") == "completed" and w.get("labor_hours") is not None]
    done = [parse_timestamp(w.get("completed_at")) for w in orders if w.get("completed_at")]
    notice = None
    if len(orders) >= 2 and top and top[1] >= 2:
        notice = f"{top[1]} {top[0]}-category work orders were recorded for this {kind} between {ctx.period.start} and {ctx.period.end}. Similar categories do not confirm a shared root cause."
    elif len(orders) >= 2:
        notice = f"{len(orders)} work orders were recorded for this {kind} in the selected period."

    return {
        "view": "room-asset",
        "entity": {"kind": kind, "id": entity_id, "label": label, "current_status": current_status},
        "period": ctx.period.as_dict(),
        "kpis": [
            kpi("wo_completed", len(orders), kind="value", unit="count", note="Work orders created in the period"),
            kpi("labor_hours", round(sum(labor), 1) if labor else None, kind="value", absent="not_applicable"),
        ],
        "downtime": downtime,
        "latest_repair_at": max(done).isoformat() if done else None,
        "repeat_notice": notice,
        "timeline": timeline,
        "no_data": not timeline,
    }


# ── Segments (trend comparison drawer) ───────────────────────────────────────

SEGMENT_DIMENSIONS = {
    "guest_sla": ("category", "department"),
    "maintenance_sla": ("category", "priority"),
    "wo_created": ("category", "priority"),
    "wo_completed": ("category", "priority"),
}


def _segment_value(metric: str, rows: list[dict], now):
    if metric == "guest_sla":
        s = guest_stats(rows, now)
        return s["sla_compliance_pct"], s["sla_eligible"]
    if metric == "maintenance_sla":
        s = maintenance_stats(rows)
        return s["sla_compliance_pct"], s["sla_eligible"]
    if metric == "wo_completed":
        done = sum(1 for r in rows if r.get("status") == "completed")
        return done, len(rows)
    return len(rows), len(rows)


def segments(ctx: ReportContext, metric: str, dimension: str) -> dict:
    allowed = SEGMENT_DIMENSIONS.get(metric)
    if allowed is None or dimension not in allowed:
        raise HTTPException(status_code=422, detail=f"'{dimension}' is not a supported breakdown for '{metric}'")

    def load(period):
        if metric == "guest_sla":
            return report_data.guest_requests_created(ctx.supabase, ctx.hotel_id, period, departments=ctx.departments)[0]
        return report_data.work_orders_created(ctx.supabase, ctx.hotel_id, period)[0]

    def key_of(row: dict) -> str:
        if dimension == "department":
            return report_data.CATEGORY_DEPARTMENT.get(row.get("category") or "", "unattributed")
        return row.get(dimension) or "unspecified"

    def group(rows: list[dict]) -> dict[str, list[dict]]:
        out: dict[str, list[dict]] = {}
        for r in rows:
            out.setdefault(key_of(r), []).append(r)
        return out

    current = group(load(ctx.period))
    previous = group(load(ctx.compare_period)) if ctx.compare_period else {}
    rows = []
    for key in sorted(set(current) | set(previous)):
        value, sample = _segment_value(metric, current.get(key, []), ctx.now)
        prev_value, prev_sample = _segment_value(metric, previous.get(key, []), ctx.now) if ctx.compare_period else (None, 0)
        rows.append({
            "segment": key, "value": value, "sample_size": sample,
            "previous": prev_value, "previous_sample_size": prev_sample,
            "low_sample": sample < LOW_SAMPLE_THRESHOLD,
        })
    rows.sort(key=lambda r: (-r["sample_size"], r["segment"]))
    return {"metric": metric, "dimension": dimension, "segments": rows, "dimensions": list(allowed)}


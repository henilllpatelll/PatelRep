"""Turns a report view into a render-ready ``ReportDocument`` (dict) for CSV/PDF/print and
scheduled email. It calls the SAME view builders as the screens, under the caller's own
``ReportContext`` (role + departments), so an export can never contain more than the
caller may see on screen."""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

from services.reporting.definitions import DEFINITIONS
from services.reporting.exports import render_csv, render_generated_at, render_pdf, safe_filename
from services.reporting.kpi import ReportContext
from services.reporting.management import load_forecast, management_view
from services.reporting.overview import overview_view
from services.reporting.trends import trend_series
from services.reporting.views import guest_view, maintenance_view, team_view
from services.reporting.views_hk import housekeeping_view

TITLES = {
    "overview": "Operations Overview",
    "guest-experience": "Guest Experience",
    "housekeeping": "Housekeeping Performance",
    "maintenance": "Maintenance Performance",
    "team": "Team Performance",
    "management": "Management Intelligence",
}
CHART_METRICS = {
    "overview": ("guest_sla", "maintenance_sla"),
    "guest-experience": ("guest_sla",),
    "housekeeping": ("cleaning_minutes",),
    "maintenance": ("maintenance_sla", "wo_created"),
    "team": (),
    "management": ("cleaning_minutes",),
}


def _col(*pairs: tuple[str, str]) -> list[dict]:
    return [{"key": k, "label": label} for k, label in pairs]


def _table(title: str, columns: list[dict], rows: list[dict]) -> dict:
    return {"title": title, "columns": columns, "rows": rows}


def _kpis_of(view: str, data: dict) -> list[dict]:
    if view != "management":
        return [k for k in data.get("kpis", []) if k]
    out: list[dict] = []
    for section in ("time_labor", "quality_risk", "guest_response"):
        out += data[section]["kpis"]
    return out


def _tables_of(view: str, data: dict) -> list[dict]:
    t: list[dict] = []
    if view == "overview":
        brief = data.get("daily_brief")
        if brief:
            t.append(_table("Daily brief (live, as of generation)", _col(("metric", "Metric"), ("value", "Value")),
                            [{"metric": "Tasks completed today", "value": brief["tasks_completed_today"]}]
                            + ([{"metric": "Open work orders", "value": brief["open_work_orders"]}] if brief["open_work_orders"] is not None else [])
                            + [{"metric": f"Rooms {k}", "value": v} for k, v in sorted((brief["room_status"] or {}).items())]))
    elif view == "guest-experience":
        t.append(_table("Request categories", _col(("key", "Category"), ("count", "Requests"), ("share_pct", "Share (%)")), data["categories"]))
        t.append(_table("Department comparison", _col(("label", "Department"), ("total_requests", "Requests"), ("sla_compliance_pct", "SLA (%)"), ("avg_acknowledgement_minutes", "Avg ack (min)")), data["departments"]))
        t.append(_table("Requests needing review", _col(("request_number", "#"), ("room", "Room"), ("category", "Category"), ("summary", "Summary"), ("sla_state", "State"), ("status", "Status"), ("created_at", "Created")), data["needs_review"]["rows"]))
    elif view == "housekeeping":
        t.append(_table("Room types", _col(("code", "Room type"), ("sessions", "Sessions"), ("avg_minutes", "Avg minutes"), ("baseline_minutes", "Baseline"), ("variance_minutes", "Variance (min)")), data["room_types"]))
        t.append(_table("Most common failed checklist items", _col(("section", "Section"), ("description", "Item"), ("fail_count", "Failures")), data["inspection_quality"]["top_failed_items"]))
        outlook = data["staffing_outlook"]
        if outlook.get("days"):
            t.append(_table("7-day staffing outlook (forward-looking)", _col(("date", "Date"), ("projected_labor_hours", "Labor hours"), ("required_housekeepers", "Required"), ("scheduled_housekeepers", "Scheduled"), ("staffing_gap", "Gap")), outlook["days"]))
    elif view == "maintenance":
        t.append(_table("Work orders by category", _col(("key", "Category"), ("count", "Work orders"), ("share_pct", "Share (%)")), data["by_category"]))
        t.append(_table("Work orders by priority", _col(("key", "Priority"), ("count", "Work orders"), ("share_pct", "Share (%)")), data["by_priority"]))
        t.append(_table("Repeat failures (2+ work orders)", _col(("label", "Room / asset"), ("failure_count", "Work orders"), ("most_recent_at", "Most recent")), data["repeat_failures"]))
        t.append(_table("Highest-priority PM deferrals", _col(("name", "Schedule"), ("deferral_count", "Deferrals"), ("deferred_until", "Deferred until")), data["preventive_maintenance"]["top_deferrals"]))
        t.append(_table("Room downtime", _col(("room", "Room"), ("downtime_hours", "Hours")), data["downtime"]["rooms"]))
    elif view == "team":
        t.append(_table("Staff", _col(("name", "Employee"), ("role", "Role"), ("tasks_completed", "Tasks done"), ("tasks_total", "Tasks assigned"), ("wo_completed", "WOs done"), ("wo_total", "WOs assigned"), ("sla_compliance_pct", "Eligible SLA (%)"), ("total_labor_hours", "Labor hours")), data["staff"]))
    elif view == "management":
        t.append(_table("Housekeeping efficiency by room type", _col(("code", "Room type"), ("sessions", "Sessions"), ("avg_minutes", "Avg minutes"), ("baseline_minutes", "Baseline"), ("variance_minutes", "Variance")), data["time_labor"]["by_room_type"]))
        t.append(_table("Repeat room failures", _col(("room", "Room"), ("failure_count", "Work orders")), data["quality_risk"]["repeat_room_failures"]))
        t.append(_table("Highest-priority PM deferrals", _col(("name", "Schedule"), ("deferral_count", "Deferrals")), data["maintenance_pm"]["preventive_maintenance"]["top_deferrals"]))
        t.append(_table("High-downtime rooms", _col(("room", "Room"), ("downtime_hours", "Hours")), data["maintenance_pm"]["high_downtime_rooms"]))
        outlook = data["staffing_forecast"]
        if outlook.get("days"):
            t.append(_table("7-day staffing forecast (forward-looking)", _col(("date", "Date"), ("required_housekeepers", "Required"), ("scheduled_housekeepers", "Scheduled"), ("staffing_gap", "Gap")), outlook["days"]))
    return t


async def build_document(
    view: str, ctx: ReportContext, *, include_charts: bool = True, include_definitions: bool = True, include_exceptions: bool = True
) -> dict:
    if view not in TITLES:
        raise HTTPException(status_code=422, detail=f"Unknown report '{view}'")
    notes: list[str] = []
    if view == "overview":
        forecast = await load_forecast(ctx)
        data = overview_view(ctx, forecast)
    elif view == "guest-experience":
        data = guest_view(ctx)
    elif view == "housekeeping":
        data = housekeeping_view(ctx, await load_forecast(ctx))
    elif view == "maintenance":
        data = maintenance_view(ctx)
    elif view == "team":
        department = ctx.departments[0] if len(ctx.departments) == 1 else None  # honour the department filter
        data = team_view(ctx, per_page=100, department=department)
        page = 1
        while data["meta"]["total"] > page * 100:  # export the whole (bounded) team, not just page 1
            page += 1
            more = team_view(ctx, page=page, per_page=100, department=department)
            data["staff"] += more["staff"]
        notes += data.get("notes", [])
    else:
        data = await management_view(ctx)
        notes.append(data["downtime_exposure"]["caveat"])
    if data.get("truncated"):
        notes.append(data.get("truncation_notice") or "Some source data exceeded the reporting record limit; affected figures are hidden.")

    kpis = _kpis_of(view, data)
    capped = bool(data.get("truncated"))
    charts = []
    if include_charts and not capped:  # a trend over a capped cohort is a partial series, not a result
        for metric in CHART_METRICS[view]:
            try:
                series = trend_series(ctx, metric)
            except HTTPException:
                continue
            charts.append({"title": f"{series['label']} ({series['granularity']})",
                           "points": [{"label": p["bucket"], "value": p["value"]} for p in series["points"]]})
    definitions = []
    if include_definitions:
        seen = []
        for k in kpis:
            if k["key"] in DEFINITIONS and k["key"] not in seen:
                seen.append(k["key"])
        definitions = [DEFINITIONS[key] for key in seen]
    exceptions = data.get("needs_attention", []) if include_exceptions and not capped else []
    if ctx.compare_period:
        notes.append("Comparison values are shown only where the same metric definition is available for both periods.")
    if any(k["scope"] == "live" for k in kpis) or view in ("overview", "maintenance"):
        notes.append("Live figures reflect the moment of generation and are not part of the historical period.")

    tenant = ctx.supabase.table("tenants").select("name").eq("id", ctx.hotel_id).maybe_single().execute()
    hotel_name = ((tenant.data if tenant else None) or {}).get("name") or "Hotel"
    return {
        "view": view,
        "title": TITLES[view],
        "hotel_name": hotel_name,
        "period": ctx.period.as_dict(),
        "comparison": ctx.compare_period.as_dict() if ctx.compare_period else None,
        "department": ", ".join(ctx.departments) if 0 < len(ctx.departments) < 2 else None,
        "generated_at": render_generated_at(ctx.now),
        "kpis": kpis,
        "charts": charts,
        "exceptions": exceptions,
        "tables": [] if capped else _tables_of(view, data),  # breakdowns of a capped cohort would read as complete
        "definitions": definitions,
        "notes": notes,
        "summary": [k for k in kpis if k["availability"] == "available"][:5],
    }


def render_document(doc: dict, fmt: str) -> tuple[bytes, str, str]:
    """-> (bytes, media type, filename)."""
    base = safe_filename(doc["view"], doc["period"]["start"], "to", doc["period"]["end"])
    if fmt == "csv":
        return render_csv(doc), "text/csv; charset=utf-8", f"{base}.csv"
    if fmt == "pdf":
        return render_pdf(doc), "application/pdf", f"{base}.pdf"
    raise HTTPException(status_code=422, detail="format must be csv or pdf")


def export_options(raw: Optional[dict]) -> dict:
    raw = raw or {}
    return {
        "include_charts": bool(raw.get("include_charts", True)),
        "include_definitions": bool(raw.get("include_definitions", True)),
        "include_exceptions": bool(raw.get("include_exceptions", True)),
    }

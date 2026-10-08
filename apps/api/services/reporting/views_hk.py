"""Housekeeping Performance view (Phase 2)."""
from __future__ import annotations

from typing import Optional

from services.reporting import data as report_data
from services.reporting import housekeeping as hk
from services.reporting.kpi import ReportContext, kpi
from services.reporting.metrics import pct
from services.reporting.truncation import tracked

_IN_CHUNK = 150  # keep PostgREST in.() URLs short


def _inspection_results(ctx: ReportContext, inspection_ids: list[str]) -> list[dict]:
    rows: list[dict] = []
    for i in range(0, len(inspection_ids), _IN_CHUNK):
        chunk = inspection_ids[i:i + _IN_CHUNK]
        # Paged: one chunk of inspections holds far more than PostgREST's 1,000-row response limit.
        part, _ = report_data.fetch_all(
            lambda: ctx.supabase.table("inspection_results").select("inspection_id, template_item_id, result")
            .eq("tenant_id", ctx.hotel_id).in_("inspection_id", chunk).order("inspection_id"),
            source="inspection_results",
        )
        rows += part
    return rows


def _item_names(ctx: ReportContext, item_ids: list[str]) -> dict[str, dict]:
    names: dict[str, dict] = {}
    for i in range(0, len(item_ids), _IN_CHUNK):
        for r in ctx.supabase.table("inspection_template_items").select("id, section, description").eq(
            "tenant_id", ctx.hotel_id
        ).in_("id", item_ids[i:i + _IN_CHUNK]).execute().data or []:
            names[r["id"]] = r
    return names


def period_numbers(ctx: ReportContext, period):
    """Everything the housekeeping KPIs need for ``period`` (shared by current + comparison)."""
    rooms = report_data.room_lookup(ctx.supabase, ctx.hotel_id)
    baselines, room_types = hk.room_type_baselines(ctx.supabase, ctx.hotel_id)
    room_type_by_room = {rid: r.get("room_type_id") for rid, r in rooms.items()}
    sessions = hk.clean_sessions(ctx.supabase, ctx.hotel_id, period, ctx.tz, room_type_by_room)
    eff = hk.efficiency(sessions, baselines)
    inspections, _ = report_data.inspections_completed(ctx.supabase, ctx.hotel_id, period)
    results = _inspection_results(ctx, [i["id"] for i in inspections]) if inspections else []
    quality = hk.inspection_quality(inspections, results)
    return {
        "rooms": rooms, "room_types": room_types, "sessions": sessions, "eff": eff,
        "inspections": inspections, "results": results, "quality": quality,
    }


def staffing_outlook(forecast: Optional[dict], role: str) -> dict:
    """Forward-looking 7-day outlook; labelled independent of the historical filter."""
    if role != "gm":
        return {"availability": "unavailable", "reason": "The 7-day staffing forecast is available to the General Manager."}
    if not forecast:
        return {"availability": "unavailable", "reason": "Forecast could not be loaded."}
    if forecast.get("truncated"):
        return {"availability": "unavailable", "reason": "The history behind the forecast exceeded the reporting record limit, so it is not shown."}
    data = forecast.get("data", forecast)
    days = [
        {
            "date": d["date"],
            "projected_rooms": d.get("projected_rooms"),
            "projected_labor_hours": d.get("projected_labor_hours"),
            "required_housekeepers": d.get("suggested_housekeepers"),
            "scheduled_housekeepers": d.get("scheduled_housekeepers"),
            "staffing_gap": d.get("staffing_gap"),
        }
        for d in data.get("days", [])
    ]
    return {
        "availability": "available" if days else "not_enough_data",
        "horizon": "next 7 days (independent of the selected reporting dates)",
        "basis": f"Trailing {data.get('lookback_weeks', 4)}-week average of completed cleans. A confidence score is not computed.",
        "days": days,
    }


@tracked
def housekeeping_view(ctx: ReportContext, forecast: Optional[dict] = None) -> dict:
    cur = period_numbers(ctx, ctx.period)
    prev = period_numbers(ctx, ctx.compare_period) if ctx.compare_period else None
    q, e = cur["quality"], cur["eff"]
    pq = prev["quality"] if prev else {}
    pe = prev["eff"] if prev else {}

    repeat_count = len(q.get("repeat_defects", []))
    kpis = [
        kpi("rooms_serviced", len(cur["sessions"]), previous=len(prev["sessions"]) if prev else None, kind="value"),
        kpi("cleaning_minutes", e.get("minutes_per_occupied_room"), previous=pe.get("minutes_per_occupied_room"), kind="value",
            sample_size=e.get("occupied_room_days")),
        kpi("inspection_pass", q.get("pass_rate_pct"), previous=pq.get("pass_rate_pct"),
            eligible=q.get("total_inspections"), numerator=q.get("passed")),
        kpi("repeat_defects", repeat_count, previous=len(pq.get("repeat_defects", [])) if prev else None, kind="value",
            note="Counts checklist items failing in 2+ inspections. Re-cleans are not recorded separately."),
    ]

    room_types = cur["room_types"]
    table = []
    for row in e.get("by_room_type", []):
        meta = room_types.get(row["room_type_id"], {})
        table.append({
            "room_type_id": row["room_type_id"],
            "code": meta.get("code"), "name": meta.get("name"),
            "sessions": row["sessions"], "avg_minutes": row["avg_minutes"],
            "baseline_minutes": row["baseline_minutes"],  # None = no baseline configured
            "variance_minutes": row["variance_minutes"], "variance_pct": row["variance_pct"],
            "low_sample": row["sessions"] < 5,
        })
    table.sort(key=lambda r: (r["code"] or ""))

    fail_counts: dict[str, int] = {}
    for r in cur["results"]:
        if r.get("result") == "fail" and r.get("template_item_id"):
            fail_counts[r["template_item_id"]] = fail_counts.get(r["template_item_id"], 0) + 1
    names = _item_names(ctx, list(fail_counts))
    failed_items = [
        {
            "template_item_id": item_id,
            "section": names.get(item_id, {}).get("section"),
            "description": names.get(item_id, {}).get("description"),
            "fail_count": count,
        }
        for item_id, count in sorted(fail_counts.items(), key=lambda kv: -kv[1])[:10]
    ]
    by_section: dict[str, int] = {}
    for item in failed_items:
        key = item["section"] or "Uncategorised"
        by_section[key] = by_section.get(key, 0) + item["fail_count"]

    total = q.get("total_inspections", 0)
    return {
        "view": "housekeeping",
        "period": ctx.period.as_dict(),
        "comparison_period": ctx.compare_period.as_dict() if ctx.compare_period else None,
        "kpis": kpis,
        "room_types": table,
        "inspection_quality": {
            "total": total,
            "passed": q.get("passed", 0), "failed": q.get("failed", 0), "conditional": q.get("conditional", 0),
            "shares": {k: pct(q.get(k, 0), total) for k in ("passed", "failed", "conditional")},
            "top_failed_items": failed_items,
            "failed_by_section": [{"section": k, "fail_count": v} for k, v in sorted(by_section.items(), key=lambda kv: -kv[1])],
            "repeat_defects": [
                {**d, "section": names.get(d["template_item_id"], {}).get("section"), "description": names.get(d["template_item_id"], {}).get("description")}
                for d in q.get("repeat_defects", [])
            ],
        },
        "staffing_outlook": staffing_outlook(forecast, ctx.role),
    }

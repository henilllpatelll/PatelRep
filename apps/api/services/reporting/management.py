"""Management Intelligence (GM only): consolidates the existing Management ROI calculators
with the shared Guest Experience metrics. No financial figure is computed here that ROI
does not already define; revenue exposure is always labelled an estimate."""
from __future__ import annotations

from services.reporting import data as report_data
from services.reporting import housekeeping as hk
from services.reporting.kpi import ReportContext, kpi
from services.reporting.trends import trend_series
from services.reporting.views import guest_view, pm_section
from services.reporting.views_hk import staffing_outlook


def ai_usage_summary(supabase, hotel_id: str, period) -> dict:
    interactions, truncated = report_data.fetch_all(
        lambda: supabase.table("ai_interactions")
        .select("interaction_type, credits_charged, model_used, success")
        .eq("tenant_id", hotel_id)
        .gte("created_at", period.start_iso)
        .lt("created_at", period.end_iso)
    )
    breakdown: dict = {}
    for i in interactions:
        key = i.get("interaction_type") or "unknown"
        breakdown[key] = breakdown.get(key, 0) + (i.get("credits_charged") or 0)
    return {
        "total_credits_used": sum(i.get("credits_charged") or 0 for i in interactions),
        "total_interactions": len(interactions),
        "breakdown_by_type": breakdown,
        "truncated": truncated,
    }


async def load_forecast(ctx: ReportContext):
    """GM-only 7-day forecast via the existing ROI calculation (None if not allowed / failed)."""
    if ctx.role != "gm":
        return None
    from routers import management_roi as roi

    try:
        return await roi.get_seven_day_forecast(lookback_weeks=4, current_user=ctx.user)
    except Exception:  # forecast is optional; its section degrades to "unavailable"
        return None


async def management_view(ctx: ReportContext) -> dict:
    from routers import management_roi as roi

    s, e, u = ctx.period.start, ctx.period.end, ctx.user
    eff = (await roi.get_housekeeping_efficiency(start_date=s, end_date=e, current_user=u))["data"]
    insp = (await roi.get_inspection_trends(start_date=s, end_date=e, current_user=u))["data"]
    repeat = (await roi.get_repeat_failures(start_date=s, end_date=e, current_user=u))["data"]
    down = (await roi.get_downtime_revenue(start_date=s, end_date=e, current_user=u))["data"]
    training = (await roi.get_training_readiness(current_user=u))["data"]
    forecast = await load_forecast(ctx)

    prior_eff = prior_insp = None
    if ctx.compare_period:
        ps, pe = ctx.compare_period.start, ctx.compare_period.end
        prior_eff = (await roi.get_housekeeping_efficiency(start_date=ps, end_date=pe, current_user=u))["data"]
        prior_insp = (await roi.get_inspection_trends(start_date=ps, end_date=pe, current_user=u))["data"]

    has_sessions = bool(eff.get("occupied_room_days"))
    inspected = insp.get("total_inspections", 0)
    rooms = report_data.room_lookup(ctx.supabase, ctx.hotel_id)
    _, room_types = hk.room_type_baselines(ctx.supabase, ctx.hotel_id)

    guest = guest_view(ctx)
    pm = pm_section(ctx)
    revenue = down["revenue"]
    exposure_cents = revenue["revenue_impact_cents"] if revenue["configured"] else None

    return {
        "view": "management",
        "period": ctx.period.as_dict(),
        "comparison_period": ctx.compare_period.as_dict() if ctx.compare_period else None,
        "time_labor": {
            "kpis": [kpi("cleaning_minutes", eff["minutes_per_occupied_room"] if has_sessions else None,
                         previous=(prior_eff or {}).get("minutes_per_occupied_room") if (prior_eff or {}).get("occupied_room_days") else None,
                         kind="value", sample_size=eff.get("occupied_room_days"))],
            "by_room_type": [
                {**r, "code": room_types.get(r["room_type_id"], {}).get("code"), "name": room_types.get(r["room_type_id"], {}).get("name")}
                for r in eff.get("by_room_type", [])
            ],
            "trend": trend_series(ctx, "cleaning_minutes"),
            "forecast_labor_hours": None if not forecast else [
                {"date": d["date"], "projected_labor_hours": d.get("projected_labor_hours")} for d in forecast["data"].get("days", [])
            ],
        },
        "quality_risk": {
            "kpis": [
                kpi("inspection_pass", insp.get("pass_rate_pct") if inspected else None,
                    previous=(prior_insp or {}).get("pass_rate_pct") if (prior_insp or {}).get("total_inspections") else None,
                    eligible=inspected, numerator=insp.get("passed")),
                kpi("repeat_defects", len(insp.get("repeat_defects", [])), kind="value",
                    note="Counts checklist items failing in 2+ inspections. Re-cleans are not recorded separately."),
            ],
            "repeat_room_failures": [{**r, "room": (rooms.get(r["room_id"]) or {}).get("room_number")} for r in repeat.get("repeat_rooms", [])],
            "repeat_asset_failures": repeat.get("repeat_assets", []),
            "training_readiness": training,
        },
        "guest_response": {"kpis": [k for k in guest["kpis"] if k["key"] != "guest_requests_total"]},
        "maintenance_pm": {
            "preventive_maintenance": pm,
            "high_downtime_rooms": [
                {**r, "room": (rooms.get(r["room_id"]) or {}).get("room_number")} for r in down["downtime"]["rooms"][:10]
            ],
        },
        "downtime_exposure": {
            "total_downtime_hours": down["downtime"]["total_downtime_hours"] if down["downtime"]["rooms"] else None,
            "rooms_affected": down["downtime"]["rooms_affected"],
            "estimate_cents": exposure_cents,
            "adr_configured": revenue["configured"],
            "is_estimate": True,
            "caveat": "Estimated exposure = downtime hours x configured ADR / 24. It is not actual lost revenue and is not a measure of revenue protected.",
        },
        "staffing_forecast": staffing_outlook(forecast, ctx.role),
        "ai_usage": ai_usage_summary(ctx.supabase, ctx.hotel_id, ctx.period),
    }


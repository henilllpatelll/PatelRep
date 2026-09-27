"""Curated, server-computed Engineering management reporting."""

from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query

from core.database import supabase
from middleware.auth import CurrentUser, require_role
from services.engineering_insights import build_engineering_insights


router = APIRouter(prefix="/engineering/insights", tags=["engineering-insights"])


def _hotel_window(user: CurrentUser, range_key: str, start: datetime | None, end: datetime | None) -> tuple[datetime, datetime]:
    if (start is None) != (end is None):
        raise HTTPException(status_code=422, detail="Custom reporting requires both start and end")
    timezone_name = "America/Chicago"
    tenant = supabase.table("tenants").select("timezone").eq("id", user.hotel_id).maybe_single().execute()
    if tenant and tenant.data and tenant.data.get("timezone"):
        timezone_name = tenant.data["timezone"]
    try:
        local_zone = ZoneInfo(timezone_name)
    except Exception:
        local_zone = ZoneInfo("America/Chicago")
    now = datetime.now(local_zone)
    if start and end:
        if end < start or end - start > timedelta(days=366):
            raise HTTPException(status_code=422, detail="Reporting range must be between one and 366 days")
        return start.astimezone(timezone.utc), end.astimezone(timezone.utc)
    local_end = now.replace(hour=23, minute=59, second=59, microsecond=999999)
    if range_key == "ytd":
        local_start = local_end.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        days = {"7d": 7, "30d": 30, "90d": 90}[range_key]
        local_start = (local_end - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return local_start.astimezone(timezone.utc), local_end.astimezone(timezone.utc)


@router.get("")
async def get_engineering_insights(
    range: Literal["7d", "30d", "90d", "ytd", "custom"] = Query("30d"),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    current_user: CurrentUser = Depends(require_role("gm", "chief_engineer")),
):
    if range == "custom" and not (start and end):
        raise HTTPException(status_code=422, detail="Custom reporting requires start and end")
    window_start, window_end = _hotel_window(current_user, range, start, end)
    tenant_id = current_user.hotel_id
    # One bounded set of server-side reads. Calculations remain off the browser;
    # table reads are date-constrained wherever a timestamp is available.
    work_orders = supabase.table("work_orders").select("id, title, created_at, acknowledged_at, arrived_at, completed_at, status, labor_cost, parts_cost, vendor_cost, asset_id, verification_result").eq("tenant_id", tenant_id).gte("created_at", window_start.isoformat()).execute().data or []
    engagements = supabase.table("work_order_vendor_engagements").select("work_order_id, vendor_id, status, requested_at, accepted_at, arrived_at, completed_at, invoice_amount, service_type").eq("tenant_id", tenant_id).gte("requested_at", window_start.isoformat()).execute().data or []
    rooms = supabase.table("room_unavailability_periods").select("id, started_at, actual_return_at, expected_return_at, status, reason_label, repair_completed_at").eq("tenant_id", tenant_id).gte("started_at", window_start.isoformat()).execute().data or []
    downtime = supabase.table("asset_downtime_periods").select("asset_id, started_at, restored_at, downtime_type").eq("tenant_id", tenant_id).gte("started_at", window_start.isoformat()).execute().data or []
    pm_completions = supabase.table("pm_completion_records").select("completed_at").eq("tenant_id", tenant_id).gte("completed_at", window_start.isoformat()).execute().data or []
    pm_schedules = supabase.table("pm_schedules").select("next_due_at, is_active").eq("tenant_id", tenant_id).lte("next_due_at", window_end.isoformat()).execute().data or []
    readings = supabase.table("meter_readings").select("recorded_at, status_at_recording, corrective_work_order_id").eq("tenant_id", tenant_id).gte("recorded_at", window_start.isoformat()).execute().data or []
    vendors = supabase.table("engineering_vendors").select("id, name").eq("tenant_id", tenant_id).execute().data or []
    relationships = supabase.table("work_order_relationships").select("parent_work_order_id, relationship_type").eq("tenant_id", tenant_id).eq("relationship_type", "repeat_failure").execute().data or []
    labor = supabase.table("work_order_labor_sessions").select("work_order_id, duration_minutes, ended_at").eq("tenant_id", tenant_id).gte("ended_at", window_start.isoformat()).execute().data or []
    assets = supabase.table("assets").select("id, name").eq("tenant_id", tenant_id).execute().data or []
    return {"data": build_engineering_insights(work_orders=work_orders, vendor_engagements=engagements, room_periods=rooms, asset_downtime=downtime, pm_completions=pm_completions, condition_readings=readings, vendors=vendors, relationships=relationships, labor_sessions=labor, assets=assets, pm_schedules=pm_schedules, start=window_start, end=window_end)}

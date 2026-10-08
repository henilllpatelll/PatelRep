"""Report view, trend and drill-down endpoints (redesign Phases 2-3).

Every handler: (1) checks the caller may see the view (server-side RBAC), (2) resolves the
shared hotel-local period, (3) scopes to the caller's departments, (4) delegates to the
service layer so KPIs, trends and drill-down share one definition.
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from core.database import supabase
from middleware.auth import CurrentUser, get_current_user
from services.reporting import drilldown, entities
from services.reporting.access import can_view, effective_departments, require_report_view
from services.reporting.kpi import ReportContext
from services.reporting.management import load_forecast, management_view
from services.reporting.overview import overview_view
from services.reporting.periods import comparison_period, hotel_timezone, resolve_period
from services.reporting.trends import TREND_METRICS, trend_series
from services.reporting.views import guest_view, maintenance_view, team_view
from services.reporting.views_hk import housekeeping_view

router = APIRouter(prefix="/reports", tags=["reports"])


def build_context(
    user: CurrentUser,
    start_date: Optional[date],
    end_date: Optional[date],
    compare: Optional[str],
    department: Optional[str],
) -> ReportContext:
    tz = hotel_timezone(supabase, user.hotel_id)
    period = resolve_period(start_date, end_date, tz)
    return ReportContext(
        supabase=supabase,
        hotel_id=user.hotel_id,
        user_id=user.user_id,
        role=user.role,
        tz=tz,
        period=period,
        compare_period=comparison_period(period, compare, tz),
        departments=effective_departments(user.role, department),
        user=user,
    )


def _ctx(view: str, user, start_date, end_date, compare, department) -> ReportContext:
    require_report_view(view, user)
    return build_context(user, start_date, end_date, compare, department)


@router.get("/views/overview")
async def overview(
    start_date: Optional[date] = Query(None), end_date: Optional[date] = Query(None),
    compare: Optional[str] = Query(None), department: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    ctx = _ctx("overview", current_user, start_date, end_date, compare, department)
    forecast = await load_forecast(ctx) if can_view(ctx.role, "housekeeping") else None
    return {"data": overview_view(ctx, forecast)}


@router.get("/views/guest-experience")
async def guest_experience(
    start_date: Optional[date] = Query(None), end_date: Optional[date] = Query(None),
    compare: Optional[str] = Query(None), department: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    return {"data": guest_view(_ctx("guest-experience", current_user, start_date, end_date, compare, department))}


@router.get("/views/housekeeping")
async def housekeeping(
    start_date: Optional[date] = Query(None), end_date: Optional[date] = Query(None),
    compare: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    ctx = _ctx("housekeeping", current_user, start_date, end_date, compare, "housekeeping")
    return {"data": housekeeping_view(ctx, await load_forecast(ctx))}


@router.get("/views/maintenance")
async def maintenance(
    start_date: Optional[date] = Query(None), end_date: Optional[date] = Query(None),
    compare: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    return {"data": maintenance_view(_ctx("maintenance", current_user, start_date, end_date, compare, "engineering"))}


@router.get("/views/team")
async def team(
    start_date: Optional[date] = Query(None), end_date: Optional[date] = Query(None),
    compare: Optional[str] = Query(None), department: Optional[str] = Query(None),
    page: int = Query(1, ge=1), per_page: int = Query(25, ge=1, le=100),
    search: Optional[str] = Query(None, max_length=80), role: Optional[str] = Query(None, max_length=40),
    sort: str = Query("name", max_length=30), desc: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
):
    ctx = _ctx("team", current_user, start_date, end_date, compare, department)
    return {"data": team_view(ctx, page=page, per_page=per_page, search=search, role_filter=role, sort=sort,
                              descending=desc, department=department)}


@router.get("/views/management")
async def management(
    start_date: Optional[date] = Query(None), end_date: Optional[date] = Query(None),
    compare: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    return {"data": await management_view(_ctx("management", current_user, start_date, end_date, compare, None))}


@router.get("/trends")
async def trends(
    metric: str = Query(...),
    granularity: Optional[str] = Query(None, pattern="^(day|week|month)$"),
    start_date: Optional[date] = Query(None), end_date: Optional[date] = Query(None),
    compare: Optional[str] = Query(None), department: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    spec = TREND_METRICS.get(metric)
    if spec is None:
        raise HTTPException(status_code=422, detail=f"Unknown trend metric '{metric}'")
    ctx = _ctx(spec["view"], current_user, start_date, end_date, compare, department)
    needed = spec.get("department")
    if needed and needed not in ctx.departments:
        raise HTTPException(status_code=403, detail="Not authorised for this metric's department")
    return {"data": trend_series(ctx, metric, granularity)}


@router.get("/segments")
async def segments(
    metric: str = Query(...), dimension: str = Query(...),
    start_date: Optional[date] = Query(None), end_date: Optional[date] = Query(None),
    compare: Optional[str] = Query(None), department: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    spec = TREND_METRICS.get(metric)
    if spec is None:
        raise HTTPException(status_code=422, detail=f"Unknown metric '{metric}'")
    ctx = _ctx(spec["view"], current_user, start_date, end_date, compare, department)
    return {"data": entities.segments(ctx, metric, dimension)}


@router.get("/records")
async def records(
    kind: str = Query(...), filter: str = Query("all", max_length=40),
    start_date: Optional[date] = Query(None), end_date: Optional[date] = Query(None),
    department: Optional[str] = Query(None),
    page: int = Query(1, ge=1), per_page: int = Query(25, ge=1, le=100),
    search: Optional[str] = Query(None, max_length=80),
    status: Optional[str] = Query(None, max_length=30), priority: Optional[str] = Query(None, max_length=20),
    priority_not: Optional[str] = Query(None, max_length=20), category: Optional[str] = Query(None, max_length=30),
    room_id: Optional[str] = Query(None, max_length=64), asset_id: Optional[str] = Query(None, max_length=64),
    assigned_to: Optional[str] = Query(None, max_length=64),
    bucket_start: Optional[date] = Query(None), bucket_end: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    view = drilldown.KIND_VIEW.get(kind)
    if view is None:
        raise HTTPException(status_code=422, detail=f"kind must be one of: {', '.join(drilldown.KINDS)}")
    ctx = _ctx(view, current_user, start_date, end_date, None, department)
    return {"data": drilldown.records(
        ctx, kind, filter, page=page, per_page=per_page, search=search, status=status, priority=priority,
        priority_not=priority_not, category=category, room_id=room_id, asset_id=asset_id, assigned_to=assigned_to,
        bucket_start=bucket_start, bucket_end=bucket_end,
    )}


@router.get("/employee/{user_id}")
async def employee(
    user_id: str,
    start_date: Optional[date] = Query(None), end_date: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    ctx = _ctx("team", current_user, start_date, end_date, None, None)
    return {"data": entities.employee_view(ctx, user_id)}


@router.get("/room-asset/{kind}/{entity_id}")
async def room_asset(
    kind: str, entity_id: str,
    start_date: Optional[date] = Query(None), end_date: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    if kind not in ("room", "asset"):
        raise HTTPException(status_code=422, detail="kind must be 'room' or 'asset'")
    allowed_views = ("housekeeping", "maintenance") if kind == "room" else ("maintenance",)
    if not any(can_view(current_user.role, v) for v in allowed_views):
        raise HTTPException(status_code=403, detail="Insufficient permissions for this report")
    tz = hotel_timezone(supabase, current_user.hotel_id)
    period = resolve_period(start_date, end_date, tz)
    ctx = ReportContext(
        supabase=supabase, hotel_id=current_user.hotel_id, user_id=current_user.user_id, role=current_user.role,
        tz=tz, period=period, departments=effective_departments(current_user.role, None), user=current_user,
    )
    return {"data": entities.room_asset_view(ctx, kind, entity_id)}

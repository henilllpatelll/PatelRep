"""Report export (CSV/PDF) and scheduled-report management (redesign Phase 4).

* Export re-uses the exact view builders under the caller's own role/department scope.
* Schedules are validated server-side; success is only returned after the row is persisted.
* A user manages their own schedules; the GM manages every schedule in the hotel.
"""
import io
import re
import zipfile
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator

from core.database import supabase
from core.roles import GM_ONLY_ROLES
from middleware.auth import CurrentUser, get_current_user
from routers.report_views import build_context
from services import email_delivery
from services.reporting import delivery as delivery_service
from services.reporting import schedule as sched
from services.reporting.access import STAFF_ROLE_DEPARTMENT, VIEWS, can_view, effective_departments, require_report_view, views_for_role
from services.reporting.documents import build_document, export_options, render_document
from services.reporting.exports import safe_filename
from services.reporting.periods import hotel_timezone

router = APIRouter(prefix="/reports", tags=["reports"])

MAX_RECIPIENTS = 25
MAX_SCHEDULES_PER_HOTEL = 50
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


ALL_REPORTS = "all"
# Views that belong to exactly one department ignore the global department filter, exactly like their screens.
_FIXED_DEPARTMENT = {"housekeeping": "housekeeping", "maintenance": "engineering", "management": None}


def view_department(view: str, department: Optional[str]) -> Optional[str]:
    return _FIXED_DEPARTMENT[view] if view in _FIXED_DEPARTMENT else department


async def _build(view: str, user: CurrentUser, start_date, end_date, compare, department, options: dict) -> dict:
    ctx = build_context(user, start_date, end_date, compare, view_department(view, department))
    return await build_document(view, ctx, **options)


@router.get("/export")
async def export_report(
    view: str = Query(...),
    format: str = Query("pdf", pattern="^(csv|pdf)$"),
    start_date: Optional[date] = Query(None), end_date: Optional[date] = Query(None),
    compare: Optional[str] = Query(None), department: Optional[str] = Query(None),
    include_charts: bool = Query(True), include_definitions: bool = Query(True), include_exceptions: bool = Query(True),
    current_user: CurrentUser = Depends(get_current_user),
):
    options = export_options({
        "include_charts": include_charts and format == "pdf",
        "include_definitions": include_definitions, "include_exceptions": include_exceptions,
    })
    if view == ALL_REPORTS:
        return await _export_all(format, start_date, end_date, compare, department, options, current_user)
    require_report_view(view, current_user)
    doc = await _build(view, current_user, start_date, end_date, compare, department, options)
    body, media_type, filename = render_document(doc, format)
    return Response(content=body, media_type=media_type, headers={
        "Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store",
    })


async def _export_all(format, start_date, end_date, compare, department, options, user: CurrentUser) -> Response:
    """One archive with a file per report the caller may open. Authorised per view (never a superset of what the
    screens show) and all-or-nothing: a report that cannot be built fails the export instead of vanishing from it."""
    views = [v for v in VIEWS if can_view(user.role, v)]
    if not views:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    buffer = io.BytesIO()
    period = None
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for view in views:
            try:
                doc = await _build(view, user, start_date, end_date, compare, department, options)
                body, _media, filename = render_document(doc, format)
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=500, detail=f"The {view} report could not be built; nothing was exported")
            period = period or doc["period"]
            archive.writestr(filename, body)
    name = safe_filename("patelrep-all-reports", period["start"], "to", period["end"]) if period else "patelrep-all-reports"
    return Response(content=buffer.getvalue(), media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="{name}.zip"', "Cache-Control": "no-store",
    })


# ── Schedules ────────────────────────────────────────────────────────────────


class ScheduleIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    report_type: str
    frequency: str
    day_of_week: Optional[int] = Field(None, ge=0, le=6)
    day_of_month: Optional[int] = Field(None, ge=1, le=28)
    local_time: str
    reporting_window: Optional[str] = None
    output_format: str = "pdf"
    recipient_ids: list[str] = Field(default_factory=list, max_length=MAX_RECIPIENTS)
    department: Optional[str] = None
    include_definitions: bool = True

    @field_validator("local_time")
    @classmethod
    def _valid_time(cls, value: str) -> str:
        if not _TIME.match(value):
            raise ValueError("local_time must be HH:MM (24-hour)")
        return value


class SchedulePatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    frequency: Optional[str] = None
    day_of_week: Optional[int] = Field(None, ge=0, le=6)
    day_of_month: Optional[int] = Field(None, ge=1, le=28)
    local_time: Optional[str] = None
    reporting_window: Optional[str] = None
    output_format: Optional[str] = None
    recipient_ids: Optional[list[str]] = Field(None, max_length=MAX_RECIPIENTS)
    department: Optional[str] = None
    include_definitions: Optional[bool] = None
    enabled: Optional[bool] = None


def _validate_shape(frequency: str, window: str, fmt: str, dow, dom) -> None:
    if frequency not in sched.FREQUENCIES:
        raise HTTPException(status_code=422, detail="frequency must be daily, weekly or monthly")
    if window not in sched.WINDOWS:
        raise HTTPException(status_code=422, detail="reporting_window must be previous_day, previous_7_days or previous_month")
    if fmt not in ("pdf", "csv"):
        raise HTTPException(status_code=422, detail="output_format must be pdf or csv")
    if frequency == "weekly" and dow is None:
        raise HTTPException(status_code=422, detail="weekly schedules need day_of_week (Monday = 0)")
    if frequency == "monthly" and dom is None:
        raise HTTPException(status_code=422, detail="monthly schedules need day_of_month (1-28)")


def _validate_recipients(user: CurrentUser, view: str, department: Optional[str], recipient_ids: list[str]) -> list[str]:
    ids = list(dict.fromkeys(recipient_ids))
    if not ids:
        raise HTTPException(status_code=422, detail="Choose at least one recipient")
    roles = delivery_service.active_roles(supabase, user.hotel_id, ids)
    scope = effective_departments(user.role, department)
    unknown = [i for i in ids if i not in roles]
    if unknown:
        raise HTTPException(status_code=422, detail="Recipients must be active staff of this hotel")
    ineligible = [i for i in ids if not delivery_service.recipient_can_receive(roles[i], view, scope)]
    if ineligible:
        raise HTTPException(status_code=422, detail="Some recipients are not authorised to receive this report")
    return ids


def _view_schedule(row: dict, names: dict, last: Optional[dict]) -> dict:
    return {
        "id": row["id"], "name": row["name"], "report_type": row["report_type"], "frequency": row["frequency"],
        "day_of_week": row.get("day_of_week"), "day_of_month": row.get("day_of_month"),
        "local_time": str(row["local_time"])[:5], "timezone": row["timezone"], "reporting_window": row["reporting_window"],
        "output_format": row["output_format"], "enabled": row["enabled"],
        "department": (row.get("filters") or {}).get("department"),
        "include_definitions": (row.get("filters") or {}).get("include_definitions", True),
        "recipients": [{"user_id": i, "name": names.get(i, "Former employee")} for i in row.get("recipient_ids") or []],
        "next_run_at": row.get("next_run_at"), "last_run_at": row.get("last_run_at"),
        "last_delivery": None if not last else {"status": last["status"], "scheduled_occurrence": last["scheduled_occurrence"], "completed_at": last.get("completed_at")},
        "description": sched.describe(row["frequency"], delivery_service.parse_time(row["local_time"]), row["timezone"], row.get("day_of_week"), row.get("day_of_month")),
        "created_by": row.get("created_by"),
    }


def _can_manage(user: CurrentUser, row: dict) -> bool:
    return user.role in GM_ONLY_ROLES or row.get("created_by") == user.user_id


def _load(user: CurrentUser, schedule_id: str) -> dict:
    result = supabase.table("report_schedules").select("*").eq("tenant_id", user.hotel_id).eq("id", schedule_id).maybe_single().execute()
    row = result.data if result else None
    if not row or not _can_manage(user, row):
        raise HTTPException(status_code=404, detail="Schedule not found")  # 404 hides other users'/hotels' schedules
    return row


@router.get("/delivery-status")
async def delivery_status(current_user: CurrentUser = Depends(get_current_user)):
    if not views_for_role(current_user.role):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    status = email_delivery.configuration_status()
    if current_user.role not in GM_ONLY_ROLES:  # configuration detail (env names) is for administrators only
        status = {"configured": status["configured"], "missing": [], "blocked_reason": None, "required_env": []}
    return {"data": status}


@router.get("/schedules/recipients")
async def eligible_recipients(
    report_type: str = Query(...), department: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    require_report_view(report_type, current_user)
    scope = effective_departments(current_user.role, department)
    from services.reporting import data as report_data

    directory = report_data.staff_directory(supabase, current_user.hotel_id)
    people = [
        {"user_id": uid, "name": p["name"], "role": p["role"], "department": STAFF_ROLE_DEPARTMENT.get(p["role"])}
        for uid, p in directory.items() if delivery_service.recipient_can_receive(p["role"], report_type, scope)
    ]
    return {"data": sorted(people, key=lambda p: p["name"].lower())}


@router.get("/schedules")
async def list_schedules(current_user: CurrentUser = Depends(get_current_user)):
    if not views_for_role(current_user.role):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    query = supabase.table("report_schedules").select("*").eq("tenant_id", current_user.hotel_id)
    if current_user.role not in GM_ONLY_ROLES:
        query = query.eq("created_by", current_user.user_id)
    rows = query.order("created_at", desc=True).execute().data or []
    ids = {i for r in rows for i in (r.get("recipient_ids") or [])}
    from services.reporting import data as report_data

    names = {uid: p["name"] for uid, p in report_data.staff_directory(supabase, current_user.hotel_id).items() if uid in ids}
    out = []
    for row in rows:
        last = supabase.table("report_deliveries").select("status, scheduled_occurrence, completed_at").eq("tenant_id", current_user.hotel_id) \
            .eq("schedule_id", row["id"]).order("created_at", desc=True).limit(1).execute().data or []
        out.append(_view_schedule(row, names, last[0] if last else None))
    return {"data": out}


@router.post("/schedules/preview")
async def preview_schedule(body: ScheduleIn, current_user: CurrentUser = Depends(get_current_user)):
    require_report_view(body.report_type, current_user)
    window = body.reporting_window or sched.DEFAULT_WINDOW.get(body.frequency, "previous_day")
    _validate_shape(body.frequency, window, body.output_format, body.day_of_week, body.day_of_month)
    tz = hotel_timezone(supabase, current_user.hotel_id)
    local_time = delivery_service.parse_time(body.local_time)
    first = sched.next_run(body.frequency, local_time, tz, day_of_week=body.day_of_week, day_of_month=body.day_of_month)
    second = sched.next_run(body.frequency, local_time, tz, day_of_week=body.day_of_week, day_of_month=body.day_of_month, after=first)
    start, end = sched.window_for(window, first, tz)
    return {"data": {
        "timezone": getattr(tz, "key", "UTC"), "next_delivery": first.isoformat(), "following_delivery": second.isoformat(),
        "reporting_window": {"key": window, "start": start.isoformat(), "end": end.isoformat()},
        "description": sched.describe(body.frequency, local_time, getattr(tz, "key", "UTC"), body.day_of_week, body.day_of_month),
    }}


@router.post("/schedules", status_code=201)
async def create_schedule(body: ScheduleIn, current_user: CurrentUser = Depends(get_current_user)):
    require_report_view(body.report_type, current_user)
    window = body.reporting_window or sched.DEFAULT_WINDOW.get(body.frequency, "previous_day")
    _validate_shape(body.frequency, window, body.output_format, body.day_of_week, body.day_of_month)
    existing = supabase.table("report_schedules").select("id").eq("tenant_id", current_user.hotel_id).execute().data or []
    if len(existing) >= MAX_SCHEDULES_PER_HOTEL:
        raise HTTPException(status_code=422, detail=f"A hotel can have at most {MAX_SCHEDULES_PER_HOTEL} scheduled reports")
    recipients = _validate_recipients(current_user, body.report_type, body.department, body.recipient_ids)
    tz = hotel_timezone(supabase, current_user.hotel_id)
    tz_name = getattr(tz, "key", "UTC")
    local_time = delivery_service.parse_time(body.local_time)
    next_run = sched.next_run(body.frequency, local_time, tz, day_of_week=body.day_of_week, day_of_month=body.day_of_month)
    saved = supabase.table("report_schedules").insert({
        "tenant_id": current_user.hotel_id, "name": body.name.strip(), "report_type": body.report_type, "frequency": body.frequency,
        "day_of_week": body.day_of_week if body.frequency == "weekly" else None,
        "day_of_month": body.day_of_month if body.frequency == "monthly" else None,
        "local_time": body.local_time, "timezone": tz_name, "reporting_window": window, "output_format": body.output_format,
        "recipient_ids": recipients,
        "filters": {"department": body.department, "include_definitions": body.include_definitions},
        "enabled": True, "next_run_at": next_run.isoformat(), "created_by": current_user.user_id,
    }).execute().data
    if not saved:
        raise HTTPException(status_code=500, detail="The schedule could not be saved")
    row = saved[0]
    return {"data": _view_schedule(row, {}, None)}


@router.patch("/schedules/{schedule_id}")
async def update_schedule(schedule_id: str, body: SchedulePatch, current_user: CurrentUser = Depends(get_current_user)):
    row = _load(current_user, schedule_id)
    if not can_view(current_user.role, row["report_type"]):
        raise HTTPException(status_code=403, detail="Insufficient permissions for this report")
    data = body.model_dump(exclude_unset=True)
    merged = {**row, **{k: v for k, v in data.items() if k not in ("department", "include_definitions", "enabled")}}
    filters = dict(row.get("filters") or {})
    if "department" in data:
        filters["department"] = data["department"]
    if "include_definitions" in data:
        filters["include_definitions"] = data["include_definitions"]
    _validate_shape(merged["frequency"], merged["reporting_window"], merged["output_format"], merged.get("day_of_week"), merged.get("day_of_month"))
    if data.get("local_time") and not _TIME.match(data["local_time"]):
        raise HTTPException(status_code=422, detail="local_time must be HH:MM (24-hour)")
    recipients = merged.get("recipient_ids") or []
    if "recipient_ids" in data or "department" in data:
        recipients = _validate_recipients(current_user, row["report_type"], filters.get("department"), merged.get("recipient_ids") or [])
    tz = hotel_timezone(supabase, current_user.hotel_id)
    enabled = data.get("enabled", row["enabled"])
    patch = {
        "name": (merged["name"] or "").strip(), "frequency": merged["frequency"],
        "day_of_week": merged.get("day_of_week") if merged["frequency"] == "weekly" else None,
        "day_of_month": merged.get("day_of_month") if merged["frequency"] == "monthly" else None,
        "local_time": merged["local_time"], "timezone": getattr(tz, "key", "UTC"), "reporting_window": merged["reporting_window"],
        "output_format": merged["output_format"], "recipient_ids": recipients, "filters": filters, "enabled": enabled,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        # Paused schedules have no next run; resuming (or any edit) recomputes it from "now" — no backlog of missed sends.
        "next_run_at": delivery_service.schedule_next_run({**merged, "timezone": getattr(tz, "key", "UTC")}).isoformat() if enabled else None,
    }
    saved = supabase.table("report_schedules").update(patch).eq("id", schedule_id).eq("tenant_id", current_user.hotel_id).execute().data
    if not saved:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return {"data": _view_schedule(saved[0], {}, None)}


@router.delete("/schedules/{schedule_id}", status_code=204)
async def delete_schedule(schedule_id: str, current_user: CurrentUser = Depends(get_current_user)):
    _load(current_user, schedule_id)
    supabase.table("report_schedules").delete().eq("id", schedule_id).eq("tenant_id", current_user.hotel_id).execute()
    return Response(status_code=204)


@router.get("/schedules/{schedule_id}/deliveries")
async def delivery_history(schedule_id: str, limit: int = Query(25, ge=1, le=100), current_user: CurrentUser = Depends(get_current_user)):
    _load(current_user, schedule_id)
    rows = supabase.table("report_deliveries").select(
        "id, status, scheduled_occurrence, started_at, completed_at, recipient_count, error_summary, attempts, next_retry_at"
    ).eq("tenant_id", current_user.hotel_id).eq("schedule_id", schedule_id).order("scheduled_occurrence", desc=True).limit(limit).execute().data or []
    return {"data": rows}


@router.post("/schedules/{schedule_id}/deliveries/{delivery_id}/retry")
async def retry_delivery(schedule_id: str, delivery_id: str, current_user: CurrentUser = Depends(get_current_user)):
    _load(current_user, schedule_id)
    result = supabase.table("report_deliveries").select("*").eq("tenant_id", current_user.hotel_id).eq("schedule_id", schedule_id).eq("id", delivery_id).maybe_single().execute()
    delivery = result.data if result else None
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    if delivery["status"] not in ("failed", "not_configured"):
        raise HTTPException(status_code=409, detail="Only failed or not-configured deliveries can be retried")
    outcome = await delivery_service.attempt_delivery(supabase, delivery)
    if outcome.get("status") == "claimed_elsewhere":
        raise HTTPException(status_code=409, detail="This delivery is already being processed")
    return {"data": {"status": outcome.get("status"), "error_summary": outcome.get("error_summary")}}


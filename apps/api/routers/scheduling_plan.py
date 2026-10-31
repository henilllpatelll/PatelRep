"""Shift management reads that sit beside routers/scheduling.py's writes (Team Scheduling Phase 3).

  GET  /schedules/assignments/{id}/detail   one shift + its VERIFIED attendance timeline + room-work summary
  POST /schedules/assignments/preview       dry run of a create / recurring batch: what would be saved, and why not
  GET  /schedules/shifts/{id}/usage         how many scheduled shifts reference a template (future / past)

Nothing here writes. The preview runs the SAME validation as POST /assignments/bulk (`_prepare`), so what the phone is
told it may save is exactly what the save will accept; the save re-validates, so a preview is advice, never a permit.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends

from core.database import supabase
from core.errors import CodedHTTPException
from middleware.auth import CurrentUser, require_role
from models.requests import BulkShiftAssignmentRequest
from routers.scheduling import (
    ASSIGNMENT_COLUMNS,
    MAX_BATCH,
    SUPERVISOR_ROLES,
    TEAM_VIEW_ROLES,
    _day,
    _load_template,
    _prepare,
    _shape,
)
from routers.shifts import roster_window
from services.scheduling_access import (
    ensure_can_manage,
    err,
    hotel_today,
    hotel_zone,
    load_departments,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/schedules", tags=["scheduling"])

SESSION_COLUMNS = "status, started_at, ended_at, on_break_since, break_seconds"


def _attendance(hotel_id: str, row: dict, zone, today) -> dict:
    """
    What hk_shift_sessions says about this person on the shift's work date. Only a day that has begun can have
    attendance; for a future date the answer is "not applicable", never "none". A failed read is `verified: false`.
    """
    work_date = _day(row.get("work_date"))
    if work_date is None or work_date > today:
        return {"applicable": False, "verified": False, "sessions": []}
    low, high = roster_window(work_date, zone)
    try:
        result = (
            supabase.table("hk_shift_sessions").select(SESSION_COLUMNS)
            .eq("tenant_id", hotel_id).eq("user_id", row["user_id"])
            .gte("started_at", low).lt("started_at", high)
            .order("started_at").execute()
        )
    except Exception:
        logger.warning("scheduling detail: attendance read failed hotel_id=%s", hotel_id)
        return {"applicable": True, "verified": False, "sessions": []}
    return {"applicable": True, "verified": True, "sessions": result.data or []}


def _room_summary(hotel_id: str, row: dict, department_code: Optional[str]) -> dict:
    """Rooms assigned to this person that day, read from room_assignments (owned by Assignments). Never computed here."""
    if department_code != "HK":
        return {"applicable": False, "available": False, "count": None}
    try:
        result = (
            supabase.table("room_assignments").select("room_id")
            .eq("tenant_id", hotel_id).eq("assigned_to", row["user_id"])
            .eq("assignment_date", str(row["work_date"])[:10]).execute()
        )
    except Exception:
        logger.warning("scheduling detail: room assignments read failed hotel_id=%s", hotel_id)
        return {"applicable": True, "available": False, "count": None}
    return {"applicable": True, "available": True, "count": len(result.data or [])}


@router.get("/assignments/{assignment_id}/detail")
async def get_assignment_detail(
    assignment_id: str,
    current_user: CurrentUser = Depends(require_role(*TEAM_VIEW_ROLES)),
):
    """One scheduled shift for the detail view. Scoped to the caller's departments; another hotel's id is a 404."""
    hotel_id = current_user.hotel_id
    result = (
        supabase.table("shift_assignments").select(ASSIGNMENT_COLUMNS)
        .eq("id", assignment_id).eq("tenant_id", hotel_id).maybe_single().execute()
    )
    row = result.data if result else None
    if not row:
        raise err(404, "assignment_not_found", "Assignment not found")
    departments = load_departments(hotel_id)
    ensure_can_manage(current_user, row.get("department_id"), departments)

    zone = hotel_zone(hotel_id)
    today = hotel_today(zone)
    shaped = _shape(row)
    for legacy in ("is_on_shift", "clocked_in_at", "clocked_out_at"):
        shaped.pop(legacy, None)  # legacy clock columns are not attendance
    department_code = departments.code_by_id.get(str(row.get("department_id") or ""))
    return {
        "data": {
            "assignment": shaped,
            "department_code": department_code,
            "attendance": _attendance(hotel_id, row, zone, today),
            "rooms": _room_summary(hotel_id, row, department_code),
            "editable": _day(row.get("work_date")) is not None and _day(row.get("work_date")) >= today,
        },
        "meta": {"generated_at": datetime.now(timezone.utc).isoformat(), "hotel_today": today.isoformat()},
    }


@router.post("/assignments/preview")
async def preview_assignments(
    body: BulkShiftAssignmentRequest,
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES)),
):
    """
    Validate a create / recurring batch WITHOUT writing. `ok=false` carries the first hard refusal exactly as the save
    would (`blocking.code`, plus its `conflicts` / `warnings`); `ok=true` lists the shifts that would be created, the
    ones already scheduled (a repeat is a no-op) and the operational warnings.
    """
    if len(body.assignments) > MAX_BATCH:
        raise err(422, "batch_too_large", f"At most {MAX_BATCH} assignments per request.")
    try:
        prepared = _prepare([{
            "user_id": str(i.user_id), "shift_id": str(i.shift_id), "work_date": i.work_date,
            "start_time": i.start_time, "end_time": i.end_time, "notes": i.notes,
        } for i in body.assignments], current_user)
    except CodedHTTPException as refusal:
        if refusal.status_code in (401, 403, 404):
            raise  # who you are and what exists is never softened into a preview
        return {"data": {"ok": False, "create_count": 0, "unchanged_count": 0, "warnings": [],
                         "blocking": {"status": refusal.status_code, **refusal.body()}, "items": []}}
    items = [
        {"user_id": str(r["user_id"]), "shift_id": str(r["shift_id"]), "work_date": r["work_date"],
         "start_time": r["start_time"], "end_time": r["end_time"], "starts_at": r["starts_at"], "ends_at": r["ends_at"],
         "status": "new"}
        for r in prepared["rows"]
    ] + [
        {"user_id": str(r["user_id"]), "shift_id": str(r["shift_id"]), "work_date": str(r["work_date"])[:10],
         "start_time": r.get("start_time"), "end_time": r.get("end_time"), "starts_at": r.get("starts_at"),
         "ends_at": r.get("ends_at"), "status": "existing"}
        for r in prepared["unchanged"]
    ]
    items.sort(key=lambda i: (i["work_date"], i["starts_at"] or "", i["user_id"]))
    return {"data": {"ok": True, "create_count": len(prepared["rows"]), "unchanged_count": len(prepared["unchanged"]),
                     "warnings": prepared["warnings"], "blocking": None, "items": items}}


@router.get("/shifts/{shift_id}/usage")
async def get_shift_usage(
    shift_id: str,
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES)),
):
    """
    How many scheduled (non-cancelled) shifts were made from this template: `upcoming` (today or later, hotel-local)
    and `past`. Archiving or editing a template never touches either, but the editor says so before it happens.
    """
    hotel_id = current_user.hotel_id
    template = _load_template(hotel_id, shift_id)
    ensure_can_manage(current_user, str(template["department_id"]), load_departments(hotel_id))
    today = hotel_today(hotel_zone(hotel_id)).isoformat()

    def count(extra) -> int:
        query = (
            supabase.table("shift_assignments").select("id", count="exact")
            .eq("tenant_id", hotel_id).eq("shift_id", shift_id).neq("publication_state", "cancelled")
        )
        result = extra(query).limit(1).execute()
        return result.count if getattr(result, "count", None) is not None else len(result.data or [])

    return {"data": {
        "shift_id": shift_id,
        "upcoming": count(lambda q: q.gte("work_date", today)),
        "past": count(lambda q: q.lt("work_date", today)),
        "archived": bool(template.get("archived_at")),
        "version": template.get("version", 1),
    }}

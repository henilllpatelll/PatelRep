"""Call-outs: a supervisor explicitly records that an employee will not work (all of) one scheduled shift.

NEVER AUTOMATIC. A missing clock-in is an observation (services/scheduling.derive_workforce_status), not an absence;
nothing here is created from attendance. Recording a call-out:
  * writes an absence_records row (confirmed -- the supervisor's act is the confirmation) and opens ONE coverage gap;
  * never touches the original shift_assignments row (the history of who was scheduled), hk_shift_sessions
    (attendance) or room_assignments (a replacement does not inherit rooms; Assignments owns that decision);
  * is idempotent (same `idempotency_key` returns the same record) and duplicate-safe (one live absence per shift,
    enforced by a partial unique index as well as a pre-check).
Absence notes are visible to managers only; every route here is manager-only.
"""
import logging
from datetime import date, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query

from core.database import supabase
from core.roles import SCHEDULE_MANAGER_ROLES
from middleware.auth import CurrentUser, require_role
from models.coverage_requests import RecordAbsenceRequest, WithdrawAbsenceRequest
from services import coverage_store as store
from services.scheduling import format_clock
from services.scheduling_access import (
    ensure_can_manage, err, hotel_zone, load_departments, load_names, load_staff, manager_scope, record_audit,
)
from services.scheduling_coverage import actor_kind, transition_error, _ts

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/schedules", tags=["scheduling-coverage"])

MAX_LIST = 200


def _audit_absence(user: CurrentUser, absence: dict, action: str, old: Optional[dict] = None, reason: Optional[str] = None) -> None:
    record_audit(user, resource_type="absence", resource_id=str(absence["id"]), action=action, old_state=old or {},
                 new_state={k: absence.get(k) for k in ("status", "kind", "user_id", "assignment_id", "work_date")}, reason_note=reason)


@router.post("/absences")
async def record_absence(body: RecordAbsenceRequest, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    hotel_id = current_user.hotel_id
    key = body.idempotency_key
    if key:  # a retried request returns what the first one created
        prior = supabase.table("absence_records").select("*").eq("tenant_id", hotel_id).eq("idempotency_key", key).maybe_single().execute()
        if prior and prior.data:
            return await _bundle(current_user, prior.data, replayed=True)

    assignment = store.load_assignment(hotel_id, str(body.assignment_id))
    departments = load_departments(hotel_id)
    ensure_can_manage(current_user, str(assignment["department_id"]) if assignment.get("department_id") else None, departments)
    if assignment.get("publication_state") == "cancelled":
        raise err(409, "shift_cancelled", "That shift was cancelled, so there is nothing to call out of.")
    if int(assignment.get("version") or 1) != body.expected_version:
        raise store.version_conflict("shift", assignment)

    staff = load_staff(hotel_id, departments, [str(assignment["user_id"])])
    member = staff.get(str(assignment["user_id"]))
    if member is None:
        raise err(409, "employee_inactive", "That employee is no longer active, so a call-out cannot be recorded.")

    now = store.now_utc()
    starts, ends = _ts(assignment.get("starts_at")), _ts(assignment.get("ends_at"))
    if starts is None or ends is None:
        raise err(409, "shift_times_unknown", "That shift has no resolved start and end, so coverage cannot be planned.")
    if ends <= now:
        raise err(409, "shift_ended", "That shift has already ended.")

    leaving = body.leaving_at
    if body.kind == "leaving_early":
        if leaving is None:
            raise err(422, "leaving_at_required", "Say when the employee is leaving.")
        leaving = leaving if leaving.tzinfo else leaving.replace(tzinfo=timezone.utc)
        if not (starts < leaving < ends):
            raise err(422, "leaving_outside_shift", "The leaving time must fall inside the shift.")
    else:
        leaving = None

    live = (
        supabase.table("absence_records").select("id, status").eq("tenant_id", hotel_id)
        .eq("assignment_id", str(body.assignment_id)).in_("status", ["reported", "confirmed", "covered"]).execute().data or []
    )
    if live:
        raise err(409, "duplicate_absence", "A call-out is already recorded for this shift.", absence_id=live[0]["id"])

    row = {
        "tenant_id": hotel_id, "user_id": str(assignment["user_id"]), "assignment_id": str(body.assignment_id),
        "department_id": str(assignment["department_id"]) if assignment.get("department_id") else None,
        "work_date": str(assignment["work_date"])[:10], "starts_at": starts.isoformat(), "ends_at": ends.isoformat(),
        "kind": body.kind, "status": "confirmed", "leaving_at": leaving.isoformat() if leaving else None,
        "note": body.note, "recorded_by": current_user.user_id, "confirmed_by": current_user.user_id,
        "confirmed_at": now.isoformat(), "idempotency_key": key, "version": 1,
    }
    try:
        absence = store.insert_row("absence_records", row)
    except Exception as exc:
        if store.is_unique_violation(exc):
            raise err(409, "duplicate_absence", "A call-out is already recorded for this shift.")
        raise

    zone = hotel_zone(hotel_id)
    gap_start = leaving or starts
    gap_row = {
        "tenant_id": hotel_id, "department_id": row["department_id"] or "", "source": "absence", "absence_id": str(absence["id"]),
        "original_assignment_id": str(body.assignment_id), "shift_id": str(assignment["shift_id"]),
        "shift_name": assignment.get("shift_name") or "", "work_date": row["work_date"],
        "start_time": format_clock(gap_start.astimezone(zone).time()) if leaving else assignment.get("start_time"),
        "end_time": assignment.get("end_time"), "starts_at": gap_start.isoformat(), "ends_at": ends.isoformat(),
        "required_role": member.roles[0] if len(member.roles) == 1 else None, "status": "open", "claimable": False,
        "created_by": current_user.user_id, "version": 1,
    }
    try:
        gap = store.insert_row("coverage_gaps", gap_row)
    except Exception:
        # No half-recorded call-out: without its gap the absence would be invisible to the coverage screens.
        supabase.table("absence_records").delete().eq("tenant_id", hotel_id).eq("id", absence["id"]).execute()
        logger.exception("absence: gap insert failed; absence rolled back hotel_id=%s", hotel_id)
        raise err(503, "coverage_unavailable", "The call-out could not be saved. Nothing was recorded; try again.")

    _audit_absence(current_user, {**absence, "status": "reported"}, "reported")
    _audit_absence(current_user, absence, "confirmed", old={"status": "reported"})
    record_audit(current_user, resource_type="coverage_gap", resource_id=str(gap["id"]), action="opened",
                 new_state={"status": "open", "absence_id": str(absence["id"]), "work_date": gap_row["work_date"]})
    return await _bundle(current_user, absence, gap=gap)


async def _bundle(current_user: CurrentUser, absence: dict, gap: Optional[dict] = None, replayed: bool = False) -> dict:
    hotel_id = current_user.hotel_id
    if gap is None:
        found = supabase.table("coverage_gaps").select("*").eq("tenant_id", hotel_id).eq("absence_id", str(absence["id"])).order("created_at", desc=True).execute().data or []
        gap = found[0] if found else None
    names = load_names([str(absence["user_id"])])
    now = store.now_utc()
    return {"data": {
        "absence": store.shape_absence(absence, names),
        "gap": store.shape_gap(gap, [], [], names, now, absence=store.shape_absence(absence, names)) if gap else None,
        "impact": store.room_impact(hotel_id, str(absence["user_id"]), date.fromisoformat(str(absence["work_date"])[:10]), _ts(absence.get("ends_at")), now),
        "replayed": replayed,
    }}


@router.get("/absences")
async def list_absences(
    date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None),
    status: Optional[str] = Query(None), user_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1), per_page: int = Query(50, ge=1, le=MAX_LIST),
    current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES)),
):
    hotel_id = current_user.hotel_id
    departments = load_departments(hotel_id)
    allowed = sorted(departments.ids_in_scope(manager_scope(current_user)))
    query = supabase.table("absence_records").select("*").eq("tenant_id", hotel_id).in_("department_id", allowed)
    if date_from:
        query = query.gte("work_date", date_from.isoformat())
    if date_to:
        query = query.lte("work_date", date_to.isoformat())
    if status:
        query = query.eq("status", status)
    if user_id:
        query = query.eq("user_id", user_id)
    start = (page - 1) * per_page
    rows = query.order("work_date", desc=True).range(start, start + per_page - 1).execute().data or []
    names = load_names(sorted({str(r["user_id"]) for r in rows}))
    return {"data": [store.shape_absence(r, names) for r in rows], "meta": {"page": page, "per_page": per_page}}


@router.get("/absences/{absence_id}")
async def get_absence(absence_id: str, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    absence = store.load_absence(current_user.hotel_id, absence_id)
    ensure_can_manage(current_user, absence.get("department_id"), load_departments(current_user.hotel_id))
    return await _bundle(current_user, absence)


@router.post("/absences/{absence_id}/withdraw")
async def withdraw_absence(absence_id: str, body: WithdrawAbsenceRequest, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    """The call-out was a mistake or the employee can work after all. Only while the gap is not yet filled."""
    hotel_id = current_user.hotel_id
    absence = store.load_absence(hotel_id, absence_id)
    ensure_can_manage(current_user, absence.get("department_id"), load_departments(hotel_id))
    problem = transition_error("absence", absence["status"], "withdrawn", actor_kind(True), body.reason)
    if problem:
        raise err(409, problem if problem != "invalid_transition" else "absence_not_withdrawable",
                  "A call-out that already has coverage cannot be withdrawn." if absence["status"] == "covered" else "That call-out cannot be withdrawn.")
    if int(absence.get("version") or 1) != body.expected_version:
        raise store.version_conflict("call-out", absence)

    gaps = supabase.table("coverage_gaps").select("*").eq("tenant_id", hotel_id).eq("absence_id", absence_id).execute().data or []
    live = [g for g in gaps if g["status"] in ("open", "offered")]
    if any(g["status"] == "filled" for g in gaps):
        raise err(409, "already_covered", "A replacement is already confirmed for this shift.")
    saved = store.cas_update("absence_records", hotel_id, absence_id, body.expected_version, {"status": "withdrawn", "withdraw_reason": body.reason})
    if saved is None:
        raise store.version_conflict("call-out", store.load_absence(hotel_id, absence_id))
    now = store.now_utc().isoformat()
    for gap in live:
        store.cas_update("coverage_gaps", hotel_id, gap["id"], gap["version"], {
            "status": "waived", "resolution": "cancelled", "resolution_reason": "Call-out withdrawn", "resolved_by": current_user.user_id, "resolved_at": now})
        supabase.table("coverage_offers").update({"status": "withdrawn", "updated_at": now}).eq("tenant_id", hotel_id).eq("gap_id", gap["id"]).eq("status", "pending").execute()
        supabase.table("coverage_claims").update({"status": "declined", "decision_reason": "Call-out withdrawn", "updated_at": now}).eq("tenant_id", hotel_id).eq("gap_id", gap["id"]).eq("status", "pending").execute()
        record_audit(current_user, resource_type="coverage_gap", resource_id=str(gap["id"]), action="waived",
                     old_state={"status": gap["status"]}, new_state={"status": "waived"}, reason_note="Call-out withdrawn")
    _audit_absence(current_user, saved, "withdrawn", old={"status": absence["status"]}, reason=body.reason)
    return {"data": store.shape_absence(saved, load_names([str(saved["user_id"])]))}


@router.get("/absences/{absence_id}/impact")
async def absence_impact(absence_id: str, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    absence = store.load_absence(current_user.hotel_id, absence_id)
    ensure_can_manage(current_user, absence.get("department_id"), load_departments(current_user.hotel_id))
    return {"data": store.room_impact(
        current_user.hotel_id, str(absence["user_id"]), date.fromisoformat(str(absence["work_date"])[:10]),
        _ts(absence.get("ends_at")), store.now_utc())}

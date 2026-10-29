"""Candidate evaluation and the single "put this person on this gap" commit, shared by every coverage route.

All of direct assignment, an accepted offer and an approved claim end in `commit_fill`, so they are revalidated by the
same eligibility rules and written by the same one-transaction database function (`fill_coverage_gap`): a stale or
double fill is refused there, not merely discouraged here.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from postgrest.exceptions import APIError

from core.database import supabase
from middleware.auth import CurrentUser
from routers.scheduling import _existing_rows, _occurrence, _week_bounds
from routers.shifts import load_roster
from services import coverage_store as store
from services.availability_store import assess_occurrences
from services.scheduling import Occurrence
from services.scheduling_availability import ACK_AVAILABILITY_WARNINGS
from services.scheduling_access import (
    Departments, StaffMember, err, hotel_today, hotel_zone, load_names, load_staff, record_audit,
)
from services.scheduling_coverage import Candidate, _ts, evaluate_candidate, offer_is_live

logger = logging.getLogger(__name__)

# Warnings that need an explicit "I know" before a supervisor commits (the rest are informational).
ACK_WARNINGS = frozenset({"insufficient_rest", "weekly_overtime", "long_shift", "pending_offer_elsewhere", "currently_clocked_in"}) | ACK_AVAILABILITY_WARNINGS


def gap_occurrence(gap: dict, user_id: str = "") -> Occurrence:
    return Occurrence(user_id, str(gap["shift_id"]), date.fromisoformat(str(gap["work_date"])[:10]), _ts(gap["starts_at"]), _ts(gap["ends_at"]))


def evaluate_users(hotel_id: str, gap: dict, staff: dict[str, StaffMember], departments: Departments) -> list[Candidate]:
    """Evaluate every person in `staff` against `gap` using real schedule, offer and attendance data."""
    if not staff:
        return []
    zone = hotel_zone(hotel_id)
    today = hotel_today(zone)
    occ = gap_occurrence(gap)
    day = occ.work_date
    low, high = _week_bounds(day, day)
    user_ids = sorted(staff)
    rows = _existing_rows(hotel_id, user_ids, low, high)
    by_user: dict[str, list[dict]] = {}
    for r in rows:
        by_user.setdefault(str(r["user_id"]), []).append(r)

    now = store.now_utc()
    offer_windows: dict[str, list[Occurrence]] = {}
    pending = supabase.table("coverage_offers").select("*").eq("tenant_id", hotel_id).eq("status", "pending").in_("user_id", user_ids).execute().data or []
    other_gap_ids = sorted({str(o["gap_id"]) for o in pending if str(o["gap_id"]) != str(gap["id"]) and offer_is_live(o, now)})
    if other_gap_ids:
        gaps = {str(g["id"]): g for g in supabase.table("coverage_gaps").select("*").eq("tenant_id", hotel_id).in_("id", other_gap_ids).execute().data or []}
        for o in pending:
            g = gaps.get(str(o["gap_id"]))
            if g and offer_is_live(o, now):
                offer_windows.setdefault(str(o["user_id"]), []).append(gap_occurrence(g, str(o["user_id"])))

    clocked: dict[str, bool] = {}
    attendance_ok: Optional[bool] = False   # False = irrelevant (not today); None = unreadable
    if day == today:
        try:
            for r in load_roster(hotel_id, today, zone):
                if r.get("user_id") and r.get("status") in ("active", "on_break"):
                    clocked[str(r["user_id"])] = True
            attendance_ok = True
        except Exception:
            logger.warning("coverage: attendance read failed hotel_id=%s", hotel_id)
            attendance_ok = None
    absent = None
    if gap.get("absence_id"):
        absence = supabase.table("absence_records").select("user_id").eq("tenant_id", hotel_id).eq("id", gap["absence_id"]).maybe_single().execute()
        absent = str(absence.data["user_id"]) if absence and absence.data else None

    # Availability + approved leave for the gap's window. None = unreadable -> every candidate reports "unknown".
    assessed = assess_occurrences(hotel_id, [gap_occurrence(gap, uid) for uid in staff], zone)
    assessments = dict(zip(staff, assessed)) if assessed is not None else {}

    out = []
    for uid, member in staff.items():
        stored_rows = by_user.get(uid, [])
        stored = [o for o in (_occurrence(r) for r in stored_rows) if o is not None]
        if attendance_ok is None:
            on_clock: Optional[bool] = None
        else:
            on_clock = clocked.get(uid, False) if attendance_ok else False
        out.append(evaluate_candidate(
            user_id=uid, roles=member.roles, department_id=member.department_id, gap_department_id=str(gap["department_id"]),
            required_role=gap.get("required_role"), gap=gap_occurrence(gap, uid), stored=stored, stored_rows=stored_rows,
            other_pending_offers=offer_windows.get(uid, []), clocked_in_elsewhere=on_clock, hotel_today=today,
            is_absent_employee=(uid == absent), assessment=assessments.get(uid),
        ))
    return out


def require_eligible(hotel_id: str, gap: dict, user_id: str, departments: Departments, *, acknowledge: bool) -> Candidate:
    """The chosen person, freshly re-evaluated. Ineligible = 409 with the reasons; unacknowledged warnings = 409."""
    staff = load_staff(hotel_id, departments, [user_id])
    if user_id not in staff:
        raise err(404, "staff_not_found", "That employee is not an active member of this hotel.")
    cand = evaluate_users(hotel_id, gap, staff, departments)[0]
    if not cand.eligible:
        raise err(409, "candidate_ineligible", "That employee can no longer take this shift.", blockers=cand.blockers, candidate=cand.as_dict())
    needing = [w for w in cand.warnings if w in ACK_WARNINGS]
    if needing and not acknowledge:
        raise err(409, "warnings_need_acknowledgement", "Review the warnings before assigning this shift.", warnings=needing, candidate=cand.as_dict())
    return cand


def commit_fill(
    current_user: CurrentUser, gap: dict, user_id: str, *, resolution: str, expected_version: int,
    offer_id: Optional[str] = None, claim_id: Optional[str] = None, notes: Optional[str] = None,
) -> dict:
    """Run the atomic fill. Maps the database function's refusals to the same coded errors the pre-checks use."""
    payload = {
        "user_id": user_id, "shift_id": str(gap["shift_id"]), "work_date": str(gap["work_date"])[:10],
        "shift_name": gap["shift_name"], "department_id": str(gap["department_id"]),
        "start_time": gap["start_time"], "end_time": gap["end_time"], "starts_at": gap["starts_at"], "ends_at": gap["ends_at"],
        "notes": notes,
    }
    try:
        result = supabase.rpc("fill_coverage_gap", {
            "p_tenant_id": current_user.hotel_id, "p_gap_id": str(gap["id"]), "p_expected_version": expected_version,
            "p_assignment": payload, "p_resolution": resolution, "p_offer_id": offer_id, "p_claim_id": claim_id,
            "p_actor": current_user.user_id,
        }).execute()
    except APIError as exc:
        code = getattr(exc, "code", None) or ""
        if code == "CV001":
            raise store.version_conflict("coverage gap", store.load_gap(current_user.hotel_id, str(gap["id"])))
        if code == "CV002":
            raise err(409, "gap_not_fillable", "This shift was just filled or closed by someone else.",
                      current=store.load_gap(current_user.hotel_id, str(gap["id"])))
        if code == "CV003":
            raise err(404, "gap_not_found", "Coverage gap not found")
        if code == "TO001":
            raise err(409, "candidate_ineligible", "That employee has approved time off during this shift.",
                      blockers=["approved_time_off"])
        if code == "23P01" or "overlap" in str(exc).lower():
            raise err(409, "schedule_conflict", "That employee's schedule changed at the same moment. Reload and try again.",
                      conflicts=[{"code": "overlapping_shift"}])
        if code == "23505":
            raise err(409, "duplicate_assignment", "That employee is already scheduled on this shift and date.")
        raise
    data = result.data
    data = data[0] if isinstance(data, list) and data else data
    assignment_id = (data or {}).get("assignment_id")
    record_audit(current_user, resource_type="coverage_gap", resource_id=str(gap["id"]), action="filled",
                 old_state={"status": gap["status"]},
                 new_state={"status": "filled", "resolution": resolution, "user_id": user_id, "assignment_id": assignment_id})
    if assignment_id:
        record_audit(current_user, resource_type="shift_assignment", resource_id=str(assignment_id), action="created",
                     new_state={"user_id": user_id, "work_date": payload["work_date"], "source": "coverage_gap", "gap_id": str(gap["id"])})
    if gap.get("absence_id"):
        record_audit(current_user, resource_type="absence", resource_id=str(gap["absence_id"]), action="covered",
                     old_state={"status": "confirmed"}, new_state={"status": "covered"})
    return {"assignment_id": assignment_id}


def full_gap(hotel_id: str, gap_id: str) -> dict:
    """One gap with its offers, claims and (for a call-out) the absence, shaped for a manager."""
    gap = store.load_gap(hotel_id, gap_id)
    offers, claims = store.gap_children([gap_id], hotel_id)
    absence = None
    if gap.get("absence_id"):
        found = supabase.table("absence_records").select("*").eq("tenant_id", hotel_id).eq("id", gap["absence_id"]).maybe_single().execute()
        absence = found.data if found else None
    ids = {str(o["user_id"]) for o in offers.get(gap_id, [])} | {str(c["user_id"]) for c in claims.get(gap_id, [])}
    if absence:
        ids.add(str(absence["user_id"]))
    if gap.get("filled_user_id"):
        ids.add(str(gap["filled_user_id"]))
    names = load_names(sorted(ids))
    shaped = store.shape_gap(gap, offers.get(gap_id, []), claims.get(gap_id, []), names, store.now_utc(),
                             absence=store.shape_absence(absence, names) if absence else None)
    shaped["filled_user_name"] = names.get(str(gap.get("filled_user_id") or ""), "") or None
    return shaped


def reopen_if_idle(hotel_id: str, gap_id: str) -> None:
    """An `offered` gap with no live offer left goes back to `open` (contract: offered -> open by manager/system)."""
    gap = store.load_gap(hotel_id, gap_id)
    if gap["status"] != "offered":
        return
    now = store.now_utc()
    live = [o for o in supabase.table("coverage_offers").select("*").eq("tenant_id", hotel_id).eq("gap_id", gap_id).execute().data or [] if offer_is_live(o, now)]
    if not live:
        store.cas_update("coverage_gaps", hotel_id, gap_id, gap["version"], {"status": "open"})
        record_audit_system(hotel_id, gap_id, "reopened")


def record_audit_system(hotel_id: str, gap_id: str, action: str) -> None:
    try:
        supabase.table("operational_audit_events").insert({
            "tenant_id": hotel_id, "resource_type": "coverage_gap", "resource_id": gap_id, "action": action,
            "actor_id": None, "actor_role": "system", "old_state": {"status": "offered"}, "new_state": {"status": "open"}, "source": "api",
        }).execute()
    except Exception:
        logger.exception("coverage: system audit write failed gap=%s", gap_id)

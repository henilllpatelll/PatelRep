"""Candidate evaluation and the single "put this person on this gap" commit, shared by every coverage route.

All of direct assignment, an accepted offer and an approved claim end in `commit_fill`, so they are revalidated by the
same eligibility rules and written by the same one-transaction database function (`fill_coverage_gap`): a stale or
double fill is refused there, not merely discouraged here.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

from postgrest.exceptions import APIError

from core.database import supabase
from middleware.auth import CurrentUser
from routers.scheduling import _existing_rows, _occurrence, _week_bounds
from routers.shifts import load_roster
from services import coverage_store as store
from services import schedule_outbox as notices
from services.availability_store import assess_occurrences
from services.scheduling import Occurrence
from services.scheduling_availability import ACK_AVAILABILITY_WARNINGS
from services.scheduling_access import (
    Departments, StaffMember, err, hotel_today, hotel_zone, load_departments, load_names, load_staff, record_audit,
)
from services.scheduling_coverage import Candidate, _ts, evaluate_candidate, offer_is_live

logger = logging.getLogger(__name__)

# Warnings that need an explicit "I know" before a supervisor commits (the rest are informational).
ACK_WARNINGS = frozenset({"insufficient_rest", "weekly_overtime", "long_shift", "pending_offer_elsewhere", "currently_clocked_in"}) | ACK_AVAILABILITY_WARNINGS


def gap_occurrence(gap: dict, user_id: str = "") -> Occurrence:
    return Occurrence(user_id, str(gap["shift_id"]), date.fromisoformat(str(gap["work_date"])[:10]), _ts(gap["starts_at"]), _ts(gap["ends_at"]))


@dataclass
class Prefetch:
    """One person's schedule, pending offers and availability for SEVERAL gaps, read once (see `prefetch_user`)."""
    user_id: str
    rows: list
    pending: list
    gaps: dict
    assessed: Optional[dict]  # gap id -> Assessment; None when availability could not be read


def prefetch_user(hotel_id: str, user_id: str, gaps: list[dict]) -> Optional[Prefetch]:
    """
    The reads `evaluate_users` would repeat for every gap when ONE person is checked against many (the employee's Open
    Shifts list): a constant handful of queries instead of about five per posting.
    """
    if not gaps:
        return None
    zone = hotel_zone(hotel_id)
    occs = [gap_occurrence(g, user_id) for g in gaps]
    low, high = _week_bounds(min(o.work_date for o in occs), max(o.work_date for o in occs))
    pending = supabase.table("coverage_offers").select("*").eq("tenant_id", hotel_id).eq("status", "pending").in_("user_id", [user_id]).execute().data or []
    known = {str(g["id"]): g for g in gaps}
    missing = sorted({str(o["gap_id"]) for o in pending} - set(known))
    if missing:
        known.update({str(g["id"]): g for g in supabase.table("coverage_gaps").select("*").eq("tenant_id", hotel_id).in_("id", missing).execute().data or []})
    assessed = assess_occurrences(hotel_id, occs, zone)
    return Prefetch(user_id, _existing_rows(hotel_id, [user_id], low, high), pending, known,
                    {str(g["id"]): a for g, a in zip(gaps, assessed)} if assessed is not None else None)


def evaluate_users(
    hotel_id: str, gap: dict, staff: dict[str, StaffMember], departments: Departments, prefetch: Optional[Prefetch] = None,
) -> list[Candidate]:
    """Evaluate every person in `staff` against `gap` using real schedule, offer and attendance data."""
    if not staff:
        return []
    if prefetch is not None and set(staff) != {prefetch.user_id}:
        prefetch = None  # a prefetch describes exactly one person
    zone = hotel_zone(hotel_id)
    today = hotel_today(zone)
    occ = gap_occurrence(gap)
    day = occ.work_date
    low, high = _week_bounds(day, day)
    user_ids = sorted(staff)
    if prefetch is not None:
        rows = [r for r in prefetch.rows if low - timedelta(days=1) <= date.fromisoformat(str(r["work_date"])[:10]) <= high + timedelta(days=1)]
    else:
        rows = _existing_rows(hotel_id, user_ids, low, high)
    by_user: dict[str, list[dict]] = {}
    for r in rows:
        by_user.setdefault(str(r["user_id"]), []).append(r)

    now = store.now_utc()
    offer_windows: dict[str, list[Occurrence]] = {}
    if prefetch is not None:
        pending = prefetch.pending
    else:
        pending = supabase.table("coverage_offers").select("*").eq("tenant_id", hotel_id).eq("status", "pending").in_("user_id", user_ids).execute().data or []
    other_gap_ids = sorted({str(o["gap_id"]) for o in pending if str(o["gap_id"]) != str(gap["id"]) and offer_is_live(o, now)})
    if other_gap_ids:
        if prefetch is not None:
            gaps = prefetch.gaps
        else:
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
    if prefetch is not None:
        assessments = {prefetch.user_id: prefetch.assessed[str(gap["id"])]} if prefetch.assessed is not None else {}
    else:
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


def open_shift_audience(hotel_id: str, gap: dict, departments: Departments) -> list[str]:
    """Who an open shift is announced to: people of its department the Open Shifts screen would show as eligible."""
    staff = {u: m for u, m in load_staff(hotel_id, departments).items() if m.department_id == str(gap["department_id"])}
    return [c.user_id for c in evaluate_users(hotel_id, gap, staff, departments) if c.eligible]


# A posting is re-checked from RECONCILE_MIN_AGE (the request path had its chance) to RECONCILE_MAX_AGE after it was made;
# later than that the Open Shifts screen, which is the source of truth, is all that is left.
RECONCILE_MIN_AGE = timedelta(minutes=2)
RECONCILE_MAX_AGE = timedelta(minutes=90)
RECONCILE_LIMIT = 50  # newest first: postings nobody is eligible for are re-checked until they age out and must not crowd out new ones


def reconcile_open_shift_announcements() -> dict:
    """
    Announce claimable open shifts whose announcement was lost. The post request announces best effort (its audience is
    computed in Python, so it cannot be a database trigger); this sweep, run by the 5-minute notification job, closes
    the gap: a still-open, still-claimable posting that has NO announcement rows is announced now. Safe to repeat: the
    outbox dedupes on (event, gap, person), and a posting nobody is eligible for is simply re-checked until it ages out.
    """
    summary = {"checked": 0, "announced": 0, "failed": 0}
    now = store.now_utc()
    try:
        gaps = (supabase.table("coverage_gaps").select("*").eq("source", "open_shift").eq("claimable", True).eq("status", "open")
                .gt("ends_at", now.isoformat()).gte("created_at", (now - RECONCILE_MAX_AGE).isoformat())
                .lte("created_at", (now - RECONCILE_MIN_AGE).isoformat()).order("created_at", desc=True).limit(RECONCILE_LIMIT).execute().data or [])
        if not gaps:
            return summary
        announced = {
            str((row.get("payload") or {}).get("gap_id")) for row in (
                supabase.table("schedule_notifications").select("payload").eq("event_type", "schedule_open_shift")
                .in_("payload->>gap_id", [str(g["id"]) for g in gaps]).limit(5000).execute().data or [])
        }
    except Exception:
        logger.warning("SCHEDULE_OPEN_SHIFT_RECONCILE_QUERY_FAILED", exc_info=True)
        return {**summary, "failed": 1}
    departments_by_hotel: dict[str, Departments] = {}
    for gap in gaps:
        if str(gap["id"]) in announced:
            continue
        summary["checked"] += 1
        hotel_id = str(gap["tenant_id"])
        try:
            departments = departments_by_hotel.setdefault(hotel_id, load_departments(hotel_id))
            audience = open_shift_audience(hotel_id, gap, departments)
            summary["announced"] += notices.enqueue(hotel_id, audience, "schedule_open_shift", str(gap["id"]),
                                                    {"gap_id": str(gap["id"]), "work_date": str(gap["work_date"])[:10]})
        except Exception:
            summary["failed"] += 1
            logger.warning("SCHEDULE_OPEN_SHIFT_RECONCILE_FAILED gap=%s", gap.get("id"), exc_info=True)
    return summary

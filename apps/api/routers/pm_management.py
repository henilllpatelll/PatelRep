"""Chief Engineer PM management: coverage summary, programs, technician assignment, workload and performance.

Every route is property-scoped and limited to the schedule managers (chief engineer, GM) except the technician list,
which any PM executor may read to see who a PM is assigned to. Counts are derived from live rows on each call; unknown
is reported as null, never as zero.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from core.database import supabase
from core.roles import PM_EXECUTION_ROLES, PM_SCHEDULE_MANAGER_ROLES
from middleware.auth import CurrentUser, require_role
from models.requests import AssignPMScheduleRequest
from services.programs.assignment import annotate_assignee
from services.programs.checklist_binding import load_resolutions
from services.reporting.periods import hotel_timezone, local_midnight_utc, local_today, parse_timestamp

router = APIRouter(prefix="/pm-management", tags=["pm-management"])

# Bounded server-side scans. Past these the response says `truncated` instead of silently under-counting.
SCHEDULE_SCAN_LIMIT = 2000
COMPLETION_SCAN_LIMIT = 5000
ELIGIBLE_ASSIGNEE_ROLES = ("engineer", "chief_engineer")

_SCHEDULE_COLUMNS = (
    "id, name, asset_id, interval_type, interval_days, recurrence_basis, estimated_minutes, next_due_at, last_completed_at, "
    "is_active, assigned_to_role, assigned_to, assigned_for_due_at, assigned_at, assigned_by, row_version, "
    "checklist_template_id, checklist_template_code, "
    "assets(name, asset_tag, location_text, is_active, category_id, criticality, asset_categories(name))"
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _moment(value) -> Optional[datetime]:
    return parse_timestamp(value)


def _asset(schedule: dict) -> dict:
    return schedule.get("assets") or {}


def _active_schedules(current_user: CurrentUser) -> tuple[list[dict], bool]:
    """Active schedules on active equipment. Retired equipment is not coverage."""
    rows = supabase.table("pm_schedules").select(_SCHEDULE_COLUMNS).eq("tenant_id", current_user.hotel_id).eq(
        "is_active", True
    ).order("next_due_at").limit(SCHEDULE_SCAN_LIMIT + 1).execute().data or []
    truncated = len(rows) > SCHEDULE_SCAN_LIMIT
    rows = [annotate_assignee(row) for row in rows[:SCHEDULE_SCAN_LIMIT] if _asset(row).get("is_active") is not False]
    return rows, truncated


def _names(ids: set[str], current_user: CurrentUser) -> dict[str, Optional[str]]:
    if not ids:
        return {}
    rows = supabase.table("user_profiles").select("id, full_name, preferred_name").eq(
        "tenant_id", current_user.hotel_id
    ).in_("id", sorted(ids)).execute().data or []
    return {str(r["id"]): (r.get("preferred_name") or r.get("full_name")) for r in rows}


def _pending_deferrals(current_user: CurrentUser) -> list[dict]:
    """Requests that still await a decision (a legacy row carrying approved_by counts as already applied)."""
    open_rows = supabase.table("pm_deferrals").select("id, pm_schedule_id, requested_by, deferred_until, reason, created_at").eq(
        "tenant_id", current_user.hotel_id
    ).is_("approved_by", "null").order("created_at", desc=True).limit(500).execute().data or []
    if not open_rows:
        return []
    decided = {
        str(r["deferral_id"])
        for r in supabase.table("pm_deferral_decisions").select("deferral_id").eq("tenant_id", current_user.hotel_id).in_(
            "deferral_id", [r["id"] for r in open_rows]
        ).execute().data or []
    }
    return [r for r in open_rows if str(r["id"]) not in decided]


def _week_bounds(tz, now: datetime) -> tuple[datetime, datetime]:
    """Hotel-local Monday 00:00 to the next Monday 00:00, as UTC instants."""
    today = local_today(tz, now)
    monday = today - timedelta(days=today.weekday())
    return local_midnight_utc(monday, tz), local_midnight_utc(monday + timedelta(days=7), tz)


# ---------------------------------------------------------------------------
# GET /pm-management/summary
# ---------------------------------------------------------------------------

@router.get("/summary")
async def get_summary(current_user: CurrentUser = Depends(require_role(*PM_SCHEDULE_MANAGER_ROLES))):
    """Coverage cards. Definitions (all over ACTIVE schedules on ACTIVE equipment):
    overdue = next_due_at already passed; unassigned = overdue or due this hotel-local week with no current assignee;
    due_this_week = not yet overdue and due inside the hotel-local Monday-Sunday week; pending_approvals = deferral
    requests with no decision."""
    now = _now()
    tz = hotel_timezone(supabase, current_user.hotel_id)
    _, week_end = _week_bounds(tz, now)
    schedules, truncated = _active_schedules(current_user)
    overdue = unassigned = due_week = 0
    for s in schedules:
        due = _moment(s.get("next_due_at"))
        if due is None:
            continue
        is_overdue = due < now
        in_week = now <= due < week_end
        overdue += is_overdue
        due_week += in_week
        if (is_overdue or in_week) and not s["effective_assigned_to"]:
            unassigned += 1
    return {"data": {
        "overdue": overdue,
        "unassigned": unassigned,
        "pending_approvals": len(_pending_deferrals(current_user)),
        "due_this_week": due_week,
        "active_schedules": len(schedules),
        "timezone": getattr(tz, "key", str(tz)),
        "week_ends_at": week_end.isoformat(),
    }, "meta": {"truncated": truncated}}


# ---------------------------------------------------------------------------
# GET /pm-management/deferrals
# ---------------------------------------------------------------------------

@router.get("/deferrals")
async def list_deferrals(
    status: str = Query("pending", pattern="^(pending|decided)$"),
    limit: int = Query(50, ge=1, le=100),
    current_user: CurrentUser = Depends(require_role(*PM_SCHEDULE_MANAGER_ROLES)),
):
    """Deferral requests with the inspection, equipment and people resolved, for the approvals list. Deciding goes through
    POST /programs/pm-deferrals/{id}/approve|reject, where the database refuses self-review and double decisions."""
    if status == "pending":
        rows = _pending_deferrals(current_user)[:limit]
        decisions: dict[str, dict] = {}
    else:
        decided = supabase.table("pm_deferral_decisions").select("*").eq("tenant_id", current_user.hotel_id).order(
            "decided_at", desc=True
        ).limit(limit).execute().data or []
        decisions = {str(d["deferral_id"]): d for d in decided}
        rows = supabase.table("pm_deferrals").select("id, pm_schedule_id, requested_by, deferred_until, reason, created_at").eq(
            "tenant_id", current_user.hotel_id
        ).in_("id", list(decisions)).execute().data or [] if decisions else []
    schedule_ids = sorted({str(r["pm_schedule_id"]) for r in rows})
    schedules = {
        str(s["id"]): s
        for s in (supabase.table("pm_schedules").select("id, name, next_due_at, is_active, assets(name, asset_tag, location_text)").eq(
            "tenant_id", current_user.hotel_id
        ).in_("id", schedule_ids).execute().data or [] if schedule_ids else [])
    }
    people = {str(r["requested_by"]) for r in rows} | {str(d["decided_by"]) for d in decisions.values()}
    names = _names(people, current_user)
    out = []
    for r in rows:
        sched = schedules.get(str(r["pm_schedule_id"])) or {}
        decision = decisions.get(str(r["id"]))
        out.append({
            "id": r["id"], "pm_schedule_id": r["pm_schedule_id"], "schedule_name": sched.get("name"),
            "asset_name": _asset(sched).get("name"), "asset_tag": _asset(sched).get("asset_tag"),
            "location_text": _asset(sched).get("location_text"),
            "current_due_at": sched.get("next_due_at"), "schedule_active": sched.get("is_active"),
            "requested_by": r["requested_by"], "requested_by_name": names.get(str(r["requested_by"])),
            "requested_at": r["created_at"], "requested_due_at": r["deferred_until"], "reason": r["reason"],
            "status": decision["decision"] if decision else "pending",
            "decided_by_name": names.get(str(decision["decided_by"])) if decision else None,
            "decided_at": decision["decided_at"] if decision else None, "decision_note": decision.get("note") if decision else None,
            # A pending request is stale when the schedule already reached or passed the requested date.
            "stale": bool(not decision and (_moment(sched.get("next_due_at")) or datetime.min.replace(tzinfo=timezone.utc)) >= (_moment(r["deferred_until"]) or datetime.max.replace(tzinfo=timezone.utc))),
        })
    return {"data": out, "meta": {"limit": limit}}


# ---------------------------------------------------------------------------
# GET /pm-management/technicians
# ---------------------------------------------------------------------------

def _eligible_technicians(current_user: CurrentUser) -> list[dict]:
    roles = supabase.table("user_roles").select("user_id, role").eq("tenant_id", current_user.hotel_id).eq(
        "is_active", True
    ).in_("role", list(ELIGIBLE_ASSIGNEE_ROLES)).execute().data or []
    ids = {str(r["user_id"]) for r in roles}
    if not ids:
        return []
    profiles = supabase.table("user_profiles").select("id, full_name, preferred_name, is_active").eq(
        "tenant_id", current_user.hotel_id
    ).eq("is_active", True).in_("id", sorted(ids)).execute().data or []
    role_by_user = {str(r["user_id"]): r["role"] for r in roles}
    out = [
        {"id": str(p["id"]), "name": p.get("preferred_name") or p.get("full_name"), "role": role_by_user.get(str(p["id"]))}
        for p in profiles
    ]
    return sorted(out, key=lambda t: (t["name"] or "").lower())


@router.get("/technicians")
async def list_technicians(current_user: CurrentUser = Depends(require_role(*PM_EXECUTION_ROLES))):
    """Active engineers and chief engineers of THIS property: the only people a PM can be assigned to."""
    return {"data": _eligible_technicians(current_user)}


# ---------------------------------------------------------------------------
# GET /pm-management/programs
# ---------------------------------------------------------------------------

@router.get("/programs")
async def list_programs(
    q: Optional[str] = Query(None, max_length=100),
    status: str = Query("active", pattern="^(active|inactive|all)$"),
    overdue_only: bool = Query(False),
    missing_checklist: bool = Query(False),
    unassigned_only: bool = Query(False),
    assignee_id: Optional[UUID] = Query(None),
    category_id: Optional[UUID] = Query(None),
    sort: str = Query("due", pattern="^(due|name)$"),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
    current_user: CurrentUser = Depends(require_role(*PM_SCHEDULE_MANAGER_ROLES)),
):
    """PM programs with their checklist state and current assignee. Missing / inactive / incompatible checklists are
    reported as configuration issues; nothing is substituted to make a program look healthy."""
    query = supabase.table("pm_schedules").select(_SCHEDULE_COLUMNS).eq("tenant_id", current_user.hotel_id)
    if status != "all":
        query = query.eq("is_active", status == "active")
    rows = query.order("next_due_at").limit(SCHEDULE_SCAN_LIMIT + 1).execute().data or []
    truncated = len(rows) > SCHEDULE_SCAN_LIMIT
    rows = [annotate_assignee(r) for r in rows[:SCHEDULE_SCAN_LIMIT]]
    resolutions = load_resolutions(supabase, current_user.hotel_id, rows)
    now = _now()
    needle = (q or "").strip().lower()
    result: list[dict] = []
    for s in rows:
        s["checklist"] = resolutions[str(s["id"])]
        due = _moment(s.get("next_due_at"))
        s["is_overdue"] = bool(s.get("is_active") and due and due < now)
        s["checklist_issue"] = s["checklist"]["state"] in ("missing", "inactive", "incompatible")
        asset = _asset(s)
        if needle and needle not in f"{s.get('name', '')} {asset.get('name', '')} {asset.get('asset_tag', '')}".lower():
            continue
        if overdue_only and not s["is_overdue"]:
            continue
        if missing_checklist and s["checklist"]["state"] == "ready":
            continue
        if unassigned_only and s["effective_assigned_to"]:
            continue
        if assignee_id and s["effective_assigned_to"] != str(assignee_id):
            continue
        if category_id and str(asset.get("category_id") or "") != str(category_id):
            continue
        result.append(s)
    if sort == "name":
        result.sort(key=lambda s: (s.get("name") or "").lower())
    page = result[offset:offset + limit]
    names = _names({s["effective_assigned_to"] for s in page if s["effective_assigned_to"]}, current_user)
    for s in page:
        s["assignee_name"] = names.get(s["effective_assigned_to"]) if s["effective_assigned_to"] else None
    return {"data": page, "meta": {"offset": offset, "limit": limit, "total": len(result), "has_more": offset + limit < len(result), "truncated": truncated}}


# ---------------------------------------------------------------------------
# PUT /pm-management/schedules/{id}/assignment
# ---------------------------------------------------------------------------

@router.put("/schedules/{schedule_id}/assignment")
async def set_assignment(
    schedule_id: str,
    request: AssignPMScheduleRequest,
    current_user: CurrentUser = Depends(require_role(*PM_SCHEDULE_MANAGER_ROLES)),
):
    """Assign, reassign or (null assignee) unassign the technician for the schedule's current inspection. One database
    transaction checks the caller's version, the assignee's eligibility in this property, and writes the change, its
    history event and its audit row. The actor is always the authenticated caller."""
    try:
        UUID(schedule_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="PM schedule not found")
    try:
        outcome = supabase.rpc("assign_pm_schedule", {
            "p_tenant_id": current_user.hotel_id,
            "p_schedule_id": schedule_id,
            "p_actor_id": current_user.user_id,
            "p_actor_role": current_user.role,
            "p_assignee_id": str(request.assignee_id) if request.assignee_id else None,
            "p_expected_version": request.expected_version,
        }).execute().data
    except Exception as exc:  # noqa: BLE001 - classify, never swallow
        if "PGRST202" in str(exc) or "Could not find the function" in str(exc):
            raise HTTPException(status_code=503, detail={"code": "assignment_unavailable", "message": "Assignments are temporarily unavailable. Nothing was changed."}) from exc
        raise
    if isinstance(outcome, list):
        outcome = outcome[0] if outcome else None
    status = (outcome or {}).get("status")
    if status in ("ok", "no_change"):
        schedule = annotate_assignee(outcome["schedule"])
        names = _names({schedule["effective_assigned_to"]} if schedule["effective_assigned_to"] else set(), current_user)
        schedule["assignee_name"] = names.get(schedule["effective_assigned_to"]) if schedule["effective_assigned_to"] else None
        return {"data": schedule, "meta": {"action": outcome.get("action"), "changed": status == "ok"}}
    refusals = {
        "not_found": (404, "not_found", "PM schedule not found"),
        "conflict": (409, "version_conflict", "This inspection was changed by someone else. Review the latest assignment and try again."),
        "schedule_inactive": (409, "schedule_inactive", "This PM schedule is no longer active."),
        "assignee_ineligible": (422, "assignee_ineligible", "That person is not an active engineer at this property."),
    }
    if status in refusals:
        code, key, message = refusals[status]
        detail = {"code": key, "message": message}
        if status == "conflict":
            detail["current_version"] = outcome.get("current_version")
        raise HTTPException(status_code=code, detail=detail)
    raise HTTPException(status_code=502, detail={"code": "assignment_unverified", "message": "The assignment could not be verified. Check the schedule before retrying."})


@router.get("/schedules/{schedule_id}/assignment-history")
async def assignment_history(
    schedule_id: str,
    limit: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(require_role(*PM_SCHEDULE_MANAGER_ROLES)),
):
    events = supabase.table("pm_schedule_assignment_events").select("*").eq("tenant_id", current_user.hotel_id).eq(
        "pm_schedule_id", schedule_id
    ).order("created_at", desc=True).limit(limit).execute().data or []
    ids = {str(v) for e in events for v in (e.get("from_user_id"), e.get("to_user_id"), e.get("actor_id")) if v}
    names = _names(ids, current_user)
    for e in events:
        e["from_name"] = names.get(str(e["from_user_id"])) if e.get("from_user_id") else None
        e["to_name"] = names.get(str(e["to_user_id"])) if e.get("to_user_id") else None
        e["actor_name"] = names.get(str(e["actor_id"]))
    return {"data": events}


# ---------------------------------------------------------------------------
# GET /pm-management/workload
# ---------------------------------------------------------------------------

@router.get("/workload")
async def get_workload(
    period: str = Query("today", pattern="^(today|week)$"),
    current_user: CurrentUser = Depends(require_role(*PM_SCHEDULE_MANAGER_ROLES)),
):
    """Per technician: inspections currently assigned, due today, overdue, completed in the period and the next one due.
    An assignment is a plan, not a clock: nothing here says a technician is working, and estimated minutes are never
    reported as labour."""
    now = _now()
    tz = hotel_timezone(supabase, current_user.hotel_id)
    today = local_today(tz, now)
    day_start, day_end = local_midnight_utc(today, tz), local_midnight_utc(today + timedelta(days=1), tz)
    period_start, period_end = (day_start, day_end) if period == "today" else _week_bounds(tz, now)

    technicians = _eligible_technicians(current_user)
    schedules, truncated = _active_schedules(current_user)
    by_tech: dict[str, list[dict]] = {}
    for s in schedules:
        if s["effective_assigned_to"]:
            by_tech.setdefault(s["effective_assigned_to"], []).append(s)

    completions = supabase.table("pm_completion_records").select("technician_id, completed_at").eq(
        "tenant_id", current_user.hotel_id
    ).gte("completed_at", period_start.isoformat()).lt("completed_at", period_end.isoformat()).limit(COMPLETION_SCAN_LIMIT).execute().data or []
    done: dict[str, int] = {}
    for c in completions:
        done[str(c["technician_id"])] = done.get(str(c["technician_id"]), 0) + 1

    cards = []
    known = {t["id"] for t in technicians}
    for tech in technicians:
        mine = by_tech.get(tech["id"], [])
        dues = sorted((d for d in (_moment(s.get("next_due_at")) for s in mine) if d), key=lambda d: d)
        cards.append({
            **tech,
            "assigned": len(mine),
            "due_today": sum(1 for d in dues if day_start <= d < day_end),
            "overdue": sum(1 for d in dues if d < now),
            "completed": done.get(tech["id"], 0),
            "next_due_at": next((d.isoformat() for d in dues if d >= now), None),
        })
    # An assignee who is no longer eligible (deactivated, role removed) still has live work; surface it, do not hide it.
    orphan_ids = [uid for uid in by_tech if uid not in known]
    orphan_names = _names(set(orphan_ids), current_user)
    for uid in orphan_ids:
        mine = by_tech[uid]
        dues = [d for d in (_moment(s.get("next_due_at")) for s in mine) if d]
        cards.append({
            "id": uid, "name": orphan_names.get(uid), "role": None, "ineligible": True,
            "assigned": len(mine), "due_today": sum(1 for d in dues if day_start <= d < day_end),
            "overdue": sum(1 for d in dues if d < now), "completed": done.get(uid, 0), "next_due_at": None,
        })
    unassigned = sum(1 for s in schedules if not s["effective_assigned_to"])
    return {"data": cards, "meta": {
        "period": period, "period_start": period_start.isoformat(), "period_end": period_end.isoformat(),
        "unassigned_schedules": unassigned, "truncated": truncated,
    }}


@router.get("/technicians/{user_id}/assignments")
async def technician_assignments(user_id: str, current_user: CurrentUser = Depends(require_role(*PM_SCHEDULE_MANAGER_ROLES))):
    """The inspections currently assigned to one technician, soonest first."""
    try:
        UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Technician not found")
    schedules, _ = _active_schedules(current_user)
    mine = [s for s in schedules if s["effective_assigned_to"] == user_id]
    return {"data": mine}


# ---------------------------------------------------------------------------
# GET /pm-management/performance
# ---------------------------------------------------------------------------

@router.get("/performance")
async def get_performance(
    period: str = Query("month", pattern="^(today|week|month)$"),
    technician_id: Optional[UUID] = Query(None),
    category_id: Optional[UUID] = Query(None),
    current_user: CurrentUser = Depends(require_role(*PM_SCHEDULE_MANAGER_ROLES)),
):
    """Execution, not compliance. A completion is on time when it was recorded at or before the deadline it satisfied
    (`pm_completion_records.due_at`, captured at completion from migration 234 on, so an approved deferral is already
    reflected). Earlier completions carry no recorded deadline and are counted as `no_recorded_deadline`; they are
    never guessed into on-time or late, and the rate uses classified completions only. Nothing here is a regulatory
    or safety certification."""
    now = _now()
    tz = hotel_timezone(supabase, current_user.hotel_id)
    today = local_today(tz, now)
    if period == "today":
        start, end = local_midnight_utc(today, tz), local_midnight_utc(today + timedelta(days=1), tz)
    elif period == "week":
        start, end = _week_bounds(tz, now)
    else:
        first = today.replace(day=1)
        nxt = (first + timedelta(days=32)).replace(day=1)
        start, end = local_midnight_utc(first, tz), local_midnight_utc(nxt, tz)

    query = supabase.table("pm_completion_records").select(
        "id, pm_schedule_id, asset_id, technician_id, completed_at, due_at, defects, pm_completion_items(result)"
    ).eq("tenant_id", current_user.hotel_id).gte("completed_at", start.isoformat()).lt("completed_at", end.isoformat())
    if technician_id:
        query = query.eq("technician_id", str(technician_id))
    rows = query.order("completed_at", desc=True).limit(COMPLETION_SCAN_LIMIT + 1).execute().data or []
    truncated = len(rows) > COMPLETION_SCAN_LIMIT
    rows = rows[:COMPLETION_SCAN_LIMIT]

    if category_id and rows:
        asset_ids = sorted({str(r["asset_id"]) for r in rows if r.get("asset_id")})
        in_category = {
            str(a["id"]) for a in supabase.table("assets").select("id, category_id").eq("tenant_id", current_user.hotel_id).in_(
                "id", asset_ids
            ).execute().data or [] if str(a.get("category_id") or "") == str(category_id)
        }
        rows = [r for r in rows if str(r.get("asset_id") or "") in in_category]

    on_time = late = no_deadline = with_findings = 0
    for r in rows:
        due, done = _moment(r.get("due_at")), _moment(r.get("completed_at"))
        if due is None or done is None:
            no_deadline += 1
        elif done <= due:
            on_time += 1
        else:
            late += 1
        results = [i.get("result") for i in (r.get("pm_completion_items") or [])]
        if "failed" in results or r.get("defects"):
            with_findings += 1

    schedules, sched_truncated = _active_schedules(current_user)
    if technician_id:
        schedules = [s for s in schedules if s["effective_assigned_to"] == str(technician_id)]
    if category_id:
        schedules = [s for s in schedules if str(_asset(s).get("category_id") or "") == str(category_id)]
    still_overdue = sum(1 for s in schedules if (d := _moment(s.get("next_due_at"))) and d < now)
    upcoming_end = now + timedelta(days=7)
    upcoming = sum(1 for s in schedules if (d := _moment(s.get("next_due_at"))) and now <= d < upcoming_end)

    decisions = supabase.table("pm_deferral_decisions").select("id, decision").eq("tenant_id", current_user.hotel_id).eq(
        "decision", "approved"
    ).gte("decided_at", start.isoformat()).lt("decided_at", end.isoformat()).limit(1000).execute().data or []

    classified = on_time + late
    return {"data": {
        "period": period,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "completed_on_time": on_time,
        "completed_late": late,
        "no_recorded_deadline": no_deadline,
        "completed_total": len(rows),
        "inspections_with_findings": with_findings,
        "still_overdue": still_overdue,
        "upcoming_7_days": upcoming,
        "deferrals_approved": len(decisions),
        "on_time_rate": round(on_time / classified, 4) if classified else None,
        "rate_basis": {"numerator": on_time, "denominator": classified},
    }, "meta": {
        "truncated": truncated or sched_truncated,
        "note": "Still overdue and upcoming describe the schedules as they stand now, not the selected period. "
                "Completions before deadline capture began have no recorded deadline and are excluded from the rate.",
    }}

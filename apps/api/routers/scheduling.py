"""Shift templates (`shifts`) and scheduled occurrences (`shift_assignments`).

THE PLAN, NOT ATTENDANCE. A shift_assignments row says who is scheduled; it never says who is working. Actual
attendance is hk_shift_sessions (routers/shifts.py) and is interpreted in services/scheduling.py. The legacy
clock-in/out endpoints below are kept for the existing web consumer and are not authoritative.

INTEGRITY RULES (migration 225 enforces the same ones in the database)
  * An assignment carries its OWN copy of the shift's name/department/times/instants, taken when it was created.
    Editing or archiving a template never changes an existing assignment.
  * A template is never hard-deleted; DELETE archives it.
  * One person cannot hold overlapping shifts (overnight shifts and DST handled in hotel-local time); several
    non-overlapping shifts on one date are fine.
  * Writes are all-or-nothing: a request is fully validated first and then written as ONE statement (one
    transaction). Creating the same (person, shift, date) again is a no-op, so a retried request is safe.
  * Concurrent edits are detected with `expected_version`; the database trigger serialises overlap checks per person.
  * Past (hotel-local) dates are not edited; only a GM may remove a past assignment.
"""
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from postgrest.exceptions import APIError

from core.database import supabase
from core.roles import SCHEDULE_MANAGER_ROLES, SCHEDULE_VIEWER_ROLES
from middleware.auth import CurrentUser, get_current_user, require_role
from models.requests import (
    BulkShiftAssignmentRequest,
    CreateShiftAssignmentRequest,
    CreateShiftRequest,
    UpdateShiftAssignmentRequest,
    UpdateShiftRequest,
)
from services.availability_store import assess_occurrences
from services.scheduling import (
    Occurrence,
    ScheduleWarning,
    compute_warnings,
    find_conflicts,
    format_clock,
    parse_clock,
    resolve_occurrence,
)
from services.scheduling_access import (
    ensure_can_manage,
    err,
    hotel_today,
    hotel_zone,
    load_departments,
    load_staff,
    manager_scope,
    record_audit,
)
from services.scheduling_availability import (
    APPROVED_TIME_OFF,
    MARKED_UNAVAILABLE,
    OUTSIDE_AVAILABILITY,
    PENDING_TIME_OFF,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/schedules", tags=["scheduling"])

# Who may WRITE schedules (unchanged from before this phase) and who may READ the team-wide schedule (the writers
# plus the chief engineer; everyone else sees only their own). Defined in core/roles.py.
SUPERVISOR_ROLES = SCHEDULE_MANAGER_ROLES
TEAM_VIEW_ROLES = SCHEDULE_VIEWER_ROLES

MAX_RANGE_DAYS = 92
DEFAULT_PAST_DAYS = 14
DEFAULT_FUTURE_DAYS = 60
ROW_CAP = 2000
MAX_BATCH = 500

ASSIGNMENT_COLUMNS = (
    "id, tenant_id, user_id, shift_id, work_date, shift_name, department_id, start_time, end_time, starts_at, ends_at, "
    "publication_state, version, notes, is_on_shift, clocked_in_at, clocked_out_at, created_at, updated_at, snapshot_source"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _shape(row: dict) -> dict:
    """Stored row -> response row. `shifts` keeps the legacy nested shape, now from the occurrence's own snapshot."""
    shaped = dict(row)
    shaped["shifts"] = {
        "name": row.get("shift_name"),
        "start_time": row.get("start_time"),
        "end_time": row.get("end_time"),
    }
    return shaped


def _ts(value) -> Optional[datetime]:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _day(value) -> Optional[date]:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _occurrence(row: dict) -> Optional[Occurrence]:
    starts, ends, day = _ts(row.get("starts_at")), _ts(row.get("ends_at")), _day(row.get("work_date"))
    if not (starts and ends and day):
        return None
    return Occurrence(str(row["user_id"]), str(row["shift_id"]), day, starts, ends, str(row["id"]) if row.get("id") else None)


def _clock(value: Optional[str], field: str) -> Optional[time]:
    if value is None:
        return None
    parsed = parse_clock(value)
    if parsed is None:
        raise err(422, "invalid_time", f"{field} must be a time like 07:00 or 07:00:00.", field=field)
    return parsed


def _template_times(start: Optional[str], end: Optional[str]) -> tuple[time, time]:
    start_t, end_t = _clock(start, "start_time"), _clock(end, "end_time")
    if start_t is None or end_t is None:
        raise err(422, "invalid_time", "start_time and end_time are both required.")
    if start_t == end_t:
        raise err(422, "invalid_time", "A shift cannot start and end at the same time.")
    return start_t, end_t


def _raise_write_error(exc: APIError):
    """Map a database refusal from the migration-225 trigger/constraints to the same errors the pre-check gives."""
    code = getattr(exc, "code", None) or ""
    if code == "TO001":
        raise err(409, "approved_time_off", "This person has approved time off during that shift.",
                  conflicts=[{"code": APPROVED_TIME_OFF}])
    if code == "23P01" or "overlap" in str(exc).lower():
        raise err(409, "schedule_conflict", "This person's schedule changed at the same moment. Reload and try again.",
                  conflicts=[{"code": "overlapping_shift"}])
    if code == "23505":
        raise err(409, "duplicate_assignment", "This person is already scheduled on that shift and date.")
    raise exc


def _load_template(hotel_id: str, shift_id: str) -> dict:
    result = supabase.table("shifts").select("*").eq("id", shift_id).eq("tenant_id", hotel_id).maybe_single().execute()
    if not result or not result.data:
        raise err(404, "shift_not_found", "Shift not found")
    return result.data


def _existing_rows(hotel_id: str, user_ids: list[str], low: date, high: date) -> list[dict]:
    """Everyone's non-cancelled occurrences for `user_ids` on work dates [low - 1 day, high + 1 day]."""
    return (
        supabase.table("shift_assignments")
        .select(ASSIGNMENT_COLUMNS)
        .eq("tenant_id", hotel_id)
        .in_("user_id", user_ids)
        .neq("publication_state", "cancelled")
        .gte("work_date", (low - timedelta(days=1)).isoformat())
        .lte("work_date", (high + timedelta(days=1)).isoformat())
        .execute()
        .data
        or []
    )


def _week_bounds(low: date, high: date) -> tuple[date, date]:
    return low - timedelta(days=low.weekday()), high + timedelta(days=6 - high.weekday())


_AVAILABILITY_DETAIL = {
    MARKED_UNAVAILABLE: "The employee said they cannot work this day.",
    OUTSIDE_AVAILABILITY: "This shift is outside the hours the employee said they can work.",
    PENDING_TIME_OFF: "The employee has a time-off request for these hours that has not been decided.",
}


def _availability_warnings(hotel_id: str, occurrences: list[Occurrence], zone) -> list[ScheduleWarning]:
    """
    Approved time off is a restriction, not a preference: it REFUSES the write (409 approved_time_off). Everything else
    the employee submitted is advice shown as a warning; missing availability is simply unknown and says nothing here.
    A failed read adds nothing -- the database trigger (migration 227) still refuses approved-leave overlaps.
    """
    assessed = assess_occurrences(hotel_id, occurrences, zone)
    if not assessed:
        return []
    blocked = [(o, a) for o, a in zip(occurrences, assessed) if APPROVED_TIME_OFF in a.blockers]
    if blocked:
        raise err(409, "approved_time_off", "That person has approved time off during this shift. Cancel the leave first or choose someone else.",
                  conflicts=[{"code": APPROVED_TIME_OFF, "user_id": o.user_id, "work_date": o.work_date.isoformat(),
                              "leave": a.leave} for o, a in blocked])
    return [
        ScheduleWarning(code, o.user_id, o.work_date, _AVAILABILITY_DETAIL[code])
        for o, a in zip(occurrences, assessed) for code in a.warnings if code in _AVAILABILITY_DETAIL
    ]


def _prepare(items: list[dict], current_user: CurrentUser) -> dict:
    """
    Validate a whole request before anything is written. Returns the rows to insert, the rows that already
    exist (idempotent repeats) and the operational warnings. Raises on the first hard error; schedule conflicts
    are reported together.
    """
    hotel_id = current_user.hotel_id
    departments = load_departments(hotel_id)

    shift_ids = sorted({i["shift_id"] for i in items})
    found = {
        str(r["id"]): r
        for r in supabase.table("shifts").select("*").eq("tenant_id", hotel_id).in_("id", shift_ids).execute().data or []
    }
    if len(found) != len(shift_ids):
        raise err(404, "shift_not_found", "Shift not found", missing=[s for s in shift_ids if s not in found])
    for template in found.values():
        if template.get("archived_at") or not template.get("is_active", True):
            raise err(409, "shift_inactive", f"Shift '{template.get('name')}' is inactive and cannot be scheduled.")
        ensure_can_manage(current_user, str(template["department_id"]), departments)

    user_ids = sorted({i["user_id"] for i in items})
    staff = load_staff(hotel_id, departments, user_ids)
    if len(staff) != len(user_ids):
        raise err(404, "staff_not_found", "Staff member not found", missing=[u for u in user_ids if u not in staff])

    zone = hotel_zone(hotel_id)  # after the ownership checks: another hotel's ids are a 404, never a timezone read
    today = hotel_today(zone)
    proposed: list[Occurrence] = []
    rows: list[dict] = []
    explicit_times: set[tuple[str, str, date]] = set()
    unknown_department: set[str] = set()
    for item in items:
        template = found[item["shift_id"]]
        member = staff[item["user_id"]]
        if member.department_id is None:
            unknown_department.add(member.user_id)
        elif member.department_id != str(template["department_id"]):
            raise err(422, "department_mismatch", "That employee does not work in this shift's department.",
                      user_id=member.user_id, shift_id=item["shift_id"])
        start_t = _clock(item.get("start_time"), "start_time") or parse_clock(template["start_time"])
        end_t = _clock(item.get("end_time"), "end_time") or parse_clock(template["end_time"])
        if start_t is None or end_t is None or start_t == end_t:
            raise err(422, "invalid_time", "The shift times are not valid.", shift_id=item["shift_id"])
        starts_at, ends_at = resolve_occurrence(item["work_date"], start_t, end_t, zone)
        key = (item["user_id"], item["shift_id"], item["work_date"])
        if item.get("start_time") is not None or item.get("end_time") is not None:
            explicit_times.add(key)
        proposed.append(Occurrence(item["user_id"], item["shift_id"], item["work_date"], starts_at, ends_at))
        rows.append({
            "tenant_id": hotel_id,
            "user_id": item["user_id"],
            "shift_id": item["shift_id"],
            "work_date": item["work_date"].isoformat(),
            "shift_name": template["name"],
            "department_id": str(template["department_id"]),
            "start_time": format_clock(start_t),
            "end_time": format_clock(end_t),
            "starts_at": starts_at.isoformat(),
            "ends_at": ends_at.isoformat(),
            "snapshot_source": "occurrence",
            "publication_state": "published",
            "version": 1,
            "notes": item.get("notes"),
            "created_by": current_user.user_id,
            "updated_by": current_user.user_id,
        })

    low, high = min(o.work_date for o in proposed), max(o.work_date for o in proposed)
    week_low, week_high = _week_bounds(low, high)
    stored = _existing_rows(hotel_id, user_ids, week_low, week_high)
    by_key = {(str(r["user_id"]), str(r["shift_id"]), str(r["work_date"])[:10]): r for r in stored}

    fresh_rows: list[dict] = []
    fresh: list[Occurrence] = []
    unchanged: list[dict] = []
    for occ, row in zip(proposed, rows):
        key = (occ.user_id, occ.shift_id, occ.work_date.isoformat())
        existing = by_key.get(key)
        if existing is None:
            fresh.append(occ)
            fresh_rows.append(row)
        elif (occ.user_id, occ.shift_id, occ.work_date) not in explicit_times or (
            existing.get("start_time") == row["start_time"] and existing.get("end_time") == row["end_time"]
        ):
            unchanged.append(existing)  # same person+shift+date already scheduled: a repeat is a no-op
        else:
            raise err(409, "duplicate_assignment",
                      "This person is already scheduled on that shift and date with different times. Edit that shift instead.",
                      conflicts=[{"code": "duplicate_assignment", "user_id": occ.user_id,
                                  "work_date": occ.work_date.isoformat(), "with_assignment_id": existing.get("id")}])

    stored_occ = [o for o in (_occurrence(r) for r in stored) if o is not None]
    conflicts = find_conflicts(fresh, stored_occ)
    if conflicts:
        raise err(409, "schedule_conflict", "That schedule overlaps another shift for the same person.",
                  conflicts=[c.as_dict() for c in conflicts])

    warnings = compute_warnings(fresh, stored_occ, hotel_today=today, unknown_department_users=unknown_department)
    warnings += _availability_warnings(hotel_id, fresh, zone)
    blocking = [w for w in warnings if w.severity == "block"]
    if blocking:
        raise err(409, "schedule_policy_blocked", "This schedule breaks a rule your hotel has set to block.",
                  warnings=[w.as_dict() for w in blocking])
    return {"rows": fresh_rows, "unchanged": unchanged, "warnings": [w.as_dict() for w in warnings]}


def _insert(rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    try:
        return supabase.table("shift_assignments").insert(rows).execute().data or []
    except APIError as exc:
        _raise_write_error(exc)


def _audit_created(current_user: CurrentUser, created: list[dict]) -> None:
    for row in created:
        record_audit(current_user, resource_type="shift_assignment", resource_id=str(row["id"]), action="created",
                     new_state={k: row.get(k) for k in ("user_id", "shift_id", "work_date", "start_time", "end_time")})


# ---------------------------------------------------------------------------
# Shift templates
# ---------------------------------------------------------------------------

@router.get("/shifts")
async def list_shifts(
    department_id: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    include_archived: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
):
    """List shift templates. Archived (removed) templates are hidden unless `include_archived=true`."""
    query = supabase.table("shifts").select("*").eq("tenant_id", current_user.hotel_id).order("start_time")
    if not include_archived:
        query = query.is_("archived_at", "null")
    if department_id:
        query = query.eq("department_id", department_id)
    if is_active is not None:
        query = query.eq("is_active", is_active)
    return {"data": query.execute().data}


@router.post("/shifts")
async def create_shift(
    body: CreateShiftRequest,
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES)),
):
    """Create a shift template. An end time before the start time is an overnight shift."""
    start_t, end_t = _template_times(body.start_time, body.end_time)
    departments = load_departments(current_user.hotel_id)
    if str(body.department_id) not in departments.code_by_id:
        raise err(404, "department_not_found", "Department not found")
    ensure_can_manage(current_user, str(body.department_id), departments)

    name = body.name.strip()
    existing = (
        supabase.table("shifts").select("id")
        .eq("tenant_id", current_user.hotel_id).eq("department_id", str(body.department_id))
        .eq("is_active", True).is_("archived_at", "null").ilike("name", name).execute()
    )
    if existing.data:
        raise err(409, "duplicate_shift_name", f"A shift named '{name}' already exists for this department.")

    result = supabase.table("shifts").insert({
        "tenant_id": current_user.hotel_id,
        "name": name,
        "department_id": str(body.department_id),
        "start_time": format_clock(start_t),
        "end_time": format_clock(end_t),
    }).execute()
    row = result.data[0] if result.data else None
    if row:
        record_audit(current_user, resource_type="shift_definition", resource_id=str(row["id"]), action="created",
                     new_state={"name": name, "start_time": row.get("start_time"), "end_time": row.get("end_time")})
    return {"data": row}


@router.patch("/shifts/{shift_id}")
async def update_shift(
    shift_id: str,
    body: UpdateShiftRequest,
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES)),
):
    """
    Update a template (name, times, is_active). Existing assignments keep the times they were created with, so this
    never alters a published or historical schedule; it only affects shifts scheduled from now on.
    """
    changes = body.model_dump(exclude_none=True)
    expected = changes.pop("expected_version", None)
    if not changes:
        raise err(422, "no_changes", "No valid fields to update")

    departments = load_departments(current_user.hotel_id)
    current = _load_template(current_user.hotel_id, shift_id)
    ensure_can_manage(current_user, str(current["department_id"]), departments)
    if expected is not None and expected != current.get("version", 1):
        raise err(409, "version_conflict", "This shift was changed by someone else. Reload and try again.",
                  current_version=current.get("version", 1))

    if "start_time" in changes or "end_time" in changes:
        start_t, end_t = _template_times(changes.get("start_time", current["start_time"]),
                                         changes.get("end_time", current["end_time"]))
        changes["start_time"], changes["end_time"] = format_clock(start_t), format_clock(end_t)
    if "name" in changes:
        changes["name"] = changes["name"].strip()
        if not changes["name"]:
            raise err(422, "invalid_name", "A shift needs a name.")
        clash = (
            supabase.table("shifts").select("id").eq("tenant_id", current_user.hotel_id)
            .eq("department_id", str(current["department_id"])).eq("is_active", True).is_("archived_at", "null")
            .ilike("name", changes["name"]).neq("id", shift_id).execute()
        )
        if clash.data:
            raise err(409, "duplicate_shift_name", f"A shift named '{changes['name']}' already exists for this department.")
    if changes.get("is_active") is True:
        changes["archived_at"] = None  # reactivating restores an archived template
        changes["archived_by"] = None

    version = current.get("version", 1)
    result = (
        supabase.table("shifts").update({**changes, "version": version + 1})
        .eq("id", shift_id).eq("tenant_id", current_user.hotel_id).eq("version", version).execute()
    )
    if not result.data:
        raise err(409, "version_conflict", "This shift was changed by someone else. Reload and try again.")
    record_audit(current_user, resource_type="shift_definition", resource_id=shift_id, action="updated",
                 old_state={k: current.get(k) for k in changes if k in current},
                 new_state={k: v for k, v in changes.items()})
    return {"data": result.data[0]}


@router.delete("/shifts/{shift_id}", status_code=204)
async def delete_shift(
    shift_id: str,
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES)),
):
    """
    Remove a shift template by ARCHIVING it (kept, inactive, unschedulable). Hard deletion used to cascade into every
    assignment that referenced the template; the database now refuses that too. Repeating the call is a no-op.
    """
    departments = load_departments(current_user.hotel_id)
    current = _load_template(current_user.hotel_id, shift_id)
    ensure_can_manage(current_user, str(current["department_id"]), departments)
    if current.get("archived_at"):
        return None
    supabase.table("shifts").update({
        "archived_at": datetime.now(timezone.utc).isoformat(),
        "archived_by": current_user.user_id,
        "is_active": False,
    }).eq("id", shift_id).eq("tenant_id", current_user.hotel_id).execute()
    record_audit(current_user, resource_type="shift_definition", resource_id=shift_id, action="archived",
                 old_state={"is_active": current.get("is_active")}, new_state={"is_active": False})
    return None


# ---------------------------------------------------------------------------
# Assignments (scheduled occurrences)
# ---------------------------------------------------------------------------

def _bounded_range(date_from: Optional[date], date_to: Optional[date], default_from: date, default_to: date) -> tuple[date, date]:
    low, high = date_from or default_from, date_to or default_to
    if low > high:
        raise err(422, "invalid_range", "date_from must not be after date_to.")
    if (high - low).days > MAX_RANGE_DAYS:
        raise err(422, "range_too_large", f"Ask for at most {MAX_RANGE_DAYS} days at a time.", max_days=MAX_RANGE_DAYS)
    return low, high


@router.get("/assignments/my-schedule")
async def get_my_schedule(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    """The caller's own PUBLISHED shifts for a hotel-local date range (default: today + 7 days)."""
    today = hotel_today(hotel_zone(current_user.hotel_id))
    low, high = _bounded_range(date_from, date_to, today, today + timedelta(days=7))
    result = (
        supabase.table("shift_assignments").select(ASSIGNMENT_COLUMNS)
        .eq("tenant_id", current_user.hotel_id).eq("user_id", current_user.user_id)
        .eq("publication_state", "published")
        .gte("work_date", low.isoformat()).lte("work_date", high.isoformat())
        .order("work_date").execute()
    )
    return {"data": [_shape(r) for r in result.data or []]}


@router.get("/assignments")
async def list_assignments(
    work_date: Optional[date] = Query(None),
    shift_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Scheduled occurrences. Managers see their own departments' team (gm: all); every other role sees only its own
    shifts. Always bounded: `work_date`, or `date_from`/`date_to` (at most 92 days), or by default the hotel-local
    window [today - 14 days, today + 60 days]; at most 2000 rows (`meta.truncated` says so).
    """
    zone = hotel_zone(current_user.hotel_id)
    today = hotel_today(zone)
    if work_date:
        low = high = work_date
    else:
        low, high = _bounded_range(date_from, date_to, today - timedelta(days=DEFAULT_PAST_DAYS),
                                   today + timedelta(days=DEFAULT_FUTURE_DAYS))

    query = (
        supabase.table("shift_assignments").select(ASSIGNMENT_COLUMNS)
        .eq("tenant_id", current_user.hotel_id)
        .gte("work_date", low.isoformat()).lte("work_date", high.isoformat())
        .order("work_date", desc=True).order("starts_at")
        .limit(ROW_CAP)
    )
    if current_user.role in SCHEDULE_VIEWER_ROLES:
        scope = manager_scope(current_user)
        if scope is not None:
            department_ids = sorted(load_departments(current_user.hotel_id).ids_in_scope(scope))
            if not department_ids:
                return {"data": [], "meta": {"date_from": low.isoformat(), "date_to": high.isoformat(), "truncated": False}}
            query = query.in_("department_id", department_ids)
        if user_id:
            query = query.eq("user_id", user_id)
    else:
        query = query.eq("user_id", current_user.user_id).eq("publication_state", "published")
    if shift_id:
        query = query.eq("shift_id", shift_id)

    rows = query.execute().data or []
    return {
        "data": [_shape(r) for r in rows],
        "meta": {"date_from": low.isoformat(), "date_to": high.isoformat(), "truncated": len(rows) >= ROW_CAP},
    }


def _write_response(created: list[dict], unchanged: list[dict], warnings: list[dict]) -> dict:
    return {
        "created_count": len(created),
        "updated_count": 0,
        "unchanged_count": len(unchanged),
        "warnings": warnings,
    }


@router.post("/assignments")
async def create_shift_assignment(
    request: CreateShiftAssignmentRequest,
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES)),
):
    """Schedule one person on a shift on a date. Repeating an identical request returns the existing assignment."""
    prepared = _prepare([{
        "user_id": str(request.user_id), "shift_id": str(request.shift_id), "work_date": request.work_date,
        "start_time": request.start_time, "end_time": request.end_time, "notes": request.notes,
    }], current_user)
    created = _insert(prepared["rows"])
    _audit_created(current_user, created)
    row = created[0] if created else (prepared["unchanged"][0] if prepared["unchanged"] else None)
    return {"data": _shape(row) if row else None, "meta": {"warnings": prepared["warnings"], "created": bool(created)}}


@router.post("/assignments/bulk")
async def bulk_create_assignments(
    body: BulkShiftAssignmentRequest,
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES)),
):
    """
    Schedule many people at once, ALL OR NOTHING: every item is validated, then written as one statement. Any hard
    error (unknown person, wrong department, overlap, duplicate in the request) rejects the whole request and
    nothing is saved. Items already scheduled are left alone (`unchanged_count`), so a retry is safe.
    """
    if len(body.assignments) > MAX_BATCH:
        raise err(422, "batch_too_large", f"At most {MAX_BATCH} assignments per request.")
    prepared = _prepare([{
        "user_id": str(i.user_id), "shift_id": str(i.shift_id), "work_date": i.work_date,
        "start_time": i.start_time, "end_time": i.end_time, "notes": i.notes,
    } for i in body.assignments], current_user)
    created = _insert(prepared["rows"])
    _audit_created(current_user, created)
    return {"data": _write_response(created, prepared["unchanged"], prepared["warnings"])}


def _version_conflict(current: dict) -> Exception:
    return err(409, "version_conflict", "This shift was changed by someone else. Reload and try again.",
               current=_shape(current))


@router.patch("/assignments/{assignment_id}")
async def update_shift_assignment(
    assignment_id: str,
    body: UpdateShiftAssignmentRequest,
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES)),
):
    """
    Edit one scheduled occurrence (its shift, employee, date, its own start/end, notes). `expected_version` must match the stored
    version or the edit is refused with 409 and the current row, never merged over someone else's change. Past
    dates and shifts that already have recorded attendance are not editable.
    """
    hotel_id = current_user.hotel_id
    result = supabase.table("shift_assignments").select(ASSIGNMENT_COLUMNS).eq("id", assignment_id).eq("tenant_id", hotel_id).maybe_single().execute()
    row = result.data if result else None
    if not row:
        raise err(404, "assignment_not_found", "Assignment not found")

    zone = hotel_zone(hotel_id)
    departments = load_departments(hotel_id)
    ensure_can_manage(current_user, row.get("department_id"), departments)
    work_date = _day(row["work_date"])
    if work_date < hotel_today(zone):
        raise err(409, "historical_assignment_locked", "Past shifts cannot be edited.")
    if row.get("clocked_in_at"):
        raise err(409, "has_attendance", "This shift already has recorded attendance and cannot be edited.")
    if row.get("version", 1) != body.expected_version:
        raise _version_conflict(row)

    fields = body.model_dump(exclude_unset=True, exclude={"expected_version"})
    if not fields:
        raise err(422, "no_changes", "No valid fields to update")

    shift_id = str(fields.get("shift_id") or row["shift_id"])
    target_user = str(fields.get("user_id") or row["user_id"])
    target_date = fields.get("work_date") or work_date
    template = _load_template(hotel_id, shift_id)
    template_changed = shift_id != str(row["shift_id"])
    user_changed = target_user != str(row["user_id"])
    date_changed = target_date != work_date
    if date_changed and target_date < hotel_today(zone):
        raise err(409, "historical_assignment_locked", "A shift cannot be moved into the past.")
    if template_changed or user_changed or date_changed:
        if template_changed:
            if template.get("archived_at") or not template.get("is_active", True):
                raise err(409, "shift_inactive", f"Shift '{template.get('name')}' is inactive and cannot be scheduled.")
            ensure_can_manage(current_user, str(template["department_id"]), departments)
        member = load_staff(hotel_id, departments, [target_user]).get(target_user)
        if member is None:  # another hotel's id is indistinguishable from an unknown one, on purpose
            if user_changed:
                raise err(404, "staff_not_found", "Staff member not found", missing=[target_user])
            raise err(409, "staff_inactive", "That employee is no longer active.")
        if member.department_id is not None and member.department_id != str(template["department_id"]):
            raise err(422, "department_mismatch", "That employee does not work in this shift's department.")
        duplicate = (
            supabase.table("shift_assignments").select("id").eq("tenant_id", hotel_id).eq("user_id", target_user)
            .eq("shift_id", shift_id).eq("work_date", target_date.isoformat()).neq("id", assignment_id).execute()
        )
        if duplicate.data:
            raise err(409, "duplicate_assignment", "This person is already scheduled on that shift and date.")

    start_t = _clock(fields.get("start_time"), "start_time") or parse_clock(
        template["start_time"] if template_changed and "start_time" not in fields else row["start_time"])
    end_t = _clock(fields.get("end_time"), "end_time") or parse_clock(
        template["end_time"] if template_changed and "end_time" not in fields else row["end_time"])
    if start_t is None or end_t is None or start_t == end_t:
        raise err(422, "invalid_time", "The shift times are not valid.")
    starts_at, ends_at = resolve_occurrence(target_date, start_t, end_t, zone)

    others = [o for o in (_occurrence(r) for r in _existing_rows(hotel_id, [target_user], target_date, target_date))
              if o is not None and o.id != assignment_id]
    mine = Occurrence(target_user, shift_id, target_date, starts_at, ends_at, assignment_id)
    conflicts = find_conflicts([mine], others)
    if conflicts:
        raise err(409, "schedule_conflict", "That change overlaps another shift for the same person.",
                  conflicts=[c.as_dict() for c in conflicts])
    warnings = compute_warnings([mine], others, hotel_today=hotel_today(zone))
    if user_changed or date_changed or "start_time" in fields or "end_time" in fields or template_changed:
        warnings += _availability_warnings(hotel_id, [mine], zone)

    update = {
        "shift_id": shift_id,
        "shift_name": template["name"] if template_changed else row.get("shift_name"),
        "department_id": str(template["department_id"]) if template_changed else row.get("department_id"),
        "start_time": format_clock(start_t),
        "end_time": format_clock(end_t),
        "starts_at": starts_at.isoformat(),
        "ends_at": ends_at.isoformat(),
        "snapshot_source": "occurrence",
        "updated_by": current_user.user_id,
        "version": body.expected_version + 1,
    }
    if user_changed:
        update["user_id"] = target_user
    if date_changed:
        update["work_date"] = target_date.isoformat()
    if "notes" in fields:
        update["notes"] = fields["notes"]
    audit_keys = ("user_id", "work_date", "shift_id", "start_time", "end_time", "notes")
    old_state = {k: row.get(k) for k in audit_keys}  # captured before the write
    try:
        saved = (
            supabase.table("shift_assignments").update(update)
            .eq("id", assignment_id).eq("tenant_id", hotel_id).eq("version", body.expected_version).execute()
        )
    except APIError as exc:
        _raise_write_error(exc)
    if not saved.data:
        latest = supabase.table("shift_assignments").select(ASSIGNMENT_COLUMNS).eq("id", assignment_id).eq("tenant_id", hotel_id).maybe_single().execute()
        if latest and latest.data:
            raise _version_conflict(latest.data)
        raise err(404, "assignment_not_found", "Assignment not found")
    record_audit(current_user, resource_type="shift_assignment", resource_id=assignment_id, action="updated",
                 old_state=old_state, new_state={k: update.get(k) for k in audit_keys if k in update})
    return {"data": _shape(saved.data[0]), "meta": {"warnings": [w.as_dict() for w in warnings]}}


@router.delete("/assignments/{assignment_id}")
async def delete_assignment(
    assignment_id: str,
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES)),
    expected_version: Optional[int] = None,  # query parameter: refuse if the shift changed since the caller saw it
):
    """
    Remove a scheduled occurrence. Refused (409) when the shift already has recorded attendance, and for past dates
    unless the caller is a GM. The removed row is written to the audit history first.
    """
    hotel_id = current_user.hotel_id
    fetched = supabase.table("shift_assignments").select(ASSIGNMENT_COLUMNS).eq("id", assignment_id).eq("tenant_id", hotel_id).maybe_single().execute()
    row = fetched.data if fetched else None
    if not row:
        raise err(404, "assignment_not_found", "Assignment not found")
    ensure_can_manage(current_user, row.get("department_id"), load_departments(hotel_id))
    if expected_version is not None and row.get("version", 1) != expected_version:
        raise _version_conflict(row)  # the shift changed since the caller looked at it; never remove an unseen change
    if row.get("clocked_in_at") or row.get("is_on_shift"):
        raise err(409, "has_attendance", "This shift already has recorded attendance and cannot be removed.")
    if _day(row["work_date"]) < hotel_today(hotel_zone(hotel_id)) and manager_scope(current_user) is not None:
        raise err(409, "historical_assignment_locked", "Past shifts can only be removed by a GM.")

    record_audit(current_user, resource_type="shift_assignment", resource_id=assignment_id, action="deleted",
                 old_state={k: row.get(k) for k in ("user_id", "shift_id", "work_date", "start_time", "end_time", "version")})
    result = supabase.table("shift_assignments").delete().eq("id", assignment_id).eq("tenant_id", hotel_id).execute()
    if not result.data:
        raise err(404, "assignment_not_found", "Assignment not found")
    return {"data": {"success": True, "deleted_id": assignment_id}}


# ---------------------------------------------------------------------------
# Legacy clock-in/out (kept for the existing web consumer; NOT the attendance source of truth -- see module docstring)
# ---------------------------------------------------------------------------

@router.patch("/assignments/{assignment_id}/clock-in")
async def clock_in(assignment_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """Legacy clock-in on the assignment row. Real attendance is POST /shifts/start (hk_shift_sessions)."""
    fetch = supabase.table("shift_assignments").select("user_id").eq("id", assignment_id).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    if not fetch.data:
        raise HTTPException(status_code=404, detail="Assignment not found")
    is_supervisor = current_user.role in SCHEDULE_MANAGER_ROLES
    is_own = fetch.data["user_id"] == current_user.user_id
    if not is_own and not is_supervisor:
        raise HTTPException(status_code=403, detail="Not authorized to clock in for another user")
    result = supabase.table("shift_assignments").update({
        "clocked_in_at": datetime.now(timezone.utc).isoformat(), "is_on_shift": True,
    }).eq("id", assignment_id).eq("tenant_id", current_user.hotel_id).execute()
    return {"data": result.data[0] if result.data else None}


@router.patch("/assignments/{assignment_id}/clock-out")
async def clock_out(assignment_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """Legacy clock-out on the assignment row. Real attendance is POST /shifts/end (hk_shift_sessions)."""
    fetch = supabase.table("shift_assignments").select("user_id").eq("id", assignment_id).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    if not fetch.data:
        raise HTTPException(status_code=404, detail="Assignment not found")
    is_supervisor = current_user.role in SCHEDULE_MANAGER_ROLES
    is_own = fetch.data["user_id"] == current_user.user_id
    if not is_own and not is_supervisor:
        raise HTTPException(status_code=403, detail="Not authorized to clock out for another user")
    result = supabase.table("shift_assignments").update({
        "clocked_out_at": datetime.now(timezone.utc).isoformat(), "is_on_shift": False,
    }).eq("id", assignment_id).eq("tenant_id", current_user.hotel_id).execute()
    return {"data": result.data[0] if result.data else None}


# ---------------------------------------------------------------------------
# Roster (legacy shape)
# ---------------------------------------------------------------------------

@router.get("/today-roster")
async def today_roster(current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))):
    """
    Staff scheduled today (hotel-local) who the legacy assignment clock marks as clocked in and not out. Kept for the
    existing web panel; the team schedule (GET /schedules/team?include_attendance=true) is the verified view.
    """
    today_str = hotel_today(hotel_zone(current_user.hotel_id)).isoformat()
    result = (
        supabase.table("shift_assignments")
        .select("user_id, is_on_shift, clocked_in_at, clocked_out_at, shift_name, start_time, end_time")
        .eq("tenant_id", current_user.hotel_id).eq("work_date", today_str).is_("clocked_out_at", "null").execute()
    )
    rows = [r for r in (result.data or []) if r.get("is_on_shift") or r.get("clocked_in_at")]

    user_ids = list({r["user_id"] for r in rows})
    profiles_map: dict = {}
    roles_map: dict = {}
    if user_ids:
        profiles = supabase.table("user_profiles").select("id, full_name").in_("id", user_ids).execute()
        profiles_map = {p["id"]: (p.get("full_name") or "") for p in (profiles.data or [])}
        roles = (
            supabase.table("user_roles").select("user_id, role").eq("tenant_id", current_user.hotel_id)
            .eq("is_active", True).in_("user_id", user_ids).execute()
        )
        roles_map = {r["user_id"]: r["role"] for r in (roles.data or [])}

    roster = [{
        "user_id": row["user_id"],
        "full_name": profiles_map.get(row["user_id"], ""),
        "role": roles_map.get(row["user_id"]),
        "shift": {"name": row.get("shift_name"), "start_time": row.get("start_time"), "end_time": row.get("end_time")},
        "clocked_in_at": row.get("clocked_in_at"),
        "is_on_shift": row.get("is_on_shift", False),
    } for row in rows]
    # Frontend contract (TodayRosterResponse): {data: {roster, date}}.
    return {"data": {"roster": roster, "date": today_str}}

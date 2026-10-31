"""Draft-versus-published scheduling (Team Scheduling Phase 7).

  POST   /schedules/revisions/changes                      stage one create / edit / cancel into the department's draft
  GET    /schedules/revisions/drafts                       the open drafts the caller may manage (with their changes)
  GET    /schedules/revisions                              publication history
  GET    /schedules/revisions/{id}                         one revision (changes, result, publisher)
  GET    /schedules/revisions/{id}/review                  the publish review: counts, impact, blocking errors, warnings
  POST   /schedules/revisions/{id}/publish                 apply the whole draft atomically (idempotent)
  POST   /schedules/revisions/{id}/discard                 throw the draft away (never publishable afterwards)
  POST   /schedules/revisions/{id}/correct                 start a corrective draft for a published revision
  DELETE /schedules/revisions/{id}/changes/{change_id}     remove one staged change
  GET    /schedules/revisions/{id}/events                  the append-only history
  GET    /schedules/revisions/{id}/notifications           what happened to the employee messages
  POST   /schedules/revisions/{id}/notifications/retry     reset failed messages and process them again

WHAT IS AND IS NOT A DRAFT. Only the new supervisor mobile planning flow stages drafts. Every pre-existing write
(`POST/PATCH/DELETE /schedules/assignments`, the web scheduler) still commits immediately, and so do emergency call-out
fills (`/schedules/gaps/{id}/assign` and offer/claim acceptance): a call-out replacement must never wait for review.
Employees cannot reach any endpoint here (managers only), and a draft never touches `shift_assignments`, so nothing a
draft holds can appear in an employee's schedule.
"""
import logging
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Query

from core.database import supabase
from middleware.auth import CurrentUser, require_role
from models.schedule_revisions import DiscardRequest, PublishRequest, StageChangeRequest
from routers.scheduling import _AVAILABILITY_DETAIL, SUPERVISOR_ROLES, _clock, _load_template
from services import revision_store as store
from services import schedule_outbox
from services.availability_store import assess_occurrences
from services.schedule_revisions import build_review, stage_decision
from services.scheduling import Occurrence, format_clock, parse_clock, resolve_occurrence
from services.scheduling_access import (
    ensure_can_manage,
    err,
    hotel_today,
    hotel_zone,
    load_departments,
    load_names,
    load_staff,
    manager_scope,
)
from services.scheduling_availability import APPROVED_TIME_OFF

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/schedules/revisions", tags=["scheduling-revisions"])

HISTORY_LIMIT = 50


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

def _change_view(change: dict) -> dict:
    return {
        "id": str(change["id"]), "kind": change["kind"],
        "assignment_id": str(change["assignment_id"]) if change.get("assignment_id") else None,
        "client_key": change.get("client_key"), "base_version": change.get("base_version"),
        "before": change.get("before"), "proposed": change.get("proposed"), "reason": change.get("reason"),
        "department_id": str(change["department_id"]), "created_at": change.get("created_at"), "updated_at": change.get("updated_at"),
    }


def _revision_view(revision: dict, changes: Optional[list[dict]] = None, names: Optional[dict] = None) -> dict:
    names = names or {}
    view = {
        "id": str(revision["id"]), "department_id": str(revision["department_id"]), "status": revision["status"],
        "version": revision["version"], "corrects_revision_id": revision.get("corrects_revision_id"),
        "created_at": revision.get("created_at"), "updated_at": revision.get("updated_at"),
        "published_at": revision.get("published_at"), "published_by": revision.get("published_by"),
        "published_by_name": names.get(str(revision.get("published_by") or "")) or None,
        "discarded_at": revision.get("discarded_at"), "result": revision.get("result"),
        "created_by": revision.get("created_by"), "updated_by": revision.get("updated_by"),
    }
    if changes is not None:
        view["changes"] = [_change_view(c) for c in changes]
    return view


def _load_manageable(current_user: CurrentUser, revision_id: str) -> tuple[dict, "object"]:
    """The revision, only if it belongs to this hotel AND the caller's role manages its department (else a plain 404)."""
    revision = store.get_revision(current_user.hotel_id, revision_id)
    if revision is None:
        raise err(404, "revision_not_found", "Draft not found.")
    departments = load_departments(current_user.hotel_id)
    ensure_can_manage(current_user, str(revision["department_id"]), departments)
    return revision, departments


# ---------------------------------------------------------------------------
# Staging
# ---------------------------------------------------------------------------

def _shape_proposal(row: dict) -> dict:
    return {
        "user_id": str(row["user_id"]), "shift_id": str(row["shift_id"]), "shift_name": row.get("shift_name"),
        "department_id": str(row["department_id"]) if row.get("department_id") else None,
        "work_date": str(row["work_date"])[:10], "start_time": str(row["start_time"])[:8], "end_time": str(row["end_time"])[:8],
        "starts_at": row.get("starts_at"), "ends_at": row.get("ends_at"), "notes": row.get("notes"),
    }


def _snapshot(row: dict) -> dict:
    return {**_shape_proposal(row), "version": row.get("version")}


def _resolve(proposal: dict, zone, today: date) -> dict:
    """Fill the UTC instants for the final times (hotel-local, overnight and DST aware) and refuse an invalid shift."""
    start_t, end_t = parse_clock(proposal["start_time"]), parse_clock(proposal["end_time"])
    if start_t is None or end_t is None or start_t == end_t:
        raise err(422, "invalid_time", "The shift times are not valid.")
    work_date = date.fromisoformat(str(proposal["work_date"])[:10])
    if work_date < today:
        raise err(409, "historical_assignment_locked", "A shift cannot be scheduled in the past.")
    starts_at, ends_at = resolve_occurrence(work_date, start_t, end_t, zone)
    return {**proposal, "start_time": format_clock(start_t), "end_time": format_clock(end_t),
            "starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat()}


def _apply_fields(base: dict, body: StageChangeRequest, hotel_id: str, departments, current_user: CurrentUser,
                  required_department: Optional[str]) -> dict:
    """Overlay the fields the caller sent onto `base`, validating a changed shift template and employee."""
    proposal = dict(base)
    sent = body.model_fields_set
    if body.user_id is not None:
        proposal["user_id"] = str(body.user_id)
    if body.work_date is not None:
        proposal["work_date"] = body.work_date.isoformat()
    template_changed = body.shift_id is not None and str(body.shift_id) != str(proposal.get("shift_id"))
    if template_changed:
        template = _load_template(hotel_id, str(body.shift_id))
        if template.get("archived_at") or not template.get("is_active", True):
            raise err(409, "shift_inactive", f"Shift '{template.get('name')}' is inactive and cannot be scheduled.")
        ensure_can_manage(current_user, str(template["department_id"]), departments)
        proposal.update(shift_id=str(template["id"]), shift_name=template["name"], department_id=str(template["department_id"]))
        if "start_time" not in sent:
            proposal["start_time"] = format_clock(parse_clock(template["start_time"]))
        if "end_time" not in sent:
            proposal["end_time"] = format_clock(parse_clock(template["end_time"]))
    if "start_time" in sent and body.start_time is not None:
        proposal["start_time"] = format_clock(_clock(body.start_time, "start_time"))
    if "end_time" in sent and body.end_time is not None:
        proposal["end_time"] = format_clock(_clock(body.end_time, "end_time"))
    if "notes" in sent:
        proposal["notes"] = body.notes
    if required_department and str(proposal.get("department_id")) != required_department:
        raise err(422, "department_mismatch", "A draft covers one department. This shift belongs to another one.")
    member = load_staff(hotel_id, departments, [proposal["user_id"]]).get(proposal["user_id"])
    if member is None:
        raise err(404, "staff_not_found", "Staff member not found", missing=[proposal["user_id"]])
    if member.department_id is not None and member.department_id != str(proposal.get("department_id")):
        raise err(422, "department_mismatch", "That employee does not work in this shift's department.")
    return proposal


@router.post("/changes")
async def stage_change(body: StageChangeRequest, current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))):
    """Stage one change. The live schedule is not touched; the response is the department's whole draft."""
    hotel_id = current_user.hotel_id
    departments = load_departments(hotel_id)
    zone = hotel_zone(hotel_id)
    today = hotel_today(zone)

    live: Optional[dict] = None
    staged: Optional[dict] = None  # the staged change this request targets by change_id
    if body.kind == "create":
        if body.change_id or body.assignment_id:
            raise err(422, "invalid_target", "A new shift does not target an existing one.")
        if not (body.client_key and body.user_id and body.shift_id and body.work_date):
            raise err(422, "missing_fields", "A new shift needs an employee, a shift, a date and a client_key.")
        template = _load_template(hotel_id, str(body.shift_id))
        if template.get("archived_at") or not template.get("is_active", True):
            raise err(409, "shift_inactive", f"Shift '{template.get('name')}' is inactive and cannot be scheduled.")
        department_id = str(template["department_id"])
        ensure_can_manage(current_user, department_id, departments)
        base = {"user_id": str(body.user_id), "shift_id": str(template["id"]), "shift_name": template["name"], "department_id": department_id,
                "work_date": body.work_date.isoformat(), "start_time": format_clock(parse_clock(template["start_time"])),
                "end_time": format_clock(parse_clock(template["end_time"])), "notes": None}
        proposal = _resolve(_apply_fields(base, body, hotel_id, departments, current_user, department_id), zone, today)
    elif body.change_id:
        staged = next((c for c in _find_change(hotel_id, str(body.change_id))), None)
        if staged is None or staged["kind"] != "create":
            raise err(404, "change_not_found", "That staged change was not found.")
        department_id = str(staged["department_id"])
        ensure_can_manage(current_user, department_id, departments)
        proposal = None
        if body.kind == "update":
            proposal = _resolve(_apply_fields(dict(staged["proposed"]), body, hotel_id, departments, current_user, department_id), zone, today)
    else:
        if not (body.assignment_id and body.expected_version):
            raise err(422, "missing_fields", "Changing a published shift needs assignment_id and expected_version.")
        live = store.live_by_ids(hotel_id, [str(body.assignment_id)]).get(str(body.assignment_id))
        if live is None:
            raise err(404, "assignment_not_found", "Assignment not found")
        department_id = str(live.get("department_id") or "")
        ensure_can_manage(current_user, department_id, departments)
        if live.get("publication_state") == "cancelled":
            raise err(404, "assignment_not_found", "Assignment not found")
        if int(live["version"]) != body.expected_version:
            raise err(409, "version_conflict", "This shift was changed by someone else. Reload and try again.", current=_snapshot(live))
        if live.get("clocked_in_at") or live.get("is_on_shift") or store.attendance_began(hotel_id, [live]):
            raise err(409, "has_attendance", "This shift already has recorded attendance and cannot be changed.")
        if date.fromisoformat(str(live["work_date"])[:10]) < today:
            raise err(409, "historical_assignment_locked", "Past shifts cannot be changed.")
        if store.committed_assignments(hotel_id, [str(live["id"])]):
            raise err(409, "coverage_commitment", "A call-out or coverage request is open for this shift. Resolve it first.")
        proposal = None

    draft = store.get_draft(hotel_id, department_id)
    existing: Optional[dict] = None
    if draft:
        for change in store.list_changes(hotel_id, str(draft["id"])):
            if (body.kind == "create" and change.get("client_key") == body.client_key) \
                    or (staged and str(change["id"]) == str(staged["id"])) \
                    or (live and change.get("assignment_id") and str(change["assignment_id"]) == str(live["id"])):
                existing = change
    if live is not None and body.kind == "update":
        reusable = existing if existing and existing.get("kind") == "update" and existing.get("base_version") == live["version"] else None
        base = dict(reusable["proposed"]) if reusable else _shape_proposal(live)
        proposal = _resolve(_apply_fields(base, body, hotel_id, departments, current_user, department_id), zone, today)
        if reusable is None:
            existing = existing if existing and existing.get("kind") == "update" else None  # a stale one is simply overwritten

    decision = stage_decision(
        existing=existing, incoming_kind=body.kind, live=_snapshot(live) if live else None, proposed=proposal)
    if decision.action == "noop":
        return {"data": {"revision": _revision_view(draft, store.list_changes(hotel_id, str(draft["id"]))) if draft else None,
                         "change": None, "action": "noop"}}

    draft = draft or store.create_draft(hotel_id, department_id, current_user.user_id)
    if decision.action == "delete":
        store.delete_change(hotel_id, str(existing["id"]))
        change = None
    else:
        row = {
            "department_id": department_id, "kind": decision.kind, "created_by": current_user.user_id, "reason": body.reason,
            "assignment_id": str(live["id"]) if live else None,
            "client_key": body.client_key if decision.kind == "create" else (existing or {}).get("client_key"),
            "base_version": int(live["version"]) if live else None,
            "before": _snapshot(live) if live else None,
            "proposed": proposal if decision.kind != "cancel" else None,
        }
        if existing and body.reason is None:
            row["reason"] = existing.get("reason")
        change = store.write_change(hotel_id, str(draft["id"]), existing, row)
    draft = store.touch_revision(hotel_id, draft, current_user.user_id)
    if draft["version"] > 2 or existing:
        store.record_event(hotel_id, str(draft["id"]), "draft_edited", current_user.user_id, {"action": decision.action, "kind": body.kind})
    return {"data": {"revision": _revision_view(draft, store.list_changes(hotel_id, str(draft["id"]))),
                     "change": _change_view(change) if change else None, "action": decision.action}}


def _find_change(hotel_id: str, change_id: str):
    rows = (supabase.table("schedule_revision_changes").select(store.CHANGE_COLUMNS)
            .eq("tenant_id", hotel_id).eq("id", change_id).limit(1).execute().data or [])
    return rows


@router.delete("/{revision_id}/changes/{change_id}")
async def remove_change(revision_id: str, change_id: str, current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))):
    revision, _ = _load_manageable(current_user, revision_id)
    if revision["status"] != "draft":
        raise err(409, "revision_closed", "This draft was published or discarded.", status=revision["status"])
    changes = store.list_changes(current_user.hotel_id, revision_id)
    if not any(str(c["id"]) == change_id for c in changes):
        raise err(404, "change_not_found", "That staged change was not found.")
    store.delete_change(current_user.hotel_id, change_id)
    revision = store.touch_revision(current_user.hotel_id, revision, current_user.user_id)
    store.record_event(current_user.hotel_id, revision_id, "draft_edited", current_user.user_id, {"action": "delete"})
    return {"data": _revision_view(revision, store.list_changes(current_user.hotel_id, revision_id))}


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

@router.get("/drafts")
async def list_drafts(current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))):
    hotel_id = current_user.hotel_id
    departments = load_departments(hotel_id)
    in_scope = sorted(departments.ids_in_scope(manager_scope(current_user)))
    drafts = store.list_drafts(hotel_id, in_scope)
    grouped = store.list_changes_for(hotel_id, [str(d["id"]) for d in drafts])
    return {"data": [_revision_view(d, grouped.get(str(d["id"]), [])) for d in drafts]}


@router.get("")
async def list_history(
    status: Optional[str] = Query(None, pattern="^(published|superseded|discarded)$"),
    limit: int = Query(20, ge=1, le=HISTORY_LIMIT),
    before: Optional[str] = Query(None, description="created_at cursor from the previous page"),
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES)),
):
    hotel_id = current_user.hotel_id
    departments = load_departments(hotel_id)
    in_scope = sorted(departments.ids_in_scope(manager_scope(current_user)))
    if not in_scope:
        return {"data": [], "meta": {"next": None}}
    query = (supabase.table("schedule_revisions").select(store.REVISION_COLUMNS).eq("tenant_id", hotel_id)
             .in_("department_id", in_scope).in_("status", [status] if status else ["published", "superseded", "discarded"])
             .order("created_at", desc=True).limit(limit + 1))
    if before:
        query = query.lt("created_at", before)
    rows = query.execute().data or []
    page, more = rows[:limit], len(rows) > limit
    names = load_names(sorted({str(r["published_by"]) for r in page if r.get("published_by")}))
    return {"data": [_revision_view(r, None, names) for r in page], "meta": {"next": page[-1]["created_at"] if more and page else None}}


@router.get("/{revision_id}")
async def get_revision(revision_id: str, current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))):
    revision, _ = _load_manageable(current_user, revision_id)
    names = load_names([str(revision[k]) for k in ("published_by", "created_by") if revision.get(k)])
    return {"data": _revision_view(revision, store.list_changes(current_user.hotel_id, revision_id), names)}


@router.get("/{revision_id}/events")
async def revision_events(revision_id: str, current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))):
    _load_manageable(current_user, revision_id)
    rows = (supabase.table("schedule_revision_events").select("id, event, actor_id, detail, created_at")
            .eq("tenant_id", current_user.hotel_id).eq("revision_id", revision_id).order("created_at").limit(200).execute().data or [])
    names = load_names(sorted({str(r["actor_id"]) for r in rows if r.get("actor_id")}))
    return {"data": [{**r, "actor_name": names.get(str(r["actor_id"])) if r.get("actor_id") else None} for r in rows]}


# ---------------------------------------------------------------------------
# Review
# ---------------------------------------------------------------------------

def compute_review(current_user: CurrentUser, revision: dict, changes: list[dict]):
    hotel_id = current_user.hotel_id
    departments = load_departments(hotel_id)
    zone = hotel_zone(hotel_id)
    today = hotel_today(zone)
    targets = [str(c["assignment_id"]) for c in changes if c.get("assignment_id")]
    live = store.live_by_ids(hotel_id, targets)
    proposed_changes = [c for c in changes if c["kind"] != "cancel" and c.get("proposed")]
    user_ids = sorted({str(c["proposed"]["user_id"]) for c in proposed_changes} | {str(r["user_id"]) for r in live.values()})
    dates = [date.fromisoformat(str(c["proposed"]["work_date"])[:10]) for c in proposed_changes] + \
            [date.fromisoformat(str(r["work_date"])[:10]) for r in live.values()]
    around = store.neighbors(hotel_id, user_ids, min(dates), max(dates)) if dates else []

    occurrences: list[tuple[dict, Occurrence]] = []
    for change in proposed_changes:
        p = change["proposed"]
        try:
            occurrences.append((change, Occurrence(str(p["user_id"]), str(p["shift_id"]), date.fromisoformat(str(p["work_date"])[:10]),
                                                   _dt(p["starts_at"]), _dt(p["ends_at"]), str(change.get("assignment_id") or "") or None)))
        except (KeyError, ValueError, TypeError):
            continue
    leave_blocked: dict[str, dict] = {}
    availability: list[dict] = []
    assessed = assess_occurrences(hotel_id, [o for _, o in occurrences], zone) if occurrences else []
    for (change, occ), result in zip(occurrences, assessed or []):
        if APPROVED_TIME_OFF in result.blockers:
            leave_blocked[str(change["id"])] = {"leave": result.leave or []}
        for code in result.warnings:
            if code in _AVAILABILITY_DETAIL:
                availability.append({"code": code, "user_id": occ.user_id, "work_date": occ.work_date.isoformat(),
                                     "detail": _AVAILABILITY_DETAIL[code], "severity": "warn"})
    staff = load_staff(hotel_id, departments, user_ids) if user_ids else {}
    unknown = [u for u in user_ids if u in staff and staff[u].department_id is None]
    return build_review(
        revision=revision, changes=changes, live=live, neighbors=around, today=today,
        names=load_names(user_ids), committed=store.committed_assignments(hotel_id, targets),
        leave_blocked=leave_blocked, availability_warnings=availability, unknown_department_users=unknown,
        live_attendance=store.attendance_began(hotel_id, list(live.values())),
    )


def _dt(value):
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


@router.get("/{revision_id}/review")
async def review_revision(revision_id: str, current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))):
    revision, departments = _load_manageable(current_user, revision_id)
    changes = store.list_changes(current_user.hotel_id, revision_id)
    review = compute_review(current_user, revision, changes)
    return {"data": {
        "revision": _revision_view(revision),
        "department": departments.code_by_id.get(str(revision["department_id"])),
        **review.as_dict(),
    }}


# ---------------------------------------------------------------------------
# Publish / discard / correct
# ---------------------------------------------------------------------------

@router.post("/{revision_id}/publish")
async def publish_revision(
    revision_id: str,
    body: PublishRequest,
    background: BackgroundTasks,
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES)),
):
    """
    Apply the draft in ONE database transaction. The same `idempotency_key` after a lost response returns the
    committed result and never applies it twice. The success response is only sent after the database confirmed the
    whole revision; employee messages are queued in that same transaction and delivered afterwards.
    """
    hotel_id = current_user.hotel_id
    revision, _ = _load_manageable(current_user, revision_id)
    replay = revision["status"] == "published" and revision.get("publication_key") == body.idempotency_key
    if not replay:
        store.record_event(hotel_id, revision_id, "publication_attempted", current_user.user_id, {"expected_version": body.expected_version})
        if revision["status"] == "draft":
            review = compute_review(current_user, revision, store.list_changes(hotel_id, revision_id))
            if review.blocking:
                store.record_event(hotel_id, revision_id, "publication_rejected", current_user.user_id,
                                   {"reason": "blocked", "codes": sorted({b["code"] for b in review.blocking})})
                raise err(409, "publish_blocked", "This draft has problems that must be fixed before it can be published.",
                          blocking=review.blocking)
    try:
        result = store.publish(hotel_id, revision_id, body.expected_version, current_user.user_id, current_user.role, body.idempotency_key)
    except Exception as refusal:
        code = getattr(refusal, "code", None)
        store.record_event(hotel_id, revision_id, "publication_rejected", current_user.user_id, {"reason": code or "error"})
        raise
    if not result.get("replayed"):
        background.add_task(schedule_outbox.process_batch, 200, revision_id)
    return {"data": result, "meta": {"notifications": {"state": "queued" if result.get("notifications_queued") else "none"}}}


@router.post("/{revision_id}/discard")
async def discard_revision(revision_id: str, body: DiscardRequest, current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))):
    revision, _ = _load_manageable(current_user, revision_id)
    if revision["status"] != "draft":
        raise err(409, "revision_closed", "Only an open draft can be discarded.", status=revision["status"])
    saved = store.discard(current_user.hotel_id, revision, current_user.user_id, body.expected_version)
    return {"data": _revision_view(saved)}


@router.post("/{revision_id}/correct")
async def start_correction(revision_id: str, current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))):
    """
    A published mistake is fixed by a NEW draft that records what it corrects. There is no automatic undo: the draft is
    built from today's schedule and re-validated at publish time, never restored from an old snapshot.
    """
    revision, _ = _load_manageable(current_user, revision_id)
    if revision["status"] != "published":
        raise err(409, "not_published", "Only a published revision can be corrected.", status=revision["status"])
    if store.get_draft(current_user.hotel_id, str(revision["department_id"])):
        raise err(409, "draft_exists", "This department already has an open draft. Publish or discard it first.")
    draft = store.create_draft(current_user.hotel_id, str(revision["department_id"]), current_user.user_id, corrects=revision_id)
    return {"data": _revision_view(draft, [])}


# ---------------------------------------------------------------------------
# Notification status
# ---------------------------------------------------------------------------

@router.get("/{revision_id}/notifications")
async def notification_status(revision_id: str, current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))):
    _load_manageable(current_user, revision_id)
    status = schedule_outbox.revision_status(current_user.hotel_id, revision_id)
    names = load_names(sorted({f["user_id"] for f in status["failed"]}))
    for failure in status["failed"]:
        failure["name"] = names.get(failure["user_id"]) or ""
    return {"data": status}


@router.post("/{revision_id}/notifications/retry")
async def retry_notifications(revision_id: str, background: BackgroundTasks,
                              current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))):
    revision, _ = _load_manageable(current_user, revision_id)
    reset = (supabase.table("schedule_notifications")
             .update({"status": "queued", "attempts": 0, "next_attempt_at": datetime.now(timezone.utc).isoformat(), "last_error": None})
             .eq("tenant_id", current_user.hotel_id).eq("revision_id", revision_id).eq("status", "failed").execute().data or [])
    if reset:
        store.record_event(current_user.hotel_id, revision_id, "notification_retried", current_user.user_id, {"count": len(reset)})
        background.add_task(schedule_outbox.process_batch, 200, revision_id)
    return {"data": {"reset": len(reset), "revision_status": revision["status"]}}

"""Database access for schedule revisions (Team Scheduling Phase 7). All reads and writes are tenant-scoped here.

Writes to the LIVE schedule never happen in this module except through `publish()`, which calls the single database
function `publish_schedule_revision` (migration 228). Everything else only touches the revision tables.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from postgrest.exceptions import APIError

from core.database import supabase
from services.scheduling_access import err

logger = logging.getLogger(__name__)

REVISION_COLUMNS = (
    "id, tenant_id, department_id, status, version, corrects_revision_id, note, created_by, updated_by, created_at, "
    "updated_at, published_at, published_by, publication_key, result, discarded_at, discarded_by"
)
CHANGE_COLUMNS = (
    "id, revision_id, department_id, kind, assignment_id, client_key, base_version, before, proposed, reason, "
    "created_by, created_at, updated_at"
)
MAX_CHANGES = 500


def _rows(result) -> list[dict]:
    return (result.data if result is not None else None) or []


def _one(result) -> Optional[dict]:
    data = result.data if result is not None else None
    return data if isinstance(data, dict) else (data[0] if data else None)


def get_revision(tenant_id: str, revision_id: str) -> Optional[dict]:
    return _one(
        supabase.table("schedule_revisions").select(REVISION_COLUMNS)
        .eq("id", revision_id).eq("tenant_id", tenant_id).maybe_single().execute()
    )


def get_draft(tenant_id: str, department_id: str) -> Optional[dict]:
    return _one(
        supabase.table("schedule_revisions").select(REVISION_COLUMNS)
        .eq("tenant_id", tenant_id).eq("department_id", department_id).eq("status", "draft").maybe_single().execute()
    )


def list_drafts(tenant_id: str, department_ids: list[str]) -> list[dict]:
    if not department_ids:
        return []
    return _rows(
        supabase.table("schedule_revisions").select(REVISION_COLUMNS)
        .eq("tenant_id", tenant_id).eq("status", "draft").in_("department_id", department_ids).execute()
    )


def list_changes(tenant_id: str, revision_id: str) -> list[dict]:
    return _rows(
        supabase.table("schedule_revision_changes").select(CHANGE_COLUMNS)
        .eq("tenant_id", tenant_id).eq("revision_id", revision_id).order("created_at").limit(MAX_CHANGES).execute()
    )


def list_changes_for(tenant_id: str, revision_ids: list[str]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {r: [] for r in revision_ids}
    if not revision_ids:
        return grouped
    rows = _rows(
        supabase.table("schedule_revision_changes").select(CHANGE_COLUMNS)
        .eq("tenant_id", tenant_id).in_("revision_id", revision_ids).order("created_at").limit(MAX_CHANGES * max(1, len(revision_ids))).execute()
    )
    for row in rows:
        grouped.setdefault(str(row["revision_id"]), []).append(row)
    return grouped


def record_event(tenant_id: str, revision_id: str, event: str, actor_id: Optional[str], detail: Optional[dict] = None) -> None:
    """History is best effort for rejections/attempts (the schedule outcome never depends on it) and loud on failure."""
    try:
        supabase.table("schedule_revision_events").insert({
            "tenant_id": tenant_id, "revision_id": revision_id, "event": event, "actor_id": actor_id, "detail": detail or {},
        }).execute()
    except Exception:
        logger.exception("schedule revision event write failed revision=%s event=%s", revision_id, event)


def create_draft(tenant_id: str, department_id: str, actor_id: str, corrects: Optional[str] = None) -> dict:
    """The department's open draft, creating it when there is none. Two supervisors racing share the winner's row."""
    existing = get_draft(tenant_id, department_id)
    if existing:
        return existing
    try:
        row = _one(supabase.table("schedule_revisions").insert({
            "tenant_id": tenant_id, "department_id": department_id, "status": "draft", "version": 1, "created_by": actor_id,
            "updated_by": actor_id, "corrects_revision_id": corrects,
        }).execute())
    except APIError as exc:
        if getattr(exc, "code", None) == "23505":
            winner = get_draft(tenant_id, department_id)
            if winner:
                return winner
        raise
    record_event(tenant_id, str(row["id"]), "draft_created", actor_id, {"corrects": corrects} if corrects else {})
    return row


def touch_revision(tenant_id: str, revision: dict, actor_id: str) -> dict:
    """Bump the draft's version after an edit (publishing must have reviewed the latest). Compare-and-set, retried once."""
    for _ in range(2):
        current = get_revision(tenant_id, str(revision["id"])) or revision
        if current["status"] != "draft":
            raise err(409, "revision_closed", "This draft was published or discarded.", status=current["status"])
        saved = _rows(
            supabase.table("schedule_revisions")
            .update({"version": int(current["version"]) + 1, "updated_by": actor_id, "updated_at": datetime.now(timezone.utc).isoformat()})
            .eq("id", str(revision["id"])).eq("tenant_id", tenant_id).eq("version", current["version"]).eq("status", "draft").execute()
        )
        if saved:
            return saved[0]
    raise err(409, "draft_busy", "The draft is being edited by someone else. Try again.")


def write_change(tenant_id: str, revision_id: str, existing: Optional[dict], row: dict) -> dict:
    try:
        if existing:
            return _one(
                supabase.table("schedule_revision_changes").update({**row, "updated_at": datetime.now(timezone.utc).isoformat()})
                .eq("id", str(existing["id"])).eq("tenant_id", tenant_id).execute()
            )
        count = len(list_changes(tenant_id, revision_id))
        if count >= MAX_CHANGES:
            raise err(422, "draft_too_large", f"A draft holds at most {MAX_CHANGES} changes. Publish it first.")
        return _one(supabase.table("schedule_revision_changes").insert({"tenant_id": tenant_id, "revision_id": revision_id, **row}).execute())
    except APIError as exc:
        if getattr(exc, "code", None) == "SR002":
            raise err(409, "revision_closed", "This draft was published or discarded.")
        if getattr(exc, "code", None) == "23505":
            raise err(409, "draft_busy", "That shift was changed in the draft at the same moment. Reload and try again.")
        raise


def delete_change(tenant_id: str, change_id: str) -> None:
    try:
        supabase.table("schedule_revision_changes").delete().eq("id", change_id).eq("tenant_id", tenant_id).execute()
    except APIError as exc:
        if getattr(exc, "code", None) == "SR002":
            raise err(409, "revision_closed", "This draft was published or discarded.")
        raise


def discard(tenant_id: str, revision: dict, actor_id: str, expected_version: int) -> dict:
    saved = _rows(
        supabase.table("schedule_revisions")
        .update({"status": "discarded", "discarded_at": datetime.now(timezone.utc).isoformat(), "discarded_by": actor_id,
                 "updated_by": actor_id, "version": int(revision["version"]) + 1})
        .eq("id", str(revision["id"])).eq("tenant_id", tenant_id).eq("status", "draft").eq("version", expected_version).execute()
    )
    if not saved:
        latest = get_revision(tenant_id, str(revision["id"]))
        if latest and latest["status"] != "draft":
            raise err(409, "revision_closed", "This draft was already published or discarded.", status=latest["status"])
        raise err(409, "revision_changed", "The draft changed since you opened it. Review it again.")
    record_event(tenant_id, str(revision["id"]), "draft_discarded", actor_id)
    return saved[0]


# ---------------------------------------------------------------------------
# Live reads used by the review
# ---------------------------------------------------------------------------

LIVE_COLUMNS = (
    "id, user_id, shift_id, work_date, shift_name, department_id, start_time, end_time, starts_at, ends_at, "
    "publication_state, version, notes, is_on_shift, clocked_in_at"
)


def live_by_ids(tenant_id: str, ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    rows = _rows(supabase.table("shift_assignments").select(LIVE_COLUMNS).eq("tenant_id", tenant_id).in_("id", ids).execute())
    return {str(r["id"]): r for r in rows}


def neighbors(tenant_id: str, user_ids: list[str], low: date, high: date) -> list[dict]:
    if not user_ids:
        return []
    return _rows(
        supabase.table("shift_assignments").select(LIVE_COLUMNS)
        .eq("tenant_id", tenant_id).in_("user_id", user_ids).neq("publication_state", "cancelled")
        .gte("work_date", (low - timedelta(days=8)).isoformat()).lte("work_date", (high + timedelta(days=8)).isoformat())
        .limit(5000).execute()
    )


def committed_assignments(tenant_id: str, assignment_ids: list[str]) -> set[str]:
    if not assignment_ids:
        return set()
    rows = _rows(
        supabase.table("absence_records").select("assignment_id").eq("tenant_id", tenant_id)
        .in_("assignment_id", assignment_ids).in_("status", ["reported", "confirmed", "covered"]).execute()
    )
    return {str(r["assignment_id"]) for r in rows}


def attendance_began(tenant_id: str, rows: list[dict]) -> set[str]:
    """Assignment ids whose person has an hk_shift_sessions row that starts in/around the shift (same rule as the RPC)."""
    started = [r for r in rows if r.get("starts_at") and r.get("ends_at")]
    if not started:
        return set()
    users = sorted({str(r["user_id"]) for r in started})
    low = min(datetime.fromisoformat(str(r["starts_at"]).replace("Z", "+00:00")) for r in started) - timedelta(hours=6)
    high = max(datetime.fromisoformat(str(r["ends_at"]).replace("Z", "+00:00")) for r in started)
    sessions = _rows(
        supabase.table("hk_shift_sessions").select("user_id, started_at").eq("tenant_id", tenant_id)
        .in_("user_id", users).gte("started_at", low.isoformat()).lt("started_at", high.isoformat()).execute()
    )
    found: set[str] = set()
    for row in started:
        start = datetime.fromisoformat(str(row["starts_at"]).replace("Z", "+00:00"))
        end = datetime.fromisoformat(str(row["ends_at"]).replace("Z", "+00:00"))
        for s in sessions:
            began = datetime.fromisoformat(str(s["started_at"]).replace("Z", "+00:00"))
            if str(s["user_id"]) == str(row["user_id"]) and start - timedelta(hours=6) <= began < end:
                found.add(str(row["id"]))
    return found


# ---------------------------------------------------------------------------
# Publication
# ---------------------------------------------------------------------------

# database error code -> (HTTP status, API code, message)
PUBLISH_ERRORS: dict[str, tuple[int, str, str]] = {
    "SR001": (409, "revision_changed", "The draft changed after you reviewed it. Review it again before publishing."),
    "SR002": (409, "already_published", "This schedule was already published."),
    "SR003": (404, "revision_not_found", "Draft not found."),
    "SR004": (409, "revision_closed", "This draft was discarded or replaced."),
    "SR005": (409, "stale_shift", "A shift changed after this draft was made. Review the draft again."),
    "SR006": (409, "has_attendance", "A shift in this draft already has recorded attendance."),
    "SR007": (409, "historical_assignment_locked", "A change in this draft is dated in the past."),
    "SR008": (409, "coverage_commitment", "A shift in this draft has a call-out in progress. Resolve it first."),
    "SR009": (422, "nothing_to_publish", "There is nothing to publish."),
    "SR010": (409, "department_mismatch", "A change in this draft belongs to another department."),
    "TO001": (409, "approved_time_off", "Someone in this draft has approved time off during a shift."),
    "23P01": (409, "schedule_conflict", "Publishing would double-book someone. Review the draft again."),
    "23505": (409, "duplicate_assignment", "Someone would be scheduled twice on the same shift and date."),
}


def publish(tenant_id: str, revision_id: str, expected_version: int, actor_id: str, actor_role: str, key: str) -> dict:
    """Run the one-transaction publication. Returns the committed result (also on an idempotent replay)."""
    try:
        result = supabase.rpc("publish_schedule_revision", {
            "p_tenant_id": tenant_id, "p_revision_id": revision_id, "p_expected_version": expected_version,
            "p_actor": actor_id, "p_actor_role": actor_role, "p_idempotency_key": key,
        }).execute()
    except APIError as exc:
        code = getattr(exc, "code", None) or ""
        mapped = PUBLISH_ERRORS.get(code)
        if mapped is None and "overlap" in str(exc).lower():
            mapped = PUBLISH_ERRORS["23P01"]
        if mapped is None:
            raise
        extra: dict[str, Any] = {"database_code": code}
        detail = getattr(exc, "details", None)
        if code == "SR005" or code in ("SR006", "SR007", "SR008"):
            if isinstance(detail, str) and len(detail) == 36:
                extra["change_id"] = detail
        raise err(mapped[0], mapped[1], mapped[2], **extra)
    data = result.data
    return data if isinstance(data, dict) else (data[0] if data else {})

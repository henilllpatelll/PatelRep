"""Draft-versus-published schedule rules (Team Scheduling Phase 7). Pure functions, no database access.

THE MODEL. A supervisor stages shift changes in a REVISION; the live schedule (`shift_assignments`) is untouched until
`publish_schedule_revision()` (migration 228) applies the whole revision in one transaction. These functions are the
shared vocabulary of the router and the tests:

  * `stage_decision`   how a newly staged change combines with what the draft already holds for that shift, so a draft
                       never carries contradictory updates (one coherent proposed result per shift);
  * `build_review`     the publish review: counts, per-employee before/after, blocking errors, warnings;
  * `backoff_seconds`  retry delay for the notification outbox.

BLOCKING versus WARNING. A blocking item stops publication (the database would refuse it or it would break a
commitment); a warning is advice (rest, overtime, availability) the supervisor may accept. Whatever the review says,
publishing re-checks everything inside the database transaction: a review is advice, never a permit.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable, Literal, Mapping, Optional, Sequence

from services.scheduling import Occurrence, compute_warnings, find_conflicts

ChangeKind = Literal["create", "update", "cancel"]

# Fields of a staged shift that a person can see or compare.
SHIFT_FIELDS = ("user_id", "shift_id", "work_date", "start_time", "end_time", "notes")

# Outbox retry: delay after attempt 1..4. The 5th failed attempt is final (the database claim stops at 5 attempts;
# a manager may reset a row explicitly). Bounded and growing, so a provider outage cannot cause a retry storm.
BACKOFF_SECONDS = (60, 300, 1800, 7200)
MAX_ATTEMPTS = 5


def backoff_seconds(attempts: int) -> Optional[int]:
    """Seconds to wait before the next try after `attempts` failures; None = out of attempts."""
    if attempts >= MAX_ATTEMPTS:
        return None
    return BACKOFF_SECONDS[min(max(attempts, 1), len(BACKOFF_SECONDS)) - 1]


# ---------------------------------------------------------------------------
# Staging: combine a new change with what the draft already holds for the same shift
# ---------------------------------------------------------------------------

def _norm_time(value: Any) -> Optional[str]:
    return None if value is None else str(value)[:5]


def comparable(shift: Mapping[str, Any]) -> tuple:
    """A shift reduced to the fields a person would notice, for equality checks (HH:MM, ISO date, notes '' == None)."""
    return (
        str(shift.get("user_id") or ""), str(shift.get("shift_id") or ""), str(shift.get("work_date") or "")[:10],
        _norm_time(shift.get("start_time")), _norm_time(shift.get("end_time")), (shift.get("notes") or "") or None,
    )


@dataclass(frozen=True)
class StageDecision:
    action: Literal["insert", "replace", "delete", "noop"]
    kind: Optional[ChangeKind] = None


def stage_decision(*, existing: Optional[Mapping[str, Any]], incoming_kind: ChangeKind, live: Optional[Mapping[str, Any]],
                   proposed: Optional[Mapping[str, Any]]) -> StageDecision:
    """
    existing  the change the draft already holds for this shift (None = none yet)
    live      the live published shift this change targets (None for a brand-new shift)
    proposed  the full proposed result (None when cancelling)

    insert   store a new change          replace   overwrite the stored change with this one
    delete   drop the stored change      noop      nothing to store (the change would equal the live shift)
    """
    if incoming_kind == "create":
        return StageDecision("replace" if existing else "insert", "create")
    if existing and existing.get("kind") == "create":
        # Cancelling a shift that only exists in the draft just removes it from the draft.
        return StageDecision("delete") if incoming_kind == "cancel" else StageDecision("replace", "create")
    if incoming_kind == "cancel":
        return StageDecision("replace" if existing else "insert", "cancel")
    if live is not None and proposed is not None and comparable(live) == comparable(proposed):
        # Edited back to what is already published: the draft must not carry a pointless change.
        return StageDecision("delete" if existing else "noop")
    return StageDecision("replace" if existing else "insert", "update")


# ---------------------------------------------------------------------------
# The publish review
# ---------------------------------------------------------------------------

@dataclass
class Review:
    summary: dict
    date_range: Optional[dict]
    impact: list[dict]
    blocking: list[dict]
    warnings: list[dict]
    forecast: dict
    can_publish: bool

    def as_dict(self) -> dict:
        return {
            "summary": self.summary, "date_range": self.date_range, "impact": self.impact, "blocking": self.blocking,
            "warnings": self.warnings, "forecast": self.forecast, "can_publish": self.can_publish,
        }


# Phase 6 forecasts demand only for days that have already begun (a future day has no verified demand source), so a
# proposal for the future cannot honestly be given a projected staffing effect. Said out loud, never faked.
FORECAST_UNAVAILABLE = {
    "available": False,
    "reason": "future_demand_unknown",
}


def _occurrence(row: Mapping[str, Any], *, identifier: Optional[str]) -> Optional[Occurrence]:
    try:
        return Occurrence(
            str(row["user_id"]), str(row["shift_id"]), date.fromisoformat(str(row["work_date"])[:10]),
            datetime.fromisoformat(str(row["starts_at"]).replace("Z", "+00:00")),
            datetime.fromisoformat(str(row["ends_at"]).replace("Z", "+00:00")), identifier,
        )
    except (KeyError, ValueError, TypeError):
        return None


def _face(row: Optional[Mapping[str, Any]]) -> Optional[dict]:
    """What the employee would see of a shift: no notes, no reasons."""
    if not row:
        return None
    return {
        "user_id": str(row.get("user_id")), "shift_id": str(row.get("shift_id") or ""), "shift_name": row.get("shift_name"),
        "work_date": str(row.get("work_date"))[:10], "start_time": _norm_time(row.get("start_time")),
        "end_time": _norm_time(row.get("end_time")),
    }


def build_review(
    *,
    revision: Mapping[str, Any],
    changes: Sequence[Mapping[str, Any]],
    live: Mapping[str, Mapping[str, Any]],
    neighbors: Iterable[Mapping[str, Any]],
    today: date,
    names: Mapping[str, str],
    committed: Iterable[str] = (),
    leave_blocked: Optional[Mapping[str, Mapping[str, Any]]] = None,
    availability_warnings: Iterable[dict] = (),
    unknown_department_users: Iterable[str] = (),
    live_attendance: Iterable[str] = (),
) -> Review:
    """
    live             assignment_id -> the live row for every update / cancel (a missing id = the shift is gone)
    neighbors        every non-cancelled live shift of the affected employees around the draft's dates
    committed        assignment ids that carry a live call-out (cannot be edited until that is resolved)
    leave_blocked    change_id -> leave detail, for final shifts inside approved time off
    live_attendance  assignment ids whose attendance has begun
    """
    blocking: list[dict] = []
    impact: dict[str, list[dict]] = {}
    proposed: list[Occurrence] = []
    targeted: set[str] = set()
    committed_set, attendance_set = set(committed), set(live_attendance)
    leave = dict(leave_blocked or {})
    counts = {"new": 0, "modified": 0, "cancelled": 0, "reassigned": 0}
    dates: list[str] = []

    def block(code: str, change: Mapping[str, Any], detail: str, **extra: Any) -> None:
        blocking.append({"code": code, "change_id": str(change["id"]), "assignment_id": str(change["assignment_id"]) if change.get("assignment_id") else None,
                         "detail": detail, **extra})

    def add_item(user_id: str, item: dict) -> None:
        impact.setdefault(user_id, []).append(item)

    for change in changes:
        kind = change["kind"]
        proposal = change.get("proposed") or {}
        assignment_id = str(change["assignment_id"]) if change.get("assignment_id") else None
        current = live.get(assignment_id) if assignment_id else None
        reason = change.get("reason")
        if str(change.get("department_id")) != str(revision.get("department_id")):
            block("department_mismatch", change, "This change belongs to another department.")
            continue

        if kind in ("update", "cancel"):
            targeted.add(assignment_id or "")
            if current is None or current.get("publication_state") == "cancelled":
                block("stale_shift", change, "This shift no longer exists in the published schedule.")
                continue
            if int(current.get("version", 1)) != int(change.get("base_version") or 0):
                block("stale_shift", change, "This shift was changed by someone else after the draft was made.",
                      current=_face(current), current_version=current.get("version"))
                continue
            if assignment_id in attendance_set or current.get("clocked_in_at") or current.get("is_on_shift"):
                block("has_attendance", change, "This shift already has recorded attendance and cannot be changed.")
                continue
            if date.fromisoformat(str(current["work_date"])[:10]) < today:
                block("past_date", change, "Past shifts cannot be changed.")
                continue
            if assignment_id in committed_set:
                block("coverage_commitment", change, "A call-out or coverage request is open for this shift. Resolve it first.")
                continue

        if kind == "cancel":
            counts["cancelled"] += 1
            dates.append(str(current["work_date"])[:10])
            add_item(str(current["user_id"]), {
                "kind": "cancelled", "change_id": str(change["id"]), "assignment_id": assignment_id,
                "work_date": str(current["work_date"])[:10], "before": _face(current), "after": None, "reason": reason})
            continue

        # create / update: the final shift must be valid.
        if date.fromisoformat(str(proposal.get("work_date"))[:10]) < today:
            block("past_date", change, "A shift cannot be scheduled in the past.")
            continue
        occurrence = _occurrence(proposal, identifier=assignment_id)
        if occurrence is None:
            block("invalid_time", change, "The shift times are not valid.")
            continue
        proposed.append(occurrence)
        if str(change["id"]) in leave:
            block("approved_time_off", change, "That person has approved time off during this shift.", leave=leave[str(change["id"])])
        dates.append(str(proposal["work_date"])[:10])
        if kind == "create":
            counts["new"] += 1
            add_item(str(proposal["user_id"]), {
                "kind": "added", "change_id": str(change["id"]), "assignment_id": None, "work_date": str(proposal["work_date"])[:10],
                "before": None, "after": _face(proposal), "reason": reason})
            continue
        previous_user = str(current["user_id"])
        if str(proposal["user_id"]) != previous_user:
            counts["reassigned"] += 1
            add_item(previous_user, {
                "kind": "removed", "change_id": str(change["id"]), "assignment_id": assignment_id,
                "work_date": str(current["work_date"])[:10], "before": _face(current), "after": None, "reason": reason})
            add_item(str(proposal["user_id"]), {
                "kind": "added", "change_id": str(change["id"]), "assignment_id": assignment_id,
                "work_date": str(proposal["work_date"])[:10], "before": None, "after": _face(proposal), "reason": reason})
        else:
            counts["modified"] += 1
            add_item(previous_user, {
                "kind": "changed", "change_id": str(change["id"]), "assignment_id": assignment_id,
                "work_date": str(proposal["work_date"])[:10], "before": _face(current), "after": _face(proposal), "reason": reason})

    # Overlaps and duplicates across the FINAL schedule: untouched live shifts + everything proposed.
    remaining = [
        o for o in (_occurrence(row, identifier=str(row.get("id"))) for row in neighbors)
        if o is not None and o.id not in targeted
    ]
    by_user_date = {c["id"]: c for c in changes}
    for conflict in find_conflicts(proposed, remaining):
        match = next((c for c in changes if c.get("proposed") and str(c["proposed"].get("user_id")) == conflict.user_id
                      and str(c["proposed"].get("work_date"))[:10] == conflict.work_date.isoformat()), None)
        entry = {"code": conflict.code, "change_id": str(match["id"]) if match else None, "user_id": conflict.user_id,
                 "work_date": conflict.work_date.isoformat(), "with_assignment_id": conflict.with_assignment_id,
                 "detail": "This person is already scheduled on that shift and date." if conflict.code == "duplicate_assignment"
                 else "This overlaps another shift for the same person."}
        if match is not None:
            entry["assignment_id"] = str(match["assignment_id"]) if match.get("assignment_id") else None
        blocking.append(entry)
    del by_user_date

    # Duplicate (person, shift, date) against untouched live rows (the database has a unique constraint on it).
    taken = {(o.user_id, o.shift_id, o.work_date) for o in remaining}
    for change in changes:
        proposal = change.get("proposed") or {}
        if change["kind"] == "cancel" or not proposal:
            continue
        key = (str(proposal.get("user_id")), str(proposal.get("shift_id")), date.fromisoformat(str(proposal["work_date"])[:10]))
        if key in taken and not any(b["code"] == "duplicate_assignment" and b.get("change_id") == str(change["id"]) for b in blocking):
            block("duplicate_assignment", change, "This person is already scheduled on that shift and date.",
                  user_id=key[0], work_date=key[2].isoformat())

    warnings = [w.as_dict() for w in compute_warnings(proposed, remaining, hotel_today=today, unknown_department_users=unknown_department_users)
                if w.code != "past_date"]
    block_policy = [w for w in warnings if w.get("severity") == "block"]
    for item in block_policy:
        blocking.append({"code": "schedule_policy_blocked", "change_id": None, "assignment_id": None, "detail": item["detail"],
                         "user_id": item["user_id"], "work_date": item["work_date"]})
    warnings = [w for w in warnings if w.get("severity") != "block"]
    warnings.extend(dict(w) for w in availability_warnings)

    people = [
        {"user_id": user_id, "name": names.get(user_id) or "", "items": sorted(items, key=lambda i: (i["work_date"], i["kind"]))}
        for user_id, items in impact.items()
    ]
    people.sort(key=lambda p: (p["name"].lower(), p["user_id"]))
    summary = {**counts, "employees_affected": len(people), "total_changes": len(changes)}
    date_range = {"from": min(dates), "to": max(dates)} if dates else None
    return Review(summary, date_range, people, blocking, warnings, dict(FORECAST_UNAVAILABLE),
                  can_publish=bool(changes) and not blocking)

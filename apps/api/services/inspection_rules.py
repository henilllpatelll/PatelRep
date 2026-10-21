"""Inspection business rules: one authoritative, I/O-free implementation.

Used by ``POST /housekeeping/inspections/complete``, the inspection detail /
correction read-model and the ready-for-inspection queue. The mobile app mirrors
the *decisions* of these rules in ``apps/mobile/lib/inspections`` for instant
feedback; ``tests/fixtures/inspection_rules.json`` is a conformance table that
both implementations are tested against, so the two cannot drift silently. The
server is always the authority: a client check is a convenience, never a gate.

Nothing in this module reads or writes the database.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Optional

ANSWERS = ("pass", "fail", "na")
SEVERITIES = ("minor", "major")

# A failure is a "touch-up" only when every failed item is explicitly minor AND
# there are at most this many. Anything else (a major item, an unclassified item,
# or a long list) is a full re-clean. Both block the room until a passing
# reinspection - neither releases it.
TOUCH_UP_MAX_ITEMS = 3

# Property policy for N/A on a REQUIRED item, in addition to the per-item
# ``allows_na`` flag (which always wins when false).
#   allow        - N/A is a valid answer (today's behaviour and the default)
#   require_note - N/A needs an explanation in the item note
#   forbid       - required items must be pass or fail
NA_POLICIES = ("allow", "require_note", "forbid")
DEFAULT_REQUIRED_ITEM_NA_POLICY = "allow"

CORRECTION_KINDS = ("touch_up", "reclean")


class RuleViolation(Exception):
    """A rule the submission breaks. Carries a stable machine code for clients."""

    def __init__(self, code: str, message: str, status_code: int = 422, **extra: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.extra = extra

    def detail(self) -> dict:
        return {"code": self.code, "message": self.message, **self.extra}


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

def sort_template_items(items: Iterable[Mapping[str, Any]]) -> list[dict]:
    """Configured order: ``sort_order`` ascending, ties broken by id so the order is stable."""
    return sorted((dict(i) for i in items), key=lambda i: (int(i.get("sort_order") or 0), str(i.get("id") or "")))


def template_fingerprint(template: Mapping[str, Any], items: Iterable[Mapping[str, Any]]) -> str:
    """Opaque digest of the checklist a supervisor is working from.

    Covers the template id and, per item in configured order, everything that
    changes what has to be answered: id, section, wording, required, photo-on-fail,
    N/A policy and sort position. Editing a template replaces its item rows, so
    even a same-id template whose items were touched produces a different digest.
    """
    canonical = {
        "template": str(template.get("id")),
        "items": [
            [
                str(i.get("id")),
                i.get("section") or "",
                i.get("description") or "",
                bool(i.get("is_required", True)),
                bool(i.get("requires_photo_on_fail", False)),
                bool(i.get("allows_na", True)),
                int(i.get("sort_order") or 0),
            ]
            for i in sort_template_items(items)
        ],
    }
    digest = hashlib.sha256(json.dumps(canonical, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    return digest.hexdigest()[:32]


def template_applies_to_room(template: Mapping[str, Any], room_type_id: Optional[str]) -> bool:
    """A template may inspect a room when it is the property default, is not tied to a
    room type, or is tied to this room's own type. Never when it belongs to another type."""
    template_type = template.get("room_type_id")
    if template_type is None or template.get("is_default"):
        return True
    return room_type_id is not None and str(template_type) == str(room_type_id)


# ---------------------------------------------------------------------------
# Answers -> outcome
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ValidatedInspection:
    result: str  # "passed" | "failed"
    failed_item_ids: frozenset[str]
    correction_kind: Optional[str]
    answers: dict[str, dict] = field(default_factory=dict)


def derive_overall_result(answers: Mapping[str, Any]) -> str:
    """``failed`` if any recorded answer is a fail, otherwise ``passed``. Callers must have
    already confirmed every required item is answered - this never turns "unanswered" into a pass."""
    return "failed" if any((a.get("result") if isinstance(a, Mapping) else a) == "fail" for a in answers.values()) else "passed"


def classify_failure(failed_severities: Iterable[Optional[str]]) -> Optional[str]:
    """``None`` when nothing failed, ``touch_up`` for a short all-minor list, otherwise ``reclean``."""
    severities = list(failed_severities)
    if not severities:
        return None
    if len(severities) <= TOUCH_UP_MAX_ITEMS and all(s == "minor" for s in severities):
        return "touch_up"
    return "reclean"


def validate_answers(
    template_items: list[Mapping[str, Any]],
    submitted: Iterable[Mapping[str, Any]],
    *,
    claimed_result: str,
    required_item_na_policy: str = DEFAULT_REQUIRED_ITEM_NA_POLICY,
) -> ValidatedInspection:
    """Validate a completed checklist against its template and derive the outcome.

    ``submitted`` rows carry ``template_item_id``, ``result`` (pass|fail|na), optional ``note`` and
    ``severity``. Raises :class:`RuleViolation` on the first broken rule.
    """
    if not template_items:
        raise RuleViolation("no_checklist", "No inspection checklist is configured for this room")
    if required_item_na_policy not in NA_POLICIES:
        required_item_na_policy = DEFAULT_REQUIRED_ITEM_NA_POLICY

    by_item = {str(i["id"]): i for i in template_items}
    answers: dict[str, dict] = {}
    for row in submitted:
        item_id = row.get("template_item_id")
        if not item_id:
            # Dropping an id-less answer would let a "fail" vanish and a pass go through.
            raise RuleViolation("item_missing_id", "Every checklist answer must reference a checklist item")
        item_id = str(item_id)
        if item_id not in by_item:
            raise RuleViolation("item_outside_checklist", "Inspection includes an item outside this checklist")
        if item_id in answers:
            raise RuleViolation("duplicate_item_answer", "A checklist item was answered more than once")
        result = row.get("result")
        if result not in ANSWERS:
            raise RuleViolation("invalid_answer", "Checklist answers must be pass, fail or N/A")
        severity = row.get("severity")
        if severity is not None and severity not in SEVERITIES:
            raise RuleViolation("invalid_severity", "Severity must be minor or major")
        if severity is not None and result != "fail":
            raise RuleViolation("severity_on_non_failed_item", "Severity can only be set on a failed item")
        answers[item_id] = {"result": result, "note": (row.get("note") or "").strip() or None, "severity": severity}

    missing = [i["id"] for i in template_items if i.get("is_required", True) and str(i["id"]) not in answers]
    if missing:
        raise RuleViolation("required_items_unanswered", f"{len(missing)} required items still need review.", missing_item_ids=[str(m) for m in missing])

    if not answers:
        # A checklist whose items are all optional must still be reviewed: zero answers is not evidence of a pass.
        raise RuleViolation("no_answers", "Review at least one checklist item before completing the inspection")

    for item_id, answer in answers.items():
        if answer["result"] != "na":
            continue
        item = by_item[item_id]
        if not item.get("allows_na", True):
            raise RuleViolation("na_not_allowed", "N/A is not allowed for this checklist item", item_id=item_id)
        if item.get("is_required", True):
            if required_item_na_policy == "forbid":
                raise RuleViolation("na_not_allowed", "N/A is not allowed for required checklist items", item_id=item_id)
            if required_item_na_policy == "require_note" and not answer["note"]:
                raise RuleViolation("na_note_required", "Explain why this required item is not applicable", item_id=item_id)

    derived = derive_overall_result(answers)
    if claimed_result != derived:
        raise RuleViolation("result_mismatch", "Inspection result must match checklist results")

    failed_ids = frozenset(i for i, a in answers.items() if a["result"] == "fail")
    kind = classify_failure(answers[i]["severity"] for i in failed_ids)
    return ValidatedInspection(result=derived, failed_item_ids=failed_ids, correction_kind=kind, answers=answers)


def validate_photo_links(
    template_items: list[Mapping[str, Any]],
    failed_item_ids: Iterable[str],
    photo_item_ids: list[str],
    photo_count: int,
) -> None:
    """Photos map one-to-one onto failed items, and every ``requires_photo_on_fail`` failure has one."""
    if len(photo_item_ids) != photo_count or len(set(photo_item_ids)) != len(photo_item_ids):
        raise RuleViolation("photo_link_invalid", "Each inspection photo must be linked to one checklist item")
    failed = set(failed_item_ids)
    required = {str(i["id"]) for i in template_items if i.get("requires_photo_on_fail") and str(i["id"]) in failed}
    attached = set(photo_item_ids)
    if not required.issubset(attached):
        raise RuleViolation(
            "required_photos_missing",
            "Required failed-item photos must finish uploading before submission",
            missing_item_ids=sorted(required - attached),
        )
    if not attached.issubset(failed):
        raise RuleViolation("photo_on_non_failed_item", "Inspection photos can only be attached to failed items")


# ---------------------------------------------------------------------------
# Correction lifecycle (read model)
# ---------------------------------------------------------------------------

CORRECTION_STATUSES = (
    "correction_missing",  # failed, but no correction task exists (creation failed) - needs repair
    "unassigned",          # task exists, nobody owns it
    "assigned",            # an owner is set; this does NOT mean they have seen or acknowledged it
    "in_progress",         # the owner started working (task started / in progress)
    "escalated",           # the task was escalated by the SLA ladder
    "resubmitted",         # corrected work was resubmitted; awaiting supervisor reinspection
    "verified",            # a later passing inspection verified the room
    "superseded",          # a newer failed inspection took over
    "cancelled",           # the correction task was cancelled without a passing reinspection
)


def derive_correction_status(
    inspection: Mapping[str, Any],
    task: Optional[Mapping[str, Any]],
    room_status: Optional[Mapping[str, Any]],
    followups: Iterable[Mapping[str, Any]],
) -> Optional[dict]:
    """Where a failed inspection's correction stands, from persisted facts only.

    ``followups`` are the room's inspections completed after ``inspection``. Returns ``None`` for
    inspections that did not need correcting (passes, and historical ``conditional`` rows, which released the room
    and never created a correction). ``reinspection_id`` is the verifying/superseding inspection when there is one.
    """
    result = inspection.get("overall_result")
    # Historical `conditional` rows released the room and never owned a correction. Since migration 219 a conditional
    # (touch-up) blocks the room and records its kind, so one with a kind - or a task - has a correction to report.
    correctable = result == "failed" or (result == "conditional" and (inspection.get("correction_kind") or task is not None))
    if not correctable:
        return None

    ordered = sorted(followups, key=lambda f: str(f.get("completed_at") or ""))
    linked = [f for f in ordered if f.get("reinspection_of") == inspection.get("id")]
    # Rows from before the link existed carry no reinspection_of; any later inspection supersedes by time.
    candidates = linked or [f for f in ordered if not f.get("reinspection_of")]
    if candidates:
        last = candidates[-1]
        if last.get("overall_result") == "passed":
            return {"status": "verified", "reinspection_id": last.get("id")}
        if last.get("overall_result") == "failed":
            return {"status": "superseded", "reinspection_id": last.get("id")}

    if task is None:
        return {"status": "correction_missing", "reinspection_id": None}
    task_status = task.get("status")
    if task_status == "cancelled":
        return {"status": "cancelled", "reinspection_id": None}
    if task_status == "completed" or (room_status or {}).get("status") == "CLEAN":
        return {"status": "resubmitted", "reinspection_id": None}
    if task_status == "escalated":
        return {"status": "escalated", "reinspection_id": None}
    if task_status == "in_progress" or task.get("started_at"):
        return {"status": "in_progress", "reinspection_id": None}
    return {"status": "assigned" if task.get("assigned_to") else "unassigned", "reinspection_id": None}


def correction_task_fields(kind: str, room_number: str, failed_labels: list[str], notes: Optional[str]) -> dict:
    """Title / description / SLA for the correction task of a failed inspection."""
    verb = "Touch-up" if kind == "touch_up" else "Re-clean"
    lines = [f"- {label}" for label in failed_labels]
    lead = "Touch-up needed after inspection." if kind == "touch_up" else "Inspection failed."
    description = lead + (f" {notes.strip()}" if notes and notes.strip() else "")
    if lines:
        description += "\nFix:\n" + "\n".join(lines)
    return {
        "title": f"{verb} Room {room_number}",
        "description": description,
        "sla_minutes": 30 if kind == "touch_up" else 60,
    }

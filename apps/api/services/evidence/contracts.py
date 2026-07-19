"""Pure policy helpers for the controlled-evidence platform."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any


FACILITY_OPTIONS = ("pool", "spa", "elevator", "boiler", "cooling_tower")
SERVICE_OPTIONS = ("breakfast",)
BRAND_REQUIREMENT_OPTIONS = ("brand_standard", "brand_safety", "brand_training")
CANONICAL_APPLICABILITY_VALUES = frozenset(
    (*FACILITY_OPTIONS, *SERVICE_OPTIONS, *BRAND_REQUIREMENT_OPTIONS)
)


def validate_applicability_values(values: list[str], *, allowed_values: tuple[str, ...]) -> list[str]:
    """Reject unknown or repeated property applicability values at the API boundary."""
    unknown = sorted(set(values).difference(allowed_values))
    if unknown:
        raise ValueError(f"unsupported property applicability value(s): {', '.join(unknown)}")
    if len(values) != len(set(values)):
        raise ValueError("property applicability values must be unique")
    return values


def is_applicable_to_property(
    document_applicability: list[str] | None,
    property_applicability: dict[str, Any] | None,
) -> bool:
    """Return whether a controlled obligation applies to this hotel's configured property."""
    required = set(document_applicability or [])
    if not required:
        return True
    property_applicability = property_applicability or {}
    configured = set(property_applicability.get("facilities") or [])
    configured.update(property_applicability.get("services") or [])
    configured.update(property_applicability.get("brand_requirements") or [])
    return required.issubset(configured)


def _as_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def _as_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def create_superseding_version(previous: dict[str, Any], *, actor_id: str) -> dict[str, Any]:
    """Return the new draft row while leaving the approved record immutable."""
    if previous.get("approval_state") != "approved":
        raise ValueError("Only an approved document can be superseded.")

    successor = {
        "title": previous["title"],
        "version_number": int(previous.get("version_number") or 0) + 1,
        "approval_state": "draft",
        "supersedes_id": previous["id"],
        "created_by": actor_id,
    }
    for field in (
        "document_type",
        "owner_id",
        "effective_date",
        "review_date",
        "expiration_date",
        "applicability",
        "retention_class",
        "source_sop_document_id",
    ):
        successor[field] = previous.get(field)
    return successor


def build_retraining_assignments(
    assignments: list[dict[str, Any]],
    *,
    successor_document_id: str,
    due_date: str,
    assigned_by: str,
) -> list[dict[str, Any]]:
    """Copy only competency-required staff into retraining for an approved successor."""
    return [
        {
            "document_id": successor_document_id,
            "assigned_to": assignment["assigned_to"],
            "assigned_by": assigned_by,
            "due_date": due_date,
            "competency_required": True,
            "competency_status": "pending",
            "assignment_type": "retraining",
            "retraining_from_assignment_id": assignment["id"],
        }
        for assignment in assignments
        if assignment.get("competency_required")
    ]


def build_exception_queue(
    *,
    documents: list[dict[str, Any]],
    assignments: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
    now: datetime,
) -> list[dict[str, str]]:
    """Derive inspector-facing exceptions without mutating controlled records."""
    today = now.date()
    exceptions: list[dict[str, str]] = []

    for document in documents:
        expiration = _as_date(document.get("expiration_date"))
        if document.get("approval_state") == "approved" and expiration and expiration < today:
            exceptions.append({
                "state": "expired",
                "kind": "document",
                "reference_id": document["id"],
                "label": document["title"],
            })

    for assignment in assignments:
        due_date = _as_date(assignment.get("due_date"))
        if not assignment.get("acknowledged_at") and due_date and due_date < today:
            exceptions.append({
                "state": "overdue",
                "kind": "acknowledgement",
                "reference_id": assignment["id"],
                "label": assignment.get("document_title") or "Controlled document acknowledgement",
            })
        elif not assignment.get("acknowledged_at"):
            exceptions.append({
                "state": "unacknowledged",
                "kind": "acknowledgement",
                "reference_id": assignment["id"],
                "label": assignment.get("document_title") or "Controlled document acknowledgement",
            })

    for record in evidence:
        expires_at = _as_datetime(record.get("expires_at"))
        required_by = _as_datetime(record.get("required_by"))
        if record.get("result") == "failed":
            exceptions.append({"state": "failed", "kind": "evidence", "reference_id": record["id"], "label": record["label"]})
        elif record.get("result") == "deferred":
            exceptions.append({"state": "deferred", "kind": "evidence", "reference_id": record["id"], "label": record["label"]})
        elif expires_at and expires_at < now:
            exceptions.append({
                "state": "expired",
                "kind": "evidence",
                "reference_id": record["id"],
                "label": record["label"],
            })
        elif required_by and required_by < now and not record.get("collected_at"):
            exceptions.append({
                "state": "missing",
                "kind": "evidence",
                "reference_id": record["id"],
                "label": record["label"],
            })

    return exceptions


def build_reminder_actions(
    assignments: list[dict[str, Any]], *, now: datetime
) -> list[dict[str, str]]:
    """Schedule individual nudges and GM escalation for still-unacknowledged work."""
    today = now.date()
    actions: list[dict[str, str]] = []

    for assignment in assignments:
        if assignment.get("acknowledged_at"):
            continue
        due_date = _as_date(assignment.get("due_date"))
        if not due_date:
            continue
        if due_date < today:
            actions.extend([
                {
                    "assignment_id": assignment["id"],
                    "recipient_type": "staff",
                    "recipient_id": assignment["assigned_to"],
                    "state": "overdue",
                },
                {
                    "assignment_id": assignment["id"],
                    "recipient_type": "role",
                    "recipient_role": "gm",
                    "state": "overdue",
                },
            ])
        elif due_date == today + date.resolution:
            actions.append({
                "assignment_id": assignment["id"],
                "recipient_type": "staff",
                "recipient_id": assignment["assigned_to"],
                "state": "due_soon",
            })

    return actions

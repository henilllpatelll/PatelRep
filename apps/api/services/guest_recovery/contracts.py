"""Pure Phase 5 guest recovery, custody, and ROI policy contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Any


class InvalidGuestRequestTransition(ValueError):
    """Raised when a request skips a required service milestone."""


class AccessibilityPriorityError(ValueError):
    """Raised when accessibility work is not treated as urgent."""


class MissingCustodyVerificationError(ValueError):
    """Raised when an item release has no identity-verification evidence."""


GUEST_REQUEST_STATUSES = (
    "open",
    "acknowledged",
    "dispatched",
    "arrived",
    "guest_contacted",
    "resolved",
    "verified",
    "reopened",
    "cancelled",
)

_ALLOWED_TRANSITIONS = {
    "open": {"acknowledged", "cancelled"},
    "acknowledged": {"dispatched", "cancelled"},
    "dispatched": {"arrived", "resolved", "cancelled"},
    "arrived": {"guest_contacted", "resolved", "cancelled"},
    "guest_contacted": {"resolved", "cancelled"},
    "resolved": {"verified", "reopened"},
    "verified": {"reopened"},
    "reopened": {"acknowledged", "cancelled"},
    "cancelled": set(),
}


def resolve_sla_minutes(
    policies: list[dict[str, Any]], *, category: str, priority: str, guest_impact: str
) -> int:
    """Choose the most specific matching tenant SLA policy, defaulting to four hours."""
    candidates = [
        policy for policy in policies
        if all(
            policy.get(field) in (None, value)
            for field, value in (("category", category), ("priority", priority), ("guest_impact", guest_impact))
        )
    ]
    if not candidates:
        return 240
    candidates.sort(
        key=lambda policy: sum(policy.get(field) is not None for field in ("category", "priority", "guest_impact")),
        reverse=True,
    )
    return int(candidates[0]["sla_minutes"])


def validate_guest_request_transition(
    *, current_status: str, next_status: str, category: str, priority: str
) -> None:
    if category == "accessibility" and priority != "urgent":
        raise AccessibilityPriorityError("Accessibility-related requests must use urgent priority")
    if next_status not in _ALLOWED_TRANSITIONS.get(current_status, set()):
        raise InvalidGuestRequestTransition(
            f"Cannot transition guest request from {current_status} to {next_status}"
        )


def validate_lost_found_custody_event(
    *, event_type: str, verification_method: str | None, recipient_name: str | None
) -> None:
    if event_type == "released" and (not verification_method or not recipient_name):
        raise MissingCustodyVerificationError(
            "Identity verification method and recipient name are required before release"
        )


def calculate_guest_request_metrics(requests: list[dict[str, Any]]) -> dict[str, float | int]:
    """Return deterministic, fixture-reconcilable guest recovery metrics."""
    total_requests = len(requests)
    if not total_requests:
        return {
            "total_requests": 0,
            "verified_resolution_rate_pct": 0.0,
            "sla_met_rate_pct": 0.0,
            "average_acknowledgement_minutes": 0.0,
            "average_verified_resolution_minutes": 0.0,
        }

    acknowledgement_minutes: list[float] = []
    verified_resolution_minutes: list[float] = []
    sla_met = 0
    verified = 0
    for request in requests:
        created_at = _parse_timestamp(request.get("created_at"))
        acknowledged_at = _parse_timestamp(request.get("acknowledged_at"))
        verified_at = _parse_timestamp(request.get("verified_at"))
        due_at = _parse_timestamp(request.get("due_at"))
        if created_at and acknowledged_at:
            acknowledgement_minutes.append((acknowledged_at - created_at).total_seconds() / 60)
        if request.get("status") == "verified" and verified_at:
            verified += 1
            if created_at:
                verified_resolution_minutes.append((verified_at - created_at).total_seconds() / 60)
            if due_at and verified_at <= due_at:
                sla_met += 1

    return {
        "total_requests": total_requests,
        "verified_resolution_rate_pct": round(verified / total_requests * 100, 1),
        "sla_met_rate_pct": round(sla_met / total_requests * 100, 1),
        "average_acknowledgement_minutes": _average(acknowledgement_minutes),
        "average_verified_resolution_minutes": _average(verified_resolution_minutes),
    }


def _parse_timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _average(values: list[float]) -> float:
    return round(sum(values) / len(values), 1) if values else 0.0

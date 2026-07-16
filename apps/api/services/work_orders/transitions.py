"""Canonical work-order status and escalation transition rules."""

from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException

WorkOrderStatus = Literal[
    "open", "escalated", "in_progress", "on_hold", "completed", "cancelled"
]
WorkOrderPriority = Literal["emergency", "urgent", "normal", "low"]

WORK_ORDER_STATUSES: tuple[WorkOrderStatus, ...] = (
    "open",
    "escalated",
    "in_progress",
    "on_hold",
    "completed",
    "cancelled",
)
WORK_ORDER_PRIORITIES: tuple[WorkOrderPriority, ...] = (
    "emergency",
    "urgent",
    "normal",
    "low",
)

_ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "open": frozenset({"in_progress", "escalated", "cancelled"}),
    "escalated": frozenset({"in_progress", "on_hold", "cancelled"}),
    "in_progress": frozenset({"on_hold", "completed", "escalated", "cancelled"}),
    "on_hold": frozenset({"in_progress", "escalated", "cancelled"}),
    "completed": frozenset({"open"}),
    "cancelled": frozenset({"open"}),
}

_REASONS_BY_TARGET: dict[str, frozenset[str]] = {
    "on_hold": frozenset({"awaiting_parts", "awaiting_vendor", "schedule_deferral", "safety_review"}),
    "cancelled": frozenset({"duplicate", "no_longer_needed", "safety_review"}),
    "open": frozenset({"reopened_after_failure", "reopened_on_request"}),
}
# Migration 064 intentionally merged chief_engineer into engineer.  Engineers
# therefore retain the operational authority previously held by that role.
_MANAGEMENT_ROLES = frozenset({"gm", "engineer"})


@dataclass(frozen=True)
class TransitionRequest:
    status: WorkOrderStatus
    reason_code: str | None = None
    reason_note: str | None = None
    override: bool = False


@dataclass(frozen=True)
class TransitionDecision:
    status: WorkOrderStatus
    reason_code: str | None
    reason_note: str | None
    is_override: bool
    requires_escalation_notification: bool


def validate_work_order_transition(
    *, current_status: str, request: TransitionRequest, actor_role: str
) -> TransitionDecision:
    """Validate one explicit work-order state change without mutating data."""
    if current_status not in WORK_ORDER_STATUSES:
        raise HTTPException(status_code=409, detail="Work order has an unsupported current status")

    if request.status not in WORK_ORDER_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported work order status")

    is_allowed = request.status in _ALLOWED_TRANSITIONS[current_status]
    if not is_allowed and not request.override:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot transition a work order from {current_status} to {request.status}",
        )

    if request.override:
        if actor_role not in _MANAGEMENT_ROLES:
            raise HTTPException(status_code=403, detail="Only management can override work-order transitions")
        if request.reason_code != "manager_override" or not request.reason_note:
            raise HTTPException(
                status_code=422,
                detail="Overrides require the manager_override reason and an explanatory note",
            )
    else:
        allowed_reasons = _REASONS_BY_TARGET.get(request.status)
        if allowed_reasons:
            if request.reason_code not in allowed_reasons:
                raise HTTPException(
                    status_code=422,
                    detail=f"Transition to {request.status} requires a structured reason",
                )

    return TransitionDecision(
        status=request.status,
        reason_code=request.reason_code,
        reason_note=request.reason_note,
        is_override=request.override,
        requires_escalation_notification=request.status == "escalated",
    )

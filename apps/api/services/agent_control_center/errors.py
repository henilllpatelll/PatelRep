"""Stable reason codes for the Control Center API. Clients branch on ``detail.code``, never on prose."""
from __future__ import annotations


class ControlCenterRefused(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


_STATUS = {
    "unauthenticated": 401,
    "not_found": 404, "feature_disabled": 404,
    "not_a_member": 403, "inactive_member": 403, "stale_role": 403, "not_authorized": 403,
    "ambiguous_membership": 403, "tenant_mismatch": 403, "unknown_role": 403, "identity_unverified": 403,
    "approver_not_authorized": 403, "self_approval_forbidden": 403, "actor_not_authorized": 403,
    "not_initiator": 403, "operator_pause_locked": 403, "gateway_disabled": 409,
    "invalid_request": 422, "invalid_reason_code": 422, "invalid_cursor": 422, "tool_not_allowed": 422,
    "schema_unavailable": 503,
}

# Refusals that are about authority, tenancy or a stale view of the world: recorded in the governance journal.
SECURITY_REFUSALS = frozenset({
    "not_found", "not_authorized", "approver_not_authorized", "self_approval_forbidden", "actor_not_authorized",
    "not_initiator", "operator_pause_locked", "stale_role", "inactive_member", "ambiguous_membership",
    "not_pending", "approval_expired", "gateway_disabled",
})


def http_status(code: str) -> int:
    return _STATUS.get(code, 409)  # state conflicts (expired, already decided, stale resource, ...) are 409

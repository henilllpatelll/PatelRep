"""Human approval interface (internal; the future AI Control Center / approval inbox calls these).

Every function requires a verified ``CurrentUser`` -- the object ``get_current_user`` builds from a verified JWT. The
hotel is the user's hotel (another hotel's approval id is simply ``not_found``), and the database re-reads the
person's CURRENT active role before recording a decision, so a role copied into a request, a stale JWT claim or the
service-role credential the API uses can never count as a human approval. There is deliberately no CLI or operator
path that approves: an operator can only expire approvals (``expire_due``) or pause execution.

Approval semantics (enforced in migrations 241/243): bound to one invocation and its action digest, initiator, agent
version and tool version; time-limited; revocable until consumed; consumed at most once by the fenced execution RPC;
under the independent-manager policy the initiator can never approve their own request.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from middleware.auth import CurrentUser
from services.agent_gateway.catalog import DB_ALLOWLIST
from services.agent_gateway.errors import GatewayRefused
from services.agent_gateway.store import GatewayStore

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_REASON_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
# Anyone who could ever approve any H2 tool. Visibility only; the database decides authority per approval.
_APPROVER_ROLES = frozenset(role for spec in DB_ALLOWLIST.values() if spec["access"] == "write" for role in spec["roles"])


def _user(user: Any) -> CurrentUser:
    if not isinstance(user, CurrentUser) or not user.hotel_id or not user.user_id:
        raise GatewayRefused("unauthenticated")
    return user


def _approval_id(value: object) -> str:
    if not isinstance(value, str) or not _UUID_RE.match(value):
        raise GatewayRefused("not_found")
    return value.lower()


def _reason(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str) or not _REASON_RE.match(value):
        raise GatewayRefused("invalid_reason_code")
    return value


def _visible(user: CurrentUser, approval: dict) -> bool:
    return user.role in approval.get("required_approver_roles", []) or approval.get("initiated_by_user_id") == user.user_id


def list_pending(store: GatewayStore, user: CurrentUser, *, limit: int = 50) -> list[dict]:
    """Pending approvals the caller could act on (approver roles) or initiated themselves."""
    user = _user(user)
    rows = store.approvals_list(tenant_id=user.hotel_id, state="requested", limit=max(1, min(limit, 200)))
    return [row for row in rows if _visible(user, row)]


def get_approval(store: GatewayStore, user: CurrentUser, approval_id: str) -> dict:
    user = _user(user)
    found = store.approval_get(tenant_id=user.hotel_id, approval_id=_approval_id(approval_id))
    if not found or not _visible(user, found):
        raise GatewayRefused("not_found")
    return found


def _decide(store: GatewayStore, user: CurrentUser, approval_id: str, decision: str, reason: Optional[str]) -> dict:
    user = _user(user)
    if user.role not in _APPROVER_ROLES:
        raise GatewayRefused("approver_not_authorized")  # cheap early refusal; the database is the authority
    result = store.approval_decide(tenant_id=user.hotel_id, approval_id=_approval_id(approval_id),
                                   actor_user_id=user.user_id, decision=decision, reason_code=_reason(reason))
    if not result.get("ok"):
        raise GatewayRefused(str(result.get("reason") or "decision_refused"))
    return result


def approve(store: GatewayStore, user: CurrentUser, approval_id: str, *, reason_code: Optional[str] = None) -> dict:
    return _decide(store, user, approval_id, "approve", reason_code)


def reject(store: GatewayStore, user: CurrentUser, approval_id: str, *, reason_code: Optional[str] = None) -> dict:
    return _decide(store, user, approval_id, "reject", reason_code)


def revoke(store: GatewayStore, user: CurrentUser, approval_id: str, *, reason_code: Optional[str] = None) -> dict:
    """Withdraw (initiator) or revoke (authorized approver) an approval that has not been consumed."""
    user = _user(user)
    result = store.approval_revoke(tenant_id=user.hotel_id, approval_id=_approval_id(approval_id),
                                   actor_user_id=user.user_id, reason_code=_reason(reason_code))
    if not result.get("ok"):
        raise GatewayRefused(str(result.get("reason") or "revoke_refused"))
    return result


def expire_due(store: GatewayStore, *, limit: int = 100) -> dict:
    """Operator / worker sweep: expire approvals past their deadline and end the runs waiting on them."""
    return store.approvals_expire(limit=limit)

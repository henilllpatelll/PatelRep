"""Current-authority identity for background work: the H0 ``IdentityAuthority`` over authoritative membership data.

A queued run stores WHO initiated it, never what they were allowed to do. Before every step the worker re-reads:

  * ``tenants``        the hotel exists and ``is_active`` (property entitlement)
  * ``user_profiles``  the person's profile exists, belongs to this hotel and ``is_active`` (account activation)
  * ``user_roles``     exactly ONE active canonical role in this hotel (membership + current role)

and then requires that role to hold the operational permission the run needs (``SYNTHETIC_INITIATOR_ROLES`` in H1).
Removal, deactivation, demotion or a hotel being deactivated therefore revokes authority at the next step. Anything
ambiguous -- several active roles, a profile owned by another hotel, an unknown role -- fails closed. No JWT, queued
role or request payload is ever consulted. System principals come only from the H0 registry (``context_for_system``)
and never inherit a human role.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Mapping, Optional

from services.agent_harness.errors import IdentityError
from services.agent_harness.identity import (
    AuthoritativeIdentity,
    IdentityAuthority,
    TrustedExecutionContext,
    context_for_system,
    reload_identity,
)
from services.agent_harness.vocabulary import CANONICAL_ROLES, PrincipalType, TriggerType

# The operational permission a human needs to keep a synthetic probe running. GM only: a probe is an operator action.
SYNTHETIC_INITIATOR_ROLES: frozenset[str] = frozenset({"gm"})


class SupabaseIdentityAuthority:
    """Reads membership with the backend (service-role) client. Every query is filtered by user AND hotel."""

    def __init__(self, client: Any, *, clock: Callable[[], datetime]) -> None:
        self._client = client
        self._clock = clock

    def load(self, *, user_id: str, hotel_id: str) -> Optional[AuthoritativeIdentity]:
        tenants = (self._client.table("tenants").select("id, is_active").eq("id", hotel_id).limit(2).execute().data or [])
        profiles = (self._client.table("user_profiles").select("id, tenant_id, is_active")
                    .eq("id", user_id).limit(2).execute().data or [])
        roles = (self._client.table("user_roles").select("role, is_active")
                 .eq("user_id", user_id).eq("tenant_id", hotel_id).limit(20).execute().data or [])
        return identity_from_rows(user_id=user_id, hotel_id=hotel_id, tenants=tenants, profiles=profiles,
                                  roles=roles, loaded_at=self._clock())


def identity_from_rows(
    *, user_id: str, hotel_id: str, tenants: list[Mapping[str, Any]], profiles: list[Mapping[str, Any]],
    roles: list[Mapping[str, Any]], loaded_at: datetime,
) -> Optional[AuthoritativeIdentity]:
    """Pure decision over the three row sets (unit-testable). None = no membership at all."""
    if len(tenants) > 1 or len(profiles) > 1:
        raise IdentityError("inconsistent membership records", code="ambiguous_membership")
    if not tenants or not profiles or not roles:
        return None
    active_roles = [r for r in roles if r.get("is_active") is True]
    profile = profiles[0]
    if profile.get("tenant_id") != hotel_id:
        raise IdentityError("the profile belongs to another hotel", code="tenant_mismatch")
    if len(active_roles) > 1:
        raise IdentityError("more than one active role in this hotel", code="ambiguous_membership")
    tenant_active = tenants[0].get("is_active") is True
    profile_active = profile.get("is_active") is True
    role = (active_roles[0] if active_roles else roles[0]).get("role")
    if not isinstance(role, str) or role not in CANONICAL_ROLES:
        raise IdentityError("membership has no canonical role", code="unknown_role")
    return AuthoritativeIdentity(
        user_id=user_id, hotel_id=hotel_id, role=role,
        is_active=bool(active_roles) and tenant_active and profile_active, loaded_at=loaded_at,
    )


class _Preloaded:
    """Hands ``reload_identity`` a record that was read BEFORE ``now`` is sampled, so H0's freshness window
    (0 <= now - loaded_at <= MAX_AUTHORITY_AGE) is evaluated against a real, already-completed read."""

    def __init__(self, record: Optional[AuthoritativeIdentity]) -> None:
        self._record = record

    def load(self, *, user_id: str, hotel_id: str) -> Optional[AuthoritativeIdentity]:
        return self._record


def revalidate_principal(run: Mapping[str, Any], authority: IdentityAuthority, *, clock: Callable[[], datetime],
                         required_roles: frozenset[str] = SYNTHETIC_INITIATOR_ROLES) -> TrustedExecutionContext:
    """Re-establish the run's principal from CURRENT authoritative state. Every failure raises ``IdentityError``."""
    try:
        principal = PrincipalType(run["principal_type"])
        trigger = TriggerType(run["trigger_type"])
    except (KeyError, ValueError) as exc:
        raise IdentityError("run carries an invalid principal or trigger", code="invalid_principal_type") from exc
    common = dict(hotel_id=run["tenant_id"], agent_id=run["agent_id"], agent_version=run["agent_version"],
                  trigger=trigger, run_id=run["id"], correlation_id=run.get("correlation_id"))
    if principal is PrincipalType.SYSTEM:
        return context_for_system(run.get("system_principal_id") or "", now=clock(), **common)
    user_id = run.get("initiated_by_user_id")
    if not isinstance(user_id, str) or not user_id:
        raise IdentityError("human run without an initiating user", code="missing_principal")
    record = authority.load(user_id=user_id, hotel_id=run["tenant_id"])
    ctx = reload_identity(_Preloaded(record), user_id=user_id, now=clock(), **common)
    if ctx.role not in required_roles:
        raise IdentityError("the user's current role no longer permits this run", code="operational_permission_revoked")
    return ctx

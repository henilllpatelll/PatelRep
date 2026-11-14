"""Trusted agent execution identity.

A ``TrustedExecutionContext`` says WHO an agent acts for, in WHICH hotel, for WHICH agent version and trigger. It is
built only by the factories below, from server-controlled sources:

  * ``context_from_verified_user``  -- an interactive request: the ``CurrentUser`` that ``get_current_user`` produced
    from a verified JWT. Fresh for ``MAX_AUTHORITY_AGE`` only.
  * ``reload_identity``             -- background work (H1+): identity and role are re-read from the authoritative
    server-side store through an ``IdentityAuthority``; a JWT captured when a job was queued is never reused.
  * ``context_for_system``          -- explicitly registered internal automation. A system principal has NO role,
    never inherits GM authority, and can only use tools that name it explicitly.

Direct construction, ``dataclasses.replace``, copy and pickle are refused, so a model output, tool payload, guest
message, retrieved document or integration payload cannot create or alter a context. Python cannot make this
cryptographically impossible for in-process code; the guarantee is that no untrusted DATA path can reach the minting
gate, and tests pin that.
"""
from __future__ import annotations

import re
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from types import MappingProxyType
from typing import Any, Iterator, Mapping, Optional, Protocol

from pydantic import BaseModel, ConfigDict, StrictBool, StrictStr

from services.agent_harness.errors import IdentityError
from services.agent_harness.vocabulary import CANONICAL_ROLES, IDENTITY_CLAIM_KEYS, AutonomyLevel, PrincipalType, TriggerType  # noqa: F401 (re-export)

POLICY_VERSION = "agent-harness-policy/h2.0"
MAX_AUTHORITY_AGE = timedelta(minutes=5)
_AGENT_ID_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$")
_minting: ContextVar[bool] = ContextVar("agent_harness_identity_minting", default=False)



class IdentitySource(str, Enum):
    VERIFIED_REQUEST_JWT = "verified_request_jwt"
    SERVER_RELOAD = "server_reload"
    SYSTEM_REGISTRY = "system_registry"


@dataclass(frozen=True)
class SystemPrincipalDef:
    principal_id: str
    description: str
    allowed_triggers: frozenset[TriggerType]
    max_autonomy: AutonomyLevel


# Registered internal automation. Reserved for H1; read-only by construction (tools.py forbids system principals on
# write tools, and max_autonomy is OBSERVE). Adding a principal is a reviewed code change, never configuration.
SYSTEM_PRINCIPALS: Mapping[str, SystemPrincipalDef] = MappingProxyType({
    "harness.scheduled_observer": SystemPrincipalDef(
        principal_id="harness.scheduled_observer",
        description="Scheduled, read-only observation runs (reserved for H1 durable execution).",
        allowed_triggers=frozenset({TriggerType.SCHEDULE}),
        max_autonomy=AutonomyLevel.OBSERVE,
    ),
})


@contextmanager
def _mint() -> Iterator[None]:
    token = _minting.set(True)
    try:
        yield
    finally:
        _minting.reset(token)


@dataclass(frozen=True)
class TrustedExecutionContext:
    principal_type: PrincipalType
    hotel_id: str
    agent_id: str
    agent_version: int
    trigger: TriggerType
    source: IdentitySource
    authority_verified_at: datetime
    user_id: Optional[str] = None
    role: Optional[str] = None
    system_principal_id: Optional[str] = None
    run_id: Optional[str] = None
    correlation_id: Optional[str] = None
    policy_version: str = POLICY_VERSION

    def __post_init__(self) -> None:
        if not _minting.get():
            raise IdentityError(
                "TrustedExecutionContext can only be minted by the trusted identity factories",
                code="untrusted_construction",
            )
        _validate_context(self)

    def __copy__(self) -> "TrustedExecutionContext":
        return self

    def __deepcopy__(self, memo: dict) -> "TrustedExecutionContext":
        return self

    def __reduce__(self) -> Any:
        raise IdentityError("trusted contexts cannot be serialised and revived", code="untrusted_construction")

    def is_current(self, now: datetime) -> bool:
        """Authority older than MAX_AUTHORITY_AGE (or from the future) must be re-established, never assumed."""
        age = now - self.authority_verified_at
        return timedelta(0) <= age <= MAX_AUTHORITY_AGE


def _require_aware(value: datetime, label: str) -> None:
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise IdentityError(f"{label} must be a timezone-aware datetime", code="invalid_timestamp")


def _validate_context(ctx: TrustedExecutionContext) -> None:
    if not isinstance(ctx.principal_type, PrincipalType):
        raise IdentityError("unknown principal type", code="invalid_principal_type")
    if not isinstance(ctx.hotel_id, str) or not ctx.hotel_id.strip():
        raise IdentityError("a hotel id is required", code="missing_hotel")
    if not isinstance(ctx.agent_id, str) or not _AGENT_ID_RE.match(ctx.agent_id):
        raise IdentityError("invalid agent id", code="invalid_agent")
    if isinstance(ctx.agent_version, bool) or not isinstance(ctx.agent_version, int) or ctx.agent_version < 1:
        raise IdentityError("invalid agent version", code="invalid_agent")
    if not isinstance(ctx.trigger, TriggerType) or not isinstance(ctx.source, IdentitySource):
        raise IdentityError("invalid trigger or identity source", code="invalid_trigger")
    _require_aware(ctx.authority_verified_at, "authority_verified_at")
    if ctx.principal_type is PrincipalType.HUMAN:
        if not isinstance(ctx.user_id, str) or not ctx.user_id.strip():
            raise IdentityError("a human principal needs a user id", code="missing_principal")
        if ctx.role not in CANONICAL_ROLES:
            raise IdentityError("a human principal needs a canonical role", code="unknown_role")
        if ctx.system_principal_id is not None:
            raise IdentityError("a human principal cannot carry a system principal", code="invalid_principal_type")
        if ctx.source is IdentitySource.SYSTEM_REGISTRY:
            raise IdentityError("human identity cannot come from the system registry", code="invalid_source")
    else:
        spec = SYSTEM_PRINCIPALS.get(ctx.system_principal_id or "")
        if spec is None:
            raise IdentityError("unknown system principal", code="unknown_system_principal")
        if ctx.user_id is not None or ctx.role is not None:
            raise IdentityError("a system principal has no user or role", code="invalid_principal_type")
        if ctx.trigger not in spec.allowed_triggers:
            raise IdentityError("trigger not allowed for this system principal", code="invalid_trigger")
        if ctx.source is not IdentitySource.SYSTEM_REGISTRY:
            raise IdentityError("system identity must come from the system registry", code="invalid_source")


def context_from_verified_user(
    user: Any,
    *,
    agent_id: str,
    agent_version: int,
    now: datetime,
    run_id: Optional[str] = None,
    correlation_id: Optional[str] = None,
) -> TrustedExecutionContext:
    """Build a request-scoped context from the ``CurrentUser`` produced by ``get_current_user``."""
    from middleware.auth import CurrentUser  # lazy: keeps this package importable without app settings

    if not isinstance(user, CurrentUser):
        raise IdentityError("identity must come from verified authentication", code="unauthenticated")
    if user.role not in CANONICAL_ROLES:
        raise IdentityError("the authenticated user has no canonical PatelRep role", code="unknown_role")
    _require_aware(now, "now")
    with _mint():
        return TrustedExecutionContext(
            principal_type=PrincipalType.HUMAN, hotel_id=user.hotel_id, agent_id=agent_id,
            agent_version=agent_version, trigger=TriggerType.USER_REQUEST,
            source=IdentitySource.VERIFIED_REQUEST_JWT, authority_verified_at=now, user_id=user.user_id,
            role=user.role, run_id=run_id, correlation_id=correlation_id,
        )


class AuthoritativeIdentity(BaseModel):
    """What the server-side store says about a person right now (H1 implements the lookup)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    user_id: StrictStr
    hotel_id: StrictStr
    role: StrictStr
    is_active: StrictBool
    loaded_at: datetime


class IdentityAuthority(Protocol):
    """Reads user_roles (or equivalent) with the service role. Returns None when there is no such membership."""

    def load(self, *, user_id: str, hotel_id: str) -> Optional[AuthoritativeIdentity]: ...


def reload_identity(
    authority: IdentityAuthority,
    *,
    user_id: str,
    hotel_id: str,
    agent_id: str,
    agent_version: int,
    trigger: TriggerType,
    now: datetime,
    run_id: Optional[str] = None,
    correlation_id: Optional[str] = None,
) -> TrustedExecutionContext:
    """Re-establish a human principal's CURRENT authority for background work. Every failure is a refusal."""
    _require_aware(now, "now")
    record = authority.load(user_id=user_id, hotel_id=hotel_id)
    if record is None:
        raise IdentityError("no current membership for this user in this hotel", code="principal_not_found")
    if not isinstance(record, AuthoritativeIdentity):
        raise IdentityError("identity authority returned an unexpected record", code="invalid_identity_record")
    if record.user_id != user_id or record.hotel_id != hotel_id:
        raise IdentityError("identity record does not match the requested principal", code="tenant_mismatch")
    if not record.is_active:
        raise IdentityError("the user is no longer active in this hotel", code="principal_inactive")
    if record.role not in CANONICAL_ROLES:
        raise IdentityError("the user has no canonical role", code="unknown_role")
    _require_aware(record.loaded_at, "loaded_at")
    if not timedelta(0) <= now - record.loaded_at <= MAX_AUTHORITY_AGE:
        raise IdentityError("identity record is stale", code="stale_identity")
    with _mint():
        return TrustedExecutionContext(
            principal_type=PrincipalType.HUMAN, hotel_id=hotel_id, agent_id=agent_id, agent_version=agent_version,
            trigger=trigger, source=IdentitySource.SERVER_RELOAD, authority_verified_at=record.loaded_at,
            user_id=user_id, role=record.role, run_id=run_id, correlation_id=correlation_id,
        )


def context_for_system(
    principal_id: str,
    *,
    hotel_id: str,
    agent_id: str,
    agent_version: int,
    trigger: TriggerType,
    now: datetime,
    run_id: Optional[str] = None,
    correlation_id: Optional[str] = None,
) -> TrustedExecutionContext:
    if principal_id not in SYSTEM_PRINCIPALS:
        raise IdentityError("unknown system principal", code="unknown_system_principal")
    _require_aware(now, "now")
    with _mint():
        return TrustedExecutionContext(
            principal_type=PrincipalType.SYSTEM, hotel_id=hotel_id, agent_id=agent_id, agent_version=agent_version,
            trigger=trigger, source=IdentitySource.SYSTEM_REGISTRY, authority_verified_at=now,
            system_principal_id=principal_id, run_id=run_id, correlation_id=correlation_id,
        )

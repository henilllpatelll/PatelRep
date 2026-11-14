"""Admission of a gateway run: one verified human asks the dispatch assistant to perform ONE tool invocation.

H2 has no model: the invocation is supplied by a trusted backend caller (H3's orchestrator will propose invocations
the same way, as untrusted suggestions). Authority comes only from a verified ``CurrentUser``; the hotel, user and role
are never taken from arguments. Admission validates, resolves and evaluates the request (a write must come back as
``requires_approval`` -- never ``allow`` -- because no approval exists yet), then persists the run, its first step, its
queue message and the immutable invocation in one database transaction that re-checks authority independently.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Optional

from middleware.auth import CurrentUser
from services.agent_gateway.authorization import GatewaySettings, block_reason, db_now, policy_inputs, process_allows_execution
from services.agent_gateway.catalog import DISPATCH_AGENT_ID, DISPATCH_AGENT_VERSION
from services.agent_gateway.errors import GatewayRefused
from services.agent_gateway.gateway import agent_for, decide, prepare, request_digest
from services.agent_gateway.store import GatewayStore
from services.agent_harness.errors import IdentityError
from services.agent_harness.identity import POLICY_VERSION, context_from_verified_user
from services.agent_harness.policy import Outcome
from services.agent_harness.vocabulary import AccessMode

_IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9._:-]{8,200}$")


@dataclass(frozen=True)
class ToolRunAdmission:
    run_id: str
    invocation_id: str
    created: bool
    state: str
    requires_approval: bool


def admit_tool_run(
    store: GatewayStore,
    user: CurrentUser,
    *,
    tool_id: object,
    tool_version: object,
    arguments: Any,
    idempotency_key: str,
    app_env: str,
    settings: GatewaySettings,
    clock: Callable[[], datetime],
    correlation_id: Optional[str] = None,
    deadline_seconds: int = 7_200,
) -> ToolRunAdmission:
    if not isinstance(user, CurrentUser) or not user.hotel_id or not user.user_id:
        raise GatewayRefused("unauthenticated")
    if not process_allows_execution(app_env=app_env, settings=settings):
        raise GatewayRefused("gateway_disabled")
    if not isinstance(idempotency_key, str) or not _IDEMPOTENCY_KEY_RE.match(idempotency_key):
        raise GatewayRefused("invalid_idempotency_key")

    agent = agent_for(DISPATCH_AGENT_ID, DISPATCH_AGENT_VERSION)
    try:
        ctx = context_from_verified_user(user, agent_id=agent.agent_id, agent_version=agent.agent_version, now=clock())
    except IdentityError as exc:
        raise GatewayRefused(exc.code) from exc
    prepared = prepare(store.client, hotel_id=ctx.hotel_id, agent=agent, tool_id=tool_id, tool_version=tool_version,
                       arguments=arguments)
    spec = prepared.binding.spec

    snapshot = store.authorization_snapshot(tenant_id=ctx.hotel_id, agent_id=agent.agent_id,
                                            agent_version=agent.agent_version)
    blocked = block_reason(snapshot, hotel_id=ctx.hotel_id, agent_id=agent.agent_id, tool_id=spec.tool_id)
    if blocked:
        raise GatewayRefused(blocked)
    now = max(clock(), db_now(snapshot) or clock())
    inputs = policy_inputs(snapshot, hotel_id=ctx.hotel_id, agent_id=agent.agent_id, process_enabled=True, now=now)
    decision = decide(ctx, prepared, inputs, now=now)
    expected = Outcome.ALLOW if spec.access is AccessMode.READ else Outcome.REQUIRES_APPROVAL
    if decision.outcome is not expected:
        raise GatewayRefused(decision.reason.value)

    result = store.run_admit(
        tenant_id=ctx.hotel_id, agent_id=agent.agent_id, agent_version=agent.agent_version, user_id=user.user_id,
        idempotency_key=idempotency_key,
        request_digest=request_digest(hotel_id=ctx.hotel_id, agent=agent, user_id=user.user_id, prepared=prepared),
        correlation_id=(correlation_id or idempotency_key)[:100], policy_version=POLICY_VERSION, tool_id=spec.tool_id,
        tool_version=spec.version, arguments=prepared.arguments, resource_type=spec.resource_type.value,
        resource_id=prepared.resource.resource_id, action_digest=prepared.digest, deadline_seconds=deadline_seconds,
        max_attempts=5, step_max_attempts=3)
    if not result.get("admitted"):
        raise GatewayRefused(str(result.get("reason") or "admission_failed"))
    return ToolRunAdmission(run_id=str(result["run_id"]), invocation_id=str(result["invocation_id"]),
                            created=bool(result["created"]), state=str(result["state"]),
                            requires_approval=spec.access is AccessMode.WRITE)

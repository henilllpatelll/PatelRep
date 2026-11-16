"""Adapter from the gateway's verified-context gatherer to the H3 planning step (worker composition only).

The orchestrator package never imports gateway execution code; the worker passes it this provider. Gateway refusals
become ``ContextUnavailable`` (terminal: the run records a 'rejected' plan with zero model attempts) and runtime-control
blocks become ``PlanningBlocked`` (the worker yields and retries later, consuming nothing).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Mapping

from services.agent_gateway.context import ContextRead, ContextRefused, VerifiedContext, gather_verified_context
from services.agent_gateway.errors import GatewayBlocked
from services.agent_gateway.store import GatewayStore
from services.agent_harness.identity import IdentityAuthority
from services.agent_orchestrator.errors import ContextUnavailable, PlanningBlocked
from services.agent_orchestrator.plans import IntentSpec


def make_context_provider(client: Any, *, authority: IdentityAuthority, clock: Callable[[], datetime],
                          process_enabled: bool) -> Callable[..., VerifiedContext]:
    def provide(*, intent: IntentSpec, run: Mapping[str, Any], planning: Mapping[str, Any]) -> VerifiedContext:
        if intent.specialist is None or not intent.context_reads:
            raise ContextUnavailable("context_not_configured")
        if planning.get("resource_type") != intent.resource_type:
            raise ContextUnavailable("resource_type_mismatch")
        reads = tuple(ContextRead(tool_id=t, tool_version=v, resource_argument=a) for t, v, a in intent.context_reads)
        try:
            return gather_verified_context(
                GatewayStore(client), run=run, agent_key=intent.specialist, resource_type=intent.resource_type,
                resource_id=str(planning["resource_id"]), reads=reads, authority=authority, clock=clock,
                process_enabled=process_enabled)
        except ContextRefused as refused:
            raise ContextUnavailable(refused.code) from None
        except GatewayBlocked as blocked:
            raise PlanningBlocked(blocked.reason) from None

    return provide

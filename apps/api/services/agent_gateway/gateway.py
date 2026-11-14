"""The deterministic gateway sequence shared by admission and the worker.

  prepare():  exact binding lookup -> agent manifest pin -> strict argument validation + canonical form + nested
              identity-claim refusal -> SERVER-side resource resolution in the trusted hotel -> action digest
  decide():   H0 ``policy.evaluate`` over a trusted context, fresh controls / entitlement / grants and (writes) a
              server-recorded approval whose approver role was re-read just now

``decide`` never executes anything. ``requires_approval`` is not permission. ``allow`` is acted on only when
``authorizes_execution`` is also true (exact H2 tool set), and writes are re-checked again inside the database in the
same transaction as the side effect.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Mapping, Optional

from services.agent_gateway.authorization import PolicyInputs, parse_ts
from services.agent_gateway.bindings import GATEWAY_BINDINGS, ToolBinding
from services.agent_gateway.catalog import GATEWAY_AGENTS
from services.agent_gateway.errors import GatewayRefused
from services.agent_gateway.schema import SchemaViolation, canonical_json, validate_arguments
from services.agent_harness.agents import AgentSpec
from services.agent_harness.identity import TrustedExecutionContext
from services.agent_harness.policy import (
    ApprovalEvidence,
    AuthorizationDecision,
    AuthorizationRequest,
    VerifiedResource,
    action_digest,
    evaluate,
)


@dataclass(frozen=True)
class Prepared:
    binding: ToolBinding
    arguments: dict
    resource: VerifiedResource
    digest: str


def agent_for(agent_id: object, agent_version: object) -> AgentSpec:
    agent = GATEWAY_AGENTS.get(agent_id, agent_version)
    if agent is None:
        raise GatewayRefused("agent_not_registered")
    return agent


def prepare(client: Any, *, hotel_id: str, agent: AgentSpec, tool_id: object, tool_version: object,
            arguments: Any) -> Prepared:
    binding = GATEWAY_BINDINGS.resolve_untrusted(tool_id, tool_version)
    if binding is None:
        raise GatewayRefused("tool_not_registered")
    if binding.key not in {ref.key for ref in agent.tools}:
        raise GatewayRefused("tool_not_allowed_for_agent")
    try:
        canonical = validate_arguments(arguments, binding.spec.input_schema)
    except SchemaViolation as exc:
        raise GatewayRefused(exc.code if exc.code == "untrusted_identity_claim" else f"invalid_arguments_{exc.code}") from exc
    resource = binding.resolve(client, hotel_id, canonical)
    if resource is None or resource.hotel_id != hotel_id or resource.resource_type is not binding.spec.resource_type:
        raise GatewayRefused("resource_out_of_scope")
    return Prepared(binding=binding, arguments=canonical, resource=resource,
                    digest=action_digest(binding.spec, resource, canonical))


def request_digest(*, hotel_id: str, agent: AgentSpec, user_id: str, prepared: Prepared) -> str:
    body = {"tenant": hotel_id, "agent": [agent.agent_id, agent.agent_version], "user": user_id,
            "tool": [prepared.binding.spec.tool_id, prepared.binding.spec.version], "arguments": prepared.arguments}
    return hashlib.sha256(canonical_json(body)).hexdigest()


def approval_evidence(approval: Mapping[str, Any], *, approver_role: str) -> ApprovalEvidence:
    """H0 evidence from a server-recorded approval. ``approver_role`` is the approver's CURRENT role, not a stored one."""
    return ApprovalEvidence(
        approval_id=str(approval["id"]), approval_policy_id=str(approval["approval_policy_id"]),
        hotel_id=str(approval["tenant_id"]), agent_id=str(approval["agent_id"]),
        agent_version=int(approval["agent_version"]), tool_id=str(approval["tool_id"]),
        tool_version=int(approval["tool_version"]), action_digest=str(approval["action_digest"]),
        initiator_user_id=str(approval["initiated_by_user_id"]), approver_user_id=str(approval["decided_by_user_id"]),
        approver_role=approver_role, approved_at=parse_ts(approval["decided_at"]),
        expires_at=parse_ts(approval["expires_at"]),
    )


def decide(ctx: TrustedExecutionContext, prepared: Prepared, inputs: PolicyInputs, *, now: datetime,
           approval: Optional[ApprovalEvidence] = None) -> AuthorizationDecision:
    spec = prepared.binding.spec
    request = AuthorizationRequest(hotel_id=ctx.hotel_id, agent_id=ctx.agent_id, agent_version=ctx.agent_version,
                                   tool_id=spec.tool_id, tool_version=spec.version, arguments=prepared.arguments)
    return evaluate(ctx, request, agents=GATEWAY_AGENTS, controls=inputs.controls, tenant=inputs.tenant, now=now,
                    resource=prepared.resource, approval=approval, grants=inputs.grants)

"""Default-deny authorization policy for agent tool requests.

``evaluate`` is pure and deterministic: same inputs, same decision, no I/O, no model. It answers one of
``allow`` / ``deny`` / ``requires_approval`` with a stable ``ReasonCode``. Everything not explicitly permitted is
denied -- unknown or malformed contexts, agents, tools, roles, principals, flags, hotels and resources all fail closed.

What a decision is NOT:
  * ``requires_approval`` is never authorization to execute.
  * ``allow`` is a policy answer, not an execution. ``AuthorizationDecision.authorizes_execution`` is True only for an
    ``allow`` on a tool version in the reviewed H2 set (``controls.H2_EXECUTABLE_TOOLS``); there is still no dispatcher
    in this package -- the Tool Gateway (services/agent_gateway) is the only executor and re-checks volatile state in
    the database immediately before any side effect.
  * A write tool outside ``H2_EXECUTABLE_TOOLS`` is never allowed: even with a valid, server-recorded approval the answer
    is ``deny / write_execution_unavailable``. Inside the set, a write is allowed only with a valid approval bound to the
    exact action digest, initiator, agent version and tool version.

The request is UNTRUSTED (it is shaped by a model). Identity comes only from the ``TrustedExecutionContext``; resource
ownership only from a server-resolved ``VerifiedResource``; approval only from a server-recorded ``ApprovalEvidence``.
Identity-like keys inside untrusted arguments are refused outright.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Iterable, Mapping, Optional

from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr

from services.agent_harness.agents import AGENT_HARNESS_FLAG, AgentRegistry, AgentSpec
from services.agent_harness.autonomy import APPROVAL_POLICIES, AutonomyGrant, effective_autonomy, requires_human_authority
from services.agent_harness.controls import RuntimeControls, TenantAgentState, tool_is_executable
from services.agent_harness.identity import POLICY_VERSION, SYSTEM_PRINCIPALS, TrustedExecutionContext
from services.agent_harness.tools import ToolSpec
from services.agent_harness.vocabulary import (
    CAPABILITY_CATALOG,
    IDENTITY_CLAIM_KEYS,
    AccessMode,
    AutonomyLevel,
    PrincipalType,
    ResourceType,
)

# The most a policy decision may reflect for writes once execution exists (H2+). Levels 3-4 are not evaluable yet.
POLICY_AUTONOMY_CEILING = AutonomyLevel.HUMAN_APPROVED


class Outcome(str, Enum):
    ALLOW = "allow"
    DENY = "deny"
    REQUIRES_APPROVAL = "requires_approval"


class ReasonCode(str, Enum):
    ALLOWED = "allowed"
    MISSING_CONTEXT = "missing_context"
    MALFORMED_REQUEST = "malformed_request"
    STALE_IDENTITY = "stale_identity"
    CONTROLS_UNAVAILABLE = "controls_unavailable"
    PLATFORM_EXECUTION_DISABLED = "platform_execution_disabled"
    COST_EMERGENCY_STOP = "cost_emergency_stop"
    TENANT_MISMATCH = "tenant_mismatch"
    UNTRUSTED_IDENTITY_CLAIM = "untrusted_identity_claim"
    HOTEL_PAUSED = "hotel_paused"
    TENANT_CAPABILITY_DISABLED = "tenant_capability_disabled"
    AGENT_MISMATCH = "agent_mismatch"
    AGENT_NOT_REGISTERED = "agent_not_registered"
    AGENT_DISABLED = "agent_disabled"
    AGENT_PAUSED = "agent_paused"
    TRIGGER_NOT_SUPPORTED = "trigger_not_supported"
    TOOL_NOT_REGISTERED = "tool_not_registered"
    TOOL_NOT_ALLOWED_FOR_AGENT = "tool_not_allowed_for_agent"
    TOOL_PAUSED = "tool_paused"
    TOOL_FEATURE_DISABLED = "tool_feature_disabled"
    CAPABILITY_NOT_DECLARED = "capability_not_declared"
    ACTOR_NOT_AUTHORIZED = "actor_not_authorized"
    HUMAN_AUTHORITY_REQUIRED = "human_authority_required"
    RESOURCE_OUT_OF_SCOPE = "resource_out_of_scope"
    AUTONOMY_INSUFFICIENT = "autonomy_insufficient"
    APPROVAL_REQUIRED = "approval_required"
    APPROVAL_INVALID = "approval_invalid"
    WRITE_EXECUTION_UNAVAILABLE = "write_execution_unavailable"


@dataclass(frozen=True)
class AuthorizationRequest:
    """An agent's (untrusted) request to use a tool. Fields are deliberately loosely typed: evaluate() validates."""

    hotel_id: Any
    agent_id: Any
    agent_version: Any
    tool_id: Any
    tool_version: Any
    arguments: Any = None


@dataclass(frozen=True)
class VerifiedResource:
    """A resource the SERVER looked up (never a model's claim about which hotel a record belongs to)."""

    resource_type: ResourceType
    resource_id: str
    hotel_id: str


class ApprovalEvidence(BaseModel):
    """A server-recorded human approval bound to one exact proposed action (H2 persists these)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    approval_id: StrictStr
    approval_policy_id: StrictStr
    hotel_id: StrictStr
    agent_id: StrictStr
    agent_version: StrictInt
    tool_id: StrictStr
    tool_version: StrictInt
    action_digest: StrictStr
    initiator_user_id: StrictStr
    approver_user_id: StrictStr
    approver_role: StrictStr
    approved_at: datetime
    expires_at: datetime


@dataclass(frozen=True)
class AuthorizationDecision:
    outcome: Outcome
    reason: ReasonCode
    policy_version: str = POLICY_VERSION
    agent_key: Optional[tuple[str, int]] = None
    tool_key: Optional[tuple[str, int]] = None

    @property
    def authorizes_execution(self) -> bool:
        """Only an ``allow`` for a tool version in the reviewed H2 executable set can authorize execution."""
        return self.outcome is Outcome.ALLOW and tool_is_executable(self.tool_key)


def action_digest(tool: ToolSpec, resource: Optional[VerifiedResource], arguments: Mapping[str, Any]) -> str:
    """Stable digest binding an approval to one exact action (tool version, resource and arguments)."""
    body = {
        "tool": [tool.tool_id, tool.version],
        "resource": None if resource is None else [resource.resource_type.value, resource.resource_id, resource.hotel_id],
        "arguments": arguments,
    }
    encoded = json.dumps(body, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


def _deny(reason: ReasonCode, agent: Optional[AgentSpec] = None, tool: Optional[ToolSpec] = None) -> AuthorizationDecision:
    return AuthorizationDecision(Outcome.DENY, reason, agent_key=agent.key if agent else None,
                                 tool_key=tool.key if tool else None)


def _approval_is_valid(approval: ApprovalEvidence, *, ctx: TrustedExecutionContext, agent: AgentSpec,
                       tool: ToolSpec, digest: str, now: datetime) -> bool:
    policy = APPROVAL_POLICIES.get(approval.approval_policy_id)
    if policy is None or approval.approval_policy_id not in agent.approval_policies:
        return False
    binding = (approval.hotel_id, approval.agent_id, approval.agent_version, approval.tool_id, approval.tool_version)
    if binding != (ctx.hotel_id, agent.agent_id, agent.agent_version, tool.tool_id, tool.version):
        return False
    if approval.action_digest != digest or approval.initiator_user_id != ctx.user_id:
        return False
    if not (approval.approved_at <= now < approval.expires_at):
        return False
    if (now - approval.approved_at).total_seconds() > policy.max_age_seconds:
        return False
    authorized_roles = tool.allowed_roles & CAPABILITY_CATALOG[tool.capability].granted_roles
    if policy.approver_must_hold_tool_role and approval.approver_role not in authorized_roles:
        return False
    if not policy.approver_may_be_initiator and approval.approver_user_id == approval.initiator_user_id:
        return False
    return True


def evaluate(
    ctx: Optional[TrustedExecutionContext],
    request: AuthorizationRequest,
    *,
    agents: AgentRegistry,
    controls: Optional[RuntimeControls],
    tenant: Optional[TenantAgentState],
    now: datetime,
    resource: Optional[VerifiedResource] = None,
    approval: Optional[ApprovalEvidence] = None,
    grants: Iterable[AutonomyGrant] = (),
) -> AuthorizationDecision:
    # --- trusted identity -------------------------------------------------------------------------------------
    if not isinstance(ctx, TrustedExecutionContext):
        return _deny(ReasonCode.MISSING_CONTEXT)
    if not isinstance(request, AuthorizationRequest):
        return _deny(ReasonCode.MALFORMED_REQUEST)
    arguments = {} if request.arguments is None else request.arguments
    if not isinstance(arguments, Mapping) or not all(isinstance(k, str) for k in arguments):
        return _deny(ReasonCode.MALFORMED_REQUEST)
    if not ctx.is_current(now):
        return _deny(ReasonCode.STALE_IDENTITY)

    # --- platform controls (fresh, server-side) ---------------------------------------------------------------
    if not isinstance(controls, RuntimeControls) or not controls.is_fresh(now):
        return _deny(ReasonCode.CONTROLS_UNAVAILABLE)
    if not controls.platform_execution_enabled:
        return _deny(ReasonCode.PLATFORM_EXECUTION_DISABLED)
    if controls.cost_emergency_stop:
        return _deny(ReasonCode.COST_EMERGENCY_STOP)

    # --- tenant ---------------------------------------------------------------------------------------------------
    if request.hotel_id != ctx.hotel_id:
        return _deny(ReasonCode.TENANT_MISMATCH)
    if IDENTITY_CLAIM_KEYS & set(arguments):
        return _deny(ReasonCode.UNTRUSTED_IDENTITY_CLAIM)
    if not isinstance(tenant, TenantAgentState) or not tenant.is_fresh(now):
        return _deny(ReasonCode.CONTROLS_UNAVAILABLE)
    if tenant.hotel_id != ctx.hotel_id:
        return _deny(ReasonCode.TENANT_MISMATCH)
    if ctx.hotel_id in controls.paused_hotels:
        return _deny(ReasonCode.HOTEL_PAUSED)
    if AGENT_HARNESS_FLAG not in tenant.enabled_flags:
        return _deny(ReasonCode.TENANT_CAPABILITY_DISABLED)

    # --- agent ----------------------------------------------------------------------------------------------------
    if (request.agent_id, request.agent_version) != (ctx.agent_id, ctx.agent_version):
        return _deny(ReasonCode.AGENT_MISMATCH)
    agent = agents.get(ctx.agent_id, ctx.agent_version)
    if agent is None:
        return _deny(ReasonCode.AGENT_NOT_REGISTERED)
    if not agent.enabled:
        return _deny(ReasonCode.AGENT_DISABLED, agent)
    if agent.agent_id in controls.paused_agents:
        return _deny(ReasonCode.AGENT_PAUSED, agent)
    if ctx.trigger not in agent.triggers:
        return _deny(ReasonCode.TRIGGER_NOT_SUPPORTED, agent)
    if not agent.required_feature_flags <= tenant.enabled_flags:
        return _deny(ReasonCode.TENANT_CAPABILITY_DISABLED, agent)

    # --- tool (the model's tool name is an untrusted suggestion) --------------------------------------------------
    tool = agents.tools.resolve_untrusted(request.tool_id, request.tool_version)
    if tool is None:
        return _deny(ReasonCode.TOOL_NOT_REGISTERED, agent)
    if tool.key not in {ref.key for ref in agent.tools}:
        return _deny(ReasonCode.TOOL_NOT_ALLOWED_FOR_AGENT, agent, tool)
    if tool.tool_id in controls.paused_tools:
        return _deny(ReasonCode.TOOL_PAUSED, agent, tool)
    if not tool.required_feature_flags <= tenant.enabled_flags:
        return _deny(ReasonCode.TOOL_FEATURE_DISABLED, agent, tool)
    capability = CAPABILITY_CATALOG.get(tool.capability)
    if capability is None or tool.capability not in agent.capabilities:
        return _deny(ReasonCode.CAPABILITY_NOT_DECLARED, agent, tool)

    # --- actor authority: explicit grants, never rank ------------------------------------------------------------
    if ctx.principal_type is PrincipalType.HUMAN:
        if ctx.role not in tool.allowed_roles or ctx.role not in capability.granted_roles:
            return _deny(ReasonCode.ACTOR_NOT_AUTHORIZED, agent, tool)
    else:
        principal = SYSTEM_PRINCIPALS.get(ctx.system_principal_id or "")
        if principal is None or ctx.system_principal_id not in tool.allowed_system_principals:
            return _deny(ReasonCode.ACTOR_NOT_AUTHORIZED, agent, tool)
        if requires_human_authority(tool):
            return _deny(ReasonCode.HUMAN_AUTHORITY_REQUIRED, agent, tool)

    # --- resource scope (server-verified ownership only) ---------------------------------------------------------
    if tool.requires_resource_id:
        if not isinstance(resource, VerifiedResource) or resource.resource_type is not tool.resource_type:
            return _deny(ReasonCode.RESOURCE_OUT_OF_SCOPE, agent, tool)
        if resource.hotel_id != ctx.hotel_id or not resource.resource_id:
            return _deny(ReasonCode.RESOURCE_OUT_OF_SCOPE, agent, tool)
    elif resource is not None and resource.hotel_id != ctx.hotel_id:
        return _deny(ReasonCode.RESOURCE_OUT_OF_SCOPE, agent, tool)

    if tool.access is AccessMode.READ:
        return AuthorizationDecision(Outcome.ALLOW, ReasonCode.ALLOWED, agent_key=agent.key, tool_key=tool.key)

    # --- writes: autonomy, then human approval, then the H2 executable-tool boundary --------------------------------------------
    level = effective_autonomy(hotel_id=ctx.hotel_id, agent_id=agent.agent_id, agent_ceiling=agent.autonomy_ceiling,
                               tool=tool, grants=grants, now=now, platform_ceiling=POLICY_AUTONOMY_CEILING)
    if ctx.principal_type is not PrincipalType.HUMAN or level < AutonomyLevel.HUMAN_APPROVED:
        return _deny(ReasonCode.AUTONOMY_INSUFFICIENT, agent, tool)
    if approval is None:
        return AuthorizationDecision(Outcome.REQUIRES_APPROVAL, ReasonCode.APPROVAL_REQUIRED,
                                     agent_key=agent.key, tool_key=tool.key)
    if not isinstance(approval, ApprovalEvidence) or not _approval_is_valid(
        approval, ctx=ctx, agent=agent, tool=tool, digest=action_digest(tool, resource, arguments), now=now,
    ):
        return _deny(ReasonCode.APPROVAL_INVALID, agent, tool)
    if not tool_is_executable(tool.key):
        return _deny(ReasonCode.WRITE_EXECUTION_UNAVAILABLE, agent, tool)
    return AuthorizationDecision(Outcome.ALLOW, ReasonCode.ALLOWED, agent_key=agent.key, tool_key=tool.key)

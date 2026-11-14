"""Autonomy policy contracts.

Autonomy is evaluated at the intersection of property x agent x tool x action x initiating actor x resource x risk.
There is no global autonomy switch and no wildcard grant: every ``AutonomyGrant`` names one hotel, one agent and one
tool version. The effective level is the MINIMUM of the agent manifest's ceiling, the matching grant (no grant =
observe only) and the platform ceiling for the current phase.

Hard rules that no autonomy level can lift:
  * Financial, personnel and safety consequences always require a human with authority (``requires_human_authority``).
  * High and critical risk tools always require a human with authority.
  * Bounded autonomy (level 3) may only ever cover LOW-risk, operational, non-human-authority tools -- and since every
    write tool in manifest schema v1 is at least medium risk and requires human approval, level 3 cannot unlock any
    write today.
  * In H0 nothing above OBSERVE is executable (``H0_EXECUTABLE_AUTONOMY``); levels 2-4 are contracts only.
"""
from __future__ import annotations

from datetime import datetime
from types import MappingProxyType
from typing import Iterable, Mapping, Optional

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, model_validator

from services.agent_harness.tools import TOOL_ID_PATTERN, ToolSpec
from services.agent_harness.vocabulary import (
    CAPABILITY_CATALOG,
    HUMAN_AUTHORITY_CONSEQUENCES,
    AccessMode,
    AutonomyLevel,
    RiskLevel,
)

# The highest autonomy level any H0 code path may act on. Observation produces no side effect, and H0 has no
# executor at all, so even this level only bounds the policy decision.
H0_EXECUTABLE_AUTONOMY: AutonomyLevel = AutonomyLevel.OBSERVE


class ApprovalPolicyDef(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    policy_id: StrictStr
    description: StrictStr
    approvals_required: StrictInt = Field(ge=1, le=3)
    approver_must_hold_tool_role: StrictBool = True  # the approver needs the same canonical authority as a direct actor
    approver_may_be_initiator: StrictBool = False
    max_age_seconds: StrictInt = Field(ge=60, le=86_400)


_APPROVAL_POLICIES = (
    ApprovalPolicyDef(
        policy_id="human_approval.single_authorized_manager.v1",
        description="One person holding the tool's canonical role approves the exact proposed action.",
        approvals_required=1,
        approver_may_be_initiator=True,
        max_age_seconds=3_600,
    ),
    ApprovalPolicyDef(
        policy_id="human_approval.independent_manager.v1",
        description="A person other than the initiator, holding the tool's canonical role, approves the action.",
        approvals_required=1,
        approver_may_be_initiator=False,
        max_age_seconds=3_600,
    ),
)

APPROVAL_POLICIES: Mapping[str, ApprovalPolicyDef] = MappingProxyType({p.policy_id: p for p in _APPROVAL_POLICIES})


def requires_human_authority(tool: ToolSpec) -> bool:
    """True when a human with authority must decide this action every time, at every autonomy level."""
    cap = CAPABILITY_CATALOG.get(tool.capability)
    if cap is None:
        return True  # unknown capability: fail closed
    if tool.access is AccessMode.WRITE:
        return True  # manifest schema v1: every write is human-approved
    return cap.consequence in HUMAN_AUTHORITY_CONSEQUENCES or tool.risk.rank >= RiskLevel.HIGH.rank


class AutonomyGrant(BaseModel):
    """A property's explicit grant of autonomy to one agent for one tool version. Never a wildcard."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    hotel_id: StrictStr = Field(min_length=1)
    agent_id: StrictStr = Field(min_length=1)
    tool_id: StrictStr = Field(pattern=TOOL_ID_PATTERN)
    tool_version: StrictInt = Field(ge=1)
    max_level: AutonomyLevel
    max_risk: RiskLevel
    granted_by_user_id: StrictStr = Field(min_length=1)
    granted_at: datetime
    expires_at: Optional[datetime] = None

    @model_validator(mode="after")
    def _bounded(self) -> "AutonomyGrant":
        for value in (self.hotel_id, self.agent_id):
            if value.strip().lower() in {"*", "all", "any"}:
                raise ValueError("autonomy grants cannot use wildcards")
        if self.max_level >= AutonomyLevel.BOUNDED and self.max_risk is not RiskLevel.LOW:
            raise ValueError("bounded or coordinated autonomy may only cover low-risk actions")
        if self.expires_at is not None and self.expires_at <= self.granted_at:
            raise ValueError("expires_at must follow granted_at")
        return self


def effective_autonomy(
    *,
    hotel_id: str,
    agent_id: str,
    agent_ceiling: AutonomyLevel,
    tool: ToolSpec,
    grants: Iterable[AutonomyGrant],
    now: datetime,
    platform_ceiling: AutonomyLevel = H0_EXECUTABLE_AUTONOMY,
) -> AutonomyLevel:
    """The level the harness may act at for this (hotel, agent, tool). Defaults to OBSERVE without a grant."""
    granted = AutonomyLevel.OBSERVE
    for grant in grants:
        if (grant.hotel_id, grant.agent_id, grant.tool_id, grant.tool_version) != (
            hotel_id, agent_id, tool.tool_id, tool.version,
        ):
            continue
        if grant.expires_at is not None and grant.expires_at <= now:
            continue
        if tool.risk.rank > grant.max_risk.rank:
            continue
        granted = max(granted, grant.max_level)
    level = min(agent_ceiling, granted, platform_ceiling)
    if level >= AutonomyLevel.BOUNDED and requires_human_authority(tool):
        level = AutonomyLevel.HUMAN_APPROVED
    return level

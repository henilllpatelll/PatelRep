"""Canonical Agent Registry contract.

An ``AgentSpec`` is a versioned, validated manifest. It declares what an agent MAY ask for; it never grants
authority by itself. Every request is still decided by the default-deny policy (policy.py) against a trusted
identity, tenant flags, runtime controls and the tool contract. Agents are disabled by default.

Registration validates the manifest against the tool registry: unknown tools, versions that are not registered,
tools whose capability the agent did not declare, and feature flags the tool needs but the agent does not require
all fail. The registry is in-process and immutable once frozen; H1+ may persist it, keeping these same rules.
"""
from __future__ import annotations

from decimal import Decimal
from types import MappingProxyType
from typing import Mapping, Optional

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, field_validator, model_validator

from core.feature_registry import FEATURE_REGISTRY
from services.agent_harness.autonomy import APPROVAL_POLICIES
from services.agent_harness.errors import RegistryError
from services.agent_harness.metering import Credits
from services.agent_harness.tools import ToolRef, ToolRegistry
from services.agent_harness.vocabulary import (
    CAPABILITY_CATALOG,
    AccessMode,
    AutonomyLevel,
    ProductFamily,
    ResourceType,
    TriggerType,
)

AGENT_MANIFEST_SCHEMA_V1 = "patelrep.agent-manifest/v1"
SUPPORTED_MANIFEST_SCHEMAS = frozenset({AGENT_MANIFEST_SCHEMA_V1})
AGENT_ID_PATTERN = r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$"
# Every agent requires the Agent Harness tenant entitlement (registered in core/feature_registry.py).
AGENT_HARNESS_FLAG = "ai_agents"


class ExecutionLimits(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    max_steps: StrictInt = Field(ge=1, le=50)
    max_tool_calls: StrictInt = Field(ge=0, le=100)
    max_runtime_seconds: StrictInt = Field(ge=1, le=3_600)
    max_credits_per_run: Credits

    @model_validator(mode="after")
    def _positive_budget(self) -> "ExecutionLimits":
        if self.max_credits_per_run <= Decimal(0):
            raise ValueError("max_credits_per_run must be positive")
        if self.max_tool_calls > self.max_steps * 4:
            raise ValueError("max_tool_calls is implausibly high for max_steps")
        return self


class AgentSpec(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    manifest_schema: StrictStr
    agent_id: StrictStr = Field(pattern=AGENT_ID_PATTERN)
    agent_version: StrictInt = Field(ge=1, le=999)
    name: StrictStr = Field(min_length=1, max_length=80)
    product_family: ProductFamily
    description: StrictStr = Field(min_length=1, max_length=1_000)
    tools: tuple[ToolRef, ...]
    capabilities: frozenset[str] = Field(min_length=1)
    autonomy_ceiling: AutonomyLevel = AutonomyLevel.OBSERVE
    required_feature_flags: frozenset[str]
    resource_types: frozenset[ResourceType] = Field(min_length=1)
    triggers: frozenset[TriggerType] = Field(min_length=1)
    limits: ExecutionLimits
    model_purpose: StrictStr = Field(pattern=r"^[a-z][a-z0-9_]{1,47}$")
    approval_policies: frozenset[str]
    enabled: StrictBool = False

    @field_validator("manifest_schema")
    @classmethod
    def _supported_schema(cls, value: str) -> str:
        if value not in SUPPORTED_MANIFEST_SCHEMAS:
            raise ValueError(f"unsupported manifest schema {value!r}")
        return value

    @model_validator(mode="after")
    def _self_consistent(self) -> "AgentSpec":
        unknown_caps = self.capabilities - CAPABILITY_CATALOG.keys()
        if unknown_caps:
            raise ValueError(f"unknown capabilities: {sorted(unknown_caps)}")
        unknown_flags = self.required_feature_flags - FEATURE_REGISTRY.keys()
        if unknown_flags:
            raise ValueError(f"unregistered feature flags: {sorted(unknown_flags)}")
        if AGENT_HARNESS_FLAG not in self.required_feature_flags:
            raise ValueError(f"every agent must require the {AGENT_HARNESS_FLAG!r} entitlement")
        unknown_policies = self.approval_policies - APPROVAL_POLICIES.keys()
        if unknown_policies:
            raise ValueError(f"unknown approval policies: {sorted(unknown_policies)}")
        keys = [ref.key for ref in self.tools]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate tool reference")
        if len({ref.tool_id for ref in self.tools}) != len(keys):
            raise ValueError("an agent may pin only one version of each tool")
        writes = {c for c in self.capabilities if CAPABILITY_CATALOG[c].access is AccessMode.WRITE}
        if writes and not self.approval_policies:
            raise ValueError("an agent declaring write capabilities must reference an approval policy")
        if writes and self.autonomy_ceiling < AutonomyLevel.HUMAN_APPROVED:
            raise ValueError("write capabilities are unusable below the human_approved autonomy ceiling")
        return self

    @property
    def key(self) -> tuple[str, int]:
        return (self.agent_id, self.agent_version)


class AgentRegistry:
    """In-process registry of agent manifests, validated against a frozen ToolRegistry."""

    def __init__(self, tools: ToolRegistry) -> None:
        if not tools.frozen:
            raise RegistryError("agent registry requires a frozen tool registry", code="tool_registry_not_frozen")
        self._tools = tools
        self._specs: dict[tuple[str, int], AgentSpec] = {}
        self._frozen = False

    @property
    def tools(self) -> ToolRegistry:
        return self._tools

    def register(self, spec: AgentSpec) -> AgentSpec:
        if self._frozen:
            raise RegistryError("agent registry is frozen", code="registry_frozen")
        if not isinstance(spec, AgentSpec):
            raise RegistryError("only validated AgentSpec instances can be registered", code="invalid_agent_spec")
        if spec.key in self._specs:
            raise RegistryError(f"duplicate agent {spec.agent_id} v{spec.agent_version}", code="duplicate_agent")
        for ref in spec.tools:
            tool = self._tools.get(ref.tool_id, ref.version)
            if tool is None:
                if self._tools.versions_of(ref.tool_id):
                    raise RegistryError(
                        f"{spec.agent_id} pins {ref.tool_id} v{ref.version}, which is not registered",
                        code="incompatible_tool_version",
                    )
                raise RegistryError(f"{spec.agent_id} references unknown tool {ref.tool_id}", code="unknown_tool")
            if tool.capability not in spec.capabilities:
                raise RegistryError(
                    f"{ref.tool_id} needs capability {tool.capability}, which {spec.agent_id} does not declare",
                    code="undeclared_capability",
                )
            missing_flags = tool.required_feature_flags - spec.required_feature_flags
            if missing_flags:
                raise RegistryError(
                    f"{ref.tool_id} requires flags {sorted(missing_flags)} that {spec.agent_id} does not require",
                    code="missing_tool_flag",
                )
            if tool.resource_type not in spec.resource_types:
                raise RegistryError(
                    f"{ref.tool_id} acts on {tool.resource_type.value}, outside {spec.agent_id}'s resource scope",
                    code="resource_scope_mismatch",
                )
        self._specs[spec.key] = spec
        return spec

    def freeze(self) -> "AgentRegistry":
        self._frozen = True
        return self

    @property
    def frozen(self) -> bool:
        return self._frozen

    def get(self, agent_id: object, version: object) -> Optional[AgentSpec]:
        if not isinstance(agent_id, str) or isinstance(version, bool) or not isinstance(version, int):
            return None
        return self._specs.get((agent_id, version))

    def all(self) -> Mapping[tuple[str, int], AgentSpec]:
        return MappingProxyType(dict(self._specs))

"""Versioned Tool Registry contract.

A ``ToolSpec`` DESCRIBES a trusted PatelRep business operation an agent might one day request. It never holds a
callable, a module reference that is imported, a SQL string or a URL: there is nothing in a spec that can run. The
operation itself stays in its domain router/service; H2 will bind a spec to that shared operation behind the Tool
Gateway, and H0 has no dispatcher at all.

Every security-relevant field is REQUIRED (no defaults), so a contract with missing configuration fails validation
instead of becoming permissive. Cross-field rules make a write tool impossible to declare without human approval,
idempotency and immutable audit, and make a tool unable to grant a role its domain capability does not.

Tool names coming from a model are untrusted: ``ToolRegistry.resolve_untrusted`` returns a spec only for an exact,
registered (id, version) pair and returns ``None`` for anything else -- it never fuzzy-matches.
"""
from __future__ import annotations

import re
from types import MappingProxyType
from typing import Any, Mapping, Optional

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, field_validator, model_validator

from core.feature_registry import FEATURE_REGISTRY
from services.agent_harness.errors import RegistryError
from services.agent_harness.vocabulary import (
    CAPABILITY_CATALOG,
    HUMAN_AUTHORITY_CONSEQUENCES,
    IDENTITY_CLAIM_KEYS,
    AccessMode,
    ApprovalRequirement,
    AuditLevel,
    IdempotencyPolicy,
    ResourceType,
    RiskLevel,
)

TOOL_ID_PATTERN = r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,4}$"
_TOOL_ID_RE = re.compile(TOOL_ID_PATTERN)
MAX_TOOL_TIMEOUT_SECONDS = 120
MAX_TOOL_OUTPUT_BYTES = 256 * 1024
MAX_TOOL_OUTPUT_ITEMS = 500
# Operation families that are never acceptable agent tools, whatever a spec claims about itself.
FORBIDDEN_DOMAINS = frozenset({"shell", "python", "sql", "http", "filesystem", "repository", "deploy"})


def _check_object_schema(schema: Any, label: str) -> dict:
    """Input/output schemas must be closed JSON objects: a model cannot smuggle undeclared fields through."""
    if not isinstance(schema, dict):
        raise ValueError(f"{label} must be a JSON-schema object")
    if schema.get("type") != "object":
        raise ValueError(f"{label} must declare type 'object'")
    if schema.get("additionalProperties") is not False:
        raise ValueError(f"{label} must set additionalProperties to false")
    props = schema.get("properties")
    if not isinstance(props, dict):
        raise ValueError(f"{label} must declare properties")
    required = schema.get("required", [])
    if not isinstance(required, list) or any(r not in props for r in required):
        raise ValueError(f"{label} lists a required field it does not declare")
    claims = IDENTITY_CLAIM_KEYS & set(props)
    if claims:
        raise ValueError(f"{label} may not declare identity/authority fields: {sorted(claims)}")
    if "$ref" in str(schema):
        raise ValueError(f"{label} may not use $ref (schemas are self-contained)")
    return schema


class ToolRef(BaseModel):
    """An agent's pin on one exact tool version."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    tool_id: StrictStr = Field(pattern=TOOL_ID_PATTERN)
    version: StrictInt = Field(ge=1, le=999)

    @property
    def key(self) -> tuple[str, int]:
        return (self.tool_id, self.version)


class ToolSpec(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    tool_id: StrictStr = Field(pattern=TOOL_ID_PATTERN)
    version: StrictInt = Field(ge=1, le=999)
    description: str = Field(min_length=1, max_length=500)
    input_schema: dict
    output_schema: dict
    capability: str
    access: AccessMode
    risk: RiskLevel
    allowed_roles: frozenset[str]
    allowed_system_principals: frozenset[str]
    resource_type: ResourceType
    requires_resource_id: StrictBool
    required_feature_flags: frozenset[str]
    approval: ApprovalRequirement
    timeout_seconds: StrictInt = Field(ge=1, le=MAX_TOOL_TIMEOUT_SECONDS)
    idempotency: IdempotencyPolicy
    audit: AuditLevel
    max_output_bytes: StrictInt = Field(ge=1, le=MAX_TOOL_OUTPUT_BYTES)
    max_output_items: StrictInt = Field(ge=1, le=MAX_TOOL_OUTPUT_ITEMS)
    owning_domain: str = Field(pattern=r"^[a-z][a-z0-9_]{1,31}$")
    owning_operation: str = Field(min_length=1, max_length=200)  # documentation pointer, never imported

    @field_validator("input_schema")
    @classmethod
    def _input_schema(cls, value: dict) -> dict:
        return _check_object_schema(value, "input_schema")

    @field_validator("output_schema")
    @classmethod
    def _output_schema(cls, value: dict) -> dict:
        return _check_object_schema(value, "output_schema")

    @model_validator(mode="after")
    def _cross_field_rules(self) -> "ToolSpec":
        cap = CAPABILITY_CATALOG.get(self.capability)
        if cap is None:
            raise ValueError(f"unknown capability {self.capability!r}")
        if self.access is not cap.access:
            raise ValueError(f"access {self.access.value} does not match capability access {cap.access.value}")
        if self.owning_domain != cap.domain:
            raise ValueError("owning_domain must match the capability's domain")
        if self.owning_domain in FORBIDDEN_DOMAINS:
            raise ValueError(f"{self.owning_domain} operations can never be agent tools")
        if not self.allowed_roles and not self.allowed_system_principals:
            raise ValueError("a tool must name at least one authorized role or system principal")
        widened = self.allowed_roles - cap.granted_roles
        if widened:
            raise ValueError(f"allowed_roles exceed the capability's canonical grant: {sorted(widened)}")
        unknown_flags = self.required_feature_flags - FEATURE_REGISTRY.keys()
        if unknown_flags:
            raise ValueError(f"unregistered feature flags: {sorted(unknown_flags)}")
        if self.resource_type is not ResourceType.HOTEL and not self.requires_resource_id:
            raise ValueError("a tool scoped to a specific resource type must require a resource id")
        if self.access is AccessMode.READ:
            if self.approval is not ApprovalRequirement.NONE or self.idempotency is not IdempotencyPolicy.NOT_APPLICABLE:
                raise ValueError("read tools declare approval=none and idempotency=not_applicable")
        else:
            if self.approval is not ApprovalRequirement.HUMAN_APPROVAL:
                raise ValueError("write tools require human approval in manifest schema v1")
            if self.idempotency is not IdempotencyPolicy.REQUIRED_KEY:
                raise ValueError("write tools require an idempotency key")
            if self.audit is not AuditLevel.IMMUTABLE_EVENT:
                raise ValueError("write tools require an immutable audit event")
            if self.risk is RiskLevel.LOW:
                raise ValueError("write tools are at least medium risk")
            if self.allowed_system_principals:
                raise ValueError("system principals may not hold write tools in manifest schema v1")
        if cap.consequence in HUMAN_AUTHORITY_CONSEQUENCES and self.risk.rank < RiskLevel.HIGH.rank:
            raise ValueError(f"{cap.consequence.value} tools must be classified high or critical risk")
        return self

    @property
    def key(self) -> tuple[str, int]:
        return (self.tool_id, self.version)


class ToolRegistry:
    """In-process, append-only registry of tool contracts. ``freeze()`` makes it immutable."""

    def __init__(self) -> None:
        self._specs: dict[tuple[str, int], ToolSpec] = {}
        self._frozen = False

    def register(self, spec: ToolSpec) -> ToolSpec:
        if self._frozen:
            raise RegistryError("tool registry is frozen", code="registry_frozen")
        if not isinstance(spec, ToolSpec):
            raise RegistryError("only validated ToolSpec instances can be registered", code="invalid_tool_spec")
        if spec.key in self._specs:
            raise RegistryError(f"duplicate tool {spec.tool_id} v{spec.version}", code="duplicate_tool")
        self._specs[spec.key] = spec
        return spec

    def freeze(self) -> "ToolRegistry":
        self._frozen = True
        return self

    @property
    def frozen(self) -> bool:
        return self._frozen

    def get(self, tool_id: str, version: int) -> Optional[ToolSpec]:
        return self._specs.get((tool_id, version))

    def versions_of(self, tool_id: str) -> tuple[int, ...]:
        return tuple(sorted(v for (tid, v) in self._specs if tid == tool_id))

    def resolve_untrusted(self, name: object, version: object) -> Optional[ToolSpec]:
        """Resolve a model-suggested tool. Anything other than an exact registered (str, int) pair is ``None``."""
        if not isinstance(name, str) or isinstance(version, bool) or not isinstance(version, int):
            return None
        if not _TOOL_ID_RE.match(name):
            return None
        return self._specs.get((name, version))

    def all(self) -> Mapping[tuple[str, int], ToolSpec]:
        return MappingProxyType(dict(self._specs))

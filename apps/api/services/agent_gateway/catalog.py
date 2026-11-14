"""The reviewed H2 tool contracts and the one agent allowed to use them.

These are ordinary H0 ``ToolSpec`` / ``AgentSpec`` contracts (validated by H0's cross-field rules) plus the gateway's
stricter schema subset (``schema.assert_supported_schema``). They hold no callable: the binding of a spec to its trusted
server-side operation lives in ``bindings.py``.

Versions: ``engineering.work_orders.lookup`` / ``engineering.work_orders.assign`` are v2 because v1 is H0's
NON-executable example contract (services/agent_harness/examples.py), which stays non-executable. Changing a schema,
role set or risk here means a new version, a new binding, a new database allowlist entry (migration) and a new entry
in ``H2_EXECUTABLE_TOOLS`` -- drift tests fail otherwise.

Role sets are the INTERSECTION of the capability's canonical grant and what an agent initiator should hold; they never
widen a domain route (tests pin each against the route's require_role / module access):
  * work-order lookup: the engineering module roles (GET /work-orders/{id} itself admits any hotel member)
  * room status lookup: gm + housekeeping_supervisor (narrower than the housekeeping module and GET /rooms/{id})
  * work-order assign: chief_engineer + gm, exactly POST /work-orders/{id}/assign
No tool names a system principal: read-only does not mean available to automation.
"""
from __future__ import annotations

from decimal import Decimal
from types import MappingProxyType
from typing import Mapping

from services.agent_gateway.schema import assert_supported_schema
from services.agent_harness.agents import AGENT_HARNESS_FLAG, AGENT_MANIFEST_SCHEMA_V1, AgentRegistry, AgentSpec, ExecutionLimits
from services.agent_harness.tools import ToolRef, ToolRegistry, ToolSpec
from services.agent_harness.vocabulary import (
    AccessMode,
    ApprovalRequirement,
    AuditLevel,
    AutonomyLevel,
    IdempotencyPolicy,
    ProductFamily,
    ResourceType,
    RiskLevel,
    TriggerType,
)

DISPATCH_AGENT_ID = "engineering.dispatch_assistant"
DISPATCH_AGENT_VERSION = 1
APPROVAL_POLICY_ID = "human_approval.independent_manager.v1"
APPROVAL_TTL_SECONDS = 3_600

_UUID = {"type": "string", "format": "uuid"}
_NULL_UUID = {"type": ["string", "null"], "format": "uuid"}
_SHORT = {"type": "string", "maxLength": 40}
_NULL_SHORT = {"type": ["string", "null"], "maxLength": 40}
_TIMESTAMP = {"type": ["string", "null"], "maxLength": 40}

WORK_ORDER_LOOKUP_V2 = ToolSpec(
    tool_id="engineering.work_orders.lookup",
    version=2,
    description="Read one work order in the caller's hotel: number, title, status, priority, room and assignee.",
    input_schema={"type": "object", "additionalProperties": False,
                  "properties": {"work_order_id": _UUID}, "required": ["work_order_id"]},
    output_schema={"type": "object", "additionalProperties": False, "properties": {
        "id": _UUID, "work_order_number": {"type": ["integer", "null"], "minimum": 0},
        "title": {"type": "string", "maxLength": 120}, "status": _SHORT, "priority": _SHORT,
        "assigned_to": _NULL_UUID, "room_number": _NULL_SHORT, "due_at": _TIMESTAMP},
        "required": ["id", "title", "status", "priority", "assigned_to"]},
    capability="engineering.work_orders.read",
    access=AccessMode.READ,
    risk=RiskLevel.LOW,
    allowed_roles=frozenset({"gm", "chief_engineer", "engineer", "housekeeping_supervisor"}),
    allowed_system_principals=frozenset(),
    resource_type=ResourceType.WORK_ORDER,
    requires_resource_id=True,
    required_feature_flags=frozenset({AGENT_HARNESS_FLAG}),
    approval=ApprovalRequirement.NONE,
    timeout_seconds=5,
    idempotency=IdempotencyPolicy.NOT_APPLICABLE,
    audit=AuditLevel.METADATA,
    max_output_bytes=2_048,
    max_output_items=1,
    owning_domain="engineering",
    owning_operation="services/agent_gateway/adapters.py read_work_order_summary (tenant-scoped work_orders read)",
)

ROOM_STATUS_LOOKUP_V1 = ToolSpec(
    tool_id="housekeeping.rooms.status_lookup",
    version=1,
    description="Read one room's operational status in the caller's hotel. Never returns guest names or notes.",
    input_schema={"type": "object", "additionalProperties": False,
                  "properties": {"room_id": _UUID}, "required": ["room_id"]},
    output_schema={"type": "object", "additionalProperties": False, "properties": {
        "id": _UUID, "room_number": {"type": "string", "maxLength": 20}, "floor": {"type": ["integer", "null"]},
        "building": _NULL_SHORT, "is_active": {"type": "boolean"}, "status": _NULL_SHORT, "fo_status": _NULL_SHORT,
        "clean_type": _NULL_SHORT, "do_not_disturb": {"type": ["boolean", "null"]}, "updated_at": _TIMESTAMP},
        "required": ["id", "room_number", "is_active", "status"]},
    capability="housekeeping.rooms.read",
    access=AccessMode.READ,
    risk=RiskLevel.LOW,
    allowed_roles=frozenset({"gm", "housekeeping_supervisor"}),
    allowed_system_principals=frozenset(),
    resource_type=ResourceType.ROOM,
    requires_resource_id=True,
    required_feature_flags=frozenset({AGENT_HARNESS_FLAG}),
    approval=ApprovalRequirement.NONE,
    timeout_seconds=5,
    idempotency=IdempotencyPolicy.NOT_APPLICABLE,
    audit=AuditLevel.METADATA,
    max_output_bytes=1_024,
    max_output_items=1,
    owning_domain="housekeeping",
    owning_operation="services/agent_gateway/adapters.py read_room_status (tenant-scoped rooms + room_status read)",
)

WORK_ORDER_ASSIGN_V2 = ToolSpec(
    tool_id="engineering.work_orders.assign",
    version=2,
    description=("Propose assigning one open work order to an active engineer in the same hotel. Executes only after "
                 "a different, currently authorized manager approves this exact action."),
    input_schema={"type": "object", "additionalProperties": False, "properties": {
        "work_order_id": _UUID, "assignee_user_id": _UUID, "expected_assigned_to": _NULL_UUID,
        "note": {"type": ["string", "null"], "maxLength": 280}},
        "required": ["work_order_id", "assignee_user_id", "expected_assigned_to"]},
    output_schema={"type": "object", "additionalProperties": False, "properties": {
        "id": _UUID, "assigned_to": _UUID, "status": _SHORT, "changed": {"type": "boolean"}},
        "required": ["id", "assigned_to", "status", "changed"]},
    capability="engineering.work_orders.assign",
    access=AccessMode.WRITE,
    risk=RiskLevel.MEDIUM,
    allowed_roles=frozenset({"gm", "chief_engineer"}),
    allowed_system_principals=frozenset(),
    resource_type=ResourceType.WORK_ORDER,
    requires_resource_id=True,
    required_feature_flags=frozenset({AGENT_HARNESS_FLAG}),
    approval=ApprovalRequirement.HUMAN_APPROVAL,
    timeout_seconds=10,
    idempotency=IdempotencyPolicy.REQUIRED_KEY,
    audit=AuditLevel.IMMUTABLE_EVENT,
    max_output_bytes=1_024,
    max_output_items=1,
    owning_domain="engineering",
    owning_operation="supabase work_order_assign_apply (migration 242), shared with POST /work-orders/{wo_id}/assign",
)

GATEWAY_TOOL_SPECS: tuple[ToolSpec, ...] = (WORK_ORDER_LOOKUP_V2, ROOM_STATUS_LOOKUP_V1, WORK_ORDER_ASSIGN_V2)

DISPATCH_AGENT_V1 = AgentSpec(
    manifest_schema=AGENT_MANIFEST_SCHEMA_V1,
    agent_id=DISPATCH_AGENT_ID,
    agent_version=DISPATCH_AGENT_VERSION,
    name="Engineering dispatch assistant (H2, human-approved)",
    product_family=ProductFamily.OPERATIONS,
    description=("Looks up a work order or a room's status and may PROPOSE assigning a work order. Every assignment "
                 "needs an independent human approval. No model is called in H2."),
    tools=tuple(ToolRef(tool_id=s.tool_id, version=s.version) for s in GATEWAY_TOOL_SPECS),
    capabilities=frozenset(s.capability for s in GATEWAY_TOOL_SPECS),
    autonomy_ceiling=AutonomyLevel.HUMAN_APPROVED,
    required_feature_flags=frozenset({AGENT_HARNESS_FLAG}),
    resource_types=frozenset({ResourceType.WORK_ORDER, ResourceType.ROOM}),
    triggers=frozenset({TriggerType.USER_REQUEST}),
    limits=ExecutionLimits(max_steps=4, max_tool_calls=4, max_runtime_seconds=3_600, max_credits_per_run=Decimal("1")),
    model_purpose="engineering_dispatch",
    approval_policies=frozenset({APPROVAL_POLICY_ID}),
    # A reviewed, shippable manifest. Execution still needs platform enablement, the tenant entitlement, a per-property
    # grant and (for writes) an approval -- all default off.
    enabled=True,
)


def _build() -> tuple[ToolRegistry, AgentRegistry]:
    for spec in GATEWAY_TOOL_SPECS:
        assert_supported_schema(spec.input_schema)
        assert_supported_schema(spec.output_schema)
    tools = ToolRegistry()
    for spec in GATEWAY_TOOL_SPECS:
        tools.register(spec)
    tools.freeze()
    agents = AgentRegistry(tools)
    agents.register(DISPATCH_AGENT_V1)
    return tools, agents.freeze()


GATEWAY_TOOLS, GATEWAY_AGENTS = _build()

# Mirror of the database allowlist (agent__gateway_tool_spec, migration 243). A drift test compares the two.
DB_ALLOWLIST: Mapping[tuple[str, int, str, int], Mapping[str, object]] = MappingProxyType({
    (DISPATCH_AGENT_ID, DISPATCH_AGENT_VERSION, s.tool_id, s.version): MappingProxyType({
        "access": s.access.value, "risk": s.risk.value, "resource_type": s.resource_type.value,
        "roles": tuple(sorted(s.allowed_roles)),
    })
    for s in GATEWAY_TOOL_SPECS
})

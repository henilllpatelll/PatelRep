"""NON-EXECUTABLE example contracts demonstrating the H0 manifests. Nothing here is wired to any route or service.

* ``engineering.work_orders.lookup`` v1 -- read-only work-order lookup.
* ``engineering.work_orders.assign`` v1 -- human-approval-required work-order assignment.
* ``examples.work_order_observer`` v1 -- a DISABLED example agent pinned to both. It is not the Engineering Agent.

``owning_operation`` strings are documentation pointers to the shared business operation a future tool would call;
they are never imported or resolved.
"""
from __future__ import annotations

from decimal import Decimal

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

_UUID = {"type": "string", "pattern": "^[0-9a-fA-F-]{36}$"}

WORK_ORDER_LOOKUP_V1 = ToolSpec(
    tool_id="engineering.work_orders.lookup",
    version=1,
    description="Read one work order in the caller's hotel: status, priority, room, assignee and timestamps.",
    input_schema={"type": "object", "additionalProperties": False,
                  "properties": {"work_order_id": _UUID}, "required": ["work_order_id"]},
    output_schema={"type": "object", "additionalProperties": False, "properties": {
        "id": _UUID, "status": {"type": "string"}, "priority": {"type": "string"},
        "room_number": {"type": ["string", "null"]}, "assigned_to": {"type": ["string", "null"]},
        "due_at": {"type": ["string", "null"]}}, "required": ["id", "status", "priority"]},
    capability="engineering.work_orders.read",
    access=AccessMode.READ,
    risk=RiskLevel.LOW,
    allowed_roles=frozenset({"gm", "chief_engineer", "engineer", "housekeeping_supervisor"}),
    allowed_system_principals=frozenset({"harness.scheduled_observer"}),
    resource_type=ResourceType.WORK_ORDER,
    requires_resource_id=True,
    required_feature_flags=frozenset({AGENT_HARNESS_FLAG}),
    approval=ApprovalRequirement.NONE,
    timeout_seconds=5,
    idempotency=IdempotencyPolicy.NOT_APPLICABLE,
    audit=AuditLevel.METADATA,
    max_output_bytes=4_096,
    max_output_items=1,
    owning_domain="engineering",
    owning_operation="routers/work_orders.py GET /work-orders/{wo_id} (shared read operation to be extracted in H2)",
)

WORK_ORDER_ASSIGN_V1 = ToolSpec(
    tool_id="engineering.work_orders.assign",
    version=1,
    description="Propose assigning one work order to an active engineer in the same hotel. Needs human approval.",
    input_schema={"type": "object", "additionalProperties": False, "properties": {
        "work_order_id": _UUID, "assignee_user_id": _UUID, "idempotency_key": {"type": "string", "maxLength": 64},
        "note": {"type": "string", "maxLength": 280}}, "required": ["work_order_id", "assignee_user_id", "idempotency_key"]},
    output_schema={"type": "object", "additionalProperties": False, "properties": {
        "id": _UUID, "assigned_to": _UUID, "status": {"type": "string"}}, "required": ["id", "assigned_to", "status"]},
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
    max_output_bytes=2_048,
    max_output_items=1,
    owning_domain="engineering",
    owning_operation="routers/work_orders.py POST /work-orders/{wo_id}/assign (shared write operation to be extracted in H2)",
)

EXAMPLE_AGENT_V1 = AgentSpec(
    manifest_schema=AGENT_MANIFEST_SCHEMA_V1,
    agent_id="examples.work_order_observer",
    agent_version=1,
    name="Example work-order observer (non-executable)",
    product_family=ProductFamily.OPERATIONS,
    description="Contract demonstration only. Reads a work order and may PROPOSE an assignment for human approval.",
    tools=(ToolRef(tool_id="engineering.work_orders.lookup", version=1),
           ToolRef(tool_id="engineering.work_orders.assign", version=1)),
    capabilities=frozenset({"engineering.work_orders.read", "engineering.work_orders.assign"}),
    autonomy_ceiling=AutonomyLevel.HUMAN_APPROVED,
    required_feature_flags=frozenset({AGENT_HARNESS_FLAG}),
    resource_types=frozenset({ResourceType.WORK_ORDER}),
    triggers=frozenset({TriggerType.USER_REQUEST}),
    limits=ExecutionLimits(max_steps=4, max_tool_calls=4, max_runtime_seconds=60,
                           max_credits_per_run=Decimal("5")),
    model_purpose="agent_example",
    approval_policies=frozenset({"human_approval.single_authorized_manager.v1"}),
)


def build_example_registries() -> tuple[ToolRegistry, AgentRegistry]:
    """Fresh, frozen registries holding only the example contracts."""
    tools = ToolRegistry()
    tools.register(WORK_ORDER_LOOKUP_V1)
    tools.register(WORK_ORDER_ASSIGN_V1)
    tools.freeze()
    agents = AgentRegistry(tools)
    agents.register(EXAMPLE_AGENT_V1)
    return tools, agents.freeze()

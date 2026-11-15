"""H5 reviewed tool contracts and the two Operations specialist manifests (ADR-0004).

Pure contract data: no callable, no import of anything that executes. ``catalog.py`` registers these next to the
H2 contracts in the same frozen registries; ``bindings.py`` binds each one to its trusted operation.

Minimum-data rule for every read below: identifiers, enumerations, booleans and counts only. No guest names, stay
details, room or work-order notes, photos, comments, staff names, phone numbers or emails. Keys that look like
identity claims (``user_id``, ``role``) are refused by the gateway schema subset, so staff appear as ``staff_id`` +
``position`` -- a description of a candidate, never a claim about the caller.

Role sets are the intersection of the capability's canonical grant and the domain route each tool mirrors:
  * assignment candidates (Engineering): chief_engineer + gm, the roles that may assign (POST /work-orders/{id}/assign)
  * readiness lookup: gm + housekeeping_supervisor (the same set as housekeeping.rooms.status_lookup v1)
  * housekeeping candidates / assign: gm + housekeeping_supervisor, exactly POST /housekeeping/assignments/batch-publish
"""
from __future__ import annotations

from decimal import Decimal

from services.agent_harness.agents import AGENT_HARNESS_FLAG, AGENT_MANIFEST_SCHEMA_V1, AgentSpec, ExecutionLimits
from services.agent_harness.tools import ToolRef, ToolSpec
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

ENGINEERING_SPECIALIST_ID = "engineering.dispatch_assistant"
ENGINEERING_SPECIALIST_VERSION = 2
HOUSEKEEPING_SPECIALIST_ID = "housekeeping.room_readiness_assistant"
HOUSEKEEPING_SPECIALIST_VERSION = 1
H5_APPROVAL_POLICY_ID = "human_approval.independent_manager.v1"

MAX_ENGINEERING_CANDIDATES = 25
MAX_HOUSEKEEPING_CANDIDATES = 40
ASSIGNABLE_ROOM_STATUSES = ("DIRTY", "PICKUP", "OCCUPIED")
ROOM_STATUSES = ("DIRTY", "IN_PROGRESS", "CLEAN", "INSPECTED", "OOO", "PICKUP", "OCCUPIED")
READINESS_BLOCKERS = ("dnd", "service_declined", "return_later", "occupancy_discrepancy", "room_not_assignable",
                      "cleaning_started", "room_inactive")

_UUID = {"type": "string", "format": "uuid"}
_NULL_UUID = {"type": ["string", "null"], "format": "uuid"}
_DATE = {"type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", "maxLength": 10}
_COUNT = {"type": "integer", "minimum": 0, "maximum": 10_000}

ASSIGNMENT_CANDIDATES_V1 = ToolSpec(
    tool_id="engineering.work_orders.assignment_candidates",
    version=1,
    description=("List the engineers in the caller's hotel who are eligible to be assigned one work order, with how "
                 "many assignable work orders each already holds. Ids and counts only; no names."),
    input_schema={"type": "object", "additionalProperties": False,
                  "properties": {"work_order_id": _UUID}, "required": ["work_order_id"]},
    output_schema={"type": "object", "additionalProperties": False, "properties": {
        "work_order_id": _UUID,
        "candidates": {"type": "array", "maxItems": MAX_ENGINEERING_CANDIDATES, "items": {
            "type": "object", "additionalProperties": False, "properties": {
                "staff_id": _UUID, "position": {"type": "string", "enum": ["engineer"]},
                "open_work_orders": _COUNT},
            "required": ["staff_id", "position", "open_work_orders"]}},
        "truncated": {"type": "boolean"}},
        "required": ["work_order_id", "candidates", "truncated"]},
    capability="engineering.work_orders.read",
    access=AccessMode.READ,
    risk=RiskLevel.LOW,
    allowed_roles=frozenset({"gm", "chief_engineer"}),
    allowed_system_principals=frozenset(),
    resource_type=ResourceType.WORK_ORDER,
    requires_resource_id=True,
    required_feature_flags=frozenset({AGENT_HARNESS_FLAG}),
    approval=ApprovalRequirement.NONE,
    timeout_seconds=5,
    idempotency=IdempotencyPolicy.NOT_APPLICABLE,
    audit=AuditLevel.METADATA,
    max_output_bytes=4_096,
    max_output_items=MAX_ENGINEERING_CANDIDATES,
    owning_domain="engineering",
    owning_operation=("services/agent_gateway/adapters_h5.py read_assignment_candidates (eligibility = "
                      "work_order_assign_apply: active 'engineer' role in the hotel)"),
)

ROOM_READINESS_LOOKUP_V1 = ToolSpec(
    tool_id="housekeeping.rooms.readiness_lookup",
    version=1,
    description=("Read one room's verified readiness facts for the hotel's current day: stage, clean type, current "
                 "owner and every blocker that stops an assignment. Never returns guest data or notes."),
    input_schema={"type": "object", "additionalProperties": False,
                  "properties": {"room_id": _UUID}, "required": ["room_id"]},
    output_schema={"type": "object", "additionalProperties": False, "properties": {
        "id": _UUID, "room_number": {"type": "string", "maxLength": 20},
        "is_active": {"type": "boolean"},
        "status": {"type": ["string", "null"], "enum": list(ROOM_STATUSES)},
        "fo_status": {"type": ["string", "null"], "maxLength": 10},
        "clean_type": {"type": ["string", "null"], "maxLength": 20},
        "hotel_date": _DATE,
        "current_assigned_to": _NULL_UUID,
        "assignment_source": {"type": "string", "enum": ["dated", "mirror", "none"]},
        "assignable": {"type": "boolean"},
        "blockers": {"type": "array", "maxItems": len(READINESS_BLOCKERS),
                     "items": {"type": "string", "enum": list(READINESS_BLOCKERS)}},
        "status_updated_at": {"type": ["string", "null"], "maxLength": 40}},
        "required": ["id", "room_number", "is_active", "status", "hotel_date", "current_assigned_to",
                     "assignment_source", "assignable", "blockers"]},
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
    max_output_bytes=2_048,
    max_output_items=len(READINESS_BLOCKERS),
    owning_domain="housekeeping",
    owning_operation=("services/agent_gateway/adapters_h5.py read_room_readiness (the same owner and blocker rules "
                      "as publish_assignment_batch, migration 222)"),
)

HOUSEKEEPING_CANDIDATES_V1 = ToolSpec(
    tool_id="housekeeping.room_assignments.candidates",
    version=1,
    description=("List the housekeepers in the caller's hotel who are eligible to receive a room today, with how many "
                 "rooms each already holds today. Ids and counts only; no names."),
    input_schema={"type": "object", "additionalProperties": False,
                  "properties": {"room_id": _UUID}, "required": ["room_id"]},
    output_schema={"type": "object", "additionalProperties": False, "properties": {
        "room_id": _UUID, "hotel_date": _DATE,
        "candidates": {"type": "array", "maxItems": MAX_HOUSEKEEPING_CANDIDATES, "items": {
            "type": "object", "additionalProperties": False, "properties": {
                "staff_id": _UUID,
                "position": {"type": "string", "enum": ["housekeeper", "housekeeping_supervisor"]},
                "rooms_assigned_today": _COUNT},
            "required": ["staff_id", "position", "rooms_assigned_today"]}},
        "truncated": {"type": "boolean"}},
        "required": ["room_id", "hotel_date", "candidates", "truncated"]},
    capability="housekeeping.room_assignments.read",
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
    max_output_bytes=6_144,
    max_output_items=MAX_HOUSEKEEPING_CANDIDATES,
    owning_domain="housekeeping",
    owning_operation=("services/agent_gateway/adapters_h5.py read_housekeeping_candidates (eligibility = "
                      "publish_assignment_batch: active housekeeper / housekeeping_supervisor role)"),
)

ROOM_ASSIGNMENT_ASSIGN_V1 = ToolSpec(
    tool_id="housekeeping.room_assignments.assign",
    version=1,
    description=("Propose assigning (or reassigning) ONE room for the hotel's current day to one eligible housekeeper. "
                 "Executes only after a different, currently authorized supervisor or GM approves this exact action, "
                 "through the same atomic publication the supervisor screen uses. Never changes a room's status."),
    input_schema={"type": "object", "additionalProperties": False, "properties": {
        "room_id": _UUID, "assignee_user_id": _UUID, "expected_assigned_to": _NULL_UUID,
        "assignment_date": _DATE},
        "required": ["room_id", "assignee_user_id", "expected_assigned_to", "assignment_date"]},
    output_schema={"type": "object", "additionalProperties": False, "properties": {
        "room_id": _UUID, "assigned_to": _UUID, "previous_assigned_to": _NULL_UUID,
        "assignment_date": _DATE, "kind": {"type": "string", "enum": ["assign", "reassign"]},
        "changed": {"type": "boolean"}},
        "required": ["room_id", "assigned_to", "previous_assigned_to", "assignment_date", "kind", "changed"]},
    capability="housekeeping.room_assignments.write",
    access=AccessMode.WRITE,
    risk=RiskLevel.HIGH,  # personnel consequence: workload allocation always needs a human with authority
    allowed_roles=frozenset({"gm", "housekeeping_supervisor"}),
    allowed_system_principals=frozenset(),
    resource_type=ResourceType.ROOM,
    requires_resource_id=True,
    required_feature_flags=frozenset({AGENT_HARNESS_FLAG}),
    approval=ApprovalRequirement.HUMAN_APPROVAL,
    timeout_seconds=10,
    idempotency=IdempotencyPolicy.REQUIRED_KEY,
    audit=AuditLevel.IMMUTABLE_EVENT,
    max_output_bytes=1_024,
    max_output_items=1,
    owning_domain="housekeeping",
    owning_operation=("supabase agent_tool_execute_room_assignment (migration 253) -> publish_assignment_batch "
                      "(migrations 221/222), shared with POST /housekeeping/assignments/batch-publish"),
)

H5_TOOL_SPECS: tuple[ToolSpec, ...] = (ASSIGNMENT_CANDIDATES_V1, ROOM_READINESS_LOOKUP_V1, HOUSEKEEPING_CANDIDATES_V1,
                                       ROOM_ASSIGNMENT_ASSIGN_V1)


def engineering_specialist_v2(lookup_v2: ToolSpec, assign_v2: ToolSpec) -> AgentSpec:
    """The Engineering specialist: a deliberate new version of the dispatch assistant (ADR-0004 decision 1)."""
    pins = (lookup_v2, ASSIGNMENT_CANDIDATES_V1, assign_v2)
    return AgentSpec(
        manifest_schema=AGENT_MANIFEST_SCHEMA_V1,
        agent_id=ENGINEERING_SPECIALIST_ID,
        agent_version=ENGINEERING_SPECIALIST_VERSION,
        name="Engineering specialist (H5, observe / human-approved)",
        product_family=ProductFamily.OPERATIONS,
        description=("Reviews one work order from verified facts, explains why it needs attention and may PROPOSE one "
                     "assignment to an eligible engineer. Every assignment needs an independent manager's approval."),
        tools=tuple(ToolRef(tool_id=s.tool_id, version=s.version) for s in pins),
        capabilities=frozenset(s.capability for s in pins),
        autonomy_ceiling=AutonomyLevel.HUMAN_APPROVED,
        required_feature_flags=frozenset({AGENT_HARNESS_FLAG}),
        resource_types=frozenset({ResourceType.WORK_ORDER}),
        triggers=frozenset({TriggerType.USER_REQUEST}),
        limits=ExecutionLimits(max_steps=4, max_tool_calls=4, max_runtime_seconds=3_600,
                               max_credits_per_run=Decimal("1")),
        model_purpose="engineering_dispatch",
        approval_policies=frozenset({H5_APPROVAL_POLICY_ID}),
        enabled=True,  # reviewed and shippable; execution still needs every default-off layer
    )


def housekeeping_specialist_v1(status_lookup_v1: ToolSpec) -> AgentSpec:
    pins = (status_lookup_v1, ROOM_READINESS_LOOKUP_V1, HOUSEKEEPING_CANDIDATES_V1, ROOM_ASSIGNMENT_ASSIGN_V1)
    return AgentSpec(
        manifest_schema=AGENT_MANIFEST_SCHEMA_V1,
        agent_id=HOUSEKEEPING_SPECIALIST_ID,
        agent_version=HOUSEKEEPING_SPECIALIST_VERSION,
        name="Housekeeping room-readiness specialist (H5, observe / human-approved)",
        product_family=ProductFamily.OPERATIONS,
        description=("Reviews one room's verified readiness blockers and cleaning priority and may PROPOSE assigning or "
                     "reassigning that room for today. Never marks a room clean, inspected or ready. Every assignment "
                     "needs an independent supervisor's or GM's approval."),
        tools=tuple(ToolRef(tool_id=s.tool_id, version=s.version) for s in pins),
        capabilities=frozenset(s.capability for s in pins),
        autonomy_ceiling=AutonomyLevel.HUMAN_APPROVED,
        required_feature_flags=frozenset({AGENT_HARNESS_FLAG}),
        resource_types=frozenset({ResourceType.ROOM}),
        triggers=frozenset({TriggerType.USER_REQUEST}),
        limits=ExecutionLimits(max_steps=4, max_tool_calls=4, max_runtime_seconds=3_600,
                               max_credits_per_run=Decimal("1")),
        model_purpose="housekeeping_room_readiness",
        approval_policies=frozenset({H5_APPROVAL_POLICY_ID}),
        enabled=True,
    )

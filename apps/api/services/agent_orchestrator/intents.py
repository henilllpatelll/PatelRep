"""The reviewed H5 planning intents (ADR-0004). Closed catalog; each entry is exact and versioned.

An intent fixes, on the SERVER: the one specialist agent version that may serve it, the exact tool versions a plan may
name, the resource type and the argument that must equal the verified resource id, the context the worker gathers
before planning, the closed findings vocabulary, the single write (if any) the plan may propose, and the roles that may
ask. The database mirrors the roles and resource type (``agent__planning_intent_roles`` /
``agent__planning_intent_resource``, migration 252); drift tests pin the two.
"""
from __future__ import annotations

from types import MappingProxyType
from typing import Mapping

from services.agent_gateway.catalog import (
    ENGINEERING_SPECIALIST_V2,
    HOUSEKEEPING_SPECIALIST_V1,
    ROOM_STATUS_LOOKUP_V1,
    WORK_ORDER_ASSIGN_V2,
    WORK_ORDER_LOOKUP_V2,
)
from services.agent_gateway.catalog_h5 import (
    ASSIGNMENT_CANDIDATES_V1,
    HOUSEKEEPING_CANDIDATES_V1,
    ROOM_ASSIGNMENT_ASSIGN_V1,
    ROOM_READINESS_LOOKUP_V1,
)
from services.agent_orchestrator.catalog import WorkloadClass
from services.agent_orchestrator.plans import IntentSpec

PLAN_SCHEMA_V2 = "patelrep.plan/v2"

ENGINEERING_FINDINGS = frozenset({
    "work_order_overdue", "work_order_unassigned", "work_order_high_priority", "work_order_on_hold",
    "work_order_escalated", "work_order_closed", "work_order_due_soon",
})
ENGINEERING_ASSIGNMENT_FINDINGS = frozenset({
    "assignee_has_lowest_workload", "no_eligible_engineer", "already_assigned", "reassignment_suggested",
})
HOUSEKEEPING_FINDINGS = frozenset({
    "room_unassigned", "room_dnd", "room_service_declined", "room_return_later", "room_occupancy_discrepancy",
    "room_not_assignable", "cleaning_started", "room_occupied_dirty", "room_vacant_dirty", "room_inactive",
})
HOUSEKEEPING_ASSIGNMENT_FINDINGS = frozenset({
    "assignee_has_lowest_workload", "no_eligible_housekeeper", "already_assigned", "reassignment_suggested",
})

_ENG = ENGINEERING_SPECIALIST_V2.key
_HK = HOUSEKEEPING_SPECIALIST_V1.key

ENGINEERING_TRIAGE = IntentSpec(
    intent="engineering.work_order_triage", version=1, resource_type="work_order",
    workload=WorkloadClass.ROUTINE_REASONING.value, candidate_agents=(_ENG,),
    allowed_tools=frozenset({WORK_ORDER_LOOKUP_V2.key}),
    resource_argument=MappingProxyType({WORK_ORDER_LOOKUP_V2.key: "work_order_id"}),
    initiator_roles=frozenset({"chief_engineer", "engineer", "gm"}),
    description=("Review ONE work order from the verified facts provided and explain, with closed finding codes and a "
                 "priority assessment, whether and why it needs attention. Read-only: no change may be proposed."),
    plan_schema=PLAN_SCHEMA_V2, context_reads=((*WORK_ORDER_LOOKUP_V2.key, "work_order_id"),),
    allowed_findings=ENGINEERING_FINDINGS, write_tool=None, specialist=_ENG,
)

ENGINEERING_DISPATCH_RECOMMENDATION = IntentSpec(
    intent="engineering.work_order_dispatch_recommendation", version=1, resource_type="work_order",
    workload=WorkloadClass.STRUCTURED_TOOL_PROPOSALS.value, candidate_agents=(_ENG,),
    allowed_tools=frozenset({WORK_ORDER_LOOKUP_V2.key, ASSIGNMENT_CANDIDATES_V1.key, WORK_ORDER_ASSIGN_V2.key}),
    resource_argument=MappingProxyType({WORK_ORDER_LOOKUP_V2.key: "work_order_id",
                                        ASSIGNMENT_CANDIDATES_V1.key: "work_order_id",
                                        WORK_ORDER_ASSIGN_V2.key: "work_order_id"}),
    initiator_roles=frozenset({"chief_engineer", "gm"}),  # = the assign tool's roles (POST /work-orders/{id}/assign)
    description=("Recommend how to dispatch ONE work order from the verified facts provided. You may PROPOSE at most one "
                 "assignment to one of the listed eligible engineers; a different manager must approve it."),
    plan_schema=PLAN_SCHEMA_V2,
    context_reads=((*WORK_ORDER_LOOKUP_V2.key, "work_order_id"), (*ASSIGNMENT_CANDIDATES_V1.key, "work_order_id")),
    allowed_findings=ENGINEERING_FINDINGS | ENGINEERING_ASSIGNMENT_FINDINGS, write_tool=WORK_ORDER_ASSIGN_V2.key,
    specialist=_ENG,
)

HOUSEKEEPING_READINESS_REVIEW = IntentSpec(
    intent="housekeeping.room_readiness_review", version=1, resource_type="room",
    workload=WorkloadClass.ROUTINE_REASONING.value, candidate_agents=(_HK,),
    allowed_tools=frozenset({ROOM_STATUS_LOOKUP_V1.key, ROOM_READINESS_LOOKUP_V1.key}),
    resource_argument=MappingProxyType({ROOM_STATUS_LOOKUP_V1.key: "room_id", ROOM_READINESS_LOOKUP_V1.key: "room_id"}),
    initiator_roles=frozenset({"gm", "housekeeping_supervisor"}),
    description=("Review ONE room's verified readiness facts for today and explain, with closed finding codes and a "
                 "cleaning-priority assessment, what blocks it and what a supervisor should look at. Read-only. You can "
                 "never declare a room clean, inspected, vacant or ready."),
    plan_schema=PLAN_SCHEMA_V2,
    context_reads=((*ROOM_STATUS_LOOKUP_V1.key, "room_id"), (*ROOM_READINESS_LOOKUP_V1.key, "room_id")),
    allowed_findings=HOUSEKEEPING_FINDINGS, write_tool=None, specialist=_HK,
)

HOUSEKEEPING_ASSIGNMENT_RECOMMENDATION = IntentSpec(
    intent="housekeeping.room_assignment_recommendation", version=1, resource_type="room",
    workload=WorkloadClass.STRUCTURED_TOOL_PROPOSALS.value, candidate_agents=(_HK,),
    allowed_tools=frozenset({ROOM_READINESS_LOOKUP_V1.key, HOUSEKEEPING_CANDIDATES_V1.key,
                             ROOM_ASSIGNMENT_ASSIGN_V1.key}),
    resource_argument=MappingProxyType({ROOM_READINESS_LOOKUP_V1.key: "room_id",
                                        HOUSEKEEPING_CANDIDATES_V1.key: "room_id",
                                        ROOM_ASSIGNMENT_ASSIGN_V1.key: "room_id"}),
    initiator_roles=frozenset({"gm", "housekeeping_supervisor"}),  # = batch-publish's require_role
    description=("Recommend who should clean ONE room today from the verified facts provided. You may PROPOSE at most "
                 "one assignment or reassignment of this room to one of the listed eligible housekeepers, for the "
                 "listed hotel date; a different supervisor or GM must approve it. Never change a room's status."),
    plan_schema=PLAN_SCHEMA_V2,
    context_reads=((*ROOM_READINESS_LOOKUP_V1.key, "room_id"), (*HOUSEKEEPING_CANDIDATES_V1.key, "room_id")),
    allowed_findings=HOUSEKEEPING_FINDINGS | HOUSEKEEPING_ASSIGNMENT_FINDINGS, write_tool=ROOM_ASSIGNMENT_ASSIGN_V1.key,
    specialist=_HK,
)

H5_INTENTS: Mapping[tuple[str, int], IntentSpec] = MappingProxyType({
    (s.intent, s.version): s for s in (ENGINEERING_TRIAGE, ENGINEERING_DISPATCH_RECOMMENDATION,
                                       HOUSEKEEPING_READINESS_REVIEW, HOUSEKEEPING_ASSIGNMENT_RECOMMENDATION)})

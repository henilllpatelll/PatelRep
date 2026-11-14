"""H0 default-deny policy: every unknown, malformed, mismatched or unauthorized input is refused."""
from __future__ import annotations

from datetime import timedelta

import pytest

from core.roles import ALL_ROLES
from services.agent_harness.autonomy import AutonomyGrant, effective_autonomy
from services.agent_harness.controls import load_runtime_controls
from services.agent_harness.policy import (
    ApprovalEvidence,
    AuthorizationDecision,
    Outcome,
    ReasonCode,
    VerifiedResource,
    action_digest,
)
from services.agent_harness.tools import ToolRef
from services.agent_harness.vocabulary import AutonomyLevel, ResourceType, RiskLevel, TriggerType
from tests.smoke.agent_harness_support import (
    AGENT_ID, ASSIGN, HOTEL_A, HOTEL_B, LOOKUP, NOW, USER_ID, WORK_ORDER_ID, agent_variant, controls, decide,
    human_ctx, registries, request, system_ctx, tenant, tool_variant, work_order,
)

ASSIGN_ARGS = {"work_order_id": WORK_ORDER_ID, "assignee_user_id": "55555555-5555-4555-8555-555555555555",
               "idempotency_key": "k-1"}
ROOM_ASSIGN = tool_variant(
    ASSIGN, tool_id="housekeeping.room_assignments.propose", capability="housekeeping.room_assignments.write",
    owning_domain="housekeeping", allowed_roles=frozenset({"housekeeping_supervisor", "gm"}),
    resource_type=ResourceType.ROOM, risk=RiskLevel.HIGH,
)
CREDIT = tool_variant(
    ASSIGN, tool_id="billing.credits.propose", capability="billing.credit_adjustment", owning_domain="billing",
    allowed_roles=frozenset({"gm"}), resource_type=ResourceType.BILLING_ACCOUNT, risk=RiskLevel.HIGH,
)
ROOM = VerifiedResource(ResourceType.ROOM, "66666666-6666-4666-8666-666666666666", HOTEL_A)
ACCOUNT = VerifiedResource(ResourceType.BILLING_ACCOUNT, HOTEL_A, HOTEL_A)


def _wide_registry():
    """The example agent, enabled, plus housekeeping and billing write tools and both triggers."""
    agent = agent_variant(
        enabled=True,
        tools=(ToolRef(tool_id=LOOKUP.tool_id, version=1), ToolRef(tool_id=ASSIGN.tool_id, version=1),
               ToolRef(tool_id=ROOM_ASSIGN.tool_id, version=1), ToolRef(tool_id=CREDIT.tool_id, version=1)),
        capabilities=frozenset({"engineering.work_orders.read", "engineering.work_orders.assign",
                                "housekeeping.room_assignments.write", "billing.credit_adjustment"}),
        resource_types=frozenset({ResourceType.WORK_ORDER, ResourceType.ROOM, ResourceType.BILLING_ACCOUNT}),
        triggers=frozenset({TriggerType.USER_REQUEST, TriggerType.SCHEDULE}),
    )
    return registries(agent=agent, tools=(LOOKUP, ASSIGN, ROOM_ASSIGN, CREDIT))


WIDE = _wide_registry()


def _grants(*tools):
    """The property's explicit human-approved autonomy grant for each tool (no grant = observe only)."""
    return [AutonomyGrant(hotel_id=HOTEL_A, agent_id=AGENT_ID, tool_id=t.tool_id, tool_version=t.version,
                          max_level=AutonomyLevel.HUMAN_APPROVED, max_risk=t.risk, granted_by_user_id=USER_ID,
                          granted_at=NOW - timedelta(days=1)) for t in tools]


GRANTS = _grants(ASSIGN, ROOM_ASSIGN, CREDIT)


def _approval(tool=ASSIGN, resource=None, args=ASSIGN_ARGS, **changes):
    resource = resource or work_order()
    data = dict(
        approval_id="appr-1", approval_policy_id="human_approval.single_authorized_manager.v1", hotel_id=HOTEL_A,
        agent_id=AGENT_ID, agent_version=1, tool_id=tool.tool_id, tool_version=tool.version,
        action_digest=action_digest(tool, resource, args), initiator_user_id=USER_ID, approver_user_id=USER_ID,
        approver_role="gm", approved_at=NOW - timedelta(minutes=1), expires_at=NOW + timedelta(minutes=30),
    )
    data.update(changes)
    return ApprovalEvidence(**data)


def _reason(decision: AuthorizationDecision) -> ReasonCode:
    return decision.reason


# --- baseline ---------------------------------------------------------------------------------------------------

def test_fully_authorized_read_is_allowed_but_never_authorizes_execution():
    decision = decide(human_ctx("gm"))
    assert decision.outcome is Outcome.ALLOW and decision.reason is ReasonCode.ALLOWED
    assert decision.authorizes_execution is False


def test_decisions_are_deterministic():
    assert decide(human_ctx("engineer")) == decide(human_ctx("engineer"))


# --- the six canonical roles ------------------------------------------------------------------------------------

READ_ROLES = {"gm", "chief_engineer", "engineer", "housekeeping_supervisor"}
ASSIGN_WO_ROLES = {"gm", "chief_engineer"}
ROOM_ASSIGN_ROLES = {"gm", "housekeeping_supervisor"}


@pytest.mark.parametrize("role", ALL_ROLES)
def test_work_order_read_follows_explicit_grants(role):
    decision = decide(human_ctx(role))
    expected = ReasonCode.ALLOWED if role in READ_ROLES else ReasonCode.ACTOR_NOT_AUTHORIZED
    assert decision.reason is expected


@pytest.mark.parametrize("role", ALL_ROLES)
def test_work_order_assignment_follows_explicit_grants(role):
    decision = decide(human_ctx(role), request(ASSIGN, arguments=ASSIGN_ARGS), agents=WIDE, grants=GRANTS)
    if role in ASSIGN_WO_ROLES:
        assert decision.outcome is Outcome.REQUIRES_APPROVAL
    else:
        assert decision.reason is ReasonCode.ACTOR_NOT_AUTHORIZED


@pytest.mark.parametrize("role", ALL_ROLES)
def test_room_assignment_follows_explicit_grants(role):
    decision = decide(human_ctx(role), request(ROOM_ASSIGN, arguments={"idempotency_key": "k"}),
                      agents=WIDE, resource=ROOM, grants=GRANTS)
    if role in ROOM_ASSIGN_ROLES:
        assert decision.outcome is Outcome.REQUIRES_APPROVAL
    else:
        assert decision.reason is ReasonCode.ACTOR_NOT_AUTHORIZED


def test_cross_department_authority_is_not_inferred_from_rank():
    # engineer and housekeeping_supervisor shared rank 2 in the legacy table; neither inherits the other's writes.
    eng = decide(human_ctx("engineer"), request(ROOM_ASSIGN, arguments={"idempotency_key": "k"}), agents=WIDE, resource=ROOM, grants=GRANTS)
    sup = decide(human_ctx("housekeeping_supervisor"), request(ASSIGN, arguments=ASSIGN_ARGS), agents=WIDE, grants=GRANTS)
    assert eng.reason is ReasonCode.ACTOR_NOT_AUTHORIZED
    assert sup.reason is ReasonCode.ACTOR_NOT_AUTHORIZED


def test_read_permission_does_not_imply_write_permission():
    assert decide(human_ctx("engineer")).outcome is Outcome.ALLOW
    write = decide(human_ctx("engineer"), request(ASSIGN, arguments=ASSIGN_ARGS), agents=WIDE, grants=GRANTS)
    assert write.reason is ReasonCode.ACTOR_NOT_AUTHORIZED


# --- context, controls and tenant -------------------------------------------------------------------------------

@pytest.mark.parametrize("ctx", [None, {"hotel_id": HOTEL_A, "role": "gm"}, "gm", object()])
def test_missing_or_fake_context_is_denied(ctx):
    assert decide(ctx).reason is ReasonCode.MISSING_CONTEXT


def test_stale_identity_is_denied():
    assert decide(human_ctx("gm"), now=NOW + timedelta(minutes=6), ctl=controls(loaded_at=NOW + timedelta(minutes=6)),
                  ten=tenant().model_copy(update={"loaded_at": NOW + timedelta(minutes=6)})).reason is ReasonCode.STALE_IDENTITY


def test_disabled_global_execution_is_denied():
    assert decide(human_ctx("gm"), ctl=controls(platform_execution_enabled=False)).reason is ReasonCode.PLATFORM_EXECUTION_DISABLED
    assert decide(human_ctx("gm"), ctl=load_runtime_controls(NOW)).reason is ReasonCode.PLATFORM_EXECUTION_DISABLED


def test_missing_or_stale_controls_fail_closed():
    from services.agent_harness.policy import evaluate
    ctx = human_ctx("gm")
    assert evaluate(ctx, request(), agents=registries(), controls=None, tenant=tenant(), now=NOW,
                    resource=work_order()).reason is ReasonCode.CONTROLS_UNAVAILABLE
    stale = controls(loaded_at=NOW - timedelta(minutes=2))
    assert decide(ctx, ctl=stale).reason is ReasonCode.CONTROLS_UNAVAILABLE


@pytest.mark.parametrize("changes, reason", [
    ({"cost_emergency_stop": True}, ReasonCode.COST_EMERGENCY_STOP),
    ({"paused_hotels": frozenset({HOTEL_A})}, ReasonCode.HOTEL_PAUSED),
    ({"paused_agents": frozenset({AGENT_ID})}, ReasonCode.AGENT_PAUSED),
    ({"paused_tools": frozenset({LOOKUP.tool_id})}, ReasonCode.TOOL_PAUSED),
])
def test_emergency_stops_are_enforced(changes, reason):
    assert decide(human_ctx("gm"), ctl=controls(**changes)).reason is reason


def test_missing_feature_flag_is_denied():
    assert decide(human_ctx("gm"), ten=tenant(flags=frozenset())).reason is ReasonCode.TENANT_CAPABILITY_DISABLED
    assert decide(human_ctx("gm"), ten=None).reason is ReasonCode.CONTROLS_UNAVAILABLE


def test_forged_hotel_identity_is_denied():
    ctx = human_ctx("gm")
    assert decide(ctx, request(hotel_id=HOTEL_B)).reason is ReasonCode.TENANT_MISMATCH
    assert decide(ctx, ten=tenant(hotel_id=HOTEL_B)).reason is ReasonCode.TENANT_MISMATCH
    forged_args = {"work_order_id": WORK_ORDER_ID, "hotel_id": HOTEL_B}
    assert decide(ctx, request(arguments=forged_args)).reason is ReasonCode.UNTRUSTED_IDENTITY_CLAIM


@pytest.mark.parametrize("claim", ["role", "user_id", "tenant_id", "approved", "approval_id", "autonomy_level"])
def test_identity_claims_in_untrusted_arguments_are_refused(claim):
    args = {"work_order_id": WORK_ORDER_ID, claim: "gm"}
    assert decide(human_ctx("housekeeper"), request(arguments=args)).reason is ReasonCode.UNTRUSTED_IDENTITY_CLAIM


def test_cross_property_resource_access_is_denied():
    ctx = human_ctx("gm")
    assert decide(ctx, resource=work_order(HOTEL_B)).reason is ReasonCode.RESOURCE_OUT_OF_SCOPE
    assert decide(ctx, resource=None).reason is ReasonCode.RESOURCE_OUT_OF_SCOPE
    assert decide(ctx, resource=ROOM).reason is ReasonCode.RESOURCE_OUT_OF_SCOPE


@pytest.mark.parametrize("arguments", [["work_order_id"], "work_order_id", {1: "x"}])
def test_malformed_arguments_are_denied(arguments):
    assert decide(human_ctx("gm"), request(arguments=arguments)).reason is ReasonCode.MALFORMED_REQUEST


# --- agents and tools -------------------------------------------------------------------------------------------

def test_unregistered_agent_is_denied():
    ctx = human_ctx("gm", agent_id="examples.unknown_agent")
    assert decide(ctx, request(agent_id="examples.unknown_agent")).reason is ReasonCode.AGENT_NOT_REGISTERED


def test_request_cannot_switch_agents():
    assert decide(human_ctx("gm"), request(agent_version=2)).reason is ReasonCode.AGENT_MISMATCH


def test_default_disabled_agent_is_denied():
    disabled = registries(agent=agent_variant())
    assert decide(human_ctx("gm"), agents=disabled).reason is ReasonCode.AGENT_DISABLED


@pytest.mark.parametrize("tool_id, version", [
    ("engineering.work_orders.delete", 1), ("engineering.work_orders.lookup", 7), ("shell.run", 1),
    ("ENGINEERING.WORK_ORDERS.LOOKUP", 1), (None, None), (42, 1),
])
def test_unknown_tool_or_action_is_denied(tool_id, version):
    req = request(tool_id=tool_id if tool_id is not None else "", tool_version=version if version is not None else 1)
    assert decide(human_ctx("gm"), req).reason is ReasonCode.TOOL_NOT_REGISTERED


def test_agent_cannot_use_a_registered_tool_outside_its_allowlist():
    agents = registries(agent=agent_variant(enabled=True), tools=(LOOKUP, ASSIGN, ROOM_ASSIGN))
    req = request(ROOM_ASSIGN, arguments={"idempotency_key": "k"})
    assert decide(human_ctx("gm"), req, agents=agents, resource=ROOM).reason is ReasonCode.TOOL_NOT_ALLOWED_FOR_AGENT


def test_unsupported_trigger_is_denied():
    # the example agent supports user requests only; a scheduled system run of it is refused
    assert decide(system_ctx()).reason is ReasonCode.TRIGGER_NOT_SUPPORTED


def test_system_principal_gets_only_tools_that_name_it():
    assert decide(system_ctx(), agents=WIDE, grants=GRANTS).outcome is Outcome.ALLOW
    write = decide(system_ctx(), request(ASSIGN, arguments=ASSIGN_ARGS), agents=WIDE, grants=GRANTS)
    assert write.reason is ReasonCode.ACTOR_NOT_AUTHORIZED


# --- approvals and autonomy -------------------------------------------------------------------------------------

def test_write_without_a_property_autonomy_grant_is_denied():
    decision = decide(human_ctx("gm"), request(ASSIGN, arguments=ASSIGN_ARGS), agents=WIDE)
    assert decision.reason is ReasonCode.AUTONOMY_INSUFFICIENT
    expired = [g.model_copy(update={"expires_at": NOW - timedelta(seconds=1)}) for g in GRANTS]
    decision = decide(human_ctx("gm"), request(ASSIGN, arguments=ASSIGN_ARGS), agents=WIDE, grants=expired)
    assert decision.reason is ReasonCode.AUTONOMY_INSUFFICIENT


def test_write_without_approval_requires_approval_and_is_not_executable():
    decision = decide(human_ctx("gm"), request(ASSIGN, arguments=ASSIGN_ARGS), agents=WIDE, grants=GRANTS)
    assert decision.outcome is Outcome.REQUIRES_APPROVAL
    assert decision.authorizes_execution is False


def test_action_labeled_approved_is_not_executable():
    args = {**ASSIGN_ARGS, "approved": True}
    decision = decide(human_ctx("gm"), request(ASSIGN, arguments=args), agents=WIDE, grants=GRANTS)
    assert decision.outcome is Outcome.DENY and decision.reason is ReasonCode.UNTRUSTED_IDENTITY_CLAIM


def test_even_a_valid_server_approval_cannot_execute_a_write_in_h0():
    decision = decide(human_ctx("gm"), request(ASSIGN, arguments=ASSIGN_ARGS), agents=WIDE, grants=GRANTS, approval=_approval())
    assert decision.outcome is Outcome.DENY and decision.reason is ReasonCode.WRITE_EXECUTION_UNAVAILABLE
    assert decision.authorizes_execution is False


@pytest.mark.parametrize("changes", [
    {"action_digest": "0" * 64},
    {"hotel_id": HOTEL_B},
    {"tool_version": 2},
    {"approver_role": "engineer"},
    {"approver_role": "housekeeping_supervisor"},
    {"initiator_user_id": "someone-else"},
    {"approval_policy_id": "human_approval.unknown.v1"},
    {"approved_at": NOW - timedelta(hours=3), "expires_at": NOW - timedelta(hours=1)},
    {"approved_at": NOW - timedelta(hours=2), "expires_at": NOW + timedelta(hours=1)},
    {"approved_at": NOW + timedelta(minutes=5), "expires_at": NOW + timedelta(hours=1)},
])
def test_invalid_approvals_are_denied(changes):
    decision = decide(human_ctx("gm"), request(ASSIGN, arguments=ASSIGN_ARGS), agents=WIDE, grants=GRANTS, approval=_approval(**changes))
    assert decision.reason is ReasonCode.APPROVAL_INVALID


def test_approval_is_bound_to_the_exact_action():
    approval = _approval()
    changed = {**ASSIGN_ARGS, "assignee_user_id": "77777777-7777-4777-8777-777777777777"}
    decision = decide(human_ctx("gm"), request(ASSIGN, arguments=changed), agents=WIDE, grants=GRANTS, approval=approval)
    assert decision.reason is ReasonCode.APPROVAL_INVALID


def test_high_risk_financial_action_cannot_bypass_human_authority():
    req = request(CREDIT, arguments={"idempotency_key": "k"})
    assert decide(human_ctx("gm"), req, agents=WIDE, resource=ACCOUNT, grants=GRANTS).outcome is Outcome.REQUIRES_APPROVAL
    approval = _approval(CREDIT, ACCOUNT, {"idempotency_key": "k"})
    final = decide(human_ctx("gm"), req, agents=WIDE, resource=ACCOUNT, grants=GRANTS, approval=approval)
    assert final.reason is ReasonCode.WRITE_EXECUTION_UNAVAILABLE
    with pytest.raises(ValueError, match="low-risk"):
        AutonomyGrant(hotel_id=HOTEL_A, agent_id=AGENT_ID, tool_id=CREDIT.tool_id, tool_version=1,
                      max_level=AutonomyLevel.BOUNDED, max_risk=RiskLevel.HIGH, granted_by_user_id=USER_ID,
                      granted_at=NOW)


@pytest.mark.parametrize("tool", [ASSIGN, ROOM_ASSIGN, CREDIT])
def test_no_grant_lifts_a_write_above_human_approved(tool):
    grant = AutonomyGrant(hotel_id=HOTEL_A, agent_id=AGENT_ID, tool_id=tool.tool_id, tool_version=1,
                          max_level=AutonomyLevel.COORDINATED, max_risk=RiskLevel.LOW, granted_by_user_id=USER_ID,
                          granted_at=NOW - timedelta(days=1))
    level = effective_autonomy(hotel_id=HOTEL_A, agent_id=AGENT_ID, agent_ceiling=AutonomyLevel.COORDINATED,
                               tool=tool, grants=[grant], now=NOW, platform_ceiling=AutonomyLevel.COORDINATED)
    assert level <= AutonomyLevel.HUMAN_APPROVED


def test_autonomy_defaults_to_observe_and_h0_ceiling_is_observe():
    assert effective_autonomy(hotel_id=HOTEL_A, agent_id=AGENT_ID, agent_ceiling=AutonomyLevel.COORDINATED,
                              tool=LOOKUP, grants=[], now=NOW) is AutonomyLevel.OBSERVE
    grant = AutonomyGrant(hotel_id=HOTEL_A, agent_id=AGENT_ID, tool_id=LOOKUP.tool_id, tool_version=1,
                          max_level=AutonomyLevel.BOUNDED, max_risk=RiskLevel.LOW, granted_by_user_id=USER_ID,
                          granted_at=NOW - timedelta(days=1))
    assert effective_autonomy(hotel_id=HOTEL_A, agent_id=AGENT_ID, agent_ceiling=AutonomyLevel.COORDINATED,
                              tool=LOOKUP, grants=[grant], now=NOW) is AutonomyLevel.OBSERVE


@pytest.mark.parametrize("wildcard", ["*", "all", "any"])
def test_autonomy_grants_cannot_be_wildcards(wildcard):
    with pytest.raises(ValueError, match="wildcard"):
        AutonomyGrant(hotel_id=wildcard, agent_id=AGENT_ID, tool_id=LOOKUP.tool_id, tool_version=1,
                      max_level=AutonomyLevel.OBSERVE, max_risk=RiskLevel.LOW, granted_by_user_id=USER_ID,
                      granted_at=NOW)


def test_another_hotels_grant_does_not_apply():
    grant = AutonomyGrant(hotel_id=HOTEL_B, agent_id=AGENT_ID, tool_id=LOOKUP.tool_id, tool_version=1,
                          max_level=AutonomyLevel.BOUNDED, max_risk=RiskLevel.LOW, granted_by_user_id=USER_ID,
                          granted_at=NOW - timedelta(days=1))
    assert effective_autonomy(hotel_id=HOTEL_A, agent_id=AGENT_ID, agent_ceiling=AutonomyLevel.COORDINATED,
                              tool=LOOKUP, grants=[grant], now=NOW,
                              platform_ceiling=AutonomyLevel.COORDINATED) is AutonomyLevel.OBSERVE

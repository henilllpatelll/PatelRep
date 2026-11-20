"""H7 Phase 1: non-executing architecture contracts for bounded autonomy (level 3).

These tests pin the H6 baseline that H7 Phases 2-8 must change only deliberately, under review
(docs/agent-harness/adr-0006-h7-bounded-autonomy.md, h7-authorization-contract.md). They add no executable tool,
touch no database and call no provider. Each failure here means a later change has widened autonomy or execution
without updating the reviewed H7 contract at the same time.
"""
from __future__ import annotations

import re
from datetime import timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError

from services.agent_execution.config import WorkerSettings
from services.agent_gateway.authorization import GATEWAY_ALLOWED_ENVIRONMENTS, GatewaySettings, process_allows_execution
from services.agent_gateway.bindings import GATEWAY_BINDINGS, WRITE_RPCS, BindingRegistry, ToolBinding
from services.agent_gateway.catalog import DB_ALLOWLIST, GATEWAY_AGENTS, GATEWAY_TOOLS
from services.agent_gateway.schema import SchemaViolation, validate_arguments
from services.agent_harness.agents import AGENT_MANIFEST_SCHEMA_V1, SUPPORTED_MANIFEST_SCHEMAS, AgentSpec
from services.agent_harness.autonomy import H0_EXECUTABLE_AUTONOMY, AutonomyGrant, effective_autonomy, requires_human_authority
from services.agent_harness.controls import (
    H0_EXECUTION_SUPPORTED,
    H2_EXECUTABLE_TOOLS,
    load_runtime_controls,
    tool_is_executable,
)
from services.agent_harness.examples import EXAMPLE_AGENT_V1, WORK_ORDER_ASSIGN_V1
from services.agent_harness.policy import POLICY_AUTONOMY_CEILING, Outcome, ReasonCode
from services.agent_harness.tools import FORBIDDEN_DOMAINS, ToolSpec
from services.agent_harness.vocabulary import CAPABILITY_CATALOG, IDENTITY_CLAIM_KEYS, AccessMode, AutonomyLevel, RiskLevel
from services.agent_orchestrator.config import OrchestratorSettings
from tests.smoke.agent_harness_support import (
    HOTEL_A,
    HOTEL_B,
    NOW,
    agent_variant,
    decide,
    human_ctx,
    registries,
    request,
    tool_variant,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
MIGRATIONS = REPO_ROOT / "supabase" / "migrations"

# The exact reviewed executable set at the H6 baseline (961a012b). H7 may only ADD versions, in a reviewed PR that
# also updates this pin, bindings.py and the database allowlist together.
H6_EXECUTABLE_TOOLS = frozenset({
    ("engineering.work_orders.lookup", 2),
    ("housekeeping.rooms.status_lookup", 1),
    ("engineering.work_orders.assign", 2),
    ("engineering.work_orders.assignment_candidates", 1),
    ("housekeeping.rooms.readiness_lookup", 1),
    ("housekeeping.room_assignments.candidates", 1),
    ("housekeeping.room_assignments.assign", 1),
})
H6_AGENTS = frozenset({
    ("engineering.dispatch_assistant", 1),
    ("engineering.dispatch_assistant", 2),
    ("housekeeping.room_readiness_assistant", 1),
})


def _bounded_grant(tool: ToolSpec, *, risk: RiskLevel = RiskLevel.LOW, hotel_id: str = HOTEL_A,
                   agent_id: str = EXAMPLE_AGENT_V1.agent_id) -> AutonomyGrant:
    return AutonomyGrant(hotel_id=hotel_id, agent_id=agent_id, tool_id=tool.tool_id, tool_version=tool.version,
                         max_level=AutonomyLevel.BOUNDED, max_risk=risk, granted_by_user_id="gm-user",
                         granted_at=NOW - timedelta(minutes=1))


# --- 1. Manifest v1 stays exactly as it is ------------------------------------------------------------------------

def test_only_manifest_schema_v1_is_supported():
    assert SUPPORTED_MANIFEST_SCHEMAS == frozenset({"patelrep.agent-manifest/v1"})
    assert AGENT_MANIFEST_SCHEMA_V1 == "patelrep.agent-manifest/v1"


@pytest.mark.parametrize("schema", ["patelrep.agent-manifest/v2", "patelrep.agent-manifest/v1.1", "", "v1"])
def test_a_v2_or_unknown_manifest_schema_is_refused_by_the_v1_validator(schema):
    with pytest.raises(ValidationError):
        agent_variant(manifest_schema=schema)


@pytest.mark.parametrize("changes", [
    {"risk": RiskLevel.LOW},                                  # low-risk writes are unrepresentable in v1
    {"approval": "none"},                                     # writes always need a human approval in v1
    {"idempotency": "not_applicable"},
    {"audit": "metadata"},
    {"allowed_system_principals": frozenset({"harness.scheduled_observer"})},  # no system-held writes in v1
])
def test_manifest_v1_cannot_express_a_bounded_write(changes):
    with pytest.raises(ValidationError):
        tool_variant(WORK_ORDER_ASSIGN_V1, **changes)


def test_every_registered_gateway_write_is_v1_human_approved_and_at_least_medium_risk():
    writes = [t for t in GATEWAY_TOOLS.all().values() if t.access is AccessMode.WRITE]
    assert {t.key for t in writes} == {("engineering.work_orders.assign", 2), ("housekeeping.room_assignments.assign", 1)}
    for tool in writes:
        assert tool.approval.value == "human_approval"
        assert tool.risk.rank >= RiskLevel.MEDIUM.rank
        assert requires_human_authority(tool)


# --- 2. The current policy cannot authorize a level-3 write ----------------------------------------------------------

def test_policy_and_platform_ceilings_stay_below_bounded():
    assert POLICY_AUTONOMY_CEILING is AutonomyLevel.HUMAN_APPROVED
    assert H0_EXECUTABLE_AUTONOMY is AutonomyLevel.OBSERVE
    assert [lvl.value for lvl in AutonomyLevel] == [1, 2, 3, 4]


def test_a_bounded_grant_cannot_cover_a_medium_or_higher_risk_action():
    for risk in (RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL):
        with pytest.raises(ValidationError):
            _bounded_grant(WORK_ORDER_ASSIGN_V1, risk=risk)


def test_effective_autonomy_caps_every_write_at_human_approved_even_with_bounded_ceilings():
    level = effective_autonomy(hotel_id=HOTEL_A, agent_id=EXAMPLE_AGENT_V1.agent_id,
                               agent_ceiling=AutonomyLevel.COORDINATED, tool=WORK_ORDER_ASSIGN_V1,
                               grants=[_bounded_grant(WORK_ORDER_ASSIGN_V1)], now=NOW,
                               platform_ceiling=AutonomyLevel.COORDINATED)
    assert level <= AutonomyLevel.HUMAN_APPROVED


def test_a_write_without_approval_is_never_allowed_whatever_the_grant():
    agents = registries(agent=agent_variant(enabled=True, autonomy_ceiling=AutonomyLevel.COORDINATED))
    for grants in ((), (_bounded_grant(WORK_ORDER_ASSIGN_V1),)):
        decision = decide(human_ctx("gm"), request(WORK_ORDER_ASSIGN_V1), agents=agents, grants=grants)
        assert decision.outcome is not Outcome.ALLOW
        assert not decision.authorizes_execution


def test_a_system_principal_can_never_write():
    from tests.smoke.agent_harness_support import system_ctx
    agents = registries(agent=agent_variant(enabled=True, triggers=frozenset({"user_request", "schedule"})))
    decision = decide(system_ctx(), request(WORK_ORDER_ASSIGN_V1), agents=agents,
                      grants=(_bounded_grant(WORK_ORDER_ASSIGN_V1),))
    assert decision.outcome is Outcome.DENY


# --- 3. Existing human-approved tools remain subject to approval ----------------------------------------------------

@pytest.mark.parametrize("key", sorted(k for k in H6_EXECUTABLE_TOOLS if GATEWAY_TOOLS.get(*k).access is AccessMode.WRITE))
def test_reviewed_writes_bind_one_atomic_rpc_and_need_approval(key):
    binding = GATEWAY_BINDINGS.get(*key)
    assert binding is not None and binding.write_rpc in WRITE_RPCS and binding.read is None
    assert binding.spec.approval.value == "human_approval"


def test_the_write_rpc_set_is_exactly_the_two_reviewed_approved_writes():
    assert WRITE_RPCS == frozenset({"agent_tool_execute_work_order_assign", "agent_tool_execute_room_assignment"})


# --- 4. Unknown tools or versions cannot resolve ----------------------------------------------------------------------

@pytest.mark.parametrize("tool_id,version", [
    ("engineering.work_orders.assign", 1), ("engineering.work_orders.assign", 3), ("engineering.work_orders.assign", "2"),
    ("engineering.work_orders.assign", True), ("engineering.work_orders.assign", None), ("engineering.work_orders.*", 2),
    ("engineering.work_orders.assign.latest", 2), ("ENGINEERING.WORK_ORDERS.ASSIGN", 2), ("sql.execute", 1),
    ("engineering.work_orders.autonomous_annotate", 1), (None, 1), ("", 1),
])
def test_unknown_tool_names_and_versions_resolve_to_nothing(tool_id, version):
    assert GATEWAY_BINDINGS.resolve_untrusted(tool_id, version) is None
    assert GATEWAY_TOOLS.resolve_untrusted(tool_id, version) is None
    assert not tool_is_executable((tool_id, version))


def test_the_executable_set_bindings_and_database_allowlist_are_the_h6_set():
    assert H2_EXECUTABLE_TOOLS == H6_EXECUTABLE_TOOLS
    assert set(GATEWAY_BINDINGS.all()) == H6_EXECUTABLE_TOOLS
    assert {(t, v) for (_a, _av, t, v) in DB_ALLOWLIST} == H6_EXECUTABLE_TOOLS
    assert H0_EXECUTION_SUPPORTED is False


# --- 5. Forbidden domains remain forbidden ---------------------------------------------------------------------------

def test_forbidden_domains_are_at_least_the_h6_set_and_no_capability_lives_in_one():
    assert FORBIDDEN_DOMAINS >= {"shell", "python", "sql", "http", "filesystem", "repository", "deploy"}
    assert not {c.domain for c in CAPABILITY_CATALOG.values()} & FORBIDDEN_DOMAINS


def test_financial_and_personnel_capabilities_stay_human_authority():
    for cap_id in ("billing.credit_adjustment", "housekeeping.room_assignments.write"):
        assert CAPABILITY_CATALOG[cap_id].consequence.value in {"financial", "personnel"}
    assert GATEWAY_TOOLS.get("housekeeping.room_assignments.assign", 1).risk.rank >= RiskLevel.HIGH.rank


# --- 6. A model cannot introduce tenant or role authority through tool arguments ------------------------------------

@pytest.mark.parametrize("key", sorted(IDENTITY_CLAIM_KEYS))
def test_identity_keys_in_arguments_are_refused_by_policy(key):
    decision = decide(human_ctx("gm"), request(arguments={"work_order_id": "x", key: HOTEL_B}))
    assert decision.outcome is Outcome.DENY and decision.reason is ReasonCode.UNTRUSTED_IDENTITY_CLAIM


@pytest.mark.parametrize("key", ["hotel_id", "role", "autonomy_level", "approved_by", "tenant_id"])
def test_nested_identity_keys_are_refused_by_the_gateway_schema(key):
    schema = GATEWAY_TOOLS.get("engineering.work_orders.assign", 2).input_schema
    with pytest.raises(SchemaViolation) as exc:
        validate_arguments({"work_order_id": "x", "note": {key: "gm"}}, schema)
    assert exc.value.code == "untrusted_identity_claim"


def test_a_request_for_another_hotel_is_refused():
    decision = decide(human_ctx("gm"), request(hotel_id=HOTEL_B))
    assert decision.reason is ReasonCode.TENANT_MISMATCH


# --- 7. No new agent can execute merely because its manifest exists ---------------------------------------------------

def test_the_gateway_agent_set_is_the_h6_set():
    assert set(GATEWAY_AGENTS.all()) == H6_AGENTS
    for agent in GATEWAY_AGENTS.all().values():
        assert agent.autonomy_ceiling <= AutonomyLevel.HUMAN_APPROVED


def test_an_enabled_manifest_with_a_valid_approval_still_cannot_execute_an_unreviewed_tool():
    from services.agent_harness.policy import ApprovalEvidence, action_digest
    from tests.smoke.agent_harness_support import work_order
    agents = registries(agent=agent_variant(enabled=True))
    args = {"work_order_id": "44444444-4444-4444-8444-444444444444"}
    approval = ApprovalEvidence(
        approval_id="ap1", approval_policy_id=sorted(EXAMPLE_AGENT_V1.approval_policies)[0], hotel_id=HOTEL_A,
        agent_id=EXAMPLE_AGENT_V1.agent_id, agent_version=1, tool_id=WORK_ORDER_ASSIGN_V1.tool_id,
        tool_version=WORK_ORDER_ASSIGN_V1.version, action_digest=action_digest(WORK_ORDER_ASSIGN_V1, work_order(), args),
        initiator_user_id=human_ctx("gm").user_id, approver_user_id="another-gm", approver_role="gm",
        approved_at=NOW - timedelta(seconds=5), expires_at=NOW + timedelta(minutes=30))
    grant = AutonomyGrant(hotel_id=HOTEL_A, agent_id=EXAMPLE_AGENT_V1.agent_id, tool_id=WORK_ORDER_ASSIGN_V1.tool_id,
                          tool_version=WORK_ORDER_ASSIGN_V1.version, max_level=AutonomyLevel.HUMAN_APPROVED,
                          max_risk=RiskLevel.HIGH, granted_by_user_id="gm-user", granted_at=NOW - timedelta(minutes=1))
    decision = decide(human_ctx("gm"), request(WORK_ORDER_ASSIGN_V1, arguments=args), agents=agents,
                      approval=approval, grants=(grant,))
    assert WORK_ORDER_ASSIGN_V1.key not in H2_EXECUTABLE_TOOLS
    assert decision.reason is ReasonCode.WRITE_EXECUTION_UNAVAILABLE
    assert not decision.authorizes_execution


def test_a_binding_outside_the_reviewed_set_cannot_be_registered():
    registry = BindingRegistry()
    with pytest.raises(Exception):
        registry.register(ToolBinding(spec=WORK_ORDER_ASSIGN_V1, resolve=lambda *_: None, read=None,
                                      write_rpc="agent_tool_execute_work_order_assign"))
    assert GATEWAY_BINDINGS.frozen


def test_manifests_are_disabled_by_default():
    assert AgentSpec.model_fields["enabled"].default is False
    assert AgentSpec.model_fields["autonomy_ceiling"].default is AutonomyLevel.OBSERVE


# --- 8. No production refusal or default-off gate has changed ---------------------------------------------------------

def test_execution_gates_default_off_and_refuse_production(monkeypatch):
    for var in ("AGENT_GATEWAY_EXECUTION_ENABLED", "AGENT_WORKER_ENABLED", "AGENT_WORKER_SYNTHETIC_ENABLED",
                "AGENT_ORCHESTRATOR_EXECUTION_ENABLED", "AGENT_ORCHESTRATOR_PAID_CALLS_ENABLED"):
        monkeypatch.delenv(var, raising=False)
    assert GatewaySettings().execution_enabled is False
    assert WorkerSettings().enabled is False and WorkerSettings().synthetic_enabled is False
    orchestrator = OrchestratorSettings()
    assert orchestrator.execution_enabled is False and orchestrator.paid_calls_enabled is False
    assert "production" not in GATEWAY_ALLOWED_ENVIRONMENTS
    assert not process_allows_execution(app_env="production", settings=GatewaySettings(execution_enabled=True))
    assert load_runtime_controls(NOW).platform_execution_enabled is False


def _sql(name: str) -> str:
    return next(MIGRATIONS.glob(name)).read_text(encoding="utf-8")


def test_the_grant_table_and_grant_rpc_keep_levels_three_and_four_unrepresentable():
    assert "max_level          smallint    NOT NULL CHECK (max_level IN (1, 2))" in _sql("241_agent_gateway_schema.sql")
    assert "IF p_max_level NOT IN (1, 2)" in _sql("243_agent_gateway_rpcs.sql")
    widening = re.compile(r"max_level\s+IN\s*\([^)]*[34]", re.IGNORECASE)
    offenders = [p.name for p in sorted(MIGRATIONS.glob("*.sql")) if widening.search(p.read_text(encoding="utf-8"))]
    assert offenders == [], f"migrations widen agent_tool_grants.max_level: {offenders}"


def test_the_254_execution_guard_still_requires_an_approval_for_every_succeeded_write():
    body = _sql("254_agent_audit_integrity_and_independent_approval.sql")
    assert "a succeeded tool write requires a valid independent approval" in body
    assert "OR NEW.approval_id IS NULL" in body


# --- 9. Runtime facts the H7 design (h7-authorization-contract.md §5-§6) depends on --------------------------------

def _latest_function(name: str) -> str:
    """Body of the most recent CREATE OR REPLACE of ``public.<name>(`` across the migration history."""
    marker = f"CREATE OR REPLACE FUNCTION public.{name}("
    sources = [p for p in sorted(MIGRATIONS.glob("*.sql")) if marker in p.read_text(encoding="utf-8")]
    assert sources, f"{name} is not defined by any migration"
    text = sources[-1].read_text(encoding="utf-8")
    start = text.rindex(marker)
    return text[start:text.index("$function$;", start)]


def test_the_execution_approval_guard_is_a_before_insert_row_trigger():
    # §5.1 relies on this: the consumption row must be inserted BEFORE the execution so the guard can see it.
    body = _sql("254_agent_audit_integrity_and_independent_approval.sql")
    assert ("CREATE TRIGGER agent_tool_executions_approval_guard BEFORE INSERT ON public.agent_tool_executions\n"
            "  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_execution_approval();") in body
    redefinitions = [p.name for p in sorted(MIGRATIONS.glob("*.sql"))
                     if "agent_tool_executions_approval_guard" in p.read_text(encoding="utf-8")]
    assert redefinitions == ["254_agent_audit_integrity_and_independent_approval.sql"]


def test_the_execution_ledger_keeps_its_idempotency_and_single_invocation_keys():
    # §5.3 replay and §5.1 binding rely on both unique constraints.
    body = _sql("241_agent_gateway_schema.sql")
    assert "CONSTRAINT agent_tool_executions_idempotency_key UNIQUE (tenant_id, idempotency_key)" in body
    assert "CONSTRAINT agent_tool_executions_one_per_invocation UNIQUE (invocation_id)" in body
    assert "autonomy_consumption_id" not in "".join(p.read_text(encoding="utf-8") for p in MIGRATIONS.glob("*.sql"))


@pytest.mark.parametrize("function", ["agent_run_claim", "agent__run_claim_scoped"])
def test_a_control_block_at_claim_redispatches_and_never_cancels(function):
    # §6: a platform/hotel/agent pause or cost stop leaves the run queued and redispatches it; it does not cancel.
    body = _latest_function(function)
    branch = body[body.index("IF v_block IS NOT NULL THEN"):body.index("'outcome', 'blocked'")]
    assert "public.agent__redispatch(" in branch
    assert "'control_blocked'" in branch
    assert "cancelled" not in branch and "agent__finish_run" not in branch

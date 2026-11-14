"""H0 registry contracts: agent manifests and tool contracts validate strictly and never become permissive."""
from __future__ import annotations

from decimal import Decimal

import pytest
from pydantic import ValidationError

from services.agent_harness.agents import AgentRegistry, AgentSpec, ExecutionLimits
from services.agent_harness.errors import RegistryError
from services.agent_harness.examples import EXAMPLE_AGENT_V1, build_example_registries
from services.agent_harness.tools import ToolRef, ToolRegistry, ToolSpec
from services.agent_harness.vocabulary import AccessMode, ApprovalRequirement, AuditLevel, AutonomyLevel, IdempotencyPolicy, RiskLevel
from tests.smoke.agent_harness_support import ASSIGN, LOOKUP, agent_variant, registries, tool_variant


def _tools(*specs):
    reg = ToolRegistry()
    for spec in specs:
        reg.register(spec)
    return reg.freeze()


# --- agent manifests --------------------------------------------------------------------------------------------

def test_valid_example_manifest_registers():
    tools, agents = build_example_registries()
    assert agents.get(EXAMPLE_AGENT_V1.agent_id, 1) == EXAMPLE_AGENT_V1
    assert tools.frozen and agents.frozen


def test_agents_are_disabled_by_default():
    assert EXAMPLE_AGENT_V1.enabled is False
    dumped = EXAMPLE_AGENT_V1.model_dump()
    dumped.pop("enabled")
    assert AgentSpec.model_validate(dumped).enabled is False


def test_duplicate_agent_version_fails():
    agents = AgentRegistry(_tools(LOOKUP, ASSIGN))
    agents.register(EXAMPLE_AGENT_V1)
    with pytest.raises(RegistryError) as err:
        agents.register(EXAMPLE_AGENT_V1)
    assert err.value.code == "duplicate_agent"


def test_new_agent_version_is_a_separate_entry():
    agents = AgentRegistry(_tools(LOOKUP, ASSIGN))
    agents.register(EXAMPLE_AGENT_V1)
    agents.register(agent_variant(agent_version=2))
    assert set(agents.all()) == {(EXAMPLE_AGENT_V1.agent_id, 1), (EXAMPLE_AGENT_V1.agent_id, 2)}


@pytest.mark.parametrize("schema", ["patelrep.agent-manifest/v2", "agent-manifest/v1", "", "PATELREP.AGENT-MANIFEST/V1"])
def test_unsupported_schema_version_fails(schema):
    with pytest.raises(ValidationError, match="unsupported manifest schema"):
        agent_variant(manifest_schema=schema)


@pytest.mark.parametrize("agent_id", ["Examples.x", "examples", "examples..x", "examples.x-y", "1x.y", "a.b.c.d.e"])
def test_invalid_agent_identifier_fails(agent_id):
    with pytest.raises(ValidationError):
        agent_variant(agent_id=agent_id)


def test_unknown_tool_reference_fails():
    agents = AgentRegistry(_tools(LOOKUP))
    spec = agent_variant(tools=(ToolRef(tool_id="engineering.work_orders.delete", version=1),))
    with pytest.raises(RegistryError) as err:
        agents.register(spec)
    assert err.value.code == "unknown_tool"


def test_incompatible_tool_version_fails():
    agents = AgentRegistry(_tools(LOOKUP, ASSIGN))
    spec = agent_variant(tools=(ToolRef(tool_id=LOOKUP.tool_id, version=2),))
    with pytest.raises(RegistryError) as err:
        agents.register(spec)
    assert err.value.code == "incompatible_tool_version"


def test_unknown_capability_fails():
    with pytest.raises(ValidationError, match="unknown capabilities"):
        agent_variant(capabilities=frozenset({"engineering.work_orders.read", "engineering.work_orders.delete"}))


def test_tool_capability_must_be_declared_by_agent():
    agents = AgentRegistry(_tools(LOOKUP, ASSIGN))
    spec = agent_variant(capabilities=frozenset({"engineering.work_orders.assign"}))
    with pytest.raises(RegistryError) as err:
        agents.register(spec)
    assert err.value.code == "undeclared_capability"


def test_agent_must_require_the_harness_entitlement():
    with pytest.raises(ValidationError, match="ai_agents"):
        agent_variant(required_feature_flags=frozenset())


def test_unregistered_feature_flag_fails():
    with pytest.raises(ValidationError, match="unregistered feature flags"):
        agent_variant(required_feature_flags=frozenset({"ai_agents", "not_a_flag"}))


def test_unknown_approval_policy_fails():
    with pytest.raises(ValidationError, match="unknown approval policies"):
        agent_variant(approval_policies=frozenset({"auto_approve"}))


def test_write_capability_without_approval_policy_fails():
    with pytest.raises(ValidationError, match="approval policy"):
        agent_variant(approval_policies=frozenset())


def test_write_capability_below_human_approved_ceiling_fails():
    with pytest.raises(ValidationError, match="human_approved"):
        agent_variant(autonomy_ceiling=AutonomyLevel.OBSERVE)


@pytest.mark.parametrize("limits", [
    {"max_steps": 0, "max_tool_calls": 1, "max_runtime_seconds": 10, "max_credits_per_run": "1"},
    {"max_steps": 51, "max_tool_calls": 1, "max_runtime_seconds": 10, "max_credits_per_run": "1"},
    {"max_steps": 2, "max_tool_calls": 1, "max_runtime_seconds": 0, "max_credits_per_run": "1"},
    {"max_steps": 2, "max_tool_calls": 1, "max_runtime_seconds": 10, "max_credits_per_run": "0"},
    {"max_steps": 2, "max_tool_calls": 1, "max_runtime_seconds": 10, "max_credits_per_run": "-1"},
    {"max_steps": 2, "max_tool_calls": 1, "max_runtime_seconds": 10, "max_credits_per_run": 1.5},
    {"max_steps": 2, "max_tool_calls": 50, "max_runtime_seconds": 10, "max_credits_per_run": "1"},
    {"max_steps": "2", "max_tool_calls": 1, "max_runtime_seconds": 10, "max_credits_per_run": "1"},
    {"max_steps": True, "max_tool_calls": 1, "max_runtime_seconds": 10, "max_credits_per_run": "1"},
])
def test_malformed_limits_fail(limits):
    with pytest.raises(ValidationError):
        ExecutionLimits(**limits)


def test_duplicate_tool_pins_fail():
    ref = ToolRef(tool_id=LOOKUP.tool_id, version=1)
    with pytest.raises(ValidationError, match="duplicate tool reference"):
        agent_variant(tools=(ref, ref))


def test_unknown_fields_are_rejected():
    with pytest.raises(ValidationError):
        agent_variant(grants_gm_authority=True)


def test_agent_registry_requires_a_frozen_tool_registry_and_freezes():
    with pytest.raises(RegistryError):
        AgentRegistry(ToolRegistry())
    agents = registries()
    with pytest.raises(RegistryError):
        agents.register(agent_variant(agent_version=9))


def test_registry_lookup_rejects_non_exact_keys():
    agents = registries()
    assert agents.get(EXAMPLE_AGENT_V1.agent_id, True) is None
    assert agents.get(EXAMPLE_AGENT_V1.agent_id, "1") is None
    assert agents.get(EXAMPLE_AGENT_V1.agent_id.upper(), 1) is None


# --- tool contracts ---------------------------------------------------------------------------------------------

def test_duplicate_tool_version_fails():
    reg = ToolRegistry()
    reg.register(LOOKUP)
    with pytest.raises(RegistryError) as err:
        reg.register(LOOKUP)
    assert err.value.code == "duplicate_tool"


REQUIRED_SECURITY_FIELDS = ["capability", "access", "risk", "allowed_roles", "allowed_system_principals",
                            "approval", "idempotency", "audit", "required_feature_flags", "requires_resource_id",
                            "resource_type", "timeout_seconds", "max_output_bytes"]


@pytest.mark.parametrize("field", REQUIRED_SECURITY_FIELDS)
def test_missing_security_configuration_never_defaults_to_permissive(field):
    data = LOOKUP.model_dump()
    data.pop(field)
    with pytest.raises(ValidationError):
        ToolSpec.model_validate(data)


@pytest.mark.parametrize("changes, message", [
    ({"capability": "engineering.work_orders.delete"}, "unknown capability"),
    ({"access": AccessMode.WRITE}, "does not match capability access"),
    ({"allowed_roles": frozenset(), "allowed_system_principals": frozenset()}, "at least one"),
    ({"allowed_roles": frozenset({"gm", "housekeeper"})}, "exceed the capability"),
    ({"allowed_roles": frozenset({"owner"})}, "exceed the capability"),
    ({"required_feature_flags": frozenset({"made_up"})}, "unregistered feature flags"),
    ({"approval": ApprovalRequirement.HUMAN_APPROVAL}, "read tools declare"),
    ({"owning_domain": "housekeeping"}, "owning_domain"),
    ({"input_schema": {"type": "object", "properties": {}}}, "additionalProperties"),
    ({"input_schema": {"type": "object", "additionalProperties": False,
                       "properties": {"hotel_id": {"type": "string"}}}}, "identity/authority"),
    ({"output_schema": {"type": "array"}}, "type 'object'"),
    ({"timeout_seconds": 0}, None),
    ({"timeout_seconds": 600}, None),
    ({"max_output_bytes": 10_000_000}, None),
    ({"version": 0}, None),
    ({"version": "1"}, None),
])
def test_invalid_tool_contracts_fail(changes, message):
    with pytest.raises(ValidationError, match=message):
        tool_variant(LOOKUP, **changes)


@pytest.mark.parametrize("changes, message", [
    ({"approval": ApprovalRequirement.NONE}, "human approval"),
    ({"idempotency": IdempotencyPolicy.NOT_APPLICABLE}, "idempotency key"),
    ({"audit": AuditLevel.METADATA}, "immutable audit"),
    ({"risk": RiskLevel.LOW}, "at least medium"),
    ({"allowed_system_principals": frozenset({"harness.scheduled_observer"})}, "system principals"),
    ({"allowed_roles": frozenset({"gm", "engineer"})}, "exceed the capability"),
])
def test_write_tools_cannot_be_declared_permissively(changes, message):
    with pytest.raises(ValidationError, match=message):
        tool_variant(ASSIGN, **changes)


def test_financial_tool_must_be_high_risk():
    financial = dict(capability="billing.credit_adjustment", owning_domain="billing", allowed_roles=frozenset({"gm"}),
                     resource_type="billing_account")
    with pytest.raises(ValidationError, match="high or critical"):
        tool_variant(ASSIGN, **financial)
    assert tool_variant(ASSIGN, risk=RiskLevel.HIGH, **financial).risk is RiskLevel.HIGH


def test_tool_spec_has_no_executable_fields():
    with pytest.raises(ValidationError):
        tool_variant(LOOKUP, handler=lambda: None)
    for name, info in type(LOOKUP).model_fields.items():
        assert "Callable" not in str(info.annotation), name


@pytest.mark.parametrize("name, version", [
    ("engineering.work_orders.lookup ", 1), ("Engineering.Work_Orders.Lookup", 1), ("engineering.work_orders", 1),
    ("engineering.work_orders.lookup", "1"), ("engineering.work_orders.lookup", True),
    ("engineering.work_orders.lookup", 2), (None, 1), ({"tool_id": "x"}, 1), ("os.system", 1),
])
def test_untrusted_tool_names_only_resolve_exactly(name, version):
    reg = _tools(LOOKUP)
    assert reg.resolve_untrusted(name, version) is None
    assert reg.resolve_untrusted(LOOKUP.tool_id, 1) is LOOKUP


def test_execution_limits_accept_decimal_strings_exactly():
    limits = ExecutionLimits(max_steps=2, max_tool_calls=2, max_runtime_seconds=10, max_credits_per_run="0.1")
    assert limits.max_credits_per_run == Decimal("0.1")

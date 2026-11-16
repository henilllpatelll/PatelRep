"""H5 registry, authority and migration-safety contracts (no database). ADR-0004.

Pins: the two specialist manifests and their exact tool pins; no cross-department reach; autonomy capped at
human-approved; the four new executable tool versions agree across H0, bindings and the database allowlist; the intent
catalog equals its database mirror; 251 is the only destructive H5 migration and widens exactly what it says.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from services.agent_gateway.bindings import GATEWAY_BINDINGS, WRITE_RPCS, BindingRegistry, ToolBinding
from services.agent_gateway.catalog import (
    DB_ALLOWLIST,
    DISPATCH_AGENT_V1,
    ENGINEERING_SPECIALIST_V2,
    GATEWAY_AGENTS,
    GATEWAY_TOOLS,
    HOUSEKEEPING_SPECIALIST_V1,
)
from services.agent_gateway.catalog_h5 import H5_TOOL_SPECS, ROOM_ASSIGNMENT_ASSIGN_V1
from services.agent_harness.agents import AgentSpec
from services.agent_harness.autonomy import AutonomyGrant, requires_human_authority
from services.agent_harness.controls import H2_EXECUTABLE_TOOLS
from services.agent_harness.errors import RegistryError
from services.agent_harness.vocabulary import (
    CAPABILITY_CATALOG,
    ROOM_ASSIGNMENT_WRITE_ROLES,
    AccessMode,
    AutonomyLevel,
    RiskLevel,
)
from services.agent_orchestrator.intents import H5_INTENTS
from services.agent_orchestrator.orchestrator import INTENTS
from tests.smoke.test_agent_harness_no_execution import _require_role_args

API_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = API_ROOT.parents[1] / "supabase" / "migrations"
H5_MIGRATIONS = ("251_agent_h5_specialist_allowlists.sql", "252_agent_h5_planning_and_handoff.sql",
                 "253_agent_h5_gateway_tools.sql")
DESTRUCTIVE = re.compile(r"\b(?:DROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA|FUNCTION|POLICY|INDEX)|TRUNCATE\b|DELETE\s+FROM\b|"
                         r"ALTER\s+(?:TABLE|TYPE)\b[^;]*\b(?:DROP|RENAME|TYPE)\b)", re.I)
ENG, HK = ENGINEERING_SPECIALIST_V2, HOUSEKEEPING_SPECIALIST_V1


def _sql(name: str) -> str:
    return (MIGRATIONS / name).read_text(encoding="utf-8")


# --- manifests --------------------------------------------------------------------------------------------------------

def test_both_specialist_manifests_validate_and_are_registered_exactly():
    for spec in (ENG, HK):
        assert AgentSpec.model_validate(spec.model_dump()) == spec
        assert GATEWAY_AGENTS.get(spec.agent_id, spec.agent_version) is spec
        assert spec.product_family.value == "operations" and spec.enabled is True
        assert spec.autonomy_ceiling is AutonomyLevel.HUMAN_APPROVED
        assert spec.approval_policies == frozenset({"human_approval.independent_manager.v1"})
        assert spec.required_feature_flags == frozenset({"ai_agents"})
        assert {t.value for t in spec.triggers} == {"user_request"}
    assert {r.key for r in ENG.tools} == {("engineering.work_orders.lookup", 2),
                                          ("engineering.work_orders.assignment_candidates", 1),
                                          ("engineering.work_orders.assign", 2)}
    assert {r.key for r in HK.tools} == {("housekeeping.rooms.status_lookup", 1),
                                         ("housekeeping.rooms.readiness_lookup", 1),
                                         ("housekeeping.room_assignments.candidates", 1),
                                         ("housekeeping.room_assignments.assign", 1)}
    assert DISPATCH_AGENT_V1.agent_version == 1 and len(DISPATCH_AGENT_V1.tools) == 3  # historical version untouched


def test_no_cross_department_capability_or_tool():
    assert all(c.startswith("engineering.") for c in ENG.capabilities)
    assert all(c.startswith("housekeeping.") for c in HK.capabilities)
    assert all(r.tool_id.startswith("engineering.") for r in ENG.tools)
    assert all(r.tool_id.startswith("housekeeping.") for r in HK.tools)
    hk_keys = {(a, v) for (a, v, _, _) in DB_ALLOWLIST if a == HK.agent_id}
    assert all(not t.startswith("engineering.") for (a, _, t, _) in DB_ALLOWLIST if a == HK.agent_id), hk_keys
    assert all(not t.startswith("housekeeping.") for (a, v, t, _) in DB_ALLOWLIST if (a, v) == ENG.key)


def test_registries_are_frozen():
    with pytest.raises(RegistryError):
        GATEWAY_AGENTS.register(ENG)
    with pytest.raises(RegistryError):
        GATEWAY_TOOLS.register(ROOM_ASSIGNMENT_ASSIGN_V1)
    assert GATEWAY_BINDINGS.frozen


@pytest.mark.parametrize("name, version", [
    ("housekeeping.room_assignments.assign", 2), ("housekeeping.room_assignments.assign", True),
    ("housekeeping.room_assignments.assign", "1"), ("housekeeping.room_assignments.*", 1),
    ("HOUSEKEEPING.room_assignments.assign", 1), ("housekeeping.rooms.mark_clean", 1),
])
def test_unknown_tools_and_versions_never_resolve(name, version):
    assert GATEWAY_BINDINGS.resolve_untrusted(name, version) is None
    assert GATEWAY_TOOLS.resolve_untrusted(name, version) is None


def test_write_bindings_name_only_reviewed_rpcs():
    writes = {k: b.write_rpc for k, b in GATEWAY_BINDINGS.all().items() if b.write_rpc}
    assert writes == {("engineering.work_orders.assign", 2): "agent_tool_execute_work_order_assign",
                      ("housekeeping.room_assignments.assign", 1): "agent_tool_execute_room_assignment"}
    assert set(writes.values()) == WRITE_RPCS
    fresh = BindingRegistry()
    with pytest.raises(RegistryError) as err:
        fresh.register(ToolBinding(spec=ROOM_ASSIGNMENT_ASSIGN_V1, resolve=lambda *a: None, read=None,
                                   write_rpc="publish_assignment_batch"))  # never a domain function directly
    assert err.value.code == "invalid_binding"


def test_housekeeping_write_is_high_risk_human_authority_and_mirrors_the_route():
    spec = ROOM_ASSIGNMENT_ASSIGN_V1
    assert spec.access is AccessMode.WRITE and spec.risk is RiskLevel.HIGH and requires_human_authority(spec)
    assert spec.allowed_roles == frozenset(ROOM_ASSIGNMENT_WRITE_ROLES)
    assert spec.allowed_roles == _require_role_args("housekeeping.py", "/assignments/batch-publish")
    assert not spec.allowed_system_principals
    with pytest.raises(ValueError):  # bounded autonomy can never cover a non-low-risk action
        AutonomyGrant(hotel_id="h", agent_id=HK.agent_id, tool_id=spec.tool_id, tool_version=1,
                      max_level=AutonomyLevel.BOUNDED, max_risk=RiskLevel.HIGH, granted_by_user_id="u",
                      granted_at="2026-11-15T00:00:00Z")


def test_new_reads_expose_minimum_data_and_mirror_domain_roles():
    for spec in H5_TOOL_SPECS:
        cap = CAPABILITY_CATALOG[spec.capability]
        assert spec.allowed_roles <= cap.granted_roles and not spec.allowed_system_principals
        text = json.dumps(spec.output_schema)
        for forbidden in ("guest", "note", "photo", "comment", "name\"", "phone", "email", "description"):
            assert forbidden not in text.lower(), (spec.tool_id, forbidden)
    assert ("engineering.work_orders.assignment_candidates", 1) in H2_EXECUTABLE_TOOLS


def test_room_readiness_tools_cannot_set_room_state():
    for spec in H5_TOOL_SPECS:
        props = set(spec.input_schema["properties"])
        assert not props & {"status", "fo_status", "clean_type", "inspected", "is_ready", "vacant"}, spec.tool_id


# --- intents ------------------------------------------------------------------------------------------------------------

def test_intent_catalog_matches_the_database_mirror():
    body = _sql("252_agent_h5_planning_and_handoff.sql").split(
        "FUNCTION public.agent__planning_intent_spec(", 1)[1].split("$function$;", 1)[0]
    found = {m[0]: json.loads(m[1]) for m in re.findall(
        r"p_intent = '([a-z_.]+)' AND p_intent_version = 1 THEN\s+'(\{.*?\})'::jsonb", body, re.S)}
    assert set(found) == {i for i, _ in INTENTS}
    for (intent, _), spec in INTENTS.items():
        db = found[intent]
        assert db["resource_type"] == spec.resource_type
        assert (None if db["specialist"] is None else (db["specialist"]["agent_id"], db["specialist"]["agent_version"])) \
            == spec.specialist
        assert (None if db["write"] is None else (db["write"]["tool_id"], db["write"]["tool_version"])) == spec.write_tool


def test_every_h5_intent_is_bounded_and_single_department():
    for spec in H5_INTENTS.values():
        assert spec.candidate_agents == (spec.specialist,)
        agent = GATEWAY_AGENTS.get(*spec.specialist)
        pins = {r.key for r in agent.tools}
        assert spec.allowed_tools <= pins and {(t, v) for t, v, _ in spec.context_reads} <= spec.allowed_tools
        assert spec.write_tool is None or spec.write_tool in spec.allowed_tools
        dept = spec.intent.split(".", 1)[0]
        assert all(t.startswith(dept + ".") for t, _ in spec.allowed_tools)
        if spec.write_tool:
            write = GATEWAY_TOOLS.get(*spec.write_tool)
            assert spec.initiator_roles == write.allowed_roles  # who may ask = who may change it by hand
        assert set(spec.resource_argument) == spec.allowed_tools


# --- migrations ---------------------------------------------------------------------------------------------------------

def test_only_the_reviewed_allowlist_migration_is_destructive():
    flagged = {name for name in H5_MIGRATIONS if DESTRUCTIVE.search(_sql(name))}
    assert flagged == {"251_agent_h5_specialist_allowlists.sql"}
    sql = _sql("251_agent_h5_specialist_allowlists.sql")
    assert "-- migration-safety: destructive-reviewed" in sql and "-- rollback-plan:" in sql
    assert len(re.findall(r"DROP CONSTRAINT", sql)) == 5
    statements = [s.strip() for s in re.sub(r"--[^\n]*", "", sql).split(";") if s.strip()]
    assert all(s.startswith("ALTER TABLE public.agent_runs") or s.startswith("ALTER TABLE public.agent_planning_runs")
               for s in statements)


def test_agent_allowlist_widens_by_exactly_the_two_specialists():
    sql = _sql("251_agent_h5_specialist_allowlists.sql")
    allow = sql.split("ADD CONSTRAINT agent_runs_h5_agent_allowlist CHECK (", 1)[1].split(");", 1)[0]
    agents = set(re.findall(r"agent_id = '([^']+)' AND agent_version = (\d+)", allow))
    assert agents == {("harness.synthetic", "1"), ("engineering.dispatch_assistant", "1"), ("harness.orchestrator", "1"),
                      ("engineering.dispatch_assistant", "2"), ("housekeeping.room_readiness_assistant", "1")}


@pytest.mark.parametrize("name", H5_MIGRATIONS[1:])
def test_h5_functions_are_invoker_search_path_pinned_and_service_role_only(name):
    sql = _sql(name)
    assert "SECURITY DEFINER" not in sql
    for match in re.finditer(r"CREATE OR REPLACE FUNCTION (public\.[a-z_]+)\(", sql):
        fn = match.group(1)
        body = sql[match.end():].split("$function$;", 1)[0]
        assert "SET search_path = ''" in body, fn
        assert re.search(rf"REVOKE ALL ON FUNCTION {re.escape(fn)}\(", sql), fn
        assert re.search(rf"GRANT EXECUTE ON FUNCTION {re.escape(fn)}\([^)]*\) TO service_role;", sql), fn
    assert "TO authenticated" not in sql and "TO anon" not in sql


def test_new_tables_enable_rls_and_are_immutable():
    sql = _sql("252_agent_h5_planning_and_handoff.sql")
    for table in ("agent_planning_events", "agent_proposal_handoffs"):
        assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;" in sql
        assert f"REVOKE ALL ON public.{table} FROM PUBLIC, anon, authenticated;" in sql
        assert re.search(rf"BEFORE UPDATE OR DELETE ON public\.{table}\s+FOR EACH ROW EXECUTE FUNCTION "
                         rf"public\.agent__guard_tool_immutable\(\)", sql)
        assert f"GRANT SELECT, INSERT ON public.{table} TO service_role;" in sql


def test_housekeeping_write_reuses_the_canonical_publication_and_never_sets_room_status():
    sql = _sql("253_agent_h5_gateway_tools.sql")
    body = sql.split("FUNCTION public.agent_tool_execute_room_assignment(", 1)[1].split("$function$;", 1)[0]
    assert "public.publish_assignment_batch(" in body
    assert "'is_ai_suggested', true" in body
    assert not re.search(r"UPDATE public\.(room_status|room_assignments|rooms)\b", body)
    assert not re.search(r"INSERT INTO public\.(room_status|room_assignments)\b", body)
    assert body.count("public.publish_assignment_batch(") == 1
    assert "agent__gateway_refusal" in body and "agent__human_authority" in body and "FOR UPDATE" in body

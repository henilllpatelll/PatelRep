"""H2 Tool Gateway static guarantees and drift guards.

* bindings are exact, frozen and equal to H0's H2_EXECUTABLE_TOOLS and to the database allowlist (migration 243)
* role sets never widen the domain routes they mirror; no system principal holds any H2 tool
* the package imports no model provider, router, shell, dynamic import or HTTP client, touches only two business
  tables, and reaches agent state only through agent_tool_* RPCs; no application code imports it
* every new SQL function is SECURITY INVOKER, has an empty search_path and is revoked from end users
* execution is off by default and refused in production at the process layer
"""
from __future__ import annotations

import ast
import json
import re
from pathlib import Path

import pytest

from core.roles import MODULE_ROLE_ACCESS
from services.agent_gateway.authorization import GatewaySettings, process_allows_execution
from services.agent_gateway.bindings import GATEWAY_BINDINGS, BindingRegistry, ToolBinding
from services.agent_gateway.catalog import (
    DB_ALLOWLIST,
    DISPATCH_AGENT_V1,
    GATEWAY_AGENTS,
    GATEWAY_TOOL_SPECS,
    ROOM_STATUS_LOOKUP_V1,
    WORK_ORDER_ASSIGN_V2,
    WORK_ORDER_LOOKUP_V2,
)
from services.agent_harness.controls import H0_EXECUTION_SUPPORTED, H2_EXECUTABLE_TOOLS, require_tool_executable
from services.agent_harness.errors import AgentExecutionDisabled, RegistryError
from services.agent_harness.examples import WORK_ORDER_ASSIGN_V1, WORK_ORDER_LOOKUP_V1
from services.agent_harness.vocabulary import WORK_ORDER_ASSIGN_ROLES
from tests.smoke.test_agent_harness_no_execution import _require_role_args

API_ROOT = Path(__file__).resolve().parents[2]
PACKAGE = API_ROOT / "services" / "agent_gateway"
MIGRATIONS = API_ROOT.parents[1] / "supabase" / "migrations"
H2_MIGRATIONS = ("241_agent_gateway_schema.sql", "242_work_order_assign_apply.sql", "243_agent_gateway_rpcs.sql")
FORBIDDEN_IMPORT_PREFIXES = (
    "openai", "anthropic", "services.ai", "services.opera", "services.sms", "services.notify", "routers", "subprocess",
    "importlib", "requests", "urllib", "httpx", "socket", "fastapi", "apscheduler", "core.scheduler", "pickle",
    "marshal", "stripe", "twilio", "os", "shutil", "pathlib",
)
FORBIDDEN_CALLS = {"eval", "exec", "compile", "__import__", "getattr", "setattr", "open"}


def _sources():
    return sorted(PACKAGE.glob("*.py"))


# --- bindings / registries ------------------------------------------------------------------------------------------

def test_bindings_executable_set_and_database_allowlist_are_one_exact_set():
    bound = set(GATEWAY_BINDINGS.all())
    assert bound == set(H2_EXECUTABLE_TOOLS) == {s.key for s in GATEWAY_TOOL_SPECS}
    assert {(t, v) for (_, _, t, v) in DB_ALLOWLIST} == bound
    assert {ref.key for ref in DISPATCH_AGENT_V1.tools} == bound
    assert H0_EXECUTION_SUPPORTED is False  # no blanket switch exists; only the exact set above


def _sql_allowlist() -> dict:
    sql = (MIGRATIONS / "243_agent_gateway_rpcs.sql").read_text(encoding="utf-8")
    body = sql.split("CREATE OR REPLACE FUNCTION public.agent__gateway_tool_spec(", 1)[1].split("$function$;", 1)[0]
    agent = re.search(r"p_agent_id = '([^']+)' AND p_agent_version = (\d+)", body)
    found = {}
    for tool, version, spec in re.findall(
            r"WHEN p_tool_id = '([^']+)' AND p_tool_version = (\d+) THEN\s+'(\{.*?\})'::jsonb", body, re.S):
        found[(agent.group(1), int(agent.group(2)), tool, int(version))] = json.loads(spec)
    return found


def test_python_catalog_matches_the_database_allowlist_exactly():
    sql = _sql_allowlist()
    assert set(sql) == set(DB_ALLOWLIST)
    for key, spec in sql.items():
        mirror = DB_ALLOWLIST[key]
        assert spec["access"] == mirror["access"] and spec["risk"] == mirror["risk"]
        assert spec["resource_type"] == mirror["resource_type"]
        assert tuple(sorted(spec["roles"])) == mirror["roles"], key


def test_h0_example_contracts_remain_non_executable():
    for spec in (WORK_ORDER_LOOKUP_V1, WORK_ORDER_ASSIGN_V1):
        assert GATEWAY_BINDINGS.get(spec.tool_id, spec.version) is None
        with pytest.raises(AgentExecutionDisabled):
            require_tool_executable(spec.key)


@pytest.mark.parametrize("name, version", [
    ("engineering.work_orders.assign", 1), ("engineering.work_orders.assign", 3), ("engineering.work_orders.assign", "2"),
    ("engineering.work_orders.assign", True), ("Engineering.Work_Orders.Assign", 2), ("engineering.work_orders.*", 2),
    ("engineering.work_orders", 2), ("shell.exec", 1), ("sql.query", 1), ("http.fetch", 1), (None, 2),
    ("engineering.work_orders.assign ", 2),
])
def test_untrusted_tool_names_resolve_only_exactly(name, version):
    assert GATEWAY_BINDINGS.resolve_untrusted(name, version) is None


def test_binding_registry_is_frozen_and_refuses_unreviewed_bindings():
    assert GATEWAY_BINDINGS.frozen
    with pytest.raises(RegistryError):
        GATEWAY_BINDINGS.register(ToolBinding(spec=WORK_ORDER_LOOKUP_V2, resolve=lambda *a: None,
                                              read=lambda *a: None, write_rpc=None))
    fresh = BindingRegistry()
    with pytest.raises(RegistryError) as err:  # H0's example contract is not the registered gateway contract
        fresh.register(ToolBinding(spec=WORK_ORDER_LOOKUP_V1, resolve=lambda *a: None, read=lambda *a: None,
                                   write_rpc=None))
    assert err.value.code == "unregistered_binding"
    with pytest.raises(RegistryError) as err:  # a write tool can never bind a Python handler
        fresh.register(ToolBinding(spec=WORK_ORDER_ASSIGN_V2, resolve=lambda *a: None, read=lambda *a: None,
                                   write_rpc="x"))
    assert err.value.code == "invalid_binding"


def test_registries_are_frozen_and_hold_only_the_dispatch_agent():
    assert GATEWAY_AGENTS.frozen and GATEWAY_AGENTS.tools.frozen
    assert set(GATEWAY_AGENTS.all()) == {(DISPATCH_AGENT_V1.agent_id, DISPATCH_AGENT_V1.agent_version)}
    assert DISPATCH_AGENT_V1.approval_policies == frozenset({"human_approval.independent_manager.v1"})


def test_no_system_principal_holds_any_h2_tool():
    assert all(not s.allowed_system_principals for s in GATEWAY_TOOL_SPECS)


def test_role_sets_never_widen_the_domain_routes():
    assert WORK_ORDER_ASSIGN_V2.allowed_roles == frozenset(WORK_ORDER_ASSIGN_ROLES)
    assert WORK_ORDER_ASSIGN_V2.allowed_roles == _require_role_args("work_orders.py", "/{wo_id}/assign")
    assert WORK_ORDER_LOOKUP_V2.allowed_roles <= set(MODULE_ROLE_ACCESS["engineering"])
    assert ROOM_STATUS_LOOKUP_V1.allowed_roles <= set(MODULE_ROLE_ACCESS["housekeeping"])


# --- static isolation -----------------------------------------------------------------------------------------------

@pytest.mark.parametrize("path", _sources(), ids=lambda p: p.name)
def test_package_imports_no_model_router_shell_or_dynamic_code(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        names = []
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            names = [node.module or ""]
        for name in names:
            assert not any(name == p or name.startswith(p + ".") for p in FORBIDDEN_IMPORT_PREFIXES), \
                f"{path.name} imports {name}"
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            assert node.func.id not in FORBIDDEN_CALLS, f"{path.name} calls {node.func.id}()"


def test_package_touches_only_two_business_tables_and_agent_tool_rpcs():
    for path in _sources():
        source = path.read_text(encoding="utf-8")
        for table in re.findall(r"\.table\(\"([a-z_]+)\"\)", source):
            assert table in {"work_orders", "rooms"}, f"{path.name} reads {table}"
        assert not re.search(r"\.(insert|update|upsert|delete)\(", source), f"{path.name} writes a table directly"
        for rpc in re.findall(r"_rpc\(\"([a-z_]+)\"", source):
            assert rpc.startswith("agent_tool_") or rpc == "agent_execution_enablement_set", f"{path.name} calls {rpc}"


def test_no_application_code_imports_the_gateway():
    offenders = []
    for path in API_ROOT.rglob("*.py"):
        rel = path.relative_to(API_ROOT).as_posix()
        if rel.startswith(("services/agent_gateway/", "services/agent_execution/", "tests/", ".venv/")) \
                or "/site-packages/" in rel:
            continue
        source = path.read_text(encoding="utf-8", errors="ignore")
        if rel.startswith("services/agent_harness/"):  # contracts may NAME the gateway in docs, never import it
            if re.search(r"^\s*(from|import)\s+services\.agent_gateway", source, re.M):
                offenders.append(rel)
            continue
        if re.search(r"services[./]agent_gateway", source):
            offenders.append(rel)
    assert offenders == [], offenders


def test_package_files_stay_under_the_500_line_limit():
    for path in _sources():
        assert len(path.read_text(encoding="utf-8").splitlines()) < 500, path.name


def test_every_h2_function_is_invoker_with_empty_search_path_and_service_role_only():
    for name in H2_MIGRATIONS:
        sql = (MIGRATIONS / name).read_text(encoding="utf-8")
        assert "SECURITY DEFINER" not in sql
        functions = set(re.findall(r"CREATE OR REPLACE FUNCTION (public\.[a-z_]+)\(", sql))
        assert functions, name
        for fn in functions:
            body = sql.split(f"CREATE OR REPLACE FUNCTION {fn}(", 1)[1].split("$function$;", 1)[0]
            assert "SET search_path = ''" in body, f"{fn} lacks an empty search_path"
            assert re.search(rf"REVOKE ALL ON FUNCTION {re.escape(fn)}\([^;]*FROM PUBLIC, anon, authenticated;", sql), fn


def test_new_tables_have_rls_and_no_end_user_privileges():
    sql = (MIGRATIONS / "241_agent_gateway_schema.sql").read_text(encoding="utf-8")
    for table in ("agent_execution_enablement", "agent_tool_controls", "agent_tool_grants", "agent_tool_invocations",
                  "agent_tool_approvals", "agent_tool_executions", "agent_tool_events"):
        assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;" in sql
        assert re.search(rf"REVOKE ALL ON [^;]*public\.{table}\b[^;]*FROM PUBLIC, anon, authenticated;", sql), table
    assert "CREATE POLICY" not in sql
    assert "DROP CONSTRAINT IF EXISTS agent_runs_h1_synthetic_only" in sql
    allowlist = sql.split("ADD CONSTRAINT agent_runs_h2_agent_allowlist CHECK (", 1)[1].split(");", 1)[0]
    assert set(re.findall(r"agent_id = '([^']+)'", allowlist)) == {"harness.synthetic", "engineering.dispatch_assistant"}


def test_historical_h1_migrations_are_untouched():
    schema = (MIGRATIONS / "238_agent_harness_durable_execution_schema.sql").read_text(encoding="utf-8")
    assert "CONSTRAINT agent_runs_h1_synthetic_only CHECK (agent_id = 'harness.synthetic' AND agent_version = 1)" in schema
    assert "awaiting_approval" not in schema


# --- execution boundary ---------------------------------------------------------------------------------------------

def test_gateway_execution_is_off_by_default(monkeypatch):
    monkeypatch.delenv("AGENT_GATEWAY_EXECUTION_ENABLED", raising=False)
    assert GatewaySettings().execution_enabled is False
    assert process_allows_execution(app_env="staging", settings=GatewaySettings()) is False


@pytest.mark.parametrize("env", ["production", "prod", "", "Production", "preview"])
def test_production_and_unknown_environments_are_refused_even_when_enabled(env):
    assert process_allows_execution(app_env=env, settings=GatewaySettings(execution_enabled=True)) is False


def test_only_isolated_environments_can_enable_execution():
    for env in ("development", "test", "staging"):
        assert process_allows_execution(app_env=env, settings=GatewaySettings(execution_enabled=True)) is True

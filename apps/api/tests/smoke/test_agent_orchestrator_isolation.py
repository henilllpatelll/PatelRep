"""H3 static guarantees and drift guards.

* nothing in application code imports the orchestrator; the package has no shell/dynamic-import/HTTP-library code
* provider credentials are read ONLY in providers_factory.py
* the orchestrator never reaches H2 execution: only frozen contracts, schemas, redaction and a timestamp parser
* every H3 SQL function is SECURITY INVOKER with an empty search_path and revoked from end users
* code mirrors of database data (price book, intent roles, allowlists) are identical
* execution stays off by default; H0/H2 ceilings are unchanged
"""
from __future__ import annotations

import ast
import re
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from services.agent_gateway.catalog import DB_ALLOWLIST, GATEWAY_AGENTS
from services.agent_harness.controls import H0_EXECUTION_SUPPORTED, H2_EXECUTABLE_TOOLS
from services.agent_harness.provider_pricing import max_exposure
from services.agent_orchestrator import ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_VERSION
from services.agent_orchestrator.catalog import MODEL_CATALOG, ROUTES, resolve_route
from services.agent_orchestrator.config import OrchestratorSettings, paid_calls_allowed, process_allows_orchestration
from services.agent_orchestrator.orchestrator import INTENTS, ORCHESTRATOR_AGENT_V1, ORCHESTRATOR_AGENTS
from services.agent_orchestrator.pricebook import PRICE_BOOK, PRICE_SCHEDULES, VERIFIED_AT

API_ROOT = Path(__file__).resolve().parents[2]
PACKAGE = API_ROOT / "services" / "agent_orchestrator"
MIGRATIONS = API_ROOT.parents[1] / "supabase" / "migrations"
H3_MIGRATIONS = ("244_agent_model_spend_schema.sql", "245_agent_model_spend_rpcs.sql",
                 "246_agent_orchestrator_h1_allowlist.sql", "247_agent_planning_runs.sql")
FORBIDDEN_IMPORT_PREFIXES = ("subprocess", "importlib", "requests", "urllib", "socket", "pickle", "marshal", "shutil",
                             "fastapi", "routers", "services.ai", "services.opera", "services.sms", "services.notify",
                             "stripe", "twilio", "apscheduler", "core.scheduler", "core.database", "litellm",
                             "langchain", "langgraph", "temporalio", "redis", "kafka")
FORBIDDEN_CALLS = {"eval", "exec", "compile", "__import__", "open"}
GATEWAY_IMPORTS = {
    "services.agent_gateway.bindings": {"GATEWAY_BINDINGS"},
    "services.agent_gateway.catalog": {"GATEWAY_AGENTS", "DISPATCH_AGENT_ID", "DISPATCH_AGENT_VERSION",
                                       "WORK_ORDER_ASSIGN_V2", "WORK_ORDER_LOOKUP_V2",
                                       # H5 intents (intents.py): contract data only
                                       "ENGINEERING_SPECIALIST_V2", "HOUSEKEEPING_SPECIALIST_V1",
                                       "ROOM_STATUS_LOOKUP_V1"},
    "services.agent_gateway.catalog_h5": {"ASSIGNMENT_CANDIDATES_V1", "HOUSEKEEPING_CANDIDATES_V1",
                                          "ROOM_ASSIGNMENT_ASSIGN_V1", "ROOM_READINESS_LOOKUP_V1"},
    "services.agent_gateway.schema": {"SchemaViolation", "canonical_json", "validate_arguments"},
    "services.agent_gateway.output": {"redact"},
    "services.agent_gateway.authorization": {"parse_ts"},
}


def _sources():
    return sorted(PACKAGE.glob("*.py"))


def _sql(name: str) -> str:
    return (MIGRATIONS / name).read_text(encoding="utf-8")


@pytest.mark.parametrize("path", _sources(), ids=lambda p: p.name)
def test_package_imports_and_calls_are_restricted(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                assert not alias.name.startswith(FORBIDDEN_IMPORT_PREFIXES), (path.name, alias.name)
        elif isinstance(node, ast.ImportFrom) and node.module:
            assert not node.module.startswith(FORBIDDEN_IMPORT_PREFIXES), (path.name, node.module)
            if node.module.startswith("services.agent_gateway"):
                allowed = GATEWAY_IMPORTS.get(node.module)
                assert allowed is not None, (path.name, node.module)
                assert {a.name for a in node.names} <= allowed, (path.name, node.module)
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            assert node.func.id not in FORBIDDEN_CALLS, (path.name, node.func.id)


def test_package_files_stay_under_the_500_line_limit():
    for path in _sources() + [API_ROOT / "services" / "agent_harness" / "provider_usage.py",
                              API_ROOT / "services" / "agent_harness" / "provider_pricing.py"]:
        assert len(path.read_text(encoding="utf-8").splitlines()) < 500, path.name


def test_credentials_are_read_only_by_the_factory():
    for path in _sources():
        source = path.read_text(encoding="utf-8")
        touches = re.search(r"openai_api_key|anthropic_api_key|core\.config|api_key\s*=|getenv|os\.environ", source)
        if path.name == "providers_factory.py":
            assert touches
        else:
            assert not touches, path.name


def test_the_orchestrator_never_reaches_h2_execution_paths():
    for path in _sources():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        names = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)} | \
                {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
        for forbidden in ("admit_tool_run", "execute_tool_step", "prepare", "decide", "GatewayStore",
                          "approval_decide", "execute_work_order_assign", "resolve"):
            assert forbidden not in names, (path.name, forbidden)
        assert not re.search(r"agent_tool_(run_admit|execute|approval|request_approval|record_outcome)",
                             path.read_text(encoding="utf-8")), path.name


def test_no_application_code_imports_the_orchestrator():
    offenders = []
    for path in API_ROOT.rglob("*.py"):
        rel = path.relative_to(API_ROOT).as_posix()
        # H6: services/agent_control_center/ is the Control Center bridge (ADR-0005); routers import only it.
        # H5: services/agent_handoff/ is the reviewed plan -> gateway bridge (ADR-0004).
        if rel.startswith(("services/agent_orchestrator/", "services/agent_execution/", "services/agent_handoff/", "services/agent_control_center/",
                           "tests/", ".venv/")) or "/site-packages/" in rel:
            continue
        if re.search(r"services[./]agent_orchestrator", path.read_text(encoding="utf-8", errors="ignore")):
            offenders.append(rel)
    assert offenders == [], offenders
    sanctioned = {p.relative_to(API_ROOT).as_posix() for p in (API_ROOT / "services" / "agent_execution").glob("*.py")
                  if "agent_orchestrator" in p.read_text(encoding="utf-8")}
    # worker (planning steps), retry (error classes) and the operator CLI (spend-* commands) -- nothing else.
    assert sanctioned == {"services/agent_execution/worker.py", "services/agent_execution/retry.py",
                          "services/agent_execution/__main__.py"}


def test_no_route_or_app_startup_mentions_planning():
    main = (API_ROOT / "main.py").read_text(encoding="utf-8")
    assert "agent_orchestrator" not in main and "planning" not in main.lower()
    for router in (API_ROOT / "routers").glob("*.py"):
        assert "agent_planning" not in router.read_text(encoding="utf-8"), router.name


# --- SQL properties ----------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("name", H3_MIGRATIONS)
def test_h3_functions_are_invoker_search_path_pinned_and_revoked(name):
    sql = _sql(name)
    assert "SECURITY DEFINER" not in sql
    for match in re.finditer(r"CREATE OR REPLACE FUNCTION (public\.[a-z_]+)\(", sql):
        fn = match.group(1)
        body = sql[match.end():].split("$function$;", 1)[0]
        assert "SET search_path = ''" in body, fn
        assert re.search(rf"REVOKE ALL ON FUNCTION {re.escape(fn)}\(", sql), fn


def test_only_the_reviewed_allowlist_migration_is_destructive():
    destructive = re.compile(r"\b(?:DROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA|FUNCTION|POLICY|INDEX)|TRUNCATE\b|DELETE\s+FROM\b|"
                             r"ALTER\s+(?:TABLE|TYPE)\b[^;]*\b(?:DROP|RENAME|TYPE)\b)", re.I)
    flagged = {name for name in H3_MIGRATIONS if destructive.search(_sql(name))}
    assert flagged == {"246_agent_orchestrator_h1_allowlist.sql"}
    sql = _sql("246_agent_orchestrator_h1_allowlist.sql")
    assert "-- migration-safety: destructive-reviewed" in sql and "-- rollback-plan:" in sql
    assert len(re.findall(r"DROP CONSTRAINT", sql)) == 2 and "DROP TABLE" not in sql


def test_allowlists_widen_by_exactly_the_orchestrator_and_model_planning():
    sql = _sql("246_agent_orchestrator_h1_allowlist.sql")
    allow = sql.split("ADD CONSTRAINT agent_runs_h3_agent_allowlist CHECK (", 1)[1].split(");", 1)[0]
    agents = set(re.findall(r"agent_id = '([^']+)' AND agent_version = (\d+)", allow))
    assert agents == {("harness.synthetic", "1"), ("engineering.dispatch_assistant", "1"),
                      ("harness.orchestrator", str(ORCHESTRATOR_AGENT_VERSION))}
    steps = sql.split("agent_run_steps_step_type_allowlist CHECK (step_type IN (", 1)[1].split("))", 1)[0]
    assert set(re.findall(r"'([a-z_]+)'", steps)) == {"synthetic_noop", "synthetic_transient_failure",
                                                      "synthetic_permanent_failure", "synthetic_delay",
                                                      "tool_invocation", "model_planning"}


# --- drift: code mirrors of database data ------------------------------------------------------------------------------

def test_price_book_equals_the_migration_seed():
    seed = _sql("244_agent_model_spend_schema.sql").split("INSERT INTO public.agent_model_price_schedules (", 1)[1]
    rows = re.findall(r"\('(openai|anthropic)', '([a-z0-9.\-]+)', '([a-z0-9.\-]+)', '([^']+)',\s+([^']+?),\s+'", seed, re.S)
    assert len(rows) == len(PRICE_SCHEDULES)
    for provider, model, version, start, numbers in rows:
        values = [v.strip() for v in numbers.split(",")]
        s = next(x for x in PRICE_SCHEDULES if x.provider.value == provider and x.model == model)
        assert s.schedule_version == version and s.effective_from.isoformat().startswith(start[:10])
        b, lc = s.base, s.long_context
        expected = [b.input, b.cache_read, b.cache_write_short, b.cache_write_long, b.output,
                    s.long_context_threshold, *(
                        [lc.input, lc.cache_read, lc.cache_write_short, lc.cache_write_long, lc.output] if lc
                        else [None] * 5)]
        parsed = [None if v == "NULL" else (int(v) if v.isdigit() and len(v) > 4 else Decimal(v)) for v in values]
        assert parsed == expected, model


def test_intent_roles_and_planning_outcomes_match_the_database():
    # H5: the latest definitions are agent__planning_intent_roles (252) and the CHECK allowlists (251).
    roles_sql = _sql("252_agent_h5_planning_and_handoff.sql").split(
        "FUNCTION public.agent__planning_intent_roles(", 1)[1].split("$function$;", 1)[0]
    checks = _sql("251_agent_h5_specialist_allowlists.sql")
    intents_check = checks.split("agent_planning_runs_intent_allowlist CHECK (intent IN (", 1)[1].split("));", 1)[0]
    assert set(re.findall(r"'([a-z_.]+)'", intents_check)) == {i for i, _ in INTENTS}
    for (intent, version), spec in INTENTS.items():
        m = re.search(rf"p_intent = '{re.escape(intent)}' AND p_intent_version = {version}\s+THEN ARRAY\[([^\]]+)\]",
                      roles_sql)
        assert m and set(re.findall(r"'([a-z_]+)'", m.group(1))) == spec.initiator_roles, intent
    outcomes = checks.split("agent_planning_runs_plan_outcome_allowlist CHECK (", 1)[1].split(");", 1)[0]
    assert set(re.findall(r"'([a-z]+)'", outcomes)) == {"proposed", "recommended", "refused", "escalated", "rejected"}


def test_orchestrator_holds_no_tool_and_is_invisible_to_the_gateway():
    assert ORCHESTRATOR_AGENT_V1.tools == () and ORCHESTRATOR_AGENTS.get(ORCHESTRATOR_AGENT_ID, 1) is ORCHESTRATOR_AGENT_V1
    assert GATEWAY_AGENTS.get(ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_VERSION) is None
    assert all(agent != ORCHESTRATOR_AGENT_ID for agent, *_ in DB_ALLOWLIST)
    assert ORCHESTRATOR_AGENT_ID not in _sql("243_agent_gateway_rpcs.sql")
    assert H0_EXECUTION_SUPPORTED is False
    assert H2_EXECUTABLE_TOOLS == frozenset({("engineering.work_orders.lookup", 2), ("housekeeping.rooms.status_lookup", 1),
                                            ("engineering.work_orders.assign", 2),
                                            # H5 (ADR-0004): exactly these four, nothing broader
                                            ("engineering.work_orders.assignment_candidates", 1),
                                            ("housekeeping.rooms.readiness_lookup", 1),
                                            ("housekeeping.room_assignments.candidates", 1),
                                            ("housekeeping.room_assignments.assign", 1)})


# --- catalog ----------------------------------------------------------------------------------------------------------

def test_every_catalog_model_is_priced_capped_below_long_context_and_routed_safely():
    at = VERIFIED_AT + timedelta(days=1)
    for key, spec in MODEL_CATALOG.items():
        schedule = PRICE_BOOK.lookup(spec.provider, spec.model_id, at=at)
        assert schedule is not None, key
        assert schedule.long_context_threshold is None or spec.max_input_tokens <= schedule.long_context_threshold
        assert spec.streaming is False
    for workload, route in ROUTES.items():
        assert route.primary in MODEL_CATALOG and all(f in MODEL_CATALOG for f in route.fallbacks)
        primary = MODEL_CATALOG[route.primary]
        bound = primary.max_input_tokens
        p_exp = max_exposure(PRICE_BOOK.lookup(*route.primary, at=at), max_input_tokens=bound, max_output_tokens=1000)
        for fb in route.fallbacks:
            f_exp = max_exposure(PRICE_BOOK.lookup(*fb, at=at), max_input_tokens=bound, max_output_tokens=1000)
            assert f_exp <= p_exp, (workload, fb)
        assert resolve_route(workload, input_bytes=1_000, max_output_tokens=500, at=at).candidates


def test_execution_and_paid_calls_are_off_by_default_and_refused_in_production(monkeypatch):
    for name in ("AGENT_ORCHESTRATOR_EXECUTION_ENABLED", "AGENT_ORCHESTRATOR_PAID_CALLS_ENABLED"):
        monkeypatch.delenv(name, raising=False)
    default = OrchestratorSettings()
    assert default.execution_enabled is False and default.paid_calls_enabled is False
    assert not process_allows_orchestration(app_env="staging", settings=default)
    on = OrchestratorSettings(execution_enabled=True, paid_calls_enabled=True)
    assert process_allows_orchestration(app_env="staging", settings=on)
    for env in ("production", "Production", "prod", ""):
        assert not process_allows_orchestration(app_env=env, settings=on)
        assert not paid_calls_allowed(app_env=env, settings=on)
    assert not paid_calls_allowed(app_env="test", settings=OrchestratorSettings(paid_calls_enabled=True))

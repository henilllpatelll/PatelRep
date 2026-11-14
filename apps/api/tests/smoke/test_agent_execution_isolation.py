"""Static guards: H1 runtime stays isolated, synthetic-only, and free of models, tools, shells and dynamic code."""
from __future__ import annotations

import ast
import re
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[2]
PACKAGE = API_ROOT / "services" / "agent_execution"
MIGRATIONS = API_ROOT.parents[1] / "supabase" / "migrations"

FORBIDDEN_IMPORT_PREFIXES = (
    "openai", "anthropic", "services.ai", "services.opera", "routers", "subprocess", "importlib", "socketserver",
    "requests", "urllib", "fastapi", "apscheduler", "core.scheduler", "pickle", "marshal",
)
FORBIDDEN_CALLS = {"eval", "exec", "compile", "__import__"}


def _sources():
    return sorted(PACKAGE.glob("*.py"))


def test_package_imports_no_model_tool_shell_router_or_scheduler():
    for path in _sources():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            for name in names:
                assert not name.startswith(FORBIDDEN_IMPORT_PREFIXES), f"{path.name} imports {name}"
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                assert node.func.id not in FORBIDDEN_CALLS, f"{path.name} calls {node.func.id}()"


def test_worker_only_reaches_the_database_through_named_agent_rpcs_and_three_membership_tables():
    allowed_tables = {"tenants", "user_profiles", "user_roles", "agent_runtime_controls"}
    for path in _sources():
        source = path.read_text(encoding="utf-8")
        for table in re.findall(r"\.table\(\"([a-z_]+)\"\)", source):
            assert table in allowed_tables, f"{path.name} reads table {table}"
        for rpc in re.findall(r"rpc\(\"([a-z_]+)\"", source) + re.findall(r"_rpc\(\"([a-z_]+)\"", source):
            assert rpc.startswith("agent_"), f"{path.name} calls rpc {rpc}"


def test_identity_tables_are_only_read():
    source = (PACKAGE / "identity_authority.py").read_text(encoding="utf-8")
    assert not re.search(r"\.(insert|update|upsert|delete)\(", source)


def test_no_application_code_imports_or_starts_the_worker():
    offenders = []
    for path in API_ROOT.rglob("*.py"):
        rel = path.relative_to(API_ROOT).as_posix()
        # H2: services/agent_gateway/ is the worker's sibling runtime (its step executor reuses the H1 identity
        # revalidation and LeaseLost). It is itself never imported by application code -- test_agent_gateway_isolation.py.
        if rel.startswith(("services/agent_execution/", "services/agent_gateway/", "tests/", ".venv/")) \
                or "/site-packages/" in rel:
            continue
        if re.search(r"services[./]agent_execution", path.read_text(encoding="utf-8", errors="ignore")):
            offenders.append(rel)
    assert offenders == [], offenders


def test_api_container_start_command_is_unchanged():
    dockerfile = (API_ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert 'CMD ["sh", "-c", "uvicorn main:app' in dockerfile
    railway = (API_ROOT / "railway.toml").read_text(encoding="utf-8")
    assert "agent_execution" not in railway


def test_package_files_stay_under_the_500_line_limit():
    for path in _sources():
        assert len(path.read_text(encoding="utf-8").splitlines()) < 500, path.name


def test_h1_migrations_keep_the_synthetic_ceiling_and_logged_queue():
    schema = (MIGRATIONS / "238_agent_harness_durable_execution_schema.sql").read_text(encoding="utf-8")
    assert "CONSTRAINT agent_runs_h1_synthetic_only CHECK (agent_id = 'harness.synthetic' AND agent_version = 1)" in schema
    assert "pgmq.create('patelrep_agent_runs_v1')" in schema
    assert "create_unlogged" not in schema.split("pgmq.create_unlogged is never used")[1]
    assert "platform_execution_enabled" not in schema


def test_every_h1_function_is_invoker_with_an_empty_search_path_and_service_role_only():
    for name in ("239_agent_harness_durable_execution_rpcs.sql", "240_agent_harness_operations_rpcs.sql",
                 "238_agent_harness_durable_execution_schema.sql"):
        sql = (MIGRATIONS / name).read_text(encoding="utf-8")
        assert "SECURITY DEFINER" not in sql
        functions = re.findall(r"CREATE OR REPLACE FUNCTION (public\.[a-z_]+)\(", sql)
        assert functions, name
        for fn in functions:
            body = sql.split(f"CREATE OR REPLACE FUNCTION {fn}(", 1)[1].split("$function$;", 1)[0]
            assert "SET search_path = ''" in body, f"{fn} lacks an empty search_path"
            assert re.search(rf"REVOKE ALL ON FUNCTION {re.escape(fn)}\(.*FROM PUBLIC, anon, authenticated;", sql), fn

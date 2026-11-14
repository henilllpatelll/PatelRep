"""H0 no-execution guarantees and drift guards.

H0 must not be able to execute a tool, call a model, start a workflow or worker, write operational data, or send a
billable request -- even with the example manifests registered and a fully permissive policy input.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

from core.feature_registry import FEATURE_REGISTRY
from core.roles import ALL_ROLES
from services.agent_harness import controls as harness_controls
from services.agent_harness.agents import AGENT_HARNESS_FLAG
from services.agent_harness.autonomy import H0_EXECUTABLE_AUTONOMY
from services.agent_harness.controls import H0_EXECUTION_SUPPORTED, load_runtime_controls, require_execution_supported
from services.agent_harness.errors import AgentExecutionDisabled
from services.agent_harness.examples import EXAMPLE_AGENT_V1, build_example_registries
from services.agent_harness.policy import Outcome
from services.agent_harness.vocabulary import (
    CAPABILITY_CATALOG,
    ROOM_ASSIGNMENT_WRITE_ROLES,
    WORK_ORDER_ASSIGN_ROLES,
    AutonomyLevel,
)
from tests.smoke.agent_harness_support import ASSIGN, LOOKUP, NOW, controls, decide, human_ctx, request

API_ROOT = Path(__file__).resolve().parents[2]
PACKAGE = API_ROOT / "services" / "agent_harness"
FORBIDDEN_IMPORT_PREFIXES = (
    "core.database", "core.scheduler", "core.config", "supabase", "openai", "anthropic", "httpx", "requests",
    "apscheduler", "stripe", "twilio", "subprocess", "socket", "routers", "middleware.credits", "services.ai",
    "services.opera", "services.sms", "services.notify", "agents", "asyncio",
)
FORBIDDEN_BUILTINS = {"eval", "exec", "compile", "__import__", "getattr", "setattr", "open"}
FORBIDDEN_METHODS = {"system", "popen", "import_module", "getenv", "execute", "rpc", "table", "create"}


def _package_sources():
    return sorted(PACKAGE.glob("*.py"))


@pytest.mark.parametrize("path", _package_sources(), ids=lambda p: p.name)
def test_package_imports_no_database_provider_queue_or_router(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        names = []
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module:
            names = [node.module]
        for name in names:
            assert not name.startswith(FORBIDDEN_IMPORT_PREFIXES), f"{path.name} imports {name}"
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name):
                assert func.id not in FORBIDDEN_BUILTINS, f"{path.name} calls {func.id}()"
            elif isinstance(func, ast.Attribute):
                assert func.attr not in FORBIDDEN_METHODS, f"{path.name} calls .{func.attr}()"


def test_package_files_stay_under_the_500_line_limit():
    for path in _package_sources():
        assert len(path.read_text(encoding="utf-8").splitlines()) < 500, path.name


def test_no_application_code_wires_the_harness_in():
    pattern = re.compile(r"agent_harness")
    offenders = []
    for path in API_ROOT.rglob("*.py"):
        rel = path.relative_to(API_ROOT).as_posix()
        if rel.startswith(("services/agent_harness/", "tests/", ".venv/")) or "/site-packages/" in rel:
            continue
        if pattern.search(path.read_text(encoding="utf-8", errors="ignore")):
            offenders.append(rel)
    # These two only MENTION the harness (a docstring and the ai_agents flag description); nothing imports or mounts it.
    assert set(offenders) <= {"services/policy.py", "core/feature_registry.py"}, offenders
    for rel in offenders:
        source = (API_ROOT / rel).read_text(encoding="utf-8")
        assert not re.search(r"^\s*(from|import)\s+services\.agent_harness", source, re.M), rel


def test_execution_is_hard_disabled_in_code():
    assert H0_EXECUTION_SUPPORTED is False
    assert H0_EXECUTABLE_AUTONOMY is AutonomyLevel.OBSERVE
    assert load_runtime_controls(NOW).platform_execution_enabled is False
    with pytest.raises(AgentExecutionDisabled):
        require_execution_supported()


def test_execution_ceiling_has_no_configuration_override(monkeypatch):
    for name in ("AGENT_HARNESS_EXECUTION_ENABLED", "AGENT_EXECUTION_ENABLED", "AI_AGENTS_ENABLED"):
        monkeypatch.setenv(name, "true")
    assert load_runtime_controls(NOW).platform_execution_enabled is False
    source = Path(harness_controls.__file__).read_text(encoding="utf-8")
    assert "os" not in vars(harness_controls)
    assert not re.search(r"os\.environ|getenv|settings\.", source)


def test_registered_manifest_triggers_no_model_database_or_worker(monkeypatch):
    import anthropic
    import openai

    from core import database, scheduler

    def boom(*_a, **_k):
        raise AssertionError("H0 contacted an external system")

    monkeypatch.setattr(openai, "OpenAI", boom)
    monkeypatch.setattr(anthropic, "Anthropic", boom)
    monkeypatch.setattr(database.supabase, "table", boom)
    monkeypatch.setattr(database.supabase, "rpc", boom)
    monkeypatch.setattr(scheduler, "build_scheduler", boom, raising=False)

    tools, agents = build_example_registries()
    assert agents.get(EXAMPLE_AGENT_V1.agent_id, 1).enabled is False
    for role in ALL_ROLES:
        for tool in (LOOKUP, ASSIGN):
            decision = decide(human_ctx(role), request(tool, arguments={"work_order_id": "x", "idempotency_key": "k"}),
                              agents=agents)
            assert decision.authorizes_execution is False


def test_no_decision_ever_authorizes_execution_even_with_everything_enabled():
    from tests.smoke.test_agent_harness_policy import GRANTS, WIDE, _approval, ASSIGN_ARGS

    allow = decide(human_ctx("gm"), agents=WIDE, ctl=controls())
    assert allow.outcome is Outcome.ALLOW and allow.authorizes_execution is False
    write = decide(human_ctx("gm"), request(ASSIGN, arguments=ASSIGN_ARGS), agents=WIDE, grants=GRANTS,
                   approval=_approval())
    assert write.outcome is Outcome.DENY and write.authorizes_execution is False


def test_package_exposes_no_executor_or_dispatcher():
    for path in _package_sources():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                assert not re.match(r"^(execute|dispatch|invoke|run|call_tool|start|enqueue|send)", node.name), (
                    f"{path.name} defines {node.name}()"
                )
            assert not isinstance(node, ast.AsyncFunctionDef), f"{path.name} defines async code"


# --- drift guards -----------------------------------------------------------------------------------------------

def test_harness_flag_is_registered_backend_enforced_and_not_a_release_toggle():
    flag = FEATURE_REGISTRY[AGENT_HARNESS_FLAG]
    assert flag.backend_enforced is True and flag.type == "entitlement"


def test_harness_flag_defaults_off_through_the_existing_flag_system(monkeypatch):
    from core import feature_flags
    from tests.smoke.fake_supabase import FakeDB

    feature_flags._cache.clear()
    monkeypatch.setattr(feature_flags, "supabase", FakeDB({"tenant_feature_flags": []}))
    assert feature_flags.is_feature_enabled("hotel-a", AGENT_HARNESS_FLAG) is False
    feature_flags._cache.clear()


def _require_role_args(router_file: str, path: str) -> set[str]:
    tree = ast.parse((API_ROOT / "routers" / router_file).read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if not any(isinstance(d, ast.Call) and d.args and isinstance(d.args[0], ast.Constant) and d.args[0].value == path
                   for d in node.decorator_list):
            continue
        for call in ast.walk(node):
            if isinstance(call, ast.Call) and getattr(call.func, "id", "") == "require_role":
                return {a.value for a in call.args if isinstance(a, ast.Constant)}
    raise AssertionError(f"{router_file} {path} has no require_role gate")


def test_work_order_assign_grant_mirrors_the_domain_route():
    assert set(WORK_ORDER_ASSIGN_ROLES) == _require_role_args("work_orders.py", "/{wo_id}/assign")
    assert CAPABILITY_CATALOG["engineering.work_orders.assign"].granted_roles == frozenset(WORK_ORDER_ASSIGN_ROLES)


def test_room_assignment_grant_mirrors_the_ai_assignment_authority():
    from services.ai.authorization import ASSIGNMENT_ROLES

    assert frozenset(ROOM_ASSIGNMENT_WRITE_ROLES) == ASSIGNMENT_ROLES


def test_capability_grants_use_only_canonical_roles():
    for cap in CAPABILITY_CATALOG.values():
        assert cap.granted_roles and cap.granted_roles <= set(ALL_ROLES), cap.capability_id

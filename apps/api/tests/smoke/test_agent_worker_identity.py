"""H6 Stage 2 static + unit contracts: the worker's least-privileged identity (migration 255, worker_identity.py).

The behaviour against the REAL restricted principal is proven in tests/integration/test_agent_worker_identity.py; these
checks pin the reviewed SHAPE so a later edit cannot silently widen it."""
from __future__ import annotations

import ast
import base64
import json
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

from services.agent_execution import worker_identity as wi
from services.agent_execution.worker_credentials import issue, mint_worker_token

API_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = API_ROOT.parents[1] / "supabase" / "migrations"
M255 = (MIGRATIONS / "255_agent_worker_database_identity.sql").read_text(encoding="utf-8")
DESTRUCTIVE = re.compile(r"\b(?:DROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA|FUNCTION|POLICY|INDEX)|TRUNCATE\b|DELETE\s+FROM\b|"
                         r"ALTER\s+(?:TABLE|TYPE)\b[^;]*\b(?:DROP|RENAME|TYPE)\b)", re.I)
# Human decisions, controls, pricing, admissions and direct domain writes: never reachable by the worker.
NEVER_FOR_WORKER = {
    "agent_tool_approval_decide", "agent_tool_approval_revoke", "agent_tool_grant_set", "agent_execution_enablement_set",
    "agent_tool_control_set", "agent_model_enablement_set", "agent_model_budget_policy_set", "agent_runtime_control_set",
    "agent_model_attempt_reconcile", "agent_run_admit", "agent_tool_run_admit", "agent_planning_run_admit",
    "agent_proposal_handoff_admit", "agent_proposal_handoff_cancel", "agent_run_request_cancel", "agent_run_request_pause",
    "agent_run_resume", "agent_model_attempt_reserve", "agent_model_attempt_dispatch", "agent_model_attempt_settle",
    "agent_model_attempt_release", "work_order_assign_apply", "publish_assignment_batch",
    "agent_audit_privileges_enforce", "agent_worker_credential_register", "agent_worker_credential_revoke",
    "agent_control_center_hotel_pause_set", "agent_control_center_run_control",
}


def _code(sql: str) -> str:
    return "\n".join(line for line in sql.splitlines() if not line.lstrip().startswith("--"))


def _b64(obj: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")


def _token(**claims) -> str:
    return f"{_b64({'alg': 'HS256'})}.{_b64(claims)}.sig"


NOW = datetime(2026, 11, 17, tzinfo=timezone.utc)
GOOD = dict(role="agent_worker", jti=str(uuid.uuid4()), iat=int(NOW.timestamp()) - 10, exp=int(NOW.timestamp()) + 3600)


# ---------------------------------------------------------------- the migration and the Python mirror are one contract
def test_python_allowlist_equals_the_migration_allowlist_and_excludes_every_decision_or_control():
    block = M255.split("FUNCTION public.agent__worker_allowed_rpcs()")[1].split("$function$;")[0]
    assert set(re.findall(r"'([a-z_]+)'", block)) == set(wi.WORKER_RPCS)
    assert not (wi.WORKER_RPCS & NEVER_FOR_WORKER)


def test_every_allowed_rpc_has_exactly_one_reviewed_definer_wrapper():
    wrappers = re.findall(r"CREATE OR REPLACE FUNCTION public\.agent_worker_rpc__([a-z_]+)\(", M255)
    assert sorted(wrappers) == sorted(wi.WORKER_RPCS)
    for name in wrappers:
        body = M255.split(f"FUNCTION public.agent_worker_rpc__{name}(")[1].split("$function$;")[0]
        assert "SECURITY DEFINER SET search_path = ''" in body, name
        statements = [s.strip() for s in body.split("BEGIN", 1)[1].split(";") if s.strip()]
        assert statements[0] == "PERFORM public.agent__worker_assert()", name  # the credential check comes first
        assert re.search(rf"(RETURN|PERFORM) public\.{name}\(", body), name   # then the UNCHANGED H1-H5 function
        assert re.search(rf"REVOKE ALL ON FUNCTION public\.agent_worker_rpc__{name}\([^)]*\) FROM PUBLIC, anon, "
                         rf"authenticated, service_role;", M255), name
        assert re.search(rf"GRANT EXECUTE ON FUNCTION public\.agent_worker_rpc__{name}\([^)]*\) TO agent_worker;", M255)


def test_agent_worker_receives_only_wrappers_the_policy_helper_schema_usage_and_reviewed_columns():
    grants = re.findall(r"^GRANT ([^;]+) TO agent_worker;", _code(M255), re.M)
    other = [g for g in grants if not g.startswith("EXECUTE ON FUNCTION public.agent_worker_rpc__")]
    parsed = {}
    for g in other:
        m = re.match(r"SELECT \(([^)]*)\) ON public\.([a-z_]+)$", g)
        if m:
            parsed[m.group(2)] = {c.strip() for c in m.group(1).split(",")}
    assert parsed == {t: set(c) for t, c in wi.WORKER_READ_COLUMNS.items()}
    rest = [g for g in other if not g.startswith("SELECT (")]
    assert sorted(rest) == ["EXECUTE ON FUNCTION public.agent__worker_credential_ok()", "USAGE ON SCHEMA public"]
    assert not re.search(r"GRANT\s+(ALL|INSERT|UPDATE|DELETE|TRUNCATE)\b[^;]*TO agent_worker", M255, re.I)
    assert "BYPASSRLS" not in _code(M255).replace("NOBYPASSRLS", "") and "GRANT service_role TO agent_worker" not in M255
    assert "agent_worker_read" in M255 and "FOR SELECT TO agent_worker" in M255


def test_255_is_forward_only_and_its_only_destructive_token_is_truncate():
    assert "-- migration-safety: destructive-reviewed" in M255 and "-- rollback-plan:" in M255
    hits = {m.group(0).upper().split()[0] for m in DESTRUCTIVE.finditer(_code(M255))}
    assert hits == {"TRUNCATE"}, hits
    assert not re.search(r"\bDROP\b|ALTER\s+TABLE[^;]*\b(DROP|RENAME)\b|DELETE\s+FROM", _code(M255), re.I)
    own = {"agent_worker_credential_register", "agent_worker_credential_revoke"}  # operator RPCs 255 itself defines
    for name in NEVER_FOR_WORKER:  # no wrapper, no grant to the worker, no redefinition of an H1-H5 body
        assert f"agent_worker_rpc__{name}(" not in M255, name
        assert name in own or f"FUNCTION public.{name}(" not in M255, name
        assert not re.search(rf"GRANT EXECUTE ON FUNCTION public\.{name}\([^)]*\) TO agent_worker", M255), name


# ---------------------------------------------------------------- in-process mirror (fails before any request)
class _Inner:
    def __init__(self):
        self.calls = []

    def rpc(self, name, params):
        self.calls.append(("rpc", name))
        return self

    def table(self, name):
        self.calls.append(("table", name))
        return self

    def select(self, columns):
        self.calls.append(("select", columns))
        return self


def test_restricted_client_maps_allowed_rpcs_to_wrappers_and_refuses_everything_else():
    inner = _Inner()
    client = wi.RestrictedWorkerClient(inner)
    client.rpc("agent_run_claim", {"p_worker": "w"})
    assert inner.calls[-1] == ("rpc", "agent_worker_rpc__agent_run_claim")
    for name in sorted(NEVER_FOR_WORKER):
        with pytest.raises(wi.WorkerIdentityError):
            client.rpc(name, {})
    client.table("rooms").select("id, tenant_id, room_number, room_status(status, fo_status)")
    for table, cols in (("agent_tool_approvals", "id"), ("rooms", "*"), ("room_status", "guest_name"),
                        ("work_orders", "id, description"), ("rooms", "id, room_status(guest_name)")):
        with pytest.raises(wi.WorkerIdentityError):
            client.table(table).select(cols)
    assert not hasattr(client.table("rooms"), "insert") and not hasattr(client.table("rooms"), "update")
    assert not hasattr(client, "storage") and not hasattr(client, "auth") and not hasattr(client, "postgrest")


@pytest.mark.parametrize("override,code", [
    ({"role": "service_role"}, "worker_token_wrong_role"),
    ({"role": "authenticated"}, "worker_token_wrong_role"),
    ({"jti": "not-a-uuid"}, "worker_token_missing_jti"),
    ({"sub": str(uuid.uuid4())}, "worker_token_carries_user_claims"),
    ({"hotel_id": str(uuid.uuid4())}, "worker_token_carries_user_claims"),
    ({"exp": int(NOW.timestamp()) + 40 * 86400}, "worker_token_lifetime_too_long"),
    ({"exp": int(NOW.timestamp()) - 1}, "worker_token_expired"),
])
def test_worker_token_shape_is_refused_unless_least_privileged(override, code):
    with pytest.raises(wi.WorkerIdentityError) as err:
        wi.inspect_worker_token(_token(**{**GOOD, **override}), now=NOW)
    assert err.value.code == code
    assert wi.inspect_worker_token(_token(**GOOD), now=NOW)["role"] == "agent_worker"
    with pytest.raises(wi.WorkerIdentityError):
        wi.inspect_worker_token("not.a.jwt", now=NOW)


def test_privileged_api_keys_and_service_role_environments_are_refused():
    for key in (_token(role="service_role"), "sb_secret_abc", ""):
        with pytest.raises(wi.WorkerIdentityError):
            wi.refuse_privileged_api_key(key)
    wi.refuse_privileged_api_key(_token(role="anon"))
    wi.refuse_privileged_api_key("sb_publishable_abc")
    for name in ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"):
        with pytest.raises(wi.WorkerIdentityError):
            wi.refuse_service_role_environment({name: "x"})
    wi.refuse_service_role_environment({"SUPABASE_SERVICE_ROLE_KEY": "  "})


def test_staging_target_guard_is_enforced_without_the_api_settings():
    s = wi.WorkerDatabaseSettings(url="https://abc.supabase.co", api_key="k", token="t")
    wi.enforce_target(s, app_env="staging", environ={"STAGING_EXPECTED_SUPABASE_HOST": "abc.supabase.co"})
    for env in ({}, {"STAGING_EXPECTED_SUPABASE_HOST": "other.supabase.co"},
                {"STAGING_EXPECTED_SUPABASE_HOST": "abc.supabase.co", "PRODUCTION_SUPABASE_HOST": "abc.supabase.co"}):
        with pytest.raises(wi.WorkerIdentityError):
            wi.enforce_target(s, app_env="staging", environ=env)
    with pytest.raises(wi.WorkerIdentityError):
        wi.enforce_target(wi.WorkerDatabaseSettings(url="ftp://x", api_key="k", token="t"), app_env="test", environ={})


# ---------------------------------------------------------------- the worker entrypoint has no service-role path
def _function_source(path: Path, name: str) -> str:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    node = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == name)
    return ast.get_source_segment(path.read_text(encoding="utf-8"), node) or ""


def test_the_worker_command_never_loads_the_api_settings_or_the_service_role_client():
    source = _function_source(API_ROOT / "services" / "agent_execution" / "__main__.py", "cmd_worker")
    imports = [n for n in ast.walk(ast.parse(source)) if isinstance(n, (ast.Import, ast.ImportFrom))]
    modules = {getattr(n, "module", None) or "" for n in imports} | {a.name for n in imports for a in n.names}
    assert not {m for m in modules if m.startswith(("core.config", "core.database"))}, modules
    assert "get_supabase(" not in source and "supabase_service_role_key" not in source
    for module in ("worker.py", "worker_identity.py", "store.py", "identity_authority.py", "controls_store.py"):
        text = (API_ROOT / "services" / "agent_execution" / module).read_text(encoding="utf-8")
        assert not re.search(r"^\s*(from|import)\s+core\.(config|database)", text, re.M), module
    factory = (API_ROOT / "services" / "agent_orchestrator" / "providers_factory.py").read_text(encoding="utf-8")
    assert not re.search(r"^\s*from core\.config|import core\.config|from core\.config import", factory, re.M)


def test_the_worker_refuses_to_start_with_a_service_role_key_or_without_a_worker_token(monkeypatch, capsys):
    from services.agent_execution.__main__ import main

    monkeypatch.setenv("AGENT_WORKER_ENABLED", "true")
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "present")
    assert main(["worker"]) == 2 and "service_role_credential_present" in capsys.readouterr().out
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY")
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    monkeypatch.setenv("AGENT_WORKER_DB_URL", "http://127.0.0.1:54321")
    monkeypatch.setenv("AGENT_WORKER_DB_API_KEY", _token(role="anon"))
    monkeypatch.setenv("AGENT_WORKER_DB_TOKEN", _token(**{**GOOD, "role": "service_role"}))
    assert main(["worker"]) == 2 and "worker_token_wrong_role" in capsys.readouterr().out
    monkeypatch.delenv("AGENT_WORKER_ENABLED")
    assert main(["worker"]) == 0  # disabled: exits before reading any credential


def test_minted_tokens_carry_only_the_worker_role_and_production_issuance_is_refused():
    issued_at = datetime.now(timezone.utc).replace(microsecond=0)
    token = mint_worker_token(jti=str(uuid.uuid4()), issued_at=issued_at,
                              expires_at=datetime.fromtimestamp(time.time() + 3600, timezone.utc), secret="s" * 40)
    claims = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
    assert set(claims) == {"role", "jti", "iss", "iat", "exp"} and claims["role"] == "agent_worker"
    assert issue(object(), label="w-1", days=1, operator="op", app_env="production", secret="s" * 40) == {
        "ok": False, "reason": "production_refused"}
    with pytest.raises(ValueError):
        mint_worker_token(jti=str(uuid.uuid4()), issued_at=issued_at,
                          expires_at=datetime.fromtimestamp(time.time() + 40 * 86400, timezone.utc), secret="s" * 40)

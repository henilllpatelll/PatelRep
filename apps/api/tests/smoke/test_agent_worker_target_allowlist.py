"""H6 P1 static + unit contracts: the worker's database-target allowlist, its bound-hotel startup proof, and the shape of
migration 257. The database behaviour is proven in tests/integration/test_agent_worker_tenant_binding.py."""
from __future__ import annotations

import ast
import base64
import itertools
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

from services.agent_execution import worker_identity as wi

API_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = API_ROOT.parents[1] / "supabase" / "migrations"
M257 = (MIGRATIONS / "257_agent_worker_tenant_binding.sql").read_text(encoding="utf-8")
PROD, STG = "prodhost.supabase.co", "staginghost.supabase.co"
APP_ENVS = ("development", "test", "staging", "production", "Production", "prod", "", "staging ", "TEST", "dev")
HOSTS = (PROD, PROD.upper(), STG, "127.0.0.1", "localhost", "evil.example.com", f"{PROD}.evil.example.com", "kong")
ENVIRONS = {
    "both": {"PRODUCTION_SUPABASE_HOST": PROD, "STAGING_EXPECTED_SUPABASE_HOST": STG},
    "both_upper": {"PRODUCTION_SUPABASE_HOST": PROD.upper(), "STAGING_EXPECTED_SUPABASE_HOST": STG.upper()},
    "staging_is_prod": {"PRODUCTION_SUPABASE_HOST": PROD, "STAGING_EXPECTED_SUPABASE_HOST": PROD},
    "prod_only": {"PRODUCTION_SUPABASE_HOST": PROD},
    "staging_only": {"STAGING_EXPECTED_SUPABASE_HOST": STG},
    "none": {},
}


def _outcome(app_env: str, host: str, environ: dict) -> str:
    settings = wi.WorkerDatabaseSettings(url=f"https://{host}", api_key="k", token="t")
    try:
        wi.enforce_target(settings, app_env=app_env, environ=environ)
    except wi.WorkerIdentityError as exc:
        return exc.code
    return "ALLOW"


def test_the_production_host_is_refused_under_every_app_env_and_variable_combination():
    rows = [(env, host, name, _outcome(env, host, environ))
            for env, host, (name, environ) in itertools.product(APP_ENVS, HOSTS, ENVIRONS.items())]
    allowed = {(env, host.lower(), name) for env, host, name, out in rows if out == "ALLOW"}
    assert len(rows) == len(APP_ENVS) * len(HOSTS) * len(ENVIRONS) == 480
    assert not {r for r in allowed if r[1] == PROD}, "the production host must never be allowed in H6"
    local = {(env, host, name) for env in ("development", "test") for host in ("127.0.0.1", "localhost")
             for name in ENVIRONS}
    assert allowed == local | {("staging", STG, "both"), ("staging", STG, "both_upper")}, sorted(allowed - local)


def test_every_refusal_has_a_specific_reason():
    assert _outcome("production", STG, ENVIRONS["both"]) == "production_worker_refused"
    assert _outcome("production", PROD, ENVIRONS["both"]) == "worker_db_target_production"
    assert _outcome("test", PROD, ENVIRONS["both"]) == "worker_db_target_production"
    assert _outcome("test", PROD, {}) == "worker_db_target_not_local"   # unknown prod host: loopback only anyway
    assert _outcome("development", STG, ENVIRONS["both"]) == "worker_db_target_not_local"
    assert _outcome("staging", STG, ENVIRONS["staging_only"]) == "production_host_unknown"
    assert _outcome("staging", PROD, ENVIRONS["staging_is_prod"]) == "worker_db_target_production"
    assert _outcome("staging", STG, ENVIRONS["staging_is_prod"]) == "worker_db_target_not_staging"
    assert _outcome("Production", STG, ENVIRONS["both"]) == "app_env_invalid"
    bad = wi.WorkerDatabaseSettings(url="ftp://127.0.0.1", api_key="k", token="t")
    with pytest.raises(wi.WorkerIdentityError):
        wi.enforce_target(bad, app_env="test", environ={})


# ---------------------------------------------------------------- transport: scheme, port and URL shape (P1 review)
def _url_outcome(url: str, app_env: str = "staging", environ: dict | None = None) -> str:
    settings = wi.WorkerDatabaseSettings(url=url, api_key="k", token="t")
    try:
        wi.enforce_target(settings, app_env=app_env, environ=ENVIRONS["both"] if environ is None else environ)
    except wi.WorkerIdentityError as exc:
        return exc.code
    return "ALLOW"


@pytest.mark.parametrize("url", [
    f"https://{STG}", f"https://{STG}/", f"https://{STG}/rest/v1", f"https://{STG}/rest/v1/", f"https://{STG}:443",
    f"https://{STG.upper()}",
])
def test_staging_allows_only_https_on_the_default_port(url):
    assert _url_outcome(url) == "ALLOW"


@pytest.mark.parametrize("url", [f"http://{STG}", f"http://{STG}/rest/v1", f"http://{STG}:443", f"http://{STG}:80"])
def test_staging_refuses_plain_http(url):
    assert _url_outcome(url) == "worker_db_transport_insecure"


@pytest.mark.parametrize("port", [1, 80, 444, 5432, 6543, 8443, 54321, 65535])
def test_staging_refuses_nonstandard_ports(port):
    assert _url_outcome(f"https://{STG}:{port}") == "worker_db_port_not_allowed"


MALFORMED = [
    "", "   ", "https://", "https:///rest/v1", f"{STG}", f"//{STG}", f"https:/{STG}", f"https:{STG}",
    f"HTTPS://{STG}", f"Https://{STG}", f"ftp://{STG}", f"ws://{STG}", f"wss://{STG}", f"file://{STG}",
    f"postgres://{STG}:5432", f"postgresql://{STG}", f"javascript://{STG}", f"git+https://{STG}",
    f"https://user@{STG}", f"https://user:pw@{STG}", f"https://{PROD}@{STG}", f"https://{STG}@{PROD}",
    f"https://{STG}:@evil.example.com", f"https://:pw@{STG}",
    f"https://{STG}/rest/v2", f"https://{STG}/x", f"https://{STG}/rest/v1/x",
    f"https://{STG}?", f"https://{STG}?x=1", f"https://{STG}#", f"https://{STG}#frag", f"https://{STG}/?a",
    f"https://{STG}:", f"https://{STG}:0", f"https://{STG}:-1", f"https://{STG}:65536", f"https://{STG}:99999",
    f"https://{STG}:0443", f"https://{STG}:443x", f"https://{STG}:abc", f"https://{STG}: 443",
    f"https://{STG}.", f"https://.{STG}", f"https://{STG.replace('.', '..', 1)}", f"https://-{STG}",
    f"https://{STG}\\@{PROD}", f"https://{STG}\n.evil", "https://st ghost.supabase.co",
    f"https://{STG}%2F", "https://[::1]", "https://[::1]:443", f"https://{'a' * 64}.supabase.co",
    f"https://xn--{STG}\x00",
]


@pytest.mark.parametrize("url", MALFORMED)
def test_malformed_or_alternate_scheme_targets_are_refused_under_every_app_env(url):
    for app_env in ("development", "test", "staging"):
        assert _url_outcome(url, app_env) == "worker_db_url_invalid", (url, app_env)


@pytest.mark.parametrize("url", [
    "http://127.0.0.1", "http://127.0.0.1:54321", "http://localhost:54321", "http://localhost:54321/rest/v1",
    "https://127.0.0.1:54321", "https://localhost", "http://127.0.0.1:1", "http://localhost:65535",
])
def test_development_and_test_allow_http_only_to_approved_loopback_hosts(url):
    for app_env in ("development", "test"):
        assert _url_outcome(url, app_env) == "ALLOW", (url, app_env)


@pytest.mark.parametrize("host", [
    STG, PROD, "evil.example.com", "127.0.0.2", "0.0.0.0", "localhost.evil.example.com", "127.0.0.1.nip.io",
    "kong", "host.docker.internal", "2130706433",
])
def test_development_and_test_refuse_every_non_loopback_host_over_http_and_https(host):
    for scheme, app_env in itertools.product(("http", "https"), ("development", "test")):
        expected = "worker_db_target_production" if host == PROD else "worker_db_target_not_local"
        assert _url_outcome(f"{scheme}://{host}:54321", app_env) == expected, (scheme, host, app_env)


def test_production_and_loopback_are_never_reachable_from_staging_whatever_the_transport():
    for url in (f"https://{PROD}", f"http://{PROD}", "https://127.0.0.1", "http://127.0.0.1:54321", "https://localhost"):
        assert _url_outcome(url) != "ALLOW", url
    assert _url_outcome(f"https://{PROD}") == "worker_db_target_production"
    assert _url_outcome("https://localhost") == "worker_db_target_not_staging"


@pytest.mark.parametrize("environ", [
    {"PRODUCTION_SUPABASE_HOST": f"https://{PROD}", "STAGING_EXPECTED_SUPABASE_HOST": STG},
    {"PRODUCTION_SUPABASE_HOST": f"{PROD}.", "STAGING_EXPECTED_SUPABASE_HOST": STG},
    {"PRODUCTION_SUPABASE_HOST": f"{PROD}:443", "STAGING_EXPECTED_SUPABASE_HOST": STG},
    {"PRODUCTION_SUPABASE_HOST": PROD, "STAGING_EXPECTED_SUPABASE_HOST": f"https://{STG}"},
    {"PRODUCTION_SUPABASE_HOST": PROD, "STAGING_EXPECTED_SUPABASE_HOST": f"{STG}/"},
    {"PRODUCTION_SUPABASE_HOST": PROD, "STAGING_EXPECTED_SUPABASE_HOST": f"{STG}:443"},
])
def test_malformed_host_variables_fail_closed_for_staging(environ):
    assert _url_outcome(f"https://{STG}", environ=environ) in ("production_host_unknown", "worker_db_target_not_staging")


# ---------------------------------------------------------------- the bound-hotel startup proof (fake client)
class _Query:
    def __init__(self, rows, log):
        self.rows, self.log = rows, log

    def eq(self, column, value):
        self.log.append(("eq", column, value))
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _Inner:
    def __init__(self, rows):
        self.rows, self.log = rows, []

    def table(self, name):
        self.log.append(("table", name))
        return self

    def select(self, columns):
        self.log.append(("select", columns))
        return _Query(self.rows, self.log)


A, B = str(uuid.uuid4()), str(uuid.uuid4())


@pytest.mark.parametrize("rows", [[], [{"id": A}, {"id": B}], [{"id": "not-a-uuid"}], [{"x": A}], [{"id": A}, {"id": A}]])
def test_startup_refuses_unless_exactly_one_bound_hotel_is_visible(rows):
    with pytest.raises(wi.WorkerIdentityError) as err:
        wi.verify_bound_identity(wi.RestrictedWorkerClient(_Inner(rows)))
    assert err.value.code == "worker_credential_not_bound"


def test_startup_pins_the_client_to_the_database_derived_hotel_and_never_rebinds():
    inner = _Inner([{"id": A.upper()}])
    client = wi.RestrictedWorkerClient(inner)
    assert wi.verify_bound_identity(client) == A and client.tenant_id == A
    client.table("work_orders").select("id, tenant_id").execute()
    client.table("tenants").select("id").execute()
    assert ("eq", "tenant_id", A) in inner.log and ("eq", "id", A) in inner.log
    with pytest.raises(wi.WorkerIdentityError):
        client.bind_tenant(B)
    with pytest.raises(wi.WorkerIdentityError):
        wi.RestrictedWorkerClient(_Inner([])).bind_tenant("hotel-a")


def test_worker_ids_are_namespaced_by_the_bound_hotel():
    assert wi.bound_worker_id(A, "w-1") == f"{A}:w-1"
    assert wi.bound_worker_id(A, f"{A}:w-1") == f"{A}:w-1"
    for bad in ("", "x" * 70, "bad id"):
        with pytest.raises(wi.WorkerIdentityError):
            wi.bound_worker_id(A, bad)


def _b64(obj: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")


def test_the_worker_refuses_to_start_when_the_credential_is_not_bound(monkeypatch, capsys):
    from services.agent_execution.__main__ import main

    now = int(datetime.now(timezone.utc).timestamp())
    token = f"{_b64({'alg': 'HS256'})}.{_b64({'role': 'agent_worker', 'jti': str(uuid.uuid4()), 'iat': now, 'exp': now + 600})}.s"
    monkeypatch.setenv("AGENT_WORKER_ENABLED", "true")
    monkeypatch.setenv("APP_ENV", "test")
    for name in ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "AGENT_WORKER_DB_SERVICE_ROLE_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AGENT_WORKER_DB_URL", "http://127.0.0.1:54321")
    monkeypatch.setenv("AGENT_WORKER_DB_API_KEY", f"{_b64({'alg': 'HS256'})}.{_b64({'role': 'anon'})}.s")
    monkeypatch.setenv("AGENT_WORKER_DB_TOKEN", token)
    monkeypatch.setattr(wi, "build_worker_client", lambda *a, **k: wi.RestrictedWorkerClient(_Inner([])))
    assert main(["worker"]) == 2 and "worker_credential_not_bound" in capsys.readouterr().out
    monkeypatch.setenv("AGENT_WORKER_DB_URL", f"https://{PROD}")  # a non-loopback host is refused before any request
    assert main(["worker"]) == 2 and "worker_db_target_not_local" in capsys.readouterr().out


def test_the_worker_composition_proves_the_binding_before_any_slot_starts():
    source = (API_ROOT / "services" / "agent_execution" / "__main__.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    cmd = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "cmd_worker")
    body = ast.get_source_segment(source, cmd) or ""
    order = [body.index(s) for s in ("enforce_target(", "verify_bound_identity(", "bound_worker_id(",
                                     ".worker_heartbeat(", "Worker(worker_settings")]
    assert order == sorted(order), order
    assert "client.bind_tenant(tenant_id)" in body


# ---------------------------------------------------------------- migration 257: shape and mirrors
def _code(sql: str) -> str:
    return "\n".join(line for line in sql.splitlines() if not line.lstrip().startswith("--"))


def test_257_is_forward_only_reviewed_and_its_only_destructive_token_is_truncate():
    assert "-- migration-safety: destructive-reviewed" in M257 and "-- rollback-plan:" in M257
    code = _code(M257)
    assert not re.search(r"\bDROP\b|\bRENAME\b|DELETE\s+FROM|ALTER\s+TABLE[^;]*\b(DROP|TYPE)\b", code, re.I)
    assert re.findall(r"\bTRUNCATE\b", code, re.I)  # only inside BEFORE TRUNCATE refusal triggers / REVOKE lists
    for line in code.splitlines():
        if re.search(r"\bTRUNCATE\b", line, re.I):
            assert re.search(r"BEFORE TRUNCATE ON|REVOKE TRUNCATE|'TRUNCATE'|never truncated|protected from TRUNCATE",
                             line), line


REVIEWED_REDEFINITIONS = {
    # 255 helpers / operator RPCs and the 255/256 verifier, registry and enforcement (strict supersets)
    "agent__worker_credential_ok", "agent_worker_credential_register", "agent_worker_credentials_list",
    "agent_worker_privilege_violations", "agent__audit_protected_tables", "agent_audit_privilege_violations",
    "agent_audit_privileges_enforce",
}
NEW_FUNCTIONS = {
    "agent__guard_deployment_identity", "agent__guard_worker_scope", "agent__guard_worker_credential_insert",
    "agent__worker_tenant", "agent__worker_check_tenant", "agent__worker_tenant_columns",
    "agent_worker_credential_register_v2", "agent__run_claim_scoped", "agent__runs_recover_scoped",
    "agent__tool_approvals_expire_scoped", "agent__model_attempts_recover_scoped",
}


def test_257_redefines_only_reviewed_functions_and_no_h1_to_h5_body():
    defined = set(re.findall(r"CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(", M257))
    wrappers = {d for d in defined if d.startswith(wi.WORKER_RPC_PREFIX)}
    assert {w[len(wi.WORKER_RPC_PREFIX):] for w in wrappers} == set(wi.WORKER_RPCS) and len(wrappers) == 23
    assert defined - wrappers == REVIEWED_REDEFINITIONS | NEW_FUNCTIONS
    for original in ("agent_run_claim", "agent_runs_recover", "agent_tool_approvals_expire", "agent_model_attempts_recover"):
        assert f"FUNCTION public.{original}(" not in M257  # the service_role originals are untouched


def test_257_grants_the_worker_only_its_tenant_source_and_wrappers():
    grants = re.findall(r"GRANT ([^;]+) TO agent_worker", _code(M257))
    assert sorted(g.strip() for g in grants if "%s" not in g) == [
        "EXECUTE ON FUNCTION public.agent__worker_credential_ok()", "EXECUTE ON FUNCTION public.agent__worker_tenant()"]
    assert "GRANT EXECUTE ON FUNCTION %s TO agent_worker" in M257  # the wrapper loop (agent_worker_rpc__* only)
    assert not re.search(r"GRANT\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b[^;]*TO agent_worker", _code(M257), re.I)


def test_python_tenant_column_mirror_equals_the_migration():
    block = M257.split("FUNCTION public.agent__worker_tenant_columns()")[1].split("$function$;")[0]
    pairs = dict(re.findall(r"\('([a-z_]+)', '([a-z_]+)'\)", block))
    assert pairs == dict(wi.WORKER_TENANT_COLUMNS) and set(pairs) == set(wi.WORKER_READ_COLUMNS)


def test_every_wrapper_checks_the_credential_then_the_bound_hotel():
    for rpc in wi.WORKER_RPCS:
        body = M257.split(f"FUNCTION public.agent_worker_rpc__{rpc}(")[1].split("$function$;")[0]
        assert "SECURITY DEFINER SET search_path = ''" in body, rpc
        statements = [s.strip() for s in body.split("BEGIN", 1)[1].split(";") if s.strip()]
        assert statements[0] == "PERFORM public.agent__worker_assert()", rpc
        assert ("agent__worker_check_tenant(" in body or "agent__worker_tenant()" in body), rpc


def test_the_tenant_source_ignores_hotel_claims_and_refuses_production():
    body = M257.split("FUNCTION public.agent__worker_tenant()")[1].split("$function$;")[0]
    assert "'hotel_id'" in body and "?|" in body       # carrying a person/hotel claim refuses the token outright
    assert "->>'hotel_id'" not in body and "auth.jwt" not in body
    assert "d.environment <> 'production'" in body and "t.is_active" in body and "c.revoked_at IS NULL" in body

"""H6 P1 (migration 257): per-hotel worker credentials, the database environment identity and the RESTRICTIVE gates,
proven against the REAL restricted principal (Kong -> PostgREST -> PostgreSQL as agent_worker).

Direct PostgREST requests (httpx) use tokens the Python client would refuse (hotel_id/sub claims, missing jti, ...), so
the DATABASE is shown to refuse them. Raw SQL is used only for what PostgREST cannot express, always in a transaction
that rolls back (environment-stamp matrix, blanket grants, contract replay). Contamination of the disposable database:
hotels, users, runs and append-only credential/scope rows created here persist (credentials and scopes can never be
deleted by design); the deployment identity is stamped 'test' once (write-once). Never point this at staging.
"""
from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import jwt
import pytest

from agent_execution_support import QUEUE, admit, make_hotel, requires_db, reset_execution_state, store
from agent_gateway_support import (
    ASSIGN,
    admit as admit_tool,
    approval_for,
    assign_args,
    gateway_worker,
    make_gateway_hotel,
    process,
    reset_gateway_state,
    run_sql,
    sql_value,
)
from agent_orchestrator_support import attempt_state, planning_run, reserve, reset_spend_state, set_budgets
from agent_worker_identity_support import (
    bound_client,
    ensure_test_deployment_identity,
    issue_token,
    raw_worker_client,
    revoke,
    stack_public_key,
    stack_secret,
)
from agent_worker_scoped_copies import SCOPED_COPIES, scoped_source
from batch_support import new_client
from core.config import settings
from postgrest.exceptions import APIError
from services.agent_execution.worker_identity import (
    WORKER_READ_COLUMNS,
    WORKER_TENANT_COLUMNS,
    WorkerIdentityError,
    bound_worker_id,
    verify_bound_identity,
)

pytestmark = requires_db
REPO = Path(__file__).resolve().parents[4]
REST = settings.supabase_project_url.rstrip("/") + "/rest/v1"
MISMATCH = "agent_worker_tenant_mismatch"


@pytest.fixture(autouse=True)
def _clean():
    reset_gateway_state()
    ensure_test_deployment_identity()
    yield
    reset_gateway_state()


# ---------------------------------------------------------------- helpers
def _mint(claims: dict, *, secret: str | None = None) -> str:
    now = int(time.time())
    return jwt.encode({"iat": now, "exp": now + 3600, **claims}, secret or stack_secret(), algorithm="HS256")


def _get(token: str, path: str, *, profile: str | None = None) -> httpx.Response:
    headers = {"apikey": stack_public_key(), "Authorization": f"Bearer {token}"}
    if profile:
        headers["Accept-Profile"] = profile
    return httpx.get(f"{REST}/{path}", headers=headers, timeout=30)


def _post(token: str, path: str, body: dict, *, profile: str | None = None) -> httpx.Response:
    headers = {"apikey": stack_public_key(), "Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if profile:
        headers["Content-Profile"] = profile
    return httpx.post(f"{REST}/{path}", headers=headers, content=json.dumps(body), timeout=30)


def _visible_tenants(token: str) -> dict[str, set[str]]:
    """Per worker-readable table: the set of tenant ids this token can see (raises on a non-200)."""
    seen = {}
    for table, column in WORKER_TENANT_COLUMNS.items():
        response = _get(token, f"{table}?select={column}")
        assert response.status_code == 200, (table, response.status_code, response.text)
        seen[table] = {str(row[column]) for row in response.json()}
    return seen


def _seed_all_tables(hotel) -> None:
    """Rows in the two tables the gateway hotel fixture does not populate."""
    db = new_client()
    db.table("room_assignments").insert({"tenant_id": hotel.tenant_id, "room_id": hotel.room,
                                         "assigned_to": hotel.housekeeper, "assigned_by": hotel.supervisor,
                                         "assignment_date": datetime.now(timezone.utc).date().isoformat()}).execute()
    db.table("room_occupancy_discrepancies").insert({"tenant_id": hotel.tenant_id, "room_id": hotel.room,
                                                     "housekeeping_observed": "vacant",
                                                     "reported_by": hotel.housekeeper}).execute()


@pytest.fixture(scope="module")
def two_hotels():
    a, b = make_gateway_hotel(), make_gateway_hotel()
    for hotel in (a, b):
        _seed_all_tables(hotel)
    return a, b


def _wrapper_error(client, name: str, params: dict) -> str:
    with pytest.raises(APIError) as err:
        client.rpc(name, params).execute()
    return f"{err.value.code}:{err.value.message}"


# ---------------------------------------------------------------- reads: bound hotel only, under every token shape
def test_a_bound_credential_reads_only_its_own_hotel_on_every_table(two_hotels):
    a, b = two_hotels
    _, token = issue_token("it-p1-read-a", tenant_id=a.tenant_id)
    seen = _visible_tenants(token)
    assert seen == {table: {a.tenant_id} for table in WORKER_TENANT_COLUMNS}, seen
    # the Python client proves and pins the same hotel
    client = bound_client(token)
    assert client.tenant_id == a.tenant_id
    rows = client.table("work_orders").select("id, tenant_id").execute().data
    assert rows and {r["tenant_id"] for r in rows} == {a.tenant_id}


def _forbidden_tokens(a, b) -> dict[str, str]:
    revoked_id, revoked = issue_token("it-p1-revoked", tenant_id=a.tenant_id)
    revoke(revoked_id)
    active_id, _ = issue_token("it-p1-active", tenant_id=a.tenant_id)
    # unbound: a credential row created directly (as service_role may) without any scope binding
    unbound = str(uuid.uuid4())
    new_client().table("agent_worker_credentials").insert({
        "id": unbound, "label": "it-p1-unbound", "app_env": "test", "issued_by": "it",
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}).execute()
    return {
        "active+hotel_id(B)": _mint({"role": "agent_worker", "jti": active_id, "hotel_id": b.tenant_id}),
        "active+sub+user_role": _mint({"role": "agent_worker", "jti": active_id, "sub": b.gm, "user_role": "gm"}),
        "active+tenant_id(B)": _mint({"role": "agent_worker", "jti": active_id, "tenant_id": b.tenant_id}),
        "active+app_metadata": _mint({"role": "agent_worker", "jti": active_id, "app_metadata": {"hotel_id": b.tenant_id}}),
        "revoked+hotel_id(A)": _mint({"role": "agent_worker", "jti": revoked_id, "hotel_id": a.tenant_id}),
        "revoked": revoked,
        "unregistered+hotel_id(A)": _mint({"role": "agent_worker", "jti": str(uuid.uuid4()), "hotel_id": a.tenant_id}),
        "no_jti+hotel_id(A)": _mint({"role": "agent_worker", "hotel_id": a.tenant_id}),
        "no_jti": _mint({"role": "agent_worker"}),
        "jti_not_string": _mint({"role": "agent_worker", "jti": 12345, "hotel_id": a.tenant_id}),
        "jti_malformed": _mint({"role": "agent_worker", "jti": active_id + "x"}),
        "jti_uppercase_other": _mint({"role": "agent_worker", "jti": str(uuid.uuid4()).upper()}),
        "unbound+hotel_id(A)": _mint({"role": "agent_worker", "jti": unbound, "hotel_id": a.tenant_id}),
        "unbound": _mint({"role": "agent_worker", "jti": unbound}),
    }


def test_revoked_unregistered_unbound_missing_jti_and_extra_claim_tokens_read_nothing(two_hotels):
    a, b = two_hotels
    for label, token in _forbidden_tokens(a, b).items():
        seen = _visible_tenants(token)
        assert all(not tenants for tenants in seen.values()), (label, seen)


def test_a_registry_expired_credential_reads_nothing_while_its_jwt_is_still_valid(two_hotels):
    a, _ = two_hotels
    credential = str(uuid.uuid4())
    registered = new_client().rpc("agent_worker_credential_register_v2", {
        "p_id": credential, "p_label": "it-p1-expiring", "p_app_env": "test",
        "p_expires_at": (datetime.now(timezone.utc) + timedelta(seconds=3)).isoformat(), "p_issued_by": "it",
        "p_tenant_id": a.tenant_id}).execute().data
    assert registered["ok"], registered
    token = _mint({"role": "agent_worker", "jti": credential, "hotel_id": a.tenant_id})
    plain = _mint({"role": "agent_worker", "jti": credential})
    assert _visible_tenants(plain)["tenants"] == {a.tenant_id}
    time.sleep(4)
    for t in (plain, token):
        assert all(not v for v in _visible_tenants(t).values())


def test_forged_and_expired_jwts_are_rejected_by_postgrest(two_hotels):
    a, _ = two_hotels
    active_id, _ = issue_token("it-p1-sig", tenant_id=a.tenant_id)
    forged = _mint({"role": "agent_worker", "jti": active_id}, secret="x" * 40)
    assert _get(forged, "tenants?select=id").status_code == 401
    now = int(time.time())
    expired = jwt.encode({"role": "agent_worker", "jti": active_id, "iat": now - 7200, "exp": now - 3600},
                         stack_secret(), algorithm="HS256")
    assert _get(expired, "tenants?select=id").status_code == 401


def test_exposed_non_public_schemas_leak_nothing_to_the_worker(two_hotels):
    a, b = two_hotels
    _, token = issue_token("it-p1-schemas", tenant_id=a.tenant_id)
    probes = [
        _get(token, "objects?select=*", profile="storage"),
        _get(token, "buckets?select=*", profile="storage"),
        _post(token, "rpc/graphql", {"query": "{ work_ordersCollection { edges { node { tenant_id title } } } }"},
              profile="graphql_public"),
        _post(token, "rpc/graphql", {"query": "{ tenantsCollection { edges { node { id } } } }"},
              profile="graphql_public"),
    ]
    for response in probes:
        assert b.tenant_id not in response.text, response.text[:300]
        if response.status_code == 200 and response.request.url.path.endswith("/objects"):
            assert response.json() == []


def test_authenticated_hotel_users_and_service_role_keep_their_access(two_hotels):
    a, b = two_hotels
    user = _mint({"role": "authenticated", "sub": a.gm, "hotel_id": a.tenant_id, "user_role": "gm",
                  "aud": "authenticated"})
    rows = _get(user, "work_orders?select=tenant_id").json()
    assert rows and {r["tenant_id"] for r in rows} == {a.tenant_id}  # the legacy hotel policy still applies to users
    both = new_client().table("work_orders").select("tenant_id").in_("tenant_id", [a.tenant_id, b.tenant_id]).execute().data
    assert {r["tenant_id"] for r in both} == {a.tenant_id, b.tenant_id}  # service_role is unaffected


# ---------------------------------------------------------------- environment identity and production
def test_the_environment_and_production_matrix_is_enforced_by_the_database(two_hotels):
    """Every stamp x credential environment, in one rolled-back transaction (guards disabled only inside it). Worker
    tenancy exists only when the credential's environment equals the stamp AND the stamp is not production."""
    a, _ = two_hotels
    envs = ("development", "test", "staging", "production")
    lines = ["BEGIN;",
             "ALTER TABLE public.agent_deployment_identity DISABLE TRIGGER agent_deployment_identity_guard;",
             "ALTER TABLE public.agent_worker_credentials DISABLE TRIGGER agent_worker_credentials_environment_guard;",
             "ALTER TABLE public.agent_worker_credential_scopes DISABLE TRIGGER agent_worker_credential_scopes_guard;"]
    creds = {env: str(uuid.uuid4()) for env in envs}
    for env, cid in creds.items():
        lines.append(f"INSERT INTO public.agent_worker_credentials (id, label, app_env, issued_by, expires_at) "
                     f"VALUES ('{cid}', 'it-p1-env-{env}', '{env}', 'it', now() + interval '1 day');")
        lines.append(f"INSERT INTO public.agent_worker_credential_scopes (credential_id, tenant_id, app_env, bound_by) "
                     f"VALUES ('{cid}', '{a.tenant_id}', '{env}', 'it');")
    for stamp in envs:
        lines.append(f"UPDATE public.agent_deployment_identity SET environment = '{stamp}';")
        for env, cid in creds.items():
            claims = json.dumps({"role": "agent_worker", "jti": cid})
            lines.append(f"SET LOCAL ROLE agent_worker; SET LOCAL request.jwt.claims = '{claims}';")
            lines.append(f"SELECT 'M|{stamp}|{env}|' || COALESCE(public.agent__worker_tenant()::text, 'none') || '|' "
                         f"|| (SELECT count(id) FROM public.tenants) || '|' || (SELECT count(id) FROM public.work_orders);")
            lines.append("RESET ROLE;")
    lines.append("DELETE FROM public.agent_deployment_identity;")
    lines.append(f"SET LOCAL ROLE agent_worker; SET LOCAL request.jwt.claims = '{json.dumps({'role': 'agent_worker', 'jti': creds['test']})}';")
    lines.append("SELECT 'M|unstamped|test|' || COALESCE(public.agent__worker_tenant()::text, 'none') || '|' "
                 "|| (SELECT count(id) FROM public.tenants) || '|0';")
    lines.append("RESET ROLE; ROLLBACK;")
    out = run_sql("\\pset tuples_only on\n\\pset format unaligned\n" + "\n".join(lines))
    results = {tuple(line.split("|")[1:3]): line.split("|")[3:] for line in out.splitlines() if line.startswith("M|")}
    assert len(results) == 17, out
    for (stamp, env), (tenant, tenants_seen, orders_seen) in results.items():
        allowed = stamp == env and stamp != "production"
        assert (tenant == a.tenant_id) is allowed and (tenants_seen == "1") is allowed, (stamp, env, tenant, tenants_seen)
        assert allowed or orders_seen == "0", (stamp, env)
    assert sql_value("SELECT environment FROM public.agent_deployment_identity WHERE id = 1;") == "test"  # rolled back


def test_registration_refuses_production_wrong_environment_and_inactive_hotels(two_hotels):
    a, _ = two_hotels
    expires = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

    def register(**over):
        params = {"p_id": str(uuid.uuid4()), "p_label": "it-p1-reg", "p_app_env": "test", "p_expires_at": expires,
                  "p_issued_by": "it", "p_tenant_id": a.tenant_id, **over}
        return new_client().rpc("agent_worker_credential_register_v2", params).execute().data

    assert register(p_app_env="production") == {"ok": False, "reason": "production_refused"}
    assert register(p_app_env="staging") == {"ok": False, "reason": "environment_mismatch"}
    assert register(p_app_env="development") == {"ok": False, "reason": "environment_mismatch"}
    assert register(p_tenant_id=str(uuid.uuid4())) == {"ok": False, "reason": "tenant_not_active"}
    assert register()["ok"] is True
    # the backstop triggers refuse the same things on the direct table path service_role holds
    for env in ("production", "staging"):
        with pytest.raises(APIError) as err:
            new_client().table("agent_worker_credentials").insert({
                "id": str(uuid.uuid4()), "label": "it-p1-direct", "app_env": env, "issued_by": "it",
                "expires_at": expires}).execute()
        assert "production_refused" in str(err.value) or "environment_mismatch" in str(err.value)


def test_bindings_are_made_only_at_registration_and_are_immutable(two_hotels):
    a, b = two_hotels
    credential, _ = issue_token("it-p1-immutable", tenant_id=a.tenant_id)
    # a credential created earlier (here: unbound, by service_role) can never acquire a hotel later
    legacy = str(uuid.uuid4())
    new_client().table("agent_worker_credentials").insert({
        "id": legacy, "label": "it-p1-legacy", "app_env": "test", "issued_by": "it",
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}).execute()
    with pytest.raises(APIError) as err:
        new_client().table("agent_worker_credential_scopes").insert({
            "credential_id": legacy, "tenant_id": a.tenant_id, "app_env": "test", "bound_by": "it"}).execute()
    assert "agent_worker_scope_not_at_registration" in str(err.value)
    for statement in (
        f"UPDATE public.agent_worker_credential_scopes SET tenant_id = '{b.tenant_id}' WHERE credential_id = '{credential}'",
        f"DELETE FROM public.agent_worker_credential_scopes WHERE credential_id = '{credential}'",
        "TRUNCATE public.agent_worker_credential_scopes",
        "UPDATE public.agent_deployment_identity SET environment = 'staging'",
        "DELETE FROM public.agent_deployment_identity",
        "TRUNCATE public.agent_deployment_identity",
        "INSERT INTO public.agent_deployment_identity (id, environment, stamped_by) VALUES (1, 'staging', 'x') "
        "ON CONFLICT (id) DO UPDATE SET environment = 'staging'",
    ):
        with pytest.raises(AssertionError):  # refused even for the table owner (immutability triggers)
            run_sql(f"BEGIN; {statement}; ROLLBACK;")
    assert sql_value("SELECT environment || ':' || count(*) OVER () FROM public.agent_deployment_identity;") == "test:1"
    assert sql_value(f"SELECT tenant_id FROM public.agent_worker_credential_scopes WHERE credential_id = '{credential}';") == a.tenant_id


def test_service_role_cannot_stamp_the_deployment_identity_even_with_a_blanket_grant():
    sql = ("BEGIN; GRANT ALL ON public.agent_deployment_identity TO service_role; SET LOCAL ROLE service_role; "
           "INSERT INTO public.agent_deployment_identity (id, environment, stamped_by) VALUES (1, 'staging', 'svc') "
           "ON CONFLICT (id) DO NOTHING; ROLLBACK;")
    with pytest.raises(AssertionError) as err:
        run_sql(sql)
    assert "only the table owner may stamp" in str(err.value)


# ---------------------------------------------------------------- the 23 wrappers: cross-hotel arguments are refused
@pytest.fixture()
def foreign_run_state():
    """A real gateway run of hotel B awaiting approval (invocation + approval exist) and a real H1 run of hotel A."""
    a, b = make_gateway_hotel(), make_gateway_hotel()
    reset_execution_state()
    admitted = admit_tool(b, ASSIGN, assign_args(b))
    assert process(gateway_worker("it-p1-svc")) == "awaiting_approval"
    approval = approval_for(b, admitted.run_id)
    own = admit(store(), a.tenant_id, spec={"operation": "noop", "steps": 1})
    return a, b, admitted.run_id, approval, own["run_id"]


def _snapshot(run_id: str) -> str:
    return sql_value(f"SELECT state || '|' || fencing_token || '|' || COALESCE(lease_owner, '') || '|' || attempt_count "
                     f"FROM public.agent_runs WHERE id = '{run_id}';")


def test_every_run_scoped_wrapper_refuses_another_hotels_run(foreign_run_state):
    a, b, b_run, approval, a_run = foreign_run_state
    _, token = issue_token("it-p1-wrappers", tenant_id=a.tenant_id)
    raw = raw_worker_client(token)
    w = bound_worker_id(a.tenant_id, "it-p1")
    run = {"p_run_id": b_run, "p_fencing_token": 1, "p_worker": w}
    inv = {**run, "p_invocation_id": approval["invocation_id"]}
    cases = {
        "agent_worker_rpc__agent_run_heartbeat": run,
        "agent_worker_rpc__agent_step_complete": {**run, "p_step_id": str(uuid.uuid4())},
        "agent_worker_rpc__agent_step_fail": {**run, "p_step_id": str(uuid.uuid4()), "p_error_class": "transient",
                                               "p_error_code": "x", "p_retryable": True},
        "agent_worker_rpc__agent_run_acknowledge": {**run, "p_action": "cancelled"},
        "agent_worker_rpc__agent_tool_step_context": {**run, "p_step_number": 1},
        "agent_worker_rpc__agent_tool_request_approval": {**inv, "p_approval_policy_id": "p", "p_approver_may_be_initiator": False,
                                                           "p_ttl_seconds": 60},
        "agent_worker_rpc__agent_tool_record_outcome": {**inv, "p_state": "succeeded"},
        "agent_worker_rpc__agent_tool_execute_work_order_assign": {**inv, "p_action_digest": approval["action_digest"]},
        "agent_worker_rpc__agent_tool_execute_room_assignment": {**inv, "p_action_digest": approval["action_digest"]},
        "agent_worker_rpc__agent_planning_step_context": run,
        "agent_worker_rpc__agent_planning_record_plan": {**run, "p_outcome": "planned", "p_plan": {}, "p_plan_digest": "d",
                                                          "p_reason_codes": [], "p_model_attempts": 0},
        "agent_worker_rpc__agent_planning_record_context": {**run, "p_agent_id": "a", "p_agent_version": 1,
                                                             "p_context_digest": "d", "p_fact_keys": []},
        "agent_worker_rpc__agent_billing_attempt_reserve": {**run, "p_step_id": str(uuid.uuid4()), "p_logical_call_key": "k",
                                                             "p_attempt_number": 1, "p_provider": "openai", "p_model": "m",
                                                             "p_schedule_version": "s", "p_max_input_tokens": 1,
                                                             "p_max_output_tokens": 1, "p_exposure_usd": 0},
        "agent_worker_rpc__agent_billing_attempt_dispatch": {"p_attempt_id": str(uuid.uuid4()), **run},
        "agent_worker_rpc__agent_tool_authorization_snapshot": {"p_tenant_id": b.tenant_id, "p_agent_id": "a",
                                                                 "p_agent_version": 1},
    }
    before = _snapshot(b_run), approval_for(b, b_run)["state"]
    for name, params in cases.items():
        assert MISMATCH in _wrapper_error(raw, name, params), name
    # a foreign invocation under the worker's OWN run id is refused too (the invocation must belong to that run)
    assert MISMATCH in _wrapper_error(raw, "agent_worker_rpc__agent_tool_record_outcome",
                                      {**inv, "p_run_id": a_run, "p_state": "succeeded"})
    assert (_snapshot(b_run), approval_for(b, b_run)["state"]) == before  # nothing about hotel B changed
    # the same call for the bound hotel passes the tenant check and reaches the unchanged H2 function
    ok = raw.rpc("agent_worker_rpc__agent_tool_authorization_snapshot",
                 {"p_tenant_id": a.tenant_id, "p_agent_id": "a", "p_agent_version": 1}).execute().data
    assert isinstance(ok, dict)


def test_attempt_scoped_billing_wrappers_refuse_another_hotels_attempt():
    reset_spend_state()
    a, b = make_gateway_hotel(grant=False), make_gateway_hotel(grant=False)
    set_budgets(b)
    claimed = planning_run(b, worker="it-p1-billing")
    reserved = reserve(claimed)
    assert reserved.ok and reserved.attempt, reserved
    attempt = reserved.attempt.attempt_id
    raw_a = raw_worker_client(tenant_id=a.tenant_id)
    for name, params in {
        "agent_worker_rpc__agent_billing_attempt_release": {"p_attempt_id": attempt, "p_fencing_token": claimed.token,
                                                            "p_reason": "x"},
        "agent_worker_rpc__agent_billing_attempt_settle": {"p_attempt_id": attempt, "p_fencing_token": claimed.token,
                                                           "p_outcome": "failed", "p_cost_usd": 0, "p_usage_status": "none",
                                                           "p_usage": {}, "p_cost_status": "none", "p_cost_cause": None,
                                                           "p_cost_tier": None, "p_reported_model": None,
                                                           "p_provider_request_id": None, "p_provider_response_id": None,
                                                           "p_error_code": "x"},
        "agent_worker_rpc__agent_billing_attempt_dispatch": {"p_attempt_id": attempt, "p_run_id": claimed.run_id,
                                                             "p_fencing_token": claimed.token, "p_worker": claimed.worker},
        "agent_worker_rpc__agent_billing_attempt_reserve": {"p_run_id": claimed.run_id, "p_fencing_token": claimed.token,
                                                            "p_worker": claimed.worker, "p_step_id": claimed.step_id,
                                                            "p_logical_call_key": "k2", "p_attempt_number": 2,
                                                            "p_provider": "openai", "p_model": "gpt-6-luna",
                                                            "p_schedule_version": "openai-2026-11-14",
                                                            "p_max_input_tokens": 10, "p_max_output_tokens": 10,
                                                            "p_exposure_usd": 0.001},
    }.items():
        assert MISMATCH in _wrapper_error(raw_a, name, params), name
    assert attempt_state(attempt) == "reserved"
    # bound to hotel B, the release passes the tenant check and the unchanged H3/H4 path releases it
    raw_b = raw_worker_client(tenant_id=b.tenant_id)
    released = raw_b.rpc("agent_worker_rpc__agent_billing_attempt_release",
                         {"p_attempt_id": attempt, "p_fencing_token": claimed.token, "p_reason": "it_release"}).execute().data
    assert released.get("ok") is True, released
    assert attempt_state(attempt) == "released"


# ---------------------------------------------------------------- globally scoped claim, recovery and sweeps
def _queue_row(run_id: str) -> str:
    return sql_value(f"SELECT read_ct || '|' || vt FROM pgmq.q_{QUEUE} WHERE message->>'run_id' = '{run_id}';")


def test_the_claim_never_reads_locks_or_delays_another_hotels_message():
    reset_execution_state()
    a, _ = make_hotel(new_client())
    b, _ = make_hotel(new_client())
    b_run = admit(store(), b, spec={"operation": "noop", "steps": 1})["run_id"]
    before = _queue_row(b_run)
    raw_a = raw_worker_client(tenant_id=a)
    w = bound_worker_id(a, "it-p1-claim")
    assert raw_a.rpc("agent_worker_rpc__agent_run_claim", {"p_worker": w}).execute().data == {"outcome": "empty"}
    assert _queue_row(b_run) == before  # not read (read_ct), not delayed (vt)
    # hotel B's message is FIRST in the queue; hotel A's worker still claims its own run behind it
    a_run = admit(store(), a, spec={"operation": "noop", "steps": 1})["run_id"]
    claimed = raw_a.rpc("agent_worker_rpc__agent_run_claim", {"p_worker": w}).execute().data
    assert claimed["outcome"] == "claimed" and claimed["run"]["id"] == a_run and claimed["run"]["tenant_id"] == a
    assert _queue_row(b_run) == before
    # and B's worker claims B's run
    raw_b = raw_worker_client(tenant_id=b)
    got = raw_b.rpc("agent_worker_rpc__agent_run_claim", {"p_worker": bound_worker_id(b, "it-p1-claim")}).execute().data
    assert got["outcome"] == "claimed" and got["run"]["id"] == b_run


def test_unattributable_queue_messages_are_left_for_the_service_role_sweeper():
    reset_execution_state()
    a, _ = make_hotel(new_client())
    run_sql(f"SELECT pgmq.send('{QUEUE}', '{{\"v\": 1, \"run_id\": \"not-a-uuid\"}}'::jsonb);"
            f"SELECT pgmq.send('{QUEUE}', '[1, 2]'::jsonb);")
    raw_a = raw_worker_client(tenant_id=a)
    assert raw_a.rpc("agent_worker_rpc__agent_run_claim",
                     {"p_worker": bound_worker_id(a, "it-p1-poison")}).execute().data == {"outcome": "empty"}
    assert sql_value(f"SELECT count(*) || ':' || sum(read_ct) FROM pgmq.q_{QUEUE};") == "2:0"
    # the unchanged service_role claim still archives them as poison
    outcomes = {store().claim(worker_id="it-p1-svc", lease_seconds=10)["outcome"] for _ in range(2)}
    assert outcomes == {"poison"}


def _state(run_id: str) -> str:
    return sql_value(f"SELECT state FROM public.agent_runs WHERE id = '{run_id}';")


def test_run_recovery_touches_only_the_bound_hotel():
    reset_execution_state()
    a, _ = make_hotel(new_client())
    b, _ = make_hotel(new_client())
    runs = {t: admit(store(), t, spec={"operation": "noop", "steps": 1})["run_id"] for t in (a, b)}
    run_sql("UPDATE public.agent_runs SET deadline_at = now() - interval '1 second' "
            f"WHERE id IN ('{runs[a]}', '{runs[b]}');")
    raw_a, raw_b = raw_worker_client(tenant_id=a), raw_worker_client(tenant_id=b)
    assert raw_a.rpc("agent_worker_rpc__agent_runs_recover", {"p_limit": 1000}).execute().data["deadline_failed"] == 1
    assert (_state(runs[a]), _state(runs[b])) == ("failed", "queued")
    assert raw_b.rpc("agent_worker_rpc__agent_runs_recover", {"p_limit": 1000}).execute().data["deadline_failed"] == 1
    assert _state(runs[b]) == "failed"


def test_the_approval_sweep_touches_only_the_bound_hotel():
    ga, gb = make_gateway_hotel(), make_gateway_hotel()
    pending = {}
    for hotel in (ga, gb):
        pending[hotel.tenant_id] = admit_tool(hotel, ASSIGN, assign_args(hotel)).run_id
        assert process(gateway_worker("it-p1-sweep")) == "awaiting_approval"
    run_sql("UPDATE public.agent_runs SET deadline_at = now() - interval '1 second' WHERE id IN ("
            + ", ".join(f"'{r}'" for r in pending.values()) + ");")
    swept = raw_worker_client(tenant_id=ga.tenant_id).rpc("agent_worker_rpc__agent_tool_approvals_expire",
                                                          {"p_limit": 1000}).execute().data
    assert swept["deadline_failed"] == 1, swept
    assert _state(pending[ga.tenant_id]) == "failed" and _state(pending[gb.tenant_id]) == "awaiting_approval"


def test_spend_recovery_touches_only_the_bound_hotel():
    reset_spend_state()
    a, b = make_gateway_hotel(grant=False), make_gateway_hotel(grant=False)
    set_budgets(b)
    claimed = planning_run(b, worker="it-p1-spend")
    attempt = reserve(claimed).attempt.attempt_id
    run_sql(f"UPDATE public.agent_runs SET lease_expires_at = now() - interval '1 second' WHERE id = '{claimed.run_id}';")
    params = {"p_stale_seconds": 0, "p_limit": 1000}
    raw_a, raw_b = raw_worker_client(tenant_id=a.tenant_id), raw_worker_client(tenant_id=b.tenant_id)
    assert raw_a.rpc("agent_worker_rpc__agent_model_attempts_recover", params).execute().data["released"] == 0
    assert attempt_state(attempt) == "reserved"
    assert raw_b.rpc("agent_worker_rpc__agent_model_attempts_recover", params).execute().data["released"] == 1
    assert attempt_state(attempt) == "released"


def test_runtime_controls_snapshot_and_heartbeat_are_bound_to_the_hotel(two_hotels):
    a, b = two_hotels
    db = new_client()
    for hotel in (a, b):
        db.rpc("agent_runtime_control_set", {"p_scope": "hotel", "p_tenant_id": hotel.tenant_id, "p_agent_id": None,
                                             "p_paused": False, "p_cost_emergency_stop": False,
                                             "p_updated_by": "operator:it", "p_reason_code": "integration_test"}).execute()
    raw = raw_worker_client(tenant_id=a.tenant_id)
    rows = raw.rpc("agent_worker_rpc__agent_runtime_controls_snapshot", {}).execute().data
    tenants = {r["tenant_id"] for r in rows}
    assert a.tenant_id in tenants and b.tenant_id not in tenants and tenants <= {a.tenant_id, None}
    beat = {"p_status": "running", "p_app_env": "test", "p_version": "it", "p_concurrency": 1, "p_in_flight": 0,
            "p_started_at": datetime.now(timezone.utc).isoformat()}
    raw.rpc("agent_worker_rpc__agent_worker_heartbeat", {**beat, "p_worker_id": bound_worker_id(a.tenant_id, "it-p1-hb")}).execute()
    for worker_id, env, code in ((f"{b.tenant_id}:it-p1-hb", "test", "agent_worker_id_not_bound"),
                                 ("it-p1-hb", "test", "agent_worker_id_not_bound"),
                                 (f"{a.tenant_id}:", "test", "agent_worker_id_not_bound"),
                                 (bound_worker_id(a.tenant_id, "it-p1-hb"), "staging", "agent_worker_environment_mismatch"),
                                 (bound_worker_id(a.tenant_id, "it-p1-hb"), "production", "agent_worker_environment_mismatch")):
        assert code in _wrapper_error(raw, "agent_worker_rpc__agent_worker_heartbeat",
                                      {**beat, "p_worker_id": worker_id, "p_app_env": env}), (worker_id, env)


def test_every_wrapper_fails_closed_for_revoked_and_unbound_credentials(two_hotels):
    a, _ = two_hotels
    credential, token = issue_token("it-p1-allrevoked", tenant_id=a.tenant_id)
    revoke(credential)
    raw = raw_worker_client(token)
    names = sql_value("SELECT string_agg(proname, ',' ORDER BY proname) FROM pg_proc "
                      "WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'agent\\_worker\\_rpc\\_\\_%';").split(",")
    assert len(names) == 23
    args = run_sql("\\pset tuples_only on\n\\pset format unaligned\n"
                   "SELECT proname || '=' || COALESCE(array_to_string(proargnames[1:pronargs - pronargdefaults], ','), '') "
                   "FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'agent\\_worker\\_rpc\\_\\_%';")
    required = {line.split("=")[0]: [p for p in line.split("=")[1].split(",") if p] for line in args.splitlines() if "=" in line}
    typed = {"p_run_id": str(uuid.uuid4()), "p_step_id": str(uuid.uuid4()), "p_invocation_id": str(uuid.uuid4()),
             "p_attempt_id": str(uuid.uuid4()), "p_tenant_id": a.tenant_id, "p_fencing_token": 1, "p_agent_version": 1,
             "p_step_number": 1, "p_ttl_seconds": 60, "p_attempt_number": 1, "p_max_input_tokens": 1,
             "p_max_output_tokens": 1, "p_exposure_usd": 0, "p_cost_usd": 0, "p_concurrency": 1, "p_in_flight": 0,
             "p_model_attempts": 0, "p_retryable": True, "p_approver_may_be_initiator": False, "p_plan": {},
             "p_usage": {}, "p_reason_codes": [], "p_fact_keys": [], "p_started_at": datetime.now(timezone.utc).isoformat(),
             "p_app_env": "test"}
    for name in names:
        params = {p: typed.get(p, "x") for p in required[name]}
        assert "agent_worker_credential_invalid" in _wrapper_error(raw, name, params), name


# ---------------------------------------------------------------- the worker composition proves the binding
def test_the_python_client_refuses_to_start_without_exactly_one_bound_hotel(two_hotels):
    a, b = two_hotels
    credential, token = issue_token("it-p1-startup", tenant_id=a.tenant_id)
    from agent_worker_identity_support import worker_client

    client = worker_client(token)
    assert verify_bound_identity(client) == a.tenant_id
    with pytest.raises(WorkerIdentityError):
        client.bind_tenant(b.tenant_id)  # never re-bound
    revoke(credential)
    with pytest.raises(WorkerIdentityError) as err:
        verify_bound_identity(worker_client(token))
    assert err.value.code == "worker_credential_not_bound"


# ---------------------------------------------------------------- reviewed SQL: copies, gates, grants, contracts
@pytest.mark.parametrize("original", sorted(SCOPED_COPIES))
def test_each_scoped_copy_is_the_unchanged_original_with_only_the_pinned_substitutions(original):
    name, substitutions = SCOPED_COPIES[original]
    src = run_sql("\\pset tuples_only on\n\\pset format unaligned\n"
                  f"SELECT prosrc FROM pg_proc WHERE oid = '{original}'::regprocedure;")
    copy = run_sql("\\pset tuples_only on\n\\pset format unaligned\n"
                   f"SELECT prosrc FROM pg_proc WHERE proname = '{name}' AND pronamespace = 'public'::regnamespace;")
    assert scoped_source(src.rstrip("\n"), substitutions) == copy.rstrip("\n").replace("\r\n", "\n")
    assert sql_value(f"SELECT count(*) FROM pg_proc WHERE proname = '{name}';") == "1"
    assert sql_value(f"SELECT prosecdef::text || has_function_privilege('service_role', p.oid, 'EXECUTE')::text "
                     f"|| has_function_privilege('agent_worker', p.oid, 'EXECUTE')::text FROM pg_proc p "
                     f"WHERE proname = '{name}';") == "falsefalsefalse"


def test_gates_roles_and_grants_are_exactly_as_reviewed():
    assert sql_value("SELECT count(*) FROM public.agent_worker_privilege_violations();") == "0"
    assert sql_value("SELECT count(*) FROM public.agent_audit_privilege_violations();") == "0"
    assert sql_value("SELECT count(*) FROM pg_policy WHERE polname = 'agent_worker_tenant_gate' AND NOT polpermissive "
                     "AND polroles = ARRAY['agent_worker'::regrole::oid];") == "8"
    gated = sql_value("SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_policy p JOIN pg_class c "
                      "ON c.oid = p.polrelid WHERE p.polname = 'agent_worker_tenant_gate';")
    assert set(gated.split(",")) == set(WORKER_READ_COLUMNS)
    # memberships: authenticator may SET ROLE agent_worker but never inherits it; agent_worker is a member of nothing
    members = run_sql("\\pset tuples_only on\n\\pset format unaligned\n"
                      "SELECT m.rolname || ':' || a.admin_option || a.inherit_option || a.set_option FROM pg_auth_members a "
                      "JOIN pg_roles m ON m.oid = a.member WHERE a.roleid = 'agent_worker'::regrole ORDER BY 1;").split()
    flags = dict(row.split(":") for row in members)  # admin_option, inherit_option, set_option
    assert flags.get("authenticator") == "falsefalsetrue", flags  # SET only: no ADMIN, no INHERIT
    assert set(flags) <= {"authenticator", "postgres"}, flags
    assert flags.get("postgres", "truefalsefalse") == "truefalsefalse", flags  # the creator's implicit ADMIN only
    assert all(not f.startswith(("truetrue", "falsetrue")) for f in flags.values()), flags  # nobody inherits it
    assert sql_value("SELECT count(*) FROM pg_auth_members WHERE member = 'agent_worker'::regrole;") == "0"
    # the tenant source: one definer overload, empty search_path, executable by agent_worker only among API roles
    assert sql_value("SELECT prosecdef::text || array_to_string(proconfig, ',') FROM pg_proc "
                     "WHERE proname = 'agent__worker_tenant';") == 'truesearch_path=""'
    for role, expected in (("anon", "false"), ("authenticated", "false"), ("service_role", "false"), ("agent_worker", "true")):
        assert sql_value(f"SELECT has_function_privilege('{role}', 'public.agent__worker_tenant()', 'EXECUTE')::text;") == expected


CI_BLANKET = """GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
SELECT public.agent_audit_privileges_enforce();
REVOKE ALL ON FUNCTION public.agent__audit_protected_tables(), public.agent__refuse_truncate(),
  public.agent_audit_privilege_violations(), public.agent_audit_privileges_enforce(),
  public.agent__guard_approval_independence(), public.agent__guard_execution_approval() FROM service_role;
"""


def test_the_schema_contract_passes_after_the_exact_ci_blanket_grant():
    contract = (REPO / "scripts" / "schema-contracts.sql").read_text(encoding="utf-8")
    out = run_sql("BEGIN;\n" + CI_BLANKET + contract + "\nSELECT 'contract_ok';\nROLLBACK;")
    assert "contract_ok" in out


@pytest.mark.parametrize("grant", [
    "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, agent_worker",
    "GRANT SELECT ON ALL TABLES IN SCHEMA public TO agent_worker",
    "DROP POLICY agent_worker_tenant_gate ON public.work_orders",
    "ALTER POLICY agent_worker_tenant_gate ON public.rooms USING (true)",
    "ALTER TABLE public.room_status DISABLE ROW LEVEL SECURITY",
])
def test_broader_grants_or_a_weakened_gate_fail_closed(grant):
    """Enforcement cannot silently 'succeed' past these, and the contract refuses them (in a rolled-back transaction)."""
    contract = (REPO / "scripts" / "schema-contracts.sql").read_text(encoding="utf-8")
    with pytest.raises(AssertionError) as err:
        run_sql(f"BEGIN;\n{grant};\nSELECT public.agent_audit_privileges_enforce();\n{contract}\nROLLBACK;")
    assert "agent audit privileges could not be enforced" in str(err.value), str(err.value)[-600:]
    assert sql_value("SELECT count(*) FROM public.agent_worker_privilege_violations();") == "0"  # rolled back


@pytest.mark.parametrize("grant", [
    "GRANT INSERT ON public.agent_deployment_identity TO service_role",
    "GRANT ALL ON public.agent_worker_credential_scopes TO anon, authenticated",
    "GRANT EXECUTE ON FUNCTION public.agent__worker_tenant() TO service_role, anon",
    "GRANT EXECUTE ON FUNCTION public.agent__run_claim_scoped(uuid, text, integer, integer, integer, integer) TO agent_worker",
    "GRANT EXECUTE ON FUNCTION public.agent__worker_check_tenant(uuid) TO service_role",
])
def test_enforcement_restores_least_privilege_on_the_257_objects(grant):
    out = run_sql(f"BEGIN;\n{grant};\nSELECT 'before=' || count(*) FROM public.agent_audit_privilege_violations();\n"
                  "SELECT public.agent_audit_privileges_enforce();\n"
                  "SELECT 'after=' || count(*) FROM public.agent_audit_privilege_violations();\nROLLBACK;")
    assert "before=0" not in out and "after=0" in out, out


def test_contract_refuses_257_objects_without_the_migration_record():
    contract = (REPO / "scripts" / "schema-contracts.sql").read_text(encoding="utf-8")
    with pytest.raises(AssertionError) as err:
        run_sql("BEGIN;\nDELETE FROM supabase_migrations.schema_migrations WHERE name = 'agent_worker_tenant_binding';\n"
                + contract + "\nROLLBACK;")
    # the definer allowlist is the first gate to close: agent__worker_tenant is allowed only with 257 recorded
    assert "An Agent Harness function is SECURITY DEFINER" in str(err.value), str(err.value)[-600:]


def test_contract_detects_a_replaced_wrapper_or_tenant_source_body():
    contract = (REPO / "scripts" / "schema-contracts.sql").read_text(encoding="utf-8")
    for mutation in (
        "CREATE OR REPLACE FUNCTION public.agent__worker_tenant() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER "
        "SET search_path = '' AS $f$ BEGIN RETURN (current_setting('request.jwt.claims', true)::jsonb->>'hotel_id')::uuid; END $f$",
        "CREATE OR REPLACE FUNCTION public.agent__run_claim_scoped(p_tenant_id uuid, p_worker text, p_lease_seconds integer, "
        "p_vt_margin integer, p_poison_read_ct integer, p_blocked_retry integer) RETURNS jsonb LANGUAGE sql SET search_path = '' "
        "AS $f$ SELECT public.agent_run_claim(p_worker, p_lease_seconds, p_vt_margin, p_poison_read_ct, p_blocked_retry) $f$",
    ):
        with pytest.raises(AssertionError) as err:
            run_sql(f"BEGIN;\n{mutation};\n{contract}\nROLLBACK;")
        assert "body changed" in str(err.value), str(err.value)[-400:]


def test_no_production_switch_exists_in_p1():
    m257 = (REPO / "supabase" / "migrations" / "257_agent_worker_tenant_binding.sql").read_text(encoding="utf-8")
    assert "worker_activation_allowed" not in m257 and "d.environment <> 'production'" in m257

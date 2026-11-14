"""Agent Harness H1 tenant isolation, RLS/privileges, append-only history, DB-enforced state machine and dispatch
recovery against the REAL migrated database (scenarios 8 and 9)."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest
from postgrest.exceptions import APIError
from supabase import create_client

from agent_execution_support import (
    QUEUE,
    admit,
    events,
    expire_lease,
    make_hotel,
    messages_for,
    process,
    requires_db,
    reset_execution_state,
    run_sql,
    run_state,
    sql_value,
    store,
    worker,
)
from core.config import settings
from core.database import get_supabase
from services.agent_execution.states import RUN_TRANSITIONS, STEP_TRANSITIONS, RunState, StepState

pytestmark = requires_db
TABLES = ("agent_runs", "agent_run_steps", "agent_run_events", "agent_runtime_controls", "agent_worker_heartbeats")


@pytest.fixture(autouse=True)
def _clean():
    reset_execution_state()
    yield


@pytest.fixture(scope="module")
def db():
    return get_supabase()


def sql_fails(sql: str) -> str:
    with pytest.raises(AssertionError) as err:
        run_sql(sql)
    return str(err.value)


# --- scenario 8: hotel isolation ---------------------------------------------------------------------------------

def test_scenario_8_one_hotel_cannot_read_control_or_reference_anothers_runs(db):
    hotel_a, _ = make_hotel(db)
    hotel_b, _ = make_hotel(db)
    s = store()
    run_a = admit(s, hotel_a)["run_id"]
    run_b = admit(s, hotel_b)["run_id"]
    assert s.get_run(tenant_id=hotel_b, run_id=run_a) is None
    assert s.events_page(tenant_id=hotel_b, run_id=run_a) == []
    for call in (s.request_cancel, s.request_pause, s.resume):
        assert call(tenant_id=hotel_b, run_id=run_a, requested_by="it-op") == {"ok": False, "reason": "not_found"}
    assert run_state(s, hotel_a, run_a)["run"]["state"] == "queued"
    assert run_state(s, hotel_b, run_b)["run"]["tenant_id"] == hotel_b
    # Child rows can never point at another hotel's run (composite foreign keys).
    assert "agent_run_steps_run_fk" in sql_fails(
        f"INSERT INTO public.agent_run_steps (run_id, tenant_id, step_number, step_type, max_attempts) "
        f"VALUES ('{run_a}', '{hotel_b}', 9, 'synthetic_noop', 1);")
    assert "agent_run_events_run_fk" in sql_fails(
        f"INSERT INTO public.agent_run_events (tenant_id, run_id, event_type, actor_kind) "
        f"VALUES ('{hotel_b}', '{run_a}', 'resumed', 'service');")
    step_b = run_state(s, hotel_b, run_b)["steps"][0]["id"]
    assert "agent_run_events_step_fk" in sql_fails(
        f"INSERT INTO public.agent_run_events (tenant_id, run_id, step_id, event_type, actor_kind) "
        f"VALUES ('{hotel_a}', '{run_a}', '{step_b}', 'resumed', 'service');")


def test_end_user_roles_have_no_access_to_execution_tables_functions_or_queue():
    for role in ("anon", "authenticated"):
        for table in TABLES:
            assert sql_value(f"SELECT has_table_privilege('{role}', 'public.{table}', 'SELECT,INSERT,UPDATE,DELETE');") == "f"
            assert "permission denied" in sql_fails(f"SET ROLE {role}; SELECT count(*) FROM public.{table};")
        for q in (f"pgmq.q_{QUEUE}", f"pgmq.a_{QUEUE}"):
            assert sql_value(f"SELECT has_table_privilege('{role}', '{q}', 'SELECT,INSERT,UPDATE,DELETE');") == "f"
        exposed = sql_value(f"""SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'agent%' AND has_function_privilege('{role}', p.oid, 'EXECUTE');""")
        assert exposed == "0"
    public_exec = sql_value("""SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE 'agent%'
          AND EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE');""")
    assert public_exec == "0"
    for table in TABLES:
        assert sql_value(f"SELECT relrowsecurity FROM pg_class WHERE oid = 'public.{table}'::regclass;") == "t"
    assert sql_value("""SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE 'agent%' AND p.prosecdef;""") == "0"


def test_anon_api_key_cannot_reach_runs_or_rpcs(db):
    anon_key = os.getenv("ANON_KEY")
    if not anon_key:
        pytest.skip("ANON_KEY not exported (privilege facts are still asserted through psql above)")
    tenant, _ = make_hotel(db)
    admit(store(), tenant)
    anon = create_client(settings.supabase_project_url, anon_key)
    with pytest.raises(APIError):
        anon.table("agent_runs").select("id").execute()
    with pytest.raises(APIError):
        anon.rpc("agent_run_claim", {"p_worker": "anon"}).execute()
    with pytest.raises(APIError):
        anon.rpc("agent_run_get", {"p_tenant_id": tenant, "p_run_id": str(uuid.uuid4())}).execute()


# --- append-only history -----------------------------------------------------------------------------------------

def test_events_are_append_only_even_for_privileged_writers(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant)["run_id"]
    assert "append-only" in sql_fails(f"UPDATE public.agent_run_events SET reason_code = 'x' WHERE run_id = '{run_id}';")
    assert "append-only" in sql_fails(f"DELETE FROM public.agent_run_events WHERE run_id = '{run_id}';")
    with pytest.raises(APIError):
        s.client.table("agent_run_events").update({"reason_code": "tampered"}).eq("run_id", run_id).execute()
    with pytest.raises(APIError):
        s.client.table("agent_run_events").delete().eq("run_id", run_id).execute()
    assert len(events(s, tenant, run_id)) == 2


def test_hotel_offboarding_cascade_still_removes_its_history(db):
    tenant, _ = make_hotel(db)
    run_id = admit(store(), tenant)["run_id"]
    run_sql(f"SELECT pgmq.purge_queue('{QUEUE}'); DELETE FROM public.tenants WHERE id = '{tenant}';")
    assert sql_value(f"SELECT count(*) FROM public.agent_run_events WHERE run_id = '{run_id}';") == "0"


# --- database-enforced state machine -----------------------------------------------------------------------------

def test_python_transition_tables_match_the_database():
    for fn, enum, table in (("agent_run_transition_allowed", RunState, RUN_TRANSITIONS),
                            ("agent_step_transition_allowed", StepState, STEP_TRANSITIONS)):
        values = ",".join(f"'{v.value}'" for v in enum)
        got = sql_value(f"SELECT string_agg(a || '>' || b, ',' ORDER BY a, b) FROM unnest(ARRAY[{values}]) a, "
                        f"unnest(ARRAY[{values}]) b WHERE public.{fn}(a, b);")
        assert set(got.split(",")) == {f"{a.value}>{b.value}" for a, b in table}


def test_illegal_transitions_and_identity_rewrites_are_refused_for_any_writer(db):
    tenant, other = make_hotel(db)[0], make_hotel(db)[0]
    s = store()
    run_id = admit(s, tenant)["run_id"]
    assert "illegal agent run transition" in sql_fails(
        f"UPDATE public.agent_runs SET state = 'succeeded', completed_at = now() WHERE id = '{run_id}';")
    assert "immutable" in sql_fails(f"UPDATE public.agent_runs SET tenant_id = '{other}' WHERE id = '{run_id}';")
    assert "immutable" in sql_fails(
        f"UPDATE public.agent_runs SET synthetic_spec = '{{\"operation\": \"delay\"}}' WHERE id = '{run_id}';")
    assert process(worker(), s) == "run_succeeded"
    assert "terminal" in sql_fails(f"UPDATE public.agent_runs SET state = 'queued' WHERE id = '{run_id}';")
    assert "terminal" in sql_fails(f"UPDATE public.agent_runs SET last_error_code = 'x' WHERE id = '{run_id}';")
    with pytest.raises(APIError):
        s.client.table("agent_runs").update({"state": "running"}).eq("id", run_id).execute()


def test_fencing_tokens_cannot_go_backwards_and_runs_start_queued(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant)["run_id"]
    s.claim(worker_id="it-a", lease_seconds=30)
    assert "fencing token cannot decrease" in sql_fails(
        f"UPDATE public.agent_runs SET fencing_token = 0 WHERE id = '{run_id}';")
    assert "created queued" in sql_fails(
        f"INSERT INTO public.agent_runs (tenant_id, agent_id, agent_version, principal_type, system_principal_id, "
        f"trigger_type, state, idempotency_key, request_digest, correlation_id, policy_version, deadline_at, max_attempts) "
        f"VALUES ('{tenant}', 'harness.synthetic', 1, 'system', 'harness.scheduled_observer', 'schedule', 'running', "
        f"'direct-{uuid.uuid4().hex}', repeat('a', 64), 'c', 'p', now() + interval '1 hour', 1);")


# --- scenario 9: missing queue notification ----------------------------------------------------------------------

def test_scenario_9_recovery_restores_a_lost_dispatch_without_a_second_run(db):
    tenant, _ = make_hotel(db)
    s = store()
    key = f"lost-{uuid.uuid4().hex}"
    run_id = admit(s, tenant, key=key)["run_id"]
    run_sql(f"SELECT pgmq.delete('{QUEUE}', msg_id) FROM pgmq.q_{QUEUE} WHERE message->>'run_id' = '{run_id}';")
    assert messages_for(run_id) == 0 and process(worker(), s) == "empty"  # committed work is invisible...
    assert s.diagnostics()["missing_dispatch"] >= 1
    assert s.recover(limit=100)["redispatched"] == 1  # ...until recovery restores eligibility
    assert s.recover(limit=100)["redispatched"] == 0  # idempotent
    assert messages_for(run_id) == 1
    assert process(worker(), s) == "run_succeeded"
    assert sql_value(f"SELECT count(*) FROM public.agent_runs WHERE idempotency_key = '{key}';") == "1"
    assert sum(1 for e in events(s, tenant, run_id) if e["event_type"] == "redispatched") == 1


def test_recovery_redispatches_a_crashed_running_run_whose_message_vanished(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant)["run_id"]
    s.claim(worker_id="it-crashed", lease_seconds=30)
    run_sql(f"SELECT pgmq.delete('{QUEUE}', msg_id) FROM pgmq.q_{QUEUE} WHERE message->>'run_id' = '{run_id}';")
    assert s.recover(limit=100)["redispatched"] == 0  # live lease: not recoverable yet
    expire_lease(run_id)
    assert s.recover(limit=100)["redispatched"] == 1
    assert process(worker("it-b"), s) == "run_succeeded"


def test_diagnostics_and_worker_liveness(db):
    tenant, _ = make_hotel(db)
    s = store()
    admit(s, tenant)
    s.worker_heartbeat(worker_id="it-diag", status="running", app_env="test", version="it", concurrency=2,
                       in_flight=0, started_at=datetime.now(timezone.utc))
    diag = s.diagnostics(limit=5)
    assert diag["runs_by_state"].get("queued", 0) >= 1 and diag["queue"]["depth"] >= 1
    assert any(w["worker_id"] == "it-diag" for w in diag["workers"])
    assert {"expired_leases", "dead_letters", "controls", "oldest_queued_at", "missing_dispatch"} <= diag.keys()

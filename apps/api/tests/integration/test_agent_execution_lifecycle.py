"""Agent Harness H1 durable lifecycle against the REAL migrated database and pgmq (scenarios 1-4 + concurrency)."""
from __future__ import annotations

import threading
import uuid

import pytest

from agent_execution_support import (
    QUEUE,
    admit,
    drain,
    events,
    expire_lease,
    make_hotel,
    messages_for,
    process,
    requires_db,
    reset_execution_state,
    run_state,
    send_raw,
    sql_value,
    store,
    worker,
)
from core.database import get_supabase

pytestmark = requires_db


@pytest.fixture(autouse=True)
def _clean():
    reset_execution_state()
    yield


@pytest.fixture(scope="module")
def db():
    return get_supabase()


def test_pgmq_extension_and_a_logged_queue_exist():
    assert sql_value("SELECT extversion FROM pg_extension WHERE extname = 'pgmq';") != ""
    assert sql_value(f"SELECT is_unlogged FROM pgmq.meta WHERE queue_name = '{QUEUE}';") == "f"
    assert sql_value(f"SELECT relpersistence FROM pg_class WHERE relname = 'q_{QUEUE}';") == "p"


# --- admission -------------------------------------------------------------------------------------------------

def test_admission_persists_run_step_event_and_message_atomically(db):
    tenant, _ = make_hotel(db)
    s = store()
    result = admit(s, tenant)
    assert result["admitted"] and result["created"] and result["state"] == "queued"
    found = run_state(s, tenant, result["run_id"])
    assert [st["state"] for st in found["steps"]] == ["pending"]
    assert messages_for(result["run_id"]) == 1
    assert [e["event_type"] for e in events(s, tenant, result["run_id"])] == ["admitted", "step_created"]


def test_idempotent_admission_and_conflicting_reuse(db):
    tenant, _ = make_hotel(db)
    other, _ = make_hotel(db)
    s = store()
    key = f"same-{uuid.uuid4().hex}"
    first = admit(s, tenant, key=key)
    again = admit(s, tenant, key=key)
    assert again == {**first, "created": False}
    assert messages_for(first["run_id"]) == 1  # a replay never enqueues twice
    assert admit(s, tenant, key=key, digest="b" * 64) == {"admitted": False, "reason": "idempotency_conflict"}
    elsewhere = admit(s, other, key=key)  # same key in another hotel is a different logical run
    assert elsewhere["created"] and elsewhere["run_id"] != first["run_id"]


def test_concurrent_admissions_with_one_key_create_exactly_one_run(db):
    tenant, _ = make_hotel(db)
    key = f"race-{uuid.uuid4().hex}"
    results, barrier = [], threading.Barrier(8)

    def go():
        s = store()
        barrier.wait()
        results.append(admit(s, tenant, key=key))
    threads = [threading.Thread(target=go) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len({r["run_id"] for r in results}) == 1
    assert sum(1 for r in results if r["created"]) == 1
    assert int(sql_value(f"SELECT count(*) FROM public.agent_runs WHERE idempotency_key = '{key}';")) == 1
    assert messages_for(results[0]["run_id"]) == 1


def test_admission_refuses_unknown_members_inactive_hotels_and_real_agents(db):
    tenant, _ = make_hotel(db)
    other_tenant, outsider = make_hotel(db)
    s = store()
    assert admit(s, tenant, user_id=outsider) == {"admitted": False, "reason": "principal_not_member"}
    db.table("tenants").update({"is_active": False}).eq("id", other_tenant).execute()
    assert admit(s, other_tenant) == {"admitted": False, "reason": "tenant_unavailable"}
    with pytest.raises(Exception) as err:  # the database ceiling, independent of Python
        s.admit(tenant_id=tenant, agent_id="engineering.work_orders", agent_version=1, principal_type="system",
                user_id=None, system_principal_id="harness.scheduled_observer", trigger_type="schedule",
                idempotency_key=f"real-{uuid.uuid4().hex}", request_digest="a" * 64, correlation_id="c",
                policy_version="p", synthetic_spec={}, first_step_type="real", deadline_seconds=60, max_attempts=1,
                step_max_attempts=1)
    assert "agent_runs_h1_synthetic_only" in str(err.value)


# --- scenario 1: normal completion --------------------------------------------------------------------------------

def test_scenario_1_normal_completion_acknowledges_in_the_same_transaction(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant, spec={"operation": "noop", "steps": 2})["run_id"]
    assert process(worker(), s) == "run_succeeded"
    found = run_state(s, tenant, run_id)
    assert found["run"]["state"] == "succeeded" and found["run"]["lease_owner"] is None
    assert [st["state"] for st in found["steps"]] == ["succeeded", "succeeded"]
    assert messages_for(run_id) == 0  # acked inside the commit: no crash window between success and ack
    assert process(worker(), s) == "empty"


# --- scenario 2: duplicate delivery -------------------------------------------------------------------------------

def test_scenario_2_duplicate_delivery_has_one_outcome(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant)["run_id"]
    send_raw({"v": 1, "run_id": run_id})
    send_raw({"v": 1, "run_id": run_id})
    outcomes = drain(worker(), s)
    assert outcomes.count("run_succeeded") == 1
    assert set(outcomes) <= {"run_succeeded", "duplicate", "stale_message", "empty"}
    evs = events(s, tenant, run_id)
    assert sum(1 for e in evs if e["event_type"] == "claimed") == 1
    assert sum(1 for e in evs if e.get("to_state") == "succeeded" and e["event_type"] == "run_state_changed") == 1
    assert len(run_state(s, tenant, run_id)["steps"]) == 1
    assert messages_for(run_id) == 0


def test_two_workers_racing_on_duplicate_messages_claim_once(db):
    tenant, _ = make_hotel(db)
    run_id = admit(store(), tenant)["run_id"]
    for _ in range(3):
        send_raw({"v": 1, "run_id": run_id})
    claims, barrier = [], threading.Barrier(4)

    def go(i):
        s = store()
        barrier.wait()
        claims.append(s.claim(worker_id=f"race-{i}", lease_seconds=30))
    threads = [threading.Thread(target=go, args=(i,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sum(1 for c in claims if c["outcome"] == "claimed") == 1


# --- scenario 3: worker crash -------------------------------------------------------------------------------------

def test_scenario_3_crashed_worker_is_recovered_after_lease_expiry(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant)["run_id"]
    crashed = s.claim(worker_id="it-crashed", lease_seconds=30)  # claims, then "dies" without writing anything
    assert crashed["outcome"] == "claimed" and crashed["fencing_token"] == 1
    assert process(worker("it-worker-b"), s) == "empty"  # message invisible, lease live: nothing to do
    expire_lease(run_id)
    assert process(worker("it-worker-b"), s) == "run_succeeded"
    run = run_state(s, tenant, run_id)["run"]
    assert run["fencing_token"] == 2 and run["attempt_count"] == 2
    assert any(e["event_type"] == "lease_takeover" for e in events(s, tenant, run_id))


# --- scenario 4: stale worker ------------------------------------------------------------------------------------

def test_scenario_4_stale_worker_is_fenced_out(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant)["run_id"]
    a = s.claim(worker_id="it-a", lease_seconds=30)
    step_a = a["step"]["id"]
    expire_lease(run_id)
    # Expired but not yet taken over: an expired lease is never honoured.
    assert s.heartbeat(run_id=run_id, fencing_token=1, worker_id="it-a", lease_seconds=30)["ok"] is False
    b = s.claim(worker_id="it-b", lease_seconds=30)
    assert b["outcome"] == "claimed" and b["fencing_token"] == 2 and b["takeover"] is True
    stale = dict(run_id=run_id, fencing_token=1, worker_id="it-a")
    assert s.complete_step(step_id=step_a, result_meta={}, **stale)["outcome"] == "lease_lost"
    assert s.fail_step(step_id=step_a, error_class="permanent_failure", error_code="x", retryable=False,
                       retry_delay_seconds=1, **stale)["outcome"] == "lease_lost"
    assert s.acknowledge(action="yield", **stale)["outcome"] == "lease_lost"
    assert s.heartbeat(lease_seconds=30, **stale)["ok"] is False
    # Right token, wrong worker id is refused as well.
    assert s.complete_step(run_id=run_id, step_id=step_a, fencing_token=2, worker_id="it-a",
                           result_meta={})["outcome"] == "lease_lost"
    assert s.complete_step(run_id=run_id, step_id=b["step"]["id"], fencing_token=2, worker_id="it-b",
                           result_meta={})["outcome"] == "run_succeeded"
    assert run_state(s, tenant, run_id)["run"]["state"] == "succeeded"


def test_parallel_workers_never_claim_the_same_run_twice(db):
    tenant, _ = make_hotel(db)
    run_ids = {admit(store(), tenant)["run_id"] for _ in range(6)}
    claimed, lock, barrier = [], threading.Lock(), threading.Barrier(6)

    def go(i):
        s = store()
        barrier.wait()
        for _ in range(3):
            c = s.claim(worker_id=f"par-{i}", lease_seconds=60)
            if c["outcome"] == "claimed":
                with lock:
                    claimed.append(c["run"]["id"])
    threads = [threading.Thread(target=go, args=(i,)) for i in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(claimed) == sorted(run_ids)  # every run claimed exactly once

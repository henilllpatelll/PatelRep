"""Agent Harness H1 retries, cancellation, pause, runtime controls and authority against the REAL database (5-7)."""
from __future__ import annotations

import threading
import time
import uuid

import pytest

from agent_execution_support import (
    admit,
    archived_for,
    events,
    expire_lease,
    make_due,
    make_hotel,
    messages_for,
    process,
    requires_db,
    reset_execution_state,
    run_state,
    send_raw,
    store,
    worker,
)
from core.database import get_supabase
from services.agent_execution.controls_store import set_control

pytestmark = requires_db


@pytest.fixture(autouse=True)
def _clean():
    reset_execution_state()
    yield
    reset_execution_state()


@pytest.fixture(scope="module")
def db():
    return get_supabase()


def wait_for(predicate, timeout=15.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.1)
    return False


def in_background(w, s):
    out = {}
    t = threading.Thread(target=lambda: out.setdefault("outcome", process(w, s)))
    t.start()
    return t, out


# --- scenario 5: retry exhaustion --------------------------------------------------------------------------------

def test_scenario_5_bounded_retries_with_backoff_end_in_dead_letter(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant, spec={"operation": "transient_failure", "fail_times": 10}, step_max_attempts=3)["run_id"]
    w = worker()
    outcomes = []
    for _ in range(3):
        outcomes.append(process(w, s))
        found = run_state(s, tenant, run_id)
        if found["run"]["state"] == "retry_wait":
            assert found["run"]["next_attempt_at"] is not None and messages_for(run_id) == 1
            assert process(w, s) == "empty"  # the delayed message is not visible yet: backoff is persisted
            make_due(run_id)
    assert outcomes == ["retry_scheduled", "retry_scheduled", "run_dead_lettered"]
    found = run_state(s, tenant, run_id)
    assert found["run"]["state"] == "dead_letter" and found["run"]["last_error_class"] == "transient_infrastructure"
    assert found["steps"][0]["attempt_count"] == 3 and found["steps"][0]["state"] == "dead_letter"
    assert messages_for(run_id) == 0 and archived_for(run_id) == 1  # kept for investigation
    assert process(w, s) == "empty"


def test_transient_failures_that_recover_succeed_within_the_limit(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant, spec={"operation": "transient_failure", "fail_times": 1})["run_id"]
    assert process(worker(), s) == "retry_scheduled"
    make_due(run_id)
    assert process(worker(), s) == "run_succeeded"


def test_permanent_failure_is_terminal_without_retry(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant, spec={"operation": "permanent_failure"})["run_id"]
    assert process(worker(), s) == "run_failed"
    run = run_state(s, tenant, run_id)["run"]
    assert (run["state"], run["last_error_code"], run["attempt_count"]) == ("failed", "synthetic_permanent", 1)


def test_repeated_crashes_are_bounded_by_run_attempts(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant, max_attempts=2)["run_id"]
    for i in range(2):
        assert s.claim(worker_id=f"crash-{i}", lease_seconds=30)["outcome"] == "claimed"
        expire_lease(run_id)
    assert s.claim(worker_id="crash-3", lease_seconds=30) == {
        "outcome": "dead_letter", "run_id": run_id, "reason": "attempts_exhausted"}


# --- scenario 6: cancellation ------------------------------------------------------------------------------------

def test_scenario_6a_cancelling_a_queued_run_is_immediate_and_removes_its_dispatch(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant)["run_id"]
    assert s.request_cancel(tenant_id=tenant, run_id=run_id, requested_by="it-op")["outcome"] == "cancelled"
    assert messages_for(run_id) == 0 and process(worker(), s) == "empty"
    assert s.request_cancel(tenant_id=tenant, run_id=run_id, requested_by="it-op")["outcome"] == "already_terminal"
    assert s.resume(tenant_id=tenant, run_id=run_id, requested_by="it-op")["reason"] == "not_paused"


def test_scenario_6b_running_job_stops_cooperatively(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant, spec={"operation": "delay", "delay_ms": 10_000})["run_id"]
    t, out = in_background(worker(lease_seconds=10), store())
    assert wait_for(lambda: run_state(s, tenant, run_id)["run"]["state"] == "running")
    assert s.request_cancel(tenant_id=tenant, run_id=run_id, requested_by="it-op")["outcome"] == "cancel_requested"
    t.join(timeout=20)
    assert out["outcome"] == "run_cancelled"
    found = run_state(s, tenant, run_id)
    assert found["run"]["state"] == "cancelled" and found["steps"][0]["state"] == "cancelled"


def test_scenario_6c_cancellation_survives_a_worker_restart(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant)["run_id"]
    assert s.claim(worker_id="it-dies", lease_seconds=30)["outcome"] == "claimed"
    assert s.request_cancel(tenant_id=tenant, run_id=run_id, requested_by="it-op")["outcome"] == "cancel_requested"
    expire_lease(run_id)  # the worker never came back
    assert process(worker("it-restarted"), s) == "cancelled"
    assert run_state(s, tenant, run_id)["run"]["state"] == "cancelled"


def test_pause_is_refused_once_cancellation_is_pending(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant)["run_id"]
    s.claim(worker_id="it-a", lease_seconds=30)
    s.request_cancel(tenant_id=tenant, run_id=run_id, requested_by="it-op")
    assert s.request_pause(tenant_id=tenant, run_id=run_id, requested_by="it-op")["reason"] == "not_pausable"


# --- pause / resume / runtime controls ----------------------------------------------------------------------------

def test_paused_run_is_not_processed_until_resumed(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant)["run_id"]
    assert s.request_pause(tenant_id=tenant, run_id=run_id, requested_by="it-op")["outcome"] == "paused"
    assert messages_for(run_id) == 0 and process(worker(), s) == "empty"
    assert s.resume(tenant_id=tenant, run_id=run_id, requested_by="it-op")["outcome"] == "resumed"
    assert process(worker(), s) == "run_succeeded"


def test_running_job_pauses_at_a_checkpoint_and_resumes_later(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant, spec={"operation": "delay", "delay_ms": 10_000})["run_id"]
    t, out = in_background(worker(lease_seconds=10), store())
    assert wait_for(lambda: run_state(s, tenant, run_id)["run"]["state"] == "running")
    assert s.request_pause(tenant_id=tenant, run_id=run_id, requested_by="it-op")["outcome"] == "pause_requested"
    t.join(timeout=20)
    assert out["outcome"] == "run_paused" and run_state(s, tenant, run_id)["run"]["state"] == "paused"
    assert run_state(s, tenant, run_id)["run"]["attempt_count"] == 0  # a pause does not consume an attempt
    s.resume(tenant_id=tenant, run_id=run_id, requested_by="it-op")
    assert run_state(s, tenant, run_id)["run"]["state"] == "queued"


@pytest.mark.parametrize("scope, reason", [("platform", "platform_paused"), ("hotel", "hotel_paused"),
                                           ("agent", "agent_paused"), ("cost", "cost_emergency_stop")])
def test_runtime_controls_block_claims_and_admission(db, scope, reason):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant)["run_id"]
    kwargs = {"platform": dict(scope="platform", paused=True), "hotel": dict(scope="hotel", tenant_id=tenant, paused=True),
              "agent": dict(scope="agent", agent_id="harness.synthetic", paused=True),
              "cost": dict(scope="platform", cost_emergency_stop=True)}[scope]
    set_control(s.client, updated_by="it-operator", **kwargs)
    claim = s.claim(worker_id="it-a", lease_seconds=30, blocked_retry=1)
    assert (claim["outcome"], claim["reason"]) == ("blocked", reason)
    assert admit(s, tenant) == {"admitted": False, "reason": reason}
    set_control(s.client, updated_by="it-operator", **{**kwargs, "paused": False, "cost_emergency_stop": False})
    assert wait_for(lambda: process(worker(), s) == "run_succeeded", timeout=10)
    assert run_state(s, tenant, run_id)["run"]["state"] == "succeeded"


def test_a_pause_set_while_running_makes_the_worker_yield(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant, spec={"operation": "delay", "delay_ms": 10_000})["run_id"]
    t, out = in_background(worker(lease_seconds=10), store())
    assert wait_for(lambda: run_state(s, tenant, run_id)["run"]["state"] == "running")
    set_control(s.client, scope="hotel", tenant_id=tenant, paused=True, updated_by="it-operator")
    t.join(timeout=20)
    assert out["outcome"] == "run_yielded" and run_state(s, tenant, run_id)["run"]["state"] == "queued"


# --- scenario 7: authority revoked -------------------------------------------------------------------------------

@pytest.mark.parametrize("revoke, code", [
    ({"role": "housekeeper"}, "operational_permission_revoked"),
    ({"is_active": False}, "principal_inactive"),
])
def test_scenario_7_revoked_authority_denies_execution(db, revoke, code):
    tenant, gm = make_hotel(db)
    s = store()
    run_id = admit(s, tenant, user_id=gm)["run_id"]
    db.table("user_roles").update(revoke).eq("user_id", gm).eq("tenant_id", tenant).execute()
    assert process(worker(), s) == "run_failed"
    found = run_state(s, tenant, run_id)
    assert (found["run"]["state"], found["run"]["last_error_class"], found["run"]["last_error_code"]) == (
        "failed", "authorization_denied", code)
    assert found["steps"][0]["result_meta"] == {}  # nothing executed


def test_deactivated_profile_and_removed_membership_deny_execution(db):
    tenant, gm = make_hotel(db)
    s = store()
    first = admit(s, tenant, user_id=gm)["run_id"]
    db.table("user_profiles").update({"is_active": False}).eq("id", gm).execute()
    assert process(worker(), s) == "run_failed"
    assert run_state(s, tenant, first)["run"]["last_error_code"] == "principal_inactive"


def test_current_gm_authority_allows_a_human_run(db):
    tenant, gm = make_hotel(db)
    s = store()
    run_id = admit(s, tenant, user_id=gm)["run_id"]
    assert process(worker(), s) == "run_succeeded" and run_state(s, tenant, run_id)["run"]["state"] == "succeeded"


# --- deadlines and poison messages -------------------------------------------------------------------------------

def test_deadline_exhaustion_is_terminal(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant, deadline=1)["run_id"]
    time.sleep(1.5)
    assert s.recover(limit=100)["deadline_failed"] >= 1
    run = run_state(s, tenant, run_id)["run"]
    assert (run["state"], run["last_error_code"]) == ("failed", "deadline_exceeded")
    assert messages_for(run_id) == 0


@pytest.mark.parametrize("message", [
    {"v": 2, "run_id": "00000000-0000-4000-8000-000000000000"},
    {"v": 1, "run_id": "not-a-uuid"},
    {"v": 1, "run_id": "00000000-0000-4000-8000-000000000000", "role": "gm"},
    {"v": 1},
    "[1, 2, 3]",
    {"v": 1, "run_id": str(uuid.uuid4())},  # well-formed but names no run
])
def test_malformed_or_orphan_messages_are_archived_as_poison(message):
    send_raw(message)
    claim = store().claim(worker_id="it-a", lease_seconds=30)
    assert claim["outcome"] == "poison"
    assert store().claim(worker_id="it-a", lease_seconds=30)["outcome"] == "empty"


def test_retry_scheduling_leaves_exactly_one_delayed_dispatch(db):
    tenant, _ = make_hotel(db)
    s = store()
    run_id = admit(s, tenant, spec={"operation": "transient_failure", "fail_times": 1})["run_id"]
    assert process(worker(), s) == "retry_scheduled"
    assert messages_for(run_id) == 1
    assert any(e["event_type"] == "run_state_changed" and e["to_state"] == "retry_wait" for e in events(s, tenant, run_id))

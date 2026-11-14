"""H1 worker decisions against a scripted store (fake clock, no sleeps). Durability itself is proven in integration."""
from __future__ import annotations

from services.agent_execution.worker import Worker
from tests.smoke.agent_execution_support import (
    HOTEL_A,
    Clock,
    FakeAuthority,
    FakeStore,
    claimed,
    make_worker,
    run_row,
    step_row,
)


def go(worker: Worker, store: FakeStore, authority=None) -> str:
    return worker.process_one(store, authority or FakeAuthority())


def test_empty_queue_does_nothing_else():
    store = FakeStore()
    assert go(make_worker(), store) == "empty" and store.names() == ["claim"]


def test_successful_multi_step_run_commits_each_step_under_the_same_token():
    store = FakeStore(claim=claimed(run_row(synthetic_spec={"operation": "noop", "steps": 3})))
    assert go(make_worker(), store) == "run_succeeded"
    completes = [kw for name, kw in store.calls if name == "complete_step"]
    assert [c["next_step_type"] for c in completes] == ["synthetic_noop", "synthetic_noop", None]
    assert {c["fencing_token"] for c in completes} == {7} and {c["worker_id"] for c in completes} == {"worker-test"}


def test_transient_failure_schedules_a_bounded_jittered_retry():
    store = FakeStore(claim=claimed(run_row(synthetic_spec={"operation": "transient_failure", "fail_times": 2}),
                                    step_row(attempt=2)))
    assert go(make_worker(), store) == "retry_scheduled"
    (_, fail), = [c for c in store.calls if c[0] == "fail_step"]
    assert fail["retryable"] is True and fail["error_class"] == "transient_infrastructure"
    assert fail["retry_delay_seconds"] == 2  # attempt 2, base 2s, jitter 0.5 -> round(4 * 0.5)


def test_permanent_failure_is_not_retried():
    store = FakeStore(claim=claimed(run_row(synthetic_spec={"operation": "permanent_failure"})))
    assert go(make_worker(), store) == "run_failed"
    (_, fail), = [c for c in store.calls if c[0] == "fail_step"]
    assert fail["retryable"] is False and fail["error_code"] == "synthetic_permanent"


def test_invalid_job_payload_is_failed_without_execution():
    store = FakeStore(claim=claimed(run_row(synthetic_spec={"operation": "shell", "cmd": "id"})))
    assert go(make_worker(), store) == "run_failed"
    (_, fail), = [c for c in store.calls if c[0] == "fail_step"]
    assert (fail["error_class"], fail["retryable"]) == ("invalid_job", False)


def test_a_non_synthetic_run_hits_the_h0_execution_ceiling():
    store = FakeStore(claim=claimed(run_row(agent_id="examples.work_order_observer")))
    assert go(make_worker(), store) == "run_failed"
    (_, fail), = [c for c in store.calls if c[0] == "fail_step"]
    assert (fail["error_code"], fail["retryable"]) == ("agent_execution_disabled", False)
    assert "complete_step" not in store.names()


def test_revoked_authority_denies_execution_and_is_not_retried():
    store = FakeStore(claim=claimed())
    assert go(make_worker(), store, FakeAuthority("housekeeper")) == "run_failed"
    (_, fail), = [c for c in store.calls if c[0] == "fail_step"]
    assert (fail["error_class"], fail["error_code"], fail["retryable"]) == (
        "authorization_denied", "operational_permission_revoked", False)


def test_identity_is_revalidated_before_every_step():
    authority = FakeAuthority("gm")
    store = FakeStore(claim=claimed(run_row(synthetic_spec={"operation": "noop", "steps": 3})))
    go(make_worker(), store, authority)
    assert len(authority.calls) == 3


def test_paused_hotel_makes_the_worker_yield_instead_of_executing():
    store = FakeStore(claim=claimed(), controls=[{"scope": "hotel", "tenant_id": HOTEL_A, "paused": True}])
    assert go(make_worker(), store) == "run_yielded"
    (_, ack), = [c for c in store.calls if c[0] == "acknowledge"]
    assert (ack["action"], ack["reason"], ack["yield_delay_seconds"]) == ("yield", "hotel_paused", 30)
    assert "complete_step" not in store.names()


def _delay_store(heartbeats):
    return FakeStore(claim=claimed(run_row(synthetic_spec={"operation": "delay", "delay_ms": 10_000})),
                     heartbeats=heartbeats)


def test_cancellation_is_acknowledged_at_a_checkpoint():
    store = _delay_store([{"ok": True, "cancel_requested": True}])
    assert go(make_worker(lease_seconds=10), store) == "run_cancelled"
    assert [kw["action"] for n, kw in store.calls if n == "acknowledge"] == ["cancel"]


def test_pause_request_is_acknowledged_at_a_checkpoint():
    store = _delay_store([{"ok": True, "pause_requested": True}])
    assert go(make_worker(lease_seconds=10), store) == "run_paused"


def test_lease_loss_stops_the_worker_without_any_further_write():
    store = _delay_store([{"ok": False, "reason": "lease_lost"}])
    assert go(make_worker(lease_seconds=10), store) == "lease_lost"
    assert store.names()[-1] == "heartbeat"
    assert not {"complete_step", "fail_step", "acknowledge"} & set(store.names())


def test_deadline_seen_at_a_checkpoint_fails_the_run_terminally():
    store = _delay_store([{"ok": True, "deadline_exceeded": True}])
    assert go(make_worker(lease_seconds=10), store) == "run_failed"
    (_, fail), = [c for c in store.calls if c[0] == "fail_step"]
    assert (fail["error_class"], fail["retryable"]) == ("deadline_exceeded", False)


def test_heartbeats_are_paced_by_the_lease_with_a_fake_clock():
    clock = Clock()
    store = FakeStore(claim=claimed(run_row(synthetic_spec={"operation": "delay", "delay_ms": 10_000})))
    assert go(make_worker(lease_seconds=12, clock=clock), store) == "run_succeeded"
    assert store.names().count("heartbeat") == 2  # 10 s of work, renew every 4 s


def test_shutdown_yields_in_flight_work_without_waiting():
    worker = make_worker(lease_seconds=10)
    worker.stop_event.set()
    store = FakeStore(claim=claimed(run_row(synthetic_spec={"operation": "delay", "delay_ms": 10_000})))
    assert go(worker, store) == "run_yielded"
    (_, ack), = [c for c in store.calls if c[0] == "acknowledge"]
    assert (ack["action"], ack["reason"], ack["yield_delay_seconds"]) == ("yield", "worker_shutdown", 0)


def test_store_outage_during_commit_is_contained():
    class Flaky(FakeStore):
        def complete_step(self, **kw):
            raise ConnectionError("db down")
    assert go(make_worker(), Flaky(claim=claimed())) == "store_unavailable"


def test_worker_never_processes_in_production_or_without_opt_in():
    for worker in (make_worker(app_env="production"), make_worker(enabled=False), make_worker(synthetic=False)):
        store = FakeStore(claim=claimed())
        assert go(worker, store) == "disabled" and store.calls == []
        assert worker.run(install_signals=False) == 0


def test_run_loop_starts_and_drains_cleanly():
    stores: list[FakeStore] = []

    def factory():
        stores.append(FakeStore())
        return stores[-1]
    worker = make_worker(concurrency=2, poll_interval_seconds=0.05, liveness_interval_seconds=1)
    worker._store_factory = factory
    import threading
    threading.Timer(0.3, worker.request_stop).start()
    assert worker.run(install_signals=False) == 0
    statuses = [kw["status"] for s in stores for n, kw in s.calls if n == "worker_heartbeat"]
    assert statuses[0] == "starting" and statuses[-1] == "stopped"
    assert any(n == "recover" for s in stores for n, _ in s.calls)

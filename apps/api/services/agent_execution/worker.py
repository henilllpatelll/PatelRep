"""The dedicated Agent Harness worker process.

It runs OUTSIDE the FastAPI app (``python -m services.agent_execution worker``); nothing here is started by
``main.py``'s lifespan and there is no second APScheduler. Stopping the worker never affects hotel operations: queued
runs simply wait, and crash recovery is driven by the database (leases, fencing, ``agent_runs_recover``).

Per claimed run the worker, for every step:
  1. refuses anything but the synthetic probe through the H0 gate ``require_execution_supported()``,
  2. re-establishes the principal from CURRENT authoritative membership (``revalidate_principal``),
  3. re-reads runtime controls (pauses / cost stop) from the database,
  4. executes the closed synthetic step, heartbeating at cooperative checkpoints,
  5. commits the outcome through a fenced RPC. A refused fencing token (``lease_lost``) means stop and write nothing.

Backpressure: a fixed number of slots (``concurrency``); a slot only reads the queue when it is free, and idle slots
back off exponentially up to ``max_idle_seconds``. Shutdown (SIGTERM/SIGINT) makes every in-flight run yield back to
the queue at its next checkpoint without consuming an attempt.
"""
from __future__ import annotations

import json
import logging
import random
import signal
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from services.agent_execution import SYNTHETIC_AGENT_ID, SYNTHETIC_AGENT_VERSION
from services.agent_execution.admission import synthetic_admission_allowed
from services.agent_execution.config import WorkerSettings
from services.agent_execution.controls_store import block_reason, load_runtime_controls_from_store
from services.agent_execution.identity_authority import revalidate_principal
from services.agent_execution.retry import DeadlineExceeded, LeaseLost, backoff_seconds, classify
from services.agent_execution.store import AgentRunStore
from services.agent_execution.synthetic import execute_step, next_step_type, parse_spec
from services.agent_harness.controls import require_execution_supported
from services.agent_harness.identity import IdentityAuthority

logger = logging.getLogger("patelrep.agent_worker")


def log_event(event: str, **fields: Any) -> None:
    """Structured, sanitized log line: identifiers, outcomes and codes only -- never payloads or exception text."""
    safe = {k: v for k, v in fields.items() if isinstance(v, (str, int, float, bool)) or v is None}
    logger.info(json.dumps({"event": event, **safe}, sort_keys=True))


class CooperativeStop(Exception):
    """Raised at a safe checkpoint: acknowledge ``action`` (cancel / pause / yield) through the fenced RPC."""

    def __init__(self, action: str, reason: str) -> None:
        super().__init__(reason)
        self.action = action
        self.reason = reason


@dataclass
class _Job:
    run: dict
    step: dict
    token: int


class _Checkpoint:
    def __init__(self, worker: "Worker", store: AgentRunStore, job: _Job) -> None:
        self._worker, self._store, self._job = worker, store, job
        self._last = worker.monotonic()

    def __call__(self, force: bool = False) -> None:
        w = self._worker
        if w.stop_event.is_set():
            raise CooperativeStop("yield", "worker_shutdown")
        if not force and w.monotonic() - self._last < w.settings.heartbeat_interval_seconds:
            return
        result = self._store.heartbeat(run_id=self._job.run["id"], fencing_token=self._job.token,
                                       worker_id=w.settings.worker_id, lease_seconds=w.settings.lease_seconds,
                                       vt_margin=w.settings.vt_margin_seconds)
        self._last = w.monotonic()
        if not result or not result.get("ok"):
            raise LeaseLost()
        if result.get("cancel_requested"):
            raise CooperativeStop("cancel", "cancel_requested")
        if result.get("pause_requested"):
            raise CooperativeStop("pause", "pause_requested")
        if result.get("blocked_reason"):
            raise CooperativeStop("yield", str(result["blocked_reason"]))
        if result.get("deadline_exceeded"):
            raise DeadlineExceeded()


class Worker:
    def __init__(
        self,
        settings: WorkerSettings,
        *,
        app_env: str,
        version: str,
        store_factory: Callable[[], AgentRunStore],
        authority_factory: Callable[[Any], IdentityAuthority],
        clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
        monotonic: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        rng: Callable[[], float] = random.random,
    ) -> None:
        self.settings = settings
        self.app_env = app_env
        self.version = (version or "unknown")[:64]
        self._store_factory = store_factory
        self._authority_factory = authority_factory
        self.clock = clock
        self.monotonic = monotonic
        self._sleep = sleep
        self._rng = rng
        self.stop_event = threading.Event()
        self._in_flight = 0
        self._lock = threading.Lock()
        self.started_at = clock()

    # ---- policy ----------------------------------------------------------------------------------------------
    @property
    def may_process(self) -> bool:
        return self.settings.enabled and synthetic_admission_allowed(
            app_env=self.app_env, synthetic_enabled=self.settings.synthetic_enabled)

    # ---- one claim -------------------------------------------------------------------------------------------
    def process_one(self, store: AgentRunStore, authority: IdentityAuthority) -> str:
        """Claim at most one run and drive it to a stopping point. Returns the final outcome code."""
        if not self.may_process:
            return "disabled"
        claim = store.claim(worker_id=self.settings.worker_id, lease_seconds=self.settings.lease_seconds,
                            vt_margin=self.settings.vt_margin_seconds, poison_read_ct=self.settings.poison_read_ct,
                            blocked_retry=self.settings.blocked_retry_seconds)
        outcome = (claim or {}).get("outcome", "invalid_claim_response")
        if outcome != "claimed":
            if outcome != "empty":
                log_event("claim_skipped", outcome=outcome, run_id=(claim or {}).get("run_id"),
                          reason=(claim or {}).get("reason"))
            return outcome
        job = _Job(run=claim["run"], step=claim["step"], token=int(claim["fencing_token"]))
        log_event("claimed", run_id=job.run["id"], tenant_id=job.run["tenant_id"], step=job.step["step_number"],
                  attempt=job.step["attempt_count"], fencing_token=job.token, takeover=bool(claim.get("takeover")))
        with self._lock:
            self._in_flight += 1
        try:
            return self._execute(store, authority, job)
        finally:
            with self._lock:
                self._in_flight -= 1

    def _execute(self, store: AgentRunStore, authority: IdentityAuthority, job: _Job) -> str:
        checkpoint = _Checkpoint(self, store, job)
        common = dict(run_id=job.run["id"], fencing_token=job.token, worker_id=self.settings.worker_id)
        while True:
            step = job.step
            try:
                if (job.run.get("agent_id"), job.run.get("agent_version")) != (SYNTHETIC_AGENT_ID, SYNTHETIC_AGENT_VERSION):
                    require_execution_supported()  # H0 ceiling: raises AgentExecutionDisabled
                revalidate_principal(job.run, authority, clock=self.clock)
                controls = load_runtime_controls_from_store(store.client, self.clock())
                blocked = block_reason(controls, hotel_id=job.run["tenant_id"], agent_id=job.run["agent_id"])
                if blocked:
                    raise CooperativeStop("yield", blocked)
                spec = parse_spec(job.run.get("synthetic_spec"))
                meta = execute_step(spec, step_number=step["step_number"], attempt=step["attempt_count"],
                                    checkpoint=checkpoint, sleep=self._sleep)
            except CooperativeStop as stop:
                action, reason = stop.action, stop.reason
                delay = 0 if reason == "worker_shutdown" else self.settings.blocked_retry_seconds
                result = self._safe(lambda: store.acknowledge(action=action, reason=reason,
                                                              yield_delay_seconds=delay, **common))
                outcome = (result or {}).get("outcome", "store_unavailable")
                log_event("cooperative_stop", run_id=job.run["id"], action=action, reason=reason, outcome=outcome)
                return outcome
            except LeaseLost:
                log_event("lease_lost", run_id=job.run["id"], fencing_token=job.token)
                return "lease_lost"
            except Exception as exc:  # classified; never echoed
                cls = classify(exc)
                delay = backoff_seconds(int(step.get("attempt_count") or 1), rng=self._rng)
                result = self._safe(lambda: store.fail_step(
                    step_id=step["id"], error_class=cls.error_class.value, error_code=cls.code,
                    retryable=cls.retryable, retry_delay_seconds=delay, **common))
                outcome = (result or {}).get("outcome", "store_unavailable")
                log_event("step_failed", run_id=job.run["id"], step=step["step_number"], error_class=cls.error_class.value,
                          error_code=cls.code, retryable=cls.retryable, outcome=outcome)
                return outcome

            next_type = next_step_type(spec, step["step_number"])
            result = self._safe(lambda: store.complete_step(step_id=step["id"], result_meta=meta,
                                                            next_step_type=next_type, **common))
            outcome = (result or {}).get("outcome", "store_unavailable")
            log_event("step_completed", run_id=job.run["id"], step=step["step_number"], outcome=outcome)
            if outcome == "next_step":
                job.step = result["step"]
                continue
            return outcome

    def _safe(self, call: Callable[[], Optional[dict]]) -> Optional[dict]:
        """A commit RPC that fails mid-flight has an unknown outcome; the lease expiry + fencing make that safe."""
        try:
            return call()
        except Exception as exc:
            log_event("store_call_failed", error_class=classify(exc).error_class.value)
            return None

    # ---- process loop ----------------------------------------------------------------------------------------
    def _slot_loop(self, slot: int) -> None:
        store = self._store_factory()
        authority = self._authority_factory(store.client)
        idle = self.settings.poll_interval_seconds
        next_recovery = 0.0
        while not self.stop_event.is_set():
            try:
                if slot == 0 and self.monotonic() >= next_recovery:
                    counts = store.recover(limit=self.settings.recovery_batch)
                    next_recovery = self.monotonic() + self.settings.recovery_interval_seconds
                    if counts and any(counts.values()):
                        log_event("recovery", **{k: v for k, v in counts.items() if isinstance(v, int)})
                outcome = self.process_one(store, authority)
            except Exception as exc:
                log_event("slot_error", slot=slot, error_class=classify(exc).error_class.value)
                outcome = "error"
            if outcome in ("empty", "error", "disabled"):
                self.stop_event.wait(idle)
                idle = min(idle * 2, self.settings.max_idle_seconds)
            else:
                idle = self.settings.poll_interval_seconds

    def _liveness(self, store: AgentRunStore, status: str) -> None:
        try:
            with self._lock:
                in_flight = self._in_flight
            store.worker_heartbeat(worker_id=self.settings.worker_id, status=status, app_env=self.app_env,
                                   version=self.version, concurrency=self.settings.concurrency,
                                   in_flight=in_flight, started_at=self.started_at)
        except Exception as exc:
            log_event("liveness_failed", error_class=classify(exc).error_class.value)

    def request_stop(self, *_: Any) -> None:
        self.stop_event.set()

    def run(self, *, install_signals: bool = True) -> int:
        if not self.may_process:
            reason = "production" if self.app_env == "production" else "not_enabled"
            log_event("worker_disabled", reason=reason, app_env=self.app_env)
            return 0
        if install_signals:
            signal.signal(signal.SIGTERM, self.request_stop)
            signal.signal(signal.SIGINT, self.request_stop)
        store = self._store_factory()
        self._liveness(store, "starting")
        threads = [threading.Thread(target=self._slot_loop, args=(i,), name=f"agent-slot-{i}", daemon=True)
                   for i in range(self.settings.concurrency)]
        for thread in threads:
            thread.start()
        log_event("worker_started", worker_id=self.settings.worker_id, concurrency=self.settings.concurrency,
                  app_env=self.app_env)
        while not self.stop_event.wait(self.settings.liveness_interval_seconds):
            self._liveness(store, "running")
        self._liveness(store, "draining")
        for thread in threads:
            thread.join(timeout=self.settings.lease_seconds)
        self._liveness(store, "stopped")
        log_event("worker_stopped", worker_id=self.settings.worker_id)
        return 0

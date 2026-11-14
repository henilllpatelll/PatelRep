"""Builders and a scripted fake store for the Agent Harness H1 unit tests (no database, network or provider).

The fake only stands in for the RPC transport so the worker's DECISIONS can be tested deterministically. Durable
semantics (atomicity, fencing, idempotency, recovery, RLS) are proven against a real database in
tests/integration/test_agent_execution_*.py -- never by this fake.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from services.agent_execution import SYNTHETIC_AGENT_ID, SYNTHETIC_AGENT_VERSION
from services.agent_execution.config import WorkerSettings
from services.agent_execution.worker import Worker
from services.agent_harness.identity import AuthoritativeIdentity
from tests.smoke.fake_supabase import FakeDB

NOW = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)
HOTEL_A = "11111111-1111-4111-8111-111111111111"
HOTEL_B = "22222222-2222-4222-8222-222222222222"
GM_USER = "33333333-3333-4333-8333-333333333333"
RUN_ID = "55555555-5555-4555-8555-555555555555"


def run_row(**changes: Any) -> dict:
    row = {
        "id": RUN_ID, "tenant_id": HOTEL_A, "agent_id": SYNTHETIC_AGENT_ID, "agent_version": SYNTHETIC_AGENT_VERSION,
        "principal_type": "human", "initiated_by_user_id": GM_USER, "system_principal_id": None,
        "trigger_type": "user_request", "correlation_id": "corr-1", "synthetic_spec": {"operation": "noop"},
    }
    row.update(changes)
    return row


def step_row(number: int = 1, attempt: int = 1, **changes: Any) -> dict:
    row = {"id": f"step-{number}-{attempt}", "step_number": number, "attempt_count": attempt, "max_attempts": 3}
    row.update(changes)
    return row


class FakeAuthority:
    def __init__(self, role: Optional[str] = "gm", *, active: bool = True, hotel_id: str = HOTEL_A,
                 loaded_at: datetime = NOW, missing: bool = False) -> None:
        self.role, self.active, self.hotel_id, self.loaded_at, self.missing = role, active, hotel_id, loaded_at, missing
        self.calls: list[tuple[str, str]] = []

    def load(self, *, user_id: str, hotel_id: str) -> Optional[AuthoritativeIdentity]:
        self.calls.append((user_id, hotel_id))
        if self.missing:
            return None
        return AuthoritativeIdentity(user_id=user_id, hotel_id=self.hotel_id, role=self.role, is_active=self.active,
                                     loaded_at=self.loaded_at)


class FakeStore:
    """Records every RPC; answers from simple scripts."""

    def __init__(self, *, claim: Optional[dict] = None, heartbeats: Optional[list[dict]] = None,
                 controls: Optional[list[dict]] = None, steps: int = 1) -> None:
        self._claim = claim
        self._heartbeats = list(heartbeats or [])
        self.client = FakeDB({"agent_runtime_controls": list(controls or [])})
        self.steps = steps
        self.calls: list[tuple[str, dict]] = []

    def names(self) -> list[str]:
        return [name for name, _ in self.calls]

    def claim(self, **kw: Any) -> dict:
        self.calls.append(("claim", kw))
        return self._claim or {"outcome": "empty"}

    def heartbeat(self, **kw: Any) -> dict:
        self.calls.append(("heartbeat", kw))
        return self._heartbeats.pop(0) if self._heartbeats else {"ok": True}

    def complete_step(self, **kw: Any) -> dict:
        self.calls.append(("complete_step", kw))
        if kw.get("next_step_type"):
            number = int(kw["step_id"].split("-")[1]) + 1
            return {"outcome": "next_step", "step": step_row(number)}
        return {"outcome": "run_succeeded"}

    def fail_step(self, **kw: Any) -> dict:
        self.calls.append(("fail_step", kw))
        return {"outcome": "retry_scheduled" if kw["retryable"] else "run_failed"}

    def acknowledge(self, **kw: Any) -> dict:
        self.calls.append(("acknowledge", kw))
        return {"outcome": {"cancel": "run_cancelled", "pause": "run_paused", "yield": "run_yielded"}[kw["action"]]}

    def recover(self, **kw: Any) -> dict:
        self.calls.append(("recover", kw))
        return {"cancelled": 0, "deadline_failed": 0, "redispatched": 0}

    def worker_heartbeat(self, **kw: Any) -> None:
        self.calls.append(("worker_heartbeat", kw))


def claimed(run: Optional[dict] = None, step: Optional[dict] = None, token: int = 7) -> dict:
    return {"outcome": "claimed", "fencing_token": token, "takeover": False,
            "run": run or run_row(), "step": step or step_row()}


class Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def monotonic(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.t += seconds


def make_worker(*, app_env: str = "test", enabled: bool = True, synthetic: bool = True, clock: Optional[Clock] = None,
                **settings: Any) -> Worker:
    clock = clock or Clock()
    ws = WorkerSettings(enabled=enabled, synthetic_enabled=synthetic, worker_id="worker-test", **settings)
    return Worker(ws, app_env=app_env, version="test", store_factory=lambda: FakeStore(),
                  authority_factory=lambda _client: FakeAuthority(), clock=lambda: NOW,
                  monotonic=clock.monotonic, sleep=clock.sleep, rng=lambda: 0.5)


def later(seconds: int) -> datetime:
    return NOW + timedelta(seconds=seconds)

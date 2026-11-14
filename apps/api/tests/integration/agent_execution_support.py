"""Helpers for the Agent Harness H1 real-database tests (isolated migrated Supabase + real pgmq, never mocks).

Raw SQL (``run_sql``) is used ONLY for fault injection and inspection that PostgREST cannot express: expiring a lease,
making a message visible early, deleting/duplicating/forging a queue message, and privilege checks. Every decision
under test is made by the real RPCs and the real worker.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import pytest

from batch_support import new_client, psql_available, run_sql
from services.agent_execution import SYNTHETIC_AGENT_ID, SYNTHETIC_AGENT_VERSION
from services.agent_execution.config import WorkerSettings
from services.agent_execution.identity_authority import SupabaseIdentityAuthority
from services.agent_execution.store import AgentRunStore
from services.agent_execution.worker import Worker

QUEUE = "patelrep_agent_runs_v1"

requires_db = pytest.mark.skipif(
    os.getenv("MIGRATED_DATABASE_TEST") != "1",
    reason="requires the isolated Supabase database created by the migration gate",
)


def now() -> datetime:
    return datetime.now(timezone.utc)


def store() -> AgentRunStore:
    return AgentRunStore(new_client())


def sql_value(query: str) -> str:
    out = run_sql(f"\\pset tuples_only on\n\\pset format unaligned\n{query}")
    return out.strip().splitlines()[-1].strip() if out.strip() else ""


def reset_execution_state() -> None:
    """Throwaway-DB hygiene between tests: finish leftover runs, clear controls, empty the queue."""
    assert psql_available(), "H1 integration tests need psql (CI installs it; locally set PSQL_DOCKER_CONTAINER)"
    run_sql(f"""
      SELECT public.agent_run_request_cancel(tenant_id, id, 'test-reset') FROM public.agent_runs
       WHERE state NOT IN ('succeeded', 'failed', 'cancelled', 'dead_letter');
      UPDATE public.agent_runs SET lease_expires_at = now() - interval '1 second' WHERE state = 'cancel_requested';
      SELECT public.agent_runs_recover(1000);
      UPDATE public.agent_runtime_controls SET paused = false, cost_emergency_stop = false;
      SELECT pgmq.purge_queue('{QUEUE}');
    """)


def _create_user(db, label: str) -> str:
    created = db.auth.admin.create_user({"email": f"{label}-{uuid.uuid4().hex[:12]}@h1-test.example",
                                         "password": f"pw-{uuid.uuid4().hex}", "email_confirm": True})
    return created.user.id


def make_hotel(db, *, role: str = "gm") -> tuple[str, str]:
    """A fresh hotel and one staff member with a profile and exactly one active role. Returns (tenant_id, user_id)."""
    suffix = uuid.uuid4().hex[:10]
    tenant_id = db.table("tenants").insert({"name": f"H1 Test {suffix}", "slug": f"h1-test-{suffix}"}).execute().data[0]["id"]
    user_id = _create_user(db, role)
    db.table("user_profiles").insert({"id": user_id, "tenant_id": tenant_id, "full_name": "H1 Tester"}).execute()
    db.table("user_roles").insert({"user_id": user_id, "tenant_id": tenant_id, "role": role}).execute()
    return tenant_id, user_id


def admit(s: AgentRunStore, tenant_id: str, *, spec: Optional[dict] = None, key: Optional[str] = None,
          user_id: Optional[str] = None, digest: Optional[str] = None, deadline: int = 600, max_attempts: int = 5,
          step_max_attempts: int = 3) -> dict:
    spec = spec or {"operation": "noop"}
    human = user_id is not None
    return s.admit(
        tenant_id=tenant_id, agent_id=SYNTHETIC_AGENT_ID, agent_version=SYNTHETIC_AGENT_VERSION,
        principal_type="human" if human else "system", user_id=user_id,
        system_principal_id=None if human else "harness.scheduled_observer",
        trigger_type="user_request" if human else "schedule", idempotency_key=key or f"it-{uuid.uuid4().hex}",
        request_digest=digest or ("a" * 64), correlation_id="it-corr", policy_version="agent-harness-policy/h0.1",
        synthetic_spec=spec, first_step_type=f"synthetic_{spec['operation']}", deadline_seconds=deadline,
        max_attempts=max_attempts, step_max_attempts=step_max_attempts)


def worker(worker_id: str = "it-worker-a", *, lease_seconds: int = 10) -> Worker:
    settings = WorkerSettings(enabled=True, synthetic_enabled=True, worker_id=worker_id, lease_seconds=lease_seconds,
                              blocked_retry_seconds=1)
    return Worker(settings, app_env="test", version="it", store_factory=store,
                  authority_factory=lambda client: SupabaseIdentityAuthority(client, clock=now), clock=now)


def process(w: Worker, s: Optional[AgentRunStore] = None) -> str:
    s = s or store()
    return w.process_one(s, SupabaseIdentityAuthority(s.client, clock=now))


def run_state(s: AgentRunStore, tenant_id: str, run_id: str) -> dict:
    return s.get_run(tenant_id=tenant_id, run_id=run_id)


def expire_lease(run_id: str) -> None:
    run_sql(f"""
      UPDATE public.agent_runs SET lease_expires_at = now() - interval '1 second' WHERE id = '{run_id}';
      UPDATE pgmq.q_{QUEUE} SET vt = now() - interval '1 second' WHERE message->>'run_id' = '{run_id}';
    """)


def make_due(run_id: str) -> None:
    """Fast-forward a retry: the persisted schedule and the delayed message become due now."""
    run_sql(f"""
      UPDATE public.agent_runs SET next_attempt_at = now() - interval '1 second' WHERE id = '{run_id}' AND state = 'retry_wait';
      UPDATE public.agent_run_steps SET next_attempt_at = now() - interval '1 second' WHERE run_id = '{run_id}' AND state = 'retry_wait';
      UPDATE pgmq.q_{QUEUE} SET vt = now() - interval '1 second' WHERE message->>'run_id' = '{run_id}';
    """)


def messages_for(run_id: str) -> int:
    return int(sql_value(f"SELECT count(*) FROM pgmq.q_{QUEUE} WHERE message->>'run_id' = '{run_id}';"))


def archived_for(run_id: str) -> int:
    return int(sql_value(f"SELECT count(*) FROM pgmq.a_{QUEUE} WHERE message->>'run_id' = '{run_id}';"))


def send_raw(message: dict | str) -> None:
    body = message if isinstance(message, str) else json.dumps(message)
    run_sql(f"SELECT pgmq.send('{QUEUE}', '{body}'::jsonb, 0);")


def events(s: AgentRunStore, tenant_id: str, run_id: str) -> list[dict]:
    return s.events_page(tenant_id=tenant_id, run_id=run_id, limit=500)


def drain(w: Worker, s: AgentRunStore, limit: int = 20) -> list[str]:
    outcomes = []
    for _ in range(limit):
        outcome = process(w, s)
        outcomes.append(outcome)
        if outcome == "empty":
            break
    return outcomes

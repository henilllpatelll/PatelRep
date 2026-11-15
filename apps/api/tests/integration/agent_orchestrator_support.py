"""Helpers for the Agent Harness H3 real-database tests (isolated migrated Supabase + real pgmq; never staging).

Every test builds its OWN hotel. Platform/provider counters are global per calendar month, so tests that exercise those
limits set them relative to the counter's current value. Raw SQL is used only for fault injection (expiring leases)
and inspection; every decision under test is made by the real RPCs.
"""
from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from agent_execution_support import QUEUE, expire_lease, run_sql, sql_value, store
from agent_gateway_support import GatewayHotel, make_gateway_hotel
from batch_support import new_client
from services.agent_orchestrator.budget_store import SupabaseSpendLedger
from services.agent_orchestrator.store import PlanningStore

BIG = Decimal("1000000")
X = Decimal("0.00300000")  # gpt-6-luna exposure for 10,000 in / 1,000 out
MODEL = ("openai", "gpt-6-luna", "openai-2026-11-14")


def ledger() -> SupabaseSpendLedger:
    return SupabaseSpendLedger(new_client())


def pstore() -> PlanningStore:
    return PlanningStore(new_client())


def reset_spend_state() -> None:
    """End leftover runs, clear controls, purge the queue, enable paid calls and lift the platform/provider caps."""
    run_sql(f"""
      SELECT public.agent_run_request_cancel(tenant_id, id, 'test-reset') FROM public.agent_runs
       WHERE state NOT IN ('succeeded', 'failed', 'cancelled', 'dead_letter');
      UPDATE public.agent_runs SET lease_expires_at = now() - interval '1 second' WHERE state = 'cancel_requested';
      SELECT public.agent_runs_recover(1000);
      UPDATE public.agent_runtime_controls SET paused = false, cost_emergency_stop = false;
      SELECT pgmq.purge_queue('{QUEUE}');
    """)
    led = ledger()
    assert led.set_enablement(enabled=True, updated_by="it-operator", reason="integration_test")["ok"]
    assert led.set_policy(scope="platform", operator="it-operator", period_limit_usd=BIG)["ok"]
    for provider in ("openai", "anthropic"):
        assert led.set_policy(scope="provider", provider=provider, operator="it-operator", period_limit_usd=BIG)["ok"]


@dataclass
class Claimed:
    run_id: str
    step_id: str
    token: int
    worker: str


def make_hotel(*, flag: bool = True) -> GatewayHotel:
    return make_gateway_hotel(flag=flag, grant=False)


def set_budgets(hotel: GatewayHotel, *, hotel_limit: Decimal = BIG, period: Decimal = BIG, run: Decimal = BIG,
                step: Decimal = BIG, call: Decimal = BIG, uncertain: int = 1) -> None:
    led = ledger()
    assert led.set_policy(scope="hotel", tenant_id=hotel.tenant_id, operator="it-operator",
                          period_limit_usd=hotel_limit)["ok"]
    result = led.set_policy(scope="agent", tenant_id=hotel.tenant_id, agent_id="harness.orchestrator", agent_version=1,
                            operator="it-operator", period_limit_usd=period, run_limit_usd=run, step_limit_usd=step,
                            call_limit_usd=call, max_uncertain_per_run=uncertain)
    assert result["ok"], result


def digest(*parts: str) -> str:
    return hashlib.sha256(":".join(parts).encode()).hexdigest()


def admit_planning(hotel: GatewayHotel, *, user: Optional[str] = None, key: Optional[str] = None,
                   work_order: Optional[str] = None, deadline: int = 600) -> dict:
    key = key or f"plan-it-{uuid.uuid4().hex}"
    wo = work_order or hotel.work_order
    return pstore().admit(tenant_id=hotel.tenant_id, user_id=user or hotel.chief,
                          intent="engineering.work_order_dispatch_plan", intent_version=1, resource_type="work_order",
                          resource_id=wo, idempotency_key=key, request_digest=digest(hotel.tenant_id, wo, key),
                          correlation_id="it-corr", policy_version="agent-harness-policy/h0.1",
                          deadline_seconds=deadline, max_attempts=3, step_max_attempts=2)


def claim(worker: str = "it-h3-a", *, lease_seconds: int = 30, run_id: Optional[str] = None) -> Claimed:
    """Take a real H1 lease on the next queued run (optionally insisting on ``run_id``)."""
    s = store()
    for _ in range(10):
        result = s.claim(worker_id=worker, lease_seconds=lease_seconds, vt_margin=5)
        if result.get("outcome") != "claimed":
            continue
        if run_id is None or result["run"]["id"] == run_id:
            return Claimed(run_id=result["run"]["id"], step_id=result["step"]["id"],
                           token=int(result["fencing_token"]), worker=worker)
    raise AssertionError(f"could not claim run {run_id}")


def planning_run(hotel: GatewayHotel, worker: str = "it-h3-a", **kw) -> Claimed:
    admitted = admit_planning(hotel, **kw)
    assert admitted.get("admitted"), admitted
    return claim(worker, run_id=admitted["run_id"])


def reserve(c: Claimed, *, key: Optional[str] = None, attempt: int = 1, exposure: Decimal = X,
            model: tuple[str, str, str] = MODEL, max_in: int = 10_000, max_out: int = 1_000, worker: Optional[str] = None,
            token: Optional[int] = None):
    return ledger().reserve(run_id=c.run_id, fencing_token=c.token if token is None else token,
                            worker_id=worker or c.worker, step_id=c.step_id,
                            logical_call_key=key or f"model:{c.run_id}:{uuid.uuid4().hex[:8]}", attempt_number=attempt,
                            provider=model[0], model=model[1], schedule_version=model[2], max_input_tokens=max_in,
                            max_output_tokens=max_out, exposure_usd=exposure)


def counter(scope: str, key: str) -> tuple[Decimal, Decimal]:
    out = sql_value(f"""SELECT reserved_usd || '|' || committed_usd FROM public.agent_model_budget_counters
                         WHERE scope = '{scope}' AND scope_key = '{key}'
                           AND period_start IN (public.agent__model_period(now()), DATE '1970-01-01');""")
    if not out:
        return Decimal(0), Decimal(0)
    reserved, committed = out.split("|")
    return Decimal(reserved), Decimal(committed)


def attempt_state(attempt_id: str) -> str:
    return sql_value(f"SELECT state FROM public.agent_model_attempts WHERE id = '{attempt_id}';")


def attempts_of(run_id: str) -> int:
    return int(sql_value(f"SELECT count(*) FROM public.agent_model_attempts WHERE run_id = '{run_id}';"))


def events_of(run_id: str) -> list[str]:
    out = run_sql(f"\\pset tuples_only on\n\\pset format unaligned\n"
                  f"SELECT event_type || ':' || COALESCE(reason_code, '') FROM public.agent_model_spend_events "
                  f"WHERE run_id = '{run_id}' ORDER BY id;")
    return [line.strip() for line in out.splitlines() if ":" in line]


__all__ = ["expire_lease", "run_sql", "sql_value", "store", "QUEUE"]

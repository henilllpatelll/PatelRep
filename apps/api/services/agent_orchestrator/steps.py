"""Worker step executor for ``harness.orchestrator`` v1 ``model_planning`` steps (called only by the H1 worker).

Per attempt: fenced planning context -> replay a plan already recorded by an earlier incarnation (no new model call)
-> revalidate the initiator from CURRENT membership -> re-read runtime controls -> build the provider adapters (process
gate) -> bounded orchestration through the budget boundary -> record the plan through a fenced RPC -> return small,
sanitized step metadata. Lease loss stops everything (the ledger, not the step, holds the financial record of any call
already dispatched). Nothing here executes a tool, reads business data or writes outside the planning/ledger RPCs.
"""
from __future__ import annotations

import asyncio
import re
import time
from datetime import datetime
from typing import Any, Callable, Mapping, Optional

from services.agent_execution.controls_store import block_reason, load_runtime_controls_from_store
from services.agent_execution.identity_authority import revalidate_principal
from services.agent_execution.retry import InvalidJob
from services.agent_gateway.authorization import parse_ts
from services.agent_harness.identity import IdentityAuthority
from services.agent_harness.metering import Provider
from services.agent_orchestrator.boundary import AttemptContext, BudgetedCaller
from services.agent_orchestrator.budget_store import SpendLedger
from services.agent_orchestrator.errors import ContextUnavailable, PlanningBlocked, PlanningDeadlineExceeded, PlanningLeaseLost
from services.agent_orchestrator.intents import PLAN_SCHEMA_V2
from services.agent_orchestrator.observability import log_event
from services.agent_orchestrator.orchestrator import Orchestrator, PlanningLimits, PlanningRequest, intent_for
from services.agent_orchestrator.planner import AgentsSdkPlanner
from services.agent_orchestrator.providers import ProviderAdapter
from services.agent_orchestrator.store import PlanningStore

_REASON_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_HEARTBEAT_STOPS = (("cancel_requested", "run_cancel_requested"), ("pause_requested", "run_pause_requested"))


def heartbeat_probe(heartbeat: Callable[[], Optional[dict]]) -> Callable[[], Optional[str]]:
    """Adapt the H1 fenced heartbeat into the boundary's ``before_attempt`` hook (returns a stop reason or None)."""
    def probe() -> Optional[str]:
        result = heartbeat()
        if not result or not result.get("ok"):
            return "lease_lost"
        for flag, reason in _HEARTBEAT_STOPS:
            if result.get(flag):
                return reason
        if result.get("blocked_reason"):
            return str(result["blocked_reason"])
        if result.get("deadline_exceeded"):
            return "deadline_exceeded"
        return None
    return probe


def execute_planning_step(*, pstore: PlanningStore, ledger: SpendLedger, run: Mapping[str, Any], step: Mapping[str, Any],
                          fencing_token: int, worker_id: str, authority: IdentityAuthority,
                          clock: Callable[[], datetime], adapters_factory: Callable[[], Mapping[Provider, ProviderAdapter]],
                          heartbeat: Callable[[], Optional[dict]], limits: PlanningLimits = PlanningLimits(),
                          monotonic: Callable[[], float] = time.monotonic, planner: Any = None,
                          context_provider: Optional[Callable[..., Any]] = None) -> dict:
    context = pstore.step_context(run_id=run["id"], fencing_token=fencing_token, worker_id=worker_id)
    if not context.get("ok"):
        if context.get("reason") == "lease_lost":
            raise PlanningLeaseLost()
        raise InvalidJob("planning context unavailable")
    planning = context["planning"]
    if planning.get("plan_outcome"):
        return _meta(planning["plan_outcome"], planning.get("plan_digest"), planning.get("reason_codes") or [],
                     proposals=len(((planning.get("plan") or {}).get("steps")) or []),
                     calls=int(planning.get("model_attempts") or 0), replayed=True)

    intent = intent_for(planning.get("intent"), planning.get("intent_version"))
    revalidate_principal(run, authority, clock=clock, required_roles=intent.initiator_roles)
    controls = load_runtime_controls_from_store(pstore.client, clock())
    blocked = block_reason(controls, hotel_id=run["tenant_id"], agent_id=run["agent_id"])
    if blocked:
        raise PlanningBlocked(blocked)

    # H5: plan-schema-v2 intents plan over VERIFIED facts gathered (by the gateway, under the initiator's reloaded
    # identity and the hotel's grants) BEFORE any paid call. A refusal ends the run with a 'rejected' plan and zero
    # model attempts; a runtime-control block yields (PlanningBlocked raised by the provider).
    verified = None
    if intent.plan_schema == PLAN_SCHEMA_V2:
        if context_provider is None:
            raise PlanningBlocked("context_provider_unavailable")
        try:
            verified = context_provider(intent=intent, run=run, planning=planning)
        except ContextUnavailable as refused:
            return _record_rejection(pstore, run, step, fencing_token, worker_id, refused.code)
        recorded_ctx = pstore.record_context(run_id=run["id"], fencing_token=fencing_token, worker_id=worker_id,
                                             agent_id=verified.agent_id, agent_version=verified.agent_version,
                                             context_digest=verified.digest, fact_keys=sorted(verified.facts))
        if not recorded_ctx.get("ok"):
            if recorded_ctx.get("reason") == "lease_lost":
                raise PlanningLeaseLost()
            raise InvalidJob("planning context could not be recorded")
    try:
        adapters = adapters_factory()
    except Exception:
        raise PlanningBlocked("paid_calls_disabled") from None

    deadline_at, db_now = parse_ts(context.get("deadline_at")), parse_ts(context.get("db_now"))
    remaining = (deadline_at - db_now).total_seconds() if deadline_at and db_now else 0.0
    budget = min(remaining, limits.step_budget_seconds)
    if budget <= 2:
        raise PlanningDeadlineExceeded()
    ctx = AttemptContext(
        tenant_id=run["tenant_id"], run_id=run["id"], step_id=step["id"], fencing_token=fencing_token,
        worker_id=worker_id, step_attempt=int(step.get("attempt_count") or 1),
        correlation_id=run.get("correlation_id"), deadline_monotonic=monotonic() + budget,
        max_model_calls=limits.max_model_calls_per_step, max_attempts_per_call=limits.max_attempts_per_call,
        max_retries_per_model=limits.max_retries_per_model, per_call_timeout_seconds=limits.per_call_timeout_seconds)
    caller = BudgetedCaller(ledger=ledger, adapters=adapters, ctx=ctx, monotonic=monotonic,
                            before_attempt=heartbeat_probe(heartbeat))
    request = PlanningRequest(tenant_id=run["tenant_id"], run_id=run["id"], intent=intent.intent,
                              intent_version=intent.version, resource_type=planning["resource_type"],
                              resource_id=str(planning["resource_id"]), correlation_id=run.get("correlation_id"),
                              context=dict(verified.facts) if verified else None,
                              context_digest=verified.digest if verified else None, now=clock())
    result = asyncio.run(Orchestrator(planner or AgentsSdkPlanner(), limits).plan(request, caller=caller))

    plan = result.plan
    recorded = pstore.record_plan(
        run_id=run["id"], fencing_token=fencing_token, worker_id=worker_id, outcome=result.outcome,
        plan=plan.plan if plan else None, plan_digest=plan.digest if plan else None,
        reason_codes=list(result.reason_codes), model_attempts=len(result.attempts))
    if not recorded.get("ok"):
        if recorded.get("reason") == "lease_lost":
            raise PlanningLeaseLost()
        raise InvalidJob("plan could not be recorded")
    log_event("plan_recorded", run_id=run["id"], step_id=step["id"], correlation_id=run.get("correlation_id"),
              plan_outcome=result.outcome, proposal_count=plan.proposal_count if plan else 0,
              model_calls=result.model_calls)
    return _meta(result.outcome, plan.digest if plan else None, list(result.reason_codes),
                 proposals=plan.proposal_count if plan else 0, calls=result.model_calls, replayed=False)


def _record_rejection(pstore: PlanningStore, run: Mapping[str, Any], step: Mapping[str, Any], fencing_token: int,
                      worker_id: str, code: str) -> dict:
    reason = code if isinstance(code, str) and _REASON_RE.match(code) else "context_unavailable"
    recorded = pstore.record_plan(run_id=run["id"], fencing_token=fencing_token, worker_id=worker_id,
                                  outcome="rejected", plan=None, plan_digest=None,
                                  reason_codes=[reason], model_attempts=0)
    if not recorded.get("ok"):
        if recorded.get("reason") == "lease_lost":
            raise PlanningLeaseLost()
        raise InvalidJob("plan could not be recorded")
    log_event("plan_recorded", run_id=run["id"], step_id=step["id"], correlation_id=run.get("correlation_id"),
              plan_outcome="rejected", proposal_count=0, model_calls=0)
    return _meta("rejected", None, [reason], proposals=0, calls=0, replayed=False)


def _meta(outcome: str, digest: Optional[str], reasons: list, *, proposals: int, calls: int, replayed: bool) -> dict:
    """Step result metadata (H1 caps it at 2 KB): identifiers and counts only, never plan contents."""
    return {"kind": "planning", "plan_outcome": outcome, "plan_digest": digest, "proposal_count": proposals,
            "model_calls": calls, "reason_codes": [str(r)[:64] for r in reasons][:8], "replayed": replayed,
            "authorizes_execution": False}

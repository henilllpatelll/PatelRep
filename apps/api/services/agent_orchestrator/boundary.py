"""The H3 paid-call boundary. EVERY potentially billable provider network attempt goes through ``BudgetedCaller``.

Per attempt, strictly in this order:
  1. bound the request (UTF-8 bytes of everything sent + the model's reviewed overhead allowance) and compute the
     maximum exposure from the exact price schedule; refuse requests that exceed the model's reviewed caps;
  2. ``reserve`` -- one committed transaction; a denial means ZERO provider dispatches for this attempt;
  3. ``dispatch`` marker -- one committed transaction re-checking lease, cancellation, pause, controls and the switch;
  4. the native adapter call (provider SDK retries are disabled; a hard asyncio timeout backs up the HTTP timeout);
  5. ``settle`` from the provider's reported usage: settled | released (provably not charged) | uncertain | unreconciled.

Retries and fallbacks are new attempts with new reservations. Only failures that provably were not processed
(NOT_DISPATCHED / REJECTED_NO_CHARGE) and are marked retryable are retried, with bounded full-jitter backoff inside the
step deadline. An uncertain outcome is never retried automatically. Database calls run in a worker thread so no
transaction is ever held open across a provider call.
"""
from __future__ import annotations

import asyncio
import json
import random
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Awaitable, Callable, Mapping, Optional

from services.agent_harness.metering import CostStatus, Provider
from services.agent_harness.provider_pricing import ProviderPriceBook, price_usage
from services.agent_harness.provider_usage import UsageStatus
from services.agent_orchestrator.budget_store import Settlement, SpendLedger
from services.agent_orchestrator.catalog import Candidate, WorkloadClass, resolve_route
from services.agent_orchestrator.errors import (
    BudgetDenied,
    CallLimitExceeded,
    ErrorKind,
    InvalidModelRequest,
    PlanningBlocked,
    PlanningDeadlineExceeded,
    PlanningLeaseLost,
    ProviderCallFailed,
    ProviderOutcomeUncertain,
    SpendOverrun,
)
from services.agent_orchestrator.observability import log_event
from services.agent_orchestrator.pricebook import PRICE_BOOK
from services.agent_orchestrator.providers import (
    ROLES,
    ChatMessage,
    DispatchState,
    ProviderAdapter,
    ProviderError,
    ProviderOutcome,
    ProviderRequest,
    StructuredOutputSpec,
)

MESSAGE_OVERHEAD_BYTES = 16
HARD_TIMEOUT_MARGIN_SECONDS = 5.0
BACKOFF_BASE_SECONDS = 1.0
BACKOFF_CAP_SECONDS = 8.0
_BLOCK_REASONS = {"paid_calls_disabled", "cost_emergency_stop", "platform_paused", "hotel_paused", "agent_paused",
                  "tenant_capability_disabled", "step_not_running"}
_ACTIONS = {"run_cancel_requested": "cancel", "run_pause_requested": "pause"}


def request_bytes(system: str, messages: tuple[ChatMessage, ...], output: Optional[StructuredOutputSpec]) -> int:
    """An upper bound on text tokens: byte-level BPE tokenizers never emit more text tokens than UTF-8 bytes."""
    total = len(system.encode("utf-8"))
    for m in messages:
        if m.role not in ROLES or not isinstance(m.text, str):
            raise InvalidModelRequest("unsupported_message")
        total += len(m.text.encode("utf-8")) + MESSAGE_OVERHEAD_BYTES
    if output is not None:
        total += len(output.name.encode("utf-8")) + len(json.dumps(output.schema, separators=(",", ":")).encode("utf-8"))
    return total


@dataclass(frozen=True)
class AttemptContext:
    tenant_id: str
    run_id: str
    step_id: str
    fencing_token: int
    worker_id: str
    step_attempt: int
    correlation_id: Optional[str]
    deadline_monotonic: float
    max_model_calls: int = 4
    max_attempts_per_call: int = 3
    max_retries_per_model: int = 1
    per_call_timeout_seconds: float = 30.0


@dataclass
class AttemptRecord:
    attempt_number: int
    provider: str
    model: str
    reserved_usd: Decimal
    settlement: str
    cost_usd: Optional[Decimal] = None
    error_code: Optional[str] = None


@dataclass(frozen=True)
class CallResult:
    text: Optional[str]
    outcome: ProviderOutcome
    candidate: Candidate
    attempts: tuple[AttemptRecord, ...]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def _to_thread(fn: Callable[..., Any], **kwargs: Any) -> Any:
    return await asyncio.to_thread(fn, **kwargs)


@dataclass
class BudgetedCaller:
    ledger: SpendLedger
    adapters: Mapping[Provider, ProviderAdapter]
    ctx: AttemptContext
    price_book: ProviderPriceBook = PRICE_BOOK
    clock: Callable[[], datetime] = _utcnow
    monotonic: Callable[[], float] = time.monotonic
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep
    rng: Callable[[], float] = random.random
    run_blocking: Callable[..., Awaitable[Any]] = _to_thread
    before_attempt: Optional[Callable[[], Optional[str]]] = None  # heartbeat; returns a stop reason or None
    calls: int = 0
    records: list[AttemptRecord] = field(default_factory=list)
    _turn: int = 0

    # ---- public --------------------------------------------------------------------------------------------------
    async def call(self, *, workload: WorkloadClass, system: str, messages: tuple[ChatMessage, ...],
                   output: Optional[StructuredOutputSpec], max_output_tokens: int,
                   override: Optional[tuple[Provider, str]] = None) -> CallResult:
        self._turn += 1
        size = request_bytes(system, messages, output)
        route = resolve_route(workload, input_bytes=size, max_output_tokens=max_output_tokens, at=self.clock(),
                              override=override, book=self.price_book,
                              unavailable=[k for k in _all_keys() if k[0] not in self.adapters])
        key = f"model:{self.ctx.run_id}:{self.ctx.step_id}:{self.ctx.step_attempt}:{self._turn}"
        attempt_number = 0
        last: Optional[ProviderError] = None
        for index, cand in enumerate(route.candidates):
            tries = 0
            while True:
                attempt_number += 1
                if attempt_number > self.ctx.max_attempts_per_call:
                    raise CallLimitExceeded()
                await self._preflight()
                request = ProviderRequest(model=cand.model.model_id, system=system, messages=messages, output=output,
                                          max_output_tokens=max_output_tokens, timeout_seconds=self._timeout(),
                                          reasoning_effort=route.reasoning_effort)
                outcome = await self._attempt(cand, request, key, attempt_number, fallback=index, retry=tries)
                if outcome.error is None:
                    return CallResult(text=outcome.text, outcome=outcome, candidate=cand, attempts=tuple(self.records))
                last = outcome.error
                if not (last.retryable and last.dispatch in (DispatchState.NOT_DISPATCHED,
                                                             DispatchState.REJECTED_NO_CHARGE)):
                    raise ProviderCallFailed(last.kind)
                tries += 1
                if tries > self.ctx.max_retries_per_model:
                    break  # next reviewed fallback, if any
                await self._backoff(tries, last.retry_after_seconds)
        raise ProviderCallFailed(last.kind if last else ErrorKind.SERVICE_UNAVAILABLE, retryable=True)

    # ---- one attempt ---------------------------------------------------------------------------------------------
    async def _attempt(self, cand: Candidate, request: ProviderRequest, key: str, attempt_number: int, *,
                       fallback: int, retry: int) -> ProviderOutcome:
        ctx, model = self.ctx, cand.model
        reserved = await self.run_blocking(
            self.ledger.reserve, run_id=ctx.run_id, fencing_token=ctx.fencing_token, worker_id=ctx.worker_id,
            step_id=ctx.step_id, logical_call_key=key, attempt_number=attempt_number, provider=model.provider.value,
            model=model.model_id, schedule_version=cand.schedule.schedule_version,
            max_input_tokens=cand.max_input_tokens, max_output_tokens=request.max_output_tokens,
            exposure_usd=cand.exposure_usd)
        if not reserved.ok or reserved.attempt is None:
            self._log("model_reservation_denied", cand, attempt_number, reason=reserved.reason)
            raise self._refusal(reserved.reason or "reservation_failed")
        attempt = reserved.attempt
        if attempt.state != "reserved":
            # A replayed reservation that already left 'reserved' was dispatched by an earlier incarnation: never re-send.
            raise ProviderOutcomeUncertain("attempt_already_dispatched")
        dispatched = await self.run_blocking(self.ledger.dispatch, attempt_id=attempt.attempt_id, run_id=ctx.run_id,
                                             fencing_token=ctx.fencing_token, worker_id=ctx.worker_id)
        if not dispatched.ok:
            self._log("model_dispatch_refused", cand, attempt_number, reason=dispatched.reason)
            raise self._refusal(dispatched.reason or "dispatch_refused")
        self.calls += 1
        adapter = self.adapters[model.provider]
        started = self.monotonic()
        try:
            outcome = await asyncio.wait_for(adapter.send(request),
                                             timeout=request.timeout_seconds + HARD_TIMEOUT_MARGIN_SECONDS)
        except asyncio.TimeoutError:
            outcome = ProviderOutcome(provider=model.provider, requested_model=model.model_id,
                                      error=ProviderError(ErrorKind.TIMEOUT_AFTER_DISPATCH, DispatchState.UNCERTAIN, False))
        except asyncio.CancelledError:
            # Cancelled mid-flight: the provider may have processed it. Record that, then let the cancellation proceed.
            await asyncio.shield(self._settle(attempt.attempt_id, Settlement(
                outcome="uncertain", error_code=ErrorKind.CANCELLED_IN_FLIGHT.value)))
            raise
        latency_ms = int((self.monotonic() - started) * 1000)
        settlement = self._settlement_for(outcome)
        result = await self._settle(attempt.attempt_id, settlement)
        record = AttemptRecord(attempt_number=attempt_number, provider=model.provider.value, model=model.model_id,
                               reserved_usd=attempt.reserved_usd, settlement=settlement.outcome,
                               cost_usd=settlement.cost_usd,
                               error_code=outcome.error.kind.value if outcome.error else settlement.cost_cause)
        self.records.append(record)
        usage = outcome.usage.counts() if outcome.usage else {}
        self._log("model_attempt", cand, attempt_number, attempt_id=attempt.attempt_id, reserved_usd=attempt.reserved_usd,
                  settlement=settlement.outcome, cost_usd=settlement.cost_usd, cost_status=settlement.cost_status,
                  cost_cause=settlement.cost_cause, usage_status=settlement.usage_status,
                  uncached_input_tokens=usage.get("uncached_input"), cache_read_tokens=usage.get("cache_read"),
                  output_tokens=usage.get("output"), reasoning_tokens=usage.get("reasoning"),
                  reported_model=outcome.reported_model, provider_request_id=outcome.request_id,
                  provider_response_id=outcome.response_id, dispatch_state=outcome.dispatch.value,
                  latency_ms=latency_ms, retry_count=retry, fallback_count=fallback,
                  error_code=record.error_code, http_status=outcome.error.http_status if outcome.error else None)
        if result is not None and result.overrun:
            raise SpendOverrun()
        if settlement.outcome == "uncertain":
            raise ProviderOutcomeUncertain()
        return outcome

    def _settlement_for(self, outcome: ProviderOutcome) -> Settlement:
        error = outcome.error
        if error is not None and error.dispatch in (DispatchState.NOT_DISPATCHED, DispatchState.REJECTED_NO_CHARGE):
            return Settlement(outcome="released", error_code=error.kind.value)
        if error is not None and error.dispatch is DispatchState.UNCERTAIN:
            return Settlement(outcome="uncertain", error_code=error.kind.value)
        usage = outcome.usage
        ids = dict(reported_model=outcome.reported_model, provider_request_id=outcome.request_id,
                   provider_response_id=outcome.response_id, error_code=error.kind.value if error else None)
        if usage is None:
            return Settlement(outcome="unreconciled", usage_status=UsageStatus.UNREPORTED.value,
                              cost_status=CostStatus.UNRECONCILED.value, cost_cause="usage_unreported", **ids)
        counts = {k: v for k, v in usage.counts().items() if v is not None}
        cost = price_usage(usage, self.price_book, provider=outcome.provider, reported_model=outcome.reported_model,
                           at=self.clock())
        if cost.status is CostStatus.COSTED:
            return Settlement(outcome="settled", cost_usd=cost.cost_usd, usage_status=usage.status.value,
                              usage=counts, cost_status=cost.status.value, cost_tier=cost.tier, **ids)
        return Settlement(outcome="unreconciled", usage_status=usage.status.value, usage=counts or None,
                          cost_status=cost.status.value, cost_cause=cost.cause.value if cost.cause else None, **ids)

    async def _settle(self, attempt_id: str, settlement: Settlement):
        try:
            return await self.run_blocking(self.ledger.settle, attempt_id=attempt_id,
                                           fencing_token=self.ctx.fencing_token, settlement=settlement)
        except Exception:
            # The attempt stays 'dispatched'; recovery will mark it uncertain. Never continue spending blind.
            log_event("model_settlement_unrecorded", run_id=self.ctx.run_id, attempt_id=attempt_id)
            raise ProviderOutcomeUncertain("settlement_unrecorded") from None

    # ---- limits ----------------------------------------------------------------------------------------------------
    async def _preflight(self) -> None:
        if self.calls >= self.ctx.max_model_calls:
            raise CallLimitExceeded()
        if self.monotonic() >= self.ctx.deadline_monotonic:
            raise PlanningDeadlineExceeded()
        if self.before_attempt is not None:
            reason = await self.run_blocking(self.before_attempt)
            if reason:
                raise self._refusal(reason)

    def _timeout(self) -> float:
        remaining = self.ctx.deadline_monotonic - self.monotonic() - HARD_TIMEOUT_MARGIN_SECONDS
        if remaining < 1.0:
            raise PlanningDeadlineExceeded()
        return min(self.ctx.per_call_timeout_seconds, remaining)

    async def _backoff(self, tries: int, retry_after: Optional[float]) -> None:
        delay = min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * (2 ** (tries - 1))) * min(max(self.rng(), 0.0), 1.0)
        if retry_after is not None:
            delay = max(delay, retry_after)
        if self.monotonic() + delay + HARD_TIMEOUT_MARGIN_SECONDS >= self.ctx.deadline_monotonic:
            raise PlanningDeadlineExceeded()
        await self.sleep(delay)

    @staticmethod
    def _refusal(reason: str) -> Exception:
        if reason == "lease_lost":
            return PlanningLeaseLost()
        if reason == "deadline_exceeded":
            return PlanningDeadlineExceeded()
        if reason in _ACTIONS:
            return PlanningBlocked(reason, action=_ACTIONS[reason])
        if reason in _BLOCK_REASONS:
            return PlanningBlocked(reason)
        return BudgetDenied(reason)

    def _log(self, event: str, cand: Candidate, attempt_number: int, **fields: Any) -> None:
        log_event(event, correlation_id=self.ctx.correlation_id, run_id=self.ctx.run_id, step_id=self.ctx.step_id,
                  attempt_number=attempt_number, provider=cand.model.provider.value, requested_model=cand.model.model_id,
                  schedule_version=cand.schedule.schedule_version, input_token_bound=cand.max_input_tokens, **fields)


def _all_keys() -> tuple[tuple[Provider, str], ...]:
    from services.agent_orchestrator.catalog import MODEL_CATALOG

    return tuple(MODEL_CATALOG)

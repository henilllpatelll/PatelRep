"""The H3 paid-call boundary: reservation before every network attempt, retries/fallback re-reserve, safe settlement."""
from __future__ import annotations

import asyncio
import logging
from decimal import Decimal

import pytest

from services.agent_harness.metering import Provider
from services.agent_orchestrator import boundary as boundary_mod
from services.agent_orchestrator.boundary import AttemptContext, BudgetedCaller
from services.agent_orchestrator.catalog import WorkloadClass
from services.agent_orchestrator.errors import (
    BudgetDenied,
    CallLimitExceeded,
    ErrorKind,
    PlanningBlocked,
    PlanningDeadlineExceeded,
    PlanningLeaseLost,
    ProviderCallFailed,
    ProviderOutcomeUncertain,
    RoutingError,
    SpendOverrun,
)
from services.agent_orchestrator.providers import ChatMessage, StructuredOutputSpec
from tests.smoke.agent_orchestrator_support import (
    GUEST_CANARY,
    SECRET_CANARY,
    FakeLedger,
    Transport,
    adapters,
    anthropic_ok,
    openai_ok,
    raise_exc,
    status,
)

SCHEMA = {"type": "object", "additionalProperties": False, "properties": {"ok": {"type": "boolean"}},
          "required": ["ok"]}
MSG = (ChatMessage("user", "Plan work order 1."),)


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


async def passthrough(fn, **kw):
    return fn(**kw)


def caller(ledger, oa, an=None, *, deadline=600.0, **ctx_kw):
    import httpx2

    clock, sleeps = Clock(), []

    async def sleep(seconds):
        sleeps.append(seconds)
        clock.now += seconds

    ctx = AttemptContext(tenant_id="t-1", run_id="run-1", step_id="step-1", fencing_token=7, worker_id="w-1",
                         step_attempt=1, correlation_id="corr-1", deadline_monotonic=deadline, **ctx_kw)
    c = BudgetedCaller(ledger=ledger, adapters=adapters(oa, an), ctx=ctx, monotonic=clock, sleep=sleep,
                       rng=lambda: 0.5, run_blocking=passthrough)
    assert httpx2  # the fakes run on the SDKs' real transport package
    return c, clock, sleeps


def run(c, workload=WorkloadClass.STRUCTURED_TOOL_PROPOSALS, **kw):
    return asyncio.run(c.call(workload=workload, system="You plan.", messages=MSG,
                              output=StructuredOutputSpec("plan", SCHEMA), max_output_tokens=500, **kw))


def test_network_is_touched_only_after_reservation_and_dispatch_commit():
    ledger = FakeLedger()
    oa = Transport([openai_ok()], ledger=ledger)
    c, *_ = caller(ledger, oa)
    result = run(c)
    assert [k for k, _ in ledger.log] == ["reserve", "dispatch", "settle:settled"]
    [req] = oa.requests
    assert req["ledger_states"] == ["dispatched"]  # committed reservation + dispatch marker existed at send time
    [a] = ledger.attempts.values()
    # 1000 uncached * 0.10 + 200 cached * 0.01 + 150 output * 0.50 per MTok
    assert a.state == "settled" and a.settled == Decimal("0.000177")
    assert result.text == '{"ok": true}' and result.candidate.model.model_id == "gpt-6-luna"
    assert a.reserved == result.candidate.exposure_usd and a.settled <= a.reserved


def test_refused_reservation_means_zero_provider_dispatches():
    ledger = FakeLedger(deny_reason="hotel_budget_exceeded")
    oa = Transport([openai_ok()], ledger=ledger)
    c, *_ = caller(ledger, oa)
    with pytest.raises(BudgetDenied) as exc:
        run(c)
    assert exc.value.reason == "hotel_budget_exceeded" and oa.requests == [] and c.calls == 0


@pytest.mark.parametrize("reason, expected", [
    ("lease_lost", PlanningLeaseLost), ("cost_emergency_stop", PlanningBlocked), ("platform_paused", PlanningBlocked),
    ("run_cancel_requested", PlanningBlocked), ("deadline_exceeded", PlanningDeadlineExceeded),
])
def test_refused_dispatch_marker_means_zero_provider_dispatches(reason, expected):
    ledger = FakeLedger(dispatch_reason=reason)
    oa = Transport([openai_ok()], ledger=ledger)
    c, *_ = caller(ledger, oa)
    with pytest.raises(expected):
        run(c)
    assert oa.requests == [] and ledger.states() == ["released"]


def test_retry_after_rate_limit_is_a_new_attempt_with_its_own_reservation():
    ledger = FakeLedger()
    oa = Transport([status(429, retry_after="1"), openai_ok()], ledger=ledger)
    c, clock, sleeps = caller(ledger, oa)
    run(c)
    assert [k for k, _ in ledger.log] == ["reserve", "dispatch", "settle:released", "reserve", "dispatch",
                                          "settle:settled"]
    first, second = ledger.attempts.values()
    assert (first.key, first.number, first.state) == (second.key, 1, "released")
    assert second.number == 2 and second.state == "settled"
    assert [r["ledger_states"] for r in oa.requests] == [["dispatched"], ["released", "dispatched"]]
    assert sleeps == [1.0]  # retry-after honoured; jittered backoff would have been 0.5


def test_fallback_needs_a_new_valid_reservation_and_never_costs_more():
    ledger = FakeLedger()
    oa = Transport([status(429), status(429)], ledger=ledger)
    an = Transport([anthropic_ok()], ledger=ledger)
    c, *_ = caller(ledger, oa, an)
    result = run(c)
    models = [(a.provider, a.model, a.number, a.state) for a in ledger.attempts.values()]
    assert models == [("openai", "gpt-6-luna", 1, "released"), ("openai", "gpt-6-luna", 2, "released"),
                      ("anthropic", "claude-haiku-5-5", 3, "settled")]
    assert len(an.requests) == 1 and an.requests[0]["ledger_states"][-1] == "dispatched"
    luna_exposure = list(ledger.attempts.values())[0].reserved
    assert result.candidate.exposure_usd <= luna_exposure


def test_fallback_is_refused_when_the_budget_cannot_cover_it():
    ledger = FakeLedger()
    oa = Transport([status(429), status(429)], ledger=ledger)
    an = Transport([anthropic_ok()], ledger=ledger)
    c, *_ = caller(ledger, oa, an)
    ledger.deny_reason = None
    original = ledger.reserve

    def reserve(**kw):
        if kw["provider"] == "anthropic":
            ledger.deny_reason = "hotel_budget_exceeded"
        return original(**kw)

    ledger.reserve = reserve
    with pytest.raises(BudgetDenied):
        run(c)
    assert an.requests == []


@pytest.mark.parametrize("reply", [status(500), status(502), raise_exc(__import__("httpx2").ReadTimeout),
                                   raise_exc(__import__("httpx2").RemoteProtocolError)])
def test_uncertain_outcomes_keep_exposure_and_are_never_retried(reply):
    ledger = FakeLedger()
    oa = Transport([reply, openai_ok()], ledger=ledger)
    an = Transport([anthropic_ok()], ledger=ledger)
    c, *_ = caller(ledger, oa, an)
    with pytest.raises(ProviderOutcomeUncertain):
        run(c)
    assert len(oa.requests) == 1 and an.requests == []
    [a] = ledger.attempts.values()
    assert a.state == "uncertain" and ledger.open_exposure == a.reserved


def test_provably_unsent_failures_are_released_and_retried():
    import httpx2

    ledger = FakeLedger()
    oa = Transport([raise_exc(httpx2.ConnectError), openai_ok()], ledger=ledger)
    c, *_ = caller(ledger, oa)
    run(c)
    assert ledger.states() == ["released", "settled"]


@pytest.mark.parametrize("reply, kind", [(status(400), ErrorKind.INVALID_REQUEST),
                                         (status(401), ErrorKind.PROVIDER_AUTH_FAILED),
                                         (status(404), ErrorKind.UNSUPPORTED_MODEL)])
def test_non_retryable_rejections_release_and_stop(reply, kind):
    ledger = FakeLedger()
    oa = Transport([reply, openai_ok()], ledger=ledger)
    c, *_ = caller(ledger, oa)
    with pytest.raises(ProviderCallFailed) as exc:
        run(c)
    assert exc.value.kind is kind and ledger.states() == ["released"] and len(oa.requests) == 1


def test_missing_usage_is_unreconciled_and_exposure_retained():
    ledger = FakeLedger()
    c, *_ = caller(ledger, Transport([openai_ok(usage=None)], ledger=ledger))
    result = run(c)
    [a] = ledger.attempts.values()
    assert a.state == "unreconciled" and a.settlement.cost_cause == "usage_unreported"
    assert ledger.open_exposure == a.reserved and result.text is not None


def test_unknown_reported_model_is_never_priced_as_another_model():
    ledger = FakeLedger()
    c, *_ = caller(ledger, Transport([openai_ok(model="gpt-6-luna-preview")], ledger=ledger))
    run(c)
    [a] = ledger.attempts.values()
    assert a.state == "unreconciled" and a.settlement.cost_cause == "price_unknown"


def test_overrun_is_recorded_and_stops_spending():
    huge = {"input_tokens": 50_000, "output_tokens": 200_000, "total_tokens": 250_000,
            "input_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
            "output_tokens_details": {"reasoning_tokens": 0}}
    ledger = FakeLedger()
    c, *_ = caller(ledger, Transport([openai_ok(usage=huge)], ledger=ledger))
    with pytest.raises(SpendOverrun):
        run(c)
    [a] = ledger.attempts.values()
    assert a.state == "settled" and a.settled > a.reserved


def test_refusal_and_truncation_settle_at_cost_and_fail_without_retry():
    ledger = FakeLedger()
    oa = Transport([openai_ok(status="incomplete"), openai_ok()], ledger=ledger)
    c, *_ = caller(ledger, oa)
    with pytest.raises(ProviderCallFailed) as exc:
        run(c)
    assert exc.value.kind is ErrorKind.INCOMPLETE_OUTPUT and ledger.states() == ["settled"] and len(oa.requests) == 1


def test_call_limit_deadline_and_cancellation_stop_before_any_reservation():
    ledger = FakeLedger()
    c, *_ = caller(ledger, Transport([status(429), openai_ok()], ledger=ledger), max_model_calls=1)
    with pytest.raises(CallLimitExceeded):
        run(c)
    assert ledger.states() == ["released"]

    late = FakeLedger()
    c2, clock, _ = caller(late, Transport([openai_ok()], ledger=late), deadline=10.0)
    clock.now = 10.0
    with pytest.raises(PlanningDeadlineExceeded):
        run(c2)
    assert late.attempts == {}

    stopped = FakeLedger()
    c3, *_ = caller(stopped, Transport([openai_ok()], ledger=stopped))
    c3.before_attempt = lambda: "run_cancel_requested"
    with pytest.raises(PlanningBlocked) as exc:
        run(c3)
    assert exc.value.action == "cancel" and stopped.attempts == {}


def test_backoff_that_would_pass_the_deadline_stops_instead():
    ledger = FakeLedger()
    c, *_ = caller(ledger, Transport([status(429, retry_after="60"), openai_ok()], ledger=ledger), deadline=30.0)
    with pytest.raises(PlanningDeadlineExceeded):
        run(c)
    assert ledger.states() == ["released"]


def test_hard_timeout_and_in_flight_cancellation_are_uncertain(monkeypatch):
    class Hanging:
        provider = Provider.OPENAI

        async def send(self, request):
            await asyncio.sleep(3600)

    ledger = FakeLedger()
    c, *_ = caller(ledger, Transport([openai_ok()], ledger=ledger), per_call_timeout_seconds=0.05)
    c.adapters = {Provider.OPENAI: Hanging()}
    monkeypatch.setattr(boundary_mod, "HARD_TIMEOUT_MARGIN_SECONDS", 0.05)
    with pytest.raises(ProviderOutcomeUncertain):
        run(c)
    assert ledger.states() == ["uncertain"]

    ledger2 = FakeLedger()
    c2, *_ = caller(ledger2, Transport([openai_ok()], ledger=ledger2))
    c2.adapters = {Provider.OPENAI: Hanging()}

    async def cancel_mid_flight():
        task = asyncio.ensure_future(c2.call(workload=WorkloadClass.STRUCTURED_TOOL_PROPOSALS, system="s", messages=MSG,
                                             output=None, max_output_tokens=10))
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(cancel_mid_flight())
    [a] = ledger2.attempts.values()
    assert a.state == "uncertain" and a.settlement.error_code == "cancelled_in_flight"


def test_a_replayed_dispatched_attempt_is_never_sent_again():
    ledger = FakeLedger()
    oa = Transport([openai_ok()], ledger=ledger)
    c, *_ = caller(ledger, oa)
    run(c)
    c2, *_ = caller(ledger, oa)  # same run/step/step-attempt/turn -> same logical key, attempt 1 (already settled)
    with pytest.raises(ProviderOutcomeUncertain):
        run(c2)
    assert len(oa.requests) == 1


def test_oversized_or_unroutable_requests_never_reserve():
    ledger = FakeLedger()
    c, *_ = caller(ledger, Transport([openai_ok()], ledger=ledger))
    with pytest.raises(RoutingError):
        asyncio.run(c.call(workload=WorkloadClass.STRUCTURED_TOOL_PROPOSALS, system="x" * 70_000, messages=MSG,
                           output=None, max_output_tokens=500))
    with pytest.raises(RoutingError):
        asyncio.run(c.call(workload=WorkloadClass.STRUCTURED_TOOL_PROPOSALS, system="s", messages=MSG, output=None,
                           max_output_tokens=50_000))
    assert ledger.attempts == {}


def test_provider_without_an_adapter_is_skipped_not_called():
    ledger = FakeLedger()
    oa = Transport([status(429), status(429)], ledger=ledger)
    c, *_ = caller(ledger, oa)  # no anthropic adapter configured
    with pytest.raises(ProviderCallFailed) as exc:
        run(c)
    assert exc.value.retryable and {a.provider for a in ledger.attempts.values()} == {"openai"}


def test_logs_are_metadata_only(caplog):
    caplog.set_level(logging.INFO, logger="patelrep.agent_orchestrator")
    ledger = FakeLedger()
    c, *_ = caller(ledger, Transport([status(401), openai_ok(text='{"secret": "' + SECRET_CANARY + '"}')],
                                     ledger=ledger))
    with pytest.raises(ProviderCallFailed) as exc:
        run(c)
    text = caplog.text + repr(exc.value) + str(exc.value)
    assert SECRET_CANARY not in text and GUEST_CANARY not in text and "You plan." not in text
    assert "model_attempt" in caplog.text and "provider_auth_failed" in caplog.text

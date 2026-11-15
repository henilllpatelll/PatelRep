"""Shared fakes for H3 smoke tests: an in-memory spend ledger and instrumented provider transports.

The provider fakes are ``httpx2.MockTransport`` handlers (httpx2 is the transport both pinned SDKs use) plugged into the REAL ``AsyncOpenAI`` / ``AsyncAnthropic``
clients, so every request the SDKs would put on the wire is observed here. Each transport call records the ledger's
state at that instant, which is how tests prove "no network call before the reservation and dispatch marker commit".
The fake ledger mirrors the database's semantics (migration 245) closely enough for boundary logic; the real
semantics are tested against PostgreSQL in tests/integration/test_agent_orchestrator_ledger*.py.
"""
from __future__ import annotations

import itertools
import json
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Callable, Optional

import anthropic
import httpx2
import openai

from services.agent_orchestrator.budget_store import AttemptRef, DispatchResult, ReserveResult, Settlement, SettleResult
from services.agent_orchestrator.provider_anthropic import AnthropicMessagesAdapter
from services.agent_orchestrator.provider_openai import OpenAIResponsesAdapter

SECRET_CANARY = "sk-proj-CANARYcanary0123456789abcdefABCDEF"
GUEST_CANARY = "Guest Canary Smith"


@dataclass
class FakeAttempt:
    id: str
    key: str
    number: int
    provider: str
    model: str
    reserved: Decimal
    state: str = "reserved"
    settled: Optional[Decimal] = None
    settlement: Optional[Settlement] = None


@dataclass
class FakeLedger:
    limit: Decimal = Decimal("1000")
    deny_reason: Optional[str] = None
    dispatch_reason: Optional[str] = None
    attempts: dict[str, FakeAttempt] = field(default_factory=dict)
    log: list[tuple[str, str]] = field(default_factory=list)
    _ids: Any = field(default_factory=lambda: itertools.count(1))

    @property
    def open_exposure(self) -> Decimal:
        return sum((a.reserved for a in self.attempts.values()
                    if a.state in ("reserved", "dispatched", "uncertain", "unreconciled")), Decimal(0))

    @property
    def committed(self) -> Decimal:
        return sum((a.settled or Decimal(0) for a in self.attempts.values() if a.state == "settled"), Decimal(0))

    def reserve(self, **kw) -> ReserveResult:
        self.log.append(("reserve", kw["logical_call_key"]))
        for a in self.attempts.values():
            if a.key == kw["logical_call_key"] and a.number == kw["attempt_number"]:
                return ReserveResult(ok=True, attempt=AttemptRef(a.id, a.state, a.reserved, replayed=True))
        if self.deny_reason:
            return ReserveResult(ok=False, reason=self.deny_reason)
        exposure = kw["exposure_usd"]
        if self.open_exposure + self.committed + exposure > self.limit:
            return ReserveResult(ok=False, reason="hotel_budget_exceeded")
        attempt = FakeAttempt(id=f"att-{next(self._ids)}", key=kw["logical_call_key"], number=kw["attempt_number"],
                              provider=kw["provider"], model=kw["model"], reserved=exposure)
        self.attempts[attempt.id] = attempt
        return ReserveResult(ok=True, attempt=AttemptRef(attempt.id, "reserved", exposure))

    def dispatch(self, *, attempt_id: str, **_) -> DispatchResult:
        self.log.append(("dispatch", attempt_id))
        a = self.attempts[attempt_id]
        if self.dispatch_reason:
            a.state = "released"
            return DispatchResult(ok=False, reason=self.dispatch_reason, released=True)
        assert a.state == "reserved"
        a.state = "dispatched"
        return DispatchResult(ok=True)

    def release(self, *, attempt_id: str, **_) -> bool:
        self.attempts[attempt_id].state = "released"
        return True

    def settle(self, *, attempt_id: str, settlement: Settlement, **_) -> SettleResult:
        self.log.append(("settle:" + settlement.outcome, attempt_id))
        a = self.attempts[attempt_id]
        if a.state not in ("dispatched", "uncertain"):
            return SettleResult(ok=False, reason="already_settled", state=a.state)
        a.settlement = settlement
        if settlement.outcome == "settled":
            a.state, a.settled = "settled", settlement.cost_usd
        elif settlement.outcome == "released":
            a.state, a.settled = "released", Decimal(0)
        else:
            a.state = settlement.outcome
        return SettleResult(ok=True, state=a.state, overrun=a.state == "settled" and a.settled > a.reserved)

    def states(self) -> list[str]:
        return [a.state for a in self.attempts.values()]


@dataclass
class Transport:
    """Records every HTTP request with the ledger states at that moment; replies from a scripted queue."""

    replies: list[Callable[[httpx2.Request], httpx2.Response]]
    ledger: Optional[FakeLedger] = None
    requests: list[dict] = field(default_factory=list)

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content) if request.content else {}
        self.requests.append({"url": str(request.url), "body": body,
                              "ledger_states": self.ledger.states() if self.ledger else None,
                              "headers": dict(request.headers)})
        reply = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        return reply(request)


def openai_client(transport: Transport, *, retries: int = 0) -> openai.AsyncOpenAI:
    return openai.AsyncOpenAI(api_key="test-key", max_retries=retries,
                              http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(transport.handler)))


def anthropic_client(transport: Transport, *, retries: int = 0) -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(api_key="test-key", max_retries=retries,
                                    http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(transport.handler)))


def adapters(oa: Transport, an: Optional[Transport] = None) -> dict:
    from services.agent_harness.metering import Provider

    result = {Provider.OPENAI: OpenAIResponsesAdapter(openai_client(oa))}
    if an is not None:
        result[Provider.ANTHROPIC] = AnthropicMessagesAdapter(anthropic_client(an))
    return result


def openai_ok(text: str = '{"ok": true}', *, usage: Any = "default", model: str = "gpt-6-luna",
              status: str = "completed", tier: Optional[str] = "default", refusal: bool = False):
    if usage == "default":
        usage = {"input_tokens": 1200, "output_tokens": 150, "total_tokens": 1350,
                 "input_tokens_details": {"cached_tokens": 200, "cache_write_tokens": 0},
                 "output_tokens_details": {"reasoning_tokens": 40}}
    content = [{"type": "refusal", "refusal": "no"}] if refusal else [
        {"type": "output_text", "text": text, "annotations": []}]
    body = {"id": "resp_test123", "object": "response", "created_at": 1, "model": model, "status": status,
            "output": [{"type": "message", "id": "msg_1", "role": "assistant", "status": "completed",
                        "content": content}],
            "usage": usage, "service_tier": tier, "parallel_tool_calls": False, "tool_choice": "auto", "tools": []}
    if status == "incomplete":
        body["incomplete_details"] = {"reason": "max_output_tokens"}
    return lambda request: httpx2.Response(200, json=body, headers={"x-request-id": "req_openai_1"})


def anthropic_ok(text: str = '{"ok": true}', *, usage: Any = "default", model: str = "claude-haiku-5-5",
                 stop: str = "end_turn"):
    if usage == "default":
        usage = {"input_tokens": 900, "output_tokens": 120, "cache_read_input_tokens": 100,
                 "cache_creation_input_tokens": 0, "service_tier": "standard"}
    body = {"id": "msg_test456", "type": "message", "role": "assistant", "model": model,
            "content": [{"type": "thinking", "thinking": "", "signature": "sig"}, {"type": "text", "text": text}],
            "stop_reason": stop, "stop_sequence": None, "usage": usage}
    return lambda request: httpx2.Response(200, json=body, headers={"request-id": "req_anthropic_1"})


def status(code: int, *, retry_after: Optional[str] = None, leak: bool = True):
    body = {"error": {"type": "error", "message": f"bad key {SECRET_CANARY} for {GUEST_CANARY}"}} if leak else {}
    headers = {"retry-after": retry_after} if retry_after else {}
    return lambda request: httpx2.Response(code, json=body, headers=headers)


def raise_exc(exc_type: type):
    def reply(request: httpx2.Request) -> httpx2.Response:
        raise exc_type(f"transport failure {SECRET_CANARY}", request=request)
    return reply

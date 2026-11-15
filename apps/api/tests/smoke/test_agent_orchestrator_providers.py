"""H3 native provider adapters through the REAL OpenAI / Anthropic SDK clients on instrumented fake transports."""
from __future__ import annotations

import asyncio

import httpx
import httpx2
import pytest

from services.agent_harness.metering import Provider
from services.agent_harness.provider_usage import UsageStatus
from services.agent_orchestrator.errors import ConfigurationError, ErrorKind
from services.agent_orchestrator.provider_anthropic import AnthropicMessagesAdapter
from services.agent_orchestrator.provider_openai import OpenAIResponsesAdapter
from services.agent_orchestrator.providers import (
    ChatMessage,
    DispatchState,
    ProviderRequest,
    StructuredOutputSpec,
    classify_status,
)
from tests.smoke.agent_orchestrator_support import (
    GUEST_CANARY,
    SECRET_CANARY,
    Transport,
    anthropic_client,
    anthropic_ok,
    openai_client,
    openai_ok,
    raise_exc,
    status,
)

SCHEMA = {"type": "object", "additionalProperties": False, "properties": {"ok": {"type": "boolean"}},
          "required": ["ok"]}


def req(model="gpt-6-luna"):
    return ProviderRequest(model=model, system="You plan.", messages=(ChatMessage("user", "Plan WO 1."),),
                           output=StructuredOutputSpec("plan", SCHEMA), max_output_tokens=500, timeout_seconds=12.5,
                           reasoning_effort="low")


def send(adapter, request):
    return asyncio.run(adapter.send(request))


# --- request construction --------------------------------------------------------------------------------------------

def test_openai_request_is_standard_tier_unstored_uncached_and_strict():
    t = Transport([openai_ok()])
    out = send(OpenAIResponsesAdapter(openai_client(t)), req())
    [sent] = t.requests
    body = sent["body"]
    assert sent["url"].endswith("/responses")
    assert body["service_tier"] == "default" and body["store"] is False
    assert body["prompt_cache_options"] == {"mode": "explicit"}
    assert body["max_output_tokens"] == 500 and body["reasoning"] == {"effort": "low"}
    assert body["text"]["format"] == {"type": "json_schema", "name": "plan", "schema": SCHEMA, "strict": True}
    assert "tools" not in body and "previous_response_id" not in body
    assert out.error is None and out.text == '{"ok": true}' and out.finish == "completed"


def test_anthropic_request_is_standard_only_uncached_and_structured():
    t = Transport([anthropic_ok()])
    out = send(AnthropicMessagesAdapter(anthropic_client(t)), req("claude-haiku-5-5"))
    body = t.requests[0]["body"]
    assert body["service_tier"] == "standard_only" and "inference_geo" not in body
    assert body["output_config"] == {"format": {"type": "json_schema", "schema": SCHEMA}, "effort": "low"}
    assert "cache_control" not in str(body) and "tools" not in body and body["max_tokens"] == 500
    assert out.text == '{"ok": true}'  # thinking blocks are dropped, never returned


@pytest.mark.parametrize("factory", [openai_client, anthropic_client])
def test_clients_with_sdk_retries_enabled_are_refused(factory):
    adapter_cls = OpenAIResponsesAdapter if factory is openai_client else AnthropicMessagesAdapter
    with pytest.raises(ConfigurationError) as exc:
        adapter_cls(factory(Transport([openai_ok()]), retries=2))
    assert exc.value.code == "provider_client_retries_enabled"


# --- usage and identifiers ---------------------------------------------------------------------------------------------

def test_openai_usage_ids_and_model_come_from_the_native_response():
    out = send(OpenAIResponsesAdapter(openai_client(Transport([openai_ok()]))), req())
    u = out.usage
    assert u.status is UsageStatus.REPORTED and (u.uncached_input, u.cache_read, u.output, u.reasoning) == (1000, 200, 150, 40)
    assert (out.reported_model, out.request_id, out.response_id) == ("gpt-6-luna", "req_openai_1", "resp_test123")


def test_anthropic_cache_tokens_are_added_not_subtracted():
    out = send(AnthropicMessagesAdapter(anthropic_client(Transport([anthropic_ok()]))), req("claude-haiku-5-5"))
    assert (out.usage.uncached_input, out.usage.cache_read, out.usage.prompt_tokens) == (900, 100, 1000)
    assert (out.request_id, out.response_id) == ("req_anthropic_1", "msg_test456")


def test_missing_usage_is_unreported_not_zero():
    out = send(OpenAIResponsesAdapter(openai_client(Transport([openai_ok(usage=None)]))), req())
    assert out.error is None and out.usage.status is UsageStatus.UNREPORTED and out.usage.output is None


def test_refusal_and_truncation_are_completed_but_not_successful():
    refused = send(OpenAIResponsesAdapter(openai_client(Transport([openai_ok(refusal=True)]))), req())
    assert refused.error.kind is ErrorKind.MODEL_REFUSED and refused.dispatch is DispatchState.COMPLETED
    cut = send(AnthropicMessagesAdapter(anthropic_client(Transport([anthropic_ok(stop="max_tokens")]))),
               req("claude-haiku-5-5"))
    assert cut.error.kind is ErrorKind.INCOMPLETE_OUTPUT and cut.usage.status is UsageStatus.REPORTED


def test_unsafe_identifiers_are_dropped():
    bad = openai_ok(model="gpt-6-luna; DROP TABLE")
    out = send(OpenAIResponsesAdapter(openai_client(Transport([bad]))), req())
    assert out.reported_model is None


# --- error classification ----------------------------------------------------------------------------------------------

@pytest.mark.parametrize("code, kind, dispatch, retryable", [
    (400, ErrorKind.INVALID_REQUEST, DispatchState.REJECTED_NO_CHARGE, False),
    (401, ErrorKind.PROVIDER_AUTH_FAILED, DispatchState.REJECTED_NO_CHARGE, False),
    (404, ErrorKind.UNSUPPORTED_MODEL, DispatchState.REJECTED_NO_CHARGE, False),
    (429, ErrorKind.RATE_LIMITED, DispatchState.REJECTED_NO_CHARGE, True),
    (503, ErrorKind.SERVICE_UNAVAILABLE, DispatchState.REJECTED_NO_CHARGE, True),
    (529, ErrorKind.SERVICE_UNAVAILABLE, DispatchState.REJECTED_NO_CHARGE, True),
    (500, ErrorKind.PROVIDER_ERROR_UNCERTAIN, DispatchState.UNCERTAIN, False),
    (502, ErrorKind.PROVIDER_ERROR_UNCERTAIN, DispatchState.UNCERTAIN, False),
    (504, ErrorKind.PROVIDER_ERROR_UNCERTAIN, DispatchState.UNCERTAIN, False),
])
@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_http_status_classification_and_single_attempt(code, kind, dispatch, retryable, provider):
    t = Transport([status(code, retry_after="2")])
    if provider == "openai":
        out = send(OpenAIResponsesAdapter(openai_client(t)), req())
    else:
        out = send(AnthropicMessagesAdapter(anthropic_client(t)), req("claude-haiku-5-5"))
    assert (out.error.kind, out.error.dispatch, out.error.retryable) == (kind, dispatch, retryable)
    assert out.error.http_status == code and len(t.requests) == 1  # no hidden SDK retry
    assert out.usage is None
    assert SECRET_CANARY not in repr(out) and GUEST_CANARY not in repr(out)


@pytest.mark.parametrize("exc_type, kind, dispatch", [
    (httpx2.ConnectError, ErrorKind.NETWORK_FAILURE, DispatchState.NOT_DISPATCHED),
    (httpx2.ConnectTimeout, ErrorKind.TIMEOUT_BEFORE_DISPATCH, DispatchState.NOT_DISPATCHED),
    (httpx2.ReadTimeout, ErrorKind.TIMEOUT_AFTER_DISPATCH, DispatchState.UNCERTAIN),
    (httpx2.WriteTimeout, ErrorKind.TIMEOUT_AFTER_DISPATCH, DispatchState.UNCERTAIN),
    (httpx2.RemoteProtocolError, ErrorKind.PROVIDER_ERROR_UNCERTAIN, DispatchState.UNCERTAIN),
    (httpx2.ReadError, ErrorKind.PROVIDER_ERROR_UNCERTAIN, DispatchState.UNCERTAIN),
])
@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_transport_failures_are_unsent_only_when_provably_unsent(exc_type, kind, dispatch, provider):
    t = Transport([raise_exc(exc_type)])
    adapter = (OpenAIResponsesAdapter(openai_client(t)) if provider == "openai"
               else AnthropicMessagesAdapter(anthropic_client(t)))
    out = send(adapter, req("gpt-6-luna" if provider == "openai" else "claude-haiku-5-5"))
    assert (out.error.kind, out.error.dispatch) == (kind, dispatch) and len(t.requests) == 1
    assert SECRET_CANARY not in repr(out)


@pytest.mark.parametrize("make, dispatch", [
    (lambda: httpx.ConnectError("x"), DispatchState.NOT_DISPATCHED),
    (lambda: httpx2.ConnectError("x"), DispatchState.NOT_DISPATCHED),
    (lambda: httpx.ReadTimeout("x"), DispatchState.UNCERTAIN),
    (lambda: httpx2.ReadTimeout("x"), DispatchState.UNCERTAIN),
    (lambda: ValueError("x"), DispatchState.UNCERTAIN),
])
def test_both_transport_families_classify_identically(make, dispatch):
    from services.agent_orchestrator.providers import classify_transport

    wrapped = RuntimeError("sdk wrapper")
    wrapped.__cause__ = make()
    assert classify_transport(wrapped).dispatch is dispatch
    unrelated = RuntimeError("later failure")
    unrelated.__context__ = httpx2.ConnectError("earlier, unrelated")  # implicit context never proves "unsent"
    assert classify_transport(unrelated).dispatch is DispatchState.UNCERTAIN


def test_unlisted_statuses_fail_safe():
    assert classify_status(418)[1] is DispatchState.REJECTED_NO_CHARGE
    assert classify_status(599)[1] is DispatchState.UNCERTAIN
    assert classify_status(None)[1] is DispatchState.UNCERTAIN


def test_malformed_success_body_is_completed_with_unknown_cost():
    t = Transport([lambda request: httpx2.Response(200, content=b"not json", headers={"content-type": "text/plain"})])
    out = send(AnthropicMessagesAdapter(anthropic_client(t)), req("claude-haiku-5-5"))
    assert out.error is not None and out.dispatch in (DispatchState.COMPLETED, DispatchState.UNCERTAIN)
    assert out.usage is None or out.usage.status is not UsageStatus.REPORTED
    assert Provider.ANTHROPIC is out.provider

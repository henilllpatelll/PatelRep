"""Native Anthropic Messages API adapter (``AsyncAnthropic.messages.create``).

* The client must be built with ``max_retries=0`` (enforced); the per-request timeout is explicit.
* ``service_tier="standard_only"`` (never priority capacity) and no ``inference_geo`` (global routing, standard price);
  no ``cache_control`` anywhere, so no cache write is requested.
* Structured output via ``output_config.format`` (json_schema); optional ``output_config.effort``.
* ``usage.input_tokens`` EXCLUDES cache reads/writes; ``normalize_anthropic_usage`` adds the categories. Thinking blocks
  are ignored (never returned, stored or logged); their tokens are inside ``output_tokens`` and bounded by
  ``max_tokens``.
"""
from __future__ import annotations

from typing import Any

import anthropic

from services.agent_harness.metering import Provider
from services.agent_harness.provider_usage import normalize_anthropic_usage
from services.agent_orchestrator.errors import ConfigurationError, ErrorKind
from services.agent_orchestrator.providers import (
    DispatchState,
    ProviderError,
    ProviderOutcome,
    ProviderRequest,
    classify_sdk_exception,
    safe_id,
    safe_model,
)

_FINISH = {"end_turn": "completed", "stop_sequence": "completed", "max_tokens": "incomplete", "refusal": "refusal"}


class AnthropicMessagesAdapter:
    provider = Provider.ANTHROPIC

    def __init__(self, client: Any) -> None:
        if getattr(client, "max_retries", None) != 0:
            raise ConfigurationError("provider_client_retries_enabled")
        self._client = client

    def build_params(self, req: ProviderRequest) -> dict:
        params: dict = {
            "model": req.model,
            "max_tokens": req.max_output_tokens,
            "system": req.system,
            "messages": [{"role": m.role, "content": m.text} for m in req.messages],
            "service_tier": "standard_only",
            "timeout": req.timeout_seconds,
        }
        output_config: dict = {}
        if req.output is not None:
            output_config["format"] = {"type": "json_schema", "schema": dict(req.output.schema)}
        if req.reasoning_effort:
            output_config["effort"] = req.reasoning_effort
        if output_config:
            params["output_config"] = output_config
        return params

    async def send(self, req: ProviderRequest) -> ProviderOutcome:
        try:
            message = await self._client.messages.create(**self.build_params(req))
        except Exception as exc:  # classified by type only; the message is never read
            return ProviderOutcome(provider=self.provider, requested_model=req.model, error=classify_sdk_exception(
                exc, status_error=anthropic.APIStatusError, connection_error=anthropic.APIConnectionError,
                validation_error=anthropic.APIResponseValidationError))
        raw = getattr(message, "usage", None)
        try:
            raw_usage = raw.model_dump(mode="python") if raw is not None else None
        except Exception:
            raw_usage = []  # malformed, never zero
        usage = normalize_anthropic_usage(raw_usage, requested_standard_only=True)  # type: ignore[arg-type]
        finish = _FINISH.get(getattr(message, "stop_reason", None), "failed")
        text = None
        if finish == "completed":
            parts = [getattr(b, "text", "") for b in (getattr(message, "content", None) or [])
                     if getattr(b, "type", None) == "text"]
            text = "".join(p for p in parts if isinstance(p, str))
        error = None
        if finish != "completed":
            kind = {"refusal": ErrorKind.MODEL_REFUSED, "incomplete": ErrorKind.INCOMPLETE_OUTPUT}.get(
                finish, ErrorKind.MALFORMED_RESPONSE)
            error = ProviderError(kind, DispatchState.COMPLETED, False)
        return ProviderOutcome(
            provider=self.provider, requested_model=req.model, error=error, text=text, usage=usage,
            reported_model=safe_model(getattr(message, "model", None)),
            request_id=safe_id(getattr(message, "_request_id", None)),
            response_id=safe_id(getattr(message, "id", None)), finish=finish)

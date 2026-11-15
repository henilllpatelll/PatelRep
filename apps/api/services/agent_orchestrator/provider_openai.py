"""Native OpenAI Responses API adapter (``AsyncOpenAI.responses.create``).

* The client must be built with ``max_retries=0`` (enforced): retries happen only in the H3 boundary, each with its own
  reservation. The per-request timeout is passed explicitly.
* ``service_tier="default"`` (standard pricing), ``store=False`` (OpenAI does not retain the response for later
  retrieval) and ``prompt_cache_options={"mode": "explicit"}`` with no breakpoints, so no cache write is requested.
* Structured output via ``text.format`` json_schema with ``strict: true``.
* Usage comes from the native response and is normalised by ``normalize_openai_usage``; the reported model, request id
  and response id are kept only if they look like identifiers. Output text is returned to the caller and never logged.
"""
from __future__ import annotations

from typing import Any

import openai

from services.agent_harness.metering import Provider
from services.agent_harness.provider_usage import normalize_openai_usage
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

REQUESTED_SERVICE_TIER = "default"


def _usage_dict(usage: Any) -> Any:
    if usage is None:
        return None
    try:
        return usage.model_dump(mode="python", exclude_none=False)
    except Exception:  # an unexpected shape is "malformed", never zero
        return "malformed"


class OpenAIResponsesAdapter:
    provider = Provider.OPENAI

    def __init__(self, client: Any) -> None:
        if getattr(client, "max_retries", None) != 0:
            raise ConfigurationError("provider_client_retries_enabled")
        self._client = client

    def build_params(self, req: ProviderRequest) -> dict:
        params: dict = {
            "model": req.model,
            "instructions": req.system,
            "input": [{"role": m.role, "content": m.text} for m in req.messages],
            "max_output_tokens": req.max_output_tokens,
            "service_tier": REQUESTED_SERVICE_TIER,
            "store": False,
            "prompt_cache_options": {"mode": "explicit"},
            "timeout": req.timeout_seconds,
        }
        if req.output is not None:
            params["text"] = {"format": {"type": "json_schema", "name": req.output.name,
                                         "schema": dict(req.output.schema), "strict": True}}
        if req.reasoning_effort:
            params["reasoning"] = {"effort": req.reasoning_effort}
        return params

    async def send(self, req: ProviderRequest) -> ProviderOutcome:
        try:
            response = await self._client.responses.create(**self.build_params(req))
        except Exception as exc:  # classified by type only; the message is never read
            return ProviderOutcome(provider=self.provider, requested_model=req.model, error=classify_sdk_exception(
                exc, status_error=openai.APIStatusError, connection_error=openai.APIConnectionError,
                validation_error=openai.APIResponseValidationError))
        raw_usage = _usage_dict(getattr(response, "usage", None))
        usage = normalize_openai_usage(raw_usage if raw_usage != "malformed" else [],  # type: ignore[arg-type]
                                       service_tier=getattr(response, "service_tier", None),
                                       requested_service_tier=REQUESTED_SERVICE_TIER)
        status = getattr(response, "status", None)
        refusal = any(getattr(part, "type", None) == "refusal"
                      for item in (getattr(response, "output", None) or [])
                      for part in (getattr(item, "content", None) or []))
        if refusal:
            finish = "refusal"
        elif status == "completed":
            finish = "completed"
        elif status == "incomplete":
            finish = "incomplete"
        else:
            finish = "failed"
        try:
            text = response.output_text if finish == "completed" else None
        except Exception:
            text = None
        error = None
        if finish != "completed":
            kind = {"refusal": ErrorKind.MODEL_REFUSED, "incomplete": ErrorKind.INCOMPLETE_OUTPUT}.get(
                finish, ErrorKind.MALFORMED_RESPONSE)
            error = ProviderError(kind, DispatchState.COMPLETED, False)
        return ProviderOutcome(
            provider=self.provider, requested_model=req.model, error=error, text=text, usage=usage,
            reported_model=safe_model(getattr(response, "model", None)),
            request_id=safe_id(getattr(response, "_request_id", None)),
            response_id=safe_id(getattr(response, "id", None)), finish=finish)

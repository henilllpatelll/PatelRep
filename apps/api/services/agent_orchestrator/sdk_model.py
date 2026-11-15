"""OpenAI Agents SDK integration: a budgeted ``Model``, a refusing ``ModelProvider`` and tracing switched OFF.

* ``BudgetedModel.get_response`` is the ONLY way the SDK can reach a model, and it always goes through
  ``BudgetedCaller.call`` (reserve -> dispatch -> provider -> settle). Every runner turn, and any runner-managed retry,
  is therefore its own reserved attempt. ``stream_response`` is refused.
* No SDK tool, handoff, hosted tool, MCP server, stored conversation or prompt object is accepted: a model proposal is
  data, never an executable SDK function (H2 stays the only operational execution path).
* ``RefusingModelProvider`` makes the SDK unable to construct its own OpenAI client by model name.
* Tracing: disabled globally (``set_tracing_disabled``), the default exporter removed (``set_trace_processors([])``) and
  disabled per run with ``trace_include_sensitive_data=False`` -- the SDK's own default for that flag is TRUE.
* ``ModelResponse.usage`` is informational only (request count); money comes from the native provider response inside
  the boundary, never from SDK ``Usage`` (which zero-fills missing usage).
"""
from __future__ import annotations

import itertools
import re
from typing import Any, AsyncIterator, Optional

from agents import ModelSettings, RunConfig, set_trace_processors, set_tracing_disabled
from agents.items import ModelResponse
from agents.models.interface import Model, ModelProvider, ModelTracing
from agents.retry import ModelRetrySettings
from agents.usage import Usage
from openai.types.responses import ResponseOutputMessage, ResponseOutputText

from services.agent_harness.metering import Provider
from services.agent_orchestrator.boundary import BudgetedCaller
from services.agent_orchestrator.catalog import WorkloadClass
from services.agent_orchestrator.errors import ConfigurationError, InvalidModelRequest
from services.agent_orchestrator.providers import ChatMessage, StructuredOutputSpec

_NAME_RE = re.compile(r"[^A-Za-z0-9_-]")
_ids = itertools.count(1)


def disable_sdk_tracing() -> None:
    """Idempotent. Called at import and again before every planning run."""
    set_tracing_disabled(True)
    set_trace_processors([])


disable_sdk_tracing()


class RefusingModelProvider(ModelProvider):
    """The SDK may never look a model up by name (that would build an unbudgeted OpenAI client)."""

    def get_model(self, model_name: Optional[str]) -> Model:
        raise ConfigurationError("sdk_model_lookup_refused")


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and part.get("type") in ("input_text", "output_text") \
                    and isinstance(part.get("text"), str):
                parts.append(part["text"])
            else:
                raise InvalidModelRequest("unsupported_input_content")
        return "".join(parts)
    raise InvalidModelRequest("unsupported_input_content")


def convert_input(value: Any) -> tuple[ChatMessage, ...]:
    """SDK input items -> plain user/assistant text messages. Anything else (tool calls, reasoning items, system or
    developer messages, files, images) is refused rather than silently forwarded."""
    if isinstance(value, str):
        return (ChatMessage("user", value),)
    messages = []
    for item in value or []:
        if hasattr(item, "model_dump"):
            item = item.model_dump(mode="json", exclude_none=True)
        if not isinstance(item, dict) or item.get("type", "message") != "message":
            raise InvalidModelRequest("unsupported_input_item")
        role = item.get("role")
        if role not in ("user", "assistant"):
            raise InvalidModelRequest("unsupported_input_role")
        messages.append(ChatMessage(role, _text_of(item.get("content"))))
    if not messages:
        raise InvalidModelRequest("empty_input")
    return tuple(messages)


class BudgetedModel(Model):
    def __init__(self, caller: BudgetedCaller, *, workload: WorkloadClass, max_output_tokens: int,
                 override: Optional[tuple[Provider, str]] = None) -> None:
        self._caller = caller
        self._workload = workload
        self._max_output_tokens = max_output_tokens
        self._override = override
        self.last_text: Optional[str] = None

    async def get_response(self, system_instructions, input, model_settings, tools, output_schema, handoffs, tracing,
                           *, previous_response_id=None, conversation_id=None, prompt=None) -> ModelResponse:
        if tools or handoffs:
            raise InvalidModelRequest("sdk_tools_not_allowed")
        if previous_response_id or conversation_id or prompt:
            raise InvalidModelRequest("stateful_request_not_allowed")
        if output_schema is None or output_schema.is_plain_text() or not output_schema.is_strict_json_schema():
            raise InvalidModelRequest("strict_structured_output_required")
        requested = getattr(model_settings, "max_tokens", None)
        max_out = min(requested, self._max_output_tokens) if isinstance(requested, int) and requested > 0 \
            else self._max_output_tokens
        name = _NAME_RE.sub("_", output_schema.name())[:64] or "plan"
        result = await self._caller.call(
            workload=self._workload, system=system_instructions or "", messages=convert_input(input),
            output=StructuredOutputSpec(name=name, schema=output_schema.json_schema()),
            max_output_tokens=max_out, override=self._override)
        self.last_text = result.text
        message = ResponseOutputMessage(
            id=f"msg_h3_{next(_ids)}", role="assistant", status="completed", type="message",
            content=[ResponseOutputText(type="output_text", text=result.text or "", annotations=[])])
        return ModelResponse(output=[message], usage=Usage(requests=1), response_id=None, request_id=None)

    def stream_response(self, system_instructions, input, model_settings, tools, output_schema, handoffs,
                        tracing: ModelTracing, *, previous_response_id=None, conversation_id=None,
                        prompt=None) -> AsyncIterator[Any]:
        raise InvalidModelRequest("streaming_not_allowed")


def planning_run_config(*, max_output_tokens: int) -> RunConfig:
    disable_sdk_tracing()
    return RunConfig(
        model_provider=RefusingModelProvider(),
        model_settings=ModelSettings(max_tokens=max_output_tokens, retry=ModelRetrySettings(max_retries=0)),
        tracing_disabled=True,
        trace_include_sensitive_data=False,
        workflow_name="patelrep_h3_planning",
    )

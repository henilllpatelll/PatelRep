"""The ONLY module in H3 that reads provider credentials.

Keys come from the API's trusted server settings (``core.config.settings``), are handed straight to the provider SDK
constructors and are never placed in prompts, plans, tool arguments, ledger rows, model-visible metadata, traces, logs
or errors. Clients are built with ``max_retries=0`` and explicit timeouts. Local (Ollama) providers are refused: H3
meters only billable providers. Nothing is constructed unless the paid-call process gate is open.
"""
from __future__ import annotations

from typing import Mapping

import anthropic
import httpx2
import openai

from services.agent_harness.metering import Provider
from services.agent_orchestrator.config import OrchestratorSettings, paid_calls_allowed
from services.agent_orchestrator.errors import ConfigurationError
from services.agent_orchestrator.provider_anthropic import AnthropicMessagesAdapter
from services.agent_orchestrator.provider_openai import OpenAIResponsesAdapter
from services.agent_orchestrator.providers import ProviderAdapter

CONNECT_TIMEOUT_SECONDS = 5.0
DEFAULT_TIMEOUT_SECONDS = 60.0


def build_live_adapters(*, app_env: str, settings: OrchestratorSettings) -> Mapping[Provider, ProviderAdapter]:
    if not paid_calls_allowed(app_env=app_env, settings=settings):
        raise ConfigurationError("paid_calls_disabled")
    from core.config import settings as api_settings  # deferred: credentials are read only here, only when allowed

    if api_settings.ai_provider.strip().lower() != "hosted":
        raise ConfigurationError("hosted_provider_required")
    # Both pinned SDKs run on httpx2 (anthropic rejects classic httpx objects outright).
    timeout = httpx2.Timeout(DEFAULT_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS)
    adapters: dict[Provider, ProviderAdapter] = {}
    if api_settings.openai_api_key:
        adapters[Provider.OPENAI] = OpenAIResponsesAdapter(
            openai.AsyncOpenAI(api_key=api_settings.openai_api_key, max_retries=0, timeout=timeout))
    if api_settings.anthropic_api_key:
        adapters[Provider.ANTHROPIC] = AnthropicMessagesAdapter(
            anthropic.AsyncAnthropic(api_key=api_settings.anthropic_api_key, max_retries=0, timeout=timeout))
    if not adapters:
        raise ConfigurationError("provider_credentials_missing")
    return adapters

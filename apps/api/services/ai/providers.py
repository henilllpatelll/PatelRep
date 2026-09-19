import anthropic
from openai import OpenAI
from types import SimpleNamespace
from typing import Any
from urllib.parse import urlparse

from core.config import settings


class AIProviderConfigurationError(RuntimeError):
    """Raised when an AI feature is requested without its provider credentials."""


def _provider_name() -> str:
    provider = settings.ai_provider.strip().lower()
    if provider not in {"hosted", "ollama"}:
        raise AIProviderConfigurationError("AI provider is not configured")
    return provider


def _ollama_base_url() -> str:
    base_url = settings.ollama_base_url.rstrip("/")
    parsed = urlparse(base_url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise AIProviderConfigurationError("Ollama must use a loopback HTTP URL")
    return base_url


class _OllamaEndpoint:
    def __init__(self, endpoint: Any, model: str, disable_thinking: bool = False):
        self._endpoint = endpoint
        self._model = model
        self._disable_thinking = disable_thinking

    def create(self, **kwargs: Any) -> Any:
        kwargs["model"] = self._model
        if self._disable_thinking:
            kwargs["extra_body"] = {**kwargs.get("extra_body", {}), "think": False}
        return self._endpoint.create(**kwargs)


class _OllamaOpenAIClient:
    def __init__(self, base_url: str):
        self._client = OpenAI(base_url=f"{base_url}/v1", api_key="ollama")
        self.chat = SimpleNamespace(
            completions=_OllamaEndpoint(
                self._client.chat.completions,
                settings.ollama_model,
                settings.ollama_disable_thinking,
            )
        )
        self.embeddings = _OllamaEndpoint(self._client.embeddings, settings.ollama_embedding_model)


class _OllamaAnthropicClient:
    def __init__(self, base_url: str):
        self._client = anthropic.Anthropic(base_url=base_url, api_key="ollama")
        self.messages = _OllamaEndpoint(
            self._client.messages,
            settings.ollama_model,
            settings.ollama_disable_thinking,
        )


def get_openai_client() -> Any:
    if _provider_name() == "ollama":
        return _OllamaOpenAIClient(_ollama_base_url())
    if not settings.openai_api_key:
        raise AIProviderConfigurationError("AI provider is not configured")
    return OpenAI(api_key=settings.openai_api_key)


def get_anthropic_client() -> Any:
    if _provider_name() == "ollama":
        return _OllamaAnthropicClient(_ollama_base_url())
    if not settings.anthropic_api_key:
        raise AIProviderConfigurationError("AI provider is not configured")
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)

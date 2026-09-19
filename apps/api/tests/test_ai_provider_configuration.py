import importlib

import pytest

from core.config import settings


def test_ai_provider_modules_import_without_credentials(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")
    monkeypatch.setattr(settings, "anthropic_api_key", "")

    module_names = [
        "services.ai.task_parser",
        "services.ai.work_order_parser",
        "services.ai.guest_request_parser",
        "services.ai.assignment_parser",
        "services.ai.sop_rag",
        "services.ai.insights",
        "services.ai.housekeeping_briefing",
        "services.ai.failure_predictions",
    ]

    for module_name in module_names:
        importlib.reload(importlib.import_module(module_name))


def test_missing_openai_key_returns_safe_configuration_error(monkeypatch):
    from services.ai.providers import AIProviderConfigurationError, get_openai_client

    monkeypatch.setattr(settings, "ai_provider", "hosted")
    monkeypatch.setattr(settings, "openai_api_key", "")

    with pytest.raises(AIProviderConfigurationError, match="AI provider is not configured"):
        get_openai_client()


def test_missing_anthropic_key_returns_safe_configuration_error(monkeypatch):
    from services.ai.providers import AIProviderConfigurationError, get_anthropic_client

    monkeypatch.setattr(settings, "ai_provider", "hosted")
    monkeypatch.setattr(settings, "anthropic_api_key", "")

    with pytest.raises(AIProviderConfigurationError, match="AI provider is not configured"):
        get_anthropic_client()


def test_ollama_uses_local_compatibility_clients_without_hosted_api_keys(monkeypatch):
    from services.ai.providers import get_anthropic_client, get_openai_client

    monkeypatch.setattr(settings, "ai_provider", "ollama", raising=False)
    monkeypatch.setattr(settings, "ollama_base_url", "http://127.0.0.1:11434", raising=False)
    monkeypatch.setattr(settings, "ollama_model", "qwen3.8:latest", raising=False)
    monkeypatch.setattr(settings, "ollama_embedding_model", "nomic-embed-text", raising=False)
    monkeypatch.setattr(settings, "openai_api_key", "")
    monkeypatch.setattr(settings, "anthropic_api_key", "")

    assert str(get_openai_client()._client.base_url) == "http://127.0.0.1:11434/v1/"
    assert str(get_anthropic_client()._client.base_url).rstrip("/") == "http://127.0.0.1:11434"


def test_ollama_rejects_non_loopback_provider_urls(monkeypatch):
    from services.ai.providers import AIProviderConfigurationError, get_openai_client

    monkeypatch.setattr(settings, "ai_provider", "ollama", raising=False)
    monkeypatch.setattr(settings, "ollama_base_url", "https://untrusted.example", raising=False)

    with pytest.raises(AIProviderConfigurationError, match="loopback"):
        get_openai_client()


def test_ollama_endpoint_uses_the_configured_model_and_disables_thinking():
    from services.ai.providers import _OllamaEndpoint

    class RecordingEndpoint:
        def __init__(self):
            self.kwargs = None

        def create(self, **kwargs):
            self.kwargs = kwargs
            return "ok"

    endpoint = RecordingEndpoint()
    wrapped = _OllamaEndpoint(endpoint, "deepseek-r1:1.5b", disable_thinking=True)

    assert wrapped.create(model="hosted-model", extra_body={"custom": "value"}) == "ok"
    assert endpoint.kwargs == {
        "model": "deepseek-r1:1.5b",
        "extra_body": {"custom": "value", "think": False},
    }

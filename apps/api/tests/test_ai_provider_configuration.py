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

    monkeypatch.setattr(settings, "openai_api_key", "")

    with pytest.raises(AIProviderConfigurationError, match="AI provider is not configured"):
        get_openai_client()


def test_missing_anthropic_key_returns_safe_configuration_error(monkeypatch):
    from services.ai.providers import AIProviderConfigurationError, get_anthropic_client

    monkeypatch.setattr(settings, "anthropic_api_key", "")

    with pytest.raises(AIProviderConfigurationError, match="AI provider is not configured"):
        get_anthropic_client()

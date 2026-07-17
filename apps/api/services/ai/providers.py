import anthropic
from openai import OpenAI

from core.config import settings


class AIProviderConfigurationError(RuntimeError):
    """Raised when an AI feature is requested without its provider credentials."""


def get_openai_client() -> OpenAI:
    if not settings.openai_api_key:
        raise AIProviderConfigurationError("AI provider is not configured")
    return OpenAI(api_key=settings.openai_api_key)


def get_anthropic_client() -> anthropic.Anthropic:
    if not settings.anthropic_api_key:
        raise AIProviderConfigurationError("AI provider is not configured")
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)

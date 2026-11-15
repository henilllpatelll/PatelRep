"""H3 process gates (environment variables prefixed ``AGENT_ORCHESTRATOR_``). Every default is the safe one.

Planning runs are processed only when ALL of these hold, and each is independent:
  * ``APP_ENV`` is development / test / staging -- production is refused in code, whatever else is set;
  * ``AGENT_ORCHESTRATOR_EXECUTION_ENABLED=true`` (and the H1 worker itself is enabled);
  * for live provider adapters additionally ``AGENT_ORCHESTRATOR_PAID_CALLS_ENABLED=true``;
then the database layers: ``agent_model_enablement.enabled``, budget policies, runtime controls, the ``ai_agents``
entitlement and the initiator's current role. No model output, tenant flag or request body can set any of these.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict

ORCHESTRATOR_ALLOWED_ENVIRONMENTS = frozenset({"development", "test", "staging"})


class OrchestratorSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AGENT_ORCHESTRATOR_", extra="ignore")

    execution_enabled: bool = False
    paid_calls_enabled: bool = False


def process_allows_orchestration(*, app_env: str, settings: OrchestratorSettings) -> bool:
    """The worker may process planning steps. Never true in production."""
    return bool(settings.execution_enabled) and app_env in ORCHESTRATOR_ALLOWED_ENVIRONMENTS


def paid_calls_allowed(*, app_env: str, settings: OrchestratorSettings) -> bool:
    """Live provider adapters may be constructed. Never true in production."""
    return process_allows_orchestration(app_env=app_env, settings=settings) and bool(settings.paid_calls_enabled)

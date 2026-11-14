"""The H2 execution-capability boundary and the inputs the gateway feeds to H0 ``policy.evaluate``.

Platform execution is ON only when ALL of these independent layers agree (each defaults off):
  1. code:      the tool version is in ``H2_EXECUTABLE_TOOLS`` and bound in ``bindings.py``
  2. process:   ``APP_ENV`` is development / test / staging. Production is refused in code in H2, whatever else is set
  3. process:   ``AGENT_GATEWAY_EXECUTION_ENABLED=true`` (a server environment variable; no model or tenant can set it)
  4. database:  ``agent_execution_enablement.enabled`` (operator switch, default false)
  5. database:  no platform / hotel / agent pause, no cost emergency stop, no tool pause
then per invocation: the tenant's ``ai_agents`` entitlement, a per-property grant for this exact agent + tool version,
the initiator's CURRENT role and, for writes, a valid single-use human approval. No single flag authorizes anything.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict

from services.agent_harness.autonomy import AutonomyGrant
from services.agent_harness.controls import RuntimeControls, TenantAgentState
from services.agent_harness.vocabulary import AutonomyLevel, RiskLevel

GATEWAY_ALLOWED_ENVIRONMENTS = frozenset({"development", "test", "staging"})
CONTROL_SOURCE = "agent_gateway_snapshot"


class GatewaySettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AGENT_GATEWAY_", extra="ignore")

    execution_enabled: bool = False


def process_allows_execution(*, app_env: str, settings: GatewaySettings) -> bool:
    """Layers 2 + 3. Production can never pass in H2."""
    return bool(settings.execution_enabled) and app_env in GATEWAY_ALLOWED_ENVIRONMENTS


def parse_ts(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def db_now(snapshot: Mapping[str, Any]) -> Optional[datetime]:
    return parse_ts(snapshot.get("db_now"))


def block_reason(snapshot: Mapping[str, Any], *, hotel_id: str, agent_id: str, tool_id: str) -> Optional[str]:
    """Why work must not start now (None = not blocked). Mirrors agent__tool_block_reason in the database."""
    rows = snapshot.get("controls") or []
    if any(r.get("scope") == "platform" and r.get("cost_emergency_stop") for r in rows):
        return "cost_emergency_stop"
    if any(r.get("scope") == "platform" and r.get("paused") for r in rows):
        return "platform_paused"
    if any(r.get("scope") == "hotel" and str(r.get("tenant_id")) == hotel_id and r.get("paused") for r in rows):
        return "hotel_paused"
    if any(r.get("scope") == "agent" and r.get("agent_id") == agent_id and r.get("paused") for r in rows):
        return "agent_paused"
    if snapshot.get("platform_execution_enabled") is not True:
        return "platform_execution_disabled"
    if tool_id in set(snapshot.get("paused_tools") or []):
        return "tool_paused"
    return None


@dataclass(frozen=True)
class PolicyInputs:
    controls: RuntimeControls
    tenant: TenantAgentState
    grants: tuple[AutonomyGrant, ...]


def policy_inputs(snapshot: Mapping[str, Any], *, hotel_id: str, agent_id: str, process_enabled: bool,
                  now: datetime) -> PolicyInputs:
    """Translate a fresh database snapshot into H0's typed inputs. Platform execution needs process AND database."""
    rows = snapshot.get("controls") or []
    controls = RuntimeControls(
        platform_execution_enabled=bool(process_enabled and snapshot.get("platform_execution_enabled") is True),
        cost_emergency_stop=any(r.get("scope") == "platform" and r.get("cost_emergency_stop") for r in rows),
        paused_hotels=frozenset(
            str(r.get("tenant_id")) for r in rows if r.get("scope") == "hotel" and r.get("paused"))
        | (frozenset({hotel_id}) if any(r.get("scope") == "platform" and r.get("paused") for r in rows) else frozenset()),
        paused_agents=frozenset(str(r.get("agent_id")) for r in rows if r.get("scope") == "agent" and r.get("paused")),
        paused_tools=frozenset(str(t) for t in snapshot.get("paused_tools") or []),
        source=CONTROL_SOURCE,
        loaded_at=now,
    )
    tenant = TenantAgentState(hotel_id=hotel_id, enabled_flags=frozenset(snapshot.get("enabled_flags") or []),
                              loaded_at=now)
    grants: list[AutonomyGrant] = []
    for g in snapshot.get("grants") or []:
        try:
            level = AutonomyLevel(int(g["max_level"]))
            grants.append(AutonomyGrant(
                hotel_id=hotel_id, agent_id=agent_id, tool_id=g["tool_id"], tool_version=int(g["tool_version"]),
                max_level=level, max_risk=RiskLevel(g["max_risk"]), granted_by_user_id=str(g["granted_by_user_id"]),
                granted_at=parse_ts(g["granted_at"]), expires_at=parse_ts(g.get("expires_at"))))
        except (KeyError, ValueError, TypeError):
            continue  # a malformed grant grants nothing
    return PolicyInputs(controls=controls, tenant=tenant, grants=tuple(grants))

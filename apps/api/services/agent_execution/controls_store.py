"""Server-side runtime controls: platform / hotel / agent pause and the cost emergency stop.

The H0 ``RuntimeControls`` snapshot is loaded here from ``agent_runtime_controls``. The store can only RESTRICT
execution: ``platform_execution_enabled`` is always False because the table has no enable column and the H0 ceiling
(``H0_EXECUTION_SUPPORTED``) stays a code constant. The same controls are enforced inside the database by admission,
claim and every heartbeat (``agent__control_block_reason``), so a stale Python snapshot cannot let work through.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from services.agent_harness.controls import RuntimeControls

CONTROL_SOURCE = "agent_runtime_controls"


def load_runtime_controls_from_store(client: Any, now: datetime) -> RuntimeControls:
    rows = (client.table("agent_runtime_controls")
            .select("scope, tenant_id, agent_id, paused, cost_emergency_stop").limit(1000).execute().data or [])
    return controls_from_rows(rows, now)


def controls_from_rows(rows: list[dict], now: datetime) -> RuntimeControls:
    platform_paused = any(r.get("scope") == "platform" and r.get("paused") for r in rows)
    cost_stop = any(r.get("scope") == "platform" and r.get("cost_emergency_stop") for r in rows)
    hotels = frozenset(str(r["tenant_id"]) for r in rows if r.get("scope") == "hotel" and r.get("paused"))
    agents = frozenset(str(r["agent_id"]) for r in rows if r.get("scope") == "agent" and r.get("paused"))
    if platform_paused:
        # A platform pause stops everything; H0's snapshot expresses that as no execution plus every hotel paused.
        hotels = hotels | {"*"}
    return RuntimeControls(platform_execution_enabled=False, cost_emergency_stop=cost_stop,
                           paused_hotels=hotels, paused_agents=agents, source=CONTROL_SOURCE, loaded_at=now)


def block_reason(controls: RuntimeControls, *, hotel_id: str, agent_id: str) -> Optional[str]:
    """Why new work must not start for this hotel/agent (None = not blocked by a pause or stop)."""
    if controls.cost_emergency_stop:
        return "cost_emergency_stop"
    if "*" in controls.paused_hotels:
        return "platform_paused"
    if hotel_id in controls.paused_hotels:
        return "hotel_paused"
    if agent_id in controls.paused_agents:
        return "agent_paused"
    return None


def set_control(client: Any, *, scope: str, updated_by: str, tenant_id: Optional[str] = None,
                agent_id: Optional[str] = None, paused: bool = False, cost_emergency_stop: bool = False,
                reason_code: Optional[str] = None) -> dict:
    """Operator action (runbook): set or clear a pause / the cost stop. Persists immediately; workers observe it."""
    return client.rpc("agent_runtime_control_set", {
        "p_scope": scope, "p_tenant_id": tenant_id, "p_agent_id": agent_id, "p_paused": paused,
        "p_cost_emergency_stop": cost_emergency_stop, "p_updated_by": updated_by, "p_reason_code": reason_code,
    }).execute().data

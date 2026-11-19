"""The reviewed agent directory, built from the code registries the gateway and orchestrator enforce (exact versions).

Only manifest metadata is exposed: names, versions, descriptions, capabilities, autonomy ceiling, tools with their
access/risk/roles, and the reviewed planning intents. Never a prompt, model instruction, schema internals or secret.
"""
from __future__ import annotations

from typing import Any

from services.agent_gateway.catalog import ALL_TOOL_SPECS, GATEWAY_AGENT_SPECS
from services.agent_orchestrator.intents import H5_INTENTS


def _tool_index() -> dict[tuple[str, int], Any]:
    return {(t.tool_id, t.version): t for t in ALL_TOOL_SPECS}


def agent_directory() -> list[dict]:
    tools = _tool_index()
    intents_by_agent: dict[tuple[str, int], list[dict]] = {}
    for (intent_id, intent_version), intent_spec in sorted(H5_INTENTS.items()):
        # Never intent_spec's description: it is model instruction text, not reviewed display copy.
        intents_by_agent.setdefault(tuple(intent_spec.specialist), []).append({
            "intent": intent_id, "intent_version": intent_version,
            "initiator_roles": sorted(intent_spec.initiator_roles),
            "proposes": ({"tool_id": intent_spec.write_tool[0], "tool_version": intent_spec.write_tool[1]}
                         if intent_spec.write_tool else None)})
    out = []
    for agent in sorted(GATEWAY_AGENT_SPECS, key=lambda a: (a.agent_id, a.agent_version)):
        agent_tools = []
        for ref in agent.tools:
            spec = tools.get((ref.tool_id, ref.version))
            if spec is None:
                continue
            agent_tools.append({
                "tool_id": spec.tool_id, "tool_version": spec.version, "description": spec.description,
                "access": spec.access.value, "risk": spec.risk.value, "allowed_roles": sorted(spec.allowed_roles),
                "requires_approval": spec.access.value == "write"})
        out.append({
            "agent_id": agent.agent_id, "agent_version": agent.agent_version, "name": agent.name,
            "product_family": getattr(agent.product_family, "value", str(agent.product_family)),
            "description": agent.description, "capabilities": sorted(agent.capabilities),
            "autonomy_ceiling": int(agent.autonomy_ceiling), "resource_types": sorted(
                getattr(r, "value", str(r)) for r in agent.resource_types),
            "tools": agent_tools, "intents": intents_by_agent.get(agent.key, []),
            "manifest_enabled": bool(agent.enabled)})
    return out


def reviewed_tool_keys() -> set[tuple[str, int, str, int]]:
    """(agent_id, agent_version, tool_id, tool_version) of every reviewed binding -- the only grants that can exist."""
    return {(a.agent_id, a.agent_version, ref.tool_id, ref.version) for a in GATEWAY_AGENT_SPECS for ref in a.tools}

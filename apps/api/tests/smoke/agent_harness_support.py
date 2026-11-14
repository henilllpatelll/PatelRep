"""Shared builders for the Agent Harness H0 contract tests. Pure: no database, network or model provider."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from middleware.auth import CurrentUser
from services.agent_harness.agents import AGENT_HARNESS_FLAG, AgentRegistry, AgentSpec
from services.agent_harness.controls import RuntimeControls, TenantAgentState
from services.agent_harness.examples import EXAMPLE_AGENT_V1, WORK_ORDER_ASSIGN_V1, WORK_ORDER_LOOKUP_V1
from services.agent_harness.identity import context_for_system, context_from_verified_user
from services.agent_harness.policy import AuthorizationRequest, VerifiedResource, evaluate
from services.agent_harness.tools import ToolRegistry, ToolSpec
from services.agent_harness.vocabulary import ResourceType, TriggerType

NOW = datetime(2026, 11, 13, 15, 0, tzinfo=timezone.utc)
HOTEL_A = "11111111-1111-4111-8111-111111111111"
HOTEL_B = "22222222-2222-4222-8222-222222222222"
USER_ID = "33333333-3333-4333-8333-333333333333"
WORK_ORDER_ID = "44444444-4444-4444-8444-444444444444"
AGENT_ID = EXAMPLE_AGENT_V1.agent_id
LOOKUP = WORK_ORDER_LOOKUP_V1
ASSIGN = WORK_ORDER_ASSIGN_V1


def tool_variant(base: ToolSpec = LOOKUP, **changes: Any) -> ToolSpec:
    """A re-VALIDATED copy of a tool spec (model_copy would skip validation)."""
    return ToolSpec.model_validate({**base.model_dump(), **changes})


def agent_variant(base: AgentSpec = EXAMPLE_AGENT_V1, **changes: Any) -> AgentSpec:
    return AgentSpec.model_validate({**base.model_dump(), **changes})


def registries(*, agent: Optional[AgentSpec] = None, tools: tuple[ToolSpec, ...] = (LOOKUP, ASSIGN)) -> AgentRegistry:
    tool_registry = ToolRegistry()
    for spec in tools:
        tool_registry.register(spec)
    tool_registry.freeze()
    agents = AgentRegistry(tool_registry)
    agents.register(agent or agent_variant(enabled=True))
    return agents.freeze()


def controls(**changes: Any) -> RuntimeControls:
    """Controls with platform execution ON -- only tests construct this; production H0 never can."""
    return RuntimeControls(**{"platform_execution_enabled": True, "source": "test", "loaded_at": NOW, **changes})


def tenant(hotel_id: str = HOTEL_A, flags: frozenset[str] = frozenset({AGENT_HARNESS_FLAG})) -> TenantAgentState:
    return TenantAgentState(hotel_id=hotel_id, enabled_flags=flags, loaded_at=NOW)


def user(role: str, hotel_id: str = HOTEL_A, user_id: str = USER_ID) -> CurrentUser:
    return CurrentUser(user_id=user_id, hotel_id=hotel_id, role=role)


def human_ctx(role: str = "gm", hotel_id: str = HOTEL_A, *, agent_id: str = AGENT_ID, agent_version: int = 1,
              now: datetime = NOW):
    return context_from_verified_user(user(role, hotel_id), agent_id=agent_id, agent_version=agent_version, now=now)


def system_ctx(principal: str = "harness.scheduled_observer", hotel_id: str = HOTEL_A, agent_id: str = AGENT_ID):
    return context_for_system(principal, hotel_id=hotel_id, agent_id=agent_id, agent_version=1,
                              trigger=TriggerType.SCHEDULE, now=NOW)


def work_order(hotel_id: str = HOTEL_A) -> VerifiedResource:
    return VerifiedResource(ResourceType.WORK_ORDER, WORK_ORDER_ID, hotel_id)


def request(tool: ToolSpec = LOOKUP, *, hotel_id: str = HOTEL_A, agent_id: str = AGENT_ID, agent_version: int = 1,
            tool_id: Any = None, tool_version: Any = None, arguments: Any = None) -> AuthorizationRequest:
    return AuthorizationRequest(
        hotel_id=hotel_id, agent_id=agent_id, agent_version=agent_version,
        tool_id=tool.tool_id if tool_id is None else tool_id,
        tool_version=tool.version if tool_version is None else tool_version,
        arguments={"work_order_id": WORK_ORDER_ID} if arguments is None else arguments,
    )


_DEFAULT = object()


def decide(ctx, req=None, *, agents=None, ctl=_DEFAULT, ten=_DEFAULT, resource=_DEFAULT, **kwargs):
    return evaluate(
        ctx, req or request(), agents=agents or registries(),
        controls=controls() if ctl is _DEFAULT else ctl, tenant=tenant() if ten is _DEFAULT else ten,
        now=kwargs.pop("now", NOW), resource=work_order() if resource is _DEFAULT else resource, **kwargs,
    )


def later(seconds: int) -> datetime:
    return NOW + timedelta(seconds=seconds)

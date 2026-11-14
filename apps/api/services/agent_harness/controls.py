"""Global execution boundary, runtime safety controls and tenant capability snapshot.

H0 has a hard execution ceiling: ``H0_EXECUTION_SUPPORTED`` is a code constant (not configuration), and
``load_runtime_controls`` always returns platform execution DISABLED. There is no environment variable, setting or
tenant flag that turns agent execution on in H0.

Future emergency-stop design (documented in docs/agent-harness/security.md; enforced by this snapshot's shape):
platform-wide pause, hotel pause, agent pause, tool pause and a cost emergency stop are all inputs to every policy
decision, and the snapshot must be fresh (``MAX_CONTROL_AGE``) -- the execution path re-reads them from the server-side
store on every step instead of trusting cached UI state or long-lived JWT claims. Cancelling active workflows is an
H1 durable-execution responsibility that consumes the same pause states.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Final, NoReturn

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr

from services.agent_harness.errors import AgentExecutionDisabled

H0_EXECUTION_SUPPORTED: Final[bool] = False

# H2 execution-capability boundary (replaces H0's blanket write hard stop for an EXACT reviewed set, nothing broader).
# A tool version may execute only if it is listed here AND bound in services/agent_gateway/bindings.py AND allowlisted
# in the database (agent__gateway_tool_spec, migration 243) -- three independently reviewed places that drift tests pin
# together. Membership is necessary, never sufficient: every invocation still needs fresh platform enablement
# (APP_ENV + AGENT_GATEWAY_EXECUTION_ENABLED + the database switch), the tenant entitlement, a per-property grant,
# current identity and, for writes, a valid single-use human approval. There is no blanket "execution supported" flag:
# H0_EXECUTION_SUPPORTED stays False and require_execution_supported() still refuses everything outside this set.
H2_EXECUTABLE_TOOLS: Final[frozenset[tuple[str, int]]] = frozenset({
    ("engineering.work_orders.lookup", 2),
    ("housekeeping.rooms.status_lookup", 1),
    ("engineering.work_orders.assign", 2),
})
MAX_CONTROL_AGE = timedelta(seconds=30)


class RuntimeControls(BaseModel):
    """Platform-level switches. Every default is the safe one."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    platform_execution_enabled: StrictBool = False
    cost_emergency_stop: StrictBool = False
    paused_hotels: frozenset[str] = frozenset()
    paused_agents: frozenset[str] = frozenset()
    paused_tools: frozenset[str] = frozenset()
    source: StrictStr = Field(default="h0_hard_default", min_length=1)
    loaded_at: datetime

    def is_fresh(self, now: datetime) -> bool:
        return timedelta(0) <= now - self.loaded_at <= MAX_CONTROL_AGE


class TenantAgentState(BaseModel):
    """One hotel's server-side agent settings, read at decision time (H1 loads it via core.feature_flags)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    hotel_id: StrictStr = Field(min_length=1)
    enabled_flags: frozenset[str] = frozenset()
    loaded_at: datetime

    def is_fresh(self, now: datetime) -> bool:
        return timedelta(0) <= now - self.loaded_at <= MAX_CONTROL_AGE


def load_runtime_controls(now: datetime) -> RuntimeControls:
    """The authoritative runtime controls. In H0 there is no store and nothing to enable: execution is off."""
    return RuntimeControls(loaded_at=now)


def require_execution_supported() -> NoReturn:
    """Blanket gate for anything OUTSIDE the reviewed H2 tool set. It always refuses."""
    raise AgentExecutionDisabled("Agent execution is not available in Agent Harness H0.")


def tool_is_executable(tool_key: object) -> bool:
    """True only for an exact (tool_id, version) pair in the reviewed H2 set."""
    return isinstance(tool_key, tuple) and tool_key in H2_EXECUTABLE_TOOLS


def require_tool_executable(tool_key: object) -> None:
    """Gate for the Tool Gateway: refuses every tool version outside ``H2_EXECUTABLE_TOOLS``."""
    if not tool_is_executable(tool_key):
        require_execution_supported()

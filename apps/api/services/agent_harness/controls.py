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
    """The single gate any future executor must pass first. In H0 it always refuses."""
    raise AgentExecutionDisabled("Agent execution is not available in Agent Harness H0.")

"""The closed synthetic operation catalog -- the ONLY work an H1 worker can execute.

Purpose: prove durable lifecycle mechanics (leases, fencing, retries, cancellation, recovery), not agent behavior.
The catalog is hard-coded. A spec selects an operation by name from ``OPERATIONS`` and supplies bounded integers;
nothing in a spec is imported, evaluated, executed as a command, fetched over the network or passed to a model, and
no synthetic operation touches guest, room, staff, work-order or billing data.
"""
from __future__ import annotations

import time
from typing import Callable, Literal, Mapping, Optional

from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError

from services.agent_execution.retry import InvalidJob, SyntheticPermanentError, SyntheticTransientError

Operation = Literal["noop", "transient_failure", "permanent_failure", "delay"]
OPERATIONS: frozenset[str] = frozenset({"noop", "transient_failure", "permanent_failure", "delay"})
CHECKPOINT_SLICE_SECONDS = 0.05


class SyntheticSpec(BaseModel):
    """A synthetic job. Every field is bounded; unknown fields are refused."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    operation: Operation
    steps: StrictInt = Field(default=1, ge=1, le=5)
    fail_times: StrictInt = Field(default=0, ge=0, le=10)
    delay_ms: StrictInt = Field(default=0, ge=0, le=10_000)

    def step_type(self) -> str:
        return f"synthetic_{self.operation}"


def parse_spec(raw: object) -> SyntheticSpec:
    if not isinstance(raw, Mapping):
        raise InvalidJob("synthetic spec must be an object")
    try:
        return SyntheticSpec.model_validate(dict(raw))
    except ValidationError as exc:
        raise InvalidJob("synthetic spec outside the closed catalog") from exc


def next_step_type(spec: SyntheticSpec, step_number: int) -> Optional[str]:
    return spec.step_type() if step_number < spec.steps else None


def execute_step(
    spec: SyntheticSpec,
    *,
    step_number: int,
    attempt: int,
    checkpoint: Callable[[], None],
    sleep: Callable[[float], None] = time.sleep,
) -> dict:
    """Run one synthetic step. ``checkpoint`` heartbeats and raises to stop cooperatively (cancel/pause/shutdown)."""
    checkpoint()
    if spec.operation == "permanent_failure":
        raise SyntheticPermanentError()
    if spec.operation == "transient_failure" and attempt <= spec.fail_times:
        raise SyntheticTransientError()
    if spec.operation == "delay":
        remaining = spec.delay_ms / 1000.0
        while remaining > 0:
            chunk = min(CHECKPOINT_SLICE_SECONDS, remaining)
            sleep(chunk)
            remaining -= chunk
            checkpoint()
    # Bounded, non-sensitive metadata only.
    return {"operation": spec.operation, "step_number": step_number, "attempt": attempt}

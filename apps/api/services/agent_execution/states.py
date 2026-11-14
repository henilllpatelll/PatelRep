"""Run and step lifecycle vocabulary.

The database is the enforcement point (``agent_run_transition_allowed`` / ``agent_step_transition_allowed`` triggers in
migration 238 refuse an illegal transition from ANY writer, including the service role). These Python tables mirror
them for documentation, typed results and unit tests; an integration test asserts the two never drift.
"""
from __future__ import annotations

from enum import Enum


class RunState(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    RETRY_WAIT = "retry_wait"
    PAUSED = "paused"
    CANCEL_REQUESTED = "cancel_requested"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    DEAD_LETTER = "dead_letter"


class StepState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    RETRY_WAIT = "retry_wait"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    DEAD_LETTER = "dead_letter"


TERMINAL_RUN_STATES = frozenset({RunState.SUCCEEDED, RunState.FAILED, RunState.CANCELLED, RunState.DEAD_LETTER})
TERMINAL_STEP_STATES = frozenset({StepState.SUCCEEDED, StepState.FAILED, StepState.CANCELLED, StepState.DEAD_LETTER})

_R = RunState
RUN_TRANSITIONS: frozenset[tuple[RunState, RunState]] = frozenset({
    (_R.QUEUED, _R.RUNNING), (_R.QUEUED, _R.PAUSED), (_R.QUEUED, _R.CANCELLED), (_R.QUEUED, _R.FAILED),
    (_R.QUEUED, _R.DEAD_LETTER),
    (_R.RUNNING, _R.RUNNING),  # lease takeover: same state, new fencing token
    (_R.RUNNING, _R.SUCCEEDED), (_R.RUNNING, _R.FAILED), (_R.RUNNING, _R.RETRY_WAIT), (_R.RUNNING, _R.CANCEL_REQUESTED),
    (_R.RUNNING, _R.CANCELLED), (_R.RUNNING, _R.DEAD_LETTER), (_R.RUNNING, _R.PAUSED), (_R.RUNNING, _R.QUEUED),
    (_R.RETRY_WAIT, _R.RUNNING), (_R.RETRY_WAIT, _R.PAUSED), (_R.RETRY_WAIT, _R.CANCELLED), (_R.RETRY_WAIT, _R.FAILED),
    (_R.RETRY_WAIT, _R.DEAD_LETTER),
    (_R.PAUSED, _R.QUEUED), (_R.PAUSED, _R.CANCELLED), (_R.PAUSED, _R.FAILED),
    (_R.CANCEL_REQUESTED, _R.CANCELLED), (_R.CANCEL_REQUESTED, _R.FAILED),
})

_S = StepState
STEP_TRANSITIONS: frozenset[tuple[StepState, StepState]] = frozenset({
    (_S.PENDING, _S.RUNNING), (_S.PENDING, _S.CANCELLED), (_S.PENDING, _S.FAILED), (_S.PENDING, _S.DEAD_LETTER),
    (_S.RUNNING, _S.RUNNING),
    (_S.RUNNING, _S.SUCCEEDED), (_S.RUNNING, _S.FAILED), (_S.RUNNING, _S.RETRY_WAIT), (_S.RUNNING, _S.CANCELLED),
    (_S.RUNNING, _S.DEAD_LETTER), (_S.RUNNING, _S.PENDING),
    (_S.RETRY_WAIT, _S.RUNNING), (_S.RETRY_WAIT, _S.PENDING), (_S.RETRY_WAIT, _S.CANCELLED), (_S.RETRY_WAIT, _S.FAILED),
    (_S.RETRY_WAIT, _S.DEAD_LETTER),
})


def run_transition_allowed(current: RunState, target: RunState) -> bool:
    return (current, target) in RUN_TRANSITIONS


def step_transition_allowed(current: StepState, target: StepState) -> bool:
    return (current, target) in STEP_TRANSITIONS

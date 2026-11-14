"""H1 pure contracts: lifecycle vocabulary, retry classification/backoff, and the closed synthetic catalog."""
from __future__ import annotations

import httpx
import pytest

from services.agent_execution.retry import (
    BACKOFF_CAP_SECONDS,
    DeadlineExceeded,
    ErrorClass,
    InvalidJob,
    SyntheticPermanentError,
    SyntheticTransientError,
    backoff_seconds,
    classify,
)
from services.agent_execution.states import (
    RUN_TRANSITIONS,
    STEP_TRANSITIONS,
    TERMINAL_RUN_STATES,
    TERMINAL_STEP_STATES,
    RunState,
    StepState,
    run_transition_allowed,
)
from services.agent_execution.synthetic import OPERATIONS, SyntheticSpec, execute_step, next_step_type, parse_spec
from services.agent_harness.errors import AgentExecutionDisabled, IdentityError


# --- state machine ----------------------------------------------------------------------------------------------

def test_terminal_states_have_no_outgoing_transitions():
    for current, _ in RUN_TRANSITIONS:
        assert current not in TERMINAL_RUN_STATES
    for current, _ in STEP_TRANSITIONS:
        assert current not in TERMINAL_STEP_STATES


@pytest.mark.parametrize("target", list(RunState))
def test_succeeded_and_cancelled_runs_never_resume(target):
    assert not run_transition_allowed(RunState.SUCCEEDED, target)
    assert not run_transition_allowed(RunState.CANCELLED, target)
    assert not run_transition_allowed(RunState.FAILED, target)


def test_failed_run_cannot_become_successful_and_queued_cannot_skip_to_success():
    assert not run_transition_allowed(RunState.FAILED, RunState.SUCCEEDED)
    assert not run_transition_allowed(RunState.QUEUED, RunState.SUCCEEDED)
    assert not run_transition_allowed(RunState.RETRY_WAIT, RunState.SUCCEEDED)


def test_pause_never_erases_a_cancellation_request():
    assert not run_transition_allowed(RunState.CANCEL_REQUESTED, RunState.PAUSED)
    assert not run_transition_allowed(RunState.CANCEL_REQUESTED, RunState.QUEUED)
    assert not run_transition_allowed(RunState.CANCEL_REQUESTED, RunState.RUNNING)
    assert run_transition_allowed(RunState.PAUSED, RunState.CANCELLED)


def test_only_lease_takeover_is_a_same_state_transition():
    same = {(a, b) for a, b in RUN_TRANSITIONS if a == b}
    assert same == {(RunState.RUNNING, RunState.RUNNING)}
    assert {(a, b) for a, b in STEP_TRANSITIONS if a == b} == {(StepState.RUNNING, StepState.RUNNING)}


# --- retry policy -----------------------------------------------------------------------------------------------

@pytest.mark.parametrize("exc, error_class, retryable", [
    (SyntheticTransientError(), ErrorClass.TRANSIENT_INFRASTRUCTURE, True),
    (httpx.ConnectError("x"), ErrorClass.TRANSIENT_INFRASTRUCTURE, True),
    (httpx.ReadTimeout("x"), ErrorClass.TRANSIENT_INFRASTRUCTURE, True),
    (SyntheticPermanentError(), ErrorClass.PERMANENT_FAILURE, False),
    (IdentityError("x", code="principal_inactive"), ErrorClass.AUTHORIZATION_DENIED, False),
    (IdentityError("x", code="operational_permission_revoked"), ErrorClass.AUTHORIZATION_DENIED, False),
    (IdentityError("x", code="stale_identity"), ErrorClass.STALE_IDENTITY, True),
    (AgentExecutionDisabled("x"), ErrorClass.INVALID_AGENT, False),
    (InvalidJob("x"), ErrorClass.INVALID_JOB, False),
    (DeadlineExceeded(), ErrorClass.DEADLINE_EXCEEDED, False),
    (RuntimeError("boom"), ErrorClass.PERSISTENT_INFRASTRUCTURE, True),
])
def test_classification(exc, error_class, retryable):
    c = classify(exc)
    assert (c.error_class, c.retryable) == (error_class, retryable)
    assert c.code.replace("_", "").isalnum() and c.code == c.code.lower()


def test_authorization_denials_are_never_retried():
    for code in ("principal_not_found", "tenant_mismatch", "principal_inactive", "unknown_role", "ambiguous_membership"):
        assert classify(IdentityError("x", code=code)).retryable is False


def test_classification_never_echoes_exception_text():
    secret = "guest jane@example.com room 412 token=abc"
    c = classify(RuntimeError(secret))
    assert secret not in c.code and "jane" not in c.code


def test_backoff_is_exponential_jittered_bounded_and_at_least_one_second():
    assert backoff_seconds(1, rng=lambda: 1.0) == 2
    assert backoff_seconds(2, rng=lambda: 1.0) == 4
    assert backoff_seconds(5, rng=lambda: 1.0) == 32
    assert backoff_seconds(50, rng=lambda: 1.0) == int(BACKOFF_CAP_SECONDS)
    assert backoff_seconds(3, rng=lambda: 0.0) == 1
    assert backoff_seconds(0, rng=lambda: 0.5) >= 1
    assert all(1 <= backoff_seconds(a) <= BACKOFF_CAP_SECONDS for a in range(1, 30))


# --- synthetic catalog ------------------------------------------------------------------------------------------

def test_catalog_is_closed():
    assert OPERATIONS == {"noop", "transient_failure", "permanent_failure", "delay"}
    for bad in ({"operation": "shell", "cmd": "rm -rf /"}, {"operation": "os.system"},
                {"operation": "noop", "import": "subprocess"}, {"operation": "noop", "url": "http://x"},
                {"operation": "noop", "steps": 99}, {"operation": "delay", "delay_ms": 10_001},
                {"operation": "noop", "steps": "2"}, {"operation": "noop", "tool_id": "engineering.work_orders.assign"},
                [], "noop", None):
        with pytest.raises(InvalidJob):
            parse_spec(bad)


def test_steps_and_step_types():
    spec = SyntheticSpec(operation="noop", steps=3)
    assert [next_step_type(spec, n) for n in (1, 2, 3)] == ["synthetic_noop", "synthetic_noop", None]


def test_execute_step_behaviour():
    calls = []
    cp = lambda: calls.append(1)  # noqa: E731
    assert execute_step(SyntheticSpec(operation="noop"), step_number=1, attempt=1, checkpoint=cp)["operation"] == "noop"
    with pytest.raises(SyntheticPermanentError):
        execute_step(SyntheticSpec(operation="permanent_failure"), step_number=1, attempt=1, checkpoint=cp)
    flaky = SyntheticSpec(operation="transient_failure", fail_times=2)
    for attempt in (1, 2):
        with pytest.raises(SyntheticTransientError):
            execute_step(flaky, step_number=1, attempt=attempt, checkpoint=cp)
    assert execute_step(flaky, step_number=1, attempt=3, checkpoint=cp)["attempt"] == 3


def test_delay_checkpoints_cooperatively_with_a_fake_clock():
    slept, checks = [], []
    execute_step(SyntheticSpec(operation="delay", delay_ms=500), step_number=1, attempt=1,
                 checkpoint=lambda: checks.append(1), sleep=slept.append)
    assert abs(sum(slept) - 0.5) < 1e-9 and len(checks) == 1 + len(slept)


def test_delay_stops_at_the_first_checkpoint_that_raises():
    class Stop(Exception):
        pass
    count = {"n": 0}

    def cp():
        count["n"] += 1
        if count["n"] == 3:
            raise Stop()
    with pytest.raises(Stop):
        execute_step(SyntheticSpec(operation="delay", delay_ms=10_000), step_number=1, attempt=1,
                     checkpoint=cp, sleep=lambda _s: None)
    assert count["n"] == 3

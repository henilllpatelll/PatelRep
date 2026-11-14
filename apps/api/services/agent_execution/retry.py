"""Failure classification and bounded retry backoff.

The worker classifies every failure into a closed ``ErrorClass``. Only transient classes are retried, and even then
the DATABASE decides whether attempts remain (``agent_step_fail`` checks step and run attempt caps and the deadline),
so a Python bug cannot produce an unbounded retry loop. Authorization denials are never retried as if they were
network errors, and no retry bypasses the runtime controls: every re-claim passes the same control checks.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from enum import Enum
from typing import Callable

import httpx

from services.agent_harness.errors import AgentExecutionDisabled, IdentityError

BACKOFF_BASE_SECONDS = 2.0
BACKOFF_CAP_SECONDS = 300.0


class ErrorClass(str, Enum):
    TRANSIENT_INFRASTRUCTURE = "transient_infrastructure"
    PERSISTENT_INFRASTRUCTURE = "persistent_infrastructure"
    INVALID_JOB = "invalid_job"
    STALE_IDENTITY = "stale_identity"
    AUTHORIZATION_DENIED = "authorization_denied"
    INVALID_AGENT = "invalid_agent"
    DEADLINE_EXCEEDED = "deadline_exceeded"
    PERMANENT_FAILURE = "permanent_failure"


@dataclass(frozen=True)
class Classification:
    error_class: ErrorClass
    code: str
    retryable: bool


class LeaseLost(Exception):
    """This worker no longer owns the run. It must stop and write NOTHING (the database refused its fencing token)."""


class InvalidJob(Exception):
    """The persisted job is malformed (e.g. a synthetic spec outside the closed catalog). Never retried."""


class DeadlineExceeded(Exception):
    """The run's persisted deadline passed. Terminal; never retried."""


class SyntheticTransientError(Exception):
    """Controlled transient failure from the synthetic catalog."""


class SyntheticPermanentError(Exception):
    """Controlled permanent failure from the synthetic catalog."""


_STALE_IDENTITY_CODES = frozenset({"stale_identity"})


def classify(exc: BaseException) -> Classification:
    """Map an exception to a stable, sanitized class + code. Never echoes exception text (it may hold data)."""
    if isinstance(exc, SyntheticTransientError):
        return Classification(ErrorClass.TRANSIENT_INFRASTRUCTURE, "synthetic_transient", True)
    if isinstance(exc, SyntheticPermanentError):
        return Classification(ErrorClass.PERMANENT_FAILURE, "synthetic_permanent", False)
    if isinstance(exc, IdentityError):
        if exc.code in _STALE_IDENTITY_CODES:
            return Classification(ErrorClass.STALE_IDENTITY, "stale_identity", True)
        return Classification(ErrorClass.AUTHORIZATION_DENIED, _safe_code(exc.code, "authorization_denied"), False)
    if isinstance(exc, AgentExecutionDisabled):
        return Classification(ErrorClass.INVALID_AGENT, "agent_execution_disabled", False)
    if isinstance(exc, InvalidJob):
        return Classification(ErrorClass.INVALID_JOB, "invalid_job", False)
    if isinstance(exc, DeadlineExceeded):
        return Classification(ErrorClass.DEADLINE_EXCEEDED, "deadline_exceeded", False)
    if isinstance(exc, (httpx.TimeoutException, httpx.TransportError, ConnectionError, TimeoutError)):
        return Classification(ErrorClass.TRANSIENT_INFRASTRUCTURE, "infrastructure_unavailable", True)
    # Unknown failures are retried (bounded by the database attempt caps) and then dead-lettered for investigation.
    return Classification(ErrorClass.PERSISTENT_INFRASTRUCTURE, "unexpected_error", True)


def _safe_code(code: object, default: str) -> str:
    if isinstance(code, str) and code.isascii() and code[:1].isalpha() and code.replace("_", "a").isalnum() and len(code) <= 64:
        return code.lower()
    return default


def backoff_seconds(attempt: int, *, rng: Callable[[], float] = random.random,
                    base: float = BACKOFF_BASE_SECONDS, cap: float = BACKOFF_CAP_SECONDS) -> int:
    """Full-jitter exponential backoff for the attempt that just failed (1-based), in whole seconds, >= 1."""
    if attempt < 1:
        attempt = 1
    ceiling = min(cap, base * (2 ** min(attempt - 1, 20)))
    return max(1, int(round(ceiling * min(max(rng(), 0.0), 1.0))))

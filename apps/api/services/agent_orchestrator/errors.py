"""Closed, sanitized error taxonomy for H3.

Every exception carries only a stable code: never a provider message, prompt, completion, argument value or upstream
exception text (provider errors can echo request content). ``str(exc)`` is the code. ``error_class`` names the H1
``ErrorClass`` the worker records and ``retryable`` says whether a NEW H1 attempt (with new reservations) may run.
"""
from __future__ import annotations

from enum import Enum


class ErrorKind(str, Enum):
    PROVIDER_AUTH_FAILED = "provider_auth_failed"
    UNSUPPORTED_MODEL = "unsupported_model"
    INVALID_CONFIGURATION = "invalid_configuration"
    INVALID_REQUEST = "invalid_request"
    RATE_LIMITED = "provider_rate_limited"
    SERVICE_UNAVAILABLE = "provider_unavailable"
    NETWORK_FAILURE = "network_failure_before_dispatch"
    TIMEOUT_BEFORE_DISPATCH = "timeout_before_dispatch"
    TIMEOUT_AFTER_DISPATCH = "timeout_after_dispatch"
    PROVIDER_ERROR_UNCERTAIN = "provider_error_outcome_unknown"
    CANCELLED_IN_FLIGHT = "cancelled_in_flight"
    MALFORMED_RESPONSE = "malformed_provider_response"
    INVALID_STRUCTURED_OUTPUT = "invalid_structured_output"
    INCOMPLETE_OUTPUT = "incomplete_output"
    MODEL_REFUSED = "model_refused"
    PRICE_UNKNOWN = "price_unknown"
    USAGE_UNREPORTED = "usage_unreported"


class OrchestratorError(Exception):
    """Base for every H3 failure. The message is the code only."""

    code: str = "orchestrator_error"
    error_class: str = "permanent_failure"
    retryable: bool = False

    def __init__(self, code: str | None = None) -> None:
        if code is not None:
            self.code = code
        super().__init__(self.code)


class ConfigurationError(OrchestratorError):
    code = "invalid_configuration"
    error_class = "invalid_agent"


class RoutingError(OrchestratorError):
    """No reviewed model satisfies the request (unknown model, capability gap, bounds, missing price)."""

    code = "no_eligible_model"
    error_class = "invalid_job"


class InvalidModelRequest(OrchestratorError):
    """The bounded request itself is not acceptable (too large, unsupported input item, streaming requested)."""

    code = "invalid_model_request"
    error_class = "invalid_job"


class BudgetDenied(OrchestratorError):
    """The ledger refused a reservation. Nothing was sent to any provider for this attempt."""

    error_class = "permanent_failure"

    def __init__(self, reason: str) -> None:
        super().__init__(f"budget_denied_{reason}" if not reason.startswith("budget_") else reason)
        self.reason = reason


class ProviderCallFailed(OrchestratorError):
    """A provider attempt failed with a classified, settled outcome (released or settled)."""

    error_class = "persistent_infrastructure"

    def __init__(self, kind: ErrorKind, *, retryable: bool = False) -> None:
        super().__init__(kind.value)
        self.kind = kind
        self.retryable = retryable


class ProviderOutcomeUncertain(OrchestratorError):
    """A dispatched attempt ended without a knowable outcome. Its exposure stays reserved; never retried automatically."""

    code = "provider_outcome_uncertain"
    error_class = "permanent_failure"


class SpendUnreconciled(OrchestratorError):
    """The provider answered but the cost could not be determined (usage missing/malformed, price unknown)."""

    code = "provider_cost_unreconciled"
    error_class = "permanent_failure"


class SpendOverrun(OrchestratorError):
    """Actual cost exceeded the reservation. The liability is recorded in full and further spending stops."""

    code = "provider_cost_overrun"
    error_class = "permanent_failure"


class CallLimitExceeded(OrchestratorError):
    code = "model_call_limit_exceeded"
    error_class = "permanent_failure"


class PlanningDeadlineExceeded(OrchestratorError):
    code = "deadline_exceeded"
    error_class = "deadline_exceeded"


class InvalidModelOutput(OrchestratorError):
    code = "invalid_model_output"
    error_class = "permanent_failure"


class PlanningBlocked(OrchestratorError):
    """A runtime control, pause or cancellation stopped work. The worker acknowledges it; it is not a failure."""

    def __init__(self, reason: str, *, action: str = "yield") -> None:
        super().__init__(reason)
        self.reason = reason
        self.action = action  # yield | cancel | pause


class PlanningLeaseLost(OrchestratorError):
    """The worker's fencing token was refused. Stop and write nothing more to the run."""

    code = "lease_lost"

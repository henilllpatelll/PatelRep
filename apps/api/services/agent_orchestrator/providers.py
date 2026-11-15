"""Provider-neutral request/outcome types and the classification that decides how an attempt is settled.

The single most important question after a failed provider call is "could we have been charged?":

  NOT_DISPATCHED      the request never left this process (connect refused/timed out, DNS)        -> release
  REJECTED_NO_CHARGE  the provider answered with a rejection before processing (4xx, 429, 503/529) -> release
  UNCERTAIN           the request may have been processed (5xx, read timeout, disconnect, cancel)  -> keep exposure
  COMPLETED           a response arrived (usage may still be missing or unpriceable)               -> settle / unreconciled

Classification never reads exception messages (they can echo request content); it uses exception TYPES, HTTP status
codes and the underlying transport exception type only. The pinned provider SDKs (openai 3.x, anthropic 2.x) run on
``httpx2``; the classic ``httpx`` family is recognised too so a client built either way classifies identically.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping, Optional, Protocol

import httpx
import httpx2

from services.agent_harness.metering import Provider
from services.agent_harness.provider_usage import NormalizedUsage
from services.agent_orchestrator.errors import ErrorKind

ROLES = frozenset({"user", "assistant"})


@dataclass(frozen=True)
class ChatMessage:
    role: str
    text: str


@dataclass(frozen=True)
class StructuredOutputSpec:
    name: str
    schema: Mapping[str, Any]


@dataclass(frozen=True)
class ProviderRequest:
    """Everything sent to a provider. Bounded by construction (see boundary.input_token_bound)."""

    model: str
    system: str
    messages: tuple[ChatMessage, ...]
    output: Optional[StructuredOutputSpec]
    max_output_tokens: int
    timeout_seconds: float
    reasoning_effort: Optional[str] = None


class DispatchState(str, Enum):
    NOT_DISPATCHED = "not_dispatched"
    REJECTED_NO_CHARGE = "rejected_no_charge"
    UNCERTAIN = "uncertain"
    COMPLETED = "completed"


@dataclass(frozen=True)
class ProviderError:
    kind: ErrorKind
    dispatch: DispatchState
    retryable: bool
    http_status: Optional[int] = None
    retry_after_seconds: Optional[float] = None


@dataclass(frozen=True)
class ProviderOutcome:
    provider: Provider
    requested_model: str
    error: Optional[ProviderError] = None
    text: Optional[str] = None
    usage: Optional[NormalizedUsage] = None  # set whenever a response object arrived
    reported_model: Optional[str] = None
    request_id: Optional[str] = None
    response_id: Optional[str] = None
    finish: str = "completed"  # completed | incomplete | refusal | failed
    extra: Mapping[str, Any] = field(default_factory=dict)

    @property
    def dispatch(self) -> DispatchState:
        return self.error.dispatch if self.error else DispatchState.COMPLETED


class ProviderAdapter(Protocol):
    provider: Provider

    async def send(self, request: ProviderRequest) -> ProviderOutcome: ...


_STATUS_RULES: dict[int, tuple[ErrorKind, DispatchState, bool]] = {
    400: (ErrorKind.INVALID_REQUEST, DispatchState.REJECTED_NO_CHARGE, False),
    401: (ErrorKind.PROVIDER_AUTH_FAILED, DispatchState.REJECTED_NO_CHARGE, False),
    403: (ErrorKind.PROVIDER_AUTH_FAILED, DispatchState.REJECTED_NO_CHARGE, False),
    404: (ErrorKind.UNSUPPORTED_MODEL, DispatchState.REJECTED_NO_CHARGE, False),
    408: (ErrorKind.TIMEOUT_BEFORE_DISPATCH, DispatchState.REJECTED_NO_CHARGE, True),
    409: (ErrorKind.INVALID_REQUEST, DispatchState.REJECTED_NO_CHARGE, False),
    413: (ErrorKind.INVALID_REQUEST, DispatchState.REJECTED_NO_CHARGE, False),
    422: (ErrorKind.INVALID_REQUEST, DispatchState.REJECTED_NO_CHARGE, False),
    429: (ErrorKind.RATE_LIMITED, DispatchState.REJECTED_NO_CHARGE, True),
    503: (ErrorKind.SERVICE_UNAVAILABLE, DispatchState.REJECTED_NO_CHARGE, True),
    529: (ErrorKind.SERVICE_UNAVAILABLE, DispatchState.REJECTED_NO_CHARGE, True),  # Anthropic "overloaded"
}


def classify_status(status: Optional[int]) -> tuple[ErrorKind, DispatchState, bool]:
    """HTTP status -> (kind, dispatch state, retryable). Unlisted 4xx are rejections; other 5xx are UNCERTAIN."""
    if status is None:
        return ErrorKind.PROVIDER_ERROR_UNCERTAIN, DispatchState.UNCERTAIN, False
    if status in _STATUS_RULES:
        return _STATUS_RULES[status]
    if 400 <= status < 500:
        return ErrorKind.INVALID_REQUEST, DispatchState.REJECTED_NO_CHARGE, False
    return ErrorKind.PROVIDER_ERROR_UNCERTAIN, DispatchState.UNCERTAIN, False


_PRE_DISPATCH = (httpx.ConnectError, httpx.ConnectTimeout, httpx.UnsupportedProtocol, httpx.InvalidURL,
                 httpx2.ConnectError, httpx2.ConnectTimeout, httpx2.UnsupportedProtocol, httpx2.InvalidURL)
_CONNECT_TIMEOUTS = (httpx.ConnectTimeout, httpx2.ConnectTimeout)
_TIMEOUTS = (httpx.TimeoutException, httpx2.TimeoutException, TimeoutError)
_TRANSPORT = (httpx.HTTPError, httpx2.HTTPError, TimeoutError, ConnectionError)


def _causes(exc: BaseException) -> list[BaseException]:
    chain, seen = [], set()
    current: Optional[BaseException] = exc
    while current is not None and id(current) not in seen and len(chain) < 8:
        seen.add(id(current))
        chain.append(current)
        current = current.__cause__  # explicit chaining only: an unrelated earlier error must not look "unsent"
    return chain


def classify_transport(exc: BaseException) -> ProviderError:
    """A failure without an HTTP response. Only a provably unsent request counts as NOT_DISPATCHED."""
    chain = _causes(exc)
    if any(isinstance(e, _PRE_DISPATCH) for e in chain):
        timeout = any(isinstance(e, _CONNECT_TIMEOUTS) for e in chain)
        return ProviderError(ErrorKind.TIMEOUT_BEFORE_DISPATCH if timeout else ErrorKind.NETWORK_FAILURE,
                             DispatchState.NOT_DISPATCHED, True)
    if any(isinstance(e, _TIMEOUTS) for e in chain):
        return ProviderError(ErrorKind.TIMEOUT_AFTER_DISPATCH, DispatchState.UNCERTAIN, False)
    return ProviderError(ErrorKind.PROVIDER_ERROR_UNCERTAIN, DispatchState.UNCERTAIN, False)


def retry_after(headers: Any) -> Optional[float]:
    try:
        value = headers.get("retry-after") if headers is not None else None
        seconds = float(value) if value is not None else None
    except (TypeError, ValueError, AttributeError):
        return None
    return seconds if seconds is not None and 0 <= seconds <= 120 else None


def classify_sdk_exception(exc: BaseException, *, status_error: type, connection_error: type,
                           validation_error: Optional[type] = None) -> ProviderError:
    """Map an OpenAI/Anthropic SDK exception (both share the same shape) to a ProviderError, by type only."""
    if validation_error is not None and isinstance(exc, validation_error):
        return ProviderError(ErrorKind.MALFORMED_RESPONSE, DispatchState.COMPLETED, False)
    if isinstance(exc, status_error):
        status = getattr(exc, "status_code", None)
        kind, dispatch, retryable = classify_status(status if isinstance(status, int) else None)
        response = getattr(exc, "response", None)
        return ProviderError(kind, dispatch, retryable, http_status=status if isinstance(status, int) else None,
                             retry_after_seconds=retry_after(getattr(response, "headers", None)))
    if isinstance(exc, connection_error) or isinstance(exc, _TRANSPORT):
        return classify_transport(exc)
    return ProviderError(ErrorKind.PROVIDER_ERROR_UNCERTAIN, DispatchState.UNCERTAIN, False)


def safe_id(value: Any, limit: int = 200) -> Optional[str]:
    """Provider request/response ids only if they look like ids (they are stored and logged)."""
    if not isinstance(value, str) or not value or len(value) > limit:
        return None
    if not all(ch.isalnum() or ch in "._:-" for ch in value):
        return None
    return value


def safe_model(value: Any) -> Optional[str]:
    if not isinstance(value, str) or not 0 < len(value) <= 100:
        return None
    if not all(ch.isalnum() or ch in "._:/-" for ch in value):
        return None
    return value

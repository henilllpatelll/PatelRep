"""Request bodies for availability, time-off requests and shift swaps (Team Scheduling Phase 5).

Strict on purpose: unknown fields are rejected, so a client cannot smuggle `user_id`, `status` or `department_id` into a
self-service call. WHO is acting always comes from the verified session, never from the body.
"""
from datetime import date
from typing import Literal, Optional

from pydantic import UUID4, ConfigDict, Field

from models.requests import LONG_TEXT_MAX, SHORT_TEXT_MAX, SanitizedBaseModel

ReasonCategory = Literal["vacation", "personal", "family", "appointment", "health", "other"]
AvailabilityMode = Literal["available", "unavailable"]
CLOCK_PATTERN = r"^\d{1,2}:\d{2}(:\d{2})?$"


class StrictModel(SanitizedBaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class AvailabilityWindowIn(StrictModel):
    start: str = Field(pattern=CLOCK_PATTERN)
    end: str = Field(pattern=CLOCK_PATTERN)


class AvailabilityDayIn(StrictModel):
    weekday: int = Field(ge=0, le=6, description="0 = Monday ... 6 = Sunday")
    mode: AvailabilityMode
    windows: list[AvailabilityWindowIn] = Field(default_factory=list, max_length=4)


class ReplaceAvailabilityRequest(StrictModel):
    """The whole recurring week as one set. A weekday left out means 'nothing submitted' from `effective_from` on."""
    expected_revision: int = Field(ge=0, description="The revision the employee was looking at (0 = nothing submitted yet).")
    effective_from: Optional[date] = Field(default=None, description="Hotel-local date; defaults to today.")
    days: list[AvailabilityDayIn] = Field(max_length=7)


class AvailabilityExceptionRequest(StrictModel):
    """One date that differs from the usual week: unavailable all day, or available only for the given windows."""
    exception_date: date
    mode: AvailabilityMode
    windows: list[AvailabilityWindowIn] = Field(default_factory=list, max_length=4)
    note: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)


class RetireAvailabilityRequest(StrictModel):
    expected_version: int = Field(ge=1)


class CreateTimeOffRequest(StrictModel):
    start_date: date
    end_date: date
    partial: bool = False
    start_time: Optional[str] = Field(default=None, pattern=CLOCK_PATTERN)
    end_time: Optional[str] = Field(default=None, pattern=CLOCK_PATTERN)
    reason_category: ReasonCategory
    note: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    idempotency_key: Optional[str] = Field(default=None, min_length=8, max_length=SHORT_TEXT_MAX)


class DecideTimeOffRequest(StrictModel):
    expected_version: int = Field(ge=1)
    reason: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)


class CancelRequest(StrictModel):
    expected_version: int = Field(ge=1)
    reason: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)


class CreateSwapRequest(StrictModel):
    """The requester is the signed-in employee. They name THEIR shift and the coworker's shift to exchange it for."""
    requester_assignment_id: UUID4
    counterpart_assignment_id: UUID4
    note: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    idempotency_key: Optional[str] = Field(default=None, min_length=8, max_length=SHORT_TEXT_MAX)


class RespondSwapRequest(StrictModel):
    accept: bool
    expected_version: int = Field(ge=1)
    note: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)


class DecideSwapRequest(StrictModel):
    expected_version: int = Field(ge=1)
    reason: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    acknowledge_warnings: bool = False

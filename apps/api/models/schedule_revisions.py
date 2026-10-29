"""Request bodies for schedule drafts and publication (Team Scheduling Phase 7).

Strict: unknown fields are rejected, so a client cannot smuggle `tenant_id`, `status`, `created_by` or a department into
a call. WHO is acting comes from the verified session and the department from the shift, never from the body.
"""
from datetime import date
from typing import Literal, Optional

from pydantic import UUID4, Field

from models.leave_requests import StrictModel
from models.requests import LONG_TEXT_MAX

CLOCK_PATTERN = r"^\d{1,2}:\d{2}(:\d{2})?$"


class StageChangeRequest(StrictModel):
    """
    One proposed change, added to (or merged into) the department's open draft.

    create  needs user_id, shift_id, work_date and a stable client_key (a retry of the same form replaces itself).
    update  targets a published shift (assignment_id + expected_version = the version the screen shows) or an
            already-staged new shift (change_id); only the fields sent are changed.
    cancel  targets a published shift (assignment_id + expected_version) or a staged new shift (change_id).
    """
    kind: Literal["create", "update", "cancel"]
    assignment_id: Optional[UUID4] = None
    change_id: Optional[UUID4] = None
    client_key: Optional[str] = Field(default=None, min_length=8, max_length=80)
    expected_version: Optional[int] = Field(default=None, ge=1)
    user_id: Optional[UUID4] = None
    shift_id: Optional[UUID4] = None
    work_date: Optional[date] = None
    start_time: Optional[str] = Field(default=None, pattern=CLOCK_PATTERN)
    end_time: Optional[str] = Field(default=None, pattern=CLOCK_PATTERN)
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    reason: Optional[str] = Field(default=None, max_length=500)


class PublishRequest(StrictModel):
    expected_version: int = Field(ge=1, description="The draft version the supervisor reviewed.")
    idempotency_key: str = Field(min_length=8, max_length=80)
    confirm: Literal[True]


class DiscardRequest(StrictModel):
    expected_version: int = Field(ge=1)

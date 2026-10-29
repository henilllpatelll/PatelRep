"""Request bodies for call-outs and shift coverage (Team Scheduling Phase 4)."""
from datetime import datetime
from typing import Literal, Optional

from pydantic import UUID4, Field

from models.requests import LONG_TEXT_MAX, SHORT_TEXT_MAX, SanitizedBaseModel

AbsenceKind = Literal["called_out", "unavailable", "leaving_early", "emergency", "other"]


class RecordAbsenceRequest(SanitizedBaseModel):
    """A supervisor explicitly records that an employee will not work (all of) one scheduled shift."""
    assignment_id: UUID4
    expected_version: int = Field(ge=1, description="The shift's version the supervisor was looking at.")
    kind: AbsenceKind
    leaving_at: Optional[datetime] = Field(default=None, description="Required for leaving_early.")
    note: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    idempotency_key: Optional[str] = Field(default=None, min_length=8, max_length=SHORT_TEXT_MAX)


class WithdrawAbsenceRequest(SanitizedBaseModel):
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=SHORT_TEXT_MAX)


class PostOpenShiftRequest(SanitizedBaseModel):
    """Post a shift occurrence that nobody holds. It is claimable only when the supervisor says so."""
    shift_id: UUID4
    work_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    required_role: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    claimable: bool = False
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    idempotency_key: Optional[str] = Field(default=None, min_length=8, max_length=SHORT_TEXT_MAX)


class OfferShiftRequest(SanitizedBaseModel):
    user_id: UUID4
    expected_version: int = Field(ge=1, description="The gap's version the supervisor was looking at.")
    expires_in_minutes: Optional[int] = Field(default=None, ge=5, le=24 * 60)


class AssignGapRequest(SanitizedBaseModel):
    """Direct assignment: an authorised supervisor puts the person on the shift now (no acceptance step)."""
    user_id: UUID4
    expected_version: int = Field(ge=1)
    acknowledge_warnings: bool = False
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class GapVersionRequest(SanitizedBaseModel):
    expected_version: int = Field(ge=1)


class WaiveGapRequest(GapVersionRequest):
    reason: str = Field(min_length=1, max_length=SHORT_TEXT_MAX)


class ClaimDecisionRequest(SanitizedBaseModel):
    expected_version: int = Field(ge=1, description="The gap's version.")
    acknowledge_warnings: bool = False
    reason: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)


class OfferResponseRequest(SanitizedBaseModel):
    accept: bool
    note: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)

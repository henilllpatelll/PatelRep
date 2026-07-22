import html
import re
import unicodedata
from typing import Any, Optional, List, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    UUID4,
    field_validator,
    model_validator,
)
from uuid import UUID
from datetime import datetime, date


EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")
PHONE_RE = re.compile(r"^[0-9+().\-\s]{7,32}$")
TIME_RE = re.compile(
    r"^(?P<hour>[01]\d|2[0-3]):(?P<minute>[0-5]\d)(?::(?P<second>[0-5]\d))?$"
)
ZIP_RE = re.compile(r"^\d{5}(?:-\d{4})?$")

SHORT_TEXT_MAX = 120
MEDIUM_TEXT_MAX = 255
LONG_TEXT_MAX = 2000


def _is_secret_field(field_name: str) -> bool:
    lowered = field_name.lower()
    return "password" in lowered or lowered == "token" or lowered.endswith("_token")


def _sanitize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).replace("\x00", "")
    without_controls = "".join(
        ch if ch in "\n\r\t" or unicodedata.category(ch) != "Cc" else " "
        for ch in normalized
    )
    compact = re.sub(r"\s+", " ", without_controls).strip()
    return html.escape(compact, quote=False)


def _sanitize_untrusted_value(value: Any, field_name: str = "") -> Any:
    if isinstance(value, str):
        return value if _is_secret_field(field_name) else _sanitize_text(value)
    if isinstance(value, list):
        return [_sanitize_untrusted_value(item, field_name) for item in value]
    if isinstance(value, dict):
        return {
            str(key): _sanitize_untrusted_value(item, str(key))
            for key, item in value.items()
        }
    return value


class SanitizedBaseModel(BaseModel):
    """Shared API request hygiene for user-entered text and common form fields."""

    model_config = ConfigDict(str_strip_whitespace=True)

    @field_validator("*", mode="before")
    @classmethod
    def sanitize_string_fields(cls, value: Any, info):
        return _sanitize_untrusted_value(value, info.field_name or "")

    @field_validator("email", mode="after", check_fields=False)
    @classmethod
    def validate_email(cls, value: Optional[str]):
        if value is None:
            return value
        normalized = value.lower()
        if len(normalized) > 254 or not EMAIL_RE.match(normalized):
            raise ValueError("invalid email address")
        return normalized

    @field_validator("phone", mode="after", check_fields=False)
    @classmethod
    def validate_phone(cls, value: Optional[str]):
        if value is None or value == "":
            return value
        if not PHONE_RE.match(value):
            raise ValueError("invalid phone number")
        return value

    @field_validator("state", mode="after", check_fields=False)
    @classmethod
    def validate_state(cls, value: Optional[str]):
        if value is None:
            return value
        normalized = value.upper()
        if not re.fullmatch(r"[A-Z]{2}", normalized):
            raise ValueError("state must be a two-letter code")
        return normalized

    @field_validator("zip", mode="after", check_fields=False)
    @classmethod
    def validate_zip(cls, value: Optional[str]):
        if value is None or value == "":
            return value
        if not ZIP_RE.match(value):
            raise ValueError("zip must be a 5-digit or ZIP+4 code")
        return value

    @field_validator("start_time", "end_time", mode="after", check_fields=False)
    @classmethod
    def validate_time(cls, value: Optional[str]):
        if value is None:
            return value
        if not TIME_RE.match(value):
            raise ValueError("time must use HH:MM or HH:MM:SS 24-hour format")
        return value

    @field_validator("days_of_week", mode="after", check_fields=False)
    @classmethod
    def validate_days_of_week(cls, value: Optional[List[int]]):
        if value is None:
            return value
        if any(day < 0 or day > 6 for day in value):
            raise ValueError("days_of_week values must be between 0 and 6")
        if len(set(value)) != len(value):
            raise ValueError("days_of_week values must be unique")
        return value

    @field_validator(
        "allowed_modules", "front_desk_modules", mode="after", check_fields=False
    )
    @classmethod
    def validate_module_list(cls, value: Optional[List[str]]):
        if value is None:
            return value
        if any(
            not item or len(item) > 64 or not re.fullmatch(r"[a-z0-9_-]+", item)
            for item in value
        ):
            raise ValueError("module names must be lowercase slugs")
        return value

    @model_validator(mode="after")
    def validate_required_strings(self):
        for field_name, field in self.__class__.model_fields.items():
            value = getattr(self, field_name, None)
            if field.is_required() and isinstance(value, str) and not value:
                raise ValueError(f"{field_name} cannot be blank")
        return self


# --- Staff Role Schedules ---
class CreateRoleScheduleRequest(SanitizedBaseModel):
    override_role: Literal["housekeeping_supervisor", "engineer"]
    days_of_week: List[int] = Field(
        min_length=1, max_length=7
    )  # 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    start_date: Optional[date] = None
    end_date: Optional[date] = None


# --- Hotel / Tenant ---
class CreateHotelRequest(SanitizedBaseModel):
    name: str = Field(min_length=1, max_length=SHORT_TEXT_MAX)
    address: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    city: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    state: str = Field(default="TX", max_length=2)
    zip: Optional[str] = Field(default=None, max_length=10)
    phone: Optional[str] = Field(default=None, max_length=32)
    room_count: int = Field(ge=1, le=1000)
    timezone: str = Field(default="America/Chicago", min_length=1, max_length=64)


# --- Rooms ---
class UpdateRoomStatusRequest(SanitizedBaseModel):
    status: Literal[
        "DIRTY", "IN_PROGRESS", "CLEAN", "INSPECTED", "OOO", "PICKUP", "OCCUPIED"
    ]
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    force: bool = False


class ManualCheckoutRequest(SanitizedBaseModel):
    checkout_time: Optional[datetime] = None
    actual_checkout_at: Optional[datetime] = None
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class UpdateCheckoutTimeRequest(SanitizedBaseModel):
    checkout_time: Optional[datetime] = None


class UndoRoomStatusRequest(SanitizedBaseModel):
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class UpdateRoomRequest(SanitizedBaseModel):
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    is_active: Optional[bool] = None
    opera_room_id: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)


class ImportRoomsRequest(SanitizedBaseModel):
    source: Literal["csv", "opera", "manual"]
    rooms: Optional[List[dict]] = Field(default=None, max_length=500)
    # Each dict in rooms may contain:
    #   room_number (str, required), floor (int, required),
    #   room_type_code (str, required), room_type_name (str, optional),
    #   building (str, optional)


# --- Late Checkout Requests ---
class CreateLateCheckoutRequest(SanitizedBaseModel):
    room_id: UUID
    room_number: str = Field(max_length=20)
    requested_time: str = Field(max_length=30)


class ResolveLateCheckoutRequest(SanitizedBaseModel):
    status: Literal["approved", "denied"]
    confirmed_time: Optional[str] = Field(default=None, max_length=30)
    notes: Optional[str] = Field(default=None, max_length=500)


# --- Tasks ---
class CreateTaskRequest(SanitizedBaseModel):
    title: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    description: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    task_type: Literal[
        "housekeeping", "engineering", "guest_request", "lost_found", "general"
    ]
    priority: Literal["urgent", "normal", "low"] = "normal"
    room_id: Optional[UUID4] = None
    location_text: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    department_id: Optional[UUID4] = None
    assigned_to: Optional[UUID4] = None
    due_at: Optional[datetime] = None
    nl_input: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    use_ai: bool = False

    @field_validator("title")
    @classmethod
    def title_required_without_nl(cls, v, info):
        if not v and not info.data.get("nl_input"):
            raise ValueError("title is required when not using AI (nl_input)")
        return v


class UpdateTaskRequest(SanitizedBaseModel):
    title: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    description: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    task_type: Optional[
        Literal["housekeeping", "engineering", "guest_request", "lost_found", "general"]
    ] = None
    priority: Optional[Literal["urgent", "normal", "low"]] = None
    status: Optional[
        Literal["open", "in_progress", "completed", "cancelled", "escalated"]
    ] = None
    assigned_to: Optional[UUID4] = None
    location_text: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    due_at: Optional[datetime] = None
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


# --- Work Orders ---
class CreateWorkOrderRequest(SanitizedBaseModel):
    title: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    description: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    category: Literal[
        "plumbing",
        "electrical",
        "hvac",
        "furniture",
        "appliance",
        "structural",
        "safety",
        "doors_locks",
        "painting",
        "general",
    ]
    priority: Literal["urgent", "normal", "low", "emergency"] = "normal"
    room_id: Optional[UUID4] = None
    location_text: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    asset_id: Optional[UUID4] = None
    assigned_to: Optional[UUID4] = None
    nl_input: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    use_ai: bool = False
    guest_reported: bool = False
    source: Literal["guest", "staff_patrol", "pm", "self"] = "self"


class CompleteWorkOrderRequest(SanitizedBaseModel):
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    labor_hours: Optional[float] = Field(default=None, ge=0, le=24)
    parts_used: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class TransitionWorkOrderRequest(SanitizedBaseModel):
    status: Literal[
        "open", "escalated", "in_progress", "on_hold", "completed", "cancelled"
    ]
    reason_code: Optional[
        Literal[
            "awaiting_parts",
            "awaiting_vendor",
            "schedule_deferral",
            "safety_review",
            "duplicate",
            "no_longer_needed",
            "reopened_after_failure",
            "reopened_on_request",
            "manager_override",
        ]
    ] = None
    reason_note: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    override: bool = False
    source: Literal["web", "mobile", "api", "automation"] = "api"


class UpdateWorkOrderRequest(SanitizedBaseModel):
    title: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    description: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    category: Optional[
        Literal[
            "plumbing",
            "electrical",
            "hvac",
            "furniture",
            "appliance",
            "structural",
            "safety",
            "doors_locks",
            "painting",
            "general",
        ]
    ] = None
    priority: Optional[Literal["urgent", "normal", "low", "emergency"]] = None
    status: Optional[
        Literal["open", "escalated", "in_progress", "on_hold", "completed", "cancelled"]
    ] = None
    assigned_to: Optional[UUID4] = None
    room_id: Optional[UUID4] = None
    location_text: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    asset_id: Optional[UUID4] = None
    due_at: Optional[datetime] = None
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    labor_hours: Optional[float] = Field(default=None, ge=0, le=24)
    parts_used: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class AddCommentRequest(SanitizedBaseModel):
    comment: str = Field(min_length=1, max_length=LONG_TEXT_MAX)


# --- Feedback ---
class CreateFeedbackRequest(SanitizedBaseModel):
    category: Literal["bug", "confusing", "missing_feature", "too_slow", "other"] = "other"
    severity: Literal["blocking", "annoying", "idea"] = "annoying"
    message: str = Field(min_length=1, max_length=LONG_TEXT_MAX)
    page_url: Optional[str] = Field(default=None, max_length=2048)
    pathname: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    user_agent: Optional[str] = Field(default=None, max_length=512)
    browser_language: Optional[str] = Field(default=None, max_length=64)
    viewport_width: Optional[int] = Field(default=None, ge=1, le=10000)
    viewport_height: Optional[int] = Field(default=None, ge=1, le=10000)
    client_context: dict[str, Any] = Field(default_factory=dict)


# --- AI Copilot ---
class CopilotChatRequest(SanitizedBaseModel):
    message: str = Field(min_length=1, max_length=4000)
    context: Optional[dict] = None


# --- Housekeeping ---
CleanType = Literal["DEP", "FULL", "LIGHT"]


class RoomAssignmentItem(SanitizedBaseModel):
    room_id: UUID4
    housekeeper_id: UUID4
    clean_type: Optional[CleanType] = None


class CreateAssignmentsRequest(SanitizedBaseModel):
    date: date
    shift_id: Optional[UUID4] = None
    assignments: List[RoomAssignmentItem] = Field(min_length=1, max_length=200)
    is_ai_suggested: bool = False


# --- Inspections ---
class InspectionResultItem(SanitizedBaseModel):
    template_item_id: Optional[UUID4] = None
    result: Literal["pass", "fail", "na"]
    note: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class SubmitInspectionRequest(SanitizedBaseModel):
    room_id: UUID4
    template_id: Optional[UUID4] = None
    overall_result: Literal["passed", "failed", "conditional"]
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    items: List[InspectionResultItem] = Field(default_factory=list, max_length=100)


# --- SOP ---
class SOPQueryRequest(SanitizedBaseModel):
    query: str = Field(min_length=1, max_length=LONG_TEXT_MAX)
    create_tasks: bool = False


# --- Evidence foundation ---
class UpdatePropertyApplicabilityRequest(SanitizedBaseModel):
    facilities: List[str] = Field(default_factory=list, max_length=40)
    services: List[str] = Field(default_factory=list, max_length=40)
    brand_requirements: List[str] = Field(default_factory=list, max_length=40)

    @field_validator("facilities")
    @classmethod
    def validate_facilities(cls, value: List[str]) -> List[str]:
        from services.evidence.contracts import FACILITY_OPTIONS, validate_applicability_values

        return validate_applicability_values(value, allowed_values=FACILITY_OPTIONS)

    @field_validator("services")
    @classmethod
    def validate_services(cls, value: List[str]) -> List[str]:
        from services.evidence.contracts import SERVICE_OPTIONS, validate_applicability_values

        return validate_applicability_values(value, allowed_values=SERVICE_OPTIONS)

    @field_validator("brand_requirements")
    @classmethod
    def validate_brand_requirements(cls, value: List[str]) -> List[str]:
        from services.evidence.contracts import BRAND_REQUIREMENT_OPTIONS, validate_applicability_values

        return validate_applicability_values(value, allowed_values=BRAND_REQUIREMENT_OPTIONS)


class CreateControlledDocumentRequest(SanitizedBaseModel):
    title: str = Field(min_length=1, max_length=MEDIUM_TEXT_MAX)
    document_type: Literal["sop", "policy", "training", "safety", "certificate"]
    owner_id: Optional[str] = Field(default=None, max_length=100)
    effective_date: Optional[date] = None
    review_date: Optional[date] = None
    expiration_date: Optional[date] = None
    applicability: List[str] = Field(default_factory=list, max_length=40)
    retention_class: Literal["operational_3_years", "safety_7_years", "brand_7_years"] = "operational_3_years"
    source_sop_document_id: Optional[str] = Field(default=None, max_length=100)

    @field_validator("applicability")
    @classmethod
    def validate_document_applicability(cls, value: List[str]) -> List[str]:
        from services.evidence.contracts import CANONICAL_APPLICABILITY_VALUES, validate_applicability_values

        return validate_applicability_values(
            value, allowed_values=tuple(CANONICAL_APPLICABILITY_VALUES)
        )

    @model_validator(mode="after")
    def validate_lifecycle_dates(self):
        if self.effective_date and self.review_date and self.review_date < self.effective_date:
            raise ValueError("review_date must be on or after effective_date")
        if self.effective_date and self.expiration_date and self.expiration_date < self.effective_date:
            raise ValueError("expiration_date must be on or after effective_date")
        if self.review_date and self.expiration_date and self.expiration_date < self.review_date:
            raise ValueError("expiration_date must be on or after review_date")
        return self


class DocumentLifecycleActionRequest(SanitizedBaseModel):
    """Structured reason context for an auditable controlled-document action."""

    reason_code: Optional[Literal["approval", "supersession", "correction", "override", "deferral"]] = None
    reason_note: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)

    @model_validator(mode="after")
    def require_reason_note_for_exceptional_actions(self):
        if self.reason_code in {"correction", "override", "deferral"} and not self.reason_note:
            raise ValueError("reason_note is required for correction, override, or deferral")
        return self


class ExceptionActionRequest(SanitizedBaseModel):
    """A GM-owned corrective action for a derived evidence exception."""

    action: Literal["assign", "defer", "escalate", "resolve", "reopen"]
    owner_id: Optional[str] = Field(default=None, max_length=100)
    reason_code: Literal[
        "safety_risk", "vendor_delay", "staffing", "document_revision",
        "evidence_pending", "corrected", "other",
    ]
    reason_note: str = Field(min_length=1, max_length=LONG_TEXT_MAX)

    @model_validator(mode="after")
    def require_owner_for_assignment(self):
        if self.action == "assign" and not self.owner_id:
            raise ValueError("owner_id is required when assigning an exception")
        return self


class AssignControlledDocumentRequest(SanitizedBaseModel):
    assigned_to: str = Field(min_length=1, max_length=100)
    due_date: date
    competency_required: bool = False


class EvaluateDocumentCompetencyRequest(SanitizedBaseModel):
    assessment_method: Literal["observed", "quiz"]
    outcome: Literal["passed", "failed"]
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class CreateEvidenceRecordRequest(SanitizedBaseModel):
    label: str = Field(min_length=1, max_length=MEDIUM_TEXT_MAX)
    evidence_type: Literal["file", "photo", "measurement", "checklist_result", "signature", "attestation", "external_certificate"]
    document_id: Optional[str] = Field(default=None, max_length=100)
    assignment_id: Optional[str] = Field(default=None, max_length=100)
    related_entity_type: Optional[Literal["staff", "task", "asset", "room", "inspection", "incident", "sop", "pm_completion"]] = None
    related_entity_id: Optional[str] = Field(default=None, max_length=100)
    measurement_value: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    result: Optional[Literal["passed", "failed", "deferred"]] = None
    required_by: Optional[datetime] = None
    expires_at: Optional[datetime] = None

    @model_validator(mode="after")
    def validate_related_entity_linkage(self):
        if bool(self.related_entity_type) != bool(self.related_entity_id):
            missing = "related_entity_id" if self.related_entity_type else "related_entity_type"
            raise ValueError(f"{missing} is required when linking evidence to an entity")
        return self


# --- Texas compliance and staff safety ---
class CreateSafetyTrainingCourseRequest(SanitizedBaseModel):
    provider_name: str = Field(min_length=1, max_length=MEDIUM_TEXT_MAX)
    course_name: str = Field(min_length=1, max_length=MEDIUM_TEXT_MAX)
    course_code: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    covered_roles: List[Literal["housekeeper", "engineer", "housekeeping_supervisor", "chief_engineer", "front_desk", "gm"]] = Field(min_length=1, max_length=6)
    new_hire_deadline_days: int = Field(default=30, ge=1, le=365)
    recurrence_months: int = Field(default=12, ge=1, le=60)


class AssignSafetyTrainingRequest(SanitizedBaseModel):
    employee_id: str = Field(min_length=1, max_length=100)
    hired_on: date


class CompleteSafetyTrainingRequest(SanitizedBaseModel):
    certificate_evidence_id: Optional[str] = Field(default=None, max_length=100)


class CreateControlledIncidentRequest(SanitizedBaseModel):
    incident_type: Literal["guest_injury", "employee_injury", "chemical_exposure", "sharps_body_fluid", "security", "privacy", "discrimination", "police_fire", "life_safety_impairment"]
    occurred_at: datetime
    location: str = Field(min_length=1, max_length=MEDIUM_TEXT_MAX)
    people_involved: List[dict[str, Any]] = Field(default_factory=list, max_length=20)
    witnesses: List[dict[str, Any]] = Field(default_factory=list, max_length=20)
    immediate_containment: str = Field(min_length=1, max_length=LONG_TEXT_MAX)
    details: str = Field(min_length=1, max_length=LONG_TEXT_MAX)
    follow_up_task_ids: List[str] = Field(default_factory=list, max_length=20)


class CreateIncidentEventRequest(SanitizedBaseModel):
    event_type: Literal["correction", "manager_review", "follow_up", "closed"]
    detail: str = Field(min_length=1, max_length=LONG_TEXT_MAX)


class CreateChemicalInventoryItemRequest(SanitizedBaseModel):
    product_name: str = Field(min_length=1, max_length=MEDIUM_TEXT_MAX)
    manufacturer: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    storage_location: str = Field(min_length=1, max_length=MEDIUM_TEXT_MAX)
    sds_evidence_id: Optional[str] = Field(default=None, max_length=100)
    secondary_label_verified: bool = False
    ppe_requirements: List[str] = Field(default_factory=list, max_length=20)


class CreateEmergencyDrillRequest(SanitizedBaseModel):
    drill_type: Literal["fire", "severe_weather", "evacuation", "medical", "security", "spill_exposure"]
    occurred_at: datetime
    location: str = Field(min_length=1, max_length=MEDIUM_TEXT_MAX)
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    follow_up_evidence_id: Optional[str] = Field(default=None, max_length=100)


class CreateEmergencyContactRequest(SanitizedBaseModel):
    contact_name: str = Field(min_length=1, max_length=MEDIUM_TEXT_MAX)
    role_label: str = Field(min_length=1, max_length=SHORT_TEXT_MAX)
    phone: str = Field(min_length=7, max_length=32)
    alternate_phone: Optional[str] = Field(default=None, max_length=32)
    is_primary: bool = False


class CheckInEmergencyDrillRequest(SanitizedBaseModel):
    accountability_status: Literal["accounted_for", "absent", "assisted"] = "accounted_for"


# --- Assets ---
class CreateAssetRequest(SanitizedBaseModel):
    name: str = Field(min_length=1, max_length=SHORT_TEXT_MAX)
    category_id: UUID4
    room_id: Optional[UUID4] = None
    location_text: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    manufacturer: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    model: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    serial_number: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    purchase_date: Optional[date] = None
    expected_lifespan_years: Optional[int] = Field(default=None, ge=1, le=100)
    replacement_cost: Optional[float] = Field(default=None, ge=0, le=1_000_000)


class UpdateAssetRequest(SanitizedBaseModel):
    name: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    manufacturer: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    model: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    is_active: Optional[bool] = None
    failure_risk_score: Optional[int] = Field(default=None, ge=0, le=100)
    warranty_expires: Optional[date] = None
    location_text: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)


# --- PM Schedules ---
class CreatePMScheduleRequest(SanitizedBaseModel):
    asset_id: UUID4
    name: str = Field(min_length=1, max_length=SHORT_TEXT_MAX)
    description: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    interval_type: Literal[
        "daily", "weekly", "monthly", "quarterly", "annual", "custom"
    ]
    interval_days: Optional[int] = Field(default=None, ge=1, le=3650)
    estimated_minutes: int = Field(default=30, ge=1, le=1440)
    next_due_at: datetime


# --- Operational programs (Phase 4) ---
class PMChecklistResultItem(SanitizedBaseModel):
    key: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    label: str = Field(min_length=1, max_length=MEDIUM_TEXT_MAX)
    result: Literal["passed", "failed", "not_applicable"]
    requires_evidence: bool = False
    # `evidence_records.id` UUID strings — the client creates the evidence_record (and
    # uploads its file) via POST /evidence/records + POST /evidence/records/{id}/file
    # BEFORE submitting the PM completion. Never a raw URL (D-06).
    evidence: List[str] = Field(default_factory=list, max_length=20)
    note: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class CompletePMProgramRequest(SanitizedBaseModel):
    """PM completion proof. `photos` and `certificate_attachments` are lists of
    `evidence_records.id` (UUID strings) pointing at records already uploaded to the private
    evidence-files bucket — never raw storage URLs. `persist_pm_completion` validates every
    submitted ID against `evidence_records` scoped to the caller's tenant before the completion
    is written, then links each evidence record to the completion via
    `related_entity_type='pm_completion'`.
    """

    checklist_template_id: Optional[str] = Field(default=None, max_length=100)
    checklist_version: Optional[int] = Field(default=None, ge=1, le=1000)
    verifier_id: Optional[str] = Field(default=None, max_length=100)
    measurements: dict[str, Any] = Field(default_factory=dict)
    meter_readings: dict[str, Any] = Field(default_factory=dict)
    photos: List[str] = Field(default_factory=list, max_length=20)
    labor_minutes: int = Field(default=0, ge=0, le=1440)
    parts_used: List[dict[str, Any]] = Field(default_factory=list, max_length=100)
    defects: List[dict[str, Any]] = Field(default_factory=list, max_length=100)
    vendor_name: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    certificate_attachments: List[str] = Field(default_factory=list, max_length=20)
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    items: List[PMChecklistResultItem] = Field(min_length=1, max_length=100)


class CreatePMDeferralRequest(SanitizedBaseModel):
    reason: str = Field(min_length=1, max_length=LONG_TEXT_MAX)
    deferred_until: datetime


class CreatePublicAreaRequest(SanitizedBaseModel):
    name: str = Field(min_length=1, max_length=MEDIUM_TEXT_MAX)
    location_detail: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)


class CreateDeepCleanScheduleRequest(SanitizedBaseModel):
    target_type: Literal["room", "public_area"]
    room_id: Optional[str] = Field(default=None, max_length=100)
    public_area_id: Optional[str] = Field(default=None, max_length=100)
    checklist_template_id: Optional[str] = Field(default=None, max_length=100)
    interval_days: int = Field(ge=1, le=3650)
    next_due_on: date


class CompleteDeepCleanRequest(SanitizedBaseModel):
    checklist_results: List[dict[str, Any]] = Field(default_factory=list, max_length=100)
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class UpsertSupplyParRequest(SanitizedBaseModel):
    supply_type: Literal["linen", "chemical", "amenity"]
    name: str = Field(min_length=1, max_length=MEDIUM_TEXT_MAX)
    on_hand: float = Field(ge=0, le=1_000_000)
    par_level: float = Field(ge=0, le=1_000_000)
    unit: str = Field(default="each", min_length=1, max_length=40)


class UpdateStayoverRuleRequest(SanitizedBaseModel):
    linen_change_frequency_days: int = Field(default=3, ge=1, le=30)
    opt_out_allowed: bool = True


class UpdateDndWelfarePolicyRequest(SanitizedBaseModel):
    threshold_hours: int = Field(ge=1, le=72)
    escalation_roles: List[Literal["housekeeping_supervisor", "front_desk", "gm"]] = Field(min_length=1, max_length=3)
    escalation_instructions: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class CreateInspectionSamplingRuleRequest(SanitizedBaseModel):
    room_type_id: Optional[str] = Field(default=None, max_length=100)
    experience_band: Literal["new_hire", "standard", "trusted"] = "standard"
    risk_level: Literal["standard", "high"] = "standard"
    sample_percent: int = Field(ge=1, le=100)


# --- Scheduling ---
class CreateShiftAssignmentRequest(SanitizedBaseModel):
    user_id: UUID4
    shift_id: UUID4
    work_date: date


class CreateShiftRequest(SanitizedBaseModel):
    name: str = Field(min_length=1, max_length=SHORT_TEXT_MAX)
    department_id: UUID4
    start_time: str  # "07:00:00"
    end_time: str  # "15:00:00"


class UpdateShiftRequest(SanitizedBaseModel):
    name: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    is_active: Optional[bool] = None


class BulkShiftAssignmentItem(SanitizedBaseModel):
    user_id: UUID4
    shift_id: UUID4
    work_date: date


class BulkShiftAssignmentRequest(SanitizedBaseModel):
    assignments: List[BulkShiftAssignmentItem] = Field(min_length=1, max_length=500)


class UpdateStaffProfileRequest(SanitizedBaseModel):
    preferred_name: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    phone: Optional[str] = Field(default=None, max_length=32)
    language_pref: Optional[Literal["en", "es"]] = None
    hire_date: Optional[date] = None


# --- Guest Requests ---
class CreateGuestRequestRequest(SanitizedBaseModel):
    title: str = Field(min_length=1, max_length=SHORT_TEXT_MAX)
    room_id: Optional[UUID4] = None
    guest_name: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    description: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    priority: Optional[Literal["normal", "urgent"]] = "normal"
    category: Literal["service", "housekeeping", "maintenance", "accessibility", "other"] = "service"
    guest_impact: Literal["low", "standard", "high"] = "standard"
    contact_preference: Optional[Literal["sms", "call", "email", "in_person", "none"]] = None
    contact_consent: bool = False


class TransitionGuestRequestRequest(SanitizedBaseModel):
    status: Literal[
        "acknowledged", "dispatched", "arrived", "guest_contacted", "resolved",
        "verified", "reopened", "cancelled",
    ]
    detail: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class CreateGuestMessageRequest(SanitizedBaseModel):
    body: str = Field(min_length=1, max_length=LONG_TEXT_MAX)
    recipient: str = Field(min_length=7, max_length=MEDIUM_TEXT_MAX)
    channel: Literal["sms", "email"] = "sms"


class RecordGuestRecoveryActionRequest(SanitizedBaseModel):
    action_type: Literal["apology", "amenity", "discount", "refund", "points", "other"]
    description: str = Field(min_length=1, max_length=LONG_TEXT_MAX)
    compensation_amount: Optional[float] = Field(default=None, ge=0, le=100000)


class UpsertAccessibleRoomFeatureRequest(SanitizedBaseModel):
    room_id: UUID4
    feature_code: str = Field(min_length=1, max_length=MEDIUM_TEXT_MAX)
    description: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    operational_status: Literal["operational", "out_of_service", "inspection_due"] = "operational"
    guidance: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class CreateLostFoundCustodyEventRequest(SanitizedBaseModel):
    event_type: Literal["intake", "moved", "released", "disposition"]
    storage_location: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    recipient_name: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    verification_method: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    disposition: Optional[Literal["claimed", "donated", "discarded"]] = None
    note: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


# --- Phase 6: PMS conflict and AI recommendation governance ---
class ResolveOperaSyncConflictRequest(SanitizedBaseModel):
    resolution: Literal["local_wins", "remote_wins"]


class AuthorizeAIRecommendationRequest(SanitizedBaseModel):
    note: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class RecordAIRecommendationOutcomeRequest(SanitizedBaseModel):
    outcome: Literal["prevented_failure", "resolved", "false_positive", "no_action_needed", "other"]
    detail: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class UpdateAIModelRouteRequest(SanitizedBaseModel):
    selected_model_name: str = Field(alias="model_name", min_length=1, max_length=MEDIUM_TEXT_MAX)
    fallback_model_name: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)


# --- Lost & Found ---
class CreateLostFoundRequest(SanitizedBaseModel):
    description: str = Field(min_length=1, max_length=LONG_TEXT_MAX)
    room_id: Optional[UUID4] = None
    location_found: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    tag_identifier: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    storage_location: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    photo_url: Optional[str] = Field(default=None, max_length=2048)


# --- Logbook ---
class CreateLogbookEntryRequest(SanitizedBaseModel):
    department_id: UUID4
    shift_id: Optional[UUID4] = None
    content: str = Field(min_length=1, max_length=4000)
    expires_hours: Optional[int] = Field(
        default=None, ge=1, le=168
    )  # 8, 24, 48, 168 — None = permanent


class UpdateLogbookEntryRequest(SanitizedBaseModel):
    content: Optional[str] = Field(default=None, max_length=4000)
    expires_hours: Optional[int] = Field(
        default=None, ge=0, le=168
    )  # 0 = remove expiry, positive = set new expiry


# --- Hotel / Tenant Updates ---
class UpdateHotelRequest(SanitizedBaseModel):
    name: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    address: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    city: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    state: Optional[str] = Field(default=None, max_length=2)
    zip: Optional[str] = Field(default=None, max_length=10)
    phone: Optional[str] = Field(default=None, max_length=32)
    room_count: Optional[int] = Field(default=None, ge=1, le=1000)
    timezone: Optional[str] = Field(default=None, max_length=64)
    front_desk_modules: Optional[List[str]] = Field(default=None, max_length=32)


# --- Staff Invitation ---
class InviteStaffRequest(SanitizedBaseModel):
    email: str = Field(min_length=3, max_length=254)
    role: Literal[
        "gm",
        "housekeeping_supervisor",
        "housekeeper",
        "engineer",
        "engineer",
        "front_desk",
    ]
    full_name: str = Field(min_length=1, max_length=SHORT_TEXT_MAX)
    department_id: Optional[UUID4] = None
    phone: Optional[str] = Field(default=None, max_length=32)
    hotel_id: Optional[str] = Field(
        default=None, max_length=64
    )  # passed during onboarding before hotel_id is in JWT


class AddStaffDirectRequest(SanitizedBaseModel):
    full_name: str = Field(min_length=1, max_length=SHORT_TEXT_MAX)
    email: str = Field(min_length=3, max_length=254)
    role: Literal[
        "gm",
        "housekeeping_supervisor",
        "housekeeper",
        "engineer",
        "engineer",
        "front_desk",
    ]
    department_id: Optional[UUID4] = None
    phone: Optional[str] = Field(default=None, max_length=32)
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)


# --- Push Token ---
class UpdatePushTokenRequest(SanitizedBaseModel):
    token: str = Field(min_length=1, max_length=512)


# --- Custom Roles ---
class CreateCustomRoleRequest(SanitizedBaseModel):
    name: str = Field(min_length=1, max_length=SHORT_TEXT_MAX)
    description: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    base_role: Literal[
        "housekeeper",
        "engineer",
        "housekeeping_supervisor",
        "engineer",
        "front_desk",
        "gm",
    ]
    allowed_modules: List[str] = Field(default_factory=list, max_length=32)


class UpdateCustomRoleRequest(SanitizedBaseModel):
    name: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    description: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    base_role: Optional[
        Literal[
            "housekeeper",
            "engineer",
            "housekeeping_supervisor",
            "engineer",
            "front_desk",
            "gm",
        ]
    ] = None
    allowed_modules: Optional[List[str]] = Field(default=None, max_length=32)


# --- Opera Cloud Integration ---
class OperaConnectRequest(SanitizedBaseModel):
    ohip_base_url: str = Field(min_length=8, max_length=2048)
    hotel_id_opera: str = Field(min_length=1, max_length=64)
    integration_username: Optional[str] = Field(
        default=None, max_length=MEDIUM_TEXT_MAX
    )
    integration_password: Optional[str] = None


# --- AI Copilot: Preview models ---
class WorkOrderPreview(SanitizedBaseModel):
    title: str = Field(min_length=1, max_length=SHORT_TEXT_MAX)
    category: Literal[
        "plumbing",
        "electrical",
        "hvac",
        "furniture",
        "appliance",
        "structural",
        "safety",
        "general",
    ]
    priority: Literal["urgent", "normal", "low"]
    room_number: Optional[str] = Field(default=None, max_length=64)
    location_text: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    description: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class GuestRequestPreview(SanitizedBaseModel):
    title: str = Field(min_length=1, max_length=SHORT_TEXT_MAX)
    room_number: Optional[str] = Field(default=None, max_length=64)
    guest_name: Optional[str] = Field(default=None, max_length=SHORT_TEXT_MAX)
    description: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class AssignmentPreview(SanitizedBaseModel):
    staff_name_hint: str = Field(min_length=1, max_length=SHORT_TEXT_MAX)
    staff_id: Optional[str] = None
    room_numbers: List[str] = Field(default_factory=list, max_length=200)
    task_ids: List[str] = Field(default_factory=list, max_length=200)
    clean_type: Optional[CleanType] = None


class AmbiguousOption(SanitizedBaseModel):
    label: str = Field(min_length=1, max_length=SHORT_TEXT_MAX)
    intent_hint: str = Field(min_length=1, max_length=SHORT_TEXT_MAX)


# --- Cleaning checklists / clean sessions / shifts ---


class ChecklistItemInput(SanitizedBaseModel):
    section: str = Field(default="General", min_length=1, max_length=SHORT_TEXT_MAX)
    label: str = Field(min_length=1, max_length=MEDIUM_TEXT_MAX)
    is_required: bool = False


class UpdateChecklistTemplateRequest(SanitizedBaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=SHORT_TEXT_MAX)
    items: List[ChecklistItemInput] = Field(min_length=1, max_length=100)


class ChecklistStateItem(SanitizedBaseModel):
    item_id: Optional[str] = Field(default=None, max_length=64)
    section: str = Field(default="General", max_length=SHORT_TEXT_MAX)
    label: str = Field(min_length=1, max_length=MEDIUM_TEXT_MAX)
    is_required: bool = False
    checked: bool = False
    checked_at: Optional[datetime] = None


class CreateCleanSessionRequest(SanitizedBaseModel):
    id: UUID4
    room_id: UUID4
    started_at: datetime


class UpdateCleanSessionRequest(SanitizedBaseModel):
    checklist: Optional[List[ChecklistStateItem]] = Field(default=None, max_length=100)
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class CompleteCleanSessionRequest(SanitizedBaseModel):
    ended_at: datetime
    checklist: Optional[List[ChecklistStateItem]] = Field(default=None, max_length=100)
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class CleanSessionBlockerRequest(SanitizedBaseModel):
    reason: Literal["dnd", "guest_in_room", "maintenance"]
    note: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


class StartShiftRequest(SanitizedBaseModel):
    id: UUID4
    started_at: datetime


class ShiftBreakRequest(SanitizedBaseModel):
    action: Literal["start", "end"]


class EndShiftRequest(SanitizedBaseModel):
    ended_at: datetime


class BriefingRoomItem(SanitizedBaseModel):
    room_number: str = Field(min_length=1, max_length=10)
    status: str = Field(min_length=1, max_length=20)
    clean_type: Optional[str] = Field(default=None, max_length=10)
    vip_flag: bool = False
    dnd_flag: bool = False
    guest_may_be_inside: bool = False
    open_work_order: bool = False
    checkin_time: Optional[str] = Field(default=None, max_length=40)
    actual_checkout_at: Optional[str] = Field(default=None, max_length=40)
    base_clean_minutes: Optional[int] = Field(default=None, ge=0, le=600)


class HousekeepingBriefingRequest(SanitizedBaseModel):
    rooms: List[BriefingRoomItem] = Field(min_length=1, max_length=60)
    language: Literal["en", "es"] = "en"

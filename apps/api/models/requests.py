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
    override_role: Literal["housekeeping_supervisor", "chief_engineer"]
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
        "general",
    ]
    priority: Literal["urgent", "normal", "low"] = "normal"
    room_id: Optional[UUID4] = None
    location_text: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
    asset_id: Optional[UUID4] = None
    assigned_to: Optional[UUID4] = None
    nl_input: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    use_ai: bool = False


class CompleteWorkOrderRequest(SanitizedBaseModel):
    notes: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)
    labor_hours: Optional[float] = Field(default=None, ge=0, le=24)
    parts_used: Optional[str] = Field(default=None, max_length=LONG_TEXT_MAX)


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
            "general",
        ]
    ] = None
    priority: Optional[Literal["urgent", "normal", "low"]] = None
    status: Optional[
        Literal["open", "in_progress", "on_hold", "completed", "cancelled"]
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


# --- Lost & Found ---
class CreateLostFoundRequest(SanitizedBaseModel):
    description: str = Field(min_length=1, max_length=LONG_TEXT_MAX)
    room_id: Optional[UUID4] = None
    location_found: Optional[str] = Field(default=None, max_length=MEDIUM_TEXT_MAX)
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
        "chief_engineer",
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
        "chief_engineer",
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
        "chief_engineer",
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
            "chief_engineer",
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

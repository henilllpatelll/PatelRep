from pydantic import BaseModel, field_validator, UUID4
from typing import Optional, List, Literal
from datetime import datetime, date


# --- Hotel / Tenant ---
class CreateHotelRequest(BaseModel):
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    state: str = "TX"
    zip: Optional[str] = None
    phone: Optional[str] = None
    room_count: int
    timezone: str = "America/Chicago"


# --- Rooms ---
class UpdateRoomStatusRequest(BaseModel):
    status: Literal["DIRTY", "IN_PROGRESS", "CLEAN", "INSPECTED", "OOO", "PICKUP"]
    notes: Optional[str] = None


class UpdateRoomRequest(BaseModel):
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    opera_room_id: Optional[str] = None


class ImportRoomsRequest(BaseModel):
    source: Literal["csv", "opera", "manual"]
    rooms: Optional[List[dict]] = None
    # Each dict in rooms may contain:
    #   room_number (str, required), floor (int, required),
    #   room_type_code (str, required), room_type_name (str, optional),
    #   building (str, optional)


# --- Tasks ---
class CreateTaskRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    task_type: Literal["housekeeping", "engineering", "guest_request", "lost_found", "general"]
    priority: Literal["urgent", "normal", "low"] = "normal"
    room_id: Optional[UUID4] = None
    location_text: Optional[str] = None
    department_id: Optional[UUID4] = None
    assigned_to: Optional[UUID4] = None
    due_at: Optional[datetime] = None
    nl_input: Optional[str] = None
    use_ai: bool = False

    @field_validator("title")
    @classmethod
    def title_required_without_nl(cls, v, info):
        if not v and not info.data.get("nl_input"):
            raise ValueError("title is required when not using AI (nl_input)")
        return v


class UpdateTaskRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    task_type: Optional[Literal["housekeeping", "engineering", "guest_request", "lost_found", "general"]] = None
    priority: Optional[Literal["urgent", "normal", "low"]] = None
    status: Optional[Literal["open", "in_progress", "completed", "cancelled", "escalated"]] = None
    assigned_to: Optional[UUID4] = None
    location_text: Optional[str] = None
    due_at: Optional[datetime] = None
    notes: Optional[str] = None


# --- Work Orders ---
class CreateWorkOrderRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Literal["plumbing", "electrical", "hvac", "furniture", "appliance", "structural", "safety", "general"]
    priority: Literal["urgent", "normal", "low"] = "normal"
    room_id: Optional[UUID4] = None
    location_text: Optional[str] = None
    asset_id: Optional[UUID4] = None
    assigned_to: Optional[UUID4] = None
    nl_input: Optional[str] = None
    use_ai: bool = False


class CompleteWorkOrderRequest(BaseModel):
    notes: Optional[str] = None
    labor_hours: Optional[float] = None
    parts_used: Optional[str] = None


class UpdateWorkOrderRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[Literal["plumbing", "electrical", "hvac", "furniture", "appliance", "structural", "safety", "general"]] = None
    priority: Optional[Literal["urgent", "normal", "low"]] = None
    status: Optional[Literal["open", "in_progress", "on_hold", "completed", "cancelled"]] = None
    assigned_to: Optional[UUID4] = None
    room_id: Optional[UUID4] = None
    location_text: Optional[str] = None
    asset_id: Optional[UUID4] = None
    due_at: Optional[datetime] = None
    notes: Optional[str] = None
    labor_hours: Optional[float] = None
    parts_used: Optional[str] = None


class AddCommentRequest(BaseModel):
    comment: str


# --- AI Copilot ---
class CopilotChatRequest(BaseModel):
    message: str
    context: Optional[dict] = None


# --- Housekeeping ---
class RoomAssignmentItem(BaseModel):
    room_id: UUID4
    housekeeper_id: UUID4


class CreateAssignmentsRequest(BaseModel):
    date: date
    shift_id: UUID4
    assignments: List[RoomAssignmentItem]
    is_ai_suggested: bool = False


# --- Inspections ---
class InspectionResultItem(BaseModel):
    template_item_id: Optional[UUID4] = None
    result: Literal["pass", "fail", "na"]
    note: Optional[str] = None


class SubmitInspectionRequest(BaseModel):
    room_id: UUID4
    template_id: Optional[UUID4] = None
    overall_result: Literal["passed", "failed", "conditional"]
    notes: Optional[str] = None
    items: List[InspectionResultItem]


# --- SOP ---
class SOPQueryRequest(BaseModel):
    query: str
    create_tasks: bool = False


# --- Assets ---
class CreateAssetRequest(BaseModel):
    name: str
    category_id: UUID4
    room_id: Optional[UUID4] = None
    location_text: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    purchase_date: Optional[date] = None
    expected_lifespan_years: Optional[int] = None
    replacement_cost: Optional[float] = None


class UpdateAssetRequest(BaseModel):
    name: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    failure_risk_score: Optional[int] = None
    warranty_expires: Optional[date] = None
    location_text: Optional[str] = None


# --- PM Schedules ---
class CreatePMScheduleRequest(BaseModel):
    asset_id: UUID4
    name: str
    description: Optional[str] = None
    interval_type: Literal["daily", "weekly", "monthly", "quarterly", "annual", "custom"]
    interval_days: Optional[int] = None
    estimated_minutes: int = 30
    next_due_at: datetime


# --- Scheduling ---
class CreateShiftAssignmentRequest(BaseModel):
    user_id: UUID4
    shift_id: UUID4
    work_date: date


class CreateShiftRequest(BaseModel):
    name: str
    department_id: UUID4
    start_time: str  # "07:00:00"
    end_time: str    # "15:00:00"


class UpdateShiftRequest(BaseModel):
    name: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    is_active: Optional[bool] = None


class BulkShiftAssignmentItem(BaseModel):
    user_id: UUID4
    shift_id: UUID4
    work_date: date


class BulkShiftAssignmentRequest(BaseModel):
    assignments: List[BulkShiftAssignmentItem]


class UpdateStaffProfileRequest(BaseModel):
    preferred_name: Optional[str] = None
    phone: Optional[str] = None
    language_pref: Optional[Literal['en', 'es']] = None
    hire_date: Optional[date] = None


# --- Guest Requests ---
class CreateGuestRequestRequest(BaseModel):
    title: str
    room_id: Optional[UUID4] = None
    guest_name: Optional[str] = None
    description: Optional[str] = None


# --- Lost & Found ---
class CreateLostFoundRequest(BaseModel):
    description: str
    room_id: Optional[UUID4] = None
    location_found: Optional[str] = None
    notes: Optional[str] = None


# --- Logbook ---
class CreateLogbookEntryRequest(BaseModel):
    department_id: UUID4
    shift_id: Optional[UUID4] = None
    content: str
    expires_hours: Optional[int] = None  # 8, 24, 48, 168 — None = permanent


class UpdateLogbookEntryRequest(BaseModel):
    content: Optional[str] = None
    expires_hours: Optional[int] = None  # 0 = remove expiry, positive = set new expiry


# --- Hotel / Tenant Updates ---
class UpdateHotelRequest(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    phone: Optional[str] = None
    room_count: Optional[int] = None
    timezone: Optional[str] = None


# --- Staff Invitation ---
class InviteStaffRequest(BaseModel):
    email: str
    role: Literal["gm", "housekeeping_supervisor", "housekeeper", "chief_engineer", "engineer", "front_desk"]
    full_name: str
    department_id: Optional[UUID4] = None
    phone: Optional[str] = None
    hotel_id: Optional[str] = None  # passed during onboarding before hotel_id is in JWT


# --- Push Token ---
class UpdatePushTokenRequest(BaseModel):
    token: str

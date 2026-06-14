from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class DepartmentCode(StrEnum):
    HOUSEKEEPING = "housekeeping"
    MAINTENANCE = "maintenance"
    FRONT_DESK = "front_desk"
    MANAGER = "manager"
    SYSTEM = "system"


class TaskCategory(StrEnum):
    HOUSEKEEPING_ROOM_CLEAN = "housekeeping_room_clean"
    HOUSEKEEPING_GUEST_REQUEST = "housekeeping_guest_request"
    MAINTENANCE_WORK_ORDER = "maintenance_work_order"
    ROOM_STATUS_MISMATCH = "room_status_mismatch"
    PMS_NOTE_REQUEST = "pms_note_request"
    AI_FAILURE = "ai_failure"
    MANAGER_REVIEW = "manager_review"


class TaskStatus(StrEnum):
    NEW = "new"
    ASSIGNED = "assigned"
    ACKNOWLEDGED = "acknowledged"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    PENDING_APPROVAL = "pending_approval"
    COMPLETED = "completed"
    VERIFIED = "verified"
    ESCALATED = "escalated"
    CANCELED = "canceled"


class TaskPriority(StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class ApprovalStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    EDITED = "edited"
    REJECTED = "rejected"
    EXPIRED = "expired"


class AuditActorType(StrEnum):
    USER = "user"
    AGENT = "agent"
    SYSTEM = "system"


class RiskLevel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


DEPARTMENT_CODES = {item.value for item in DepartmentCode}
TASK_CATEGORIES = {item.value for item in TaskCategory}
TASK_STATUSES = {item.value for item in TaskStatus}
TASK_PRIORITIES = {item.value for item in TaskPriority}
APPROVAL_STATUSES = {item.value for item in ApprovalStatus}
AUDIT_ACTOR_TYPES = {item.value for item in AuditActorType}
RISK_LEVELS = {item.value for item in RiskLevel}


class TaskEngineModel(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        use_enum_values=True,
        str_strip_whitespace=True,
    )


class Property(TaskEngineModel):
    id: str
    name: str
    opera_cloud_enabled: bool = Field(default=False, alias="operaCloudEnabled")
    timezone: str = "America/Chicago"


class Room(TaskEngineModel):
    id: str
    property_id: str = Field(alias="propertyId")
    room_number: str = Field(alias="roomNumber")
    room_type: str = Field(alias="roomType")
    opera_status: Optional[str] = Field(default=None, alias="operaStatus")
    patelrep_status: Optional[str] = Field(default=None, alias="patelrepStatus")
    occupancy_status: Optional[str] = Field(default=None, alias="occupancyStatus")
    arrival_departure_context: dict[str, Any] = Field(
        default_factory=dict, alias="arrivalDepartureContext"
    )
    assigned_housekeeper: Optional[str] = Field(
        default=None, alias="assignedHousekeeper"
    )
    due_time: Optional[datetime] = Field(default=None, alias="dueTime")
    open_issues: list[dict[str, Any]] = Field(default_factory=list, alias="openIssues")
    mismatch_flag: bool = Field(default=False, alias="mismatchFlag")


class StaffUser(TaskEngineModel):
    id: str
    property_id: str = Field(alias="propertyId")
    full_name: str = Field(alias="fullName")
    department: DepartmentCode
    role: str
    is_active: bool = Field(default=True, alias="isActive")


class Department(TaskEngineModel):
    id: str
    property_id: str = Field(alias="propertyId")
    code: DepartmentCode
    name: str


class Task(TaskEngineModel):
    id: str
    property_id: str = Field(alias="propertyId")
    category: TaskCategory
    status: TaskStatus = TaskStatus.NEW
    priority: TaskPriority = TaskPriority.NORMAL
    title: str
    room_id: Optional[str] = Field(default=None, alias="roomId")
    room_or_area: Optional[str] = Field(default=None, alias="roomOrArea")
    issue_category: Optional[str] = Field(default=None, alias="issueCategory")
    guest_facing: bool = Field(default=False, alias="guestFacing")
    blocked_reason: Optional[str] = Field(default=None, alias="blockedReason")
    assigned_tech: Optional[str] = Field(default=None, alias="assignedTech")
    photos: list[str] = Field(default_factory=list)
    completion_verification: dict[str, Any] = Field(
        default_factory=dict, alias="completionVerification"
    )


class TaskCreateInput(TaskEngineModel):
    title: str = Field(min_length=1, max_length=120)
    category: TaskCategory
    priority: TaskPriority = TaskPriority.NORMAL
    description: Optional[str] = Field(default=None, max_length=2000)
    room_id: Optional[str] = Field(default=None, alias="roomId")
    department_id: Optional[str] = Field(default=None, alias="departmentId")
    assigned_to: Optional[str] = Field(default=None, alias="assignedTo")
    due_at: Optional[datetime] = Field(default=None, alias="dueAt")
    room_or_area: Optional[str] = Field(default=None, alias="roomOrArea")
    issue_category: Optional[str] = Field(default=None, alias="issueCategory")
    guest_facing: bool = Field(default=False, alias="guestFacing")
    blocked_reason: Optional[str] = Field(default=None, alias="blockedReason")
    assigned_tech: Optional[str] = Field(default=None, alias="assignedTech")
    completion_verification: dict[str, Any] = Field(
        default_factory=dict, alias="completionVerification"
    )
    metadata: dict[str, Any] = Field(default_factory=dict)


class TaskAssignment(TaskEngineModel):
    id: str
    property_id: str = Field(alias="propertyId")
    task_id: str = Field(alias="taskId")
    assigned_to: str = Field(alias="assignedTo")
    assigned_by: str = Field(alias="assignedBy")
    status: str = "active"


class TaskNote(TaskEngineModel):
    id: str
    property_id: str = Field(alias="propertyId")
    task_id: str = Field(alias="taskId")
    author_user_id: str = Field(alias="authorUserId")
    body: str


class TaskPhoto(TaskEngineModel):
    id: str
    property_id: str = Field(alias="propertyId")
    task_id: str = Field(alias="taskId")
    storage_url: str = Field(alias="storageUrl")
    content_type: Optional[str] = Field(default=None, alias="contentType")
    byte_size: Optional[int] = Field(default=None, alias="byteSize")


class ApprovalRequest(TaskEngineModel):
    id: str
    property_id: str = Field(alias="propertyId")
    proposed_action: str = Field(alias="proposedAction")
    proposed_payload: dict[str, Any] = Field(alias="proposedPayload")
    risk_level: RiskLevel = Field(alias="riskLevel")
    requested_by_agent_id: str = Field(alias="requestedByAgentId")
    approved_by_user_id: Optional[str] = Field(default=None, alias="approvedByUserId")
    status: ApprovalStatus = ApprovalStatus.PENDING
    edited_payload: Optional[dict[str, Any]] = Field(
        default=None, alias="editedPayload"
    )


class AuditEvent(TaskEngineModel):
    id: str
    actor_type: AuditActorType = Field(alias="actorType")
    actor_id: Optional[str] = Field(default=None, alias="actorId")
    property_id: str = Field(alias="propertyId")
    room_id: Optional[str] = Field(default=None, alias="roomId")
    task_id: Optional[str] = Field(default=None, alias="taskId")
    event_type: str = Field(alias="eventType")
    before_snapshot_ref: Optional[dict[str, Any]] = Field(
        default=None, alias="beforeSnapshotRef"
    )
    after_snapshot_ref: Optional[dict[str, Any]] = Field(
        default=None, alias="afterSnapshotRef"
    )
    action_attempted: Optional[str] = Field(default=None, alias="actionAttempted")
    verifier_result: Optional[dict[str, Any]] = Field(
        default=None, alias="verifierResult"
    )
    confidence: Optional[float] = None
    error_message: Optional[str] = Field(default=None, alias="errorMessage")
    timestamp: datetime


class PmsSnapshot(TaskEngineModel):
    id: str
    property_id: str = Field(alias="propertyId")
    provider: str = "opera_cloud"
    payload: dict[str, Any]
    captured_at: datetime = Field(alias="capturedAt")


class AgentRun(TaskEngineModel):
    id: str
    property_id: str = Field(alias="propertyId")
    agent_name: str = Field(alias="agentName")
    status: str
    input_payload: dict[str, Any] = Field(default_factory=dict, alias="inputPayload")
    output_payload: dict[str, Any] = Field(default_factory=dict, alias="outputPayload")


class EscalationEvent(TaskEngineModel):
    id: str
    property_id: str = Field(alias="propertyId")
    task_id: str = Field(alias="taskId")
    reason: str
    escalated_by_actor_type: AuditActorType = Field(alias="escalatedByActorType")
    escalated_by_actor_id: Optional[str] = Field(
        default=None, alias="escalatedByActorId"
    )

from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime, date


class APIResponse(BaseModel):
    data: Any
    meta: Optional[dict] = None


class ErrorResponse(BaseModel):
    error: dict


class RoomStatusResponse(BaseModel):
    room_id: str
    room_number: str
    floor: int
    status: str
    assigned_to: Optional[dict] = None
    vip_flag: bool = False
    guest_name: Optional[str] = None
    checkin_time: Optional[datetime] = None
    risk_level: Optional[str] = None
    predicted_ready_at: Optional[datetime] = None


class TaskResponse(BaseModel):
    id: str
    task_number: int
    title: str
    task_type: str
    priority: str
    status: str
    room_id: Optional[str] = None
    assigned_to: Optional[dict] = None
    due_at: Optional[datetime] = None
    created_at: datetime


class WorkOrderResponse(BaseModel):
    id: str
    work_order_number: int
    title: str
    category: str
    priority: str
    status: str
    room_id: Optional[str] = None
    assigned_to: Optional[dict] = None
    due_at: Optional[datetime] = None
    sla_breached: bool = False
    created_at: datetime


class CopilotResponse(BaseModel):
    response_type: str  # task_preview | answer | insight | error
    message: str
    task_preview: Optional[dict] = None
    actions: Optional[List[dict]] = None
    credits_used: float = 0
    model_used: str = ""


class RiskAlertResponse(BaseModel):
    housekeeping_risks: List[dict] = []
    maintenance_risks: List[dict] = []
    sla_breaches: List[dict] = []


class CreditLedgerResponse(BaseModel):
    period: str
    credits_included: int
    credits_used: int
    credits_remaining: int
    overage_credits: int
    overage_cost_cents: int
    cap_cents: Optional[int] = None

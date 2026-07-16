"""Texas safety, training, controlled incident, and drill workflows."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from core.database import supabase
from middleware.auth import CurrentUser, get_current_user, require_role
from models.requests import (
    AssignSafetyTrainingRequest,
    CheckInEmergencyDrillRequest,
    CompleteSafetyTrainingRequest,
    CreateChemicalInventoryItemRequest,
    CreateControlledIncidentRequest,
    CreateEmergencyDrillRequest,
    CreateIncidentEventRequest,
    CreateSafetyTrainingCourseRequest,
)
from services.safety.contracts import (
    build_incident_event,
    calculate_next_training_due_date,
    get_training_status,
)


router = APIRouter(prefix="/safety", tags=["safety"])
MANAGER_ROLES = ("gm", "housekeeping_supervisor", "chief_engineer")


def _record_audit_event(current_user: CurrentUser, resource_type: str, resource_id: str, action: str, new_state: dict) -> None:
    supabase.table("operational_audit_events").insert({
        "tenant_id": current_user.hotel_id,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "action": action,
        "actor_id": current_user.user_id,
        "actor_role": current_user.role,
        "old_state": {},
        "new_state": new_state,
        "source": "api",
    }).execute()


def _require_employee(employee_id: str, current_user: CurrentUser) -> dict:
    result = supabase.table("user_roles").select("user_id, role").eq("tenant_id", current_user.hotel_id).eq("user_id", employee_id).eq("is_active", True).maybe_single().execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Employee is not active at this property.")
    return result.data


@router.post("/training/courses")
async def create_training_course(request: CreateSafetyTrainingCourseRequest, current_user: CurrentUser = Depends(require_role("gm"))):
    record = supabase.table("safety_training_courses").insert({"tenant_id": current_user.hotel_id, **request.model_dump(), "created_by": current_user.user_id}).execute().data[0]
    _record_audit_event(current_user, "safety_training_course", record["id"], "safety_training_course.created", {"course_name": record["course_name"]})
    return {"data": record}


@router.get("/training/status")
async def list_training_status(current_user: CurrentUser = Depends(get_current_user)):
    courses = supabase.table("safety_training_courses").select("*").eq("tenant_id", current_user.hotel_id).eq("is_active", True).execute().data or []
    assignments = supabase.table("safety_training_assignments").select("*").eq("tenant_id", current_user.hotel_id).execute().data or []
    employees = supabase.table("user_roles").select("user_id, role").eq("tenant_id", current_user.hotel_id).eq("is_active", True).execute().data or []
    today = date.today()
    rows = []
    for employee in employees:
        for course in courses:
            required = employee["role"] in (course.get("covered_roles") or [])
            assignment = next((item for item in assignments if item["employee_id"] == employee["user_id"] and item["course_id"] == course["id"] and not item.get("completed_at")), None)
            rows.append({"employee_id": employee["user_id"], "employee_role": employee["role"], "course_id": course["id"], "course_name": course["course_name"], "provider_name": course["provider_name"], "assignment_id": assignment.get("id") if assignment else None, "due_date": assignment.get("due_date") if assignment else None, "status": get_training_status(required=required, completed_at=None, due_date=date.fromisoformat(assignment["due_date"]) if assignment else None, today=today)})
    return {"data": rows}


@router.post("/training/courses/{course_id}/assignments")
async def assign_training(course_id: str, request: AssignSafetyTrainingRequest, current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES))):
    course = supabase.table("safety_training_courses").select("*").eq("id", course_id).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    if not course or not course.data:
        raise HTTPException(status_code=404, detail="Safety training course not found.")
    employee = _require_employee(request.employee_id, current_user)
    if employee["role"] not in (course.data.get("covered_roles") or []):
        raise HTTPException(status_code=409, detail="This employee is not covered by the selected course.")
    due_date = request.hired_on + timedelta(days=course.data["new_hire_deadline_days"])
    record = supabase.table("safety_training_assignments").insert({"tenant_id": current_user.hotel_id, "course_id": course_id, "employee_id": request.employee_id, "due_date": due_date.isoformat(), "assigned_by": current_user.user_id}).execute().data[0]
    _record_audit_event(current_user, "safety_training_assignment", record["id"], "safety_training_assignment.assigned", {"due_date": record["due_date"]})
    return {"data": record}


@router.post("/training/assignments/{assignment_id}/complete")
async def complete_training(assignment_id: str, request: CompleteSafetyTrainingRequest, current_user: CurrentUser = Depends(get_current_user)):
    assignment = supabase.table("safety_training_assignments").select("*, safety_training_courses(recurrence_months)").eq("id", assignment_id).eq("tenant_id", current_user.hotel_id).eq("employee_id", current_user.user_id).maybe_single().execute()
    if not assignment or not assignment.data:
        raise HTTPException(status_code=404, detail="Training assignment not found.")
    completed_at = datetime.now(timezone.utc)
    record = supabase.table("safety_training_assignments").update({"completed_at": completed_at.isoformat(), "certificate_evidence_id": request.certificate_evidence_id}).eq("id", assignment_id).eq("tenant_id", current_user.hotel_id).execute().data[0]
    recurrence_months = assignment.data["safety_training_courses"]["recurrence_months"]
    supabase.table("safety_training_assignments").insert({"tenant_id": current_user.hotel_id, "course_id": assignment.data["course_id"], "employee_id": current_user.user_id, "due_date": calculate_next_training_due_date(completed_at.date(), recurrence_months).isoformat(), "assigned_by": current_user.user_id}).execute()
    _record_audit_event(current_user, "safety_training_assignment", assignment_id, "safety_training_assignment.completed", {"certificate_evidence_id": request.certificate_evidence_id})
    return {"data": record}


@router.post("/incidents")
async def create_controlled_incident(request: CreateControlledIncidentRequest, current_user: CurrentUser = Depends(get_current_user)):
    incident = supabase.table("controlled_incidents").insert({"tenant_id": current_user.hotel_id, **request.model_dump(mode="json"), "created_by": current_user.user_id}).execute().data[0]
    event = build_incident_event(incident_id=incident["id"], event_type="created", detail="Controlled incident recorded.", actor_id=current_user.user_id, actor_role=current_user.role, now=datetime.now(timezone.utc))
    supabase.table("controlled_incident_events").insert({"tenant_id": current_user.hotel_id, **event}).execute()
    _record_audit_event(current_user, "controlled_incident", incident["id"], "controlled_incident.created", {"incident_type": incident["incident_type"]})
    return {"data": incident}


@router.get("/incidents")
async def list_controlled_incidents(current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES))):
    records = supabase.table("controlled_incidents").select("*, controlled_incident_events(*)").eq("tenant_id", current_user.hotel_id).order("created_at", desc=True).execute().data or []
    return {"data": records}


@router.post("/incidents/{incident_id}/events")
async def append_incident_event(incident_id: str, request: CreateIncidentEventRequest, current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES))):
    incident = supabase.table("controlled_incidents").select("id").eq("id", incident_id).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    if not incident or not incident.data:
        raise HTTPException(status_code=404, detail="Controlled incident not found.")
    event = build_incident_event(incident_id=incident_id, event_type=request.event_type, detail=request.detail, actor_id=current_user.user_id, actor_role=current_user.role, now=datetime.now(timezone.utc))
    record = supabase.table("controlled_incident_events").insert({"tenant_id": current_user.hotel_id, **event}).execute().data[0]
    _record_audit_event(current_user, "controlled_incident", incident_id, f"controlled_incident.{request.event_type}", {"event_id": record["id"]})
    return {"data": record}


@router.get("/chemicals")
async def list_chemicals(current_user: CurrentUser = Depends(get_current_user)):
    return {"data": supabase.table("chemical_inventory").select("*").eq("tenant_id", current_user.hotel_id).order("product_name").execute().data or []}


@router.post("/chemicals")
async def create_chemical(request: CreateChemicalInventoryItemRequest, current_user: CurrentUser = Depends(require_role("gm", "chief_engineer", "engineer"))):
    record = supabase.table("chemical_inventory").insert({"tenant_id": current_user.hotel_id, **request.model_dump(), "created_by": current_user.user_id}).execute().data[0]
    _record_audit_event(current_user, "chemical_inventory", record["id"], "chemical_inventory.created", {"product_name": record["product_name"]})
    return {"data": record}


@router.get("/emergency/plans")
async def list_emergency_plans(current_user: CurrentUser = Depends(get_current_user)):
    documents = supabase.table("controlled_documents").select("id, title, version_number, effective_date, document_acknowledgements!left(id, acknowledged_at, assigned_to)").eq("tenant_id", current_user.hotel_id).eq("document_type", "safety").eq("approval_state", "approved").execute().data or []
    for document in documents:
        document["acknowledged_at"] = next((item.get("acknowledged_at") for item in document.pop("document_acknowledgements", []) if item.get("assigned_to") == current_user.user_id), None)
    return {"data": documents}


@router.post("/emergency/drills")
async def create_emergency_drill(request: CreateEmergencyDrillRequest, current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES))):
    record = supabase.table("emergency_drills").insert({"tenant_id": current_user.hotel_id, **request.model_dump(mode="json"), "created_by": current_user.user_id}).execute().data[0]
    _record_audit_event(current_user, "emergency_drill", record["id"], "emergency_drill.recorded", {"drill_type": record["drill_type"]})
    return {"data": record}


@router.post("/emergency/drills/{drill_id}/check-in")
async def check_in_emergency_drill(drill_id: str, request: CheckInEmergencyDrillRequest, current_user: CurrentUser = Depends(get_current_user)):
    drill = supabase.table("emergency_drills").select("id").eq("id", drill_id).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    if not drill or not drill.data:
        raise HTTPException(status_code=404, detail="Emergency drill not found.")
    record = supabase.table("emergency_drill_participants").upsert({"tenant_id": current_user.hotel_id, "drill_id": drill_id, "employee_id": current_user.user_id, "accountability_status": request.accountability_status, "acknowledged_at": datetime.now(timezone.utc).isoformat()}, on_conflict="drill_id,employee_id").execute().data[0]
    return {"data": record}

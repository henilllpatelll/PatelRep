"""Texas safety, training, controlled incident, and drill workflows."""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from core.database import supabase
from core.roles import MANAGER_ROLES
from middleware.auth import CurrentUser, get_current_user, require_role
from models.requests import (
    AssignSafetyTrainingRequest,
    CheckInEmergencyDrillRequest,
    CompleteSafetyTrainingRequest,
    CreateChemicalInventoryItemRequest,
    CreateControlledIncidentRequest,
    CreateEmergencyContactRequest,
    CreateEmergencyDrillRequest,
    CreateIncidentEventRequest,
    CreateSafetyTrainingCourseRequest,
)
from services.safety.contracts import (
    build_incident_event,
    calculate_next_training_due_date,
    get_training_status,
    is_incident_visible_to,
)


router = APIRouter(prefix="/safety", tags=["safety"])


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


def _require_evidence_record(evidence_id: str | None, current_user: CurrentUser, *, label: str) -> None:
    if not evidence_id:
        return
    result = (
        supabase.table("evidence_records").select("id").eq("id", evidence_id)
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail=f"{label} evidence was not found at this property.")


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
        if current_user.role not in MANAGER_ROLES and employee["user_id"] != current_user.user_id:
            continue
        for course in courses:
            required = employee["role"] in (course.get("covered_roles") or [])
            employee_assignments = [
                item for item in assignments
                if item["employee_id"] == employee["user_id"] and item["course_id"] == course["id"]
            ]
            assignment = next((item for item in employee_assignments if not item.get("completed_at")), None)
            completed = sorted(
                (item for item in employee_assignments if item.get("completed_at")),
                key=lambda item: item["completed_at"], reverse=True,
            )
            last_completed_on = (
                datetime.fromisoformat(completed[0]["completed_at"].replace("Z", "+00:00")).date()
                if completed else None
            )
            due_date = (
                date.fromisoformat(assignment["due_date"])
                if assignment else calculate_next_training_due_date(last_completed_on, course["recurrence_months"])
                if last_completed_on else None
            )
            rows.append({
                "employee_id": employee["user_id"], "employee_role": employee["role"],
                "course_id": course["id"], "course_name": course["course_name"],
                "provider_name": course["provider_name"], "assignment_id": assignment.get("id") if assignment else None,
                "due_date": due_date.isoformat() if due_date else None,
                "status": get_training_status(
                    required=required,
                    completed_at=datetime.now(timezone.utc) if last_completed_on and due_date and due_date > today else None,
                    due_date=due_date, today=today,
                ),
            })
    return {"data": rows}


@router.post("/training/courses/{course_id}/assignments")
async def assign_training(course_id: str, request: AssignSafetyTrainingRequest, current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES))):
    del course_id, request, current_user
    raise HTTPException(status_code=409, detail="Safety assignments are generated by the compliance scheduler.")


@router.post("/training/assignments/{assignment_id}/complete")
async def complete_training(assignment_id: str, request: CompleteSafetyTrainingRequest, current_user: CurrentUser = Depends(get_current_user)):
    assignment = supabase.table("safety_training_assignments").select("*, safety_training_courses(recurrence_months)").eq("id", assignment_id).eq("tenant_id", current_user.hotel_id).eq("employee_id", current_user.user_id).maybe_single().execute()
    if not assignment or not assignment.data:
        raise HTTPException(status_code=404, detail="Training assignment not found.")
    _require_evidence_record(request.certificate_evidence_id, current_user, label="Certificate")
    completed_at = datetime.now(timezone.utc)
    record = supabase.table("safety_training_assignments").update({"completed_at": completed_at.isoformat(), "certificate_evidence_id": request.certificate_evidence_id}).eq("id", assignment_id).eq("tenant_id", current_user.hotel_id).execute().data[0]
    _record_audit_event(current_user, "safety_training_assignment", assignment_id, "safety_training_assignment.completed", {"certificate_evidence_id": request.certificate_evidence_id})
    return {"data": record}


@router.get("/training/export")
async def export_training_compliance(current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES))):
    status = await list_training_status(current_user)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["employee_id", "employee_role", "course_id", "course_name", "provider_name", "due_date", "status"])
    writer.writeheader()
    for row in status["data"]:
        writer.writerow({key: row[key] for key in writer.fieldnames})
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=safety-training-compliance.csv"})


@router.post("/incidents")
async def create_controlled_incident(request: CreateControlledIncidentRequest, current_user: CurrentUser = Depends(get_current_user)):
    incident = supabase.table("controlled_incidents").insert({"tenant_id": current_user.hotel_id, **request.model_dump(mode="json"), "created_by": current_user.user_id}).execute().data[0]
    event = build_incident_event(incident_id=incident["id"], event_type="created", detail="Controlled incident recorded.", actor_id=current_user.user_id, actor_role=current_user.role, now=datetime.now(timezone.utc))
    supabase.rpc("append_controlled_incident_event", {
        "p_incident_id": incident["id"], "p_tenant_id": current_user.hotel_id,
        "p_event_type": event["event_type"], "p_detail": event["detail"],
        "p_actor_id": current_user.user_id, "p_actor_role": current_user.role,
        "p_occurred_at": event["occurred_at"],
    }).execute()
    _record_audit_event(current_user, "controlled_incident", incident["id"], "controlled_incident.created", {"incident_type": incident["incident_type"]})
    return {"data": incident}


@router.get("/incidents")
async def list_controlled_incidents(current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES))):
    records = supabase.table("controlled_incidents").select("*, controlled_incident_events(*)").eq("tenant_id", current_user.hotel_id).order("created_at", desc=True).execute().data or []
    return {"data": records}


@router.get("/incidents/{incident_id}")
async def get_controlled_incident(incident_id: str, current_user: CurrentUser = Depends(get_current_user)):
    incident = (
        supabase.table("controlled_incidents").select("*, controlled_incident_events(*)")
        .eq("id", incident_id).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    )
    if not incident.data:
        raise HTTPException(status_code=404, detail="Controlled incident not found.")
    if not is_incident_visible_to(
        incident_creator_id=incident.data["created_by"], requester_id=current_user.user_id,
        requester_role=current_user.role,
    ):
        raise HTTPException(status_code=403, detail="You may only view controlled incidents you filed.")
    return {"data": incident.data}


@router.post("/incidents/{incident_id}/events")
async def append_incident_event(incident_id: str, request: CreateIncidentEventRequest, current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES))):
    incident = supabase.table("controlled_incidents").select("id").eq("id", incident_id).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    if not incident or not incident.data:
        raise HTTPException(status_code=404, detail="Controlled incident not found.")
    event = build_incident_event(incident_id=incident_id, event_type=request.event_type, detail=request.detail, actor_id=current_user.user_id, actor_role=current_user.role, now=datetime.now(timezone.utc))
    result = supabase.rpc("append_controlled_incident_event", {
        "p_incident_id": incident_id, "p_tenant_id": current_user.hotel_id,
        "p_event_type": event["event_type"], "p_detail": event["detail"],
        "p_actor_id": current_user.user_id, "p_actor_role": current_user.role,
        "p_occurred_at": event["occurred_at"],
    }).execute()
    record = (result.data or [None])[0]
    if not record:
        raise HTTPException(status_code=500, detail="Unable to append controlled incident event.")
    _record_audit_event(current_user, "controlled_incident", incident_id, f"controlled_incident.{request.event_type}", {"event_id": record["id"]})
    return {"data": record}


@router.get("/chemicals")
async def list_chemicals(current_user: CurrentUser = Depends(get_current_user)):
    return {"data": supabase.table("chemical_inventory").select("*").eq("tenant_id", current_user.hotel_id).order("product_name").execute().data or []}


@router.post("/chemicals")
async def create_chemical(request: CreateChemicalInventoryItemRequest, current_user: CurrentUser = Depends(require_role("gm", "chief_engineer", "engineer"))):
    _require_evidence_record(request.sds_evidence_id, current_user, label="SDS")
    record = supabase.table("chemical_inventory").insert({"tenant_id": current_user.hotel_id, **request.model_dump(), "created_by": current_user.user_id}).execute().data[0]
    _record_audit_event(current_user, "chemical_inventory", record["id"], "chemical_inventory.created", {"product_name": record["product_name"]})
    return {"data": record}


@router.get("/safety-information")
async def get_safety_information(current_user: CurrentUser = Depends(get_current_user)):
    chemicals = (
        supabase.table("chemical_inventory").select("*").eq("tenant_id", current_user.hotel_id)
        .order("product_name").execute().data or []
    )
    evidence_ids = [item["sds_evidence_id"] for item in chemicals if item.get("sds_evidence_id")]
    evidence_by_id = {}
    if evidence_ids:
        records = supabase.table("evidence_records").select("id, storage_path").eq("tenant_id", current_user.hotel_id).in_("id", evidence_ids).execute().data or []
        evidence_by_id = {record["id"]: record for record in records}
    for chemical in chemicals:
        record = evidence_by_id.get(chemical.get("sds_evidence_id"))
        chemical["sds_url"] = (
            supabase.storage.from_("evidence-files").create_signed_url(record["storage_path"], 3600).get("signedURL")
            if record and record.get("storage_path") else None
        )
    procedures = (
        supabase.table("controlled_documents").select("id, title, version_number, effective_date")
        .eq("tenant_id", current_user.hotel_id).eq("document_type", "safety")
        .eq("approval_state", "approved").execute().data or []
    )
    return {"data": {"chemicals": chemicals, "procedures": procedures}}


@router.get("/emergency/contacts")
async def list_emergency_contacts(current_user: CurrentUser = Depends(get_current_user)):
    records = supabase.table("emergency_contacts").select("*").eq("tenant_id", current_user.hotel_id).order("is_primary", desc=True).execute().data or []
    return {"data": records}


@router.post("/emergency/contacts")
async def create_emergency_contact(request: CreateEmergencyContactRequest, current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES))):
    record = supabase.table("emergency_contacts").insert({"tenant_id": current_user.hotel_id, **request.model_dump(), "created_by": current_user.user_id}).execute().data[0]
    _record_audit_event(current_user, "emergency_contact", record["id"], "emergency_contact.created", {"role_label": record["role_label"]})
    return {"data": record}


@router.get("/emergency/plans")
async def list_emergency_plans(current_user: CurrentUser = Depends(get_current_user)):
    documents = supabase.table("controlled_documents").select("id, title, version_number, effective_date, document_acknowledgements!left(id, acknowledged_at, assigned_to)").eq("tenant_id", current_user.hotel_id).eq("document_type", "safety").eq("approval_state", "approved").execute().data or []
    for document in documents:
        document["acknowledged_at"] = next((item.get("acknowledged_at") for item in document.pop("document_acknowledgements", []) if item.get("assigned_to") == current_user.user_id), None)
    return {"data": documents}


@router.post("/emergency/drills")
async def create_emergency_drill(request: CreateEmergencyDrillRequest, current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES))):
    _require_evidence_record(request.follow_up_evidence_id, current_user, label="Drill follow-up")
    payload = request.model_dump(mode="json", exclude={"follow_up_evidence_id"})
    record = supabase.table("emergency_drills").insert({"tenant_id": current_user.hotel_id, **payload, "created_by": current_user.user_id}).execute().data[0]
    if request.follow_up_evidence_id:
        supabase.table("emergency_drill_follow_up_evidence").insert({"tenant_id": current_user.hotel_id, "drill_id": record["id"], "evidence_id": request.follow_up_evidence_id, "linked_by": current_user.user_id}).execute()
    _record_audit_event(current_user, "emergency_drill", record["id"], "emergency_drill.recorded", {"drill_type": record["drill_type"]})
    return {"data": record}


@router.post("/emergency/drills/{drill_id}/check-in")
async def check_in_emergency_drill(drill_id: str, request: CheckInEmergencyDrillRequest, current_user: CurrentUser = Depends(get_current_user)):
    drill = supabase.table("emergency_drills").select("id").eq("id", drill_id).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    if not drill or not drill.data:
        raise HTTPException(status_code=404, detail="Emergency drill not found.")
    record = supabase.table("emergency_drill_participants").upsert({"tenant_id": current_user.hotel_id, "drill_id": drill_id, "employee_id": current_user.user_id, "accountability_status": request.accountability_status, "acknowledged_at": datetime.now(timezone.utc).isoformat()}, on_conflict="drill_id,employee_id").execute().data[0]
    return {"data": record}

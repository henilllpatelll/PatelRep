"""Tenant-scoped controlled documents, proof, acknowledgements, and exceptions."""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile

from core.database import supabase
from middleware.auth import CurrentUser, get_current_user, require_role
from models.requests import (
    AssignControlledDocumentRequest,
    CreateControlledDocumentRequest,
    CreateEvidenceRecordRequest,
    UpdatePropertyApplicabilityRequest,
)
from services.evidence.contracts import (
    build_exception_queue,
    build_reminder_actions,
    create_superseding_version,
)

router = APIRouter(prefix="/evidence", tags=["evidence"])

MAX_EVIDENCE_UPLOAD_BYTES = 10 * 1024 * 1024
SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]")
ALLOWED_EVIDENCE_CONTENT_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}


def _record_audit_event(
    *, current_user: CurrentUser, resource_type: str, resource_id: str,
    action: str, old_state: dict | None = None, new_state: dict | None = None,
) -> None:
    supabase.table("operational_audit_events").insert({
        "tenant_id": current_user.hotel_id,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "action": action,
        "actor_id": current_user.user_id,
        "actor_role": current_user.role,
        "old_state": old_state or {},
        "new_state": new_state or {},
        "source": "api",
    }).execute()


def _get_document(document_id: str, current_user: CurrentUser) -> dict:
    result = (
        supabase.table("controlled_documents").select("*").eq("id", document_id)
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Controlled document not found.")
    return result.data


@router.get("/applicability")
async def get_property_applicability(current_user: CurrentUser = Depends(get_current_user)):
    result = (
        supabase.table("property_applicability").select("*")
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    )
    return {"data": result.data or {"facilities": [], "services": [], "brand_requirements": []}}


@router.put("/applicability")
async def update_property_applicability(
    request: UpdatePropertyApplicabilityRequest,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    payload = {"tenant_id": current_user.hotel_id, **request.model_dump(), "updated_by": current_user.user_id}
    result = supabase.table("property_applicability").upsert(payload, on_conflict="tenant_id").execute()
    record = (result.data or [payload])[0]
    _record_audit_event(current_user=current_user, resource_type="property_applicability", resource_id=current_user.hotel_id, action="property_applicability.updated", new_state=request.model_dump(mode="json"))
    return {"data": record}


@router.get("/documents")
async def list_controlled_documents(current_user: CurrentUser = Depends(get_current_user)):
    result = (
        supabase.table("controlled_documents").select("*").eq("tenant_id", current_user.hotel_id)
        .order("title").order("version_number", desc=True).execute()
    )
    return {"data": result.data or []}


@router.post("/documents")
async def create_controlled_document(
    request: CreateControlledDocumentRequest,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    payload = {
        "tenant_id": current_user.hotel_id,
        **request.model_dump(mode="json"),
        "owner_id": request.owner_id or current_user.user_id,
        "created_by": current_user.user_id,
        "version_number": 1,
        "approval_state": "draft",
    }
    result = supabase.table("controlled_documents").insert(payload).execute()
    record = result.data[0]
    _record_audit_event(current_user=current_user, resource_type="controlled_document", resource_id=record["id"], action="controlled_document.created", new_state={"approval_state": "draft", "version_number": 1})
    return {"data": record}


@router.post("/documents/{document_id}/approve")
async def approve_controlled_document(
    document_id: str,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    document = _get_document(document_id, current_user)
    result = (
        supabase.table("controlled_documents").update({
            "approval_state": "approved", "approver_id": current_user.user_id,
            "approved_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", document_id).eq("tenant_id", current_user.hotel_id).execute()
    )
    record = result.data[0]
    _record_audit_event(current_user=current_user, resource_type="controlled_document", resource_id=document_id, action="controlled_document.approved", old_state={"approval_state": document["approval_state"]}, new_state={"approval_state": "approved"})
    return {"data": record}


@router.post("/documents/{document_id}/supersede")
async def supersede_controlled_document(
    document_id: str,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    previous = _get_document(document_id, current_user)
    try:
        successor = create_superseding_version(previous, actor_id=current_user.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    successor["tenant_id"] = current_user.hotel_id
    successor["document_type"] = previous["document_type"]
    successor["applicability"] = previous.get("applicability") or []
    successor["created_by"] = current_user.user_id
    new_record = supabase.table("controlled_documents").insert(successor).execute().data[0]
    supabase.table("controlled_documents").update({"approval_state": "superseded", "superseded_at": datetime.now(timezone.utc).isoformat()}).eq("id", document_id).eq("tenant_id", current_user.hotel_id).execute()
    _record_audit_event(current_user=current_user, resource_type="controlled_document", resource_id=document_id, action="controlled_document.superseded", old_state={"approval_state": "approved"}, new_state={"successor_id": new_record["id"]})
    return {"data": new_record}


@router.post("/documents/{document_id}/assignments")
async def assign_controlled_document(
    document_id: str,
    request: AssignControlledDocumentRequest,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor", "engineer")),
):
    _get_document(document_id, current_user)
    staff = supabase.table("user_roles").select("user_id").eq("tenant_id", current_user.hotel_id).eq("user_id", request.assigned_to).eq("is_active", True).maybe_single().execute()
    if not staff.data:
        raise HTTPException(status_code=404, detail="Assignee is not active at this property.")
    payload = {"tenant_id": current_user.hotel_id, "document_id": document_id, **request.model_dump(mode="json"), "assigned_by": current_user.user_id}
    record = supabase.table("document_acknowledgements").insert(payload).execute().data[0]
    _record_audit_event(current_user=current_user, resource_type="document_acknowledgement", resource_id=record["id"], action="document_acknowledgement.assigned", new_state={"due_date": payload["due_date"]})
    return {"data": record}


@router.get("/my-acknowledgements")
async def list_my_acknowledgements(current_user: CurrentUser = Depends(get_current_user)):
    result = (
        supabase.table("document_acknowledgements").select("*, controlled_documents(title, version_number, approval_state)")
        .eq("tenant_id", current_user.hotel_id).eq("assigned_to", current_user.user_id).order("due_date").execute()
    )
    return {"data": result.data or []}


@router.post("/acknowledgements/{assignment_id}/acknowledge")
async def acknowledge_controlled_document(assignment_id: str, current_user: CurrentUser = Depends(get_current_user)):
    assignment = (
        supabase.table("document_acknowledgements").select("*").eq("id", assignment_id)
        .eq("tenant_id", current_user.hotel_id).eq("assigned_to", current_user.user_id).maybe_single().execute()
    )
    if not assignment.data:
        raise HTTPException(status_code=404, detail="Document assignment not found.")
    if assignment.data.get("acknowledged_at"):
        return {"data": assignment.data}
    result = supabase.table("document_acknowledgements").update({"acknowledged_at": datetime.now(timezone.utc).isoformat(), "acknowledged_by": current_user.user_id}).eq("id", assignment_id).eq("tenant_id", current_user.hotel_id).execute()
    record = result.data[0]
    _record_audit_event(current_user=current_user, resource_type="document_acknowledgement", resource_id=assignment_id, action="document_acknowledgement.acknowledged", new_state={"acknowledged": True})
    return {"data": record}


@router.post("/records")
async def create_evidence_record(request: CreateEvidenceRecordRequest, current_user: CurrentUser = Depends(get_current_user)):
    payload = {"tenant_id": current_user.hotel_id, **request.model_dump(mode="json"), "collected_by": current_user.user_id, "collected_at": datetime.now(timezone.utc).isoformat()}
    record = supabase.table("evidence_records").insert(payload).execute().data[0]
    _record_audit_event(current_user=current_user, resource_type="evidence_record", resource_id=record["id"], action="evidence_record.collected", new_state={"evidence_type": record["evidence_type"]})
    return {"data": record}


@router.post("/records/{record_id}/file")
async def upload_evidence_file(record_id: str, file: UploadFile = File(...), current_user: CurrentUser = Depends(get_current_user)):
    record = (
        supabase.table("evidence_records").select("id").eq("id", record_id)
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    )
    if not record.data:
        raise HTTPException(status_code=404, detail="Evidence record not found.")
    if file.content_type not in ALLOWED_EVIDENCE_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Evidence must be a PDF, JPEG, PNG, or WebP file.")
    content = await file.read(MAX_EVIDENCE_UPLOAD_BYTES + 1)
    if len(content) > MAX_EVIDENCE_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Evidence file is too large. Maximum size is 10 MB.")
    filename = SAFE_FILENAME_RE.sub("_", file.filename or "evidence")
    path = f"{current_user.hotel_id}/{record_id}/{filename}"
    supabase.storage.from_("evidence-files").upload(path, content, {"content-type": file.content_type, "upsert": "false"})
    updated = supabase.table("evidence_records").update({"storage_path": path, "file_name": filename, "file_content_type": file.content_type}).eq("id", record_id).eq("tenant_id", current_user.hotel_id).execute().data[0]
    return {"data": updated}


@router.get("/exceptions")
async def list_evidence_exceptions(current_user: CurrentUser = Depends(get_current_user)):
    documents = supabase.table("controlled_documents").select("*").eq("tenant_id", current_user.hotel_id).execute().data or []
    assignments = supabase.table("document_acknowledgements").select("*, controlled_documents(title)").eq("tenant_id", current_user.hotel_id).execute().data or []
    for assignment in assignments:
        assignment["document_title"] = (assignment.get("controlled_documents") or {}).get("title")
    evidence = supabase.table("evidence_records").select("*").eq("tenant_id", current_user.hotel_id).execute().data or []
    return {"data": build_exception_queue(documents=documents, assignments=assignments, evidence=evidence, now=datetime.now(timezone.utc))}


@router.get("/exceptions/export")
async def export_evidence_exceptions(current_user: CurrentUser = Depends(require_role("gm"))):
    response = await list_evidence_exceptions(current_user)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["state", "kind", "reference_id", "label"])
    writer.writeheader()
    writer.writerows(response["data"])
    return Response(output.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=evidence-exceptions.csv"})


def run_evidence_reminders() -> int:
    """Create in-app reminder delivery records for due controlled-document work."""
    assignments = supabase.table("document_acknowledgements").select("*").execute().data or []
    actions = build_reminder_actions(assignments, now=datetime.now(timezone.utc))
    for action in actions:
        assignment = next(item for item in assignments if item["id"] == action["assignment_id"])
        if action["recipient_type"] == "staff":
            recipients = [action["recipient_id"]]
        else:
            role_rows = supabase.table("user_roles").select("user_id").eq("role", action["recipient_role"]).eq("tenant_id", assignment["tenant_id"]).eq("is_active", True).execute().data or []
            recipients = [row["user_id"] for row in role_rows]
        for recipient_id in recipients:
            notification = supabase.table("notifications").insert({"tenant_id": assignment["tenant_id"], "user_id": recipient_id, "type": "evidence_reminder", "title": "Document acknowledgement required", "body": f"A controlled document acknowledgement is {action['state'].replace('_', ' ')}.", "data": {"assignment_id": assignment["id"]}}).execute().data[0]
            supabase.table("notification_deliveries").insert({"tenant_id": assignment["tenant_id"], "notification_id": notification["id"], "user_id": recipient_id, "channel": "in_app", "status": "delivered"}).execute()
    return len(actions)

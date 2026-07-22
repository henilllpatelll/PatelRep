"""Tenant-scoped controlled documents, proof, acknowledgements, and exceptions."""

from __future__ import annotations

import csv
import io
import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile

from core.database import supabase
from middleware.auth import CurrentUser, get_current_user, require_role
from models.requests import (
    AssignControlledDocumentRequest,
    CreateControlledDocumentRequest,
    CreateEvidenceRecordRequest,
    DocumentLifecycleActionRequest,
    EvaluateDocumentCompetencyRequest,
    ExceptionActionRequest,
    UpdatePropertyApplicabilityRequest,
)
from services.evidence.contracts import (
    build_exception_queue,
    build_inspector_export_rows,
    build_reminder_actions,
    create_superseding_version,
    exception_lifecycle_state,
    is_applicable_to_property,
)

router = APIRouter(prefix="/evidence", tags=["evidence"])
logger = logging.getLogger(__name__)

MAX_EVIDENCE_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_EVIDENCE_CONTENT_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
EVIDENCE_CAPTURE_ROLES = (
    "housekeeper", "housekeeping_supervisor", "engineer", "chief_engineer", "front_desk", "gm",
)
COMPETENCY_MANAGER_ROLES = ("gm", "housekeeping_supervisor", "chief_engineer")
EVIDENCE_FILE_EXTENSIONS = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
RELATED_ENTITY_TABLES = {
    "staff": ("user_roles", "user_id"),
    "task": ("tasks", "id"),
    "asset": ("assets", "id"),
    "room": ("rooms", "id"),
    "inspection": ("inspections", "id"),
    "incident": ("controlled_incidents", "id"),
    "sop": ("sop_documents", "id"),
    "pm_completion": ("pm_completion_records", "id"),
}
EXCEPTION_REFERENCE_TABLES = {
    "document": ("controlled_documents", "Controlled document"),
    "acknowledgement": ("document_acknowledgements", "Document acknowledgement"),
    "evidence": ("evidence_records", "Evidence record"),
}


def _record_audit_event(
    *, current_user: CurrentUser, resource_type: str, resource_id: str,
    action: str, old_state: dict | None = None, new_state: dict | None = None,
    reason_code: str | None = None, reason_note: str | None = None,
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
        "reason_code": reason_code,
        "reason_note": reason_note,
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


def _get_evidence_record(record_id: str, current_user: CurrentUser) -> dict:
    result = (
        supabase.table("evidence_records").select("*").eq("id", record_id)
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Evidence record not found.")
    return result.data


def _require_same_tenant_evidence_links(
    request: CreateEvidenceRecordRequest, current_user: CurrentUser,
) -> None:
    if request.document_id:
        _get_document(request.document_id, current_user)
    if request.assignment_id:
        assignment = (
            supabase.table("document_acknowledgements").select("id, document_id")
            .eq("id", request.assignment_id).eq("tenant_id", current_user.hotel_id)
            .maybe_single().execute()
        )
        if not assignment.data:
            raise HTTPException(status_code=404, detail="Document assignment not found.")
        if request.document_id and assignment.data.get("document_id") != request.document_id:
            raise HTTPException(status_code=409, detail="Document assignment does not belong to the linked controlled document.")
    if request.related_entity_type and request.related_entity_id:
        table, key = RELATED_ENTITY_TABLES[request.related_entity_type]
        entity = (
            supabase.table(table).select(key).eq(key, request.related_entity_id)
            .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
        )
        if not entity.data:
            raise HTTPException(
                status_code=404,
                detail=f"Related {request.related_entity_type} not found at this property.",
            )


def _evidence_storage_path(current_user: CurrentUser, record_id: str, content_type: str) -> str:
    return f"{current_user.hotel_id}/{record_id}/{secrets.token_urlsafe(24)}.{EVIDENCE_FILE_EXTENSIONS[content_type]}"


def _create_evidence_signed_url(storage_path: str) -> str:
    try:
        response = supabase.storage.from_("evidence-files").create_signed_url(storage_path, 3600)
        return (response or {}).get("signedURL") or ""
    except Exception:
        logger.warning("Evidence signed URL creation failed for path=%s", storage_path, exc_info=True)
        return ""


def _get_property_applicability(current_user: CurrentUser) -> dict:
    result = (
        supabase.table("property_applicability").select("*")
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    )
    return (result.data if result and result.data else {
        "facilities": [], "services": [], "brand_requirements": [],
    })


def _require_document_applicability(document: dict, current_user: CurrentUser) -> None:
    if not is_applicable_to_property(document.get("applicability"), _get_property_applicability(current_user)):
        raise HTTPException(status_code=409, detail="Controlled document is not applicable to this property.")


def _require_active_tenant_user(user_id: str, current_user: CurrentUser, *, label: str) -> None:
    result = (
        supabase.table("user_roles").select("user_id")
        .eq("tenant_id", current_user.hotel_id).eq("user_id", user_id)
        .eq("is_active", True).maybe_single().execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail=f"Controlled document {label} is not active at this property.")


def _require_same_tenant_sop(source_sop_document_id: str | None, current_user: CurrentUser) -> None:
    if not source_sop_document_id:
        return
    result = (
        supabase.table("sop_documents").select("id")
        .eq("id", source_sop_document_id).eq("tenant_id", current_user.hotel_id)
        .maybe_single().execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Source SOP document was not found at this property.")


def _reason_context(
    request: DocumentLifecycleActionRequest | None, *, default_reason_code: str
) -> tuple[str, str | None]:
    return (
        (request.reason_code if request and request.reason_code else default_reason_code),
        request.reason_note if request else None,
    )


def _get_exception_target(kind: str, reference_id: str, current_user: CurrentUser) -> dict:
    table_and_label = EXCEPTION_REFERENCE_TABLES.get(kind)
    if not table_and_label:
        raise HTTPException(status_code=422, detail="Unsupported evidence exception type.")
    table, label = table_and_label
    result = (
        supabase.table(table).select("*").eq("id", reference_id)
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail=f"{label} not found at this property.")
    return result.data


def _exception_context(current_user: CurrentUser) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    documents = (
        supabase.table("controlled_documents").select("*").eq("tenant_id", current_user.hotel_id).execute().data or []
    )
    assignments = (
        supabase.table("document_acknowledgements").select("*, controlled_documents(title)")
        .eq("tenant_id", current_user.hotel_id).execute().data or []
    )
    for assignment in assignments:
        assignment["document_title"] = (assignment.get("controlled_documents") or {}).get("title")
    records = (
        supabase.table("evidence_records").select("*").eq("tenant_id", current_user.hotel_id).execute().data or []
    )
    actions = (
        supabase.table("evidence_exception_actions").select("*").eq("tenant_id", current_user.hotel_id)
        .order("updated_at", desc=True).execute().data or []
    )
    return documents, assignments, records, actions


@router.get("/applicability")
async def get_property_applicability(current_user: CurrentUser = Depends(get_current_user)):
    return {"data": _get_property_applicability(current_user)}


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
    property_applicability = _get_property_applicability(current_user)
    return {"data": [
        document for document in (result.data or [])
        if is_applicable_to_property(document.get("applicability"), property_applicability)
    ]}


@router.get("/documents/{document_id}")
async def get_controlled_document(
    document_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    return {"data": _get_document(document_id, current_user)}


@router.get("/documents/{document_id}/history")
async def list_controlled_document_history(
    document_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    _get_document(document_id, current_user)
    result = (
        supabase.table("operational_audit_events").select("*")
        .eq("tenant_id", current_user.hotel_id).eq("resource_type", "controlled_document")
        .eq("resource_id", document_id).order("created_at", desc=True).execute()
    )
    return {"data": result.data or []}


@router.post("/documents")
async def create_controlled_document(
    request: CreateControlledDocumentRequest,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    _require_document_applicability({"applicability": request.applicability}, current_user)
    owner_id = request.owner_id or current_user.user_id
    _require_active_tenant_user(owner_id, current_user, label="owner")
    _require_same_tenant_sop(request.source_sop_document_id, current_user)
    payload = {
        "tenant_id": current_user.hotel_id,
        **request.model_dump(mode="json"),
        "owner_id": owner_id,
        "created_by": current_user.user_id,
        "version_number": 1,
        "approval_state": "draft",
    }
    result = supabase.table("controlled_documents").insert(payload).execute()
    record = result.data[0]
    _record_audit_event(current_user=current_user, resource_type="controlled_document", resource_id=record["id"], action="controlled_document.created", new_state={"approval_state": "draft", "version_number": 1}, reason_code="creation")
    return {"data": record}


@router.post("/documents/{document_id}/approve")
async def approve_controlled_document(
    document_id: str,
    request: DocumentLifecycleActionRequest | None = None,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    document = _get_document(document_id, current_user)
    _require_document_applicability(document, current_user)
    if document.get("approval_state") != "draft":
        raise HTTPException(status_code=409, detail="Only a draft controlled document can be approved.")
    if document.get("owner_id") == current_user.user_id:
        raise HTTPException(status_code=409, detail="A document owner cannot approve their own controlled document.")
    _require_active_tenant_user(current_user.user_id, current_user, label="approver")
    reason_code, reason_note = _reason_context(request, default_reason_code="approval")
    result = (
        supabase.table("controlled_documents").update({
            "approval_state": "approved", "approver_id": current_user.user_id,
            "approved_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", document_id).eq("tenant_id", current_user.hotel_id).execute()
    )
    record = result.data[0]
    _record_audit_event(current_user=current_user, resource_type="controlled_document", resource_id=document_id, action="controlled_document.approved", old_state={"approval_state": document["approval_state"]}, new_state={"approval_state": "approved"}, reason_code=reason_code, reason_note=reason_note)
    return {"data": record}


@router.post("/documents/{document_id}/supersede")
async def supersede_controlled_document(
    document_id: str,
    request: DocumentLifecycleActionRequest | None = None,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    previous = _get_document(document_id, current_user)
    _require_document_applicability(previous, current_user)
    try:
        create_superseding_version(previous, actor_id=current_user.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    reason_code, reason_note = _reason_context(request, default_reason_code="supersession")
    result = supabase.rpc("supersede_controlled_document_with_audit", {
        "p_document_id": document_id,
        "p_tenant_id": current_user.hotel_id,
        "p_actor_id": current_user.user_id,
        "p_actor_role": current_user.role,
        "p_reason_code": reason_code,
        "p_reason_note": reason_note,
        "p_source": "api",
    }).execute()
    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=409, detail="Unable to supersede the controlled document.")
    return {"data": rows[0]}


@router.post("/documents/{document_id}/assignments")
async def assign_controlled_document(
    document_id: str,
    request: AssignControlledDocumentRequest,
    current_user: CurrentUser = Depends(require_role(*COMPETENCY_MANAGER_ROLES)),
):
    document = _get_document(document_id, current_user)
    _require_document_applicability(document, current_user)
    if document.get("approval_state") != "approved":
        raise HTTPException(status_code=409, detail="Only an approved controlled document can be assigned.")
    _require_active_tenant_user(request.assigned_to, current_user, label="assignee")
    existing = (
        supabase.table("document_acknowledgements").select("*")
        .eq("tenant_id", current_user.hotel_id).eq("document_id", document_id)
        .eq("assigned_to", request.assigned_to).maybe_single().execute()
    )
    if existing.data:
        return {"data": existing.data}
    payload = {
        "tenant_id": current_user.hotel_id,
        "document_id": document_id,
        **request.model_dump(mode="json"),
        "assigned_by": current_user.user_id,
        "competency_status": "pending" if request.competency_required else "not_required",
        "assignment_type": "initial",
    }
    record = supabase.table("document_acknowledgements").insert(payload).execute().data[0]
    _record_audit_event(current_user=current_user, resource_type="document_acknowledgement", resource_id=record["id"], action="document_acknowledgement.assigned", new_state={"due_date": payload["due_date"], "competency_required": request.competency_required, "assignment_type": "initial"})
    return {"data": record}


@router.get("/my-acknowledgements")
async def list_my_acknowledgements(current_user: CurrentUser = Depends(get_current_user)):
    result = (
        supabase.table("document_acknowledgements").select("*, controlled_documents(title, version_number, approval_state)")
        .eq("tenant_id", current_user.hotel_id).eq("assigned_to", current_user.user_id).order("due_date").execute()
    )
    property_applicability = _get_property_applicability(current_user)
    applicable_assignments = []
    for assignment in result.data or []:
        document = _get_document(assignment["document_id"], current_user)
        if is_applicable_to_property(document.get("applicability"), property_applicability):
            applicable_assignments.append(assignment)
    return {"data": applicable_assignments}


@router.get("/documents/{document_id}/assignments")
async def list_document_assignments(
    document_id: str,
    current_user: CurrentUser = Depends(require_role(*COMPETENCY_MANAGER_ROLES)),
):
    _get_document(document_id, current_user)
    result = (
        supabase.table("document_acknowledgements").select("*")
        .eq("tenant_id", current_user.hotel_id).eq("document_id", document_id)
        .order("due_date").execute()
    )
    return {"data": result.data or []}


@router.post("/acknowledgements/{assignment_id}/acknowledge")
async def acknowledge_controlled_document(
    assignment_id: str,
    current_user: CurrentUser = Depends(require_role(*EVIDENCE_CAPTURE_ROLES)),
):
    assignment = (
        supabase.table("document_acknowledgements").select("*").eq("id", assignment_id)
        .eq("tenant_id", current_user.hotel_id).eq("assigned_to", current_user.user_id).maybe_single().execute()
    )
    if not assignment.data:
        raise HTTPException(status_code=404, detail="Document assignment not found.")
    _require_document_applicability(
        _get_document(assignment.data["document_id"], current_user), current_user,
    )
    if assignment.data.get("acknowledged_at"):
        return {"data": assignment.data}
    result = supabase.table("document_acknowledgements").update({"acknowledged_at": datetime.now(timezone.utc).isoformat(), "acknowledged_by": current_user.user_id}).eq("id", assignment_id).eq("tenant_id", current_user.hotel_id).execute()
    record = result.data[0]
    _record_audit_event(current_user=current_user, resource_type="document_acknowledgement", resource_id=assignment_id, action="document_acknowledgement.acknowledged", new_state={"acknowledged": True})
    return {"data": record}


@router.post("/acknowledgements/{assignment_id}/competency")
async def evaluate_document_competency(
    assignment_id: str,
    request: EvaluateDocumentCompetencyRequest,
    current_user: CurrentUser = Depends(require_role(*COMPETENCY_MANAGER_ROLES)),
):
    assignment = (
        supabase.table("document_acknowledgements").select("*").eq("id", assignment_id)
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    )
    if not assignment.data:
        raise HTTPException(status_code=404, detail="Document assignment not found.")
    if not assignment.data.get("competency_required"):
        raise HTTPException(status_code=409, detail="Competency is not required for this document assignment.")
    payload = {
        "competency_status": request.outcome,
        "competency_method": request.assessment_method,
        "competency_notes": request.notes,
        "competency_evaluated_by": current_user.user_id,
        "competency_evaluated_at": datetime.now(timezone.utc).isoformat(),
    }
    result = (
        supabase.table("document_acknowledgements").update(payload).eq("id", assignment_id)
        .eq("tenant_id", current_user.hotel_id).execute()
    )
    record = result.data[0]
    _record_audit_event(
        current_user=current_user,
        resource_type="document_acknowledgement",
        resource_id=assignment_id,
        action="document_acknowledgement.competency_evaluated",
        old_state={"competency_status": assignment.data.get("competency_status")},
        new_state={"competency_status": request.outcome, "assessment_method": request.assessment_method},
        reason_code="competency_evaluation",
        reason_note=request.notes,
    )
    return {"data": record}


@router.post("/records")
async def create_evidence_record(
    request: CreateEvidenceRecordRequest,
    current_user: CurrentUser = Depends(require_role(*EVIDENCE_CAPTURE_ROLES)),
):
    _require_same_tenant_evidence_links(request, current_user)
    payload = {"tenant_id": current_user.hotel_id, **request.model_dump(mode="json"), "collected_by": current_user.user_id, "collected_at": datetime.now(timezone.utc).isoformat()}
    record = supabase.table("evidence_records").insert(payload).execute().data[0]
    _record_audit_event(current_user=current_user, resource_type="evidence_record", resource_id=record["id"], action="evidence_record.collected", new_state={"evidence_type": record["evidence_type"]})
    return {"data": record}


@router.get("/records")
async def list_evidence_records(current_user: CurrentUser = Depends(get_current_user)):
    result = (
        supabase.table("evidence_records").select("*").eq("tenant_id", current_user.hotel_id)
        .order("collected_at", desc=True).execute()
    )
    return {"data": result.data or []}


@router.get("/records/{record_id}")
async def get_evidence_record(record_id: str, current_user: CurrentUser = Depends(get_current_user)):
    return {"data": _get_evidence_record(record_id, current_user)}


@router.get("/records/{record_id}/file-url")
async def get_evidence_file_url(record_id: str, current_user: CurrentUser = Depends(get_current_user)):
    record = _get_evidence_record(record_id, current_user)
    storage_path = record.get("storage_path")
    if not storage_path:
        raise HTTPException(status_code=404, detail="Evidence attachment not found.")
    signed_url = _create_evidence_signed_url(storage_path)
    if not signed_url:
        raise HTTPException(status_code=503, detail="Evidence attachment is temporarily unavailable.")
    return {"data": {"url": signed_url, "expires_in_seconds": 3600}}


@router.post("/records/{record_id}/file")
async def upload_evidence_file(
    record_id: str,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_role(*EVIDENCE_CAPTURE_ROLES)),
):
    _get_evidence_record(record_id, current_user)
    if file.content_type not in ALLOWED_EVIDENCE_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Evidence must be a PDF, JPEG, PNG, or WebP file.")
    content = await file.read(MAX_EVIDENCE_UPLOAD_BYTES + 1)
    if len(content) > MAX_EVIDENCE_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Evidence file is too large. Maximum size is 10 MB.")
    path = _evidence_storage_path(current_user, record_id, file.content_type)
    try:
        supabase.storage.from_("evidence-files").upload(
            path, content, {"content-type": file.content_type, "upsert": "false"}
        )
    except Exception:
        logger.warning("Evidence upload failed for record=%s", record_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Evidence upload failed. Please retry.")
    updated = supabase.table("evidence_records").update({
        "storage_path": path,
        "file_name": file.filename or "evidence",
        "file_content_type": file.content_type,
    }).eq("id", record_id).eq("tenant_id", current_user.hotel_id).execute().data[0]
    _record_audit_event(
        current_user=current_user,
        resource_type="evidence_record",
        resource_id=record_id,
        action="evidence_record.file_uploaded",
        new_state={"storage_path": path, "content_type": file.content_type},
    )
    return {"data": updated}


@router.get("/exceptions")
async def list_evidence_exceptions(
    state: str | None = None,
    kind: str | None = None,
    owner_id: str | None = None,
    lifecycle_state: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
):
    documents, assignments, records, actions = _exception_context(current_user)
    action_by_reference = {
        (action["exception_kind"], action["reference_id"]): action
        for action in actions
    }
    queue = build_exception_queue(
        documents=documents, assignments=assignments, evidence=records, now=datetime.now(timezone.utc)
    )
    enriched = []
    for item in queue:
        action = action_by_reference.get((item["kind"], item["reference_id"]), {})
        enriched_item = {
            **item,
            "lifecycle_state": action.get("lifecycle_state", "open"),
            "owner_id": action.get("owner_id"),
            "reason_code": action.get("reason_code"),
            "reason_note": action.get("reason_note"),
            "escalation_level": action.get("escalation_level", 0),
        }
        if state and enriched_item["state"] != state:
            continue
        if kind and enriched_item["kind"] != kind:
            continue
        if owner_id and enriched_item["owner_id"] != owner_id:
            continue
        if lifecycle_state and enriched_item["lifecycle_state"] != lifecycle_state:
            continue
        enriched.append(enriched_item)
    return {"data": enriched}


@router.post("/exceptions/{kind}/{reference_id}/actions")
async def act_on_evidence_exception(
    kind: str,
    reference_id: str,
    request: ExceptionActionRequest,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    _get_exception_target(kind, reference_id, current_user)
    if request.owner_id:
        _require_active_tenant_user(request.owner_id, current_user, label="exception owner")
    existing = (
        supabase.table("evidence_exception_actions").select("*")
        .eq("tenant_id", current_user.hotel_id).eq("exception_kind", kind)
        .eq("reference_id", reference_id).maybe_single().execute()
    )
    lifecycle = exception_lifecycle_state(request.action)
    payload = {
        "tenant_id": current_user.hotel_id,
        "exception_kind": kind,
        "reference_id": reference_id,
        "lifecycle_state": lifecycle,
        "owner_id": request.owner_id or (existing.data or {}).get("owner_id"),
        "reason_code": request.reason_code,
        "reason_note": request.reason_note,
        "escalation_level": ((existing.data or {}).get("escalation_level") or 0) + (1 if request.action == "escalate" else 0),
        "created_by": (existing.data or {}).get("created_by") or current_user.user_id,
        "updated_by": current_user.user_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    result = supabase.table("evidence_exception_actions").upsert(
        payload, on_conflict="tenant_id,exception_kind,reference_id"
    ).execute()
    record = result.data[0]
    _record_audit_event(
        current_user=current_user,
        resource_type="evidence_exception",
        resource_id=reference_id,
        action={
            "assign": "evidence_exception.assigned",
            "defer": "evidence_exception.deferred",
            "escalate": "evidence_exception.escalated",
            "resolve": "evidence_exception.resolved",
            "reopen": "evidence_exception.reopened",
        }[request.action],
        old_state={
            "lifecycle_state": (existing.data or {}).get("lifecycle_state"),
            "owner_id": (existing.data or {}).get("owner_id"),
            "escalation_level": (existing.data or {}).get("escalation_level", 0),
        },
        new_state={
            "kind": kind, "lifecycle_state": lifecycle, "owner_id": payload["owner_id"],
            "escalation_level": payload["escalation_level"],
        },
        reason_code=request.reason_code,
        reason_note=request.reason_note,
    )
    return {"data": record}


@router.get("/export")
async def export_evidence_packet(current_user: CurrentUser = Depends(require_role("gm"))):
    documents, assignments, records, actions = _exception_context(current_user)
    exceptions = build_exception_queue(
        documents=documents, assignments=assignments, evidence=records, now=datetime.now(timezone.utc)
    )
    audits = (
        supabase.table("operational_audit_events").select("*")
        .eq("tenant_id", current_user.hotel_id).order("created_at").execute().data or []
    )
    rows = build_inspector_export_rows(
        applicability=_get_property_applicability(current_user), documents=documents,
        assignments=assignments, evidence=records, exceptions=exceptions, actions=actions, audits=audits,
    )
    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=["section", "record_id", "label", "state", "owner_id", "reason_code", "reason_note", "details"],
    )
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        output.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=inspector-evidence-packet.csv"},
    )


def run_evidence_reminders(*, now: datetime | None = None) -> dict[str, int]:
    """Queue idempotent in-app reminders; providers decide delivered versus failed later."""
    current_time = now or datetime.now(timezone.utc)
    assignments = supabase.table("document_acknowledgements").select("*").execute().data or []
    actions = build_reminder_actions(assignments, now=current_time)
    outcome_counts = {"queued": 0, "duplicates": 0, "retry_queued": 0}
    for action in actions:
        assignment = next(item for item in assignments if item["id"] == action["assignment_id"])
        if action["recipient_type"] == "staff":
            recipients = [action["recipient_id"]]
        else:
            role_rows = (
                supabase.table("user_roles").select("user_id").eq("role", action["recipient_role"])
                .eq("tenant_id", assignment["tenant_id"]).eq("is_active", True).execute().data or []
            )
            recipients = [row["user_id"] for row in role_rows]
        for recipient_id in recipients:
            key = f"evidence-reminder:{assignment['id']}:{recipient_id}:{action['state']}:{current_time.date().isoformat()}"
            result = supabase.rpc("queue_evidence_reminder_delivery", {
                "p_tenant_id": assignment["tenant_id"],
                "p_recipient_id": recipient_id,
                "p_assignment_id": assignment["id"],
                "p_state": action["state"],
                "p_channel": "in_app",
                "p_idempotency_key": key,
                "p_retry_failed": True,
            }).execute()
            outcome = ((result.data or [{}])[0]).get("outcome", "duplicate")
            if outcome == "queued":
                outcome_counts["queued"] += 1
            elif outcome == "retry_queued":
                outcome_counts["retry_queued"] += 1
            else:
                outcome_counts["duplicates"] += 1
    return outcome_counts

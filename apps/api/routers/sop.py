from fastapi import APIRouter, Depends, UploadFile, File, Form, BackgroundTasks, HTTPException
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import SOPQueryRequest
from core.database import supabase
from services.ai.sop_rag import index_sop_document, query_sop

router = APIRouter(prefix="/sop", tags=["sop"])


# ---------------------------------------------------------------------------
# GET /sop/documents
# List all SOP documents for the current hotel, newest first.
# ---------------------------------------------------------------------------

@router.get("/documents")
async def list_sop_documents(
    current_user: CurrentUser = Depends(get_current_user),
):
    result = (
        supabase.table("sop_documents")
        .select("*")
        .eq("tenant_id", current_user.hotel_id)
        .order("created_at", desc=True)
        .execute()
    )
    return {"data": result.data or []}


# ---------------------------------------------------------------------------
# POST /sop/documents
# Upload a PDF SOP document, store it, and kick off background indexing.
# Only GM, housekeeping supervisors, and chief engineers may upload.
# ---------------------------------------------------------------------------

@router.post("/documents")
async def upload_sop_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    category: str = Form(None),
    description: str = Form(None),
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor", "chief_engineer")
    ),
):
    # Validate PDF
    is_pdf = (
        (file.content_type and "pdf" in file.content_type.lower())
        or (file.filename and file.filename.lower().endswith(".pdf"))
    )
    if not is_pdf:
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are supported. Please upload a .pdf file.",
        )

    content: bytes = await file.read()

    # Upload to Supabase Storage
    storage_path = f"sop-documents/{current_user.hotel_id}/{file.filename}"
    supabase.storage.from_("sop-documents").upload(
        storage_path,
        content,
        {"content-type": "application/pdf", "upsert": "true"},
    )

    # Create the document record with pending status
    insert_result = supabase.table("sop_documents").insert({
        "tenant_id": current_user.hotel_id,
        "title": title,
        "category": category,
        "description": description,
        "storage_path": storage_path,
        "file_size_bytes": len(content),
        "uploaded_by": current_user.user_id,
        "indexing_status": "pending",
    }).execute()

    doc_record = insert_result.data[0] if insert_result.data else {}
    doc_id = doc_record.get("id")

    # Kick off background indexing
    if doc_id:
        background_tasks.add_task(
            index_sop_document,
            doc_id,
            storage_path,
            current_user.hotel_id,
        )

    return {
        "data": doc_record,
        "message": "Upload successful. Indexing in background.",
    }


# ---------------------------------------------------------------------------
# GET /sop/documents/{document_id}
# Retrieve a single SOP document (must belong to this hotel).
# ---------------------------------------------------------------------------

@router.get("/documents/{document_id}")
async def get_sop_document(
    document_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    result = (
        supabase.table("sop_documents")
        .select("*")
        .eq("id", document_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="SOP document not found.")

    return {"data": result.data}


# ---------------------------------------------------------------------------
# DELETE /sop/documents/{document_id}
# Delete an SOP document and its chunks (cascade), plus the Storage object.
# Only the GM may delete documents.
# ---------------------------------------------------------------------------

@router.delete("/documents/{document_id}")
async def delete_sop_document(
    document_id: str,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    # Fetch first to get the storage_path and verify tenant ownership
    fetch_result = (
        supabase.table("sop_documents")
        .select("id, storage_path, tenant_id")
        .eq("id", document_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )

    if not fetch_result.data:
        raise HTTPException(status_code=404, detail="SOP document not found.")

    storage_path: str = fetch_result.data.get("storage_path", "")

    # Delete database record (chunks cascade via FK ON DELETE CASCADE)
    supabase.table("sop_documents").delete().eq("id", document_id).execute()

    # Delete the file from Supabase Storage
    if storage_path:
        try:
            supabase.storage.from_("sop-documents").remove([storage_path])
        except Exception:
            # Storage deletion failure is non-fatal; log and continue
            pass

    return {"message": "Document deleted."}


# ---------------------------------------------------------------------------
# POST /sop/query
# Perform a RAG query over the hotel's indexed SOP documents.
# ---------------------------------------------------------------------------

@router.post("/query")
async def query_sop_endpoint(
    request: SOPQueryRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    result = query_sop(
        query=request.query,
        hotel_id=current_user.hotel_id,
        user_id=current_user.user_id,
    )
    return {"data": result}

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import Optional
from pydantic import BaseModel
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import CompletePMProgramRequest, CreateAssetRequest, CreatePMScheduleRequest, UpdateAssetRequest
from core.database import supabase
from routers.evidence import _create_evidence_signed_url
from services.programs.contracts import EvidenceRequiredError
from services.programs.execution import persist_pm_completion

router = APIRouter(prefix="/assets", tags=["assets"])


class CreateCategoryRequest(BaseModel):
    name: str
    code: str
    default_pm_interval_days: Optional[int] = None


# ---------------------------------------------------------------------------
# 1. GET /  — list assets
# ---------------------------------------------------------------------------

@router.get("")
async def list_assets(
    risk_score_min: Optional[int] = Query(None),
    current_user: CurrentUser = Depends(get_current_user)
):
    query = supabase.table("assets")\
        .select("*, asset_categories(name, code), rooms(room_number)")\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("is_active", True)\
        .order("failure_risk_score", desc=True)

    if risk_score_min:
        query = query.gte("failure_risk_score", risk_score_min)

    result = query.execute()
    return {"data": result.data}


# ---------------------------------------------------------------------------
# 2. POST /  — create asset
# ---------------------------------------------------------------------------

@router.post("")
async def create_asset(
    request: CreateAssetRequest,
    current_user: CurrentUser = Depends(require_role("gm", "engineer"))
):
    asset_data = {
        "tenant_id": current_user.hotel_id,
        **request.model_dump(exclude_none=True),
    }
    if "category_id" in asset_data:
        asset_data["category_id"] = str(asset_data["category_id"])
    if "room_id" in asset_data:
        asset_data["room_id"] = str(asset_data["room_id"])

    result = supabase.table("assets").insert(asset_data).execute()
    return {"data": result.data[0] if result.data else None}


# ---------------------------------------------------------------------------
# 3. GET /failure-predictions  — active unacknowledged predictions
# ---------------------------------------------------------------------------

@router.get("/failure-predictions")
async def get_failure_predictions(current_user: CurrentUser = Depends(get_current_user)):
    result = supabase.table("failure_predictions")\
        .select("*, assets(name, category_id, asset_categories(name))")\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("is_acknowledged", False)\
        .order("risk_score", desc=True)\
        .limit(10)\
        .execute()
    return {"data": result.data}


# ---------------------------------------------------------------------------
# 4. GET /failure-predictions/history  — full prediction history (NEW)
# ---------------------------------------------------------------------------

@router.get("/failure-predictions/history")
async def get_failure_prediction_history(
    acknowledged: Optional[bool] = Query(None),
    risk_min: Optional[int] = Query(None),
    current_user: CurrentUser = Depends(get_current_user)
):
    """Get all failure predictions including acknowledged ones (for history view)."""
    query = supabase.table("failure_predictions")\
        .select("*, assets(name, asset_categories(name))")\
        .eq("tenant_id", current_user.hotel_id)\
        .order("generated_at", desc=True)\
        .limit(50)

    if acknowledged is not None:
        query = query.eq("is_acknowledged", acknowledged)
    if risk_min is not None:
        query = query.gte("risk_score", risk_min)

    result = query.execute()
    return {"data": result.data}


# ---------------------------------------------------------------------------
# 5. POST /failure-predictions/{prediction_id}/acknowledge  — acknowledge
# ---------------------------------------------------------------------------

@router.post("/failure-predictions/{prediction_id}/acknowledge")
async def acknowledge_failure_prediction(
    prediction_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "engineer"))
):
    result = supabase.table("failure_predictions") \
        .update({
            "is_acknowledged": True,
            "acknowledged_by": current_user.user_id,
            "acknowledged_at": datetime.now(timezone.utc).isoformat(),
        }) \
        .eq("id", prediction_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    return {"data": result.data[0] if result.data else None}


# ---------------------------------------------------------------------------
# 6. POST /failure-predictions/{prediction_id}/create-work-order  (NEW)
# ---------------------------------------------------------------------------

@router.post("/failure-predictions/{prediction_id}/create-work-order")
async def create_work_order_from_prediction(
    prediction_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "engineer"))
):
    """Create a work order from a failure prediction."""
    from datetime import timedelta

    # Fetch prediction with asset details
    pred_result = supabase.table("failure_predictions")\
        .select("*, assets(name, id, room_id)")\
        .eq("id", prediction_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    pred = pred_result.data
    if not pred:
        raise HTTPException(status_code=404, detail="Prediction not found")

    asset = pred.get("assets") or {}
    risk_score = pred.get("risk_score", 50)

    # Map risk score to priority
    if risk_score >= 70:
        priority = "urgent"
    elif risk_score >= 40:
        priority = "normal"
    else:
        priority = "low"

    sla_map = {"urgent": 60, "normal": 240, "low": 480}
    sla = sla_map[priority]
    due_at = (datetime.now(timezone.utc) + timedelta(minutes=sla)).isoformat()

    description_parts = [pred.get("recommendation", "")]
    if pred.get("ai_reasoning"):
        description_parts.append(f"\nAI Analysis: {pred['ai_reasoning']}")
    if pred.get("failure_indicators"):
        indicators = ", ".join(pred["failure_indicators"])
        description_parts.append(f"\nFailure indicators: {indicators}")

    wo_data = {
        "tenant_id": current_user.hotel_id,
        "title": f"Predicted failure: {asset.get('name', 'Unknown asset')}",
        "description": "\n".join(description_parts),
        "category": "general",
        "priority": priority,
        "asset_id": pred.get("asset_id"),
        "room_id": asset.get("room_id"),
        "created_by": current_user.user_id,
        "is_ai_created": True,
        "sla_minutes": sla,
        "due_at": due_at,
    }

    wo_result = supabase.table("work_orders").insert(wo_data).execute()
    return {"data": wo_result.data[0] if wo_result.data else None}


# ---------------------------------------------------------------------------
# 7. GET /pm-schedules  — list PM schedules
# ---------------------------------------------------------------------------

@router.get("/pm-schedules")
async def list_pm_schedules(current_user: CurrentUser = Depends(get_current_user)):
    result = supabase.table("pm_schedules")\
        .select("*, assets(name, room_id)")\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("is_active", True)\
        .order("next_due_at")\
        .execute()
    return {"data": result.data}


# ---------------------------------------------------------------------------
# 8. POST /pm-schedules  — create PM schedule
# ---------------------------------------------------------------------------

@router.post("/pm-schedules")
async def create_pm_schedule(
    request: CreatePMScheduleRequest,
    current_user: CurrentUser = Depends(require_role("gm", "engineer", "chief_engineer"))
):
    result = supabase.table("pm_schedules").insert({
        "tenant_id": current_user.hotel_id,
        **request.model_dump(),
    }).execute()
    return {"data": result.data[0] if result.data else None}


# ---------------------------------------------------------------------------
# 9. POST /pm-schedules/{schedule_id}/complete  — mark PM complete (NEW)
# ---------------------------------------------------------------------------

@router.post("/pm-schedules/{schedule_id}/complete")
async def complete_pm_schedule(
    schedule_id: str,
    request: CompletePMProgramRequest,
    current_user: CurrentUser = Depends(require_role("engineer", "gm", "chief_engineer"))
):
    """Record PM proof and advance the schedule only after a valid completion."""
    sched_result = supabase.table("pm_schedules")\
        .select("*")\
        .eq("id", schedule_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    sched = sched_result.data if sched_result else None
    if not sched:
        raise HTTPException(status_code=404, detail="PM schedule not found")

    try:
        record = persist_pm_completion(
            db=supabase,
            tenant_id=current_user.hotel_id,
            user_id=current_user.user_id,
            schedule=sched,
            payload=request.model_dump(mode="json"),
        )
    except (EvidenceRequiredError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"data": record}


# ---------------------------------------------------------------------------
# 10. PATCH /pm-schedules/{schedule_id}  — update PM schedule (NEW)
# ---------------------------------------------------------------------------

@router.patch("/pm-schedules/{schedule_id}")
async def update_pm_schedule(
    schedule_id: str,
    request: Request,
    current_user: CurrentUser = Depends(require_role("engineer", "gm"))
):
    """Update a PM schedule (reschedule, deactivate, change interval)."""
    body = await request.json()
    allowed = {"name", "description", "interval_type", "interval_days",
               "estimated_minutes", "next_due_at", "is_active", "assigned_to_role"}
    update_data = {k: v for k, v in body.items() if k in allowed}

    if not update_data:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    result = supabase.table("pm_schedules")\
        .update(update_data)\
        .eq("id", schedule_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    return {"data": result.data[0] if result.data else None}


# ---------------------------------------------------------------------------
# 11. DELETE /pm-schedules/{schedule_id}  — deactivate PM schedule (NEW)
# ---------------------------------------------------------------------------

@router.delete("/pm-schedules/{schedule_id}")
async def deactivate_pm_schedule(
    schedule_id: str,
    current_user: CurrentUser = Depends(require_role("engineer", "gm"))
):
    """Soft-delete (deactivate) a PM schedule."""
    result = supabase.table("pm_schedules")\
        .update({"is_active": False})\
        .eq("id", schedule_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    return {"data": result.data[0] if result.data else None}


# ---------------------------------------------------------------------------
# 12. GET /categories  — list asset categories (NEW)
# ---------------------------------------------------------------------------

@router.get("/categories")
async def list_asset_categories(current_user: CurrentUser = Depends(get_current_user)):
    """List all asset categories for this hotel."""
    result = supabase.table("asset_categories")\
        .select("*")\
        .eq("tenant_id", current_user.hotel_id)\
        .order("name")\
        .execute()
    return {"data": result.data}


# ---------------------------------------------------------------------------
# 13. POST /categories  — create asset category (NEW)
# ---------------------------------------------------------------------------

@router.post("/categories")
async def create_asset_category(
    request: CreateCategoryRequest,
    current_user: CurrentUser = Depends(require_role("gm", "engineer"))
):
    """Create a new asset category."""
    result = supabase.table("asset_categories").insert({
        "tenant_id": current_user.hotel_id,
        "name": request.name,
        "code": request.code.upper(),
        "default_pm_interval_days": request.default_pm_interval_days,
    }).execute()
    return {"data": result.data[0] if result.data else None}


# ---------------------------------------------------------------------------
# 14. GET /{asset_id}  — get single asset
# ---------------------------------------------------------------------------

@router.get("/{asset_id}")
async def get_asset(
    asset_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    result = supabase.table("assets") \
        .select("*, asset_categories(name, code), rooms(room_number), pm_schedules(*)") \
        .eq("id", asset_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"data": result.data[0]}


# ---------------------------------------------------------------------------
# 15. PATCH /{asset_id}  — update asset
# ---------------------------------------------------------------------------

@router.patch("/{asset_id}")
async def update_asset(
    asset_id: str,
    request: UpdateAssetRequest,
    current_user: CurrentUser = Depends(require_role("gm", "engineer"))
):
    update_data = request.model_dump(exclude_none=True)
    if "warranty_expires" in update_data and update_data["warranty_expires"]:
        update_data["warranty_expires"] = str(update_data["warranty_expires"])

    result = supabase.table("assets") \
        .update(update_data) \
        .eq("id", asset_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    return {"data": result.data[0] if result.data else None}


# ---------------------------------------------------------------------------
# 16. POST /{asset_id}/run-prediction  — on-demand AI prediction (NEW)
# ---------------------------------------------------------------------------

@router.post("/{asset_id}/run-prediction")
async def run_asset_prediction(
    asset_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "engineer"))
):
    """Trigger on-demand AI failure prediction for a single asset."""
    from services.ai.failure_predictions import run_single_asset_prediction

    result = await run_single_asset_prediction(current_user.hotel_id, asset_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Asset not found or inactive")

    return {"data": result}


# ---------------------------------------------------------------------------
# 17. GET /pm-schedules/{schedule_id}/completions/{completion_id}  — PM completion,
#     attachments resolved to short-lived signed URLs only (D-06) (NEW)
# ---------------------------------------------------------------------------

def _resolve_evidence_signed_urls(evidence_ids: list, tenant_id: str) -> list[dict]:
    """Resolve evidence_record IDs to short-lived signed URLs. Never returns storage_path
    or a public URL — only a signed URL, matching the evidence platform's delivery contract."""
    if not evidence_ids:
        return []
    records_result = supabase.table("evidence_records") \
        .select("id, storage_path, file_name") \
        .eq("tenant_id", tenant_id).in_("id", evidence_ids).execute()
    records_by_id = {record["id"]: record for record in ((records_result.data if records_result else None) or [])}
    resolved = []
    for evidence_id in evidence_ids:
        record = records_by_id.get(evidence_id)
        if not record or not record.get("storage_path"):
            continue
        signed_url = _create_evidence_signed_url(record["storage_path"])
        if not signed_url:
            continue
        resolved.append({
            "evidence_id": evidence_id,
            "url": signed_url,
            "file_name": record.get("file_name"),
            "expires_in_seconds": 3600,
        })
    return resolved


@router.get("/pm-schedules/{schedule_id}/completions/{completion_id}")
async def get_pm_completion(
    schedule_id: str,
    completion_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Read a PM completion. Photos/certificate/checklist-item attachments are resolved to
    short-lived signed URLs — never a raw storage_path or public URL (D-06)."""
    completion_result = supabase.table("pm_completion_records").select("*") \
        .eq("id", completion_id).eq("pm_schedule_id", schedule_id) \
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    completion = completion_result.data if completion_result else None
    if not completion:
        raise HTTPException(status_code=404, detail="PM completion not found")

    items_result = supabase.table("pm_completion_items").select("*") \
        .eq("completion_id", completion_id).eq("tenant_id", current_user.hotel_id).execute()
    items = list(items_result.data or [])

    tenant_id = current_user.hotel_id
    completion["photos"] = _resolve_evidence_signed_urls(completion.get("photos") or [], tenant_id)
    completion["certificate_attachments"] = _resolve_evidence_signed_urls(
        completion.get("certificate_attachments") or [], tenant_id,
    )
    for item in items:
        item["evidence"] = _resolve_evidence_signed_urls(item.get("evidence") or [], tenant_id)
    completion["items"] = items
    return {"data": completion}

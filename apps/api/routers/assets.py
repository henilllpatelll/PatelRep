from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import Optional
from pydantic import BaseModel
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import BatchAcknowledgePredictionsRequest, CompletePMProgramRequest, CreateAssetRequest, CreateMeterRequest, CreatePMScheduleRequest, RecordMeterReadingRequest, RestoreAssetDowntimeRequest, StartAssetDowntimeRequest, UpdateAssetRequest, UpdateMeterRequest
from core.database import supabase
from routers.evidence import _create_evidence_signed_url
from services.programs.contracts import EvidenceRequiredError
from services.programs.execution import persist_pm_completion
from services.asset_reliability import calculate_asset_reliability, restore_asset_downtime as restore_asset_downtime_service, start_asset_downtime as start_asset_downtime_service, with_elapsed_minutes
from services.condition_monitoring import meter_freshness_status, persist_condition_reading

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
    assets = result.data or []
    active_result = supabase.table("asset_downtime_periods").select(
        "id, asset_id, started_at, downtime_type, impact_level, work_order_id"
    ).eq("tenant_id", current_user.hotel_id).is_("restored_at", "null").execute()
    active_by_asset = {row["asset_id"]: with_elapsed_minutes(row) for row in (active_result.data or [])}
    active_meters = supabase.table("asset_meters").select("*").eq(
        "tenant_id", current_user.hotel_id
    ).eq("is_active", True).execute().data or []
    meters_by_asset: dict[str, list[dict]] = {}
    for meter in active_meters:
        if meter.get("asset_id"):
            meters_by_asset.setdefault(str(meter["asset_id"]), []).append(
                _meter_with_latest(meter, current_user)
            )
    for asset in assets:
        asset["active_downtime"] = active_by_asset.get(asset["id"])
        statuses = [meter["current_status"] for meter in meters_by_asset.get(asset["id"], [])]
        asset["condition_status"] = "critical" if "critical" in statuses else "warning" if "warning" in statuses else "stale" if "stale" in statuses else None
    assets.sort(key=lambda asset: (
        0 if (asset.get("active_downtime") or {}).get("impact_level") == "out_of_service" else 1,
        0 if asset.get("condition_status") == "critical" else 1,
        0 if asset.get("condition_status") == "warning" else 1,
        -(asset.get("failure_risk_score") or 0),
    ))
    return {"data": assets}


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
    for date_field in ("purchase_date", "installation_date", "warranty_expires"):
        if date_field in asset_data:
            asset_data[date_field] = str(asset_data[date_field])

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
            "escalation_level": 0,
            "high_risk_since": None,
        }) \
        .eq("id", prediction_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    return {"data": result.data[0] if result.data else None}


# ---------------------------------------------------------------------------
# 5b. POST /failure-predictions/batch-acknowledge  (NEW)
# ---------------------------------------------------------------------------

@router.post("/failure-predictions/batch-acknowledge")
async def batch_acknowledge_failure_predictions(
    body: BatchAcknowledgePredictionsRequest,
    current_user: CurrentUser = Depends(require_role("gm", "engineer")),
):
    """Best-effort batch acknowledge: loops acknowledge_failure_prediction per id, one
    result per id. The single-item update returns data=None (not a 404) for a missing
    or cross-tenant id, so that case must be treated as a per-item not_found here rather
    than a silent success."""
    results = []
    for pid in body.prediction_ids:
        prediction_id = str(pid)
        try:
            outcome = await acknowledge_failure_prediction(prediction_id=prediction_id, current_user=current_user)
            if outcome["data"]:
                results.append({"prediction_id": prediction_id, "action": "acknowledged"})
            else:
                results.append({"prediction_id": prediction_id, "action": "not_found"})
        except HTTPException as e:
            results.append({"prediction_id": prediction_id, "action": "error", "status": e.status_code, "detail": e.detail})

    succeeded = sum(1 for r in results if r["action"] == "acknowledged")
    failed = len(results) - succeeded
    return {"data": {"results": results, "succeeded": succeeded, "failed": failed}}


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

    supabase.table("failure_predictions").update({
        "escalation_level": 0,
        "high_risk_since": None,
    }).eq("id", prediction_id).eq("tenant_id", current_user.hotel_id).execute()

    return {"data": wo_result.data[0] if wo_result.data else None}


# ---------------------------------------------------------------------------
# 6b. GET /recurring-issues — repeat work orders on the same asset/room (NEW)
# ---------------------------------------------------------------------------

@router.get("/recurring-issues")
async def get_recurring_issues(
    days: int = Query(30, ge=1, le=365),
    min_count: int = Query(3, ge=2, le=20),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Flags assets/rooms with repeated work orders in a rolling window (e.g.
    "Room 214 AC: 3rd work order in 30 days") -- a cheap, data-driven signal
    that a repair-vs-replace decision may be due. Distinct from the AI
    failure_predictions model above (which scores from WO history + asset
    age/warranty via an LLM call); this is plain frequency counting with no
    AI credit cost, so it can run on every page load.

    Not a duplicate of GET /management-roi/repeat-failures (D-08,
    calculate_repeat_failures): that one is a GM-only, 90-day, 2+-threshold
    backward-looking KPI count (anonymous ids, no names) for the ROI
    dashboard. This is an engineer-facing, 30-day, 3+-threshold *actionable*
    list (named asset/room, last-seen, linked WO ids) meant to be glanced at
    while triaging work orders, not analyzed after the fact.
    """
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    wo_result = (
        supabase.table("work_orders")
        .select("id, asset_id, room_id, category, title, status, created_at")
        .eq("tenant_id", current_user.hotel_id)
        .neq("status", "cancelled")
        .gte("created_at", since)
        .order("created_at", desc=False)
        .execute()
    )
    work_orders = wo_result.data or []

    asset_groups: dict[str, list[dict]] = {}
    room_only_groups: dict[str, list[dict]] = {}
    for wo in work_orders:
        asset_id = wo.get("asset_id")
        room_id = wo.get("room_id")
        if asset_id:
            asset_groups.setdefault(asset_id, []).append(wo)
        elif room_id:
            room_only_groups.setdefault(room_id, []).append(wo)

    flagged_asset_ids = [aid for aid, wos in asset_groups.items() if len(wos) >= min_count]
    flagged_room_ids = [rid for rid, wos in room_only_groups.items() if len(wos) >= min_count]

    asset_map: dict[str, dict] = {}
    if flagged_asset_ids:
        assets_result = (
            supabase.table("assets")
            .select("id, name, room_id, rooms(room_number)")
            .in_("id", flagged_asset_ids)
            .execute()
        )
        asset_map = {a["id"]: a for a in (assets_result.data or [])}

    room_map: dict[str, dict] = {}
    all_room_ids = list(flagged_room_ids) + [
        a.get("room_id") for a in asset_map.values() if a.get("room_id") and not isinstance(a.get("rooms"), dict)
    ]
    if all_room_ids:
        rooms_result = (
            supabase.table("rooms")
            .select("id, room_number")
            .in_("id", list(set(all_room_ids)))
            .execute()
        )
        room_map = {r["id"]: r for r in (rooms_result.data or [])}

    issues = []
    for asset_id in flagged_asset_ids:
        wos = asset_groups[asset_id]
        asset = asset_map.get(asset_id) or {}
        nested_room = asset.get("rooms")
        if isinstance(nested_room, dict):
            room_number = nested_room.get("room_number")
        else:
            room_number = (room_map.get(asset.get("room_id")) or {}).get("room_number")
        issues.append({
            "key": f"asset:{asset_id}",
            "asset_id": asset_id,
            "asset_name": asset.get("name") or "Unknown asset",
            "room_id": asset.get("room_id"),
            "room_number": room_number,
            "category": wos[-1].get("category"),
            "wo_count": len(wos),
            "window_days": days,
            "first_wo_at": wos[0]["created_at"],
            "last_wo_at": wos[-1]["created_at"],
            "work_order_ids": [w["id"] for w in wos],
        })

    for room_id in flagged_room_ids:
        wos = room_only_groups[room_id]
        room = room_map.get(room_id) or {}
        issues.append({
            "key": f"room:{room_id}",
            "asset_id": None,
            "asset_name": None,
            "room_id": room_id,
            "room_number": room.get("room_number"),
            "category": wos[-1].get("category"),
            "wo_count": len(wos),
            "window_days": days,
            "first_wo_at": wos[0]["created_at"],
            "last_wo_at": wos[-1]["created_at"],
            "work_order_ids": [w["id"] for w in wos],
        })

    issues.sort(key=lambda i: i["wo_count"], reverse=True)
    return {"data": issues[:20]}


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
            actor_role=current_user.role,
            schedule=sched,
            payload=request.model_dump(mode="json"),
        )
    except (EvidenceRequiredError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"data": record}


# ---------------------------------------------------------------------------
# 10. GET /pm-schedules/{schedule_id}/completions — selected-PM history
# ---------------------------------------------------------------------------

@router.get("/pm-schedules/{schedule_id}/completions")
async def list_pm_schedule_completions(
    schedule_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Recent immutable completion records for one selected schedule only."""
    schedule = supabase.table("pm_schedules").select("id").eq("id", schedule_id).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single().execute()
    if not schedule or not schedule.data:
        raise HTTPException(status_code=404, detail="PM schedule not found")
    records = supabase.table("pm_completion_records").select(
        "*, pm_completion_items(*)"
    ).eq("tenant_id", current_user.hotel_id).eq("pm_schedule_id", schedule_id).order(
        "completed_at", desc=True
    ).limit(12).execute()
    return {"data": records.data or []}


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
               "estimated_minutes", "next_due_at", "is_active", "assigned_to_role", "recurrence_basis"}
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

def _asset_or_404(asset_id: str, current_user: CurrentUser) -> dict:
    result = supabase.table("assets").select("id").eq("id", asset_id).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single().execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Asset not found")
    return result.data


@router.get("/{asset_id}/downtime")
async def list_asset_downtime(asset_id: str, limit: int = Query(25, ge=1, le=100), current_user: CurrentUser = Depends(get_current_user)):
    _asset_or_404(asset_id, current_user)
    result = supabase.table("asset_downtime_periods").select("*").eq(
        "tenant_id", current_user.hotel_id
    ).eq("asset_id", asset_id).order("started_at", desc=True).limit(limit).execute()
    return {"data": [with_elapsed_minutes(row) for row in (result.data or [])]}


@router.post("/{asset_id}/downtime")
async def start_asset_downtime(asset_id: str, request: StartAssetDowntimeRequest, current_user: CurrentUser = Depends(require_role("engineer", "chief_engineer", "gm"))):
    _asset_or_404(asset_id, current_user)
    if request.work_order_id:
        work_order = supabase.table("work_orders").select("asset_id").eq("id", str(request.work_order_id)).eq(
            "tenant_id", current_user.hotel_id
        ).maybe_single().execute()
        if not work_order or not work_order.data:
            raise HTTPException(status_code=404, detail="Work order not found")
        if str(work_order.data.get("asset_id") or "") != asset_id:
            raise HTTPException(status_code=422, detail="Work order must be linked to this asset")
    return {"data": start_asset_downtime_service(
        db=supabase, asset_id=asset_id, tenant_id=current_user.hotel_id, actor_id=current_user.user_id,
        payload=request.model_dump(mode="json", exclude_none=True),
    )}


@router.post("/{asset_id}/downtime/{downtime_id}/restore")
async def restore_asset_downtime(asset_id: str, downtime_id: str, request: RestoreAssetDowntimeRequest, current_user: CurrentUser = Depends(require_role("engineer", "chief_engineer", "gm"))):
    _asset_or_404(asset_id, current_user)
    return {"data": restore_asset_downtime_service(
        db=supabase, asset_id=asset_id, downtime_id=downtime_id, tenant_id=current_user.hotel_id,
        actor_id=current_user.user_id, notes=request.notes,
    )}


@router.get("/{asset_id}/reliability")
async def get_asset_reliability(asset_id: str, current_user: CurrentUser = Depends(get_current_user)):
    _asset_or_404(asset_id, current_user)
    periods = supabase.table("asset_downtime_periods").select(
        "id, started_at, restored_at, downtime_type, impact_level, work_order_id"
    ).eq("tenant_id", current_user.hotel_id).eq("asset_id", asset_id).execute().data or []
    work_orders = supabase.table("work_orders").select("id, completed_at, verification_result").eq(
        "tenant_id", current_user.hotel_id
    ).eq("asset_id", asset_id).eq("status", "completed").execute().data or []
    work_order_ids = [row["id"] for row in work_orders]
    relationships, reopen_events = [], []
    if work_order_ids:
        relationships = supabase.table("work_order_relationships").select("parent_work_order_id, relationship_type").eq(
            "tenant_id", current_user.hotel_id
        ).in_("parent_work_order_id", work_order_ids).execute().data or []
        reopen_events = supabase.table("work_order_events").select("work_order_id, event_type").eq(
            "tenant_id", current_user.hotel_id
        ).in_("work_order_id", work_order_ids).eq("event_type", "reopened").execute().data or []
    return {"data": calculate_asset_reliability(
        periods=periods, work_orders=work_orders, relationships=relationships, reopen_events=reopen_events,
    )}


def _meter_with_latest(meter: dict, current_user: CurrentUser) -> dict:
    latest_result = supabase.table("meter_readings").select("*").eq(
        "tenant_id", current_user.hotel_id
    ).eq("meter_id", meter["id"]).order("recorded_at", desc=True).limit(1).execute()
    latest = (latest_result.data or [None])[0]
    meter["latest_reading"] = latest
    meter["current_status"] = meter_freshness_status(
        latest.get("recorded_at") if latest else None, meter.get("stale_after_hours"),
    ) or (latest.get("status_at_recording") if latest else "no_readings")
    return meter


def _meter_or_404(meter_id: str, current_user: CurrentUser) -> dict:
    result = supabase.table("asset_meters").select("*").eq("id", meter_id).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single().execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Meter not found")
    return result.data


@router.post("/meters")
async def create_property_meter(
    request: CreateMeterRequest,
    current_user: CurrentUser = Depends(require_role("chief_engineer", "gm")),
):
    """Create a location-owned meter without inventing an equipment asset."""
    if not request.location_text:
        raise HTTPException(status_code=422, detail="Location is required for a property meter")
    try:
        result = supabase.table("asset_meters").insert({
            **request.model_dump(exclude_none=True), "tenant_id": current_user.hotel_id,
        }).execute()
    except Exception as exc:
        raise HTTPException(status_code=409, detail="A meter with this name already exists at this location") from exc
    return {"data": result.data[0]}


@router.get("/meters/{meter_id}")
async def get_meter(meter_id: str, current_user: CurrentUser = Depends(get_current_user)):
    return {"data": _meter_with_latest(_meter_or_404(meter_id, current_user), current_user)}


@router.patch("/meters/{meter_id}")
async def update_meter(
    meter_id: str,
    request: UpdateMeterRequest,
    current_user: CurrentUser = Depends(require_role("chief_engineer", "gm")),
):
    meter = _meter_or_404(meter_id, current_user)
    update_data = request.model_dump(exclude_none=True)
    if "unit" in update_data and update_data["unit"] != meter["unit"]:
        existing = supabase.table("meter_readings").select("id").eq("tenant_id", current_user.hotel_id).eq(
            "meter_id", meter_id
        ).limit(1).execute().data or []
        if existing:
            raise HTTPException(status_code=422, detail="Unit cannot change after a meter has readings")
    if not update_data:
        return {"data": meter}
    result = supabase.table("asset_meters").update({
        **update_data, "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", meter_id).eq("tenant_id", current_user.hotel_id).execute()
    return {"data": result.data[0] if result.data else None}


@router.get("/meters/{meter_id}/readings")
async def list_meter_readings(
    meter_id: str,
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    current_user: CurrentUser = Depends(get_current_user),
):
    _meter_or_404(meter_id, current_user)
    query = supabase.table("meter_readings").select("*").eq("tenant_id", current_user.hotel_id).eq(
        "meter_id", meter_id
    ).order("recorded_at", desc=True).limit(limit)
    if start:
        query = query.gte("recorded_at", start.isoformat())
    if end:
        query = query.lte("recorded_at", end.isoformat())
    return {"data": query.execute().data or []}


@router.post("/meters/{meter_id}/readings")
async def record_meter_reading(
    meter_id: str,
    request: RecordMeterReadingRequest,
    current_user: CurrentUser = Depends(require_role("engineer", "chief_engineer", "gm")),
):
    meter = _meter_or_404(meter_id, current_user)
    recorded_at = request.recorded_at
    now = datetime.now(timezone.utc)
    if recorded_at and (recorded_at > now + timedelta(minutes=5) or recorded_at < now - timedelta(days=365 * 20)):
        raise HTTPException(status_code=422, detail="Recorded time must be within the last 20 years and no more than five minutes in the future")
    asset = _asset_or_404(str(meter["asset_id"]), current_user) if meter.get("asset_id") else None
    return {"data": persist_condition_reading(
        db=supabase, meter=meter, tenant_id=current_user.hotel_id, user_id=current_user.user_id,
        value=request.value, source="manual", recorded_at=recorded_at, notes=request.notes, asset=asset,
    )}


@router.get("/{asset_id}/meters")
async def list_asset_meters(asset_id: str, current_user: CurrentUser = Depends(get_current_user)):
    _asset_or_404(asset_id, current_user)
    meters = supabase.table("asset_meters").select("*").eq("tenant_id", current_user.hotel_id).eq(
        "asset_id", asset_id
    ).order("name").execute().data or []
    return {"data": [_meter_with_latest(meter, current_user) for meter in meters]}


@router.post("/{asset_id}/meters")
async def create_asset_meter(
    asset_id: str,
    request: CreateMeterRequest,
    current_user: CurrentUser = Depends(require_role("chief_engineer", "gm")),
):
    _asset_or_404(asset_id, current_user)
    payload = request.model_dump(exclude_none=True)
    payload.update({"tenant_id": current_user.hotel_id, "asset_id": asset_id})
    try:
        result = supabase.table("asset_meters").insert(payload).execute()
    except Exception as exc:
        raise HTTPException(status_code=409, detail="A meter with this name already exists for this asset") from exc
    return {"data": result.data[0]}


@router.get("/{asset_id}/condition-summary")
async def asset_condition_summary(asset_id: str, current_user: CurrentUser = Depends(get_current_user)):
    _asset_or_404(asset_id, current_user)
    meters = supabase.table("asset_meters").select("*").eq("tenant_id", current_user.hotel_id).eq(
        "asset_id", asset_id
    ).eq("is_active", True).execute().data or []
    hydrated = [_meter_with_latest(meter, current_user) for meter in meters]
    summary = {"total_meters": len(hydrated), "normal_count": 0, "warning_count": 0, "critical_count": 0, "stale_count": 0, "no_readings_count": 0}
    for meter in hydrated:
        key = f"{meter['current_status']}_count"
        if key in summary:
            summary[key] += 1
    summary["meters"] = hydrated
    return {"data": summary}


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
    asset = result.data[0]
    active = supabase.table("asset_downtime_periods").select(
        "id, started_at, downtime_type, impact_level, work_order_id"
    ).eq("tenant_id", current_user.hotel_id).eq("asset_id", asset_id).is_(
        "restored_at", "null"
    ).maybe_single().execute()
    asset["active_downtime"] = with_elapsed_minutes(active.data) if active and active.data else None
    return {"data": asset}


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
    for field in ("category_id", "room_id"):
        if field in update_data:
            update_data[field] = str(update_data[field])
    for field in ("purchase_date", "installation_date", "warranty_expires"):
        if field in update_data:
            update_data[field] = str(update_data[field])

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

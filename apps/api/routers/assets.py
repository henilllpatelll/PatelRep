from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import Optional
from uuid import UUID
from pydantic import BaseModel
from middleware.auth import get_current_user, require_role, CurrentUser
from core.roles import ASSET_MANAGER_ROLES, ASSET_RETIRE_ROLES, PM_EXECUTION_ROLES, PM_SCHEDULE_MANAGER_ROLES
from models.requests import AssignPMChecklistRequest, AttachAssetPhotoRequest, BatchAcknowledgePredictionsRequest, CompletePMProgramRequest, CreateAssetRequest, CreateMeterRequest, CreatePMScheduleRequest, RecordMeterReadingRequest, RestoreAssetDowntimeRequest, RetireAssetRequest, StartAssetDowntimeRequest, UpdateAssetCriticalityRequest, UpdateAssetRequest, UpdateMeterRequest
from core.database import supabase
from routers.evidence import _create_evidence_signed_url
from services.programs.contracts import EvidenceRequiredError
from services.programs.assignment import annotate_assignee
from services.programs.checklist_binding import PmChecklistUnavailable, load_assignable_template, load_resolutions
from services.programs.execution import PmCompletionRefused, persist_pm_completion
from services.asset_reliability import calculate_asset_reliability, restore_asset_downtime as restore_asset_downtime_service, start_asset_downtime as start_asset_downtime_service, with_elapsed_minutes
from services.reporting.periods import hotel_timezone
from services.condition_monitoring import meter_freshness_status, persist_condition_reading

router = APIRouter(prefix="/assets", tags=["assets"])


# ---------------------------------------------------------------------------
# Shared helpers: audit, tag identity, same-property references
# ---------------------------------------------------------------------------

def _audit(*, current_user: CurrentUser, resource_type: str, resource_id: str, action: str, old_state: dict, new_state: dict, reason_note: Optional[str] = None) -> None:
    supabase.table("operational_audit_events").insert({
        "tenant_id": current_user.hotel_id, "resource_type": resource_type, "resource_id": resource_id,
        "action": action, "actor_id": current_user.user_id, "actor_role": current_user.role,
        "old_state": old_state, "new_state": new_state, "reason_note": reason_note, "source": "api",
    }).execute()


def _is_unique_violation(exc: Exception) -> bool:
    text = str(exc)
    return "23505" in text or "duplicate key" in text.lower()


def _unique_violation_kind(exc: Exception) -> Optional[str]:
    """Which uniqueness a 23505 broke: the physical label ("tag"), the record id ("id"), or something else (None)."""
    if not _is_unique_violation(exc):
        return None
    text = str(exc).lower()
    if "tag" in text:
        return "tag"
    if "pkey" in text or "(id)" in text:
        return "id"
    return "tag"  # the only other unique rule on this table; keeps the pre-existing behaviour for unnamed errors


def _tag_conflict() -> HTTPException:
    return HTTPException(status_code=409, detail={"code": "asset_tag_in_use", "message": "Another active asset already uses this tag."})


def _version_conflict(current: Optional[dict]) -> HTTPException:
    return HTTPException(status_code=409, detail={
        "code": "asset_conflict",
        "message": "This equipment record was changed by someone else. Review the latest version and try again.",
        "current": current,
    })


def _normalize_tag(tag: Optional[str]) -> Optional[str]:
    """The stored form of a physical label: trimmed, and absent when blank. Case is kept (it is what is printed)."""
    cleaned = (tag or "").strip()
    return cleaned or None


def _require_tag_free(tag: Optional[str], current_user: CurrentUser, *, except_asset_id: Optional[str] = None) -> None:
    """An active asset's tag identifies it at the scanner, so two active assets cannot share one (case-insensitive)."""
    if not tag:
        return
    pattern = tag.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    rows = supabase.table("assets").select("id, asset_tag").eq("tenant_id", current_user.hotel_id).eq(
        "is_active", True
    ).ilike("asset_tag", pattern).limit(5).execute().data or []
    clash = [r for r in rows if (r.get("asset_tag") or "").strip().lower() == tag.lower() and str(r["id"]) != str(except_asset_id or "")]
    if clash:
        raise HTTPException(status_code=409, detail={"code": "asset_tag_in_use", "message": "Another active asset already uses this tag."})


def _require_same_property(table: str, row_id: Optional[str], current_user: CurrentUser, label: str) -> None:
    """A category or room named in a request must belong to the caller's own property."""
    if not row_id:
        return
    found = supabase.table(table).select("id").eq("id", str(row_id)).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    if not found or not found.data:
        raise HTTPException(status_code=422, detail=f"{label} not found at this property")


def _own_asset(asset_id: str, current_user: CurrentUser) -> Optional[dict]:
    """The full asset row when it belongs to the caller's property, otherwise None (never another property's row)."""
    found = supabase.table("assets").select("*").eq("id", str(asset_id)).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    return found.data if found and found.data else None


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
    current_user: CurrentUser = Depends(require_role(*ASSET_MANAGER_ROLES))
):
    """Register equipment. A client-generated `id` makes the call retry-safe: replaying the same id returns the record
    that was already created (HTTP 200) and never a second asset."""
    asset_data = {
        "tenant_id": current_user.hotel_id,
        **request.model_dump(exclude_none=True),
    }
    client_id = str(asset_data.pop("id")) if "id" in asset_data else None
    for uuid_field in ("category_id", "room_id"):
        if uuid_field in asset_data:
            asset_data[uuid_field] = str(asset_data[uuid_field])
    for date_field in ("purchase_date", "installation_date", "warranty_expires"):
        if date_field in asset_data:
            asset_data[date_field] = str(asset_data[date_field])

    if client_id:
        replay = _own_asset(client_id, current_user)
        if replay:
            return {"data": replay}
        asset_data["id"] = client_id

    _require_same_property("asset_categories", asset_data.get("category_id"), current_user, "Category")
    _require_same_property("rooms", asset_data.get("room_id"), current_user, "Room")
    tag = _normalize_tag(asset_data.pop("asset_tag", None))
    if tag:
        _require_tag_free(tag, current_user)
        asset_data["asset_tag"] = tag

    try:
        result = supabase.table("assets").insert(asset_data).execute()
    except Exception as exc:  # noqa: BLE001 - only uniqueness races are translated
        kind = _unique_violation_kind(exc)
        if kind == "tag":
            raise _tag_conflict() from exc
        if kind == "id":
            # Two taps of the same registration racing each other: the loser reads back the winner's row. An id that
            # exists only in another property is refused without saying so.
            replay = _own_asset(client_id, current_user) if client_id else None
            if replay:
                return {"data": replay}
            raise HTTPException(status_code=409, detail={"code": "asset_id_in_use", "message": "That equipment id cannot be used."}) from exc
        raise
    created = result.data[0] if result.data else None
    if created:
        _audit(current_user=current_user, resource_type="asset", resource_id=created["id"], action="asset.created",
               old_state={}, new_state={"name": created.get("name"), "asset_tag": created.get("asset_tag"), "room_id": created.get("room_id")})
    return {"data": created}


# ---------------------------------------------------------------------------
# 3. GET /failure-predictions  — active unacknowledged predictions
# ---------------------------------------------------------------------------

@router.get("/failure-predictions")
async def get_failure_predictions(
    asset_id: Optional[str] = Query(None, description="Only this asset's open predictions"),
    current_user: CurrentUser = Depends(get_current_user),
):
    query = supabase.table("failure_predictions")\
        .select("*, assets(name, category_id, asset_categories(name))")\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("is_acknowledged", False)\
        .order("risk_score", desc=True)\
        .limit(10)
    if asset_id:
        query = query.eq("asset_id", asset_id)
    return {"data": query.execute().data}


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

_PM_SCHEDULE_SELECT = "*, assets(name, room_id, asset_tag, location_text, manufacturer, is_active, asset_categories(name, code), rooms(room_number))"


@router.get("/pm-schedules")
async def list_pm_schedules(current_user: CurrentUser = Depends(get_current_user)):
    result = supabase.table("pm_schedules")\
        .select(_PM_SCHEDULE_SELECT)\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("is_active", True)\
        .order("next_due_at")\
        .execute()
    schedules = result.data or []
    resolutions = load_resolutions(supabase, current_user.hotel_id, schedules)
    for schedule in schedules:
        schedule["checklist"] = resolutions[str(schedule["id"])]
        annotate_assignee(schedule)
    return {"data": schedules}


@router.get("/pm-schedules/{schedule_id}")
async def get_pm_schedule(schedule_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """One schedule with its exact asset and checklist state: the target of every "open this PM" link."""
    try:
        UUID(schedule_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="PM schedule not found")
    result = supabase.table("pm_schedules").select(_PM_SCHEDULE_SELECT).eq("id", schedule_id).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single().execute()
    schedule = result.data if result else None
    if not schedule:
        raise HTTPException(status_code=404, detail="PM schedule not found")
    schedule["checklist"] = load_resolutions(supabase, current_user.hotel_id, [schedule])[str(schedule["id"])]
    annotate_assignee(schedule)
    return {"data": schedule}


# ---------------------------------------------------------------------------
# 8. POST /pm-schedules  — create PM schedule
# ---------------------------------------------------------------------------

@router.post("/pm-schedules")
async def create_pm_schedule(
    request: CreatePMScheduleRequest,
    current_user: CurrentUser = Depends(require_role(*PM_SCHEDULE_MANAGER_ROLES))
):
    asset = supabase.table("assets").select("id, is_active").eq("id", str(request.asset_id)).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single().execute()
    if not asset or not asset.data:
        raise HTTPException(status_code=404, detail="Asset not found")
    if not asset.data.get("is_active"):
        raise HTTPException(status_code=409, detail="A PM schedule cannot be created for inactive equipment")
    row = {"tenant_id": current_user.hotel_id, **request.model_dump(mode="json", exclude={"checklist_template_id"})}
    if request.checklist_template_id:
        try:
            template = load_assignable_template(supabase, current_user.hotel_id, str(request.checklist_template_id))
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        row["checklist_template_id"] = template["id"]
        row["checklist_template_code"] = template["code"]
    result = supabase.table("pm_schedules").insert(row).execute()
    created = result.data[0] if result.data else None
    if created:
        _audit(current_user=current_user, resource_type="pm_schedule", resource_id=created["id"], action="pm_schedule.created",
               old_state={}, new_state={"asset_id": created["asset_id"], "next_due_at": created["next_due_at"], "checklist_template_id": created.get("checklist_template_id")})
    return {"data": created}


@router.put("/pm-schedules/{schedule_id}/checklist")
async def assign_pm_schedule_checklist(
    schedule_id: str,
    request: AssignPMChecklistRequest,
    current_user: CurrentUser = Depends(require_role(*PM_SCHEDULE_MANAGER_ROLES)),
):
    """Bind (or with null, unbind) the checklist a technician follows for this schedule. Past completions keep the
    procedure they were done against; only future inspections use the new binding."""
    schedule = supabase.table("pm_schedules").select("id, checklist_template_id, checklist_template_code").eq(
        "id", schedule_id
    ).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    if not schedule or not schedule.data:
        raise HTTPException(status_code=404, detail="PM schedule not found")
    update = {"checklist_template_id": None, "checklist_template_code": None}
    if request.checklist_template_id:
        try:
            template = load_assignable_template(supabase, current_user.hotel_id, str(request.checklist_template_id))
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        update = {"checklist_template_id": template["id"], "checklist_template_code": template["code"]}
    result = supabase.table("pm_schedules").update(update).eq("id", schedule_id).eq(
        "tenant_id", current_user.hotel_id
    ).execute()
    _audit(current_user=current_user, resource_type="pm_schedule", resource_id=schedule_id, action="pm_schedule.checklist_assigned",
           old_state={"checklist_template_id": schedule.data.get("checklist_template_id")}, new_state={"checklist_template_id": update["checklist_template_id"]})
    updated = result.data[0] if result.data else None
    if updated:
        updated["checklist"] = load_resolutions(supabase, current_user.hotel_id, [updated])[str(updated["id"])]
    return {"data": updated}


# ---------------------------------------------------------------------------
# 9. POST /pm-schedules/{schedule_id}/complete  — mark PM complete (NEW)
# ---------------------------------------------------------------------------

@router.post("/pm-schedules/{schedule_id}/complete")
async def complete_pm_schedule(
    schedule_id: str,
    request: CompletePMProgramRequest,
    current_user: CurrentUser = Depends(require_role(*PM_EXECUTION_ROLES))
):
    """Record PM proof and advance the schedule, atomically and at most once per `submission_id`."""
    try:
        UUID(schedule_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="PM schedule not found")
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
    except PmChecklistUnavailable as exc:
        raise HTTPException(status_code=409, detail={
            "code": "checklist_unavailable",
            "message": "This schedule's checklist is not available. Ask a chief engineer to assign a current one.",
            "checklist": exc.resolution,
        }) from exc
    except PmCompletionRefused as exc:
        raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message}) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (EvidenceRequiredError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"data": record, "meta": {"replayed": bool(record.get("replayed"))}}


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
# 10b. GET /pm-completions — property-wide PM inspection history (paged, newest first)
# ---------------------------------------------------------------------------

@router.get("/pm-completions")
async def list_pm_completions(
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
    asset_id: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Slim, read-only summaries for the mobile History view. Full records (items, signed evidence)
    stay on GET /pm-schedules/{id}/completions/{completion_id}."""
    query = supabase.table("pm_completion_records").select(
        "id, pm_schedule_id, asset_id, technician_id, completed_at, checklist_template_id, "
        "checklist_version, labor_minutes, defects, pm_completion_items(result)"
    ).eq("tenant_id", current_user.hotel_id)
    if asset_id:
        query = query.eq("asset_id", asset_id)
    rows = (query.order("completed_at", desc=True).range(offset, offset + limit).execute().data) or []
    has_more = len(rows) > limit
    rows = rows[:limit]

    def _names(table: str, column: str, ids: set, field: str = "name") -> dict:
        if not ids:
            return {}
        found = supabase.table(table).select(f"id, {field}").eq("tenant_id", current_user.hotel_id).in_(
            "id", sorted(ids)
        ).execute().data or []
        return {row["id"]: row.get(field) for row in found}

    schedule_names = _names("pm_schedules", "id", {r["pm_schedule_id"] for r in rows if r.get("pm_schedule_id")})
    asset_names = _names("assets", "id", {r["asset_id"] for r in rows if r.get("asset_id")})
    profiles = supabase.table("user_profiles").select("id, full_name, preferred_name").eq(
        "tenant_id", current_user.hotel_id
    ).in_("id", sorted({r["technician_id"] for r in rows if r.get("technician_id")})).execute().data or [] if rows else []
    technicians = {p["id"]: (p.get("preferred_name") or p.get("full_name")) for p in profiles}

    data = []
    for row in rows:
        results = [item.get("result") for item in (row.pop("pm_completion_items", None) or [])]
        data.append({
            **row,
            "schedule_name": schedule_names.get(row.get("pm_schedule_id")),
            "asset_name": asset_names.get(row.get("asset_id")),
            "technician_name": technicians.get(row.get("technician_id")),
            "passed_count": results.count("passed"),
            "failed_count": results.count("failed"),
            "not_applicable_count": results.count("not_applicable"),
        })
    return {"data": data, "meta": {"offset": offset, "limit": limit, "has_more": has_more}}


# ---------------------------------------------------------------------------
# 10. PATCH /pm-schedules/{schedule_id}  — update PM schedule (NEW)
# ---------------------------------------------------------------------------

_SCHEDULE_AUDITED_FIELDS = ("next_due_at", "is_active", "interval_type", "interval_days", "recurrence_basis")


@router.patch("/pm-schedules/{schedule_id}")
async def update_pm_schedule(
    schedule_id: str,
    request: Request,
    current_user: CurrentUser = Depends(require_role(*PM_SCHEDULE_MANAGER_ROLES))
):
    """Update a PM schedule (reschedule, deactivate, change interval). Due-date, interval and active changes are audited."""
    body = await request.json()
    expected_version = body.get("expected_version")
    if expected_version is not None and (not isinstance(expected_version, int) or isinstance(expected_version, bool) or expected_version < 1):
        raise HTTPException(status_code=422, detail="expected_version must be a positive integer")
    allowed = {"name", "description", "interval_type", "interval_days",
               "estimated_minutes", "next_due_at", "is_active", "assigned_to_role", "recurrence_basis"}
    update_data = {k: v for k, v in body.items() if k in allowed}

    if not update_data:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    before = supabase.table("pm_schedules").select("*").eq("id", schedule_id).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single().execute()
    if not before or not before.data:
        raise HTTPException(status_code=404, detail="PM schedule not found")
    previous = dict(before.data)
    base_version = previous.get("row_version") or 1
    if expected_version is not None and expected_version != base_version:
        raise HTTPException(status_code=409, detail={
            "code": "version_conflict", "current_version": base_version,
            "message": "This schedule was changed by someone else. Review the latest version and try again.",
        })

    update_data["row_version"] = base_version + 1
    result = supabase.table("pm_schedules")\
        .update(update_data)\
        .eq("id", schedule_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("row_version", base_version)\
        .execute()
    if not result.data:
        raise HTTPException(status_code=409, detail={
            "code": "version_conflict", "message": "This schedule was changed by someone else. Review the latest version and try again.",
        })
    changed = {k: v for k, v in update_data.items() if k in _SCHEDULE_AUDITED_FIELDS and previous.get(k) != v}
    if changed:
        _audit(current_user=current_user, resource_type="pm_schedule", resource_id=schedule_id, action="pm_schedule.updated",
               old_state={k: previous.get(k) for k in changed}, new_state=changed)

    return {"data": result.data[0] if result.data else None}


# ---------------------------------------------------------------------------
# 11. DELETE /pm-schedules/{schedule_id}  — deactivate PM schedule (NEW)
# ---------------------------------------------------------------------------

@router.delete("/pm-schedules/{schedule_id}")
async def deactivate_pm_schedule(
    schedule_id: str,
    current_user: CurrentUser = Depends(require_role(*PM_SCHEDULE_MANAGER_ROLES))
):
    """Soft-delete (deactivate) a PM schedule. Its completions stay readable."""
    result = supabase.table("pm_schedules")\
        .update({"is_active": False})\
        .eq("id", schedule_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="PM schedule not found")
    _audit(current_user=current_user, resource_type="pm_schedule", resource_id=schedule_id, action="pm_schedule.deactivated",
           old_state={"is_active": True}, new_state={"is_active": False})
    return {"data": result.data[0]}


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
# 13b. GET /browse and GET /lookup  — mobile inventory (read-only, NEW)
# Registered before /{asset_id} so the static names are not captured as ids.
# ---------------------------------------------------------------------------

_BROWSE_ACTIVE_WO_STATUSES = ("open", "escalated", "in_progress", "on_hold")
_BROWSE_SORTS = ("name", "location", "last_serviced", "next_pm", "risk", "updated")
_BROWSE_CHUNK = 1000
_BROWSE_MAX_ROWS = 20000
_PM_DUE_SOON_DAYS = 7


def _fetch_all(build) -> list[dict]:
    """Walk a tenant-scoped query in fixed chunks: PostgREST caps one response, an inventory can exceed it."""
    rows: list[dict] = []
    while len(rows) < _BROWSE_MAX_ROWS:
        chunk = build().range(len(rows), len(rows) + _BROWSE_CHUNK - 1).execute().data or []
        rows.extend(chunk)
        if len(chunk) < _BROWSE_CHUNK:
            break
    return rows


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _service_status(downtime: Optional[dict], in_progress: int) -> str:
    """Display status derived from recorded facts (not a stored column): downtime impact, then a repair underway."""
    if downtime and downtime.get("impact_level") == "out_of_service":
        return "out_of_service"
    if downtime and downtime.get("impact_level") == "degraded":
        return "degraded"
    if in_progress > 0:
        return "under_repair"
    return "operational"


def _asset_search_text(asset: dict) -> str:
    room = (asset.get("rooms") or {}).get("room_number")
    category = (asset.get("asset_categories") or {}).get("name")
    fields = (
        asset.get("name"), asset.get("asset_tag"), asset.get("serial_number"), asset.get("manufacturer"),
        asset.get("model"), asset.get("location_text"), room, category,
    )
    return " ".join(str(value) for value in fields if value).casefold()


def _sort_key(sort_by: str):
    far = datetime.max.replace(tzinfo=timezone.utc)

    def name(a: dict) -> str:
        return (a.get("name") or "").casefold()

    if sort_by == "location":
        return lambda a: ((((a.get("rooms") or {}).get("room_number")) or a.get("location_text") or "~").casefold(), name(a))
    if sort_by == "last_serviced":
        return lambda a: (-(_parse_iso(a.get("last_serviced_at")) or datetime.min.replace(tzinfo=timezone.utc)).timestamp(), name(a))
    if sort_by == "next_pm":
        return lambda a: ((_parse_iso(a.get("next_pm_due_at")) or far).timestamp(), name(a))
    if sort_by == "risk":
        return lambda a: (-(a.get("failure_risk_score") or 0), name(a))
    if sort_by == "updated":
        return lambda a: (-(_parse_iso(a.get("updated_at")) or datetime.min.replace(tzinfo=timezone.utc)).timestamp(), name(a))
    return name


@router.get("/browse")
async def browse_assets(
    q: Optional[str] = Query(None, max_length=100),
    category_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None, pattern="^(operational|degraded|out_of_service|under_repair)$"),
    maintenance: Optional[str] = Query(None, pattern="^(active_work_order|pm_overdue|pm_due_soon|none)$"),
    reliability: Optional[str] = Query(None, pattern="^(active_prediction|repeat_repairs|confirmed_downtime)$"),
    attention: bool = Query(False, description="Derived group: degraded/out of service, PM overdue, or an open prediction"),
    room_id: Optional[str] = Query(None),
    floor: Optional[int] = Query(None),
    building: Optional[str] = Query(None),
    sort_by: str = Query("name"),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Server-side search, filter, sort and paging over the whole property inventory.

    Every filter runs over all of the hotel's active assets, never just the page on screen. `service_status`
    is derived (active downtime impact, else a repair in progress, else operational); it is not a stored status.
    """
    if sort_by not in _BROWSE_SORTS:
        raise HTTPException(status_code=422, detail="Unknown sort")
    tenant_id = current_user.hotel_id
    now = datetime.now(timezone.utc)
    tz = hotel_timezone(supabase, tenant_id)
    today = now.astimezone(tz).date()

    def base():
        query = supabase.table("assets").select(
            "id, name, asset_tag, serial_number, category_id, room_id, location_text, manufacturer, model, "
            "failure_risk_score, updated_at, asset_categories(name, code), rooms(room_number, floor, building)"
        ).eq("tenant_id", tenant_id).eq("is_active", True).order("id")
        if category_id:
            query = query.eq("category_id", category_id)
        if room_id:
            query = query.eq("room_id", room_id)
        return query

    assets = _fetch_all(base)
    terms = [term for term in (q or "").casefold().split() if term]
    if terms:
        assets = [a for a in assets if all(term in _asset_search_text(a) for term in terms)]
    if floor is not None:
        assets = [a for a in assets if (a.get("rooms") or {}).get("floor") == floor]
    if building:
        assets = [a for a in assets if (a.get("rooms") or {}).get("building") == building]

    downtime_rows = _fetch_all(lambda: supabase.table("asset_downtime_periods").select(
        "asset_id, started_at, restored_at, downtime_type, impact_level, work_order_id"
    ).eq("tenant_id", tenant_id).gte("started_at", (now - timedelta(days=365)).isoformat()).order("started_at"))
    active_downtime: dict[str, dict] = {}
    downtime_assets: set[str] = set()
    for row in downtime_rows:
        downtime_assets.add(str(row["asset_id"]))
        if not row.get("restored_at"):
            active_downtime[str(row["asset_id"])] = with_elapsed_minutes(row)

    wo_rows = _fetch_all(lambda: supabase.table("work_orders").select(
        "asset_id, status, completed_at"
    ).eq("tenant_id", tenant_id).gte("created_at", (now - timedelta(days=365)).isoformat()).order("created_at"))
    active_wo: dict[str, int] = {}
    in_progress: dict[str, int] = {}
    last_repair: dict[str, str] = {}
    repeat: dict[str, int] = {}
    for row in wo_rows:
        asset_key = str(row.get("asset_id") or "")
        if not asset_key:
            continue
        if row.get("status") in _BROWSE_ACTIVE_WO_STATUSES:
            active_wo[asset_key] = active_wo.get(asset_key, 0) + 1
            if row.get("status") == "in_progress":
                in_progress[asset_key] = in_progress.get(asset_key, 0) + 1
        elif row.get("status") == "completed" and row.get("completed_at"):
            completed = str(row["completed_at"])
            if completed > last_repair.get(asset_key, ""):
                last_repair[asset_key] = completed
            if (_parse_iso(completed) or now) >= now - timedelta(days=90):
                repeat[asset_key] = repeat.get(asset_key, 0) + 1

    pm_rows = _fetch_all(lambda: supabase.table("pm_schedules").select(
        "asset_id, next_due_at, last_completed_at"
    ).eq("tenant_id", tenant_id).eq("is_active", True).order("id"))
    next_pm: dict[str, str] = {}
    pm_overdue: set[str] = set()
    pm_due_soon: set[str] = set()
    last_pm: dict[str, str] = {}
    for row in pm_rows:
        asset_key = str(row["asset_id"])
        due = _parse_iso(row.get("next_due_at"))
        if due:
            if asset_key not in next_pm or str(row["next_due_at"]) < next_pm[asset_key]:
                next_pm[asset_key] = str(row["next_due_at"])
            # Hotel calendar days, the same rule the PM screens use: due earlier today is "due today", not overdue.
            days_until = (due.astimezone(tz).date() - today).days
            if days_until < 0:
                pm_overdue.add(asset_key)
            elif days_until <= _PM_DUE_SOON_DAYS:
                pm_due_soon.add(asset_key)
        if row.get("last_completed_at") and str(row["last_completed_at"]) > last_pm.get(asset_key, ""):
            last_pm[asset_key] = str(row["last_completed_at"])

    prediction_rows = _fetch_all(lambda: supabase.table("failure_predictions").select(
        "asset_id"
    ).eq("tenant_id", tenant_id).eq("is_acknowledged", False).order("id"))
    predicted = {str(row["asset_id"]) for row in prediction_rows if row.get("asset_id")}

    rows: list[dict] = []
    for asset in assets:
        key = str(asset["id"])
        downtime = active_downtime.get(key)
        serviced = max(filter(None, [last_repair.get(key), last_pm.get(key)]), default=None)
        asset.pop("serial_number", None)  # searchable, not listed
        asset.update({
            "active_downtime": downtime,
            "service_status": _service_status(downtime, in_progress.get(key, 0)),
            "active_work_order_count": active_wo.get(key, 0),
            "next_pm_due_at": next_pm.get(key),
            "pm_overdue": key in pm_overdue,
            "pm_due_soon": key in pm_due_soon,
            "last_serviced_at": serviced,
            "repeat_repairs_90d": repeat.get(key, 0),
            "has_active_prediction": key in predicted,
            "had_downtime_365d": key in downtime_assets,
        })
        rows.append(asset)

    if status:
        rows = [a for a in rows if a["service_status"] == status]
    if attention:
        rows = [
            a for a in rows
            if a["service_status"] in ("degraded", "out_of_service") or a["pm_overdue"] or a["has_active_prediction"]
        ]
    if maintenance == "active_work_order":
        rows = [a for a in rows if a["active_work_order_count"] > 0]
    elif maintenance == "pm_overdue":
        rows = [a for a in rows if a["pm_overdue"]]
    elif maintenance == "pm_due_soon":
        rows = [a for a in rows if a["pm_due_soon"]]
    elif maintenance == "none":
        rows = [a for a in rows if not (a["active_work_order_count"] or a["pm_overdue"] or a["pm_due_soon"])]
    if reliability == "active_prediction":
        rows = [a for a in rows if a["has_active_prediction"]]
    elif reliability == "repeat_repairs":
        rows = [a for a in rows if a["repeat_repairs_90d"] >= 2]
    elif reliability == "confirmed_downtime":
        rows = [a for a in rows if a["had_downtime_365d"]]

    rows.sort(key=_sort_key(sort_by))
    total = len(rows)
    start = (page - 1) * per_page
    return {"data": rows[start:start + per_page], "meta": {
        "page": page, "per_page": per_page, "total": total, "has_more": start + per_page < total,
    }}


@router.get("/lookup")
async def lookup_asset(
    asset_id: Optional[str] = Query(None, max_length=64),
    tag: Optional[str] = Query(None, max_length=64),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Resolve a scanned or typed identifier to one asset in the caller's own property.

    The code is only a lookup key: the same tenant scope and 404 apply whether the id belongs to another
    property or to nothing, so a code never confirms that equipment exists elsewhere. A tag matches regardless of
    letter case (uniqueness is case-insensitive too). Retired equipment still resolves, flagged `is_active: false`, so a
    label left on a retired unit says so instead of looking unknown; an active record always wins over a retired one.
    """
    if bool(asset_id) == bool(tag):
        raise HTTPException(status_code=422, detail="Provide exactly one of asset_id or tag")
    if asset_id:
        try:
            UUID(asset_id)
        except ValueError:
            raise HTTPException(status_code=404, detail="Asset not found")
    query = supabase.table("assets").select("id, name, asset_tag, is_active").eq("tenant_id", current_user.hotel_id)
    wanted = (tag or "").strip()
    if asset_id:
        query = query.eq("id", asset_id)
    else:
        escaped = wanted.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.ilike("asset_tag", escaped)
    rows = query.limit(10).execute().data or []
    if tag:
        rows = [r for r in rows if (r.get("asset_tag") or "").strip().lower() == wanted.lower()]
    active = [r for r in rows if r.get("is_active", True)]
    matches = active or rows
    if not matches:
        raise HTTPException(status_code=404, detail="Asset not found")
    if len(matches) > 1:
        raise HTTPException(status_code=409, detail="More than one asset has this tag; search by name or location instead")
    return {"data": matches[0]}


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
        .select("*, asset_categories(name, code), rooms(room_number, floor, building), pm_schedules(*)") \
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
    # Same derived status the inventory list shows, from property-wide counts (no work order content), so a card and
    # its detail screen can never disagree.
    open_orders = supabase.table("work_orders").select("status").eq("tenant_id", current_user.hotel_id).eq(
        "asset_id", asset_id
    ).in_("status", list(_BROWSE_ACTIVE_WO_STATUSES)).execute().data or []
    in_progress = sum(1 for row in open_orders if row.get("status") == "in_progress")
    asset["active_work_order_count"] = len(open_orders)
    recent = supabase.table("work_orders").select("id").eq("tenant_id", current_user.hotel_id).eq(
        "asset_id", asset_id
    ).eq("status", "completed").gte(
        "completed_at", (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    ).execute().data or []
    asset["repeat_repairs_90d"] = len(recent)
    asset["service_status"] = _service_status(asset["active_downtime"], in_progress)
    # Administrative status (is the record in use?) is deliberately separate from service_status (is it working?).
    asset["administrative_status"] = "active" if asset.get("is_active", True) else "inactive"
    asset["photo_url"] = _identity_photo_url(asset)
    return {"data": asset}


# ---------------------------------------------------------------------------
# 15. PATCH /{asset_id}  — update asset
# ---------------------------------------------------------------------------

@router.patch("/{asset_id}")
async def update_asset(
    asset_id: str,
    request: UpdateAssetRequest,
    current_user: CurrentUser = Depends(require_role(*ASSET_MANAGER_ROLES))
):
    """Edit an equipment record. `is_active` is the administrative status (retire / restore); condition, downtime and
    predicted risk are derived elsewhere and are not editable here (`failure_risk_score` is accepted for older clients
    and ignored).

    Concurrency: when `expected_row_version` is sent, the edit applies only if the record is still at that version; the
    check is part of the UPDATE itself, so two simultaneous editors can never both win (the loser gets 409 with the
    current record). `clear_fields` explicitly empties optional fields; omitting a field never changes it."""
    try:
        UUID(asset_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Asset not found")
    update_data = request.model_dump(exclude_none=True)
    expected_version = update_data.pop("expected_row_version", None)
    clear_fields = list(dict.fromkeys(update_data.pop("clear_fields", None) or []))
    update_data.pop("failure_risk_score", None)
    for field in ("category_id", "room_id"):
        if field in update_data:
            update_data[field] = str(update_data[field])
    for field in ("purchase_date", "installation_date", "warranty_expires"):
        if field in update_data:
            update_data[field] = str(update_data[field])
    overlap = [f for f in clear_fields if f in update_data]
    if overlap:
        raise HTTPException(status_code=422, detail=f"Cannot both set and clear: {', '.join(overlap)}")
    for field in clear_fields:
        update_data[field] = None
    if not update_data:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    existing = supabase.table("assets").select("*").eq("id", asset_id).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    if not existing or not existing.data:
        raise HTTPException(status_code=404, detail="Asset not found")
    before = dict(existing.data)
    base_version = before.get("row_version") or 1
    if expected_version is not None and expected_version != base_version:
        raise _version_conflict(before)

    _require_same_property("asset_categories", update_data.get("category_id"), current_user, "Category")
    _require_same_property("rooms", update_data.get("room_id"), current_user, "Room")
    # A date edit is checked against the dates already on record, not only against the others in this request.
    merged = {**before, **update_data}
    for later, earlier in (("warranty_expires", "installation_date"), ("warranty_expires", "purchase_date"), ("installation_date", "purchase_date")):
        if merged.get(later) and merged.get(earlier) and str(merged[later]) < str(merged[earlier]):
            raise HTTPException(status_code=422, detail=f"{later} cannot be before {earlier}")
    if "asset_tag" in update_data:
        update_data["asset_tag"] = _normalize_tag(update_data["asset_tag"])
    will_be_active = update_data.get("is_active", before.get("is_active", True))
    new_tag = update_data.get("asset_tag", before.get("asset_tag"))
    if will_be_active and ("asset_tag" in update_data or update_data.get("is_active") is True):
        _require_tag_free(new_tag, current_user, except_asset_id=asset_id)

    update_data["row_version"] = base_version + 1
    try:
        result = supabase.table("assets") \
            .update(update_data) \
            .eq("id", asset_id) \
            .eq("tenant_id", current_user.hotel_id) \
            .eq("row_version", base_version) \
            .execute()
    except Exception as exc:  # noqa: BLE001 - only the tag race is translated
        if _unique_violation_kind(exc):
            raise _tag_conflict() from exc
        raise
    if not result.data:
        # The record moved between the read above and the write: someone else's edit landed first.
        raise _version_conflict(_own_asset(asset_id, current_user))
    changed = {k: v for k, v in update_data.items() if k != "row_version" and before.get(k) != v}
    if changed:
        _audit(current_user=current_user, resource_type="asset", resource_id=asset_id, action="asset.updated",
               old_state={k: before.get(k) for k in changed}, new_state=changed)
    if before.get("is_active", True) and update_data.get("is_active") is False:
        # Retiring equipment ends its recurring work: its schedules stop generating work and drop out of the PM list.
        # Completions, work orders and downtime history stay readable. Restoring does not re-activate schedules.
        retired = supabase.table("pm_schedules").update({"is_active": False}).eq("asset_id", asset_id).eq(
            "tenant_id", current_user.hotel_id
        ).eq("is_active", True).execute().data or []
        _audit(current_user=current_user, resource_type="asset", resource_id=asset_id, action="asset.retired",
               old_state={"is_active": True}, new_state={"is_active": False, "pm_schedules_deactivated": [row["id"] for row in retired]})
    return {"data": result.data[0] if result.data else None}


# ---------------------------------------------------------------------------
# 15b. POST /{asset_id}/retire  — retire equipment (reasoned, guarded, audited)
# ---------------------------------------------------------------------------

@router.post("/{asset_id}/retire")
async def retire_asset(
    asset_id: str,
    request: RetireAssetRequest,
    current_user: CurrentUser = Depends(require_role(*ASSET_RETIRE_ROLES)),
):
    """Take equipment out of service records. Never deletes: the asset, its completions, work orders and downtime stay
    readable. Refused while the equipment has open work orders or an open downtime period (resolve those first), so a
    retirement can never strand a live repair. Its recurring schedules are deactivated with it."""
    asset = _own_asset(asset_id, current_user) if _is_uuid(asset_id) else None
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    if not asset.get("is_active", True):
        raise HTTPException(status_code=409, detail={"code": "asset_already_retired", "message": "This equipment is already retired."})
    base_version = asset.get("row_version") or 1
    if request.expected_row_version is not None and request.expected_row_version != base_version:
        raise _version_conflict(asset)

    open_orders = supabase.table("work_orders").select("id").eq("tenant_id", current_user.hotel_id).eq(
        "asset_id", asset_id
    ).in_("status", list(_BROWSE_ACTIVE_WO_STATUSES)).limit(1).execute().data or []
    if open_orders:
        raise HTTPException(status_code=409, detail={"code": "asset_has_open_work_orders", "message": "Close or reassign this equipment's open work orders before retiring it."})
    open_downtime = supabase.table("asset_downtime_periods").select("id").eq("tenant_id", current_user.hotel_id).eq(
        "asset_id", asset_id
    ).is_("restored_at", "null").limit(1).execute().data or []
    if open_downtime:
        raise HTTPException(status_code=409, detail={"code": "asset_has_open_downtime", "message": "Restore this equipment's open downtime before retiring it."})

    result = supabase.table("assets").update({"is_active": False, "row_version": base_version + 1}).eq("id", asset_id).eq(
        "tenant_id", current_user.hotel_id
    ).eq("row_version", base_version).execute()
    if not result.data:
        raise _version_conflict(_own_asset(asset_id, current_user))
    retired = supabase.table("pm_schedules").update({"is_active": False}).eq("asset_id", asset_id).eq(
        "tenant_id", current_user.hotel_id
    ).eq("is_active", True).execute().data or []
    _audit(current_user=current_user, resource_type="asset", resource_id=asset_id, action="asset.retired",
           old_state={"is_active": True}, new_state={"is_active": False, "pm_schedules_deactivated": [row["id"] for row in retired]},
           reason_note=request.reason)
    return {"data": result.data[0]}


# ---------------------------------------------------------------------------
# 15b2. PUT /{asset_id}/criticality - the property's documented assessment of operational impact
# ---------------------------------------------------------------------------

@router.put("/{asset_id}/criticality")
async def set_asset_criticality(
    asset_id: str,
    request: UpdateAssetCriticalityRequest,
    current_user: CurrentUser = Depends(require_role(*ASSET_RETIRE_ROLES)),
):
    """Set criticality (low | medium | high | life_safety). An administrative judgement by the equipment register's owner:
    never inferred from the asset's category or a prediction, and a change is audited with its reason. Guarded by the
    record's row_version so two managers cannot silently overwrite each other."""
    asset = _own_asset(asset_id, current_user) if _is_uuid(asset_id) else None
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    if not asset.get("is_active", True):
        raise HTTPException(status_code=409, detail={"code": "asset_retired", "message": "Retired equipment cannot be reclassified."})
    base_version = asset.get("row_version") or 1
    if request.expected_row_version is not None and request.expected_row_version != base_version:
        raise _version_conflict(asset)
    previous = asset.get("criticality")
    if previous == request.criticality:
        return {"data": asset, "meta": {"changed": False}}
    result = supabase.table("assets").update({"criticality": request.criticality, "row_version": base_version + 1}).eq(
        "id", asset_id
    ).eq("tenant_id", current_user.hotel_id).eq("row_version", base_version).execute()
    if not result.data:
        raise _version_conflict(_own_asset(asset_id, current_user))
    _audit(current_user=current_user, resource_type="asset", resource_id=asset_id, action="asset.criticality_changed",
           old_state={"criticality": previous}, new_state={"criticality": request.criticality}, reason_note=request.reason)
    return {"data": result.data[0], "meta": {"changed": True}}


# ---------------------------------------------------------------------------
# 15c. PUT/DELETE /{asset_id}/photo  — the equipment's identity photograph
# ---------------------------------------------------------------------------

_PHOTO_CONTENT_TYPES = ("image/jpeg", "image/png", "image/webp")


def _is_uuid(value: str) -> bool:
    try:
        UUID(value)
        return True
    except ValueError:
        return False


def _identity_photo_url(asset: dict) -> Optional[str]:
    """A short-lived signed URL for the identity photo, or None. The storage path is never returned."""
    evidence_id = asset.get("photo_evidence_id")
    if not evidence_id:
        return None
    record = supabase.table("evidence_records").select("storage_path").eq("id", evidence_id).eq(
        "tenant_id", asset["tenant_id"]
    ).maybe_single().execute()
    path = ((record.data if record else None) or {}).get("storage_path")
    return (_create_evidence_signed_url(path) or None) if path else None


def _discard_evidence(evidence_id: Optional[str], current_user: CurrentUser) -> None:
    """Best effort removal of a superseded identity photo (file, then record), within the caller's property only."""
    if not evidence_id:
        return
    try:
        record = supabase.table("evidence_records").select("storage_path").eq("id", evidence_id).eq(
            "tenant_id", current_user.hotel_id
        ).maybe_single().execute()
        path = ((record.data if record else None) or {}).get("storage_path")
        if path:
            supabase.storage.from_("evidence-files").remove([path])
        supabase.table("evidence_records").delete().eq("id", evidence_id).eq("tenant_id", current_user.hotel_id).execute()
    except Exception:  # noqa: BLE001 - an unreferenced leftover record is harmless; failing the edit over it is not
        pass


@router.put("/{asset_id}/photo")
async def set_asset_photo(
    asset_id: str,
    request: AttachAssetPhotoRequest,
    current_user: CurrentUser = Depends(require_role(*ASSET_MANAGER_ROLES)),
):
    """Make an already-uploaded evidence photo this equipment's identity photograph. The record must belong to this
    property, be an uploaded image, and have been captured for THIS asset; the previous identity photo (and only it) is
    then removed. Inspection photos are never touched."""
    asset = _own_asset(asset_id, current_user) if _is_uuid(asset_id) else None
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    base_version = asset.get("row_version") or 1
    if request.expected_row_version is not None and request.expected_row_version != base_version:
        raise _version_conflict(asset)
    evidence = supabase.table("evidence_records").select("*").eq("id", str(request.evidence_id)).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single().execute()
    record = evidence.data if evidence else None
    if (
        not record
        or record.get("related_entity_type") != "asset"
        or str(record.get("related_entity_id")) != str(asset_id)
        or record.get("evidence_type") != "photo"
        or not record.get("storage_path")
        or record.get("file_content_type") not in _PHOTO_CONTENT_TYPES
    ):
        raise HTTPException(status_code=422, detail="That upload is not a photo of this equipment")
    previous = asset.get("photo_evidence_id")
    if str(previous or "") == str(request.evidence_id):
        return {"data": {**asset, "photo_url": _identity_photo_url(asset)}}
    result = supabase.table("assets").update({"photo_evidence_id": str(request.evidence_id), "row_version": base_version + 1}).eq(
        "id", asset_id
    ).eq("tenant_id", current_user.hotel_id).eq("row_version", base_version).execute()
    if not result.data:
        raise _version_conflict(_own_asset(asset_id, current_user))
    _audit(current_user=current_user, resource_type="asset", resource_id=asset_id, action="asset.photo_changed",
           old_state={"photo_evidence_id": previous}, new_state={"photo_evidence_id": str(request.evidence_id)})
    _discard_evidence(previous, current_user)
    updated = result.data[0]
    return {"data": {**updated, "photo_url": _identity_photo_url(updated)}}


@router.delete("/{asset_id}/photo")
async def remove_asset_photo(
    asset_id: str,
    current_user: CurrentUser = Depends(require_role(*ASSET_MANAGER_ROLES)),
):
    asset = _own_asset(asset_id, current_user) if _is_uuid(asset_id) else None
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    previous = asset.get("photo_evidence_id")
    if not previous:
        return {"data": {**asset, "photo_url": None}}
    base_version = asset.get("row_version") or 1
    result = supabase.table("assets").update({"photo_evidence_id": None, "row_version": base_version + 1}).eq("id", asset_id).eq(
        "tenant_id", current_user.hotel_id
    ).eq("row_version", base_version).execute()
    if not result.data:
        raise _version_conflict(_own_asset(asset_id, current_user))
    _audit(current_user=current_user, resource_type="asset", resource_id=asset_id, action="asset.photo_removed",
           old_state={"photo_evidence_id": previous}, new_state={"photo_evidence_id": None})
    _discard_evidence(previous, current_user)
    return {"data": {**result.data[0], "photo_url": None}}


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
    # The links a record needs: the exact equipment it was done on, and the corrective work orders this very completion
    # opened (read, never created, here). Both are looked up inside the caller's property by id.
    asset = None
    if completion.get("asset_id"):
        found = supabase.table("assets").select("id, name, asset_tag, is_active").eq("id", completion["asset_id"]).eq(
            "tenant_id", tenant_id
        ).maybe_single().execute()
        asset = found.data if found and found.data else None
    orders = supabase.table("work_orders").select("id, title, status, work_order_number").eq("tenant_id", tenant_id).eq(
        "pm_completion_id", completion_id
    ).order("created_at").execute().data or []
    completion["asset"] = asset
    completion["corrective_work_orders"] = orders
    return {"data": completion}

"""Tenant-scoped PM and housekeeping program configuration and execution."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from core.database import supabase
from middleware.auth import CurrentUser, require_role
from models.requests import (
    CompleteDeepCleanRequest,
    CreateDeepCleanScheduleRequest,
    CreateInspectionSamplingRuleRequest,
    CreatePMDeferralRequest,
    CreateProgramTemplateRequest,
    CreatePublicAreaRequest,
    UpdateDndWelfarePolicyRequest,
    UpdateProgramTemplateRequest,
    UpdateStayoverRuleRequest,
    UpsertSupplyParRequest,
)
from services.programs.contracts import (
    DEFAULT_PROGRAM_TEMPLATES,
    GATED_TEMPLATE_FACILITIES as GATED,
    build_supply_alerts,
    next_recurrence_date,
)


router = APIRouter(prefix="/programs", tags=["programs"])
MANAGER_ROLES = ("gm", "housekeeping_supervisor", "engineer", "chief_engineer")


def _get_pm_schedule(schedule_id: str, current_user: CurrentUser) -> dict:
    result = (
        supabase.table("pm_schedules").select("*").eq("id", schedule_id)
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="PM schedule not found")
    return result.data


def _get_property_applicability(current_user: CurrentUser) -> dict:
    """D-05/G5: mirrors routers/evidence.py's _get_property_applicability read pattern
    (single row per tenant, facilities/services/brand_requirements JSONB arrays) so
    template seeding can gate pool/backflow/domestic_water without a cross-router import."""
    result = (
        supabase.table("property_applicability").select("*")
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    )
    return (result.data if result and result.data else {
        "facilities": [], "services": [], "brand_requirements": [],
    })


def _require_active_tenant_approver(user_id: str, current_user: CurrentUser) -> None:
    """D-07: a deferral approver must be a distinct, active user at this tenant."""
    result = (
        supabase.table("user_roles").select("user_id")
        .eq("tenant_id", current_user.hotel_id).eq("user_id", user_id)
        .eq("is_active", True).maybe_single().execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Deferral approver is not active at this property.")


def _record_audit_event(
    *, current_user: CurrentUser, resource_type: str, resource_id: str,
    action: str, old_state: dict | None = None, new_state: dict | None = None,
    reason_code: str | None = None, reason_note: str | None = None,
) -> None:
    """Append-only operational audit write — mirrors routers/evidence.py's
    _record_audit_event column set (no parallel audit mechanism)."""
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


@router.get("/overview")
async def get_program_overview(current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES))):
    tenant_id = current_user.hotel_id
    templates = supabase.table("pm_checklist_templates").select("*").eq("tenant_id", tenant_id).eq("is_active", True).order("program_area").execute().data or []
    deep_cleans = supabase.table("deep_clean_schedules").select("*, rooms(room_number), public_areas(name)").eq("tenant_id", tenant_id).eq("is_active", True).order("next_due_on").execute().data or []
    pars = supabase.table("housekeeping_supply_pars").select("*").eq("tenant_id", tenant_id).order("supply_type").execute().data or []
    inspection_rules = supabase.table("inspection_sampling_rules").select("*, room_types(name, code)").eq("tenant_id", tenant_id).execute().data or []
    stayover_result = supabase.table("housekeeping_stayover_rules").select("*").eq("tenant_id", tenant_id).maybe_single().execute()
    stayover = stayover_result.data if stayover_result else None
    dnd_policy_result = supabase.table("dnd_welfare_policies").select("*").eq("tenant_id", tenant_id).maybe_single().execute()
    dnd_policy = dnd_policy_result.data if dnd_policy_result else None
    return {"data": {
        "templates": templates,
        "deep_clean_schedules": deep_cleans,
        "supply_pars": pars,
        "supply_alerts": build_supply_alerts(pars),
        "inspection_sampling_rules": inspection_rules,
        "stayover_rule": stayover,
        "dnd_welfare_policy": dnd_policy,
    }}


@router.post("/templates/initialize")
async def initialize_property_templates(current_user: CurrentUser = Depends(require_role("gm"))):
    """D-05/G5: seeds the 7 engineering + 2 housekeeping named templates with their real
    multi-item checklists, but skips a gated template (pool_check/domestic_water/backflow)
    unless the tenant's property_applicability.facilities includes the matching facility.
    Idempotent: codes already present at this tenant are never re-seeded."""
    existing = supabase.table("pm_checklist_templates").select("code").eq("tenant_id", current_user.hotel_id).execute().data or []
    existing_codes = {row["code"] for row in existing}
    facilities = set(_get_property_applicability(current_user).get("facilities") or [])
    records = []
    for template in DEFAULT_PROGRAM_TEMPLATES:
        if template["code"] in existing_codes:
            continue
        required_facility = GATED.get(template["code"])
        if required_facility and required_facility not in facilities:
            continue
        records.append({
            "tenant_id": current_user.hotel_id,
            "code": template["code"],
            "program_area": template["program_area"],
            "name": template["name"],
            "name_es": template.get("name_es"),
            "items": {
                "checklist": template["items"],
                "default_frequency_days": template.get("default_frequency_days"),
            },
            "created_by": current_user.user_id,
        })
    if records:
        supabase.table("pm_checklist_templates").insert(records).execute()
    return {"data": {"created": len(records)}}


def _template_items_json(items: list, default_frequency_days: int | None) -> dict:
    return {
        "checklist": [item.model_dump() for item in items],
        "default_frequency_days": default_frequency_days,
    }


@router.put("/templates/{template_id}")
async def update_program_template(
    template_id: str,
    request: UpdateProgramTemplateRequest,
    current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES)),
):
    """PM-08 template editor: a manager may update a tenant-scoped template's
    name/name_es, checklist items, and suggested default frequency. Updated in
    place — pm_checklist_templates is a mutable config table (not append-only),
    so this does not bump `version` (which instead exists for the
    UNIQUE(tenant_id, code, version) key some future revision-history feature
    could use)."""
    result = (
        supabase.table("pm_checklist_templates").select("*").eq("id", template_id)
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Template not found")

    payload: dict = {"items": _template_items_json(request.items, request.default_frequency_days)}
    if request.name is not None:
        payload["name"] = request.name
    if request.name_es is not None:
        payload["name_es"] = request.name_es

    record = (
        supabase.table("pm_checklist_templates").update(payload)
        .eq("id", template_id).eq("tenant_id", current_user.hotel_id)
        .execute().data[0]
    )
    return {"data": record}


@router.post("/templates")
async def create_program_template(
    request: CreateProgramTemplateRequest,
    current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES)),
):
    """PM-08 generic builder: lets a manager configure an obligation outside the 9
    named templates (e.g. an ice-machine sanitation program). `code` must be unique
    at this tenant."""
    existing = (
        supabase.table("pm_checklist_templates").select("id")
        .eq("tenant_id", current_user.hotel_id).eq("code", request.code)
        .maybe_single().execute()
    )
    if existing and existing.data:
        raise HTTPException(status_code=409, detail="A template with this code already exists")

    record = supabase.table("pm_checklist_templates").insert({
        "tenant_id": current_user.hotel_id,
        "code": request.code,
        "program_area": request.program_area,
        "name": request.name,
        "name_es": request.name_es,
        "items": _template_items_json(request.items, request.default_frequency_days),
        "created_by": current_user.user_id,
    }).execute().data[0]
    return {"data": record}


@router.post("/pm-schedules/{schedule_id}/deferrals")
async def defer_pm_schedule(
    schedule_id: str,
    request: CreatePMDeferralRequest,
    current_user: CurrentUser = Depends(require_role("gm", "chief_engineer")),
):
    _get_pm_schedule(schedule_id, current_user)
    if request.approved_by == current_user.user_id:
        raise HTTPException(
            status_code=422,
            detail="A deferral requires an approver distinct from the requester",
        )
    _require_active_tenant_approver(request.approved_by, current_user)
    record = supabase.table("pm_deferrals").insert({
        "tenant_id": current_user.hotel_id,
        "pm_schedule_id": schedule_id,
        "reason": request.reason,
        "requested_by": current_user.user_id,
        "approved_by": request.approved_by,
        "deferred_until": request.deferred_until.isoformat(),
    }).execute().data[0]
    supabase.table("pm_schedules").update({"next_due_at": request.deferred_until.isoformat()}).eq("id", schedule_id).eq("tenant_id", current_user.hotel_id).execute()
    _record_audit_event(
        current_user=current_user,
        resource_type="pm_deferral",
        resource_id=record["id"],
        action="pm_deferral.approved",
        reason_code="pm_deferral",
        new_state={
            "deferred_until": request.deferred_until.isoformat(),
            "reason": request.reason,
            "approved_by": request.approved_by,
        },
    )
    return {"data": record}


@router.post("/public-areas")
async def create_public_area(request: CreatePublicAreaRequest, current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES))):
    record = supabase.table("public_areas").insert({"tenant_id": current_user.hotel_id, **request.model_dump()}).execute().data[0]
    return {"data": record}


@router.post("/deep-clean-schedules")
async def create_deep_clean_schedule(request: CreateDeepCleanScheduleRequest, current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES))):
    if (request.target_type == "room") != bool(request.room_id) or (request.target_type == "public_area") != bool(request.public_area_id):
        raise HTTPException(status_code=422, detail="Provide exactly the target required for this deep-clean schedule")
    record = supabase.table("deep_clean_schedules").insert({
        "tenant_id": current_user.hotel_id,
        **request.model_dump(),
        "created_by": current_user.user_id,
    }).execute().data[0]
    return {"data": record}


@router.post("/deep-clean-schedules/{schedule_id}/complete")
async def complete_deep_clean(schedule_id: str, request: CompleteDeepCleanRequest, current_user: CurrentUser = Depends(require_role("housekeeper", "housekeeping_supervisor", "gm"))):
    result = supabase.table("deep_clean_schedules").select("*").eq("id", schedule_id).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Deep-clean schedule not found")
    schedule = result.data
    now = datetime.now(timezone.utc)
    occurrence = supabase.table("deep_clean_occurrences").insert({
        "tenant_id": current_user.hotel_id,
        "schedule_id": schedule_id,
        "assigned_to": current_user.user_id,
        "completed_by": current_user.user_id,
        "completed_at": now.isoformat(),
        "checklist_results": request.checklist_results,
        "notes": request.notes,
    }).execute().data[0]
    supabase.table("deep_clean_schedules").update({"next_due_on": next_recurrence_date(now.date(), schedule["interval_days"]).isoformat()}).eq("id", schedule_id).eq("tenant_id", current_user.hotel_id).execute()
    return {"data": occurrence}


@router.post("/supply-pars")
async def upsert_supply_par(request: UpsertSupplyParRequest, current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES))):
    payload = {"tenant_id": current_user.hotel_id, **request.model_dump(), "updated_by": current_user.user_id, "updated_at": datetime.now(timezone.utc).isoformat()}
    record = supabase.table("housekeeping_supply_pars").upsert(payload, on_conflict="tenant_id,supply_type,name").execute().data[0]
    return {"data": record}


@router.put("/stayover-rule")
async def update_stayover_rule(request: UpdateStayoverRuleRequest, current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor"))):
    payload = {"tenant_id": current_user.hotel_id, **request.model_dump(), "updated_by": current_user.user_id, "updated_at": datetime.now(timezone.utc).isoformat()}
    record = supabase.table("housekeeping_stayover_rules").upsert(payload, on_conflict="tenant_id").execute().data[0]
    return {"data": record}


@router.put("/dnd-welfare-policy")
async def update_dnd_welfare_policy(request: UpdateDndWelfarePolicyRequest, current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor"))):
    payload = {"tenant_id": current_user.hotel_id, **request.model_dump(), "updated_by": current_user.user_id, "updated_at": datetime.now(timezone.utc).isoformat()}
    record = supabase.table("dnd_welfare_policies").upsert(payload, on_conflict="tenant_id").execute().data[0]
    return {"data": record}


@router.post("/inspection-sampling-rules")
async def create_inspection_sampling_rule(request: CreateInspectionSamplingRuleRequest, current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor"))):
    record = supabase.table("inspection_sampling_rules").upsert({"tenant_id": current_user.hotel_id, **request.model_dump()}, on_conflict="tenant_id,room_type_id,experience_band,risk_level").execute().data[0]
    return {"data": record}


@router.get("/inspection-quality")
async def get_inspection_quality(current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES))):
    inspections = supabase.table("inspections").select("overall_result, inspected_by, room_id, completed_at, rooms(room_type_id)").eq("tenant_id", current_user.hotel_id).order("completed_at", desc=True).limit(500).execute().data or []
    trends: dict[str, dict] = {}
    for inspection in inspections:
        key = inspection.get("overall_result", "unknown")
        trend = trends.setdefault(key, {"result": key, "count": 0})
        trend["count"] += 1
    return {"data": {"by_result": list(trends.values()), "sample_size": len(inspections)}}

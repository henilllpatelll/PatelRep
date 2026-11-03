"""Tenant-scoped PM and housekeeping program configuration and execution."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from core.database import supabase
from core.roles import PM_DEFERRAL_REQUEST_ROLES, PM_DEFERRAL_REVIEWER_ROLES, PROGRAM_MANAGER_ROLES
from middleware.auth import CurrentUser, require_role
from models.requests import (
    CompleteDeepCleanRequest,
    CreateDeepCleanScheduleRequest,
    CreateInspectionSamplingRuleRequest,
    CreatePMDeferralRequest,
    CreateProgramTemplateRequest,
    CreatePublicAreaRequest,
    DecidePMDeferralRequest,
    UpdateDndWelfarePolicyRequest,
    UpdateProgramTemplateRequest,
    UpdateStayoverRuleRequest,
    UpsertSupplyParRequest,
)
from services.programs.contracts import (
    DEFAULT_PROGRAM_TEMPLATES,
    GATED_TEMPLATE_FACILITIES as GATED,
    aggregate_inspection_quality,
    build_supply_alerts,
    experience_band as _experience_band,
    next_recurrence_date,
    select_inspection_sample,
)

router = APIRouter(prefix="/programs", tags=["programs"])


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
async def get_program_overview(current_user: CurrentUser = Depends(require_role(*PROGRAM_MANAGER_ROLES))):
    tenant_id = current_user.hotel_id
    templates = supabase.table("pm_checklist_templates").select("*").eq("tenant_id", tenant_id).eq("is_active", True).order("program_area").execute().data or []
    deep_cleans = supabase.table("deep_clean_schedules").select("*, rooms(room_number), public_areas(name)").eq("tenant_id", tenant_id).eq("is_active", True).order("next_due_on").execute().data or []
    public_areas = supabase.table("public_areas").select("*").eq("tenant_id", tenant_id).eq("is_active", True).order("name").execute().data or []
    pars = supabase.table("housekeeping_supply_pars").select("*").eq("tenant_id", tenant_id).order("supply_type").execute().data or []
    inspection_rules = supabase.table("inspection_sampling_rules").select("*, room_types(name, code)").eq("tenant_id", tenant_id).execute().data or []
    stayover_result = supabase.table("housekeeping_stayover_rules").select("*").eq("tenant_id", tenant_id).maybe_single().execute()
    stayover = stayover_result.data if stayover_result else None
    dnd_policy_result = supabase.table("dnd_welfare_policies").select("*").eq("tenant_id", tenant_id).maybe_single().execute()
    dnd_policy = dnd_policy_result.data if dnd_policy_result else None
    return {"data": {
        "templates": templates,
        "deep_clean_schedules": deep_cleans,
        "public_areas": public_areas,
        "supply_pars": pars,
        "supply_alerts": build_supply_alerts(pars),
        "inspection_sampling_rules": inspection_rules,
        "stayover_rule": stayover,
        "dnd_welfare_policy": dnd_policy,
    }}


@router.get("/pm-templates")
async def list_pm_templates(current_user: CurrentUser = Depends(require_role("engineer", "chief_engineer", "gm"))):
    """Active engineering checklist templates only - the light read the mobile inspection needs (the full
    /overview also carries housekeeping rules, pars and sampling)."""
    templates = supabase.table("pm_checklist_templates").select("*").eq(
        "tenant_id", current_user.hotel_id
    ).eq("is_active", True).eq("program_area", "engineering").order("name").execute().data or []
    return {"data": templates}


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
    current_user: CurrentUser = Depends(require_role(*PROGRAM_MANAGER_ROLES)),
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
    if payload["items"].get("checklist") != (result.data.get("items") or {}).get("checklist"):
        # A changed checklist is a new revision: completions record the version they were done against, so the
        # number must move when the questions do. Past completions keep their own item rows and are untouched.
        latest = (
            supabase.table("pm_checklist_templates").select("version")
            .eq("tenant_id", current_user.hotel_id).eq("code", result.data["code"])
            .order("version", desc=True).limit(1).execute().data or []
        )
        payload["version"] = max([result.data.get("version") or 1, *(row["version"] for row in latest)]) + 1
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
    current_user: CurrentUser = Depends(require_role(*PROGRAM_MANAGER_ROLES)),
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


def _deferral_status(deferral: dict, decision: dict | None) -> str:
    """pending | approved | rejected. A row written before decisions existed carries approved_by and was applied
    when it was created, so it reads as approved."""
    if decision:
        return decision["decision"]
    return "approved" if deferral.get("approved_by") else "pending"


def _with_status(deferrals: list[dict], decisions: list[dict]) -> list[dict]:
    by_deferral = {row["deferral_id"]: row for row in decisions}
    out = []
    for deferral in deferrals:
        decision = by_deferral.get(deferral["id"])
        out.append({
            **deferral,
            "status": _deferral_status(deferral, decision),
            "decision": decision,
        })
    return out


def _decisions_for(deferral_ids: list[str], current_user: CurrentUser) -> list[dict]:
    if not deferral_ids:
        return []
    return supabase.table("pm_deferral_decisions").select("*").eq(
        "tenant_id", current_user.hotel_id
    ).in_("deferral_id", deferral_ids).execute().data or []


@router.post("/pm-schedules/{schedule_id}/deferrals")
async def defer_pm_schedule(
    schedule_id: str,
    request: CreatePMDeferralRequest,
    current_user: CurrentUser = Depends(require_role(*PM_DEFERRAL_REQUEST_ROLES)),
):
    """Request a deferral. The schedule's due date does NOT move: an independent reviewer decides the request with
    their own login (POST /pm-deferrals/{id}/approve | /reject). `approved_by` in the body is ignored."""
    schedule = _get_pm_schedule(schedule_id, current_user)
    if not schedule.get("is_active"):
        raise HTTPException(status_code=409, detail="This PM schedule is not active.")
    deferred_until = request.deferred_until if request.deferred_until.tzinfo else request.deferred_until.replace(tzinfo=timezone.utc)
    if deferred_until <= datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail="The requested date must be in the future")
    current_due = datetime.fromisoformat(str(schedule["next_due_at"]).replace("Z", "+00:00"))
    if current_due.tzinfo is None:
        current_due = current_due.replace(tzinfo=timezone.utc)
    if deferred_until <= current_due:
        raise HTTPException(status_code=422, detail="A deferral must move the due date later than it is now")

    open_requests = supabase.table("pm_deferrals").select("id, approved_by").eq(
        "tenant_id", current_user.hotel_id
    ).eq("pm_schedule_id", schedule_id).is_("approved_by", "null").execute().data or []
    decided = {row["deferral_id"] for row in _decisions_for([row["id"] for row in open_requests], current_user)}
    if any(row["id"] not in decided for row in open_requests):
        raise HTTPException(status_code=409, detail="This schedule already has a deferral request awaiting review")

    record = supabase.table("pm_deferrals").insert({
        "tenant_id": current_user.hotel_id,
        "pm_schedule_id": schedule_id,
        "reason": request.reason,
        "requested_by": current_user.user_id,
        "deferred_until": deferred_until.isoformat(),
    }).execute().data[0]
    _record_audit_event(
        current_user=current_user,
        resource_type="pm_deferral",
        resource_id=record["id"],
        action="pm_deferral.requested",
        reason_code="pm_deferral",
        reason_note=request.reason,
        old_state={"next_due_at": schedule["next_due_at"]},
        new_state={"deferred_until": deferred_until.isoformat(), "pm_schedule_id": schedule_id},
    )
    return {"data": {**record, "status": "pending", "decision": None}}


@router.get("/pm-deferrals")
async def list_pm_deferrals(
    status: str = Query("pending", pattern="^(pending|approved|rejected|all)$"),
    schedule_id: str | None = Query(None, max_length=64),
    limit: int = Query(50, ge=1, le=100),
    current_user: CurrentUser = Depends(require_role(*PM_DEFERRAL_REQUEST_ROLES)),
):
    """Deferral requests for this property, newest first, with their decision (if any)."""
    query = supabase.table("pm_deferrals").select("*").eq("tenant_id", current_user.hotel_id)
    if schedule_id:
        query = query.eq("pm_schedule_id", schedule_id)
    rows = query.order("created_at", desc=True).limit(500).execute().data or []
    rows = _with_status(rows, _decisions_for([row["id"] for row in rows], current_user))
    if status != "all":
        rows = [row for row in rows if row["status"] == status]
    return {"data": rows[:limit], "meta": {"limit": limit}}


def _decide(deferral_id: str, decision: str, note: str | None, current_user: CurrentUser) -> dict:
    """One guarded operation: the database function locks the schedule, refuses self-review, applies an approval and
    writes the decision + audit rows in a single transaction. The reviewer is ALWAYS the authenticated caller."""
    try:
        outcome = supabase.rpc("decide_pm_deferral", {
            "p_tenant_id": current_user.hotel_id,
            "p_deferral_id": deferral_id,
            "p_reviewer_id": current_user.user_id,
            "p_reviewer_role": current_user.role,
            "p_decision": decision,
            "p_note": note,
        }).execute().data
    except Exception as exc:  # noqa: BLE001 - classify, never swallow
        if "PGRST202" in str(exc) or "Could not find the function" in str(exc):
            raise HTTPException(status_code=503, detail={"code": "deferral_unavailable", "message": "Deferral decisions are temporarily unavailable. Nothing was changed."}) from exc
        raise
    if isinstance(outcome, list):
        outcome = outcome[0] if outcome else None
    status = (outcome or {}).get("status")
    if status == "ok":
        return {"data": outcome["decision"], "meta": {"replayed": False}}
    if status == "already_decided":
        prior = outcome.get("decision")
        if prior and prior.get("decision") == decision and prior.get("decided_by") == current_user.user_id:
            return {"data": prior, "meta": {"replayed": True}}
        raise HTTPException(status_code=409, detail={"code": "already_decided", "message": "This request has already been decided."})
    refusals = {
        "not_found": (404, "not_found", "Deferral request not found"),
        "self_review": (403, "self_review", "You cannot decide a deferral you requested. Ask another reviewer."),
        "schedule_inactive": (409, "schedule_inactive", "This PM schedule is no longer active."),
        "stale": (409, "stale", "The schedule's due date has already moved to or past the requested date."),
        "expired": (409, "expired", "The requested date has already passed. Ask for a new deferral."),
        "invalid_decision": (422, "invalid_decision", "Decision must be approved or rejected"),
    }
    if status in refusals:
        code_, key, message = refusals[status]
        raise HTTPException(status_code=code_, detail={"code": key, "message": message})
    raise HTTPException(status_code=502, detail={"code": "decision_unverified", "message": "The decision could not be verified. Check the request before retrying."})


@router.post("/pm-deferrals/{deferral_id}/approve")
async def approve_pm_deferral(
    deferral_id: str,
    request: DecidePMDeferralRequest,
    current_user: CurrentUser = Depends(require_role(*PM_DEFERRAL_REVIEWER_ROLES)),
):
    return _decide(deferral_id, "approved", request.note, current_user)


@router.post("/pm-deferrals/{deferral_id}/reject")
async def reject_pm_deferral(
    deferral_id: str,
    request: DecidePMDeferralRequest,
    current_user: CurrentUser = Depends(require_role(*PM_DEFERRAL_REVIEWER_ROLES)),
):
    return _decide(deferral_id, "rejected", request.note, current_user)


@router.post("/public-areas")
async def create_public_area(request: CreatePublicAreaRequest, current_user: CurrentUser = Depends(require_role(*PROGRAM_MANAGER_ROLES))):
    record = supabase.table("public_areas").insert({"tenant_id": current_user.hotel_id, **request.model_dump()}).execute().data[0]
    return {"data": record}


@router.post("/deep-clean-schedules")
async def create_deep_clean_schedule(request: CreateDeepCleanScheduleRequest, current_user: CurrentUser = Depends(require_role(*PROGRAM_MANAGER_ROLES))):
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
async def upsert_supply_par(request: UpsertSupplyParRequest, current_user: CurrentUser = Depends(require_role(*PROGRAM_MANAGER_ROLES))):
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


@router.get("/inspection-sample")
async def get_inspection_sample(
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor", "chief_engineer")),
):
    """G11/HK-02: today's rule-driven inspection sample -- which of today's
    assigned rooms a supervisor should physically inspect, honoring
    inspection_sampling_rules (room_type + assigned housekeeper's derived
    experience_band + room risk_level) instead of a flat aggregate."""
    tenant_id = current_user.hotel_id
    today = datetime.now(timezone.utc).date()

    assignments = (
        supabase.table("room_assignments").select("room_id, assigned_to, rooms(room_type_id)")
        .eq("tenant_id", tenant_id).eq("assignment_date", today.isoformat()).execute().data or []
    )
    if not assignments:
        return {"data": {"rooms": [], "sample_size": 0}}

    room_ids = [assignment["room_id"] for assignment in assignments]
    assigned_user_ids = list({assignment["assigned_to"] for assignment in assignments if assignment.get("assigned_to")})

    statuses = (
        supabase.table("room_status").select("room_id, risk_level")
        .eq("tenant_id", tenant_id).in_("room_id", room_ids).execute().data or []
    )
    risk_by_room = {status["room_id"]: (status.get("risk_level") or "").upper() for status in statuses}

    profiles = (
        supabase.table("user_profiles").select("id, hire_date")
        .eq("tenant_id", tenant_id).in_("id", assigned_user_ids).execute().data or []
    ) if assigned_user_ids else []
    hire_date_by_user = {profile["id"]: profile.get("hire_date") for profile in profiles}

    rules = (
        supabase.table("inspection_sampling_rules").select("*").eq("tenant_id", tenant_id).execute().data or []
    )

    rooms_for_sampling = [
        {
            "room_id": assignment["room_id"],
            "room_type_id": (assignment.get("rooms") or {}).get("room_type_id"),
            "experience_band": _experience_band(hire_date_by_user.get(assignment.get("assigned_to")), today),
            "risk_level": "high" if risk_by_room.get(assignment["room_id"]) == "HIGH" else "standard",
        }
        for assignment in assignments
    ]

    selected_ids = set(select_inspection_sample(rooms=rooms_for_sampling, rules=rules))
    selected_rooms = [room for room in rooms_for_sampling if room["room_id"] in selected_ids]
    return {"data": {"rooms": selected_rooms, "sample_size": len(selected_rooms)}}


def _resolve_quality_trend_names(
    quality: dict[str, Any], *, tenant_id: str,
) -> dict[str, Any]:
    """CR-02: aggregate_inspection_quality is intentionally pure (no DB) so its
    grouping logic stays unit-testable, but that means by_room_type/by_employee
    key on raw room_type_id/inspected_by UUIDs. Resolve those to display names
    here, after aggregation, the same way housekeeping.py resolves inspector
    names for the near-identical inspection list."""
    room_type_ids = [row["key"] for row in quality["by_room_type"] if row["key"] != "unknown"]
    if room_type_ids:
        room_types = (
            supabase.table("room_types").select("id, name")
            .in_("id", room_type_ids).eq("tenant_id", tenant_id).execute().data or []
        )
        room_type_names = {row["id"]: row["name"] for row in room_types}
        for row in quality["by_room_type"]:
            row["key"] = room_type_names.get(row["key"], row["key"])

    employee_ids = [row["key"] for row in quality["by_employee"] if row["key"] != "unknown"]
    if employee_ids:
        profiles = (
            supabase.table("user_profiles").select("id, preferred_name, full_name")
            .in_("id", employee_ids).eq("tenant_id", tenant_id).execute().data or []
        )
        employee_names = {
            row["id"]: row.get("preferred_name") or row.get("full_name") or row["id"] for row in profiles
        }
        for row in quality["by_employee"]:
            row["key"] = employee_names.get(row["key"], row["key"])

    return quality


@router.get("/inspection-quality")
async def get_inspection_quality(current_user: CurrentUser = Depends(require_role(*PROGRAM_MANAGER_ROLES))):
    """HK-03: quality trends broken down by overall result, checklist item, room
    type, and employee -- not only overall_result."""
    inspections = (
        supabase.table("inspections")
        .select("overall_result, inspected_by, room_id, completed_at, rooms(room_type_id), inspection_results(result, inspection_template_items(description))")
        .eq("tenant_id", current_user.hotel_id).order("completed_at", desc=True).limit(500).execute().data or []
    )
    quality = aggregate_inspection_quality(inspections)
    quality = _resolve_quality_trend_names(quality, tenant_id=current_user.hotel_id)
    return {"data": quality}


@router.get("/deep-clean-schedules")
async def list_deep_clean_schedules(current_user: CurrentUser = Depends(require_role(*PROGRAM_MANAGER_ROLES))):
    """HK-01/G12: the depth UI (04-07) reads active deep-clean schedules (room and
    public-area targets) with their next-due date, tenant-scoped."""
    schedules = (
        supabase.table("deep_clean_schedules").select("*, rooms(room_number), public_areas(name)")
        .eq("tenant_id", current_user.hotel_id).eq("is_active", True)
        .order("next_due_on").execute().data or []
    )
    return {"data": schedules}


@router.get("/public-areas")
async def list_public_areas(current_user: CurrentUser = Depends(require_role(*PROGRAM_MANAGER_ROLES))):
    """HK-01/G12: the depth UI (04-07) reads active public areas, tenant-scoped."""
    areas = (
        supabase.table("public_areas").select("*")
        .eq("tenant_id", current_user.hotel_id).eq("is_active", True)
        .order("name").execute().data or []
    )
    return {"data": areas}

"""Database-backed program execution helpers shared by PM routes."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from services.programs.checklist_binding import resolve_completion_template
from services.programs.contracts import (
    build_corrective_work_order,
    validate_completion_items,
)
from services.condition_monitoring import persist_condition_reading


class PmCompletionRefused(Exception):
    """The completion was understood but must not be recorded. Nothing was written."""

    def __init__(self, code: str, message: str, status_code: int = 409):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def compute_submission_hash(schedule_id: str, payload: dict[str, Any]) -> str:
    """Stable fingerprint of WHAT was submitted (never of the key itself), so a retry of the same attempt matches and
    the same key reused for different content is detected."""
    body = {k: v for k, v in payload.items() if k != "submission_id"}
    canonical = json.dumps({"schedule_id": str(schedule_id), "payload": body}, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _collect_evidence_ids(payload: dict[str, Any], items: list[dict[str, Any]]) -> list[str]:
    """De-duplicated evidence_record IDs referenced anywhere in a PM completion payload."""
    ordered_ids: list[str] = [
        *(payload.get("photos") or []),
        *(payload.get("certificate_attachments") or []),
    ]
    for item in items:
        ordered_ids.extend(item.get("evidence") or [])
    seen: set[str] = set()
    unique_ids: list[str] = []
    for evidence_id in ordered_ids:
        if evidence_id not in seen:
            seen.add(evidence_id)
            unique_ids.append(evidence_id)
    return unique_ids


def _validate_verifier(*, db: Any, tenant_id: str, user_id: str, verifier_id: str | None) -> None:
    """Mirrors the PM-deferral separation-of-duty check (D-07,
    routers/programs.py `_require_active_tenant_approver`): a verifier must be
    distinct from the technician submitting the completion, and an active user
    at this tenant. Without this, a completion's "independent verification"
    is only enforced client-side and can be bypassed by calling the API directly."""
    if not verifier_id:
        return
    if verifier_id == user_id:
        raise ValueError("Verifier must be distinct from the technician submitting this completion.")
    result = (
        db.table("user_roles").select("user_id")
        .eq("tenant_id", tenant_id).eq("user_id", verifier_id)
        .eq("is_active", True).maybe_single().execute()
    )
    if not result or not result.data:
        raise ValueError("Verifier is not an active user at this property.")


def _validate_tenant_evidence_ids(*, db: Any, tenant_id: str, evidence_ids: list[str]) -> None:
    """Reject a PM completion that references evidence_records missing or owned by another tenant."""
    if not evidence_ids:
        return
    result = (
        db.table("evidence_records").select("id").eq("tenant_id", tenant_id)
        .in_("id", evidence_ids).execute()
    )
    found_ids = {row["id"] for row in ((result.data if result else None) or [])}
    missing = [evidence_id for evidence_id in evidence_ids if evidence_id not in found_ids]
    if missing:
        raise ValueError(
            f"Evidence record(s) not found at this property: {', '.join(missing)}"
        )



def _fetch_asset_criticality(*, db: Any, tenant_id: str, asset_id: str | None) -> str | None:
    """G8: corrective work orders need the failing asset's criticality to set priority."""
    if not asset_id:
        return None
    result = (
        db.table("assets").select("criticality").eq("id", asset_id)
        .eq("tenant_id", tenant_id).maybe_single().execute()
    )
    data = result.data if result else None
    return data.get("criticality") if data else None



def _rpc_result(db: Any, params: dict[str, Any]) -> dict[str, Any]:
    try:
        data = db.rpc("record_pm_completion", params).execute().data
    except Exception as exc:  # noqa: BLE001 - classify, never swallow
        text = str(exc)
        if "PGRST202" in text or "Could not find the function" in text:
            # Fail closed: the non-atomic path is exactly what this function replaces.
            raise PmCompletionRefused(
                "completion_unavailable",
                "PM completion is temporarily unavailable. Nothing was recorded; try again shortly.",
                503,
            ) from exc
        raise
    if isinstance(data, list):
        data = data[0] if data else None
    if not isinstance(data, dict) or "status" not in data:
        raise PmCompletionRefused(
            "completion_unverified", "The PM completion could not be verified. Check the schedule before retrying.", 502
        )
    return data


def _heal_condition_readings(
    *, db: Any, tenant_id: str, user_id: str, completion_id: str, readings: list[dict[str, Any]],
    meters_by_id: dict[str, dict[str, Any]], replayed: bool,
) -> None:
    """Readings are appended after the atomic write. On a replay, any that a crashed first attempt never wrote are
    written now, keyed by (completion, meter), so a retry finishes the job rather than duplicating it."""
    existing: set[str] = set()
    if replayed and readings:
        rows = db.table("meter_readings").select("meter_id").eq("tenant_id", tenant_id).eq(
            "pm_completion_id", completion_id
        ).execute().data or []
        existing = {str(row["meter_id"]) for row in rows}
    for reading in readings:
        meter_id = str(reading["meter_id"])
        if meter_id in existing:
            continue
        persist_condition_reading(
            db=db,
            meter=meters_by_id[meter_id],
            tenant_id=tenant_id,
            user_id=user_id,
            value=float(reading["value"]),
            source="pm",
            recorded_at=reading.get("recorded_at"),
            pm_completion_id=completion_id,
            notes=reading.get("notes"),
        )


def persist_pm_completion(
    *, db: Any, tenant_id: str, user_id: str, actor_role: str,
    schedule: dict[str, Any], payload: dict[str, Any],
) -> dict[str, Any]:
    """Record one PM completion atomically and idempotently.

    Everything that must happen together - the completion, its immutable items, the corrective work orders, the
    evidence links, the audit rows and the schedule advance - is ONE database transaction (`record_pm_completion`,
    migration 232). The caller's `submission_id` makes it replay-safe: the same accepted submission returns the
    original record, a different payload under the same id is refused, and concurrent identical submissions are
    serialised by the schedule row lock.

    All submitted `photos`/`certificate_attachments`/per-item `evidence` values are `evidence_records.id` UUIDs (D-06),
    validated for tenant ownership before anything is written.
    """
    items = payload.get("items") or []
    condition_readings = payload.get("condition_readings") or []
    submission_hash = compute_submission_hash(schedule["id"], payload)
    meter_ids = [str(reading["meter_id"]) for reading in condition_readings]
    meters_by_id: dict[str, dict[str, Any]] = {}
    if meter_ids:
        meters = db.table("asset_meters").select("*").eq("tenant_id", tenant_id).in_("id", meter_ids).execute().data or []
        meters_by_id = {str(meter["id"]): meter for meter in meters}
        if len(meters_by_id) != len(set(meter_ids)):
            raise ValueError("One or more condition meters were not found")
        if any(meter.get("asset_id") != schedule.get("asset_id") for meter in meters_by_id.values()):
            raise ValueError("Condition meter must belong to this PM asset")
    validate_completion_items(items)
    _validate_verifier(
        db=db, tenant_id=tenant_id, user_id=user_id, verifier_id=payload.get("verifier_id"),
    )
    evidence_ids = _collect_evidence_ids(payload, items)
    _validate_tenant_evidence_ids(db=db, tenant_id=tenant_id, evidence_ids=evidence_ids)
    if payload.get("vendor_id"):
        vendor = db.table("engineering_vendors").select("id, name").eq("id", str(payload["vendor_id"])).eq("tenant_id", tenant_id).maybe_single().execute()
        if not vendor or not vendor.data:
            raise ValueError("Vendor not found")
        # Retain the readable snapshot even if the vendor name changes later.
        payload["vendor_name"] = payload.get("vendor_name") or vendor.data["name"]

    template = resolve_completion_template(db, tenant_id, schedule, payload.get("checklist_template_id"))
    checklist_template_id = template["id"] if template else None
    checklist_version = payload.get("checklist_version")
    if template and checklist_version is None:
        checklist_version = template.get("version")

    completion_id = str(uuid.uuid4())
    completed_at = datetime.now(timezone.utc)
    corrective: list[dict[str, Any]] = []
    failed_items = [item for item in items if item["result"] == "failed"]
    if failed_items:
        criticality = _fetch_asset_criticality(db=db, tenant_id=tenant_id, asset_id=schedule.get("asset_id"))
        for item in failed_items:
            work_order = build_corrective_work_order(
                tenant_id=tenant_id,
                asset_id=schedule.get("asset_id"),
                completion_id=completion_id,
                checklist_item=item,
                created_by=user_id,
                completed_at=completed_at,
                criticality=criticality,
            )
            corrective.append({"label": item["label"], **{k: work_order[k] for k in (
                "asset_id", "title", "description", "category", "priority", "created_by", "sla_minutes", "due_at",
            )}})

    params = {
        "p_tenant_id": tenant_id,
        "p_schedule_id": str(schedule["id"]),
        "p_user_id": user_id,
        "p_actor_role": actor_role,
        "p_completion_id": completion_id,
        "p_submission_id": str(payload["submission_id"]) if payload.get("submission_id") else None,
        "p_submission_hash": submission_hash,
        "p_completion": {
            "checklist_template_id": checklist_template_id,
            "checklist_version": checklist_version,
            "verifier_id": payload.get("verifier_id"),
            "measurements": payload.get("measurements") or {},
            "meter_readings": payload.get("meter_readings") or {},
            "photos": payload.get("photos") or [],
            "labor_minutes": payload.get("labor_minutes", 0),
            "parts_used": payload.get("parts_used") or [],
            "defects": payload.get("defects") or [],
            "vendor_id": str(payload["vendor_id"]) if payload.get("vendor_id") else None,
            "vendor_name": payload.get("vendor_name"),
            "certificate_attachments": payload.get("certificate_attachments") or [],
            "notes": payload.get("notes"),
        },
        "p_items": [{
            "item_key": item.get("key") or item["label"].lower().replace(" ", "_"),
            "label": item["label"],
            "result": item["result"],
            "requires_evidence": item.get("requires_evidence", False),
            "evidence": item.get("evidence") or [],
            "note": item.get("note"),
        } for item in items],
        "p_corrective": corrective,
        "p_evidence_ids": evidence_ids,
        "p_completed_at": completed_at.isoformat(),
    }
    outcome = _rpc_result(db, params)
    status = outcome["status"]
    if status == "schedule_not_found":
        raise LookupError("PM schedule not found")
    if status == "conflict":
        raise PmCompletionRefused(
            "submission_conflict",
            "This submission id was already used for a different inspection. Nothing was changed.",
        )
    if status == "schedule_inactive":
        raise PmCompletionRefused("schedule_inactive", "This PM schedule is no longer active.")
    if status == "asset_inactive":
        raise PmCompletionRefused("asset_inactive", "This equipment is no longer active, so its PM cannot be completed.")
    if status not in ("created", "replayed"):
        raise PmCompletionRefused("completion_unverified", "The PM completion could not be verified.", 502)

    completion = outcome["completion"]
    replayed = status == "replayed"
    if condition_readings:
        _heal_condition_readings(
            db=db, tenant_id=tenant_id, user_id=user_id, completion_id=completion["id"],
            readings=condition_readings, meters_by_id=meters_by_id, replayed=replayed,
        )
    completion["corrective_work_orders"] = outcome.get("corrective_work_orders") or []
    completion["replayed"] = replayed
    return completion

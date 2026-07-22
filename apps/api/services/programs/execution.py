"""Database-backed program execution helpers shared by PM routes."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from services.programs.contracts import (
    build_corrective_work_order,
    next_recurrence_date,
    validate_completion_items,
)


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


def _link_evidence_to_completion(*, db: Any, tenant_id: str, completion_id: str, evidence_ids: list[str]) -> None:
    """Backfill evidence_records.related_entity_* after the completion exists (evidence_records
    is mutable; pm_completion_records is not, so the link must be an UPDATE on the evidence side)."""
    if not evidence_ids:
        return
    db.table("evidence_records").update({
        "related_entity_type": "pm_completion",
        "related_entity_id": completion_id,
    }).eq("tenant_id", tenant_id).in_("id", evidence_ids).execute()


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


def _record_containment_audit(
    *, db: Any, tenant_id: str, user_id: str, actor_role: str, completion_id: str,
    item_label: str, work_order_id: str | None,
) -> None:
    """Append-only containment record for a failed PM check (G2/T-04-11). execution.py has
    no CurrentUser, so this inserts directly into operational_audit_events with the same
    column set as routers/evidence.py's _record_audit_event, rather than a parallel mechanism."""
    db.table("operational_audit_events").insert({
        "tenant_id": tenant_id,
        "resource_type": "pm_completion",
        "resource_id": completion_id,
        "action": "pm_check.failed_containment",
        "actor_id": user_id,
        "actor_role": actor_role,
        "old_state": {},
        "new_state": {"item": item_label, "work_order_id": work_order_id},
        "reason_code": "failed_check",
        "reason_note": None,
        "source": "api",
    }).execute()


def persist_pm_completion(
    *, db: Any, tenant_id: str, user_id: str, actor_role: str,
    schedule: dict[str, Any], payload: dict[str, Any],
) -> dict[str, Any]:
    """Append a complete PM record, its immutable results, and failed-check follow-ups.

    All submitted `photos`/`certificate_attachments`/per-item `evidence` values are
    `evidence_records.id` UUID strings (D-06) — validated for tenant ownership before the
    completion is written, then linked to the completion via a post-insert UPDATE.
    """
    items = payload.get("items") or []
    validate_completion_items(items)
    evidence_ids = _collect_evidence_ids(payload, items)
    _validate_tenant_evidence_ids(db=db, tenant_id=tenant_id, evidence_ids=evidence_ids)
    completed_at = datetime.now(timezone.utc)
    completion_payload = {
        "tenant_id": tenant_id,
        "pm_schedule_id": schedule["id"],
        "asset_id": schedule.get("asset_id"),
        "checklist_template_id": payload.get("checklist_template_id"),
        "checklist_version": payload.get("checklist_version"),
        "technician_id": user_id,
        "verifier_id": payload.get("verifier_id"),
        "measurements": payload.get("measurements") or {},
        "meter_readings": payload.get("meter_readings") or {},
        "photos": payload.get("photos") or [],
        "labor_minutes": payload.get("labor_minutes", 0),
        "parts_used": payload.get("parts_used") or [],
        "defects": payload.get("defects") or [],
        "vendor_name": payload.get("vendor_name"),
        "certificate_attachments": payload.get("certificate_attachments") or [],
        "notes": payload.get("notes"),
        "completed_at": completed_at.isoformat(),
    }
    completion = db.table("pm_completion_records").insert(completion_payload).execute().data[0]
    _link_evidence_to_completion(
        db=db, tenant_id=tenant_id, completion_id=completion["id"], evidence_ids=evidence_ids,
    )

    item_rows = [{
        "tenant_id": tenant_id,
        "completion_id": completion["id"],
        "item_key": item.get("key") or item["label"].lower().replace(" ", "_"),
        "label": item["label"],
        "result": item["result"],
        "requires_evidence": item.get("requires_evidence", False),
        "evidence": item.get("evidence") or [],
        "note": item.get("note"),
    } for item in items]
    if item_rows:
        db.table("pm_completion_items").insert(item_rows).execute()

    failed_items = [item for item in items if item["result"] == "failed"]
    if failed_items:
        criticality = _fetch_asset_criticality(
            db=db, tenant_id=tenant_id, asset_id=schedule.get("asset_id"),
        )
        for item in failed_items:
            work_order = build_corrective_work_order(
                tenant_id=tenant_id,
                asset_id=schedule.get("asset_id"),
                completion_id=completion["id"],
                checklist_item=item,
                created_by=user_id,
                completed_at=completed_at,
                criticality=criticality,
            )
            wo_result = db.table("work_orders").insert(work_order).execute()
            wo_rows = wo_result.data if wo_result else None
            work_order_id = wo_rows[0]["id"] if wo_rows else None
            _record_containment_audit(
                db=db,
                tenant_id=tenant_id,
                user_id=user_id,
                actor_role=actor_role,
                completion_id=completion["id"],
                item_label=item["label"],
                work_order_id=work_order_id,
            )

    interval_days = schedule.get("interval_days") or {
        "daily": 1, "weekly": 7, "monthly": 30, "quarterly": 90, "annual": 365,
    }.get(schedule.get("interval_type"), 30)
    db.table("pm_schedules").update({
        "last_completed_at": completed_at.isoformat(),
        "next_due_at": next_recurrence_date(completed_at.date(), interval_days).isoformat(),
    }).eq("id", schedule["id"]).eq("tenant_id", tenant_id).execute()
    return completion

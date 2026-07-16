"""Database-backed program execution helpers shared by PM routes."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from services.programs.contracts import (
    build_corrective_work_order,
    next_recurrence_date,
    validate_completion_items,
)


def persist_pm_completion(
    *, db: Any, tenant_id: str, user_id: str, schedule: dict[str, Any], payload: dict[str, Any]
) -> dict[str, Any]:
    """Append a complete PM record, its immutable results, and failed-check follow-ups."""
    items = payload.get("items") or []
    validate_completion_items(items)
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

    for item in items:
        if item["result"] == "failed":
            work_order = build_corrective_work_order(
                tenant_id=tenant_id,
                asset_id=schedule.get("asset_id"),
                completion_id=completion["id"],
                checklist_item=item,
                created_by=user_id,
            )
            db.table("work_orders").insert(work_order).execute()

    interval_days = schedule.get("interval_days") or {
        "daily": 1, "weekly": 7, "monthly": 30, "quarterly": 90, "annual": 365,
    }.get(schedule.get("interval_type"), 30)
    db.table("pm_schedules").update({
        "last_completed_at": completed_at.isoformat(),
        "next_due_at": next_recurrence_date(completed_at.date(), interval_days).isoformat(),
    }).eq("id", schedule["id"]).eq("tenant_id", tenant_id).execute()
    return completion

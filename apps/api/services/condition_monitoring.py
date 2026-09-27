"""Shared, server-authoritative threshold and condition-reading policy."""

from datetime import datetime, timedelta, timezone
from typing import Any


def evaluate_meter_reading(meter: dict[str, Any], value: float) -> str:
    """Return the status at a reading's instant; critical boundaries are inclusive."""
    critical_low = meter.get("critical_low")
    critical_high = meter.get("critical_high")
    warning_low = meter.get("warning_low")
    warning_high = meter.get("warning_high")
    if critical_low is not None and value <= float(critical_low):
        return "critical"
    if critical_high is not None and value >= float(critical_high):
        return "critical"
    if warning_low is not None and value <= float(warning_low):
        return "warning"
    if warning_high is not None and value >= float(warning_high):
        return "warning"
    return "normal"


def meter_freshness_status(
    recorded_at: datetime | str | None,
    stale_after_hours: int | None,
    *,
    now: datetime | None = None,
) -> str | None:
    """Freshness overlays current state only; it never rewrites recorded status."""
    if recorded_at is None:
        return "no_readings"
    if not stale_after_hours:
        return None
    if isinstance(recorded_at, str):
        recorded_at = datetime.fromisoformat(recorded_at.replace("Z", "+00:00"))
    if recorded_at.tzinfo is None:
        recorded_at = recorded_at.replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    return "stale" if recorded_at <= now - timedelta(hours=stale_after_hours) else None


def reading_insert_payload(
    meter: dict[str, Any],
    *,
    tenant_id: str,
    user_id: str,
    value: float,
    source: str,
    recorded_at: datetime | None = None,
    pm_completion_id: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """Build the append-only snapshot used by both manual and PM reads."""
    return {
        "tenant_id": tenant_id,
        "meter_id": meter["id"],
        "value": value,
        "recorded_at": (recorded_at or datetime.now(timezone.utc)).isoformat(),
        "recorded_by": user_id,
        "source": source,
        "status_at_recording": evaluate_meter_reading(meter, value),
        "warning_low_snapshot": meter.get("warning_low"),
        "warning_high_snapshot": meter.get("warning_high"),
        "critical_low_snapshot": meter.get("critical_low"),
        "critical_high_snapshot": meter.get("critical_high"),
        "pm_completion_id": pm_completion_id,
        "notes": notes,
    }


def persist_condition_reading(
    *,
    db: Any,
    meter: dict[str, Any],
    tenant_id: str,
    user_id: str,
    value: float,
    source: str,
    recorded_at: datetime | None = None,
    pm_completion_id: str | None = None,
    notes: str | None = None,
    asset: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Append a reading and, only when configured, open one critical corrective WO."""
    reading = db.table("meter_readings").insert(reading_insert_payload(
        meter, tenant_id=tenant_id, user_id=user_id, value=value, source=source,
        recorded_at=recorded_at, pm_completion_id=pm_completion_id, notes=notes,
    )).execute().data[0]
    if reading["status_at_recording"] != "critical" or meter.get("critical_action") != "create_work_order":
        return reading

    active = db.table("work_orders").select("id, work_order_number").eq(
        "tenant_id", tenant_id
    ).eq("condition_meter_id", meter["id"]).in_(
        "status", ["open", "escalated", "in_progress", "on_hold"]
    ).limit(1).execute().data or []
    if active:
        reading["work_order"] = active[0]
        return reading

    location = (asset or {}).get("location_text") or meter.get("location_text")
    title_location = f" — {location}" if location else ""
    threshold = meter.get("critical_high") if meter.get("critical_high") is not None else meter.get("critical_low")
    direction = "high" if meter.get("critical_high") is not None and value >= float(meter["critical_high"]) else "low"
    try:
        work_order = db.table("work_orders").insert({
            "tenant_id": tenant_id,
            "title": f"Critical {meter['name']}{title_location}",
            "description": f"Condition monitoring reading of {value:g} {meter['unit']} exceeded the critical {direction} threshold of {float(threshold):g} {meter['unit']}.",
            "category": "general",
            "priority": "urgent",
            "asset_id": meter.get("asset_id"),
            "location_text": location,
            "created_by": user_id,
            "sla_minutes": 1440,
            "condition_meter_id": meter["id"],
            "triggering_meter_reading_id": reading["id"],
        }).execute().data[0]
    except Exception:
        # Partial unique index is the race-safe authority. Fetch its winner so a
        # concurrent critical reading never produces duplicate corrective work.
        active = db.table("work_orders").select("id, work_order_number").eq(
            "tenant_id", tenant_id
        ).eq("condition_meter_id", meter["id"]).in_(
            "status", ["open", "escalated", "in_progress", "on_hold"]
        ).limit(1).execute().data or []
        if not active:
            raise
        reading["work_order"] = active[0]
        return reading
    db.table("meter_readings").update({"work_order_id": work_order["id"]}).eq(
        "id", reading["id"]
    ).eq("tenant_id", tenant_id).execute()
    reading["work_order"] = work_order
    reading["work_order_id"] = work_order["id"]
    return reading

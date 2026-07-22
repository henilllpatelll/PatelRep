"""Pure policy contracts shared by PM, housekeeping, and escalation routes."""

from datetime import date, datetime, timedelta
from typing import Any


class EvidenceRequiredError(ValueError):
    """Raised when a controlled checklist item has no required proof."""


# G8: corrective work orders must be escalatable — the escalations/check cron filters on
# due_at — and life-safety failures must not share the same priority as everything else.
CORRECTIVE_WO_SLA_HOURS = {"emergency": 4, "urgent": 24}


DEFAULT_PROGRAM_TEMPLATES = (
    {
        "code": "fire_extinguisher",
        "program_area": "engineering",
        "name": "Fire extinguisher inspection",
        "name_es": "Inspección de extintores",
        "requires_evidence": True,
    },
    {
        "code": "emergency_lighting",
        "program_area": "engineering",
        "name": "Emergency lighting function check",
        "name_es": "Revisión funcional de iluminación de emergencia",
        "requires_evidence": True,
    },
    {
        "code": "fire_alarm_sprinkler",
        "program_area": "engineering",
        "name": "Fire alarm and sprinkler vendor check",
        "name_es": "Revisión del proveedor de alarmas y rociadores",
        "requires_evidence": True,
    },
    {
        "code": "elevator_certificate",
        "program_area": "engineering",
        "name": "Elevator certificate review",
        "name_es": "Revisión de certificado de elevador",
        "requires_evidence": True,
    },
    {
        "code": "pool_check",
        "program_area": "engineering",
        "name": "Pool safety and chemistry check",
        "name_es": "Revisión de seguridad y química de piscina",
        "requires_evidence": True,
    },
    {
        "code": "domestic_water",
        "program_area": "engineering",
        "name": "Domestic water monitoring and flushing",
        "name_es": "Monitoreo y purga de agua doméstica",
        "requires_evidence": True,
    },
    {
        "code": "backflow",
        "program_area": "engineering",
        "name": "Backflow and regulated-obligation check",
        "name_es": "Revisión de contraflujo y obligaciones reguladas",
        "requires_evidence": True,
    },
    {
        "code": "privacy_guest_present_entry",
        "program_area": "housekeeping",
        "name": "Privacy and guest-present entry",
        "name_es": "Privacidad y entrada con huésped presente",
        "requires_evidence": False,
    },
    {
        "code": "sharps_body_fluid_spill",
        "program_area": "housekeeping",
        "name": "Sharps, body-fluid, and spill response",
        "name_es": "Respuesta a objetos punzantes, fluidos y derrames",
        "requires_evidence": False,
    },
)


def validate_completion_items(items: list[dict[str, Any]]) -> None:
    """Reject incomplete controlled checks before a PM record is persisted."""
    for item in items:
        result = item.get("result")
        if result not in {"passed", "failed", "not_applicable"}:
            raise ValueError("Checklist result must be passed, failed, or not_applicable")
        if item.get("requires_evidence") and result != "not_applicable" and not item.get("evidence"):
            raise EvidenceRequiredError(f"Evidence is required for {item.get('label', 'this checklist item')}")


def build_corrective_work_order(
    *,
    tenant_id: str,
    asset_id: str | None,
    completion_id: str,
    checklist_item: dict[str, Any],
    created_by: str,
    completed_at: datetime,
    criticality: str | None = None,
) -> dict[str, Any]:
    """Build the tenant-scoped, criticality-based follow-up for a failed PM item.

    G8: `life_safety` assets escalate to `emergency` priority (4h SLA); everything else
    stays `urgent` (24h SLA). `due_at` is always set so the `escalations/check` cron
    (which filters on due_at) can pick this work order up and auto-escalate it.
    """
    label = checklist_item.get("label", "PM checklist item")
    note = (checklist_item.get("note") or "No additional detail provided.").strip()
    priority = "emergency" if criticality == "life_safety" else "urgent"
    due_at = completed_at + timedelta(hours=CORRECTIVE_WO_SLA_HOURS[priority])
    return {
        "tenant_id": tenant_id,
        "asset_id": asset_id,
        "title": f"Corrective PM work: {label}",
        "description": f"Failed PM completion {completion_id}. {note}",
        "category": "safety",
        "priority": priority,
        "created_by": created_by,
        "is_pm_generated": True,
        "pm_completion_id": completion_id,
        "sla_minutes": 60,
        "due_at": due_at.isoformat(),
    }


def next_recurrence_date(completed_on: date, interval_days: int) -> date:
    if interval_days < 1:
        raise ValueError("Recurrence interval must be at least one day")
    return completed_on + timedelta(days=interval_days)


def should_create_dnd_escalation(
    *, dnd_hours: float, threshold_hours: int, existing_open_event: bool
) -> bool:
    return dnd_hours >= threshold_hours and not existing_open_event


def build_supply_alerts(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    for item in items:
        on_hand = item.get("on_hand", 0)
        par_level = item.get("par_level", 0)
        if on_hand < par_level:
            alerts.append({
                "name": item["name"],
                "on_hand": on_hand,
                "par_level": par_level,
                "shortage": par_level - on_hand,
            })
    return alerts

"""Pure policy contracts shared by PM, housekeeping, and escalation routes."""

import math
from datetime import date, datetime, timedelta
from typing import Any


class EvidenceRequiredError(ValueError):
    """Raised when a controlled checklist item has no required proof."""


# G8: corrective work orders must be escalatable — the escalations/check cron filters on
# due_at — and life-safety failures must not share the same priority as everything else.
CORRECTIVE_WO_SLA_HOURS = {"emergency": 4, "urgent": 24}


# D-05/G5: facility-gated templates only surface where property_applicability.facilities
# (migration 083) includes the matching key. Non-gated templates always seed.
GATED_TEMPLATE_FACILITIES = {
    "pool_check": "pool",
    "domestic_water": "domestic_water",
    "backflow": "backflow",
}


DEFAULT_PROGRAM_TEMPLATES = (
    {
        "code": "fire_extinguisher",
        "program_area": "engineering",
        "name": "Fire extinguisher inspection",
        "name_es": "Inspección de extintores",
        "requires_evidence": True,
        "default_frequency_days": 30,
        "items": [
            {"key": "gauge_in_range", "label": "Pressure gauge reads in the operable (green) range", "requires_evidence": False},
            {"key": "pin_seal_intact", "label": "Safety pin and tamper seal are intact", "requires_evidence": False},
            {"key": "accessible_unobstructed", "label": "Extinguisher is mounted, visible, and unobstructed", "requires_evidence": False},
            {"key": "tag_signed_photo", "label": "Inspection tag signed and dated", "requires_evidence": True},
        ],
    },
    {
        "code": "emergency_lighting",
        "program_area": "engineering",
        "name": "Emergency lighting function check",
        "name_es": "Revisión funcional de iluminación de emergencia",
        "requires_evidence": True,
        "default_frequency_days": 90,
        "items": [
            {"key": "battery_holds_charge", "label": "Battery/unit holds charge through the 90-second function test", "requires_evidence": False},
            {"key": "all_heads_illuminate", "label": "All lamp heads illuminate during the test", "requires_evidence": False},
            {"key": "charge_indicator_lit", "label": "AC power / charge indicator light is lit", "requires_evidence": False},
            {"key": "test_photo", "label": "Function test result photographed", "requires_evidence": True},
        ],
    },
    {
        "code": "fire_alarm_sprinkler",
        "program_area": "engineering",
        "name": "Fire alarm and sprinkler vendor check",
        "name_es": "Revisión del proveedor de alarmas y rociadores",
        "requires_evidence": True,
        "default_frequency_days": 90,
        "items": [
            {"key": "panel_no_trouble", "label": "Fire alarm panel shows no trouble/fault condition", "requires_evidence": False},
            {"key": "sprinkler_gauge_pressure", "label": "Sprinkler system gauge pressure is within normal range", "requires_evidence": False},
            {"key": "vendor_report_on_file", "label": "Vendor inspection report on file", "requires_evidence": True},
            {"key": "deficiencies_logged", "label": "Any deficiencies logged with a corrective plan", "requires_evidence": False},
        ],
    },
    {
        "code": "elevator_certificate",
        "program_area": "engineering",
        "name": "Elevator certificate review",
        "name_es": "Revisión de certificado de elevador",
        "requires_evidence": True,
        "default_frequency_days": 365,
        "items": [
            {"key": "current_cert_on_file", "label": "Current elevator operating certificate on file", "requires_evidence": True},
            {"key": "cert_posted_in_cab", "label": "Certificate posted and visible in the elevator cab", "requires_evidence": False},
            {"key": "inspection_date_recorded", "label": "Most recent state/third-party inspection date recorded", "requires_evidence": False},
            {"key": "load_rating_confirmed", "label": "Load rating plate matches the certificate", "requires_evidence": False},
        ],
    },
    {
        "code": "pool_check",
        "program_area": "engineering",
        "name": "Pool safety and chemistry check",
        "name_es": "Revisión de seguridad y química de piscina",
        "requires_evidence": True,
        "default_frequency_days": 1,
        "items": [
            {"key": "free_chlorine_in_range", "label": "Free chlorine within code range (1-10 ppm)", "requires_evidence": False},
            {"key": "ph_in_range", "label": "pH within 7.2-7.8 range", "requires_evidence": False},
            {"key": "signage_posted", "label": "Required safety/depth/no-lifeguard signage posted", "requires_evidence": False},
            {"key": "readings_logged_photo", "label": "Chemical readings logged (test strip or meter photo)", "requires_evidence": True},
        ],
    },
    {
        "code": "domestic_water",
        "program_area": "engineering",
        "name": "Domestic water monitoring and flushing",
        "name_es": "Monitoreo y purga de agua doméstica",
        "requires_evidence": True,
        "default_frequency_days": 30,
        "items": [
            {"key": "temperature_verified", "label": "Hot water temperature verified at point of use (Legionella control)", "requires_evidence": False},
            {"key": "flushing_completed_low_use", "label": "Low-use fixtures and dead legs flushed per schedule", "requires_evidence": False},
            {"key": "log_entry_photo", "label": "Flushing/monitoring log entry recorded", "requires_evidence": True},
        ],
    },
    {
        "code": "backflow",
        "program_area": "engineering",
        "name": "Backflow and regulated-obligation check",
        "name_es": "Revisión de contraflujo y obligaciones reguladas",
        "requires_evidence": True,
        "default_frequency_days": 365,
        "items": [
            {"key": "device_tested_by_certified_tester", "label": "Backflow prevention device tested by a licensed tester", "requires_evidence": True},
            {"key": "test_report_filed_with_authority", "label": "Test report filed with the local water authority", "requires_evidence": True},
            {"key": "device_passes_no_leaks", "label": "Device shows no leaks or fouling on visual check", "requires_evidence": False},
        ],
    },
    {
        "code": "privacy_guest_present_entry",
        "program_area": "housekeeping",
        "name": "Privacy and guest-present entry",
        "name_es": "Privacidad y entrada con huésped presente",
        "requires_evidence": False,
        "default_frequency_days": None,
        "items": [
            {"key": "knock_announce", "label": "Housekeeper knocks and announces presence before entry", "requires_evidence": False},
            {"key": "wait_for_response", "label": "Wait a reasonable time for a guest response before entering", "requires_evidence": False},
            {"key": "door_prop_or_partner", "label": "Door propped or partner present while a guest is inside", "requires_evidence": False},
            {"key": "report_refused_entry", "label": "Refused or limited entry reported to a supervisor", "requires_evidence": False},
        ],
    },
    {
        "code": "sharps_body_fluid_spill",
        "program_area": "housekeeping",
        "name": "Sharps, body-fluid, and spill response",
        "name_es": "Respuesta a objetos punzantes, fluidos y derrames",
        "requires_evidence": False,
        "default_frequency_days": None,
        "items": [
            {"key": "ppe_worn", "label": "Appropriate PPE (gloves, eye protection) worn before response", "requires_evidence": False},
            {"key": "sharps_container_used", "label": "Sharps disposed of using a puncture-resistant sharps container", "requires_evidence": False},
            {"key": "spill_kit_used_and_area_disinfected", "label": "Spill kit used; area cleaned and disinfected per protocol", "requires_evidence": False},
            {"key": "incident_reported", "label": "Incident reported to a supervisor and logged", "requires_evidence": False},
        ],
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


def select_inspection_sample(
    *, rooms: list[dict[str, Any]], rules: list[dict[str, Any]], default_percent: int = 10
) -> list[str]:
    """G11/HK-02: which of today's assigned rooms a supervisor must physically
    inspect, honoring the tenant's `inspection_sampling_rules` instead of a flat
    aggregate. Each `room` dict needs `room_id`, `room_type_id`, `experience_band`,
    `risk_level` (already resolved by the caller — this function is pure, no DB).

    Rule matching is most-specific-first: a rule whose `room_type_id` exactly
    matches the room beats a wildcard rule (`room_type_id is None`, applies to
    all room types) with the same `experience_band`/`risk_level`; when several
    rules of the same specificity match, the highest `sample_percent` wins (never
    silently under-samples). Falls back to `default_percent` when nothing matches.

    Sampling is deterministic: rooms are grouped by (room_type_id, experience_band,
    risk_level), each group is sorted by room_id, and the first
    `ceil(count * pct / 100)` rooms in that order are selected.
    """
    def _matching_percent(room: dict[str, Any]) -> int:
        candidates = [
            rule for rule in rules
            if rule.get("experience_band") == room.get("experience_band")
            and rule.get("risk_level") == room.get("risk_level")
            and (rule.get("room_type_id") is None or rule.get("room_type_id") == room.get("room_type_id"))
        ]
        if not candidates:
            return default_percent
        exact = [rule for rule in candidates if rule.get("room_type_id") == room.get("room_type_id")]
        pool = exact or candidates
        return max(rule["sample_percent"] for rule in pool)

    groups: dict[tuple, list[dict[str, Any]]] = {}
    for room in rooms:
        key = (room.get("room_type_id"), room.get("experience_band"), room.get("risk_level"))
        groups.setdefault(key, []).append(room)

    selected: list[str] = []
    for group_rooms in groups.values():
        percent = _matching_percent(group_rooms[0])
        sample_size = math.ceil(len(group_rooms) * percent / 100)
        ordered = sorted(group_rooms, key=lambda room: room["room_id"])
        selected.extend(room["room_id"] for room in ordered[:sample_size])
    return sorted(selected)


def aggregate_inspection_quality(inspections: list[dict[str, Any]]) -> dict[str, Any]:
    """HK-03: quality trends broken down by overall result, checklist item, room
    type, and employee -- not only `overall_result`. Each dimension is a list of
    `{key, count}`, plus `pass_rate`/`fail_rate` when the dimension has a
    pass/fail concept (by_result itself is the result breakdown, so it has no
    rate). Pure; accepts already-joined inspection dicts (`rooms.room_type_id`,
    `inspection_results[].inspection_template_items.description` when present).
    """
    def _bump(bucket: dict[str, dict[str, Any]], key: str, is_pass: bool | None) -> None:
        entry = bucket.setdefault(key, {"key": key, "count": 0, "pass_count": 0, "fail_count": 0})
        entry["count"] += 1
        if is_pass is True:
            entry["pass_count"] += 1
        elif is_pass is False:
            entry["fail_count"] += 1

    def _finalize(bucket: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        rows = []
        for entry in bucket.values():
            row = {"key": entry["key"], "count": entry["count"]}
            total_rated = entry["pass_count"] + entry["fail_count"]
            if total_rated:
                row["pass_rate"] = round(entry["pass_count"] / total_rated, 4)
                row["fail_rate"] = round(entry["fail_count"] / total_rated, 4)
            rows.append(row)
        return sorted(rows, key=lambda row: row["key"])

    by_result: dict[str, dict[str, Any]] = {}
    by_item: dict[str, dict[str, Any]] = {}
    by_room_type: dict[str, dict[str, Any]] = {}
    by_employee: dict[str, dict[str, Any]] = {}

    for inspection in inspections:
        result = inspection.get("overall_result") or "unknown"
        is_pass = True if result == "passed" else False if result == "failed" else None
        _bump(by_result, result, None)

        room_type_id = (inspection.get("rooms") or {}).get("room_type_id") or "unknown"
        _bump(by_room_type, room_type_id, is_pass)

        employee = inspection.get("inspected_by") or "unknown"
        _bump(by_employee, employee, is_pass)

        for item_result in inspection.get("inspection_results") or []:
            label = (
                (item_result.get("inspection_template_items") or {}).get("description")
                or item_result.get("template_item_id")
                or "unknown"
            )
            item_result_value = item_result.get("result")
            item_is_pass = True if item_result_value == "pass" else False if item_result_value == "fail" else None
            _bump(by_item, label, item_is_pass)

    return {
        "by_result": _finalize(by_result),
        "by_item": _finalize(by_item),
        "by_room_type": _finalize(by_room_type),
        "by_employee": _finalize(by_employee),
        "sample_size": len(inspections),
    }

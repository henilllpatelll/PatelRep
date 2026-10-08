"""
Single source of truth for how Settings audit events are described to a GM.

Everything that is shown in Activity & Audit comes through this catalog:

* ``ACTIONS``  - the only event actions the Activity API will return (an allowlist), with a human title
  and a category. Existing operational events that are not listed here (room status, work-order
  transitions, discrepancies, ...) are never exposed by this screen.
* ``FIELDS``   - per resource type, the only state keys that may be written to or read from
  ``old_state`` / ``new_state``, with a display label. Unknown keys are dropped on write AND on read,
  so historic or future rows cannot leak extra data through the UI.
* ``CATEGORIES`` - one entry per category that actually has mapped actions.

The frontend only needs category ids (for icons/filters); labels and field names live here.
"""
from __future__ import annotations

import re
from typing import Any

# category id -> display label (ordered). Billing is intentionally absent: no billing event is recorded
# by this application (subscription state is mirrored from Stripe webhooks, which are not admin actions).
CATEGORIES: dict[str, str] = {
    "property": "Property",
    "rooms": "Rooms",
    "housekeeping": "Housekeeping",
    "inspections": "Inspections",
    "sla": "Service SLAs",
    "permissions": "Permissions",
    "integrations": "Integrations",
    "operations": "Operations",
}

# action -> (title, category)
ACTIONS: dict[str, tuple[str, str]] = {
    # Property
    "settings.property.updated": ("Property profile updated", "property"),
    "settings.property.layout_updated": ("Property layout replaced", "property"),
    # Rooms
    "settings.room.created": ("Room added", "rooms"),
    "settings.room.updated": ("Room details updated", "rooms"),
    "settings.room.deleted": ("Room deleted", "rooms"),
    "settings.rooms.imported": ("Rooms imported", "rooms"),
    "settings.accessibility_feature.updated": ("Accessibility feature updated", "rooms"),
    # Housekeeping
    "settings.cleaning_checklist.updated": ("Cleaning checklist updated", "housekeeping"),
    "settings.cleaning_checklist.reset": ("Cleaning checklist restored to defaults", "housekeeping"),
    "settings.housekeeping_workload.updated": ("Housekeeping workload settings updated", "housekeeping"),
    "settings.housekeeping_assignment.updated": ("Assignment preferences updated", "housekeeping"),
    # Inspections
    "settings.inspection_template.created": ("Inspection template created", "inspections"),
    "settings.inspection_template.updated": ("Inspection template updated", "inspections"),
    "settings.inspection_template.deleted": ("Inspection template deleted", "inspections"),
    "settings.inspection_template.archived": ("Inspection template archived", "inspections"),
    # Service SLAs
    "settings.sla_policy.created": ("Service SLA rule created", "sla"),
    "settings.sla_policy.updated": ("Service SLA rule updated", "sla"),
    "settings.sla_policy.deleted": ("Service SLA rule deleted", "sla"),
    # Permissions
    "settings.custom_role.created": ("Custom role created", "permissions"),
    "settings.custom_role.updated": ("Custom role updated", "permissions"),
    "settings.custom_role.deleted": ("Custom role deleted", "permissions"),
    "settings.front_desk_access.updated": ("Front Desk access updated", "permissions"),
    # Integrations
    "settings.integration.opera_connected": ("OPERA Cloud connection saved", "integrations"),
    "settings.integration.opera_sftp_connected": ("OPERA Cloud report ingestion connection saved", "integrations"),
    "settings.integration.opera_disconnected": ("OPERA Cloud disconnected", "integrations"),
    "settings.integration.opera_conflict_resolved": ("OPERA sync conflict resolved", "integrations"),
    # Operations: pre-existing events that are safe to list by title only (their states are never shown).
    "controlled_document.created": ("Controlled document created", "operations"),
    "controlled_document.approved": ("Controlled document approved", "operations"),
    "vendor.created": ("Vendor added", "operations"),
    "vendor.updated": ("Vendor updated", "operations"),
    "work_order.archived": ("Work order archived", "operations"),
    "work_order.unarchived": ("Work order restored from archive", "operations"),
    "property_applicability.updated": ("Program applicability updated", "operations"),
}

# Events whose old/new state may be shown (everything recorded by the Settings helper below).
DETAIL_ACTION_PREFIX = "settings."

RESOURCE_TYPES: dict[str, str] = {
    "property_profile": "Property profile",
    "property_layout": "Property layout",
    "room": "Room",
    "rooms_import": "Room import",
    "accessibility_feature": "Accessibility feature",
    "cleaning_checklist": "Cleaning checklist",
    "housekeeping_workload": "Housekeeping workload",
    "housekeeping_assignment": "Assignment preferences",
    "inspection_template": "Inspection template",
    "sla_policy": "Service SLA rule",
    "custom_role": "Custom role",
    "front_desk_access": "Front Desk access",
    "integration": "OPERA Cloud integration",
    "integration_conflict": "OPERA sync conflict",
    # pre-existing operational resource types
    "controlled_document": "Controlled document",
    "vendor": "Vendor",
    "work_order": "Work order",
    "property_applicability": "Program applicability",
}

# resource type -> {state key: label}. Only these keys are ever stored or returned.
FIELDS: dict[str, dict[str, str]] = {
    "property_profile": {
        "name": "Property name", "address": "Address", "city": "City", "state": "State", "zip": "ZIP code",
        "phone": "Phone", "room_count": "Room count", "timezone": "Time zone",
        "average_daily_rate_cents": "Average daily rate (cents)",
    },
    "property_layout": {"section_count": "Layout sections"},
    "room": {"room_number": "Room number", "floor": "Floor", "building": "Building", "room_type_id": "Room type"},
    "rooms_import": {"source": "Import source", "submitted": "Rooms submitted", "created": "Rooms created", "updated": "Rooms updated", "skipped": "Rooms skipped"},
    "accessibility_feature": {
        "room_number": "Room", "feature_code": "Feature", "operational_status": "Status",
        "description": "Description", "guidance": "Guidance",
    },
    "cleaning_checklist": {"name": "Checklist name", "clean_type": "Clean type", "item_count": "Items"},
    "housekeeping_workload": {
        "default_target_credits": "Daily target credits", "credit_weights": "Cleaning weights",
        "capacity_override_count": "Staff capacity overrides",
    },
    "housekeeping_assignment": {"preferences": "Assignment preferences"},
    "inspection_template": {
        "name": "Template name", "is_default": "Default template", "is_active": "Active",
        "section_count": "Sections", "check_count": "Checks",
    },
    "sla_policy": {
        "category": "Category", "priority": "Priority", "guest_impact": "Guest impact", "sla_minutes": "Response target (minutes)",
    },
    "custom_role": {
        "name": "Role name", "description": "Description", "base_role": "Base role", "allowed_modules": "Modules",
    },
    "front_desk_access": {"modules": "Modules"},
    "integration": {
        "property_code": "Property code", "endpoint": "Endpoint", "connection_mode": "Connection type",
        "auth_updated": "Authentication details",
    },
    "integration_conflict": {"resolution": "Resolution", "entity_type": "Record type", "external_id": "OPERA reference"},
}

# Defence in depth on top of the allowlist: never keep a value whose key looks like a credential.
_SENSITIVE_KEY = re.compile(r"pass(word|phrase)?|secret|token|api[_-]?key|authorization|cookie|credential|private|bearer|session", re.I)
_MAX_STR = 200
_MAX_ITEMS = 60

CATEGORY_ACTIONS: dict[str, list[str]] = {
    cat: [action for action, (_, c) in ACTIONS.items() if c == cat] for cat in CATEGORIES
}


def action_title(action: str) -> str | None:
    entry = ACTIONS.get(action)
    return entry[0] if entry else None


def action_category(action: str) -> str | None:
    entry = ACTIONS.get(action)
    return entry[1] if entry else None


def _clean_scalar(value: Any) -> Any:
    if isinstance(value, bool) or value is None or isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        return value if len(value) <= _MAX_STR else value[: _MAX_STR - 1] + "…"
    return None


def _clean_value(value: Any) -> Any:
    """Scalars, short lists of scalars, or one level of scalar-valued dicts. Anything else is dropped."""
    if isinstance(value, list):
        return [c for c in (_clean_scalar(v) for v in value[:_MAX_ITEMS]) if c is not None]
    if isinstance(value, dict):
        return {
            str(k)[:60]: c
            for k, v in list(value.items())[:_MAX_ITEMS]
            if not _SENSITIVE_KEY.search(str(k)) and (c := _clean_scalar(v)) is not None
        }
    return _clean_scalar(value)


def sanitize_state(resource_type: str, state: dict | None) -> dict:
    """Keep only allowlisted, non-sensitive keys of ``state`` for ``resource_type`` (used on write and on read)."""
    allowed = FIELDS.get(resource_type, {})
    if not isinstance(state, dict):
        return {}
    return {
        key: _clean_value(value)
        for key, value in state.items()
        if key in allowed and not _SENSITIVE_KEY.search(key)
    }


def _as_list(value: Any) -> list | None:
    return value if isinstance(value, list) else None


def build_changes(resource_type: str, old_state: dict | None, new_state: dict | None) -> list[dict]:
    """
    Human-readable change items from the RECORDED states only.

    A key that is absent from a state was not recorded (it is not guessed from current data): the item
    then omits ``before`` / ``after`` entirely, and the UI shows it as not recorded.
    """
    labels = FIELDS.get(resource_type, {})
    old = sanitize_state(resource_type, old_state)
    new = sanitize_state(resource_type, new_state)
    items: list[dict] = []
    for key, label in labels.items():
        if key not in old and key not in new:
            continue
        item: dict = {"field": key, "label": label}
        if key in old:
            item["before"] = old[key]
        if key in new:
            item["after"] = new[key]
        before, after = item.get("before"), item.get("after")
        if _as_list(before) is not None or _as_list(after) is not None:
            b, a = _as_list(before) or [], _as_list(after) or []
            item["added"] = [x for x in a if x not in b]
            item["removed"] = [x for x in b if x not in a]
        elif isinstance(before, dict) or isinstance(after, dict):
            b, a = before if isinstance(before, dict) else {}, after if isinstance(after, dict) else {}
            item["changed_keys"] = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
        items.append(item)
    return items


def changed_subset(resource_type: str, old: dict | None, new: dict | None) -> tuple[dict, dict]:
    """Old/new states reduced to the allowlisted keys whose value actually changed (both sides keep the key)."""
    o, n = sanitize_state(resource_type, old), sanitize_state(resource_type, new)
    keys = [k for k in set(o) | set(n) if o.get(k) != n.get(k)]
    return {k: o[k] for k in keys if k in o}, {k: n[k] for k in keys if k in n}


ROLE_LABELS: dict[str, str] = {
    "gm": "General Manager",
    "housekeeping_supervisor": "Housekeeping Supervisor",
    "chief_engineer": "Chief Engineer",
    "engineer": "Engineer",
    "housekeeper": "Housekeeper",
    "front_desk": "Front Desk",
}


def role_label(role: str | None) -> str | None:
    if not role:
        return None
    return ROLE_LABELS.get(role, role.replace("_", " ").title())


def resource_name(resource_type: str, old_state: dict | None, new_state: dict | None) -> str | None:
    """A recorded, human-friendly name for the affected resource (never looked up from current data)."""
    new, old = sanitize_state(resource_type, new_state), sanitize_state(resource_type, old_state)
    for source in (new, old):
        if resource_type == "room" and source.get("room_number"):
            return f"Room {source['room_number']}"
        if resource_type == "accessibility_feature" and source.get("feature_code"):
            room = source.get("room_number")
            return f"{source['feature_code']}{f' (Room {room})' if room else ''}"
        if resource_type == "cleaning_checklist" and source.get("clean_type"):
            return f"{source['clean_type']} checklist"
        if resource_type == "integration_conflict" and source.get("external_id"):
            return str(source["external_id"])
        if resource_type == "integration" and source.get("property_code"):
            return f"Property {source['property_code']}"
        if source.get("name"):
            return str(source["name"])
    return None

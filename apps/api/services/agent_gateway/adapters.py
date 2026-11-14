"""Domain-operation adapters: trusted resource resolution and the bounded, tenant-scoped read operations.

Every query filters by the TRUSTED hotel id (from the reloaded identity, never from arguments) AND the resource id,
so another hotel's id resolves to nothing -- there is no fetch-then-filter. Reads select an explicit, minimal column
list: no guest names, notes, descriptions, photos, comments or free text beyond a truncated work-order title.

The one write (work-order assignment) has no Python implementation here: it executes inside the database through
``agent_tool_execute_work_order_assign`` -> ``work_order_assign_apply`` (the same operation the human route uses).
"""
from __future__ import annotations

from typing import Any, Mapping, Optional

from services.agent_harness.policy import VerifiedResource
from services.agent_harness.vocabulary import ResourceType

TITLE_MAX = 120


def _single(rows: Any) -> Optional[dict]:
    rows = rows or []
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        return None  # zero rows = not in this hotel; more than one = inconsistent, fail closed
    return rows[0]


def _verified(row: Optional[dict], resource_type: ResourceType, hotel_id: str) -> Optional[VerifiedResource]:
    if row is None or str(row.get("tenant_id")) != hotel_id or not row.get("id"):
        return None
    return VerifiedResource(resource_type=resource_type, resource_id=str(row["id"]), hotel_id=hotel_id)


def resolve_work_order(client: Any, hotel_id: str, arguments: Mapping[str, Any]) -> Optional[VerifiedResource]:
    rows = (client.table("work_orders").select("id, tenant_id")
            .eq("id", arguments["work_order_id"]).eq("tenant_id", hotel_id).limit(2).execute().data)
    return _verified(_single(rows), ResourceType.WORK_ORDER, hotel_id)


def resolve_room(client: Any, hotel_id: str, arguments: Mapping[str, Any]) -> Optional[VerifiedResource]:
    rows = (client.table("rooms").select("id, tenant_id")
            .eq("id", arguments["room_id"]).eq("tenant_id", hotel_id).limit(2).execute().data)
    return _verified(_single(rows), ResourceType.ROOM, hotel_id)


def _embedded(value: Any) -> Optional[dict]:
    if isinstance(value, list):
        return value[0] if len(value) == 1 and isinstance(value[0], dict) else None
    return value if isinstance(value, dict) else None


def read_work_order_summary(client: Any, hotel_id: str, resource: VerifiedResource) -> Optional[dict]:
    row = _single(client.table("work_orders")
                  .select("id, tenant_id, work_order_number, title, status, priority, assigned_to, due_at, rooms(room_number)")
                  .eq("id", resource.resource_id).eq("tenant_id", hotel_id).limit(2).execute().data)
    if row is None or str(row.get("tenant_id")) != hotel_id:
        return None
    room = _embedded(row.get("rooms")) or {}
    return {
        "id": str(row["id"]),
        "work_order_number": row.get("work_order_number"),
        "title": str(row.get("title") or "")[:TITLE_MAX],
        "status": row.get("status"),
        "priority": row.get("priority"),
        "assigned_to": str(row["assigned_to"]) if row.get("assigned_to") else None,
        "room_number": room.get("room_number"),
        "due_at": row.get("due_at"),
    }


def read_room_status(client: Any, hotel_id: str, resource: VerifiedResource) -> Optional[dict]:
    row = _single(client.table("rooms")
                  .select("id, tenant_id, room_number, floor, building, is_active, "
                          "room_status(status, fo_status, clean_type, dnd_flag, updated_at)")
                  .eq("id", resource.resource_id).eq("tenant_id", hotel_id).limit(2).execute().data)
    if row is None or str(row.get("tenant_id")) != hotel_id:
        return None
    status = _embedded(row.get("room_status")) or {}
    return {
        "id": str(row["id"]),
        "room_number": str(row.get("room_number") or ""),
        "floor": row.get("floor") if isinstance(row.get("floor"), int) and not isinstance(row.get("floor"), bool) else None,
        "building": row.get("building"),
        "is_active": bool(row.get("is_active")),
        "status": status.get("status"),
        "fo_status": status.get("fo_status"),
        "clean_type": status.get("clean_type"),
        "do_not_disturb": status.get("dnd_flag"),
        "updated_at": status.get("updated_at"),
    }

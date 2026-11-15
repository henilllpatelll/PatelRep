"""H5 read adapters: bounded, tenant-scoped reads that mirror the domain rules of the operations they inform.

Every query filters by the TRUSTED hotel id (never an argument) and selects explicit minimal columns. The rules are
copies of the authoritative database rules, not new ones, and the database re-applies the real rule at execution:

  * engineer eligibility  = ``work_order_assign_apply`` (migration 242): an active ``engineer`` role in the hotel
  * housekeeper eligibility = ``publish_assignment_batch`` (migration 222): an active ``housekeeper`` or
    ``housekeeping_supervisor`` role in the hotel
  * a room's owner        = the dated ``room_assignments`` row for the hotel's current day, else the status mirror
  * blockers             = DND, do-not-service, return-later, an open occupancy discrepancy, a non-assignable stage

These reads describe; they never decide. Nothing here marks a room clean, inspected, vacant or ready.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any, Callable, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from services.agent_gateway.adapters import _embedded, _single
from services.agent_gateway.catalog_h5 import (
    ASSIGNABLE_ROOM_STATUSES,
    MAX_ENGINEERING_CANDIDATES,
    MAX_HOUSEKEEPING_CANDIDATES,
)
from services.agent_harness.policy import VerifiedResource

ASSIGNABLE_WORK_ORDER_STATUSES = ("open", "escalated", "in_progress", "on_hold")
HOUSEKEEPING_RECEIVER_ROLES = ("housekeeper", "housekeeping_supervisor")
_ROW_CAP = 2_000

Clock = Callable[[], datetime]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def hotel_today(client: Any, hotel_id: str, clock: Clock = _utcnow) -> Optional[str]:
    """The hotel's current calendar day (same rule as publish_assignment_batch: now() in the tenant's timezone)."""
    row = _single(client.table("tenants").select("id, timezone").eq("id", hotel_id).limit(2).execute().data)
    if row is None or str(row.get("id")) != hotel_id:
        return None
    try:
        zone = ZoneInfo(str(row.get("timezone") or "UTC"))
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("UTC")
    return clock().astimezone(zone).date().isoformat()


def read_assignment_candidates(client: Any, hotel_id: str, resource: VerifiedResource) -> Optional[dict]:
    roles = (client.table("user_roles").select("user_id")
             .eq("tenant_id", hotel_id).eq("role", "engineer").eq("is_active", True).limit(_ROW_CAP).execute().data or [])
    staff = sorted({str(r["user_id"]) for r in roles if r.get("user_id")})
    load: Counter = Counter()
    if staff:
        open_rows = (client.table("work_orders").select("assigned_to")
                     .eq("tenant_id", hotel_id).in_("assigned_to", staff)
                     .in_("status", list(ASSIGNABLE_WORK_ORDER_STATUSES)).limit(_ROW_CAP).execute().data or [])
        load = Counter(str(r["assigned_to"]) for r in open_rows if r.get("assigned_to"))
    ranked = sorted(staff, key=lambda s: (load[s], s))
    return {
        "work_order_id": resource.resource_id,
        "candidates": [{"staff_id": s, "position": "engineer", "open_work_orders": load[s]}
                       for s in ranked[:MAX_ENGINEERING_CANDIDATES]],
        "truncated": len(ranked) > MAX_ENGINEERING_CANDIDATES,
    }


def _room_row(client: Any, hotel_id: str, room_id: str) -> Optional[dict]:
    row = _single(client.table("rooms")
                  .select("id, tenant_id, room_number, is_active, room_status(status, fo_status, clean_type, "
                          "assigned_to, dnd_flag, do_not_service, dnd_retry_at, updated_at)")
                  .eq("id", room_id).eq("tenant_id", hotel_id).limit(2).execute().data)
    if row is None or str(row.get("tenant_id")) != hotel_id:
        return None
    return row


def read_room_readiness(client: Any, hotel_id: str, resource: VerifiedResource, clock: Clock = _utcnow) -> Optional[dict]:
    row = _room_row(client, hotel_id, resource.resource_id)
    today = hotel_today(client, hotel_id, clock)
    if row is None or today is None:
        return None
    status = _embedded(row.get("room_status")) or {}
    dated = _single(client.table("room_assignments").select("id, assigned_to")
                    .eq("tenant_id", hotel_id).eq("room_id", resource.resource_id).eq("assignment_date", today)
                    .limit(2).execute().data)
    if dated is not None:
        owner, source = dated.get("assigned_to"), "dated"
    elif status.get("assigned_to"):
        owner, source = status.get("assigned_to"), "mirror"
    else:
        owner, source = None, "none"
    discrepancy = (client.table("room_occupancy_discrepancies").select("id")
                   .eq("tenant_id", hotel_id).eq("room_id", resource.resource_id).eq("status", "open")
                   .limit(1).execute().data or [])
    stage = status.get("status")
    blockers: list[str] = []
    if not row.get("is_active"):
        blockers.append("room_inactive")
    if stage == "IN_PROGRESS":
        blockers.append("cleaning_started")
    if stage not in ASSIGNABLE_ROOM_STATUSES:
        blockers.append("room_not_assignable")
    if status.get("dnd_flag"):
        blockers.append("dnd")
    if status.get("do_not_service"):
        blockers.append("service_declined")
    retry = _parse(status.get("dnd_retry_at"))
    if retry is not None and retry > clock():
        blockers.append("return_later")
    if discrepancy:
        blockers.append("occupancy_discrepancy")
    return {
        "id": str(row["id"]),
        "room_number": str(row.get("room_number") or "")[:20],
        "is_active": bool(row.get("is_active")),
        "status": stage,
        "fo_status": status.get("fo_status"),
        "clean_type": status.get("clean_type"),
        "hotel_date": today,
        "current_assigned_to": str(owner) if owner else None,
        "assignment_source": source,
        "assignable": not blockers,
        "blockers": blockers,
        "status_updated_at": status.get("updated_at"),
    }


def read_housekeeping_candidates(client: Any, hotel_id: str, resource: VerifiedResource,
                                 clock: Clock = _utcnow) -> Optional[dict]:
    if _room_row(client, hotel_id, resource.resource_id) is None:
        return None
    today = hotel_today(client, hotel_id, clock)
    if today is None:
        return None
    roles = (client.table("user_roles").select("user_id, role")
             .eq("tenant_id", hotel_id).eq("is_active", True).in_("role", list(HOUSEKEEPING_RECEIVER_ROLES))
             .limit(_ROW_CAP).execute().data or [])
    position: dict[str, str] = {}
    for r in roles:
        uid = str(r.get("user_id") or "")
        if uid and (position.get(uid) != "housekeeper"):
            position[uid] = str(r.get("role"))  # a person holding both is described as a housekeeper
    staff = sorted(position)
    load: Counter = Counter()
    if staff:
        rows = (client.table("room_assignments").select("assigned_to")
                .eq("tenant_id", hotel_id).eq("assignment_date", today).in_("assigned_to", staff)
                .limit(_ROW_CAP).execute().data or [])
        load = Counter(str(r["assigned_to"]) for r in rows if r.get("assigned_to"))
    ranked = sorted(staff, key=lambda s: (load[s], s))
    return {
        "room_id": resource.resource_id,
        "hotel_date": today,
        "candidates": [{"staff_id": s, "position": position[s], "rooms_assigned_today": load[s]}
                       for s in ranked[:MAX_HOUSEKEEPING_CANDIDATES]],
        "truncated": len(ranked) > MAX_HOUSEKEEPING_CANDIDATES,
    }

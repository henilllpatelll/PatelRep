"""Post-commit staff notification for a NEWLY committed, human-approved gateway write (worker composition only).

Mirrors the human routes: ``POST /housekeeping/assignments/batch-publish`` pushes each gaining housekeeper and
``POST /work-orders/{id}/assign`` pushes the engineer, both AFTER the commit and both best effort. Here too:

  * called only for an execution the worker's own attempt committed with a real change (never for a replay, so a
    redelivered or recovered run never notifies twice);
  * a failure is swallowed and logged with identifiers only -- it never undoes or reports against the committed change;
  * the push goes through ``services.notify.send_push`` (central policy: event registry, preferences, devices).

A crash between the database commit and this call loses the push, exactly as it would on the human route.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Mapping

logger = logging.getLogger("patelrep.agent_handoff")


def _row(client: Any, table: str, columns: str, *, hotel_id: str, row_id: str) -> dict:
    rows = (client.table(table).select(columns).eq("id", row_id).eq("tenant_id", hotel_id).limit(1).execute().data
            or [])
    return rows[0] if rows and isinstance(rows[0], dict) else {}


def notify_committed_write(client: Any, committed: Mapping[str, Any]) -> None:
    from services.notify import send_push  # local: the worker imports this module only through its composition root

    try:
        hotel = str(committed["hotel_id"])
        result = dict(committed.get("result") or {})
        tool = (committed.get("tool_id"), committed.get("tool_version"))
        if tool == ("housekeeping.room_assignments.assign", 1):
            room = _row(client, "rooms", "id, room_number", hotel_id=hotel, row_id=str(result["room_id"]))
            number = str(room.get("room_number") or "")
            coro = send_push(tenant_id=hotel, recipient_ids=[str(result["assigned_to"])], event_type="room_assignment",
                             title="Room Assigned", body=f"Room {number} has been assigned to you",
                             data={"room_number": number, "url": f"/(app)/my-rooms/{result['room_id']}"})
        elif tool == ("engineering.work_orders.assign", 2):
            wo = _row(client, "work_orders", "id, title", hotel_id=hotel, row_id=str(result["id"]))
            coro = send_push(tenant_id=hotel, recipient_ids=[str(result["assigned_to"])], event_type="wo_assignment",
                             title="Work Order Assigned", body=str(wo.get("title") or "")[:120],
                             data={"url": f"/(app)/work-orders/{result['id']}", "wo_id": str(result["id"])})
        else:
            return
        asyncio.run(coro)
    except Exception:  # noqa: BLE001 - a push failure never affects the committed change
        logger.warning("agent_write_push_failed tool=%s", committed.get("tool_id"))

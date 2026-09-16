"""Engineering spare-parts stock movements (migration 102).

Shared by routers/inventory.py (manual add/remove/count/transfer) and
routers/work_orders.py (parts consumed closing a work order) so both paths
mutate engineering_part_stock and log engineering_part_transactions the same
way.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException

from core.database import supabase


def get_stock_quantity(part_id: str, location_id: str, tenant_id: str) -> float:
    row = (
        supabase.table("engineering_part_stock")
        .select("quantity")
        .eq("part_id", part_id)
        .eq("location_id", location_id)
        .eq("tenant_id", tenant_id)
        .maybe_single()
        .execute()
    )
    data = row.data if row else None
    return float((data or {}).get("quantity") or 0)


def _set_stock(part_id: str, location_id: str, tenant_id: str, quantity: float) -> float:
    supabase.table("engineering_part_stock").upsert(
        {
            "tenant_id": tenant_id,
            "part_id": part_id,
            "location_id": location_id,
            "quantity": quantity,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="part_id,location_id",
    ).execute()
    return quantity


def adjust_stock(
    part_id: str,
    location_id: str,
    tenant_id: str,
    delta: float,
    *,
    allow_negative: bool = True,
) -> float:
    """Apply a relative change. Raises 409 if it would go negative and
    allow_negative is False (the case for remove/transfer-out/consume)."""
    current = get_stock_quantity(part_id, location_id, tenant_id)
    new_quantity = current + delta
    if not allow_negative and new_quantity < 0:
        raise HTTPException(status_code=409, detail="Insufficient stock at this location")
    return _set_stock(part_id, location_id, tenant_id, new_quantity)


def set_stock_count(
    part_id: str, location_id: str, tenant_id: str, quantity: float
) -> tuple[float, float]:
    """Physical recount: set on-hand to an absolute value. Returns (new_quantity, delta_applied)."""
    current = get_stock_quantity(part_id, location_id, tenant_id)
    delta = quantity - current
    return _set_stock(part_id, location_id, tenant_id, quantity), delta


def record_transaction(
    *,
    tenant_id: str,
    part_id: str,
    location_id: str,
    transaction_type: str,
    quantity_delta: float,
    resulting_quantity: float,
    user_id: str,
    work_order_id: str | None = None,
    note: str | None = None,
    transfer_group_id: str | None = None,
) -> dict:
    payload = {
        "tenant_id": tenant_id,
        "part_id": part_id,
        "location_id": location_id,
        "transaction_type": transaction_type,
        "quantity_delta": quantity_delta,
        "resulting_quantity": resulting_quantity,
        "user_id": user_id,
        "work_order_id": work_order_id,
        "note": note,
        "transfer_group_id": transfer_group_id,
    }
    result = supabase.table("engineering_part_transactions").insert(payload).execute()
    return result.data[0] if result.data else payload


def ensure_sufficient_stock(items: list[tuple[str, str, float]], tenant_id: str) -> None:
    """Pre-flight check for a batch consumption (e.g. closing a work order):
    raises 409 before any state changes if any part lacks enough on hand,
    so a completion never leaves a work order transitioned but only
    partially consumed."""
    for part_id, location_id, quantity in items:
        current = get_stock_quantity(part_id, location_id, tenant_id)
        if current < quantity:
            raise HTTPException(
                status_code=409,
                detail=f"Insufficient stock for part {part_id} at location {location_id}",
            )


def consume_part(
    *,
    part_id: str,
    location_id: str,
    quantity: float,
    tenant_id: str,
    user_id: str,
    work_order_id: str,
    note: str | None = None,
) -> dict:
    """Remove `quantity` of a part at a location and log it against a work order.
    Raises 409 (via adjust_stock) if there isn't enough on hand."""
    new_quantity = adjust_stock(part_id, location_id, tenant_id, -quantity, allow_negative=False)
    return record_transaction(
        tenant_id=tenant_id,
        part_id=part_id,
        location_id=location_id,
        transaction_type="remove",
        quantity_delta=-quantity,
        resulting_quantity=new_quantity,
        user_id=user_id,
        work_order_id=work_order_id,
        note=note or "Consumed closing work order",
    )

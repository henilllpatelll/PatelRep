"""Engineering spare-parts inventory (migration 102).

Scoped to engineering spares only — housekeeping_supply_pars (migration 071)
already owns par-level tracking for linen/chemical/amenity. This is the
InvenTree-derived (MIT) item/location/stock/transaction model for the
still-open gap: work_orders.parts_used was free text with nothing decrementing
stock behind it.
"""
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query

from core.database import supabase
from middleware.auth import CurrentUser, get_current_user, require_role
from models.requests import (
    CreateEngineeringPartLocationRequest,
    CreateEngineeringPartRequest,
    CreateEngineeringPartTransactionRequest,
    UpdateEngineeringPartRequest,
)
from services.inventory import adjust_stock, record_transaction, set_stock_count

router = APIRouter(prefix="/inventory", tags=["inventory"])

_MANAGER_ROLES = ("gm", "engineer", "chief_engineer")


def _ensure_tenant_row(table: str, row_id: str, hotel_id: str, label: str) -> None:
    result = (
        supabase.table(table)
        .select("id")
        .eq("id", row_id)
        .eq("tenant_id", hotel_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=404, detail=f"{label} not found")


def _get_part_or_404(part_id: str, hotel_id: str) -> dict:
    result = (
        supabase.table("engineering_parts")
        .select("*")
        .eq("id", part_id)
        .eq("tenant_id", hotel_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Part not found")
    return result.data


def _total_on_hand_map(part_ids: list[str], hotel_id: str) -> dict[str, float]:
    if not part_ids:
        return {}
    rows = (
        supabase.table("engineering_part_stock")
        .select("part_id, quantity")
        .eq("tenant_id", hotel_id)
        .in_("part_id", part_ids)
        .execute()
    )
    totals: dict[str, float] = {}
    for row in (rows.data or []):
        totals[row["part_id"]] = totals.get(row["part_id"], 0.0) + float(row.get("quantity") or 0)
    return totals


# ---------------------------------------------------------------------------
# Locations
# ---------------------------------------------------------------------------

@router.post("/locations")
async def create_location(
    request: CreateEngineeringPartLocationRequest,
    current_user: CurrentUser = Depends(require_role(*_MANAGER_ROLES)),
):
    if request.parent_id:
        _ensure_tenant_row(
            "engineering_part_locations", request.parent_id, current_user.hotel_id, "Parent location"
        )
    payload = {"tenant_id": current_user.hotel_id, **request.model_dump()}
    result = supabase.table("engineering_part_locations").insert(payload).execute()
    return {"data": result.data[0] if result.data else None}


@router.get("/locations")
async def list_locations(current_user: CurrentUser = Depends(get_current_user)):
    result = (
        supabase.table("engineering_part_locations")
        .select("*")
        .eq("tenant_id", current_user.hotel_id)
        .order("name")
        .execute()
    )
    return {"data": result.data or []}


# ---------------------------------------------------------------------------
# Parts
# ---------------------------------------------------------------------------

@router.post("/parts")
async def create_part(
    request: CreateEngineeringPartRequest,
    current_user: CurrentUser = Depends(require_role(*_MANAGER_ROLES)),
):
    if request.default_location_id:
        _ensure_tenant_row(
            "engineering_part_locations", request.default_location_id, current_user.hotel_id, "Location"
        )
    payload = {"tenant_id": current_user.hotel_id, **request.model_dump()}
    result = supabase.table("engineering_parts").insert(payload).execute()
    return {"data": result.data[0] if result.data else None}


@router.get("/parts")
async def list_parts(
    low_stock_only: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
):
    parts = (
        supabase.table("engineering_parts")
        .select("*")
        .eq("tenant_id", current_user.hotel_id)
        .eq("is_active", True)
        .order("name")
        .execute()
        .data
        or []
    )
    totals = _total_on_hand_map([p["id"] for p in parts], current_user.hotel_id)

    enriched = []
    for part in parts:
        total = totals.get(part["id"], 0.0)
        low_stock = total < float(part.get("minimum_stock") or 0)
        if low_stock_only and not low_stock:
            continue
        enriched.append({**part, "total_on_hand": total, "low_stock": low_stock})
    return {"data": enriched}


@router.get("/parts/{part_id}")
async def get_part(part_id: str, current_user: CurrentUser = Depends(get_current_user)):
    part = _get_part_or_404(part_id, current_user.hotel_id)
    stock = (
        supabase.table("engineering_part_stock")
        .select("*, engineering_part_locations(name)")
        .eq("part_id", part_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
        .data
        or []
    )
    total = sum(float(s.get("quantity") or 0) for s in stock)
    transactions = (
        supabase.table("engineering_part_transactions")
        .select("*")
        .eq("part_id", part_id)
        .eq("tenant_id", current_user.hotel_id)
        .order("created_at", desc=True)
        .limit(50)
        .execute()
        .data
        or []
    )
    return {
        "data": {
            **part,
            "total_on_hand": total,
            "low_stock": total < float(part.get("minimum_stock") or 0),
            "stock_by_location": stock,
            "recent_transactions": transactions,
        }
    }


@router.patch("/parts/{part_id}")
async def update_part(
    part_id: str,
    request: UpdateEngineeringPartRequest,
    current_user: CurrentUser = Depends(require_role(*_MANAGER_ROLES)),
):
    _get_part_or_404(part_id, current_user.hotel_id)
    payload = request.model_dump(exclude_none=True)
    if not payload:
        return {"data": _get_part_or_404(part_id, current_user.hotel_id)}
    if "default_location_id" in payload:
        _ensure_tenant_row(
            "engineering_part_locations", payload["default_location_id"], current_user.hotel_id, "Location"
        )
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = (
        supabase.table("engineering_parts")
        .update(payload)
        .eq("id", part_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    return {"data": result.data[0] if result.data else None}


# ---------------------------------------------------------------------------
# Transactions — add / remove / count / transfer
# ---------------------------------------------------------------------------

@router.post("/parts/{part_id}/transactions")
async def create_part_transaction(
    part_id: str,
    request: CreateEngineeringPartTransactionRequest,
    current_user: CurrentUser = Depends(require_role(*_MANAGER_ROLES)),
):
    _get_part_or_404(part_id, current_user.hotel_id)
    _ensure_tenant_row(
        "engineering_part_locations", request.location_id, current_user.hotel_id, "Location"
    )
    if request.work_order_id:
        _ensure_tenant_row("work_orders", request.work_order_id, current_user.hotel_id, "Work order")

    hotel_id = current_user.hotel_id

    if request.transaction_type == "transfer":
        if not request.destination_location_id:
            raise HTTPException(status_code=422, detail="transfer requires destination_location_id")
        if request.destination_location_id == request.location_id:
            raise HTTPException(
                status_code=422, detail="destination_location_id must differ from location_id"
            )
        if request.quantity <= 0:
            raise HTTPException(status_code=422, detail="transfer quantity must be greater than 0")
        _ensure_tenant_row(
            "engineering_part_locations", request.destination_location_id, hotel_id, "Destination location"
        )
        transfer_group_id = str(uuid4())
        source_new = adjust_stock(part_id, request.location_id, hotel_id, -request.quantity, allow_negative=False)
        dest_new = adjust_stock(part_id, request.destination_location_id, hotel_id, request.quantity)
        out_txn = record_transaction(
            tenant_id=hotel_id, part_id=part_id, location_id=request.location_id,
            transaction_type="transfer", quantity_delta=-request.quantity, resulting_quantity=source_new,
            user_id=current_user.user_id, work_order_id=request.work_order_id, note=request.note,
            transfer_group_id=transfer_group_id,
        )
        in_txn = record_transaction(
            tenant_id=hotel_id, part_id=part_id, location_id=request.destination_location_id,
            transaction_type="transfer", quantity_delta=request.quantity, resulting_quantity=dest_new,
            user_id=current_user.user_id, work_order_id=request.work_order_id, note=request.note,
            transfer_group_id=transfer_group_id,
        )
        return {"data": [out_txn, in_txn]}

    if request.transaction_type == "add":
        if request.quantity <= 0:
            raise HTTPException(status_code=422, detail="add quantity must be greater than 0")
        new_quantity = adjust_stock(part_id, request.location_id, hotel_id, request.quantity)
        delta = request.quantity
    elif request.transaction_type == "remove":
        if request.quantity <= 0:
            raise HTTPException(status_code=422, detail="remove quantity must be greater than 0")
        new_quantity = adjust_stock(part_id, request.location_id, hotel_id, -request.quantity, allow_negative=False)
        delta = -request.quantity
    else:  # count — quantity is the new absolute on-hand amount, not a delta
        new_quantity, delta = set_stock_count(part_id, request.location_id, hotel_id, request.quantity)

    txn = record_transaction(
        tenant_id=hotel_id, part_id=part_id, location_id=request.location_id,
        transaction_type=request.transaction_type, quantity_delta=delta, resulting_quantity=new_quantity,
        user_id=current_user.user_id, work_order_id=request.work_order_id, note=request.note,
    )
    return {"data": txn}

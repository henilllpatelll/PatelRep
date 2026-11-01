"""Hotel-wide Out-of-Order lifecycle API.

This router deliberately owns availability episodes, while ``room_status``
continues to answer only the room's current operational state.
"""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from core.database import supabase
from core.roles import LIMITED_ROOM_UNAVAILABILITY_VISIBILITY_ROLES
from middleware.auth import CurrentUser, get_current_user, require_role
from models.requests import (
    CreateRoomUnavailabilityRequest,
    ReleaseRoomUnavailabilityRequest,
    UpdateRoomUnavailabilityEtaRequest,
)
from services.engineering_notify import notify_managers, notify_users
from services.room_unavailability import is_past_eta, validate_eta_change

router = APIRouter(prefix="/room-unavailability", tags=["room-unavailability"])

MANAGE_ROLES = ("gm", "housekeeping_supervisor", "engineer")


def _serialize(period: dict, limited: bool = False) -> dict:
    payload = {**period, "is_past_eta": is_past_eta(period)}
    if limited:
        for key in ("details", "repair_remarks", "release_notes", "owner_id"):
            payload.pop(key, None)
    return payload


def _require_tenant_reference(table: str, row_id: str, hotel_id: str, label: str) -> None:
    result = supabase.table(table).select("id").eq("id", row_id).eq("tenant_id", hotel_id).maybe_single().execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail=f"{label} not found")


def _validate_references(request: CreateRoomUnavailabilityRequest, user: CurrentUser) -> None:
    _require_tenant_reference("rooms", str(request.room_id), user.hotel_id, "Room")
    if request.primary_work_order_id:
        _require_tenant_reference("work_orders", str(request.primary_work_order_id), user.hotel_id, "Work order")
    if request.owner_id:
        result = supabase.table("user_roles").select("id").eq("user_id", str(request.owner_id)).eq("tenant_id", user.hotel_id).eq("is_active", True).limit(1).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Responsible staff member not found")


def _notify_availability(user: CurrentUser, room_id: str, down: bool, work_order_id: str | None = None) -> None:
    """Tell the chief engineers (and the engineer on the linked repair) that a room went down or came back.
    Best effort: the availability change has already been committed."""
    try:
        room = supabase.table("rooms").select("room_number").eq("id", room_id).eq("tenant_id", user.hotel_id).maybe_single().execute()
        number = (room.data or {}).get("room_number") if room else None
        label = f"Room {number}" if number else "A room"
        title = "Room taken out of availability" if down else "Room back in availability"
        body = f"{label} is now out of order or service." if down else f"{label} was released."
        data = {"url": f"/(app)/room-status/{room_id}"}
        kwargs = dict(tenant_id=user.hotel_id, event="room_availability_changed", title=title, body=body, data=data,
                      subject_key="room_id", subject_id=room_id)
        notify_managers(exclude=user.user_id, **kwargs)
        if work_order_id:
            wo = supabase.table("work_orders").select("assigned_to").eq("id", work_order_id).eq("tenant_id", user.hotel_id).maybe_single().execute()
            assignee = (wo.data or {}).get("assigned_to") if wo else None
            if assignee:
                notify_users(user_ids=[assignee], exclude=user.user_id, **kwargs)
    except Exception:  # noqa: BLE001
        pass


@router.get("/reasons")
async def list_reasons(current_user: CurrentUser = Depends(get_current_user)):
    result = supabase.table("room_unavailability_reasons").select("id, code, label, external_code, is_active").eq("tenant_id", current_user.hotel_id).eq("is_active", True).order("sort_order").execute()
    return {"data": result.data or []}


@router.get("")
async def list_periods(
    status: Literal["ACTIVE", "RELEASED", "CANCELLED"] | None = Query(None),
    room_id: str | None = Query(None),
    returned_today: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
):
    query = supabase.table("room_unavailability_periods").select(
        "*, rooms(room_number, floor, room_types(name, code)), "
        "work_orders(id, work_order_number, title, priority, status, assigned_to, created_at)"
    ).eq("tenant_id", current_user.hotel_id).order("started_at", desc=True)
    if status:
        query = query.eq("status", status)
    if room_id:
        query = query.eq("room_id", room_id)
    if returned_today:
        start_of_today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        query = query.eq("status", "RELEASED").gte("actual_return_at", start_of_today.isoformat())
    rows = query.execute().data or []
    limited = current_user.role in LIMITED_ROOM_UNAVAILABILITY_VISIBILITY_ROLES
    return {"data": [_serialize(row, limited) for row in rows]}


@router.get("/summary")
async def get_summary(current_user: CurrentUser = Depends(get_current_user)):
    rows = supabase.table("room_unavailability_periods").select("id, expected_return_at, status").eq("tenant_id", current_user.hotel_id).eq("status", "ACTIVE").execute().data or []
    return {"data": {"active": len(rows), "past_eta": sum(is_past_eta(row) for row in rows)}}


@router.get("/room/{room_id}/active")
async def get_active_room_period(room_id: str, current_user: CurrentUser = Depends(get_current_user)):
    result = supabase.table("room_unavailability_periods").select(
        "*, rooms(room_number, floor, room_types(name, code)), "
        "work_orders(id, work_order_number, title, priority, status, assigned_to, created_at)"
    ).eq("tenant_id", current_user.hotel_id).eq("room_id", room_id).eq("status", "ACTIVE").maybe_single().execute()
    if not result or not result.data:
        return {"data": None}
    return {"data": _serialize(result.data, current_user.role in LIMITED_ROOM_UNAVAILABILITY_VISIBILITY_ROLES)}


@router.get("/{period_id}")
async def get_period(period_id: str, current_user: CurrentUser = Depends(get_current_user)):
    result = supabase.table("room_unavailability_periods").select(
        "*, rooms(room_number, floor, room_types(name, code)), "
        "work_orders(id, work_order_number, title, priority, status, assigned_to, created_at), room_unavailability_events(*)"
    ).eq("id", period_id).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Out-of-order period not found")
    return {"data": _serialize(result.data, current_user.role in LIMITED_ROOM_UNAVAILABILITY_VISIBILITY_ROLES)}


@router.post("")
async def create_period(
    request: CreateRoomUnavailabilityRequest,
    current_user: CurrentUser = Depends(require_role(*MANAGE_ROLES)),
):
    _validate_references(request, current_user)
    result = supabase.rpc("create_room_unavailability", {
        "p_room_id": str(request.room_id), "p_tenant_id": current_user.hotel_id,
        "p_reason_code": request.reason_code, "p_reason_label": request.reason_label,
        "p_type": request.type,
        "p_details": request.details, "p_expected_return_at": request.expected_return_at.isoformat(),
        "p_owner_id": str(request.owner_id) if request.owner_id else None,
        "p_work_order_id": str(request.primary_work_order_id) if request.primary_work_order_id else None,
        "p_created_by": current_user.user_id, "p_source": request.source,
    }).execute()
    _notify_availability(current_user, str(request.room_id), True, str(request.primary_work_order_id) if request.primary_work_order_id else None)
    return {"data": result.data}


@router.patch("/{period_id}/expected-return")
async def update_expected_return(
    period_id: str, request: UpdateRoomUnavailabilityEtaRequest,
    current_user: CurrentUser = Depends(require_role(*MANAGE_ROLES)),
):
    existing = supabase.table("room_unavailability_periods").select("expected_return_at, status").eq("id", period_id).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    period = (existing.data if existing else None) or None
    if not period:
        raise HTTPException(status_code=404, detail="Out-of-order period not found")
    if period["status"] != "ACTIVE":
        raise HTTPException(status_code=409, detail="Only an active period can be updated")
    current_eta = datetime.fromisoformat(period["expected_return_at"].replace("Z", "+00:00")) if period.get("expected_return_at") else None
    validate_eta_change(current_eta, request.expected_return_at, request.note)
    result = supabase.rpc("update_room_unavailability_eta", {
        "p_period_id": period_id, "p_tenant_id": current_user.hotel_id,
        "p_expected_return_at": request.expected_return_at.isoformat(), "p_actor_id": current_user.user_id,
        "p_note": request.note,
    }).execute()
    return {"data": result.data}


@router.post("/{period_id}/release")
async def release_period(
    period_id: str, request: ReleaseRoomUnavailabilityRequest,
    current_user: CurrentUser = Depends(require_role(*MANAGE_ROLES)),
):
    period = supabase.table("room_unavailability_periods").select("room_id, primary_work_order_id").eq("id", period_id).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    result = supabase.rpc("release_room_unavailability", {
        "p_period_id": period_id, "p_tenant_id": current_user.hotel_id,
        "p_released_by": current_user.user_id, "p_release_notes": request.release_notes,
        "p_source": request.source,
    }).execute()
    if period and period.data:
        _notify_availability(current_user, str(period.data["room_id"]), False, period.data.get("primary_work_order_id"))
    return {"data": result.data}

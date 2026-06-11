import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from middleware.auth import require_role, CurrentUser
from models.requests import EndShiftRequest, ShiftBreakRequest, StartShiftRequest
from core.database import supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/shifts", tags=["shifts"])

SHIFT_ROLES = ("housekeeper", "housekeeping_supervisor")


def _get_open_shift(hotel_id: str, user_id: str) -> dict | None:
    result = (
        supabase.table("hk_shift_sessions")
        .select("*")
        .eq("tenant_id", hotel_id)
        .eq("user_id", user_id)
        .neq("status", "ended")
        .order("started_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# GET /shifts/current
# ---------------------------------------------------------------------------

@router.get("/current")
async def get_current_shift(
    current_user: CurrentUser = Depends(require_role(*SHIFT_ROLES)),
):
    return {"data": _get_open_shift(current_user.hotel_id, current_user.user_id)}


# ---------------------------------------------------------------------------
# POST /shifts/start  (idempotent — id is client-generated)
# ---------------------------------------------------------------------------

@router.post("/start")
async def start_shift(
    request: StartShiftRequest,
    current_user: CurrentUser = Depends(require_role(*SHIFT_ROLES)),
):
    shift_id = str(request.id)
    existing = (
        supabase.table("hk_shift_sessions")
        .select("*")
        .eq("id", shift_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        return {"data": existing.data}

    open_shift = _get_open_shift(current_user.hotel_id, current_user.user_id)
    if open_shift:
        return {"data": open_shift}

    result = supabase.table("hk_shift_sessions").insert({
        "id": shift_id,
        "tenant_id": current_user.hotel_id,
        "user_id": current_user.user_id,
        "started_at": request.started_at.isoformat(),
        "status": "active",
    }).execute()
    rows = result.data or []
    return {"data": rows[0] if rows else None}


# ---------------------------------------------------------------------------
# POST /shifts/break  {action: start | end}
# ---------------------------------------------------------------------------

@router.post("/break")
async def toggle_break(
    request: ShiftBreakRequest,
    current_user: CurrentUser = Depends(require_role(*SHIFT_ROLES)),
):
    shift = _get_open_shift(current_user.hotel_id, current_user.user_id)
    if not shift:
        raise HTTPException(status_code=404, detail="No active shift")

    now = datetime.now(timezone.utc)
    if request.action == "start":
        if shift["status"] == "on_break":
            return {"data": shift}  # idempotent
        update_payload = {"status": "on_break", "on_break_since": now.isoformat()}
    else:
        if shift["status"] != "on_break":
            return {"data": shift}  # idempotent
        accrued = 0
        if shift.get("on_break_since"):
            try:
                since = datetime.fromisoformat(str(shift["on_break_since"]).replace("Z", "+00:00"))
                accrued = max(0, int((now - since).total_seconds()))
            except (ValueError, TypeError):
                accrued = 0
        update_payload = {
            "status": "active",
            "on_break_since": None,
            "break_seconds": int(shift.get("break_seconds") or 0) + accrued,
        }

    result = (
        supabase.table("hk_shift_sessions")
        .update(update_payload)
        .eq("id", shift["id"])
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    rows = result.data or []
    return {"data": rows[0] if rows else {**shift, **update_payload}}


# ---------------------------------------------------------------------------
# POST /shifts/end
# ---------------------------------------------------------------------------

@router.post("/end")
async def end_shift(
    request: EndShiftRequest,
    current_user: CurrentUser = Depends(require_role(*SHIFT_ROLES)),
):
    shift = _get_open_shift(current_user.hotel_id, current_user.user_id)
    if not shift:
        return {"data": None}  # idempotent — already ended

    break_seconds = int(shift.get("break_seconds") or 0)
    if shift["status"] == "on_break" and shift.get("on_break_since"):
        try:
            since = datetime.fromisoformat(str(shift["on_break_since"]).replace("Z", "+00:00"))
            break_seconds += max(0, int((request.ended_at - since).total_seconds()))
        except (ValueError, TypeError):
            pass

    result = (
        supabase.table("hk_shift_sessions")
        .update({
            "status": "ended",
            "ended_at": request.ended_at.isoformat(),
            "on_break_since": None,
            "break_seconds": break_seconds,
        })
        .eq("id", shift["id"])
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    rows = result.data or []
    return {"data": rows[0] if rows else None}


# ---------------------------------------------------------------------------
# GET /shifts/history  (last 7 shifts — profile screen)
# ---------------------------------------------------------------------------

@router.get("/history")
async def get_shift_history(
    current_user: CurrentUser = Depends(require_role(*SHIFT_ROLES)),
):
    result = (
        supabase.table("hk_shift_sessions")
        .select("*")
        .eq("tenant_id", current_user.hotel_id)
        .eq("user_id", current_user.user_id)
        .eq("status", "ended")
        .order("started_at", desc=True)
        .limit(7)
        .execute()
    )
    return {"data": result.data or []}

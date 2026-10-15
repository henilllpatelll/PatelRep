import logging
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from middleware.auth import require_role, CurrentUser
from models.requests import EndShiftRequest, ShiftBreakRequest, StartShiftRequest
from core.database import supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/shifts", tags=["shifts"])

SHIFT_ROLES = ("housekeeper", "housekeeping_supervisor")
ASSIGNMENT_SUPERVISOR_ROLES = ("gm", "housekeeping_supervisor")

# Re-read attempts when a concurrent write changes the shift between read and update.
_END_ATTEMPTS = 3


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


def _get_last_ended_shift(hotel_id: str, user_id: str) -> dict | None:
    result = (
        supabase.table("hk_shift_sessions")
        .select("*")
        .eq("tenant_id", hotel_id)
        .eq("user_id", user_id)
        .eq("status", "ended")
        .order("ended_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    return rows[0] if rows else None


def _parse_ts(value) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# GET /shifts/current
# ---------------------------------------------------------------------------

@router.get("/current")
async def get_current_shift(
    current_user: CurrentUser = Depends(require_role(*SHIFT_ROLES)),
):
    """
    The caller's open shift (``data``), or null when none is open.

    ``meta.last_ended`` carries the caller's most recently ended shift whenever
    ``data`` is null, so a client can tell "never clocked in" from "already
    clocked out" and never has to start a shift just to find out. ``data`` keeps
    its original shape for existing consumers.
    """
    shift = _get_open_shift(current_user.hotel_id, current_user.user_id)
    if shift:
        return {"data": shift, "meta": {"last_ended": None}}
    return {
        "data": None,
        "meta": {"last_ended": _get_last_ended_shift(current_user.hotel_id, current_user.user_id)},
    }


# ---------------------------------------------------------------------------
# GET /shifts/roster  (supervisor-facing: today's shift status per housekeeper)
# ---------------------------------------------------------------------------

@router.get("/roster")
async def get_shift_roster(
    roster_date: Optional[date] = Query(None, alias="date"),
    current_user: CurrentUser = Depends(require_role(*ASSIGNMENT_SUPERVISOR_ROLES)),
):
    """
    Latest hk_shift_sessions row per housekeeper for the given date (default
    today), for the Assign Rooms workspace's staff availability display.
    This table is otherwise only read/written by the housekeeper's own
    self-service clock in/break/end above — this is its first supervisor-
    facing, hotel-wide read.
    """
    target_date = roster_date or datetime.now(timezone.utc).date()
    day_start = f"{target_date.isoformat()}T00:00:00+00:00"
    day_end = f"{target_date.isoformat()}T23:59:59.999999+00:00"

    result = (
        supabase.table("hk_shift_sessions")
        .select("user_id, status, started_at, on_break_since, break_seconds")
        .eq("tenant_id", current_user.hotel_id)
        .gte("started_at", day_start)
        .lte("started_at", day_end)
        .order("started_at", desc=True)
        .execute()
    )

    latest_by_user: dict[str, dict] = {}
    for row in result.data or []:
        uid = row.get("user_id")
        if uid and uid not in latest_by_user:
            latest_by_user[uid] = row

    return {"data": list(latest_by_user.values())}


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
        .eq("user_id", current_user.user_id)
        .neq("status", "ended")  # a break must never reopen a shift that was just clocked out
        .execute()
    )
    rows = result.data or []
    # No row: the shift ended (or changed) underneath us. Say so; the client re-reads the truth.
    return {"data": rows[0] if rows else None}


# ---------------------------------------------------------------------------
# POST /shifts/end
# ---------------------------------------------------------------------------

@router.post("/end")
async def end_shift(
    request: EndShiftRequest,
    current_user: CurrentUser = Depends(require_role(*SHIFT_ROLES)),
):
    # A skewed device clock must never produce a shift that ends before it began.
    requested_end = request.ended_at if request.ended_at.tzinfo else request.ended_at.replace(tzinfo=timezone.utc)

    # Compare-and-swap: the update only lands while the row is still exactly as it was
    # read. A concurrent end (another tap, another device) or a break toggle makes it
    # match nothing; we then re-read and either finish against the fresh row or report
    # the idempotent no-op. An already-ended shift is never rewritten.
    for _ in range(_END_ATTEMPTS):
        shift = _get_open_shift(current_user.hotel_id, current_user.user_id)
        if not shift:
            return {"data": None}  # idempotent — already ended
        if request.shift_id and request.shift_id != shift["id"]:
            # The caller meant a shift that is no longer the open one (ended elsewhere, a
            # new one started since). Do not end the person's other shift by accident.
            return {"data": None}

        ended_at = requested_end
        started_at = _parse_ts(shift.get("started_at"))
        if started_at and ended_at < started_at:
            ended_at = started_at

        break_seconds = int(shift.get("break_seconds") or 0)
        if shift["status"] == "on_break" and shift.get("on_break_since"):
            since = _parse_ts(shift["on_break_since"])
            if since:
                break_seconds += max(0, int((ended_at - since).total_seconds()))

        query = (
            supabase.table("hk_shift_sessions")
            .update({
                "status": "ended",
                "ended_at": ended_at.isoformat(),
                "on_break_since": None,
                "break_seconds": break_seconds,
            })
            .eq("id", shift["id"])
            .eq("tenant_id", current_user.hotel_id)
            .eq("user_id", current_user.user_id)
            .eq("status", shift["status"])
        )
        # Guard on the raw stored values (a null counter is distinct from 0 to the database).
        for column in ("break_seconds", "on_break_since"):
            query = query.eq(column, shift[column]) if shift.get(column) is not None else query.is_(column, "null")
        rows = query.execute().data or []
        if rows:
            return {"data": rows[0]}
    return {"data": None}


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

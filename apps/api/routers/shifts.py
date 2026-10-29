import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from dateutil import tz
from fastapi import APIRouter, Depends, HTTPException, Query

from middleware.auth import require_role, CurrentUser
from models.requests import EndShiftRequest, ShiftBreakRequest, StartShiftRequest
from core.database import supabase
from core.timezones import safe_gettz
from services.scheduling import MAX_PLAUSIBLE_OPEN_SHIFT

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/shifts", tags=["shifts"])

SHIFT_ROLES = ("housekeeper", "housekeeping_supervisor")
ASSIGNMENT_SUPERVISOR_ROLES = ("gm", "housekeeping_supervisor")

# Re-read attempts when a concurrent write changes the shift between read and update.
_END_ATTEMPTS = 3

# How far back a still-open shift is carried into a later roster day (an overnight shift). Mirrors the
# mobile app's MAX_PLAUSIBLE_OPEN_SHIFT_MS: an open shift older than this was almost certainly never closed out.
OPEN_SHIFT_CARRY_OVER = MAX_PLAUSIBLE_OPEN_SHIFT


def _hotel_zone(hotel_id: str):
    """
    The hotel's timezone (tenants.timezone, default America/Chicago like the rest of housekeeping), or None
    when the hotel cannot be read at all -- callers then keep the legacy UTC day rather than guess.
    """
    try:
        result = supabase.table("tenants").select("timezone").eq("id", hotel_id).maybe_single().execute()
        row = result.data if result else None
    except Exception:
        logger.warning("shifts roster: could not read hotel timezone for hotel_id=%s; using the UTC day", hotel_id)
        return None
    if not row:
        return None
    return safe_gettz(row.get("timezone") or "America/Chicago") or tz.gettz("America/Chicago")


def roster_window(target_date: date, zone) -> tuple[str, str]:
    """
    [local midnight of target_date, local midnight of the next day) as UTC ISO strings. `zone=None` is the
    legacy behaviour: the UTC calendar day. Computed on wall-clock time, so a DST change moves the UTC
    boundary instead of producing a 23- or 25-hour error.
    """
    tzinfo = zone if zone is not None else timezone.utc
    start = datetime.combine(target_date, time.min, tzinfo=tzinfo).astimezone(timezone.utc)
    end = datetime.combine(target_date + timedelta(days=1), time.min, tzinfo=tzinfo).astimezone(timezone.utc)
    return start.isoformat(), end.isoformat()


def load_roster(hotel_id: str, target_date: date, zone) -> list[dict]:
    """
    Latest hk_shift_sessions row per person for the hotel-local `target_date` (the read behind GET /shifts/roster,
    shared with the team schedule so attendance has exactly one interpretation). Raises on a failed read: callers
    decide whether that means "unknown" or an error.
    """
    day_start, day_end = roster_window(target_date, zone)
    columns = "user_id, status, started_at, on_break_since, break_seconds"

    result = (
        supabase.table("hk_shift_sessions")
        .select(columns)
        .eq("tenant_id", hotel_id)
        .gte("started_at", day_start)
        .lt("started_at", day_end)
        .order("started_at", desc=True)
        .execute()
    )
    rows = list(result.data or [])

    # An overnight shift that began before the day window and is STILL OPEN belongs to this roster too: the
    # person is working right now. Only meaningful for a hotel-local window (a legacy UTC window keeps its
    # original behaviour), and bounded so a shift that was never closed out cannot linger indefinitely.
    if zone is not None:
        lookback = (_parse_ts(day_start) - OPEN_SHIFT_CARRY_OVER).isoformat()
        carried = (
            supabase.table("hk_shift_sessions")
            .select(columns)
            .eq("tenant_id", hotel_id)
            .neq("status", "ended")
            .gte("started_at", lookback)
            .lt("started_at", day_start)
            .order("started_at", desc=True)
            .execute()
        )
        rows.extend(carried.data or [])
        floor = datetime.min.replace(tzinfo=timezone.utc)
        rows.sort(key=lambda row: _parse_ts(row.get("started_at")) or floor, reverse=True)

    latest_by_user: dict[str, dict] = {}
    for row in rows:
        uid = row.get("user_id")
        if uid and uid not in latest_by_user:
            latest_by_user[uid] = row

    return list(latest_by_user.values())


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

    "The given date" is the HOTEL's local calendar day (tenants.timezone), not
    the UTC day: `started_at` is stored in UTC, so a UTC window dropped any
    shift started after local ~19:00 (Chicago) from that evening's roster.
    A shift that began before the window and is still open (an overnight
    shift, up to OPEN_SHIFT_CARRY_OVER old) is carried into the day it is
    still running on. If the hotel's timezone cannot be read the original UTC
    day is used unchanged.
    """
    zone = _hotel_zone(current_user.hotel_id)
    if roster_date is not None:
        target_date = roster_date
    elif zone is not None:
        target_date = datetime.now(timezone.utc).astimezone(zone).date()
    else:
        target_date = datetime.now(timezone.utc).date()
    return {"data": load_roster(current_user.hotel_id, target_date, zone)}


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

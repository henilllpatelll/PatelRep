import asyncio
import logging
import httpx
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File, Form
from typing import Optional
from datetime import date, datetime, time, timedelta, timezone
from dateutil import tz
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import CreateAssignmentsRequest, SubmitInspectionRequest
from core.database import supabase
from services.housekeeping_assignments import effective_room_status, room_status_for_clean_type
from services.opera_pdf import parse_hk_details, parse_task_sheet

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/housekeeping", tags=["housekeeping"])

CLEAN_TYPE_LABELS = {
    "DEP": "Departure Clean",
    "FULL": "Full Linen Change",
    "LIGHT": "Light Service",
}
TASK_SHEET_CLEAN_TYPE_NOTE_PREFIX = "task_sheet_clean_type="
STAYOVER_OVERRIDE_NOTE = "stayover_override"
STANDARD_INSPECTION_TEMPLATE_ITEMS = [
    ("Bathroom", "Bathroom clean and sanitized", True),
    ("Bathroom", "Towels fresh and folded", True),
    ("Sleeping Area", "Bed made, linens fresh", True),
    ("Sleeping Area", "Pillows properly arranged", False),
    ("General", "Floors clean and vacuumed", True),
    ("General", "Amenities restocked", True),
]

HOTEL_ACTIVITY_TIMEZONE = tz.gettz("America/Chicago") or timezone(timedelta(hours=-6))


def _is_missing_clean_type_column_error(exc: Exception) -> bool:
    err = str(exc)
    return ("42703" in err or "PGRST204" in err) and "clean_type" in err


def _without_clean_type(payload: dict) -> dict:
    return {key: value for key, value in payload.items() if key != "clean_type"}


def _execute_room_status_clean_type_write(payload: dict, build_query):
    try:
        return build_query(payload).execute()
    except Exception as exc:
        if "clean_type" in payload and _is_missing_clean_type_column_error(exc):
            logger.warning("room_status.clean_type column missing; retrying room_status write without clean_type")
            return build_query(_without_clean_type(payload)).execute()
        raise


def _ensure_tenant_row(table: str, row_id: str, hotel_id: str, label: str) -> None:
    result = supabase.table(table)\
        .select("id")\
        .eq("id", row_id)\
        .eq("tenant_id", hotel_id)\
        .maybe_single()\
        .execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail=f"{label} not found")


def _ensure_housekeeper(user_id: str, hotel_id: str) -> None:
    result = supabase.table("user_roles")\
        .select("id")\
        .eq("user_id", user_id)\
        .eq("tenant_id", hotel_id)\
        .eq("role", "housekeeper")\
        .eq("is_active", True)\
        .limit(1)\
        .execute()
    if result.data:
        return
    # Fallback for staff added before user_roles was fully populated — verify
    # hotel membership via user_profiles instead of raising 404.
    profile = supabase.table("user_profiles")\
        .select("id")\
        .eq("id", user_id)\
        .eq("tenant_id", hotel_id)\
        .maybe_single()\
        .execute()
    if not profile or not profile.data:
        raise HTTPException(status_code=404, detail="Housekeeper not found")


def _clean_type_payload(clean_type: str | None) -> dict:
    if not clean_type:
        return {"clean_type": None, "clean_type_label": None}
    return {
        "clean_type": clean_type,
        "clean_type_label": CLEAN_TYPE_LABELS.get(clean_type, clean_type),
    }


def _task_sheet_clean_type_note(clean_type: str) -> str:
    return f"{TASK_SHEET_CLEAN_TYPE_NOTE_PREFIX}{clean_type}"


def _insert_standard_inspection_items(template_id: str, tenant_id: str) -> list[dict]:
    items_data = [
        {
            "template_id": template_id,
            "tenant_id": tenant_id,
            "section": section,
            "description": description,
            "is_required": is_required,
            "sort_order": idx,
        }
        for idx, (section, description, is_required) in enumerate(
            STANDARD_INSPECTION_TEMPLATE_ITEMS,
            start=1,
        )
    ]
    items = supabase.table("inspection_template_items").insert(items_data).execute()
    return items.data or []


def _create_standard_inspection_template(tenant_id: str) -> dict:
    tmpl = (
        supabase.table("inspection_templates")
        .insert({
            "tenant_id": tenant_id,
            "name": "Standard Room Inspection",
            "room_type_id": None,
            "is_default": True,
            "is_active": True,
        })
        .execute()
    )
    template = tmpl.data[0]
    return {
        **template,
        "items": _insert_standard_inspection_items(template["id"], tenant_id),
    }


def _clean_type_from_task_sheet_note(note: str | None) -> str | None:
    if not note or not note.startswith(TASK_SHEET_CLEAN_TYPE_NOTE_PREFIX):
        return None
    clean_type = note.removeprefix(TASK_SHEET_CLEAN_TYPE_NOTE_PREFIX).strip().upper()
    return clean_type if clean_type in CLEAN_TYPE_LABELS else None


def _activity_day_window_utc(activity_date: date) -> tuple[str, str]:
    local_start = datetime.combine(activity_date, time.min, tzinfo=HOTEL_ACTIVITY_TIMEZONE)
    local_end = local_start + timedelta(days=1)
    return (
        local_start.astimezone(timezone.utc).isoformat(),
        local_end.astimezone(timezone.utc).isoformat(),
    )


def _clear_import_history_markers(hotel_id: str, assignment_date: str) -> None:
    try:
        activity_date = date.fromisoformat(assignment_date)
    except ValueError:
        logger.warning("Invalid assignment_date on import marker cleanup: %s", assignment_date)
        return

    activity_start, activity_end = _activity_day_window_utc(activity_date)
    marker_queries = (
        lambda: supabase.table("room_status_history")
        .delete()
        .eq("tenant_id", hotel_id)
        .gte("created_at", activity_start)
        .lt("created_at", activity_end)
        .like("notes", f"{TASK_SHEET_CLEAN_TYPE_NOTE_PREFIX}%"),
        lambda: supabase.table("room_status_history")
        .delete()
        .eq("tenant_id", hotel_id)
        .gte("created_at", activity_start)
        .lt("created_at", activity_end)
        .eq("notes", STAYOVER_OVERRIDE_NOTE),
    )

    for build_query in marker_queries:
        build_query().execute()


def _attach_task_sheet_clean_types(rows: list[dict], hotel_id: str, activity_date: date) -> list[dict]:
    room_ids = [row.get("room_id") for row in rows if row.get("room_id")]
    if not room_ids:
        return rows

    activity_start, activity_end = _activity_day_window_utc(activity_date)
    history_result = (
        supabase.table("room_status_history")
        .select("room_id, notes, created_at")
        .eq("tenant_id", hotel_id)
        .in_("room_id", room_ids)
        .gte("created_at", activity_start)
        .lt("created_at", activity_end)
        .order("created_at", desc=True)
        .limit(max(len(room_ids) * 4, 50))
        .execute()
    )

    stayover_rooms: set[str] = set()
    imported_clean_type_by_room: dict[str, str] = {}
    for history_row in history_result.data or []:
        room_id = history_row.get("room_id")
        if not room_id:
            continue
        notes = history_row.get("notes") or ""
        if notes == STAYOVER_OVERRIDE_NOTE:
            stayover_rooms.add(room_id)
            continue
        if room_id in stayover_rooms or room_id in imported_clean_type_by_room:
            continue
        clean_type = _clean_type_from_task_sheet_note(notes)
        if clean_type:
            imported_clean_type_by_room[room_id] = clean_type

    for row in rows:
        room_id = row.get("room_id")
        if room_id in stayover_rooms:
            row["clean_type"] = None
            row.pop("clean_type_label", None)
            continue
        # Checked-out rooms already have their status/clean_type set by the checkout
        # endpoint (DEP). Task-sheet imports from earlier today must not override them.
        if row.get("actual_checkout_at"):
            continue
        history_ct = imported_clean_type_by_room.get(room_id)
        clean_type = history_ct or row.get("clean_type")
        if not clean_type:
            continue
        row["clean_type"] = clean_type
        row["clean_type_label"] = CLEAN_TYPE_LABELS.get(clean_type, clean_type)
        row["status"] = effective_room_status(row.get("status"), clean_type, row.get("fo_status"))

    return rows


def _attach_room_activity(rows: list[dict], hotel_id: str, activity_date: date) -> list[dict]:
    room_ids = [row.get("room_id") for row in rows if row.get("room_id")]
    if not room_ids:
        return rows

    activity_start, activity_end = _activity_day_window_utc(activity_date)

    latest_note_by_room: dict[str, dict] = {}
    note_result = (
        supabase.table("room_status_history")
        .select("room_id, notes, from_status, to_status, changed_by, change_source, created_at")
        .eq("tenant_id", hotel_id)
        .in_("room_id", room_ids)
        .gte("created_at", activity_start)
        .lt("created_at", activity_end)
        .order("created_at", desc=True)
        .limit(max(len(room_ids) * 4, 50))
        .execute()
    )
    for note in note_result.data or []:
        room_id = note.get("room_id")
        note_text = (note.get("notes") or "").strip()
        from_status = note.get("from_status")
        to_status = note.get("to_status")
        is_task_sheet_marker = _clean_type_from_task_sheet_note(note_text) is not None
        is_staff_note = (
            bool(note.get("changed_by"))
            and note.get("change_source", "app") == "app"
            and bool(from_status)
            and from_status == to_status
        )
        if is_task_sheet_marker:
            continue
        if room_id and note_text and is_staff_note and room_id not in latest_note_by_room:
            latest_note_by_room[room_id] = note

    open_work_order_by_room: dict[str, dict] = {}
    work_order_result = (
        supabase.table("work_orders")
        .select("id, room_id, work_order_number, title, priority, status, created_at")
        .eq("tenant_id", hotel_id)
        .in_("room_id", room_ids)
        .in_("status", ["open", "in_progress", "on_hold"])
        .order("created_at", desc=True)
        .limit(max(len(room_ids) * 2, 50))
        .execute()
    )
    for work_order in work_order_result.data or []:
        room_id = work_order.get("room_id")
        if room_id and room_id not in open_work_order_by_room:
            open_work_order_by_room[room_id] = work_order

    for row in rows:
        room_id = row.get("room_id")
        note = latest_note_by_room.get(room_id)
        work_order = open_work_order_by_room.get(room_id)
        row["latest_note"] = (note.get("notes") or "").strip() if note else None
        row["latest_note_at"] = note.get("created_at") if note else None
        row["open_work_order_id"] = work_order.get("id") if work_order else None
        row["open_work_order_number"] = work_order.get("work_order_number") if work_order else None
        row["open_work_order_title"] = work_order.get("title") if work_order else None
        row["open_work_order_priority"] = work_order.get("priority") if work_order else None
        row["open_work_order_status"] = work_order.get("status") if work_order else None
    return rows


def _has_task_sheet_clean_type_marker(
    room_id: str | None,
    hotel_id: str,
    assignment_date: str | None,
    clean_type: str | None,
) -> bool:
    if not room_id or not assignment_date or not clean_type:
        return False
    try:
        target_date = date.fromisoformat(assignment_date)
    except ValueError:
        return False

    activity_start, activity_end = _activity_day_window_utc(target_date)
    history_result = (
        supabase.table("room_status_history")
        .select("notes")
        .eq("tenant_id", hotel_id)
        .eq("room_id", room_id)
        .gte("created_at", activity_start)
        .lt("created_at", activity_end)
        .execute()
    )
    return any(
        _clean_type_from_task_sheet_note(row.get("notes")) == clean_type
        for row in (history_result.data or [])
    )


# ---------------------------------------------------------------------------
# GET /housekeeping/board
# ---------------------------------------------------------------------------

@router.get("/board")
async def get_housekeeping_board(
    board_date: Optional[date] = Query(None, alias="date"),
    shift_id: Optional[str] = Query(None),
    include_predictions: bool = Query(True),
    current_user: CurrentUser = Depends(get_current_user),
):
    target_date = board_date or date.today()

    # Fetch room_status rows with joined room/room_type data.
    # supabase-py does not support ordering by joined table columns directly,
    # so we sort in Python after fetching.
    result = (
        supabase.table("room_status")
        .select(
            "*, "
            "rooms!inner(id, room_number, floor, building, "
            "room_types(name, code, base_clean_minutes))"
        )
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )

    rows = result.data or []

    # Sort by floor then room_number in Python
    def _sort_key(r: dict) -> tuple:
        room = r.get("rooms") or {}
        floor = room.get("floor") or 0
        room_number = room.get("room_number") or ""
        return (floor, room_number)

    rows.sort(key=_sort_key)

    assignment_query = (
        supabase.table("room_assignments")
        .select("id, room_id, assigned_to, shift_id, assignment_date, clean_type")
        .eq("tenant_id", current_user.hotel_id)
        .eq("assignment_date", target_date.isoformat())
    )
    if shift_id:
        assignment_query = assignment_query.eq("shift_id", shift_id)

    assignment_result = assignment_query.execute()
    assignment_map = {
        assignment["room_id"]: assignment
        for assignment in (assignment_result.data or [])
        if assignment.get("room_id")
    }

    # Optionally attach predictions
    predictions = []
    if include_predictions:
        pred_result = (
            supabase.table("room_readiness_predictions")
            .select("*")
            .eq("tenant_id", current_user.hotel_id)
            .execute()
        )
        predictions = pred_result.data or []

    pred_map = {p["room_id"]: p for p in predictions}

    rooms_with_predictions = []
    for room in rows:
        assignment = assignment_map.get(room.get("room_id"))
        # When a room is checked out, room_status.clean_type (DEP) takes precedence
        # over any assignment clean_type (FULL/LIGHT), so the board shows Vacant Dirty
        # rather than incorrectly keeping the room as PICKUP.
        if room.get("actual_checkout_at"):
            clean_type = room.get("clean_type") or (assignment or {}).get("clean_type")
        else:
            clean_type = (assignment or {}).get("clean_type") or room.get("clean_type")
        rooms_with_predictions.append({
            **room,
            "status": effective_room_status(room.get("status"), clean_type, room.get("fo_status")),
            "assigned_to": assignment.get("assigned_to") if assignment else None,
            "assignment_id": assignment.get("id") if assignment else None,
            "assignment_date": assignment.get("assignment_date") if assignment else target_date.isoformat(),
            "assignment_shift_id": assignment.get("shift_id") if assignment else None,
            **_clean_type_payload(clean_type),
            "prediction": pred_map.get(room.get("room_id")),
        })

    _attach_task_sheet_clean_types(rooms_with_predictions, current_user.hotel_id, target_date)
    _attach_room_activity(rooms_with_predictions, current_user.hotel_id, target_date)
    return {"data": rooms_with_predictions}


# ---------------------------------------------------------------------------
# GET /housekeeping/my-rooms
# ---------------------------------------------------------------------------

@router.get("/my-rooms")
async def get_my_rooms(
    assignment_date: Optional[date] = Query(None, alias="date"),
    current_user: CurrentUser = Depends(require_role("housekeeper")),
):
    # Accept client-supplied date (local hotel timezone) so Railway's UTC clock
    # doesn't cause a mismatch after 7 PM CST when date.today() rolls to tomorrow.
    today = assignment_date or date.today()
    assignments = (
        supabase.table("room_assignments")
        .select("id, room_id, assignment_date, clean_type")
        .eq("tenant_id", current_user.hotel_id)
        .eq("assigned_to", current_user.user_id)
        .eq("assignment_date", today.isoformat())
        .execute()
    )
    assignment_rows = assignments.data or []
    assignment_map = {
        a["room_id"]: a
        for a in assignment_rows
        if a.get("room_id")
    }
    room_ids = list(assignment_map.keys())
    if not room_ids:
        return {"data": []}

    # Return current status for all rooms assigned today (all statuses, not filtered)
    my_rooms_select = (
        "id, room_id, tenant_id, status, assigned_to, "
        "clean_type, vip_flag, checkin_time, checkout_time, actual_checkout_at, fo_status, "
        "risk_level, predicted_ready_at, "
        "rooms(id, room_number, floor, room_types(name, base_clean_minutes))"
    )
    try:
        result = (
            supabase.table("room_status")
            .select(my_rooms_select)
            .eq("tenant_id", current_user.hotel_id)
            .in_("room_id", room_ids)
            .execute()
        )
    except Exception as exc:
        if not _is_missing_clean_type_column_error(exc):
            raise
        logger.warning("room_status.clean_type column missing; retrying my-rooms select without clean_type")
        result = (
            supabase.table("room_status")
            .select(my_rooms_select.replace("clean_type, ", ""))
            .eq("tenant_id", current_user.hotel_id)
            .in_("room_id", room_ids)
            .execute()
        )
    rows = []
    for room in (result.data or []):
        assignment = assignment_map.get(room.get("room_id")) or {}
        clean_type = assignment.get("clean_type") or room.get("clean_type")
        nested_room = room.get("rooms") or {}
        rows.append({
            **room,
            "room_number": nested_room.get("room_number"),
            "floor": nested_room.get("floor"),
            "status": effective_room_status(room.get("status"), clean_type, room.get("fo_status")),
            "assignment_id": assignment.get("id"),
            "assignment_date": assignment.get("assignment_date"),
            **_clean_type_payload(clean_type),
        })
    _attach_task_sheet_clean_types(rows, current_user.hotel_id, today)
    _attach_room_activity(rows, current_user.hotel_id, today)
    return {"data": rows}


# ---------------------------------------------------------------------------
# GET /housekeeping/assignments
# ---------------------------------------------------------------------------

@router.get("/assignments")
async def get_assignments(
    assignment_date: Optional[date] = Query(None, alias="date"),
    shift_id: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Returns all room assignments for the given date, grouped by housekeeper.
    Includes per-housekeeper room count and completion stats.
    """
    target_date = assignment_date or date.today()

    # Fetch assignments for the date (and optionally shift)
    assign_query = (
        supabase.table("room_assignments")
        .select("id, room_id, assigned_to, shift_id, assignment_date, clean_type, rooms(room_number, room_types(name))")
        .eq("tenant_id", current_user.hotel_id)
        .eq("assignment_date", target_date.isoformat())
    )

    if shift_id:
        assign_query = assign_query.eq("shift_id", shift_id)

    assign_result = assign_query.execute()
    assignments = assign_result.data or []

    if not assignments:
        return {"data": []}

    # Fetch current room status for all assigned rooms in one query
    room_ids = list({a["room_id"] for a in assignments if a.get("room_id")})
    status_result = (
        supabase.table("room_status")
        .select("room_id, status")
        .in_("room_id", room_ids)
        .execute()
    )
    status_map = {r["room_id"]: r["status"] for r in (status_result.data or [])}

    # Group by housekeeper
    grouped: dict[str, dict] = {}
    for a in assignments:
        hk_id = a.get("assigned_to")

        if hk_id not in grouped:
            grouped[hk_id] = {
                "housekeeper_id": hk_id,
                "name": hk_id or "Unknown",
                "rooms_assigned": 0,
                "rooms_done": 0,
                "in_progress": 0,
                "rooms": [],
            }

        room_info = a.get("rooms") or {}
        rt_info = room_info.get("room_types") or {}
        status = effective_room_status(status_map.get(a.get("room_id"), ""), a.get("clean_type"))

        grouped[hk_id]["rooms"].append({
            "assignment_id": a.get("id"),
            "room_id": a.get("room_id"),
            "room_number": room_info.get("room_number", ""),
            "status": status,
            "room_type": rt_info.get("name", ""),
            **_clean_type_payload(a.get("clean_type")),
        })

        grouped[hk_id]["rooms_assigned"] += 1
        if status in ("CLEAN", "INSPECTED"):
            grouped[hk_id]["rooms_done"] += 1
        elif status == "IN_PROGRESS":
            grouped[hk_id]["in_progress"] += 1

    # Fetch housekeeper names
    if grouped:
        hk_ids = list(grouped.keys())
        profiles_result = (
            supabase.table("user_profiles")
            .select("id, full_name, preferred_name")
            .in_("id", hk_ids)
            .execute()
        )
        for p in (profiles_result.data or []):
            uid = p["id"]
            if uid in grouped:
                grouped[uid]["name"] = p.get("preferred_name") or p.get("full_name") or uid

    return {"data": list(grouped.values())}


# ---------------------------------------------------------------------------
# POST /housekeeping/assignments
# ---------------------------------------------------------------------------

async def _send_assignment_push(housekeeper_id: str, room_number: str, room_id: str = "") -> None:
    """Fire-and-forget push notification to housekeeper on room assignment."""
    try:
        profile = supabase.table("user_profiles") \
            .select("expo_push_token") \
            .eq("id", housekeeper_id) \
            .maybe_single().execute()
        token = (profile.data or {}).get("expo_push_token")
        if not token:
            logger.debug("No push token for housekeeper=%s, skipping push", housekeeper_id)
            return
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post("https://exp.host/--/api/v2/push/send", json={
                "to": token,
                "title": "Room Assigned",
                "body": f"Room {room_number} has been assigned to you",
                "data": {
                    "type": "room_assignment",
                    "room_number": room_number,
                    "url": f"/(app)/my-rooms/{room_id}" if room_id else "/(app)/my-rooms",
                },
            })
    except Exception:
        pass  # Never block assignment response on push failure


@router.post("/assignments")
async def create_assignments(
    request: CreateAssignmentsRequest,
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
    if request.shift_id:
        _ensure_tenant_row("shifts", str(request.shift_id), current_user.hotel_id, "Shift")
    for assignment in request.assignments:
        _ensure_tenant_row("rooms", str(assignment.room_id), current_user.hotel_id, "Room")
        _ensure_housekeeper(str(assignment.housekeeper_id), current_user.hotel_id)

    # Preserve clean_type already set by PDF import; only overwrite if explicitly provided
    existing_clean = supabase.table("room_assignments")\
        .select("room_id, clean_type")\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("assignment_date", request.date.isoformat())\
        .in_("room_id", [str(a.room_id) for a in request.assignments])\
        .execute()
    existing_clean_map: dict[str, str | None] = {
        row["room_id"]: row.get("clean_type") for row in (existing_clean.data or [])
    }

    # Fallback: read clean_type + fo_status from room_status (set by task sheet import)
    # This handles the first save after import when no room_assignments row exists yet
    room_status_rows = supabase.table("room_status")\
        .select("room_id, clean_type, fo_status")\
        .eq("tenant_id", current_user.hotel_id)\
        .in_("room_id", [str(a.room_id) for a in request.assignments])\
        .execute()
    room_status_map: dict[str, dict] = {
        row["room_id"]: row for row in (room_status_rows.data or [])
    }

    def _resolve_clean_type(room_id: str, explicit: str | None) -> str | None:
        return (
            explicit
            or existing_clean_map.get(room_id)
            or (room_status_map.get(room_id) or {}).get("clean_type")
        )

    assignments_data = [
        {
            "tenant_id": current_user.hotel_id,
            "room_id": str(a.room_id),
            "assigned_to": str(a.housekeeper_id),
            "assigned_by": current_user.user_id,
            "shift_id": str(request.shift_id) if request.shift_id else None,
            "assignment_date": request.date.isoformat(),
            "clean_type": _resolve_clean_type(str(a.room_id), a.clean_type),
            "is_ai_suggested": request.is_ai_suggested,
        }
        for a in request.assignments
    ]

    try:
        result = supabase.table("room_assignments").upsert(
            assignments_data,
            on_conflict="room_id,assignment_date",
        ).execute()
    except Exception as e:
        err = str(e)
        if "23505" in err or "duplicate key" in err:
            raise HTTPException(
                status_code=409,
                detail="One or more rooms are already assigned for that date.",
            )
        raise HTTPException(status_code=500, detail="Failed to save assignments. Please try again.")

    # Mirror assigned_to on room_status for quick lookups and keep Opera
    # stayover task types in the Pickup lane.
    for a in request.assignments:
        clean_type = _resolve_clean_type(str(a.room_id), a.clean_type)
        if clean_type:
            fo_status = (room_status_map.get(str(a.room_id)) or {}).get("fo_status")
            room_status = room_status_for_clean_type(clean_type, fo_status)
            _execute_room_status_clean_type_write(
                {"assigned_to": str(a.housekeeper_id), "clean_type": clean_type},
                lambda payload, room_id=str(a.room_id): supabase.table("room_status")
                    .update(payload)
                    .eq("room_id", room_id)
                    .eq("tenant_id", current_user.hotel_id),
            )
            _execute_room_status_clean_type_write(
                {"status": room_status, "clean_type": clean_type},
                lambda payload, room_id=str(a.room_id): supabase.table("room_status")
                    .update(payload)
                    .eq("room_id", room_id)
                    .eq("tenant_id", current_user.hotel_id)
                    .in_("status", ["DIRTY", "PICKUP", "OCCUPIED"]),
            )
        else:
            supabase.table("room_status")\
                .update({"assigned_to": str(a.housekeeper_id)})\
                .eq("room_id", str(a.room_id))\
                .eq("tenant_id", current_user.hotel_id)\
                .execute()

    # Fire-and-forget push notifications (never block the HTTP response)
    for a in request.assignments:
        room_info = supabase.table("rooms") \
            .select("room_number") \
            .eq("id", str(a.room_id)) \
            .eq("tenant_id", current_user.hotel_id) \
            .maybe_single().execute()
        room_number = (room_info.data or {}).get("room_number", "")
        asyncio.create_task(_send_assignment_push(str(a.housekeeper_id), room_number, str(a.room_id)))

    return {"data": result.data}


# ---------------------------------------------------------------------------
# DELETE /housekeeping/assignments/{assignment_id}
# ---------------------------------------------------------------------------

@router.delete("/assignments/{assignment_id}")
async def delete_assignment(
    assignment_id: str,
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
    assignment_result = (
        supabase.table("room_assignments")
        .select("id, room_id, assigned_to, assignment_date, clean_type")
        .eq("id", assignment_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    assignment = assignment_result.data if assignment_result else None
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    delete_result = (
        supabase.table("room_assignments")
        .delete()
        .eq("id", assignment_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    if not (delete_result.data if delete_result else None):
        raise HTTPException(status_code=404, detail="Assignment not found")

    status_result = (
        supabase.table("room_status")
        .select("room_id, status, fo_status, clean_type")
        .eq("room_id", assignment.get("room_id"))
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    room_status = status_result.data if status_result else None
    assignment_clean_type = assignment.get("clean_type")
    clear_manual_clean_type = (
        room_status
        and assignment_clean_type
        and room_status.get("clean_type") == assignment_clean_type
        and not _has_task_sheet_clean_type_marker(
            assignment.get("room_id"),
            current_user.hotel_id,
            assignment.get("assignment_date"),
            assignment_clean_type,
        )
    )

    status_update = {"assigned_to": None}
    if clear_manual_clean_type:
        status_update["clean_type"] = None
        if room_status.get("status") in {"DIRTY", "PICKUP", "OCCUPIED"}:
            status_update["status"] = "OCCUPIED" if room_status.get("fo_status") == "OCC" else "DIRTY"

    supabase.table("room_status")\
        .update(status_update)\
        .eq("room_id", assignment.get("room_id"))\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("assigned_to", assignment.get("assigned_to"))\
        .execute()

    return {"data": {"success": True, "deleted_id": assignment_id}}


# ---------------------------------------------------------------------------
# POST /housekeeping/ai-suggest-assignments
# ---------------------------------------------------------------------------

@router.post("/ai-suggest-assignments")
async def suggest_assignments(
    board_date: Optional[date] = Query(None, alias="date"),
    shift_id: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
    """
    Rule-based workload-balancing assignment suggester.

    Algorithm:
    1. Fetch all DIRTY / IN_PROGRESS / PICKUP rooms needing assignment.
    2. Fetch active housekeepers on shift (shift_assignments for work_date=today).
    3. Sort rooms: VIP first, then earliest checkin_time, then floor.
    4. Distribute round-robin weighted by room base_clean_minutes so total
       cleaning minutes are balanced across housekeepers.
    5. Return suggestions (not committed to DB).
    """
    target_date = board_date or date.today()

    # --- 1. Rooms needing work ---
    rooms_result = (
        supabase.table("room_status")
        .select(
            "room_id, status, vip_flag, checkin_time, "
            "rooms(id, room_number, floor, room_types(name, base_clean_minutes))"
        )
        .eq("tenant_id", current_user.hotel_id)
        .in_("status", ["DIRTY", "IN_PROGRESS", "PICKUP"])
        .execute()
    )
    rooms = rooms_result.data or []

    if not rooms:
        return {
            "data": {
                "suggestions": [],
                "message": "No rooms currently need assignment",
            }
        }

    # --- 2. Active housekeepers on shift ---
    hk_query = (
        supabase.table("shift_assignments")
        .select(
            "user_id"
        )
        .eq("tenant_id", current_user.hotel_id)
        .eq("work_date", target_date.isoformat())
    )
    if shift_id:
        hk_query = hk_query.eq("shift_id", shift_id)

    hk_result = hk_query.execute()
    hk_rows = hk_result.data or []

    # Only include housekeepers (role filter would require joining user_profiles.role)
    # We keep all shift-assigned staff and let the supervisor adjust.
    housekeepers = []
    seen_user_ids: set[str] = set()
    for row in hk_rows:
        uid = row.get("user_id")
        if uid and uid not in seen_user_ids:
            seen_user_ids.add(uid)
            housekeepers.append({
                "id": uid,
                "full_name": "",
                "preferred_name": "",
                "assigned_rooms": [],
                "assigned_minutes": 0,
            })

    if not housekeepers:
        return {
            "data": {
                "suggestions": [],
                "message": "No housekeepers found on shift for this date",
            }
        }

    # --- 3. Sort rooms by priority ---
    def _room_sort_key(r: dict) -> tuple:
        # VIP first (is_vip=True sorts before False in ascending — negate)
        vip_sort = 0 if r.get("vip_flag") else 1
        # Earliest checkin_time first; None goes last
        checkin = r.get("checkin_time") or "9999-99-99T99:99:99"
        floor = (r.get("rooms") or {}).get("floor") or 999
        return (vip_sort, checkin, floor)

    rooms.sort(key=_room_sort_key)

    # --- 4. Weighted round-robin distribution ---
    for room in rooms:
        room_info = room.get("rooms") or {}
        rt_info = room_info.get("room_types") or {}
        base_minutes: int = rt_info.get("base_clean_minutes") or 30

        # Pick housekeeper with the fewest assigned minutes so far
        target_hk = min(housekeepers, key=lambda h: h["assigned_minutes"])

        target_hk["assigned_rooms"].append({
            "room_id": room.get("room_id"),
            "room_number": room_info.get("room_number", ""),
            "status": room.get("status"),
            "room_type": rt_info.get("name", ""),
            "base_clean_minutes": base_minutes,
            "is_vip": room.get("vip_flag", False),
        })
        target_hk["assigned_minutes"] += base_minutes

    # --- 5. Build response (strip internal tracking fields) ---
    suggestions = [
        {
            "housekeeper": {
                "id": hk["id"],
                "full_name": hk["full_name"],
                "preferred_name": hk["preferred_name"],
            },
            "rooms": hk["assigned_rooms"],
            "room_count": len(hk["assigned_rooms"]),
            "total_minutes": hk["assigned_minutes"],
        }
        for hk in housekeepers
    ]

    return {
        "data": {
            "suggestions": suggestions,
            "date": target_date.isoformat(),
            "shift_id": shift_id,
            "message": (
                f"Suggested assignments for {len(rooms)} room(s) "
                f"across {len(housekeepers)} housekeeper(s)"
            ),
        }
    }


# ---------------------------------------------------------------------------
# GET /housekeeping/predictions
# ---------------------------------------------------------------------------

@router.get("/predictions")
async def get_predictions(
    current_user: CurrentUser = Depends(get_current_user),
):
    result = (
        supabase.table("room_readiness_predictions")
        .select("*, rooms(room_number, floor)")
        .eq("tenant_id", current_user.hotel_id)
        .in_("risk_level", ["HIGH", "MEDIUM"])
        .order("risk_level")
        .execute()
    )

    high_risk = [r for r in (result.data or []) if r.get("risk_level") == "HIGH"]
    return {
        "data": {
            "at_risk_count": len(high_risk),
            "rooms": result.data or [],
        }
    }


# ---------------------------------------------------------------------------
# GET /housekeeping/ready-for-inspection
# ---------------------------------------------------------------------------

@router.get("/ready-for-inspection")
async def list_ready_for_inspection(
    board_date: Optional[date] = Query(None, alias="date"),
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
    """Return rooms currently in CLEAN status — waiting for supervisor inspection."""
    today = board_date or date.today()

    result = (
        supabase.table("room_status")
        .select("room_id, status, updated_at, rooms!inner(room_number, floor)")
        .eq("tenant_id", current_user.hotel_id)
        .eq("status", "CLEAN")
        .execute()
    )
    clean_rooms = result.data or []

    if not clean_rooms:
        return {"data": []}

    room_ids = [r["room_id"] for r in clean_rooms]

    # Resolve assigned_to UUIDs from today's assignments
    assignments_res = (
        supabase.table("room_assignments")
        .select("room_id, assigned_to, clean_type")
        .eq("tenant_id", current_user.hotel_id)
        .eq("assignment_date", today.isoformat())
        .in_("room_id", room_ids)
        .execute()
    )
    assigned_map: dict[str, str] = {
        a["room_id"]: a["assigned_to"]
        for a in (assignments_res.data or [])
        if a.get("assigned_to")
    }
    clean_type_map: dict[str, str | None] = {
        a["room_id"]: a.get("clean_type")
        for a in (assignments_res.data or [])
    }

    # Resolve housekeeper names
    hk_ids = list(set(assigned_map.values()))
    name_map: dict[str, str] = {}
    if hk_ids:
        profiles = (
            supabase.table("user_profiles")
            .select("id, preferred_name, full_name")
            .in_("id", hk_ids)
            .eq("tenant_id", current_user.hotel_id)
            .execute()
        )
        for p in (profiles.data or []):
            name_map[p["id"]] = p.get("preferred_name") or p.get("full_name") or p["id"]

    output = []
    for room in clean_rooms:
        room_info = room.get("rooms") or {}
        assigned_to = assigned_map.get(room["room_id"])
        output.append({
            "room_id": room["room_id"],
            "room_number": room_info.get("room_number", ""),
            "floor": room_info.get("floor"),
            "cleaned_by": name_map.get(assigned_to, "") if assigned_to else "",
            "cleaned_at": room.get("updated_at"),
            "housekeeper_id": assigned_to,
            "clean_type": clean_type_map.get(room["room_id"]),
        })

    output.sort(key=lambda r: (r["floor"] or 0, r["room_number"]))
    return {"data": output}


# ---------------------------------------------------------------------------
# POST /housekeeping/inspections
# ---------------------------------------------------------------------------

@router.post("/inspections")
async def submit_inspection(
    request: SubmitInspectionRequest,
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
    # Capture current status before the DB trigger changes it
    current_rs = (
        supabase.table("room_status")
        .select("status")
        .eq("room_id", str(request.room_id))
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    from_status = (current_rs.data or {}).get("status", "CLEAN")
    to_status = "DIRTY" if request.overall_result == "failed" else "INSPECTED"

    inspection = supabase.table("inspections").insert({
        "tenant_id": current_user.hotel_id,
        "room_id": str(request.room_id),
        "template_id": str(request.template_id) if request.template_id else None,
        "inspected_by": current_user.user_id,
        "overall_result": request.overall_result,
        "notes": request.notes,
    }).execute()

    inspection_id = inspection.data[0]["id"]

    # Insert per-item results
    results_data = [
        {
            "inspection_id": inspection_id,
            "template_item_id": str(item.template_item_id) if item.template_item_id else None,
            "tenant_id": current_user.hotel_id,
            "result": item.result,
            "note": item.note,
        }
        for item in request.items
    ]
    if results_data:
        supabase.table("inspection_results").insert(results_data).execute()

    # room_status is updated by the on_inspection_complete DB trigger (migration 017).
    # History must be written explicitly — the status-history trigger was dropped in migration 024.
    supabase.table("room_status_history").insert({
        "room_id": str(request.room_id),
        "tenant_id": current_user.hotel_id,
        "from_status": from_status,
        "to_status": to_status,
        "changed_by": current_user.user_id,
        "change_source": "app",
        "notes": request.notes,
    }).execute()

    return {"data": inspection.data[0]}


# ---------------------------------------------------------------------------
# GET /housekeeping/inspections
# ---------------------------------------------------------------------------

@router.get("/inspections")
async def list_inspections(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    room_id: Optional[str] = Query(None),
    result: Optional[str] = Query(None),  # passed|failed|conditional
    current_user: CurrentUser = Depends(get_current_user),
):
    """List inspection records with optional filters."""
    today = date.today()
    from_date = date_from or today
    to_date = date_to or today

    query = (
        supabase.table("inspections")
        .select(
            "id, overall_result, notes, completed_at, inspected_by, "
            "rooms!inner(room_number)"
        )
        .eq("tenant_id", current_user.hotel_id)
        .gte("completed_at", f"{from_date.isoformat()}T00:00:00+00:00")
        .lte("completed_at", f"{to_date.isoformat()}T23:59:59+00:00")
        .order("completed_at", desc=True)
    )

    if room_id:
        query = query.eq("room_id", room_id)
    if result:
        query = query.eq("overall_result", result)

    res = query.execute()
    rows = res.data or []

    # Resolve inspector UUIDs → names in one query
    inspector_ids = list({r["inspected_by"] for r in rows if r.get("inspected_by")})
    name_map: dict[str, str] = {}
    if inspector_ids:
        profiles = (
            supabase.table("user_profiles")
            .select("id, preferred_name, full_name")
            .in_("id", inspector_ids)
            .eq("tenant_id", current_user.hotel_id)
            .execute()
        )
        for p in (profiles.data or []):
            name_map[p["id"]] = p.get("preferred_name") or p.get("full_name") or p["id"]

    # Flatten for convenience
    output = []
    for row in rows:
        room = row.get("rooms") or {}
        inspector_id = row.get("inspected_by", "")
        inspector_fallback = inspector_id[:8] if inspector_id else "Unknown"
        output.append({
            "id": row.get("id"),
            "room_number": room.get("room_number", ""),
            "inspector_name": name_map.get(inspector_id, inspector_fallback),
            "overall_result": row.get("overall_result"),
            "notes": row.get("notes"),
            "completed_at": row.get("completed_at"),
        })

    return {"data": output}


# ---------------------------------------------------------------------------
# GET /housekeeping/inspections/templates
# ---------------------------------------------------------------------------

@router.get("/inspections/templates")
async def list_inspection_templates(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get all active inspection checklist templates for this hotel, including their items."""
    templates = (
        supabase.table("inspection_templates")
        .select("id, name, room_type_id, is_default, is_active")
        .eq("tenant_id", current_user.hotel_id)
        .eq("is_active", True)
        .order("is_default", desc=True)
        .execute()
    )

    template_rows = templates.data or []
    if not template_rows:
        return {"data": [_create_standard_inspection_template(current_user.hotel_id)]}

    result = []
    for tmpl in template_rows:
        items = (
            supabase.table("inspection_template_items")
            .select("id, section, description, is_required, sort_order")
            .eq("template_id", tmpl["id"])
            .eq("tenant_id", current_user.hotel_id)
            .order("sort_order")
            .execute()
        )
        item_rows = items.data or []
        if not item_rows and tmpl.get("is_default"):
            item_rows = _insert_standard_inspection_items(tmpl["id"], current_user.hotel_id)
        result.append({**tmpl, "items": item_rows})

    if not any(template.get("items") for template in result):
        result.insert(0, _create_standard_inspection_template(current_user.hotel_id))

    return {"data": result}


# ---------------------------------------------------------------------------
# POST /housekeeping/inspections/templates
# ---------------------------------------------------------------------------

@router.post("/inspections/templates")
async def create_inspection_template(
    body: dict,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Create a new inspection checklist template with items."""
    name = body.get("name", "Custom Inspection")
    items = body.get("items", [])

    tmpl = supabase.table("inspection_templates").insert({
        "tenant_id": current_user.hotel_id,
        "name": name,
        "room_type_id": body.get("room_type_id"),
        "is_default": body.get("is_default", False),
        "is_active": True,
    }).execute()

    template_id = tmpl.data[0]["id"]

    if items:
        items_data = [
            {
                "template_id": template_id,
                "tenant_id": current_user.hotel_id,
                "section": item.get("section", "General"),
                "description": item.get("description", ""),
                "is_required": item.get("is_required", True),
                "sort_order": item.get("sort_order", idx),
            }
            for idx, item in enumerate(items)
        ]
        supabase.table("inspection_template_items").insert(items_data).execute()

    return {"data": tmpl.data[0]}


# ---------------------------------------------------------------------------
# PATCH /housekeeping/inspections/templates/{template_id}
# ---------------------------------------------------------------------------

@router.patch("/inspections/templates/{template_id}")
async def update_inspection_template(
    template_id: str,
    body: dict,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Update an inspection template name/default flag and replace its items."""
    update_data: dict = {}
    if "name" in body:
        update_data["name"] = body["name"]
    if "is_default" in body:
        update_data["is_default"] = body["is_default"]
    if "is_active" in body:
        update_data["is_active"] = body["is_active"]

    if update_data:
        supabase.table("inspection_templates") \
            .update(update_data) \
            .eq("id", template_id) \
            .eq("tenant_id", current_user.hotel_id) \
            .execute()

    if "items" in body:
        supabase.table("inspection_template_items") \
            .delete() \
            .eq("template_id", template_id) \
            .eq("tenant_id", current_user.hotel_id) \
            .execute()
        items = body["items"] or []
        if items:
            items_data = [
                {
                    "template_id": template_id,
                    "tenant_id": current_user.hotel_id,
                    "section": item.get("section", "General"),
                    "description": item.get("description", ""),
                    "is_required": item.get("is_required", True),
                    "sort_order": idx,
                }
                for idx, item in enumerate(items)
            ]
            supabase.table("inspection_template_items").insert(items_data).execute()

    tmpl = supabase.table("inspection_templates") \
        .select("id, name, room_type_id, is_default, is_active") \
        .eq("id", template_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .maybe_single().execute()

    if not tmpl.data:
        raise HTTPException(status_code=404, detail="Template not found")

    item_result = supabase.table("inspection_template_items") \
        .select("id, section, description, is_required, sort_order") \
        .eq("template_id", template_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .order("sort_order") \
        .execute()

    return {"data": {**tmpl.data, "items": item_result.data or []}}


# ---------------------------------------------------------------------------
# DELETE /housekeeping/inspections/templates/{template_id}
# ---------------------------------------------------------------------------

@router.delete("/inspections/templates/{template_id}", status_code=204)
async def delete_inspection_template(
    template_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Delete an inspection template and all its items."""
    supabase.table("inspection_template_items") \
        .delete() \
        .eq("template_id", template_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    supabase.table("inspection_templates") \
        .delete() \
        .eq("id", template_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()


# ---------------------------------------------------------------------------
# POST /housekeeping/import/hk-details
# ---------------------------------------------------------------------------

@router.post("/import/hk-details")
async def import_hk_details(
    file: UploadFile = File(...),
    assignment_date: str = Form(...),
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """
    Import an Opera HK Details PDF to reset room_status for the day.
    Overrides any current room status including IN_PROGRESS.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    pdf_bytes = await file.read()
    rows, warnings = parse_hk_details(pdf_bytes)

    if not rows:
        raise HTTPException(status_code=422, detail="No room data found in PDF — check file format")

    _clear_import_history_markers(current_user.hotel_id, assignment_date)

    # Fetch all rooms for this hotel to resolve room_number → room_id
    rooms_res = supabase.table("rooms") \
        .select("id, room_number") \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    room_map: dict[str, str] = {r["room_number"]: r["id"] for r in (rooms_res.data or [])}

    applied = 0
    skipped_active = 0
    not_found: list[str] = []

    for row in rows:
        room_id = room_map.get(row.room_number)
        if not room_id:
            not_found.append(row.room_number)
            continue

        resolved_status = (
            "OCCUPIED"
            if row.our_status == "DIRTY" and row.fo_status == "OCC"
            else row.our_status
        )

        update_data: dict = {
            "room_id": room_id,
            "tenant_id": current_user.hotel_id,
            "status": resolved_status,
            "fo_status": row.fo_status,
            "actual_checkout_at": None,
            "checkout_time": None,
            "checkin_time": None,
            "clean_type": None,
            "guest_name": None,
            "vip_flag": False,
            "dnd_flag": False,
            "do_not_service": False,
            "notes": None,
        }

        _execute_room_status_clean_type_write(
            update_data,
            lambda payload: supabase.table("room_status").upsert(payload, on_conflict="room_id"),
        )
        applied += 1

    if not_found:
        warnings.append(f"Rooms not found in system: {', '.join(not_found[:20])}")

    return {
        "data": {
            "applied": applied,
            "skipped_active": skipped_active,
            "not_found": len(not_found),
            "total_parsed": len(rows),
            "warnings": warnings,
        }
    }


# ---------------------------------------------------------------------------
# POST /housekeeping/import/task-sheet
# ---------------------------------------------------------------------------

@router.post("/import/task-sheet")
async def import_task_sheet(
    file: UploadFile = File(...),
    assignment_date: str = Form(...),
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """
    Import an Opera Task Sheet PDF to set clean_type for rooms needing cleaning.
    Overrides any current room status including IN_PROGRESS.
    Sets DIRTY+OCC+Stayover rooms with FULL/LIGHT task to PICKUP status.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    pdf_bytes = await file.read()
    rows, warnings = parse_task_sheet(pdf_bytes)

    if not rows:
        raise HTTPException(status_code=422, detail="No room data found in PDF — check file format")

    # Purge generated same-day import markers so every Task Sheet import starts fresh.
    try:
        _clear_import_history_markers(current_user.hotel_id, assignment_date)
    except Exception:
        pass  # non-fatal — stale notes will be overwritten by new ones below

    # Fetch all rooms for this hotel
    rooms_res = supabase.table("rooms") \
        .select("id, room_number") \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    room_map: dict[str, str] = {r["room_number"]: r["id"] for r in (rooms_res.data or [])}

    applied = 0
    skipped_active = 0
    not_found: list[str] = []

    for row in rows:
        room_id = room_map.get(row.room_number)
        if not room_id:
            not_found.append(row.room_number)
            continue

        # Fetch current room status
        current = supabase.table("room_status") \
            .select("status, fo_status") \
            .eq("room_id", room_id) \
            .eq("tenant_id", current_user.hotel_id) \
            .maybe_single() \
            .execute()

        current_status = current.data.get("status") if current.data else None

        # Determine the new status based on Opera occupancy + reservation status.
        # DI + OCC + Stayover = PICKUP regardless of task column.
        # DEP stays OCCUPIED (guest still in room until actual checkout).
        new_status = current_status or "DIRTY"
        fo = row.fo_status or (current.data.get("fo_status") if current.data else None)
        res_lower = (row.reservation_status or "").lower()
        is_stayover_or_arrived = "stayover" in res_lower or "arrived" in res_lower

        if row.clean_type == "DEP":
            new_status = "OCCUPIED" if fo == "OCC" else "DIRTY"
        elif fo == "OCC" and is_stayover_or_arrived:
            new_status = "PICKUP"

        # Update clean_type on existing assignment if one exists; skip if not yet assigned
        if row.clean_type:
            supabase.table("room_assignments") \
                .update({"clean_type": row.clean_type}) \
                .eq("room_id", room_id) \
                .eq("assignment_date", assignment_date) \
                .eq("tenant_id", current_user.hotel_id) \
                .execute()

        # Update room_status with new status and fo_status
        status_update = {
            "room_id": room_id,
            "tenant_id": current_user.hotel_id,
            "status": new_status,
            "fo_status": fo,
            "actual_checkout_at": None,
            "checkout_time": None,
        }
        if row.clean_type:
            status_update["clean_type"] = row.clean_type

        _execute_room_status_clean_type_write(
            status_update,
            lambda payload: supabase.table("room_status").upsert(payload, on_conflict="room_id"),
        )

        history_notes = _task_sheet_clean_type_note(row.clean_type) if row.clean_type else None
        supabase.table("room_status_history").insert({
            "room_id": room_id,
            "tenant_id": current_user.hotel_id,
            "from_status": current_status,
            "to_status": new_status,
            "changed_by": current_user.user_id,
            "change_source": "system",
            **({"notes": history_notes} if history_notes else {}),
        }).execute()

        applied += 1

    if not_found:
        warnings.append(f"Rooms not found in system: {', '.join(not_found[:20])}")

    return {
        "data": {
            "applied": applied,
            "skipped_active": skipped_active,
            "not_found": len(not_found),
            "total_parsed": len(rows),
            "warnings": warnings,
        }
    }

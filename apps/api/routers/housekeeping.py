import asyncio
import logging
import httpx
from fastapi import APIRouter, Depends, Query, HTTPException
from typing import Optional
from datetime import date
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import CreateAssignmentsRequest, SubmitInspectionRequest
from core.database import supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/housekeeping", tags=["housekeeping"])


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

    rooms_with_predictions = [
        {**room, "prediction": pred_map.get(room.get("room_id"))}
        for room in rows
    ]

    return {"data": rooms_with_predictions}


# ---------------------------------------------------------------------------
# GET /housekeeping/my-rooms
# ---------------------------------------------------------------------------

@router.get("/my-rooms")
async def get_my_rooms(
    current_user: CurrentUser = Depends(require_role("housekeeper")),
):
    # Fetch today's assignments for this housekeeper from the assignments table
    # (room_status.assigned_to persists across days, so we scope by assignment_date)
    today = date.today()
    assignments = (
        supabase.table("room_assignments")
        .select("room_id")
        .eq("tenant_id", current_user.hotel_id)
        .eq("assigned_to", current_user.user_id)
        .eq("assignment_date", today.isoformat())
        .execute()
    )
    room_ids = [a["room_id"] for a in (assignments.data or [])]
    if not room_ids:
        return {"data": []}

    # Return current status for all rooms assigned today (all statuses, not filtered)
    result = (
        supabase.table("room_status")
        .select(
            "id, room_id, tenant_id, status, assigned_to, "
            "vip_flag, checkin_time, risk_level, predicted_ready_at, "
            "rooms(id, room_number, floor, room_types(name, base_clean_minutes))"
        )
        .eq("tenant_id", current_user.hotel_id)
        .in_("room_id", room_ids)
        .execute()
    )
    return {"data": result.data or []}


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
        .select("id, room_id, assigned_to, shift_id, assignment_date, rooms(room_number, room_types(name))")
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
        status = status_map.get(a.get("room_id"), "")

        grouped[hk_id]["rooms"].append({
            "room_id": a.get("room_id"),
            "room_number": room_info.get("room_number", ""),
            "status": status,
            "room_type": rt_info.get("name", ""),
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
    assignments_data = [
        {
            "tenant_id": current_user.hotel_id,
            "room_id": str(a.room_id),
            "assigned_to": str(a.housekeeper_id),
            "assigned_by": current_user.user_id,
            "shift_id": str(request.shift_id) if request.shift_id else None,
            "assignment_date": request.date.isoformat(),
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

    # Mirror assigned_to on room_status for quick lookups
    for a in request.assignments:
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
# POST /housekeeping/inspections
# ---------------------------------------------------------------------------

@router.post("/inspections")
async def submit_inspection(
    request: SubmitInspectionRequest,
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
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
    supabase.table("inspection_results").insert(results_data).execute()

    # room_status is updated by the on_inspection_complete DB trigger (migration 017).
    # History must be written explicitly — the status-history trigger was dropped in migration 024.
    supabase.table("room_status_history").insert({
        "room_id": str(request.room_id),
        "tenant_id": current_user.hotel_id,
        "from_status": "CLEAN",
        "to_status": "INSPECTED",
        "changed_by": current_user.user_id,
        "change_source": "inspection",
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
            .execute()
        )
        for p in (profiles.data or []):
            name_map[p["id"]] = p.get("preferred_name") or p.get("full_name") or p["id"]

    # Flatten for convenience
    output = []
    for row in rows:
        room = row.get("rooms") or {}
        inspector_id = row.get("inspected_by", "")
        output.append({
            "id": row.get("id"),
            "room_number": room.get("room_number", ""),
            "inspector_name": name_map.get(inspector_id, inspector_id),
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

    result = []
    for tmpl in (templates.data or []):
        items = (
            supabase.table("inspection_template_items")
            .select("id, section, description, is_required, sort_order")
            .eq("template_id", tmpl["id"])
            .eq("tenant_id", current_user.hotel_id)
            .order("sort_order")
            .execute()
        )
        result.append({**tmpl, "items": items.data or []})

    # If no templates exist, return a sensible default checklist
    if not result:
        result = [{
            "id": None,
            "name": "Standard Room Inspection",
            "room_type_id": None,
            "is_default": True,
            "is_active": True,
            "items": [
                {"id": None, "section": "Bathroom", "description": "Bathroom clean and sanitized", "is_required": True, "sort_order": 1},
                {"id": None, "section": "Bathroom", "description": "Towels fresh and folded", "is_required": True, "sort_order": 2},
                {"id": None, "section": "Sleeping Area", "description": "Bed made, linens fresh", "is_required": True, "sort_order": 3},
                {"id": None, "section": "Sleeping Area", "description": "Pillows properly arranged", "is_required": False, "sort_order": 4},
                {"id": None, "section": "General", "description": "Floors clean and vacuumed", "is_required": True, "sort_order": 5},
                {"id": None, "section": "General", "description": "Amenities restocked", "is_required": True, "sort_order": 6},
            ]
        }]

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

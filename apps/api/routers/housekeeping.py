from fastapi import APIRouter, Depends, Query, HTTPException
from typing import Optional
from datetime import date, datetime
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import CreateAssignmentsRequest, SubmitInspectionRequest
from core.database import supabase

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
    target_date = board_date or date.today()

    # Fetch room_status rows with joined room/room_type data.
    # supabase-py does not support ordering by joined table columns directly,
    # so we sort in Python after fetching.
    result = (
        supabase.table("room_status")
        .select(
            "*, "
            "rooms!inner(id, room_number, floor, building, "
            "room_types(name, code, base_clean_minutes)), "
            "user_profiles(preferred_name, full_name)"
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
    result = (
        supabase.table("room_status")
        .select("*, rooms(id, room_number, floor, room_types(name, base_clean_minutes))")
        .eq("tenant_id", current_user.hotel_id)
        .eq("assigned_to", current_user.user_id)
        .in_("status", ["DIRTY", "IN_PROGRESS", "PICKUP"])
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
        .select(
            "id, room_id, assigned_to, shift_id, assignment_date, "
            "user_profiles!room_assignments_assigned_to_fkey(id, full_name, preferred_name), "
            "room_status(status, rooms(room_number, room_types(name)))"
        )
        .eq("tenant_id", current_user.hotel_id)
        .eq("assignment_date", target_date.isoformat())
    )

    if shift_id:
        assign_query = assign_query.eq("shift_id", shift_id)

    assign_result = assign_query.execute()
    assignments = assign_result.data or []

    # Group by housekeeper
    grouped: dict[str, dict] = {}
    for a in assignments:
        hk_profile = a.get("user_profiles") or {}
        hk_id = a.get("assigned_to")

        if hk_id not in grouped:
            grouped[hk_id] = {
                "housekeeper": {
                    "id": hk_id,
                    "full_name": hk_profile.get("full_name", ""),
                    "preferred_name": hk_profile.get("preferred_name", ""),
                },
                "rooms": [],
                "room_count": 0,
                "completed_count": 0,
                "in_progress_count": 0,
            }

        rs = a.get("room_status") or {}
        room_info = rs.get("rooms") or {}
        rt_info = room_info.get("room_types") or {}
        status = rs.get("status", "")

        grouped[hk_id]["rooms"].append({
            "room_id": a.get("room_id"),
            "room_number": room_info.get("room_number", ""),
            "status": status,
            "room_type": rt_info.get("name", ""),
        })

        grouped[hk_id]["room_count"] += 1
        if status == "CLEAN":
            grouped[hk_id]["completed_count"] += 1
        elif status == "IN_PROGRESS":
            grouped[hk_id]["in_progress_count"] += 1

    return {"data": list(grouped.values())}


# ---------------------------------------------------------------------------
# POST /housekeeping/assignments
# ---------------------------------------------------------------------------

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
            "shift_id": str(request.shift_id),
            "assignment_date": request.date.isoformat(),
            "is_ai_suggested": request.is_ai_suggested,
        }
        for a in request.assignments
    ]

    result = supabase.table("room_assignments").upsert(assignments_data).execute()

    # Mirror assigned_to on room_status for quick lookups
    for a in request.assignments:
        supabase.table("room_status")\
            .update({"assigned_to": str(a.housekeeper_id)})\
            .eq("room_id", str(a.room_id))\
            .execute()

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
            "room_id, status, is_vip, checkin_time, "
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
            "user_id, "
            "user_profiles(id, full_name, preferred_name)"
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
            profile = row.get("user_profiles") or {}
            housekeepers.append({
                "id": uid,
                "full_name": profile.get("full_name", ""),
                "preferred_name": profile.get("preferred_name", ""),
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
        vip_sort = 0 if r.get("is_vip") else 1
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
            "is_vip": room.get("is_vip", False),
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
        "template_id": str(request.template_id),
        "inspected_by": current_user.user_id,
        "overall_result": request.overall_result,
        "notes": request.notes,
    }).execute()

    inspection_id = inspection.data[0]["id"]

    # Insert per-item results
    results_data = [
        {
            "inspection_id": inspection_id,
            "template_item_id": str(item.template_item_id),
            "tenant_id": current_user.hotel_id,
            "result": item.result,
            "note": item.note,
        }
        for item in request.items
    ]
    supabase.table("inspection_results").insert(results_data).execute()

    # Update room status based on inspection result (don't rely on DB trigger)
    if request.overall_result == "passed":
        supabase.table("room_status").update({
            "status": "INSPECTED",
            "last_inspected_at": datetime.utcnow().isoformat(),
            "last_inspected_by": current_user.user_id,
        }).eq("room_id", str(request.room_id)).eq("tenant_id", current_user.hotel_id).execute()

        supabase.table("room_status_history").insert({
            "room_id": str(request.room_id),
            "tenant_id": current_user.hotel_id,
            "from_status": "CLEAN",
            "to_status": "INSPECTED",
            "changed_by": current_user.user_id,
            "change_source": "app",
            "notes": f"Inspection passed: {request.notes}" if request.notes else "Inspection passed",
        }).execute()

    elif request.overall_result == "failed":
        supabase.table("room_status").update({
            "status": "DIRTY",
        }).eq("room_id", str(request.room_id)).eq("tenant_id", current_user.hotel_id).execute()

        supabase.table("room_status_history").insert({
            "room_id": str(request.room_id),
            "tenant_id": current_user.hotel_id,
            "from_status": "CLEAN",
            "to_status": "DIRTY",
            "changed_by": current_user.user_id,
            "change_source": "app",
            "notes": f"Inspection failed: {request.notes}" if request.notes else "Inspection failed",
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
            "id, overall_result, notes, completed_at, "
            "rooms!inner(room_number), "
            "user_profiles!inspections_inspected_by_fkey(full_name, preferred_name)"
        )
        .eq("tenant_id", current_user.hotel_id)
        .gte("completed_at", f"{from_date.isoformat()}T00:00:00")
        .lte("completed_at", f"{to_date.isoformat()}T23:59:59")
        .order("completed_at", desc=True)
    )

    if room_id:
        query = query.eq("room_id", room_id)
    if result:
        query = query.eq("overall_result", result)

    res = query.execute()
    rows = res.data or []

    # Flatten for convenience
    output = []
    for row in rows:
        room = row.get("rooms") or {}
        profile = row.get("user_profiles") or {}
        output.append({
            "id": row.get("id"),
            "room_number": room.get("room_number", ""),
            "inspector_name": profile.get("preferred_name") or profile.get("full_name", ""),
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

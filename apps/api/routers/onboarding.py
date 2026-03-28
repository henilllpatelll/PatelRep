import csv
import io
import pdfplumber
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from middleware.auth import require_role, get_current_user_no_hotel, CurrentUser
from models.requests import CopilotChatRequest
from core.database import supabase

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


# ---------------------------------------------------------------------------
# Shared room import logic (used by CSV and PDF endpoints)
# ---------------------------------------------------------------------------

def _import_rooms_batch(rooms_input: list[dict], hotel_id: str) -> dict:
    """
    Insert rooms + initial room_status rows for a hotel.
    Skips duplicates (same tenant + room_number).
    Returns { imported_count, skipped_count, errors }.
    """
    imported_count = 0
    skipped_count = 0
    errors: list[dict] = []

    for room_data in rooms_input:
        room_number = str(room_data.get("room_number", "")).strip()
        floor_raw = room_data.get("floor")
        room_type_code = str(room_data.get("room_type_code", "")).strip().upper()
        room_type_name = str(room_data.get("room_type_name", "")).strip() or None
        building = str(room_data.get("building", "")).strip() or None

        if not room_number:
            errors.append({"room_number": room_number, "reason": "room_number is required"})
            continue
        try:
            floor = int(float(floor_raw))
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail=f"Invalid floor value: {floor_raw!r}")

        if not room_type_code:
            errors.append({"room_number": room_number, "reason": "room_type_code is required"})
            continue

        # Resolve or create room_type
        rt_result = (
            supabase.table("room_types")
            .select("id")
            .eq("tenant_id", hotel_id)
            .eq("code", room_type_code)
            .limit(1)
            .execute()
        )
        if rt_result.data:
            room_type_id = rt_result.data[0]["id"]
        elif room_type_name:
            new_rt = supabase.table("room_types").insert({
                "tenant_id": hotel_id,
                "code": room_type_code,
                "name": room_type_name,
                "base_clean_minutes": 30,
            }).execute()
            if not new_rt.data:
                errors.append({"room_number": room_number, "reason": f"Failed to create room_type '{room_type_code}'"})
                continue
            room_type_id = new_rt.data[0]["id"]
        else:
            errors.append({
                "room_number": room_number,
                "reason": f"room_type_code '{room_type_code}' not found; provide room_type_name to create it",
            })
            continue

        # Duplicate check
        existing = (
            supabase.table("rooms")
            .select("id")
            .eq("tenant_id", hotel_id)
            .eq("room_number", room_number)
            .limit(1)
            .execute()
        )
        if existing.data:
            skipped_count += 1
            continue

        # Insert room
        payload: dict = {
            "tenant_id": hotel_id,
            "room_number": room_number,
            "floor": floor,
            "room_type_id": room_type_id,
        }
        if building:
            payload["building"] = building

        new_room = supabase.table("rooms").insert(payload).execute()
        if not new_room.data:
            errors.append({"room_number": room_number, "reason": "Database insert failed"})
            continue

        # Initial room_status row
        supabase.table("room_status").insert({
            "room_id": new_room.data[0]["id"],
            "tenant_id": hotel_id,
            "status": "DIRTY",
        }).execute()
        imported_count += 1

    return {"imported_count": imported_count, "skipped_count": skipped_count, "errors": errors}


def _normalize_header(h: str) -> str:
    """Lowercase, strip punctuation/spaces for fuzzy column matching."""
    return h.lower().replace(" ", "").replace(".", "").replace("_", "").replace("-", "") if h else ""


# Map of normalized header → field name
_ROOM_COL_MAP = {
    "room": "room_number",
    "roomno": "room_number",
    "roomnumber": "room_number",
    "rm": "room_number",
    "rmno": "room_number",
    "floor": "floor",
    "fl": "floor",
    "roomtype": "room_type_code",
    "rmtype": "room_type_code",
    "type": "room_type_code",
    "roomclass": "room_type_code",
    "class": "room_type_code",
    "roomtypecode": "room_type_code",
    "code": "room_type_code",
    "description": "room_type_name",
    "roomtypename": "room_type_name",
    "typename": "room_type_name",
    "name": "room_type_name",
    "building": "building",
    "bldg": "building",
    "bld": "building",
}


def _map_headers(raw_headers: list[str]) -> dict[int, str]:
    """Return {column_index: field_name} for recognized columns."""
    mapping: dict[int, str] = {}
    for i, h in enumerate(raw_headers):
        norm = _normalize_header(h or "")
        if norm in _ROOM_COL_MAP:
            field = _ROOM_COL_MAP[norm]
            if field not in mapping.values():  # first match wins
                mapping[i] = field
    return mapping

ONBOARDING_STEPS = [
    "hotel_profile",
    "rooms_imported",
    "staff_invited",
    "sop_uploaded",
]


@router.get("/status")
async def get_onboarding_status(
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Return the onboarding checklist status for the hotel."""
    hotel = supabase.table("tenants")\
        .select("name, room_count")\
        .eq("id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    room_count = supabase.table("rooms")\
        .select("id", count="exact")\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    staff_count = supabase.table("user_roles")\
        .select("id", count="exact")\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("is_active", True)\
        .execute()

    sop_count = supabase.table("sop_documents")\
        .select("id", count="exact")\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    completed_steps = []

    # Properly check hotel profile has required fields filled
    hotel_data = hotel.data or {}
    if hotel_data.get("name") and hotel_data.get("room_count"):
        completed_steps.append("hotel_profile")

    if (room_count.count or 0) > 0:
        completed_steps.append("rooms_imported")
    if (staff_count.count or 0) > 1:
        completed_steps.append("staff_invited")
    if (sop_count.count or 0) > 0:
        completed_steps.append("sop_uploaded")

    # Check Opera integration connected
    try:
        opera = supabase.table("opera_credentials")\
            .select("is_connected")\
            .eq("tenant_id", current_user.hotel_id)\
            .maybe_single()\
            .execute()
        if opera.data and opera.data.get("is_connected"):
            completed_steps.append("opera_connected")
    except Exception:
        pass  # opera_credentials row may not exist yet

    return {
        "data": {
            "completed_steps": completed_steps,
            "remaining_steps": [s for s in ONBOARDING_STEPS if s not in completed_steps],
            "is_complete": len(completed_steps) >= len(ONBOARDING_STEPS),
            "percent_complete": int(len(completed_steps) / len(ONBOARDING_STEPS) * 100),
        }
    }


@router.post("/rooms/import-csv")
async def import_rooms_csv(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Import rooms from a CSV file. Expected columns: room_number, floor, room_type_code, room_type_name."""
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    content = await file.read()
    text = content.decode("utf-8-sig", errors="replace")  # utf-8-sig handles Excel BOM
    reader = csv.DictReader(io.StringIO(text))

    rooms_input: list[dict] = []
    for row in reader:
        # Normalize header keys (strip whitespace, lowercase)
        normalized = {k.strip().lower(): v for k, v in row.items() if k}
        rooms_input.append({
            "room_number": normalized.get("room_number") or normalized.get("room") or "",
            "floor": normalized.get("floor") or normalized.get("fl") or "",
            "room_type_code": normalized.get("room_type_code") or normalized.get("room_type") or normalized.get("type") or "",
            "room_type_name": normalized.get("room_type_name") or normalized.get("description") or normalized.get("name") or "",
            "building": normalized.get("building") or normalized.get("bldg") or "",
        })

    if not rooms_input:
        raise HTTPException(status_code=400, detail="CSV file is empty or has no valid rows")

    result = _import_rooms_batch(rooms_input, current_user.hotel_id)
    return {"data": result}


@router.post("/rooms/import-pdf")
async def import_rooms_pdf(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """
    Import rooms from an Opera Cloud room list PDF.
    Detects table columns automatically (Room No., Floor, Room Type/Class, Description).
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a .pdf")

    content = await file.read()
    rooms_input: list[dict] = []
    parse_errors: list[str] = []

    try:
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page_num, page in enumerate(pdf.pages, start=1):
                tables = page.extract_tables()
                for table in tables:
                    if not table or len(table) < 2:
                        continue

                    # First row = headers
                    raw_headers = [str(c).strip() if c else "" for c in table[0]]
                    col_map = _map_headers(raw_headers)

                    # Need at least room_number + floor + room_type_code
                    required = {"room_number", "floor", "room_type_code"}
                    if not required.issubset(col_map.values()):
                        # Try positional fallback: assume first 3 cols are room, floor, type
                        if len(raw_headers) >= 3:
                            col_map = {0: "room_number", 1: "floor", 2: "room_type_code"}
                            if len(raw_headers) >= 4:
                                col_map[3] = "room_type_name"
                        else:
                            parse_errors.append(
                                f"Page {page_num}: could not identify required columns "
                                f"(found: {raw_headers})"
                            )
                            continue

                    for row in table[1:]:
                        if not row or all(c is None or str(c).strip() == "" for c in row):
                            continue
                        room_data: dict = {}
                        for col_idx, field in col_map.items():
                            val = row[col_idx] if col_idx < len(row) else None
                            room_data[field] = str(val).strip() if val else ""
                        rooms_input.append(room_data)

    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not parse PDF: {exc}")

    if not rooms_input:
        detail = "No room data found in PDF."
        if parse_errors:
            detail += " " + "; ".join(parse_errors)
        raise HTTPException(status_code=422, detail=detail)

    result = _import_rooms_batch(rooms_input, current_user.hotel_id)
    if parse_errors:
        result["parse_warnings"] = parse_errors
    return {"data": result}


@router.post("/ai-assistant")
async def onboarding_ai_assistant(
    request: CopilotChatRequest,
    current_user: CurrentUser = Depends(get_current_user_no_hotel)
):
    """AI assistant to guide GM through onboarding setup."""
    from openai import OpenAI
    from core.config import settings

    current_step = 1
    hotel_name = "your hotel"
    completed_steps = []

    if request.context:
        current_step = request.context.get("current_step", 1)
        hotel_name = request.context.get("hotel_name", "your hotel")
        completed_steps = request.context.get("completed_steps", [])

    STEP_CONTEXT = {
        1: "The GM is setting up their Hotel Profile (name, address, room count, timezone). Help them understand the setup and answer questions about pricing ($99/month base, room count determines the monthly cap at $2.50/room).",
        2: "The GM is importing rooms via CSV or manually. The CSV format needs: room_number (e.g. '101'), floor (integer), room_type_code (e.g. 'KS' for King Suite, 'SD' for Standard Double). They can also connect Opera Cloud to import automatically.",
        3: "The GM is inviting staff. Roles available: housekeeping_supervisor (manages HK team + inspections), housekeeper (marks rooms clean on mobile), chief_engineer (manages work orders + PM schedules), engineer (claims and completes work orders), front_desk (creates guest requests, views room status).",
        4: "The GM is connecting Opera Cloud (optional). This enables: automatic room status updates on checkout, guest VIP flags, check-in times for predictions. They need their Opera OHIP credentials. It's skippable — they can connect it later in Settings > Integrations.",
        5: "The GM is uploading SOPs (Standard Operating Procedures) as PDFs (optional). These get indexed for AI Q&A. Good SOPs to upload: housekeeping procedures, VIP protocols, emergency procedures, brand standards. Skippable for now.",
        6: "The GM has completed onboarding! Congratulate them. Suggest first actions: 1) Assign today's rooms to housekeepers, 2) Create a test task from the AI Copilot, 3) Check the Dashboard for live metrics.",
    }

    step_ctx = STEP_CONTEXT.get(current_step, STEP_CONTEXT[1])

    system_prompt = f"""You are an expert hotel operations consultant and AI assistant for PatelRep, helping a General Manager set up their hotel management platform.

Current context:
- Hotel: {hotel_name}
- Current onboarding step: {current_step} of 6
- Completed steps: {len(completed_steps)} steps done
- Step context: {step_ctx}

Your job:
1. Answer their question helpfully and concisely
2. Provide actionable guidance specific to the current step
3. Keep responses under 3 sentences unless they ask for detail
4. Be encouraging — this is an exciting time for them
5. If they ask about something from a different step, still help them

PatelRep pricing: $99/month base + $0.02/AI credit overage, cap at $2.50/room/month. 1-month free trial with 10,000 AI credits."""

    client = OpenAI(api_key=settings.openai_api_key)

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": request.message},
        ],
        max_tokens=300,
        temperature=0.7,
    )

    reply = response.choices[0].message.content or "I'm here to help you set up PatelRep. What questions do you have?"

    # Contextual tip based on current step
    STEP_TIPS = {
        1: "Tip: Your room count determines your monthly price cap ($2.50/room). A 100-room hotel caps at $250/month total.",
        2: "Tip: Use our CSV template — download it from the Import Rooms step. Each floor should have consistent room numbering.",
        3: "Tip: Start with at least 1 housekeeping supervisor and 2 housekeepers to see the room assignment features work.",
        4: "Tip: Opera Cloud sync is optional but powerful — it automatically marks rooms Dirty on checkout so housekeepers are instantly notified.",
        5: "Tip: Upload your most-used SOPs first (housekeeping procedures, VIP protocols). The AI can answer questions from them instantly.",
        6: "You're all set! The AI Copilot (bottom-right) can create tasks, answer SOP questions, and give you operational insights anytime.",
    }

    tip = STEP_TIPS.get(current_step)

    # Log the interaction (1 credit, not charging during onboarding/trial)
    try:
        supabase.table("ai_interactions").insert({
            "tenant_id": current_user.hotel_id,
            "interaction_type": "onboarding_assistant",
            "credits_charged": 1.0,
            "model_used": "gpt-4o-mini",
            "success": True,
        }).execute()
    except Exception:
        pass  # Don't fail the response if logging fails

    return {
        "data": {
            "message": reply,
            "tip": tip,
            "current_step": current_step,
            "credits_used": 1,
        }
    }

from fastapi import APIRouter, Depends, UploadFile, File
from middleware.auth import require_role, CurrentUser
from models.requests import CopilotChatRequest
from core.database import supabase

router = APIRouter(prefix="/onboarding", tags=["onboarding"])

ONBOARDING_STEPS = [
    "hotel_profile",
    "rooms_imported",
    "staff_invited",
    "departments_configured",
    "sop_uploaded",
    "first_task_created",
]


@router.get("/status")
async def get_onboarding_status(
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Return the onboarding checklist status for the hotel."""
    hotel = supabase.table("tenants")\
        .select("name, room_count, onboarding_completed_at, onboarding_step")\
        .eq("id", current_user.hotel_id)\
        .single()\
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
            .single()\
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
    """Import rooms from a CSV file during onboarding."""
    content = await file.read()
    # Placeholder: CSV parsing and room creation in Week 4
    return {
        "data": {
            "message": "CSV room import will be fully implemented in Week 4.",
            "file_name": file.filename,
            "file_size_bytes": len(content),
        }
    }


@router.post("/ai-assistant")
async def onboarding_ai_assistant(
    request: CopilotChatRequest,
    current_user: CurrentUser = Depends(require_role("gm"))
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

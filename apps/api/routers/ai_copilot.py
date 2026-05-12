import logging
from fastapi import APIRouter, Depends, HTTPException
from slowapi import Limiter
from slowapi.util import get_remote_address
from middleware.auth import get_current_user, CurrentUser
from middleware.credits import check_and_deduct_credits, log_ai_interaction
from models.requests import CopilotChatRequest
from core.database import supabase
from services.ai.task_parser import parse_nl_tasks
from services.ai.insights import generate_gm_insights
import openai
import anthropic
import time

router = APIRouter(prefix="/ai", tags=["ai"])
limiter = Limiter(key_func=get_remote_address)


def detect_intent(message: str) -> str:
    msg = message.lower()
    sop_keywords = ["how do", "procedure", "protocol", "sop", "steps", "policy",
                    "cómo", "procedimiento", "how to", "what is the process"]
    task_keywords = ["broken", "need", "fix", "clean", "towels", "repair", "urgent",
                     "room", "habitación", "roto", "necesita", "plumbing", "ac ", "hvac",
                     "leak", "light", "elevator", "turndown", "vip", "guest", "request"]
    insight_keywords = ["insight", "analysis", "trend", "performance", "report",
                        "how are we doing", "summary", "overview"]
    if any(kw in msg for kw in sop_keywords):
        return "sop_query"
    if any(kw in msg for kw in insight_keywords):
        return "insight_query"
    if any(kw in msg for kw in task_keywords):
        return "task_creation"
    return "general"


def _get_hotel_context(hotel_id: str) -> dict:
    """Fetch hotel name and active shift for context injection."""
    hotel = supabase.table("tenants")\
        .select("name")\
        .eq("id", hotel_id)\
        .maybe_single()\
        .execute()
    hotel_name = (hotel.data or {}).get("name", "the hotel") if hotel else "the hotel"

    # Try to get current/most recent active shift
    from datetime import datetime, timezone
    now_time = datetime.now(timezone.utc).strftime("%H:%M:%S")

    shift = supabase.table("shifts")\
        .select("name, start_time, end_time")\
        .eq("tenant_id", hotel_id)\
        .lte("start_time", now_time)\
        .gte("end_time", now_time)\
        .eq("is_active", True)\
        .limit(1)\
        .execute()

    if shift.data:
        s = shift.data[0]
        return {
            "hotel_name": hotel_name,
            "shift_name": s["name"],
            "shift_start": s["start_time"][:5],
            "shift_end": s["end_time"][:5],
        }
    return {
        "hotel_name": hotel_name,
        "shift_name": "Current Shift",
        "shift_start": "07:00",
        "shift_end": "15:00",
    }


def _resolve_room_id(hotel_id: str, room_number: str) -> str | None:
    """Look up room UUID by room number."""
    if not room_number:
        return None
    result = supabase.table("rooms")\
        .select("id, room_number")\
        .eq("tenant_id", hotel_id)\
        .eq("room_number", room_number)\
        .limit(1)\
        .execute()
    if result.data:
        return result.data[0]["id"]
    return None


@router.post("/copilot/chat")
async def copilot_chat(
    request: CopilotChatRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Main AI copilot endpoint.
    - task_creation intent: calls GPT-4o-mini function calling, returns parsed tasks for preview
    - sop_query intent: routes to SOP RAG (stub)
    - insight_query intent: calls Claude Sonnet for GM insights
    - general: returns helpful fallback
    """
    start = time.time()
    intent = detect_intent(request.message)

    interaction_type = (
        "task_creation" if intent == "task_creation" else
        "sop_query" if intent == "sop_query" else
        "gm_insight"
    )

    credits = 0
    prompt_tokens = 0
    completion_tokens = 0
    response_payload = {}

    try:
        if intent == "task_creation":
            ctx = _get_hotel_context(current_user.hotel_id)
            result = parse_nl_tasks(
                message=request.message,
                hotel_name=ctx["hotel_name"],
                staff_name=current_user.user_id,  # name not in CurrentUser, use id as fallback
                role=current_user.role,
                shift_name=ctx["shift_name"],
                shift_start=ctx["shift_start"],
                shift_end=ctx["shift_end"],
                context=request.context,
            )
            # Deduct credits only after AI call succeeds
            credits = await check_and_deduct_credits(current_user.hotel_id, interaction_type)
            prompt_tokens = result["prompt_tokens"]
            completion_tokens = result["completion_tokens"]

            # Resolve room IDs for parsed tasks
            tasks = result["tasks"]
            for task in tasks:
                rn = task.pop("room_number", None)
                if rn:
                    task["room_id"] = _resolve_room_id(current_user.hotel_id, rn)
                    task["room_number_display"] = rn
                else:
                    task["room_id"] = None
                    task["room_number_display"] = None

            # Low-confidence tasks need confirmation
            needs_confirm = any(t.get("confidence", 1.0) < 0.7 for t in tasks)

            response_payload = {
                "response_type": "task_preview",
                "message": (
                    f"I found {len(tasks)} task{'s' if len(tasks) != 1 else ''} to create. "
                    "Please review and confirm."
                ),
                "tasks": tasks,
                "requires_confirmation": needs_confirm or len(tasks) > 0,
                "credits_used": credits,
                "model_used": "gpt-4o-mini",
            }

        elif intent == "insight_query":
            result = generate_gm_insights(current_user.hotel_id, query=request.message)
            # Deduct credits only after AI call succeeds
            credits = await check_and_deduct_credits(current_user.hotel_id, interaction_type)
            prompt_tokens = result["prompt_tokens"]
            completion_tokens = result["completion_tokens"]
            response_payload = {
                "response_type": "insights",
                "message": "Here are your operational insights:",
                "insights": result["insights"],
                "credits_used": credits,
                "model_used": "claude-sonnet-4-6",
            }

        elif intent == "sop_query":
            # SOP RAG is built in Week 8 — graceful degradation
            response_payload = {
                "response_type": "answer",
                "message": (
                    "SOP Q&A requires uploaded SOP documents. "
                    "Please upload your SOPs in the SOP Library, then ask again."
                ),
                "credits_used": 0,
                "model_used": None,
            }

        else:
            # General chat — lightweight response, no AI call, no credit charge
            response_payload = {
                "response_type": "answer",
                "message": (
                    "I can help you create tasks (e.g. 'Room 412 needs towels'), "
                    "check operational insights, or answer SOP questions. What do you need?"
                ),
                "credits_used": 0,
                "model_used": None,
                "actions": [
                    {"label": "At-risk rooms today", "type": "quick_action"},
                    {"label": "Open work orders", "type": "quick_action"},
                    {"label": "Today's roster", "type": "quick_action"},
                ],
            }

    except HTTPException:
        raise
    except (openai.RateLimitError, openai.AuthenticationError, anthropic.RateLimitError, anthropic.AuthenticationStatusError) as exc:
        latency = int((time.time() - start) * 1000)
        await log_ai_interaction(
            hotel_id=current_user.hotel_id,
            user_id=current_user.user_id,
            interaction_type=interaction_type,
            model_used="gpt-4o-mini",
            credits_charged=credits,
            prompt_tokens=0,
            completion_tokens=0,
            latency_ms=latency,
            success=False,
            error_message=str(exc),
        )
        raise HTTPException(status_code=503, detail="AI service temporarily unavailable. Please try again later.")
    except Exception as exc:
        latency = int((time.time() - start) * 1000)
        await log_ai_interaction(
            hotel_id=current_user.hotel_id,
            user_id=current_user.user_id,
            interaction_type=interaction_type,
            model_used="gpt-4o-mini",
            credits_charged=credits,
            prompt_tokens=0,
            completion_tokens=0,
            latency_ms=latency,
            success=False,
            error_message=str(exc),
        )
        raise HTTPException(status_code=500, detail=f"AI service error: {str(exc)}")

    latency = int((time.time() - start) * 1000)
    await log_ai_interaction(
        hotel_id=current_user.hotel_id,
        user_id=current_user.user_id,
        interaction_type=interaction_type,
        model_used=response_payload.get("model_used") or "none",
        credits_charged=credits,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        latency_ms=latency,
        success=True,
    )

    return {"data": response_payload}


@router.post("/tasks/confirm")
async def confirm_tasks(
    tasks: list[dict],
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Batch-create tasks after AI confirmation.
    Accepts list of task dicts (from task_preview response).
    """
    from datetime import datetime, timedelta, timezone
    SLA_MINUTES = {"urgent": 60, "normal": 240, "low": 480}

    created = []
    for task in tasks:
        if task.get("room_id"):
            room_check = supabase.table("rooms").select("id")\
                .eq("id", task["room_id"])\
                .eq("tenant_id", current_user.hotel_id)\
                .maybe_single().execute()
            if not (room_check and room_check.data):
                raise HTTPException(status_code=400, detail="Room not found in your hotel")

        priority = task.get("priority", "normal")
        sla = SLA_MINUTES.get(priority, 240)
        due_at = task.get("due_at") or (datetime.now(timezone.utc) + timedelta(minutes=sla)).isoformat()

        row = {
            "tenant_id": current_user.hotel_id,
            "title": task["title"],
            "description": task.get("description"),
            "task_type": task.get("task_type", "general"),
            "priority": priority,
            "room_id": task.get("room_id"),
            "due_at": due_at,
            "sla_minutes": sla,
            "created_by": current_user.user_id,
            "is_ai_created": True,
        }
        result = supabase.table("tasks").insert(row).execute()
        if result.data:
            created.append(result.data[0])

    return {"data": {"created_count": len(created), "tasks": created}}


@router.get("/risk-alerts")
async def get_risk_alerts(current_user: CurrentUser = Depends(get_current_user)):
    """Get high-risk rooms, SLA breaches, and high-risk assets."""
    from datetime import datetime, timezone

    room_risks = supabase.table("room_readiness_predictions")\
        .select("*, rooms(room_number)")\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("risk_level", "HIGH")\
        .execute()

    sla_breaches = supabase.table("work_orders")\
        .select("work_order_number, title, due_at")\
        .eq("tenant_id", current_user.hotel_id)\
        .in_("status", ["open", "in_progress"])\
        .lt("due_at", datetime.now(timezone.utc).isoformat())\
        .execute()

    asset_risks = supabase.table("assets")\
        .select("name, failure_risk_score")\
        .eq("tenant_id", current_user.hotel_id)\
        .gte("failure_risk_score", 70)\
        .order("failure_risk_score", desc=True)\
        .limit(5)\
        .execute()

    return {
        "data": {
            "housekeeping_risks": room_risks.data or [],
            "maintenance_risks": asset_risks.data or [],
            "sla_breaches": sla_breaches.data or [],
        }
    }


@router.get("/insights")
async def get_gm_insights(
    current_user: CurrentUser = Depends(get_current_user)
):
    """Generate GM operational insights using Claude Sonnet."""
    credits = await check_and_deduct_credits(current_user.hotel_id, "gm_insight")
    start = time.time()

    try:
        result = generate_gm_insights(current_user.hotel_id)
    except Exception as exc:
        latency = int((time.time() - start) * 1000)
        await log_ai_interaction(
            hotel_id=current_user.hotel_id,
            user_id=current_user.user_id,
            interaction_type="gm_insight",
            model_used="claude-sonnet-4-6",
            credits_charged=credits,
            prompt_tokens=0,
            completion_tokens=0,
            latency_ms=latency,
            success=False,
            error_message=str(exc),
        )
        raise HTTPException(status_code=503, detail="AI insights temporarily unavailable. Please try again later.")

    latency = int((time.time() - start) * 1000)
    await log_ai_interaction(
        hotel_id=current_user.hotel_id,
        user_id=current_user.user_id,
        interaction_type="gm_insight",
        model_used="claude-sonnet-4-6",
        credits_charged=credits,
        prompt_tokens=result["prompt_tokens"],
        completion_tokens=result["completion_tokens"],
        latency_ms=latency,
    )

    return {"data": {"insights": result["insights"], "credits_used": credits}}

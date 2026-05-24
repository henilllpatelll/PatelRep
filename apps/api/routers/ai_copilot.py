from fastapi import APIRouter, Depends, HTTPException
from middleware.auth import get_current_user, CurrentUser, require_role
from middleware.credits import check_and_deduct_credits, log_ai_interaction
from models.requests import (
    CopilotChatRequest,
    WorkOrderPreview, GuestRequestPreview, AssignmentPreview,
)
from core.database import supabase
from services.ai.task_parser import parse_nl_tasks, try_fast_path
from services.ai.insights import generate_gm_insights
from services.ai.work_order_parser import parse_work_orders
from services.ai.guest_request_parser import parse_guest_requests
from services.ai.assignment_parser import parse_assignments
from services.ai.sop_rag import query_sop
from services.policy import check_action_permitted
import openai
import anthropic
import time
import logging
from typing import Optional

router = APIRouter(prefix="/ai", tags=["ai"])
logger = logging.getLogger(__name__)


def _intent_score(msg: str, keywords: list) -> int:
    return sum(1 for kw in keywords if kw in msg)


def detect_intent(message: str, intent_hint: Optional[str] = None) -> str:
    if intent_hint:
        return intent_hint

    msg = message.lower()

    sop_kw = ["how do", "procedure", "protocol", "sop", "steps", "policy",
               "cómo", "procedimiento", "how to", "what is the process"]
    insight_kw = ["insight", "analysis", "trend", "performance", "report",
                  "how are we doing", "summary", "overview"]
    assign_kw = ["assign ", "reassign", "give to", "move to", "put on"]

    if any(kw in msg for kw in sop_kw):
        return "sop_query"
    if any(kw in msg for kw in insight_kw):
        return "insight_query"
    if any(kw in msg for kw in assign_kw):
        return "task_assignment"

    wo_kw = ["ac ", "hvac", "plumbing", "leak", "electrical", "elevator",
             "broken", "not working", "repair", "maintenance", "flooding"]
    gr_kw = ["guest", "rollaway", "deliver to room", "bring to room",
             "requesting", "wants ", "extra towels", "extra pillow"]
    task_kw = ["towels", "clean", "needs", "need", "turndown", "vip",
               "habitación", "roto", "necesita", "restock", "supplies",
               "checkout", "departure", "vacuum", "linen", "trash", "amenities"]

    scores = {
        "work_order_creation": _intent_score(msg, wo_kw),
        "guest_request_creation": _intent_score(msg, gr_kw),
        "task_creation": _intent_score(msg, task_kw),
    }
    top_intent, top_score = max(scores.items(), key=lambda x: x[1])
    if top_score == 0:
        return "general"
    competing = [(k, v) for k, v in scores.items() if v > 0 and k != top_intent]
    if competing and max(v for _, v in competing) >= top_score * 0.8:
        return "ambiguous"
    return top_intent


def _get_hotel_context(hotel_id: str) -> dict:
    hotel = supabase.table("tenants")\
        .select("name")\
        .eq("id", hotel_id)\
        .maybe_single()\
        .execute()
    hotel_name = (hotel.data or {}).get("name", "the hotel") if hotel else "the hotel"
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
        return {"hotel_name": hotel_name, "shift_name": s["name"],
                "shift_start": s["start_time"][:5], "shift_end": s["end_time"][:5]}
    return {"hotel_name": hotel_name, "shift_name": "Current Shift",
            "shift_start": "07:00", "shift_end": "15:00"}


def _resolve_room_id(hotel_id: str, room_number: str) -> Optional[str]:
    if not room_number:
        return None
    result = supabase.table("rooms")\
        .select("id")\
        .eq("tenant_id", hotel_id)\
        .eq("room_number", room_number)\
        .limit(1)\
        .execute()
    return result.data[0]["id"] if result.data else None


def _resolve_staff_id(hotel_id: str, name_hint: str) -> Optional[str]:
    if not name_hint:
        return None
    try:
        roles = supabase.table("user_roles")\
            .select("user_id")\
            .eq("tenant_id", hotel_id)\
            .eq("is_active", True)\
            .in_("role", ["housekeeper", "housekeeping_supervisor"])\
            .execute()
        user_ids = [r["user_id"] for r in (roles.data or [])]
        if not user_ids:
            return None
        match = supabase.table("user_profiles")\
            .select("id")\
            .in_("id", user_ids)\
            .ilike("full_name", f"%{name_hint}%")\
            .limit(1)\
            .execute()
        return match.data[0]["id"] if match and match.data else None
    except Exception:
        return None


def _is_assignable_housekeeping_staff(hotel_id: str, staff_id: str) -> bool:
    result = supabase.table("user_roles")\
        .select("id")\
        .eq("tenant_id", hotel_id)\
        .eq("user_id", staff_id)\
        .eq("is_active", True)\
        .in_("role", ["housekeeper", "housekeeping_supervisor"])\
        .limit(1)\
        .execute()
    return bool(result.data)


@router.post("/copilot/chat")
async def copilot_chat(
    request: CopilotChatRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    start = time.time()
    intent_hint = (request.context or {}).get("intent_hint") if request.context else None
    intent = detect_intent(request.message, intent_hint)

    intent_to_log = {
        "task_creation": "task_creation",
        "work_order_creation": "work_order_creation",
        "guest_request_creation": "guest_request_creation",
        "task_assignment": "task_assignment",
        "sop_query": "sop_query",
        "insight_query": "gm_insight",
    }.get(intent, "general")

    credits = 0
    prompt_tokens = 0
    completion_tokens = 0
    response_payload: dict = {}

    try:
        if intent == "task_creation":
            fast = try_fast_path(request.message)
            if fast:
                tasks = fast["tasks"]
                for task in tasks:
                    rn = task.pop("room_number", None)
                    task["room_id"] = _resolve_room_id(current_user.hotel_id, rn) if rn else None
                    task["room_number_display"] = rn
                response_payload = {
                    "response_type": "task_preview",
                    "message": "I recognised that — here's what I'll create:",
                    "tasks": tasks,
                    "requires_confirmation": True,
                    "credits_used": 0,
                    "model_used": "rule_engine",
                }
            else:
                ctx = _get_hotel_context(current_user.hotel_id)
                result = parse_nl_tasks(
                    message=request.message,
                    hotel_name=ctx["hotel_name"],
                    staff_name=current_user.user_id,
                    role=current_user.role,
                    shift_name=ctx["shift_name"],
                    shift_start=ctx["shift_start"],
                    shift_end=ctx["shift_end"],
                    context=request.context,
                )
                credits = await check_and_deduct_credits(current_user.hotel_id, intent_to_log)
                prompt_tokens = result["prompt_tokens"]
                completion_tokens = result["completion_tokens"]
                tasks = result["tasks"]
                for task in tasks:
                    rn = task.pop("room_number", None)
                    task["room_id"] = _resolve_room_id(current_user.hotel_id, rn) if rn else None
                    task["room_number_display"] = rn
                needs_confirm = any(t.get("confidence", 1.0) < 0.7 for t in tasks)
                response_payload = {
                    "response_type": "task_preview",
                    "message": (f"I found {len(tasks)} task{'s' if len(tasks) != 1 else ''} to create. "
                                "Please review and confirm."),
                    "tasks": tasks,
                    "requires_confirmation": needs_confirm or len(tasks) > 0,
                    "credits_used": credits,
                    "model_used": "gpt-4o-mini",
                }

        elif intent == "work_order_creation":
            result = parse_work_orders(request.message)
            credits = await check_and_deduct_credits(current_user.hotel_id, intent_to_log)
            prompt_tokens = result["prompt_tokens"]
            completion_tokens = result["completion_tokens"]
            wos = result["work_orders"]
            for wo in wos:
                rn = wo.get("room_number")
                wo["room_id"] = _resolve_room_id(current_user.hotel_id, rn) if rn else None
            response_payload = {
                "response_type": "work_order_preview",
                "message": f"I'll create {len(wos)} work order{'s' if len(wos) != 1 else ''} — please confirm.",
                "work_orders": wos,
                "requires_confirmation": True,
                "credits_used": credits,
                "model_used": "gpt-4o-mini",
            }

        elif intent == "guest_request_creation":
            result = parse_guest_requests(request.message)
            credits = await check_and_deduct_credits(current_user.hotel_id, intent_to_log)
            prompt_tokens = result["prompt_tokens"]
            completion_tokens = result["completion_tokens"]
            reqs = result["requests"]
            for req in reqs:
                rn = req.get("room_number")
                req["room_id"] = _resolve_room_id(current_user.hotel_id, rn) if rn else None
            response_payload = {
                "response_type": "guest_request_preview",
                "message": f"I'll log {len(reqs)} guest request{'s' if len(reqs) != 1 else ''} — please confirm.",
                "requests": reqs,
                "requires_confirmation": True,
                "credits_used": credits,
                "model_used": "gpt-4o-mini",
            }

        elif intent == "task_assignment":
            result = parse_assignments(request.message)
            credits = await check_and_deduct_credits(current_user.hotel_id, intent_to_log)
            prompt_tokens = result["prompt_tokens"]
            completion_tokens = result["completion_tokens"]
            assignments = result["assignments"]
            for a in assignments:
                a["staff_id"] = _resolve_staff_id(current_user.hotel_id, a.get("staff_name_hint", ""))
            response_payload = {
                "response_type": "assignment_preview",
                "message": f"I'll process {len(assignments)} assignment{'s' if len(assignments) != 1 else ''} — please confirm.",
                "assignments": assignments,
                "requires_confirmation": True,
                "credits_used": credits,
                "model_used": "gpt-4o-mini",
            }

        elif intent == "ambiguous":
            response_payload = {
                "response_type": "ambiguous",
                "message": "I'm not sure what you need — what should I do?",
                "options": [
                    {"label": "Work Order", "intent_hint": "work_order_creation"},
                    {"label": "Housekeeping Task", "intent_hint": "task_creation"},
                    {"label": "Guest Request", "intent_hint": "guest_request_creation"},
                ],
                "credits_used": 0,
                "model_used": None,
            }

        elif intent == "insight_query":
            result = generate_gm_insights(current_user.hotel_id, query=request.message)
            credits = await check_and_deduct_credits(current_user.hotel_id, intent_to_log)
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
            sop_check = (
                supabase.table("sop_documents")
                .select("id", count="exact")
                .eq("tenant_id", current_user.hotel_id)
                .eq("indexing_status", "indexed")
                .limit(1)
                .execute()
            )
            if not sop_check.count:
                response_payload = {
                    "response_type": "answer",
                    "message": ("No SOPs have been uploaded yet. Upload your procedures "
                                "in the SOP Library and I'll be able to answer questions about them."),
                    "sources": [],
                    "credits_used": 0,
                    "model_used": None,
                }
            else:
                sop_result = query_sop(
                    query=request.message,
                    hotel_id=current_user.hotel_id,
                    user_id=current_user.user_id,
                )
                credits = await check_and_deduct_credits(current_user.hotel_id, intent_to_log)
                prompt_tokens = sop_result.get("prompt_tokens", 0)
                completion_tokens = sop_result.get("completion_tokens", 0)
                response_payload = {
                    "response_type": "answer",
                    "message": sop_result["answer"],
                    "sources": sop_result.get("sources", []),
                    "suggested_tasks": sop_result.get("suggested_tasks", []),
                    "credits_used": credits,
                    "model_used": "claude-sonnet-4-6",
                }

        else:
            response_payload = {
                "response_type": "answer",
                "message": ("I can help you create tasks (e.g. 'Room 412 needs towels'), "
                            "check operational insights, or answer SOP questions. What do you need?"),
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
    except (openai.RateLimitError, openai.AuthenticationError,
            anthropic.RateLimitError, anthropic.AuthenticationError) as exc:
        latency = int((time.time() - start) * 1000)
        await log_ai_interaction(
            hotel_id=current_user.hotel_id, user_id=current_user.user_id,
            interaction_type=intent_to_log, model_used="gpt-4o-mini",
            credits_charged=credits, prompt_tokens=0, completion_tokens=0,
            latency_ms=latency, success=False, error_message=str(exc),
        )
        raise HTTPException(status_code=503, detail="AI service temporarily unavailable. Please try again later.")
    except Exception as exc:
        latency = int((time.time() - start) * 1000)
        await log_ai_interaction(
            hotel_id=current_user.hotel_id, user_id=current_user.user_id,
            interaction_type=intent_to_log, model_used="gpt-4o-mini",
            credits_charged=credits, prompt_tokens=0, completion_tokens=0,
            latency_ms=latency, success=False, error_message=str(exc),
        )
        logger.exception("AI copilot request failed hotel=%s intent=%s", current_user.hotel_id, intent)
        raise HTTPException(status_code=500, detail="AI service temporarily unavailable. Please try again later.")

    latency = int((time.time() - start) * 1000)
    await log_ai_interaction(
        hotel_id=current_user.hotel_id, user_id=current_user.user_id,
        interaction_type=intent_to_log,
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
    from datetime import datetime, timedelta, timezone
    SLA_MINUTES = {"urgent": 60, "normal": 240, "low": 480}
    for task in tasks:
        assigned_to = task.get("assigned_to")
        if assigned_to and assigned_to != current_user.user_id:
            permitted, reason = check_action_permitted("reassign_other_staff_task", current_user.role)
            if not permitted:
                raise HTTPException(status_code=403, detail=reason)
    created = []
    for task in tasks:
        # Resolve room_id from display number when client fast path omits it
        if not task.get("room_id") and task.get("room_number_display"):
            task["room_id"] = _resolve_room_id(current_user.hotel_id, task["room_number_display"])
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


@router.post("/work-orders/confirm")
async def confirm_work_orders(
    work_orders: list[WorkOrderPreview],
    current_user: CurrentUser = Depends(get_current_user)
):
    from datetime import datetime, timedelta, timezone
    SLA = {"urgent": 60, "normal": 240, "low": 480}
    created = []
    for wo in work_orders:
        room_id = _resolve_room_id(current_user.hotel_id, wo.room_number) if wo.room_number else None
        priority = wo.priority
        due_at = (datetime.now(timezone.utc) + timedelta(minutes=SLA.get(priority, 240))).isoformat()
        result = supabase.table("work_orders").insert({
            "tenant_id": current_user.hotel_id,
            "title": wo.title,
            "description": wo.description,
            "category": wo.category,
            "priority": priority,
            "room_id": room_id,
            "location_text": wo.location_text,
            "due_at": due_at,
            "created_by": current_user.user_id,
            "is_ai_created": True,
        }).execute()
        if result.data:
            created.append(result.data[0])
    return {"data": {"created_count": len(created), "work_orders": created}}


@router.post("/guest-requests/confirm")
async def confirm_guest_requests(
    requests: list[GuestRequestPreview],
    current_user: CurrentUser = Depends(get_current_user)
):
    created = []
    for req in requests:
        room_id = _resolve_room_id(current_user.hotel_id, req.room_number) if req.room_number else None
        result = supabase.table("guest_requests").insert({
            "tenant_id": current_user.hotel_id,
            "title": req.title,
            "description": req.description,
            "room_id": room_id,
            "guest_name": req.guest_name,
            "status": "open",
            "created_by": current_user.user_id,
        }).execute()
        if result.data:
            created.append(result.data[0])
    return {"data": {"created_count": len(created), "requests": created}}


@router.post("/assignments/confirm")
async def confirm_assignments(
    assignments: list[AssignmentPreview],
    current_user: CurrentUser = Depends(
        require_role("housekeeping_supervisor", "chief_engineer", "gm")
    )
):
    assigned_count = 0
    from datetime import date
    today = date.today().isoformat()

    for assignment in assignments:
        staff_id = assignment.staff_id or _resolve_staff_id(
            current_user.hotel_id, assignment.staff_name_hint
        )
        if not staff_id or not _is_assignable_housekeeping_staff(current_user.hotel_id, staff_id):
            continue

        for room_number in assignment.room_numbers:
            room_id = _resolve_room_id(current_user.hotel_id, room_number)
            if not room_id:
                continue
            supabase.table("room_assignments").upsert({
                "tenant_id": current_user.hotel_id,
                "room_id": room_id,
                "assigned_to": staff_id,
                "assigned_by": current_user.user_id,
                "assignment_date": today,
                "clean_type": assignment.clean_type or "DEP",
                "is_ai_suggested": True,
            }, on_conflict="room_id,assignment_date").execute()
            supabase.table("room_status")\
                .update({"assigned_to": staff_id})\
                .eq("tenant_id", current_user.hotel_id)\
                .eq("room_id", room_id)\
                .execute()
            assigned_count += 1

        if assignment.task_ids:
            supabase.table("tasks")\
                .update({"assigned_to": staff_id})\
                .eq("tenant_id", current_user.hotel_id)\
                .in_("id", assignment.task_ids)\
                .execute()
            assigned_count += len(assignment.task_ids)

    return {"data": {"assigned_count": assigned_count}}


@router.get("/risk-alerts")
async def get_risk_alerts(current_user: CurrentUser = Depends(get_current_user)):
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
async def get_gm_insights(current_user: CurrentUser = Depends(get_current_user)):
    credits = await check_and_deduct_credits(current_user.hotel_id, "gm_insight")
    start = time.time()
    try:
        result = generate_gm_insights(current_user.hotel_id)
    except Exception as exc:
        latency = int((time.time() - start) * 1000)
        await log_ai_interaction(
            hotel_id=current_user.hotel_id, user_id=current_user.user_id,
            interaction_type="gm_insight", model_used="claude-sonnet-4-6",
            credits_charged=credits, prompt_tokens=0, completion_tokens=0,
            latency_ms=latency, success=False, error_message=str(exc),
        )
        raise HTTPException(status_code=503, detail="AI insights temporarily unavailable. Please try again later.")
    latency = int((time.time() - start) * 1000)
    await log_ai_interaction(
        hotel_id=current_user.hotel_id, user_id=current_user.user_id,
        interaction_type="gm_insight", model_used="claude-sonnet-4-6",
        credits_charged=credits, prompt_tokens=result["prompt_tokens"],
        completion_tokens=result["completion_tokens"], latency_ms=latency,
    )
    return {"data": {"insights": result["insights"], "credits_used": credits}}

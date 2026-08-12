from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from middleware.auth import get_current_user, CurrentUser, require_role
from middleware.credits import check_and_deduct_credits, log_ai_interaction
from models.requests import (
    CopilotChatRequest, HousekeepingBriefingRequest,
    TaskPreview, WorkOrderPreview, GuestRequestPreview, AssignmentPreview,
    AuthorizeAIRecommendationRequest, RecordAIRecommendationOutcomeRequest,
    UpdateAIModelRouteRequest,
)
from core.database import supabase
from services.ai.task_parser import parse_nl_tasks, try_fast_path
from services.ai.insights import generate_gm_insights
from services.ai.work_order_parser import parse_work_orders
from services.ai.guest_request_parser import parse_guest_requests
from services.ai.assignment_parser import parse_assignments
from services.ai.sop_rag import query_sop
from services.ai.housekeeping_briefing import generate_shift_briefing
from services.housekeeping_assignments import room_status_for_clean_type
from services.policy import check_action_permitted
from services.ai.governance import (
    InvalidRecommendationTransition,
    calculate_recommendation_metrics,
    validate_ai_action,
    validate_recommendation_transition,
)
from services.ai.model_routing import DEFAULT_MODEL_ROUTES
from services.guest_recovery.contracts import resolve_sla_minutes
from routers.guest_requests import _record_guest_request_event
import openai
import anthropic
import time
import logging
from typing import Optional

router = APIRouter(prefix="/ai", tags=["ai"])
logger = logging.getLogger(__name__)


def _append_recommendation_event(hotel_id: str, recommendation_id: str, event_type: str, actor_id: str | None, metadata: dict | None = None) -> None:
    supabase.table("ai_recommendation_events").insert({
        "tenant_id": hotel_id,
        "recommendation_id": recommendation_id,
        "event_type": event_type,
        "actor_id": actor_id,
        "metadata": metadata or {},
    }).execute()


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


def _layout_to_context_text(layout: Optional[dict]) -> str:
    if not layout:
        return ""
    buildings = layout.get("buildings", {})
    routing_rules = layout.get("routing_rules", [])
    lines = ["Hotel physical layout:"]
    for bname, bdata in buildings.items():
        b_label = bdata.get("name", f"Building {bname}")
        b_pos = bdata.get("position", "")
        floors = bdata.get("floors", {})
        floor_parts = []
        for fnum in sorted(floors.keys()):
            fdata = floors[fnum]
            rooms = fdata.get("rooms", [])
            amenities = fdata.get("amenities", {})
            fd = f"Floor {fnum}: {rooms[0]}-{rooms[-1]}" if rooms else f"Floor {fnum}"
            if amenities:
                fd += f" ({', '.join(f'{k}: {v}' for k, v in amenities.items())})"
            floor_parts.append(fd)
        lines.append(f"- {b_label} ({b_pos}): {'; '.join(floor_parts)}")
    if routing_rules:
        lines.append("Routing notes:")
        for rule in routing_rules:
            lines.append(f"  • {rule}")
    return "\n".join(lines)


def _build_work_order_triage_summary(work_orders: list[dict]) -> str:
    """Pure, zero-LLM rule-based triage summary — no DB/network access.

    Mirrors 13-01's suggest_assignments precedent: a real, context-derived
    analysis computed entirely server-side from the work orders the client
    already has, so this branch is unit-testable without mocking Supabase.
    """
    if not work_orders:
        return "No open work orders to triage."

    priority_rank = {"emergency": 0, "urgent": 1, "normal": 2, "low": 3}
    now = datetime.now(timezone.utc)

    def _is_overdue(wo: dict) -> bool:
        due_at = wo.get("due_at")
        if not due_at:
            return False
        try:
            due = datetime.fromisoformat(str(due_at).replace("Z", "+00:00"))
            if due.tzinfo is None:
                due = due.replace(tzinfo=timezone.utc)
            return due < now
        except (ValueError, TypeError):
            return False

    overdue_count = sum(1 for wo in work_orders if _is_overdue(wo))
    unassigned_count = sum(1 for wo in work_orders if not wo.get("assigned_to"))

    def _sort_key(wo: dict):
        overdue = _is_overdue(wo)
        unassigned = not wo.get("assigned_to")
        rank = priority_rank.get(wo.get("priority"), 2)
        return (0 if overdue else 1, 0 if unassigned else 1, rank)

    ordered = sorted(work_orders, key=_sort_key)
    floor_order = ", ".join(
        wo.get("room_number") or wo.get("title") or "—" for wo in ordered[:5]
    )

    return (
        f"Reviewed {len(work_orders)} open work order(s): {overdue_count} overdue, "
        f"{unassigned_count} unassigned. Suggested floor order: {floor_order}."
    )


def _get_hotel_context(hotel_id: str) -> dict:
    hotel = supabase.table("tenants")\
        .select("name, layout")\
        .eq("id", hotel_id)\
        .maybe_single()\
        .execute()
    hotel_data = (hotel.data or {}) if hotel else {}
    hotel_name = hotel_data.get("name", "the hotel")
    layout_text = _layout_to_context_text(hotel_data.get("layout"))
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
                "shift_start": s["start_time"][:5], "shift_end": s["end_time"][:5],
                "layout_text": layout_text}
    return {"hotel_name": hotel_name, "shift_name": "Current Shift",
            "shift_start": "07:00", "shift_end": "15:00", "layout_text": layout_text}


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
        "work_order_triage": "work_order_triage",
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
                prompt_tokens = result["prompt_tokens"]
                completion_tokens = result["completion_tokens"]
                credits = await check_and_deduct_credits(
                    current_user.hotel_id, intent_to_log, prompt_tokens, completion_tokens
                )
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
            prompt_tokens = result["prompt_tokens"]
            completion_tokens = result["completion_tokens"]
            credits = await check_and_deduct_credits(
                current_user.hotel_id, intent_to_log, prompt_tokens, completion_tokens
            )
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
            prompt_tokens = result["prompt_tokens"]
            completion_tokens = result["completion_tokens"]
            credits = await check_and_deduct_credits(
                current_user.hotel_id, intent_to_log, prompt_tokens, completion_tokens
            )
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
            prompt_tokens = result["prompt_tokens"]
            completion_tokens = result["completion_tokens"]
            credits = await check_and_deduct_credits(
                current_user.hotel_id, intent_to_log, prompt_tokens, completion_tokens
            )
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

        elif intent == "work_order_triage":
            wos = (request.context or {}).get("work_orders") or []
            response_payload = {
                "response_type": "answer",
                "message": _build_work_order_triage_summary(wos),
                "credits_used": 0,
                "model_used": None,
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
            prompt_tokens = result["prompt_tokens"]
            completion_tokens = result["completion_tokens"]
            credits = await check_and_deduct_credits(
                current_user.hotel_id, intent_to_log, prompt_tokens, completion_tokens
            )
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
                prompt_tokens = sop_result.get("prompt_tokens", 0)
                completion_tokens = sop_result.get("completion_tokens", 0)
                credits = await check_and_deduct_credits(
                    current_user.hotel_id, intent_to_log, prompt_tokens, completion_tokens
                )
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


@router.post("/housekeeping/briefing")
async def housekeeping_shift_briefing(
    request: HousekeepingBriefingRequest,
    current_user: CurrentUser = Depends(require_role("housekeeper", "housekeeping_supervisor")),
):
    """AI shift briefing for the housekeeper's assigned rooms.

    The mobile app sends compact room summaries and renders a local heuristic
    briefing when this returns 503, so AI failures must not leak provider detail.
    """
    start = time.time()
    credits = 0
    try:
        hotel = supabase.table("tenants")\
            .select("layout")\
            .eq("id", current_user.hotel_id)\
            .maybe_single()\
            .execute()
        layout_text = _layout_to_context_text((hotel.data or {}).get("layout") if hotel else None)
        result = generate_shift_briefing(
            [room.model_dump() for room in request.rooms],
            request.language,
            layout_context=layout_text,
        )
        credits = await check_and_deduct_credits(
            current_user.hotel_id, "housekeeping_briefing",
            result["prompt_tokens"], result["completion_tokens"],
        )
        latency = int((time.time() - start) * 1000)
        await log_ai_interaction(
            hotel_id=current_user.hotel_id, user_id=current_user.user_id,
            interaction_type="housekeeping_briefing", model_used="claude-sonnet-4-6",
            credits_charged=credits, prompt_tokens=result["prompt_tokens"],
            completion_tokens=result["completion_tokens"], latency_ms=latency, success=True,
        )
        return {"data": {**result["briefing"], "credits_used": credits, "model_used": "claude-sonnet-4-6"}}
    except HTTPException:
        raise
    except Exception as exc:
        latency = int((time.time() - start) * 1000)
        await log_ai_interaction(
            hotel_id=current_user.hotel_id, user_id=current_user.user_id,
            interaction_type="housekeeping_briefing", model_used="claude-sonnet-4-6",
            credits_charged=credits, prompt_tokens=0, completion_tokens=0,
            latency_ms=latency, success=False, error_message=str(exc),
        )
        raise HTTPException(status_code=503, detail="AI briefing temporarily unavailable.")


@router.post("/tasks/confirm")
async def confirm_tasks(
    tasks: list[TaskPreview],
    current_user: CurrentUser = Depends(get_current_user)
):
    from datetime import datetime, timedelta, timezone
    SLA_MINUTES = {"urgent": 60, "normal": 240, "low": 480}
    for task in tasks:
        assigned_to = str(task.assigned_to) if task.assigned_to else None
        if assigned_to and assigned_to != current_user.user_id:
            permitted, reason = check_action_permitted("reassign_other_staff_task", current_user.role)
            if not permitted:
                raise HTTPException(status_code=403, detail=reason)
    created = []
    for task in tasks:
        room_id = str(task.room_id) if task.room_id else None
        # Resolve room_id from display number when client fast path omits it
        if not room_id and task.room_number_display:
            room_id = _resolve_room_id(current_user.hotel_id, task.room_number_display)
        if room_id:
            room_check = supabase.table("rooms").select("id")\
                .eq("id", room_id)\
                .eq("tenant_id", current_user.hotel_id)\
                .maybe_single().execute()
            if not (room_check and room_check.data):
                raise HTTPException(status_code=400, detail="Room not found in your hotel")
        priority = task.priority
        sla = SLA_MINUTES.get(priority, 240)
        due_at = task.due_at or (datetime.now(timezone.utc) + timedelta(minutes=sla)).isoformat()
        row = {
            "tenant_id": current_user.hotel_id,
            "title": task.title,
            "description": task.description,
            "task_type": task.task_type,
            "priority": priority,
            "room_id": room_id,
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
    # Fail-fast validation before any writes — matches create_guest_request's contract.
    for req in requests:
        if req.category == "accessibility" and req.priority != "urgent":
            raise HTTPException(status_code=422, detail="Accessibility-related requests must use urgent priority")

    created = []
    for req in requests:
        room_id = _resolve_room_id(current_user.hotel_id, req.room_number) if req.room_number else None
        policies = supabase.table("guest_request_sla_policies").select(
            "category, priority, guest_impact, sla_minutes"
        ).eq("tenant_id", current_user.hotel_id).execute().data or []
        sla_minutes = resolve_sla_minutes(
            policies, category=req.category, priority=req.priority, guest_impact=req.guest_impact,
        )
        now = datetime.now(timezone.utc)
        due_at = (now + timedelta(minutes=sla_minutes)).isoformat()
        result = supabase.table("guest_requests").insert({
            "tenant_id": current_user.hotel_id,
            "title": req.title,
            "description": req.description,
            "room_id": room_id,
            "guest_name": req.guest_name,
            "status": "open",
            "created_by": current_user.user_id,
            "priority": req.priority,
            "category": req.category,
            "guest_impact": req.guest_impact,
            "sla_minutes": sla_minutes,
            "due_at": due_at,
        }).execute()
        if not result.data:
            continue

        gr_id = result.data[0]["id"]
        # The linked task is what the escalation cron watches for SLA breaches
        # (mirrors routers/guest_requests.py::create_guest_request).
        task_result = supabase.table("tasks").insert({
            "tenant_id": current_user.hotel_id,
            "title": req.title,
            "description": req.description,
            "task_type": "guest_request",
            "priority": req.priority,
            "room_id": room_id,
            "created_by": current_user.user_id,
            "sla_minutes": sla_minutes,
            "due_at": due_at,
            "is_ai_created": True,
        }).execute()

        task_created = False
        if task_result.data:
            task_created = True
            task_id = task_result.data[0]["id"]
            refreshed = supabase.table("guest_requests")\
                .update({"task_id": task_id})\
                .eq("id", gr_id)\
                .eq("tenant_id", current_user.hotel_id)\
                .execute()
            if refreshed.data:
                result = refreshed
        else:
            logger.error("Auto-task creation failed for AI-created guest_request=%s", gr_id)

        _record_guest_request_event(
            request_id=gr_id,
            event_type="created",
            current_user=current_user,
            source="automation",
            metadata={
                "category": req.category,
                "priority": req.priority,
                "task_created": task_created,
                "created_via": "ai_copilot",
            },
        )
        created.append(result.data[0])
    return {"data": {"created_count": len(created), "requests": created}}


@router.post("/assignments/confirm")
async def confirm_assignments(
    assignments: list[AssignmentPreview],
    current_user: CurrentUser = Depends(
        require_role("housekeeping_supervisor", "engineer", "gm")
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
            clean_type = assignment.clean_type or "DEP"
            supabase.table("room_assignments").upsert({
                "tenant_id": current_user.hotel_id,
                "room_id": room_id,
                "assigned_to": staff_id,
                "assigned_by": current_user.user_id,
                "assignment_date": today,
                "clean_type": clean_type,
                "is_ai_suggested": True,
            }, on_conflict="room_id,assignment_date").execute()
            supabase.table("room_status")\
                .update({"assigned_to": staff_id})\
                .eq("tenant_id", current_user.hotel_id)\
                .eq("room_id", room_id)\
                .execute()
            supabase.table("room_status")\
                .update({"status": room_status_for_clean_type(clean_type)})\
                .eq("tenant_id", current_user.hotel_id)\
                .eq("room_id", room_id)\
                .in_("status", ["DIRTY", "PICKUP"])\
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
        .select("id, name, failure_risk_score")\
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
    credits = 0
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
    credits = await check_and_deduct_credits(
        current_user.hotel_id, "gm_insight", result["prompt_tokens"], result["completion_tokens"]
    )
    latency = int((time.time() - start) * 1000)
    await log_ai_interaction(
        hotel_id=current_user.hotel_id, user_id=current_user.user_id,
        interaction_type="gm_insight", model_used="claude-sonnet-4-6",
        credits_charged=credits, prompt_tokens=result["prompt_tokens"],
        completion_tokens=result["completion_tokens"], latency_ms=latency,
    )
    return {"data": {"insights": result["insights"], "credits_used": credits}}


@router.get("/recommendations")
async def list_ai_recommendations(
    status: Optional[str] = Query(default=None),
    current_user: CurrentUser = Depends(require_role("gm", "chief_engineer", "housekeeping_supervisor")),
):
    query = supabase.table("ai_recommendations") \
        .select("*") \
        .eq("tenant_id", current_user.hotel_id) \
        .order("created_at", desc=True) \
        .limit(100)
    if status:
        query = query.eq("status", status)
    return {"data": query.execute().data or []}


@router.get("/recommendations/metrics")
async def get_ai_recommendation_metrics(
    current_user: CurrentUser = Depends(require_role("gm", "chief_engineer", "housekeeping_supervisor")),
):
    result = supabase.table("ai_recommendations") \
        .select("status, outcome") \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    return {"data": calculate_recommendation_metrics(result.data or [])}


@router.post("/failure-predictions/{prediction_id}/recommendation")
async def create_failure_prediction_recommendation(
    prediction_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "chief_engineer")),
):
    prediction_result = supabase.table("failure_predictions") \
        .select("*") \
        .eq("tenant_id", current_user.hotel_id) \
        .eq("id", prediction_id) \
        .maybe_single() \
        .execute()
    prediction = prediction_result.data
    if not prediction:
        raise HTTPException(status_code=404, detail="Failure prediction not found")

    existing = supabase.table("ai_recommendations") \
        .select("*") \
        .eq("tenant_id", current_user.hotel_id) \
        .eq("source_type", "failure_prediction") \
        .eq("source_id", prediction_id) \
        .maybe_single() \
        .execute()
    if existing.data:
        return {"data": existing.data}

    suggested_action = validate_ai_action("create_work_order")
    result = supabase.table("ai_recommendations").insert({
        "tenant_id": current_user.hotel_id,
        "source_type": "failure_prediction",
        "source_id": prediction_id,
        "recommendation_type": "asset_failure_prevention",
        "evidence": {
            "risk_score": prediction.get("risk_score"),
            "failure_indicators": prediction.get("failure_indicators") or [],
            "analysis": prediction.get("ai_reasoning"),
        },
        # The legacy failure model does not emit calibrated confidence; preserve that limitation.
        "confidence": 0.5,
        "suggested_action": suggested_action,
        "action_payload": {"failure_prediction_id": prediction_id},
        "model_name": DEFAULT_MODEL_ROUTES["failure_prediction"],
    }).execute()
    recommendation = (result.data or [None])[0]
    if recommendation:
        _append_recommendation_event(current_user.hotel_id, recommendation["id"], "created", current_user.user_id)
    return {"data": recommendation}


@router.post("/recommendations/{recommendation_id}/authorize")
async def authorize_ai_recommendation(
    recommendation_id: str,
    body: AuthorizeAIRecommendationRequest,
    current_user: CurrentUser = Depends(require_role("gm", "chief_engineer")),
):
    lookup = supabase.table("ai_recommendations") \
        .select("*") \
        .eq("tenant_id", current_user.hotel_id) \
        .eq("id", recommendation_id) \
        .maybe_single() \
        .execute()
    recommendation = lookup.data
    if not recommendation:
        raise HTTPException(status_code=404, detail="AI recommendation not found")
    try:
        validate_ai_action(recommendation["suggested_action"])
        validate_recommendation_transition(recommendation["status"], "authorized")
    except (InvalidRecommendationTransition, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    result = supabase.table("ai_recommendations").update({
        "status": "authorized",
        "authorization_note": body.note,
        "authorized_by": current_user.user_id,
        "authorized_at": datetime.now(timezone.utc).isoformat(),
    }).eq("tenant_id", current_user.hotel_id).eq("id", recommendation_id).execute()
    _append_recommendation_event(current_user.hotel_id, recommendation_id, "authorized", current_user.user_id, {"note": body.note})
    return {"data": (result.data or [None])[0]}


@router.post("/recommendations/{recommendation_id}/mark-executed")
async def mark_ai_recommendation_executed(
    recommendation_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "chief_engineer")),
):
    lookup = supabase.table("ai_recommendations").select("status").eq("tenant_id", current_user.hotel_id).eq("id", recommendation_id).maybe_single().execute()
    if not lookup.data:
        raise HTTPException(status_code=404, detail="AI recommendation not found")
    try:
        validate_recommendation_transition(lookup.data["status"], "executed")
    except InvalidRecommendationTransition as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    result = supabase.table("ai_recommendations").update({
        "status": "executed", "executed_by": current_user.user_id,
        "executed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("tenant_id", current_user.hotel_id).eq("id", recommendation_id).execute()
    _append_recommendation_event(current_user.hotel_id, recommendation_id, "executed", current_user.user_id)
    return {"data": (result.data or [None])[0]}


@router.post("/recommendations/{recommendation_id}/outcome")
async def record_ai_recommendation_outcome(
    recommendation_id: str,
    body: RecordAIRecommendationOutcomeRequest,
    current_user: CurrentUser = Depends(require_role("gm", "chief_engineer")),
):
    lookup = supabase.table("ai_recommendations").select("status").eq("tenant_id", current_user.hotel_id).eq("id", recommendation_id).maybe_single().execute()
    if not lookup.data:
        raise HTTPException(status_code=404, detail="AI recommendation not found")
    try:
        validate_recommendation_transition(lookup.data["status"], "outcome_recorded")
    except InvalidRecommendationTransition as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    result = supabase.table("ai_recommendations").update({
        "status": "outcome_recorded", "outcome": body.outcome,
        "outcome_detail": body.detail, "outcome_recorded_by": current_user.user_id,
        "outcome_recorded_at": datetime.now(timezone.utc).isoformat(),
    }).eq("tenant_id", current_user.hotel_id).eq("id", recommendation_id).execute()
    _append_recommendation_event(current_user.hotel_id, recommendation_id, "outcome_recorded", current_user.user_id, {"outcome": body.outcome})
    return {"data": (result.data or [None])[0]}


@router.put("/model-routes/{purpose}")
async def update_ai_model_route(
    purpose: str,
    body: UpdateAIModelRouteRequest,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    if purpose not in DEFAULT_MODEL_ROUTES:
        raise HTTPException(status_code=422, detail="Unknown AI model route")
    result = supabase.table("ai_model_routes").upsert({
        "tenant_id": current_user.hotel_id, "purpose": purpose,
        "model_name": body.selected_model_name, "fallback_model_name": body.fallback_model_name,
        "updated_by": current_user.user_id, "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="tenant_id,purpose").execute()
    return {"data": (result.data or [None])[0]}

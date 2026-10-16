from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from middleware.auth import get_current_user, CurrentUser, require_role
from middleware.credits import assert_ai_allowance, check_and_deduct_credits, log_ai_interaction, record_cache_hit
from models.requests import (
    CopilotChatRequest, HousekeepingBriefingRequest, HousekeeperShiftRecapRequest,
    SupervisorBriefingRequest, EngineerBriefingRequest, FrontDeskBriefingRequest,
    TaskPreview, WorkOrderPreview, GuestRequestPreview, AssignmentPreview,
    AuthorizeAIRecommendationRequest, RecordAIRecommendationOutcomeRequest,
    UpdateAIModelRouteRequest, TaskTranslationRequest,
)
from core.database import supabase
from core.feature_flags import is_feature_enabled, require_feature
from core.roles import GM_ONLY_ROLES
from services.ai.task_parser import hotel_zone, normalize_due_at, parse_nl_tasks, try_fast_path
from services.ai.insights import generate_gm_insights
from services.ai.work_order_parser import parse_work_orders
from services.ai.guest_request_parser import parse_guest_requests
from services.ai.assignment_parser import parse_assignments
from services.ai.sop_access import SopUnavailable
from services.ai.sop_rag import query_sop
from services.ai.photo_analysis import MAX_NOTE_CHARS, MAX_UPLOAD_BYTES, PhotoRejected, analyze_photo, prepare_image
from services.ai.providers import AIProviderConfigurationError
from services.ai.usage_summary import summarize as summarize_usage
from services.ai.task_translation import task_source_hash, translate_task_fields
from services.ai.housekeeping_briefing import generate_shift_briefing
from services.ai.housekeeper_shift_recap import generate_shift_recap, load_shift_facts
from services.ai.supervisor_briefing import generate_supervisor_briefing
from services.ai.engineer_briefing import generate_engineer_briefing
from services.ai.front_desk_briefing import generate_front_desk_briefing
from services.ai.gm_briefing import generate_gm_briefing
from services.housekeeping_assignments import room_status_for_clean_type
from services.inventory import get_low_stock_parts_summary
from services.policy import check_action_permitted
from services.ai.authorization import (
    parse_intent_hint,
    require_creation_role,
    resolve_intent,
    resolve_trusted_context,
    sanitize_context,
    PERMISSION_DENIED,
)
from services.ai.governance import (
    InvalidRecommendationTransition,
    calculate_recommendation_metrics,
    validate_ai_action,
    validate_recommendation_transition,
)
from services.ai.model_routing import DEFAULT_MODEL_ROUTES
from services.guest_recovery.contracts import resolve_sla_minutes
from routers.guest_requests import _record_guest_request_event
from routers.work_orders import (
    SLA_MINUTES as WORK_ORDER_SLA_MINUTES,
    _find_replayed_work_order,
    _is_unique_violation,
    _seed_checklist_from_template,
)
from routers.assets import get_recurring_issues
import asyncio
import openai
import anthropic
import time
import logging
from typing import Optional

router = APIRouter(prefix="/ai", tags=["ai"])

# Most recent audit-log rows read for one usage summary (the response says when this truncated).
USAGE_ROW_LIMIT = 20000
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
        .select("name, layout, timezone")\
        .eq("id", hotel_id)\
        .maybe_single()\
        .execute()
    hotel_data = (hotel.data or {}) if hotel else {}
    hotel_name = hotel_data.get("name", "the hotel")
    hotel_timezone = hotel_data.get("timezone")
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
                "layout_text": layout_text, "timezone": hotel_timezone}
    return {"hotel_name": hotel_name, "shift_name": "Current Shift",
            "shift_start": "07:00", "shift_end": "15:00", "layout_text": layout_text,
            "timezone": hotel_timezone}


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


def _finalize_parsed_tasks(hotel_id: str, tasks: list[dict], hotel_timezone: Optional[str]) -> None:
    """Make AI/rule-engine drafts safe to show: verified room or none, validated due time.

    * ``room_id`` is set only when ``room_number`` matches a room of this hotel; otherwise the
      number is kept as text (``room_number_display``) for the person to correct.
    * ``due_at`` is re-validated here (hotel zone, not in the past); anything unusable is
      dropped and flagged ``due_unresolved`` so the client asks for a correction.
    * ``location_text`` (a place that is not a room) is kept as plain text, trimmed.
    * Drafts never carry an assignee: the parser does not choose who does the work.
    """
    zone = hotel_zone(hotel_timezone)
    for task in tasks:
        rn = task.pop("room_number", None)
        task["room_id"] = _resolve_room_id(hotel_id, rn) if rn else None
        task["room_number_display"] = rn
        task["due_at"], task["due_unresolved"] = normalize_due_at(task.get("due_at"), zone)
        task.pop("assigned_to", None)
        # A place that is not a room stays text for the person to review; it is never a verified room.
        place = task.get("location_text")
        task["location_text"] = place.strip()[:255] if isinstance(place, str) and place.strip() else None


@router.post("/copilot/chat")
async def copilot_chat(
    request: CopilotChatRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    start = time.time()
    # The client's role, hint and context are untrusted: the role is the verified JWT's,
    # the hint must be on the whitelist, and every context identifier is re-checked
    # against this hotel (and, for floor staff, against their own assignments).
    intent_hint = parse_intent_hint(request.context)
    safe_context = sanitize_context(request.context)
    trusted_context = resolve_trusted_context(
        supabase, current_user.hotel_id, current_user.user_id, current_user.role, safe_context
    )
    intent = resolve_intent(detect_intent(request.message, intent_hint), intent_hint, current_user.role)
    # Only server-verified facts reach a prompt (never the client's free-text context).
    parser_context = {"room_number": trusted_context["room_number"]} if trusted_context.get("room_number") else None

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
                _finalize_parsed_tasks(
                    current_user.hotel_id, tasks, _get_hotel_context(current_user.hotel_id).get("timezone")
                )
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
                await assert_ai_allowance(current_user.hotel_id, current_user.user_id, intent_to_log)
                result = parse_nl_tasks(
                    message=request.message,
                    hotel_name=ctx["hotel_name"],
                    staff_name=current_user.user_id,
                    role=current_user.role,
                    shift_name=ctx["shift_name"],
                    shift_start=ctx["shift_start"],
                    shift_end=ctx["shift_end"],
                    context=parser_context,
                    timezone_name=ctx.get("timezone"),
                )
                prompt_tokens = result["prompt_tokens"]
                completion_tokens = result["completion_tokens"]
                credits = await check_and_deduct_credits(
                    current_user.hotel_id, intent_to_log, prompt_tokens, completion_tokens
                )
                tasks = result["tasks"]
                _finalize_parsed_tasks(current_user.hotel_id, tasks, ctx.get("timezone"))
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
            await assert_ai_allowance(current_user.hotel_id, current_user.user_id, intent_to_log)
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
            await assert_ai_allowance(current_user.hotel_id, current_user.user_id, intent_to_log)
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
            await assert_ai_allowance(current_user.hotel_id, current_user.user_id, intent_to_log)
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
            wos = safe_context.get("work_orders") or []
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
            await assert_ai_allowance(current_user.hotel_id, current_user.user_id, intent_to_log)
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
            # Answers come only from approved, indexed procedures of THIS hotel; with a document in
            # context (already verified above) they come only from that document.
            await assert_ai_allowance(current_user.hotel_id, current_user.user_id, intent_to_log)
            sop_result = await asyncio.to_thread(
                query_sop,
                query=request.message,
                hotel_id=current_user.hotel_id,
                user_id=current_user.user_id,
                document_id=trusted_context.get("document_id"),
                language=safe_context.get("language"),
                suggest_tasks=False,
            )
            prompt_tokens = sop_result.get("prompt_tokens", 0)
            completion_tokens = sop_result.get("completion_tokens", 0)
            # No model call (nothing to search, nothing relevant) means nothing to bill.
            if prompt_tokens or completion_tokens:
                credits = await check_and_deduct_credits(
                    current_user.hotel_id, intent_to_log, prompt_tokens, completion_tokens
                )
            response_payload = {
                "response_type": "answer",
                "message": sop_result["answer"],
                "sources": sop_result.get("sources", []),
                "grounded": sop_result.get("grounded", False),
                "reason": sop_result.get("reason"),
                "high_risk": sop_result.get("high_risk", False),
                "answer_language": sop_result.get("answer_language"),
                "related_documents": sop_result.get("related_documents", []),
                "credits_used": credits,
                "model_used": "claude-sonnet-4-6" if (prompt_tokens or completion_tokens) else None,
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
            anthropic.RateLimitError, anthropic.AuthenticationError, SopUnavailable,
            AIProviderConfigurationError) as exc:
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

    response_payload["intent"] = intent
    if trusted_context:
        response_payload["trusted_context"] = trusted_context

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
        await assert_ai_allowance(current_user.hotel_id, current_user.user_id, "housekeeping_briefing")
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


# A recap is only worth buying once per unchanged shift: the answer is kept per
# person + shift facts + language, so a second tap (or a second device) on the same
# facts returns it without another model call or another charge.
_RECAP_CACHE_TTL_S = 12 * 60 * 60
_RECAP_CACHE_MAX = 500
_recap_cache: dict[tuple, tuple[float, dict]] = {}


def _recap_cache_get(key: tuple) -> dict | None:
    hit = _recap_cache.get(key)
    if not hit:
        return None
    if time.time() - hit[0] > _RECAP_CACHE_TTL_S:
        _recap_cache.pop(key, None)
        return None
    return hit[1]


def _recap_cache_put(key: tuple, value: dict) -> None:
    if len(_recap_cache) >= _RECAP_CACHE_MAX:
        oldest = min(_recap_cache, key=lambda k: _recap_cache[k][0])
        _recap_cache.pop(oldest, None)
    _recap_cache[key] = (time.time(), value)


@router.post("/housekeeping/shift-summary")
async def housekeeping_shift_recap(
    request: HousekeeperShiftRecapRequest,
    current_user: CurrentUser = Depends(require_role("housekeeper", "housekeeping_supervisor")),
):
    """AI wording for the housekeeper's own end-of-shift recap.

    The facts are computed here from the authoritative tables (assignments, room
    status, completed clean sessions, the shift record), never taken from the
    client, and are returned with the wording so the app can show the verified
    numbers separately from the AI sentence. 409 means there is no completed
    work on record to write about (no model call, no charge). AI failures must
    not leak provider detail.
    """
    start = time.time()
    credits = 0
    try:
        facts = load_shift_facts(
            supabase,
            hotel_id=current_user.hotel_id,
            user_id=current_user.user_id,
            shift_date=request.shift_date,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Shift facts temporarily unavailable.") from exc

    if facts["evidence"] != "sufficient":
        raise HTTPException(status_code=409, detail="No completed work is recorded for this shift yet.")

    cache_key = (current_user.hotel_id, current_user.user_id, facts["fingerprint"], request.language)
    cached = _recap_cache_get(cache_key)
    if cached is not None:
        await record_cache_hit(current_user.hotel_id, current_user.user_id, "housekeeper_shift_recap")
        return {"data": {**cached, "facts": facts, "credits_used": 0, "cached": True}}

    try:
        await assert_ai_allowance(current_user.hotel_id, current_user.user_id, "housekeeper_shift_recap")
        result = generate_shift_recap(facts, request.language)
        credits = await check_and_deduct_credits(
            current_user.hotel_id, "housekeeper_shift_recap",
            result["prompt_tokens"], result["completion_tokens"],
        )
        latency = int((time.time() - start) * 1000)
        await log_ai_interaction(
            hotel_id=current_user.hotel_id, user_id=current_user.user_id,
            interaction_type="housekeeper_shift_recap", model_used="claude-sonnet-4-6",
            credits_charged=credits, prompt_tokens=result["prompt_tokens"],
            completion_tokens=result["completion_tokens"], latency_ms=latency, success=True,
        )
        body = {**result["recap"], "model_used": "claude-sonnet-4-6"}
        _recap_cache_put(cache_key, body)
        return {"data": {**body, "facts": facts, "credits_used": credits, "cached": False}}
    except HTTPException:
        raise
    except Exception as exc:
        latency = int((time.time() - start) * 1000)
        await log_ai_interaction(
            hotel_id=current_user.hotel_id, user_id=current_user.user_id,
            interaction_type="housekeeper_shift_recap", model_used="claude-sonnet-4-6",
            credits_charged=credits, prompt_tokens=0, completion_tokens=0,
            latency_ms=latency, success=False, error_message=str(exc),
        )
        raise HTTPException(status_code=503, detail="AI shift recap temporarily unavailable.")


@router.post("/supervisor/briefing")
async def supervisor_shift_briefing(
    request: SupervisorBriefingRequest,
    current_user: CurrentUser = Depends(require_role("housekeeping_supervisor")),
):
    """AI shift briefing for a housekeeping supervisor's floor(s).

    The mobile app sends compact room + staff-progress summaries; AI failures
    must not leak provider detail to the client.
    """
    start = time.time()
    credits = 0
    try:
        await assert_ai_allowance(current_user.hotel_id, current_user.user_id, "supervisor_briefing")
        result = generate_supervisor_briefing(
            [room.model_dump() for room in request.rooms],
            [member.model_dump() for member in request.staff],
            request.language,
        )
        credits = await check_and_deduct_credits(
            current_user.hotel_id, "supervisor_briefing",
            result["prompt_tokens"], result["completion_tokens"],
        )
        latency = int((time.time() - start) * 1000)
        await log_ai_interaction(
            hotel_id=current_user.hotel_id, user_id=current_user.user_id,
            interaction_type="supervisor_briefing", model_used="claude-sonnet-4-6",
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
            interaction_type="supervisor_briefing", model_used="claude-sonnet-4-6",
            credits_charged=credits, prompt_tokens=0, completion_tokens=0,
            latency_ms=latency, success=False, error_message=str(exc),
        )
        raise HTTPException(status_code=503, detail="AI briefing temporarily unavailable.")


@router.post("/engineer/briefing")
async def engineer_shift_briefing(
    request: EngineerBriefingRequest,
    current_user: CurrentUser = Depends(require_role("engineer", "chief_engineer")),
):
    """AI shift briefing for an engineer's open work orders and PM load.

    Mobile treats engineer and chief_engineer as one persona, so both roles
    are gated onto this endpoint. The mobile app sends compact work-order
    summaries; AI failures must not leak provider detail to the client.
    """
    start = time.time()
    credits = 0
    try:
        await assert_ai_allowance(current_user.hotel_id, current_user.user_id, "engineer_briefing")
        result = generate_engineer_briefing(
            [wo.model_dump() for wo in request.work_orders],
            request.pm_due_this_week,
            request.language,
        )
        credits = await check_and_deduct_credits(
            current_user.hotel_id, "engineer_briefing",
            result["prompt_tokens"], result["completion_tokens"],
        )
        latency = int((time.time() - start) * 1000)
        await log_ai_interaction(
            hotel_id=current_user.hotel_id, user_id=current_user.user_id,
            interaction_type="engineer_briefing", model_used="claude-sonnet-4-6",
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
            interaction_type="engineer_briefing", model_used="claude-sonnet-4-6",
            credits_charged=credits, prompt_tokens=0, completion_tokens=0,
            latency_ms=latency, success=False, error_message=str(exc),
        )
        raise HTTPException(status_code=503, detail="AI briefing temporarily unavailable.")


@router.post("/front-desk/briefing")
async def front_desk_shift_briefing(
    request: FrontDeskBriefingRequest,
    current_user: CurrentUser = Depends(require_role("front_desk")),
):
    """AI shift briefing for a front desk agent's open guest requests.

    The mobile app sends compact guest-request summaries plus readiness/arrival
    counts; AI failures must not leak provider detail to the client.
    """
    start = time.time()
    credits = 0
    try:
        await assert_ai_allowance(current_user.hotel_id, current_user.user_id, "front_desk_briefing")
        result = generate_front_desk_briefing(
            [gr.model_dump() for gr in request.guest_requests],
            request.ready_room_count,
            request.arrivals_count,
            request.vip_arrivals_count,
            request.language,
        )
        credits = await check_and_deduct_credits(
            current_user.hotel_id, "front_desk_briefing",
            result["prompt_tokens"], result["completion_tokens"],
        )
        latency = int((time.time() - start) * 1000)
        await log_ai_interaction(
            hotel_id=current_user.hotel_id, user_id=current_user.user_id,
            interaction_type="front_desk_briefing", model_used="claude-sonnet-4-6",
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
            interaction_type="front_desk_briefing", model_used="claude-sonnet-4-6",
            credits_charged=credits, prompt_tokens=0, completion_tokens=0,
            latency_ms=latency, success=False, error_message=str(exc),
        )
        raise HTTPException(status_code=503, detail="AI briefing temporarily unavailable.")


@router.get("/gm/briefing")
async def gm_shift_briefing(
    language: str = Query(default="en"),
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """AI weekly briefing for a GM, built from the same 7-day operational
    aggregate as GET /ai/insights. AI failures must not leak provider detail
    to the client."""
    start = time.time()
    credits = 0
    try:
        await assert_ai_allowance(current_user.hotel_id, current_user.user_id, "gm_briefing")
        result = generate_gm_briefing(current_user.hotel_id, language)
        credits = await check_and_deduct_credits(
            current_user.hotel_id, "gm_briefing",
            result["prompt_tokens"], result["completion_tokens"],
        )
        latency = int((time.time() - start) * 1000)
        await log_ai_interaction(
            hotel_id=current_user.hotel_id, user_id=current_user.user_id,
            interaction_type="gm_briefing", model_used="claude-sonnet-4-6",
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
            interaction_type="gm_briefing", model_used="claude-sonnet-4-6",
            credits_charged=credits, prompt_tokens=0, completion_tokens=0,
            latency_ms=latency, success=False, error_message=str(exc),
        )
        raise HTTPException(status_code=503, detail="AI briefing temporarily unavailable.")


DUPLICATE_TASK_WINDOW_SECONDS = 120


def _find_recent_duplicate_task(
    hotel_id: str, user_id: str, title: str, task_type: str, room_id: Optional[str], now
) -> Optional[dict]:
    """A task this user already created from an identical preview in the last couple of
    minutes — a double-tap or a client retry after a dropped response, not a new request."""
    since = (now - timedelta(seconds=DUPLICATE_TASK_WINDOW_SECONDS)).isoformat()
    rows = (
        supabase.table("tasks").select("*")
        .eq("tenant_id", hotel_id)
        .eq("created_by", user_id)
        .eq("title", title)
        .eq("task_type", task_type)
        .eq("is_ai_created", True)
        .neq("status", "cancelled")
        .gte("created_at", since)
        .execute()
    ).data or []
    for row in rows:
        if (row.get("room_id") or None) == room_id:
            return row
    return None


@router.post("/tasks/confirm")
async def confirm_tasks(
    tasks: list[TaskPreview],
    current_user: CurrentUser = Depends(get_current_user)
):
    """Create the tasks from reviewed AI previews. Body: a JSON **array** of TaskPreview.

    * A room is only linked when it is verified in this hotel: ``room_id`` must belong to the
      tenant, or ``room_number_display`` must resolve to one. An unresolvable room number is
      kept as plain ``location_text`` and is never treated as a verified room.
    * ``assigned_to`` (when given) must be an active staff member of this hotel and, for
      someone other than the caller, passes the reassign policy.
    * Identical previews already created by the caller within the last two minutes are
      returned instead of duplicated (``meta.deduplicated``).
    """
    require_creation_role(current_user.role)
    SLA_MINUTES = {"urgent": 60, "normal": 240, "low": 480}
    if not tasks:
        raise HTTPException(status_code=422, detail="At least one task is required")
    if len(tasks) > 20:
        raise HTTPException(status_code=422, detail="Too many tasks in one request")
    for task in tasks:
        assigned_to = str(task.assigned_to) if task.assigned_to else None
        if assigned_to and assigned_to != current_user.user_id:
            permitted, reason = check_action_permitted("reassign_other_staff_task", current_user.role)
            if not permitted:
                raise HTTPException(status_code=403, detail=reason)

    # Validate every preview before the first write so a bad item never leaves a partial batch.
    prepared = []
    for task in tasks:
        room_id = str(task.room_id) if task.room_id else None
        location_text = None
        if room_id:
            room_check = supabase.table("rooms").select("id")                .eq("id", room_id)                .eq("tenant_id", current_user.hotel_id)                .maybe_single().execute()
            if not (room_check and room_check.data):
                raise HTTPException(status_code=400, detail="Room not found in your hotel")
        elif task.room_number_display:
            room_id = _resolve_room_id(current_user.hotel_id, task.room_number_display)
            if not room_id:
                location_text = task.room_number_display
        assigned_to = str(task.assigned_to) if task.assigned_to else None
        if assigned_to:
            staff_check = supabase.table("user_roles").select("id")                .eq("user_id", assigned_to)                .eq("tenant_id", current_user.hotel_id)                .eq("is_active", True)                .limit(1).execute()
            if not staff_check.data:
                raise HTTPException(status_code=400, detail="Assignee not found in your hotel")
        prepared.append((task, room_id, location_text, assigned_to))

    created = []
    deduplicated = 0
    now = datetime.now(timezone.utc)
    for task, room_id, location_text, assigned_to in prepared:
        duplicate = _find_recent_duplicate_task(
            current_user.hotel_id, current_user.user_id, task.title, task.task_type, room_id, now
        )
        if duplicate:
            deduplicated += 1
            created.append(duplicate)
            continue
        priority = task.priority
        sla = SLA_MINUTES.get(priority, 240)
        due_at = task.due_at or (now + timedelta(minutes=sla)).isoformat()
        row = {
            "tenant_id": current_user.hotel_id,
            "title": task.title,
            "description": task.description,
            "task_type": task.task_type,
            "priority": priority,
            "room_id": room_id,
            "location_text": location_text,
            "due_at": due_at,
            "sla_minutes": sla,
            "created_by": current_user.user_id,
            "is_ai_created": True,
        }
        if assigned_to:
            row["assigned_to"] = assigned_to
            row["assigned_by"] = current_user.user_id
        result = supabase.table("tasks").insert(row).execute()
        if result.data:
            created.append(result.data[0])
    return {
        "data": {"created_count": len(created), "tasks": created},
        "meta": {"deduplicated": deduplicated},
    }


MAX_CONFIRM_BATCH = 20


def _verified_room_id(hotel_id: str, room_id: Optional[str], room_number: Optional[str]) -> Optional[str]:
    """A room reference on an AI preview, proven to belong to this hotel.

    ``room_id`` (when the preview carries one) must be a room of this hotel; otherwise
    ``room_number`` must resolve to one. A reference that cannot be verified is refused
    rather than saved as an unlinked record, so the person can correct the preview.
    """
    if room_id:
        found = (
            supabase.table("rooms").select("id")
            .eq("id", room_id).eq("tenant_id", hotel_id)
            .limit(1).execute()
        ).data or []
        if not found:
            raise HTTPException(status_code=400, detail="Room not found in your hotel")
        return found[0]["id"]
    if room_number:
        resolved = _resolve_room_id(hotel_id, room_number)
        if not resolved:
            raise HTTPException(status_code=400, detail=f"Room {room_number} was not found in your hotel")
        return resolved
    return None


def _check_batch(items: list) -> None:
    if not items:
        raise HTTPException(status_code=422, detail="At least one item is required")
    if len(items) > MAX_CONFIRM_BATCH:
        raise HTTPException(status_code=422, detail="Too many items in one request")


@router.post("/work-orders/confirm")
async def confirm_work_orders(
    work_orders: list[WorkOrderPreview],
    current_user: CurrentUser = Depends(get_current_user)
):
    """Create work orders from reviewed AI previews. Body: a JSON **array** of WorkOrderPreview.

    * Every room reference is verified against this hotel before the first write, so a bad
      preview never leaves a partial batch.
    * ``client_request_id`` makes a retried confirm return the work order the first attempt
      created (``meta.deduplicated``) -- the same key and unique index POST /work-orders uses.
    """
    require_creation_role(current_user.role)
    _check_batch(work_orders)

    prepared = []
    for wo in work_orders:
        replayed = _find_replayed_work_order(wo.client_request_id, current_user) if wo.client_request_id else None
        room_id = None if replayed else _verified_room_id(
            current_user.hotel_id, str(wo.room_id) if wo.room_id else None, wo.room_number
        )
        prepared.append((wo, room_id, replayed))

    created = []
    deduplicated = 0
    for wo, room_id, replayed in prepared:
        if replayed:
            deduplicated += 1
            created.append(replayed)
            continue
        sla = WORK_ORDER_SLA_MINUTES.get(wo.priority, 240)
        row = {
            "tenant_id": current_user.hotel_id,
            "title": wo.title,
            "description": wo.description,
            "category": wo.category,
            "priority": wo.priority,
            "room_id": room_id,
            "location_text": wo.location_text,
            "sla_minutes": sla,
            "due_at": (datetime.now(timezone.utc) + timedelta(minutes=sla)).isoformat(),
            "created_by": current_user.user_id,
            "is_ai_created": True,
        }
        if wo.client_request_id:
            row["client_request_id"] = str(wo.client_request_id)
        try:
            result = supabase.table("work_orders").insert(row).execute()
        except Exception as exc:
            if wo.client_request_id and _is_unique_violation(exc, "work_orders_client_request_uniq"):
                winner = _find_replayed_work_order(wo.client_request_id, current_user)
                if winner:
                    deduplicated += 1
                    created.append(winner)
                    continue
            raise
        if result.data:
            _seed_checklist_from_template(result.data[0]["id"], wo.category, current_user.hotel_id)
            created.append(result.data[0])
    if not created:
        raise HTTPException(status_code=502, detail="The work order could not be created.")
    return {
        "data": {"created_count": len(created), "work_orders": created},
        "meta": {"deduplicated": deduplicated},
    }


@router.post("/photo-analysis")
async def analyze_issue_photo(
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    room_id: Optional[str] = Form(None),
    current_user: CurrentUser = Depends(require_feature("hk_ai_photo_analysis")),
):
    """Suggest a work-order category and a short description from ONE photo the employee chose to send.

    A suggestion only: this creates, assigns and escalates nothing, and the photo is analysed in memory and
    never stored. The upload is validated from its own bytes (type, size, dimensions), re-encoded without
    metadata, and billed from the provider's real token usage like every other AI call.
    """
    start = time.time()
    require_creation_role(current_user.role)
    note = (description or "").strip()[:MAX_NOTE_CHARS]
    if room_id:
        # Same checks as the chat: a room of THIS hotel and, for a housekeeper, one they are assigned today.
        context = sanitize_context({"room_id": room_id})
        resolve_trusted_context(supabase, current_user.hotel_id, current_user.user_id, current_user.role, context)

    data = await file.read(MAX_UPLOAD_BYTES + 1)
    try:
        jpeg = prepare_image(data)
    except PhotoRejected as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))

    credits = 0
    prompt_tokens = 0
    completion_tokens = 0
    try:
        await assert_ai_allowance(current_user.hotel_id, current_user.user_id, "photo_analysis")
        result = await asyncio.to_thread(analyze_photo, jpeg, note)
        prompt_tokens = result["prompt_tokens"]
        completion_tokens = result["completion_tokens"]
        credits = await check_and_deduct_credits(current_user.hotel_id, "photo_analysis", prompt_tokens, completion_tokens)
    except HTTPException:
        raise
    except (openai.RateLimitError, openai.AuthenticationError, AIProviderConfigurationError, openai.APIConnectionError, openai.APIStatusError) as exc:
        await _log_photo_analysis(current_user, credits, 0, 0, start, False, str(exc))
        raise HTTPException(status_code=503, detail="AI photo analysis is temporarily unavailable. You can still report the issue yourself.")
    except Exception as exc:
        await _log_photo_analysis(current_user, credits, 0, 0, start, False, str(exc))
        logger.exception("AI photo analysis failed hotel=%s", current_user.hotel_id)
        raise HTTPException(status_code=500, detail="AI photo analysis is temporarily unavailable. You can still report the issue yourself.")

    await _log_photo_analysis(current_user, credits, prompt_tokens, completion_tokens, start, True, None)
    return {
        "data": {
            "outcome": result["outcome"],
            "observation": result["observation"],
            "suggested_category": result["category"],
            "question": result["question"],
            "is_suggestion": True,
            "retained": False,
            "credits_used": credits,
            "model_used": "gpt-4o-mini",
        }
    }


@router.post("/tasks/{task_id}/translate")
async def translate_task_instructions(
    task_id: str,
    request: TaskTranslationRequest,
    current_user: CurrentUser = Depends(require_feature("hk_ai_task_translation")),
):
    """Translate ONE task's title and description for the person who may see it. Read-only: the stored task,
    its status and everything else about it are untouched, and the original text is returned beside the
    translation so it can always be shown. A cached translation is reused only while the task text is unchanged.
    """
    start = time.time()
    require_creation_role(current_user.role)
    # Same gate as using a task as assistant context: this hotel's task, and for floor staff one that is theirs.
    context = sanitize_context({"task_id": task_id})
    resolve_trusted_context(supabase, current_user.hotel_id, current_user.user_id, current_user.role, context)
    row = (
        supabase.table("tasks").select("id, title, description")
        .eq("id", context["task_id"]).eq("tenant_id", current_user.hotel_id).limit(1).execute()
    ).data or []
    if not row:
        raise HTTPException(status_code=404, detail="Record not found.")
    title, description = row[0].get("title") or "", row[0].get("description")
    source_hash = task_source_hash(title, description)
    original = {"title": title, "description": description}

    try:
        cached = (
            supabase.table("ai_content_translations").select("translated_title, translated_body")
            .eq("tenant_id", current_user.hotel_id).eq("source_type", "task").eq("source_id", context["task_id"])
            .eq("source_hash", source_hash).eq("target_language", request.target_language).limit(1).execute()
        ).data or []
    except Exception:
        cached = []
        logger.warning("Translation cache unreadable hotel=%s", current_user.hotel_id, exc_info=True)
    if cached:
        await record_cache_hit(current_user.hotel_id, current_user.user_id, "translation")
        return {"data": {
            "original": original, "translated": {"title": cached[0]["translated_title"], "description": cached[0].get("translated_body")},
            "target_language": request.target_language, "cached": True, "ai_generated": True, "credits_used": 0,
        }}

    credits, prompt_tokens, completion_tokens = 0, 0, 0
    try:
        await assert_ai_allowance(current_user.hotel_id, current_user.user_id, "translation")
        result = await asyncio.to_thread(translate_task_fields, title, description, request.target_language)
        prompt_tokens, completion_tokens = result["prompt_tokens"], result["completion_tokens"]
        credits = await check_and_deduct_credits(current_user.hotel_id, "translation", prompt_tokens, completion_tokens)
    except HTTPException:
        raise
    except (openai.RateLimitError, openai.AuthenticationError, AIProviderConfigurationError, openai.APIConnectionError, openai.APIStatusError) as exc:
        await _log_ai_call(current_user, "translation", credits, 0, 0, start, False, str(exc))
        raise HTTPException(status_code=503, detail="Translation is temporarily unavailable. The original instructions are unchanged.")
    except Exception as exc:
        await _log_ai_call(current_user, "translation", credits, 0, 0, start, False, str(exc))
        logger.exception("Task translation failed hotel=%s", current_user.hotel_id)
        raise HTTPException(status_code=500, detail="Translation is temporarily unavailable. The original instructions are unchanged.")

    try:
        supabase.table("ai_content_translations").insert({
            "tenant_id": current_user.hotel_id, "source_type": "task", "source_id": context["task_id"],
            "source_hash": source_hash, "target_language": request.target_language,
            "translated_title": result["title"], "translated_body": result["description"],
            "provider": "openai:gpt-4o-mini",
        }).execute()
    except Exception:
        # A cache miss next time costs one more translation; it must not fail this one.
        logger.warning("Could not cache task translation hotel=%s", current_user.hotel_id, exc_info=True)

    await _log_ai_call(current_user, "translation", credits, prompt_tokens, completion_tokens, start, True, None)
    return {"data": {
        "original": original, "translated": {"title": result["title"], "description": result["description"]},
        "target_language": request.target_language, "cached": False, "ai_generated": True,
        "credits_used": credits, "model_used": "gpt-4o-mini",
    }}


async def _log_ai_call(current_user, interaction_type, credits, prompt_tokens, completion_tokens, start, success, error):
    """Record a call without letting a bookkeeping failure turn a finished call into an error."""
    try:
        await log_ai_interaction(
            hotel_id=current_user.hotel_id, user_id=current_user.user_id,
            interaction_type=interaction_type, model_used="gpt-4o-mini",
            credits_charged=credits, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
            latency_ms=int((time.time() - start) * 1000), success=success, error_message=error,
        )
    except Exception:
        logger.warning("Could not log the %s interaction hotel=%s", interaction_type, current_user.hotel_id, exc_info=True)


async def _log_photo_analysis(current_user, credits, prompt_tokens, completion_tokens, start, success, error):
    """Record the call without letting a bookkeeping failure turn a finished analysis into an error."""
    try:
        await log_ai_interaction(
            hotel_id=current_user.hotel_id, user_id=current_user.user_id,
            interaction_type="photo_analysis", model_used="gpt-4o-mini",
            credits_charged=credits, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
            latency_ms=int((time.time() - start) * 1000), success=success, error_message=error,
        )
    except Exception:
        logger.warning("Could not log the photo-analysis interaction hotel=%s", current_user.hotel_id, exc_info=True)


def _find_recent_duplicate_guest_request(
    hotel_id: str, user_id: str, title: str, room_id: Optional[str], now
) -> Optional[dict]:
    """A guest request this user already logged from an identical preview in the last couple of
    minutes -- a double-tap or a retry after a dropped response, not a second request."""
    since = (now - timedelta(seconds=DUPLICATE_TASK_WINDOW_SECONDS)).isoformat()
    rows = (
        supabase.table("guest_requests").select("*")
        .eq("tenant_id", hotel_id)
        .eq("created_by", user_id)
        .eq("title", title)
        .neq("status", "cancelled")
        .gte("created_at", since)
        .execute()
    ).data or []
    for row in rows:
        if (row.get("room_id") or None) == room_id:
            return row
    return None


@router.post("/guest-requests/confirm")
async def confirm_guest_requests(
    requests: list[GuestRequestPreview],
    current_user: CurrentUser = Depends(get_current_user)
):
    """Log guest requests from reviewed AI previews. Body: a JSON **array** of GuestRequestPreview.

    Rooms are verified against this hotel before any write, and an identical preview from the
    same person within two minutes is returned instead of duplicated (``meta.deduplicated``).
    """
    require_creation_role(current_user.role)
    _check_batch(requests)
    # Fail-fast validation before any writes — matches create_guest_request's contract.
    for req in requests:
        if req.category == "accessibility" and req.priority != "urgent":
            raise HTTPException(status_code=422, detail="Accessibility-related requests must use urgent priority")
    prepared = [
        (req, _verified_room_id(current_user.hotel_id, str(req.room_id) if req.room_id else None, req.room_number))
        for req in requests
    ]

    created = []
    deduplicated = 0
    for req, room_id in prepared:
        now = datetime.now(timezone.utc)
        duplicate = _find_recent_duplicate_guest_request(
            current_user.hotel_id, current_user.user_id, req.title, room_id, now
        )
        if duplicate:
            deduplicated += 1
            created.append(duplicate)
            continue
        policies = supabase.table("guest_request_sla_policies").select(
            "category, priority, guest_impact, sla_minutes"
        ).eq("tenant_id", current_user.hotel_id).execute().data or []
        sla_minutes = resolve_sla_minutes(
            policies, category=req.category, priority=req.priority, guest_impact=req.guest_impact,
        )
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
    if not created:
        raise HTTPException(status_code=502, detail="The guest request could not be logged.")
    return {
        "data": {"created_count": len(created), "requests": created},
        "meta": {"deduplicated": deduplicated},
    }


@router.post("/assignments/confirm")
async def confirm_assignments(
    assignments: list[AssignmentPreview],
    # Same authority as the domain's room-assignment routes (housekeeping.py): GM and housekeeping supervisor.
    # Line engineers have no housekeeping assignment authority, so the AI confirm must not grant it.
    current_user: CurrentUser = Depends(require_role("housekeeping_supervisor", "gm"))
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
    """Real-time, deterministic exception feed for the GM dashboard -- unlike
    the cron-driven shift_summary AI narrative (which mentions similar signals
    inside a paragraph 3x/day), this recomputes on every request with no AI
    credit cost, so it's always current and each item links straight to the
    room/WO/part/request that needs attention."""
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

    low_stock_parts = get_low_stock_parts_summary(current_user.hotel_id)

    guest_issues = supabase.table("guest_requests")\
        .select("id, title, description, room_id, rooms(room_number)")\
        .eq("tenant_id", current_user.hotel_id)\
        .not_.in_("status", ["resolved", "verified", "cancelled"])\
        .limit(10)\
        .execute()

    recurring = await get_recurring_issues(days=30, min_count=3, current_user=current_user)

    return {
        "data": {
            "housekeeping_risks": room_risks.data or [],
            "maintenance_risks": asset_risks.data or [],
            "sla_breaches": sla_breaches.data or [],
            "low_stock_parts": low_stock_parts,
            "pending_guest_issues": guest_issues.data or [],
            "recurring_issues": recurring["data"],
        }
    }


# What the app may offer this hotel's staff, so a switched-off AI feature leaves no dead button. The server
# still enforces the backend-enforced flags on their own routes; this only tells the phone what to show.
CAPABILITY_FLAGS = {
    "unified_assistant": "hk_ai_assistant",
    "photo_analysis": "hk_ai_photo_analysis",
    "task_translation": "hk_ai_task_translation",
}


@router.get("/capabilities")
async def get_ai_capabilities(current_user: CurrentUser = Depends(get_current_user)):
    return {"data": {name: is_feature_enabled(current_user.hotel_id, key) for name, key in CAPABILITY_FLAGS.items()}}


@router.get("/usage")
async def get_ai_usage(
    days: int = Query(30, ge=1, le=90),
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """This hotel's AI usage for the last `days` days, from the existing `ai_interactions` audit log.

    GM-only and always scoped to the caller's own hotel. Counts, tokens, credits, latency, cap refusals and
    cache hits per feature and per model; no message text, no person identifiers. The dollar figure is an
    estimate from recorded tokens (the provider's invoice is authoritative) and unmetered requests are
    listed rather than treated as free.
    """
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    result = (
        supabase.table("ai_interactions")
        .select("interaction_type, model_used, prompt_tokens, completion_tokens, credits_charged, latency_ms, success, error_message")
        .eq("tenant_id", current_user.hotel_id)
        .gte("created_at", since)
        .order("created_at", desc=True)
        .limit(USAGE_ROW_LIMIT)
        .execute()
    )
    rows = result.data or []
    return {"data": {**summarize_usage(rows), "window_days": days, "truncated": len(rows) >= USAGE_ROW_LIMIT}}


@router.get("/insights")
async def get_gm_insights(current_user: CurrentUser = Depends(get_current_user)):
    # Hotel-wide operational analysis is GM-only (same rule as the chat insight intent).
    if current_user.role not in GM_ONLY_ROLES:
        raise HTTPException(status_code=403, detail=PERMISSION_DENIED)
    credits = 0
    start = time.time()
    await assert_ai_allowance(current_user.hotel_id, current_user.user_id, "gm_insight")
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

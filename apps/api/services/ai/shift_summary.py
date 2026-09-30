"""AI Shift Handoff service — generates a structured, operationally-grounded
shift handoff for the incoming shift using Claude Sonnet.

Split into composable stages (Phase 5) so context collection, the shift time
window, and prompt construction are all testable without an Anthropic call:
  build_shift_window()            -> real UTC [start, end) for a shift/date
  collect_shift_handoff_context() -> every data source, tenant-scoped
  build_shift_summary_prompt()    -> the narrative prompt (facts only)
  generate_or_get_shift_summary() -> idempotent "Generate" (no dup AI call)
  regenerate_shift_summary()      -> forced "Regenerate" (upserts in place)

Both call through _perform_generation() so cron and manual generation, and
Generate vs Regenerate, can never diverge in how a row is built or stored.
"""
from datetime import datetime, time as time_cls, timedelta, timezone
import time as time_module
from typing import Optional

from dateutil import tz as dateutil_tz
from fastapi import HTTPException

from core.database import supabase
from middleware.credits import check_and_deduct_credits, log_ai_interaction
from services.ai.providers import get_anthropic_client

MODEL_NAME = "claude-sonnet-4-6"

STATS_KEYS = (
    "tasks_completed",
    "open_work_orders",
    "logbook_entries_count",
    "vip_arrivals_count",
    "pending_guest_issues_count",
    "low_stock_parts_count",
    "sla_breaches_count",
    "follow_up_count",
)


def _get_hotel_tz(hotel_id: str):
    result = supabase.table("tenants").select("timezone").eq("id", hotel_id).maybe_single().execute()
    tz_name = ((result.data if result else None) or {}).get("timezone") or "America/Chicago"
    return dateutil_tz.gettz(tz_name) or dateutil_tz.gettz("America/Chicago")


def hotel_today(hotel_id: str) -> str:
    return datetime.now(_get_hotel_tz(hotel_id)).date().isoformat()


def _parse_time(value) -> time_cls:
    hours, minutes, *_ = str(value).split(":")
    return time_cls(int(hours), int(minutes))


def build_shift_window(hotel_id: str, shift: dict, shift_date: str) -> tuple[datetime, datetime]:
    """Real UTC [start, end) instant for a shift on a hotel-local calendar date.

    Overnight shifts (end_time <= start_time) end on the following local day —
    e.g. Night 23:00->07:00 on 2026-09-29 runs through 2026-09-30 07:00 local.
    """
    tz = _get_hotel_tz(hotel_id)
    base_date = datetime.strptime(shift_date, "%Y-%m-%d").date()
    start_time = _parse_time(shift.get("start_time"))
    end_time = _parse_time(shift.get("end_time"))

    start_local = datetime.combine(base_date, start_time, tzinfo=tz)
    end_date = base_date if end_time > start_time else base_date + timedelta(days=1)
    end_local = datetime.combine(end_date, end_time, tzinfo=tz)

    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def collect_shift_handoff_context(hotel_id: str, shift_id: str, shift_date: str, shift: dict) -> dict:
    """Gather every operational data source for one shift/date. Pure data
    collection — no AI call, fully unit-testable. Every query is tenant-scoped."""
    start_at, end_at = build_shift_window(hotel_id, shift, shift_date)
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    # Logbook entries for this exact shift occurrence (template + calendar date),
    # excluding archived/expired entries.
    logbook_result = supabase.table("logbook_entries")\
        .select("id, content, created_at, author_id, category, status, priority, "
                "follow_up_at, assigned_to, related_type, related_id")\
        .eq("tenant_id", hotel_id)\
        .eq("shift_id", shift_id)\
        .eq("entry_date", shift_date)\
        .is_("archived_at", "null")\
        .or_(f"expires_at.is.null,expires_at.gt.{now_iso}")\
        .order("created_at", desc=False)\
        .execute()
    logbook_entries = logbook_result.data or []

    follow_ups = [e for e in logbook_entries if e.get("status") == "follow_up"]

    # Tasks completed within the shift's real time window (not the calendar day).
    tasks_result = supabase.table("tasks")\
        .select("id, title, status, priority, task_type, completed_at")\
        .eq("tenant_id", hotel_id)\
        .eq("status", "completed")\
        .gte("completed_at", start_at.isoformat())\
        .lt("completed_at", end_at.isoformat())\
        .execute()
    completed_tasks = tasks_result.data or []

    # Open work orders — a current-state snapshot at generation time, not a
    # shift-window query (open work is ongoing, not shift-bounded).
    wo_result = supabase.table("work_orders")\
        .select("id, title, priority, category, status, due_at, rooms(room_number)")\
        .eq("tenant_id", hotel_id)\
        .in_("status", ["open", "in_progress", "on_hold"])\
        .execute()
    open_work_orders = wo_result.data or []

    # VIP arrivals — DEP-turnover rooms flagged VIP (hotel-agnostic arrival
    # proxy; no Opera-synced reservation/arrival table exists yet).
    vip_result = supabase.table("room_status")\
        .select("vip_flag, clean_type, room_id, rooms!inner(room_number)")\
        .eq("tenant_id", hotel_id)\
        .eq("clean_type", "DEP")\
        .eq("vip_flag", True)\
        .execute()
    vip_arrivals = [
        {"room_id": r.get("room_id"), "room_number": (r.get("rooms") or {}).get("room_number")}
        for r in (vip_result.data or [])
        if (r.get("rooms") or {}).get("room_number")
    ]

    # Pending guest issues — non-terminal guest requests.
    guest_result = supabase.table("guest_requests")\
        .select("id, title, description, status, due_at, room_id, rooms(room_number)")\
        .eq("tenant_id", hotel_id)\
        .not_.in_("status", ["resolved", "verified", "cancelled"])\
        .execute()
    pending_guest_issues = guest_result.data or []

    # Low-stock engineering parts — total on-hand < minimum_stock.
    parts_result = supabase.table("engineering_parts")\
        .select("id, name, minimum_stock")\
        .eq("tenant_id", hotel_id)\
        .eq("is_active", True)\
        .execute()
    parts = parts_result.data or []
    part_ids = [p["id"] for p in parts]
    on_hand: dict[str, float] = {}
    if part_ids:
        stock_result = supabase.table("engineering_part_stock")\
            .select("part_id, quantity")\
            .eq("tenant_id", hotel_id)\
            .in_("part_id", part_ids)\
            .execute()
        for row in (stock_result.data or []):
            on_hand[row["part_id"]] = on_hand.get(row["part_id"], 0.0) + float(row.get("quantity") or 0)
    low_stock_parts = [
        {"id": p["id"], "name": p.get("name", ""), "quantity_on_hand": on_hand.get(p["id"], 0.0),
         "minimum_stock": float(p.get("minimum_stock") or 0)}
        for p in parts
        if on_hand.get(p["id"], 0.0) < float(p.get("minimum_stock") or 0)
    ]

    # SLA breaches — overdue open/in_progress work orders + tasks.
    wo_breach_result = supabase.table("work_orders")\
        .select("id, title, due_at")\
        .eq("tenant_id", hotel_id)\
        .in_("status", ["open", "in_progress"])\
        .lt("due_at", now_iso)\
        .execute()
    task_breach_result = supabase.table("tasks")\
        .select("id, title, due_at")\
        .eq("tenant_id", hotel_id)\
        .in_("status", ["open", "in_progress"])\
        .lt("due_at", now_iso)\
        .execute()
    def _sla_snapshot_item(item_type: str, item: dict) -> dict:
        due_at = item.get("due_at")
        overdue_minutes = None
        if due_at:
            try:
                due = datetime.fromisoformat(str(due_at).replace("Z", "+00:00"))
                overdue_minutes = max(0, int((now - due.astimezone(timezone.utc)).total_seconds() // 60))
            except (TypeError, ValueError):
                # Keep the source record available even when legacy data carries
                # an unparsable due time; never invent a duration.
                pass
        return {"type": item_type, "id": item["id"], "title": item.get("title", ""),
                "due_at": due_at, "overdue_minutes": overdue_minutes}

    sla_breaches = [
        _sla_snapshot_item("work_order", wo) for wo in (wo_breach_result.data or [])
    ] + [
        _sla_snapshot_item("task", task) for task in (task_breach_result.data or [])
    ]

    return {
        "start_at": start_at.isoformat(),
        "end_at": end_at.isoformat(),
        "logbook_entries": logbook_entries,
        "follow_ups": follow_ups,
        "completed_tasks": completed_tasks,
        "open_work_orders": open_work_orders,
        "vip_arrivals": vip_arrivals,
        "pending_guest_issues": pending_guest_issues,
        "low_stock_parts": low_stock_parts,
        "sla_breaches": sla_breaches,
    }


def build_shift_summary_prompt(shift_name: str, dept_name: str, shift_date: str, context: dict) -> str:
    log_text = "\n".join([
        f"- [{e.get('created_at', '')[:16]}] ({e.get('category', 'general')}/{e.get('status', 'informational')}) "
        f"{e.get('content', '')}"
        for e in context["logbook_entries"]
    ]) or "No logbook entries recorded."

    follow_up_text = "\n".join([
        f"- {f.get('content', '')} (priority: {f.get('priority', 'normal')}"
        + (f", due {f['follow_up_at']}" if f.get("follow_up_at") else "") + ")"
        for f in context["follow_ups"]
    ]) or "No staff-flagged follow-ups."

    tasks_text = "\n".join([
        f"- {t.get('title', '')} ({t.get('priority', 'normal')} priority, {t.get('task_type', '')})"
        for t in context["completed_tasks"][:20]
    ]) or "No tasks completed."

    wo_text = "\n".join([
        f"- {wo.get('title', '')} [{(wo.get('priority') or 'normal').upper()}] {wo.get('category', '')} — {wo.get('status', '')}"
        for wo in context["open_work_orders"][:10]
    ]) or "No open work orders."

    vip_text = "\n".join([
        f"- Room {v['room_number']}" for v in context["vip_arrivals"][:10]
    ]) or "No VIP arrivals flagged."

    guest_issues_text = "\n".join([
        f"- {(g.get('title') or g.get('description') or 'Guest request')} (status: {g.get('status', '')})"
        for g in context["pending_guest_issues"][:10]
    ]) or "No pending guest issues."

    low_stock_text = "\n".join([
        f"- {p['name']}" for p in context["low_stock_parts"][:10]
    ]) or "No low-stock parts."

    sla_text = "\n".join([
        f"- ({b['type']}) {b['title']}" for b in context["sla_breaches"][:10]
    ]) or "No SLA breaches."

    return f"""You are a hotel operations AI assistant. Generate a concise shift handoff for the incoming shift.

Shift: {shift_name} ({dept_name}) — {shift_date}

LOGBOOK ENTRIES:
{log_text}

STAFF-FLAGGED FOLLOW-UPS (explicit action items marked by this shift's staff):
{follow_up_text}

TASKS COMPLETED THIS SHIFT:
{tasks_text}

OPEN WORK ORDERS (requiring attention):
{wo_text}

VIP ARRIVALS:
{vip_text}

PENDING GUEST ISSUES:
{guest_issues_text}

LOW-STOCK PARTS:
{low_stock_text}

SLA BREACHES (overdue work orders & tasks):
{sla_text}

Write a professional 3-4 paragraph shift handoff that:
1. Gives a concise overall shift status
2. Highlights important operational incidents from the logbook
3. Identifies unresolved guest/service issues
4. Calls out the staff-flagged follow-ups above
5. Identifies open engineering/work-order concerns and meaningful SLA breaches
6. Mentions VIP preparation and low-stock risks where relevant
7. Distinguishes completed work from still-open work

Use only the supplied operational data above. Do not infer occupancy, guest
sentiment, staffing conditions, or incident severity unless explicitly present
in the data. Keep it concise, factual, and actionable."""


def _build_stats(context: dict) -> dict:
    return {
        "tasks_completed": len(context["completed_tasks"]),
        "open_work_orders": len(context["open_work_orders"]),
        "logbook_entries_count": len(context["logbook_entries"]),
        "vip_arrivals_count": len(context["vip_arrivals"]),
        "pending_guest_issues_count": len(context["pending_guest_issues"]),
        "low_stock_parts_count": len(context["low_stock_parts"]),
        "sla_breaches_count": len(context["sla_breaches"]),
        "follow_up_count": len(context["follow_ups"]),
        "model_used": MODEL_NAME,
    }


def _build_handoff_data(context: dict) -> dict:
    """Structured snapshot stored alongside the narrative — the drawer's detail
    sections render from this, never from re-querying live data or the AI text."""
    return {
        "logbook": {
            "entry_count": len(context["logbook_entries"]),
            "follow_up_count": len(context["follow_ups"]),
        },
        "tasks_completed": [
            {"id": t.get("id"), "title": t.get("title"), "task_type": t.get("task_type"),
             "completed_at": t.get("completed_at")}
            for t in context["completed_tasks"]
        ],
        "open_work_orders": [
            {"id": wo.get("id"), "title": wo.get("title"),
             "room_number": (wo.get("rooms") or {}).get("room_number"),
             "status": wo.get("status"), "priority": wo.get("priority"), "due_at": wo.get("due_at")}
            for wo in context["open_work_orders"]
        ],
        "guest_issues": [
            {"id": g.get("id"), "title": g.get("title") or g.get("description"),
             "room_number": (g.get("rooms") or {}).get("room_number"),
             "status": g.get("status"), "due_at": g.get("due_at")}
            for g in context["pending_guest_issues"]
        ],
        "vip_arrivals": context["vip_arrivals"],
        "low_stock_parts": context["low_stock_parts"],
        "sla_breaches": context["sla_breaches"],
        "follow_ups": [
            {"logbook_entry_id": f.get("id"), "content": f.get("content"),
             "priority": f.get("priority"), "assigned_to": f.get("assigned_to"),
             "follow_up_at": f.get("follow_up_at"), "related_type": f.get("related_type"),
             "related_id": f.get("related_id")}
            for f in context["follow_ups"]
        ],
    }


async def _perform_generation(
    hotel_id: str, shift_id: str, shift_date: str, user_id: Optional[str],
    existing_row: Optional[dict], is_regenerate: bool,
) -> dict:
    shift_result = supabase.table("shifts")\
        .select("name, start_time, end_time, department_id, departments(name)")\
        .eq("id", shift_id)\
        .eq("tenant_id", hotel_id)\
        .maybe_single()\
        .execute()
    shift = (shift_result.data if shift_result else None) or {}
    shift_name = shift.get("name", "Shift")
    department_id = shift.get("department_id")
    dept_name = (shift.get("departments") or {}).get("name", "All Departments") if shift.get("departments") else "All Departments"

    context = collect_shift_handoff_context(hotel_id, shift_id, shift_date, shift)
    prompt = build_shift_summary_prompt(shift_name, dept_name, shift_date, context)

    started_at = time_module.time()
    client = get_anthropic_client()
    try:
        message = client.messages.create(
            model=MODEL_NAME,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as exc:
        latency_ms = int((time_module.time() - started_at) * 1000)
        await log_ai_interaction(
            hotel_id=hotel_id, user_id=user_id, interaction_type="shift_summary",
            model_used=MODEL_NAME, credits_charged=0.0, latency_ms=latency_ms,
            success=False, error_message=str(exc),
        )
        raise HTTPException(
            status_code=503,
            detail="Unable to generate the handoff right now. Existing Logbook entries and operational data are still available.",
        ) from exc

    summary_text = message.content[0].text
    usage = getattr(message, "usage", None)
    prompt_tokens = getattr(usage, "input_tokens", 0) or 0
    completion_tokens = getattr(usage, "output_tokens", 0) or 0

    stats = _build_stats(context)
    handoff_data = _build_handoff_data(context)
    now_iso = datetime.now(timezone.utc).isoformat()

    row_payload = {
        "tenant_id": hotel_id,
        "shift_id": shift_id,
        "shift_date": shift_date,
        "department_id": department_id,
        "summary_text": summary_text,
        "stats": stats,
        "handoff_data": handoff_data,
        "generated_at": now_iso,
        "updated_at": now_iso,
    }
    if is_regenerate:
        row_payload["acknowledged_by"] = None
        row_payload["acknowledged_at"] = None

    result = supabase.table("shift_summaries")\
        .upsert(row_payload, on_conflict="tenant_id,shift_id,shift_date")\
        .execute()
    row = (result.data or [{}])[0] if result.data else {**row_payload, "id": (existing_row or {}).get("id")}

    credits_charged = await check_and_deduct_credits(hotel_id, "shift_summary", prompt_tokens, completion_tokens)
    latency_ms = int((time_module.time() - started_at) * 1000)
    await log_ai_interaction(
        hotel_id=hotel_id, user_id=user_id, interaction_type="shift_summary",
        model_used=MODEL_NAME, credits_charged=credits_charged,
        prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
        latency_ms=latency_ms, success=True,
    )

    return {**row, "was_generated": True}


def _find_existing_summary(hotel_id: str, shift_id: str, shift_date: str) -> Optional[dict]:
    result = supabase.table("shift_summaries")\
        .select("*")\
        .eq("tenant_id", hotel_id)\
        .eq("shift_id", shift_id)\
        .eq("shift_date", shift_date)\
        .maybe_single()\
        .execute()
    return (result.data if result else None) or None


async def generate_or_get_shift_summary(hotel_id: str, shift_id: str, shift_date: str, user_id: Optional[str] = None) -> dict:
    """'Generate' semantics: return the existing summary untouched (no AI call,
    no credit charge) if one already exists for this shift/date; otherwise
    generate fresh. Used by both the manual endpoint and the cron job."""
    existing = _find_existing_summary(hotel_id, shift_id, shift_date)
    if existing:
        return {**existing, "was_generated": False}
    return await _perform_generation(hotel_id, shift_id, shift_date, user_id, existing_row=None, is_regenerate=False)


async def regenerate_shift_summary(hotel_id: str, shift_id: str, shift_date: str, user_id: Optional[str] = None) -> dict:
    """'Regenerate' semantics: always call the AI again and upsert the same
    logical row in place — never a duplicate — clearing any prior acknowledgment."""
    existing = _find_existing_summary(hotel_id, shift_id, shift_date)
    return await _perform_generation(hotel_id, shift_id, shift_date, user_id, existing_row=existing, is_regenerate=True)

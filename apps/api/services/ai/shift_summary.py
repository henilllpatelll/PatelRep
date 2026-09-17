"""
AI Shift Summary service — generates a concise shift handoff summary using Claude Sonnet.
Collects: logbook entries, completed tasks, open work orders for the shift period.
"""
from datetime import datetime, timezone

import anthropic
from core.config import settings
from core.database import supabase


def generate_shift_summary(hotel_id: str, shift_id: str, shift_date: str) -> dict:
    """
    Generate an AI shift summary for a completed shift.
    Returns dict with summary_text, key_events list, open_items list.
    """
    # 1. Get shift details (start/end times to bound queries)
    shift_result = supabase.table("shifts")\
        .select("name, start_time, end_time, department_id, departments(name)")\
        .eq("id", shift_id)\
        .maybe_single()\
        .execute()

    shift = (shift_result.data if shift_result else None) or {}
    shift_name = shift.get("name", "Shift")
    department_id = shift.get("department_id")
    dept_name = shift.get("departments", {}).get("name", "All Departments") if shift.get("departments") else "All Departments"

    # 2. Get logbook entries for this shift
    logbook_result = supabase.table("logbook_entries")\
        .select("content, created_at, author_id")\
        .eq("tenant_id", hotel_id)\
        .eq("shift_id", shift_id)\
        .order("created_at", desc=False)\
        .execute()

    logbook_entries = logbook_result.data or []

    # 3. Get tasks completed during this shift date
    tasks_result = supabase.table("tasks")\
        .select("title, status, priority, task_type, completed_at")\
        .eq("tenant_id", hotel_id)\
        .eq("status", "completed")\
        .gte("completed_at", f"{shift_date}T00:00:00")\
        .lte("completed_at", f"{shift_date}T23:59:59")\
        .execute()

    completed_tasks = tasks_result.data or []

    # 4. Get open work orders
    wo_result = supabase.table("work_orders")\
        .select("title, priority, category, status")\
        .eq("tenant_id", hotel_id)\
        .in_("status", ["open", "in_progress", "on_hold"])\
        .execute()

    open_work_orders = wo_result.data or []

    now_iso = datetime.now(timezone.utc).isoformat()

    # 4a. VIP arrivals — DEP-turnover rooms flagged VIP (hotel-agnostic arrival proxy)
    vip_result = supabase.table("room_status")\
        .select("vip_flag, clean_type, rooms!inner(room_number)")\
        .eq("tenant_id", hotel_id)\
        .eq("clean_type", "DEP")\
        .eq("vip_flag", True)\
        .execute()

    vip_arrivals = [
        (r.get("rooms") or {}).get("room_number")
        for r in (vip_result.data or [])
        if (r.get("rooms") or {}).get("room_number")
    ]

    # 4b. Pending guest issues — non-terminal guest requests
    guest_result = supabase.table("guest_requests")\
        .select("title, description")\
        .eq("tenant_id", hotel_id)\
        .not_.in_("status", ["resolved", "verified", "cancelled"])\
        .execute()

    pending_guest_issues = [
        (g.get("title") or g.get("description") or "Guest request")
        for g in (guest_result.data or [])
    ]

    # 4c. Low-stock engineering parts — total_on_hand < minimum_stock (mirrors inventory.py)
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
        p.get("name", "")
        for p in parts
        if on_hand.get(p["id"], 0.0) < float(p.get("minimum_stock") or 0)
    ]

    # 4d. SLA breaches — overdue open/in_progress work orders + tasks (mirrors internal.py)
    wo_breach_result = supabase.table("work_orders")\
        .select("title")\
        .eq("tenant_id", hotel_id)\
        .in_("status", ["open", "in_progress"])\
        .lt("due_at", now_iso)\
        .execute()

    task_breach_result = supabase.table("tasks")\
        .select("title")\
        .eq("tenant_id", hotel_id)\
        .in_("status", ["open", "in_progress"])\
        .lt("due_at", now_iso)\
        .execute()

    sla_breaches = [
        wo.get("title", "") for wo in (wo_breach_result.data or [])
    ] + [
        t.get("title", "") for t in (task_breach_result.data or [])
    ]

    # 5. Build prompt context
    log_text = "\n".join([
        f"- [{e.get('created_at', '')[:16]}] Staff: {e.get('content', '')}"
        for e in logbook_entries
    ]) or "No logbook entries recorded."

    tasks_text = "\n".join([
        f"- {t.get('title', '')} ({t.get('priority', 'normal')} priority, {t.get('task_type', '')})"
        for t in completed_tasks[:20]
    ]) or "No tasks completed."

    wo_text = "\n".join([
        f"- {wo.get('title', '')} [{wo.get('priority', 'normal').upper()}] {wo.get('category', '')} — {wo.get('status', '')}"
        for wo in open_work_orders[:10]
    ]) or "No open work orders."

    vip_text = "\n".join([
        f"- Room {room_number}"
        for room_number in vip_arrivals[:10]
    ]) or "No VIP arrivals today."

    guest_issues_text = "\n".join([
        f"- {issue}"
        for issue in pending_guest_issues[:10]
    ]) or "No pending guest issues."

    low_stock_text = "\n".join([
        f"- {name}"
        for name in low_stock_parts[:10]
    ]) or "No low-stock parts."

    sla_text = "\n".join([
        f"- {title}"
        for title in sla_breaches[:10]
    ]) or "No SLA breaches."

    prompt = f"""You are a hotel operations AI assistant. Generate a concise shift handoff summary for the hotel management team.

Shift: {shift_name} ({dept_name}) — {shift_date}

LOGBOOK ENTRIES:
{log_text}

TASKS COMPLETED THIS SHIFT:
{tasks_text}

OPEN WORK ORDERS (requiring attention):
{wo_text}

VIP ARRIVALS TODAY:
{vip_text}

PENDING GUEST ISSUES:
{guest_issues_text}

LOW-STOCK PARTS:
{low_stock_text}

SLA BREACHES (overdue work orders & tasks):
{sla_text}

Write a professional 3-4 paragraph shift handoff summary that:
1. Opens with a brief status overview (occupancy pace, overall shift tone)
2. Highlights key incidents or notable guest interactions from the logbook
3. Summarizes task completion and any unfinished items
4. Flags open work orders that need attention on the next shift
5. Flags VIP arrivals, pending guest issues, low-stock items, and SLA breaches that need the next shift's attention

Keep it concise, factual, and actionable. Use hotel industry terminology."""

    # 6. Call Claude Sonnet
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )

    summary_text = message.content[0].text

    # 7. Store in shift_summaries table (schema: tenant_id, shift_id, shift_date,
    #    department_id, summary_text, stats JSONB)
    supabase.table("shift_summaries").insert({
        "tenant_id": hotel_id,
        "shift_id": shift_id,
        "shift_date": shift_date,
        "department_id": department_id,
        "summary_text": summary_text,
        "stats": {
            "tasks_completed": len(completed_tasks),
            "open_work_orders": len(open_work_orders),
            "logbook_entries_count": len(logbook_entries),
            "model_used": "claude-sonnet-4-6",
            "vip_arrivals_count": len(vip_arrivals),
            "pending_guest_issues_count": len(pending_guest_issues),
            "low_stock_parts_count": len(low_stock_parts),
            "sla_breaches_count": len(sla_breaches),
        },
    }).execute()

    # 8. Log AI interaction
    supabase.table("ai_interactions").insert({
        "tenant_id": hotel_id,
        "interaction_type": "shift_summary",
        "credits_charged": 3.0,
        "model_used": "claude-sonnet-4-6",
        "success": True,
        "prompt_tokens": len(prompt.split()),
        "completion_tokens": len(summary_text.split()),
    }).execute()

    return {
        "summary_text": summary_text,
        "tasks_completed": len(completed_tasks),
        "open_work_orders": len(open_work_orders),
        "logbook_entries_count": len(logbook_entries),
        "vip_arrivals_count": len(vip_arrivals),
        "pending_guest_issues_count": len(pending_guest_issues),
        "low_stock_parts_count": len(low_stock_parts),
        "sla_breaches_count": len(sla_breaches),
    }

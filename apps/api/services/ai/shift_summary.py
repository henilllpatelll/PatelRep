"""
AI Shift Summary service — generates a concise shift handoff summary using Claude Sonnet.
Collects: logbook entries, completed tasks, open work orders for the shift period.
"""
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
        .single()\
        .execute()

    shift = shift_result.data or {}
    shift_name = shift.get("name", "Shift")
    dept_name = shift.get("departments", {}).get("name", "All Departments") if shift.get("departments") else "All Departments"

    # 2. Get logbook entries for this shift
    logbook_result = supabase.table("logbook_entries")\
        .select("content, created_at, user_profiles(preferred_name, full_name)")\
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

    # 5. Build prompt context
    log_text = "\n".join([
        f"- [{e.get('created_at', '')[:16]}] {(e.get('user_profiles') or {}).get('preferred_name') or (e.get('user_profiles') or {}).get('full_name', 'Staff')}: {e.get('content', '')}"
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

    prompt = f"""You are a hotel operations AI assistant. Generate a concise shift handoff summary for the hotel management team.

Shift: {shift_name} ({dept_name}) — {shift_date}

LOGBOOK ENTRIES:
{log_text}

TASKS COMPLETED THIS SHIFT:
{tasks_text}

OPEN WORK ORDERS (requiring attention):
{wo_text}

Write a professional 3-4 paragraph shift handoff summary that:
1. Opens with a brief status overview (occupancy pace, overall shift tone)
2. Highlights key incidents or notable guest interactions from the logbook
3. Summarizes task completion and any unfinished items
4. Flags open work orders that need attention on the next shift

Keep it concise, factual, and actionable. Use hotel industry terminology."""

    # 6. Call Claude Sonnet
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )

    summary_text = message.content[0].text

    # 7. Store in shift_summaries table
    supabase.table("shift_summaries").upsert({
        "tenant_id": hotel_id,
        "shift_id": shift_id,
        "shift_date": shift_date,
        "summary_text": summary_text,
        "tasks_completed": len(completed_tasks),
        "open_work_orders": len(open_work_orders),
        "logbook_entries_count": len(logbook_entries),
        "generated_by_ai": True,
        "model_used": "claude-sonnet-4-6",
    }, on_conflict="tenant_id,shift_id").execute()

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
    }

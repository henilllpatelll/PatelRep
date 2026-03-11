import anthropic
import json
from core.config import settings
from core.database import supabase
from datetime import datetime, timedelta

claude = anthropic.Anthropic(api_key=settings.anthropic_api_key)


def _get_7day_stats(hotel_id: str) -> dict:
    """Aggregate 7-day operational stats from the DB."""
    seven_days_ago = (datetime.utcnow() - timedelta(days=7)).isoformat()

    # Rooms cleaned in 7 days
    rooms_cleaned = supabase.table("room_status_history")\
        .select("id", count="exact")\
        .eq("tenant_id", hotel_id)\
        .eq("to_status", "CLEAN")\
        .gte("created_at", seven_days_ago)\
        .execute()

    # Work orders opened
    wo_opened = supabase.table("work_orders")\
        .select("id, priority", count="exact")\
        .eq("tenant_id", hotel_id)\
        .gte("created_at", seven_days_ago)\
        .execute()

    # Work orders completed
    wo_completed = supabase.table("work_orders")\
        .select("id", count="exact")\
        .eq("tenant_id", hotel_id)\
        .eq("status", "completed")\
        .gte("completed_at", seven_days_ago)\
        .execute()

    # SLA breaches (due_at passed while open/in_progress)
    breached = supabase.table("work_orders")\
        .select("id", count="exact")\
        .eq("tenant_id", hotel_id)\
        .in_("status", ["open", "in_progress"])\
        .lt("due_at", datetime.utcnow().isoformat())\
        .execute()

    # High-risk rooms
    high_risk = supabase.table("room_readiness_predictions")\
        .select("id", count="exact")\
        .eq("tenant_id", hotel_id)\
        .eq("risk_level", "HIGH")\
        .execute()

    # AI credit usage
    credit_usage = supabase.table("ai_interactions")\
        .select("credits_charged")\
        .eq("tenant_id", hotel_id)\
        .gte("created_at", seven_days_ago)\
        .execute()

    total_credits = sum(r.get("credits_charged", 0) for r in (credit_usage.data or []))

    # Hotel name
    hotel = supabase.table("tenants")\
        .select("name")\
        .eq("id", hotel_id)\
        .single()\
        .execute()
    hotel_name = hotel.data.get("name", "the hotel") if hotel.data else "the hotel"

    wo_count = len(wo_opened.data or [])
    wo_done = wo_completed.count or 0
    completion_rate = round(wo_done / wo_count * 100) if wo_count > 0 else 0

    return {
        "hotel_name": hotel_name,
        "rooms_cleaned_7d": rooms_cleaned.count or 0,
        "work_orders_opened_7d": wo_count,
        "work_orders_completed_7d": wo_done,
        "wo_completion_rate_pct": completion_rate,
        "sla_breach_count": breached.count or 0,
        "high_risk_rooms": high_risk.count or 0,
        "ai_credits_used_7d": round(total_credits, 1),
    }


def generate_gm_insights(hotel_id: str, query: str = None) -> dict:
    """
    Generate GM insights using Claude Sonnet based on 7-day operational data.
    Returns {"insights": [...], "prompt_tokens": int, "completion_tokens": int}
    """
    stats = _get_7day_stats(hotel_id)

    system_prompt = f"""You are the operations intelligence assistant for {stats['hotel_name']}.
Analyze the following 7-day operational data and provide 3-5 actionable insights.

Focus on what matters most to a hotel GM: guest satisfaction, labor cost, and asset protection.

Provide insights in JSON array format:
[{{
  "type": "labor_efficiency|sla_risk|maintenance_pattern|cost_savings|staffing",
  "severity": "info|warning|critical",
  "title": "Short title (max 8 words)",
  "detail": "1-2 sentence explanation with specific numbers",
  "action": "Specific recommended action (max 10 words)"
}}]

Return ONLY the JSON array. No markdown, no preamble."""

    stats_summary = f"""7-Day Stats:
- Rooms cleaned: {stats['rooms_cleaned_7d']}
- Work orders opened: {stats['work_orders_opened_7d']}
- Work orders completed: {stats['work_orders_completed_7d']} ({stats['wo_completion_rate_pct']}% completion rate)
- SLA breaches (currently overdue): {stats['sla_breach_count']}
- High-risk rooms (readiness): {stats['high_risk_rooms']}
- AI credits used: {stats['ai_credits_used_7d']}"""

    user_msg = stats_summary
    if query:
        user_msg = f"{stats_summary}\n\nSpecific question: {query}"

    response = claude.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": user_msg}],
    )

    usage = response.usage
    content = response.content[0].text.strip()

    try:
        insights = json.loads(content)
        if not isinstance(insights, list):
            insights = []
    except (json.JSONDecodeError, IndexError):
        insights = []

    return {
        "insights": insights,
        "prompt_tokens": usage.input_tokens,
        "completion_tokens": usage.output_tokens,
    }

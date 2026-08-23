"""AI weekly briefing for GMs.

Reuses the same 7-day operational aggregate as the existing GM insights feed
(services.ai.insights._get_7day_stats) so the numbers stay consistent between
the two surfaces, but asks Claude for a single condensed "corner card" brief
instead of a list of separate insights. Failures must surface as exceptions
for the router to map to 503.
"""

import json

from services.ai.insights import _get_7day_stats
from services.ai.providers import get_anthropic_client

_SYSTEM_PROMPT = """You are the AI operations copilot for a hotel general manager.
You receive this property's real 7-day operational stats. Do not invent numbers
that were not given to you. Find the single most useful thing for the GM to see
right now — usually whichever number is furthest off target (SLA breaches,
completion rate, high-risk rooms, or credit spend).

Respond in {language_name}.

Return ONLY a JSON object (no markdown) with this shape:
{{
  "headline": "1-2 sentences: the most useful thing noticed, with specific numbers from the data given.",
  "confidence": <integer 0-100>,
  "sources": ["up to 3 short tags naming what data drove this, e.g. '7-day trend', 'work orders'"],
  "stats": [
    {{"label": "short stat name, max 3 words", "value": "short number, taken from the data given", "sub": "short qualifier"}}
  ],
  "rows": [
    {{"title": "short line item from this week", "sub": "detail", "meta": "short metric"}}
  ],
  "primary_action": "short imperative button label, max 5 words",
  "secondary_action": "short button label for a lower-commitment option, max 3 words",
  "chips": ["0-2 short follow-up questions a GM might tap, each under 6 words"]
}}

"stats" must have exactly 3 entries, each built only from the numbers given below.
"rows" must have at most 4 entries. If nothing is off target, say so plainly in
the headline and still fill stats/rows with the current state."""


def generate_gm_briefing(hotel_id: str, language: str = "en") -> dict:
    """Returns {"briefing": {...}, "prompt_tokens": int, "completion_tokens": int}."""
    claude = get_anthropic_client()
    language_name = "Spanish" if language == "es" else "English"
    stats = _get_7day_stats(hotel_id)

    user_content = f"""7-Day Stats for {stats['hotel_name']}:
- Rooms cleaned: {stats['rooms_cleaned_7d']}
- Work orders opened: {stats['work_orders_opened_7d']}
- Work orders completed: {stats['work_orders_completed_7d']} ({stats['wo_completion_rate_pct']}% completion rate)
- SLA breaches (currently overdue): {stats['sla_breach_count']}
- High-risk rooms (readiness): {stats['high_risk_rooms']}
- AI credits used: {stats['ai_credits_used_7d']}"""

    response = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=700,
        system=_SYSTEM_PROMPT.format(language_name=language_name),
        messages=[{"role": "user", "content": user_content}],
    )

    usage = response.usage
    content = response.content[0].text.strip()

    briefing = json.loads(content)
    if not isinstance(briefing, dict):
        raise ValueError("briefing must be a JSON object")

    return {
        "briefing": {
            "headline": str(briefing.get("headline", "")),
            "confidence": int(briefing.get("confidence") or 0),
            "sources": [str(s) for s in briefing.get("sources", [])][:3],
            "stats": [
                {
                    "label": str(s.get("label", "")),
                    "value": str(s.get("value", "")),
                    "sub": str(s.get("sub", "")),
                }
                for s in briefing.get("stats", [])
            ][:3],
            "rows": [
                {
                    "title": str(r.get("title", "")),
                    "sub": str(r.get("sub", "")),
                    "meta": str(r.get("meta", "")),
                }
                for r in briefing.get("rows", [])
            ][:4],
            "primary_action": str(briefing.get("primary_action", "")),
            "secondary_action": str(briefing.get("secondary_action", "")),
            "chips": [str(c) for c in briefing.get("chips", [])][:2],
        },
        "prompt_tokens": usage.input_tokens,
        "completion_tokens": usage.output_tokens,
    }

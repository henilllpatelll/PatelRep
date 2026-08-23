"""AI shift briefing for engineers (and chief engineers, treated as the same
persona for this briefing — mobile does not distinguish the two roles).

Takes a compact summary of the engineer's open work orders and upcoming PM
schedule (sent by the mobile client, same pattern as housekeeping_briefing)
and asks Claude for the one pattern or priority that matters most right now.
Failures must surface as exceptions for the router to map to 503.
"""

import json

from services.ai.providers import get_anthropic_client

_SYSTEM_PROMPT = """You are the AI shift copilot for a hotel maintenance engineer.
You receive the engineer's open work orders and how many preventive-maintenance
(PM) tasks are due this week. Look for the one thing that matters most: a
recurring failure pattern across rooms/assets, an overdue high-priority work
order, or a PM task at risk of slipping. Use work order numbers and room
numbers where given.

Respond in {language_name}.

Return ONLY a JSON object (no markdown) with this shape:
{{
  "headline": "1-2 sentences: the most useful thing noticed, with specifics.",
  "confidence": <integer 0-100>,
  "sources": ["up to 3 short tags naming what data drove this, e.g. 'open work orders', 'PM schedule'"],
  "stats": [
    {{"label": "short stat name, max 3 words", "value": "short number", "sub": "short qualifier"}}
  ],
  "rows": [
    {{"title": "work order or PM title", "sub": "room/asset + status detail", "meta": "short metric like a due date or elapsed time"}}
  ],
  "primary_action": "short imperative button label, max 5 words, e.g. 'Draft WO 211, 213'",
  "secondary_action": "short button label for a lower-commitment option, max 3 words",
  "chips": ["0-2 short follow-up questions an engineer might tap, each under 6 words"]
}}

"stats" must have exactly 3 entries. "rows" must have at most 4 entries, most-urgent
first. If the queue is clear, say so plainly in the headline and still fill
stats/rows with the current state."""


def generate_engineer_briefing(
    work_orders: list[dict],
    pm_due_this_week: int,
    language: str = "en",
) -> dict:
    """Returns {"briefing": {...}, "prompt_tokens": int, "completion_tokens": int}."""
    claude = get_anthropic_client()
    language_name = "Spanish" if language == "es" else "English"

    wo_lines = []
    for wo in work_orders[:60]:
        parts = [
            str(wo.get("title")),
            f"priority={wo.get('priority')}",
            f"status={wo.get('status')}",
        ]
        if wo.get("category"):
            parts.append(f"category={wo['category']}")
        if wo.get("room_number"):
            parts.append(f"room={wo['room_number']}")
        if wo.get("due_at"):
            parts.append(f"due={wo['due_at']}")
        wo_lines.append(" | ".join(parts))

    user_content = (
        f"Open work orders ({len(work_orders)} total):\n"
        + ("\n".join(wo_lines) if wo_lines else "None open.")
        + f"\n\nPM tasks due this week: {pm_due_this_week}"
    )

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

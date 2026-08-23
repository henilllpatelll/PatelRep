"""AI shift briefing for front desk staff.

Takes a compact summary of open guest requests plus today's readiness/arrival
counts (sent by the mobile client, same pattern as housekeeping_briefing) and
asks Claude for the single most useful recovery move or heads-up right now.
Failures must surface as exceptions for the router to map to 503.
"""

import json

from services.ai.providers import get_anthropic_client

_SYSTEM_PROMPT = """You are the AI shift copilot for a hotel front desk agent.
You receive today's open guest requests and readiness/arrival counts. Find the
single most useful thing to do right now — usually an SLA-breaching request
that needs a recovery move (room move, comp, call), or a heads-up about VIP
arrivals versus ready rooms. Use room numbers and request references where given.

Respond in {language_name}.

Return ONLY a JSON object (no markdown) with this shape:
{{
  "headline": "1-2 sentences: the most useful thing noticed, with specifics.",
  "confidence": <integer 0-100>,
  "sources": ["up to 3 short tags naming what data drove this, e.g. 'guest requests', 'room board'"],
  "stats": [
    {{"label": "short stat name, max 3 words", "value": "short number", "sub": "short qualifier"}}
  ],
  "rows": [
    {{"title": "guest request or arrival summary", "sub": "room + detail", "meta": "short metric like minutes open or a time"}}
  ],
  "primary_action": "short imperative button label, max 5 words, e.g. 'Offer move to 412'",
  "secondary_action": "short button label for a lower-commitment option, max 3 words",
  "chips": ["0-2 short follow-up questions a front desk agent might tap, each under 6 words"]
}}

"stats" must have exactly 3 entries. "rows" must have at most 4 entries, most-urgent
first. If nothing is breaching SLA or at risk, say so plainly in the headline and
still fill stats/rows with the current state."""


def generate_front_desk_briefing(
    guest_requests: list[dict],
    ready_room_count: int,
    arrivals_count: int,
    vip_arrivals_count: int,
    language: str = "en",
) -> dict:
    """Returns {"briefing": {...}, "prompt_tokens": int, "completion_tokens": int}."""
    claude = get_anthropic_client()
    language_name = "Spanish" if language == "es" else "English"

    gr_lines = []
    for gr in guest_requests[:60]:
        parts = [
            str(gr.get("request_type")),
            f"status={gr.get('status')}",
        ]
        if gr.get("room_number"):
            parts.append(f"room={gr['room_number']}")
        if gr.get("sla_breached"):
            parts.append("SLA_BREACHED")
        if gr.get("minutes_open") is not None:
            parts.append(f"open={gr['minutes_open']}m")
        gr_lines.append(" | ".join(parts))

    user_content = (
        f"Open guest requests ({len(guest_requests)} total):\n"
        + ("\n".join(gr_lines) if gr_lines else "None open.")
        + f"\n\nReady rooms: {ready_room_count}\n"
        + f"Arrivals today: {arrivals_count} ({vip_arrivals_count} VIP)"
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

"""AI shift briefing for housekeepers.

Takes the housekeeper's assigned-room summaries (sent by the mobile client so
the briefing works off exactly what the floor sees) and asks Claude for a
short, practical shift plan. The mobile app falls back to a local heuristic
briefing whenever this service is unavailable, so failures here must surface
as exceptions for the router to map to 503 — never half-empty payloads.
"""

import anthropic
import json

from core.config import settings

claude = anthropic.Anthropic(api_key=settings.anthropic_api_key)

_SYSTEM_PROMPT = """You are the AI shift copilot for a hotel housekeeping team.
You receive today's assigned rooms for ONE housekeeper. Write a briefing that
saves them time on the floor. Be concrete and use room numbers.

Respond in {language_name}.

Return ONLY a JSON object (no markdown) with this shape:
{{
  "headline": "One sentence: the single most important thing right now (max 18 words)",
  "plan": ["room numbers in the order they should be cleaned, max 6"],
  "watchouts": ["0-3 short warnings: DND, guest inside, work orders, VIP, tight arrivals"],
  "estimated_minutes": <integer total remaining cleaning minutes>
}}

Ordering rules: departures with checked-out guests first, VIPs early,
rooms with arrivals soon before others, do-not-disturb and occupied rooms last
(they cannot be entered yet). Never tell staff to enter a DND or occupied room."""


def generate_shift_briefing(rooms: list[dict], language: str = "en") -> dict:
    """Returns {"briefing": {...}, "prompt_tokens": int, "completion_tokens": int}."""
    language_name = "Spanish" if language == "es" else "English"

    room_lines = []
    for room in rooms[:40]:
        parts = [
            f"Room {room.get('room_number')}",
            f"status={room.get('status')}",
        ]
        if room.get("clean_type"):
            parts.append(f"clean_type={room['clean_type']}")
        if room.get("vip_flag"):
            parts.append("VIP")
        if room.get("dnd_flag"):
            parts.append("DND")
        if room.get("guest_may_be_inside"):
            parts.append("guest_may_be_inside")
        if room.get("open_work_order"):
            parts.append("open_work_order")
        if room.get("checkin_time"):
            parts.append(f"arrival={room['checkin_time']}")
        if room.get("actual_checkout_at"):
            parts.append("checked_out")
        if room.get("base_clean_minutes"):
            parts.append(f"est={room['base_clean_minutes']}m")
        room_lines.append(" | ".join(parts))

    response = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=600,
        system=_SYSTEM_PROMPT.format(language_name=language_name),
        messages=[{"role": "user", "content": "Today's assignment:\n" + "\n".join(room_lines)}],
    )

    usage = response.usage
    content = response.content[0].text.strip()

    briefing = json.loads(content)
    if not isinstance(briefing, dict):
        raise ValueError("briefing must be a JSON object")

    return {
        "briefing": {
            "headline": str(briefing.get("headline", "")),
            "plan": [str(r) for r in briefing.get("plan", [])][:6],
            "watchouts": [str(w) for w in briefing.get("watchouts", [])][:3],
            "estimated_minutes": int(briefing.get("estimated_minutes") or 0),
        },
        "prompt_tokens": usage.input_tokens,
        "completion_tokens": usage.output_tokens,
    }

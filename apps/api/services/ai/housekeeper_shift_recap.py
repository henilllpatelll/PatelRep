"""AI end-of-shift recap for housekeepers.

Takes the housekeeper's completed-room summaries for the day (mirrors
housekeeping_briefing.py's input shape) and asks Claude for a short,
factual recap. The mobile client falls back to a local heuristic recap
whenever this service is unavailable, so failures here must surface as
exceptions for the router to map to 503 — never half-empty payloads.
"""

import json

from services.ai.providers import get_anthropic_client

_SYSTEM_PROMPT = """You are the AI shift copilot for a hotel housekeeping team.
You receive the rooms ONE housekeeper cleaned today, already complete. Write a
short, factual end-of-shift recap — encouraging but grounded in the numbers
given, never invented details.

Respond in {language_name}.

Return ONLY a JSON object (no markdown) with this shape:
{{
  "headline": "One factual, encouraging sentence about today's shift (max 20 words)",
  "note": "0-1 short operational note worth flagging for tomorrow, or empty string if nothing stands out"
}}

Base the headline only on the room counts and pace given — do not invent guest
interactions, incidents, or details not present in the data."""


def generate_shift_recap(
    rooms: list[dict],
    language: str = "en",
) -> dict:
    """Returns {"recap": {...}, "prompt_tokens": int, "completion_tokens": int}."""
    claude = get_anthropic_client()
    language_name = "Spanish" if language == "es" else "English"

    room_lines = []
    for room in rooms[:60]:
        parts = [f"Room {room.get('room_number')}", f"status={room.get('status')}"]
        if room.get("clean_type"):
            parts.append(f"clean_type={room['clean_type']}")
        if room.get("base_clean_minutes"):
            parts.append(f"target={room['base_clean_minutes']}m")
        room_lines.append(" | ".join(parts))

    response = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        system=_SYSTEM_PROMPT.format(language_name=language_name),
        messages=[{"role": "user", "content": "Today's completed rooms:\n" + "\n".join(room_lines)}],
    )

    usage = response.usage
    content = response.content[0].text.strip()

    recap = json.loads(content)
    if not isinstance(recap, dict):
        raise ValueError("recap must be a JSON object")

    return {
        "recap": {
            "headline": str(recap.get("headline", "")),
            "note": str(recap.get("note", "")),
        },
        "prompt_tokens": usage.input_tokens,
        "completion_tokens": usage.output_tokens,
    }

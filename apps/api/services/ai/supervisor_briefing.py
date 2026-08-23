"""AI shift briefing for housekeeping supervisors.

Takes a compact summary of the floor's rooms and each housekeeper's progress
(sent by the mobile client, same pattern as housekeeping_briefing) and asks
Claude for the one reassignment or intervention that matters most right now.
Failures must surface as exceptions for the router to map to 503.
"""

import json

from services.ai.providers import get_anthropic_client

_SYSTEM_PROMPT = """You are the AI shift copilot for a hotel housekeeping supervisor.
You receive today's floor status: room readiness counts and each housekeeper's
progress against their assigned rooms. Find the single most useful intervention
right now — usually a reassignment between an ahead and a behind housekeeper,
or a floor that needs attention before upcoming arrivals.

Respond in {language_name}.

Return ONLY a JSON object (no markdown) with this shape:
{{
  "headline": "1-2 sentences: what's happening and the one recommended move. Use names and room numbers.",
  "confidence": <integer 0-100>,
  "sources": ["up to 3 short tags naming what data drove this, e.g. 'today's board', '6 housekeepers'"],
  "stats": [
    {{"label": "short stat name, max 3 words", "value": "short number/percent", "sub": "short qualifier"}}
  ],
  "rows": [
    {{"title": "housekeeper name + floor", "sub": "progress detail", "meta": "short metric like a percent or count"}}
  ],
  "primary_action": "short imperative button label, max 5 words, e.g. 'Reassign 313, 314'",
  "secondary_action": "short button label for a lower-commitment option, max 3 words",
  "chips": ["0-2 short follow-up questions a supervisor might tap, each under 6 words"]
}}

"stats" must have exactly 3 entries. "rows" must have at most 4 entries, ordered
most-urgent-first. If nothing is behind or at risk, say so plainly in the headline
and still fill stats/rows with the current state."""


def generate_supervisor_briefing(
    rooms: list[dict],
    staff: list[dict],
    language: str = "en",
) -> dict:
    """Returns {"briefing": {...}, "prompt_tokens": int, "completion_tokens": int}."""
    claude = get_anthropic_client()
    language_name = "Spanish" if language == "es" else "English"

    ready = sum(1 for r in rooms if r.get("status") in ("CLEAN", "INSPECTED"))
    dirty = sum(1 for r in rooms if r.get("status") in ("DIRTY", "OCCUPIED"))

    room_lines = [
        f"Rooms: {len(rooms)} total, {ready} ready, {dirty} dirty/occupied",
    ]

    staff_lines = []
    for member in staff[:40]:
        parts = [
            str(member.get("name")),
            f"floor={member.get('floor')}" if member.get("floor") else None,
            f"{member.get('rooms_done', 0)}/{member.get('rooms_total', 0)} rooms",
        ]
        minutes_behind = member.get("minutes_behind")
        if minutes_behind:
            parts.append(
                f"{abs(minutes_behind)}m {'behind' if minutes_behind > 0 else 'ahead'}"
            )
        staff_lines.append(" | ".join(p for p in parts if p))

    user_content = "\n".join(room_lines) + "\n\nHousekeeper progress:\n" + (
        "\n".join(staff_lines) if staff_lines else "No staff assigned yet."
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

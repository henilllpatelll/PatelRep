import json
import logging
from openai import OpenAI
from core.config import settings

client = OpenAI(api_key=settings.openai_api_key)
logger = logging.getLogger(__name__)

_ASSIGN_SCHEMA = {
    "name": "create_assignments",
    "description": "Parse staff room or task assignment instructions",
    "parameters": {
        "type": "object",
        "properties": {
            "assignments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "staff_name_hint": {"type": "string"},
                        "room_numbers": {"type": "array", "items": {"type": "string"}},
                        "task_ids": {"type": "array", "items": {"type": "string"}},
                        "clean_type": {
                            "type": "string",
                            "enum": ["DEP", "FULL", "LIGHT"],
                            "description": "Housekeeping clean type: DEP for checkout/departure, FULL for stayover linen change, LIGHT for stayover pickup/light service.",
                        },
                    },
                    "required": ["staff_name_hint"],
                },
            }
        },
        "required": ["assignments"],
    },
}

_SYSTEM = (
    "Parse hotel staff assignment instructions. "
    "Extract staff name, room numbers (expand ranges like 200-210 into individual rooms), "
    "any specific task references, and clean type when the user says departure, checkout, "
    "full linen, linen change, stayover full, light, pickup, or stayover light."
)


def parse_assignments(message: str) -> dict:
    """
    Returns {"assignments": [...], "prompt_tokens": int, "completion_tokens": int}
    """
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": message},
        ],
        tools=[{"type": "function", "function": _ASSIGN_SCHEMA}],
        tool_choice={"type": "function", "function": {"name": "create_assignments"}},
        temperature=0.1,
    )
    msg = response.choices[0].message
    raw: list = []
    if msg.tool_calls:
        raw = json.loads(msg.tool_calls[0].function.arguments).get("assignments", [])
    return {
        "assignments": raw,
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
    }

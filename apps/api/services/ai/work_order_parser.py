import json
import logging
from openai import OpenAI
from core.config import settings

client = OpenAI(api_key=settings.openai_api_key)
logger = logging.getLogger(__name__)

_WO_SCHEMA = {
    "name": "create_work_orders",
    "description": "Parse hotel maintenance requests into engineering work orders",
    "parameters": {
        "type": "object",
        "properties": {
            "work_orders": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "category": {
                            "enum": ["plumbing", "electrical", "hvac", "furniture",
                                     "appliance", "structural", "safety", "general"]
                        },
                        "priority": {"enum": ["urgent", "normal", "low"]},
                        "room_number": {"type": "string"},
                        "location_text": {"type": "string"},
                        "description": {"type": "string"},
                    },
                    "required": ["title", "category", "priority"],
                },
            }
        },
        "required": ["work_orders"],
    },
}

_SYSTEM = (
    "Parse hotel maintenance requests into work orders. "
    "Broken/not-working items are urgent. "
    "'ac' or 'hvac' → hvac. Plumbing/leak → plumbing. Electrical → electrical."
)


def parse_work_orders(message: str) -> dict:
    """
    Returns {"work_orders": [...], "prompt_tokens": int, "completion_tokens": int}
    """
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": message},
        ],
        tools=[{"type": "function", "function": _WO_SCHEMA}],
        tool_choice={"type": "function", "function": {"name": "create_work_orders"}},
        temperature=0.1,
    )
    msg = response.choices[0].message
    raw: list = []
    if msg.tool_calls:
        raw = json.loads(msg.tool_calls[0].function.arguments).get("work_orders", [])
    return {
        "work_orders": raw,
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
    }

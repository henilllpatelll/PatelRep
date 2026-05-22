import json
import logging
from openai import OpenAI
from core.config import settings

client = OpenAI(api_key=settings.openai_api_key)
logger = logging.getLogger(__name__)

_GR_SCHEMA = {
    "name": "create_guest_requests",
    "description": "Parse hotel guest service requests",
    "parameters": {
        "type": "object",
        "properties": {
            "requests": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "room_number": {"type": "string"},
                        "guest_name": {"type": "string"},
                        "description": {"type": "string"},
                    },
                    "required": ["title"],
                },
            }
        },
        "required": ["requests"],
    },
}

_SYSTEM = (
    "Parse hotel guest service requests. "
    "Extract room number, guest name if mentioned, and what they need."
)


def parse_guest_requests(message: str) -> dict:
    """
    Returns {"requests": [...], "prompt_tokens": int, "completion_tokens": int}
    """
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": message},
        ],
        tools=[{"type": "function", "function": _GR_SCHEMA}],
        tool_choice={"type": "function", "function": {"name": "create_guest_requests"}},
        temperature=0.1,
    )
    msg = response.choices[0].message
    raw: list = []
    if msg.tool_calls:
        raw = json.loads(msg.tool_calls[0].function.arguments).get("requests", [])
    return {
        "requests": raw,
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
    }

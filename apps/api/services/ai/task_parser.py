import re
import logging
from openai import OpenAI
from pydantic import BaseModel, Field, ValidationError, field_validator
from typing import Optional, Literal
from core.config import settings
from datetime import date

client = OpenAI(api_key=settings.openai_api_key)
logger = logging.getLogger(__name__)


class ParsedTaskOutput(BaseModel):
    title: str
    description: Optional[str] = None
    task_type: Literal["housekeeping", "engineering", "guest_request", "general"]
    priority: Literal["urgent", "normal", "low"]
    room_number: Optional[str] = None
    due_at: Optional[str] = None
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("title cannot be empty")
        return v.strip()

CREATE_TASKS_SCHEMA = {
    "name": "create_tasks",
    "description": "Create one or more hotel operations tasks from natural language input",
    "parameters": {
        "type": "object",
        "properties": {
            "tasks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                        "task_type": {"enum": ["housekeeping", "engineering", "guest_request", "general"]},
                        "priority": {"enum": ["urgent", "normal", "low"]},
                        "room_number": {"type": "string"},
                        "due_at": {"type": "string", "format": "date-time"},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1}
                    },
                    "required": ["title", "task_type", "priority", "confidence"]
                }
            }
        },
        "required": ["tasks"]
    }
}


def parse_nl_tasks(
    message: str,
    hotel_name: str,
    staff_name: str,
    role: str,
    shift_name: str = "Morning",
    shift_start: str = "07:00",
    shift_end: str = "15:00",
    context: dict = None,
) -> dict:
    """
    Parse natural language into structured task objects using GPT-4o-mini function calling.
    Returns {"tasks": [...], "prompt_tokens": int, "completion_tokens": int}
    """
    today = date.today().strftime("%A, %B %d, %Y")

    system_prompt = f"""You are the AI operations assistant for {hotel_name}, a hotel in Texas.
Today is {today} and the current shift is {shift_name} ({shift_start}–{shift_end}).
The user {staff_name} has the role: {role}.

Your job is to parse natural language into structured hotel operations tasks.
Always extract:
- Task title (concise, action-oriented)
- Task type: housekeeping | engineering | guest_request | general
- Priority: urgent (guest-facing, SLA < 1hr) | normal (4hr SLA) | low (end of day)
- Room number (if mentioned)
- Due time (if mentioned or implied by check-in)
- Any sub-tasks if multiple actions are mentioned

Rules:
- If a VIP guest is mentioned or implied, set priority to urgent
- If a guest check-in time is mentioned, set due_at to 30 minutes before that time
- Engineering issues (AC, plumbing, electrical) → task_type: engineering
- Housekeeping requests (towels, turndown, clean) → task_type: housekeeping
- Spanish input is acceptable. Parse correctly regardless of language.

Call the create_tasks function with an array of 1 or more task objects."""

    # Add room context if provided
    user_content = message
    if context and context.get("room_number"):
        user_content = f"[Context: currently viewing Room {context['room_number']}]\n{message}"

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        tools=[{"type": "function", "function": CREATE_TASKS_SCHEMA}],
        tool_choice={"type": "function", "function": {"name": "create_tasks"}},
        temperature=0.1,
    )

    msg = response.choices[0].message
    usage = response.usage

    raw_tasks = []
    if msg.tool_calls:
        import json
        args = json.loads(msg.tool_calls[0].function.arguments)
        raw_tasks = args.get("tasks", [])

    tasks = []
    for raw in raw_tasks:
        try:
            tasks.append(ParsedTaskOutput(**raw).model_dump())
        except ValidationError as exc:
            logger.warning("AI task output failed schema validation, skipping: %s", exc)

    return {
        "tasks": tasks,
        "prompt_tokens": usage.prompt_tokens,
        "completion_tokens": usage.completion_tokens,
    }


_FAST_PATTERNS = [
    # Housekeeping supply / cleaning
    (r"room\s*#?\s*(\d+)\s+needs?\s+(.+)", "housekeeping", "normal"),
    (r"(\d+)\s+needs?\s+(.+)", "housekeeping", "normal"),
    (r"(?:send|bring|deliver)\s+(.+?)\s+to\s+(?:room\s*)?(\d+)", "housekeeping", "normal"),
    # Engineering
    (r"room\s*#?\s*(\d+)\s+(.+?)\s+(?:is\s+)?(?:broken|not working|leaking|out|down)", "engineering", "urgent"),
    (r"(?:fix|repair|check)\s+(.+?)\s+in\s+(?:room\s*)?(\d+)", "engineering", "urgent"),
    # Guest request
    (r"room\s*#?\s*(\d+)\s+guest\s+(?:requesting|needs?|wants?)\s+(.+)", "guest_request", "normal"),
    # Shorthand supply (e.g. "101 towels", "305 trash")
    (r"(\d+)\s+(towels?|linens?|sheets?|soap|shampoo|amenities|supplies|trash|garbage|pillows?|blankets?|tp|toilet\s+paper|coffee|cups?)", "housekeeping", "normal"),
    # Clean / turndown shorthand (e.g. "clean 210", "turndown 305")
    (r"(clean|vacuum|mop|sanitize|disinfect|turndown)\s+(?:room\s*)?(\d+)", "housekeeping", "normal"),
    # Checkout / departure (e.g. "101 checkout")
    (r"(\d+)\s+(checkout|check\s*out|departure|check-out)", "housekeeping", "normal"),
    # Restock shorthand (e.g. "restock 210")
    (r"(restock|resupply|refill)\s+(?:room\s*)?(\d+)", "housekeeping", "normal"),
    # VIP urgency (e.g. "101 vip arrival")
    (r"(\d+)\s+(vip\s*.+)", "housekeeping", "urgent"),
]


def try_fast_path(message: str) -> Optional[dict]:
    """
    Returns a parse_nl_tasks-shaped dict if message matches a known high-confidence
    pattern (confidence >= 0.92), otherwise returns None.
    """
    text = message.strip()
    for pattern, task_type, priority in _FAST_PATTERNS:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            groups = m.groups()
            if len(groups) < 2:
                continue
            if groups[0].isdigit():
                room, description = groups[0], groups[1]
            else:
                room, description = groups[1], groups[0]
            title = f"{description.strip().capitalize()} — Room {room}"
            return {
                "tasks": [{
                    "title": title,
                    "description": None,
                    "task_type": task_type,
                    "priority": priority,
                    "room_number": room,
                    "due_at": None,
                    "confidence": 0.92,
                }],
                "prompt_tokens": 0,
                "completion_tokens": 0,
            }
    return None

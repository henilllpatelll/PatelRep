from openai import OpenAI
from core.config import settings
from datetime import date

client = OpenAI(api_key=settings.openai_api_key)

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

    tasks = []
    if msg.tool_calls:
        import json
        args = json.loads(msg.tool_calls[0].function.arguments)
        tasks = args.get("tasks", [])

    return {
        "tasks": tasks,
        "prompt_tokens": usage.prompt_tokens,
        "completion_tokens": usage.completion_tokens,
    }

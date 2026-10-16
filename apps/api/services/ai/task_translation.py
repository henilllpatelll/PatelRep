"""Translate ONE already-authorised task's title and description (English <-> Spanish).

Reuses the Logbook translator (same constrained prompt, same provider route) rather than adding a second
engine. The caller supplies a task id it has already authorised; no browser text ever reaches the model.
The stored task is never modified, and the cache key includes a hash of the text, so editing a task makes
the old translation unreachable.
"""
import hashlib
from typing import Optional

from services.ai.logbook_translation import translate_logbook_content

SEPARATOR = "\n\n@@@@\n\n"
MAX_FIELD_CHARS = 2000


def task_source_hash(title: str, description: Optional[str]) -> str:
    material = f"{(title or '').strip()}␟{(description or '').strip()}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def translate_task_fields(title: str, description: Optional[str], target_language: str) -> dict:
    """{"title", "description", "prompt_tokens", "completion_tokens"}; raises if the provider returns nothing."""
    title = (title or "").strip()[:MAX_FIELD_CHARS]
    body = (description or "").strip()[:MAX_FIELD_CHARS]
    if not body:
        one = translate_logbook_content(title, target_language, max_tokens=400)
        return {"title": one["translated_text"], "description": None,
                "prompt_tokens": one["prompt_tokens"], "completion_tokens": one["completion_tokens"]}

    both = translate_logbook_content(f"{title}{SEPARATOR}{body}", target_language, max_tokens=1600)
    parts = [p.strip() for p in both["translated_text"].split("@@@@")]
    if len(parts) == 2 and all(parts):
        return {"title": parts[0], "description": parts[1],
                "prompt_tokens": both["prompt_tokens"], "completion_tokens": both["completion_tokens"]}

    # The model dropped the divider: translate the fields separately rather than guess where the title ends.
    first = translate_logbook_content(title, target_language, max_tokens=400)
    second = translate_logbook_content(body, target_language, max_tokens=1200)
    return {
        "title": first["translated_text"], "description": second["translated_text"],
        "prompt_tokens": both["prompt_tokens"] + first["prompt_tokens"] + second["prompt_tokens"],
        "completion_tokens": both["completion_tokens"] + first["completion_tokens"] + second["completion_tokens"],
    }

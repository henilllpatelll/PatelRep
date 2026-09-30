"""Constrained server-side translation for Logbook content.

The caller supplies only an already-authorized source entity id and target
language. This service never accepts browser-provided prompts or text.
"""

from services.ai.providers import get_openai_client


def translate_logbook_content(source_text: str, target_language: str) -> dict:
    target_name = "Spanish" if target_language == "es" else "English"
    response = get_openai_client().chat.completions.create(
        model="gpt-4o-mini",
        temperature=0,
        max_tokens=1200,
        messages=[
            {
                "role": "system",
                "content": (
                    "Translate hotel operations text faithfully. Preserve names, room numbers, "
                    "task and work-order IDs, dates, times, measurements, and abbreviations. "
                    "Return only the translation; do not summarize or add explanation."
                ),
            },
            {"role": "user", "content": f"Translate to {target_name}:\n\n{source_text}"},
        ],
    )
    translated_text = (response.choices[0].message.content or "").strip()
    if not translated_text:
        raise RuntimeError("Translation provider returned no text")
    # We intentionally leave uncertain detection unset instead of guessing from
    # browser settings; the UI only claims the target language with certainty.
    return {"translated_text": translated_text, "source_language": None}

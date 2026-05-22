# SOP Q&A Wiring + Mobile Voice Input + Credit Fast Path

## Context

Three AI copilot improvements to reduce friction for hotel floor staff and control AI credit burn:

1. **SOP Q&A** — the RAG pipeline (`sop_rag.py`) is fully built (pgvector + Claude Sonnet) but the `/ai/copilot/chat` endpoint returns a stub instead of calling it. Wire the real path.
2. **Voice input (mobile)** — housekeepers on the floor can't type easily. Add hold-to-record mic button on the mobile copilot screen using on-device STT (0 credits).
3. **Credit fast path** — simple, unambiguous task requests (any type, confidence ≥ 0.90) should skip the LLM entirely, show the same task preview, and charge 0 credits.

---

## Decisions Made

| Topic | Decision |
|-------|----------|
| SOP fallback | Pre-check `sop_documents` table. If 0 indexed docs → graceful 0-credit message. If docs exist → call `query_sop()`, charge 2 credits. |
| Voice surface | Mobile only (device mic). `expo-speech-recognition` (on-device iOS/Android STT, free). |
| Voice UX | Mic button beside the send button. Hold-to-record → release fills text input → user taps send. |
| Fast path action | Still show preview (same task preview card). Skip LLM. 0 credits. `model_used: "rule_engine"`. |
| Fast path scope | All task types (housekeeping, engineering, guest_request) at confidence ≥ 0.90. |

---

## Critical Files

| File | Change |
|------|--------|
| `apps/api/routers/ai_copilot.py` | SOP wiring + fast path call-site |
| `apps/api/services/ai/sop_rag.py` | `query_sop()` — already built, just need to import + call |
| `apps/api/services/ai/task_parser.py` | Add `try_fast_path()` function |
| `apps/mobile/app/(app)/copilot/index.tsx` | Mic button + `expo-speech-recognition` hooks |
| `apps/mobile/package.json` | Add `expo-speech-recognition` |

---

## 1. SOP Q&A Wiring

**File**: `apps/api/routers/ai_copilot.py`

Add import:
```python
from services.ai.sop_rag import query_sop
```

Replace the `sop_query` stub with:

```python
elif intent == "sop_query":
    sop_check = (
        supabase.table("sop_documents")
        .select("id", count="exact")
        .eq("hotel_id", hotel_id)
        .eq("indexing_status", "indexed")
        .limit(1)
        .execute()
    )
    if not sop_check.count:
        response_payload = {
            "response_type": "answer",
            "message": "No SOPs have been uploaded yet. Upload your procedures in the SOP Library and I'll be able to answer questions about them.",
            "sources": [],
            "credits_used": 0,
            "model_used": None,
        }
    else:
        sop_result = await query_sop(query=message, hotel_id=hotel_id)
        credits = await check_and_deduct_credits(hotel_id, "sop_query")
        await log_ai_interaction(
            hotel_id=hotel_id,
            user_id=current_user.user_id,
            interaction_type="sop_query",
            model_used="claude-sonnet-4-6",
            prompt_tokens=sop_result.get("prompt_tokens", 0),
            completion_tokens=sop_result.get("completion_tokens", 0),
            credits_charged=credits,
            latency_ms=int((time.time() - start_time) * 1000),
            success=True,
        )
        response_payload = {
            "response_type": "answer",
            "message": sop_result["answer"],
            "sources": sop_result.get("sources", []),
            "suggested_tasks": sop_result.get("suggested_tasks", []),
            "credits_used": credits,
            "model_used": "claude-sonnet-4-6",
        }
```

---

## 2. Mobile Voice Input

**Install**:
```bash
cd apps/mobile && npx expo install expo-speech-recognition
```

Add to `app.json` plugins (for permissions):
- iOS: `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`
- Android: `RECORD_AUDIO` (auto-added by the library plugin)

**File**: `apps/mobile/app/(app)/copilot/index.tsx`

```tsx
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

// State
const [isRecording, setIsRecording] = useState(false);

// Fill input on result
useSpeechRecognitionEvent('result', (event) => {
  const transcript = event.results[0]?.transcript ?? '';
  setInputText(transcript);
  setIsRecording(false);
});

// Hold-to-record handlers
const handleMicPressIn = () => {
  setIsRecording(true);
  ExpoSpeechRecognitionModule.start({ lang: 'en-US', continuous: false, interimResults: false });
};
const handleMicPressOut = () => {
  ExpoSpeechRecognitionModule.stop();
};
```

Mic button (placed left of existing send button in the input row):
```tsx
<TouchableOpacity
  onPressIn={handleMicPressIn}
  onPressOut={handleMicPressOut}
  style={[styles.micButton, isRecording && styles.micActive]}
>
  <Mic size={20} color={isRecording ? '#EF4444' : '#6B7280'} />
</TouchableOpacity>
```

Transcribed text enters the existing copilot chat flow unchanged. 0 credits charged.

---

## 3. Credit Fast Path (Rule Engine)

**File**: `apps/api/services/ai/task_parser.py` — add `try_fast_path()`:

```python
import re
from typing import Optional

_FAST_PATTERNS = [
    # Housekeeping — supply / cleaning requests
    (r"room\s*(?:#?\s*)?(\d+)\s+needs?\s+(.+)", "housekeeping", "normal"),
    (r"(\d+)\s+needs?\s+(.+)", "housekeeping", "normal"),
    (r"(?:send|bring|deliver)\s+(.+?)\s+to\s+(?:room\s*)?(\d+)", "housekeeping", "normal"),
    # Engineering — broken / not working / leak
    (r"room\s*(?:#?\s*)?(\d+)\s+(.+?)\s+(?:is\s+)?(?:broken|not working|leaking|out|down)", "engineering", "urgent"),
    (r"(?:fix|repair|check)\s+(.+?)\s+in\s+(?:room\s*)?(\d+)", "engineering", "urgent"),
    # Guest request
    (r"room\s*(?:#?\s*)?(\d+)\s+guest\s+(?:requesting|needs?|wants?)\s+(.+)", "guest_request", "normal"),
]

def try_fast_path(message: str) -> Optional[dict]:
    """
    Returns a parse_nl_tasks-shaped dict if message matches a known pattern
    at confidence >= 0.90, otherwise returns None.
    """
    text = message.strip()
    for pattern, task_type, priority in _FAST_PATTERNS:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            groups = m.groups()
            if len(groups) < 2:
                continue
            # Determine which group is the room number
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
```

**File**: `apps/api/routers/ai_copilot.py` — in the `task_creation` branch, before `parse_nl_tasks()`:

```python
from services.ai.task_parser import parse_nl_tasks, try_fast_path

# Inside task_creation intent block:
fast = try_fast_path(message)
if fast:
    response_payload = {
        "response_type": "task_preview",
        "message": "I recognised that — here's what I'll create:",
        "tasks": fast["tasks"],
        "requires_confirmation": True,
        "credits_used": 0,
        "model_used": "rule_engine",
    }
else:
    # Existing LLM path (1 credit)
    parsed = await parse_nl_tasks(message, ...)
    ...
```

---

## Verification

### SOP Q&A
- Upload an SOP PDF in the SOP Library; confirm `indexing_status = "indexed"` in `sop_documents`
- Ask a procedure question in AI Copilot → real Claude answer + sources returned
- Ask with no SOPs uploaded → graceful 0-credit message
- Check `ai_interactions` for 2 credits deducted and correct token counts

### Voice Input (Mobile)
- Build: `npx expo run:android` (or `run:ios`)
- Hold mic button → speak "Room 412 needs towels" → release → input fills with transcript
- Tap send → task preview appears with correct room and type
- No credits charged for the STT step

### Fast Path
- POST `/ai/copilot/chat` `{ "message": "room 205 needs towels" }` → `model_used: "rule_engine"`, `credits_used: 0`, housekeeping task preview
- POST `{ "message": "room 301 AC is broken" }` → engineering task, urgent, 0 credits
- POST ambiguous `{ "message": "something seems off" }` → falls through to LLM, 1 credit

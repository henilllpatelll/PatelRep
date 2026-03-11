# PatelRep — AI Integration Specification

## 1. Model Routing Matrix

| Interaction Type | Model | Provider | Why | Target Latency | Credits |
|---|---|---|---|---|---|
| NL → task/work-order creation | `gpt-4o-mini` | OpenAI | Best function calling, structured JSON output, fast | < 800ms | 1 |
| Onboarding assistant chat | `gpt-4o-mini` | OpenAI | Conversational, guided, structured responses | < 1s | 1 |
| SOP RAG Q&A | `claude-3-5-sonnet-20241022` | Anthropic | Long context, precise instruction following, complex reasoning | 2–4s (async OK) | 2 |
| Room readiness prediction (per room) | `claude-3-5-sonnet-20241022` | Anthropic | Multi-factor reasoning with workload + time calculations | batch async | 0.5 |
| Asset failure prediction (per asset) | `claude-3-5-sonnet-20241022` | Anthropic | Pattern analysis, cost estimation, recommendation generation | nightly batch | 0.25 |
| AI shift summary | `claude-3-5-sonnet-20241022` | Anthropic | Long-form narrative generation from structured data | end of shift | 3 |
| GM insight generation | `claude-3-5-sonnet-20241022` | Anthropic | Cross-domain analysis, trend reasoning | on-demand | 2 |
| AI room auto-assignment | `gpt-4o-mini` | OpenAI | Scoring + ranking, structured output | < 1s | 0.5 |
| Text embeddings (SOP indexing) | `text-embedding-3-small` | OpenAI | 1536-dim embeddings, $0.02/1M tokens | async | 0 (infra cost) |

---

## 2. NL → Task Creation Flow

### 2.1 Flow Diagram

```
Staff Input: "Room 412 needs extra towels and VIP turndown setup, guest arrives 3PM"
    │
    ▼
POST /ai/copilot/chat
    │
    ├─► Inject context:
    │     - current_user.role + name
    │     - current_hotel.name
    │     - room_id (if screen context available)
    │     - today's date + shift
    │
    ▼
GPT-4o-mini (function calling)
    │  Function: create_tasks(tasks: Task[])
    │
    ▼
Parsed output:
    [
      { title: "Extra towels", task_type: "housekeeping", priority: "normal", room_id: "uuid" },
      { title: "VIP turndown setup", task_type: "housekeeping", priority: "urgent", room_id: "uuid",
        due_at: "2026-03-06T15:00:00Z" }  ← 3PM extracted
    ]
    │
    ▼
Confidence check: if confidence < 0.7 → show confirmation with editable fields
    │
    ▼
Staff confirms → POST /tasks (batch create)
    │
    ▼
AI assignment algorithm runs (see §7)
    │
    ▼
Push notification → assigned staff
Supabase Realtime → room board updates
```

### 2.2 System Prompt (NL Task Creation)

```
You are the AI operations assistant for {hotel_name}, a hotel in Texas.
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

Call the create_tasks function with an array of 1 or more task objects.
```

### 2.3 Function Schema (GPT-4o-mini)

```json
{
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
            "title": { "type": "string" },
            "description": { "type": "string" },
            "task_type": { "enum": ["housekeeping", "engineering", "guest_request", "general"] },
            "priority": { "enum": ["urgent", "normal", "low"] },
            "room_number": { "type": "string" },
            "due_at": { "type": "string", "format": "date-time" },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
          },
          "required": ["title", "task_type", "priority", "confidence"]
        }
      }
    },
    "required": ["tasks"]
  }
}
```

---

## 3. Room Readiness Prediction Engine

### 3.1 Prediction Algorithm (runs every 30 minutes via Railway Cron)

```python
# FastAPI endpoint: POST /internal/predictions/run
async def run_room_predictions(hotel_id: str):
    # 1. Get all rooms with DIRTY or IN_PROGRESS status and a check-in today
    rooms = await get_at_risk_rooms(hotel_id)

    for room in rooms:
        # 2. Get housekeeper speed profile
        hk_profile = await get_housekeeper_profile(
            user_id=room.assigned_to,
            room_type_id=room.room_type_id
        )
        # avg_speed = hk_profile.avg_clean_minutes or room_type.base_clean_minutes

        # 3. Get housekeeper's current workload (rooms remaining ahead of this one)
        rooms_ahead = await count_rooms_ahead(
            user_id=room.assigned_to,
            current_room_priority=room.priority
        )

        # 4. Calculate ETA
        minutes_remaining = rooms_ahead * hk_profile.avg_clean_minutes
        predicted_ready = datetime.now() + timedelta(minutes=minutes_remaining)

        # 5. Calculate risk
        buffer_minutes = (room.checkin_time - predicted_ready).total_seconds() / 60
        risk_factors = []
        if room.vip_flag: risk_factors.append("vip_room")
        if buffer_minutes < 0: risk_factors.append("will_be_late")
        if rooms_ahead > 5: risk_factors.append("overloaded_housekeeper")
        if room.checkout_time > (room.checkin_time - timedelta(hours=4)):
            risk_factors.append("tight_turnaround")

        risk_level = "HIGH" if buffer_minutes < 0 else "MEDIUM" if buffer_minutes < 30 else "LOW"

        # 6. Update predictions table
        await upsert_prediction(room.id, predicted_ready, risk_level, risk_factors)

        # 7. Send push notification to supervisor if HIGH risk just detected
        if risk_level == "HIGH" and previous_risk != "HIGH":
            await notify_supervisor(hotel_id, room, predicted_ready)
```

### 3.2 Housekeeper Speed Profile Updates

After every room completion:
```python
async def update_housekeeper_profile(user_id, room_type_id, actual_minutes):
    profile = await get_profile(user_id, room_type_id)
    if profile:
        # Exponential moving average (recent completions weighted more)
        alpha = 0.3  # smoothing factor
        new_avg = alpha * actual_minutes + (1 - alpha) * profile.avg_clean_minutes
    else:
        new_avg = actual_minutes  # first entry
    await upsert_profile(user_id, room_type_id, new_avg)
```

### 3.3 Cold Start (New Hotel, No Historical Data)

```python
# 1. Industry defaults (if no profile exists)
ROOM_TYPE_DEFAULTS = {
    "king_suite": 40,
    "double_queen": 30,
    "standard_double": 25,
    "studio": 20,
}

# 2. Onboarding calibration (GM provides during setup)
# Stored in room_types.base_clean_minutes

# 3. Opera Cloud bootstrap (90 days of checkout history)
# Infer check-in/checkout pattern from Opera reservation history
# Use as proxy for room service cycles until real data accumulates
```

---

## 4. SOP RAG Architecture

### 4.1 Ingestion Pipeline

```
PDF Upload → Supabase Storage
     │
     ▼
FastAPI Background Task (triggered on upload)
     │
     ├─► Parse PDF text (pdfplumber Python library)
     │     - Extract text per page
     │     - Preserve section headers as metadata
     │
     ├─► Chunk text
     │     - Chunk size: 500 tokens (cl100k_base tokenizer)
     │     - Overlap: 50 tokens
     │     - Keep sections intact where possible
     │
     ├─► Generate embeddings
     │     - OpenAI text-embedding-3-small
     │     - 1536 dimensions
     │     - Batch 100 chunks per API call
     │
     ├─► Store in sop_chunks table
     │     - content, embedding, metadata (page, section, document_id)
     │     - tenant_id for RLS isolation
     │
     └─► Update sop_documents.indexing_status = 'indexed'
         Supabase Realtime notifies web client → "Indexed!" confirmation
```

### 4.2 Query Pipeline (SOP Q&A)

```python
async def sop_query(query: str, hotel_id: str) -> SOPQueryResult:
    # 1. Generate query embedding
    query_embedding = await openai.embeddings.create(
        input=query,
        model="text-embedding-3-small"
    )

    # 2. Similarity search in pgvector
    # cosine distance, top 5 chunks, scoped to tenant
    chunks = await supabase.rpc('match_sop_chunks', {
        'query_embedding': query_embedding.data[0].embedding,
        'hotel_id': hotel_id,
        'match_threshold': 0.75,
        'match_count': 5
    })

    # 3. Build context for Claude
    context = "\n\n".join([
        f"[{c['metadata']['section']} - Page {c['metadata']['page']}]\n{c['content']}"
        for c in chunks
    ])

    # 4. Claude Sonnet generates answer
    response = await anthropic.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=1024,
        system=SOP_SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": f"Context from hotel SOPs:\n{context}\n\nQuestion: {query}"
        }]
    )

    # 5. Extract procedure steps if present → suggest tasks
    ...
    return SOPQueryResult(answer=..., suggested_tasks=..., sources=...)
```

### 4.3 pgvector SQL Function

```sql
CREATE OR REPLACE FUNCTION match_sop_chunks(
  query_embedding VECTOR(1536),
  hotel_id UUID,
  match_threshold FLOAT DEFAULT 0.75,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID, content TEXT, similarity FLOAT, metadata JSONB
)
LANGUAGE sql STABLE AS $$
  SELECT
    id, content,
    1 - (embedding <=> query_embedding) AS similarity,
    metadata
  FROM sop_chunks
  WHERE
    tenant_id = hotel_id
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

### 4.4 SOP Query System Prompt (Claude Sonnet)

```
You are the SOP assistant for {hotel_name}. You answer staff questions about hotel
procedures using ONLY the provided SOP excerpts.

Rules:
1. Only answer from the provided context. If the answer isn't in the context, say:
   "I don't have that procedure in your uploaded SOPs. Please check with your supervisor."
2. Format procedures as numbered steps.
3. If the procedure involves tasks that should be created (cleaning setup, VIP service, etc.),
   end your response with a "SUGGESTED_TASKS" JSON block listing the tasks to create.
4. Keep responses concise and action-oriented.
5. If the staff member wrote in Spanish, respond in Spanish.

SUGGESTED_TASKS format (only include if procedure creates tasks):
SUGGESTED_TASKS: [{"title": "...", "task_type": "...", "priority": "..."}]
```

---

## 5. Asset Failure Prediction (Nightly Batch)

### 5.1 Data Collection per Asset

```python
async def get_asset_context(asset_id: str, hotel_id: str) -> dict:
    return {
        "asset": await get_asset_details(asset_id),
        "work_orders_90d": await get_work_orders(asset_id, days=90),
        "pm_history": await get_pm_completions(asset_id, days=180),
        "pm_schedule": await get_pm_schedule(asset_id),
        "days_since_last_pm": ...,
        "category_benchmarks": FAILURE_BENCHMARKS.get(asset.category_code, {}),
    }
```

### 5.2 Failure Prediction Prompt (Claude Sonnet)

```
You are a hotel maintenance AI analyst. Analyze this asset's maintenance history and
provide a failure risk assessment.

Asset: {asset_name}
Category: {category}
Age: {age_years} years (expected lifespan: {lifespan} years)
Purchase cost: ${purchase_cost} | Replacement cost: ${replacement_cost}

Work Orders (last 90 days):
{work_orders_summary}

Preventive Maintenance:
- Last PM completed: {last_pm_date}
- Next PM due: {next_pm_date}
- Days overdue: {days_overdue}
- PM compliance rate: {pm_compliance_pct}%

Industry benchmarks for {category}:
- Average failure rate after {age} years: {benchmark}
- Common failure indicators: {indicators}

Provide a JSON response with:
{
  "risk_score": 0-100,
  "predicted_failure_window": "next 30 days|next 90 days|not imminent",
  "failure_indicators": ["list of specific indicators from this asset's data"],
  "recommendation": "concise action recommendation",
  "estimated_repair_cost": float,
  "reasoning": "2-3 sentence explanation"
}

Be conservative with high risk scores (70+). Only assign HIGH risk if there is clear
pattern evidence from the work order history.
```

### 5.3 Failure Benchmarks (Seed Data)

```python
FAILURE_BENCHMARKS = {
    "HVAC": {
        "avg_lifespan_years": 15,
        "high_risk_age_years": 12,
        "failure_indicators": ["refrigerant leak", "capacitor failure", "compressor noise"],
        "typical_repair_cost": 400,
        "typical_replace_cost": 3000,
    },
    "ICE": {
        "avg_lifespan_years": 10,
        "high_risk_age_years": 8,
        "failure_indicators": ["ice production drop", "water leak", "compressor cycling"],
        "typical_repair_cost": 250,
        "typical_replace_cost": 1800,
    },
    # ... other categories
}
```

---

## 6. AI Auto-Assignment Algorithm

### 6.1 Scoring Logic

```python
async def suggest_room_assignments(hotel_id: str, date: date, shift_id: str):
    available_housekeepers = await get_on_shift_staff(hotel_id, shift_id, 'housekeeper')
    dirty_rooms = await get_unassigned_dirty_rooms(hotel_id, date)

    # Build a score matrix: housekeeper × room
    suggestions = []
    for hk in available_housekeepers:
        hk_profile = await get_housekeeper_profiles(hk.id)  # per room type
        assigned_rooms = []
        workload_minutes = 0

        for room in sorted(dirty_rooms, key=lambda r: (r.checkin_time or far_future, -r.vip_flag)):
            room_type_avg = hk_profile.get(room.room_type_id, room_type.base_clean_minutes)
            workload_minutes += room_type_avg
            assigned_rooms.append(room.id)

            # Stop when workload fills shift
            if workload_minutes >= shift_duration_minutes * 0.90:
                break

        suggestions.append({
            "housekeeper_id": hk.id,
            "housekeeper_name": hk.preferred_name,
            "room_ids": assigned_rooms,
            "estimated_completion": shift_start + timedelta(minutes=workload_minutes),
            "workload_balance_score": ...,
        })

    # Balance check: redistribute if any HK is > 20% above average workload
    suggestions = rebalance_workloads(suggestions)
    return suggestions
```

---

## 7. AI Shift Summary Generation

### 7.1 Data Aggregation

```python
async def generate_shift_summary(shift_id: str, hotel_id: str, dept_id: str):
    stats = {
        "rooms_cleaned": count_rooms_cleaned(shift_id),
        "rooms_inspected": count_rooms_inspected(shift_id),
        "inspection_fail_rate": ...,
        "work_orders_opened": count_wos_opened(shift_id),
        "work_orders_completed": count_wos_completed(shift_id),
        "sla_compliance_pct": calculate_sla_compliance(shift_id),
        "guest_requests_handled": count_guest_requests(shift_id),
        "urgent_tasks_count": count_urgent_tasks(shift_id),
        "outstanding_items": get_open_items(shift_id),  # Carry to next shift
        "vip_rooms_served": count_vip_rooms(shift_id),
    }
    # Send to Claude Sonnet for narrative generation
```

### 7.2 Shift Summary Prompt

```
You are generating a shift handoff summary for {dept_name} at {hotel_name}.
Date: {date}, Shift: {shift_name} ({start}–{end})

Shift statistics:
{stats_json}

Write a concise shift summary for the incoming supervisor. Include:
1. One-sentence overview ("Strong shift — all 47 rooms cleaned with 94% SLA compliance")
2. Key wins (2-3 bullets)
3. Issues/open items for next shift (2-3 bullets)
4. One actionable recommendation for the next shift

Keep it under 200 words. Write in clear, plain English suitable for hotel supervisors.
If the stats show any Spanish-speaking staff names, keep the summary in English (supervisors read English).
```

---

## 8. GM Insights Engine

### 8.1 Insights Prompt (Daily, on-demand)

```
You are the operations intelligence assistant for {hotel_name}.
Analyze the following 7-day operational data and provide 3-5 actionable insights.

Data summary:
- Housekeeping SLA compliance: {hk_sla}% (7d avg)
- Average check-in readiness: {readiness}%
- Labor hours (Housekeeping): {hk_hours}h/day avg
- Work orders opened: {wo_open}/day avg
- Work orders completed: {wo_complete}/day avg
- SLA breach rate: {breach_pct}%
- Top repeat issues: {top_issues}
- Engineering overtime: {eng_overtime}%
- AI credit usage trend: {credit_trend}

Provide insights in JSON:
[{
  "type": "labor_efficiency|sla_risk|maintenance_pattern|cost_savings|staffing",
  "severity": "info|warning|critical",
  "title": "Short title (max 8 words)",
  "detail": "1-2 sentence explanation with specific numbers",
  "action": "Specific recommended action (max 10 words)"
}]

Focus on what matters most to a hotel GM: guest satisfaction, labor cost, and asset protection.
```

---

## 9. Onboarding AI Assistant

```python
ONBOARDING_SYSTEM_PROMPT = """
You are the setup assistant for PatelRep, helping {gm_name} configure their hotel
{hotel_name} on the platform.

Current onboarding step: {current_step}
Completed steps: {completed_steps}
Hotel details so far: {hotel_context}

Your job is to:
1. Guide them through the current setup step
2. Answer questions about how the platform works
3. Pre-fill suggestions based on what they've told you
4. Be encouraging — setup should feel easy, not overwhelming

Current step details:
{step_instructions}

Be conversational, concise, and practical. This GM probably runs a 50-100 room independent
hotel and doesn't have time for lengthy explanations.
"""
```

---

## 10. FastAPI AI Router Structure

```python
# routers/ai.py
from fastapi import APIRouter, Depends
from services.ai.router import route_to_model
from services.ai.task_parser import parse_nl_task
from services.ai.sop_rag import query_sop
from services.ai.predictions import run_room_predictions
from services.ai.insights import generate_gm_insights

router = APIRouter(prefix="/ai", tags=["ai"])

@router.post("/copilot/chat")
async def copilot_chat(request: CopilotRequest, hotel: Hotel = Depends(get_hotel)):
    """Main copilot endpoint — routes to appropriate AI function based on intent."""
    intent = detect_intent(request.message, request.context)

    if intent == "task_creation":
        return await parse_nl_task(request.message, hotel, request.context)
    elif intent == "sop_query":
        return await query_sop(request.message, hotel)
    elif intent == "insight_query":
        return await generate_gm_insights(hotel, query=request.message)
    else:
        return await general_chat(request.message, hotel, request.context)

def detect_intent(message: str, context: dict) -> str:
    """
    Fast regex/keyword intent detection before sending to LLM.
    Avoids unnecessary LLM calls for clear intent signals.
    """
    task_keywords = ["need", "broken", "fix", "clean", "towels", "urgent", "room", "request"]
    sop_keywords = ["how do", "procedure", "policy", "protocol", "sop", "steps"]

    msg_lower = message.lower()
    if any(kw in msg_lower for kw in sop_keywords):
        return "sop_query"
    if any(kw in msg_lower for kw in task_keywords):
        return "task_creation"
    return "general"
```

---

## 11. Credit Metering (AI Cost Tracking)

```python
# middleware/ai_credits.py
async def charge_ai_credits(hotel_id: str, interaction_type: str, model: str,
                             prompt_tokens: int, completion_tokens: int) -> bool:
    CREDIT_COSTS = {
        "task_creation": 1.0,
        "room_prediction": 0.5,
        "sop_query": 2.0,
        "failure_prediction": 0.25,
        "shift_summary": 3.0,
        "gm_insight": 2.0,
        "assignment_suggestion": 0.5,
    }

    credits = CREDIT_COSTS.get(interaction_type, 1.0)

    # Check cap before charging
    ledger = await get_current_ledger(hotel_id)
    if is_at_cap(ledger):
        return False  # Block AI interaction, show upgrade prompt

    # Deduct credits
    await increment_credits_used(hotel_id, credits)

    # Log interaction
    await log_ai_interaction(
        hotel_id=hotel_id,
        interaction_type=interaction_type,
        model_used=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        credits_charged=credits,
    )
    return True
```

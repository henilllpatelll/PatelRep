# Plan: AI Copilot as Primary Staff Interface

## Context

The AI Copilot FAB (`AICopilotBubble.tsx`) already exists, is mounted globally in `DashboardShell.tsx`, and already handles NL→task parsing via `POST /ai/copilot/chat` → `POST /ai/tasks/confirm`. The problem: it only covers one action type (task creation), stays open after an action, has no shift history, and falls back to text for ambiguous input instead of quick-tap buttons.

This plan extends the existing bubble and backend — no new components, no new architecture.

---

## UX Target (confirmed)

- **Floating bubble:** keep placement, extend behavior
- **Action model:** Show intent → confirm (one tap) → execute → close panel + toast
- **Ambiguity:** Show 2–3 button chips, not a text question
- **History:** Persist full shift history to localStorage, restore on panel open
- **Actions:** Work orders, guest requests, task assignment
  - Room status: already handled by existing task parser — no change needed

---

## Phase 1 — Backend: Extend Intent Routing

### 1a. `apps/api/routers/ai_copilot.py` — extend `detect_intent()`

Add new intent types:
- `work_order_creation` — AC, HVAC, plumbing, leak, electrical, elevator, broken, repair, maintenance
- `guest_request_creation` — guest wants/needs, towels, rollaway, extra, bring, deliver
- `task_assignment` — assign, give, reassign, move [name] to, put [name] on
- `ambiguous` — when top two intents are within 20% confidence of each other

### 1b. New response types (Pydantic models in `apps/api/models/requests.py`)

```python
WorkOrderPreview:    title, category, priority, room_number, location_text, description
GuestRequestPreview: title, room_number, guest_name, description
AssignmentPreview:   staff_name_hint, staff_id (resolved), room_numbers[], task_ids[]
AmbiguousOption:     label, intent_hint

WorkOrderPreviewResponse:    response_type="work_order_preview", work_orders[], requires_confirmation, credits_used
GuestRequestPreviewResponse: response_type="guest_request_preview", requests[], requires_confirmation, credits_used
AssignmentPreviewResponse:   response_type="assignment_preview", assignments[], requires_confirmation, credits_used
AmbiguousResponse:           response_type="ambiguous", message, options[]
```

### 1c. New AI service parsers in `apps/api/services/ai/`

**`work_order_parser.py`**
- Model: GPT-4o-mini, function calling
- Output: `{ title, category, priority, room_number, location_text, description }`
- Category enum: `plumbing | electrical | hvac | furniture | appliance | structural | safety | general`

**`guest_request_parser.py`**
- Model: GPT-4o-mini, function calling
- Output: `{ title, room_number, guest_name, description }`

**`assignment_parser.py`**
- Model: GPT-4o-mini, function calling
- Output: `{ assignments: [{ staff_name_hint, room_numbers[], task_ids[] }] }`
- Staff UUID resolution happens in the endpoint (fuzzy match against hotel's staff table by first/last name)

### 1d. New confirm endpoints in `apps/api/routers/ai_copilot.py`

```
POST /ai/work-orders/confirm
  auth: get_current_user required
  body: list[WorkOrderPreview]
  action: resolve room_id from room_number, insert into work_orders table
  returns: { data: { created_count, work_orders[] } }

POST /ai/guest-requests/confirm
  auth: get_current_user required
  body: list[GuestRequestPreview]
  action: resolve room_id, insert into guest_requests table (auto-creates linked task)
  returns: { data: { created_count, requests[] } }

POST /ai/assignments/confirm
  auth: get_current_user required, require_role(housekeeping_supervisor, chief_engineer, gm)
  body: list[AssignmentPreview]
  action:
    - room assignments → call housekeeping save_assignments logic
    - task assignments → UPDATE tasks SET assigned_to = staff_id WHERE id IN (task_ids)
  returns: { data: { assigned_count } }
```

Credits are deducted at chat stage (existing behavior) — confirm endpoints do NOT deduct.

---

## Phase 2 — Frontend: Extend AICopilotBubble

**File:** `apps/web/components/ai/AICopilotBubble.tsx`

### 2a. New response type renderers

Handle `work_order_preview`, `guest_request_preview`, `assignment_preview` using the same card-list + Confirm/Cancel pattern already used for `task_preview`.

Work order preview card shows: title, category badge, priority badge, room number.
Guest request preview card shows: title, room number, guest name.
Assignment preview card shows: staff name, rooms or tasks being assigned.

### 2b. Ambiguity UI — button chips

When `response_type === "ambiguous"`:
```tsx
<div className="flex gap-2 flex-wrap mt-2">
  {options.map(opt => (
    <button key={opt.intent_hint} onClick={() => resendWithHint(opt.intent_hint)}>
      {opt.label}
    </button>
  ))}
</div>
```
`resendWithHint` resends the original user message with `context: { intent_hint }` — the backend skips ambiguity detection and routes directly to the hinted intent.

### 2c. Post-action close + toast

After any confirm action succeeds:
1. Set `isOpen = false` (close panel)
2. Fire `toast.success(summaryMessage)` via sonner (already in the stack)
3. Invalidate React Query keys: `["work-orders"]`, `["guest-requests"]`, `["tasks"]` as appropriate

### 2d. Shift history — localStorage

```typescript
const HISTORY_KEY = `copilot-shift-${userId}-${todayISO}`;

// On panel mount: restore
const saved = localStorage.getItem(HISTORY_KEY);
if (saved) setMessages(JSON.parse(saved));

// After each message exchange: persist
localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-50)));
```

Cap at 50 messages. Key rotates daily so history auto-expires.

### 2e. `apps/web/lib/api/ai.ts` — new types + API calls

```typescript
// Types
WorkOrderPreview, GuestRequestPreview, AssignmentPreview
WorkOrderPreviewResponse, GuestRequestPreviewResponse, AssignmentPreviewResponse, AmbiguousResponse

// API calls
confirmWorkOrders: (previews: WorkOrderPreview[]) => Promise<{ data: { created_count; work_orders: WorkOrder[] } }>
confirmGuestRequests: (previews: GuestRequestPreview[]) => Promise<{ data: { created_count; requests: GuestRequest[] } }>
confirmAssignments: (previews: AssignmentPreview[]) => Promise<{ data: { assigned_count: number } }>
```

---

## Files Changed

| File | Change |
|------|--------|
| `apps/api/routers/ai_copilot.py` | Extend `detect_intent()`, add 3 confirm endpoints, handle 4 new response types |
| `apps/api/services/ai/work_order_parser.py` | **New** — GPT-4o-mini WO parser |
| `apps/api/services/ai/guest_request_parser.py` | **New** — GPT-4o-mini GR parser |
| `apps/api/services/ai/assignment_parser.py` | **New** — GPT-4o-mini assignment parser |
| `apps/api/models/requests.py` | Add preview/confirm Pydantic models |
| `apps/web/components/ai/AICopilotBubble.tsx` | Add response handlers, ambiguity chips, close+toast, localStorage history |
| `apps/web/lib/api/ai.ts` | Add new TypeScript types + 3 confirm API functions |

No new frontend components. No layout changes. No routing changes.

---

## Verification

1. `cd apps/api && pytest tests/` — all existing tests pass
2. Smoke test flows:
   - `"AC broken in 312"` → `work_order_preview` card with category=hvac, priority=urgent
   - `"guest in 410 wants extra towels"` → `guest_request_preview` card
   - `"assign Maria to rooms 200-210"` → `assignment_preview` (requires supervisor role)
   - `"312 has a problem"` → `ambiguous` response with chips: [Work Order] [Housekeeping] [Guest Request]
   - Confirm any → panel closes, toast fires, record appears in relevant dashboard list
3. Close and reopen bubble → prior shift messages still visible
4. Task creation (existing flow) → unchanged

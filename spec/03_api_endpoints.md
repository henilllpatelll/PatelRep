# PatelRep — API Endpoints Specification

## Base URL
- **Production:** `https://api.patelrep.com/v1`
- **Development:** `http://localhost:8000/v1`

## Authentication
All endpoints (except auth and webhooks) require:
```
Authorization: Bearer <supabase_jwt_token>
x-hotel-id: <tenant_uuid>
```
FastAPI middleware validates the Supabase JWT, extracts `hotel_id` and `role` from JWT claims, and injects them into request context.

## Common Response Formats
```json
// Success
{ "data": {...}, "meta": { "total": 100, "page": 1, "per_page": 20 } }

// Error
{ "error": { "code": "TASK_NOT_FOUND", "message": "Task not found", "details": null } }
```

---

## 1. Auth

### POST /auth/login
Initiate magic link or password login via Supabase Auth (handled client-side with Supabase JS). This endpoint sets up hotel context after Supabase auth completes.

**Request:**
```json
{ "hotel_id": "uuid" }
```
**Response:**
```json
{
  "data": {
    "user": { "id": "uuid", "full_name": "Maria Garcia", "role": "housekeeper", "language_pref": "es" },
    "hotel": { "id": "uuid", "name": "Austin Suites", "timezone": "America/Chicago" }
  }
}
```

### GET /auth/me
Returns current user profile + role for the active hotel.

### POST /auth/refresh
Refresh JWT token (handled automatically by Supabase JS client).

---

## 2. Hotels (Tenant Management)

### POST /hotels
Create new hotel (triggered during onboarding wizard).
```json
// Request
{
  "name": "Austin Suites Hotel",
  "address": "123 Congress Ave",
  "city": "Austin", "state": "TX", "zip": "78701",
  "room_count": 87,
  "timezone": "America/Chicago"
}
```

### GET /hotels/{hotel_id}
Returns hotel profile, integration status, subscription status.

### PATCH /hotels/{hotel_id}
Update hotel settings.

### GET /hotels/{hotel_id}/stats
High-level property stats (total rooms, active staff, open tasks).

---

## 3. Rooms

### GET /rooms
List all rooms with current status. Supports filters.
```
Query params:
  status=DIRTY|CLEAN|INSPECTED|OOO|IN_PROGRESS|PICKUP
  floor=3
  assigned_to=<user_uuid>
  risk_level=HIGH|MEDIUM|LOW
  include_predictions=true
```
**Response:**
```json
{
  "data": [{
    "id": "uuid",
    "room_number": "412",
    "floor": 4,
    "room_type": { "name": "King Suite", "base_clean_minutes": 40 },
    "status": "DIRTY",
    "assigned_to": { "id": "uuid", "preferred_name": "Maria" },
    "vip_flag": true,
    "guest_name": "John Smith",
    "checkin_time": "2026-03-06T15:00:00Z",
    "risk_level": "HIGH",
    "predicted_ready_at": "2026-03-06T15:45:00Z"
  }]
}
```

### GET /rooms/{room_id}
Full room detail including status history, current task, maintenance history.

### PATCH /rooms/{room_id}/status
Update room status. Validates allowed transitions.
```json
{ "status": "CLEAN", "notes": "Room is ready" }
```
Allowed transitions:
- `DIRTY → IN_PROGRESS` (housekeeper starts cleaning)
- `IN_PROGRESS → CLEAN` (housekeeper marks done)
- `CLEAN → INSPECTED` (supervisor approves)
- `CLEAN → DIRTY` (supervisor fails inspection)
- `* → OOO` (supervisor/GM only)

### GET /rooms/{room_id}/history
Status change history for a room.

### POST /rooms/import
Bulk create rooms from CSV or Opera Cloud sync.
```json
{
  "source": "csv|opera",
  "rooms": [{ "room_number": "101", "floor": 1, "room_type_code": "SD" }]
}
```

---

## 4. Housekeeping

### GET /housekeeping/board
Returns the full housekeeping room board. Optimized single query for the status board view.
```
Query params:
  date=2026-03-06 (defaults to today)
  shift_id=<uuid>
  include_predictions=true
```
**Response:** Array of rooms with status, assignment, prediction, guest data grouped by floor.

### POST /housekeeping/assignments
Create or update room assignments for the day.
```json
{
  "date": "2026-03-06",
  "assignments": [
    { "room_id": "uuid", "housekeeper_id": "uuid", "shift_id": "uuid" }
  ],
  "is_ai_suggested": true
}
```

### GET /housekeeping/assignments
Get today's room assignments grouped by housekeeper.

### POST /housekeeping/ai-suggest-assignments
Trigger AI auto-assignment algorithm. Returns suggestions (not yet committed).
```json
// Request
{ "date": "2026-03-06", "shift_id": "uuid" }

// Response
{
  "data": {
    "suggestions": [
      {
        "housekeeper_id": "uuid",
        "housekeeper_name": "Maria Garcia",
        "room_ids": ["uuid1", "uuid2", "uuid3"],
        "estimated_completion": "14:30",
        "workload_balance_score": 0.94,
        "reasoning": "Maria is fastest on King Suites and has 5 rooms assigned vs team avg of 6"
      }
    ],
    "unassigned_rooms": [],
    "balance_score": 0.91
  }
}
```

### GET /housekeeping/predictions
Room readiness risk predictions for today's check-ins.
```json
{
  "data": {
    "at_risk_count": 3,
    "rooms": [
      {
        "room_id": "uuid",
        "room_number": "312",
        "risk_level": "HIGH",
        "checkin_time": "2026-03-06T15:00:00Z",
        "predicted_ready_at": "2026-03-06T15:45:00Z",
        "delay_minutes": 45,
        "assigned_housekeeper": "Maria Garcia",
        "risk_factors": ["overloaded_housekeeper", "late_checkout"],
        "suggested_action": "Reassign to Carmen Rodriguez (2 rooms remaining)"
      }
    ]
  }
}
```

### GET /housekeeping/my-rooms
For housekeeper role: returns only assigned rooms for today.

---

## 5. Inspections

### POST /inspections
Submit completed inspection.
```json
{
  "room_id": "uuid",
  "template_id": "uuid",
  "overall_result": "passed|failed|conditional",
  "notes": "Bathroom spotless, minor dust on nightstand",
  "items": [
    { "template_item_id": "uuid", "result": "pass|fail|na", "note": "string" }
  ]
}
```
If `overall_result = "failed"`, room status is automatically reset to `DIRTY` and original housekeeper notified.

### GET /inspections
List inspections. Filters: date, room_id, result, inspected_by.

### GET /inspections/templates
Get inspection checklist templates for the hotel.

### POST /inspections/templates
Create or update inspection checklist.

---

## 6. Tasks

### POST /tasks
Create a task (structured form OR natural language).
```json
// Structured
{
  "title": "Extra towels needed",
  "task_type": "housekeeping",
  "priority": "normal",
  "room_id": "uuid",
  "description": "Guest requested 4 extra towels"
}

// Natural language (AI processes)
{
  "nl_input": "Room 412 needs extra towels and VIP turndown setup, guest arriving at 3",
  "use_ai": true
}
```
When `use_ai: true`, FastAPI calls GPT-4o-mini to parse → returns structured task preview for confirmation.

### GET /tasks
List tasks with filters.
```
Query params:
  status=open|in_progress|completed|cancelled
  task_type=housekeeping|engineering|guest_request
  priority=urgent|normal|low
  assigned_to=<uuid>
  room_id=<uuid>
  date_from=2026-03-01
  date_to=2026-03-06
  page=1&per_page=20
```

### GET /tasks/{task_id}
Full task detail with comments.

### PATCH /tasks/{task_id}
Update task status, assignment, priority.
```json
{ "status": "in_progress", "assigned_to": "uuid" }
```

### DELETE /tasks/{task_id}
Soft delete (sets status to cancelled).

### POST /tasks/{task_id}/comments
Add a comment to a task.

---

## 7. Work Orders

### POST /work-orders
Create work order (structured or NL).
```json
{
  "title": "AC not cooling in room 514",
  "category": "hvac",
  "priority": "urgent",
  "room_id": "uuid",
  "description": "Guest reported AC not working. Temp in room is 78F."
}
```

### GET /work-orders
List work orders with filters.
```
Query params:
  status=open|in_progress|on_hold|completed
  category=hvac|plumbing|electrical|...
  priority=urgent|normal|low
  assigned_to=<uuid>
  asset_id=<uuid>
  is_pm_generated=true|false
  date_from=...
  page=1&per_page=20
```

### GET /work-orders/{id}
Full work order detail with photos and comments.

### PATCH /work-orders/{id}
Update status, assignee, notes, labor hours.

### POST /work-orders/{id}/claim
Engineer claims an open work order (sets assigned_to = current user, status = in_progress).

### POST /work-orders/{id}/complete
Mark work order complete.
```json
{
  "notes": "Replaced AC filter and recharged coolant",
  "labor_hours": 1.5,
  "parts_used": "AC filter x1, refrigerant R-410A 1lb"
}
```

### POST /work-orders/{id}/photos
Upload photo to work order.
```
Content-Type: multipart/form-data
Fields: photo (file), photo_type (before|after|progress), caption (optional)
```
Returns Supabase Storage presigned upload URL.

### POST /work-orders/{id}/comments
Add comment.

---

## 8. Assets & PM

### GET /assets
List all assets with failure risk scores.
```
Query params:
  category=hvac|plumbing|...
  risk_score_min=70
  room_id=<uuid>
  include_predictions=true
```

### POST /assets
Create asset.
```json
{
  "name": "HVAC Unit - Room 412",
  "category_id": "uuid",
  "room_id": "uuid",
  "manufacturer": "Carrier",
  "model": "42XL15",
  "serial_number": "SN123456",
  "purchase_date": "2019-06-01",
  "expected_lifespan_years": 10,
  "replacement_cost": 2500.00
}
```

### PATCH /assets/{id}
Update asset details.

### GET /assets/{id}/work-order-history
All work orders for this asset (used for failure pattern analysis).

### GET /assets/failure-predictions
Top failure predictions sorted by risk score.
```json
{
  "data": [{
    "asset": { "id": "uuid", "name": "HVAC - 5th Floor Corridor" },
    "risk_score": 87,
    "predicted_failure_window": "next 30 days",
    "failure_indicators": ["3 work orders in 60 days", "PM overdue 45 days"],
    "estimated_repair_cost": 800,
    "estimated_replace_cost": 2500,
    "recommendation": "Schedule replacement before summer peak season"
  }]
}
```

### GET /pm-schedules
List PM schedules with next due dates.

### POST /pm-schedules
Create PM schedule for an asset.

### PATCH /pm-schedules/{id}
Update PM schedule (interval, assignee role, etc.).

### POST /pm-schedules/{id}/generate-work-order
Manually trigger PM work order generation (cron job does this automatically).

### GET /pm-schedules/overdue
List overdue PMs with AI risk assessment.

---

## 9. SOP Library

### POST /sop/documents
Upload SOP document.
```
Content-Type: multipart/form-data
Fields: file (PDF), title, category, description
```
Returns upload URL + triggers background indexing pipeline.

### GET /sop/documents
List SOP documents with indexing status.

### DELETE /sop/documents/{id}
Delete SOP and its vector chunks.

### POST /sop/query
RAG-powered SOP Q&A.
```json
// Request
{
  "query": "How do I set up a VIP turndown service?",
  "create_tasks": false
}

// Response
{
  "data": {
    "answer": "For VIP turndown service:\n1. Turn down bed linens 45°...",
    "sources": [{ "document": "VIP Guest Protocol SOP", "page": 12 }],
    "confidence": 0.91,
    "suggested_tasks": [
      { "title": "VIP Turndown - Bed preparation", "task_type": "housekeeping" },
      { "title": "VIP Turndown - Amenity setup", "task_type": "housekeeping" }
    ],
    "credits_used": 2
  }
}
```

### POST /sop/query/create-tasks
Same as `/sop/query` but also creates the suggested tasks automatically.

---

## 10. AI Copilot

### POST /ai/copilot/chat
Main copilot endpoint. Routes to appropriate model based on interaction type.
```json
// Request
{
  "message": "Room 514 AC is broken, urgent",
  "context": {
    "current_screen": "housekeeping_board",
    "room_id": "uuid"             // Optional: current room context
  }
}

// Response
{
  "data": {
    "response_type": "task_preview|answer|insight|error",
    "message": "I'll create an urgent work order for Engineering.",
    "task_preview": {
      "title": "AC not working - Room 514",
      "category": "hvac",
      "priority": "urgent",
      "department": "Engineering"
    },
    "actions": [
      { "label": "Create Work Order", "action": "confirm_task_creation" },
      { "label": "Edit Details", "action": "edit_task" }
    ],
    "credits_used": 1,
    "model_used": "gpt-4o-mini"
  }
}
```

### POST /ai/copilot/confirm-task
Confirm task creation after copilot preview.
```json
{ "task_preview": {...}, "confirmed": true }
```

### GET /ai/insights
GM dashboard AI insights (Claude Sonnet analysis).
```json
{
  "data": {
    "insights": [
      {
        "type": "labor_efficiency",
        "severity": "warning",
        "title": "Engineering overtime spiking",
        "detail": "40% above baseline this week. Consider shift rebalancing.",
        "action": "View Engineering Schedule"
      }
    ],
    "generated_at": "2026-03-06T08:00:00Z",
    "credits_used": 2
  }
}
```

### GET /ai/risk-alerts
Current real-time risk alerts for GM dashboard.
```json
{
  "data": {
    "housekeeping_risks": [{ "room": "312", "risk": "45min late for 3PM check-in" }],
    "maintenance_risks": [{ "asset": "HVAC 5F", "risk": "87% failure probability" }],
    "sla_breaches": [{ "work_order": "WO-1042", "overdue_minutes": 15 }]
  }
}
```

---

## 11. Scheduling

### GET /schedules/shifts
Get shift definitions for the hotel.

### POST /schedules/shifts
Create a new shift.

### GET /schedules/assignments
Get staff schedule for a date range.
```
Query params:
  date_from=2026-03-06
  date_to=2026-03-07
  department_id=<uuid>
```

### POST /schedules/assignments
Create shift assignments for staff.
```json
{
  "assignments": [
    { "user_id": "uuid", "shift_id": "uuid", "work_date": "2026-03-07" }
  ]
}
```

### PATCH /schedules/assignments/{id}/clock-in
Staff clocks in.

### PATCH /schedules/assignments/{id}/clock-out
Staff clocks out.

---

## 12. Guest Requests

### POST /guest-requests
Create guest request (Front Desk or any staff).
```json
{
  "title": "Extra pillows - Room 312",
  "room_id": "uuid",
  "guest_name": "Sarah Johnson",
  "description": "Guest called requesting 2 extra pillows"
}
```
Auto-creates linked task and assigns to available Housekeeping staff.

### GET /guest-requests
List guest requests. Filters: status, date, room_id.

### PATCH /guest-requests/{id}
Update status, resolve request.

---

## 13. Lost & Found

### POST /lost-found
Log found item.
```json
{
  "description": "Black iPhone 15 Pro with blue case",
  "room_id": "uuid",
  "found_by": "uuid",
  "photo": "<base64 or upload separately>"
}
```

### GET /lost-found
List lost & found items. Filters: status, date_from, date_to, search.

### PATCH /lost-found/{id}
Update status (claimed, donated, discarded).

---

## 14. Logbook

### POST /logbook/entries
Create manual logbook entry.
```json
{
  "department_id": "uuid",
  "shift_id": "uuid",
  "content": "VIP guest in 1401 requested early morning wake-up call tomorrow at 5AM"
}
```

### GET /logbook/entries
List logbook entries.
```
Query params:
  department_id=<uuid>
  date=2026-03-06
  search=vip
```

### GET /logbook/shift-summary/{shift_id}
Get AI-generated summary for a completed shift.

### POST /logbook/shift-summary/generate
Manually trigger AI shift summary generation.
```json
{ "shift_id": "uuid", "shift_date": "2026-03-06" }
```

---

## 15. Reports

### GET /reports/daily-summary
Generate daily operations summary. Returns structured data; PDF generation triggered by `format=pdf`.
```
Query params:
  date=2026-03-06
  format=json|pdf
```

### GET /reports/staff-performance
Staff performance report.
```
Query params:
  date_from=2026-03-01
  date_to=2026-03-06
  department_id=<uuid>
  format=json|csv
```

### GET /reports/maintenance
Engineering maintenance cost and compliance report.
```
Query params:
  date_from=2026-03-01
  date_to=2026-03-31
  format=json|pdf
```

### GET /reports/ai-usage
AI credit usage report for billing review.
```
Query params:
  period=2026-03   (YYYY-MM)
  format=json|csv
```

---

## 16. Billing

### GET /billing/subscription
Current subscription status, plan details, trial info.

### GET /billing/credits
Current period credit usage.
```json
{
  "data": {
    "period": "2026-03",
    "credits_included": 5000,
    "credits_used": 3847,
    "credits_remaining": 1153,
    "cap_amount": 250.00,
    "current_cost_estimate": 99.00,
    "overage_estimate": 0
  }
}
```

### POST /billing/portal
Create Stripe Customer Portal session URL for self-service billing management.

### POST /billing/checkout
Create Stripe Checkout session for plan upgrade or credit purchase.

### GET /billing/invoices
List past invoices.

---

## 17. Onboarding

### GET /onboarding/status
Check onboarding completion state.
```json
{
  "data": {
    "steps": {
      "hotel_profile": "completed",
      "rooms_imported": "completed",
      "staff_invited": "in_progress",
      "opera_connected": "pending",
      "sop_uploaded": "pending",
      "pm_configured": "pending"
    },
    "completion_pct": 33,
    "next_step": "staff_invited"
  }
}
```

### POST /onboarding/rooms/import-csv
Parse and preview room CSV before committing.

### POST /onboarding/ai-assistant
Onboarding AI assistant chat endpoint. Guides GM through setup steps.
```json
{ "message": "I need help setting up my housekeeping staff" }
```

---

## 18. Opera Cloud Integration

### POST /integrations/opera/connect
Initiate Opera Cloud OAuth 2.0 flow. Returns authorization URL.

### GET /integrations/opera/callback
OAuth callback handler. Exchanges code for tokens, stores encrypted in Supabase Vault.

### GET /integrations/opera/status
Current integration connection status, last sync time.

### POST /integrations/opera/sync
Manually trigger full reservation sync.

### DELETE /integrations/opera/disconnect
Revoke OAuth tokens and disconnect integration.

### POST /webhooks/opera
Opera Cloud Business Events webhook handler (public endpoint, no auth header).
Validates Opera HMAC signature. Handles:
- `RESERVATION.CHECKED_OUT` → room status = DIRTY
- `RESERVATION.CHECKED_IN` → update room with guest profile
- `RESERVATION.MODIFIED` → update check-in/out times
- `ROOM_STATUS.DO_NOT_DISTURB` → set dnd_flag

---

## 19. Notifications

### GET /notifications
List notifications for current user.
```
Query params:
  is_read=false
  limit=20
```

### PATCH /notifications/{id}/read
Mark notification as read.

### POST /notifications/mark-all-read
Mark all notifications read.

---

## 20. Internal Cron Endpoints (Railway Cron, not public)

These are called by Railway Cron Jobs and protected by an internal `X-Cron-Secret` header.

### POST /internal/predictions/run
Recalculate room readiness predictions (every 30 minutes).

### POST /internal/pm/check-due
Check for due/overdue PM schedules and generate work orders (daily 6am).

### POST /internal/ai/failure-predictions
Run nightly asset failure prediction analysis (daily midnight).

### POST /internal/billing/monthly-trueup
Calculate monthly AI credit overage and create Stripe invoice items (last day of month).

### POST /internal/reports/daily-summary-email
Generate and email daily summary to GMs (daily 6am).

### POST /internal/logbook/shift-summary
Generate AI shift summaries for completed shifts (at shift end times).

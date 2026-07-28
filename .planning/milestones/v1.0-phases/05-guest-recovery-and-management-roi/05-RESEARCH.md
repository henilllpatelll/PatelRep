# Phase 5: Guest recovery and management ROI - Research

**Researched:** 2026-07-24
**Domain:** Twilio SMS integration, ROI/analytics aggregation over existing Supabase tables, cron-based retention flagging, Next.js settings/admin surfaces — all layered onto an already-shipped Phase 5 backend
**Confidence:** HIGH (existing-code findings, verified by direct file reads) / MEDIUM (Twilio integration design, verified against official Context7 docs + Twilio support docs) / LOW-MEDIUM (7-day forecast feasibility — flagged explicitly below)

## Summary

This is **not a greenfield phase**. Pre-existing commit `fea45b29` (2026-07-16) already shipped the full data layer and core validation logic for guest request lifecycle, messaging scaffolding, accessibility metadata, and lost & found custody tracking (migration `072_guest_recovery_and_roi.sql`, `services/guest_recovery/contracts.py`, `routers/guest_requests.py`, `routers/lost_found.py`, a kanban web UI, and two `/reports` endpoints). All of this was directly verified by reading the code in this research session — it is real, tested (`test_guest_recovery.py`, 6 passing tests), and wired into `main.py`. The planner should treat sub-domains 1–3's schema and validation contracts as **done** and scope tasks only around the genuinely missing pieces.

What's missing breaks into four buckets, each with a clear implementation template already established elsewhere in this codebase: (1) Twilio SMS send/receive, which should mirror the existing `webhooks.py` Opera/Stripe dispatch pattern — verified via Context7 that Twilio's Python SDK (`twilio==9.10.9`, [VERIFIED: pip index]) provides `RequestValidator.validate()` for HMAC-SHA1 signature checking and `client.messages.create()` for sending, but a **critical nuance was found**: Twilio's default opt-out handling does **not** forward STOP messages to your inbound webhook or fire any status callback for it — Advanced Opt-Out (a Messaging Service-level feature) is required to receive that signal at all, which changes D-03's implementation approach (see Common Pitfalls). (2) A 7-day rooms-to-clean/labor-hours forecast, where research found the existing prediction pipeline (`services/ai/predictions.py`) is architecturally unable to extend to a 7-day horizon because its only forward-looking data source (`opera_reservations`) is feature-flagged/pilot-gated and unavailable to standalone hotels — a different, trailing-average-based design is needed and is recommended below. (3) ROI metric aggregation, which can follow the exact SQL/date-range/RBAC pattern already used four times in `reports.py`. (4) New web UI surfaces (SMS panel, ROI dashboard, two settings pages, lost & found custody/disposition UI), which all have direct structural templates already in the codebase (`settings/inspections`, `settings/rooms`, `GuestRequestDrawer.tsx`).

**Primary recommendation:** Do not re-build or redesign any Phase 5 schema/contracts/routers already shipped. Add a `guest_phone` migration + Twilio webhook/send module modeled on `webhooks.py`, extend `contracts.py` in place for new metric formulas, extend `reports.py` with new GM-only ROI aggregation endpoints (or a new `management_roi.py` router — planner's call), and build the 7-day forecast as a **new trailing-average labor projection**, not an extension of the near-term ETA cron.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Guest request lifecycle/state machine | API / Backend | Database | Already implemented in `contracts.py` + `guest_requests.py`; pure validation functions, DB-persisted state |
| Twilio inbound webhook (SMS receive) | API / Backend | Database | Public unauthenticated endpoint, mirrors `webhooks.py`; must resolve tenant from phone number, write to `guest_messages` |
| Twilio outbound send | API / Backend | — | Triggered from `guest_requests.py`'s `send_guest_message`; needs a `services/sms/` (or similar) module wrapping the Twilio client |
| Message thread UI | Browser / Client | API / Backend | New panel inside `GuestRequestDrawer.tsx`; reads/writes via existing `/guest-requests/{id}/messages` endpoint |
| Accessible room features CRUD | API / Backend | Database | Already implemented (`upsert_accessible_room_feature`); UI is the only gap |
| Lost & found custody/disposition | API / Backend | Database | Already implemented; missing piece is retention-flagging cron + web UI |
| Lost & found retention cron | API / Backend (cron) | Database | New `/v1/internal/lost-found/retention-check`, follows `internal.py` pattern exactly |
| ROI metric aggregation | API / Backend | Database | Extends `reports.py` pattern (date-range params, tenant scope, RBAC via `require_role`) |
| 7-day rooms-to-clean forecast | API / Backend | Database | New trailing-average projection; NOT an extension of the near-term `predictions.py` ETA cron (see rationale below) |
| Management ROI dashboard page | Browser / Client | API / Backend | New Next.js route under `(dashboard)/`; consumes new/extended reports endpoints |
| Settings > Guest Requests (SLA policies) | Browser / Client | API / Backend | New page mirroring `settings/inspections`; CRUD already exists at API layer? **No** — `guest_request_sla_policies` currently has no CRUD endpoints, only a read via `resolve_sla_minutes` internal lookup. Planner must add list/create endpoints too. |
| Settings > Rooms accessibility tab | Browser / Client | API / Backend | New tab on existing page; API (`/guest-requests/accessibility/features`) already exists |
| GM-configured ADR field | Browser / Client | API / Backend | New column on `tenants` table via `hotels.py`'s existing `PATCH /{hotel_id}` (`UpdateHotelRequest`) — no new endpoint needed, just a new field |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `twilio` (Python SDK) | 9.10.9 [VERIFIED: pip index, 2026-07-24] | Send/receive SMS, validate inbound webhook signatures | Official Twilio SDK; already the codebase's pattern of using official vendor SDKs (`stripe`, `openai`, `anthropic` all present in `requirements.txt`) |

**Installation:**
```bash
cd apps/api && pip install twilio==9.10.9
```
Add `twilio==9.10.9` to `apps/api/requirements.txt` (alongside `stripe==15.3.1`, following existing pinning convention).

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `twilio.request_validator.RequestValidator` | (bundled in `twilio` package) | HMAC-SHA1 inbound webhook signature verification | Every inbound Twilio POST, mirroring `_verify_opera_signature` in `webhooks.py` |
| `twilio.twiml.messaging_response.MessagingResponse` | (bundled) | Optional TwiML auto-reply | Only needed if an immediate auto-ack reply to inbound SMS is desired; D-02/D-05 don't require this — plain `{"status": "ok"}` JSON response (like the Opera/Stripe webhooks) is sufficient and simpler |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Twilio | Vonage, MessageBird, AWS SNS SMS | Not applicable — D-01 locks Twilio explicitly; do not substitute |
| New `management_roi.py` router | Extend `reports.py` in place | Either works; `reports.py` is already 403 lines and growing — a new router keeps the GM-only ROI surface cleanly separated and matches D-06's "new unified page" framing, but either satisfies the "don't hand-roll a duplicate service" convention as long as `calculate_guest_request_metrics`-style pure functions live in `contracts.py`/`services/` and routers stay thin |

## Architecture Patterns

### System Architecture Diagram

```
Guest's phone (SMS)
   │  inbound text
   ▼
Twilio (carrier + STOP/START keyword filter)
   │  POST /v1/webhooks/twilio-sms  (X-Twilio-Signature header)
   ▼
apps/api/routers/webhooks.py  ── new twilio_sms_webhook() ──►
   1. Validate signature (RequestValidator.validate)
   2. Resolve guest_request via "reply-only" match:
        most-recent outbound guest_messages.recipient == From number
        AND guest_messages.guest_request_id's tenant scoping
   3. No match → route to front-desk manual triage (no auto-create) [D-02]
   4. Insert guest_messages(direction='inbound', excluded_from_ai=TRUE)
   5. Insert guest_request_events(event_type='guest_contacted', source='sms')
   ▼
Supabase (guest_messages, guest_request_events — both append-only via
migration 072 triggers)
   ▲
   │  outbound send
apps/api/routers/guest_requests.py  POST /{id}/messages (existing)
   │  existing consent/opt-out gate already checks contact_consent_at /
   │  contact_opted_out_at (existing code, unchanged)
   ▼
NEW services/sms/twilio_client.py  ── send_sms(to, body) ──►
   Twilio REST API (client.messages.create)
   │
   ▼
Twilio status callback  →  POST /v1/webhooks/twilio-status
   │  updates guest_messages.delivery_status + provider_message_id
   │  (queued → sent → delivered/failed); on error 21610 (unsubscribed
   │  recipient) or Advanced Opt-Out STOP event → set
   │  guest_requests.contact_opted_out_at
   ▼
apps/web/components/guest-requests/GuestRequestDrawer.tsx
   NEW message thread panel — reads guest_messages ordered by created_at,
   reply box gated to MESSAGE_ROLES
```

```
ROI Dashboard data flow:

GM opens /management-roi (new Next.js route)
   ▼
lib/api/managementRoi.ts  (new client)
   ▼  parallel GET requests (date-range params, like existing reports.ts calls)
   ├─► GET /reports/guest-recovery       (existing)
   ├─► GET /reports/maintenance          (existing)
   ├─► GET /reports/roi/repeat-failures  (new — 90-day trailing window, D-08)
   ├─► GET /reports/roi/downtime-revenue (new — GM ADR × downtime hours, D-07)
   ├─► GET /reports/roi/pm-compliance    (new — completion/deferral rates)
   ├─► GET /reports/roi/training-readiness (new — wraps existing /safety/training/status aggregate)
   ├─► GET /reports/roi/inspection-trends  (new — pass-rate + repeat-defect via inspection_results)
   └─► GET /reports/roi/forecast-7day    (new — trailing-average projection, D-09)
   ▼
Each endpoint: require_role("gm") only (D-06: GM-only page) — tenant-scoped
Supabase queries following the exact date-range pattern in reports.py
(today/start/end query params, .gte/.lt on created_at)
```

### Recommended Project Structure
```
apps/api/
├── routers/
│   ├── webhooks.py            # ADD: twilio_sms_webhook, twilio_status_webhook
│   ├── guest_requests.py      # ADD: guest_phone on create; SLA policy CRUD endpoints
│   ├── lost_found.py          # unchanged (custody events already complete)
│   ├── internal.py            # ADD: /lost-found/retention-check cron endpoint
│   └── reports.py             # EXTEND or new management_roi.py — new ROI endpoints
├── services/
│   ├── guest_recovery/
│   │   └── contracts.py       # EXTEND: repeat-failure window, revenue-impact, forecast pure fns
│   └── sms/                   # NEW
│       └── twilio_client.py   # send_sms(), verify_signature() wrappers
├── models/requests.py          # ADD: guest_phone field, SLA policy request models
apps/web/app/(dashboard)/
├── management-roi/page.tsx     # NEW (route name — planner decides exact slug)
├── settings/guest-requests/page.tsx   # NEW (D-13)
├── settings/rooms/page.tsx     # EXTEND with accessibility tab (D-14)
├── lost-found/page.tsx         # EXTEND with custody/retention/disposition UI
└── guest-requests/
    └── (GuestRequestDrawer.tsx extended with message panel, D-05)
supabase/migrations/
└── 084_guest_phone_and_roi_extensions.sql   # NEW (next available number — see Common Pitfalls)
```

### Pattern 1: Webhook signature verification (Twilio, mirroring Opera)
**What:** Validate `X-Twilio-Signature` header using HMAC-SHA1 over the full webhook URL + POST params, using the Twilio Auth Token as the HMAC key.
**When to use:** Every inbound Twilio webhook (SMS receive, status callback).
**Example:**
```python
# Source: Context7 /twilio/twilio-python — twilio/request_validator.py
from twilio.request_validator import RequestValidator

validator = RequestValidator(settings.twilio_auth_token)

@router.post("/twilio-sms")
async def twilio_sms_webhook(request: Request):
    form = await request.form()
    params = dict(form)
    signature = request.headers.get("x-twilio-signature", "")
    # IMPORTANT: url must be the EXACT public URL Twilio was configured to call,
    # including scheme — reconstruct from X-Forwarded-Proto/Host if behind Railway's proxy,
    # do not use request.url directly (may report http:// behind a proxy).
    proto = request.headers.get("x-forwarded-proto", "https")
    host = request.headers.get("host", "")
    url = f"{proto}://{host}{request.url.path}"
    if settings.app_env == "production" and not validator.validate(url, params, signature):
        raise HTTPException(status_code=401, detail="Invalid Twilio signature")
    ...
```
This directly parallels the existing `_verify_opera_signature` function in `webhooks.py` (same file, same dev-vs-prod fail-open pattern already established for Opera).

### Pattern 2: Reply-only inbound matching (D-02)
**What:** On inbound SMS, look up the most recent `guest_messages` row where `direction='outbound'` and `recipient` equals the inbound `From` number; use its `guest_request_id`. If none found, do not create a request — log/flag for front-desk triage.
**When to use:** `twilio_sms_webhook` handler.
**Example:**
```python
# Pattern extrapolated from existing guest_requests.py conventions
recent_outbound = supabase.table("guest_messages").select(
    "guest_request_id, tenant_id"
).eq("direction", "outbound").eq("recipient", from_number).order(
    "created_at", desc=True
).limit(1).execute().data
if not recent_outbound:
    # No match — do NOT create a guest_request (D-02). Insert a standalone
    # triage record (e.g., a new lightweight table, or a notification to
    # front_desk role) so nothing is silently dropped.
    ...
```

### Pattern 3: ROI aggregation (mirrors existing `reports.py`)
**What:** date-range query params, tenant-scoped Supabase select, Python-side aggregation, `require_role` gate.
**Example:**
```python
# Source: apps/api/routers/reports.py (existing pattern, verified in this session)
@router.get("/roi/repeat-failures")
async def get_repeat_failures_report(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(require_role("gm")),
):
    today = date.today()
    start = start_date or (today - timedelta(days=90))  # D-08 default window
    end = end_date or today
    work_orders = supabase.table("work_orders").select(
        "id, asset_id, room_id, created_at"
    ).eq("tenant_id", current_user.hotel_id).gte(
        "created_at", start.isoformat()
    ).lt("created_at", (end + timedelta(days=1)).isoformat()).execute().data or []
    # group by asset_id/room_id, count >= 2 within window = "repeat" (D-08)
```

### Pattern 4: 7-day forecast (D-09) — see Common Pitfalls before implementing
**What:** Trailing-average projection of rooms-to-clean and labor-hours per day, NOT an extension of `run_room_predictions`.
**Recommended design (new function, e.g. `services/guest_recovery/contracts.py` or a new `services/ai/forecast.py`):**
```python
def project_seven_day_labor_forecast(
    historical_daily_completions: list[dict],  # from room_clean_sessions or room_status_history
    avg_clean_minutes_by_type: dict[str, float],  # from housekeeper_profiles rollups
) -> list[dict]:
    """
    For each of the next 7 days, project:
      - expected rooms to clean = trailing N-week average of completions for that weekday
      - expected labor hours = expected rooms × avg_clean_minutes / 60
    This is a capacity projection based on historical turnover patterns, not an
    occupancy-based projection (no reliable forward-looking checkin data exists
    for standalone/non-Opera hotels — see rationale below).
    """
```

### Anti-Patterns to Avoid
- **Extending `run_room_predictions` to 7 days:** Its only forward-looking signal is `room_status.checkin_time`, populated from `opera_reservations` sync (feature-flagged, pilot-gated per A4). A standalone hotel (the majority per the "standalone-first" constraint) has no reliable checkin data beyond what's already reflected in current `room_status` rows. Do not attempt to stretch this pipeline's 12-hour risk window into a 7-day window — it will silently degrade to near-zero coverage for hotels without Opera connected.
- **Re-validating already-shipped contracts:** Do not re-write `resolve_sla_minutes`, `validate_guest_request_transition`, `validate_lost_found_custody_event`, or `calculate_guest_request_metrics` — extend them in place (same file) for new formulas only.
- **Building a parallel "SLA policy" read path:** `resolve_sla_minutes` already consumes `guest_request_sla_policies` at request-creation time; the only gap is CRUD (list/create) endpoints for D-13's settings page — don't duplicate the resolution logic in the new endpoints.
- **Auto-creating guest requests from cold inbound texts:** Explicitly rejected by D-02 to avoid spam/wrong-number noise.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| SMS delivery | Custom carrier integration, raw HTTP to a gateway | Twilio Python SDK (`twilio.rest.Client`) | Handles retries, number formatting, and provides `MessageInstance.status`/`sid` for delivery tracking — D-01 locked |
| Webhook signature verification | Custom HMAC scheme (like the Opera one uses `CRON_SECRET`-derived HMAC) | `twilio.request_validator.RequestValidator` | Twilio's own algorithm (HMAC-SHA1 over URL+params) must be used exactly as Twilio computes it; a custom scheme won't match Twilio's signature |
| Opt-out/consent tracking | Custom STOP/START keyword parser | Twilio's built-in filter (default) + Advanced Opt-Out webhook (if enabled) | Twilio intercepts STOP/START by default per carrier requirements; building a parallel parser risks double-processing or missing carrier-level blocks. See Common Pitfalls for what "provider-level" actually requires. |
| Repeat-failure/ROI aggregation | A new analytics microservice or scheduled ETL | Direct Supabase queries in FastAPI routers, Python-side aggregation (existing `reports.py` pattern) | Data volumes are small (50-150 room hotels); the existing pattern already handles this scale fine, and a new service would violate the "services/ only when shared 2+ domains" convention (A1) |

**Key insight:** Every "don't hand-roll" item in this phase has a working precedent already in this exact codebase (Opera webhook signature check, `reports.py` aggregation). The discipline required is reuse, not reinvention.

## Common Pitfalls

### Pitfall 1: Twilio's default opt-out handling silently does NOT tell your app anything
**What goes wrong:** D-03 assumes "when Twilio's status webhook reports an opt-out, set `contact_opted_out_at`." By default, Twilio intercepts STOP/START/HELP keywords at the carrier/platform level and **never forwards them to your inbound webhook or fires a status callback event for them** [MEDIUM: WebSearch cross-checked against Twilio's own error-code docs and support article "Twilio Support for Opt-out Keywords (SMS STOP Filtering)"]. If the phone number is a bare "From" number (not a Messaging Service), your app will simply never learn that a guest opted out — until you try to send them another message and get error code 21610 ("Attempt to send to unsubscribed recipient").
**Why it happens:** Twilio's opt-out interception exists at the platform/carrier-compliance layer, independent of your webhook configuration, unless "Advanced Opt-Out" is explicitly enabled on a **Messaging Service** (not a raw phone number).
**How to avoid:** Two viable designs, and this needs to be confirmed with the user during planning (flag as open question, not silently pick one):
  1. **Reactive detection (simpler, no Twilio console config needed):** Catch the send-time error (HTTP 400 with Twilio error code 21610) in the outbound send wrapper and set `contact_opted_out_at` at that moment. Works with a bare Twilio phone number.
  2. **Proactive detection (matches D-03's literal wording):** Provision a Twilio Messaging Service (not just a phone number) and enable Advanced Opt-Out, which then POSTs an `OptOutType` param (STOP/START/HELP) to your inbound webhook. Requires additional Twilio console setup beyond code.
Recommend the planner default to (1) as the code-complete, credential-independent path (consistent with "no live Twilio credentials locally"), and note (2) as a configuration-dependent enhancement if the user later provisions a Messaging Service.
**Warning signs:** If planning proceeds assuming inbound STOP messages arrive at your webhook by default, tests will pass (against a fake Twilio client) but the live integration will not perform as described once real credentials exist.

### Pitfall 2: Reconstructing the exact webhook URL for signature validation behind Railway's proxy
**What goes wrong:** Twilio's `RequestValidator.validate(uri, params, signature)` requires the **exact** URL Twilio was configured to POST to, including scheme. Railway terminates TLS and proxies to the container over HTTP, so `request.url` inside FastAPI may report `http://` when Twilig signed `https://`. This exact class of bug already required a fix in the Opera webhook path's dev/prod HMAC check.
**Why it happens:** Reverse-proxy header rewriting; FastAPI/Starlette doesn't automatically trust `X-Forwarded-Proto` unless explicitly configured.
**How to avoid:** Reconstruct the URL from `X-Forwarded-Proto` + `Host` headers (as shown in Pattern 1 above), matching exactly what's registered in the Twilio console for the webhook URL (including trailing slash/path presence).
**Warning signs:** Signature validation fails 100% of the time in production even though the request is genuinely from Twilio.

### Pitfall 3: `guest_request_sla_policies` has no CRUD endpoints yet
**What goes wrong:** CONTEXT.md's scouting finding says "the API-only" for accessibility features, but for SLA policies there is **no API surface at all** — `resolve_sla_minutes` only reads the table via a raw `supabase.table("guest_request_sla_policies").select(...)` inline in `create_guest_request`. There is no list/create/update/delete endpoint. D-13's settings page has nothing to call.
**Why it happens:** The pre-existing commit built only the consumption path (SLA resolution at request-creation time), not the management path.
**How to avoid:** Planner must add `GET /guest-requests/sla-policies` (list) and `POST`/`PATCH`/`DELETE /guest-requests/sla-policies` (or similar) endpoints as net-new work — this is not "extend existing," it's "build from scratch," and should be sized accordingly in the plan.
**Warning signs:** Assuming this is UI-only work will under-scope the phase.

### Pitfall 4: "PM completion/deferral rates" has no explicit "deferred" concept in the schema
**What goes wrong:** `pm_schedules` (migration 008) has `next_due_at`, `last_completed_at`, `is_active` — there is no `deferred` flag or event. "Deferral" must be *derived*, e.g.: a PM-generated work order (`work_orders.is_pm_generated=true`, linked via `pm_schedule_id`) that is not completed before the schedule's `next_due_at` rolls forward again (i.e., the cron in `internal.py`'s `check_due_pm` creates a new PM work order for the same schedule while a prior one is still open).
**Why it happens:** Migration 008 predates Phase 5's ROI reporting need; deferral was never a first-class concept.
**How to avoid:** Define "deferred" precisely during planning (recommend: PM work order still open when `pm_schedules.next_due_at` advances again for that schedule) and confirm with the user if ambiguous — flag as an assumption, not a fact.
**Warning signs:** Metric shows 0% deferral for every hotel because no explicit flag is ever set.

### Pitfall 5: Migration numbering — 082 is a gap
**What goes wrong:** The migrations directory jumps from `081_pm_evidence_linkage.sql` to `083_program_template_facilities.sql` — 082 does not exist anywhere in the repo. This mirrors the known 020/0201 and dual-039 numbering quirks already documented in `CLAUDE.md`.
**How to avoid:** The next new migration for this phase should be **`084_...`**, not `082` (which would collide with nothing but breaks the ascending-order convention and looks like an error). Do not attempt to "fill the gap" at 082.

### Pitfall 6: `next` is `16.3.0-preview.6` (a preview release), recently bumped
**What goes wrong:** Per STATE.md, `next`, `zustand`, and `@hookform/resolvers` were all just bumped via Dependabot merges and pushed to production for the first time on 2026-07-21 ("if prod UI misbehaves, suspect these before Phase 3 code"). New pages built in this phase are the first real exercise of these majors for net-new routes.
**How to avoid:** After building the new `management-roi` and `settings/guest-requests` pages, run the full verification loop (type-check, build, Playwright) before considering the phase done — don't assume the preview Next.js release behaves identically to the prior stable version for new dynamic routes.

## Code Examples

### Existing state-machine validation (reuse, do not rebuild)
```python
# Source: apps/api/services/guest_recovery/contracts.py (verified in this session)
_ALLOWED_TRANSITIONS = {
    "open": {"acknowledged", "cancelled"},
    "acknowledged": {"dispatched", "cancelled"},
    "dispatched": {"arrived", "resolved", "cancelled"},
    "arrived": {"guest_contacted", "resolved", "cancelled"},
    "guest_contacted": {"resolved", "cancelled"},
    "resolved": {"verified", "reopened"},
    "verified": {"reopened"},
    "reopened": {"acknowledged", "cancelled"},
    "cancelled": set(),
}
```

### Existing cron registration pattern (for the new retention-check cron)
```python
# Source: apps/api/routers/internal.py (verified in this session) — template to copy
@router.post("/lost-found/retention-check")
async def check_lost_found_retention(x_cron_secret: str = Header(None)):
    verify_cron(x_cron_secret)
    now = datetime.now(timezone.utc).isoformat()
    due = supabase.table("lost_found_items").select("id, tenant_id").eq(
        "status", "unclaimed"
    ).lt("retention_due_at", now).execute().data or []
    # D-11: flag only — no auto-disposal. Consider a lightweight status filter
    # or a new boolean/derived field rather than mutating `status` (status enum
    # is unclaimed/claimed/donated/discarded — a disposition-due signal should
    # not silently masquerade as one of those).
    _record_cron_run("lost-found.retention-check")
    return {"status": "ok", "flagged": len(due)}
```
Then register in `.github/workflows/cron-jobs.yml` under a fitting existing schedule group (e.g., the `daily-6am` group already fires `pm/check-due` and other daily jobs at `0 6 * * *` — this fits without needing a new cron schedule entry).

### Existing settings-page shape to clone for Settings > Guest Requests (D-13)
```typescript
// Source: apps/web/app/(dashboard)/settings/inspections/page.tsx (verified in this session)
// Pattern: useRole() gate + useQuery for list + a Form card component for create/edit,
// toast on success/error, refetch after mutation. Reuse TemplateFormCard-style
// component shape for the new SLA policy form (category/priority/guest_impact/sla_minutes).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| N/A — this is the first SMS integration in the codebase | Twilio Python SDK 9.x with `RequestValidator` | N/A | No prior pattern to deprecate; this establishes the first outbound-communications vendor integration pattern in the codebase alongside Stripe/OpenAI/Anthropic |

**Deprecated/outdated:** None specific to this phase — all touched systems (webhooks.py, reports.py, contracts.py) are current and actively maintained in this codebase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Reactive (send-time error 21610) opt-out detection is the right default design for D-03, deferring Advanced Opt-Out (Messaging Service + webhook) as a later enhancement | Common Pitfalls #1, Pattern 1 | If the user actually wants proactive STOP detection at the webhook, extra Twilio console configuration (a Messaging Service) is needed beyond code — should be confirmed before planning locks the design |
| A2 | "Deferred" PM rate = PM work order still open when its schedule's `next_due_at` next advances | Common Pitfalls #4 | If the user has a different definition in mind (e.g., WO marked "on hold" with a reason code that doesn't exist yet), the metric will need a schema change instead of pure aggregation |
| A3 | 7-day forecast should be a new trailing-average labor-capacity projection rather than an occupancy-based projection, because no reliable multi-day-forward checkin data exists outside Opera | Pattern 4, Don't Hand-Roll | If the pilot hotel(s) DO have Opera connected and reliable forward reservations, an occupancy-based forecast (using `opera_reservations.checkin_date`) would be materially more accurate — planner should ask whether the pilot hotel is Opera-connected before finalizing this design |
| A4 | A new `management_roi.py` router (vs. extending `reports.py` in place) is acceptable either way | Architecture Patterns, Alternatives Considered | Low risk — both are structurally valid; purely a file-organization choice |
| A5 | `guest_request_sla_policies` genuinely has zero CRUD endpoints today (confirmed by reading `guest_requests.py` in full — only inline `.select()` inside `create_guest_request`) | Common Pitfalls #3 | Low risk — this was directly verified by reading the router file, not inferred |

## Open Questions

1. **Does the opt-out design need Twilio Messaging Service + Advanced Opt-Out, or is reactive (send-error) detection acceptable for D-03?** — **(RESOLVED 2026-07-24)** Confirmed with the user: reactive design. Catch outbound error code 21610 and set `contact_opted_out_at` at that moment. No custom keyword parsing, no Messaging Service/Advanced Opt-Out provisioning. Locked in `05-CONTEXT.md` D-03; implemented by plan `05-02`.
   - What we know: Twilio's default STOP/START handling is invisible to the app unless Advanced Opt-Out is enabled on a Messaging Service.
   - What's unclear: Whether the user's mental model for D-03 ("provider-level... status webhook reports an opt-out") assumed the webhook path without knowing this requires extra Twilio console setup.
   - Recommendation: Planner should surface this distinction explicitly and default to the reactive (error-code) design as the credential-independent, code-complete option, noting the Messaging Service path as a future enhancement.

2. **Is the pilot hotel expected to have Opera Cloud connected when the 7-day forecast ships?** — **(RESOLVED 2026-07-24)** No Opera dependency. Trailing-average forecast only, per D-09 and the standalone-first constraint (A4). An Opera-aware path can layer into Phase 6 without redesign. Implemented by plans `05-03` (formula) and `05-06` (endpoint).
   - What we know: Opera integration is feature-flagged/pilot-gated (A4 in CLAUDE.md); `opera_reservations` is the only forward-looking occupancy data source.
   - What's unclear: Whether Phase 5's forecast should have an Opera-aware code path (use real reservations when connected, fall back to trailing-average when not) or just always use trailing-average for simplicity.
   - Recommendation: Build the trailing-average version first (works standalone); an Opera-aware enhancement can be layered in Phase 6 (PMS expansion) without redesign, since the trailing-average function's output shape can stay the same.

3. **Route name for the new Management ROI page** — `/management-roi` vs. `/reports/roi` vs. something else. — **(RESOLVED 2026-07-24)** `/management-roi`, a new top-level dashboard section sibling to `/reports`, matching D-06's intent literally. Implemented by plan `05-10`.
   - What we know: D-06 explicitly wants this to NOT be more `/reports` tabs.
   - What's unclear: Exact slug/route name.
   - Recommendation: `/management-roi` as a new top-level dashboard section (sibling to `/reports`, not nested under it), matching D-06's intent literally.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Twilio account/credentials (Account SID, Auth Token, phone number) | Live SMS send/receive | ✗ | — | Build code-complete against a fake Twilio client in tests (mirrors existing AI/Stripe credential gap handling per project instructions); explicitly flag live SMS as unverified in the phase summary |
| `twilio` Python package | SMS send + signature validation | ✗ (not yet in `requirements.txt`) | 9.10.9 available on PyPI [VERIFIED: pip index] | Add to `requirements.txt`; no fallback needed, this is a standard `pip install` |
| Opera Cloud connection (any tenant) | Occupancy-aware forecast enhancement (not required for MVP) | Unknown/pilot-gated | — | Trailing-average forecast design (Pattern 4) does not require this |

**Missing dependencies with no fallback:**
- None — Twilio credentials are the only hard external dependency, and the locked decision (D-01) already accounts for building code-complete without them, consistent with how this project handles the AI/Stripe credential gap.

**Missing dependencies with fallback:**
- Twilio live credentials — fallback is unit/integration testing against a fake provider client (extend the existing `tests/smoke/fake_supabase.py`-style harness with a `FakeTwilioClient`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 9.1.1 + pytest-asyncio 1.4.0 [VERIFIED: requirements.txt] |
| Config file | `apps/api/pytest.ini` (warning filters only, no custom markers) |
| Quick run command | `cd apps/api && python -m pytest tests/test_guest_recovery.py tests/test_internal_escalations.py -q` |
| Full suite command | `cd apps/api && python -m pytest tests/ -q` (currently 312 tests per STATE.md) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| P5-SMS-01 | Twilio inbound signature validation rejects bad signatures | unit | `pytest tests/test_guest_recovery.py -k signature -x` | ❌ Wave 0 — new test file needed, e.g. `test_twilio_sms.py` |
| P5-SMS-02 | Reply-only matching links inbound to most recent outbound recipient; no match → no auto-create | unit | `pytest tests/test_twilio_sms.py -k reply_only -x` | ❌ Wave 0 |
| P5-SMS-03 | Opt-out (reactive or webhook) sets `contact_opted_out_at` and blocks further sends | unit | `pytest tests/test_guest_recovery.py -k opt_out -x` | ❌ Wave 0 (extends existing consent test surface) |
| P5-ROI-01 | Repeat asset/room failure = 2+ within trailing 90 days | unit | `pytest tests/test_management_roi.py -k repeat_failure -x` | ❌ Wave 0 — new test file |
| P5-ROI-02 | Room-downtime revenue impact = hours × (ADR/24) | unit | `pytest tests/test_management_roi.py -k revenue_impact -x` | ❌ Wave 0 |
| P5-ROI-03 | 7-day forecast produces per-day rooms + labor-hours projection reconcilable against fixture data | unit | `pytest tests/test_management_roi.py -k forecast -x` | ❌ Wave 0 |
| P5-LF-01 | Retention cron flags (does not auto-dispose) items past 90-day `retention_due_at` | integration | `pytest tests/test_internal_escalations.py -k retention -x` (or a new file alongside it) | ❌ Wave 0 |
| P5-LF-02 | Disposition RBAC = gm, housekeeping_supervisor, front_desk (matches existing custody-event RBAC) | unit | existing pattern in `lost_found.py` already enforces this; add a negative-case test for e.g. `engineer` → 403 | ⚠️ Partial — RBAC code exists, explicit test coverage should be verified/added |
| (existing, unchanged) | SLA resolution, transition validation, custody verification, metrics reconciliation | unit | `pytest tests/test_guest_recovery.py -q` | ✅ Already exists (6 tests) |

### Sampling Rate
- **Per task commit:** `cd apps/api && python -m pytest tests/test_guest_recovery.py tests/test_twilio_sms.py tests/test_management_roi.py -q` (fast, phase-scoped)
- **Per wave merge:** `cd apps/api && python -m pytest tests/ -q` (full 312+ suite)
- **Phase gate:** Full suite green + `cd apps/web && npm run lint && npm run type-check && npm run build` before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `apps/api/tests/test_twilio_sms.py` — covers signature validation, reply-only matching, opt-out detection (P5-SMS-01/02/03); needs a `FakeTwilioClient` test double (extend `tests/smoke/fake_supabase.py`'s FakeDB pattern for the SMS provider layer)
- [ ] `apps/api/tests/test_management_roi.py` — covers repeat-failure window, revenue-impact calc, PM deferral rate, 7-day forecast reconciliation against fixture data (P5-ROI-01/02/03)
- [ ] Extend `apps/api/tests/test_internal_escalations.py` (or new file) — covers lost & found retention-flagging cron (P5-LF-01)
- [ ] `apps/api/requirements.txt` — add `twilio==9.10.9` before any Twilio-dependent test can import the SDK

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing JWT-based `get_current_user`/`require_role` (unchanged) |
| V3 Session Management | no | No new session handling introduced |
| V4 Access Control | yes | `require_role("gm")` for ROI dashboard endpoints (D-06: GM-only); role-set checks for SLA policy CRUD, disposition approval (D-12: gm/housekeeping_supervisor/front_desk) |
| V5 Input Validation | yes | Pydantic `SanitizedBaseModel` request models (existing convention in `models/requests.py`) for all new request bodies (guest_phone, SLA policy fields) |
| V6 Cryptography | yes | Twilio `RequestValidator` HMAC-SHA1 signature check for webhook authenticity — never hand-roll a custom signature scheme for Twilio (must match their exact algorithm) |
| V13 API Security (webhooks specifically) | yes | Public unauthenticated Twilio endpoints must validate signature before trusting payload, exactly like the existing Opera/Stripe webhook handlers in `webhooks.py` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged Twilio webhook POST (spoofed inbound SMS or fake delivery status) | Spoofing | `RequestValidator.validate()` on every inbound request; reject in production if signature missing/invalid (mirrors existing Opera pattern's prod-only enforcement) |
| Guest phone number used to auto-create requests / spam the system | Tampering / DoS | D-02's reply-only matching explicitly prevents this — no request creation from a cold inbound text |
| Guest messages leaking into AI training/prompts | Information Disclosure | Already enforced by `excluded_from_ai BOOLEAN NOT NULL DEFAULT TRUE` on `guest_messages` (migration 072) — do not remove or bypass this default in new code |
| Disposition approval by unauthorized role releasing/discarding a guest's lost item | Elevation of Privilege | RBAC role-set check already implemented in `lost_found.py` (`{"front_desk", "housekeeping_supervisor", "gm"}`) — D-12 confirms this exact set, do not narrow it |
| Cross-tenant data leakage in new ROI endpoints | Information Disclosure | Every new query must include `.eq("tenant_id", current_user.hotel_id)` — this is the single most repeated convention across the entire codebase and the one most likely to be missed under time pressure when writing 6+ new aggregation endpoints |

## Sources

### Primary (HIGH confidence)
- Context7 `/twilio/twilio-python` — `RequestValidator` signature validation pattern, `MessageList.create()` signature, `MessagingResponse` TwiML usage
- Direct codebase reads (this session): `apps/api/routers/webhooks.py`, `guest_requests.py`, `lost_found.py`, `reports.py`, `internal.py`, `services/guest_recovery/contracts.py`, `services/ai/predictions.py`, `apps/api/tests/test_guest_recovery.py`, `apps/api/tests/smoke/fake_supabase.py`, `apps/api/models/requests.py`, `apps/api/core/config.py`, `apps/api/middleware/auth.py`, `apps/api/main.py`, `apps/api/requirements.txt`, `apps/api/pytest.ini`, `apps/web/components/guest-requests/GuestRequestDrawer.tsx`, `apps/web/lib/api/guest_requests.ts`, `apps/web/lib/api/hotels.ts`, `apps/web/app/(dashboard)/settings/{inspections,rooms,general}/page.tsx`, `apps/web/app/(dashboard)/routers/hotels.py`, `supabase/migrations/{008,009,055,072}...sql`, `.github/workflows/cron-jobs.yml`, `.claude/skills/{patelrep-api,patelrep-web}/SKILL.md`
- `pip index versions twilio` — verified current PyPI version 9.10.9

### Secondary (MEDIUM confidence)
- WebSearch (cross-checked against Twilio's own error-code documentation and a Twilio Support article "Twilio Support for Opt-out Keywords (SMS STOP Filtering)") — confirms default STOP/START interception behavior and that Advanced Opt-Out (Messaging Service feature) is required for webhook-level opt-out visibility
- WebFetch of `twilio.com/docs/messaging/guides/webhook-request` — inbound webhook POST parameter list (From, To, Body, MessageSid, etc.)

### Tertiary (LOW confidence)
- None flagged — all findings above were either directly verified in the codebase or cross-checked against official Twilio sources.

## Metadata

**Confidence breakdown:**
- Standard stack (Twilio SDK version/APIs): HIGH — verified via Context7 + pip registry
- Existing-code architecture (what's built vs. missing): HIGH — every claim in the Summary was verified by direct file reads this session, not inferred from CONTEXT.md alone
- Twilio opt-out/webhook nuances: MEDIUM — cross-checked via WebSearch against Twilio's own docs/support articles, not Context7-verified line-by-line
- 7-day forecast feasibility: MEDIUM — architectural conclusion (no forward-looking data source outside Opera) is HIGH confidence given direct schema reads; the *recommended alternative design* (trailing-average) is a reasoned proposal, not a verified existing pattern, hence flagged as Assumption A3
- PM deferral definition: LOW-MEDIUM — no existing schema concept, flagged as Assumption A2 requiring confirmation

**Research date:** 2026-07-24
**Valid until:** 30 days for architecture findings (stable, based on read-only codebase inspection); 7 days for Twilio SDK version pin (fast-moving vendor package, re-verify version before implementation if this research is used later than ~1-2 weeks out)

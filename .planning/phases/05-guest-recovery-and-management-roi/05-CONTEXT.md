# Phase 5: Guest recovery and management ROI - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the guest-service loop and let management quantify operational value. Four sub-domains, per `HOTEL_STANDARDS_EXECUTION_PLAN.md` §Phase 5:

1. **Guest request lifecycle + messaging MVP** — configurable SLA, the 9-state milestone chain (open → acknowledged → dispatched → arrived → guest_contacted → resolved → verified/reopened, plus cancelled), inbound/outbound SMS, consent/opt-out, service-recovery actions with compensation approval, satisfaction capture.
2. **Accessibility operations** — accessible-room feature metadata, accessibility-priority enforcement (already urgent-only by contract), maintenance protection, staff guidance for matching requests to suitable rooms.
3. **Lost and found** — tag/storage tracking, custody event history, retention clock, identity-verified release, approved disposition workflow.
4. **Management reporting** — the full ROI metric set: minutes/occupied room + cleaning-time variance, inspection pass-rate/repeat-defect trends, WO SLA + MTTR, repeat asset/room failures, room downtime + revenue impact, PM completion/deferral rates, training/compliance readiness, guest-request response/verified-resolution rates, 7-day rooms-to-clean + labor-hours projection.

**Important scouting finding — read before planning:** this is NOT a greenfield phase. A pre-GSD commit (`fea45b29`, 2026-07-16, "Refactor dashboard workflows and tighten API integrations") already shipped most of the *backend* for sub-domains 1–3:
- `supabase/migrations/072_guest_recovery_and_roi.sql` — full schema already applied (guest_requests columns, `guest_request_sla_policies`, `guest_request_events`, `guest_messages`, `guest_recovery_actions`, `accessible_room_features`, `lost_found_custody_events`; all append-only via triggers, all RLS-scoped).
- `apps/api/services/guest_recovery/contracts.py` — pure policy functions: SLA resolution, state-machine transition validation, custody-verification validation, deterministic metrics calc. Already unit-tested (`apps/api/tests/test_guest_recovery.py`, 6 tests).
- `apps/api/routers/guest_requests.py` (385 lines) and `apps/api/routers/lost_found.py` (254 lines) — both wired into `main.py`, implement create/transition/list/update/delete, accessibility feature CRUD, recovery-action recording, custody events, and a `/guest-requests/metrics/summary` endpoint.
- `apps/web/components/guest-requests/GuestRequestsPage.tsx` — kanban UI already reflects the full 9-status chain (collapsed into 3 visual columns: Open / In Progress / Resolved) with inline per-status advance buttons.
- `apps/api/routers/reports.py` — already has `/reports/guest-recovery` (response/verified-resolution rates) and `/reports/maintenance` (WO SLA compliance, avg response/repair hours = MTTR, category/priority breakdown).

**What's actually missing (the real Phase 5 work):**
- No SMS provider anywhere (no Twilio, no inbound webhook — only Opera/Stripe webhooks exist in `webhooks.py`). Outbound messages just insert as `delivery_status='queued'` with nothing to send them.
- No `guest_phone` field on `guest_requests` at all.
- `GuestRequestDrawer.tsx` has zero messaging UI (notes/comments only).
- `lost-found/page.tsx` has zero custody/retention/disposition UI — `retention_due_at` and `disposition_approved_by` columns are completely unused in code.
- No settings UI for `guest_request_sla_policies` (falls back to the 240-minute default) or `accessible_room_features` (API-only, no page).
- No unified ROI dashboard, no room-downtime revenue-impact calc (no room-rate source exists), no inspection pass-rate/repeat-defect trend, no PM completion/deferral aggregation, no training-readiness surfacing, no 7-day forecast.

Research and planning should treat sub-domains 1–3's *data layer and core validation* as largely done, and focus effort on: SMS integration, the missing web UI surfaces, retention/disposition enforcement, admin config pages, and the new ROI reporting/forecasting work.

</domain>

<decisions>
## Implementation Decisions

### Guest messaging (SMS)
- **D-01:** SMS provider is **Twilio**. No local Twilio credentials exist (same situation as the existing AI/Stripe gap) — build code-complete with a webhook route (mirroring the `webhooks.py` Opera/Stripe pattern), signature verification, and send/receive logic, unit-tested against a fake provider client. Explicitly flag live SMS delivery as unverified pending real credentials in the phase summary — do not claim it as tested.
- **D-02:** Inbound SMS matching is **reply-only**: link to the most recent `guest_requests` row that has an outbound `guest_messages` row to that phone number. No match → route to front-desk manual triage. Never auto-create a new guest request from a cold inbound text (avoids spam/wrong-number noise).
- **D-03:** Opt-out is **provider-level**: rely on Twilio's built-in STOP/START handling; when Twilio's status webhook reports an opt-out, set `contact_opted_out_at` so the existing consent check in `guest_requests.py` (`send_guest_message`) blocks further sends. No custom keyword parsing needed on top.
- **D-04:** Add a persisted **`guest_phone`** column to `guest_requests` (new migration). Captured once at request creation by front desk; auto-fills the `recipient` field on every outbound message and is the match key for inbound routing (replaces re-typing a number per message).
- **D-05:** Add a **message thread panel** inside the existing `GuestRequestDrawer.tsx` (not a separate tab) — inbound/outbound `guest_messages` in order, per-message `delivery_status`, reply box gated to the existing `MESSAGE_ROLES` (`front_desk`, `housekeeping_supervisor`, `engineer`, `gm`).

### Management ROI dashboard
- **D-06:** Build a **new unified "Management ROI" GM-only page** (not more tabs bolted onto the existing `/reports` page) that pulls guest-recovery, maintenance, and the new metrics together, organized around time-saved / quality / response / revenue-protected rather than per-domain totals.
- **D-07:** Room-downtime revenue impact uses a **GM-configured average daily rate (ADR)** field in Settings > General. Revenue impact = downtime hours × (rate / 24). No Opera Cloud dependency — matches the standalone-first constraint (Opera is pilot-gated and feature-flagged).
- **D-08 (Claude's discretion):** "Repeat" asset/room failure = same asset/room, 2+ failures within a trailing **90-day** window, with configurable start/end dates matching the pattern already used in `reports.py` endpoints.
- **D-09 (Claude's discretion):** For the 7-day rooms-to-clean/labor-hours forecast — research the existing room-readiness prediction cron and `housekeeper_profiles` rolling-average clean-time data during phase research; extend that pipeline to project 7 days forward if it fits, rather than building a parallel forecasting system.

### Lost & found retention/disposition
- **D-10:** Retention period is a **fixed 90 days** (not per-tenant configurable in this phase).
- **D-11:** When `retention_due_at` passes, a cron **flags the item for review only** (e.g., a `disposition_due` filter/status) — no automatic donation or disposal. Actual donate/discard still requires a manager to log a custody event with `disposition_approved_by`, consistent with the append-only/human-authorized pattern used throughout this codebase (Phase 1–4).
- **D-12:** Disposition approval RBAC = **`gm`, `housekeeping_supervisor`, AND `front_desk`** — the user explicitly rejected narrowing this to supervisor+ only; it should match the exact same role set already used for logging custody events in `lost_found.py`, not a stricter subset.

### Accessibility ops & SLA config UI
- **D-13:** Build a new **Settings > Guest Requests** page for managing `guest_request_sla_policies` (create/list rules by category + priority + guest_impact), mirroring the existing `settings/inspections` and `settings/housekeeping` page patterns. Without this the table stays unreachable and every request falls back to the 240-minute default.
- **D-14:** Manage `accessible_room_features` via a **new panel/tab on the existing Settings > Rooms page** (not a standalone top-level page) — reuse its existing room list/selection UI.
- **D-15:** "Staff guidance for matching requests to suitable rooms" = when viewing/creating an accessibility-category guest request, **show a list of rooms with the relevant operational `accessible_room_features` and their status** inline on the request. This is informational guidance only — not an automated room-assignment or booking action.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope source
- `HOTEL_STANDARDS_EXECUTION_PLAN.md` §"Phase 5 — Guest recovery and management ROI" (lines 289–351) — the authoritative deliverable list this phase must satisfy; also §"Definition of done for every phase" (lines 397–412) applies (migration/rollback, tenant+RBAC, web+mobile where applicable, tests-first, EN/ES copy, audit/evidence, error/offline handling, desktop+390px verification, prod smoke, and a saved-time/risk/service/revenue metric).

### Pre-existing schema and logic (already built, reuse — do not re-design)
- `supabase/migrations/072_guest_recovery_and_roi.sql` — full Phase 5 schema: `guest_requests` new columns, `guest_request_sla_policies`, `guest_request_events`, `guest_messages`, `guest_recovery_actions`, `accessible_room_features`, `lost_found_custody_events`, append-only triggers, RLS policies.
- `apps/api/services/guest_recovery/contracts.py` — SLA resolution (`resolve_sla_minutes`), state-machine validation (`validate_guest_request_transition`, `_ALLOWED_TRANSITIONS`), custody validation (`validate_lost_found_custody_event`), metrics calc (`calculate_guest_request_metrics`).
- `apps/api/routers/guest_requests.py` — existing lifecycle/messaging/recovery-action/accessibility endpoints.
- `apps/api/routers/lost_found.py` — existing item + custody-event endpoints.
- `apps/api/routers/reports.py` — existing `/reports/guest-recovery` and `/reports/maintenance` endpoints to extend rather than duplicate.
- `apps/api/tests/test_guest_recovery.py` — existing test coverage to extend, not replace.
- `apps/web/components/guest-requests/GuestRequestsPage.tsx`, `GuestRequestDrawer.tsx`, `HistoryTab.tsx`, `NewRequestModal.tsx` — existing web UI to extend (message panel, phone field) rather than rebuild.

### Prior UX decision (superseded in part)
- Memory: `project_guest_requests_spec.md` (agreed 2026-06-02) — original 3-column kanban spec (Open/In Progress/Resolved Today, inline confirm, no category badge, no guest name). The current implementation already extends this to the full 9-status chain collapsed into those 3 visual columns — treat the *visual* kanban decisions (card layout, inline confirm, drawer has no status controls) as still valid; the *status model* has since expanded and is now schema-locked by migration 072.

No other external specs — requirements fully captured in decisions above and in the execution-plan section referenced.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/guest_recovery/contracts.py` — pure functions, fully unit-tested; extend in place for new metric formulas (repeat-failure window, revenue impact) rather than creating a parallel service module (matches the "services/ only when shared 2+ domains" convention — this module already exists and is the natural home).
- `webhooks.py` (Opera + Stripe patterns) — the template to copy for a new Twilio inbound webhook: signature verification, event-type dispatch, structured error handling.
- `settings/inspections`, `settings/housekeeping` pages — template for the new Settings > Guest Requests (SLA policy) page.
- `settings/rooms` page — extend with an accessibility-features panel rather than a new top-level route.
- Existing `notification_deliveries` reminder pattern (Phase 2/3) — reusable if a reminder is ever added for disposition-due items (not required now per D-11, but the pattern exists if scope grows).

### Established Patterns
- Append-only + `SECURITY DEFINER` RPC pattern for immutable event tables (`guest_request_events`, `guest_messages`, `guest_recovery_actions`, `lost_found_custody_events` all already have this via migration 072 triggers) — any new write path must go through the existing insert patterns, never UPDATE/DELETE.
- Every mutation gated by `require_role()` / manual role-set checks matching the codebase's existing RBAC style (see `lost_found.py`'s `{"front_desk", "housekeeping_supervisor", "gm"}` sets).
- Tenant scoping via `.eq("tenant_id", current_user.hotel_id)` on every query — already followed consistently in the existing Phase 5 backend code; keep following it for all new code.

### Integration Points
- New `guest_phone` column requires a new migration (084+) and a form-field addition to `NewRequestModal.tsx` / the guest-request edit path.
- Twilio webhook registers alongside Opera/Stripe in `webhooks.py` and `main.py`'s router includes.
- ROI dashboard page is a new route under `apps/web/app/(dashboard)/` — decide exact route name during planning (e.g., `/reports/roi` vs a new top-level `/management-roi`).
- Retention-due cron follows the existing cron pattern: new `/v1/internal/lost-found/retention-check` endpoint registered in `.github/workflows/cron-jobs.yml` and `routers/internal.py`, guarded by `X-Cron-Secret`.

</code_context>

<specifics>
## Specific Ideas

- Twilio was the user's explicit provider choice (not "you decide") — do not substitute another SMS vendor during research/planning without checking back in.
- The user was explicit and firm that lost & found disposition approval must include `front_desk`, not just supervisor+ roles — this was a direct override of the recommended option, so treat it as a hard requirement, not a suggestion.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (SLA-policy per-tenant retention configurability and Opera-sourced room rates were both explicitly discussed and decided against for this phase, not deferred as unaddressed ideas — see D-07 and D-10.)

### Reviewed Todos (not folded)
None — `list-todos` returned zero pending todos at discussion time.

</deferred>

---

*Phase: 5-Guest recovery and management ROI*
*Context gathered: 2026-07-24*

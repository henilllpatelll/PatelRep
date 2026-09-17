# Phase 39: AI Shift-Handover + GM Morning Brief — Research

**Researched:** 2026-09-16
**Domain:** Existing FastAPI summary enrichment, atomic acknowledgment, persisted React Query UI
**Confidence:** HIGH for inspected code and schema; live Anthropic execution unverified

<user_constraints>
## User Constraints (from CONTEXT.md)

The decisions below are reproduced verbatim. Verified factual corrections follow them; preserve the intended behavior while using actual schema and reachable UI.

## Implementation Decisions

### Data enrichment (`services/ai/shift_summary.py`, `generate_shift_summary()`)
Add four new queries, each tenant-scoped (`hotel_id`), each capped at 10 items in the prompt text (matching the existing `completed_tasks[:20]` / `open_work_orders[:10]` truncation style) with a `_count` stat key even when the list is truncated:

- **VIP arrivals**: `rooms` joined/filtered where `vip_flag = true` AND today's `room_status.clean_type = 'DEP'` (the same "arrival/turnover" proxy `useArrivalReadiness.ts` already uses client-side — there is no PMS-arrival feed for non-Opera-pilot hotels, so this is the correct hotel-agnostic signal, not a new one). Count + room numbers.
- **Pending guest issues**: `guest_requests` where `status NOT IN ('resolved', 'verified', 'cancelled')` (mirrors the exact terminal-status set the guest-request→WO bridge already uses in `guest_requests.py` — do not hand-roll a different terminal list). Count + short description per row.
- **Low-stock parts**: reuse the exact predicate from `routers/inventory.py` (`total_on_hand < minimum_stock`, summed from `engineering_part_stock` per `engineering_parts`). Engineering parts only — `housekeeping_supply_pars` (migration 071) inclusion is Claude's discretion at plan time (nice-to-have, not required; keep scope tight if it adds meaningfully to the query surface). Count + part names.
- **SLA breaches**: reuse the exact predicate `check_escalations` already uses in `internal.py` — `work_orders` where `status IN ('open','in_progress') AND due_at < now()`, and `tasks` where `status IN ('open','in_progress') AND due_at < now()`. Do not invent a different threshold or reuse `escalation_level` as the sole signal — `due_at < now()` is the ground truth this codebase already treats as "breached." Count + titles, combined WO+task total.

Extend the prompt with a new section per signal (same style as existing `LOGBOOK ENTRIES:` / `TASKS COMPLETED THIS SHIFT:` blocks) and add a 5th instruction bullet: "Flag VIP arrivals, pending guest issues, low-stock items, and SLA breaches that need the next shift's attention." Extend `stats` JSONB with `vip_arrivals_count`, `pending_guest_issues_count`, `low_stock_parts_count`, `sla_breaches_count` — additive only, do not remove or rename existing stats keys (`tasks_completed`, `open_work_orders`, `logbook_entries_count`, `model_used`).

Do not change the cron schedule, the AI model/provider call, the credit-charging logic (`credits_charged: 3.0`), or the `ai_interactions` logging shape — only the data pulled into the prompt and the stats stored.

### Acknowledgment (new migration, next free number `105_*.sql`)
- `ALTER TABLE public.shift_summaries ADD COLUMN acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL, ADD COLUMN acknowledged_at TIMESTAMPTZ;` — both nullable, no default. NULL = not yet acknowledged (the normal initial state for every existing and new row).
- New endpoint `POST /v1/logbook/shift-summary/{summary_id}/acknowledge` in `logbook.py`. Any authenticated staff role may acknowledge (no `require_role` restriction beyond standard auth) — an oncoming supervisor, engineer, or the GM should all be able to confirm they read the handoff; this is deliberately not GM-only, unlike Phase 38's `hourly_rate`, because acknowledgment is a read-confirmation action, not a payroll-adjacent data write. Sets `acknowledged_by = current_user.user_id`, `acknowledged_at = now()`. If already acknowledged, return the existing acknowledgment unchanged (idempotent 200, not an error) — Claude's discretion whether to no-op silently or return a distinct message, but do not 409/error on a re-click, since a double-click or two staff both confirming shouldn't be treated as a failure.
- `GET /logbook/shift-summary/{shift_id}` (existing endpoint) includes `acknowledged_by`/`acknowledged_at` (nullable) in its response — extend, don't replace, the existing response shape (`summary_text`, `generated_by_ai` per the current web API client type).
- When surfacing "who acknowledged," resolve `acknowledged_by` to a display name using the same `user_profiles.full_name` lookup pattern already used elsewhere (e.g. `internal.py`'s `gm_profile` lookup, or `shift_summary.py` itself) — do not add a new profile-lookup helper if an existing one already does this.

### UI
- **Logbook page** (`apps/web/app/(dashboard)/logbook/page.tsx`): wherever `summary_text` is currently displayed, add an "Acknowledge" button when `acknowledged_at` is null; once set, replace it with a read-only line like "Acknowledged by {name} · {relative time}" (follow this codebase's existing relative-time formatting convention — check for a shared date-format util before adding a new one).
- **`OvernightRecapStrip.tsx`** (GM dashboard): add a small acknowledgment affordance next to the existing "Read full recap" link — an inline "Acknowledge" action when unacknowledged, or a compact "✓ Acknowledged" indicator when already acked by anyone. Must not break the existing single-line, `h-[52px]`-constrained truncated layout — keep it minimal (a text link or small badge, not a new row/section). This requires wiring the acknowledgment fields through `useArrivalReadiness.ts`'s `overnightSummary`/`OvernightSummary` type (currently just `{ text, href }` — extend it, e.g. add `id`, `acknowledgedAt`, `acknowledgedByName`).
- Do NOT create a new dedicated "Morning Brief" page/route. Do NOT add a new dashboard widget beyond enriching `OvernightRecapStrip`. Do NOT change `SimplifiedDashboard.tsx`'s overall layout beyond whatever minimal prop-threading is needed to pass the richer summary data through.
- i18n: add any new UI strings to both `en.ts` and `es.ts` (this codebase's established bilingual-parity requirement, per Phase 38's own precedent and the v2.0 rollout's i18n regression history — do not ship an English-only string).

### Claude's Discretion
- Whether to include `housekeeping_supply_pars` low-stock signal alongside `engineering_parts` (nice-to-have, not required).
- Exact prompt wording for the new instruction bullet and new data sections (must remain factual/actionable, matching the existing prompt's tone — not verbatim-locked).
- Idempotent-acknowledge response shape (silent no-op vs. a `"already_acknowledged": true` flag in the response).
- Exact copy/placement of the "Acknowledge" affordance in both UI surfaces, and which relative-time/date-formatting utility to reuse.
- Migration file name suffix (must be `105_*.sql`).
- Test file naming/organization — follow this project's existing `test_*.py` conventions (e.g. a new `test_shift_summary_acknowledgment.py`, or extend an existing logbook test file if one already covers `generate_shift_summary`).

### Deferred Ideas (explicitly out of scope)
- A dedicated "Morning Brief" page or new dashboard route/widget beyond enriching the two existing surfaces.
- Escalation or re-notification if a shift summary goes unacknowledged (no Phase-29-style ladder here — acknowledgment is informational, not SLA-enforced).
- Rewriting or touching the separate `reports.daily-summary-email` cron (plain-text Resend email) — different feature, different code path, not in scope.
- Changing the cron schedule/cadence for `logbook.shift-summary`.
- Any new AI model, provider, or routing decision — reuse the exact existing `anthropic.Anthropic` call and model id already hardcoded in `shift_summary.py`.
- Occupancy→labor forecasting, proactive exception alerts, or any other Output-3 ranked item beyond #2 — those are separate future phases.

</user_constraints>

## Summary

Extend the existing summary service and table. Do not add an AI provider, scheduler, notification loop, or page. The missing implementation is larger than attaching two fields: current summary generation, saved-summary reads, and dashboard display are disconnected. Plans must repair those connections before acknowledgment can identify the actual handoff.

**Primary recommendation:** enrich the existing service, return persisted summary IDs, expose tenant/date-scoped summary reads, implement conditional acknowledgment, and feed both existing UI components from one shared summary query.

## Standard Stack

| Existing dependency | Inspected version/source | Use |
|---|---|---|
| FastAPI, synchronous supabase-py, Anthropic SDK | Existing Python service/router imports; no dependency changes required | Add queries and endpoints inside existing modules |
| Next.js / React | `apps/web/package.json`: 16.3.0-preview.10 / ^18.3.1 | Existing authenticated Logbook and dashboard |
| TanStack React Query | ^5.101.4 | Shared persisted-summary reads and mutation invalidation |
| date-fns / react-i18next | ^4.4.0 / ^17.0.11 | Existing relative-time rendering; English/Spanish copy |
| pytest / Playwright / tsx | Existing project harnesses; Playwright ^1.62.1 | API contracts, browser workflow, existing web unit tests |

Do not install a new test runner or data layer. The web `test:unit` script currently enumerates five utility test files explicitly; a new test is not automatically included.

## Verified Context Corrections

| Assumption in context | Actual evidence | Planning consequence |
|---|---|---|
| Tables filter `hotel_id` | Service/router code and orchestrator's live schema use `tenant_id`; auth exposes `current_user.hotel_id` | Apply `.eq("tenant_id", current_user.hotel_id)` to every tenant-owned read/write |
| `rooms.vip_flag`, dated `room_status` | Live schema confirmed by orchestrator: `room_status.vip_flag` and `clean_type`; no date column. `rooms` has room_number/is_active, no vip_flag | Query current `room_status` with joined rooms; do not filter an invented status date or claim historical arrival accuracy |
| Generator also inserts AI logbook entry | `shift_summary.py` inserts only `shift_summaries` and `ai_interactions` | Read `shift_summaries` directly; never use a logbook entry UUID as summary UUID |
| Summary timestamp is generic created time | Live schema has `generated_at`, not `created_at` | Sort summaries using `generated_at` with deterministic tie-breaker |
| Existing Logbook panel reads summaries | `AISummaryPanel` holds local `summaryText` only and sends `shift_id: 'today'` | Hydrate saved summaries by selected date and generate using an actual tenant-owned shift UUID |
| Existing GET matches one row by shift | GET `/shift-summary/{shift_id}` uses unbounded `maybe_single()` without a date | Multiple dates can break it; add optional date/latest deterministic selection while preserving the response envelope |
| `generated_by_ai` is provided | Client type declares it, but router returns raw summary rows | Define one accurate `ShiftSummary` type; retain/synthesize compatibility field if required, and return persisted ID, stats and acknowledgment fields |
| Recap already appears on active dashboard | `SimplifiedDashboard.tsx` never imports the recap or readiness hook | Mount the existing `OvernightRecapStrip` once directly after the existing briefing hero (around line 868), retaining the staffing/work-list layout |
| Exact cron escalation predicate is only status/due | Cron additionally requires assigned staff and escalation_level<3; tasks also require urgent priority | Use the context's explicit briefing status+due rule; document that notification eligibility is narrower than outstanding breach reporting |

The orchestrator confirmed live migration 104 is current, acknowledgment columns are absent, shifts have tenant_id/department_id/is_active/start_time/end_time, and existing table RLS is enabled. Research did not independently query live data or expose fixture credentials.

## Architecture Patterns

### Enrichment stays in the existing service

- VIP: current `room_status`, tenant-scoped, `vip_flag=true`, `clean_type='DEP'`, with room numbers from a tenant-scoped rooms join. This is the existing turnover proxy, not confirmed reservations. Do not add a date filter unsupported by the schema.
- Pending guest issues: exclude exactly resolved/verified/cancelled. The inspected bridge defines active `_BRIDGEABLE_STATUSES` rather than a reusable exported terminal constant; retain the exact terminal semantics without importing a router into the service.
- Low stock: active `engineering_parts` only; sum every `engineering_part_stock.quantity` per part across locations, default missing stock to zero, then compare strictly `< minimum_stock`. Equal stock is not low. Follow `inventory.py` semantics. Omit housekeeping supplies to keep scope bounded.
- SLA: tenant-scoped open/in_progress work orders plus tasks with `due_at < UTC now`; exclude null/future dates and completed items. Compute one combined count and cap the combined prompt list at ten, not ten per source.
- Four signals need more than four database calls: low stock requires parts plus stock, SLA requires tasks plus work orders. Keep full counts despite ten-item prompt truncation; exact counts for directly filtered queries or complete/paginated result sets for aggregate stock prevent silent API-row-limit undercounting.
- Preserve model `claude-sonnet-4-6`, 1024 max tokens, existing credit and interaction fields as locked. Add four stats keys without removing current keys. Keep text factual and bounded; staff/guest free text is data, not model instructions.
- Scope the existing shift lookup to tenant before using department_id or calling the provider. Return a controlled missing/foreign shift result before AI charges or writes. Capture the inserted summary row so manual generation returns its actual ID.

### One persisted summary contract

Add a tenant/date-scoped saved-summary read route in `logbook.py` (a plural list route is natural) alongside the existing single-shift route. Return complete summaries including `id`, `shift_id`, `shift_date`, `generated_at`, `summary_text`, `stats`, nullable acknowledgment fields, and nullable display name. Date reads should have deterministic ordering. The recap must choose a summary row from this endpoint; no heuristic string or ID join to logbook entries.

Preserve the overnight intent explicitly: select the earliest generated handoff for the selected day if retaining the current convention. A latest-summary rule would be a deliberate behavior change. A recap link should carry enough date/summary identity that Logbook opens the same handoff, rather than silently displaying another shift. Empty saved-summary data should remain an honest empty state.

Use a shared React Query summary key containing tenant and date. Both `useArrivalReadiness` and the actual `SimplifiedDashboard` should consume the same small summary hook. Do not mount all of `useArrivalReadiness` inside SimplifiedDashboard; that would duplicate board/work-order/roster/risk traffic. Preserve `overnight.summary`, loading/error/refetch contracts for its existing callers.

The Logbook panel should fetch saved summaries when opened/reloaded or date changes. Separate generation authorization from read/acknowledge authorization: its current `if (!isSupervisor) return null` would hide acknowledgment from other authenticated roles. Keep generation's existing API RBAC. Resolve manual generation to a real active tenant shift using existing scheduling reads or a documented server selection rule; never send the placeholder `today` as a UUID.

### Atomic acknowledgment

Use one conditional UPDATE filtered by summary ID, tenant, and `acknowledged_at IS NULL`. If it returns no rows, read the same tenant-scoped ID: return the existing acknowledgment unchanged or 404 if missing. This is first-writer-wins; a read-then-unconditional-update is not. PostgreSQL rechecks the UPDATE condition after a competing row update under its default isolation. [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)

Use `acknowledged_at` as the state marker: deleting an auth user sets acknowledged_by to NULL while the acknowledgment time persists. Display a translated fallback name in that case. Resolve user_profiles only after the summary has been tenant-authorized, using the existing id/full_name lookup pattern; no client-supplied actor or timestamp.

After success update/invalidate the tenant/date summary caches and relevant single-summary cache. Disable the pending button and keep recoverable error feedback on failure. Await invalidation where needed for pending-state consistency. [TanStack mutation invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations)

## Code Examples

Illustrative conditional update using the existing Supabase Python style:

```python
updated = (
    supabase.table("shift_summaries")
    .update({"acknowledged_by": current_user.user_id,
             "acknowledged_at": datetime.now(timezone.utc).isoformat()})
    .eq("id", str(summary_id))
    .eq("tenant_id", current_user.hotel_id)
    .is_("acknowledged_at", "null")
    .execute()
)
# If no returned row: tenant-scoped read, returning existing acknowledgment or 404.
```

Use UUID path validation and a typed date for new endpoints. Verify the installed SDK returns update representations (the existing project assumes `result.data`); do not blindly add unsupported chained methods. [Supabase update](https://supabase.com/docs/reference/python/update), [Supabase null filter](https://supabase.com/docs/reference/python/is)

## Don't Hand-Roll

| Problem | Use | Avoid |
|---|---|---|
| Competing acknowledgments | Database conditional UPDATE | Python locks, pre-read-only guards, last-click-wins |
| Saved summary identity | Persisted row ID returned by API | Logbook UUID, text matching, generated client IDs |
| Cross-surface freshness | Shared React Query keys/invalidation | A second Zustand store or Realtime channel |
| Relative time | Existing `formatDistanceToNow`; locale-aware en/es | New formatter utilities for this phase |
| Display of generated text | React plain text/whitespace handling | Raw HTML injection |

## Common Pitfalls

- `logbook._get_hotel_tz` still queries `hotels`; project memory and live schema say `tenants`. If touched for date resolution, correct that lookup with the existing timezone fallback and focused regression coverage.
- A summary insert that ignores its returned row cannot support immediate acknowledgment after Generate. Keep existing top-level generation counters compatible while adding persisted identity.
- Live metadata confirmed by the orchestrator: summary uniqueness is only the primary key `id`, with no tenant/shift/date unique constraint. Regeneration can insert a new revision; choose the displayed revision deterministically and never attach an old acknowledgment to new unseen text. Do not use an upsert conflict target unsupported by an index.
- Only the recap skeleton currently has `h-[52px]`; keep rendered content constrained too. Long text, translations, loading/error copy, and narrow viewports must not push the action off-screen.
- Do not mask failed new data queries as reassuring zero-count results. Use controlled failure behavior and distinguish missing data from no issues.
- Existing Supabase no-row responses can be `None`, not an object with `.data`; guard both. Prefer `.limit(1)` list reads for deterministic optional records.

## Verification Plan

1. **Service tests first:** deterministic fake Supabase and fake Anthropic. Assert each new query is tenant-scoped; VIP uses actual columns; all three guest terminal statuses are excluded; stock sums across locations and handles missing/equal/inactive stock; SLA boundaries/exclusions; eleven-item data yields full count but only ten prompt items; empty inputs; existing stats/model/credit shape unchanged; invalid or foreign shifts cause no provider call or write.
2. **API tests:** all supported authenticated roles can acknowledge; unauthenticated rejected; valid/missing/foreign UUIDs; malformed ID; first acknowledgment; repeat by same/different staff keeps actor/time; simulate another writer winning between attempts; deleted-profile fallback; persistence/readback; multi-date summary selection and empty date response. Assert conditional update filters explicitly, not merely successful HTTP status.
3. **Real database concurrency smoke:** on a newly created fixture-owned summary, issue simultaneous acknowledgments as two fixture users; both 200 results and later read must show one stable actor/time. An ordinary sequential mock does not prove database concurrency.
4. **Browser workflow:** localhost dashboard loads actual saved recap, click Acknowledge, read-only indicator, reload persistence, same handoff on Logbook link, Logbook acknowledgment updates dashboard cache, other staff role can read/ack, historical date switches reset displayed summary, duplicate click and error/retry, empty state, English/Spanish, desktop/narrow width. Inspect screenshots and console/network responses.
5. **Project checks:** focused pytest, full API suite, API lint/type checks if configured, web type-check/lint/build, existing unit suite, i18n parity and focused Playwright. The orchestrator repaired three unrelated stale management-ROI fixture date parameters and confirmed a green 431/431 non-smoke API baseline before Phase 39 changes.

## Safe Development Verification

Use the configured linked Supabase project only through the orchestrator's verified access. Current MCP tools are unavailable; CLI Management API access is confirmed, so tool-name drift is not a blocker. Keep existing RLS and schema migration scope unchanged. Apply migration 105 through the orchestrator, then verify nullable/no-default fields, auth.users FK/ON DELETE SET NULL and advisory baseline.

Use fixture-owned records and clean only IDs created by the verification run. Existing regression fixture environment provides GM/supervisor credentials; load without printing keys, passwords or JWTs. Confirm frontend API origin and localhost ports before launching, and use hidden Windows processes. Avoid the E2E suite's default production base URL by explicitly setting the localhost URL. Development API startup must keep cron scheduling disabled.

No local AI provider keys are present per orchestrator inspection. Test generation with a controlled local fake-provider harness and real database integration where safe; separately label actual Anthropic execution unverified. Never substitute a fabricated AI result and claim an external provider pass. No deployment or production cron invocation is needed to complete local verification.

## Sources and Confidence

- HIGH: targeted source reads of `shift_summary.py`, `logbook.py`, relevant `internal.py` handlers, inventory stock predicate, guest-request status definitions, `useArrivalReadiness.ts`, logbook client, recap component, active dashboard and Logbook panel.
- HIGH: live schema findings provided by orchestrator on 2026-09-16 (not independently re-queried by researcher).
- HIGH: official Supabase update/null-filter, PostgreSQL transaction isolation, and TanStack mutation invalidation documentation linked above. Context7 tools unavailable; official docs used directly.
- HIGH: project API/web/security skills, OpenWolf guidance and relevant memory. Domain skill examples contain stale hotel_id/table names, so actual schema takes precedence.
- MEDIUM: final manual shift selection, revision display selection and recap detail-link design remain planner implementation choices to verify.

**Validity:** code/schema findings apply to this checkout on 2026-09-16. Recheck only modified contracts before execution.

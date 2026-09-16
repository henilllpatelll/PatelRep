# Phase 39: AI Shift-Handover + GM Morning Brief - Context

**Gathered:** 2026-09-16
**Status:** Ready for planning
**Mode:** Autonomous (user delegated all decisions — "run the same loop" as Phase 38: no interactive discussion, decisions below are Claude's, grounded in `.planning/research/oss-ecosystem-landscape.md`'s Output-3 ranked list item #2 ("AI shift-handover + GM morning brief" — "very high value / high differentiation") and cross-module opportunity #4 ("AI shift-handover + morning brief... auto-compose: open WOs, rooms not ready, VIP arrivals, pending guest issues, low stock, SLA breaches — next shift acknowledges"), plus a direct read of the current schema/code before writing this file.

<domain>
## Phase Boundary

This is NOT a greenfield feature — significant infrastructure already exists and must be extended, not duplicated:
- `services/ai/shift_summary.py`'s `generate_shift_summary()` already calls Claude Sonnet to compose a narrative shift-handoff summary from logbook entries, completed tasks, and open work orders, storing it in `shift_summaries` (migration 012) and as an `is_ai_generated=true` row in `logbook_entries`.
- Cron `logbook.shift-summary` (`internal.py`'s `generate_shift_summaries`, scheduled 7/15/23 UTC) already calls this for every shift automatically.
- The GM dashboard already surfaces the most-recent overnight AI summary as a one-line truncated strip (`OvernightRecapStrip.tsx`, driven by `useArrivalReadiness.ts`'s `overnightSummary` — it just reads the earliest `is_ai_generated` logbook entry of the day) with a "Read full recap" link to `/logbook`.
- The Logbook page (`apps/web/app/(dashboard)/logbook/page.tsx`) already has a manual "Generate Summary" trigger and displays `summary_text`.

**What's actually missing** (confirmed by code read, not assumption): the AI summary's data pull only covers logbook/tasks/WOs — it has no idea about VIP arrivals, pending guest issues, low-stock parts, or SLA-breached items, so it can't do the "flag what needs you" job the research doc asks for. There is also no acknowledgment mechanism anywhere (no "next shift confirms they read this").

This phase's job: **enrich the existing AI summary's inputs and prompt** with the four missing signals, **add a lightweight acknowledgment field + action**, and **surface acknowledgment in the two existing UI surfaces** (Logbook detail view, `OvernightRecapStrip`). It does NOT build a new page, a new cron, a new AI model integration, or a new notification/escalation loop for unacknowledged summaries.

</domain>

<decisions>
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

</decisions>

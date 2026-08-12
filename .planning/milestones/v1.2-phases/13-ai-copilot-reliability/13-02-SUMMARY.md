---
phase: 13-ai-copilot-reliability
plan: 02
subsystem: ai
tags: [fastapi, supabase, postgres-check-constraint, react-query, i18n]

# Dependency graph
requires:
  - phase: 13-ai-copilot-reliability
    provides: "13-01's canonical ApiClientError catch-block pattern (err instanceof ApiClientError ? err.message : fallback), replicated here"
provides:
  - "New work_order_triage backend intent: rule-based, zero-LLM, zero-credit summary derived from request.context.work_orders"
  - "handleAITriage sends intent_hint: 'work_order_triage' and renders the real backend message instead of a static canned string"
  - "Distinct success/error notice styling ({ message, isError } state) matching 13-01's AI-surface error pattern"
  - "Migration 088 (ai_interactions.interaction_type CHECK constraint widened to include work_order_triage), applied live"
affects: [13-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Rule-based, zero-LLM AI intent branches (pattern established by 13-01's suggest_assignments, reused here for work_order_triage) — testable without live OpenAI/Anthropic credentials"
    - "{ message: string; isError: boolean } notice state shape for AI-surface success/failure distinction, alert-toned styling via bg-[var(--alert-soft)]/border-[var(--alert-line)]/text-[var(--alert)] on failure"

key-files:
  created:
    - apps/api/tests/smoke/test_ai_work_order_triage.py
    - supabase/migrations/088_ai_interactions_work_order_triage_type.sql
    - .planning/phases/13-ai-copilot-reliability/deferred-items.md
  modified:
    - apps/api/routers/ai_copilot.py
    - apps/web/app/(dashboard)/engineering/work-orders/page.tsx
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts

key-decisions:
  - "Kept the migration narrowly scoped to only the new work_order_triage value, not the broader pre-existing interaction_type CHECK-constraint drift (general/work_order_creation/guest_request_creation/task_assignment/housekeeping_briefing all still unsupported) — that drift is documented in the migration's own header comment and in deferred-items.md for a future plan, matching 13-02's declared scope boundary."
  - "Restarted the dev API server after finding stale --reload workers were serving pre-13-02 code (masked the migration's effect during first live-verification attempt) — matches the same environment gotcha documented in 13-01 and 06-05, not a code deviation."
  - "Logged the /v1/tasks?per_page=200 422 (EngineeringRoomBoard.tsx, outside this plan's file list) to deferred-items.md rather than fixing it in-plan, per the Rule 1-3 scope boundary (only fix issues directly caused by this plan's own changes)."

patterns-established:
  - "AI-surface { message, isError } notice pattern for 13-03 to replicate if it touches another chat-driven notice surface"

# Metrics
duration: 45min
completed: 2026-08-02
---

# Phase 13 Plan 02: Work Order Triage Honesty Fix Summary

**New rule-based `work_order_triage` backend intent replaces the static "AI triage applied" string with a genuine, context-derived summary (overdue/unassigned counts + suggested floor order), and `handleAITriage` now renders real success/failure states instead of disguising every outcome as a success.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-08-02T19:10:00-05:00 (approx, continuation of a session interrupted mid-task by a limit)
- **Completed:** 2026-08-02T20:24:00-05:00
- **Tasks:** 3 planned (2 code tasks + 1 verification-only task), all complete
- **Files modified:** 7 (2 created for planned tasks, 1 migration file, 3 modified for planned tasks, 1 deferred-items log)

## Accomplishments

- New `_build_work_order_triage_summary(work_orders)` helper in `apps/api/routers/ai_copilot.py` — pure, zero-DB, zero-LLM function computing overdue count, unassigned count, and a priority-ranked suggested floor order (top 5 by `room_number`/`title`/`"—"` fallback) from the real work orders the frontend sends
- New `elif intent == "work_order_triage":` branch wires that helper into `copilot_chat`, returning `response_type: "answer"` with the genuine message, `credits_used: 0`, `model_used: None` — mirrors 13-01's `suggest_assignments` zero-credit rule-based precedent
- `intent_to_log["work_order_triage"] = "work_order_triage"` so the audit log records the real intent instead of collapsing to `"general"`
- New `test_ai_work_order_triage.py` (3 tests): empty-list message, overdue/unassigned prioritization ordering, malformed-`due_at` safety — all call the helper directly with no DB mocking required
- `handleAITriage` (`apps/web/app/(dashboard)/engineering/work-orders/page.tsx`) now sends `intent_hint: 'work_order_triage'`, reads `res.data.message` for the real backend-computed summary on success, and distinguishes `ApiClientError` detail from a generic fallback on failure — `aiTriageNotice` state changed from a bare string to `{ message: string; isError: boolean }`
- Notice box now renders alert-toned styling (`bg-[var(--alert-soft)]`/`border-[var(--alert-line)]`/`text-[var(--alert)]`, `AlertCircle` icon) on failure instead of the same ai-toned "success" styling used for both outcomes previously
- `aiTriageErrorDetail` EN/ES locale key added; the now-unused `aiTriageApplied` key removed from both locale files
- The deterministic `sortWOs` client-side reorder in the `finally` block is unchanged and still fires unconditionally regardless of AI-call outcome

## Task Commits

Each task was committed atomically:

1. **Task 1: Add a genuine rule-based work_order_triage intent branch to the backend** - `6040f939` (feat) — completed and committed in the prior (interrupted) session
2. **Task 2: Wire the frontend to the real intent and distinguish success from failure** - `accc0d9b` (feat)
3. **[Deviation, Rule 1] Add work_order_triage to ai_interactions.interaction_type CHECK constraint** - `ca0d0fd3` (fix)
4. **Task 3: Regression-verify adjacent Engineering surfaces sharing this page** - verification-only, no files modified, no commit

_This SUMMARY.md + STATE.md update will be committed together as the final metadata commit._

## Files Created/Modified

- `apps/api/routers/ai_copilot.py` - `_build_work_order_triage_summary` helper + `work_order_triage` intent branch + `intent_to_log` entry
- `apps/api/tests/smoke/test_ai_work_order_triage.py` - 3 tests locking the triage summary logic
- `apps/web/app/(dashboard)/engineering/work-orders/page.tsx` - `handleAITriage` sends `intent_hint`, reads real `res.data.message`, distinguishes `ApiClientError` detail; notice box renders distinct alert styling on failure
- `apps/web/i18n/locales/en.ts` / `es.ts` - `aiTriageErrorDetail` added, unused `aiTriageApplied` removed
- `supabase/migrations/088_ai_interactions_work_order_triage_type.sql` - widens `ai_interactions.interaction_type` CHECK constraint to include `work_order_triage`; applied live via Supabase MCP by the orchestrator, verified via `pg_get_constraintdef`
- `.planning/phases/13-ai-copilot-reliability/deferred-items.md` - logs 2 out-of-scope discoveries found during live verification (see below)

## Decisions Made

- Migration 088 deliberately widens the CHECK constraint by exactly one value (`work_order_triage`) rather than fixing the full pre-existing drift affecting `general`/`work_order_creation`/`guest_request_creation`/`task_assignment`/`housekeeping_briefing` — that broader fix is out of this phase's declared scope (per the migration's own header comment) and is now tracked in `deferred-items.md` for a future plan.
- The `aiTriageApplied` locale key was removed rather than left unused, since it directly encoded the old fabricated-success wording this plan exists to eliminate — keeping it around risked a future accidental re-use.
- Restarting the dev API server (see Issues Encountered) was treated as an environment-recovery step, not a code deviation — no code changed to fix it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added `work_order_triage` to the live `ai_interactions.interaction_type` CHECK constraint**
- **Found during:** This plan's own required live-verification step (Task 2's `<verify>` section)
- **Issue:** `ai_interactions.interaction_type`'s CHECK constraint has drifted from migration 013's original text (untracked by any subsequent migration prior to this one) and only allowed the original 8 legacy values. The new `work_order_triage` intent added by Task 1 would 500/400 on every real hit at the final unconditional `log_ai_interaction` call in `copilot_chat`, meaning the plan's own success path could never complete against the live database.
- **Fix:** `supabase/migrations/088_ai_interactions_work_order_triage_type.sql` — `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` re-adding the original 8 values plus `work_order_triage`. Deliberately does not touch the other drifted values (see Decisions Made / deferred-items.md).
- **Files modified:** `supabase/migrations/088_ai_interactions_work_order_triage_type.sql`
- **Verification:** Applied to the live Supabase project (`oacnwalhcpqdabivweki`) by the orchestrator via `apply_migration`, confirmed via `pg_get_constraintdef` before this execution session began. Independently re-confirmed in this session via a direct `supabase-py` insert with `interaction_type="work_order_triage"` (succeeded), and via the full end-to-end live browser walkthrough (see below).
- **Committed in:** `ca0d0fd3`

---

**Total deviations:** 1 auto-fixed (1 bug fix, Rule 1)
**Impact on plan:** Necessary for the plan's own success criteria — without this migration, the new intent's success path could never complete against the live database for any real hit. No scope creep: the fix is a single additive CHECK-constraint value, matching the plan's own instruction and 13-01's precedent for in-phase DB bug fixes.

## Issues Encountered

- **Stale dev API server masked the migration's effect on first live-verification attempt.** The `uvicorn --reload` process on port 8003 (PID 44268, plus its multiprocessing worker) had started at 19:02:16, before the file edits from this session's continuation were saved to disk had a chance to be picked up reliably — the first live click of "AI triage" 400'd with the exact `23514` check-violation error the migration was supposed to have already fixed, even though a direct `supabase-py` insert with the same `interaction_type` value succeeded moments later, and an in-process call to `copilot_chat()` with an identical payload also succeeded. This is the same "stale/zombie dev process" environment gotcha already documented in `13-01-SUMMARY.md` and `06-05-SUMMARY.md`. Killed the stale parent/worker/multiprocessing-child trio and started a fresh `uvicorn --reload --port 8003`; the identical curl request that had 400'd immediately returned 200 with the real triage message afterward. No code changed — purely an environment-recovery step.
- **Confirmed (not fixed) a second, already-documented pre-existing bug during Task 3's regression walkthrough:** sending a message to the main AI Copilot chat bubble that scores 0 against every `detect_intent` keyword list (e.g. "Create a task to check smoke detectors in room 210") falls through to the `"general"` intent, which is *also* not in the original migration-013 CHECK-constraint list and therefore 400s on the same `ai_interactions_interaction_type_check` constraint — exactly as migration 088's own header comment predicted and explicitly deferred. This is unrelated to 13-02's changes (it reproduces on the pre-existing, unmodified keyword-scoring path, not the new `work_order_triage` branch) and is now logged in `deferred-items.md` for a future plan rather than fixed here, since widening the constraint to cover all `intent_to_log` values is explicitly out of this plan's scope.
- **Found (not fixed) an unrelated pre-existing 422** on `GET /v1/tasks?per_page=200`, fired by `EngineeringRoomBoard.tsx` (outside this plan's file list) every time the Room Board tab is opened on the Work Orders page — the backend's `/v1/tasks` query-param validator caps `per_page` at 100. Silently fails (React Query swallows it, task-count badge just doesn't populate); no visible UI breakage. Logged in `deferred-items.md`.

## User Setup Required

None - migration 088 was already applied to the live Supabase project by the orchestrator before this execution session began; no further external service configuration required.

## Next Phase Readiness

- Full API smoke suite: **257/257 passed** (254 baseline from 13-01 + 3 new `test_ai_work_order_triage.py` tests), zero regressions.
- `apps/web` type-check: clean.
- Live browser walkthrough (GM login, Sonesta ES Suites Fossil Creek, real dev Supabase project):
  - Success path: clicked "AI triage" against 20 real open/escalated work orders — notice rendered `"Reviewed 20 open work order(s): 20 overdue, 16 unassigned. Suggested floor order: ..."` with `Sparkles` icon and ai-toned styling, matching the `/ai/copilot/chat` response body's `data.message` exactly. Zero console errors.
  - Failure path: mocked a 503 on `/ai/copilot/chat` via Playwright route interception — notice switched to `"AI triage unavailable: Service Unavailable"` with `AlertCircle` icon and confirmed `bg-[var(--alert-soft)]`/`border-[var(--alert-line)]`/`text-[var(--alert)]` classes via DOM inspection. Removed the mock and re-clicked — notice correctly recovered to the genuine success message.
  - Adjacent surfaces confirmed unaffected: Room Board tab renders (aside from the pre-existing, unrelated `/v1/tasks` 422 above), Work Order detail drawer opens/closes cleanly, "New Work Order" modal opens/closes cleanly, emergency/urgent alert banner renders correctly alongside the notice box with no overlap, main AI Copilot chat bubble's `task_creation` intent (message: "Room 210 needs extra towels") still correctly produces a task preview with zero console errors — confirming `detect_intent`'s existing keyword-scoring path is unaffected by the new `work_order_triage` branch (which only activates via explicit `intent_hint`).
- 13-03 is unblocked and can proceed; it should replicate the `{ message, isError }` / `ApiClientError` pattern established across 13-01 and 13-02 for cross-surface consistency (AI-02's stated requirement).
- Two out-of-scope items logged for future planning in `.planning/phases/13-ai-copilot-reliability/deferred-items.md`: the `/v1/tasks?per_page=200` 422, and live confirmation of the broader `ai_interactions.interaction_type` CHECK-constraint drift (`general` and others) already flagged in migration 088's header comment.

---
*Phase: 13-ai-copilot-reliability*
*Completed: 2026-08-02*

## Self-Check: PASSED

- FOUND: apps/api/tests/smoke/test_ai_work_order_triage.py
- FOUND: supabase/migrations/088_ai_interactions_work_order_triage_type.sql
- FOUND: .planning/phases/13-ai-copilot-reliability/deferred-items.md
- FOUND: 6040f939, accc0d9b, ca0d0fd3 (all commits present in git log)

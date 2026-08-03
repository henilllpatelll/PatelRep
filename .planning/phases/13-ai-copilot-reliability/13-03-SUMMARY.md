---
phase: 13-ai-copilot-reliability
plan: 03
subsystem: ai
tags: [react-query, error-handling, playwright]

# Dependency graph
requires:
  - phase: 13-ai-copilot-reliability
    provides: "13-01/13-02's canonical ApiClientError catch-block pattern (err instanceof ApiClientError ? err.message : fallback), replicated and finalized here on the third and final AI Copilot surface"
provides:
  - "AICopilotBubble.tsx's 4 confirm handlers (handleConfirmTasks/WorkOrders/GuestRequests/Assignments) now catch failures, surface the real ApiClientError message inline in the chat thread, and rethrow so ConfirmView/TaskConfirmView correctly skip the false-success checkmark and reset to a retryable state"
  - "sendMessage's catch surfaces err.message when it's an ApiClientError instead of always showing a hardcoded generic string"
  - "Final cross-surface consistency confirmation: all 3 AI Copilot entry points (chat bubble, assignment sidebar, engineering triage) share the identical catch -> ApiClientError.message -> visible-surface -> finally-reset shape"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Confirm-handler error contract: catch, append inline error bubble, then rethrow -- required whenever a parent's try { await onConfirm(); setConfirmed(true) } finally { setConfirming(false) } depends on rejection propagating to skip the success state"

key-files:
  created: []
  modified:
    - apps/web/components/ai/AICopilotBubble.tsx
    - .planning/phases/13-ai-copilot-reliability/deferred-items.md

key-decisions:
  - "Confirm handlers rethrow after appending the inline error bubble rather than swallowing the error, because ConfirmView/TaskConfirmView's untouched try/finally block depends on the rejection to correctly skip setConfirmed(true) -- swallowing would have reintroduced the exact false-success bug class this phase exists to eliminate"
  - "Logged (not fixed) a third live reproduction of the pre-existing, already-deferred ai_interactions.interaction_type 'general'-intent CHECK-constraint drift (13-02's deferred-items.md item 2), found via the 'At-risk rooms today' quick-action chip -- confirmed as the same known issue, not a regression from this plan's changes, and out of this plan's declared scope (file list is AICopilotBubble.tsx only, no backend)"

patterns-established:
  - "This closes the cross-surface error-handling consistency pattern across all 3 AI Copilot entry points for AI-02"

# Metrics
duration: 35min
completed: 2026-08-02
---

# Phase 13 Plan 03: AI Copilot Chat Bubble Error-Handling Finalization Summary

**All 4 confirm handlers and `sendMessage` in `AICopilotBubble.tsx` now catch failures and surface the real `ApiClientError` message inline, with confirm handlers rethrowing so `ConfirmView`/`TaskConfirmView` never show a false success checkmark on a failed backend call -- finalizing cross-surface error-handling consistency across all 3 AI Copilot entry points.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-02T20:30:00Z (approx)
- **Completed:** 2026-08-02T21:05:00Z (approx)
- **Tasks:** 2 planned (1 code task + 1 verification-only task), both complete
- **Files modified:** 2 (1 code, 1 deferred-items log)

## Accomplishments

- Imported `ApiClientError` from `@/lib/api/client` into `AICopilotBubble.tsx`
- `handleConfirmTasks`, `handleConfirmWorkOrders`, `handleConfirmGuestRequests`, `handleConfirmAssignments` all wrapped in try/catch: on failure, append an inline AI chat bubble with `err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.'`, then rethrow -- preserving the `ConfirmView`/`TaskConfirmView` reject contract (both components were left completely untouched, as the plan required)
- `sendMessage`'s previously-bare `catch { ... }` (always showing the same hardcoded string) now catches `err` and surfaces the real `ApiClientError.message` when available
- Live browser verification (GM, Sonesta ES Suites Fossil Creek, real dev Supabase project) proved:
  - Client fast-path ("101 needs towels") still resolves instantly with zero network call and a working task preview
  - Confirm & Create on that preview succeeded via a genuine `POST /v1/ai/tasks/confirm` (200) call -- pre-existing success behavior unaffected
  - A message requiring a real backend round trip ("Multiple rooms need turndown service before tonight's VIP arrivals") correctly triggered a genuine `/v1/ai/copilot/chat` network call (not a client fast-path hit)
  - Mocking a 503 on `/v1/ai/copilot/chat` produced the real `ApiClientError` message inline ("AI service temporarily unavailable. Please try again later.") instead of a fixed generic string
  - Mocking a 500 on `/v1/ai/tasks/confirm` after a fast-path task preview: inline error bubble appeared with the real message ("Database temporarily unavailable. Please try again."), and the "Confirm & Create" button correctly remained in its clickable, non-confirmed state -- no false "✓ ... created" checkmark
  - Unmocking and clicking "Confirm & Create" again on the same still-open preview succeeded via a real `200` response and correctly flipped to the "1 task created." checkmark -- proving the button was genuinely retryable, not stuck
  - Full regression pass: off-topic short-circuit ("what's the weather") fired `OFF_TOPIC_RESPONSE` with zero network call; SOP Q&A ("how do I clean a bathroom properly") returned the canned "No SOPs have been uploaded yet" message via a genuine `200` `/v1/ai/copilot/chat` call
- Full API smoke suite: **257/257 passed**, unchanged from 13-02's baseline (this plan touches no backend code)
- `apps/web` type-check: clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Surface real confirm-flow and send-message errors inline without breaking the confirm/reject contract** - `01995635` (fix)
2. **Task 2: Full regression verification of unaffected chat-page behavior and final cross-surface consistency check** - `0229ae4f` (docs, deferred-items.md log; verification itself produced no code changes)

## Files Created/Modified

- `apps/web/components/ai/AICopilotBubble.tsx` - all 4 confirm handlers wrapped in try/catch/rethrow appending an inline `ApiClientError`-sourced error bubble; `sendMessage`'s catch now surfaces `err.message` instead of a fixed string
- `.planning/phases/13-ai-copilot-reliability/deferred-items.md` - logged a third live reproduction (via the "At-risk rooms today" quick-action chip) of the pre-existing, already-deferred `ai_interactions.interaction_type` "general"-intent CHECK-constraint drift documented by 13-02

## Decisions Made

- Confirm handlers rethrow the caught error after appending the inline chat bubble, rather than swallowing it, because `ConfirmView`/`TaskConfirmView`'s existing `try { await onConfirm(); setConfirmed(true) } finally { setConfirming(false) }` (deliberately left untouched per the plan) depends on the rejection propagating to correctly skip `setConfirmed(true)`. Swallowing the error would have produced exactly the false-success-checkmark bug class this phase exists to eliminate, at the moment the inline bubble said the action failed.
- The "At-risk rooms today" quick-action 400 (root cause: the pre-existing `general`-intent CHECK-constraint drift already documented in 13-02's `deferred-items.md`) was confirmed live but not fixed here -- it is a backend/database issue, entirely outside this plan's declared file scope (`AICopilotBubble.tsx` only), and is the same known, already-deferred bug rather than a new regression introduced by this plan's catch-block changes. Logged as a third reproduction for traceability rather than silently observed and dropped.
- The real backend round trip for `task_creation` intent ("Multiple rooms need turndown service...") 500'd locally because `extract_task_details` requires a live LLM call and no local `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` exists per CLAUDE.md's documented environment constraint -- this is expected and, notably, is exactly the scenario Task 1's fix improves: the inline bubble now shows the real backend detail ("AI service temporarily unavailable. Please try again later.") instead of the old fixed generic string, in both the mocked-503 and genuine-500 cases.

## Deviations from Plan

None - plan executed exactly as written. The one out-of-scope discovery (the "general"-intent CHECK-constraint 400 via a new entry point) was logged to `deferred-items.md`, not fixed, per the Rule 1-3 scope boundary (only fix issues directly caused by this plan's own changes) and consistent with 13-02's identical handling of the same underlying drift.

## Issues Encountered

- The chat page's `task_creation` intent (non-fast-path messages) requires a live LLM call to `extract_task_details`, which 500s locally with no `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` configured -- a known, pre-existing, credential-blocked environment limitation (CLAUDE.md's "Current Scope" section), not a code defect. This did not block verification: it provided a genuine, non-mocked real-500 case to prove `sendMessage`'s new error-surfacing behavior end-to-end (both the mocked-503 and the real-500 cases rendered the identical, correct real backend message).
- Confirmed (not fixed) a third live reproduction of the `ai_interactions.interaction_type` "general"-intent CHECK-constraint drift already documented in 13-02's `deferred-items.md`, this time via the "At-risk rooms today" quick-action chip in the main copilot bubble rather than a typed message. Logged in `deferred-items.md`, not fixed -- same scope boundary as 13-02.

## User Setup Required

None - no external service configuration required. No new migrations, no new backend code.

## Next Phase Readiness

- This was the final plan in Phase 13 (AI Copilot Reliability). All 3 AI Copilot entry points (chat bubble here, housekeeping assignment sidebar in 13-01, engineering triage notice in 13-02) now share the identical `catch (err) => err instanceof ApiClientError ? err.message : <localized generic fallback>` error-handling shape, surfaced visibly in-context (inline chat bubble / toast / notice box respectively -- an intentional, pre-existing per-surface presentation difference, not an inconsistency), with loading state always reset in a `finally` block, and (for confirm-style flows) the error rethrown so parent success-state logic correctly stays in its failed/retryable state.
- Full API smoke suite: 257/257 passed (unchanged baseline, no backend files touched). `apps/web` type-check clean.
- Live browser walkthrough confirmed both the new inline-error behavior (including the correct retryable-button-state-on-failure check) and zero regression to pre-existing chat-page behavior (fast-path, off-topic, task-creation round trip, SOP Q&A, quick-action).
- One item remains logged (not newly introduced, not fixed) in `deferred-items.md`: the broader `ai_interactions.interaction_type` CHECK-constraint drift affecting the `general` fallback intent, now confirmed reproducible from 3 separate entry points across 13-02 and 13-03. A future plan should widen the constraint to cover all `intent_to_log` values actually used in code.
- Phase 13 (AI Copilot Reliability) is now feature-complete: 13-01 (assignment sidebar honesty fix), 13-02 (work-order-triage honesty fix), 13-03 (chat bubble error-handling finalization + cross-surface consistency) all closed.

---
*Phase: 13-ai-copilot-reliability*
*Completed: 2026-08-02*

## Self-Check: PASSED

- FOUND: apps/web/components/ai/AICopilotBubble.tsx
- FOUND: .planning/phases/13-ai-copilot-reliability/deferred-items.md
- FOUND: .planning/phases/13-ai-copilot-reliability/13-03-SUMMARY.md
- FOUND: 01995635, 0229ae4f (both commits present in git log)

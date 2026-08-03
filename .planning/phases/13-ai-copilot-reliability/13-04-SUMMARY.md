---
phase: 13-ai-copilot-reliability
plan: 04
subsystem: ui
tags: [react, nextjs, error-handling, ai-copilot, i18n]

requires:
  - phase: 13-ai-copilot-reliability (13-01, 13-03)
    provides: the AssignmentSidebar.tsx honesty-fix pattern and the AICopilotBubble.tsx inline-error/rethrow pattern this plan replicates onto duplicate surfaces
provides:
  - Assignments tab's "Suggest Assignments with AI" button reads the real suggestion response shape and never fabricates success
  - Dedicated /ai chat page shares the same catch -> ApiClientError.message -> visible-surface -> rethrow-on-confirm pattern as the floating AI Copilot bubble
affects: [13-VERIFICATION.md gap closure, any future AI Copilot UI surface]

tech-stack:
  added: []
  patterns:
    - "Suggestion-only AI endpoints: read data.suggestions/data.message, never invalidate query caches on a read-only response"
    - "Confirm-handler rethrow: catch, append inline error bubble, then rethrow so ConfirmView/TaskConfirmView's try/finally skips the false-success checkmark"

key-files:
  created: []
  modified:
    - apps/web/app/(dashboard)/housekeeping/assignments/page.tsx
    - apps/web/app/(dashboard)/ai/page.tsx
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts

key-decisions:
  - "Replicated 13-01/13-03 patterns verbatim rather than introducing new abstractions, per the plan's own framing as gap-closure, not new design work"
  - "Left ConfirmView/TaskConfirmView untouched, matching 13-03's precedent, even though their try/finally-without-catch shape produces a browser 'pageerror' console entry on a rethrown confirm failure — pre-existing, accepted behavior, not a regression"

patterns-established:
  - "All 4 AI Copilot UI surfaces (AssignmentSidebar, work-order triage, AICopilotBubble, AssignmentsPage, /ai page) now share the identical catch(err) => err instanceof ApiClientError ? err.message : localized-fallback shape"

duration: 25min
completed: 2026-08-02
---

# Phase 13 Plan 04: AI Copilot Reliability Gap Closure Summary

**Applied the already-proven 13-01 (suggestion-honesty) and 13-03 (confirm-rethrow) fix patterns to the two duplicate UI surfaces those plans missed: the Assignments tab's AI button and the dedicated `/ai` full-page chat.**

## Performance

- **Duration:** 25 min
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- `AssignmentsPage`'s `handleAiAutoAssign` now reads `data.suggestions`/`data.message` instead of nonexistent `assignments_created`/`count` keys, drops the false cache invalidation on a read-only endpoint, and standardizes on `ApiClientError`
- `app/(dashboard)/ai/page.tsx`'s `sendMessage` and all 4 confirm handlers now surface real `ApiClientError` messages inline and rethrow on confirm failure so the button reverts to a retryable state instead of showing a false success checkmark
- Live browser verification (Playwright, GM login against the real dev Supabase project) proved both the success and mocked-failure paths on both surfaces, plus zero regression on 6 adjacent behaviors

## Task Commits

1. **Task 1: Apply 13-01 pattern to Assignments tab** - `307d2e54` (fix)
2. **Task 2: Apply 13-03 pattern to /ai page** - `57d6c658` (fix)
3. **Task 3: Full regression check + cross-surface consistency confirmation** - verification only, no code changes, no commit

**Plan metadata:** (this file)

## Files Created/Modified
- `apps/web/app/(dashboard)/housekeeping/assignments/page.tsx` - `handleAiAutoAssign` reads real suggestion shape, catches via `ApiClientError`, no longer invalidates cache on a read-only response
- `apps/web/app/(dashboard)/ai/page.tsx` - `sendMessage` catch surfaces real error detail; all 4 confirm handlers wrap `aiApi.confirmX` in try/catch, append an inline error bubble, and rethrow
- `apps/web/i18n/locales/en.ts` - `assignmentsPage.autoAssignWithAi` renamed to "Suggest Assignments with AI", `noRoomsNeedWork` added, unused `aiSuccessGeneric` removed
- `apps/web/i18n/locales/es.ts` - Spanish equivalents of the above

## Decisions Made
- Removed the now-unused `useQueryClient` import/hook from `assignments/page.tsx` since the cache invalidation it powered was deleted (nothing else in the file used it)
- Did not modify `ConfirmView`/`TaskConfirmView` in `/ai/page.tsx`, matching the plan's explicit instruction and the 13-03 precedent on `AICopilotBubble.tsx`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None blocking. During live verification, deliberately mocking a confirm failure and observing the rethrow surfaced a browser `pageerror` console entry (unhandled promise rejection) — this is inherent to `ConfirmView`'s pre-existing `try { await onConfirm(); setDone(true) } finally { setSaving(false) }` shape (no catch), which is identical to the already-approved 13-03 pattern on `AICopilotBubble.tsx` and explicitly out of scope to change. Not treated as a bug.

Also reconfirmed (not fixed, 4th occurrence) the already-deferred `ai_interactions.interaction_type` CHECK-constraint drift on the "At-risk rooms today" quick-action chip (400, Postgres code 23514) — this time the fix in this plan correctly surfaced the real backend detail ("Database request failed. Please check the request and try again.") inline instead of the old hardcoded generic string, demonstrating the fix works as intended even against a known unrelated backend bug. Logged previously in `deferred-items.md`; out of this plan's scope.

## Live Verification (Playwright, GM login, real dev Supabase project)

**Assignments tab (`/housekeeping/assignments`):**
- "Suggest Assignments with AI" button visible with new copy; clicking it produced a toast reading "AI suggested N room(s)" matching the real backend suggestion count
- Mocked a 500 on `/housekeeping/ai-suggest-assignments` — toast correctly showed the real `ApiClientError` message ("Simulated suggest-assignments failure"), not a generic fallback
- Non-regression: date picker "Today" button and "Import from Opera" button still render and are clickable; table did not visibly change after the AI click (nothing persisted)

**Dedicated `/ai` chat page:**
- Client fast-path ("101/102 needs towels") still resolves instantly to a task preview with working "Confirm & Create"
- Off-topic short-circuit still fires with zero network call
- Mocked a 500 on `/ai/tasks/confirm` after a fast-path preview — inline error bubble appeared, "Confirm & Create" remained visible/clickable with no false "N task(s) created." checkmark; unmocking and retrying the same preview succeeded normally
- Mocked a 503 on `/ai/copilot/chat` for a non-fast-path message — inline bubble showed the real backend detail ("AI service temporarily unavailable") instead of a fixed string
- Quick-action chip ("At-risk rooms today") and SOP Q&A ("how do I clean a bathroom" → "No SOPs have been uploaded yet...") both resolved normally with no behavior change
- Zero console errors on all non-error-path (golden-path) scenarios; the mocked-error scenarios produced only the expected network-error/pageerror console entries inherent to the deliberate test setup

**Room Board tab (`AssignmentSidebar.tsx`, untouched by this plan):**
- Spot-checked via "Assign mode" toggle — AI sidebar button still visible and still fires an accurate "AI suggested N room(s)" toast, confirming no regression

**Backend:** `python -m pytest tests/smoke/ -q` — 257/257 passed (unchanged baseline; this plan touched no backend code)

## Next Phase Readiness

Both gaps from `13-VERIFICATION.md` are closed. All 4 AI Copilot UI surfaces (AssignmentSidebar, work-order triage, AICopilotBubble, AssignmentsPage, `/ai` page) now share the identical `catch(err) => err instanceof ApiClientError ? err.message : localized fallback` shape, surfaced per-surface (toast / notice box / inline chat bubble), with loading state reset in `finally` and confirm-style flows rethrowing so parent success-state logic correctly stays failed/retryable on error. Phase 13 (AI Copilot Reliability) is ready to close.

---
*Phase: 13-ai-copilot-reliability*
*Completed: 2026-08-02*

## Self-Check: PASSED

- FOUND: apps/web/app/(dashboard)/housekeeping/assignments/page.tsx
- FOUND: apps/web/app/(dashboard)/ai/page.tsx
- FOUND: commit 307d2e54
- FOUND: commit 57d6c658

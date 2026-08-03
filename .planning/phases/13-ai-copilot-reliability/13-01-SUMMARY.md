---
phase: 13-ai-copilot-reliability
plan: 01
subsystem: ai
tags: [react-query, i18n, postgrest, fastapi, supabase]

# Dependency graph
requires:
  - phase: 12-logbook-and-lost-found-data-integrity
    provides: no direct code dependency; continues the v1.2 Stabilization Pass bug-fix sequence
provides:
  - "AssignmentSidebar.tsx reads the real /housekeeping/ai-suggest-assignments response shape (data.suggestions/data.message) instead of nonexistent assignments_created/count keys"
  - "Canonical ApiClientError catch-block pattern for later 13-02/13-03 plans to replicate"
  - "Backend regression test locking the ai-suggest-assignments response contract (has-rooms, no-rooms, no-staff)"
  - "Fixed a real PGRST200 crash in the endpoint's no-shift-records fallback (user_roles -> user_profiles embed had no FK Postgrest could resolve)"
affects: [13-02, 13-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "catch (err) { toast.error(err instanceof ApiClientError ? err.message : t('...failure')) } — canonical AI-surface error handling for 13-02/13-03"
    - "Two-step fetch (user_roles then user_profiles by .in_('id', ids)) instead of embedding, matching routers/staff.py::list_staff — required whenever Postgrest can't auto-resolve a user_roles->user_profiles relationship"

key-files:
  created:
    - apps/api/tests/smoke/test_ai_suggest_assignments.py
  modified:
    - apps/web/components/housekeeping/AssignmentSidebar.tsx
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts
    - apps/api/routers/housekeeping.py

key-decisions:
  - "Removed the three query-cache invalidations on the AI-suggest success path since the endpoint is read-only and never persists — invalidating implied a completed action that never happened"
  - "Kept noRoomsNeedWork as a translated fallback string only; the primary empty-state message is always sourced from the backend's own data.message so the 'no rooms' vs 'no staff' distinction is never silently collapsed"
  - "Fixed the discovered PGRST200 crash by following the existing two-step fetch pattern in routers/staff.py::list_staff rather than restructuring the query differently, keeping the fix minimal and consistent with codebase convention"

patterns-established:
  - "AI-surface toast error handling: err instanceof ApiClientError ? err.message : localized fallback"

# Metrics
duration: 30min
completed: 2026-08-02
---

# Phase 13 Plan 01: AI Assignment Sidebar Honesty Fix Summary

**Fixed AssignmentSidebar.tsx's fabricated-success bug by reading the real `data.suggestions`/`data.message` response shape, and fixed a real backend PGRST200 crash discovered live in the no-staff fallback path.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-08-02T18:35:00-05:00 (approx)
- **Completed:** 2026-08-02T19:04:00-05:00
- **Tasks:** 2 planned (+ 1 auto-fixed deviation)
- **Files modified:** 4 (1 created, 3 modified for planned tasks; 1 additional modified for the deviation fix)

## Accomplishments

- `AssignmentSidebar.tsx::handleAiAutoAssign` no longer reads the nonexistent `assignments_created`/`count` keys — it now reads `data.suggestions`, sums `room_count`, and shows an accurate toast (`"AI suggested {{count}} room(s)."`)
- Zero-suggestion states are now honest and scenario-specific: `toast.info(data.message)` renders the backend's own distinct string for "no rooms need assignment" vs. "no active housekeepers found" — never a fake success and never a single collapsed message
- Removed the three `queryClient.invalidateQueries(...)` calls on the success path since the endpoint never writes to the database — no more implying a persisted change that didn't happen
- Standardized error handling on `err instanceof ApiClientError ? err.message : t('...failure')`, the pattern 13-02/13-03 will replicate
- Button and locale copy (EN/ES) renamed from "Auto-Assign with AI" to "Suggest Assignments with AI"; dropped the now-unreferenced `successGeneric` key
- New `test_ai_suggest_assignments.py` (3 tests) locks the `/housekeeping/ai-suggest-assignments` contract: suggestions shape with `room_count`/`total_minutes`, the exact "no rooms" empty-state response, and the exact "no staff" empty-state response
- **Found and fixed a real production bug during live verification:** the no-shift-records fallback (`user_roles` embedding `user_profiles`) 422'd with `PGRST200` on every real hit, because Postgrest has no FK it can use to resolve that embed — meaning the "no active housekeepers" message could never actually be reached in practice, and the has-rooms success path was unreachable whenever this fallback fired. Fixed with the two-step fetch pattern already used in `routers/staff.py::list_staff`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix handleAiAutoAssign response parsing and make the UX honestly suggestion-only** - `e6c43489` (fix)
2. **Task 2: Add backend regression test locking the ai-suggest-assignments response contract** - `5e15741b` (test)
3. **[Deviation, Rule 1] Fix PGRST200 crash in ai-suggest-assignments no-staff fallback** - `e2ee47e9` (fix)

_No plan metadata commit exists as a separate hash; this SUMMARY.md + STATE.md update will be committed together as the final metadata commit._

## Files Created/Modified

- `apps/web/components/housekeeping/AssignmentSidebar.tsx` - `handleAiAutoAssign` reads `data.suggestions`/`data.message`, drops cache invalidation, standardizes error handling on `ApiClientError`
- `apps/web/i18n/locales/en.ts` - `assignmentSidebar` copy updated to suggestion-only language, added `noRoomsNeedWork`, removed `successGeneric`
- `apps/web/i18n/locales/es.ts` - Spanish equivalent of the above
- `apps/api/tests/smoke/test_ai_suggest_assignments.py` - 3 new tests locking the response contract (has-rooms, no-rooms, no-staff)
- `apps/api/routers/housekeeping.py` - `suggest_assignments`'s no-shift fallback now batch-fetches `user_profiles` by id instead of embedding them off `user_roles` (fixes a live PGRST200 crash)

## Decisions Made

- Cache invalidation removed entirely from the AI-suggest success path rather than kept for "future confirm flow" — the endpoint is unambiguously read-only today (confirmed no `.update()`/`.upsert()` calls in `housekeeping.py:974-1182`), so invalidating implied a false persisted change.
- The "no rooms" fallback locale string (`noRoomsNeedWork`) is intentionally a rare-case fallback, not the primary message — the primary source of truth is always the backend's `data.message`, preserving the "nothing to do" vs. "no staff" distinction end-to-end.
- The PGRST200 fix followed the exact two-step fetch pattern already established in `routers/staff.py::list_staff` rather than inventing a new approach, keeping the codebase's data-access convention consistent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed PGRST200 crash in ai-suggest-assignments no-staff fallback**
- **Found during:** Live browser verification of Task 1 (required by the plan's own `<verify>` section)
- **Issue:** `suggest_assignments`'s fallback query (`apps/api/routers/housekeeping.py:1047-1054`, pre-existing, not touched by this plan's Task 1/2 file list) did `supabase.table("user_roles").select("user_id, user_profiles(full_name, preferred_name)")` — Postgrest has no direct FK relationship between `user_roles` and `user_profiles` it can auto-resolve for that embed, so every real hit of this code path returned a 422 `PGRST200` ("Could not find a relationship... in the schema cache") instead of the intended housekeeper list or the "no active housekeepers" message. This silently broke exactly the scenario the plan's must-haves require to be honest (the "no staff" empty state), and also blocked verifying the has-rooms success path when housekeepers came from the fallback rather than `shift_assignments`.
- **Fix:** Replaced the embedded select with the two-step fetch pattern already used in `routers/staff.py::list_staff` — fetch `user_roles` for `user_id` only, then batch-fetch `user_profiles` separately via `.in_("id", user_ids)`, and map profiles back by id.
- **Files modified:** `apps/api/routers/housekeeping.py`
- **Verification:** Reproduced the crash live against the real dev Supabase project (direct query via `postgrest.exceptions.APIError` isolated the exact failing embed); confirmed the fix resolves it with the same real queries; confirmed live via browser + Network tab that the endpoint now returns 200 with real suggestions (47 rooms across 3 housekeepers for the current test hotel) and the frontend toast (`"AI suggested 47 rooms."`) matches exactly; full API smoke suite (254 tests) still green.
- **Committed in:** `e2ee47e9`

---

**Total deviations:** 1 auto-fixed (1 bug fix, Rule 1)
**Impact on plan:** Necessary for the plan's own success criteria — without this fix, the "no active housekeepers" honest message and the has-rooms success toast could never actually be exercised against the real backend for any hotel relying on the fallback path. No scope creep: fix was isolated to the single broken query, following an existing codebase pattern.

## Issues Encountered

- The local dev API server (`:8003`) was running stale/zombie Python processes from a prior session (predating this plan's changes) that masked whether `--reload` had picked up the `housekeeping.py` fix — matches a previously-documented environment gotcha (see STATE.md Phase 6 06-05 notes). Killed the stale processes and restarted `uvicorn --reload` fresh; confirmed the running code matched the file on disk before re-verifying.
- The unrelated port :8000 turned out to be occupied by a completely different (non-PatelRep) FastAPI app; the actual PatelRep API dev server runs on :8003 per `apps/web/.env.local`'s `NEXT_PUBLIC_API_URL`. Noted for anyone else verifying this plan locally.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The `ApiClientError`-based catch-block pattern established in Task 1 is ready for 13-02/13-03 to replicate on AI-01's sibling surfaces per AI-02's cross-surface consistency requirement.
- `apps/web` type-check clean; `apps/api` full smoke suite green (254/254, up from 251 baseline + 3 new tests); live browser walkthrough confirmed the has-rooms success path and the real-error-surfaces path end-to-end against the actual dev backend and database.
- Not independently re-verified live: the "zero rooms need assignment" and "no active housekeepers" empty-state toasts, since the current dev/test hotel (Sonesta ES Suites Fort Worth Fossil Creek) has 47 real dirty/pickup rooms and 3 active housekeepers — reproducing either empty state live would require mutating real dev data, which was avoided. Both scenarios are locked by `test_ai_suggest_assignments.py`'s exact-response-contract assertions instead.

---
*Phase: 13-ai-copilot-reliability*
*Completed: 2026-08-02*

## Self-Check: PASSED

- FOUND: apps/api/tests/smoke/test_ai_suggest_assignments.py
- FOUND: apps/web/components/housekeeping/AssignmentSidebar.tsx
- FOUND: .planning/phases/13-ai-copilot-reliability/13-01-SUMMARY.md
- FOUND: e6c43489, 5e15741b, e2ee47e9 (all commits present in git log)

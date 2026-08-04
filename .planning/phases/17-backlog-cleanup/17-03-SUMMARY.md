---
phase: 17-backlog-cleanup
plan: 03
subsystem: ui
tags: [react-query, error-handling, opera-integration, nextjs]

requires: []
provides:
  - "Opera status-fetch error block surfaces real backend detail (403 pilot-gate message, connectivity errors, etc.) instead of a hardcoded generic string"
affects: [17-backlog-cleanup]

tech-stack:
  added: []
  patterns:
    - "err.message || fallback pattern applied uniformly across all 5 Opera error-handling call sites in integrations/page.tsx (4 mutations + 1 query)"

key-files:
  created: []
  modified:
    - "apps/web/app/(dashboard)/settings/integrations/page.tsx"

key-decisions:
  - "No backend change needed - integrations.py already returns specific detail strings; only the frontend's statusQuery.isError block was discarding them"

patterns-established:
  - "Query-error rendering should mirror the same (err as any)?.message || fallback pattern already used by this file's mutations, for consistency across all error surfaces in one component"

duration: 15min
completed: 2026-08-04
---

# Phase 17 Plan 03: Opera Status-Fetch Error Copy Summary

**Opera integration status-fetch error block now surfaces the real backend error detail (e.g. "Opera pilot not enabled for this hotel") instead of a hardcoded generic string, matching the pattern already used by the file's 4 mutations.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-08-04T07:18:30Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- `statusQuery.isError` block now renders `(statusQuery.error as any)?.message || 'Failed to load Opera status.'`, closing the Opera half of UX-03 (ROADMAP Phase 17 success criterion 3).
- Verified live via a Playwright script driving the real dev server (localhost:3000/8003) with a real GM login against the shared dev Supabase project: a mocked 403 pilot-gate response rendered the exact real backend string "Opera pilot not enabled for this hotel" in place of the old generic text.

## Task Commits

1. **Task 1: Surface the real status-fetch error instead of a hardcoded string** - `35497d94` (fix)

**Plan metadata:** (this commit, docs)

## Files Created/Modified
- `apps/web/app/(dashboard)/settings/integrations/page.tsx` - `statusQuery.isError` block now surfaces `(statusQuery.error as any)?.message` with the old generic string retained only as a fallback, mirroring `connectMutation`/`syncMutation`/`testMutation`/`disconnectMutation`'s existing pattern in the same file.

## Decisions Made
None - followed plan as specified.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
During live Playwright verification, the file's edit was found reverted back to the original hardcoded string on a re-read immediately before the browser check (npm's file-watcher/Turbopack HMR churn in this session — same class of environment noise documented in prior phase summaries, e.g. stale dev-server gotchas in Phase 6/13). Re-applied the identical edit, verified via `git diff` that it held, and committed immediately to lock it in before running the browser check. No code-logic issue — the fix itself was correct on the first attempt.

Separately, the plan's stated fallback scenario ("if the backend error has no message for some reason, the generic string still shows") could not be triggered to render the literal string "Failed to load Opera status." through the real API client: `lib/api/client.ts`'s `toFriendlyError()` always returns a non-empty string (defaulting to "Something went wrong. Please try again." when no detail is present), so `(statusQuery.error as any)?.message` is never actually falsy for errors that pass through this client. This is not a regression — the identical `err.message || fallback` pattern in this file's 4 pre-existing mutations has the same characteristic, so the new code is consistent with established behavior; the fallback branch is defensive (guards against `statusQuery.error` being some other non-`ApiClientError` shape) rather than reachable in the current single-client architecture.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Opera half of UX-03 is closed. No blockers for subsequent Phase 17 plans.

---
*Phase: 17-backlog-cleanup*
*Completed: 2026-08-04*

## Self-Check: PASSED
- FOUND: apps/web/app/(dashboard)/settings/integrations/page.tsx
- FOUND: commit 35497d94
- FOUND: .planning/phases/17-backlog-cleanup/17-03-SUMMARY.md

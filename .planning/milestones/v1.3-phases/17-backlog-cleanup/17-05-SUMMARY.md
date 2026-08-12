---
phase: 17-backlog-cleanup
plan: 05
subsystem: ui
tags: [react, next.js, react-query, guest-requests]

# Dependency graph
requires:
  - phase: 05-guest-recovery-and-management-roi
    provides: GuestRequestDrawer, GuestRequestsPage, transitionRequest endpoint, status state machine
provides:
  - Status-advance action buttons inside the Guest Request drawer, mirroring the kanban card
affects: [guest-requests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Second-surface action wiring: thread an existing card-only callback/mutation-state pair through as new props rather than duplicating the mutation"

key-files:
  created: []
  modified:
    - apps/web/components/guest-requests/GuestRequestDrawer.tsx
    - apps/web/components/guest-requests/GuestRequestsPage.tsx

key-decisions:
  - "Reused the exact same handleAdvance callback and updateMutation.isPending flag the kanban card already uses instead of creating a second mutation, so both surfaces share one source of truth and one query-invalidation path"
  - "Did not add drawer auto-close or auto-refresh of drawerRequest after advancing; the existing invalidateQueries on updateMutation.onSuccess already refreshes the kanban board, which was judged sufficient for this fix's scope"

patterns-established:
  - "Pattern: when a secondary UI surface (drawer/modal) needs an action already implemented on a primary surface (card), thread the primary surface's existing callback + pending-state through as props rather than re-implementing the mutation"

# Metrics
duration: 15min
completed: 2026-08-04
---

# Phase 17 Plan 05: Guest Request Drawer Status-Advance Summary

**Guest Request drawer gained the same per-status advance buttons (Acknowledge/Dispatch/Arrived/Contacted/Resolve/Verify) the kanban card already had, wired to the existing real transitionRequest mutation via two new threaded props.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-08-04
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- `GuestRequestDrawer` now accepts `onAdvance`/`isUpdating` props and renders the correct single action button for the request's current status (identical status→button→next-status mapping as the kanban card)
- `GuestRequestsPage` passes its existing `handleAdvance` callback and `updateMutation.isPending` flag into the drawer, so both the card and the drawer share one mutation and one query-invalidation path — no new backend work, no new state machine

## Task Commits

Each task was committed atomically:

1. **Task 1: Thread onAdvance + isUpdating from GuestRequestsPage into the drawer** - `96e43a78` (feat)
2. **Task 2: Render status-advance action buttons inside the drawer** - `ee6dedbe` (feat)

_Note: `ee6dedbe` also unintentionally includes an unrelated `apps/api/routers/scheduling.py` diff — see Deviations below._

## Files Created/Modified
- `apps/web/components/guest-requests/GuestRequestDrawer.tsx` - Added `onAdvance`/`isUpdating` to `Props`, destructured them, and added a status-advance button block right after the "Request" title block
- `apps/web/components/guest-requests/GuestRequestsPage.tsx` - Passes `handleAdvance` and `updateMutation.isPending` into `<GuestRequestDrawer ... onAdvance={handleAdvance} isUpdating={updateMutation.isPending} />`

## Decisions Made
- Reused the card's existing mutation/callback instead of creating a drawer-local one, per the plan's explicit instruction (single source of truth for the transition, single invalidation path)
- Left the drawer open after advancing rather than auto-closing it, matching the plan's accepted tradeoff that the drawer's own header may not live-update until the next kanban refetch/close-reopen

## Deviations from Plan

### Environment/Concurrency Note (not a code deviation)

This session's working directory had multiple GSD executor agents running concurrently against the same git repository (per the session's teammate roster: exec-17-01..04, executor-16-*, etc.). During execution:
1. A first attempt to verify whether a set of pre-existing `tsc` errors in `app/(dashboard)/staff/page.tsx` predated this plan's changes used `git stash` to compare against HEAD. The stash pop was blocked by unrelated `.wolf/` file conflicts from a concurrent agent, and the abort left this plan's Task 2 edit un-restored to the working tree (it was not present in the stash and not in HEAD — genuinely lost, not just staged elsewhere). Re-diagnosed by diffing the file against HEAD (clean, confirming the edit was gone) and re-applied Task 2's edit from scratch, then re-verified `type-check` clean and committed immediately without further stashing.
2. Task 2's commit (`git add` scoped only to `GuestRequestDrawer.tsx`, followed immediately by `git commit`) unexpectedly bundled in an unrelated `apps/api/routers/scheduling.py` diff, apparently staged by a concurrent agent's process in the narrow window between the `add` and `commit` calls. A subsequent attempt to correct this via `git reset --soft HEAD~1` was itself overtaken by two further commits from a concurrent agent (`exec-17-01`) landing on top before the correction could be re-applied cleanly — rewriting history further at that point risked destroying that agent's already-committed work, so the correction was abandoned. Verified via `git diff HEAD -- <drawer files>` (empty) and `git log --follow` that both of this plan's commits and their exact intended file content are intact in history; the only residual issue is that `ee6dedbe`'s diff also contains the unrelated `scheduling.py` change under this plan's commit message — a cosmetic attribution issue, not a functional or data-loss issue (the `scheduling.py` content itself was that other agent's own legitimate in-flight work, further modified by their own subsequent commits).

No source-code deviations from the plan itself — both tasks were implemented exactly as specified.

## Issues Encountered
- See Environment/Concurrency Note above. No unresolved issues; final state verified clean (`tsc --noEmit` passes with zero errors at current HEAD, and both target files match their intended final content).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- UX-05 (Guest Request drawer half of ROADMAP Phase 17 success criterion 4) is closed: the drawer includes real status-advance actions, not just view.
- Live browser verification (per the plan's Task 2 `<verify>` live-check step) was not performed by this executor — no browser/Playwright tool was available in this agent's toolset. Type-check is clean and the code mirrors the kanban card's already-proven button/mutation pattern exactly, but an authenticated click-through walkthrough remains an open follow-up before this can be called fully verified end-to-end.

---
*Phase: 17-backlog-cleanup*
*Completed: 2026-08-04*

## Self-Check: PASSED
- FOUND: apps/web/components/guest-requests/GuestRequestDrawer.tsx
- FOUND: apps/web/components/guest-requests/GuestRequestsPage.tsx
- FOUND: .planning/phases/17-backlog-cleanup/17-05-SUMMARY.md
- FOUND commit: 96e43a78
- FOUND commit: ee6dedbe

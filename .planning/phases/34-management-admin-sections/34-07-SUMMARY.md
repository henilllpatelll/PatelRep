---
phase: 34-management-admin-sections
plan: 07
subsystem: ui
tags: [react-query, i18n, header, dashboard, notifications, late-checkout]

# Dependency graph
requires:
  - phase: 34-management-admin-sections
    provides: "34-01 i18n foundation - header.notificationsLoadError key (consumed read-only)"
provides:
  - "Header.tsx notification dropdown gains loading skeleton + error+retry states inside the existing shell-flag redesigned region"
  - "FrontDeskDashboard.tsx late-checkout panel confirmed complete (loading/error/empty) and a real double-submit race in LateCheckoutRow fixed"
affects: [34-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "notificationsData query destructuring extended with isLoading/isError/refetch, gated on the existing redesigned prop, mirroring the pattern already used across Phase 33 sections"

key-files:
  created: []
  modified:
    - apps/web/components/shared/Header.tsx
    - apps/web/components/dashboard/FrontDeskDashboard.tsx

key-decisions:
  - "Notifications dropdown loading state uses a hand-built 3-row skeleton (Skeleton primitive for the two text lines, plain div for the unread dot) rather than a generic Skeleton card, to closely match the actual notification-item shape inside the ~360px-tall dropdown"
  - "Error state uses StateBlock with a className='py-8' override (twMerge correctly overrides the default py-12) for a tighter fit inside the compact dropdown"
  - "Late-checkout panel's loading/error/empty states and LateCheckoutRow's resolving-gated Confirm/Deny buttons were already correct and complete - verification only, no locale-key gap found"
  - "Found and fixed one real bug outside the plan's explicit checklist but within Task 2's stated scope: LateCheckoutRow's Cancel (X) button was not disabled during an in-flight mutation, allowing a user to cancel back to idle mode mid-request and re-trigger approve/deny on the same row (double-submit race). Fixed minimally with disabled={resolving}, no mutation logic changed"

patterns-established: []

# Metrics
duration: 25min
completed: 2026-08-18
---

# Phase 34 Plan 07: Notifications + Late Checkout (piggyback-flag sections) Summary

**Header's notification dropdown gains a loading skeleton and StateBlock error+retry (previously entirely absent) inside the existing `shell`-flag-gated region; FrontDeskDashboard's late-checkout panel confirmed already complete, with one real double-submit race found and fixed in LateCheckoutRow's Cancel button.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-18T21:15:00Z
- **Completed:** 2026-08-18T21:40:00Z
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- Header.tsx's notification dropdown `notificationsData` query now surfaces loading (3-row skeleton) and error (`StateBlock` + retry using `header.notificationsLoadError`) states, both gated on the pre-existing `redesigned` prop; the badge-count query (`unreadNotificationsData`) and the dropdown's empty case were left byte-unchanged
- FrontDeskDashboard.tsx's late-checkout panel verified line-by-line against the plan's documented shape (query destructuring, `SkeletonRow v2` loading, `StateBlock` error+refetch, `StateBlock` empty) — confirmed already complete, no locale-key or wiring gap existed
- Found and fixed a genuine correctness gap in `LateCheckoutRow`: the Cancel (X) icon button was not disabled while a mutation was in flight (`resolving === true`), meaning a user could cancel back to idle mode mid-request and click Approve/Deny again on the same row, firing a second mutation for the same late-checkout request

## Task Commits

Each task was committed atomically:

1. **Task 1: Header.tsx notification dropdown — add loading skeleton + error+retry to notificationsData** - `8c3b4e4e` (feat)
2. **Task 2: FrontDeskDashboard.tsx late-checkout panel — verify + close gap in resolving-state** - `edf70364` (fix)

**Plan metadata:** (this commit)

## Files Created/Modified
- `apps/web/components/shared/Header.tsx` - Extended `notificationsData` query destructuring with `isLoading`/`isError`/`refetch`; added a `redesigned`-gated 3-row skeleton (loading) and `StateBlock` error+retry (error) inside the dropdown's `max-h-[360px]` content region, both rendered above the existing (unchanged) empty case and list; imported `StateBlock`/`Skeleton`
- `apps/web/components/dashboard/FrontDeskDashboard.tsx` - `LateCheckoutRow`'s Cancel `IconButton` (in both the approving and denying inline panels) now receives `disabled={resolving}`, closing a double-submit race; no other line in the file changed

## Decisions Made
- Loading skeleton built by hand (Skeleton primitive for text lines + a plain dot div) rather than reusing a generic card skeleton, to match the notification-item's actual visual shape at dropdown scale
- StateBlock's default `py-12` padding overridden to `py-8` via `className` (confirmed via `cn`'s `twMerge` that this correctly wins, not just appends) for a tighter fit in the ~360px dropdown
- The late-checkout panel itself needed zero changes — the plan's own text flagged this as "verification, not a rebuild," and that held true for every piece except the Cancel-button gap, which was in scope per Task 2's explicit instruction to fix `resolving`-gating gaps found in `LateCheckoutRow`'s JSX

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] LateCheckoutRow Cancel button not disabled during in-flight mutation**
- **Found during:** Task 2 (FrontDeskDashboard.tsx late-checkout panel verification)
- **Issue:** The Confirm/Deny action buttons correctly used `loading={resolving}` (which the shared `Button` component auto-disables via `isDisabled = disabled || loading`), but the adjacent Cancel `IconButton` in both the "approving" and "denying" inline panels had no `resolving` gating at all. A user could click Cancel while a mutation was in flight, which flips `mode` back to `'idle'` — re-exposing the row's Approve/Deny buttons (gated only on `mode === 'idle'`, not on `resolving`) — and click Approve or Deny again on the same request, firing a second `resolveRequest` mutation call before the first one settled.
- **Fix:** Added `disabled={resolving}` to both Cancel `IconButton`s. This closes the loophole at its source (the only path back to idle mode while `resolving` is true) without touching the mutation's trigger logic, success/error handling, or any callback signature.
- **Files modified:** `apps/web/components/dashboard/FrontDeskDashboard.tsx`
- **Verification:** `npm run type-check` and `npm run build` (all 43 routes) both green after the change; `git diff` confirms the change is a 2-line, single-attribute addition confined to `LateCheckoutRow`
- **Committed in:** `edf70364` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix was explicitly anticipated by the plan's own Task 2 instructions ("if resolving is threaded but not actually used to disable the buttons, fix it minimally") and stayed within the plan's stated file/region scope. No scope creep.

## Issues Encountered
- A `npm run build` attempt mid-execution failed with a TypeScript error in `app/(dashboard)/ai/page.tsx` (`Property 'v2' is missing in type '{}'`). Investigated via `git status`: this file is being actively edited by a sibling parallel Phase 34 plan (34-02..34-06), entirely outside this plan's `files_modified` scope (`Header.tsx`, `FrontDeskDashboard.tsx` only). A retry of `npm run build` a short time later succeeded cleanly across all 43 routes, confirming this was a transient collision with the sibling plan's in-flight edit (same class of issue documented in 33-04-SUMMARY.md), not caused by this plan's changes. No file outside this plan's scope was touched to resolve it.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both piggyback-flag sections (Notifications, Late Checkout) are complete for Phase 34's SEC-01b scope
- `Header.tsx` and `FrontDeskDashboard.tsx` are this plan's sole Phase-34 responsibility — no other Phase 34 plan touches either file, so no merge risk with sibling wave-2 plans
- No deferred items specific to this plan's two sections; the late-checkout panel and notification dropdown are both now fully wired with loading/error/empty coverage
- Ready for `34-08` (wave 3, close-out verification) once all wave-2 plans (34-02..34-07) land

---
*Phase: 34-management-admin-sections*
*Completed: 2026-08-18*

## Self-Check: PASSED

- FOUND: apps/web/components/shared/Header.tsx
- FOUND: apps/web/components/dashboard/FrontDeskDashboard.tsx
- FOUND: .planning/phases/34-management-admin-sections/34-07-SUMMARY.md
- FOUND: commit 8c3b4e4e (Task 1)
- FOUND: commit edf70364 (Task 2)

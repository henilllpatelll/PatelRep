---
phase: 36-housekeeping-section-chrome
plan: 02
subsystem: web
tags: [housekeeping, v2-redesign, StateBlock, Skeleton, EmptyState, redesignFlag]

# Dependency graph
requires: ["36-01"]
provides:
  - "housekeeping/page.tsx v2-gated chrome: role-loading guard, SyncBadge-bearing PageHeader, date/shift controls, HousekeeperBar, HousekeeperRoomItem, my-rooms/no-access views all render behind isSectionRedesigned('housekeeping', hotel)"
  - "HousekeeperBar staff-list fetch-failure gap closed with StateBlock error + retry"
  - "HousekeeperMyRoomsView board-query fetch-failure gap closed with stale-data-safe StateBlock error + retry"
affects: [36-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reused the established isSectionRedesigned(sectionKey, hotel) + dataI18nSkip={v2} flag-read pattern from apps/web/app/(dashboard)/engineering/predictions/page.tsx verbatim"
    - "v2-gated fetch-failure StateBlock error, threaded isError/refetch from the same useQuery already powering loading/data — no new query added"
    - "Stale-data-safe error gating for interval-polled queries: isError && !data (not isError alone), so a background refetchInterval failure never replaces an already-rendered list with an error screen"

key-files:
  created: []
  modified:
    - apps/web/app/(dashboard)/housekeeping/page.tsx

key-decisions:
  - "HousekeeperMyRoomsView and SupervisorHousekeepingPage's v2 prop signatures were added in Task 1 (not deferred entirely to Task 2 as the plan's task split implied), because the router already invokes both with v2={v2} in Task 1 and TypeScript errors on an extra prop passed to a zero-arg function component — this is a Rule 3 (blocking issue) auto-fix required for Task 1's own type-check verification to pass. Task 2 then fills in the actual v2-gated body logic inside HousekeeperMyRoomsView exactly as planned."
  - "The plan's literal StateBlock code snippet for HousekeeperMyRoomsView (status={isLoading ? 'loading' : ...}) was not implementable as written: StateBlock's 'loading' status renders its own generic spinner+label, but the plan separately instructs replacing the bespoke skeleton rows with 3 explicit Skeleton variant=\"card\" cards — StateBlock has no slot for custom loading content. Resolved by keeping the isLoading branch outside StateBlock (rendering the 3 Skeleton cards directly) and using StateBlock only for the post-load error/empty/data three-way, preserving the exact stale-data gating logic (isError && !boardData) and the required Skeleton-card conversion."
  - "Typography conversion in HousekeeperRoomItem scoped exactly to the two elements the plan names ('status pill / clean-type' text) — the status pill (text-xs font-medium -> text-xs font-normal) and the clean-type badge (text-[10px] font-semibold -> text-xs font-normal), both v2-gated. The 'waiting for inspection' label (text-xs font-medium) and checkout-time label were left untouched since the plan's action text did not name them and they were not confirmed gaps — flagged here rather than silently expanded, per the non-regression / targeted-change policy."
  - "No custom 20px stat-numeral utility class exists in tailwind.config.ts (only font-display -> var(--font-display) is declared), so 'text-xl font-display font-semibold' (Tailwind's default text-xl = 20px) was used to pin the stat numerals, confirmed against the config rather than inventing a new utility."
  - "SyncBadge confirmed to already use only token-based color (bg-ready maps to var(--ready) via tailwind.config.ts, no bespoke hex/named color) — left completely untouched, matching the plan's explicit 'leave as-is if already token-based' instruction."
  - "The shift <select>'s focus-ring restyle in the v2 path followed the codebase's established focus-visible pattern (components/shared/Sidebar.tsx: focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]) rather than the plan's shorthand 'replace focus:ring-amber-400 with focus-visible:ring-[var(--focus-ring)]', since mixing focus: and focus-visible: pseudo-classes on the same element would create an inconsistent trigger condition between ring width and ring color."

patterns-established: []

# Metrics
duration: ~20min
completed: 2026-08-19
---

# Phase 36 Plan 02: Housekeeping Page Chrome (v2) Summary

**Restyled all six components in `housekeeping/page.tsx` (role router, SyncBadge, HousekeeperBar, HousekeeperRoomItem, HousekeeperMyRoomsView, SupervisorHousekeepingPage) onto the v2 visual system behind a net-new `housekeeping` flag, closing two confirmed loading/error UX gaps (staff-list and my-rooms board fetch failures) with `StateBlock` error states, while `RoomStatusBoard`/`RoomDetailDrawer` render with byte-identical props and flag-off preserves the legacy UI exactly.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-19T05:58Z
- **Tasks:** 2 completed
- **Files modified:** 1

## Accomplishments

- Added `const v2 = isSectionRedesigned('housekeeping', hotel)` in the default-exported `HousekeepingPage` router (reading `hotel` via `useHotelStore`), threaded one prop-hop deep into `HousekeeperMyRoomsView` and `SupervisorHousekeepingPage`, and further one hop into `HousekeeperBar`/`HousekeeperRoomItem` from `SupervisorHousekeepingPage`/`HousekeeperMyRoomsView` respectively — no prop drilled more than one hop past its receiving view.
- Role-loading guard's 3 bespoke `animate-pulse` divs converted to `Skeleton`/`Skeleton variant="card"` in the v2 path; legacy bespoke markup preserved byte-for-byte when `v2` is false.
- No-access branch converted to `EmptyState` in the v2 path; legacy centered `<p>` preserved when `v2` is false.
- `HousekeeperBar`'s staff-list `useQuery` now destructures `isError`/`refetch`; a genuine fetch failure renders `StateBlock status="error"` with `housekeeping.page.assignBar.loadError` + retry (v2 path only) — the pre-existing "No staff / Add staff" empty-copy branch is unchanged and still covers the genuinely-empty (non-error) case in both flag states.
- `HousekeeperMyRoomsView`'s board `useQuery` now destructures `isError`/`refetch`; wrapped the post-load list in `StateBlock` gated on `(isError && !boardData) ? 'error' : myRooms.length === 0 ? 'empty' : null` — a background `refetchInterval` (10s) failure with already-loaded data does NOT flash an error over the existing list, per the Pitfall 3 requirement.
- `HousekeeperRoomItem` gained a `v2` prop; status pill and clean-type badge typography pinned to the UI-SPEC's 12px/regular label role in the v2 path (legacy 500-weight/10px styling preserved when `v2` is false).
- Both `PageHeader` call sites (`HousekeeperMyRoomsView`, `SupervisorHousekeepingPage`) now pass `dataI18nSkip={v2}`.
- My-rooms stat numerals (todo/in-progress/done) pinned to `text-xl font-display font-semibold` (20px/semibold per UI-SPEC) in the v2 path.
- Shift `<select>`'s hardcoded `focus:ring-amber-400` replaced with the established `focus-visible:ring-[var(--focus-ring)]` token pattern in the v2 path.
- `<HousekeeperBar v2={v2} />` and `<HousekeeperRoomItem ... v2={v2} />` call sites explicitly wired — neither prop left defaulting away.
- `RoomStatusBoard`/`RoomDetailDrawer` render calls confirmed byte-identical to pre-plan via `git diff` (zero diff lines touching either call site across both commits).
- `npm run check:frozen-files` — "OK: 7 frozen files unchanged (or allowlisted)" — confirmed after both tasks.
- `npm run type-check` — clean (`tsc --noEmit`, zero errors) — confirmed after both tasks.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire the flag, restyle the role router + HousekeeperBar + HousekeeperRoomItem, close the staff-list error gap** - `ec57be5d` (feat)
2. **Task 2: Restyle HousekeeperMyRoomsView (close the board-query error gap) and SupervisorHousekeepingPage's PageHeader/date-shift chrome** - `9b69ebbc` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `apps/web/app/(dashboard)/housekeeping/page.tsx` — v2-gated chrome across all six components; `RoomStatusBoard`/`RoomDetailDrawer` untouched.

## Decisions Made

See `key-decisions` in frontmatter for the full rationale on each. Summary:
- Added `v2` prop signatures to `HousekeeperMyRoomsView`/`SupervisorHousekeepingPage` in Task 1 (ahead of Task 2's body-logic work) to keep Task 1's own type-check green — a required Rule 3 blocking-issue fix given the plan's task split passes the prop before the receiving component accepts it.
- Substituted a StateBlock-for-post-load-only + explicit-Skeleton-for-loading structure in `HousekeeperMyRoomsView`, since StateBlock has no custom-loading-content slot and the plan required both the generic StateBlock error/empty wiring AND explicit `Skeleton variant="card"` loading rows — these two literal instructions were mutually exclusive if loading state routed through `StateBlock status="loading"`.
- Scoped `HousekeeperRoomItem`'s typography conversion to exactly the two text roles the plan named (status pill, clean-type badge); left the "waiting for inspection" label and checkout-time label untouched as out-of-scope per the plan's literal text.
- Used `text-xl font-display font-semibold` (Tailwind's `text-xl` = 20px) for stat numerals since no dedicated 20px utility exists in `tailwind.config.ts`.
- Left `SyncBadge` fully untouched — confirmed via `tailwind.config.ts` that `bg-ready` already resolves to `var(--ready)`, i.e. no bespoke color to replace.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `HousekeeperMyRoomsView`/`SupervisorHousekeepingPage` needed `v2` prop signatures added a task earlier than the plan's literal task split**
- **Found during:** Task 1 verification (`npm run type-check`)
- **Issue:** Task 1's action text has the router invoke `<HousekeeperMyRoomsView v2={v2} />` and `<SupervisorHousekeepingPage v2={v2} />`, but Task 1's scope (per the plan's own task boundary) doesn't touch either function's signature — those signature changes are described under Task 2. A zero-arg function component invoked with an unexpected prop is a TypeScript error (`Property 'v2' does not exist on type 'IntrinsicAttributes'`), which would fail Task 1's own required `npm run type-check succeeds` verification step.
- **Fix:** Added minimal `{ v2 }: { v2: boolean }` prop signatures to both components as part of Task 1 (unused within the body until Task 2 wires the actual v2-gated logic in). No behavior change — `v2` prop was accepted but not yet read by either component's body until Task 2.
- **Files modified:** `apps/web/app/(dashboard)/housekeeping/page.tsx`
- **Commit:** `ec57be5d` (Task 1), body logic wired in `9b69ebbc` (Task 2)

**2. [Rule 3 - Blocking issue] Plan's literal StateBlock loading-state snippet was not implementable as written**
- **Found during:** Task 2 implementation
- **Issue:** The plan's Task 2 code block routes `isLoading` through `StateBlock status="loading"`, but also separately instructs "Replace the bespoke `animate-pulse` skeleton rows... with `Skeleton` (`variant="card" className="h-20"` × 3) only inside the `v2`-true path." `StateBlock`'s `status="loading"` branch renders its own fixed spinner+label UI (see `apps/web/components/ui/StateBlock.tsx`) with no slot for custom children during loading — the two instructions are mutually exclusive as literally written.
- **Fix:** Kept the `isLoading` check outside `StateBlock` (rendering the 3 explicit `Skeleton variant="card"` rows directly, satisfying the second instruction), and used `StateBlock` only for the subsequent error/empty/data three-way once loading is resolved, preserving the plan's required `(isError && !boardData)` stale-data-safe gating exactly.
- **Files modified:** `apps/web/app/(dashboard)/housekeeping/page.tsx`
- **Commit:** `9b69ebbc`

## Issues Encountered

None beyond the two auto-fixed items above.

## User Setup Required

None — no external service configuration required. This plan does not touch env vars, migrations, or infra.

## Next Phase Readiness

- 36-04 (final wave, wraps up phase-level integration/verification per ROADMAP HSK-01) is unblocked: `housekeeping/page.tsx`'s chrome is fully v2-gated, both confirmed loading/error gaps are closed, and `RoomStatusBoard`/`RoomDetailDrawer`/`RoomCard` remain frozen (confirmed via `check:frozen-files`).
- 36-03 (parallel, same wave) touches `AssignmentSidebar.tsx`/`PredictionPanel.tsx` only — zero file overlap confirmed throughout this plan's execution.
- No blockers or concerns carried forward.

---
*Phase: 36-housekeeping-section-chrome*
*Completed: 2026-08-19*

## Self-Check: PASSED

- FOUND: apps/web/app/(dashboard)/housekeeping/page.tsx
- FOUND: .planning/phases/36-housekeeping-section-chrome/36-02-SUMMARY.md
- FOUND: ec57be5d (Task 1 commit)
- FOUND: 9b69ebbc (Task 2 commit)

---
phase: 34-management-admin-sections
plan: 02
subsystem: ui
tags: [react-i18next, tanstack-query, statblock, skeleton, flag-gating]

# Dependency graph
requires:
  - phase: 34-management-admin-sections
    provides: "34-01's reports.*/managementRoi.* locale namespaces in en.ts/es.ts (frozen, consumed read-only)"
provides:
  - "Reports page (5 tabs) flag-threaded to v2 skeleton/StateBlock loading-empty-error, Pattern 2 (flag read once, redesigned prop threaded to tabs)"
  - "Management ROI page flag-gated directly (single page, no sub-components), stacked per-query StateBlock errors with correct per-query onRetry"
affects: [34-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern 2 flag-thread (parent reads isSectionRedesigned once, threads redesigned/v2 boolean prop to children) applied to a 5-tab page for the first time in Phase 34 (previously 4/3 panels in 33-05)"
    - "Per-query onRetry mapping for stacked multi-query error banners: errors array entries carry their own refetch closure rather than a generic refetch-all"

key-files:
  created: []
  modified:
    - apps/web/app/(dashboard)/reports/page.tsx
    - apps/web/app/(dashboard)/management-roi/page.tsx

key-decisions:
  - "Reports' PageHeader title/subtitle and Management ROI's title/subtitle/non-GM guard were converted to t() calls (reports.pageTitle/pageSubtitle, managementRoi.pageTitle/pageSubtitle/noAccess) under v2, not left as literals with dataI18nSkip set blindly — dataI18nSkip only makes sense paired with real i18next-sourced content, otherwise it would suppress the legacy DOM translator's existing (working) EN->ES glossary match for these titles"
  - "Reports' 3 bare-<p> former-empty regions (DailySummaryTab's room-status-breakdown empty, MaintenanceTab's by-category empty, GuestRecoveryTab's by-category empty) were mapped to their tab-level reports.<tabKey>.empty.* keys per the plan's literal instruction, even though they are nested sub-section empties rather than whole-tab empties — matches 34-01's provisioned key shape exactly"
  - "Management ROI's stacked-error noun interpolation kept the noun value as a plain English string passed into managementRoi.loadErrorFor's {{noun}} placeholder (no per-noun locale keys exist) — matches the plan's 'or plain string interpolation' fallback since 34-01 provisioned only the template key, not per-noun translations"

patterns-established:
  - "StatSkeleton/SkeletonGrid/Section (Management ROI's shared skeleton scaffolding) accept an optional v2 prop threaded from the page, letting composite-loading-boolean skeletons re-skin without touching the aggregation/grouping logic that drives them"

# Metrics
duration: 35min
completed: 2026-08-18
---

# Phase 34 Plan 02: Reports + Management ROI Redesign Summary

**Reports' 5 tabs and Management ROI flag-gated behind `'reports'`/`'managementRoi'`, each wired to shared skeleton/StateBlock loading-empty-error components with per-query `refetch()` retry, zero query/RBAC change.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-18 (session start)
- **Completed:** 2026-08-18T21:23:22Z
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- Reports (`reports/page.tsx`): flag read once in `ReportsPage`, threaded as `redesigned={v2}` into all 5 tab components (Pattern 2, matching 33-05's Safety/Programs precedent but with 5 panels). Auth-loading guard replaced with a shared `Skeleton`-based v2 skeleton; no-access text and `PageHeader` title/subtitle route through `reports.*` i18n keys with `dataI18nSkip={v2}`.
- Each of Reports' 5 tabs (`DailySummaryTab`, `StaffPerformanceTab`, `MaintenanceTab`, `GuestRecoveryTab`, `AIUsageTab`) extended its `useQuery` destructuring to include `refetch` (previously absent in all 5), added a new `SkeletonBlockV2` (thin wrapper over the shared `Skeleton` component) for loading, wired `StateBlock status="error"` with `onRetry: () => refetch()` for errors, and converted every bare-`<p>`/hardcoded-`EmptyState`-copy empty region to `StateBlock`/i18n'd `EmptyState` using `reports.<tabKey>.empty.*`.
- Management ROI (`management-roi/page.tsx`): flag read once in `ManagementRoiPage`. Auth-loading skeleton and non-GM guard text route through `managementRoi.*`. The 9 named query objects were left untouched (no destructuring change — `.refetch()` already dot-notation callable). The stacked error array gained a `refetch` closure per entry so each `StateBlock status="error"` retries only its own failing query (not a blanket refetch-all), message sourced via `managementRoi.loadErrorFor` with `{{noun}}` interpolation. Page-level `EmptyState` i18n'd via `managementRoi.empty.*`. `Section`/`SkeletonGrid`/`StatSkeleton` threaded an optional `v2` prop to re-skin the 4 composite-loading-boolean skeletons with the shared `Skeleton` component, without touching the aggregation booleans (`timeSavedLoading`/`qualityLoading`/`responseLoading`/`revenueLoading`) or grouping logic.
- `Stat`/`Pill` (frozen `primitives.tsx`) confirmed untouched — `check:frozen-files` green.
- Legacy branch (flag off) renders byte-identical to pre-plan code in both files via `redesigned`/`v2` ternaries at every touched call site.

## Task Commits

Each task was committed atomically:

1. **Task 1: Reports — flag-thread to 5 tabs; skeleton auth-loading; StateBlock per-tab loading/empty/error** - `92493678` (feat)
2. **Task 2: Management ROI — flag gate; skeleton auth-loading + per-Section loading; StateBlock stacked errors + page empty** - `bb4a47d3` (feat)

**Plan metadata:** (this commit, following SUMMARY.md/STATE.md update)

## Files Created/Modified
- `apps/web/app/(dashboard)/reports/page.tsx` - Flag-threaded to 5 tabs (Pattern 2); v2 skeleton/StateBlock loading-empty-error per tab; `reports.*` i18n consumed read-only
- `apps/web/app/(dashboard)/management-roi/page.tsx` - Flag-gated directly; stacked per-query StateBlock errors with correct per-query `onRetry`; `managementRoi.*` i18n consumed read-only

## Decisions Made
- Converted `PageHeader` title/subtitle (and Management ROI's non-GM guard text) to `t()` calls under `v2` rather than leaving literals with `dataI18nSkip` set — pairing `dataI18nSkip` with non-i18n content would have suppressed the legacy DOM translator's currently-working EN→ES glossary match for these exact strings, a regression. Both `reports.pageTitle`/`pageSubtitle` and `managementRoi.pageTitle`/`pageSubtitle`/`noAccess` already existed verbatim-matching in `en.ts` from 34-01, confirming this was the intended consumption.
- Reports' 3 bare-`<p>` empty regions (nested sub-section empties inside `DailySummaryTab`/`MaintenanceTab`/`GuestRecoveryTab`, not whole-tab empties) were mapped to their tab-level `reports.<tabKey>.empty.*` keys per the plan's literal instruction — this is the only key shape 34-01 provisioned, so the mapping is intentionally coarser than the literal UI region it replaces.
- Management ROI's `loadErrorFor` noun interpolation kept the noun as a plain English string (no per-noun locale keys exist in `en.ts`/`es.ts`) — the translated shell text still localizes to Spanish, only the noun substring stays English, matching the plan's explicit "or plain string interpolation" fallback.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- One transient `next build` collision ("Another next build process is already running") caused by a sibling wave-2 plan's concurrent build — resolved by retrying after a short wait, no file conflict, consistent with the same class of collision documented in prior phase summaries (33-04, 33-05).
- One `git commit` accidentally swept in a sibling plan's already-staged file (`settings/integrations/page.tsx`, staged by plan 34-05's concurrent process) because the initial `git add` only staged my own file but a prior `git commit` (without pathspec restriction) committed the full index. Caught immediately via the commit's `--stat` output, fixed via `git reset --soft HEAD~1` (restoring the index to its exact pre-commit state) followed by a pathspec-scoped `git commit -m "..." -- <my-file>` that commits only the intended file while leaving the sibling's staged file untouched. Verified via `git show --stat` on both final commits that each touches exactly one file. No sibling plan's work was lost or corrupted.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Reports and Management ROI are flag-gated and StateBlock/skeleton-wired, ready for 34-08's close-out live-verification sweep alongside the other wave-2 plans.
- No blockers. `reports.*`/`managementRoi.*` locale keys consumed exactly as provisioned by 34-01, no gap keys needed.

---
*Phase: 34-management-admin-sections*
*Completed: 2026-08-18*

## Self-Check: PASSED
- FOUND: apps/web/app/(dashboard)/reports/page.tsx
- FOUND: apps/web/app/(dashboard)/management-roi/page.tsx
- FOUND: .planning/phases/34-management-admin-sections/34-02-SUMMARY.md
- FOUND: commit 92493678 (feat(34-02): Reports)
- FOUND: commit bb4a47d3 (feat(34-02): Management ROI)

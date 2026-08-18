---
phase: 35-engineering-section-chrome
plan: 04
subsystem: ui
tags: [react, next.js, i18n, state-block, skeleton, engineering]

# Dependency graph
requires:
  - phase: 35-engineering-section-chrome
    provides: "35-01 froze en.ts/es.ts for the phase, confirming engineering.assetsPage.loadError/retry already existed as reusable keys"
provides:
  - "Assets page (engineering/assets/page.tsx) redesigned behind the 'engineering' flag: table loading uses shared Skeleton, table error uses shared StateBlock (existing key + existing invalidateQueries retry), empty-state typography v2-token-ified while its rich structure is preserved, AssetDetailModal's loading spinner replaced with a skeleton"
affects: [35-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SkeletonRow branches internally on a v2 boolean prop rather than the table body choosing between two row renderers — kept the diff smallest since only the placeholder markup differs, not the <tr>/<td> structure"
    - "Local modal components (AssetDetailModal) take v2 as an explicit prop threaded from the parent page rather than reading the flag themselves, matching 34-03/34-06's precedent for local sub-components in the same file"

key-files:
  created: []
  modified:
    - "apps/web/app/(dashboard)/engineering/assets/page.tsx"

key-decisions:
  - "Table error path reuses the EXISTING engineering.assetsPage.loadError/retry keys and the EXISTING queryClient.invalidateQueries({ queryKey: ['assets'] }) retry mechanism verbatim inside StateBlock's error.onRetry — no new key, no switch to .refetch()"
  - "Empty-state (Open Question 2 from 35-RESEARCH.md): stays structurally bespoke inside <td colSpan={7}>, NOT literally wrapped in <EmptyState> — only the emptyHeading/emptyHelp <p> tags' typography classes are swapped to EmptyState-equivalent tokens (text-ink / text-[13px] leading-relaxed text-ink3) under v2; the 3 sample-asset chips and conditional Add-Asset button are fully preserved unchanged in both v2 and legacy"
  - "AssetDetailModal's query destructuring stays { data, isLoading } (no isError added) — only the loading treatment (Loader2 spinner -> Skeleton placeholder) is in scope per CONTEXT's narrow mandate; a full error-state addition to the detail modal is deliberately deferred"

patterns-established:
  - "Confirmed pattern: page-level v2 boolean is computed once via useHotelStore + isSectionRedesigned and threaded down as an explicit prop to any local (same-file) sub-component that needs it, rather than each sub-component re-deriving the flag"

# Metrics
duration: 20min
completed: 2026-08-18
---

# Phase 35 Plan 04: Assets Page Chrome Summary

**Assets table's loading/error states converted from raw markup to shared Skeleton/StateBlock primitives behind the `engineering` flag, reusing 100% of the page's existing i18n keys and retry mechanism; empty-state typography brought in line with the shared visual language while its richer information architecture stays structurally bespoke.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-18T23:19:00Z (approx, immediately following 35-01 close-out)
- **Completed:** 2026-08-18T23:36:49Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- `assets/page.tsx` reads `isSectionRedesigned('engineering', hotel)` once and threads `v2` into `PageHeader`'s `dataI18nSkip`, `SkeletonRow`, and `AssetDetailModal`
- Table error block converted to `StateBlock status="error"` under `v2`, wired to the pre-existing `engineering.assetsPage.loadError` key and the pre-existing `queryClient.invalidateQueries({ queryKey: ['assets'] })` retry — legacy branch byte-unchanged
- `SkeletonRow` branches internally on `v2`: v2 renders the shared `Skeleton` component per cell (same widths as before), legacy renders the original raw `bg-gray-100` divs unchanged
- Empty-state's `emptyHeading`/`emptyHelp` `<p>` tags now use `text-ink`/`text-ink3` typography tokens under `v2` (matching `EmptyState.tsx`'s own classes), while its 3 sample-asset chips and conditional Add-Asset CTA are structurally untouched — it deliberately stays outside a literal `<EmptyState>` wrap since it lives inside `<td colSpan={7}>`
- `AssetDetailModal` gained a `v2` prop; its `isLoading` branch now renders a `Skeleton`-based placeholder (badge-row + 8-field grid, sized to roughly match the loaded detail layout) instead of the raw `Loader2` spinner under `v2` — legacy spinner unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Flag; table loading→Skeleton, error→StateBlock (reuse existing keys/retry)** - `3b1b54f9` (feat)
2. **Task 2: Empty-state typography v2-token-ify; AssetDetailModal spinner→skeleton** - `1e7e24e8` (feat)

**Plan metadata:** (this commit, following SUMMARY/STATE update)

## Files Created/Modified
- `apps/web/app/(dashboard)/engineering/assets/page.tsx` - Flag-gated Skeleton/StateBlock chrome for the assets table, v2-token empty-state typography, AssetDetailModal skeleton loading

## Decisions Made
- Reused the existing `engineering.assetsPage.loadError`/`retry` keys and the existing `invalidateQueries`-based retry mechanism verbatim in `StateBlock`'s `error` prop — no new locale key needed (per 35-01's confirmation this page already had working error copy), no switch to `.refetch()`.
- Empty-state (35-RESEARCH.md Open Question 2, resolved here): kept structurally bespoke rather than wrapped in `<EmptyState>`, since it renders inside a `<td>` and carries materially more information architecture (3 sample chips + conditional CTA) than `EmptyState`'s `icon+title+body+action` shape accommodates. Only title/body typography classes were aligned to `EmptyState`'s visual language.
- `SkeletonRow` was given an internal `v2` branch (single component, two render paths) rather than splitting into two separate row-renderer components selected by the table body — kept the diff smallest while leaving the `<tr>`/`<td>` structure and column count identical in both paths.
- `AssetDetailModal`'s query destructuring was deliberately left as `{ data, isLoading }` (no `isError`) — only the loading-spinner-to-skeleton swap is in scope; a full error-state redesign of the detail modal is out of this phase per CONTEXT's narrow-scope mandate.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**Transient build-lock collision (not a code defect):** `npm run build` initially failed 3 times in a row with Next.js's "Another next build process is already running" error, because this plan runs in parallel with 4 sibling wave-2 plans (35-02/35-03/35-05/35-06) sharing one working tree and one `.next` build lock. Resolved by polling with a wait-then-retry loop (no lock file force-removed, no process killed) until a sibling's build released the lock; the eventual `npm run build` run completed cleanly with all 43 routes (including `/engineering/assets`) succeeding. No git-index commingling occurred for this plan — both task commits were pathspec-restricted (`git commit -m "..." -- <path>`) per the phase's standing git-race guidance, and `git status --short -- "apps/web/app/(dashboard)/engineering/assets/page.tsx"` confirmed clean single-file diffs both times.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Assets page chrome is complete and gate-clean (`type-check`, `build` all 43 routes, `check:frozen-files` 7/7, `check:contrast` 10 pairings both modes, `check:i18n-parity` 1578 keys unchanged).
- No deferred items for the 35-07 close-out list beyond the standing, already-flagged phase-wide items (bug-965, StateBlock i18n mangling class, out of scope for this plan and already tracked from Phase 34's close-out).
- Ready for 35-07 (close-out verification, wave 3) once all of wave 2 (35-02..35-06) completes.

---
*Phase: 35-engineering-section-chrome*
*Completed: 2026-08-18*

## Self-Check: PASSED

- FOUND: apps/web/app/(dashboard)/engineering/assets/page.tsx
- FOUND: commit 3b1b54f9 (Task 1)
- FOUND: commit 1e7e24e8 (Task 2)
- FOUND: .planning/phases/35-engineering-section-chrome/35-04-SUMMARY.md

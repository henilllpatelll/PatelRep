---
phase: 32-role-dashboard-homes
plan: 03
subsystem: ui
tags: [react, next.js, tailwind, i18n, dashboard]

requires:
  - phase: 32-01
    provides: dashboard.empty.*/dashboard.section.* i18n keys in en.ts/es.ts
provides:
  - v2-flag-branched restyle of HousekeeperDashboard.tsx (My queue / My tasks / Heads up)
  - v2-flag-branched restyle of EngineerDashboard.tsx (stat strip / work-order list / urgent callout)
affects: [32-06, 33, 37]

tech-stack:
  added: []
  patterns:
    - "Read isSectionRedesigned('dashboard', hotel) directly via useHotelStore in each dashboard home component, branch entire return early (if (v2) { return ... }); legacy branch left byte-identical below it"
    - "v2 chrome applies duration-fast/ease-standard transitions, focus-visible:ring-[var(--focus-ring)], and bg-brand/text-brand accents on interactive rows only — room-status/priority tone tokens (Pill/StatusDot via STATUS_TONE/PRIORITY_TONE) untouched"
    - "StateBlock status='empty'/'error' replaces ad-hoc empty/error JSX per list section, wired to each query's own isError + refetch"

key-files:
  created: []
  modified:
    - apps/web/components/dashboard/HousekeeperDashboard.tsx
    - apps/web/components/dashboard/EngineerDashboard.tsx

key-decisions:
  - "Housekeeper stat-strip active-room badge switched from bg-accent to bg-brand in the v2 branch only (legacy untouched) — the v2 brand ramp is the intended chrome accent per 30-04, accent stays legacy-only"
  - "Housekeeper active-queue-row highlight switched from bg-[var(--accent-soft)] to inline style background: var(--brand-soft) in v2 (brand-soft has no Tailwind color utility class, only the CSS var) — kept legacy's className approach unchanged"
  - "Wired isError/refetch on all three housekeeper queries (myRoomsData, boardData, tasksData) since 'my queue' merges the first two and 'my tasks' consumes the third; alertsData (Heads up predictions) intentionally left without an error UI — it already degrades to its existing 'No risk flags right now' empty copy on either loading or error, which is not a query the plan asked to gate, and forcing an error branch there would touch a list the plan didn't name"
  - "Engineer file's 'Work orders' section heading and housekeeper's 'Full board'/'View board' link text left untranslated (plain string), matching legacy exactly — no dashboard.section.* or dashboard.gm.* key matches those labels, and the plan only asked for the myQueue/myTasks/headsUp section labels plus the empty-state keys"
  - "New SkeletonRowV2 component added alongside the existing SkeletonRow (kept for the legacy branch) rather than parameterizing SkeletonRow with a v2 flag — avoids threading a boolean prop through an otherwise a prop-less skeleton row, keeps both branches trivially diffable"
  - "Engineer urgent-callout banner's --alert/--alert-soft/--alert-line tokens reused as-is in v2 (only transition-colors duration-base/ease-standard added to the banner's className) — no *-v2 token introduced, since the plan's exclusion (do NOT re-tint --alert) left no accent gap to fill"

patterns-established:
  - "Section-flag home restyle pattern: compute v2 once near the top of the component (useHotelStore + isSectionRedesigned), branch the whole `return`, never interleave `v2 ? x : y` conditionals inside shared JSX for these home components"

duration: 25min
completed: 2026-08-16
---

# Phase 32 Plan 03: Housekeeper + Engineer Dashboard Homes Summary

**Flag-branched v2 restyle of HousekeeperDashboard.tsx and EngineerDashboard.tsx — same queue/task and work-order information architecture, rebuilt StateBlock-driven empty/error states, skeleton-card loading, zero changes to frozen primitives, room-status tokens, or locale files.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `HousekeeperDashboard.tsx` v2 branch: My queue (rooms) and My tasks each get `StateBlock` empty/error states (`dashboard.empty.housekeeperNoRooms`/`housekeeperNoTasks`), section headings pulled from `dashboard.section.myQueue`/`myTasks`/`headsUp`, v2 chrome tokens (brand accent, focus-visible ring, `duration-fast`/`ease-standard`) on interactive rows; skeleton-card loading unchanged (still `animate-pulse` + `bg-surface-2`, no spinner).
- `EngineerDashboard.tsx` v2 branch: work-order list gets `StateBlock` empty/error (`dashboard.empty.engineerNoWorkOrders`), a new `SkeletonRowV2` (still a skeleton), v2 chrome tokens on the "View board" link and each WO row; urgent-callout banner behavior and WO sort/priority logic byte-unchanged, only its transition chrome updated.
- Both files' `!v2` branches are byte-identical to the pre-plan source (confirmed by diff review during authoring — no line inside the legacy return was touched).
- No `primitives.tsx`, `en.ts`/`es.ts`, or any shared/frozen file edited; `check:frozen-files` confirms zero drift.

## Task Commits

1. **Task 1: Restyle HousekeeperDashboard to v2 + rebuild states** - `c532f01f` (feat)
2. **Task 2: Restyle EngineerDashboard to v2 + rebuild states** - `0cbb722d` (feat)

## Files Created/Modified
- `apps/web/components/dashboard/HousekeeperDashboard.tsx` - v2-flag-branched restyle; legacy branch preserved verbatim
- `apps/web/components/dashboard/EngineerDashboard.tsx` - v2-flag-branched restyle; legacy branch preserved verbatim

## Decisions Made
See `key-decisions` in frontmatter above — most notably: no new `*-v2` token was needed for either file (v2 chrome reuses the existing `--brand`/`--brand-soft`/`--focus-ring`/`--motion-*` tokens from Phase 30), and the AI "Heads up" predictions sidebar in the housekeeper home was deliberately left without a dedicated error branch since it already degrades gracefully and wasn't named in the plan's error-wiring list.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- HOME-01 is now met for housekeeper and engineer (2 of the 5 non-GM roles); housekeeping_supervisor/chief_engineer (32-04) and GM (32-02) are handled by parallel wave-2 plans.
- `check:frozen-files` and `check:contrast` both green after this plan — no regression introduced for downstream close-out gates (32-06 / Phase 37).
- Verified live with the flag OFF only (no Supabase MCP write access in this session to flip `web_redesign_sections` on the test tenant); flag-ON visual click-through for these two roles should be covered by the phase's close-out verification, same class of follow-up as Phase 31's.

---
*Phase: 32-role-dashboard-homes*
*Completed: 2026-08-16*

## Self-Check: PASSED
- FOUND: apps/web/components/dashboard/HousekeeperDashboard.tsx
- FOUND: apps/web/components/dashboard/EngineerDashboard.tsx
- FOUND: .planning/phases/32-role-dashboard-homes/32-03-SUMMARY.md
- FOUND commit: c532f01f
- FOUND commit: 0cbb722d

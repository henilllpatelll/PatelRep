---
phase: 11-mobile-ui-parity-cleanup-widen-i18n-lint-gate-fix-hardcoded-dark-mode-color-address-tooling-audit-debt
plan: 04
subsystem: ui
tags: [i18n, react-i18next, mobile, expo-router]

requires:
  - phase: 11-03
    provides: guestRequests/lostFound i18n namespaces, established the per-plan gate-widening pattern (locale-first, then wire t())
provides:
  - alertsScreen, scheduling, and sop top-level i18n namespaces (EN/ES parity)
  - notifications/index.tsx, scheduling/index.tsx, sop/index.tsx, sop/[sopId].tsx fully wired to t()
affects: [11-05, 11-06]

tech-stack:
  added: []
  patterns:
    - "CLDR _one/_other plural pair used for count-suffix strings (unreadSuffix, procedureCount) even when EN text doesn't change between forms — required for ES pluralization"
    - "Named interpolation params (day/month/date) for composite date-prefix strings instead of embedding raw JS expressions in translation calls"

key-files:
  created: []
  modified:
    - apps/mobile/i18n/locales/en.json
    - apps/mobile/i18n/locales/es.json
    - apps/mobile/app/(app)/notifications/index.tsx
    - apps/mobile/app/(app)/scheduling/index.tsx
    - apps/mobile/app/(app)/sop/index.tsx
    - apps/mobile/app/(app)/sop/[sopId].tsx

key-decisions:
  - "Wired scheduling/index.tsx:99's 'Clocked in' Pill text through t() (scheduling.clockedIn) per the plan's fallback instruction — harmless either way, and consistent with the other 5 literals in that file"
  - "sop/[sopId].tsx's 'Ask about this SOP' button (line 66, label + inert onPress={() => undefined}) left completely untouched, confirmed via post-edit grep (both the label string and the onPress handler each appear exactly once)"

patterns-established:
  - "Explicit out-of-scope UI elements (per CONTEXT.md) are verified via targeted grep counts in acceptance criteria, not just visual diff review"

duration: 15min
completed: 2026-08-01
---

# Phase 11 Plan 04: Notifications/Scheduling/SOP i18n gate-widening Summary

**Wired 21 raw JSX-text literals across 4 mobile screens through `t()`, backed by new top-level `alertsScreen`/`scheduling`/`sop` i18n namespaces at EN/ES parity, while leaving `sop/[sopId].tsx`'s explicitly out-of-scope "Ask about this SOP" button byte-for-byte unchanged.**

## Performance

- **Duration:** 15 min
- **Tasks:** 2 completed
- **Files modified:** 6

## Accomplishments
- Added `alertsScreen` (3 keys incl. CLDR plural pair), `scheduling` (6 keys), and `sop` (13 keys incl. plural pair) namespaces to both `en.json` and `es.json`, confirmed collision-free against pre-existing `notifications`, `engineerMore.scheduling`/`schedulingSub`, and `home.*` keys
- `notifications/index.tsx` (2 literals), `scheduling/index.tsx` (6 literals), `sop/index.tsx` (6 literals), `sop/[sopId].tsx` (7 literals) all now resolve through `t()`, each gaining a `useTranslation` import + `const { t } = useTranslation()` hook mirroring `tasks/index.tsx`'s established placement
- `sop/[sopId].tsx` line 66's inert "Ask about this SOP" button preserved exactly — confirmed via grep (label string count=1, `onPress={() => undefined}` count=1)
- `apps/mobile` `npm run type-check` passes clean

## Task Commits

1. **Task 1: Add alertsScreen + scheduling + sop EN/ES namespaces** - `8562a255` (feat)
2. **Task 2: Wire t() across the 4 files (21 literals), preserving sop/[sopId].tsx's inert button untouched** - `e6b8e70a` (feat)

## Files Created/Modified
- `apps/mobile/i18n/locales/en.json` - added alertsScreen/scheduling/sop namespaces
- `apps/mobile/i18n/locales/es.json` - added alertsScreen/scheduling/sop namespaces (parity)
- `apps/mobile/app/(app)/notifications/index.tsx` - wired 2 literals (unread count, "Alerts" title) through t()
- `apps/mobile/app/(app)/scheduling/index.tsx` - wired 6 literals (title, today-prefix, clocked-in pill, day-off/no-shift, "This week" section label) through t()
- `apps/mobile/app/(app)/sop/index.tsx` - wired 6 literals (procedure count x2 via plural idiom, title, search prompt, categories/recently-added labels) through t()
- `apps/mobile/app/(app)/sop/[sopId].tsx` - wired 7 literals (updated-prefix, assistant intro prefix/suffix, overview/category/pages/added labels) through t(); line 66 button untouched

## Decisions Made
- Wired the "Clocked in" pill text (scheduling/index.tsx:99) since the plan's fallback said to wire it "if unsure" as harmless either way, and it's consistent with the rest of the file's coverage.
- No new architectural decisions — followed the plan's literal→key mapping exactly.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
21 of 52 total gate-widening violations now closed (this plan) + 22 from 11-03 = 43/52. Remaining violations belong to other Phase 11 wave-3/wave-4 plans (11-05, 11-06 handle the rest plus the actual `eslint.config.mjs` gate-widening, deferred by design to avoid config-file collisions across parallel plans). No blockers.

---
*Phase: 11-mobile-ui-parity-cleanup-widen-i18n-lint-gate-fix-hardcoded-dark-mode-color-address-tooling-audit-debt*
*Completed: 2026-08-01*

## Self-Check: PASSED

- FOUND: 11-04-SUMMARY.md
- FOUND: commit 8562a255 (Task 1)
- FOUND: commit e6b8e70a (Task 2)

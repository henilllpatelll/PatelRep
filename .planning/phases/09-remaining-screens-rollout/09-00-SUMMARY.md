---
phase: 09-remaining-screens-rollout
plan: 00
subsystem: mobile-i18n
tags: [react-native, expo, i18next, eslint, spanish]

# Dependency graph
requires:
  - phase: 07-theme-foundation-primitives
    provides: i18next/no-literal-string mobile lint gate
  - phase: 08-floor-role-rollout
    provides: the four floor-facing files whose deferred literals are now translated
provides:
  - EN/ES parity for all 22 deferred task and modal literals
  - Active i18next lint enforcement for all four formerly-exempt floor files
affects: [09-remaining-screens-rollout, 10-dark-mode-accessibility-qa]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Standalone work-order labels use workOrders.categoryLabel so the dynamic workOrders.category namespace remains intact"
    - "Placeholder copy is translated manually while markupOnly:true intentionally keeps the lint gate narrow"

key-files:
  created:
    - .planning/phases/09-remaining-screens-rollout/09-00-SUMMARY.md
  modified:
    - apps/mobile/i18n/locales/en.json
    - apps/mobile/i18n/locales/es.json
    - apps/mobile/app/(app)/tasks/index.tsx
    - apps/mobile/components/engineering/CreateWorkOrderModal.tsx
    - apps/mobile/components/housekeeping/ReportIssueModal.tsx
    - apps/mobile/components/housekeeping/SupplyRequestModal.tsx
    - apps/mobile/eslint.config.mjs

key-decisions:
  - "Kept markupOnly:true unchanged; the six placeholder literals are translated by explicit task scope, not an app-wide gate expansion."
  - "Added workOrders.categoryLabel instead of replacing the dynamic workOrders.category object namespace."

patterns-established:
  - "New locale keys require EN/ES string parity checks before call sites are wired."

# Metrics
duration: 12min
completed: 2026-07-31
---

# Phase 9 Plan 00: I18n Gate-Widening Summary

**All 22 deferred floor-screen literals now resolve through `t()` with human-reviewed English and Spanish keys, while the mobile no-literal-string gate actively covers the formerly exempt task and modal files.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-30T23:55:36Z
- **Completed:** 2026-07-31T00:08:23Z
- **Tasks:** 3 completed
- **Files modified:** 7

## Accomplishments

- Added paired EN/ES task, work-order, report-issue, and supply-request labels and placeholders.
- Replaced the 22 specified text/placeholder literals with `t()` calls without changing submit, API, offline queue, validation, or form-state behavior.
- Removed the four temporary ESLint exemptions and their obsolete Phase 9 deferral note while preserving `markupOnly: true`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add all new EN + ES keys (parity-first)** - `1fe8a11f` (feat)
2. **Task 2: Wire t() for the 22 literals across the 4 files** - `784759de` (feat)
3. **Task 3: Remove 4 ignores entries + confirm gate green** - `96444785` (chore)

**Plan metadata:** created with the plan-completion metadata commit.

## Files Created/Modified

- `apps/mobile/i18n/locales/en.json` - Added English task and modal copy.
- `apps/mobile/i18n/locales/es.json` - Added matching, human-reviewed Spanish copy.
- `apps/mobile/app/(app)/tasks/index.tsx` - Localized the AI preview room label.
- `apps/mobile/components/engineering/CreateWorkOrderModal.tsx` - Localized five labels and three placeholders.
- `apps/mobile/components/housekeeping/ReportIssueModal.tsx` - Localized seven labels and two placeholders while retaining required asterisks.
- `apps/mobile/components/housekeeping/SupplyRequestModal.tsx` - Localized two labels and one placeholder.
- `apps/mobile/eslint.config.mjs` - Activated the existing narrow i18next lint gate for all four files.

## Decisions Made

- Kept `markupOnly: true` unchanged, as required by D-12; the six placeholders are translated explicitly rather than widening attribute enforcement across the app.
- Used `workOrders.categoryLabel` for the standalone label because `workOrders.category` is an existing dynamic category-object namespace used throughout the work-order UI.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corrected stale locale namespace assumptions without breaking dynamic category labels**
- **Found during:** Task 1 (Add all new EN + ES keys)
- **Issue:** The planned `reportIssue` and `supplies` objects did not exist in either locale, and `workOrders.category` is an object namespace referenced by dynamic category keys rather than a standalone string.
- **Fix:** Added the two missing locale namespaces in both languages and introduced `workOrders.categoryLabel` for the modal's standalone label, preserving existing `workOrders.category.${categoryKey}` lookups.
- **Files modified:** `apps/mobile/i18n/locales/en.json`, `apps/mobile/i18n/locales/es.json`, `apps/mobile/components/engineering/CreateWorkOrderModal.tsx`
- **Verification:** EN/ES string-parity check, TypeScript check, and active-gate lint all pass.
- **Committed in:** `1fe8a11f` and `784759de`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary naming adjustment only; it preserves the plan's full 22-literal translation scope and prevents a runtime regression in existing category translations.

## Issues Encountered

- The current user-level GSD engine was used because this checkout has no project-local `.claude/get-shit-done/bin`; no plan work was blocked.
- Full Jest completed green with pre-existing console warnings from icon/test async updates and the intentional offline-sync failure test.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The Phase 9 i18n backlog is closed; subsequent screen-migration plans now run under the same active narrow lint gate.
- Ready for 09-01-PLAN.md.

## Self-Check: PASSED

- The summary and all seven implementation artifacts exist.
- Task commits `1fe8a11f`, `784759de`, and `96444785` were verified during execution.
- Mobile type-check, lint, EN/ES key-parity assertions, and the full Jest run (25 suites, 135 tests) passed.

---
*Phase: 09-remaining-screens-rollout*
*Completed: 2026-07-31*

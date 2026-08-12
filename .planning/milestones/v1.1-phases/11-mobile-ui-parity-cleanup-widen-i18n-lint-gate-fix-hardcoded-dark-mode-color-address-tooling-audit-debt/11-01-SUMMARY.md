---
phase: 11-mobile-ui-parity-cleanup-widen-i18n-lint-gate-fix-hardcoded-dark-mode-color-address-tooling-audit-debt
plan: 01
subsystem: ui
tags: [react-native, expo, i18n, react-i18next, theming, testing, jest]

# Dependency graph
requires:
  - phase: 07-theme-foundation-primitives
    provides: theme.ai.primary token in components/shared/tokens.ts
provides:
  - home/index.tsx sparkles icon themed via theme.ai.primary (light+dark reactive)
  - FoundItemModal.tsx surfaces Toast on submission failure instead of silently swallowing it
  - workOrders.searchPlaceholder + foundItem.submitError locale keys (EN+ES parity)
  - new FoundItemModal.test.tsx covering the failure path
affects: [11-mobile-ui-parity-cleanup remaining plans]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real-i18n component tests use <I18nextProvider i18n={i18n}> wrapping the real @/i18n singleton (not a react-i18next identity mock) to assert on actual resolved translation strings — mirrors OfflineBanner.test.tsx"

key-files:
  created:
    - apps/mobile/__tests__/components/FoundItemModal.test.tsx
  modified:
    - apps/mobile/app/(app)/home/index.tsx
    - apps/mobile/components/housekeeping/FoundItemModal.tsx
    - apps/mobile/i18n/locales/en.json
    - apps/mobile/i18n/locales/es.json

key-decisions:
  - "Test asserts on the button via getByLabelText, not getByText, because foundItem.title and foundItem.submit are both literally \"Report Found Item\" in en.json and getByText matched two elements"
  - "Wrapped test render in <I18nextProvider i18n={i18n}> using the real @/i18n singleton — without it, useTranslation() in a component with no import-chain path to @/i18n resolves raw keys instead of real strings, since nothing in FoundItemModal's dependency graph triggers the side-effect init that app/_layout.tsx normally provides"

patterns-established:
  - "Toast-on-catch idiom: `toast.error(t(\"<namespace>.submitError\"))` in an otherwise-empty catch block, mirroring SupplyRequestModal.tsx and LostFoundScreen's inline handler"

# Metrics
duration: 25min
completed: 2026-08-01
---

# Phase 11 Plan 01: Mobile UI Parity Cleanup — Theme Color, Toast Error, i18n Key Summary

**Replaced a hardcoded hex AI-sparkles color with the theme.ai.primary token, filled FoundItemModal's silently-swallowing catch block with a Toast error, added the missing workOrders.searchPlaceholder i18n key (EN+ES), and closed the FoundItemModal test-coverage gap with a new failure-path test.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-01T17:10:00Z
- **Completed:** 2026-08-01T17:35:00Z
- **Tasks:** 2 completed
- **Files modified:** 4 modified, 1 created

## Accomplishments
- `home/index.tsx`'s sparkles icon now themes correctly in both light and dark mode via `theme.ai.primary` instead of a hardcoded `#CBB8F0`
- `FoundItemModal.tsx` surfaces a user-visible Toast error on submission failure instead of silently leaving the modal in a stuck state, while still keeping the modal open (preserving prior "keep modal open on error" intent)
- Spanish users now see a translated placeholder in the work-orders search field (`workOrders.searchPlaceholder`) instead of falling back to the English `defaultValue`
- New `FoundItemModal.test.tsx` proves the failure path calls `toast.error` with the real resolved translation string and does not call `onClose`, closing the coverage gap Phase 11 research identified

## Task Commits

Each task was committed atomically:

1. **Task 1: AI color token fix + locale key additions** - `e593ee5c` (feat)
2. **Task 2: FoundItemModal catch-block fix + new test** - `df2e07a9` (fix)

_Note: `4f041f80` (chore(11-02): apply safe npm audit fix) appears between these two commits in git log — it was made by a concurrently-running plan 11-02, not part of this plan's work._

## Files Created/Modified
- `apps/mobile/app/(app)/home/index.tsx` - Sparkles icon color swapped from `#CBB8F0` to `theme.ai.primary`
- `apps/mobile/i18n/locales/en.json` - Added `workOrders.searchPlaceholder` and `foundItem.submitError`
- `apps/mobile/i18n/locales/es.json` - Added matching ES keys for parity
- `apps/mobile/components/housekeeping/FoundItemModal.tsx` - Empty catch block now calls `toast.error(t("foundItem.submitError"))`
- `apps/mobile/__tests__/components/FoundItemModal.test.tsx` - New test asserting the failure path fires `toast.error` and the modal stays open

## Decisions Made
- Used `getByLabelText("Report Found Item")` instead of `getByText` in the new test because the modal's title and submit-button label resolve to the identical English string, making `getByText` ambiguous (Button.tsx sets `accessibilityLabel={label}`, which is unique per accessible element)
- Wrapped the new test's render tree in `<I18nextProvider i18n={i18n}>` (the real `@/i18n` singleton), matching the proven pattern in `OfflineBanner.test.tsx`, rather than relying on any transitive import chain to auto-initialize translations — confirmed via a failing dry run that without this explicit provider, `t()` resolves to raw keys (e.g. `"foundItem.title"`) since nothing in `FoundItemModal`'s own dependency graph reaches the `@/i18n` side-effect import that `app/_layout.tsx` normally provides

## Deviations from Plan

None - plan executed exactly as written. The only adjustment was to the test's element-selection strategy (`getByLabelText` instead of `getByText`) and adding the `I18nextProvider` wrapper, both required to make the test pass correctly per the plan's own explicit instruction not to mock `react-i18next` to identity — no deviation-rule was needed since this was refining the test's own implementation to match its stated intent, not a change to production code.

## Issues Encountered
- Running the full mobile Jest suite (`npx jest`) shows 14-16 pre-existing test-suite failures (timeouts in `AccessibilityContracts.test.tsx`, `RoomStatusList.test.tsx`, `RoomDetail.test.tsx`, etc.) under parallel-worker load. Confirmed via `git stash` that these failures exist on `main` prior to this plan's changes and are reproducible with or without the new `FoundItemModal.test.tsx` present — pre-existing flakiness, out of this plan's scope, not investigated further.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- ROADMAP criteria 2, 3, 4 for Phase 11 satisfied: theme.ai.* semantic token in use, FoundItemModal fails loudly with new test coverage, workOrders.searchPlaceholder present in both locale files
- Remaining Phase 11 tech-debt items (i18n lint-gate coverage widening, npm audit debt review) are handled by other plans in this phase (11-02 already committed in parallel per git log)

---
*Phase: 11-mobile-ui-parity-cleanup-widen-i18n-lint-gate-fix-hardcoded-dark-mode-color-address-tooling-audit-debt*
*Completed: 2026-08-01*

## Self-Check: PASSED

All claimed files exist (home/index.tsx, en.json, es.json, FoundItemModal.tsx, FoundItemModal.test.tsx) and both task commits (`e593ee5c`, `df2e07a9`) are present in git history.

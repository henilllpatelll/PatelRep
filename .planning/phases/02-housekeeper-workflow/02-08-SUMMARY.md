---
phase: 02-housekeeper-workflow
plan: 08
subsystem: ui
tags: [react-native, i18n, react-i18next, localization, mobile]

# Dependency graph
requires:
  - phase: 02-housekeeper-workflow
    provides: ReportIssueModal component with t() already wired for all strings except Submit button
provides:
  - rooms.submit translation key in EN locale ("Submit") and ES locale ("Enviar")
  - ReportIssueModal Submit button fully localized via t("rooms.submit")
  - L10N-01 requirement fully satisfied — no hardcoded UI strings remain in the modal
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "All new UI button text uses t() with a namespace-qualified key (e.g. rooms.submit) — no hardcoded English strings in components"

key-files:
  created: []
  modified:
    - apps/mobile/i18n/locales/en.json
    - apps/mobile/i18n/locales/es.json
    - apps/mobile/components/housekeeping/ReportIssueModal.tsx

key-decisions:
  - "rooms.submit key placed after checkinTime in both locale files to maintain alphabetical-ish ordering within the rooms namespace"

patterns-established:
  - "Translation keys added to both locale files before (or simultaneously with) component changes — prevents silent blank text"

requirements-completed: [L10N-01]

# Metrics
duration: 2min
completed: 2026-03-22
---

# Phase 2 Plan 8: Submit Button i18n Fix Summary

**rooms.submit translation key added to EN/ES locales and ReportIssueModal Submit button replaced with t("rooms.submit") — L10N-01 fully satisfied**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-22T01:26:02Z
- **Completed:** 2026-03-22T01:28:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added `"submit": "Submit"` to `en.json` rooms namespace after `checkinTime`
- Added `"submit": "Enviar"` to `es.json` rooms namespace after `checkinTime`
- Replaced hardcoded `Submit` string on ReportIssueModal.tsx line 115 with `{t("rooms.submit")}`
- All 4 existing ReportIssueModal jest tests pass without modification (regex `/submit/i` matches `"rooms.submit"`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add rooms.submit translation key to both locale files** - `55b0acd` (feat)
2. **Task 2: Replace hardcoded Submit with t("rooms.submit") in ReportIssueModal** - `45512de` (fix)

**Plan metadata:** `(docs commit follows)`

## Files Created/Modified
- `apps/mobile/i18n/locales/en.json` - Added `"submit": "Submit"` inside rooms object
- `apps/mobile/i18n/locales/es.json` - Added `"submit": "Enviar"` inside rooms object
- `apps/mobile/components/housekeeping/ReportIssueModal.tsx` - Line 115 uses `{t("rooms.submit")}` instead of hardcoded `Submit`

## Decisions Made
- rooms.submit key placed after checkinTime in both locale files — matches the existing ordering pattern in the rooms namespace

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `npx jest` from monorepo root failed (jest not found); resolved by running from `apps/mobile` directory where jest-expo is installed — same as all previous test runs in this phase.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- L10N-01 is complete; the housekeeper workflow mobile gap closure is fully done
- Phase 2 gap closure plans (07 + 08) both complete — all identified gaps closed
- Ready for Phase 3 when scope is defined

## Self-Check: PASSED

All files verified present. Both task commits verified in git log.

---
*Phase: 02-housekeeper-workflow*
*Completed: 2026-03-22*

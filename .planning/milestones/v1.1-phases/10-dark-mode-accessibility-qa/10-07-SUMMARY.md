---
phase: 10-dark-mode-accessibility-qa
plan: 07
subsystem: mobile-ui
tags: [react-native, accessibility, dark-mode, wcag, housekeeping, inspections]

requires:
  - phase: 10-01
    provides: Persisted app-wide appearance preference and reactive theme source
  - phase: 10-02
    provides: Contrast-tested semantic on-colors and status token pairs
provides:
  - Explicit five-file housekeeping and inspection semantic foreground guard
  - Theme-safe primary, destructive, and selected-state foregrounds
  - Named 44pt controls with selected, checked, disabled, and busy state
  - Scrollable modal content that retains required actions at large text sizes
affects: [10-08, 10-09, 10-10, 10-11, android-accessibility-qa]

tech-stack:
  added: []
  patterns:
    - Semantic on-color roles follow the solid fill used by each control
    - Source guards use an explicit owned-file inventory instead of a repository-wide regex
    - Modal content scrolls while action handlers and payloads remain unchanged

key-files:
  created:
    - apps/mobile/__tests__/components/HousekeepingSemanticOnColor.test.ts
  modified:
    - apps/mobile/components/housekeeping/SupplyRequestModal.tsx
    - apps/mobile/components/housekeeping/ReportIssueModal.tsx
    - apps/mobile/components/housekeeping/KnockModal.tsx
    - apps/mobile/components/housekeeping/ChecklistSection.tsx
    - apps/mobile/app/(app)/inspect/index.tsx

key-decisions:
  - "Use theme.onDestructive for solid dirty/failure controls and theme.onPrimary for primary, ready, pickup, and clean solid controls."
  - "Keep semantic soft fills and borders for non-solid status selections instead of forcing every control through a primary Button variant."
  - "Preserve modal workflows while adding bounded scrolling for Supply Request, Knock, and inspection confirmation content at 200% text."

patterns-established:
  - "Accessibility inventory: document real Pressable/TouchableOpacity controls per file and explicitly exclude decorative icons, rails, grabbers, dots, and avatars."
  - "State semantics: checkbox/radio/tab/button roles carry checked, selected, expanded, disabled, or busy state when applicable."

duration: 11 min
completed: 2026-07-31
---

# Phase 10 Plan 07: Housekeeping and Inspection Accessibility Summary

**Contrast-tested semantic foregrounds, 44pt named controls, and large-text-safe modal scrolling across the bounded housekeeping and inspection audit**

## Performance

- **Duration:** 11 min
- **Started:** 2026-07-31T07:16:04Z
- **Completed:** 2026-07-31T07:27:07Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added an explicit source-level guard for the five owned runtime files; its RED run failed on every known raw-white site before production edits.
- Replaced raw white foregrounds with `theme.onPrimary` or `theme.onDestructive` according to the actual solid semantic fill while preserving status labels/icons and soft status boundaries.
- Raised real controls to at least 44pt and added meaningful roles, labels, checked/selected/expanded/disabled/busy state without treating decorative surfaces as touch targets.
- Made Supply Request, Knock, and inspection confirmation content scrollable so Spanish or 200% text cannot hide required actions.
- Preserved work-order creation, offline queueing, inspection submission, reclean triggering, photo capture/upload, callbacks, guards, routing, and payloads.

## Task Commits

Each task was committed atomically with an explicit file scope:

1. **Task 1: Establish the housekeeping/inspection source and target contract** - `d3a8f8ec` (test)
2. **Task 2: Fix housekeeping and inspection semantic foregrounds/targets** - `cb4c9af6` (feat)

## Files Created/Modified

- `apps/mobile/__tests__/components/HousekeepingSemanticOnColor.test.ts` - Explicit source inventory, raw on-color guard, semantic-role assertions, and bounded manual target checklist.
- `apps/mobile/components/housekeeping/SupplyRequestModal.tsx` - Semantic selected checkmark, checkbox state, and scrollable large-text sheet.
- `apps/mobile/components/housekeeping/ReportIssueModal.tsx` - Theme-safe priority on-colors and radio/expanded semantics with 44pt choices.
- `apps/mobile/components/housekeeping/KnockModal.tsx` - Semantic pickup marker foreground and scrollable instruction/CTA layout.
- `apps/mobile/components/housekeeping/ChecklistSection.tsx` - Semantic ready/photo foregrounds plus named 44pt checklist, photo, skip, lost-item, and linen controls.
- `apps/mobile/app/(app)/inspect/index.tsx` - Semantic pass/fail confirmation foregrounds, tab/status/close/checklist semantics, and large-text-safe confirmation sheet.

## Decisions Made

- Solid dirty/failure controls use `theme.onDestructive`; primary, ready, pickup, and clean solid controls use `theme.onPrimary`.
- Soft status actions keep their tested status foreground/soft-fill/line combination, preserving the operational color vocabulary.
- The photo action uses the primary action/on-primary pair because the accent-brass family has no tested solid on-color.
- Large-text fixes add scrolling and minimum sizes only; no workflow, data, or role behavior changed.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- A concurrent Phase 10 edit temporarily introduced a TypeScript error in `ToastProvider.test.tsx`; no 10-07 file appeared in the diagnostic. The parallel edit settled, and the final full type-check passed without changing out-of-scope files.
- Existing React `act(...)` warnings and the expected simulated offline-sync warning remain non-failing test-suite noise; all 395 tests passed.

## Verification

- RED guard: `npx jest __tests__/components/HousekeepingSemanticOnColor.test.ts --runInBand` - failed on all 10 expected assertions before production edits.
- Focused plan suites: 3 suites / 16 tests passed.
- Full mobile suite: 42 suites / 395 tests passed.
- `npm run type-check` - passed.
- `npm run lint` - passed.
- Raw `#fff/#FFFFFF` scan across the five audited runtime files - no matches.
- Diff review - handlers, endpoints, payloads, offline queueing, photo behavior, callbacks, routing, and RBAC remain unchanged.

## Authentication Gates

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The bounded housekeeping/inspection source contract is green and ready for the remaining Phase 10 accessibility regression gates.
- Android 200%-text and TalkBack confirmation remains intentionally part of the later Phase 10 real-device verification plans, not this autonomous source-audit plan.

## Self-Check: PASSED

- All six created/modified plan artifacts and this summary exist.
- Task commits `d3a8f8ec` and `cb4c9af6` resolve as commits.
- The focused suites, full 395-test mobile suite, type-check, lint, source scan, and scoped diff review are green.

---
*Phase: 10-dark-mode-accessibility-qa*
*Completed: 2026-07-31*

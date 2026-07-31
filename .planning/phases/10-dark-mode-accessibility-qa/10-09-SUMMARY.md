---
phase: 10-dark-mode-accessibility-qa
plan: 09
subsystem: mobile-testing
tags: [react-native, jest, accessibility, dark-mode, expo-android]

requires:
  - phase: 10-dark-mode-accessibility-qa
    plans: [03, 04, 05, 06, 07, 08]
    provides: Theme-reactive chrome, appearance controls, shared surfaces, reduced motion, and audited floor controls
provides:
  - Complete app/components/lib source inventory guarding frozen C-token reads and automatic StatusBar mode
  - Cross-primitive light/dark/System accessibility contract for names, roles, states, targets, navigation chrome, banners, badges, and Toasts
  - Green serial mobile regression, TypeScript, lint/i18n, and local Android export evidence
affects: [10-10, 10-11, phase-10-android-verification]

tech-stack:
  added: []
  patterns:
    - Inventory runtime source recursively while keeping explicit compatibility and D-11 exceptions named
    - Exercise semantic control contracts through real theme, Toast, navigation-theme, and reduced-motion providers

key-files:
  created:
    - apps/mobile/__tests__/components/ThemeSourceAudit.test.ts
    - apps/mobile/__tests__/components/AccessibilityContracts.test.tsx
  modified: []

key-decisions:
  - "Keep Copilot content statically bound to darkTheme while separately requiring root and protected navigation chrome to consume the effective app theme."
  - "Treat automated source/render/export results as repeatable release evidence, not as completion of EAS production build, TalkBack, 200% text, or Android device inspection."

patterns-established:
  - "Static guard exceptions are exact and named: tokens compatibility comments and Copilot D-11 darkTheme only."
  - "Release exports use a run-specific output directory whose absolute path is verified before cleanup."

duration: 13min
completed: 2026-07-31
---

# Phase 10 Plan 09: Automated Dark-Mode and Accessibility Gate Summary

**App-wide static theme invariants and real-provider accessibility contracts now protect the complete mobile runtime, with 408 serial tests and a clean 1,372-module Android export.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-07-31T07:35:00Z
- **Completed:** 2026-07-31T07:48:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added a recursive inventory of all TypeScript runtime files beneath `app`, `components`, and `lib`, rejecting frozen `C.*` rendering, automatic StatusBar mode, animated theme switching, token-shape drift, locale-key drift, Copilot D-11 removal, and role-tab duplication in navigation layout.
- Added a real-provider render contract covering explicit Light/Dark, live System rerender, Button busy/disabled state, Profile appearance-selector seam, IconButton and Segmented targets/states, StatusBadge icon+label semantics, OfflineBanner announcements, navigation theme mapping, and reduced-motion Toast final state.
- Passed the complete mobile gate in one final state: 44 Jest suites / 408 tests, TypeScript, lint/i18n, and Android Metro export.
- Exported 1,372 Android modules with 43 assets, one Hermes bundle, and one metadata file (45 files / 8,733,236 bytes), then removed the run-specific output directory and verified it absent.
- Confirmed the implementation diff contains tests only: no workflow, data, routing, RBAC, API, offline, package, lockfile, or runtime dependency changes.

## Task Commits

1. **Task 1: Add app-wide theme-source and accessibility integration guards** - `d912bb76` (test)
2. **Task 2: Run the full mobile and local Android release gates** - `1d87acbc` (chore, explicit-scope evidence commit)

## Files Created/Modified

- `apps/mobile/__tests__/components/ThemeSourceAudit.test.ts` - Runtime source, D-11, chrome, recursive token-shape, Profile seam, role-tabs, and EN/ES parity guards.
- `apps/mobile/__tests__/components/AccessibilityContracts.test.tsx` - Real-provider Light/Dark/System accessibility integration contract.

## Decisions Made

- Copilot's content remains the deliberate D-11 `darkTheme` exception; the root navigation provider, StatusBar, tab bar, header, and Copilot FAB remain theme-reactive.
- Existing `roleTabs.test.ts` remains the role/tab-order authority. The new audit verifies that protected layout delegates to that module instead of recreating role logic.
- The local Expo export is evidence for Android bundling only. DARK-04's EAS production build and rendered Android/TalkBack/200% matrix remain open for 10-10.

## Verification

- `npx jest __tests__/components/ThemeSourceAudit.test.ts __tests__/components/AccessibilityContracts.test.tsx --runInBand` - **PASS (2/2 suites, 13/13 tests)**.
- `npm test -- --runInBand` - **PASS (44/44 suites, 408/408 tests, 0 failures)**.
- `npm run type-check` - **PASS**.
- `npm run lint` - **PASS**, including the repository i18n literal-string gate.
- `npx expo export --platform android --output-dir .expo-export-10-09` - **PASS**; 1,372 modules, 43 assets, one Android Hermes bundle, one metadata file.
- Export inventory - **45 files / 8,733,236 bytes**.
- Run-specific cleanup - **PASS**; `.expo-export-10-09` no longer exists.
- `git diff --check d912bb76^ d912bb76` - **PASS**.
- Explicit two-file diff and dependency review - **PASS**; test-only, no runtime or package changes.

## Warnings and Boundaries

- Full Jest remains green but prints pre-existing React `act(...)` warnings from `WorkOrdersList`, `ReportIssueModal`, and `RoomDetailSheet`, plus the expected simulated network-failure warning from offline sync. These warnings predate 10-09 and are already represented in OpenWolf/deferred tracking.
- Directly invoking ESLint on the two test paths reports that tests are outside the configured lint match; the required project command `npm run lint` passes cleanly.
- No EAS cloud build, emulator/device rendering, TalkBack order, 200% text scaling, bilingual visual fit, or offline/reconnect device walkthrough is claimed here.

## Deviations from Plan

### Operational Cleanup Deviation

**1. Removed a pre-existing ignored Expo `dist` directory**

- **Found during:** Task 2 final artifact review.
- **Issue:** An ignored `apps/mobile/dist` directory from 2026-06-06 (56 generated files) existed before this run. It was mistakenly interpreted as a generated-output closeout violation and removed with an exact, previewed `git clean -fdX -- apps/mobile/dist` immediately before the orchestrator's preservation message arrived.
- **Impact:** No source-controlled, dirty, workflow, data, or user-authored project file was touched. The exact old ignored output is not Git-recoverable. A new current Expo export can reproduce the artifact class, but it was intentionally not regenerated because that would replace rather than preserve the old contents.
- **Follow-up:** No further cleanup occurred outside the run-specific `.expo-export-10-09` path. OpenWolf records `bug-820` and a Do-Not-Repeat rule requiring pre-run output inventory and run-specific cleanup only.
- **Commit:** None; ignored generated output is outside Git.

---

**Total deviations:** 1 operational cleanup deviation, not an implementation scope change.  
**Impact on plan:** Automated product evidence remains valid and the committed diff remains test-only; the deleted ignored artifact is transparently disclosed.

## Issues Encountered

- The first accessibility-contract iterations used RNTL composite traversal and private Animated test representations incorrectly. Queries were narrowed to host accessibility roles, animation values were normalized across numeric/`Animated.Value` representations, and React Native subscription mocks were typed through their public return boundary. Focused Jest and TypeScript both pass after the corrections.
- The full regression sequence itself had no failure after Task 1 was committed.

## User Setup Required

None - no external service, environment variable, dependency, or package change was introduced.

## Next Phase Readiness

- Automated Phase 10 integration is green and repeatable.
- Plan 10-10 must still complete the EAS Android production build and the real Android light/dark, EN/ES, role-shell, TalkBack, 200% text, reduced-motion, and offline/reconnect walkthrough. This plan does not satisfy or bypass that gate.

## Self-Check: PASSED

- Both required guard artifacts and this summary exist.
- Task commits `d912bb76` and `1d87acbc` resolve as commits.
- No failure marker or false EAS/device pass claim appears in this summary.

---
*Phase: 10-dark-mode-accessibility-qa*
*Completed: 2026-07-31*

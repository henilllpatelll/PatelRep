---
phase: 10-dark-mode-accessibility-qa
plan: 02
subsystem: mobile-ui-accessibility
tags: [react-native, wcag-aa, dark-mode, design-tokens, jest, tdd]

requires:
  - phase: 07-theme-foundation-primitives
    provides: Reactive light/dark theme resolver and shared mobile primitives
  - phase: 08-floor-role-rollout
    provides: Protected room/work-order status meaning and non-color cues
  - phase: 09-remaining-screens-rollout
    provides: Migrated screen token usage and Copilot D-11 dark presentation
provides:
  - Deterministic hex/RGBA parsing, sRGB compositing, luminance, and WCAG contrast helpers
  - Named 4.5:1 text and 3:1 essential-control/boundary contracts for shared mobile tokens
  - Contrast-safe per-mode shells, on-colors, Toast/banner roles, and status families
  - Dedicated purple in-progress semantics in both light and dark modes
affects: [10-03, 10-04, 10-05, 10-06, 10-07, 10-08, 10-09, 10-11]

tech-stack:
  added: []
  patterns:
    - Measure translucent roles only after compositing them over their declared surface
    - Resolve on-colors and operational status foregrounds independently per theme

key-files:
  created:
    - apps/mobile/__tests__/helpers/contrast.ts
  modified:
    - apps/mobile/components/shared/tokens.ts
    - apps/mobile/__tests__/components/MobileVisualTokens.test.ts
    - apps/mobile/jest.config.js

key-decisions:
  - "Preserve the existing light Evening Lobby shell while using a visibly deeper warm-charcoal shell in dark mode."
  - "Keep operational status meanings fixed by hue, but use separate contrast-safe foreground and line values per mode."
  - "Use semantic onPrimary/onDestructive/onDisabled/onAi and Toast/banner foreground roles instead of universal white."

patterns-established:
  - "Visible composite first: RGBA soft fill over the real surface, then foreground/border contrast."
  - "Theme parity: lightTheme and darkTheme expose identical semantic key shapes."

duration: 10min
completed: 2026-07-31
---

# Phase 10 Plan 02: Composited WCAG Token Contract Summary

**WCAG AA is now a deterministic mobile semantic-token contract, including correctly composited translucent status fills and mode-specific Evening Lobby roles.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-07-31T06:40:19Z
- **Completed:** 2026-07-31T06:51:05Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added a dependency-free contrast helper covering 3/6/8-digit hex, `rgb/rgba`, alpha compositing, relative luminance, and unrounded WCAG ratios.
- Turned 64 initial failures/missing roles into 110 passing named assertions across content, navigator chrome, actions, boundaries, overlays, all operational statuses, and Copilot D-11.
- Preserved warm `#0F0D0B` dark layers, forest-green actions, and the universal status mapping while adding a dedicated purple in-progress family.
- Exported `ThemeTokens` from `getThemeTokens()` and aligned light/dark theme key shapes.

## Task Commits

1. **Task 1 (RED): Add a failing composited WCAG token contract** — `3026502a` (test)
2. **Task 2 (GREEN): Tune semantic tokens without changing status meaning** — `527b502a` (feat)

## Files Created/Modified

- `apps/mobile/__tests__/helpers/contrast.ts` — deterministic color parsing, compositing, luminance, and contrast math.
- `apps/mobile/__tests__/components/MobileVisualTokens.test.ts` — named 4.5:1/3:1 production pairing contracts and protected identity checks.
- `apps/mobile/components/shared/tokens.ts` — per-mode shells/on-colors/overlays, aligned theme shapes, and AA-safe operational status roles.
- `apps/mobile/jest.config.js` — ignores reusable helper modules as standalone suites while they remain unit-tested by the token suite.

## Final Contrast Ratios

Ratios are unrounded during assertions; the two-decimal values below are reporting-only.

### Text, shell, actions, and boundaries

| Mode | Pair | Final ratio(s) |
| --- | --- | --- |
| Light | Secondary text / background, surface, subtle, muted, elevated | 5.10, 5.63, 5.43, 4.81, 5.71 |
| Light | Muted text / background, surface, subtle, muted, elevated | 5.36, 5.93, 5.71, 5.06, 6.01 |
| Light | Disabled text / background, surface | 5.36, 5.93 |
| Dark | Muted text / background, surface, subtle, muted, elevated | 6.45, 6.04, 6.25, 4.94, 5.41 |
| Dark | Disabled text / background, surface | 6.45, 6.04 |
| Light | Inactive shell text; shell boundary | 5.27; 3.07 |
| Dark | Inactive shell text; shell boundary | 5.85; 3.02 |
| Light | Primary, pressed, disabled-composite, destructive, AI actions | 4.93, 7.49, 4.93, 6.39, 5.70 |
| Dark | Primary, pressed, disabled-composite, destructive, AI actions | 6.66, 5.98, 7.70, 6.64, 6.70 |
| Light | Card, sheet/modal, selected boundaries | 3.35, 3.70, 3.82 |
| Dark | Card, sheet/modal, selected boundaries | 3.54, 3.31, 3.88 |

### Toast and OfflineBanner pairings

Each row reports **foreground/fill**, **fill/surrounding surface**, and **border/fill**.

| Mode | Role | Final ratios |
| --- | --- | --- |
| Light | Success Toast | 6.38, 6.38, 4.64 |
| Light | Error Toast | 7.76, 7.76, 4.35 |
| Light | Info Toast | 6.92, 6.92, 4.65 |
| Light | OfflineBanner | 8.15, 7.27, 4.57 |
| Dark | Success Toast | 7.03, 6.28, 3.77 |
| Dark | Error Toast | 6.64, 5.73, 3.97 |
| Dark | Info Toast | 7.46, 6.63, 3.59 |
| Dark | OfflineBanner | 5.75, 5.91, 3.81 |

### Operational status composites

Each row reports **foreground/composited soft fill** and **meaningful border/composited soft fill**.

| Status | Light | Dark |
| --- | --- | --- |
| Ready / inspected | 4.62, 4.62 | 8.09, 8.09 |
| Clean / inspection-ready | 5.63, 5.63 | 6.97, 6.97 |
| In progress (purple) | 6.09, 6.09 | 7.27, 7.27 |
| Vacant dirty | 4.97, 4.97 | 6.48, 6.48 |
| Occupied (striped red contract unchanged) | 4.97, 4.97 | 6.48, 6.48 |
| Pickup | 5.38, 5.38 | 7.00, 7.00 |
| OOO/OOS stone | 5.44, 5.44 | 6.99, 6.99 |

### Copilot D-11 dark-only pairings

| Pair | Final ratio |
| --- | --- |
| Body text / canvas | 16.60 |
| Secondary text / bubble | 8.79 |
| AI action | 6.70 |
| AI boundary | 3.73 |
| Confirmation / composited ready fill | 8.09 |

## Decisions Made

- The light shell retains PatelRep's established charcoal frame; the dark shell moves to deeper warm `#090806/#13110F/#1B1814` layers instead of neutral black or blue-gray.
- Light status hues were darkened only where their soft-fill pairing failed; dark statuses received brighter same-hue foreground/line values while retaining the existing RGBA soft fills.
- Meaningful borders use explicit contrast-safe roles. Decorative `borderSubtle` remains available and is not misrepresented as an essential boundary.
- `C` remains a temporary light compatibility export; no new runtime consumer was added.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Excluded reusable test helpers from Jest suite discovery**

- **Found during:** Task 2 integrated verification
- **Issue:** The repository's broad `testMatch` collected the plan-required `__tests__/helpers/contrast.ts` module as an empty suite, failing the otherwise-green full run.
- **Fix:** Added a narrow `testPathIgnorePatterns` entry for `__tests__/helpers/`; helper behavior remains independently exercised inside `MobileVisualTokens.test.ts`.
- **Files modified:** `apps/mobile/jest.config.js`
- **Verification:** Full mobile suite passes 34/34 suites and 298/298 tests.
- **Committed in:** `527b502a`

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** The fix only corrects Jest discovery for the exact helper location required by the plan; runtime behavior and test coverage are unchanged.

## Issues Encountered

- RED correctly exposed 64 failures/missing roles. One GREEN iteration left only the two shell boundaries below 3:1 (2.85 and 2.70); minimally lightening the warm shell line tokens raised them to 3.07 and 3.02.
- The full suite emits pre-existing React `act(...)` warnings in bare-render/hydration tests and a deliberate offline-sync warning; all 298 tests pass. The concurrent 10-01 executor recorded the actionable pre-existing warning in the shared deferred-items file.

## User Setup Required

None — no external service configuration or dependency was added.

## Verification

- `npx jest __tests__/components/MobileVisualTokens.test.ts --runInBand` — **PASS (110/110)**
- `npm test -- --runInBand` — **PASS (34/34 suites, 298/298 tests)**
- `npm run type-check` — **PASS**
- `npm run lint` — **PASS**
- `apps/mobile/coverage` — **absent**

## Next Phase Readiness

- Plans 10-03 through 10-08 can consume the shared semantic on-colors, shell roles, overlay roles, `ThemeTokens`, and dedicated `status.inProgress` family.
- Rendered Android inspection remains mandatory later in Phase 10; automated token ratios supplement rather than replace device verification.

## Self-Check: PASSED

- All four implementation/test artifacts and this summary exist.
- RED commit `3026502a` and GREEN commit `527b502a` resolve as Git commits.
- Final focused, integrated, type, and lint gates are green.

---
*Phase: 10-dark-mode-accessibility-qa*
*Completed: 2026-07-31*

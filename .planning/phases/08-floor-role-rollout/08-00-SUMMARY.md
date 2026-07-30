---
phase: 08-floor-role-rollout
plan: 00
subsystem: ui
tags: [react-native, expo, theme, design-tokens]

# Dependency graph
requires:
  - phase: 07-theme-foundation-primitives
    provides: reactive lightTheme/darkTheme objects, getThemeTokens(mode), useTheme() hook
provides:
  - textDisabled, accentBrassSoft, accentBrassLine keys on both lightTheme and darkTheme
affects: [08-01, 08-02, 08-03, 08-04, 08-05, 08-06, 08-07, 08-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Promote flat-C-object-only literal colors into lightTheme/darkTheme when a screen migration needs useTheme() to reach them"
    - "Dark-mode soft/line accent variants follow the alpha-fill rgba pattern already used by darkStatusTokens/darkAiTokens"

key-files:
  created: []
  modified:
    - apps/mobile/components/shared/tokens.ts

key-decisions:
  - "Kept the flat C compatibility object completely untouched (byte-for-byte) — this task only adds new theme keys, does not migrate or delete anything"
  - "Dark textDisabled uses #6E685E (a dimmer tier below darkTheme.textMuted #918A7E) since no direct literal precedent existed in dark mode"

patterns-established:
  - "New theme keys are added immediately after accentClay in both lightTheme and darkTheme to keep the accent-family keys grouped"

requirements-completed: [FLOOR-01, FLOOR-02, FLOOR-03, FLOOR-04, FLOOR-05]

# Metrics
duration: 15min
completed: 2026-07-29
---

# Phase 8 Plan 00: Theme Token Unblock Summary

**Added `textDisabled`, `accentBrassSoft`, `accentBrassLine` to `lightTheme`/`darkTheme` so `useTheme()` can reach the three colors that previously existed only as hardcoded literals in the flat `C` compatibility object.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-29T17:40:02-05:00
- **Tasks:** 1 completed
- **Files modified:** 1

## Accomplishments
- `lightTheme` now exposes `textDisabled: "#B7AA99"`, `accentBrassSoft: "#F4E7C6"`, `accentBrassLine: "#E2C679"` — exact hex matches for `C.ink4`/`C.brassSoft`/`C.brassLine`.
- `darkTheme` now exposes `textDisabled: "#6E685E"`, `accentBrassSoft: "rgba(208, 168, 90, 0.20)"`, `accentBrassLine: "rgba(208, 168, 90, 0.40)"`, following the existing alpha-fill convention used by `darkStatusTokens`/`darkAiTokens`.
- Flat `C` object and every other pre-existing key in `tokens.ts` verified unchanged (grep-asserted per acceptance criteria).
- Unblocks every Wave 1-5 screen/component migration in this phase that references `C.ink4`, `C.brassSoft`, or `C.brassLine`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add textDisabled + brass soft/line keys to lightTheme and darkTheme** - `323ea7bb` (feat)

## Files Created/Modified
- `apps/mobile/components/shared/tokens.ts` - Added 3 new keys to both `lightTheme` and `darkTheme` accent blocks; no other changes.

## Decisions Made
- None beyond what the plan specified. Exact hex/rgba values were dictated by the plan's `<action>` block (light mode: exact literal matches; dark mode: alpha-fill pattern already established by `darkStatusTokens`/`darkAiTokens`).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The worktree had no `node_modules` installed under `apps/mobile` or at the repo root (git worktrees don't carry untracked/gitignored directories). Rather than running a fresh `npm install` (slow, network-dependent, and would produce a redundant copy), created Windows directory junctions (`apps/mobile/node_modules` and `node_modules` at repo root) pointing at the already-installed `node_modules` in the main checkout (`C:\Users\Henil\projects\PatelRep`). This is a local, untracked, gitignored filesystem link only — it does not touch git history, does not modify the main checkout, and was verified not to appear in `git status`. Both `npx jest MobileVisualTokens.test.ts` and `npm run type-check` ran and passed through this link.

The plan's `08-PATTERNS.md` context reference does not exist yet in the phase directory (only `08-CONTEXT.md`, `08-RESEARCH.md`, `08-VALIDATION.md`, `08-DISCUSSION-LOG.md`, and the `08-0N-PLAN.md` files were present) — this is plan 00, the first plan in the phase, so no prior-plan pattern doc exists yet. Not a blocker; the plan's own `<interfaces>` block provided everything needed for this single-file, additive task.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`useTheme()` (via `getThemeTokens`) now returns `textDisabled`, `accentBrassSoft`, `accentBrassLine` in both light and dark mode. Every subsequent Phase 8 plan (08-01 through 08-08) migrating a floor screen or shared component can now route `C.ink4` → `theme.textDisabled`, `C.brassSoft` → `theme.accentBrassSoft`, `C.brassLine` → `theme.accentBrassLine` without any further token-layer work. No blockers for Wave 1.

---
*Phase: 08-floor-role-rollout*
*Completed: 2026-07-29*

---
phase: 07-theme-foundation-primitives
plan: 03
subsystem: ui
tags: [react-native, expo, design-tokens, theming, mobile]

# Dependency graph
requires:
  - phase: 07-01
    provides: "useTheme()/ThemeProvider reactive theme shell around tokens.ts"
provides:
  - "General-purpose Button primitive (components/ui/Button.tsx): 4 variants, 3 sizes, no-layout-shift loading"
  - "IconButton theme-wired to useTheme() with byte-identical light-mode colors across all 13 tones"
  - "IconButton optional accessibilityLabel prop for future touch-target remediation"
affects: [08-floor-role-screens, 09-remaining-screens]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Primitives resolve colors only through useTheme(), never import C/lightTheme/darkTheme directly"
    - "Style merge order: styles.base first, variant/size styles next, caller style prop last"
    - "No-layout-shift loading: opacity:0 label (reserves space) + absolutely positioned ActivityIndicator"
    - "Per-component theme-derived color maps (IconButton) built at render time, not module scope, when the source constant is theme-reactive"

key-files:
  created: [apps/mobile/components/ui/Button.tsx]
  modified: [apps/mobile/components/shared/mobileHandoff.tsx]

key-decisions:
  - "IconButton's module-level toneColors (C.*-based) was kept in place rather than deleted, since getToneColors(), Pill, and RoomNumberTile still reference it — only IconButton itself now builds its own theme-derived map"
  - "IconButton's accessibilityLabel kept optional (not required) so all 8 existing call sites remain untouched — required promotion deferred to Phase 8 once call sites migrate"

patterns-established:
  - "Pattern 1: New general-purpose primitives (Button) live in components/ui/ and consume useTheme() exclusively"
  - "Pattern 2: In-place theme-wiring of an existing shared primitive (IconButton) preserves structure/props surface and only swaps the color-resolution source"

requirements-completed: [UI-01]

# Metrics
duration: ~25min
completed: 2026-07-29
---

# Phase 7 Plan 3: Button Primitive & IconButton Theme-Wire Summary

**New general-purpose `Button` primitive (4 variants x 3 sizes, no-layout-shift loading, theme-only colors) plus in-place theme-wiring of the existing `IconButton` in `mobileHandoff.tsx` to `useTheme()`, with all 13 tones verified byte-identical to their prior `C.*`-derived light-mode values.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-29 (session start, after fast-forwarding worktree branch onto main to pick up Wave 1 output)
- **Completed:** 2026-07-29T06:29:57Z
- **Tasks:** 2/2 completed
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Created `apps/mobile/components/ui/Button.tsx`: `Pressable`-based primitive with `primary`/`secondary`/`ghost`/`destructive` variants and `sm`/`md`/`lg` sizes (minHeight 44/48/56 respectively — all meet the touch-target floor), a no-layout-shift loading state (opacity-hidden label + absolutely-positioned `ActivityIndicator`), and colors sourced exclusively via `useTheme()`.
- Theme-wired `IconButton` in `mobileHandoff.tsx` so all 13 tones resolve through a render-time `useTheme()`-derived map instead of the static `C.*` snapshot, with every tone's `bg`/`fg`/`line` verified byte-identical to its prior light-mode value (including the critical `neutral.bg = theme.surfaceMuted`, not `theme.surface`, check — the default tone used by all 8 existing call sites).
- Added an optional `accessibilityLabel` prop to `IconButton` without breaking any of the 8 existing call sites (none pass it today, none were edited).

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the Button primitive** - `2f872ab3` (feat)
2. **Task 2: Theme-wire IconButton in mobileHandoff.tsx** - `fe625243` (feat)

**Plan metadata:** this commit (docs: complete plan) — orchestrator-owned, not created by this executor per instructions.

## Files Created/Modified
- `apps/mobile/components/ui/Button.tsx` - New general-purpose Button primitive (variants/sizes/loading), consumes `useTheme()` only.
- `apps/mobile/components/shared/mobileHandoff.tsx` - `IconButton` now resolves its 13 tones via a `useTheme()`-derived map (built inside the component); added optional `accessibilityLabel` prop; module-level `toneColors` (still used by `getToneColors`/`Pill`/`RoomNumberTile`) and all other exports (`HeroButton`, `Pill`, `Segmented`, `Avatar`, `Mono`, `AILabel`, etc.) left untouched.

## Decisions Made
- Kept the module-level `C.*`-based `toneColors` const in `mobileHandoff.tsx` in place (per plan instruction #4) because `getToneColors()`, `Pill`, and `RoomNumberTile` still reference it — deleting it would have broken those exports. `IconButton` now builds and uses its own theme-derived map locally instead.
- `IconButton`'s new `accessibilityLabel` prop is optional, not required, specifically to avoid forcing edits to the 8 existing call sites (SC5 zero-visual-change / zero-forced-edit constraint).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing `apps/mobile` npm dependencies**
- **Found during:** Task 1 verification (`npx tsc --noEmit`)
- **Issue:** `apps/mobile/node_modules` did not exist in this worktree (root `node_modules` also had stale/mismatched versions — e.g. root `package.json` pins `expo@^46`/`@types/react@~18` while `apps/mobile/package.json` correctly pins `expo@~54`/`@types/react@~19`). Without `apps/mobile`'s own install, `tsc` could not resolve `@expo/vector-icons` (46 pre-existing occurrences of this error across the codebase, confirming it was an environment gap, not a code defect) and reported spurious `gap` style-prop errors from an unrelated, older React Native type version.
- **Fix:** Ran `npm install --no-audit --no-fund --legacy-peer-deps` inside `apps/mobile` (919 packages added, no lockfile drift — `node_modules/` is gitignored, `package-lock.json` unchanged in git status).
- **Files modified:** None tracked in git (only `apps/mobile/node_modules/`, which is gitignored).
- **Verification:** `cd apps/mobile && npx tsc --noEmit` went from ~1384 errors (spread across dozens of pre-existing files, none caused by this plan's changes) to 0 errors after install.
- **Committed in:** N/A — no trackable file changes; node_modules is gitignored.

---

**Total deviations:** 1 auto-fixed (1 blocking/environment)
**Impact on plan:** Required to actually run the plan's mandated `npx tsc --noEmit` verification command. No scope creep — no application code was touched by this fix.

## Issues Encountered
- The worktree branch (`worktree-agent-aae22d38509b7f1d1`) was created before Phase 7's plan files (07-01 through 07-06, CONTEXT, PATTERNS, UI-SPEC) and Wave 1's `useTheme()`/`ThemeProvider` output landed on `main`. Fast-forwarded the worktree branch onto `main` (`git merge main --ff-only`) to pick up those files before starting — a clean fast-forward with no conflicts, since the worktree branch had no local commits yet.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `Button` is available for Phase 8/9 screen migrations (not adopted by any screen this phase, per D-05/scope).
- `IconButton` is dark-mode-ready (reads `useTheme()`) with zero visual change in light mode — confirmed via per-tone grep assertions below.
- Flag for Phase 8 planner: any screen adopting `IconButton` in a touch-target-sensitive context should pass both `accessibilityLabel` and `size={44}` or greater; `accessibilityLabel` may be promoted to required once all call sites migrate.
- No blockers for Wave 2 siblings (07-02, 07-04) — this plan touched only `components/ui/Button.tsx` (new file) and the `IconButton` function inside `mobileHandoff.tsx` (non-overlapping with their file sets per orchestrator's parallel-safety guarantee).

## Acceptance Criteria Verification (from 07-03-PLAN.md)

**Task 1 (Button):**
- `useTheme` referenced; `C.`/`lightTheme`/`darkTheme` never imported — PASS
- All three `minHeight: 44/48/56` present — PASS
- `ActivityIndicator` present; `opacity: 0` present (label hidden while loading) — PASS
- `theme.status.dirty` used for destructive fill (not inline hex) — PASS
- `styles.base` starts the merge array, caller `style` prop ends it — PASS
- No `t(` call (no internal translation / no English default) — PASS
- `npx tsc --noEmit` clean — PASS (0 errors after dependency install)

**Task 2 (IconButton theme-wire) — the 13-tone byte-identical check:**
- `useTheme` referenced inside `IconButton` — PASS
- `accessibilityLabel` present and optional (`accessibilityLabel?:`) — PASS
- `size = 36` default unchanged — PASS
- `HeroButton`/`Pill`/`Segmented` exports still present and untouched — PASS
- Per-tone byte-identical regex assertions, ALL 13 tones (neutral, dirty, occupied, progress, clean, ready, pickup, accent, ai, alert, caution, info, ooo) matched exactly as specified in the plan's mapping table, including the critical `neutral.bg = theme.surfaceMuted` (not `theme.surface`) default-tone check and the `accent`/`ai` non-status-key checks — ALL PASS (verified individually via grep, see Task Commits above)
- Tone-key count check (`≥13`) — PASS (26 total: 13 in the untouched module-level `C.*` map + 13 in the new `IconButton`-local `theme.*` map)
- All 8 existing `IconButton` call sites (`SupervisorHome.tsx:179`, `notifications/index.tsx:112`, `lost-found/index.tsx:143`, `home/index.tsx:155,273,330`, `sop/index.tsx:79,95`) verified byte-identical/unedited — PASS
- `npx tsc --noEmit` clean — PASS (0 errors)

**CONFIRMED: The 13-tone byte-identical check passed in full** — every IconButton tone (`neutral`, `dirty`, `occupied`, `progress`, `clean`, `ready`, `pickup`, `accent`, `ai`, `alert`, `caution`, `info`, `ooo`) resolves through `useTheme()` to the exact same light-mode hex/rgba value it resolved to via the old static `C.*` snapshot, with zero visible regression across all 8 existing call sites.

---
*Phase: 07-theme-foundation-primitives*
*Completed: 2026-07-29*

## Self-Check: PASSED

- FOUND: `apps/mobile/components/ui/Button.tsx`
- FOUND: `apps/mobile/components/shared/mobileHandoff.tsx`
- FOUND: `.planning/phases/07-theme-foundation-primitives/07-03-SUMMARY.md`
- FOUND commit: `2f872ab3` (Task 1: Button primitive)
- FOUND commit: `fe625243` (Task 2: IconButton theme-wire)
- FOUND commit: `1028b8bd` (docs: SUMMARY)

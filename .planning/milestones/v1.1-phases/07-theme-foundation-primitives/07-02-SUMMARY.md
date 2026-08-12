---
phase: 07-theme-foundation-primitives
plan: 02
subsystem: ui
tags: [react-native, expo, toast, animated, panresponder, theme]

# Dependency graph
requires:
  - phase: 07-01
    provides: "useTheme()/ThemeProvider theme shell (apps/mobile/lib/theme/useTheme.ts, ThemeProvider.tsx)"
provides:
  - "ToastProvider + useToast() app-wide non-blocking feedback channel for authed mobile screens"
  - "ToastViewport mounted below OfflineBanner in app/(app)/_layout.tsx"
affects: [phase-08-floor-role-rollout, phase-09-remaining-screens-rollout]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Toast built from core RN Animated + PanResponder only (zero new npm deps)"
    - "Single-toast-replace model (no queue) via a monotonic id ref"
    - "Provider split into ToastActionsContext (stable show fn) + ToastStateContext (toast/dismiss) to avoid re-rendering consumers of useToast() on every toast change"

key-files:
  created:
    - apps/mobile/lib/theme/ToastProvider.tsx
    - apps/mobile/lib/theme/useToast.ts
  modified:
    - apps/mobile/app/(app)/_layout.tsx

key-decisions:
  - "Split ToastProvider's context into two contexts (actions vs. state) so useToast() callers don't re-render on every toast open/close."
  - "OfflineBanner height measured via onLayout (not hardcoded) so the toast viewport sits flush below it whether online or offline (D-01)."

patterns-established:
  - "Toast fill colors always resolve from useTheme() (theme.status.ready/dirty, theme.shell.bg) — never inline hex."
  - "Primitives/providers never call t() internally — caller owns translation (i18n floor contract)."

requirements-completed: [THEME-02]

# Metrics
duration: ~25min
completed: 2026-07-29
---

# Phase 7 Plan 02: Toast System Summary

**App-wide `ToastProvider`/`useToast()` built from core React Native `Animated` + `PanResponder` (zero new deps), mounted below `OfflineBanner` in the authed `(app)` layout.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 completed
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `ToastProvider` + `ToastViewport` (Animated enter/exit, PanResponder swipe-to-dismiss) with a single-toast-replace model (D-03)
- `useToast()` hook exposing `{ success, error, info }`, each taking an already-translated string (D-04)
- `ToastViewport` mounted directly below the measured `OfflineBanner` height, offset by `insets.top`, inside `app/(app)/_layout.tsx` — never overlaps the banner (D-01)
- Auto-dismiss timing: 3000ms success/info, 5000ms error (D-02); swipe past 80px dismisses early
- Zero new npm dependencies; role-tab logic and tab-bar chrome in `(app)/_layout.tsx` left untouched

## Task Commits

1. **Task 1: Build ToastProvider (queue + Animated viewport) and useToast** - `8ec686fb` (feat)
2. **Task 2: Mount ToastProvider + viewport below OfflineBanner in the (app) layout** - `0d739909` (feat)

## Files Created/Modified
- `apps/mobile/lib/theme/ToastProvider.tsx` - `ToastProvider` + `ToastViewport`, core-RN Animated/PanResponder toast implementation, colors from `useTheme()`
- `apps/mobile/lib/theme/useToast.ts` - `useToast()` hook exposing `success`/`error`/`info`
- `apps/mobile/app/(app)/_layout.tsx` - wraps the authed tree in `ToastProvider`, measures `OfflineBanner` height via `onLayout`, mounts `ToastViewport` with computed `topOffset`

## Decisions Made
- Split the toast context into two contexts (`ToastActionsContext` for the stable `show` function, `ToastStateContext` for the current toast + `dismiss`) rather than one combined context, so `useToast()` callers (which only need `show`) don't re-render whenever a toast opens/closes. This is an implementation detail not specified by the plan but consistent with its "memoize the context value" instruction and the codebase's Pitfall-5 provider-re-render-churn guidance.
- Everything else followed the plan exactly: timing, threshold, colors, container styling, motion, and layout wiring all match the plan's literal specification.

## Deviations from Plan

None — plan executed exactly as written. One documentation note, not a code deviation:

- The plan's Task 1 acceptance criterion `grep -n "t(" apps/mobile/lib/theme/ToastProvider.tsx` returns nothing" is a naive substring check that also matches unrelated code containing the two-character sequence `t(` (e.g. `setTimeout(`, `clearTimeout(`, `useContext(`, `.start(`). Those matches are present in the file, but there is no `useTranslation()`/`t()` i18n call anywhere in `ToastProvider.tsx` — verified by manual inspection, satisfying the actual intent behind D-04 (Toast never translates internally). No code change was made to chase this literal grep, since doing so would mean avoiding standard RN API names like `setTimeout`.

## Issues Encountered

- This worktree's git branch (`worktree-agent-aabc954161b6dcb94`) was created from an older `main` commit that predated the Phase 7 planning and Wave-1 (07-01) work, so `.planning/phases/07-theme-foundation-primitives/` and `apps/mobile/lib/theme/{ThemeProvider,useTheme}.tsx` were initially missing from the worktree. Resolved with a fast-forward `git merge main --ff-only` (no unique commits existed on the worktree branch, so this was a safe, non-destructive fast-forward) before starting Task 1.
- This worktree had no `apps/mobile/node_modules` installed (fresh worktree checkout, `node_modules` is gitignored), which made `@expo/vector-icons` and every other dependency unresolvable for `npx tsc --noEmit` — a pre-existing, environment-wide condition affecting all mobile files, not something introduced by this plan. Resolved for verification purposes only by creating a Windows directory junction from this worktree's `apps/mobile/node_modules` to the main checkout's already-installed `apps/mobile/node_modules` (junction, not a copy or commit — `node_modules` remains gitignored and untouched in git history).

## Next Phase Readiness
- `useToast()` is available to every authed screen starting Phase 8; no screen calls it yet (adoption is out of scope for this plan, per the plan's own `<verification>` block).
- `apps/mobile/package.json` has zero new dependencies (confirmed via `git diff HEAD apps/mobile/package.json` — empty).

---
*Phase: 07-theme-foundation-primitives*
*Completed: 2026-07-29*

## Self-Check: PASSED

- FOUND: apps/mobile/lib/theme/ToastProvider.tsx
- FOUND: apps/mobile/lib/theme/useToast.ts
- FOUND commit 8ec686fb (Task 1)
- FOUND commit 0d739909 (Task 2)

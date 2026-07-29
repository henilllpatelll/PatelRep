---
phase: 07-theme-foundation-primitives
plan: 01
subsystem: mobile-theme
tags: [theme, provider, hook, mobile, foundation, THEME-01]
requires: []
provides:
  - "apps/mobile/lib/theme/useTheme.ts (useTheme hook)"
  - "apps/mobile/lib/theme/ThemeProvider.tsx (ThemeProvider + useThemeMode)"
  - "ThemeProvider mounted at app root in apps/mobile/app/_layout.tsx"
affects:
  - "apps/mobile/app/_layout.tsx"
tech-stack:
  added: []
  patterns:
    - "React Context provider for theme mode (first Context provider in apps/mobile)"
    - "useColorScheme() read but unused (Phase 10 hook point); mode pinned to light"
    - "Memoized context value (Pitfall 5) to avoid re-render churn over auth/NetInfo effects"
key-files:
  created:
    - apps/mobile/lib/theme/ThemeProvider.tsx
    - apps/mobile/lib/theme/useTheme.ts
  modified:
    - apps/mobile/app/_layout.tsx
decisions:
  - "Mode pinned to 'light' unconditionally this phase (THEME-01); useColorScheme() call kept present so Phase 10 needs no structural change"
  - "Theme not wired into appStore/AsyncStorage this phase — pure in-memory context"
metrics:
  duration: "~10 min"
  completed: "2026-07-29"
  tasks: 2
  files: 3
---

# Phase 7 Plan 01: Theme Shell Summary

JWT-free, in-memory `ThemeProvider` + `useTheme()` shell wrapping the pre-existing `tokens.ts` data, mounted at the mobile app root, resolving to `lightTheme` unconditionally so no existing screen changes visually.

## What Was Built

**Task 1 — `ThemeProvider.tsx` + `useTheme.ts`** (commit `d467fdfc`)
- `apps/mobile/lib/theme/ThemeProvider.tsx`: a `ThemeModeContext` holding `{ mode: ThemeMode }`, the `ThemeProvider` component, and a `useThemeMode()` hook that throws if used outside the provider. `useColorScheme()` is read inside the component (assigned to `_systemScheme`, unused this phase) so Phase 10 can flip to the OS scheme with no structural change. Mode is pinned to `"light"` (THEME-01). Context value is memoized with `useMemo` (Pitfall 5).
- `apps/mobile/lib/theme/useTheme.ts`: `useTheme()` reads `useThemeMode()` and returns `getThemeTokens(mode)` inside a `useMemo`. Returns the existing `lightTheme`/`darkTheme` object shape — no new keys invented.

**Task 2 — Mount at root** (commit `7a82b22a`)
- `apps/mobile/app/_layout.tsx`: added `import { ThemeProvider } from "@/lib/theme/ThemeProvider";` and replaced the top-level `<>` fragment with `<ThemeProvider>` as a sibling wrapper above `<Stack>`. All five `useEffect` blocks (auth `onAuthStateChange`, splash hide, safety timeout, NetInfo→`syncOnConnect`, notification deep-link) and `<StatusBar style="auto" />` are byte-identical to before — pure JSX-wrapper insertion, no logic or dep-array changes.

## Verification

- `cd apps/mobile && npx tsc --noEmit` — clean, no new errors (run after each task).
- `grep -c "useMemo" ThemeProvider.tsx` → 2 (context value memoized; `useTheme` also memoizes).
- `grep -rn "appStore\|AsyncStorage" apps/mobile/lib/theme/` → no matches (no persistence coupling this phase).
- Effect-call count in `_layout.tsx` unchanged: 5 `useEffect(() =>` blocks; `syncOnConnect`, `onAuthStateChange`, `NetInfo.addEventListener`, and `StatusBar style="auto"` all still present.

## Deviations from Plan

None — plan executed exactly as written.

## Acceptance Criteria

- [x] `useTheme()` importable/callable app-wide, returns the light theme object this phase (ROADMAP SC1).
- [x] Zero visual change on any existing screen (ROADMAP SC5) — mode pinned to light, no screen consumes the hook yet.
- [x] Context value memoized (Pitfall 5); auth/NetInfo effects untouched (threat T-07-01 mitigated).
- [x] `npx tsc --noEmit` clean from `apps/mobile`.

## Notes for Downstream Plans

- Primitives (07-02..07-05) consume `useTheme()` only — never import raw `lightTheme`/`darkTheme`.
- `ToastProvider` mounts separately in `app/(app)/_layout.tsx` (authed surfaces), not here.
- The `_systemScheme` variable is intentionally unused until Phase 10 flips `mode` to reactive.

## Self-Check: PASSED

- FOUND: apps/mobile/lib/theme/ThemeProvider.tsx
- FOUND: apps/mobile/lib/theme/useTheme.ts
- FOUND: commit d467fdfc (Task 1)
- FOUND: commit 7a82b22a (Task 2)

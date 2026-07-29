---
phase: 07-theme-foundation-primitives
plan: 05
subsystem: mobile-ui-primitives
tags: [mobile, primitives, empty-state, state-block, i18n, theme]
requires:
  - "useTheme() (07-01)"
  - "Button primitive (07-03)"
provides:
  - "EmptyState primitive (icon + title + body + action)"
  - "StateBlock primitive (loading | empty | error branch)"
  - "common.errorGeneric.{title,body} i18n keys (EN + ES)"
affects:
  - "apps/mobile/components/ui/"
  - "apps/mobile/i18n/locales/"
tech-stack:
  added: []
  patterns:
    - "Status-branching wrapper renders children when data present"
    - "Primitive copy is 100% caller-supplied — no internal t(), no English defaults"
    - "Theme-only colors via useTheme(); static layout in StyleSheet.create"
key-files:
  created:
    - apps/mobile/components/ui/EmptyState.tsx
    - apps/mobile/components/ui/StateBlock.tsx
  modified:
    - apps/mobile/i18n/locales/en.json
    - apps/mobile/i18n/locales/es.json
decisions:
  - "D-13 honored: loading = centralized ActivityIndicator, no skeleton loader"
  - "D-14 honored: retry Button rendered only when onRetry provided"
metrics:
  duration: ~10m
  completed: 2026-07-29
  tasks: 3
  files: 4
---

# Phase 7 Plan 05: EmptyState + StateBlock Summary

EmptyState and StateBlock presentation primitives added to `components/ui/`, centralizing the hand-rolled `ActivityIndicator`/empty/error pattern into one status-driven wrapper, with generic-error i18n keys seeded in EN + ES for Phase 8+ callers. Satisfies UI-03. No screen adopts them this phase (zero visual change).

## What Was Built

### Task 1 — `EmptyState` (`components/ui/EmptyState.tsx`, commit `7633d18c`)
Centered icon + title + optional body + optional action block. Icon `size={40}` colored `iconColor ?? theme.textMuted`; title 16/600 `theme.textPrimary`; body 14/600 `lineHeight 21` `theme.textMuted` (wrap-friendly, no `numberOfLines`); action rendered below with a 16px gap. All copy is caller-supplied — no `t()`, no English default strings. Style merge order locked: `[styles.container, style]` (caller last). Colors via `useTheme()` only; no `C`/`lightTheme`/`darkTheme` import.

### Task 2 — `StateBlock` (`components/ui/StateBlock.tsx`, commit `56e2ad9d`)
Single `status: "loading" | "empty" | "error"` prop drives rendering; renders `children` when data is present.
- `loading`: centered `<ActivityIndicator size="large" color={theme.primaryAction} />`, `paddingVertical: S.sectionGap` (22). Centralized, not redesigned (D-13). No skeleton loader.
- `empty`: delegates to `<EmptyState>` with `emptyIcon ?? "folder-open-outline"` fallback.
- `error`: `<EmptyState>` with `errorIcon ?? "alert-circle-outline"`, `iconColor={theme.status.dirty}`, message as title, and a retry `<Button variant="secondary" size="md">` rendered **only** when `onRetry` is provided (D-14). `retryLabel` is caller-supplied.
No internal `t()`; only Ionicons name fallbacks are defaulted (not user copy).

### Task 3 — i18n seed keys (`en.json` + `es.json`, commit `17aba765`)
Added `common.errorGeneric.{title,body}` to both locales:
- EN: "Something went wrong" / "Something went wrong loading this data."
- ES: "Algo salió mal" / "Ocurrió un error al cargar estos datos."
Existing `common.retry`/`common.loading` reused, not duplicated. Both files remain valid JSON (node parse-check passes).

## Verification

- `cd apps/mobile && npx tsc --noEmit` — clean, no new errors (run after each task + final).
- `node -e` locale parse-check prints `OK` — both locales valid JSON with the new keys, EN/ES parity.
- Grep acceptance: no `t(`, no `C.`/`lightTheme`/`darkTheme`, no `skeleton`, no `numberOfLines={1}` in either primitive; `ActivityIndicator`/`size="large"`, `EmptyState`, `onRetry`, `theme.status.dirty` all present in StateBlock.
- No new npm dependency. No screen imports the primitives yet (Phase 8 adopts them).

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- FOUND: apps/mobile/components/ui/EmptyState.tsx
- FOUND: apps/mobile/components/ui/StateBlock.tsx
- FOUND: commit 7633d18c (feat 07-05: EmptyState)
- FOUND: commit 56e2ad9d (feat 07-05: StateBlock)
- FOUND: commit 17aba765 (feat 07-05: errorGeneric i18n keys)

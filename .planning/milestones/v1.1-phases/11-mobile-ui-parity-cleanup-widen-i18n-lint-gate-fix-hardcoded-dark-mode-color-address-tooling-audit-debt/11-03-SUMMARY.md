---
phase: 11-mobile-ui-parity-cleanup-widen-i18n-lint-gate-fix-hardcoded-dark-mode-color-address-tooling-audit-debt
plan: 03
subsystem: mobile-i18n
tags: [i18n, mobile, guest-requests, lost-found, eslint-gate-prep]
dependency-graph:
  requires: ["11-01"]
  provides: ["guestRequests-i18n-namespace", "lostFound-i18n-namespace", "guest-requests-screens-t-wired", "lost-found-screen-t-wired"]
  affects: ["11-06 (eslint gate widening)"]
tech-stack:
  added: []
  patterns: ["i18next plural suffix idiom (_one/_other) for lostFound.itemsHeld", "interpolation idiom {{var}} for room/floor/name labels"]
key-files:
  created: []
  modified:
    - apps/mobile/i18n/locales/en.json
    - apps/mobile/i18n/locales/es.json
    - "apps/mobile/app/(app)/guest-requests/index.tsx"
    - "apps/mobile/app/(app)/guest-requests/[requestId].tsx"
    - apps/mobile/app/(app)/lost-found/index.tsx
decisions:
  - "Confirmed via grep before editing that neither guestRequests nor lostFound existed as top-level locale objects (only nested strings with the same key names under tabs/home.gm/detailActions) — new top-level namespaces added with zero collision risk."
  - "itemsHeld uses i18next v23 CLDR plural suffixes (_one/_other) instead of the prior manual ternary + two text nodes."
  - "Scope held strictly to the 22 enumerated violations — ternary-embedded strings (e.g. filter label ternaries, req.status.replace fallback) were left untouched per plan instruction, since they are not gate-flagged."
metrics:
  duration: 20 min
  tasks_completed: 2
  files_modified: 5
  completed: 2026-08-01
---

# Phase 11 Plan 03: Guest Requests + Lost & Found i18n Wiring Summary

Wired 22 raw JSX-text literals in the guest-requests and lost-found mobile screens through `t()`, backed by new `guestRequests`/`lostFound` locale namespaces at full EN/ES parity — closing 2 of the 16 directories the widened `i18next/no-literal-string` ESLint gate (landing in 11-06) will cover.

## What was built

**Task 1 — Locale namespaces (commit `5d2f5730`):** Added new top-level `guestRequests` (10 keys) and `lostFound` (11 keys, including the `itemsHeld_one`/`itemsHeld_other` plural pair) objects to both `apps/mobile/i18n/locales/en.json` and `es.json`. Verified via the plan's node parity script (`parity ok`) and a grep confirming exactly one top-level occurrence of each new key name per file (no collision with the pre-existing `tabs.guestRequests`/`tabs.lostFound`/`home.gm.guestRequests` plain-string keys under different parents).

**Task 2 — t() wiring (commit `c9c8bb9d`):** Replaced all 22 literal violations across the 3 files with `t()` calls against the new keys:
- `guest-requests/index.tsx` (4 literals) — already had `useTranslation` in scope, no import change needed.
- `guest-requests/[requestId].tsx` (7 literals) — added `useTranslation` import + `const { t } = useTranslation()` hook, mirroring the sibling `index.tsx`.
- `lost-found/index.tsx` (11 literals, including the 2-text-node item-count expression collapsed into one `t("lostFound.itemsHeld", { count })` call) — added the same import + hook.

No navigation, status-update, staff-assignment, room-search, or styling logic was touched — diffs are proportional (25 insertions / 21 deletions across the 3 files) to literal→`t()` swaps and the 2 hook additions.

## Verification

- `cd apps/mobile && npm run type-check` — clean, no errors.
- EN/ES parity node script — `parity ok`.
- `guest-requests/[requestId].tsx`: 7 `t("guestRequests` call sites (≥6 threshold).
- `lost-found/index.tsx`: 10 `t("lostFound` call sites (≥9 threshold).
- Manual diff review: zero logic-line changes; `eslint.config.mjs` untouched (gate widening deferred to 11-06 as designed).

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- Confirmed `apps/mobile/i18n/locales/en.json` contains `guestRequests` and `lostFound` top-level keys.
- Confirmed `apps/mobile/i18n/locales/es.json` contains matching keys.
- Confirmed commits `5d2f5730` and `c9c8bb9d` exist in `git log`.
- Confirmed `apps/mobile/app/(app)/guest-requests/index.tsx`, `apps/mobile/app/(app)/guest-requests/[requestId].tsx`, and `apps/mobile/app/(app)/lost-found/index.tsx` all reference the new `t()` keys.

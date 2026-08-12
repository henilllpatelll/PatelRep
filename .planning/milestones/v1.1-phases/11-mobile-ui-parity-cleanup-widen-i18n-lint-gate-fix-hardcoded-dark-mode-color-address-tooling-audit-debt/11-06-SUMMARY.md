---
phase: 11-mobile-ui-parity-cleanup-widen-i18n-lint-gate-fix-hardcoded-dark-mode-color-address-tooling-audit-debt
plan: 06
subsystem: mobile-tooling
tags: [i18n, eslint, lint-gate, mobile]
dependency-graph:
  requires: ["11-01", "11-03", "11-04", "11-05"]
  provides: ["full-app-i18n-lint-gate"]
  affects: ["apps/mobile/eslint.config.mjs"]
tech-stack:
  added: []
  patterns: ["i18next/no-literal-string gate widening", "t() interpolation for unit-suffixed values (~{{min}}m)"]
key-files:
  created: []
  modified:
    - apps/mobile/eslint.config.mjs
    - apps/mobile/components/supervisor/atoms.tsx
    - apps/mobile/i18n/locales/en.json
    - apps/mobile/i18n/locales/es.json
decisions:
  - "Widened only the files array in the existing rule block; markupOnly and jsx-attributes include list untouched, per plan constraint"
  - "New avgMinutes key follows the existing codebase idiom of keeping the unit suffix ('m') literal and interpolating only the number, matching the pre-existing 'Pre-localized summary' comment convention in the same file"
metrics:
  duration: 10 min
  tasks: 1
  files: 4
  completed: 2026-08-01
---

# Phase 11 Plan 06: Widen i18n lint gate to full app coverage Summary

Widened `apps/mobile/eslint.config.mjs`'s `i18next/no-literal-string` gate from 10 to 26 directory globs, closing ROADMAP success criterion 1 for full app-wide i18n-gate coverage.

## What was done

- Added 16 new globs to the existing `files` array in `eslint.config.mjs`'s single i18next rule block (same object, not a new one): `app/(app)/profile/**`, `home/**`, `assignments/**`, `scheduling/**`, `staff/**`, `assets/**`, `pm-schedules/**`, `guest-requests/**`, `lost-found/**`, `logbook/**`, `sop/**`, `copilot/**`, `alerts/**`, `notifications/**`, `components/supervisor/**`, `components/home/**`.
- `markupOnly: true` and the `jsx-attributes.include` list (`['aria-label', 'placeholder', 'title']`) left byte-for-byte unchanged — confirmed via grep count (`1` occurrence of `markupOnly: true`, unchanged from before).
- Ran `npm run lint` against the widened gate. It surfaced exactly one new violation not enumerated in Phase 11 research: `components/supervisor/atoms.tsx:161` — `TeamLoadRow`'s average-clean-time text (`~{avgMin}m`). This file was touched by 11-05 for its `overBadge`/`inRoomPrefix` strings but this particular literal wasn't in that plan's scope (11-05 covered the 9 violations found in a widened-config dry run predating this exact line's exposure to the gate).
- Fixed it per the plan's own remediation instruction (wire it the same way as the sibling plans, not an `ignores` workaround): added `supervisorTools.avgMinutes: "~{{min}}m"` to both `en.json` and `es.json` (parity), and swapped the raw JSX text for `t("supervisorTools.avgMinutes", { min: avgMin })` in `atoms.tsx`. The `"m"` unit suffix stays literal, matching the file's own pre-existing "Pre-localized ... ~{m}m left" comment convention on the same component.
- `npm run lint` now exits 0 with zero violations across the fully-widened gate.
- `npm run type-check` confirmed clean (config + one small `t()` call change; no type regressions).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] New i18n literal surfaced by the widened gate, not in original 52-violation count**
- **Found during:** Task 1, first `npm run lint` run after widening the files array
- **Issue:** `components/supervisor/atoms.tsx:161` rendered raw JSX text `~{avgMin}m` (average room-clean-minutes indicator), which the widened `components/supervisor/**` glob now flags
- **Fix:** Added `supervisorTools.avgMinutes` key (`"~{{min}}m"`) to `en.json`/`es.json`; replaced the raw text with `t("supervisorTools.avgMinutes", { min: avgMin })`
- **Files modified:** `apps/mobile/components/supervisor/atoms.tsx`, `apps/mobile/i18n/locales/en.json`, `apps/mobile/i18n/locales/es.json`
- **Commit:** `63246430`

## Verification

- `cd apps/mobile && npm run lint` — exit 0, zero violations across all 26 gated directory globs
- `cd apps/mobile && npm run type-check` — exit 0, clean
- `eslint.config.mjs` diff confirmed to be `files` array additions only — no rule-config changes (`markupOnly: true` count unchanged at 1, `jsx-attributes` include list untouched)

## Success Criteria

ROADMAP success criterion 1 fully satisfied: the `i18next/no-literal-string` gate now covers all Phase-9-migrated directories (profile, home, assignments, scheduling, staff, assets, pm-schedules, guest-requests, lost-found, logbook, sop, copilot, alerts, notifications, components/supervisor, components/home), alongside the original 10. `npm run lint` is green across the fully-widened gate. This closes literal-fixing + gate-widening for all of Phase 11's i18n-coverage scope (52/52 original violations wired across 11-03/11-04/11-05, plus 1 newly-surfaced violation fixed here).

## Self-Check: PASSED

- FOUND: `apps/mobile/eslint.config.mjs` (widened files array present)
- FOUND: `apps/mobile/components/supervisor/atoms.tsx` (avgMinutes t() call present)
- FOUND: `apps/mobile/i18n/locales/en.json` (avgMinutes key present)
- FOUND: `apps/mobile/i18n/locales/es.json` (avgMinutes key present)
- FOUND: commit `63246430` in `git log --oneline`

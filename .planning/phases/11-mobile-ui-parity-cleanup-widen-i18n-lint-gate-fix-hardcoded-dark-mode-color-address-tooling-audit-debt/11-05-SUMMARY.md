---
phase: 11-mobile-ui-parity-cleanup-widen-i18n-lint-gate-fix-hardcoded-dark-mode-color-address-tooling-audit-debt
plan: 05
subsystem: ui
tags: [i18n, react-i18next, mobile, eslint-gate, expo]

requires:
  - phase: 11-04
    provides: en.json/es.json with alertsScreen/scheduling/sop namespaces already present
provides:
  - supervisorTools i18n namespace (6 keys) for BroadcastModal/ShiftNoteModal/atoms.tsx modal-internal copy
  - profile.appVersion and assignments.vipBadge keys added to existing namespaces
  - Final 9 of 52 total gate-widening literal violations wired through t()
affects: [11-06 (eslint gate config widening)]

tech-stack:
  added: []
  patterns:
    - "Decorative glyph-only text kept as a bare JSX text child (e.g. {\"★ \"}) alongside a translated {t(...)} expression, since symbol-only text nodes are not gate-flagged"

key-files:
  created: []
  modified:
    - apps/mobile/i18n/locales/en.json
    - apps/mobile/i18n/locales/es.json
    - apps/mobile/components/supervisor/BroadcastModal.tsx
    - apps/mobile/components/supervisor/ShiftNoteModal.tsx
    - apps/mobile/components/supervisor/atoms.tsx
    - apps/mobile/app/(app)/profile/index.tsx
    - apps/mobile/app/(app)/assignments/index.tsx

key-decisions:
  - "New top-level supervisorTools namespace created (not nested inside existing home.supervisor dashboard-label object) to keep modal-content strings separate from dashboard-card labels"
  - "assignments.vipBadge and profile.appVersion use identical EN/ES values by design (VIP is an accepted Spanish hospitality loanword; app version strings aren't translated) — not missed translations"

patterns-established: []

duration: 12min
completed: 2026-08-01
---

# Phase 11 Plan 05: Supervisor/Profile/Assignments i18n Wiring Summary

**Wired the final 9 of 52 gate-widening raw-literal violations (BroadcastModal, ShiftNoteModal, atoms.tsx, profile, assignments) through t(), closing out all literal-fixing work ahead of 11-06's ESLint gate-config widening**

## Performance

- **Duration:** 12 min
- **Tasks:** 2
- **Files modified:** 7 (2 locale files + 5 source files)

## Accomplishments
- Added new top-level `supervisorTools` namespace (6 keys) plus one new key each to the existing `profile` and `assignments` namespaces, at full EN/ES parity
- Wired all 9 raw-literal violations in `BroadcastModal.tsx`, `ShiftNoteModal.tsx`, `components/supervisor/atoms.tsx`, `profile/index.tsx`, and `assignments/index.tsx` through `t()`
- Confirmed zero behavior change: `send()`/`submit()`/`signOut`/AI-balance-suggestion logic untouched in all 5 files
- This closes literal-fixing for all 52 gate-widening violations across all 12 files found by Phase 11 research (22 in 11-03, 21 in 11-04, 9 here) — 11-06 can now widen the ESLint gate config itself

## Task Commits

1. **Task 1: Add supervisorTools namespace + profile.appVersion + assignments.vipBadge keys** - `caf482c3` (feat)
2. **Task 2: Wire t() across the 5 files (9 literals)** - `8c16b873` (feat)

## Files Created/Modified
- `apps/mobile/i18n/locales/en.json` - new `supervisorTools` namespace + `profile.appVersion` + `assignments.vipBadge`
- `apps/mobile/i18n/locales/es.json` - same keys, ES translations
- `apps/mobile/components/supervisor/BroadcastModal.tsx` - title/subtitle wired via `supervisorTools.messageTeamTitle`/`messageTeamSub`, new `useTranslation` import + hook
- `apps/mobile/components/supervisor/ShiftNoteModal.tsx` - title/subtitle wired via `supervisorTools.shiftNoteTitle`/`shiftNoteSub`, new `useTranslation` import + hook
- `apps/mobile/components/supervisor/atoms.tsx` - over-assigned badge (`supervisorTools.overBadge`) and "In {room}" interpolation (`supervisorTools.inRoomPrefix`) wired, new `useTranslation` import + hook
- `apps/mobile/app/(app)/profile/index.tsx` - app version line wired via `profile.appVersion` interpolation (t already in scope)
- `apps/mobile/app/(app)/assignments/index.tsx` - VIP chip split into bare `"★ "` glyph text child + `t("assignments.vipBadge")` (t already in scope)

## Decisions Made
- `supervisorTools` created as a new top-level namespace rather than nested under the pre-existing `home.supervisor` object, per the plan's explicit reasoning: `home.supervisor` holds dashboard-card button labels that open these modals (a different concern) while `supervisorTools` holds the modals' own internal copy.
- Left `QUICK_MESSAGES` array, `toast.success(...)`/`toast.error(...)` string arguments, and the `placeholder="..."` attribute in both modals untouched — confirmed not gate-flagged, matching the established `ReportIssueModal.tsx`/`SupplyRequestModal.tsx` precedent.
- Left `{load.done}/{load.total}` in atoms.tsx untouched — pure expression, not a literal, re-confirmed during read_first against the plan's own caveat that the exact violating line needed re-verification.

## Deviations from Plan
None - plan executed exactly as written. Line numbers for the atoms.tsx violations matched the plan's approximate citations (~155 overAssigned badge, ~172 "In {room}") exactly.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 52 gate-widening literal violations across all 12 files are now wired through `t()` (22 in 11-03, 21 in 11-04, 9 in this plan)
- `eslint.config.mjs` intentionally left untouched — 11-06 is now unblocked to widen the ESLint `no-literal-string` gate config to cover `components/supervisor/**`, `app/(app)/profile/**`, `app/(app)/assignments/**`, and the remaining zero-violation directories
- `npm run type-check` clean; no regressions expected in supervisor tools, profile, or assignments screens

---
*Phase: 11-mobile-ui-parity-cleanup-widen-i18n-lint-gate-fix-hardcoded-dark-mode-color-address-tooling-audit-debt*
*Completed: 2026-08-01*

## Self-Check: PASSED
- FOUND: apps/mobile/components/supervisor/BroadcastModal.tsx
- FOUND: 11-05-SUMMARY.md
- FOUND commit: caf482c3
- FOUND commit: 8c16b873

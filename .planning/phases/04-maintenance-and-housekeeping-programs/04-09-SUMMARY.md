---
phase: 04-maintenance-and-housekeeping-programs
plan: 09
subsystem: ui
tags: [i18n, react-i18next, housekeeping, room-status-board, realtime]

# Dependency graph
requires:
  - phase: 04-08
    provides: "eslint-plugin-i18next gate precedent + engineering.workOrderCard i18n pattern (TFunction-parameterized module helpers) this plan reused"
provides:
  - "Full EN/ES i18n coverage of the Housekeeping Room Status Board (a Supabase Realtime surface), Room Cards, Assignment Sidebar, and Prediction Panel"
  - "housekeeping.roomStatus / housekeeping.assignmentSidebar / housekeeping.roomCard / housekeeping.predictionPanel i18n namespaces in en.ts/es.ts with full key parity"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level helper functions that render translated strings and run outside component scope (getCleanTypeChips, getStatusWorkflowChips in RoomStatusBoard.tsx; formatETA, prettifyRiskFactor/getRiskFactorLabels in PredictionPanel.tsx) take a `t: TFunction` (imported from `i18next`) parameter, matching the precedent set by WorkOrderCard.tsx in 04-08."
    - "Status/clean-type labels sourced from shared cross-component utility files (lib/utils/roomStatus.ts STATUS_SHORT_LABELS, lib/utils/cleanType.ts getCleanTypeShortLabel) are left untranslated in RoomCard.tsx, treated as raw enum-derived data — same pattern WorkOrderCard.tsx uses for wo.priority/wo.status. Only copy owned exclusively by the file being translated was rewired to t()."
    - "CLEAN_TYPE_OPTIONS (lib/utils/cleanType.ts) is consumed only by RoomStatusBoard.tsx's clean-type prompt modal (verified via grep), so its label/hint text was translated in-place via a value→key lookup (t(`housekeeping.roomStatus.cleanTypePrompt.options.${key}.label`)) without modifying the shared util file itself."
key-files:
  modified:
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts
    - apps/web/components/housekeeping/RoomStatusBoard.tsx
    - apps/web/components/housekeeping/AssignmentSidebar.tsx
    - apps/web/components/housekeeping/RoomCard.tsx
    - apps/web/components/housekeeping/PredictionPanel.tsx
key-decisions:
  - "Left lib/utils/cleanType.ts and lib/utils/roomStatus.ts (STATUS_SHORT_LABELS, getCleanTypeShortLabel) untouched even though their string values render inside the translated components, because both files are shared across 8+ other components not in this plan's files_modified list (RoomDetailDrawer.tsx, InspectionModal.tsx, ai/cards.tsx, housekeeping/page.tsx, housekeeping/inspections/page.tsx, and RoomStatusBoard/RoomCard themselves). Modifying them would be an out-of-scope shared-logic change per the project's Non-Regression Policy. This mirrors the established WorkOrderCard.tsx precedent of leaving enum-derived status/priority labels as raw data."
  - "CLEAN_TYPE_OPTIONS (also in cleanType.ts) was translated in-place at the RoomStatusBoard.tsx call site (not by editing cleanType.ts) after confirming via grep it has exactly one consumer (RoomStatusBoard.tsx) — its label/hint text is genuine RoomStatusBoard-owned UI copy (a clean-type selection modal), not shared cross-component data, and the plan's action text explicitly requires 'all user-facing copy in RoomStatusBoard.tsx' including 'status labels/legend'."
requirements-completed: [BL-01, D-03]

# Metrics
duration: "~45 min"
completed: "2026-07-23"
---

# Phase 4 Plan 09: Housekeeping Room Status Board Bilingual Coverage Summary

Extended `react-i18next` locale objects (`i18n/locales/{en,es}.ts`) with four new namespaces (`housekeeping.roomStatus`, `housekeeping.assignmentSidebar`, `housekeeping.roomCard`, `housekeeping.predictionPanel`, 80 keys each, full EN/ES parity) and rewired the Housekeeping Room Status Board — one of the codebase's three Supabase Realtime surfaces — plus its Room Cards, Assignment Sidebar, and AI Prediction Panel to render every user-facing string via `useTranslation()`/`t()`.

## Performance

- **Duration:** ~45 min
- **Tasks:** 2/2 (both `type="auto"`, no checkpoints — `autonomous: true`)
- **Files modified:** 6 (2 locale files, 4 component files)

## Accomplishments

- `i18n/locales/en.ts` / `es.ts` gained a new `housekeeping` top-level namespace with `roomStatus`, `assignmentSidebar`, `roomCard`, and `predictionPanel` sub-namespaces — 80 keys, all present in both files (verified programmatically: 80/80 keys match, 0 missing either direction).
- `RoomStatusBoard.tsx` now renders via `useTranslation()`/`t()`: status filter chips (All/Departure/Full/Light/In Progress/Clean/Inspected/OOO/AI risk), building filter, error/retry banner, dismiss aria-label, "no rooms match filters" empty state, floor-group headers (Ground Floor / Floor N / room count pluralization), and the clean-type selection modal (title, subtitle, cancel aria-label, and the three DEP/FULL/LIGHT option label+hint pairs).
- `AssignmentSidebar.tsx` now renders via `useTranslation()`/`t()`: card title/subtitle, Unassigned/Needs work stat labels, AI success (pluralized room count) / generic success / failure messages, and the Assigning.../Auto-Assign with AI button states.
- `RoomCard.tsx` now renders via `useTranslation()`/`t()`: AI-risk title attribute, VIP pill, Full/Light Done labels, Out/Due checkout labels, Late-checkout prefix, pluralized guest-request/task counts, Tap to assign / tap to reassign / Assigned / Remove copy.
- `PredictionPanel.tsx` now renders via `useTranslation()`/`t()`: ETA formatting (Unknown/Overdue/Ready in N min/Ready by TIME), risk-factor labels (VIP Room, Will Be Late, Tight Timeline, HK Overloaded, Unassigned), header (Predictions, N HIGH/MEDIUM counts, all clear), and the empty "No risks flagged right now" state.
- Module-level helper functions that render translated strings but execute outside component render scope were converted to take a `t: TFunction` parameter (`getCleanTypeChips`, `getStatusWorkflowChips`, `formatETA`, `getRiskFactorLabels`/`prettifyRiskFactor`), following the `WorkOrderCard.tsx` precedent from 04-08.

## Task Commits

Each task was committed atomically:

1. **Task 1: Translate RoomStatusBoard.tsx + AssignmentSidebar.tsx** — `0e3017dc` (feat)
2. **Task 2: Translate RoomCard.tsx + PredictionPanel.tsx** — `fec6bb8a` (feat)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `apps/web/i18n/locales/en.ts` / `es.ts` — added `housekeeping.roomStatus`, `housekeeping.assignmentSidebar`, `housekeeping.roomCard`, `housekeeping.predictionPanel` namespaces (80 keys each, full EN/ES parity).
- `apps/web/components/housekeeping/RoomStatusBoard.tsx` — status/clean-type filter chips, building filter, error/empty states, floor headers, clean-type prompt modal all render via `t()`.
- `apps/web/components/housekeeping/AssignmentSidebar.tsx` — AI Assignments card copy, success/failure messages, button states render via `t()`.
- `apps/web/components/housekeeping/RoomCard.tsx` — AI-risk/VIP badges, clean-type done labels, checkout labels, guest-request/task counts, assignment overlay copy render via `t()`.
- `apps/web/components/housekeeping/PredictionPanel.tsx` — ETA formatting, risk-factor labels, header/empty-state copy render via `t()`.

## Decisions Made

See `key-decisions` in the frontmatter above (shared-util status/clean-type labels left as raw data per the WorkOrderCard.tsx precedent; CLEAN_TYPE_OPTIONS translated in-place at its single call site rather than editing the shared `cleanType.ts` file).

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written for the 4 named files. No Rule 1-3 bugs or missing-critical-functionality gaps were found; the only judgment calls made were the scope boundaries around shared utility files, documented as key-decisions above rather than deviations (no plan behavior was changed, no plan file list was altered).

---

**Total deviations:** 0
**Impact on plan:** None. The plan's `files_modified` frontmatter (4 components + 2 locale files) was followed exactly.

## Issues Encountered

- This worktree had no `node_modules` installed (fresh git worktree checkout). Symlinked `node_modules` and `apps/web/node_modules` to the main repo's installed dependencies (read-only, not committed — both paths are gitignored) to run `npm run type-check`, `npx eslint`, and the key-parity verification script without a full reinstall.
- The worktree's branch HEAD was found pointing at a stale pre-Phase-4 commit (predating `38cae8e9`) at agent startup, per the mandatory `worktree_branch_check` step. Verified all commits on the stale branch tip were already ancestors of `main` (no data loss), then `git reset --hard` to the expected base commit `38cae8e9` before starting work.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The Housekeeping Room Status Board (Realtime surface), Room Cards, Assignment Sidebar, and Prediction Panel are now genuinely usable in English and Spanish (D-03/BL-01), continuing the bilingual floor contract closing slice (4C) alongside 04-08's PM completion / PM schedules / housekeeping program depth coverage.
- `lib/utils/cleanType.ts` and `lib/utils/roomStatus.ts` (STATUS_SHORT_LABELS, CLEAN_TYPE_LABELS, CLEAN_TYPE_SHORT_LABELS) remain hardcoded English and are consumed by other not-yet-translated files (`RoomDetailDrawer.tsx`, `InspectionModal.tsx`, `components/ai/cards.tsx`, `app/(dashboard)/housekeeping/page.tsx`, `app/(dashboard)/housekeeping/inspections/page.tsx`). A future plan closing the remaining `components/housekeeping/**` bilingual gap (already flagged in 04-08's `deferred-items.md`) should decide whether to promote these shared label maps into the i18n locale files at that point.
- The scoped `i18next/no-literal-string` ESLint gate added in 04-08 does not yet cover the four files this plan translated (its `files` glob is still scoped to the 04-08 file list) — widening that gate to include `RoomStatusBoard.tsx`, `AssignmentSidebar.tsx`, `RoomCard.tsx`, and `PredictionPanel.tsx` is a natural follow-up once the remaining `components/housekeeping/**` files are also translated, so the gate can cover the whole directory without breaking `npm run lint`.

## Self-Check: PASSED

- FOUND: `apps/web/i18n/locales/en.ts` contains `housekeeping.roomStatus`, `housekeeping.assignmentSidebar`, `housekeeping.roomCard`, `housekeeping.predictionPanel`
- FOUND: `apps/web/i18n/locales/es.ts` — same namespaces, 80/80 keys match `en.ts` (0 missing either direction, verified programmatically)
- FOUND: commit `0e3017dc` (Task 1)
- FOUND: commit `fec6bb8a` (Task 2)
- VERIFIED: `grep -c "useTranslation" apps/web/components/housekeeping/RoomStatusBoard.tsx` → 3 (≥ 1 required)
- VERIFIED: `grep -c "useTranslation" apps/web/components/housekeeping/AssignmentSidebar.tsx` → 2 (≥ 1 required)
- VERIFIED: `grep -c "useTranslation" apps/web/components/housekeeping/RoomCard.tsx` → 2 (≥ 1 required)
- VERIFIED: `grep -c "useTranslation" apps/web/components/housekeeping/PredictionPanel.tsx` → 3 (≥ 1 required)
- VERIFIED: `grep -c "roomStatus" en.ts` == `grep -c "roomStatus" es.ts` (both 1, namespace present)
- VERIFIED: `grep -c "roomCard\|predictionPanel" en.ts` == `grep -c "roomCard\|predictionPanel" es.ts` (both 2)
- VERIFIED: `cd apps/web && npm run type-check` → clean (0 errors)
- VERIFIED: `cd apps/web && npx eslint components/housekeeping/ i18n/locales/en.ts i18n/locales/es.ts` → clean (0 errors, 0 warnings)

---
*Phase: 04-maintenance-and-housekeeping-programs*
*Completed: 2026-07-23*

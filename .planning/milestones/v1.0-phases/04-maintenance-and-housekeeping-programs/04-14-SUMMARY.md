---
phase: 04-maintenance-and-housekeeping-programs
plan: 14
subsystem: ui
tags: [i18n, react-i18next, engineering, work-orders, bilingual-floor-contract]

# Dependency graph
requires:
  - phase: 04-08
    provides: "engineering.workOrderCard.* i18n namespace + WorkOrderCard.tsx/PMCompletionModal.tsx as translated analogs (useTranslation/t() wiring, formatSLA(t) helper pattern)"
  - phase: 04-13
    provides: "en.ts/es.ts as shared, sequential locale files (avoids merge conflicts across parallel 04-* plans); engineering.workOrderDetail.* namespace reused for priorityLabel/previewAlt/addPhoto"
provides:
  - "Full EN/ES i18n coverage of CreateWorkOrderModal.tsx, WorkOrderList.tsx, EngineeringRoomBoard.tsx, and FailurePredictionSidebar.tsx — the four remaining untranslated engineering/work-order floor components named by D-03"
  - "engineering.createWorkOrder.*, engineering.workOrderList.*, engineering.roomBoard.*, engineering.failurePrediction.* i18n namespaces in en.ts/es.ts with full EN/ES parity"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level helper functions that build translated option lists (getCategories(t), getPriorities(t) in CreateWorkOrderModal.tsx; getEmptyMessages(t) in WorkOrderList.tsx) instead of static top-level arrays/objects — memoized with useMemo(() => getX(t), [t]) inside the component so the list only rebuilds when the locale changes."
    - "getRiskLabel(score, t) in FailurePredictionSidebar.tsx follows the same t-as-parameter pattern as WorkOrderCard.tsx's formatSLA(t) for module-level helpers outside component scope; risk bands (HIGH/MEDIUM/LOW) now render via a translated label map rather than the raw hardcoded string, per the deferred-items.md #3 guidance cited in this plan."
    - "Cross-namespace reuse: engineering.workOrderCard.room, engineering.workOrderDetail.{priorityLabel,previewAlt,addPhoto}, programs.pmCompletion.optionalTag, and common.cancel for identical copy shared with already-translated components — avoids key duplication per the plan's <interfaces> reuse guidance."
    - "Pluralized room-count text (roomCountOne/roomCountOther) in EngineeringRoomBoard.tsx follows the exact manual-ternary convention already established by programs.pmSchedules.scheduleCountOne/Other (not react-i18next's automatic _one/_other suffix convention, which this codebase does not use)."
key-files:
  created: []
  modified:
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts
    - apps/web/components/engineering/CreateWorkOrderModal.tsx
    - apps/web/components/engineering/WorkOrderList.tsx
    - apps/web/components/engineering/EngineeringRoomBoard.tsx
    - apps/web/components/engineering/FailurePredictionSidebar.tsx
key-decisions:
  - "New category/priority option-label keys (engineering.createWorkOrder.category*/priority*Label/priority*Desc) were added fresh rather than reused from housekeeping.roomStatus.workOrderForm.categories.* (a similar-looking but not byte-identical set used by a different component, RoomDetailDrawer's simplified housekeeping-to-engineering WO form — its 'hvac' label is 'HVAC / A/C' vs. this file's plain 'HVAC') or from engineering.workOrderCard.* (which intentionally renders raw untranslated enum values for category/priority, per 04-13's parity decision) — neither was an identical-copy match."
  - "EngineeringRoomBoard.tsx's new engineering.roomBoard.* keys (loading/error/retry/floor/roomCount) were kept namespace-local rather than reused from the structurally similar housekeeping.roomStatus.{error,empty,floor} keys, since the plan's own namespace-assignment table scopes reuse to engineering.workOrderCard.*/workOrderDetail.*/common.* only — duplicating short, generic English strings (\"Retry\", \"Ground Floor\") across domain namespaces is an existing, accepted pattern in this codebase (e.g. \"Retry\" already appears in 3 other namespaces)."
  - "roomOption/roomOptionFloor in createWorkOrder.* are two full interpolated templates ('Room {{number}}' / 'Room {{number}} · Floor {{floor}}') rather than concatenating a translated 'Room' fragment with a separately-translated floor suffix — avoids grammatically fragile string concatenation across languages."
requirements-completed: [BL-01, D-03]

# Metrics
duration: "~40 min"
completed: "2026-07-23"
---

# Phase 4 Plan 14: Bilingual Floor Contract — Engineering/Work-Order Components Summary

Translated the four remaining untranslated engineering/work-order floor components — `CreateWorkOrderModal.tsx`, `WorkOrderList.tsx`, `EngineeringRoomBoard.tsx`, and `FailurePredictionSidebar.tsx` — into EN + ES, adding four new `engineering.*` i18n namespaces (`createWorkOrder`, `workOrderList`, `roomBoard`, `failurePrediction`) with full EN/ES parity, completing the D-03 "engineering / work-orders" component-level bilingual scope started in 04-08 and continued in 04-13.

## Performance

- **Duration:** ~40 min
- **Tasks:** 3/3 (all `type="auto"`, no checkpoints — `autonomous: true`)
- **Files modified:** 6 (2 locale files, 4 component files)

## Accomplishments

- `CreateWorkOrderModal.tsx` now imports `useTranslation`/`TFunction`; every user-facing string — dialog aria-label/title/close button, AI-toggle heading+description, room picker (placeholder option + two interpolated room-option templates with/without floor), location-detail/other-location labels+placeholders, work-order title label+placeholder, AI natural-language-input label+placeholder+hint, category select (label + 8 category option labels), priority radio group (label + 4 priority labels with their full descriptions), guest-reported toggle label, photo section (label, preview alt, remove button aria-label+text, add-photo button), validation/API error copy, and footer buttons (Cancel/Create/Create with AI/Processing…/Creating…) — now renders via `t()`.
- `WorkOrderList.tsx` now imports `useTranslation`; the per-status `EMPTY_MESSAGES` map became `getEmptyMessages(t)` (open/escalated/in_progress/on_hold/completed/cancelled), with a translated generic fallback for any other status, plus the load-error message.
- `EngineeringRoomBoard.tsx` now imports `useTranslation`; loading spinner text, error message + Retry button, the three filter chips (All/Vacant/AI risk), the no-rooms-match-filter empty state, floor headings (Ground Floor / Floor {{floor}}), and the pluralized room-count text (via `roomCountOne`/`roomCountOther`, matching the `programs.pmSchedules.scheduleCountOne/Other` convention) all render via `t()`.
- `FailurePredictionSidebar.tsx` now imports `useTranslation`; both the top-level component and the nested `PredictionCard` function call `useTranslation()` independently (the latter is a separate function component, not a closure over the parent's `t`). Header heading, active-count badge, unknown-asset fallback, "Failure window:" label, Create WO/Acknowledge/Acknowledged action text, empty state (no-high-risk heading + all-normal subtext), and footer note all render via `t()`. `getRiskLabel()` (module-level, outside component scope) now takes a `t: TFunction` parameter and returns a translated risk-band label (`riskHigh`/`riskMedium`/`riskLow`) instead of the hardcoded `'HIGH'`/`'MEDIUM'`/`'LOW'` strings — resolving the exact gap flagged by `deferred-items.md` item #3's pattern (render enum-derived values via a translated label map, not the raw string).
- `en.ts`/`es.ts` gained four new namespaces under `engineering`: `createWorkOrder` (44 keys), `workOrderList` (8 keys), `roomBoard` (11 keys), `failurePrediction` (13 keys) — 76 new keys total, full EN/ES parity verified programmatically across the *entire* locale files (not just the new namespaces): 1093/1093 flattened keys present in both `en.ts` and `es.ts`, 0 missing either direction.
- Reused `engineering.workOrderCard.room`, `engineering.workOrderDetail.{priorityLabel,previewAlt,addPhoto}`, `programs.pmCompletion.optionalTag`, and `common.cancel` for byte-identical copy already present from 04-08/04-13, rather than duplicating keys.

## Task Commits

Each task was committed atomically:

1. **Task 1: CreateWorkOrderModal.tsx** — `fb2537b6` (feat)
2. **Task 2: WorkOrderList.tsx + EngineeringRoomBoard.tsx** — `0aabae47` (feat)
3. **Task 3: FailurePredictionSidebar.tsx** — `6d0dc398` (feat)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `apps/web/i18n/locales/en.ts` — added `engineering.createWorkOrder.*` (44 keys), `engineering.workOrderList.*` (8 keys), `engineering.roomBoard.*` (11 keys), `engineering.failurePrediction.*` (13 keys).
- `apps/web/i18n/locales/es.ts` — matching Spanish translations, same 76 keys, full parity.
- `apps/web/components/engineering/CreateWorkOrderModal.tsx` — rewired to `useTranslation()`/`t()` across the entire modal; `CATEGORIES`/`PRIORITIES` static arrays replaced with `getCategories(t)`/`getPriorities(t)` builder functions memoized via `useMemo`.
- `apps/web/components/engineering/WorkOrderList.tsx` — rewired to `useTranslation()`/`t()`; `EMPTY_MESSAGES` static object replaced with `getEmptyMessages(t)`.
- `apps/web/components/engineering/EngineeringRoomBoard.tsx` — rewired to `useTranslation()`/`t()` across loading/error/filter-chips/floor-headings/room-count/empty-state.
- `apps/web/components/engineering/FailurePredictionSidebar.tsx` — rewired both `FailurePredictionSidebar` and the nested `PredictionCard` component to `useTranslation()`/`t()`; `getRiskLabel()` now takes a `t: TFunction` parameter.

## Decisions Made

See `key-decisions` in the frontmatter above (fresh category/priority keys rather than cross-component reuse of non-identical copy; roomBoard.* kept namespace-local per the plan's scoped reuse guidance; full interpolated room-option templates instead of string concatenation).

## Deviations from Plan

None — plan executed exactly as written. The plan's Task 3 note ("render enum values via a translated label map, not the raw API value") was followed directly rather than surfacing as a deviation, since it was an explicit instruction in the plan's own `<action>` text.

## Issues Encountered

- The worktree checkout had no `node_modules` at either the repo root or `apps/web/` (git worktrees don't carry untracked directories) — same pre-existing environment condition documented in 04-13's summary. Created Windows directory junctions (`mklink /J`) pointing at the main checkout's installed `node_modules` (same lockfile, same commit) rather than reinstalling from scratch; verification commands (`type-check`, `lint`) then ran normally. Note for future executors in this worktree: `mklink /J <link> <target>` resolves the target path relative to the *current working directory*, not the link's own directory — get the relative `..\` count wrong (as happened on the first attempt for `apps/web/node_modules`) and the junction silently points at the wrong folder, producing a `File Not Found`/empty-directory listing instead of an error.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `CreateWorkOrderModal.tsx`, `WorkOrderList.tsx`, `EngineeringRoomBoard.tsx`, and `FailurePredictionSidebar.tsx` are all fully bilingual. Combined with 04-08's `WorkOrderCard.tsx`/`PMCompletionModal.tsx` and 04-13's `WorkOrderDetailDrawer.tsx`, **every file in `components/engineering/**` named by D-03's "engineering / work-orders" scope is now bilingual EN+ES.**
- Per `deferred-items.md`'s "Follow-up plan should" list (logged during 04-08), the remaining tracked gaps are: `app/(dashboard)/tasks/page.tsx` and `components/housekeeping/**` (out of this plan's scope — its `files_modified` frontmatter targeted only the four `components/engineering/**` files above). This plan closes 4 of the 6 items on that follow-up list; the housekeeping/tasks surfaces remain for a future plan.
- The scoped `i18next/no-literal-string` ESLint gate (added in 04-08, `apps/web/eslint.config.mjs`) does not yet cover any of this plan's four files; widening that gate's `files` glob to include the now-fully-translated `components/engineering/**` directory is a natural follow-up once the housekeeping/tasks surfaces are also translated (widening it now, with `components/housekeeping/**` still untranslated, would still fail if the glob is directory-wide — a future plan should scope the widened glob carefully).

## Self-Check: PASSED

- FOUND: `apps/web/i18n/locales/en.ts` contains `engineering.createWorkOrder` (44 keys), `engineering.workOrderList` (8 keys), `engineering.roomBoard` (11 keys), `engineering.failurePrediction` (13 keys)
- FOUND: `apps/web/i18n/locales/es.ts` — same four namespaces, same 76 keys, full parity (1093/1093 keys match across the entire file, verified programmatically)
- FOUND: `apps/web/components/engineering/CreateWorkOrderModal.tsx` imports and uses `useTranslation` (grep count: 2)
- FOUND: `apps/web/components/engineering/WorkOrderList.tsx` imports and uses `useTranslation` (grep count: 2)
- FOUND: `apps/web/components/engineering/EngineeringRoomBoard.tsx` imports and uses `useTranslation` (grep count: 2)
- FOUND: `apps/web/components/engineering/FailurePredictionSidebar.tsx` imports and uses `useTranslation` (grep count: 3)
- FOUND: commit `fb2537b6` (Task 1)
- FOUND: commit `0aabae47` (Task 2)
- FOUND: commit `6d0dc398` (Task 3)
- VERIFIED: `cd apps/web && npm run type-check` → clean
- VERIFIED: `cd apps/web && npm run lint` → clean (0 errors, 0 warnings)
- VERIFIED: manual scan of all four files — no remaining hardcoded user-facing JSX text/placeholder/aria-label/title literal

---

*Phase: 04-maintenance-and-housekeeping-programs*
*Completed: 2026-07-23*

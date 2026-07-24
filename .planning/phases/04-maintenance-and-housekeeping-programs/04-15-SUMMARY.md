---
phase: 04-maintenance-and-housekeeping-programs
plan: 15
subsystem: ui
tags: [i18n, react-i18next, engineering, app-router, bilingual-floor-contract]

# Dependency graph
requires:
  - phase: 04-08
    provides: "engineering.workOrderCard.*/workOrderDetail.* i18n namespaces + WorkOrderCard.tsx as the t-as-parameter helper convention (formatSLA(t))"
  - phase: 04-13
    provides: "en.ts/es.ts as shared, sequential locale files (avoids merge conflicts across parallel 04-* plans)"
  - phase: 04-14
    provides: "engineering.createWorkOrder.*/workOrderList.*/roomBoard.*/failurePrediction.* namespaces reused for identical copy (riskHigh/Medium/Low, unknownAsset, failureWindowLabel, acknowledge/acknowledged, room)"
provides:
  - "Full EN/ES i18n coverage of the four engineering app-route pages named by D-03: assets/page.tsx, predictions/page.tsx, work-orders/page.tsx, and the engineering/page.tsx landing redirect"
  - "engineering.assetsPage.*, engineering.predictionsPage.*, engineering.workOrdersPage.* i18n namespaces in en.ts/es.ts with full EN/ES parity"
  - "Confirmation that engineering/page.tsx is a pure redirect (0 literals) — closes D-03's engineering-directory scope entirely"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RISK_FILTERS in assets/page.tsx converted from a string-literal union (RiskFilter = 'All' | 'High Risk' | ...) to a keyed {key, label} array via getRiskFilters(t), mirroring predictions/page.tsx's pre-existing risk/status filter pattern — filter-matching logic now compares stable English keys ('all'|'highRisk'|'medium'|'low'), not translated display text, so switching locale never breaks filtering."
    - "COLUMNS in work-orders/page.tsx converted from a module-level static array to getColumns(t), called inside the component body (not memoized — cheap enough, consistent with predictions/page.tsx's inline risk/status filter arrays rather than CreateWorkOrderModal.tsx's useMemo(() => getX(t), [t]) pattern)."
    - "getRiskBadge(score, t) and getWarrantyLabel(warrantyExpires, t) in assets/page.tsx, and getRiskLabel(score, t) in predictions/page.tsx, all follow the same t-as-parameter convention as WorkOrderCard.tsx's formatSLA(t) and 04-14's getRiskLabel(score, t) for module-level helpers outside component scope."
    - "Manual One/Other pluralization for emergency/urgent work-order-count alert text (emergencyAlertOne/Other, urgentAlertOne/Other in work-orders/page.tsx) — same manual-ternary convention as programs.pmSchedules.scheduleCountOne/Other and 04-14's roomBoard.roomCountOne/Other, not react-i18next's automatic _one/_other suffix."
    - "Separate useTranslation() calls per function component (RiskRing, PredictionCard, KanbanColumn) rather than prop-drilling t — consistent with 04-14's FailurePredictionSidebar/PredictionCard precedent."
key-files:
  created: []
  modified:
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts
    - apps/web/app/(dashboard)/engineering/assets/page.tsx
    - apps/web/app/(dashboard)/engineering/predictions/page.tsx
    - apps/web/app/(dashboard)/engineering/work-orders/page.tsx
key-decisions:
  - "engineering/page.tsx (the 5-line landing route) was left untouched — confirmed to be a pure `redirect('/engineering/work-orders')` wrapper with zero user-facing copy, per the plan's own note. No useTranslation import was added since there is nothing to translate."
  - "Cross-page 'Room {{number}}' text in assets/page.tsx (asset location display, both in the detail modal and the table) reuses engineering.workOrderCard.room ('Room') rather than duplicating a new key — byte-identical usage pattern to WorkOrderCard.tsx/WorkOrderDetailDrawer.tsx from 04-08/04-13."
  - "Risk-band labels (HIGH/MEDIUM/LOW) in both assets/page.tsx's getRiskBadge and predictions/page.tsx's getRiskLabel now reuse engineering.failurePrediction.riskHigh/riskMedium/riskLow from 04-14, rather than re-declaring per-page risk labels — same enum-derived value, same translated label map convention flagged by deferred-items.md #3 and already resolved once in 04-14."
  - "'Acknowledged'/'Acknowledge' text in predictions/page.tsx's StatCard, status filter, and action button all reuse engineering.failurePrediction.acknowledged/acknowledge (04-14) instead of adding predictionsPage-local duplicates, since the copy is byte-identical to the FailurePredictionSidebar it sits next to on the same route."
  - "New, non-reused per-page keys (assetsPage.category/location/manufacturer/model/serialNumber/warranty/notes/purchaseDate, etc.) were consolidated to a single shared key within each page's own namespace where the exact same English text appears in multiple places on that page (e.g. 'Category' as both a table column header and a detail-row label) — reduces duplication without reusing across page namespaces, consistent with 04-14's decision that cross-namespace reuse should stay scoped to the plan's own interfaces table."
requirements-completed: [BL-01, D-03]

# Metrics
duration: "~55 min"
completed: "2026-07-23"
---

# Phase 4 Plan 15: Bilingual Floor Contract — Engineering Route Pages Summary

Translated the four engineering app-route pages (`assets/page.tsx`, `predictions/page.tsx`, `work-orders/page.tsx`, and the `engineering/page.tsx` landing redirect) into EN + ES, adding three new `engineering.*` i18n namespaces (`assetsPage`, `predictionsPage`, `workOrdersPage`) with full EN/ES parity, completing D-03's "engineering / work-orders" scope — every file inside the D-04 gate glob's `app/(dashboard)/{...,engineering,...}/**` slice is now literal-free.

## Performance

- **Duration:** ~55 min
- **Tasks:** 3/3 (all `type="auto"`, no checkpoints — `autonomous: true`)
- **Files modified:** 5 (2 locale files, 3 route-page files)

## Accomplishments

- `assets/page.tsx` (1107 lines, largest file in this plan) now imports `useTranslation`/`TFunction` across three components (`AssetRegisterPage`, `AssetDetailModal`, `CreateAssetModal`): page header, all four stat cards, search input, risk filter chips, table headers, empty states (both "no assets yet" and "no assets match filters"), the asset detail modal (view + edit modes, all 8 editable fields, PM-schedules sub-list with overdue/due/last-done/never-completed states), and the create-asset modal (all 10 fields, validation error, submit states) all render via `t()`. `getRiskBadge`/`getWarrantyLabel` module-level helpers now take a `t: TFunction` parameter. `RISK_FILTERS` converted from a translated-string-literal union to a keyed `{key, label}` array (`getRiskFilters(t)`) so risk filtering no longer depends on display text.
- `predictions/page.tsx` (636 lines) now imports `useTranslation` across `PredictionsPage`, `RiskRing`, and `PredictionCard`: page header, AI-authorization hint, success/authorization toast messages, all four stat cards, risk/status filter chips (labels only — filter keys already stable), Clear-filters links, both empty states (filtered vs. unfiltered) with sample-signal cards, and every field of the expandable prediction card (risk ring aria-label, failure-window, AI-reasoning expand/collapse, cost breakdown, generated/acknowledged timestamps, and all three action buttons) now render via `t()`. `getRiskLabel(score, t)` follows the same helper convention as 04-14's identically-named function in `FailurePredictionSidebar.tsx`.
- `work-orders/page.tsx` (458 lines) now imports `useTranslation` across `WorkOrdersPage` and the nested `KanbanColumn` component: page header, AI-triage button + toast messages, New-Work-Order button, tab bar (Work Orders / Room Board), all 5 Kanban column labels, the per-column empty-state message, and the emergency/urgent count alert banner (with manual singular/plural key pairs) all render via `t()`. `COLUMNS` converted from a static array to `getColumns(t)`.
- `engineering/page.tsx` confirmed to be a pure `redirect('/engineering/work-orders')` wrapper with zero user-facing copy — left untouched, no `useTranslation` needed.
- `en.ts`/`es.ts` gained three new namespaces under `engineering`: `assetsPage` (85 keys), `predictionsPage` (38 keys), `workOrdersPage` (18 keys) — 141 new keys total, full EN/ES parity verified programmatically across the *entire* locale files: 1236/1236 flattened keys present in both `en.ts` and `es.ts`, 0 missing either direction.
- Reused `engineering.failurePrediction.riskHigh/riskMedium/riskLow`, `engineering.failurePrediction.unknownAsset`, `engineering.failurePrediction.failureWindowLabel`, `engineering.failurePrediction.acknowledge`/`acknowledged`, and `engineering.workOrderCard.room` for byte-identical copy already present from 04-14/04-08, rather than duplicating keys.

## Task Commits

Each task was committed atomically:

1. **Task 1: assets/page.tsx** — `68574efc` (feat)
2. **Task 2: predictions/page.tsx** — `c232daae` (feat)
3. **Task 3: work-orders/page.tsx + engineering/page.tsx confirmation** — `3839e451` (feat)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `apps/web/i18n/locales/en.ts` — added `engineering.assetsPage.*` (85 keys), `engineering.predictionsPage.*` (38 keys), `engineering.workOrdersPage.*` (18 keys).
- `apps/web/i18n/locales/es.ts` — matching Spanish translations, same 141 keys, full parity.
- `apps/web/app/(dashboard)/engineering/assets/page.tsx` — rewired to `useTranslation()`/`t()` across `AssetRegisterPage`, `AssetDetailModal`, `CreateAssetModal`; `getRiskBadge`/`getWarrantyLabel` now take a `TFunction` parameter; `RISK_FILTERS` replaced with `getRiskFilters(t)`.
- `apps/web/app/(dashboard)/engineering/predictions/page.tsx` — rewired to `useTranslation()`/`t()` across `PredictionsPage`, `RiskRing`, `PredictionCard`; `getRiskLabel` now takes a `TFunction` parameter.
- `apps/web/app/(dashboard)/engineering/work-orders/page.tsx` — rewired to `useTranslation()`/`t()` across `WorkOrdersPage` and `KanbanColumn`; `COLUMNS` replaced with `getColumns(t)`.

## Decisions Made

See `key-decisions` in the frontmatter above (engineering/page.tsx left untouched as a confirmed pure redirect; cross-page reuse of 04-08/04-14 keys for risk labels, "Room", and acknowledge/acknowledged text; per-page key consolidation for identical same-page copy like "Category"/"Location" appearing as both a table header and a detail-row label).

## Deviations from Plan

None — plan executed exactly as written. The RISK_FILTERS/COLUMNS refactor from string-literal unions to keyed `{key, label}` arrays was necessary to translate the display text without breaking the filter-matching logic (which compares against the raw value) — this is standard i18n mechanics for translating enum-driven UI, not a deviation from the plan's intent, and follows the same `{key, label}` pattern predictions/page.tsx's risk/status filters already used before this plan.

## Issues Encountered

- The worktree checkout had no `node_modules` at either the repo root or `apps/web/` (same pre-existing environment condition documented in 04-13's and 04-14's summaries — git worktrees don't carry untracked directories). Created Windows directory junctions (`mklink /J`) pointing at the main checkout's installed `node_modules`. Additionally, `cmd.exe /c "..."` invoked directly through the Bash tool's git-bash wrapper silently failed to execute (it printed the cmd.exe banner instead of running the command) due to MSYS path-mangling of the `/c` flag into a Windows path; prefixing the command with `MSYS_NO_PATHCONV=1` fixed it. Noting this for future executors in this worktree environment.
- Found and corrected one drafting mistake before it reached the codebase: initially reused `engineering.assetsPage.loadDetailError` ("Failed to load asset.") for the edit-form's *save* error fallback in `AssetDetailModal.handleSave`, which is semantically wrong (that catch block is for a failed PATCH, not a failed GET). Added a dedicated `engineering.assetsPage.saveError` ("Failed to save changes.") key instead and fixed the call site before running verification — caught during this same task, not left as a residual bug.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `assets/page.tsx`, `predictions/page.tsx`, `work-orders/page.tsx`, and `engineering/page.tsx` are all fully bilingual (or confirmed literal-free). Combined with 04-08's `WorkOrderCard.tsx`/`PMCompletionModal.tsx`, 04-13's `WorkOrderDetailDrawer.tsx`, and 04-14's `CreateWorkOrderModal.tsx`/`WorkOrderList.tsx`/`EngineeringRoomBoard.tsx`/`FailurePredictionSidebar.tsx`, **every file named by D-03's "engineering / work-orders" scope — both `components/engineering/**` and `app/(dashboard)/engineering/**` — is now bilingual EN+ES or confirmed to have zero user-facing copy.**
- This closes out the engineering-directory portion of D-03/BL-01 entirely. Per `deferred-items.md`'s follow-up list (logged during 04-08, narrowed in 04-14), the remaining tracked gaps outside this plan's `files_modified` scope are `app/(dashboard)/tasks/page.tsx` and `components/housekeeping/**` — out of this plan's scope, for a future plan.
- The scoped `i18next/no-literal-string` ESLint gate (added in 04-08, `apps/web/eslint.config.mjs`) still does not cover any of these files. With the entire `components/engineering/**` and `app/(dashboard)/engineering/**` trees now fully translated, widening that gate's `files` glob to include both directories is now safe from an engineering-side false-positive perspective — but should wait until `components/housekeeping/**` and `app/(dashboard)/tasks/page.tsx` are also translated if the glob is intended to be directory-wide across all of `app/(dashboard)/{housekeeping,engineering,tasks,programs}` per D-04's exact wording. A future plan (04-16 per this plan's own objective note, "before the gate widens") should own that gate-widening step.

## Self-Check: PASSED

- FOUND: `apps/web/i18n/locales/en.ts` contains `engineering.assetsPage` (85 keys), `engineering.predictionsPage` (38 keys), `engineering.workOrdersPage` (18 keys)
- FOUND: `apps/web/i18n/locales/es.ts` — same three namespaces, same 141 keys, full parity (1236/1236 keys match across the entire file, verified programmatically)
- FOUND: `apps/web/app/(dashboard)/engineering/assets/page.tsx` imports and uses `useTranslation` (grep count: 4)
- FOUND: `apps/web/app/(dashboard)/engineering/predictions/page.tsx` imports and uses `useTranslation` (grep count: 4)
- FOUND: `apps/web/app/(dashboard)/engineering/work-orders/page.tsx` imports and uses `useTranslation` (grep count: 3)
- FOUND: `apps/web/app/(dashboard)/engineering/page.tsx` unchanged — confirmed 0 literals (pure redirect)
- FOUND: commit `68574efc` (Task 1)
- FOUND: commit `c232daae` (Task 2)
- FOUND: commit `3839e451` (Task 3)
- VERIFIED: `cd apps/web && npm run type-check` → clean
- VERIFIED: `cd apps/web && npm run lint` → clean (0 errors, 0 warnings)
- VERIFIED: manual scan of all three edited files — no remaining hardcoded user-facing JSX text/placeholder/aria-label/title literal

---

*Phase: 04-maintenance-and-housekeeping-programs*
*Completed: 2026-07-23*

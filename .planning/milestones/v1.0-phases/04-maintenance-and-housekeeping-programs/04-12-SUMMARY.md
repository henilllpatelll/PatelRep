---
phase: 04-maintenance-and-housekeeping-programs
plan: 12
subsystem: ui
tags: [i18n, react-i18next, housekeeping, app-router, gate-glob]

# Dependency graph
requires:
  - phase: 04-11
    provides: "housekeeping.* i18n namespace precedent (page/assignmentsPage) and shared en.ts/es.ts locale files this plan extends"
provides:
  - "Full EN/ES i18n coverage of the housekeeping inspections route (app/(dashboard)/housekeeping/inspections/page.tsx) and the all-rooms route (app/(dashboard)/housekeeping/rooms/page.tsx) — the last two app-route pages inside D-04's locked gate glob living under housekeeping/"
  - "housekeeping.inspectionsPage / housekeeping.roomsPage i18n namespaces in en.ts/es.ts with full key parity"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Component-scoped useTranslation(): StripQueueCard, QueueCard, RoomMobileCard, and ImportModal are each separate function components (not module-level helpers) so each calls its own useTranslation() rather than threading a t prop down from the page component."
    - "Loop-variable shadow avoidance: two pre-existing `.map((t) => ...)` tab-array iterations (inspections tab bar, rooms import-modal tab bar) shadowed the react-i18next `t` function: both were renamed to `tabKey` so `t()` calls inside the same JSX scope resolve to the translation function, not the loop item."
    - "Dynamic-key interpolation for pluralization-free result labels: `t(\\`housekeeping.inspectionModal.manualResult.${row.overall_result}\\`)` reused directly in inspections/page.tsx's history table instead of re-declaring a local resultLabel() helper — same dynamic-key pattern as 04-11's `t(\\`housekeeping.page.shifts.${s.key}\\`)`."
    - "Bold-count-preserving sentence translation: the CSV/manual room-import result banner keeps the imported/skipped counts as their own untranslated <span className=\"font-semibold\"> nodes while translating only the surrounding words (importedPrefix/roomWord/roomsWord/skippedWord) — avoids needing a Trans component for a 3-fragment sentence with inline bold spans."
key-files:
  modified:
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts
    - apps/web/app/(dashboard)/housekeeping/inspections/page.tsx
    - apps/web/app/(dashboard)/housekeeping/rooms/page.tsx
key-decisions:
  - "Left lib/utils/roomStatus.ts's STATUS_LABELS/STATUS_COLORS (rendered raw in rooms/page.tsx's status filter dropdown and StatusBadge) untranslated, continuing the 04-09/04-10/04-11 shared-util precedent — the file is consumed by 5 other components outside this plan's scope (RoomDetailDrawer, settings/rooms, reports, lost-found, plus this page)."
  - "Left the CSV import example content in rooms/page.tsx untranslated: the 'Expected columns:' code block's literal column names (room_number, floor, room_type_code, room_type_name, building), the multi-line textarea placeholder (CSV header + two sample data rows), and the manual-entry Input placeholders (101, SD, Standard Double, Main) — these are literal technical syntax/example values the user must type verbatim, not prose copy."
  - "Reused common.cancel for the exact-match 'Cancel' button copy in both rooms/page.tsx delete-confirm flows (mobile card + desktop table row) instead of duplicating a roomsPage.cancel key, matching the existing RoomDetailDrawer/InspectionModal/evidence page precedent for that key."
  - "Reused housekeeping.inspectionModal.manualResult.*/optionalTag in inspections/page.tsx (history result pill + result-filter dropdown options, and the re-assign note's '(optional)' tag) instead of duplicating identical Passed/Failed/Conditional/'(optional)' copy in the new inspectionsPage namespace."
  - "Renamed two pre-existing `.map((t) => ...)` loop variables (tab arrays in both files) to `tabKey` — required to avoid the loop item shadowing the `useTranslation()` `t` function now in scope in the same component; a Rule 1 bug-prevention fix made inline while wiring, not a scope change."
requirements-completed: [BL-01, D-03]

# Metrics
duration: "~20 min"
completed: "2026-07-23"
---

# Phase 4 Plan 12: Housekeeping Inspections + Rooms Route Bilingual Coverage Summary

Extended `react-i18next` locale objects (`i18n/locales/{en,es}.ts`) with two new `housekeeping.*` sub-namespaces (`inspectionsPage` — live/history tabs, strip/inspection queues, empty state, toasts, history filters+table, re-assign drawer; `roomsPage` — heading, filters, table, empty/loading/error states, full CSV+manual import modal) and rewired the last two app-route pages inside D-04's locked gate glob that live under `housekeeping/` — the inspections page (strip queue, inspection queue, inspection history with re-assign-on-fail flow) and the all-rooms admin page (filterable room table + CSV/manual room-import modal) — to render every user-facing string via `useTranslation()`/`t()`, closing D-03's full housekeeping-directory app-route coverage requirement.

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-23T19:34:35-05:00
- **Completed:** 2026-07-23T19:48:14-05:00
- **Tasks:** 2/2 (both `type="auto"`, no checkpoints — `autonomous: true`)
- **Files modified:** 4 (2 locale files, 2 route page files)

## Accomplishments

- `i18n/locales/en.ts` / `es.ts` gained `housekeeping.inspectionsPage` and `housekeeping.roomsPage` namespaces, full EN/ES key-sequence parity verified programmatically (806/806 multi-line keys match sequence, identical count and order both files).
- `app/(dashboard)/housekeeping/inspections/page.tsx` now renders via `useTranslation()`/`t()`:
  - `StripQueueCard` / `QueueCard` — Departure/Unassigned labels, Floor {{floor}}, Due out/Cleaned at timestamps, Marking…/Mark Stripped, Inspect buttons.
  - Main page — PageHeader eyebrow/title/subtitle, Live/Live · {{count}}/History tabs, Ready to Strip / Inspection Queue section headings, empty-state title+subtitle, all 6 toast messages (strip success/error, pass/conditional success, re-assign success/error).
  - History tab — From/To date labels, Today/This Week buttons, result-filter dropdown (reusing `inspectionModal.manualResult.*`), 5 table column headers, Unknown inspector fallback, Pending pill, empty-period message, result pill (dynamic-key reuse of `inspectionModal.manualResult.*`).
  - Re-assign drawer — title/subtitle, Housekeeper label + select-housekeeper placeholder + "(original)" suffix, note label (reusing `inspectionModal.optionalTag`) + placeholder, Skip/Re-assigning…/Re-assign buttons.
- `app/(dashboard)/housekeeping/rooms/page.tsx` now renders via `useTranslation()`/`t()`:
  - `RoomMobileCard` — Room {{number}}, Room type unknown fallback, Floor/Assigned dt labels, Unassigned fallback, Edit Room button, Confirm/Cancel (Cancel reuses `common.cancel`).
  - `ImportModal` — header, CSV Upload/Manual Entry tabs, import result banner (bold count spans preserved, surrounding words translated), error banner messages (no-valid-rows, no-room-number), CSV tab (Expected columns: prefix, Upload CSV file label, or paste CSV, preview heading + 5 preview-table headers), Manual tab (help text, 5 table headers + Add Row), footer (Close/Cancel, Preview, Import {{count}} Rooms/Importing…, Import Rooms/Importing…).
  - Main page — All Rooms heading, {{count}} total room(s) subtitle, Import Rooms button, All Floors/Floor {{floor}}/All Statuses filter options, search placeholder, {{count}} result(s) pill, table loading/error/empty states, 6 table column headers, per-row Edit/Delete-title/Confirm/Cancel (Cancel reuses `common.cancel`).

## Task Commits

Each task was committed atomically:

1. **Task 1: Translate housekeeping/inspections/page.tsx** — `30eb812d` (feat)
2. **Task 2: Translate housekeeping/rooms/page.tsx** — `2a4bea70` (feat)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `apps/web/i18n/locales/en.ts` / `es.ts` — added `housekeeping.inspectionsPage` (tabs, stripSection, queueSection, empty, toast, history incl. nested table, reassign) and `housekeeping.roomsPage` (heading, filters, table, empty, import incl. nested tabs/previewHeaders) namespaces, full EN/ES parity.
- `apps/web/app/(dashboard)/housekeeping/inspections/page.tsx` — `StripQueueCard`, `QueueCard`, and `InspectionsPage` (incl. history tab + re-assign drawer) rewired to `t()`; removed the now-redundant local `resultLabel()` helper (replaced with a dynamic-key `t()` call reusing `inspectionModal.manualResult.*`); renamed a shadowing `.map((t) => ...)` tab-loop variable to `tabKey`.
- `apps/web/app/(dashboard)/housekeeping/rooms/page.tsx` — `RoomMobileCard`, `ImportModal`, and `RoomsPage` rewired to `t()`; renamed a shadowing `.map((t) => ...)` tab-loop variable to `tabKey`.

## Decisions Made

See `key-decisions` in the frontmatter above (shared roomStatus util and CSV example/placeholder content left as raw data per established precedent; `common.cancel`/`inspectionModal.manualResult.*`/`inspectionModal.optionalTag` reused instead of duplicating; two loop-variable renames to prevent `t` shadowing).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Renamed shadowing `.map((t) => ...)` loop variables in both files**
- **Found during:** Task 1 and Task 2 (while adding `const { t } = useTranslation()` to each page component)
- **Issue:** Both pre-existing tab-bar renderers (`(['live','history'] as const).map((t) => ...)` in inspections/page.tsx, `(['csv','manual'] as const).map((t) => ...)` in rooms/page.tsx's `ImportModal`) used `t` as the loop-item variable name. Adding `useTranslation()`'s `t` to the same component scope would have the loop variable shadow the translation function inside that JSX block, silently breaking any `t()` call placed there.
- **Fix:** Renamed both loop variables to `tabKey` (and all their internal references: `key={tabKey}`, `setTab(tabKey)`, `tab === tabKey`, `tabKey === 'live'|'csv'`).
- **Files modified:** `apps/web/app/(dashboard)/housekeeping/inspections/page.tsx`, `apps/web/app/(dashboard)/housekeeping/rooms/page.tsx`
- **Commit:** `30eb812d` (Task 1), `2a4bea70` (Task 2)

---

**Total deviations:** 1 (Rule 1, two occurrences across the two files, auto-fixed inline, no user decision required)
**Impact on plan:** None to plan scope. Both fixes were made while wiring the exact named files, not new files — pure variable renames with no behavior change to the tab-switching logic (verified by `type-check` and `lint` passing clean, and by all `tab === tabKey` comparisons preserving identical semantics to the original `tab === t`).

## Issues Encountered

- This worktree's branch HEAD was found reset to a stale, pre-Phase-4 commit (`268f7474`, from the Phase 3 era, predating wave 3's tracking commit) at the mandatory `worktree_branch_check` step — corrected via `git reset --hard` to the expected base `b5af9b3b665be600003c92c242e4ea6d347d2cf2` ("wave 3" tracking commit) per protocol. Verified via `git merge-base --is-ancestor` in both directions before resetting (confirmed HEAD was a strict ancestor of the expected base, i.e. a pure fast-forward with no unique local commits at risk) — matching the same recovery pattern documented in 04-09/04-10/04-11's summaries.
- This worktree had no `node_modules` installed at agent start (fresh git worktree checkout). Created Windows directory junctions (`mklink /J`, via `cmd.exe` with `MSYS2_ARG_CONV_EXCL="*"` to avoid Git Bash path-mangling of the target argument) from this worktree's `node_modules` and `apps/web/node_modules` to the main repo's installed dependencies (read-only reuse, not committed — both paths are gitignored) to run `npm run type-check`, `npm run lint`, and an eslint pass on the touched files without a full reinstall.
- The scoped `i18next/no-literal-string` ESLint gate added in 04-08 (`apps/web/eslint.config.mjs`) still does not cover the two files this plan translated — its `files` glob remains scoped to the original 04-08 file list, matching the established 04-09/04-10/04-11 precedent of not widening the gate mid-slice. `04-16` is expected to widen it.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All app-route pages inside D-04's locked gate glob (`app/(dashboard)/{housekeeping,engineering,tasks,programs}/**`) that live under `housekeeping/` are now literal-free and genuinely usable in English and Spanish (D-03/BL-01): landing + assignments (04-11), and inspections + rooms (this plan), completing D-03's full housekeeping-directory app-route coverage requirement alongside 04-08's housekeeping program depth and 04-09/04-10's component-level coverage.
- `lib/utils/roomStatus.ts` (`STATUS_LABELS`/`STATUS_COLORS`) remains an intentionally untouched shared-utility file per the established 04-09/04-10/04-11 precedent (out-of-scope shared logic, non-regression policy) since it's consumed across 5 components including this plan's `rooms/page.tsx`.
- 04-16 (widening the D-04 lint gate) can now safely include the full `housekeeping/**` app-route surface built by 04-08 through 04-12 — every file under `app/(dashboard)/housekeeping/**` inside the gate glob is bilingual.

## Self-Check: PASSED

- FOUND: `apps/web/i18n/locales/en.ts` contains `housekeeping.inspectionsPage`, `housekeeping.roomsPage`
- FOUND: `apps/web/i18n/locales/es.ts` — same namespaces present; whole-file multi-line key sequence verified programmatically (806/806 keys match, identical order both files)
- FOUND: commit `30eb812d` (Task 1)
- FOUND: commit `2a4bea70` (Task 2)
- VERIFIED: `grep -c "useTranslation" "apps/web/app/(dashboard)/housekeeping/inspections/page.tsx"` → 4 (≥ 1 required)
- VERIFIED: `grep -c "useTranslation" "apps/web/app/(dashboard)/housekeeping/rooms/page.tsx"` → 4 (≥ 1 required)
- VERIFIED: `grep -c "inspectionsPage" en.ts` == `grep -c "inspectionsPage" es.ts` (both 1, non-zero)
- VERIFIED: `grep -c "roomsPage" en.ts` == `grep -c "roomsPage" es.ts` (both 1, non-zero)
- VERIFIED: `cd apps/web && npm run type-check` → clean (0 errors)
- VERIFIED: `cd apps/web && npx eslint "app/(dashboard)/housekeeping/rooms/page.tsx" "app/(dashboard)/housekeeping/inspections/page.tsx" i18n/locales/en.ts i18n/locales/es.ts` → clean (0 errors, 0 warnings)
- VERIFIED: `cd apps/web && npm run lint` (full project) → clean (0 errors, 0 warnings)
- VERIFIED: `git diff --diff-filter=D --name-only HEAD~2 HEAD` → empty (no accidental file deletions across both task commits)

---
*Phase: 04-maintenance-and-housekeeping-programs*
*Completed: 2026-07-23*

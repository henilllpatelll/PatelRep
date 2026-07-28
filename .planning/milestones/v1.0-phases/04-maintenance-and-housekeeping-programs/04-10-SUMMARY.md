---
phase: 04-maintenance-and-housekeeping-programs
plan: 10
subsystem: ui
tags: [i18n, react-i18next, housekeeping, room-detail-drawer, inspection, occupancy-import]

# Dependency graph
requires:
  - phase: 04-09
    provides: "housekeeping.* i18n namespace precedent (roomStatus/assignmentSidebar/roomCard/predictionPanel) and shared en.ts/es.ts locale files this plan extends"
provides:
  - "Full EN/ES i18n coverage of the Room Detail Drawer, Inspection Modal, and Occupancy Import Modal — the deepest daily housekeeping drill-down surfaces"
  - "housekeeping.roomDetail / housekeeping.inspectionModal / housekeeping.occupancyImport i18n namespaces in en.ts/es.ts with full key parity"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level helper functions that render translated strings outside component scope (formatHistoryTimestamp, getActionLabel, formatLastAction in RoomDetailDrawer.tsx; OverallResultBadge in InspectionModal.tsx) take a `t: TFunction` (imported from `i18next`) parameter, matching the WorkOrderCard.tsx precedent from 04-08/04-09."
    - "Sub-components rendered outside the main component's closure (DropZone, ResultBanner in OccupancyImportModal.tsx) also take an explicit `t: TFunction` prop rather than calling `useTranslation()` themselves, since they are plain function components invoked directly (not custom hooks)."
    - "Renamed a map-callback parameter from `t` to `taskItem` in RoomDetailDrawer.tsx's room-history event builder — the original code used `(t: any) => ...` for a task item, which would have shadowed the outer i18n `t` function and silently broken translation calls inside that callback (caught before commit, not a runtime bug introduced)."
    - "Cross-namespace key reuse for identical shared copy: InspectionModal.tsx reuses `housekeeping.roomDetail.lastClean.itemsCount` / `photoOne` / `photoOther` for its identical 'N/M items' and 'N photo(s)' strings rather than duplicating them under `inspectionModal.*`."
    - "Fragmented-sentence translation keys (OccupancyImportModal's `uploadPrefix` + `hkDetailsLabel`/`taskSheetLabel` + `hkDetailsDescription`/`taskSheetDescription`) are NOT required to mirror the same word order per locale — each locale's fragments are composed to read naturally when concatenated in the fixed JSX order, even though the EN and ES prefixes carry different literal meanings (EN 'Upload the', ES 'Suba el informe') to produce grammatically correct sentences in both languages."
key-files:
  modified:
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts
    - apps/web/components/housekeeping/RoomDetailDrawer.tsx
    - apps/web/components/housekeeping/InspectionModal.tsx
    - apps/web/components/housekeeping/OccupancyImportModal.tsx
key-decisions:
  - "Split the header 'Assigned to {{name}}' string into a plain `assignedToPrefix` key (no interpolation) rather than a combined `'Assigned to {{name}}'` template, so the housekeeper's name can remain independently bold-styled in JSX instead of being flattened into the translated string."
  - "Added a new `roomDetailsAria` key distinct from the visible `roomLabel` key so the drawer's `aria-label` ('Room {{roomNumber}} details') is fully translated rather than partially composed via string concatenation."
  - "Added `housekeeping.roomDetail.departureCheckout.save: 'Save'` rather than reusing `programs.save` (an existing identical string) — `programs.save` lives in an unrelated PM-schedule/DND-settings namespace and coupling the room-detail departure-checkout Save button to it would create an unrelated cross-domain dependency for a one-word label."
  - "Added `resultBadge.{passed,failed,conditional}` (all-caps, for the auto-calculated badge) and a separate `manualResult.{passed,failed,conditional}` (title-case, for the manual radio-button fallback when no inspection template items exist) rather than reusing one set for both UI treatments, since the original English strings used different casing/wording ('PASSED' vs 'Passed') for the two contexts."
  - "OccupancyImportModal's close button previously had no `aria-label` at all; added `housekeeping.occupancyImport.closeAria` (Rule 2 — accessibility gap) rather than leaving it untranslated-because-absent."
requirements-completed: [BL-01, D-03]

# Metrics
duration: "~50 min"
completed: "2026-07-23"
---

# Phase 4 Plan 10: Room Detail Drawer, Inspection Modal, Occupancy Import Bilingual Coverage Summary

Extended `react-i18next` locale objects (`i18n/locales/{en,es}.ts`) with three new `housekeeping.*` sub-namespaces (`roomDetail` — 51 leaf keys, `inspectionModal` — 33 leaf keys, `occupancyImport` — 20 leaf keys, all with full EN/ES parity) and rewired the three deepest daily housekeeping drill-down surfaces — the 1199-line Room Detail Drawer, the 613-line Inspection Modal, and the 255-line Occupancy Import Modal — to render every user-facing string via `useTranslation()`/`t()`, continuing the D-03 bilingual floor contract closure started in 04-08/04-09.

## Performance

- **Duration:** ~50 min
- **Tasks:** 3/3 (all `type="auto"`, no checkpoints — `autonomous: true`)
- **Files modified:** 5 (2 locale files, 3 component files)

## Accomplishments

- `i18n/locales/en.ts` / `es.ts` gained `housekeeping.roomDetail`, `housekeeping.inspectionModal`, and `housekeeping.occupancyImport` namespaces — verified programmatically at both the new-namespace level (152 → 158 keys as sections were added, 0 missing either direction) and the whole-file level (757/757 keys, 0 missing either direction).
- `RoomDetailDrawer.tsx` now renders via `useTranslation()`/`t()`: header (room label, aria-labels, guest/check-in/checkout meta, VIP badge reusing `roomCard.vip`), assigned-to/last-action line, late-checkout banner, the full departure-checkout block (checked-out/scheduled/no-time states, Mark Checked Out / Undo Checkout / Stayover buttons and their success/error copy), the 3-button action grid (Add Note / Work Order / Lost & Found), OOO work-order info, note and work-order forms (including the 8 WO category options and 3 priority options), guest-requests and open-tasks section headings, the supervisor-only Last Clean evidence block, the AI Prediction risk badge/ETA/risk-factors block, and the full Room History event timeline (work-order/guest-request/task/clean-session fallback labels, "Yesterday {{time}}", "by you"/"by {{name}}" actor suffixes, action labels like "Marked clean"/"Returned to cleaning").
- `InspectionModal.tsx` now renders via `useTranslation()`/`t()`: the Re-clean dispatch dialog, the main inspection header (title, "Cleaned by", last-clean minutes/items/photos), the loading/no-template states, the Pass/Fail/N-A per-item toggles and photo-evidence prompts, the auto-calculated result badge and manual-radio fallback, notes, and all submit/error/retry states (including pluralized "N required item(s)" and "N failed item(s) require(s) photo evidence" validation messages).
- `OccupancyImportModal.tsx` now renders via `useTranslation()`/`t()`: the modal title and (newly added) close-button aria-label, the two HK Details / Task Sheet tabs, both upload-instruction paragraphs (with the bold report-name span preserved), both dropzones' labels and "or click to browse" hint, both Apply buttons, and the import-result banner (applied/total count, pluralized skipped/not-found counts, "+N more warnings").
- Fixed a latent naming-collision bug before it could ship: the original `RoomDetailDrawer.tsx` used `(t: any) => ...` as a map-callback parameter name for a task item inside the Room History event builder, which would have shadowed the outer i18n `t` function and broken any translation call made inside that callback. Renamed the parameter to `taskItem`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Translate RoomDetailDrawer.tsx** — `8673ad0e` (feat)
2. **Task 2: Translate InspectionModal.tsx** — `38b8f9b8` (feat)
3. **Task 3: Translate OccupancyImportModal.tsx** — `82c3dd56` (feat)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `apps/web/i18n/locales/en.ts` / `es.ts` — added `housekeeping.roomDetail`, `housekeeping.inspectionModal`, `housekeeping.occupancyImport` namespaces (104 new leaf keys total across the three namespaces, full EN/ES parity; whole-file parity re-verified at 757/757 keys after all edits).
- `apps/web/components/housekeeping/RoomDetailDrawer.tsx` — full drawer UI, module-level helpers (`formatHistoryTimestamp`, `getActionLabel`, `formatLastAction`) converted to accept a `TFunction` parameter.
- `apps/web/components/housekeeping/InspectionModal.tsx` — full modal UI including the re-clean sub-dialog; `OverallResultBadge` helper converted to accept a `TFunction` parameter.
- `apps/web/components/housekeeping/OccupancyImportModal.tsx` — full modal UI; `DropZone` and `ResultBanner` sub-components converted to accept a `TFunction` prop.

## Decisions Made

See `key-decisions` in the frontmatter above (assignedTo prefix split to preserve bold name styling, dedicated `roomDetailsAria` key, dedicated `departureCheckout.save` key instead of coupling to the unrelated `programs.save`, separate `resultBadge`/`manualResult` casing sets, and the added `occupancyImport.closeAria` accessibility fix).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Renamed a shadowing `t` parameter in RoomDetailDrawer.tsx's task-events map callback**
- **Found during:** Task 1 (wiring the Room History section)
- **Issue:** The pre-existing code used `allTasks.map((t: any): RoomEvent => ({ ..., title: t.title ?? 'Task', ... }))`. Introducing `useTranslation()`'s `t` in the enclosing component scope meant this callback's own `t` parameter (the task item) would shadow the i18n `t` function for any `t('...')` call written inside that specific callback body.
- **Fix:** Renamed the callback parameter to `taskItem` and used `t('housekeeping.roomDetail.history.taskFallback')` for the translated fallback title.
- **Files modified:** `apps/web/components/housekeeping/RoomDetailDrawer.tsx`
- **Commit:** `8673ad0e`

**2. [Rule 2 - Missing accessibility] Added a close-button `aria-label` to OccupancyImportModal.tsx**
- **Found during:** Task 3
- **Issue:** The modal's close (`X`) button had no `aria-label` at all in the original code (visual-only icon button).
- **Fix:** Added `aria-label={t('housekeeping.occupancyImport.closeAria')}` with matching EN/ES copy.
- **Files modified:** `apps/web/components/housekeeping/OccupancyImportModal.tsx`, `apps/web/i18n/locales/en.ts`, `apps/web/i18n/locales/es.ts`
- **Commit:** `82c3dd56`

---

**Total deviations:** 2 (both Rule 1/2, auto-fixed inline, no user decision required)
**Impact on plan:** None to plan scope. The plan's `files_modified` frontmatter (3 components + 2 locale files) was followed exactly; both fixes were surfaced while wiring the named files, not new files.

## Issues Encountered

- This worktree had no `node_modules` installed at agent start (this worktree's HEAD was also found reset to a stale, unrelated commit at the mandatory `worktree_branch_check` step — corrected via `git reset --hard` to the expected base `86eb17e1` per protocol, matching the same pattern documented in 04-09's summary). Created Windows directory junctions (`mklink /J`) from this worktree's `node_modules` and `apps/web/node_modules` to the main repo's installed dependencies (read-only, not committed — both paths are gitignored) to run `npm run type-check`, `npx eslint`, and the key-parity verification script without a full reinstall.
- `npm run build` (full production build) fails in this specific worktree with a Turbopack-internal error ("Symlink [project]/node_modules is invalid, it points out of the filesystem root") — this is caused by the junction-symlink workaround above (Turbopack's filesystem-root detection rejects the cross-worktree junction), not by any code change in this plan. `npm run type-check` and `npm run lint` (the plan's actual stated verification commands) both pass cleanly; the production build was not part of this plan's `<verification>` requirements.
- The scoped `i18next/no-literal-string` ESLint gate added in 04-08 (`apps/web/eslint.config.mjs`) still does not cover the three files this plan translated — its `files` glob remains scoped to the original 04-08 file list, matching 04-09's precedent of not widening the gate mid-slice. Widening it is deferred to a follow-up hardening pass (tracked in `deferred-items.md`) once the remaining `components/housekeeping/**` files (occupancy views, dashboards, etc. not touched by 04-09 or 04-10) are also translated, so the gate can cover the whole directory without breaking `npm run lint` on still-untranslated siblings.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The Room Detail Drawer, Inspection Modal, and Occupancy Import Modal — the highest-detail daily housekeeping interactions — are now genuinely usable in English and Spanish (D-03/BL-01), continuing the bilingual floor contract closing slice (4C) alongside 04-08 (PM completion/schedules, housekeeping depth panels) and 04-09 (Room Status Board, Room Cards, Assignment Sidebar, Prediction Panel).
- Remaining `components/housekeeping/**` surfaces not yet translated by 04-08/04-09/04-10 (e.g. any occupancy/dashboard views outside this plan's three named files) are the natural next slice; `lib/utils/cleanType.ts` and `lib/utils/roomStatus.ts` (STATUS_LABELS, CLEAN_TYPE_LABELS) remain intentionally untouched shared-utility files per the established precedent (out-of-scope shared logic, non-regression policy) since they are consumed across 8+ components.
- Once the remaining `components/housekeeping/**` files are translated, `apps/web/eslint.config.mjs`'s scoped `i18next/no-literal-string` gate should be widened to include `RoomDetailDrawer.tsx`, `InspectionModal.tsx`, and `OccupancyImportModal.tsx` (and the rest of the directory) so the hard-fail lint gate covers the whole floor-facing surface.

## Self-Check: PASSED

- FOUND: `apps/web/i18n/locales/en.ts` contains `housekeeping.roomDetail`, `housekeeping.inspectionModal`, `housekeeping.occupancyImport`
- FOUND: `apps/web/i18n/locales/es.ts` — same namespaces, key parity verified programmatically (whole-file: 757/757 keys match, 0 missing either direction)
- FOUND: commit `8673ad0e` (Task 1)
- FOUND: commit `38b8f9b8` (Task 2)
- FOUND: commit `82c3dd56` (Task 3)
- VERIFIED: `grep -c "useTranslation" apps/web/components/housekeeping/RoomDetailDrawer.tsx` → 2 (≥ 1 required)
- VERIFIED: `grep -c "useTranslation" apps/web/components/housekeeping/InspectionModal.tsx` → 2 (≥ 1 required)
- VERIFIED: `grep -c "useTranslation" apps/web/components/housekeeping/OccupancyImportModal.tsx` → 2 (≥ 1 required)
- VERIFIED: `grep -c "roomDetail" en.ts` == `grep -c "roomDetail" es.ts` (both 2, non-zero)
- VERIFIED: `grep -c "inspectionModal" en.ts` == `grep -c "inspectionModal" es.ts` (both 1, non-zero)
- VERIFIED: `grep -c "occupancyImport" en.ts` == `grep -c "occupancyImport" es.ts` (both 1, non-zero)
- VERIFIED: `cd apps/web && npm run type-check` → clean (0 errors)
- VERIFIED: `cd apps/web && npx eslint components/housekeeping/{RoomDetailDrawer,InspectionModal,OccupancyImportModal}.tsx i18n/locales/{en,es}.ts` → clean (0 errors, 0 warnings)
- VERIFIED: `cd apps/web && npm run lint` (full project) → clean (0 errors, 0 warnings)

---
*Phase: 04-maintenance-and-housekeeping-programs*
*Completed: 2026-07-23*

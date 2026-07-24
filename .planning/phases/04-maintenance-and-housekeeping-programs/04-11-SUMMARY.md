---
phase: 04-maintenance-and-housekeeping-programs
plan: 11
subsystem: ui
tags: [i18n, react-i18next, housekeeping, app-router, gate-glob]

# Dependency graph
requires:
  - phase: 04-10
    provides: "housekeeping.* i18n namespace precedent (roomDetail/inspectionModal/occupancyImport) and shared en.ts/es.ts locale files this plan extends"
provides:
  - "Full EN/ES i18n coverage of the housekeeping landing route (app/(dashboard)/housekeeping/page.tsx) and the assignments route (app/(dashboard)/housekeeping/assignments/page.tsx) — the two app-route pages inside D-04's locked gate glob"
  - "housekeeping.page / housekeeping.assignmentsPage i18n namespaces in en.ts/es.ts with full key parity"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SHIFTS filter array (module-level constant used inside a <select>) was refactored from `{ value, label }` to `{ value, key }`, resolving the display label at render time via `t(`housekeeping.page.shifts.${s.key}`)` inside the component that owns the JSX — avoids needing a TFunction parameter on a plain data array."
    - "statusConfig (a per-render Record<string, {label, pillClass}> built inside HousekeeperRoomItem's function body, not module scope) calls t() directly since it already executes inside the component render where useTranslation()'s t is in scope — no TFunction-parameter helper needed, unlike the module-level helpers in 04-08/04-09/04-10."
    - "Manual pluralization branching (count === 1 ? t('...One') : t('...Other')) used for the AI auto-assign success count message, matching the established codebase pattern from AssignmentSidebar.tsx/RoomCard.tsx rather than i18next's built-in _one/_other key suffix convention."
key-files:
  modified:
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts
    - apps/web/app/(dashboard)/housekeeping/page.tsx
    - apps/web/app/(dashboard)/housekeeping/assignments/page.tsx
key-decisions:
  - "Left `lib/utils/cleanType.ts`'s `getCleanTypeShortLabel()` output (rendered raw inside HousekeeperRoomItem's clean-type chip) untranslated, continuing the 04-09/04-10 precedent — the shared util is consumed by 8+ other components outside this plan's scope."
  - "Left the `WO-{{number}}` work-order-reference prefix in HousekeeperRoomItem as raw string concatenation (not translated), matching the identical `WO-{wo.work_order_number}` precedent already established in `WorkOrderCard.tsx` (04-08) — it is a formatted ID label, not prose copy."
  - "Both `housekeeping.page.*` and `housekeeping.assignmentsPage.*` locale keys were added to en.ts/es.ts in a single edit (during Task 1) since they are adjacent namespaces in the same file; Task 2 only needed to wire `assignments/page.tsx` to already-present keys. This does not change plan scope — the plan's `files_modified` frontmatter already listed both locale files without a task-specific split."
requirements-completed: [BL-01, D-03]

# Metrics
duration: "~35 min"
completed: "2026-07-23"
---

# Phase 4 Plan 11: Housekeeping Landing + Assignments Route Bilingual Coverage Summary

Extended `react-i18next` locale objects (`i18n/locales/{en,es}.ts`) with two new `housekeeping.*` sub-namespaces (`page` — 38 leaf keys, `assignmentsPage` — 23 leaf keys, full EN/ES parity) and rewired the two app-route pages that sit inside D-04's locked gate glob (`app/(dashboard)/{housekeeping,engineering,tasks,programs}/**`) — the housekeeping landing page (role-adaptive: housekeeper "My Rooms" view + supervisor/GM Room Status Board view) and the room-assignments table page — to render every user-facing string via `useTranslation()`/`t()`, closing D-03's full housekeeping-directory coverage requirement.

## Performance

- **Duration:** ~35 min
- **Tasks:** 2/2 (both `type="auto"`, no checkpoints — `autonomous: true`)
- **Files modified:** 4 (2 locale files, 2 route page files)

## Accomplishments

- `i18n/locales/en.ts` / `es.ts` gained `housekeeping.page` and `housekeeping.assignmentsPage` namespaces — verified programmatically at the whole-file level (829/829 keys match, 0 missing either direction after both tasks).
- `app/(dashboard)/housekeeping/page.tsx` now renders via `useTranslation()`/`t()` across all five of its internal components:
  - `SyncBadge` — live/never-synced/just-now/N-min-ago sync status text.
  - `HousekeeperBar` (assign-mode chip bar) — "Tap rooms to assign" / "Select a housekeeper:", Saved/save-error copy, Save button, "No housekeeper staff found." + "Add staff" link.
  - `HousekeeperRoomItem` — Room {{number}} label, Ready Occupied/Vacant, Checked out/Due out, all 7 status-chip labels (Vacant Dirty, Occupied Dirty, Pickup, In Progress, Clean, Inspected/Ready, Out of Order), Confirm Done/Cancel/Done/Confirm Undo/Undo buttons, "Tap for notes & issues" hint, Start button, "Waiting for / supervisor" two-line copy.
  - `HousekeeperMyRoomsView` — "My Rooms" heading, to-do/in-progress/done stat labels, empty-state copy.
  - `SupervisorHousekeepingPage` — page header eyebrow/title, Previous/Next day aria-labels, shift-select options (via the refactored `SHIFTS` array), Exit assign/Assign mode button text.
  - The role-gated entry point's "You don't have access to this section." fallback.
- `app/(dashboard)/housekeeping/assignments/page.tsx` now renders via `useTranslation()`/`t()`: page heading/subtitle, Import from Opera / Auto-Assign with AI / Thinking... buttons, Date label / Today button, the AI success (pluralized count) / generic-success / failure banner text, the table's 4 column headers, Show/Hide rooms toggle text, "No rooms listed" empty state, and the top-level loading-error / no-assignments empty state (title + subtitle).

## Task Commits

Each task was committed atomically:

1. **Task 1: Translate housekeeping/page.tsx** — `17b43f00` (feat) — also added both `housekeeping.page.*` and `housekeeping.assignmentsPage.*` locale keys (adjacent namespaces, single locale-file edit)
2. **Task 2: Translate housekeeping/assignments/page.tsx** — `00486805` (feat)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `apps/web/i18n/locales/en.ts` / `es.ts` — added `housekeeping.page` (38 leaf keys: shifts, sync, assignBar, roomItem incl. nested status, myRooms, board, noAccess) and `housekeeping.assignmentsPage` (23 leaf keys: header/buttons, date picker, AI banner incl. pluralized success, table incl. nested column labels, empty/error states) namespaces, full EN/ES parity.
- `apps/web/app/(dashboard)/housekeeping/page.tsx` — all 5 internal components (`SyncBadge`, `HousekeeperBar`, `HousekeeperRoomItem`, `HousekeeperMyRoomsView`, `SupervisorHousekeepingPage`) plus the role-gated default export now render via `t()`; `SHIFTS` module constant refactored from `{value, label}` to `{value, key}`.
- `apps/web/app/(dashboard)/housekeeping/assignments/page.tsx` — `AssignmentsPage` component fully rewired to `t()`; added a missing `aria-label` to the AI-message dismiss button (Rule 2).

## Decisions Made

See `key-decisions` in the frontmatter above (shared-util clean-type label and `WO-` ID-prefix left as raw data per the 04-08/04-09/04-10 precedent; both locale namespaces added together in Task 1's commit since they're adjacent in the same file).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing accessibility] Added a dismiss-button aria-label to the AI message banner in assignments/page.tsx**
- **Found during:** Task 2
- **Issue:** The `✕` dismiss button on the AI success/failure banner had no `aria-label` at all in the original code (visual-only icon button, unlabeled for screen readers).
- **Fix:** Added `aria-label={t('housekeeping.assignmentsPage.dismissAria')}` with matching EN ("Dismiss message") / ES ("Descartar mensaje") copy.
- **Files modified:** `apps/web/app/(dashboard)/housekeeping/assignments/page.tsx`, `apps/web/i18n/locales/en.ts`, `apps/web/i18n/locales/es.ts`
- **Commit:** `00486805`

---

**Total deviations:** 1 (Rule 2, auto-fixed inline, no user decision required)
**Impact on plan:** None to plan scope. The plan's `files_modified` frontmatter (2 route pages + 2 locale files) was followed exactly; the fix was surfaced while wiring the named file, not a new file.

## Issues Encountered

- This worktree's branch HEAD was found reset to a stale, pre-Phase-4 commit (predating `26779038`, at commit `268f7474` from the Phase 3 era) at the mandatory `worktree_branch_check` step — corrected via `git reset --hard` to the expected base `2677903845c9cfbfc86dc87e3e41bc95891a63ec` per protocol, matching the same recovery pattern documented in 04-09's and 04-10's summaries. Verified the working tree was clean before the reset (no uncommitted work at risk).
- This worktree had no `node_modules` installed at agent start (fresh git worktree checkout). Created Windows directory junctions (`mklink /J`, via `cmd.exe` with `MSYS2_ARG_CONV_EXCL="*"` to avoid Git Bash path-mangling of the target argument) from this worktree's `node_modules` and `apps/web/node_modules` to the main repo's installed dependencies (read-only reuse, not committed — both paths are gitignored) to run `npm run type-check`, `npm run lint`, and a whole-file key-parity verification script without a full reinstall.
- The scoped `i18next/no-literal-string` ESLint gate added in 04-08 (`apps/web/eslint.config.mjs`) still does not cover the two files this plan translated — its `files` glob remains scoped to the original 04-08 file list, matching the established 04-09/04-10 precedent of not widening the gate mid-slice.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Both app-route pages inside D-04's locked gate glob (`app/(dashboard)/{housekeeping,engineering,tasks,programs}/**`) that live under `housekeeping/` are now literal-free and genuinely usable in English and Spanish (D-03/BL-01), completing D-03's full housekeeping-directory coverage requirement alongside 04-08 (PM completion/schedules, housekeeping program depth), 04-09 (Room Status Board, Room Cards, Assignment Sidebar, Prediction Panel), and 04-10 (Room Detail Drawer, Inspection Modal, Occupancy Import Modal).
- `lib/utils/cleanType.ts` (`getCleanTypeShortLabel`) remains an intentionally untouched shared-utility file per the established precedent (out-of-scope shared logic, non-regression policy) since it's consumed across 8+ components including this plan's `page.tsx`.
- 04-16 (widening the D-04 lint gate) can now safely include the full `housekeeping/**` app-route + component surface — 04-08 through 04-11 collectively cover every file under `app/(dashboard)/housekeeping/**` and `components/housekeeping/**`.

## Self-Check: PASSED

- FOUND: `apps/web/i18n/locales/en.ts` contains `housekeeping.page`, `housekeeping.assignmentsPage`
- FOUND: `apps/web/i18n/locales/es.ts` — same namespaces, whole-file key parity verified programmatically (829/829 keys match, 0 missing either direction)
- FOUND: commit `17b43f00` (Task 1)
- FOUND: commit `00486805` (Task 2)
- VERIFIED: `grep -c "useTranslation" "apps/web/app/(dashboard)/housekeeping/page.tsx"` → 7 (≥ 1 required)
- VERIFIED: `grep -c "useTranslation" "apps/web/app/(dashboard)/housekeeping/assignments/page.tsx"` → 2 (≥ 1 required)
- VERIFIED: `grep -c "assignmentsPage" en.ts` == `grep -c "assignmentsPage" es.ts` (both 1, non-zero)
- VERIFIED: `cd apps/web && npm run type-check` → clean (0 errors)
- VERIFIED: `cd apps/web && npx eslint "app/(dashboard)/housekeeping/page.tsx" "app/(dashboard)/housekeeping/assignments/page.tsx" i18n/locales/en.ts i18n/locales/es.ts` → clean (0 errors, 0 warnings)
- VERIFIED: `cd apps/web && npm run lint` (full project) → clean (0 errors, 0 warnings)

---
*Phase: 04-maintenance-and-housekeeping-programs*
*Completed: 2026-07-23*

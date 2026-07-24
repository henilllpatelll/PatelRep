---
phase: 04-maintenance-and-housekeeping-programs
plan: 13
subsystem: ui
tags: [i18n, react-i18next, engineering, work-orders, bilingual-floor-contract]

# Dependency graph
requires:
  - phase: 04-08
    provides: "engineering.workOrderCard.* i18n namespace + WorkOrderCard.tsx/PMCompletionModal.tsx as translated analogs (useTranslation/t() wiring, formatSLA(t) helper pattern)"
  - phase: 04-12
    provides: "en.ts/es.ts as shared, sequential locale files (avoids merge conflicts across parallel 04-* plans)"
provides:
  - "Full EN/ES i18n coverage of WorkOrderDetailDrawer.tsx (the largest untranslated floor surface in Phase 4, ~1106 lines / ~76 literals)"
  - "engineering.workOrderDetail.* i18n namespace (65 keys) in en.ts/es.ts with full EN/ES parity"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "formatTs()/slaDisplay() are module-level helpers (outside component scope) that now take a `t: TFunction` (imported from `i18next`) parameter instead of calling useTranslation() themselves — same pattern as WorkOrderCard.tsx's formatSLA(t)."
    - "Today/Yesterday relative-date formatting uses i18n interpolation keys (todayTime: 'Today {{time}}', yesterdayTime: 'Yesterday {{time}}') matching the exact pattern already established in components/housekeeping/RoomDetailDrawer.tsx's formatHistoryTimestamp(t)."
    - "Cross-namespace reuse: engineering.workOrderCard.* (room/pm/day/days/overdue/left) for identical copy shared with WorkOrderCard.tsx; programs.pmCompletion.* (partsUsed/notesLabel/optionalTag) for identical copy shared with PMCompletionModal.tsx; common.cancel for every plain 'Cancel' button/label in the drawer."
key-files:
  created: []
  modified:
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts
    - apps/web/components/engineering/WorkOrderDetailDrawer.tsx
key-decisions:
  - "Split the single ~1106-line file into two atomic commits matching the plan's task split exactly: Task 1 = header/status/meta/AI-insight/inline-edit-form/Details section (through line ~569); Task 2 = Actions section through the sticky action bar (line ~571 to end). This matches the plan's own described boundary ('header/status/meta/detail fields' vs. 'activity, comments, parts/labor, actions, modals') without needing to renegotiate scope."
  - "Left dynamic/raw enum values untranslated by design, consistent with the already-translated WorkOrderCard.tsx analog: work_order status (`fullWo.status.replace(/_/g,' ')`), priority badge text (`fullWo.priority`), and category (`CATEGORY_ICONS[fullWo.category]} {fullWo.category}`) all render the raw backend enum value, not a translated label — WorkOrderCard.tsx does the same (`{wo.status.replace('_',' ')}`, `{wo.priority}`) so this is parity, not a gap."
  - "Reused engineering.workOrderCard.room for the two 'Room {{number}}' locations in this file (location header line, Push-to-Housekeeping confirmation) instead of adding a duplicate key — identical copy already exists from 04-08."
requirements-completed: [BL-01, D-03]

# Metrics
duration: "~55 min"
completed: "2026-07-23"
---

# Phase 4 Plan 13: Bilingual Floor Contract — Work-Order Detail Drawer Summary

Translated the entire `WorkOrderDetailDrawer.tsx` (the drill-down engineers open per work order, and the single heaviest untranslated floor surface named by D-03) into EN + ES across two atomic passes matching the file's natural top/bottom split, adding a new `engineering.workOrderDetail.*` i18n namespace (65 keys, full EN/ES parity) while reusing existing `engineering.workOrderCard.*`, `programs.pmCompletion.*`, and `common.cancel` keys wherever the copy was byte-identical.

## Performance

- **Duration:** ~55 min
- **Tasks:** 2/2 (both `type="auto"`, no checkpoints — `autonomous: true`)
- **Files modified:** 3 (2 locale files, 1 component file)

## Accomplishments

- `WorkOrderDetailDrawer.tsx` now imports `useTranslation` from `react-i18next` and `TFunction` from `i18next`; every user-facing string in the component — header/title, status/priority/PM/AI pills, AI insight callout, inline edit form (labels, placeholders, aria-labels, priority options), the Details section (Description/Asset/Created/Started/Completed/Labor hours/Parts used/Notes), the role-gated Actions section (Claim/Mark Complete/Put On Hold/Resume/Reopen/Cancel/Escalate), the hold/cancel/reopen transition reason dialog (heading, required-reason label, every reason-code option, note label, error, Save change), the inline completion form (notes/labor-hours/parts-used labels+placeholders, error, Submit Completion), the Push to Housekeeping section (success banner, dismiss, create-task copy, message field, priority select, push button, error), the Photos section (heading, preview/remove-photo alt+aria-labels, photo-type select options, upload button, add-photo button), the Timeline/comments section (heading, empty state, System label, add-comment field+button), and the sticky bottom action bar (Claim/Complete/Cancel/Close) — now renders via `t()`.
- `formatTs()` and `slaDisplay()` (module-level helpers outside component scope) now take a `t: TFunction` parameter, following the exact pattern `WorkOrderCard.tsx`'s `formatSLA(t)` already established in 04-08. `formatTs()`'s Today/Yesterday relative-date logic now uses i18n interpolation (`todayTime`/`yesterdayTime` with `{{time}}`), matching `RoomDetailDrawer.tsx`'s `formatHistoryTimestamp(t)` pattern exactly.
- `en.ts`/`es.ts` gained a 65-key `engineering.workOrderDetail.*` namespace with full EN/ES parity — verified programmatically across the entire locale files (not just the new namespace): 1015/1015 flattened keys present in both `en.ts` and `es.ts`, 0 missing either direction.
- Reused `engineering.workOrderCard.{room,pm,day,days,overdue,left}` (identical copy shared with the already-translated `WorkOrderCard.tsx`), `programs.pmCompletion.{partsUsed,notesLabel,optionalTag}` (identical copy shared with `PMCompletionModal.tsx`), and `common.cancel` (every plain "Cancel" button/label in this file) rather than duplicating keys — per the plan's `<interfaces>` reuse guidance.

## Task Commits

Each task was committed atomically:

1. **Task 1: Header/status/meta/detail fields** — `3af91102` (feat)
2. **Task 2: Activity/comments/parts-labor/actions/modals** — `83452e37` (feat)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `apps/web/i18n/locales/en.ts` — added `engineering.workOrderDetail.*` (65 keys: aria-labels, headings, form labels/placeholders, transition-reason options, action-button labels, error/empty-state copy, Today/Yesterday interpolation keys).
- `apps/web/i18n/locales/es.ts` — matching Spanish translations, same 65 keys, full parity.
- `apps/web/components/engineering/WorkOrderDetailDrawer.tsx` — rewired to `useTranslation()`/`t()` across the entire file (header, AI insight, inline edit, Details, Actions, transition dialog, completion form, Push to Housekeeping, Photos, Timeline/comments, sticky action bar); `formatTs()` and `slaDisplay()` module-level helpers now accept `t: TFunction`.

## Decisions Made

See `key-decisions` in the frontmatter above (task split boundary matching the plan's own description; raw enum values for status/priority/category left untranslated for parity with the already-translated `WorkOrderCard.tsx` analog; `room` key reuse instead of duplication).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Translated the Upload-failed photo error and Today/Yesterday relative-date formatting**
- **Found during:** Task 2
- **Issue:** Two literal strings render inside the drawer but sit outside the JSX the plan's `<action>` text explicitly called out: (a) `uploadPhotoMutation.onError` set `photoError` to the hardcoded string `'Upload failed — please try again.'`, which is then rendered as user-facing error copy in the Photos section; (b) the module-level `formatTs()` helper hardcoded `Today ${time}` / `Yesterday ${time}` prefixes for every Created/Started/Completed/comment timestamp shown in the Details and Timeline sections. Both are genuinely user-facing copy that would have left the file not "literal-free" per the plan's own Task 2 acceptance criterion.
- **Fix:** Added `engineering.workOrderDetail.uploadError` key; gave `formatTs()` a `t: TFunction` parameter and added `todayTime`/`yesterdayTime` interpolation keys, matching the exact pattern already used by `components/housekeeping/RoomDetailDrawer.tsx`'s `formatHistoryTimestamp(t)`.
- **Files modified:** `apps/web/components/engineering/WorkOrderDetailDrawer.tsx`, `apps/web/i18n/locales/{en,es}.ts`
- **Verification:** `npm run type-check` clean; manual scan of the file confirms no remaining hardcoded user-facing copy.
- **Committed in:** `83452e37` (Task 2 commit)

---

**Total deviations:** 1 (Rule 2 missing-critical-functionality auto-fix — both instances found and fixed within the same Task 2 pass)
**Impact on plan:** No scope creep — both fixes are strictly inside `WorkOrderDetailDrawer.tsx`, the file this plan targets, and are required to satisfy the plan's own "literal-free" acceptance criterion for Task 2.

## Issues Encountered

- The worktree checkout had no `node_modules` (git worktrees don't carry untracked directories). Symlinked `node_modules` at the repo root and `apps/web/node_modules` to the main checkout's installed dependencies (same lockfile, same commit) rather than reinstalling from scratch — verification commands (`type-check`, `lint`) then ran normally.
- `npm run build` fails on `/reports` and `/ai` page prerendering with `@supabase/ssr: Your project's URL and API key are required` — this is the documented, pre-existing "No live API credentials in the local environment" constraint from `CLAUDE.md`'s Current Scope section, not a regression from this plan's changes (the failure is in `useAuth.ts`/`Sidebar.tsx`, unrelated to `WorkOrderDetailDrawer.tsx`). `type-check` and `lint` — this plan's actual verification gates — both pass cleanly.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `WorkOrderDetailDrawer.tsx` is fully bilingual (D-03 "engineering / work-orders" floor surface); together with 04-08's `WorkOrderCard.tsx`/`PMCompletionModal.tsx`, the primary work-order lifecycle UI is now covered EN+ES.
- Per 04-08's `deferred-items.md`, the following engineering/tasks/housekeeping surfaces remain hardcoded English and are still tracked as a gap: `WorkOrderList.tsx`, `FailurePredictionSidebar.tsx`, `EngineeringRoomBoard.tsx`, `CreateWorkOrderModal.tsx`, `app/(dashboard)/tasks/page.tsx`, and `components/housekeeping/**`. This plan does not close that gap (out of its own scope — it targeted only `WorkOrderDetailDrawer.tsx` per its `files_modified` frontmatter) but does not widen it either.
- The scoped `i18next/no-literal-string` ESLint gate added in 04-08 does not yet cover `WorkOrderDetailDrawer.tsx`; widening that gate's `files` glob to include this file (now that it's genuinely translated) is a natural follow-up for whichever plan closes the remaining gap above.

## Self-Check: PASSED

- FOUND: `apps/web/i18n/locales/en.ts` contains `engineering.workOrderDetail` with 65 keys
- FOUND: `apps/web/i18n/locales/es.ts` — same namespace, same 65 keys, full parity (1015/1015 keys match across the entire file, verified programmatically)
- FOUND: `apps/web/components/engineering/WorkOrderDetailDrawer.tsx` imports and uses `useTranslation` (grep count: 2)
- FOUND: commit `3af91102` (Task 1)
- FOUND: commit `83452e37` (Task 2)
- VERIFIED: `cd apps/web && npm run type-check` → clean
- VERIFIED: `cd apps/web && npm run lint` → clean (0 errors, 0 warnings)
- VERIFIED: manual scan of `WorkOrderDetailDrawer.tsx` — no remaining hardcoded user-facing JSX text/placeholder/title/aria-label literal (raw enum values for status/priority/category are intentionally left untranslated, matching the already-translated `WorkOrderCard.tsx` analog)
- NOTED (pre-existing, not a regression): `npm run build` fails on `/reports`/`/ai` prerendering due to missing local Supabase credentials — documented environment limitation, unrelated to this plan's files

---

*Phase: 04-maintenance-and-housekeeping-programs*
*Completed: 2026-07-23*

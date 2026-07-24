---
phase: 04-maintenance-and-housekeeping-programs
reviewed: 2026-07-24T00:00:00Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - apps/web/app/(dashboard)/engineering/assets/page.tsx
  - apps/web/app/(dashboard)/engineering/pm-schedules/page.tsx
  - apps/web/app/(dashboard)/engineering/predictions/page.tsx
  - apps/web/app/(dashboard)/engineering/work-orders/page.tsx
  - apps/web/app/(dashboard)/housekeeping/assignments/page.tsx
  - apps/web/app/(dashboard)/housekeeping/inspections/page.tsx
  - apps/web/app/(dashboard)/housekeeping/page.tsx
  - apps/web/app/(dashboard)/housekeeping/rooms/page.tsx
  - apps/web/app/(dashboard)/tasks/page.tsx
  - apps/web/components/engineering/CreateWorkOrderModal.tsx
  - apps/web/components/engineering/EngineeringRoomBoard.tsx
  - apps/web/components/engineering/FailurePredictionSidebar.tsx
  - apps/web/components/engineering/PMCompletionModal.tsx
  - apps/web/components/engineering/WorkOrderDetailDrawer.tsx
  - apps/web/components/engineering/WorkOrderList.tsx
  - apps/web/components/housekeeping/AssignmentSidebar.tsx
  - apps/web/components/housekeeping/InspectionModal.tsx
  - apps/web/components/housekeeping/OccupancyImportModal.tsx
  - apps/web/components/housekeeping/PredictionPanel.tsx
  - apps/web/components/housekeeping/RoomCard.tsx
  - apps/web/components/housekeeping/RoomDetailDrawer.tsx
  - apps/web/components/housekeeping/RoomStatusBoard.tsx
  - apps/web/e2e/phase4-programs.spec.ts
  - apps/web/eslint.config.mjs
  - apps/web/i18n/locales/en.ts
  - apps/web/i18n/locales/es.ts
findings:
  critical: 2
  warning: 4
  info: 3
  total: 9
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-07-24T00:00:00Z
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

Reviewed the 25 files touched by gap-closure plans 04-09..04-17 (react-i18next wiring across housekeeping/engineering route pages and components, ESLint `i18next/no-literal-string` gate widening, and the phase4 bilingual E2E spec).

The `t`-shadowing bug class the task asked me to double-check is **not** fully gone — it recurs in 5 places, though none currently crash at runtime (see WR-01). More seriously, I found a role-based access-control bug in `WorkOrderDetailDrawer.tsx` (`isChief = role === 'engineer'`) that silently gives regular engineers chief-engineer-only actions (hold/cancel/resume/reopen/edit a work order) while chief engineers lose them entirely — this survived two separate i18n-only edits to this exact file (04-13, 04-16) because those touches never re-audited the surrounding logic. I also found one concrete floor-facing bilingual-parity miss: the Kanban `WorkOrderCard` on the Work Orders page hardcodes the English word "Room" in a JS template literal, which the new ESLint gate cannot catch because it's `markupOnly: true` (it only scans JSX text/markup, not string literals inside JS expressions).

EN/ES key parity in `en.ts`/`es.ts` is solid: both files have identical key structure (1199 leaf keys, verified by exact key-path diff) and identical `{{placeholder}}` sets per line — no missing keys or dropped interpolation variables were found in either file. Spot-checked the specific keys asserted by the new E2E spec (`programs.pmSchedules.title`, `.pmCompletion.title/checklistResults/verifierLabel`) and all match the spec's expected EN/ES strings exactly.

## Critical Issues

### CR-01: `isChief` role check tests for `'engineer'`, not `'chief_engineer'` — privilege bug in Work Order actions

**File:** `apps/web/components/engineering/WorkOrderDetailDrawer.tsx:120-121`
**Issue:**
```ts
const isEngineer = role === 'engineer'
const isChief = role === 'engineer'
```
`isChief` is defined identically to `isEngineer`. It gates `canHold`, `canCancel`, `canResume`, `canReopen`, the inline "Edit work order" button, and the inline edit form (lines 168-174, 410, 444). As a result:
- A plain `engineer` (not `chief_engineer`) can put a WO on hold, cancel it, resume it, reopen a completed/cancelled WO, and edit its title/category/priority/notes — actions that are supposed to be chief-engineer/GM-only.
- An actual `chief_engineer` gets **none** of these actions, because their role string never equals `'engineer'`.

`git log -p` on this file shows the line used to correctly read `role === 'chief_engineer'`, was changed to `role === 'engineer'` in commit `402a2fa6` ("refactor: merge chief_engineer role into engineer" — a business decision to eliminate the two-tier engineering role). That merge was reverted app-wide in a later commit (`fea45b29`, "Refactor dashboard workflows and tighten API integrations", which restored `chief_engineer` to `ENGINEERING_ROLES` in `useRole.ts`) — but this one line in `WorkOrderDetailDrawer.tsx` was never fixed back. Two later, purely i18n-focused commits on this same file (`3af91102`, `83452e37` — Phase 04-13 translation work) and one more (`a857f0f5` — 04-16 lint-gate widening) all touched this file without catching the stale logic, because none of those diffs were logic reviews.

`chief_engineer` is still a first-class, actively used role everywhere else in the codebase (`staff.tsx`, `routeGuard.ts`, `pm-schedules/page.tsx`, `predictions/page.tsx`, `Sidebar.tsx`, `RoleForm.tsx`), so this is a live, current authorization defect, not dead code.

**Fix:**
```ts
const isEngineer = role === 'engineer'
const isChief = role === 'chief_engineer'
```

### CR-02: Work Order Kanban card hardcodes "Room" — bypasses the bilingual floor contract this phase built

**File:** `apps/web/app/(dashboard)/engineering/work-orders/page.tsx:83-85`
**Issue:**
```ts
const location = wo.rooms?.room_number
    ? `Room ${wo.rooms.room_number}`
    : wo.location_text ?? null
```
This is the location chip rendered on every Work Order Kanban card (`WorkOrderCard`, same file, lines 76-130). It always renders the literal English word "Room", even when the Spanish locale is active. Every sibling surface that shows the same information (`assets/page.tsx:382,1008`, `WorkOrderDetailDrawer.tsx:330`) correctly calls `t('engineering.workOrderCard.room')`, which resolves to `"Habitación"` in `es.ts:883`. This card is the one place in the reviewed set that was missed.

This slipped past the newly-widened ESLint `i18next/no-literal-string` gate (`eslint.config.mjs:51-58`) because that rule is configured `markupOnly: true` — it only flags literal strings that appear directly as JSX text/`aria-label`/`placeholder`/`title`, not literals embedded in a JS template expression assigned to a variable (`` `Room ${...}` ``) and later interpolated into JSX. The gate cannot see this pattern, so it is not just a one-off miss — it's a systemic blind spot in the enforcement mechanism the phase built (see WR-03).

**Fix:**
```ts
const { t } = useTranslation() // add if not already destructured in this component
...
const location = wo.rooms?.room_number
    ? `${t('engineering.workOrderCard.room')} ${wo.rooms.room_number}`
    : wo.location_text ?? null
```
(`WorkOrderCard` in this file does not currently call `useTranslation()` — it will need the hook added, following the pattern already used in `assets/page.tsx`.)

## Warnings

### WR-01: The flagged `t`-shadowing bug class still recurs in 5 places

**File:** multiple (see list below)
**Issue:** Each of these declares or destructures a local variable named `t` inside a component/effect that already has `const { t } = useTranslation()` in an outer scope, shadowing the translate function within that narrower block:
- `apps/web/app/(dashboard)/housekeeping/inspections/page.tsx:140` — `const t = setTimeout(() => setToast(null), 3500)`
- `apps/web/components/housekeeping/InspectionModal.tsx:94` — `templates.find((t) => t.is_default) ?? templates[0]`
- `apps/web/components/housekeeping/RoomDetailDrawer.tsx:441` — `.filter((t: any) => t.status !== 'completed' && t.status !== 'cancelled')`
- `apps/web/components/housekeeping/RoomStatusBoard.tsx:305` — `.filter((t: any) => t.status !== 'completed' && t.status !== 'cancelled')`
- `apps/web/components/engineering/EngineeringRoomBoard.tsx:66` — `.filter((t: any) => t.status !== 'completed' && t.status !== 'cancelled')`

None of these currently crash, because the shadowed `t` is never called as a function inside its narrow scope today. But it is a live footgun: the very next person who adds a `t('some.key')` call inside one of these callbacks (very plausible — e.g. adding a translated empty-state message inside the `.filter` predicate, or a translated toast message inside the `setTimeout` effect) will get `TypeError: t is not a function` at runtime, because `t` there resolves to a task object / `NodeJS.Timeout`, not the i18n function. This is exactly the recurring class the plan history describes fixing repeatedly — it isn't fully gone.

**Fix:** Rename the shadowing locals (`tsHandle`, `tpl`, `task`, etc.) so `t` is never rebound inside a component that also uses the i18n `t`:
```ts
// housekeeping/inspections/page.tsx
const timeoutId = setTimeout(() => setToast(null), 3500)
return () => clearTimeout(timeoutId)

// InspectionModal.tsx
templates.find((tpl) => tpl.is_default) ?? templates[0]

// RoomDetailDrawer.tsx / RoomStatusBoard.tsx / EngineeringRoomBoard.tsx
.filter((task: any) => task.status !== 'completed' && task.status !== 'cancelled')
```

### WR-02: Silent `catch {}` blocks hide failures from the user in PM Schedules

**File:** `apps/web/app/(dashboard)/engineering/pm-schedules/page.tsx:582-590` and `:592-606`
**Issue:**
```ts
async function handleDeactivate(scheduleId: string) {
  try {
    await engineeringApi.deactivatePMSchedule(scheduleId)
    queryClient.invalidateQueries({ queryKey: ['pm-schedules'] })
    setConfirmDeactivateId(null)
  } catch {
    // deactivation failed — user can retry
  }
}

async function handleCreateWOFromPM(schedule: PMSchedule) {
  try {
    await engineeringApi.createWorkOrder({ ... })
    setSuccessMessage(t('programs.pmSchedules.woCreatedMessage', { name: schedule.name }))
    setTimeout(() => setSuccessMessage(null), 4000)
  } catch {
    // work order creation failed — user can retry
  }
}
```
Both handlers swallow the error entirely. On failure, `handleDeactivate` leaves the "Confirm/Cancel" row visibly stuck (harmless but confusing) with zero feedback; `handleCreateWOFromPM` gives the user no indication the WO was not created — they will believe it succeeded since the button simply stops spinning. Every other mutation in this same file (`CreatePMScheduleModal`, `PMCompletionModal`) surfaces a translated error string on failure; these two do not.

**Fix:** Surface a translated error via the existing `successMessage`/error-banner pattern already used elsewhere on this page, e.g.:
```ts
} catch {
  setSuccessMessage(null)
  setErrorMessage(t('programs.pmSchedules.deactivateError'))
  setTimeout(() => setErrorMessage(null), 4000)
}
```

### WR-03: `i18next/no-literal-string` gate cannot see literals inside JS expressions

**File:** `apps/web/eslint.config.mjs:50-58`
**Issue:** The rule is configured `markupOnly: true`. That setting is precisely what allowed CR-02 to ship undetected — a raw string embedded in a template literal (`` `Room ${x}` ``) that is later placed into JSX is invisible to the rule, because it only inspects JSX text nodes and the three listed `jsx-attributes`. The phase's own comment block (lines 19-28) frames this gate as the enforcement mechanism that closes out floor-facing bilingual gaps, but as configured it has a structural blind spot for this exact bug pattern.
**Fix:** Either drop `markupOnly: true` for this file set (accepting some false positives on non-UI strings, e.g. CSS class names, that would need targeted `eslint-disable` comments as already done at `rooms/page.tsx:298`), or add a follow-up manual/automated sweep specifically for string literals assigned to variables that flow into JSX (`location`, `label`, `title` local variables are a good heuristic) in the floor-facing directories this gate covers.

### WR-04: `OccupancyImportModal` is missing dialog semantics and Escape-to-close, unlike every sibling modal reviewed

**File:** `apps/web/components/housekeeping/OccupancyImportModal.tsx:80-92`
**Issue:** Every other modal touched by this phase (`AssetDetailModal`/`CreateAssetModal` in `assets/page.tsx`, `CreatePMScheduleModal` in `pm-schedules/page.tsx`, `PMCompletionModal.tsx`, `CreateWorkOrderModal.tsx`, `InspectionModal.tsx`) renders its outer container with `role="dialog"`, `aria-modal="true"`, and an accessible name, plus a `keydown` listener that closes on `Escape`. `OccupancyImportModal`'s outer container is a plain `<div className="fixed inset-0 ...">` with none of that — no `role`, no `aria-modal`, no `aria-label`, and no Escape handling (only the `X` button and backdrop click close it). Screen-reader users get no indication this is a modal dialog, and keyboard-only users lose the Escape shortcut every other floor-facing modal in this phase provides.
**Fix:**
```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-label={t('housekeeping.occupancyImport.title')}
  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
>
```
Plus the same `useEffect` Escape-key pattern used in `InspectionModal.tsx:114-120`.

## Info

### IN-01: Modal focus-trapping is inconsistent across the reviewed components

**File:** `apps/web/components/engineering/CreateWorkOrderModal.tsx`, `PMCompletionModal.tsx`, `WorkOrderDetailDrawer.tsx`, `apps/web/components/housekeeping/InspectionModal.tsx`, `OccupancyImportModal.tsx`
**Issue:** Only `CreateTaskModal` (in `tasks/page.tsx:216-230`) implements full Tab-focus trapping (first/last focusable element cycling). All the engineering/housekeeping modals above only close on `Escape` (or, in `OccupancyImportModal`'s case, not even that — see WR-04); Tab can move focus out of the dialog into the page behind it while it's open. This predates this phase's changes (it's a pre-existing pattern across the app) so it's not a regression, but it's worth tracking given the review's accessibility focus.
**Fix:** Extract the focus-trap logic from `CreateTaskModal` into a shared hook (e.g. `useModalFocusTrap`, already referenced in `CLAUDE.md`'s `lib/hooks/` inventory) and apply it to the remaining dialogs.

### IN-02: Hardcoded "Room" fallback text gets persisted as stored data, not just displayed

**File:** `apps/web/components/engineering/CreateWorkOrderModal.tsx:108-114`, `apps/web/components/engineering/WorkOrderDetailDrawer.tsx:256`
**Issue:**
```ts
location_text: selectedRoomId
  ? (locationText.trim() || (roomNumber ? `Room ${roomNumber}` : undefined))
  : locationText.trim() || undefined,
```
and
```ts
title: hkTaskNote.trim() || `Housekeeping needed — Room ${fullWo.rooms?.room_number}`,
```
These English fallback strings get written into `location_text` / task `title` fields in the database, not just rendered client-side. Lower severity than CR-02 because in the WO detail view the room number is displayed via the translated `t('engineering.workOrderCard.room')` join rather than this stored `location_text` (so the effect is mostly latent), but the created Task's title (pushed to Housekeeping) will always read in English regardless of the active locale, since it's stored, not re-derived at render time.
**Fix:** Not a blocking fix, but worth a follow-up ticket: build these default strings from `t(...)` at creation time, understanding the persisted value will still be frozen in whatever locale was active when the record was created.

### IN-03: Continued heavy use of `any` in the reviewed files

**File:** e.g. `apps/web/app/(dashboard)/housekeeping/assignments/page.tsx:69,85,95`, `apps/web/app/(dashboard)/housekeeping/page.tsx:95-97,506-509`, `apps/web/components/housekeeping/RoomDetailDrawer.tsx` (dozens of `room: any`, `entry: any` etc.)
**Issue:** Widespread `as any` / implicit `any` typing removes the type safety that would otherwise catch shape mismatches between the API response and the component's expectations. Pre-existing pattern across the codebase, not introduced by this phase, but worth noting since it's exactly the kind of "type assertions" the standard-depth checklist calls out.
**Fix:** No action required for this phase; consider a follow-up typing pass on `lib/api/housekeeping.ts` response shapes so downstream components stop needing `as any` casts.

---

_Reviewed: 2026-07-24T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

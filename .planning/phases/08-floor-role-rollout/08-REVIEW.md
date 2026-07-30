---
phase: 08-floor-role-rollout
reviewed: 2026-07-30T07:46:18Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - apps/mobile/__tests__/components/ReportIssueModal.test.tsx
  - apps/mobile/__tests__/screens/InspectorQueue.test.tsx
  - apps/mobile/__tests__/screens/MyRoomsScreen.test.tsx
  - apps/mobile/__tests__/screens/RoomBoard.test.tsx
  - apps/mobile/__tests__/screens/RoomDetail.test.tsx
  - apps/mobile/__tests__/screens/TasksVariationA.test.tsx
  - apps/mobile/__tests__/screens/WorkOrderDetail.test.tsx
  - apps/mobile/__tests__/screens/WorkOrdersList.test.tsx
  - apps/mobile/app/(app)/inspect/index.tsx
  - apps/mobile/app/(app)/my-rooms/[roomId].tsx
  - apps/mobile/app/(app)/my-rooms/index.tsx
  - apps/mobile/app/(app)/room-board/index.tsx
  - apps/mobile/app/(app)/tasks/index.tsx
  - apps/mobile/app/(app)/work-orders/[woId].tsx
  - apps/mobile/app/(app)/work-orders/index.tsx
  - apps/mobile/components/engineering/CreateWorkOrderModal.tsx
  - apps/mobile/components/engineering/WorkOrderCard.tsx
  - apps/mobile/components/housekeeping/ChecklistSection.tsx
  - apps/mobile/components/housekeeping/FoundItemModal.tsx
  - apps/mobile/components/housekeeping/KnockModal.tsx
  - apps/mobile/components/housekeeping/ReportIssueModal.tsx
  - apps/mobile/components/housekeeping/SupplyRequestModal.tsx
  - apps/mobile/components/shared/evening.tsx
  - apps/mobile/components/shared/tokens.ts
  - apps/mobile/components/tasks/TaskCard.tsx
  - apps/mobile/components/ui/Button.tsx
  - apps/mobile/i18n/locales/en.json
  - apps/mobile/i18n/locales/es.json
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-07-30T07:46:18Z
**Depth:** standard
**Files Reviewed:** 27
**Status:** issues_found

## Summary

Reviewed the 9-plan Phase 7-primitives migration (`C.*` compat tokens → `useTheme()` / `Card` / `Button` / `StatusBadge` / `StateBlock` / `useToast()`) across mobile housekeeping and engineering screens. I cross-referenced every commit in the phase range (`323ea7bb^..HEAD`) file-by-file against its pre-migration version to isolate presentation-only diffs from any accidental logic drift, ran a duplicate-JSON-key check on both locale files, and programmatically cross-referenced every static `t("...")` call in the reviewed files against `en.json`/`es.json`.

**No duplicate-key merge artifacts, no logic regressions, and no locale-parity gaps between `en.json`/`es.json`** were found — both locale files have identical key sets. Every `Alert.alert` → `toast.*` conversion I traced (RoomDetail, WorkOrderDetail, Inspect, CreateWorkOrderModal, SupplyRequestModal) preserved the original side effects (e.g. `router.back()`, optimistic state reverts) and correctly kept genuine Yes/Cancel confirmation dialogs (escalate, photo-source picker) as `Alert.alert`.

The issues found are narrower: one real silent-failure UX gap in a file whose toast plumbing was added by this migration but not wired to its own catch block, one missing i18n key (pre-existing, but in a file this phase touched extensively), a cluster of hardcoded-English strings in the exact `toast.*`/label calls this migration introduced or touched, and a test whose mock doesn't correspond to any code path in the component it exercises.

## Warnings

### WR-01: FoundItemModal silently swallows submission failures with no user feedback

**File:** `apps/mobile/components/housekeeping/FoundItemModal.tsx:99-128`
**Issue:** `handleSubmit()` wires `toast.error(...)` for the permission-denied and offline paths (both added in this migration), but the actual submission `catch` block is empty except for a comment (`// keep modal open on error`). If `uploadPhoto()` or `createLostFoundItem()` throws — e.g. a dropped connection mid-upload, a 500 from the API — `submitting` is reset to `false` and the modal just sits there with no indication anything went wrong. The housekeeper has no way to know the found-item report wasn't actually sent. This is pre-existing behavior (the empty catch predates this migration — verified via `git diff`), but this exact function is where `useToast()` was just introduced for two sibling paths, making the missed wiring on the actual submit path a clear, fixable gap while the file is already open.
**Fix:**
```tsx
} catch (err: unknown) {
  toast.error((err as Error).message ?? t("common.error"));
} finally {
  setSubmitting(false);
}
```

### WR-02: `workOrders.searchPlaceholder` i18n key does not exist in either locale file

**File:** `apps/mobile/app/(app)/work-orders/index.tsx:275`
**Issue:** `t("workOrders.searchPlaceholder", { defaultValue: "Search work orders…" })` relies on i18next's `defaultValue` fallback because the key is absent from both `en.json` and `es.json` (confirmed via a full key-parity diff of both locale files — they match each other exactly, but neither has this key under `workOrders`). This means Spanish-language users see the literal English string "Search work orders…" in the search bar placeholder — the one piece of copy on this screen that doesn't get translated. Pre-existing (unchanged by this phase's diff), but the screen was touched extensively by 08-05, making this a low-effort fix while the file is in scope.
**Fix:** Add to both locale files under `workOrders`:
```json
// en.json
"searchPlaceholder": "Search work orders…"
// es.json
"searchPlaceholder": "Buscar órdenes de trabajo…"
```
And drop the `defaultValue` fallback at the call site once the key exists.

### WR-03: Hardcoded English strings in Toast calls and labels added/touched by this migration

**Files:**
- `apps/mobile/components/engineering/CreateWorkOrderModal.tsx:102,106,121,133,146,155,166,191,221,252,259` (title, placeholders, section labels, `toast.success`/`toast.error` bodies)
- `apps/mobile/components/housekeeping/SupplyRequestModal.tsx:51,63,67,82,84,128,133,141` (`toast.error`/`toast.success` bodies, title, subtitle, placeholder, button labels)
- `apps/mobile/components/housekeeping/ReportIssueModal.tsx:95-259` (title, subtitle, all field labels/placeholders, button labels — this file imports neither `useTranslation` nor `t`)

**Issue:** All three modals were reworked in this phase (theme wiring, `Alert.alert` → `Toast` conversion in the first two) but the copy itself was carried over verbatim as raw English string literals rather than `t()` calls, even though every sibling component in this same phase (`FoundItemModal`, `KnockModal`, `InspectScreen`, `[roomId].tsx`, etc.) is fully localized via `react-i18next` and the app maintains full ES/EN parity everywhere else. `ReportIssueModal.tsx` doesn't import `useTranslation` at all. This is pre-existing (verified via diff — the strings were already hardcoded before this migration), but since this migration explicitly rewired the exact lines carrying these strings (new `toast.success("Your supervisor has been notified.")`, `toast.error("Pick at least one item to request.")`, etc.), it was the natural point to close the gap and wasn't.
**Fix:** Add `en.json`/`es.json` keys for these three modals' copy (mirroring the `foundItem.*` / `rooms.detail.*` pattern already in use) and replace the literals with `t(...)` calls, importing `useTranslation` in `ReportIssueModal.tsx`.

## Info

### IN-01: `WorkOrderCard` "LOW" priority badge is hardcoded, unlike its sibling badges

**File:** `apps/mobile/components/engineering/WorkOrderCard.tsx:106`
**Issue:** `<StatusBadge statusKey="low" label="LOW" />` — the emergency/urgent/onHold badges immediately above and below it all use `t("workOrders.chip*")`, but "LOW" is a bare string literal with no matching `workOrders.chipLow` key in either locale file. Spanish users see "LOW" instead of "BAJA"/"BAJO". Pre-existing content (unchanged by this migration's diff, only re-wrapped in the new `StatusBadge` component), but worth closing alongside WR-03 since it sits in a file this phase rewrote.
**Fix:** Add `workOrders.chipLow` to both locale files and use `t("workOrders.chipLow")` in place of the literal.

### IN-02: `RoomDetail.test.tsx` undo-hang test mocks an `Alert.alert` confirmation the component never shows

**File:** `apps/mobile/__tests__/screens/RoomDetail.test.tsx:300-326`
**Issue:** The test `"clears undo loading if the undo request hangs"` spies on `Alert.alert` and auto-presses a button with `text === "rooms.undoConfirm"`, but `handleUndo()` in `[roomId].tsx` calls `undoRoomStatus()` directly with no `Alert.alert` confirmation step, and `undoRoomStatus()` sets no loading flag that the Undo button reflects (there's no spinner/disabled state on the Undo `<Button>` tied to the in-flight POST). The `Alert.alert` spy is therefore never invoked, and the assertions after `jest.advanceTimersByTime(12000)` only re-confirm that the (unrelated, always-visible) primary-action label is still rendered — which would pass even if the whole undo flow were deleted. This isn't a new issue introduced by Phase 8 (the file wasn't touched in this phase's commit range), but it's a stale/misleading test in a file that was reviewed here, and it doesn't actually verify what its name claims.
**Fix:** Either remove the unused `Alert.alert` spy and rename the test to reflect what it verifies, or add real loading-state coverage to `undoRoomStatus()`/the Undo button if a loading indicator was intended.

---

_Reviewed: 2026-07-30T07:46:18Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

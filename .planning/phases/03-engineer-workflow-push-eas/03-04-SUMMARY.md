---
phase: 03-engineer-workflow-push-eas
plan: "04"
subsystem: mobile-work-orders
tags: [engineer-workflow, i18n, mobile, ENG-01, ENG-02]
dependency_graph:
  requires: [03-00]
  provides: [ENG-01, ENG-02]
  affects: [apps/mobile/app/(app)/work-orders/index.tsx]
tech_stack:
  added: []
  patterns: [status-chip, i18n-keys-first]
key_files:
  created: []
  modified:
    - apps/mobile/app/(app)/work-orders/index.tsx
    - apps/mobile/i18n/locales/en.json
    - apps/mobile/i18n/locales/es.json
decisions:
  - "STATUS_COLORS constant mirrors PRIORITY_COLORS pattern — consistent color map approach in WO screen"
  - "t() second arg item.status used as fallback for unmapped status keys — safe i18next behaviour, no crash on unexpected status"
  - "WorkOrdersList test 3 remains RED — offline claim enqueue (plan 03-02) not yet implemented, expected Wave 0 state"
metrics:
  duration: 2 min
  completed_date: "2026-03-22"
  tasks_completed: 2
  files_modified: 3
---

# Phase 03 Plan 04: Work Order List Status Chip + i18n Summary

**One-liner:** Status chip added to every WO card using STATUS_COLORS map + workOrders.status.* i18n keys in EN/ES satisfying ENG-02.

## What Was Built

### Task 1: i18n keys (en.json + es.json)
Added missing `workOrders.status` and `workOrders.myOrders` keys to both locale files:
- EN: `workOrders.myOrders = "My Orders"`, `workOrders.status.{open,in_progress,completed}`
- ES: `workOrders.myOrders = "Mis Ordenes"`, `workOrders.status.{open=Abierta,in_progress=En Progreso,completed=Completada}`
- Both files remain valid JSON; all existing keys unchanged

### Task 2: Status chip on WO card (index.tsx)
- Added `STATUS_COLORS` constant (open=blue, in_progress=amber, completed=green) after `PRIORITY_COLORS`
- Added `statusRow` + `statusBadge` view with 20% opacity background tint after room_number line in card renderItem
- Added `statusText` with full-opacity foreground color
- Added 3 new StyleSheet entries: `statusRow`, `statusBadge`, `statusText`
- Translation call: `t('workOrders.status.${item.status}', item.status)` — uses item.status as fallback

## Verification

JSON key check:
```
PASS: all workOrders i18n keys present
```

WorkOrdersList.test.tsx:
- Test 1 (renders WO card fields): PASS
- Test 2 (shows Claim button): PASS
- Test 3 (offline enqueue): RED — Wave 0 stub, turns GREEN in plan 03-02

Full test suite: 21/23 passing. 2 failures are WorkOrderDetail.test.tsx Wave 0 RED stubs (plan 03-03 scope). No regressions introduced.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

### Files exist
- apps/mobile/app/(app)/work-orders/index.tsx — STATUS_COLORS + statusRow + statusBadge present
- apps/mobile/i18n/locales/en.json — workOrders.status and myOrders present
- apps/mobile/i18n/locales/es.json — workOrders.status and myOrders present

### Commits
- 3793a23: feat(03-04): add workOrders.status and myOrders i18n keys
- df3666e: feat(03-04): add status chip to WO card (ENG-02)

## Self-Check: PASSED

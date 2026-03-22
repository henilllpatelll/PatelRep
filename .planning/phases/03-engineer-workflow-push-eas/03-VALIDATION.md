---
phase: 3
slug: engineer-workflow-push-eas
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest-expo ^51.0.4 + @testing-library/react-native ^12.9.0 |
| **Config file** | `apps/mobile/jest.config.js` (exists) |
| **Quick run command** | `cd apps/mobile && npm test -- --passWithNoTests --testPathPattern="sync\|offline"` |
| **Full suite command** | `cd apps/mobile && npm test -- --passWithNoTests` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd apps/mobile && npm test -- --passWithNoTests --testPathPattern="sync\|offline"`
- **After every plan wave:** Run `cd apps/mobile && npm test -- --passWithNoTests`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | ENG-01 | unit | `npm test -- --testPathPattern="workOrders"` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 1 | ENG-02 | component | `npm test -- --testPathPattern="workOrders"` | ❌ W0 | ⬜ pending |
| 3-01-03 | 01 | 1 | ENG-03 | unit | `npm test -- --testPathPattern="sync"` | ✅ extend | ⬜ pending |
| 3-01-04 | 01 | 1 | ENG-04 | unit | `npm test -- --testPathPattern="sync"` | ✅ extend | ⬜ pending |
| 3-01-05 | 01 | 1 | ENG-05 | unit | `npm test -- --testPathPattern="workOrders"` | ❌ W0 | ⬜ pending |
| 3-01-06 | 01 | 1 | ENG-07 | unit | `npm test -- --testPathPattern="sync"` | ✅ extend | ⬜ pending |
| 3-02-01 | 02 | 1 | ENG-06 | unit (Python) | `cd apps/api && python -m pytest tests/ -x -k "wo_push"` | ❌ W0 | ⬜ pending |
| 3-02-02 | 02 | 1 | INFRA-02 | unit | `npm test -- --testPathPattern="notifications"` | ❌ W0 | ⬜ pending |
| 3-02-03 | 02 | 2 | ENG-06/HK-05 | manual | `N/A — physical device required` | N/A | ⬜ pending |
| 3-03-01 | 03 | 2 | INFRA-03 | manual | `eas build --platform android --profile preview` | N/A | ⬜ pending |
| 3-03-02 | 03 | 2 | INFRA-03 | manual | `eas build --platform ios --profile production` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/mobile/__tests__/lib/offline/sync.test.ts` — extend with `work_order/claim` and `work_order/complete` handler cases
- [ ] `apps/mobile/__tests__/lib/notifications.test.ts` — covers INFRA-02: verifies `savePushTokenToProfile` calls `api.patch` not `supabase`
- [ ] `apps/mobile/__tests__/screens/WorkOrdersList.test.tsx` — covers ENG-01, ENG-02: renders WO cards with correct fields
- [ ] `apps/mobile/__tests__/screens/WorkOrderDetail.test.tsx` — covers ENG-05: completion notes sent in payload
- [ ] `apps/api/tests/smoke/test_wo_push.py` — covers ENG-06: verifies push helper is called on claim

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Push notification received on physical device | ENG-06, HK-05 | Requires APNs/FCM delivery to real hardware | Assign WO in web dashboard; verify notification arrives on engineer's device and taps to correct WO screen |
| Killed-state deep link navigation | ENG-06 | Cannot simulate killed-app notification tap in Jest | Force-quit app, tap push notification, verify it opens `/work-orders/<id>` |
| EAS Android APK builds and installs | INFRA-03 | Build happens in EAS cloud, not in test runner | `eas build --platform android --profile preview`; download APK; sideload and launch |
| EAS iOS IPA accepted by TestFlight | INFRA-03 | Requires Apple Developer Program + real device | `eas build --platform ios --profile production`; `eas submit --platform ios`; verify TestFlight receives build |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

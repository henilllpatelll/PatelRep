---
phase: 8
slug: floor-role-rollout
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-29
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest ^29.7.0 + `jest-expo` ~54.0.0 + `@testing-library/react-native` ^12.9.0 |
| **Config file** | none dedicated found in `apps/mobile/` root — likely inline in `package.json` or inherited from `jest-expo` preset; confirm exact config during planning (not blocking — `npm test` already works per existing `__tests__/` suite) |
| **Quick run command** | `cd apps/mobile && npx jest __tests__/screens/MyRoomsScreen.test.tsx` (swap filename per screen) |
| **Full suite command** | `cd apps/mobile && npm test` (`jest --passWithNoTests`) |
| **Estimated runtime** | ~60 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** run the relevant screen's existing test file, plus `npm run type-check` (`tsc --noEmit`) and `npm run lint` (i18n gate — hard-fails on any new raw string literal in a gated file)
- **After every plan wave:** full `npm test` + `npm run type-check` + `npm run lint`
- **Before `/gsd-verify-work`:** full suite must be green, plus a manual device/simulator pass: offline banner still renders above any new Toast, no visual regression on any of the 5 screens, EN and ES both render unchanged strings without new truncation (spot-check ES on My Rooms and Work Orders)
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-00-01 | 00 | 0 | (prereq) | — | `tokens.ts` gains `ink4`/`brassSoft`/`brassLine` in `lightTheme`/`darkTheme`, no shape break | unit | `cd apps/mobile && npx jest MobileVisualTokens.test.ts` | ✅ | ⬜ pending |
| 08-01-xx | 01 | 1 | FLOOR-01 | T-8-01 | My Rooms list+detail render via primitives; role/tenant-scoped fetch calls unchanged | unit/component | `cd apps/mobile && npx jest __tests__/screens/MyRoomsScreen.test.tsx __tests__/screens/RoomDetail.test.tsx` | ✅ | ⬜ pending |
| 08-02-xx | 02 | 2 | FLOOR-02 | T-8-01 | Room Board renders via primitives; offline-sync unchanged | unit/component | `cd apps/mobile && npx jest __tests__/screens/RoomStatusList.test.tsx` | ✅ (verify name match) | ⬜ pending |
| 08-03-xx | 03 | 3 | FLOOR-03 | T-8-01 | Work Orders list+detail render via primitives; RBAC/tenant-scoping unchanged | unit/component | `cd apps/mobile && npx jest __tests__/screens/WorkOrdersList.test.tsx __tests__/screens/WorkOrderDetail.test.tsx` | ✅ | ⬜ pending |
| 08-04-xx | 04 | 4 | FLOOR-04 | — | Tasks renders via primitives; data behavior unchanged | unit/component | `cd apps/mobile && npx jest __tests__/screens/TasksVariationA.test.tsx` | ✅ | ⬜ pending |
| 08-05-xx | 05 | 5 | FLOOR-05 | — | Inspect renders via primitives; submission behavior unchanged (existing checklist UI migrated as-is, no new photo-capture behavior) | unit/component | `cd apps/mobile && npx jest __tests__/screens/InspectorQueue.test.tsx` | ✅ (verify name match) | ⬜ pending |

*Task IDs are placeholders (`xx`) — planner assigns final IDs per plan/wave breakdown. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/mobile/components/shared/tokens.ts` — add `ink4`, `brassSoft`, `brassLine` to `lightTheme`/`darkTheme` (currently exist only in the flat `C` compat object; `useTheme()` has no path to them, and D-03 requires zero `C` usage remaining after this phase)
- [ ] Confirm `MobileVisualTokens.test.ts` (or equivalent) doesn't assert a fixed theme-object shape that would break when the 3 keys are added

*No new test framework install needed — existing Jest/jest-expo infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual parity of migrated screens (no layout regression, Toast doesn't cover offline banner, ES string wrap unchanged) | FLOOR-01..05 | Component tests assert render/behavior, not pixel-level layout | Run on simulator/device: navigate all 5 screens + their modals in EN and ES, toggle role where relevant (housekeeper/engineer), confirm no clipped text, no overlapping Toast/banner, no missing icons |
| `Alert.alert` → `Toast` conversion correctness across all 32 call sites (2 stay blocking per D-04 classification) | FLOOR-01, FLOOR-03, FLOOR-05 | Requires exercising each destructive/success/error path by hand; not all 32 paths are covered by existing automated tests | Trigger each classified call site (see RESEARCH.md's full classification table) and confirm blocking alerts still block, feedback-only alerts now show as non-blocking Toast with correct success/error/info variant |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (tokens.ts gap)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

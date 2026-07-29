---
phase: 8
slug: floor-role-rollout
status: approved
nyquist_compliant: true
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

| Plan | Wave | Objective | Requirement | Threat Ref | Secure Behavior | Automated Command | Status |
|------|------|-----------|-------------|------------|-----------------|-------------------|--------|
| 08-00 | 0 | tokens.ts prereq | FLOOR-01..05 (unblocks all) | T-08-00-01/02 | `lightTheme`/`darkTheme` gain `textDisabled`/`accentBrassSoft`/`accentBrassLine`, no existing key renamed/removed | `cd apps/mobile && npx jest MobileVisualTokens.test.ts && npm run type-check` | ⬜ pending |
| 08-01 | 1 | My Rooms list + RoomQueueCard rebuild (D-09) | FLOOR-01 | plan threat_model | Card-shell only touched; `StatusPill`/`StatusRail` untouched; role/tenant-scoped fetch unchanged | `cd apps/mobile && npx jest __tests__/screens/MyRoomsScreen.test.tsx` | ⬜ pending |
| 08-02 | 1 | My Rooms detail + ChecklistSection; 11 alerts→Toast | FLOOR-01 | plan threat_model | Alert→Toast conversion only touches feedback-only alerts per D-04; confirm-dialogs unchanged | `cd apps/mobile && npx jest __tests__/screens/RoomDetail.test.tsx` | ⬜ pending |
| 08-03 | 1 | My Rooms modals: ReportIssue/Knock/SupplyRequest/FoundItem | FLOOR-01 | plan threat_model | FoundItemModal raw-hex→theme migration; zero hex literals remain | `cd apps/mobile && npx jest __tests__/components/ReportIssueModal.test.tsx` | ⬜ pending |
| 08-04 | 2 | Room Board + new render test scaffold | FLOOR-02 | plan threat_model | Offline-sync unchanged; new `RoomBoard.test.tsx` created (no prior test existed — `RoomStatusList.test.tsx` covers the unrelated `room-status` screen) | `cd apps/mobile && npx jest __tests__/screens/RoomBoard.test.tsx` | ⬜ pending |
| 08-05 | 3 | WO list + WorkOrderCard rebuild (D-08) + CreateWorkOrderModal | FLOOR-03 | plan threat_model | RBAC/tenant-scoping in handlers unchanged; Card-shell rebuild only | `cd apps/mobile && npx jest __tests__/screens/WorkOrdersList.test.tsx` | ⬜ pending |
| 08-06 | 3 | WO detail; 10 alerts→Toast, escalate-confirm stays blocking | FLOOR-03 | plan threat_model | Escalate-confirm `Alert.alert` intentionally NOT converted (D-04 confirm case) | `cd apps/mobile && npx jest __tests__/screens/WorkOrderDetail.test.tsx` | ⬜ pending |
| 08-07 | 4 | Tasks list + TaskCard rebuild (D-08) | FLOOR-04 | plan threat_model | Data behavior unchanged; doneBtn stays themed TouchableOpacity (no primitive fits icon-only tappable) | `cd apps/mobile && npx jest __tests__/screens/TasksVariationA.test.tsx` | ⬜ pending |
| 08-08 | 5 | Inspect; migrate existing fail-checklist as-is (D-11) | FLOOR-05 | plan threat_model | No new ImagePicker/photo-capture code added; submission logic unchanged | `cd apps/mobile && npx jest __tests__/screens/InspectorQueue.test.tsx` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. Updated post-planning to match the 9 plans/6 waves actually produced — see individual PLAN.md files for full per-task acceptance criteria.*

---

## Wave 0 Requirements

- [ ] `apps/mobile/components/shared/tokens.ts` — add `textDisabled`, `accentBrassSoft`, `accentBrassLine` to `lightTheme`/`darkTheme` (mirrors `C.ink4`/`C.brassSoft`/`C.brassLine`, which exist only in the flat `C` compat object; `useTheme()` has no path to them, and D-03 requires zero `C` usage remaining after this phase) — implemented in 08-00-PLAN.md
- [ ] Confirm `MobileVisualTokens.test.ts` doesn't assert a fixed theme-object shape that would break when the 3 keys are added — 08-00's `read_first` covers this
- [ ] `apps/mobile/app/(app)/room-board/index.tsx` has no pre-existing dedicated test (`RoomStatusList.test.tsx` covers `room-status`, a different screen) — 08-04 creates `RoomBoard.test.tsx` as part of its Wave 2 work

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

**Approval:** approved 2026-07-29 (gsd-plan-checker Dimension 8: all 4 sub-checks pass, 0 blockers)

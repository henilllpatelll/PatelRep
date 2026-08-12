---
phase: 9
slug: remaining-screens-rollout
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-30
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest ^29.7.0 + `jest-expo` ~54.0.0 + `@testing-library/react-native` ^12.9.0 |
| **Config file** | none dedicated — `jest-expo` preset (unchanged since Phase 8) |
| **Quick run command** | `cd apps/mobile && npx jest __tests__/screens/<Name>.test.tsx` |
| **Full suite command** | `cd apps/mobile && npm test` |
| **Estimated runtime** | ~30-60 seconds (full suite, per Phase 8 precedent) |

---

## Sampling Rate

- **After every task commit:** the touched screen's existing test (where present) + `npm run type-check` (`tsc --noEmit`) + `npm run lint` (the i18n gate — enforcing the 4 formerly-exempt files once the i18n backlog task lands)
- **After every plan wave:** full `npm test` + `npm run type-check` + `npm run lint`
- **Before `/gsd-verify-work`:** full suite green + manual simulator/device pass per wave (no visual regression, offline banner renders above any new Toast, EN/ES render without new truncation on the busiest screens)
- **Max feedback latency:** ~60 seconds (type-check + lint + targeted jest run)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-i18n-01 | i18n backlog | 0 | SCREENS-03 (backlog) | — | 16 text + 6 placeholder literals wired with `t()`, EN/ES parity, 4 `ignores` entries removed | lint | `cd apps/mobile && npm run lint` | ✅ | ⬜ pending |
| 09-01-01 | Profile | 1 | SCREENS-01 | — | Sign-out `Alert.alert` unchanged; renders via primitives | component | `npx jest __tests__/screens/ProfileHandoff.test.tsx` | ✅ | ⬜ pending |
| 09-01-02 | Dashboards | 1 | SCREENS-02 | — | Role-gating unchanged; all 5 dashboards render via primitives | component | `npx jest __tests__/screens/HousekeeperHome.test.tsx __tests__/screens/EngineerHome.test.tsx` | ✅ (2/5; rest ❌ optional) | ⬜ pending |
| 09-02-01 | Assignments + supervisor screens/modals | 2 | SCREENS-03 | — | RBAC/data behavior unchanged; role action-sheets stay `Alert.alert` | manual + type-check | `npm run type-check` | ❌ optional | ⬜ pending |
| 09-03-01 | Assets + PM Schedules | 3 | SCREENS-04 | — | Data behavior unchanged | manual + type-check | `npm run type-check` | ❌ optional | ⬜ pending |
| 09-04-01 | Guest Requests + Lost & Found | 4 | SCREENS-05 | — | List+detail render via primitives, data unchanged | component | `npx jest __tests__/screens/GuestRequestsList.test.tsx` | ✅ (list only) | ⬜ pending |
| 09-05-01 | Logbook + SOP | 5 | SCREENS-06, SCREENS-07 | — | Data behavior unchanged | manual + type-check | `npm run type-check` | ❌ optional | ⬜ pending |
| 09-06-01 | AI Copilot | 6 | SCREENS-08 | — | Chat behavior + dark aesthetic unchanged (D-11); 6 alerts → Toast | manual + type-check | `npm run type-check` | ❌ optional | ⬜ pending |
| 09-07-01 | Alerts/Notifications + Room Status | 7 | SCREENS-09, SCREENS-10 | — | `CreateWorkOrderModal` integration intact (D-04) | component | `npx jest __tests__/screens/RoomStatusList.test.tsx` | ✅ (verify targets room-status) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs above are wave-level placeholders — the planner assigns final per-plan task IDs; this map's requirement/command coverage carries forward regardless of exact numbering.*

---

## Wave 0 Requirements

- [ ] i18n backlog (mandatory, not a test): remove 4 `ignores` entries from `apps/mobile/eslint.config.mjs`, wire `t()` for 16 JSX-text + 6 placeholder literals across `CreateWorkOrderModal.tsx`/`ReportIssueModal.tsx`/`SupplyRequestModal.tsx`/`tasks/index.tsx`, add matching EN+ES keys, confirm `npm run lint` passes with the gate active on these 4 files.
- [ ] No `tokens.ts` prerequisite this phase — Phase 8's Wave-0 fix (`textDisabled`/`accentBrassSoft`/`accentBrassLine`) already covers all ordinary screens; copilot stays dark per D-11 so no new token additions are needed.

*Per-screen new test files are optional (Phase 8 precedent) — do not block the phase on authoring ~18 new test files; existing tests + type-check + lint + manual pass are the primary sampling mechanism. A smoke render test is recommended only for screens with complex conditional rendering (dashboards, copilot) if the planner wants extra safety.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| No screen regression across all 13 screens + 7 supervisor files | SCREENS-01..10 | No dedicated component test exists for 21 of the 28 touched files; visual/interaction parity is not machine-checkable without a snapshot baseline | Per-wave manual simulator/device pass: navigate to each migrated screen, confirm layout/colors/interactions unchanged, offline banner still renders above any new Toast, EN/ES render without truncation |
| `copilot/index.tsx` dark aesthetic preserved (D-11) | SCREENS-08 | Visual/aesthetic judgment, not a snapshot assertion | Manual pass: confirm chat surface still renders dark, send/mic/confirm-card controls work via new Button/IconButton, 6 outcome toasts fire correctly |
| `room-status/index.tsx` + `CreateWorkOrderModal` integration (D-04) | SCREENS-10 | Cross-component integration behavior after parent theming | Manual pass: open Create Work Order from the migrated `room-status` screen, confirm modal still renders/functions correctly |
| EN/ES parity for all new i18n keys | i18n backlog | Missing ES key silently falls back to English — not a lint error | Manually cross-check each new key exists in both `apps/mobile/i18n/en.ts` and `es.ts` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

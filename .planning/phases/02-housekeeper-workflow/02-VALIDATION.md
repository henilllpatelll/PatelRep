---
phase: 2
slug: housekeeper-workflow
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest-expo 51.0.4 + @testing-library/react-native 12.9.0 |
| **Config file** | `apps/mobile/jest.config.js` |
| **Quick run command** | `cd apps/mobile && npx jest --passWithNoTests --testPathPattern="__tests__"` |
| **Full suite command** | `cd apps/mobile && npx jest --passWithNoTests` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd apps/mobile && npx jest --passWithNoTests --testPathPattern="__tests__"`
- **After every plan wave:** Run `cd apps/mobile && npx jest --passWithNoTests`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-xx-HK04a | sync | W0 | HK-04 | unit | `cd apps/mobile && npx jest __tests__/lib/offline/sync.test.ts -x` | ❌ W0 | ⬜ pending |
| 2-xx-HK04b | sync | W0 | HK-04 | unit | same file | ❌ W0 | ⬜ pending |
| 2-xx-HK04c | sync | W0 | HK-04 | unit | same file | ❌ W0 | ⬜ pending |
| 2-xx-HK06a | issue | W0 | HK-06 | unit | `cd apps/mobile && npx jest __tests__/components/ReportIssueModal.test.tsx -x` | ❌ W0 | ⬜ pending |
| 2-xx-HK06b | issue | W0 | HK-06 | unit | same file | ❌ W0 | ⬜ pending |
| 2-xx-HK01 | rooms | manual | HK-01 | manual | — | N/A | ⬜ pending |
| 2-xx-HK02 | rooms | manual | HK-02 | manual | — | N/A | ⬜ pending |
| 2-xx-HK03 | rooms | manual | HK-03 | manual | — | N/A | ⬜ pending |
| 2-xx-HK05 | push | manual | HK-05 | manual | — | N/A | ⬜ pending |
| 2-xx-HK07 | rooms | manual | HK-07 | manual | — | N/A | ⬜ pending |
| 2-xx-PROF01 | profile | manual | PROF-01 | manual | — | N/A | ⬜ pending |
| 2-xx-PROF02 | profile | manual | PROF-02 | manual | — | N/A | ⬜ pending |
| 2-xx-L10N01 | i18n | manual | L10N-01 | manual | — | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/mobile/__tests__/lib/offline/sync.test.ts` — stubs for HK-04 (flush queue, skip failed, correct endpoint)
- [ ] `apps/mobile/__tests__/components/ReportIssueModal.test.tsx` — stubs for HK-06 (render, submit, offline enqueue)

*Test files do not exist yet and must be created before implementing the features they cover.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Housekeeper sees only their assigned rooms | HK-01 | Visual/interaction — requires seeded DB with assignments | Log in as housekeeper test account; verify only assigned rooms appear |
| Room list shows room number, floor, status, ETA | HK-02 | Visual rendering — requires live API data with `predicted_ready_at` | Verify all 4 fields display on room card |
| Status update DIRTY→IN_PROGRESS→CLEAN in ≤3 taps | HK-03 | Interaction count — requires real device/simulator | Count taps from card to CLEAN state |
| Room detail shows VIP flag and check-in time | HK-07 | Visual rendering — requires VIP room in test data | Open a VIP room; confirm badge and time are visible |
| Push notification on room assignment | HK-05 | Requires EAS push infrastructure + physical device | Assign room via web dashboard; verify push arrives on device |
| Profile shows name, role, hotel name | PROF-01 | Visual — requires API call to `/hotels/{id}` | Open profile tab; confirm all three fields display |
| Sign Out returns to login screen | PROF-02 | Navigation flow — requires running auth session | Tap Sign Out; confirm redirect to `/auth/login` |
| All new strings present in EN + ES | L10N-01 | Visual — requires device language switch | Check report issue modal and profile in both EN and ES |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

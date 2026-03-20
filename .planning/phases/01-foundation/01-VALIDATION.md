---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-20
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest-expo (Wave 0 installs — none detected in scaffold) |
| **Config file** | `apps/mobile/jest.config.js` — Wave 0 creates |
| **Quick run command** | `npx jest --testPathPattern="(client|OfflineBanner)" --passWithNoTests` |
| **Full suite command** | `cd apps/mobile && npx jest --passWithNoTests` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --testPathPattern="(client|OfflineBanner)" --passWithNoTests`
- **After every plan wave:** Run `cd apps/mobile && npx jest --passWithNoTests`
- **Before `/gsd:verify-work`:** Full suite must be green + physical device checklist complete
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | INFRA-01 | unit | `npx jest --testPathPattern="client"` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 0 | INFRA-04 | unit | `npx jest --testPathPattern="OfflineBanner"` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | AUTH-04 | manual smoke | Cold open on physical device — no login flash | N/A | ⬜ pending |
| 1-01-04 | 01 | 1 | AUTH-03 | manual smoke | Kill + reopen app — session still active | N/A | ⬜ pending |
| 1-01-05 | 01 | 1 | AUTH-05 | manual smoke | Background 30 min, return — no re-login | N/A | ⬜ pending |
| 1-01-06 | 01 | 1 | AUTH-01 | manual smoke | Password login → home screen on physical device | N/A | ⬜ pending |
| 1-01-07 | 01 | 2 | AUTH-02 | manual smoke | Magic link email → app opens (not browser) → session active | N/A | ⬜ pending |
| 1-01-08 | 01 | 2 | INFRA-04 | unit | `npx jest --testPathPattern="OfflineBanner"` | ❌ W0 | ⬜ pending |
| 1-01-09 | 01 | 2 | INFRA-01 | unit | `npx jest --testPathPattern="client"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/mobile/jest.config.js` — jest setup for React Native / Expo (jest-expo preset)
- [ ] `apps/mobile/babel.config.js` — confirm Babel preset exists for jest transforms
- [ ] `apps/mobile/__tests__/lib/api/client.test.ts` — 401 retry unit test, covers INFRA-01
- [ ] `apps/mobile/__tests__/components/OfflineBanner.test.tsx` — offline banner render test, covers INFRA-04
- [ ] Framework install: `cd apps/mobile && npx expo install jest-expo @types/jest`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Password login reaches home screen without error | AUTH-01 | Requires physical device + real Supabase credentials | Open app fresh, enter email/password, verify home screen renders with no error toast |
| Magic link opens app (not browser) | AUTH-02 | Requires real email delivery + deep link OS handling | Request magic link, tap email link on device, verify app opens to home screen |
| Session persists across app restart | AUTH-03 | Requires process kill + restart on real device | Force-close app from app switcher, reopen, verify no login screen appears |
| No login flash on cold open | AUTH-04 | Splash screen timing is device-specific | Reboot device, open app cold, verify splash hides directly to home (not login) |
| No logout after 30 min background | AUTH-05 | Requires real-time elapsed + OS background policies | Background app for 30 min during shift, return, verify still authenticated |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

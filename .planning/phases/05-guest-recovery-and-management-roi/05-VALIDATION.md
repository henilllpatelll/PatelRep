---
phase: 5
slug: guest-recovery-and-management-roi
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-24
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.1.1 + pytest-asyncio 1.4.0 (API) / Playwright (web E2E, existing config) |
| **Config file** | `apps/api/pytest.ini` (warning filters only, no custom markers) |
| **Quick run command** | `cd apps/api && python -m pytest tests/test_guest_recovery.py tests/test_twilio_sms.py tests/test_management_roi.py -q` |
| **Full suite command** | `cd apps/api && python -m pytest tests/ -q` (currently 312 tests) |
| **Estimated runtime** | ~15s quick / ~90s full (per STATE.md history at similar suite size) |

---

## Sampling Rate

- **After every task commit:** Run `cd apps/api && python -m pytest tests/test_guest_recovery.py tests/test_twilio_sms.py tests/test_management_roi.py -q`
- **After every plan wave:** Run `cd apps/api && python -m pytest tests/ -q` plus `cd apps/web && npm run lint && npm run type-check`
- **Before `/gsd-verify-work`:** Full suite green + `cd apps/web && npm run build`
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| P5-SMS-01 | TBD | TBD | Twilio inbound signature validation rejects bad signatures | T-5-01 | Invalid/missing `X-Twilio-Signature` → 401 in production | unit | `pytest tests/test_twilio_sms.py -k signature -x` | ❌ W0 | ⬜ pending |
| P5-SMS-02 | TBD | TBD | Reply-only matching links inbound to most recent outbound recipient; no match → no auto-create | T-5-02 | No guest_request created from cold inbound text | unit | `pytest tests/test_twilio_sms.py -k reply_only -x` | ❌ W0 | ⬜ pending |
| P5-SMS-03 | TBD | TBD | Reactive opt-out (send-error 21610) sets `contact_opted_out_at` and blocks further sends | T-5-03 | Opted-out guest cannot receive further outbound sends | unit | `pytest tests/test_guest_recovery.py -k opt_out -x` | ❌ W0 | ⬜ pending |
| P5-ROI-01 | TBD | TBD | Repeat asset/room failure = 2+ within trailing 90 days | — | Tenant-scoped aggregation, no cross-tenant leakage | unit | `pytest tests/test_management_roi.py -k repeat_failure -x` | ❌ W0 | ⬜ pending |
| P5-ROI-02 | TBD | TBD | Room-downtime revenue impact = hours × (ADR/24) | — | GM-only endpoint (`require_role("gm")`) | unit | `pytest tests/test_management_roi.py -k revenue_impact -x` | ❌ W0 | ⬜ pending |
| P5-ROI-03 | TBD | TBD | 7-day forecast produces per-day rooms + labor-hours projection reconcilable against fixture data | — | GM-only endpoint | unit | `pytest tests/test_management_roi.py -k forecast -x` | ❌ W0 | ⬜ pending |
| P5-LF-01 | TBD | TBD | Retention cron flags (does not auto-dispose) items past 90-day `retention_due_at` | T-5-04 | No status mutation to donated/discarded without a manager-logged custody event | integration | `pytest tests/test_internal_escalations.py -k retention -x` | ❌ W0 | ⬜ pending |
| P5-LF-02 | TBD | TBD | Disposition RBAC = gm, housekeeping_supervisor, front_desk (matches existing custody-event RBAC) | T-5-05 | Non-listed role (e.g. `engineer`) → 403 | unit | new negative-case test in `lost_found.py` test suite | ⚠️ Partial — RBAC code exists, test coverage TBD | ⬜ pending |
| (existing, unchanged) | — | — | SLA resolution, transition validation, custody verification, metrics reconciliation | — | Unchanged — do not re-test what's not touched | unit | `pytest tests/test_guest_recovery.py -q` | ✅ (6 tests) | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs above are placeholders (P5-SMS-xx / P5-ROI-xx / P5-LF-xx) since this project does not assign formal REQ-5XX IDs — scope authority is `HOTEL_STANDARDS_EXECUTION_PLAN.md` §Phase 5. The planner should map these to actual plan/wave/task IDs once plans are written.*

---

## Wave 0 Requirements

- [ ] `apps/api/requirements.txt` — add `twilio==9.10.9` before any Twilio-dependent test can import the SDK
- [ ] `apps/api/tests/test_twilio_sms.py` — new file; signature validation, reply-only matching, reactive opt-out detection (P5-SMS-01/02/03); needs a `FakeTwilioClient` test double extending the existing `tests/smoke/fake_supabase.py` FakeDB pattern
- [ ] `apps/api/tests/test_management_roi.py` — new file; repeat-failure window, revenue-impact calc, PM deferral rate, 7-day forecast reconciliation against fixture data (P5-ROI-01/02/03)
- [ ] Extend `apps/api/tests/test_internal_escalations.py` (or new file) — lost & found retention-flagging cron (P5-LF-01)
- [ ] `supabase/migrations/084_...sql` — guest_phone column + any new tables/columns needed for ROI aggregation (next available migration number; 082 is an intentional gap per CLAUDE.md history, do not fill it)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|--------------------|
| Live Twilio SMS send/receive | Guest messaging MVP | No live Twilio credentials exist locally (Account SID/Auth Token/phone number) — code-complete only, verified against a fake client | Flag explicitly as unverified in phase summary; do not claim tested until real credentials + a manual Twilio sandbox/production test are run |
| Management ROI dashboard visual/desktop+390px verification | Management reporting | New Next.js route, first exercise of the recently-bumped Next 16 preview release for a net-new dynamic route | Navigate to `/management-roi` at desktop and 390px width in a real browser; confirm no console errors, correct data rendering |
| Settings > Guest Requests + Settings > Rooms accessibility tab | Accessibility ops & SLA config UI | New admin UI surfaces | Manual GM-role browser walkthrough: create an SLA policy, toggle an accessible room feature, confirm persistence |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

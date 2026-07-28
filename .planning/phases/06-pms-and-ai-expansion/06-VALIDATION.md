---
phase: 6
slug: pms-and-ai-expansion
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-28
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.1.1 + pytest-asyncio (verified via `python -m pytest --version`) |
| **Config file** | not located as a standalone `pytest.ini`/`pyproject.toml [tool.pytest.ini_options]` in this research session — existing 300+ test suite already runs, so config exists; confirm exact location in Wave 0 rather than assuming absence |
| **Quick run command** | `cd apps/api && python -m pytest tests/smoke/test_integrations_security.py tests/smoke/test_ai_assignment_confirm.py -q` |
| **Full suite command** | `cd apps/api && python -m pytest tests/ -q` |
| **Estimated runtime** | ~60-120 seconds (full suite, based on prior phase baselines in STATE.md) |

---

## Sampling Rate

- **After every task commit:** Run the specific new/modified test file's quick command (e.g. `pytest tests/test_ai_copilot_credits.py -x`)
- **After every plan wave:** Run `cd apps/api && python -m pytest tests/ -q` (full suite — confirm no regression against the existing 400+ test baseline)
- **Before `/gsd-verify-work`:** Full suite green + `cd apps/web && npm run type-check` + live authenticated browser walkthrough (CLAUDE.md Self-Verification Policy)
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Decision | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|----------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-03-01 | 06-03 | 2 | D-01/D-06 | RBAC | Non-gm/chief_engineer/housekeeping_supervisor role gets 403 on `/ai/insights`, `/ai/recommendations`, `/ai/recommendations/metrics`; correctly-open endpoints (chat, confirm) allow any authenticated role | unit | `pytest tests/test_ai_copilot_rbac.py -x` | ❌ W0 | ⬜ pending |
| 06-02-02 | 06-02 | 1 | D-01/D-06 | Tenant isolation | Cross-tenant Opera credential/conflict access returns 404/empty and writes zero rows | unit | `pytest tests/smoke/test_opera_routes.py -x` | ❌ W0 | ⬜ pending |
| 06-01-02 | 06-01 | 1 | D-02/D-06 | Credit accounting (CLAUDE.md A3) | `credits_charged` varies with real `prompt_tokens`/`completion_tokens`, not fixed per `CREDIT_COSTS` | unit | `pytest tests/test_ai_copilot_credits.py -x` | ❌ W0 | ⬜ pending |
| 06-01-03 | 06-01 | 1 | D-02/D-06 | Audit integrity | Exactly one `ai_interactions` row is written per SOP query via `/copilot/chat` (fixes double-log bug found in research) | unit | `pytest tests/test_ai_copilot_credits.py -x` | ❌ W0 | ⬜ pending |
| 06-04-02 | 06-04 | 2 | D-05 | Webhook auth | Opera webhook signature check uses `opera_credentials.webhook_secret`, not the current `CRON_SECRET`-derived key (fixes signature bug found in research) | unit | `pytest tests/smoke/test_opera_webhooks.py -x` | ❌ W0 | ⬜ pending |
| 06-02-03 | 06-02 | 1 | D-03 | Pilot gating | Non-pilot hotel: all 7 `/opera/*` endpoints return 403; the reservation-sync cron skips non-pilot hotels (`sync_reservations` self-guards); webhook for non-pilot hotel is a documented no-op | unit | `pytest tests/test_opera_pilot_gate.py -x` | ❌ W0 | ⬜ pending |
| 06-05-02 | 06-05 | 3 | D-06 | E2E | Live authenticated browser walkthrough: AI copilot fast-path task creation, Opera settings pilot-gated vs non-pilot behavior on the web settings surface | manual | manual localhost walkthrough (Playwright) | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. Task IDs finalized against the 06-01..06-05 plan set (planner, revision iteration 1).*

---

## Wave 0 Requirements

- [ ] `apps/api/tests/test_ai_copilot_rbac.py` — new file, RBAC matrix for all `ai_copilot.py` endpoints (plan 06-03 Task 1)
- [ ] `apps/api/tests/test_ai_copilot_credits.py` — new file, D-02 credit-accounting + double-log regression tests (plan 06-01 Task 1)
- [ ] `apps/api/tests/smoke/test_opera_routes.py` — new file, RBAC + tenant isolation for remaining 6 of 7 Opera endpoints (connect partially covered by existing `test_integrations_security.py`) (plan 06-02 Task 2)
- [ ] `apps/api/tests/smoke/test_opera_webhooks.py` — new file, webhook signature + dispatch tests (currently zero coverage of `routers/webhooks.py::opera_webhook` or `services/opera/webhooks.py`) (plan 06-04 Task 1)
- [ ] `apps/api/tests/test_opera_pilot_gate.py` — new file, D-03 pilot-flag enforcement for the 7 endpoints + the reservation-sync cron path (plan 06-02 Task 2/3)
- [x] Web UI surface for Opera settings confirmed to exist (`apps/web/app/(dashboard)/settings/integrations/page.tsx`, 61 Opera references) — browser E2E scoped in plan 06-05

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full authenticated E2E walkthrough of AI copilot + Opera settings surface | D-06 | CLAUDE.md Self-Verification Policy mandates browser verification on localhost; no live Opera/OHIP or LLM provider credentials exist locally for a fully automated E2E | Start `npm run dev:web` + `npm run dev:api`, log in as GM test account, exercise AI copilot fast-path + confirm flow, exercise Opera settings UI for pilot-gated vs non-pilot hotel behavior, confirm no console errors |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (planner, revision iteration 1) — `wave_0_complete` stays `false` until the five RED test scaffolds are created during execution.

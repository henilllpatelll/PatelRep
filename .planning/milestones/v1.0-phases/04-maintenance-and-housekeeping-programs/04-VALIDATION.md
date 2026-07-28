---
phase: 4
slug: maintenance-and-housekeeping-programs
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-22
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `04-RESEARCH.md` §Validation Architecture. Phase 4 has no formal REQ-XXX IDs; behaviors are keyed to the `HOTEL_STANDARDS_EXECUTION_PLAN.md §Phase 4` scope as PM-XX / HK-XX / BL-XX and to CONTEXT decisions D-01..D-13.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (API, `apps/api/tests/`); Playwright (web, `apps/web/e2e/`); ESLint (web i18n gate) |
| **Config file** | pytest via `apps/api` invocation; Playwright `playwright.phase4.config.ts` (**Wave 0 creates**) |
| **Quick run command** | `cd apps/api && python -m pytest tests/test_operational_programs.py tests/test_programs_routes.py -q` |
| **Full suite command** | `cd apps/api && python -m pytest tests/ -q` then `cd apps/web && npm run lint && npm run type-check` |
| **Estimated runtime** | ~30–60 seconds (API) + ~60s (Playwright EN/ES at 390px) |

---

## Sampling Rate

- **After every task commit:** Run `cd apps/api && python -m pytest tests/test_operational_programs.py tests/test_programs_routes.py -q` + `npm run type-check` for touched web.
- **After every plan wave:** Run full `pytest tests/ -q` + `npm run lint && npm run type-check`.
- **Before `/gsd-verify-work`:** Full suite green + EN/ES 390px Playwright pass + i18n lint gate green.
- **Max feedback latency:** ~60 seconds.

---

## Per-Task Verification Map

*Skeleton — the planner fills exact Task IDs/waves. Behaviors and threat refs from research.*

| Behavior | Slice | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists |
|----------|-------|------------|-----------------|-----------|-------------------|-------------|
| PM completion persists items + advances schedule | 4A | — | tenant-scoped write | integration (TestClient) | `pytest tests/test_programs_routes.py -x` | ❌ W0 |
| Evidence-required item without proof → 422 | 4A | V5 | reject incomplete evidence | unit + route | `pytest -k evidence_required` | ✅ unit / ❌ route W0 |
| Failed check spawns corrective WO (audit + due_at) | 4A | Repudiation | canonical WO transition | unit + route | `pytest -k corrective_work_order` | ✅ unit / ❌ route W0 |
| Deferral requires distinct approver + audit event | 4A | Tampering | no self-approval (G4) | route | `pytest -k deferral_approval` | ❌ W0 |
| DB-level immutability (UPDATE/DELETE blocked) | S0 | Repudiation | trigger-enforced | integration (Supabase MCP tx) | manual/MCP rolled-back tx | ❌ (SQL string-match only) |
| PM photo/cert returned as signed URL, never public | S0/4A | V8 (G1) | private bucket + signed URL | route | `pytest -k signed_url` | ❌ W0 |
| Cross-tenant PM schedule → 404, zero writes | S0 | Info Disclosure | in-handler `.eq(tenant_id)` | route | `pytest -k tenant_isolation` | ❌ W0 |
| RBAC: housekeeper 403 on PM complete; chief_engineer allowed | S0 | V4 (G7) | correct role set | route | `pytest -k pm_rbac` | ❌ W0 |
| Overview read gated to management (G6) | S0 | V4 | `require_role` on read | route | `pytest -k overview_rbac` | ❌ W0 |
| Deep-clean recurrence advances from completion | 4B | — | append-only occurrence | unit | `pytest -k deep_clean_recurrence` | ✅ |
| DND threshold + one escalation per window | 4B | — | duplicate-prevention | unit | `pytest -k dnd_policy` | ✅ |
| Par alerts only below threshold | 4B | — | correct alert gating | unit | `pytest -k supply_par` | ✅ |
| Templates applicability-gated + editor/generic builder | 4A | — | property_applicability gate (G5) | unit + route | `pytest -k template` | ❌ W0 |
| `maybe_single()→None` handled on new routes (bug-449 guard) | S0 | — | real-behavior test | route | `pytest -k maybe_single` | ❌ W0 |
| Floor workflows usable EN + ES at 390px | 4C | — | full i18n coverage | e2e | `npx playwright test --config=playwright.phase4.config.ts` | ❌ W0 |
| Raw literal in floor dir fails lint | 4C | — | scoped hard-fail gate (D-04) | ci | `cd apps/web && npm run lint` | ❌ W0 |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/test_programs_routes.py` — TestClient route tests: tenant isolation (404 cross-tenant, **zero writes**), RBAC per route (incl. `chief_engineer`), evidence-required 422, signed-URL-on-read, overview read gate.
- [ ] DB-level immutability proof — Supabase MCP rolled-back transaction (mirror the Phase 3 incident-immutability approach in STATE.md), not just SQL string-match.
- [ ] `playwright.phase4.config.ts` + `e2e/phase4-programs.spec.ts` — EN + ES at 390px over PM completion, deep-clean, DND config.
- [ ] `eslint-plugin-i18next` install + scoped `no-literal-string` override on floor-facing dirs + one intentional-failure fixture proving the gate bites.
- [ ] Real-behavior test for `maybe_single()→None` on new routes (bug-449 regression guard).

---

## Manual-Only Verifications

| Behavior | Why Manual | Test Instructions |
|----------|------------|-------------------|
| DB-level immutability of `pm_completion_records` / `pm_deferrals` / `deep_clean_occurrences` | Trigger enforcement is DB-side; the FakeDB harness cannot prove it | Supabase MCP: open a transaction, attempt UPDATE + DELETE on a seeded row, assert both rejected, ROLL BACK (zero residue), mirroring the Phase 3 incident proof |
| Authenticated GM browser walkthrough of PM completion + deep-clean + DND config, EN and ES | Golden-path self-verification policy (localhost:3000 → API) | Per CLAUDE.md Self-Verification Policy — exercise the flows, confirm no console errors |

*Credential-gated paths: none introduced by Phase 4 (D-11) — no AI/Stripe dependency, so no manual credential blocker.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (route tests, immutability proof, Playwright config, i18n gate)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

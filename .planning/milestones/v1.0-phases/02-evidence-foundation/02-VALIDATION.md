---
phase: 02
slug: evidence-foundation
status: ready
verified: false
score: 0
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-19
---

# Phase 2 — Validation Strategy

| Layer | Quick check | Full check |
|---|---|---|
| API | `cd apps/api && python -m pytest tests/test_evidence_foundation.py -q` | `cd apps/api && pytest tests/ -q` |
| Web | `cd apps/web && npm run type-check` | `cd apps/web && npm run lint && npm run build` |
| Browser | Phase 2 Playwright spec | Desktop and 390px authenticated evidence workflows |

After each task commit, run the focused API or web test named in that task. After each plan wave, run the relevant full suite. Before phase verification, run all three layers and a localhost browser check of the GM exception/export and staff acknowledgement flows.

| Plan | Automated coverage required |
|---|---|
| 02-01 | canonical applicability validation, GM RBAC, tenant filter, assignment applicability rejection |
| 02-02 | version/supersession, owner/approver/date/retention rules, same-tenant links, append-only audit reasons |
| 02-03 | evidence linkage/RBAC, content limits, private signed URL, cross-tenant attachment denial |
| 02-04 | approved/applicable assignment, ownership, competency outcome, retraining after supersession |
| 02-05 | mixed-state queue, idempotent reminders/escalation/failure delivery, export contents, GM/staff browser flows |

No Wave 0 test infrastructure is needed: pytest, the FakeDB fixtures, Next checks, and Playwright are already present.

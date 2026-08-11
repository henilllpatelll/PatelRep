# Roadmap: PatelRep

## Milestones

- ✅ **v1.0 Hotel Standards Execution Plan** — Phases 0-6 (shipped 2026-07-28). Full details: `.planning/milestones/v1.0-ROADMAP.md`
- ✅ **v1.1 Mobile UI Parity** — Phases 7-11 (shipped 2026-08-02). Full details: `.planning/milestones/v1.1-ROADMAP.md`
- ✅ **v1.2 Stabilization Pass** — Phases 12-14 (shipped 2026-08-03). Full details: `.planning/milestones/v1.2-ROADMAP.md`
- ✅ **v1.3 Billing, Work Order Archival, and Backlog Cleanup** — Phases 15-17 (shipped 2026-08-04). Full details: `.planning/milestones/v1.3-ROADMAP.md`
- ✅ **v1.4 Platform and Ops Hardening** — Phases 18-22 (shipped 2026-08-11). Full details: `.planning/milestones/v1.4-ROADMAP.md`
- 🚧 **v1.5 RBAC Enforcement Tooling** — Phases 23-24 (in progress, started 2026-08-11)

## Phases

<details>
<summary>✅ v1.0 Hotel Standards Execution Plan (Phases 0-6) — SHIPPED 2026-07-28</summary>

- [x] Phase 0: Restore reality — completed 2026-07-19
- [x] Phase 1: Core operational integrity — completed 2026-07-19
- [x] Phase 2: Evidence foundation (5/5 plans) — completed 2026-07-21
- [x] Phase 3: Texas compliance and staff safety — completed 2026-07-21 (deployed)
- [x] Phase 4: Maintenance and housekeeping programs (17/17 plans) — completed 2026-07-25 (deployed)
- [x] Phase 5: Guest recovery and management ROI (12/12 plans) — completed 2026-07-25 (deployed)
- [x] Phase 6: PMS and AI expansion (5/5 plans) — completed 2026-07-28

Full phase details, decisions, and issues: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>✅ v1.1 Mobile UI Parity (Phases 7-11) — SHIPPED 2026-08-02</summary>

- [x] Phase 7: Theme Foundation & Primitives (6/6 plans) — completed 2026-07-29
- [x] Phase 8: Floor-Role Rollout (9/9 plans) — completed 2026-07-30
- [x] Phase 9: Remaining Screens Rollout (17/17 plans) — completed 2026-07-31
- [x] Phase 10: Dark Mode & Accessibility QA (11/11 plans) — completed 2026-07-31
- [x] Phase 11: Mobile UI Parity Cleanup (6/6 plans) — completed 2026-08-02

Full phase details, decisions, and issues: `.planning/milestones/v1.1-ROADMAP.md`

</details>

<details>
<summary>✅ v1.2 Stabilization Pass (Phases 12-14) — SHIPPED 2026-08-03</summary>

- [x] Phase 12: Logbook & Lost & Found Data Integrity (2/2 plans) — completed 2026-08-02
- [x] Phase 13: AI Copilot Reliability (3/3 plans) — completed 2026-08-03
- [x] Phase 14: Room Status Display Accuracy (1/1 plans) — completed 2026-08-03

Full phase details, decisions, and issues: `.planning/milestones/v1.2-ROADMAP.md`

</details>

<details>
<summary>✅ v1.3 Billing, Work Order Archival, and Backlog Cleanup (Phases 15-17) — SHIPPED 2026-08-04</summary>

- [x] Phase 15: Work-Order Bulk-Archive (2/2 plans) — completed 2026-08-04
- [x] Phase 16: Self-Serve Billing Management (4/4 plans) — completed 2026-08-04
- [x] Phase 17: Backlog Cleanup (8/8 plans) — completed 2026-08-04

Full phase details, decisions, and issues: `.planning/milestones/v1.3-ROADMAP.md`

</details>

<details>
<summary>✅ v1.4 Platform and Ops Hardening (Phases 18-22) — SHIPPED 2026-08-11</summary>

- [x] Phase 18: Documentation Drift Fixes (1/1 plans) — completed 2026-08-04
- [x] Phase 19: RBAC Audit and Normalization (4/4 plans) — completed 2026-08-04
- [x] Phase 20: Close Deferred v1.3 Verification Items (2/2 plans) — completed 2026-08-05
- [x] Phase 21: Dev/QA Test-Data Hygiene (3/3 plans) — completed 2026-08-05
- [x] Phase 22: Expo SDK 54→57 Bump (6/6 plans) — completed 2026-08-06

Full phase details, decisions, and issues: `.planning/milestones/v1.4-ROADMAP.md`

</details>

### 🚧 v1.5 RBAC Enforcement Tooling (In Progress, started 2026-08-11)

**Milestone Goal:** Close the RBAC tooling gap deferred from Phase 19 — make role-check drift structurally hard to reintroduce, instead of relying on periodic manual audits.

- [x] **Phase 23: Route×Role Permission Matrix** - An auto-generated `RBAC-MATRIX.md` lists every route's required role(s), produced by a re-runnable, deterministic script instead of hand-maintained prose
- [ ] **Phase 24: CI Guard Against New Bare Role Comparisons** - A CI check fails the build when a router adds a new bare role-comparison outside `require_role()`/`core/roles.py`, with pre-existing intentional inline checks handled via a documented allowlist

## Phase Details

### Phase 23: Route×Role Permission Matrix
**Goal**: Every API route's required role(s) are documented in an accurate, auto-generated artifact that a developer can regenerate on demand rather than hand-maintain, replacing the one-time manual `RBAC-AUDIT.md` inventory with a living one.
**Depends on**: Nothing (first phase in milestone; introspects current code as-is, no dependency on Phase 24's lint check)
**Requirements**: RBAC-05, RBAC-06
**Success Criteria** (what must be TRUE):
  1. Running the generator script produces an `RBAC-MATRIX.md` (or equivalent) artifact listing every route in `apps/api/routers/` with its required role(s) — "none" for identity/self-service endpoints, the specific role tuple/constant name otherwise.
  2. The matrix is derived by introspecting live code (`require_role()` calls and `core/roles.py`-sourced constants), not hand-typed prose — spot-checked against `.planning/phases/19-rbac-audit-and-normalization/RBAC-AUDIT.md`'s known 30-router inventory for consistency.
  3. Running the script twice against unchanged code reproduces byte-identical output (deterministic, no manual editing required to stay accurate).
  4. The script is checked into the repo (e.g. `apps/api/scripts/`) and can be invoked with a single documented command by a developer or CI.
**Plans**: 1 plan
- [x] 23-01-PLAN.md — AST-based `apps/api/scripts/generate_rbac_matrix.py` generator producing `apps/api/RBAC-MATRIX.md`, plus a pytest CI drift guard (complete 2026-08-11)

### Phase 24: CI Guard Against New Bare Role Comparisons
**Goal**: A router file that adds a new bare role-comparison outside `require_role()`/an imported `core/roles.py` constant fails CI, while the pre-existing intentional inline checks the Phase 19 audit already confirmed correct continue to pass via an explicit, documented allowlist.
**Depends on**: Phase 23 (reuses the same AST-based introspection approach for identifying role-check call sites across `apps/api/routers/`; not a hard technical dependency, but shares enough parsing logic to sequence after)
**Requirements**: RBAC-07, RBAC-08
**Success Criteria** (what must be TRUE):
  1. A CI check (script + workflow/pre-commit step) scans `apps/api/routers/` and fails the build when it finds a new bare role-comparison pattern (`current_user.role == "..."`, `current_user.role in {...}`/`not in {...}`, equivalent literal-role-set patterns) that isn't a call to `require_role()` and isn't sourced from an imported `core/roles.py` constant.
  2. Running the check against the current, Phase-19-audited codebase passes cleanly with zero false positives — `lost_found.py`'s custody-state set (confirmed-correct per the Phase 19 audit) passes via an explicit allowlist entry, and `safety.py`'s self-service exception passes automatically because it imports `MANAGER_ROLES` from `core/roles.py` (not a blanket file exclusion in either case).
  3. Introducing a new bare role-comparison in a router file (proven via a deliberate test case) causes the check to fail, demonstrating it actually blocks drift rather than merely documenting it.
  4. The allowlist is a checked-in, reviewable artifact (e.g. JSON/YAML) with an inline explanation for each entry, so a reviewer can see why it's intentional rather than a silent carve-out.
**Plans**: 1 plan
- [ ] 24-01-PLAN.md — AST-based `apps/api/scripts/check_bare_role_comparisons.py` detector + `apps/api/rbac_bare_comparison_allowlist.json` allowlist + pytest CI guard (`apps/api/tests/smoke/test_bare_role_comparison_guard.py`)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|-----------------|--------|-----------|
| 0. Restore reality | v1.0 | N/A | Complete | 2026-07-19 |
| 1. Core operational integrity | v1.0 | N/A | Complete | 2026-07-19 |
| 2. Evidence foundation | v1.0 | 5/5 | Complete | 2026-07-21 |
| 3. Texas compliance and staff safety | v1.0 | — | Complete (deployed) | 2026-07-21 |
| 4. Maintenance and housekeeping programs | v1.0 | 17/17 | Complete (deployed) | 2026-07-25 |
| 5. Guest recovery and management ROI | v1.0 | 12/12 | Complete (deployed) | 2026-07-25 |
| 6. PMS and AI expansion | v1.0 | 5/5 | Complete | 2026-07-28 |
| 7. Theme Foundation & Primitives | v1.1 | 6/6 | Complete | 2026-07-29 |
| 8. Floor-Role Rollout | v1.1 | 9/9 | Complete | 2026-07-30 |
| 9. Remaining Screens Rollout | v1.1 | 17/17 | Complete | 2026-07-31 |
| 10. Dark Mode & Accessibility QA | v1.1 | 11/11 | Complete | 2026-07-31 |
| 11. Mobile UI Parity Cleanup | v1.1 | 6/6 | Complete | 2026-08-02 |
| 12. Logbook & Lost & Found Data Integrity | v1.2 | 2/2 | Complete | 2026-08-02 |
| 13. AI Copilot Reliability | v1.2 | 3/3 | Complete | 2026-08-03 |
| 14. Room Status Display Accuracy | v1.2 | 1/1 | Complete | 2026-08-03 |
| 15. Work-Order Bulk-Archive | v1.3 | 2/2 | Complete | 2026-08-04 |
| 16. Self-Serve Billing Management | v1.3 | 4/4 | Complete | 2026-08-04 |
| 17. Backlog Cleanup | v1.3 | 8/8 | Complete | 2026-08-04 |
| 18. Documentation Drift Fixes | v1.4 | 1/1 | Complete | 2026-08-04 |
| 19. RBAC Audit and Normalization | v1.4 | 4/4 | Complete | 2026-08-04 |
| 20. Close Deferred v1.3 Verification Items | v1.4 | 2/2 | Complete | 2026-08-05 |
| 21. Dev/QA Test-Data Hygiene | v1.4 | 3/3 | Complete | 2026-08-05 |
| 22. Expo SDK 54→57 Bump | v1.4 | 6/6 | Complete | 2026-08-06 |
| 23. Route×Role Permission Matrix | v1.5 | Complete    | 2026-08-11 | 2026-08-11 |
| 24. CI Guard Against New Bare Role Comparisons | v1.5 | 0/TBD | Not started | - |

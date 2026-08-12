---
phase: 19-rbac-audit-and-normalization
plan: 01
subsystem: docs
tags: [rbac, audit, documentation]
dependency-graph:
  requires: []
  provides: [rbac-audit-artifact]
  affects: [19-02, 19-03, 19-04]
tech-stack:
  added: []
  patterns: []
key-files:
  created:
    - .planning/phases/19-rbac-audit-and-normalization/RBAC-AUDIT.md
  modified: []
decisions:
  - "MANAGER_ROLES split into MANAGER_ROLES (leadership/compliance tier) and PROGRAM_MANAGER_ROLES (operational tier incl. engineer) rather than merged to one value"
  - "ALL_STAFF_ROLES fix is dedup-only (drop duplicate 'engineer'); chief_engineer intentionally not re-added — retired by migration 064"
metrics:
  duration: "~15 minutes"
  completed: 2026-08-04
---

# Phase 19 Plan 01: RBAC Audit Artifact Summary

Created the permanent RBAC audit document by transcribing and restructuring the already-verified content from `19-RESEARCH.md` into a durable, committed artifact.

## What was built

`.planning/phases/19-rbac-audit-and-normalization/RBAC-AUDIT.md` (81 lines), containing:

1. **Legend** — defines route-level gate vs. object-level/business-rule check, and notes `internal.py`/`webhooks.py` as non-role-based by design.
2. **Full Role-Check Inventory (RBAC-01)** — 30-router table (all files in `apps/api/routers/` except `__init__.py`) with route-level gates, object-level checks, and notes per router, plus the roll-up reconciling to 30 (3 named inline-only + 2 non-role-based + 2 hosting named constant collisions + 22 clean/mixed).
3. **chief_engineer note** — reproduces the migration-064 critical discovery: `chief_engineer` was retired as an assignable role value; any router still referencing it in a constant is dead-but-harmless, not a live gap.
4. **RBAC-03 Review Outcomes** — per-router documented conclusions: `auth.py` (no gap, self-scoped/DB-validated), `lost_found.py` (2 gaps found and closed — PATCH/DELETE on `/{item_id}`), `guest_requests.py` (1 gap found and closed — DELETE `/{request_id}`).
5. **RBAC-04 Constant Decisions** — the `MANAGER_ROLES`/`PROGRAM_MANAGER_ROLES` split and the `ALL_STAFF_ROLES` dedup-only fix, each with the chief_engineer/migration-064 rationale.

This is a documentation-only task — no application code was touched.

## Deviations from Plan

None — plan executed exactly as written. The single task's action, verify, and done criteria were all met on the first pass.

## Verification

```
test -f .planning/phases/19-rbac-audit-and-normalization/RBAC-AUDIT.md
grep -c "guest_requests.py\|lost_found.py\|auth.py\|MANAGER_ROLES\|PROGRAM_MANAGER_ROLES\|ALL_STAFF_ROLES\|chief_engineer" RBAC-AUDIT.md
→ 24 (non-zero, required)
wc -l RBAC-AUDIT.md → 81 (min_lines: 60, required)
```

File contains the 30-router inventory table, RBAC-03 per-router outcomes (auth.py/lost_found.py/guest_requests.py), and RBAC-04 decisions (MANAGER_ROLES/PROGRAM_MANAGER_ROLES split, ALL_STAFF_ROLES dedup) — all done criteria satisfied.

## Note on concurrent work

At commit time, `git status` showed uncommitted modifications to `apps/api/routers/guest_requests.py`, `hotels.py`, `programs.py`, `safety.py`, and `apps/api/tests/test_lost_found_delete.py` — these are in-scope for later plans in this phase (19-02/19-03/19-04, the code-fix and constant-consolidation plans) and were left untouched. Only `RBAC-AUDIT.md` was staged and committed by this plan.

## Self-Check: PASSED

- FOUND: `.planning/phases/19-rbac-audit-and-normalization/RBAC-AUDIT.md`
- FOUND: commit `2e829e21`

---
phase: 24-ci-guard-bare-role-comparisons
plan: 01
subsystem: api
tags: [rbac, ast, pytest, ci-guard, python]

# Dependency graph
requires:
  - phase: 23-route-role-permission-matrix
    provides: generate_rbac_matrix.py's parse_role_constants (reused, not re-derived) and the RBAC-MATRIX.md drift-guard precedent this plan mirrors
provides:
  - "apps/api/scripts/check_bare_role_comparisons.py -- whole-router-module AST scan detecting bare current_user.role comparisons not sourced from an imported core/roles.py constant"
  - "apps/api/rbac_bare_comparison_allowlist.json -- 25 reasoned entries, keyed by (router filename, exact comparison text), documenting every pre-existing Phase-19-audited bare comparison"
  - "apps/api/tests/smoke/test_bare_role_comparison_guard.py -- RBAC-07 CI enforcement, picked up automatically by ci.yml's existing pytest tests/smoke/ step"
affects: [future-router-changes, rbac-tooling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AST-based CI drift guard with a reviewable, per-entry-reasoned JSON allowlist matched by (filename, exact ast.unparse text) rather than line number -- survives unrelated line-number shifts"
    - "importlib.util.spec_from_file_location to load a no-__init__.py scripts/ module from a test, reusing an existing sibling script's parsing logic instead of re-deriving it"

key-files:
  created:
    - apps/api/scripts/check_bare_role_comparisons.py
    - apps/api/rbac_bare_comparison_allowlist.json
    - apps/api/tests/smoke/test_bare_role_comparison_guard.py
  modified: []

key-decisions:
  - "Detector walks the entire router module (ast.walk(tree)), not just @router.<verb>(...)-decorated function bodies, so bare comparisons inside module-level helpers (work_orders.py's _ensure_engineer_can_update_work_order, rooms.py's _validate_undo_permission) are caught"
  - "Allowlist matches by (router filename, exact ast.unparse comparison text), not line number, so unrelated edits elsewhere in a router file don't false-positive the guard"
  - "safety.py:84 is excluded from the allowlist entirely (not just correctly unflagged) because it imports MANAGER_ROLES directly from core.roles -- the properly-sourced carve-out, not an allowlist carve-out"

patterns-established:
  - "Second CI guard layered on Phase 23's RBAC-MATRIX drift guard: route-level gates tracked by generate_rbac_matrix.py, inline/bare comparisons tracked by check_bare_role_comparisons.py -- together they cover both RBAC surfaces"

duration: 20min
completed: 2026-08-11
---

# Phase 24 Plan 01: CI Guard Against New Bare Role Comparisons Summary

**AST-based `check_bare_role_comparisons.py` scans every `apps/api/routers/*.py` module (including module-level helpers, not just route handlers) for bare `current_user.role` comparisons, classifies provenance via `core/roles.py` imports, and fails `pytest tests/smoke/` on any comparison not covered by a reasoned allowlist entry.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-11T23:44:49Z
- **Tasks:** 3
- **Files modified:** 3 created, 1 temporarily modified and reverted (`apps/api/routers/tasks.py`)

## Accomplishments

- New zero-dependency (`ast` + `json` stdlib only) detector, `apps/api/scripts/check_bare_role_comparisons.py`, that walks whole router modules for bare `<name>.role` comparisons and correctly distinguishes "imported from `core/roles.py`" (never flagged) from "any locally-known constant" (still flagged if not imported)
- Dry run against the current codebase found exactly the known inventory: **9 files, 25 occurrences** (`clean_sessions.py`, `guest_requests.py` x9, `late_checkout.py`, `logbook.py` x2, `lost_found.py` x3, `rooms.py` x3, `scheduling.py` x2, `tasks.py`, `work_orders.py` x3) -- `safety.py:84` correctly absent (imports `MANAGER_ROLES` from `core.roles`)
- `apps/api/rbac_bare_comparison_allowlist.json` populated with all 25 entries, `code` text copied verbatim from the detector's own output, each with a specific reason sourced from `RBAC-AUDIT.md` and Phase 23's CR-01/WR-04 fixes
- New `apps/api/tests/smoke/test_bare_role_comparison_guard.py::test_no_unlisted_bare_role_comparisons`, picked up automatically by `ci.yml`'s existing `pytest tests/smoke/` step -- zero false positives against the Phase-19-audited codebase
- Deliberate-drift proof: a temporary `if current_user.role == "phase24_deliberate_drift_test": pass` inserted into `tasks.py` made the new test FAIL naming `tasks.py:146` and the exact comparison text; `git checkout -- apps/api/routers/tasks.py` restored a clean tree and the test PASSED again

## Task Commits

1. **Task 1: Build the bare-role-comparison detector** - `ca3193f0` (feat)
2. **Task 2: Populate the allowlist, add the pytest CI guard** - `ca307814` (feat)
3. **Task 3: Deliberate-drift proof + non-regression check** - no commit (the only file touched, `apps/api/routers/tasks.py`, was reverted to its original committed state before this task completed -- `git status --short apps/api/routers/tasks.py` is empty)

**Plan metadata:** committed separately after this summary.

## Files Created/Modified

- `apps/api/scripts/check_bare_role_comparisons.py` - Whole-router-module AST scanner: `imported_core_roles_names`, `find_bare_role_comparisons`, `load_allowlist`, `find_violations`, `main()` (standalone report entrypoint)
- `apps/api/rbac_bare_comparison_allowlist.json` - 25 reasoned entries across 10 router files, `{"entries": [{"router", "line", "code", "reason"}, ...]}`
- `apps/api/tests/smoke/test_bare_role_comparison_guard.py` - `test_no_unlisted_bare_role_comparisons`, asserts `find_violations(...)` returns `[]`

## Decisions Made

- Reused `generate_rbac_matrix.py`'s `parse_role_constants` via `importlib.util.spec_from_file_location` rather than re-deriving `core/roles.py` constant parsing, so the two scripts can never classify `core/roles.py` differently (per plan's `key_links`)
- Allowlist matching key is `(router filename, exact ast.unparse text)`, not `(router, line)` -- `line` is stored only for human reviewability, matching the plan's explicit design rationale (line numbers shift on unrelated edits)
- `safety.py:84` deliberately has no allowlist entry -- it is excluded by the "properly sourced from an imported core/roles.py constant" carve-out itself, not by an allowlist bypass, per RBAC-07's literal wording

## Deviations from Plan

None - plan executed exactly as written. The detector's dry-run output matched the plan's stated known inventory exactly (9 files, 25 occurrences, same file:line list), so no discrepancy investigation was needed before writing the allowlist.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. This is a pure static-analysis CI guard with no new dependencies, env vars, or infrastructure.

## Verification Evidence

- `cd apps/api && .venv/Scripts/python.exe scripts/check_bare_role_comparisons.py` (no allowlist): printed all 25 violations, file:line list matched the plan's stated inventory exactly, exit 1
- `cd apps/api && .venv/Scripts/python.exe -m pytest tests/smoke/test_bare_role_comparison_guard.py -v`: **PASSED** against the allowlist-populated codebase
- `cd apps/api && .venv/Scripts/python.exe scripts/check_bare_role_comparisons.py` (allowlist present): "No unlisted bare role comparisons found.", exit 0
- Deliberate drift: inserted `if current_user.role == "phase24_deliberate_drift_test": pass` into `tasks.py` -> guard test **FAILED**, naming `tasks.py:146: current_user.role == 'phase24_deliberate_drift_test'`
- Revert: `git checkout -- apps/api/routers/tasks.py` -> guard test **PASSED** again; `git status --short apps/api/routers/tasks.py` printed nothing (clean tree)
- Full suite non-regression: baseline (new smoke test temporarily removed) = **556 passed, 3 pre-existing failures** (`test_management_roi.py` x3, confirmed pre-existing and unrelated to this plan); with this plan's additions = **557 passed, 3 pre-existing failures, 0 new failures** -- exactly the prior count plus the 1 new test, as required

## Next Phase Readiness

Phase 24 (CI Guard Against New Bare Role Comparisons, RBAC-07/RBAC-08) is complete. Both v1.5 phases (23 and 24) are now closed: Phase 23 built the auto-generated route x role matrix + drift guard, Phase 24 built the complementary bare-comparison drift guard with a reviewable allowlist. No blockers for milestone completion.

---
*Phase: 24-ci-guard-bare-role-comparisons*
*Completed: 2026-08-11*

## Self-Check: PASSED

- FOUND: apps/api/scripts/check_bare_role_comparisons.py
- FOUND: apps/api/rbac_bare_comparison_allowlist.json
- FOUND: apps/api/tests/smoke/test_bare_role_comparison_guard.py
- FOUND commit: ca3193f0 (Task 1)
- FOUND commit: ca307814 (Task 2)
- `git status --short apps/api/routers/tasks.py` is empty (clean, deliberate-drift test fully reverted)

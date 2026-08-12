---
phase: 23-route-role-permission-matrix
plan: 01
subsystem: api
tags: [ast, rbac, ci-guard, pytest, static-analysis]

# Dependency graph
requires:
  - phase: 19-rbac-audit-and-normalization
    provides: RBAC-AUDIT.md's route-level-gate/object-level-check classification and the MANAGER_ROLES/PROGRAM_MANAGER_ROLES/ALL_STAFF_ROLES constant normalization in core/roles.py
provides:
  - "apps/api/scripts/generate_rbac_matrix.py: AST-only (stdlib, zero deps) generator that introspects apps/api/routers/*.py + core/roles.py"
  - "apps/api/RBAC-MATRIX.md: committed, regenerable route x role table covering all 30 router files / 286 routes"
  - "apps/api/tests/smoke/test_rbac_matrix_contract.py: CI drift guard that fails if the matrix goes stale"
affects: [24-ci-guard-bare-role-comparisons]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AST-only introspection (no import/exec of target modules) for build-time drift guards, mirroring test_enum_contracts.py's JSON-contract precedent"
    - "importlib.util.spec_from_file_location to load a script with no __init__.py package structure directly into a test"

key-files:
  created:
    - apps/api/scripts/generate_rbac_matrix.py
    - apps/api/RBAC-MATRIX.md
    - apps/api/tests/smoke/test_rbac_matrix_contract.py
  modified: []

key-decisions:
  - "Matrix lives at apps/api/RBAC-MATRIX.md (not repo root) -- apps/api/LAUNCH_CHECKLIST.md is the existing precedent for an apps/api-level doc, and this artifact describes apps/api/routers/ specifically."
  - "required_roles_display uses three states: resolved role list (comma-joined, sorted) for require_role(...) gates, 'none' for get_current_user/get_current_user_no_hotel with no gate, and 'N/A (not role-based)' for verify_cron-gated cron endpoints and signature-verified webhooks."
  - "Unresolvable starred constants render as a '<NAME>(unresolved)' marker rather than being silently dropped, per the plan's explicit never-drop-a-role requirement."

# Metrics
duration: 25min
completed: 2026-08-11
---

# Phase 23 Plan 01: AST-Based RBAC Route x Role Matrix Generator Summary

**Stdlib-`ast`-only script that introspects all 30 `apps/api/routers/*.py` files and `core/roles.py` to produce a committed, byte-identical-on-rerun `RBAC-MATRIX.md` (286 routes), enforced by a new pytest drift guard.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-11T22:40:00Z (approx.)
- **Completed:** 2026-08-11T23:05:45Z
- **Tasks:** 3
- **Files modified:** 3 (all new)

## Accomplishments
- `generate_rbac_matrix.py` parses `core/roles.py` constants (with Name-reference resolution for `ALL_STAFF_ROLES = ALL_ROLES`), derives the `/v1` API prefix from `main.py` via AST (not hardcoded), resolves per-router constant maps (imported `core.roles` names + local `*_ROLES` constants, local wins), and extracts every `@router.<verb>(...)`-decorated route's `require_role(...)` gate (literal args + starred constant args, e.g. `require_role(*SESSION_ROLES, "gm")`), `get_current_user`/`get_current_user_no_hotel` no-gate markers, `verify_cron(...)` cron markers, and inline `<name>.role` comparisons.
- `apps/api/RBAC-MATRIX.md` generated and committed: 30 routers, 286 routes, proven byte-identical across two consecutive runs with no intervening code changes.
- `test_rbac_matrix_contract.py` loads the generator via `importlib.util.spec_from_file_location` (no `__init__.py` in `scripts/`) and asserts the committed file matches a fresh regeneration -- proven to fail on a deliberate manual edit (widened `programs.py`'s `initialize_property_templates` gate) and pass again cleanly after revert.

## Task Commits

Each task was committed atomically:

1. **Task 1: Build the AST introspection engine** - `97ddaf9f` (feat) -- proved against `programs.py`, matching all 16 documented gates from RBAC-AUDIT.md.
2. **Task 2: Render the full Markdown matrix, generate RBAC-MATRIX.md** - `d7ba1ee5` (feat) -- all 30 routers, determinism proven.
3. **Task 3: Add the CI drift guard** - `7bf7844f` (test) -- deliberate-drift proof done, full suite confirmed non-regressed.

## Files Created/Modified
- `apps/api/scripts/generate_rbac_matrix.py` - AST-based generator: `parse_role_constants`, `parse_api_prefix`, `_resolve_router_constants`, `get_router_prefix`, `_extract_route_rows`, `build_matrix_rows`, `render_markdown`, `main`.
- `apps/api/RBAC-MATRIX.md` - Generated artifact: `| Router | Route | Method | Required Role(s) | Source |` table, 286 rows.
- `apps/api/tests/smoke/test_rbac_matrix_contract.py` - `test_rbac_matrix_matches_generated_output`, the CI drift guard.

## Decisions Made
- Placed the generated artifact at `apps/api/RBAC-MATRIX.md` rather than the repo root, following the `LAUNCH_CHECKLIST.md` precedent for apps/api-scoped documentation.
- Kept `services/policy.py`'s numeric `_ROLE_RANK` paradigm (used by `ai_copilot.py`'s AI-action gating) entirely out of scope -- it's a different mechanism from set-membership `require_role(...)`, consistent with Phase 19's RBAC-04 Decision 3. The generator naturally reports `ai_copilot.py`'s policy-gated action-confirm endpoints (`/ai/tasks/confirm`, `/ai/work-orders/confirm`, etc.) as `none` at the route level, since their access control lives in `check_action_permitted` inside the handler body, not a `Depends(require_role(...))` gate -- this matches RBAC-AUDIT.md's own classification of those routes as intentionally open at the route level.
- Rendered `required_roles_display` as a sorted, deduplicated, comma-joined list rather than preserving call-site argument order, for deterministic and readable output.

## Deviations from Plan

None - plan executed exactly as written. All three tasks matched their `<action>`/`<verify>`/`<done>` specifications; no bugs, missing-critical-functionality, or blocking issues were encountered, and no architectural decisions were required.

## Issues Encountered

None during implementation. One pre-existing, out-of-scope issue was confirmed (not fixed, per the deviation rules' scope boundary): `apps/api/tests/test_management_roi.py` has 3 failing tests (`test_roi_downtime_revenue_uses_tenant_adr`, `test_roi_housekeeping_efficiency_pairs_in_progress_to_clean`, `test_roi_pm_compliance_reads_pm_deferrals_table`). Verified via `git stash` (stashing this plan's new/modified files and re-running) that these 3 failures are identical with or without this plan's changes -- they predate Phase 23 and are unrelated to `management_roi.py`, which this plan never touches. Logged as out-of-scope; not fixed here.

**Full suite result:** 554 passed + 3 pre-existing failures before this plan's test file existed (verified via stash) -> 555 passed + 3 pre-existing failures after (1 new test, `test_rbac_matrix_matches_generated_output`, added and passing). Zero regressions attributable to this plan.

## User Setup Required

None - no external service configuration required. The generator is pure stdlib `ast`, requires no environment variables, Supabase credentials, or a running app.

## Next Phase Readiness

- `apps/api/RBAC-MATRIX.md` is now the durable, regenerable source of truth for route x role requirements, replacing the one-time hand-typed `RBAC-AUDIT.md` inventory as the artifact developers should consult going forward (`RBAC-AUDIT.md` remains as historical audit record).
- `apps/api/scripts/generate_rbac_matrix.py`'s AST-walking primitives (constant resolution, `require_role(...)` arg resolution, inline `.role` comparison detection) are directly reusable by Phase 24's CI guard against new bare role comparisons -- Phase 24 can import/adapt the same inline-check-detection logic to flag comparisons outside `require_role()`/`core/roles.py` and cross-reference against this phase's already-computed set of intentional inline checks (e.g. `safety.py` line 84, `late_checkout.py` line 61, `rooms.py`'s `UNDO_ALL_ROLES` check) for the allowlist.
- No blockers.

---
*Phase: 23-route-role-permission-matrix*
*Completed: 2026-08-11*

## Self-Check: PASSED

- FOUND: apps/api/scripts/generate_rbac_matrix.py
- FOUND: apps/api/RBAC-MATRIX.md
- FOUND: apps/api/tests/smoke/test_rbac_matrix_contract.py
- FOUND: commit 97ddaf9f (Task 1)
- FOUND: commit d7ba1ee5 (Task 2)
- FOUND: commit 7bf7844f (Task 3)

# Phase 24: CI Guard Against New Bare Role Comparisons - Context

**Gathered:** 2026-08-11
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — smart discuss skipped per autonomous workflow's infrastructure-detection rule: goal keywords "CI check"/"guard", success criteria are all technical — check fails build, allowlist is reviewable, no user-facing behavior)

<domain>
## Phase Boundary

A CI check that fails the build when a router file in `apps/api/routers/` adds a new bare role-comparison (`current_user.role == "..."`, `current_user.role in {...}`/`not in {...}`, equivalent literal-role-set patterns) that isn't a call to `require_role()` and isn't sourced from an imported `core/roles.py` constant — with an explicit, documented allowlist for the pre-existing intentional inline checks Phase 19 already confirmed correct. Covers RBAC-07 (the CI check) and RBAC-08 (the allowlist).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase, discuss skipped. Guiding constraints from PROJECT.md and Phase 23's own work:
- Reuse, don't reinvent: Phase 23's `apps/api/scripts/generate_rbac_matrix.py` already built (and, per its own code-review fix cycle, hardened) AST-walking primitives for exactly this — detecting inline `<name>.role` comparisons, distinguishing denial-raising gates (`if ...: raise HTTPException(...)`) from filter-only comparisons, and resolving `core/roles.py`-sourced constants. Phase 24's check should share or directly reuse that logic rather than writing a second, possibly-divergent detector — Phase 23's own SUMMARY.md flagged this exact reuse opportunity for Phase 24.
- Allowlist source: Phase 19's `RBAC-AUDIT.md` (`.planning/phases/19-rbac-audit-and-normalization/RBAC-AUDIT.md`) already names the specific intentional inline checks that must be allowlisted, not blocked: `lost_found.py`'s custody-state set, `safety.py`'s self-service exception (`current_user.role not in MANAGER_ROLES and employee["user_id"] != current_user.user_id`), and any other confirmed-correct inline checks the RBAC-01 inventory documented (e.g. `guest_requests.py`'s message/satisfaction/recovery gates, `logbook.py`, `scheduling.py` clock-in/out — the same routes Phase 23's fix (CR-01) proved are genuine role gates, not filters).
- CI integration: mirror how the existing `i18next/no-literal-string` ESLint gate (mobile/web) and `test_enum_contracts.py`/`test_rbac_matrix_contract.py` (API) are wired into this repo's test suite / CI — likely a pytest test (Python-side, matching the router language) rather than a new standalone script with separate CI wiring, for consistency with the Phase 23 precedent.
- Allowlist format: a checked-in, reviewable artifact (not inline code comments scattered across routers) with an inline explanation per entry, per RBAC-08's explicit requirement.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/scripts/generate_rbac_matrix.py` (Phase 23) — already has `_collect_role_gated_ifs` (taint-aware AST scan distinguishing real `if <cond involving .role>: raise HTTPException(...)` denials from filter-only comparisons) and constant-resolution helpers (`parse_role_constants`, per-router constant maps). This phase's detector is a natural extension/reuse of that module rather than a fresh build.
- `apps/api/RBAC-MATRIX.md` (Phase 23's generated output) — already lists every current inline role-restriction with file:line, which is a ready-made starting point for populating the initial allowlist (the check should pass cleanly against the current, already-audited codebase).
- `.planning/phases/19-rbac-audit-and-normalization/RBAC-AUDIT.md` — RBAC-03 review outcomes section documents which inline checks were confirmed intentional vs. gaps (the gaps were already fixed in Phase 19).
- `apps/api/tests/smoke/test_rbac_matrix_contract.py` (Phase 23) — the drift-guard pattern this phase's new CI test should structurally resemble (pytest, `tests/smoke/` directory).
- `apps/api/core/roles.py` — the constants module bare comparisons should instead source from.

### Established Patterns
- This codebase enforces structural conventions via pytest drift-guard tests (`test_enum_contracts.py`, `test_rbac_matrix_contract.py`) rather than custom lint plugins, for the Python side.
- `apps/web`'s `eslint.config.mjs` `i18next/no-literal-string` rule is the cross-language precedent for "CI fails the build on a newly-introduced pattern, with a documented allowlist/exception mechanism" — conceptually relevant even though it's JS/TS tooling, not something to port directly into Python.

### Integration Points
- New check likely lives in `apps/api/tests/smoke/` (pytest, runs with the existing suite in CI) and/or as a script in `apps/api/scripts/` if a standalone regeneratable check is also useful.
- Must run against `apps/api/routers/*.py`, the same file set Phase 23's generator scans.

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond REQUIREMENTS.md's RBAC-07/RBAC-08 text. The plan should explicitly verify: (a) the check passes cleanly against the current codebase (zero false positives) using the allowlist, and (b) a deliberately-introduced new bare role-comparison actually fails the check (proving it blocks drift, not just documents it) — mirroring Phase 23's own "deliberate drift, confirm failure, revert, confirm pass" verification style.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope (matches REQUIREMENTS.md's explicit Out of Scope: no retroactive enforcement beyond what Phase 19 already audited, no object-level/business-rule authorization checks, no frontend route-guard matrix).

</deferred>

---
phase: 23-route-role-permission-matrix
verified: 2026-08-11T00:00:00Z
status: passed
score: 5/5 must-haves verified
---

# Phase 23: Route Role Permission Matrix Verification Report

**Phase Goal:** Every API route's required role(s) are documented in an accurate, auto-generated artifact that a developer can regenerate on demand rather than hand-maintain, replacing the one-time manual RBAC-AUDIT.md inventory with a living one.
**Verified:** 2026-08-11
**Status:** passed
**Re-verification:** No — initial verification (post code-review-fix cycle)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A developer can run one documented command and get a Markdown file listing every route in `apps/api/routers/` with its required role(s) | ✓ VERIFIED | `cd apps/api && .venv/Scripts/python.exe scripts/generate_rbac_matrix.py` produced `Wrote ...RBAC-MATRIX.md (30 routers, 286 routes)`; module docstring and `RBAC-MATRIX.md` header both state this exact command. |
| 2 | Routes gated by `require_role(...)` show the actual role tuple/constant name, not a generic placeholder | ✓ VERIFIED | Spot-checked `ai_copilot.py`, `assets.py`, etc. — rows show resolved, sorted role names (e.g. `chief_engineer, gm, housekeeping_supervisor`) plus `source` with line numbers. |
| 3 | Identity/self-service routes with no role gate show "none", not an omission | ✓ VERIFIED | `auth.py \| /v1/auth/me \| GET \| none` present. Genuinely open routes (e.g. `guest_requests.py PATCH /{request_id}` — read source, confirmed no role check) correctly remain `none`. |
| 4 | Running the generator twice against unchanged code produces byte-identical output | ✓ VERIFIED | Ran generator twice in sequence; `git diff --stat apps/api/RBAC-MATRIX.md` empty both times (committed file already matched, and second run vs first also empty). |
| 5 | CI (pytest) fails if RBAC-MATRIX.md drifts from what the generator would produce from current code | ✓ VERIFIED | `test_rbac_matrix_contract.py::test_rbac_matrix_matches_generated_output` asserts committed file == freshly generated string; passed. Additionally two classification spot-check tests (WR-04 fix) directly assert generator output for known routes, independent of the committed file, closing the "drift-only, not correctness" gap flagged in code review. |

**Score:** 5/5 truths verified

### Critical Bug Fix Verification (CR-01)

Independently re-derived (not trusting REVIEW-FIX.md's narrative) by reading router source directly:

- `apps/api/routers/guest_requests.py:213,300,334,375,590` — all have `if current_user.role not in {...}: raise HTTPException(...)` gates. Matrix rows 89, 90, 91, 92, 101 now show `role-restricted (inline, see source)` with the resolved gate condition and line number — previously (per 23-REVIEW.md) mislabeled `none`.
- `apps/api/routers/lost_found.py:170,218` — same pattern; matrix rows 163, 164 correctly show `role-restricted (inline, see source)`.
- `apps/api/routers/logbook.py:124-125` and `scheduling.py:278-280,311-313` — role check factored through intermediate booleans (`is_privileged`, `is_supervisor`); the taint-aware scan (`_expr_involves_role`, `_stmts_raise_http_exception`, `_collect_role_gated_ifs` — all present in `generate_rbac_matrix.py`) correctly follows these and labels rows 154, 155, 246, 247 as `role-restricted (inline, see source)`.
- Negative control confirmed: `tasks.py GET /v1/tasks` (row 276), which only filters a query by role and never raises 403, correctly remains `none` — the fix does not over-detect.
- `test_inline_role_gated_routes_are_not_labeled_none` (8 assertions) and `test_filtering_only_role_comparisons_remain_none` (3 assertions) both pass, directly encoding this distinction as a regression guard.

The fix holds under independent inspection — not just SUMMARY/REVIEW-FIX claims.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/scripts/generate_rbac_matrix.py` | AST-based introspection producing matrix rows + rendered Markdown | ✓ VERIFIED | Exists, contains `build_matrix_rows`, `parse_role_constants`, `parse_api_prefix`, `render_markdown`, plus CR-01/WR-01/WR-02/WR-03 fix functions (`_expr_involves_role`, `_stmts_raise_http_exception`, `_collect_role_gated_ifs`, `_escape_table_cell`). Uses only stdlib `ast`. Runs successfully from `apps/api/`. |
| `apps/api/RBAC-MATRIX.md` | Committed, generated route x role table | ✓ VERIFIED | Header table `| Router | Route | Method | Required Role(s) | Source |` present; 286 data rows + 1 header/separator = matches `grep -c "^| "` = 287; footer `**30 routers, 286 routes.**`; working tree clean (no uncommitted diff after regeneration). |
| `apps/api/tests/smoke/test_rbac_matrix_contract.py` | Drift guard: fails CI if committed file != freshly generated output | ✓ VERIFIED | Contains `test_rbac_matrix_matches_generated_output` plus two WR-04 classification spot-check tests. All 3 pass (`pytest tests/smoke/test_rbac_matrix_contract.py -v` → 3 passed). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `generate_rbac_matrix.py` | `core/roles.py` | AST parse of module-level tuple assignments | ✓ WIRED | `parse_role_constants` resolves `ALL_ROLES`, `MANAGER_ROLES`, `PROGRAM_MANAGER_ROLES`, `ALL_STAFF_ROLES` (Name-reference chain handled); confirmed via correctly-resolved role lists in generated output (no `(unresolved)` markers found in committed file). |
| `generate_rbac_matrix.py` | `apps/api/routers/*.py` | AST parse of decorators + `Depends(require_role(...))` + inline `current_user.role` checks | ✓ WIRED | 286 routes extracted across all 30 router files; inline-check taint scan confirmed working against `guest_requests.py`, `lost_found.py`, `logbook.py`, `scheduling.py`. |
| `test_rbac_matrix_contract.py` | `generate_rbac_matrix.py` | `importlib.util.spec_from_file_location` | ✓ WIRED | Test file loads the script this way (no `__init__.py` in `scripts/`); test executes successfully and imports `build_matrix_rows`/`render_markdown`/`parse_api_prefix` from the loaded module. |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|-----------------|
| RBAC-05: Generated `RBAC-MATRIX.md` listing every route with role(s), "none" for identity/self-service, introspected not hand-maintained | ✓ SATISFIED | None — verified above. |
| RBAC-06: Re-runnable script, checked into repo, invocable by developer/CI, reproduces same output on unchanged code | ✓ SATISFIED | None — determinism proven by two consecutive runs producing zero diff; command documented in both script docstring and `RBAC-MATRIX.md` header. |

(RBAC-07/RBAC-08 are scoped to Phase 24, not this phase.)

### Anti-Patterns Found

None blocking. No TODO/FIXME/placeholder markers found in the three key files. No stub implementations — all functions have real logic verified against router source.

### Human Verification Required

None. All success criteria are mechanically verifiable (script output, git diff, pytest results) and were directly re-executed during this verification, not merely inferred from summaries.

### Gaps Summary

No gaps. All 4 phase success criteria and both requirements (RBAC-05, RBAC-06) are satisfied:

1. Generator produces `apps/api/RBAC-MATRIX.md` covering all 30 routers / 286 routes with role(s) or "none".
2. Matrix is derived by AST introspection of live code (`require_role()` calls + `core/roles.py` constants) — spot-checked against known Phase 19 `programs.py` gates (per SUMMARY) and independently re-verified here against `guest_requests.py`, `lost_found.py`, `logbook.py`, `scheduling.py`, `tasks.py`, `auth.py` source.
3. Two consecutive runs produce byte-identical output (`git diff` empty both times).
4. Script is checked into `apps/api/scripts/generate_rbac_matrix.py`, invocable via one documented command.

The post-review CR-01 fix (inline `if current_user.role not in {...}: raise HTTPException(403,...)` gates previously mislabeled "none") was independently re-verified against live router source — not merely trusted from REVIEW-FIX.md — and holds correctly, including the negative control (filter-only `.role` comparisons still correctly render "none"). Full API test suite (521 tests, excluding the pre-existing, unrelated `test_management_roi.py` failures which predate this phase and touch a different router) passes with zero regressions.

---

*Verified: 2026-08-11*
*Verifier: Claude (gsd-verifier)*

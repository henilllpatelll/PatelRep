---
phase: 23-route-role-permission-matrix
fixed_at: 2026-08-11T00:00:00Z
review_path: .planning/phases/23-route-role-permission-matrix/23-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 23: Code Review Fix Report

**Fixed at:** 2026-08-11
**Source review:** .planning/phases/23-route-role-permission-matrix/23-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (1 critical, 4 warning)
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: Inline role-gated routes are mislabeled "none" (no role restriction) in the generated RBAC matrix

**Files modified:** `apps/api/scripts/generate_rbac_matrix.py`, `apps/api/RBAC-MATRIX.md`
**Commit:** `0d096e03`
**Applied fix:** Added a taint-aware AST scan (`_expr_involves_role`, `_stmts_raise_http_exception`, `_collect_role_gated_ifs`) to `generate_rbac_matrix.py`. It performs a small fixed-point taint pass to follow role checks factored into intermediate booleans (e.g. `is_supervisor = current_user.role in X; ...; if not is_own and not is_supervisor: raise HTTPException(...)`, used in `scheduling.py` and `logbook.py`), then flags any `if <cond involving .role>: raise HTTPException(...)` block as a real authorization gate. Routes with such a gate are now labeled `role-restricted (inline, see source)` instead of `none`, with the resolved `if` condition recorded in the `Source` column. Routes whose only `.role` comparison filters/scopes a query or response without denying access (`tasks.py:142`, `rooms.py:198`, `safety.py:84`) were verified to correctly remain `none`. Also updated the matrix's doc header to describe the new label. Regenerated `apps/api/RBAC-MATRIX.md` (30 routers, 286 routes) — 15 rows changed across `guest_requests.py`, `logbook.py`, `lost_found.py`, and `scheduling.py`, matching every route the review identified plus one additional genuine gate the review didn't enumerate (`guest_requests.py` `DELETE /{request_id}` at L590, same `SLA_POLICY_ROLES` pattern).

### WR-01: "N/A (not role-based)" fallback bucket conflates legitimate non-role auth with "no auth dependency found at all"

**Files modified:** `apps/api/scripts/generate_rbac_matrix.py`, `apps/api/RBAC-MATRIX.md`
**Commit:** `0ac8748f`
**Applied fix:** Split the true fallback case (no `require_role`, no `verify_cron`, no `get_current_user*` dependency detected) from the deliberate `verify_cron(...)` case. The fallback now renders as `UNVERIFIED (no auth dependency detected)` instead of reusing `N/A (not role-based)`. Regenerating revealed this was already a live instance, not just a hypothetical: `webhooks.py`'s four routes (Opera, Stripe, Twilio SMS/status) use hand-rolled HMAC/Twilio-SDK signature verification helpers, not a literal `verify_cron(...)` call, so they were already in the ambiguous fallback bucket. They remain legitimately authenticated (verified `_verify_twilio_signature` / `_verify_opera_signature` / stripe signature checks in `webhooks.py`) — the new label surfaces this pattern for human review rather than reporting a real defect. Doc header updated to explain the new label.

### WR-02: Role checks factored into a helper function called by the route are invisible to the inline-check scanner

**Files modified:** `apps/api/scripts/generate_rbac_matrix.py`
**Commit:** `922e7de7`
**Applied fix:** Per REVIEW.md's stated preference ("Document this limitation prominently in the script's module docstring, or extend the scanner"), added a prominent `KNOWN LIMITATION (WR-02, 23-REVIEW.md)` section to the script's module docstring explaining that both the inline `.role` scanner and the new `_collect_role_gated_ifs` gate detector only walk each route function's own AST subtree, so a role check factored into a separately-defined module-level helper is invisible and would silently regress to `none`. No such helper pattern exists in `apps/api/routers/` today, so this is documentation-only — confirmed no change to the generated `RBAC-MATRIX.md`.

### WR-03: Generated Markdown table cells are not escaped for `|` or embedded newlines

**Files modified:** `apps/api/scripts/generate_rbac_matrix.py`
**Commit:** `38d1d165`
**Applied fix:** Added `_escape_table_cell` (escapes `|` as `\|`, collapses `\r\n`/`\n`/`\r` to a single space) and applied it to every cell (`router`, `path`, `method`, `required_roles_display`, `source`) when rendering each Markdown table row in `render_markdown`. Confirmed no change to the current committed `RBAC-MATRIX.md`, since no existing router expression currently unparses to text containing `|` or a newline.

### WR-04: The CI drift guard only verifies sync, not classification correctness

**Files modified:** `apps/api/tests/smoke/test_rbac_matrix_contract.py`
**Commit:** `35e96161`
**Applied fix:** Added two targeted assertions independent of the committed matrix file, per REVIEW.md's suggestion: `test_inline_role_gated_routes_are_not_labeled_none` asserts that eight known inline-role-gated routes (`guest_requests.py`'s `/messages`, `/satisfaction`, `/recovery-actions`; `lost_found.py`'s custody-events POST and item PATCH; `logbook.py`'s entry PATCH; `scheduling.py`'s clock-in/clock-out) are never classified as `none`; `test_filtering_only_role_comparisons_remain_none` asserts the three known filter-only routes (`tasks.py`, `rooms.py`, `safety.py`) stay `none`, guarding against over-detection regressions in `_collect_role_gated_ifs`. A regression in the classification logic itself — not just drift from the generator's own prior output — now fails CI directly.

## Verification

- `python apps/api/scripts/generate_rbac_matrix.py` regenerated `apps/api/RBAC-MATRIX.md` after each fix that could affect output (CR-01, WR-01) and committed the result; WR-02/WR-03/WR-04 were confirmed to produce no diff to the committed matrix (documentation-only, no live escaping triggers, and test-only respectively).
- `pytest apps/api/tests/smoke/test_rbac_matrix_contract.py` passes after every commit (3 tests: 1 drift guard + 2 new WR-04 spot-checks).
- Full `apps/api/tests/` suite (excluding `tests/test_management_roi.py`, which fails at collection with a pre-existing `pydantic_core.ValidationError` for missing `supabase_service_role_key`/`supabase_jwt_secret`/`cron_secret` settings — a pre-existing, unrelated failure noted as predating this phase, not caused by these fixes) passes: 521 passed (519 pre-existing + 2 new WR-04 tests).

---

_Fixed: 2026-08-11_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

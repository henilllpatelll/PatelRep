---
phase: 23-route-role-permission-matrix
reviewed: 2026-08-11T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - apps/api/scripts/generate_rbac_matrix.py
  - apps/api/RBAC-MATRIX.md
  - apps/api/tests/smoke/test_rbac_matrix_contract.py
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 23: Code Review Report

**Reviewed:** 2026-08-11
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

I reviewed the RBAC matrix generator (`generate_rbac_matrix.py`), its generated output
(`RBAC-MATRIX.md`), and the CI drift guard (`test_rbac_matrix_contract.py`) that keeps them in
sync. I verified the extraction mechanics against the actual router source: all 286
`@router.<verb>(...)` decorators in `apps/api/routers/*.py` are accounted for in the matrix (no
routes silently dropped), all `require_role(...)` call sites resolve correctly (no
`(unresolved)` markers in the committed file), and the drift-guard test currently passes.

However, I traced the classification logic against the actual route bodies it claims to describe
and found the core "Required Role(s)" column is materially wrong for a meaningful subset of
routes: routes that enforce authorization via an inline `if current_user.role not in X: raise
HTTPException(403, ...)` check are labeled `none` ("any authenticated staff member, no role
restriction") instead of reflecting the real restriction. This isn't a cosmetic nit — the file's
own header text claims the tool distinguishes "route-level-gate" from "object-level-check"
(citing Phase 19's `RBAC-AUDIT.md` classification), but the implementation does not actually make
that distinction; it dumps every inline `.role` comparison into the same `none` bucket regardless
of whether the code path denies access (403) or merely scopes a query result set. Since this
artifact is explicitly positioned as a CI-enforced security audit document, this is a correctness
defect that undermines its stated purpose.

I also found several lower-severity robustness gaps in the generator (an ambiguous fallback
bucket for "no auth mechanism detected," inline checks only detected within the route function's
own AST subtree, no escaping of characters that could corrupt the generated Markdown table) and a
gap in the test's guarantee (it only detects *drift* between generator and committed file, not
*correctness* of the generator's classification — so a systematic bug like the one above will
never be caught by this test).

## Critical Issues

### CR-01: Inline role-gated routes are mislabeled "none" (no role restriction) in the generated RBAC matrix

**File:** `apps/api/scripts/generate_rbac_matrix.py:260-275` (classification logic), manifesting in `apps/api/RBAC-MATRIX.md` (e.g. lines 89-92, 96-98, 101, 154-155, 163-165)

**Issue:** When a route has no `require_role(...)` dependency but does have `Depends(get_current_user)`, the generator unconditionally sets `required_roles_display = "none"` (line 268), even when the function body contains an inline check that *denies access with a 403* to non-matching roles. The inline `.role` comparison is appended only as a free-text `source` annotation (line 274), not reflected in the `Required Role(s)` column.

I confirmed this is not a hypothetical edge case by reading the actual route bodies for every `| none | inline: ...|` row in the matrix. At least the following are genuine authorization gates (raise `HTTPException(403, ...)` on role mismatch), not query filters, yet are documented as "no role restriction":

- `apps/api/routers/guest_requests.py:213-214` — `POST /guest-requests/{id}/messages`: `if current_user.role not in MESSAGE_ROLES: raise HTTPException(403, ...)`. Matrix row (RBAC-MATRIX.md:89) says `none`.
- `apps/api/routers/guest_requests.py:300-301` — `GET /guest-requests/{id}/messages`: same pattern. Matrix row (RBAC-MATRIX.md:90) says `none`.
- `apps/api/routers/guest_requests.py:334-335` — `POST /guest-requests/{id}/satisfaction`: same pattern. Matrix row (RBAC-MATRIX.md:91) says `none`.
- `apps/api/routers/guest_requests.py:375-376` — `POST /guest-requests/{id}/recovery-actions`: conditionally requires `gm`/`front_desk` and raises 403. Matrix row (RBAC-MATRIX.md:92) says `none`.
- `apps/api/routers/lost_found.py:170-171, 218-219` — `POST .../custody-events` and `PATCH /lost-found/{id}`: `if current_user.role not in {"front_desk","housekeeping_supervisor","gm"}: raise HTTPException(403, ...)`. Matrix rows (RBAC-MATRIX.md:163,164) say `none`.
- `apps/api/routers/logbook.py:123-126` — `PATCH /logbook/entries/{id}`: raises 403 unless author-or-privileged-role. Matrix row (RBAC-MATRIX.md:154) says `none`.
- `apps/api/routers/scheduling.py:278-281, 311+` — clock-in/clock-out: raises 403 unless own-record-or-supervisor-role. Matrix rows (RBAC-MATRIX.md:246,247) say `none`.

By contrast, some other `none | inline:` rows genuinely are unrestricted at the route level and only apply role-based *data filtering* with no denial (e.g. `tasks.py:142` scopes a housekeeper's query to their own tasks but never 403s; `rooms.py:198` only gates a `force` flag; `safety.py:84` filters a response list). The generator treats both categories identically, so a reader cannot tell from the `Required Role(s)` column — the very column this document exists to provide — whether a route is truly open to any authenticated staff member or is actually role-restricted.

This is a security-documentation accuracy defect: a reviewer relying on this CI-enforced artifact (per its own description: "matching Phase 19's RBAC-AUDIT.md route-level-gate/object-level-check classification") would incorrectly conclude that write endpoints like guest message sending, lost & found custody transfer, and logbook entry edits have no role restriction, when in fact 4-6 of the 6 roles are excluded.

**Fix:** Distinguish denial-raising inline checks from filtering logic. At minimum, detect the common pattern `if <cond involving .role>: raise HTTPException(...)` (or `not in` gate combined with an early `raise`) within the function body and surface it as a real restriction (e.g. `role-restricted (inline, see source)` or resolve the actual role set) rather than `none`. For example:

```python
# In _extract_route_rows, when scanning for inline .role comparisons, also check whether the
# comparison node's enclosing `if` statement's body raises an HTTPException (a real gate) vs.
# performs a query/list operation (a filter), and set required_roles_display accordingly instead
# of leaving it "none" for gates.
```

If a full static distinction is impractical, at minimum stop asserting `none` for any route with an inline `.role` check that is embedded inside an `if ...: raise HTTPException(...)` block, and use a distinct label such as `see inline (role-restricted)` so the column is never affirmatively wrong.

## Warnings

### WR-01: "N/A (not role-based)" fallback bucket conflates legitimate non-role auth with "no auth dependency found at all"

**File:** `apps/api/scripts/generate_rbac_matrix.py:264-272`

**Issue:** A route falls into `required_roles_display = "N/A (not role-based)"` in two very different situations: (1) it calls `verify_cron(...)` (a real, deliberate non-role auth mechanism), or (2) the fallback `else` branch — no `require_role`, no `verify_cron`, and no `Depends(get_current_user*)` dependency at all, i.e. potentially an **unauthenticated route**. Both cases render identically in the matrix and are described identically in the doc header ("gated by a separate auth mechanism (cron secret, webhook signature) instead of a role"). Currently this only affects `webhooks.py` (correctly using their own signature verification) so the output is accurate today, but the tool provides no distinct signal if a future route is added to `routers/` without any auth dependency by mistake — it would silently blend into the same reassuring "N/A (not role-based)" bucket instead of being flagged as a potential missing-auth defect.

**Fix:** Split the fallback case from the `verify_cron` case, e.g. label routes with no detected auth dependency and no `verify_cron` call as `UNVERIFIED (no auth dependency detected)` rather than reusing the same label used for legitimate cron/webhook gating.

### WR-02: Role checks factored into a helper function called by the route are invisible to the inline-check scanner

**File:** `apps/api/scripts/generate_rbac_matrix.py:245-258`

**Issue:** `_extract_route_rows` finds inline `.role` comparisons via `ast.walk(node)`, where `node` is the route's own `FunctionDef`/`AsyncFunctionDef`. This only sees comparisons written directly in the route body (including nested closures defined inside it), not comparisons inside a separately-defined module-level helper function that the route calls (e.g. a shared `_authorize(current_user, ...)` helper). No such pattern exists in the codebase today, so this is not presently causing wrong output, but it is a latent gap: if a router is refactored to factor an inline role check like the ones in CR-01 into a shared helper (a natural DRY refactor given how many routers repeat the same `if current_user.role not in {...}: raise HTTPException(403, ...)` pattern), the generator would stop reporting the restriction entirely and silently regress to `none` with no `source` annotation, and the drift-guard test would still pass.

**Fix:** Document this limitation prominently in the script's module docstring, or extend the scanner to also inspect module-level helper functions referenced by name within the route body.

### WR-03: Generated Markdown table cells are not escaped for `|` or embedded newlines

**File:** `apps/api/scripts/generate_rbac_matrix.py:156, 346-349`

**Issue:** `required_roles_display` and `source` are built from `ast.unparse(...)` output (e.g. `_resolve_require_role_args`'s `else` branch at line 156, and the inline-note `desc = ast.unparse(sub)` at line 256) and inserted directly into a `|`-delimited Markdown table row with no escaping. No current router expression happens to contain a literal `|` or newline, but nothing prevents a future `require_role(...)` call or inline comparison from unparsing to text containing one (e.g. a set/dict literal is fine, but a bitwise-or expression or a multi-line f-string default would not be). If that happens, the emitted row silently corrupts the Markdown table (columns shift or the table breaks) with no error raised by the generator or the drift-guard test.

**Fix:** Escape `|` (`\|`) and collapse/strip newlines when building `required_roles_display` and `source` strings before joining them into table rows.

### WR-04: The CI drift guard only verifies sync, not classification correctness

**File:** `apps/api/tests/smoke/test_rbac_matrix_contract.py` (whole file)

**Issue:** `test_rbac_matrix_matches_generated_output` asserts that the committed `RBAC-MATRIX.md` equals a freshly-generated one. This only catches *drift* between the generator and the committed file — it cannot catch a systematic bug in the generator's own classification logic, because both sides of the comparison are produced by the same (potentially buggy) code. CR-01 is a concrete example: the generator has consistently mislabeled inline-gated routes as `none` since inception, the committed file matches the generator's output, and this test passes and will continue to pass indefinitely regardless of that defect. The test's docstring and the file's own description imply a stronger guarantee ("fails CI if this file ever goes stale relative to the code it describes") than it actually provides (staleness vs. correctness are different properties).

**Fix:** Not a blocking requirement, but consider adding a small number of targeted assertions that spot-check known role-gated-by-inline-check routes (e.g. assert that `guest_requests.py`'s `/messages` routes are not reported as `none`) so a regression in the classification logic itself is caught, not just drift from the generator's own prior output.

## Info

### IN-01: Redundant `parse_api_prefix` call in `main()`

**File:** `apps/api/scripts/generate_rbac_matrix.py:356-357`

**Issue:** `main()` calls `parse_api_prefix(MAIN_PATH)` directly, and then `build_matrix_rows(API_ROOT)` (line 357) parses `main.py`'s `PREFIX` a second time internally (line 303). Both parses read and re-parse the same file for the same value.

**Fix:** Have `build_matrix_rows` accept and reuse the already-parsed `api_prefix`, or have `main()` retrieve it once via `build_matrix_rows`'s return value plumbing.

### IN-02: `AnnAssign`-style constant declarations would be silently skipped

**File:** `apps/api/scripts/generate_rbac_matrix.py:56-67, 105-117`

**Issue:** `parse_role_constants` and `_resolve_router_constants` only match `ast.Assign` nodes. If `core/roles.py` or a router ever adopts typed constant declarations (e.g. `ALL_ROLES: tuple[str, ...] = (...)`, an `ast.AnnAssign` node), the constant would be silently omitted from the resolved map — any `require_role(*ALL_ROLES)` call site would then fall into the `(unresolved)` marker path rather than erroring loudly.

**Fix:** Low priority given current code style is 100% plain `Assign`, but worth a one-line comment noting the assumption, or handling `ast.AnnAssign` alongside `ast.Assign`.

### IN-03: Multi-target module-level assignments are silently skipped

**File:** `apps/api/scripts/generate_rbac_matrix.py:59-60, 108-109`

**Issue:** Both constant-resolution functions bail out (`if len(node.targets) != 1: continue`) on chained assignments like `A = B = ("gm",)`. Not used anywhere in the current codebase, but if introduced it would silently drop both `A` and `B` from the resolved constants map with no warning, again routing any dependent `require_role(*A)` call to the `(unresolved)` fallback rather than failing the build.

**Fix:** No action required unless this pattern is adopted; flagged for awareness only.

---

_Reviewed: 2026-08-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

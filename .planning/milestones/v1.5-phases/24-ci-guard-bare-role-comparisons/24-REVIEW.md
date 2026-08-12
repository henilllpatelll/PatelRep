---
phase: 24-ci-guard-bare-role-comparisons
reviewed: 2026-08-11T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - apps/api/scripts/check_bare_role_comparisons.py
  - apps/api/rbac_bare_comparison_allowlist.json
  - apps/api/tests/smoke/test_bare_role_comparison_guard.py
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: issues_found
---

# Phase 24: Code Review Report

**Reviewed:** 2026-08-11
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Reviewed the CI guard that fails the build when a router file adds a new bare
`current_user.role` comparison not sourced from `require_role()` or an imported
`core/roles.py` constant. The AST-walking detector itself (`find_bare_role_comparisons`,
`imported_core_roles_names`) is sound and correctly reproduces all 25 pre-existing
bare comparisons against the committed allowlist (verified empirically — 25 raw
findings, 0 unlisted, `pytest` passes).

However, the allowlist-matching mechanism has a critical correctness gap: it keys
matches on `(router, code)` text only, completely ignoring the `line` field that is
stored in every allowlist entry. This was verified empirically (see CR-01) — a brand
new, never-reviewed bare role check added anywhere in an already-partially-allowlisted
router file is silently accepted by the guard as long as its `ast.unparse()` text is
identical to an existing entry's text. Given how common patterns like
`current_user.role == 'gm'` and `current_user.role not in MESSAGE_ROLES` are, this is a
realistic bypass of the exact guarantee this phase exists to provide (per the task
brief: "fails the build when a router file adds a new bare `current_user.role`
comparison"). This mirrors the class of bug the Phase 23 review caught (a
classification/matching gap that produces false negatives, not false positives).

There is also no unit-level test coverage of the detector's own classification logic
(only one integration assertion against the live codebase), so a regression of this
kind would not be caught by the test suite itself.

## Critical Issues

### CR-01: Allowlist matching ignores line number, letting new duplicate-text bare comparisons bypass the guard

**File:** `apps/api/scripts/check_bare_role_comparisons.py:115-142` (also `apps/api/rbac_bare_comparison_allowlist.json`)

**Issue:** `load_allowlist()` builds its match set from `(entry["router"], entry["code"])`
only — the `line` field recorded in every JSON entry is never read for matching
purposes:

```python
def load_allowlist(allowlist_path: Path) -> set[tuple[str, str]]:
    ...
    return {(entry["router"], entry["code"]) for entry in data.get("entries", [])}
```

`find_violations()` builds its comparison key the same way:

```python
key = (violation["router"], violation["code"])
if key not in allowlist:
    violations.append(violation)
```

This means the guard treats "this exact router file already has an allowlisted bare
comparison with this exact source text, anywhere in the file" as equivalent to "this
specific occurrence at this specific line was reviewed." Any **new**, unreviewed bare
role comparison added later in the same router file, whose `ast.unparse()` text happens
to match text already in the allowlist, is silently treated as covered and never
flagged.

This was verified empirically: appending a brand-new function to a copy of
`guest_requests.py` containing only:
```python
def _new_totally_unreviewed_check(current_user):
    if current_user.role not in MESSAGE_ROLES:
        raise Exception("nope")
```
produces **zero** new violations from `find_violations()` — the new, never-reviewed
line is absorbed by the existing `("guest_requests.py", "current_user.role not in
MESSAGE_ROLES")` entry (already present 3x in the allowlist for lines 213/300/334).
The same applies to any router with a duplicated pattern, e.g. `rooms.py`'s
`current_user.role == 'gm'` (line 198) or `work_orders.py`'s `current_user.role ==
'engineer'` (lines 66, 193) — a new bare check with identical text added anywhere else
in those files passes CI unreviewed. This directly defeats the stated purpose of the
guard ("fails CI if a router file... contains a 'bare' role comparison... unless that
exact comparison is already listed").

**Fix:** Match on occurrence *count* per `(router, code)` key rather than presence,
so line-number drift from unrelated edits is still tolerated but genuinely new
additions are caught:

```python
def load_allowlist(allowlist_path: Path) -> dict[tuple[str, str], int]:
    """Return a count of allowlisted occurrences per (router, code) key."""
    if not allowlist_path.exists():
        return {}
    data = json.loads(allowlist_path.read_text(encoding="utf-8"))
    counts: dict[tuple[str, str], int] = {}
    for entry in data.get("entries", []):
        key = (entry["router"], entry["code"])
        counts[key] = counts.get(key, 0) + 1
    return counts


def find_violations(api_root: Path, allowlist_path: Path) -> list[dict]:
    ...
    allowlist_counts = load_allowlist(allowlist_path)
    seen_counts: dict[tuple[str, str], int] = {}

    violations: list[dict] = []
    for router_path in router_files:
        for violation in find_bare_role_comparisons(router_path, core_roles):
            key = (violation["router"], violation["code"])
            seen_counts[key] = seen_counts.get(key, 0) + 1
            if seen_counts[key] > allowlist_counts.get(key, 0):
                violations.append(violation)
    ...
```

This preserves resilience to line-number churn from unrelated edits (the original
design goal implied by matching on text) while ensuring the Nth+1 occurrence of a
previously-allowlisted pattern is still flagged as new and unreviewed.

## Warnings

### WR-01: No unit/fixture-level tests for the detector's own classification logic

**File:** `apps/api/tests/smoke/test_bare_role_comparison_guard.py:35-48`

**Issue:** The only test in this file asserts `find_violations()` returns `[]` against
the live, already-reviewed codebase. There is no synthetic/fixture-based test that
exercises the detector's logic directly — e.g. confirming that a new bare comparison
in a temp file is detected, that an aliased `from core.roles import X as Y` import is
recognized, that `require_role(...)` calls are correctly ignored, or that the
allowlist-matching semantics behave as intended (see CR-01). Phase 23's equivalent
guard (`test_rbac_matrix_contract.py`) has dedicated classification tests (e.g.
`test_inline_role_gated_routes_are_not_labeled_none`) for exactly this reason. Without
this, a regression in the detector's own logic — such as CR-01 — has zero test
coverage and can ship silently as long as the current codebase's 25 findings still
match.

**Fix:** Add fixture-based unit tests that write small synthetic router-like files
(or `ast.parse` string snippets) and assert `find_bare_role_comparisons` /
`find_violations` classify them correctly, including a regression test for CR-01: two
identical bare comparisons in the same file, only one allowlisted, should yield exactly
one violation.

### WR-02: Allowlist matching depends on `ast.unparse()` output being byte-stable across Python versions

**File:** `apps/api/scripts/check_bare_role_comparisons.py:109`, `apps/api/rbac_bare_comparison_allowlist.json`

**Issue:** Allowlist entries are matched via exact string equality against
`ast.unparse(node)` output (e.g. quote style, spacing, set vs. tuple literal
rendering). `ast.unparse()`'s exact formatting is not part of Python's stable public
contract across minor/major versions. If a future Python upgrade changes `unparse()`
formatting (e.g. quoting rules), all 25 existing allowlist entries could stop matching
simultaneously, failing CI for every router file at once — a false-positive outage
unrelated to any actual code drift, requiring a bulk allowlist regeneration.

**Fix:** Either (a) document this fragility explicitly and provide a
`--regenerate-allowlist` helper mode that rewrites `code` values from current
`ast.unparse()` output for auditor sign-off, or (b) match on a more stable
representation (e.g. normalized `ast.dump()` structural signature) rather than exact
unparsed source text.

### WR-03: Duplicate allowlist entries create a false impression of per-occurrence coverage

**File:** `apps/api/rbac_bare_comparison_allowlist.json:9-26, 39-50, 63-79, 117-128`

**Issue:** Several allowlist entries share an identical `(router, code)` pair within
the same file — e.g. `guest_requests.py`'s `current_user.role not in MESSAGE_ROLES`
(lines 213, 300, 334) and `current_user.role not in SLA_POLICY_ROLES` (lines 444, 476,
590), and `logbook.py`'s `current_user.role in ('gm', 'housekeeping_supervisor',
'engineer')` (lines 124, 176). Given `load_allowlist()` collapses to a
`set[(router, code)]` (see CR-01), these duplicate entries are functionally redundant
for guard purposes — only one is needed to "cover" all current and (per CR-01) future
occurrences with identical text. This is not itself dangerous, but it obscures the
guard's real matching granularity from anyone reading the JSON file expecting each
`line` to correspond to an individually-verified guarantee.

**Fix:** Once CR-01's count-based matching is implemented, these duplicate entries
become meaningfully load-bearing (each one legitimately raises the allowed-occurrence
count by one). Until then, add a code comment or README note in the allowlist file
clarifying that `line` is documentation-only and matching is per-router-per-text.

## Info

### IN-01: Docstring's "KNOWN LIMITATION" section omits the line-agnostic matching behavior

**File:** `apps/api/scripts/check_bare_role_comparisons.py:31-34`

**Issue:** The module docstring documents one known limitation (LHS-only `.role`
detection) but does not mention that allowlist matching ignores line number and matches
purely on `(router, exact unparsed text)`, which is the more consequential limitation
(see CR-01).

**Fix:** Add a paragraph to the "KNOWN LIMITATION" section documenting the matching
semantics once CR-01 is resolved (or, if resolved via the count-based approach in
CR-01, describe that explicitly so future maintainers understand why duplicate entries
are load-bearing).

---

_Reviewed: 2026-08-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

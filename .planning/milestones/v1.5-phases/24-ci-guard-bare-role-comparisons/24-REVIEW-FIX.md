---
phase: 24-ci-guard-bare-role-comparisons
fixed_at: 2026-08-11T23:59:00Z
review_path: .planning/phases/24-ci-guard-bare-role-comparisons/24-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 24: Code Review Fix Report

**Fixed at:** 2026-08-11
**Source review:** .planning/phases/24-ci-guard-bare-role-comparisons/24-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (1 critical, 3 warning)
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: Allowlist matching ignores line number, letting new duplicate-text bare comparisons bypass the guard

**Files modified:** `apps/api/scripts/check_bare_role_comparisons.py`
**Commit:** 41ceadac
**Applied fix:** Changed `load_allowlist()` from returning a `set[(router, code)]` to a `dict[(router, code), int]` occurrence count. `find_violations()` now tracks a running `seen_counts` per key during the live scan and flags any occurrence beyond the allowlisted count as a violation, rather than doing simple set-membership. This preserves line-number-agnostic matching (tolerant of unrelated edits shifting line numbers) while closing the evasion gap where a new, unreviewed bare comparison with duplicate text was silently absorbed by an existing allowlist entry.

Verification performed:
- `pytest tests/smoke/test_bare_role_comparison_guard.py` still passes against the current, unmodified codebase (25 allowlisted comparisons, 0 violations).
- Synthetic duplicate-text test: appended a second, unreviewed `current_user.role not in MESSAGE_ROLES` check to `guest_requests.py` (already allowlisted 3x) — the guard now correctly reports it as 1 new violation (previously would have reported 0). Reverted cleanly; confirmed `git status` clean after revert and 0 violations restored.
- Full `apps/api/tests/` suite passes (526 passed, 38 deselected `test_management_roi.py` pre-existing unrelated failures excluded via `--deselect`).

### WR-01: No unit/fixture-level tests for the detector's own classification logic

**Files modified:** `apps/api/tests/smoke/test_bare_role_comparison_guard.py`
**Commit:** 77248607
**Applied fix:** Added 4 fixture-based unit tests using `tmp_path`: (1) a new bare comparison in a synthetic router file is detected by `find_bare_role_comparisons()`; (2) an aliased `from core.roles import X as Y` import is correctly recognized and not flagged; (3) `require_role(...)` calls are confirmed to never be flagged; (4) a CR-01 regression test — two identical bare comparisons in one synthetic router file, only one allowlisted, must yield exactly one violation via `find_violations()`. All 5 tests in the file (1 pre-existing + 4 new) pass.

### WR-02: Allowlist matching depends on `ast.unparse()` output being byte-stable across Python versions

**Files modified:** `apps/api/scripts/check_bare_role_comparisons.py`
**Commit:** fd908668
**Applied fix:** Went with option (a) from the review (documentation + regeneration helper, chosen over a structural `ast.dump()` signature rewrite to avoid an invasive, harder-to-audit change to all 25 existing entries' human-readable `code` text). Added a "KNOWN LIMITATION" paragraph to the module docstring explaining the fragility and pointing at the new mode. Added `regenerate_allowlist()` and wired it to `python check_bare_role_comparisons.py --regenerate-allowlist`, which rewrites each entry's `code` field from current `ast.unparse()` output, correlating old entries to live findings by `(router, line)` (not by text, since text is exactly what's unstable) and preserving `reason`/`line`/order. Smoke-tested against the real allowlist file (copied, ran `--regenerate-allowlist`, diffed against backup): 0 entries needed changes, output byte-identical to the original, confirming no accidental corruption. Also confirmed it preserves the new WR-03 top-level `_matching_semantics` key on a subsequent run.

### WR-03: Duplicate allowlist entries create a false impression of per-occurrence coverage

**Files modified:** `apps/api/rbac_bare_comparison_allowlist.json`
**Commit:** abdbc75e
**Applied fix:** Since CR-01 was fixed with count-based matching, the duplicate `(router, code)` entries (e.g. `guest_requests.py`'s `MESSAGE_ROLES`/`SLA_POLICY_ROLES` rows, `logbook.py`'s role-tuple row) are now genuinely load-bearing rather than redundant. Added a top-level `_matching_semantics` documentation key to the allowlist JSON explaining that `line` is documentation-only, matching is per-occurrence-count keyed on `(router, code)`, and duplicate entries each legitimately raise the allowed-occurrence count by one — so a future maintainer doesn't mistake them for accidental duplication and collapse them. Verified the JSON remains valid (`node -e "JSON.parse(...)"`) and that `load_allowlist()`/`find_violations()`/`regenerate_allowlist()` all continue to work correctly with the new top-level key present (extra keys are safely ignored by `data.get("entries", [])` and preserved by `regenerate_allowlist()`'s write-back).

## Skipped Issues

None — all 4 in-scope findings were fixed.

---

_Fixed: 2026-08-11_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

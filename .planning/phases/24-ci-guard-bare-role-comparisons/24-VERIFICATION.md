---
phase: 24-ci-guard-bare-role-comparisons
verified: 2026-08-11T00:00:00Z
status: passed
score: 5/5 must-haves verified
---

# Phase 24: CI Guard Against New Bare Role Comparisons Verification Report

**Phase Goal:** A router file that adds a new bare role-comparison outside `require_role()`/an imported `core/roles.py` constant fails CI, while the pre-existing intentional inline checks the Phase 19 audit already confirmed correct continue to pass via an explicit, documented allowlist.
**Verified:** 2026-08-11
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `pytest tests/smoke/` (CI's exact command) passes cleanly against the current codebase, zero false positives | ✓ VERIFIED | Ran `.venv/Scripts/python.exe -m pytest tests/smoke/test_bare_role_comparison_guard.py -v`: all 5 tests pass, including `test_no_unlisted_bare_role_comparisons`. Standalone `check_bare_role_comparisons.py` also prints "No unlisted bare role comparisons found." and exits 0. |
| 2 | A new bare `current_user.role` comparison not sourced from `require_role()`/an imported `core/roles.py` constant and not allowlisted makes the test fail, naming the file/comparison | ✓ VERIFIED | Independently injected `if current_user.role == "phase24_verify_drift_test": pass` into `apps/api/routers/tasks.py`; re-ran the guard test — it FAILED with `tasks.py:145: current_user.role == 'phase24_verify_drift_test'` in the assertion message. |
| 3 | A developer can open one checked-in file and see every allowlisted bare comparison plus a one-line reason — no blanket per-file exclusions | ✓ VERIFIED | `apps/api/rbac_bare_comparison_allowlist.json` exists, checked in, 25 entries across 10 router files (clean_sessions x1, guest_requests x9, late_checkout x1, logbook x2, lost_found x3, rooms x3, scheduling x2, tasks x1, work_orders x3), each with a specific `reason` field. No file-level exclusion mechanism exists in the detector — matching is per `(router, code)` occurrence. |
| 4 | Comparisons sourced from an imported `core/roles.py` constant (e.g. `safety.py`'s `MANAGER_ROLES`) are never flagged, matching RBAC-07's carve-out | ✓ VERIFIED | Read `safety.py` lines 13 (`from core.roles import MANAGER_ROLES`) and 84 (`current_user.role not in MANAGER_ROLES`). `imported_core_roles_names()` correctly captures `MANAGER_ROLES` as imported-from-core.roles, so the comparator is skipped in `find_bare_role_comparisons`. Confirmed no `safety.py` entry exists in the allowlist (grep for `"router": "safety.py"` returns nothing), and the guard still passes — proving exclusion is via import-provenance, not a missing/blanket rule. |
| 5 | Reverting a deliberately-introduced bare comparison restores an all-green run with a clean working tree | ✓ VERIFIED | `git checkout -- apps/api/routers/tasks.py`, then re-ran `test_no_unlisted_bare_role_comparisons` — PASSED. `git status --short apps/api/routers/tasks.py` printed nothing (clean tree), confirmed both immediately after revert and again after the full test-suite run. |

**Score:** 5/5 truths verified

### CR-01 Fix Independent Verification (per task instructions)

The Phase 24 code review (`24-REVIEW.md`) found a critical bug: `load_allowlist()`/`find_violations()` originally matched on `(router, code)` **set membership**, so a genuinely new bare comparison whose text duplicated an already-allowlisted one elsewhere in the same file would silently evade detection. This was reportedly fixed in commit `41ceadac` via per-`(router, code)` **occurrence-count** matching.

Independent verification performed (not just trusting `24-REVIEW-FIX.md`):

1. **Read the current implementation** (`apps/api/scripts/check_bare_role_comparisons.py`, lines 127–173): `load_allowlist()` now returns `dict[tuple[str, str], int]` — a count of allowlisted occurrences per `(router, code)` key (line 141–145). `find_violations()` maintains a `seen_counts` dict incremented per live occurrence during a single forward scan, and flags a violation only when `seen_counts[key] > allowlist_counts.get(key, 0)` (line 169). This logic is sound: the Nth live occurrence of a given text is only covered if the allowlist has at least N entries for that key, so duplicate-text-but-genuinely-new occurrences beyond the allowlisted count are correctly caught, while occurrences within the allowlisted count remain tolerant of line-number drift.
2. **Confirmed commit `41ceadac`** exists in git history with message "fix(24): CR-01 match allowlist by occurrence count, not text presence."
3. **Wrote and ran my own independent synthetic test** (not reusing the one already in the test file), separate from the existing `test_duplicate_text_only_one_allowlisted_flags_the_new_occurrence`: 3 identical bare comparisons (`current_user.role == 'gm'`) in one synthetic router file, only 2 allowlisted. Result: `find_violations()` returned exactly 1 violation, at line 10 (the 3rd/newest occurrence) — confirming the counting logic correctly identifies the "extra" occurrence beyond the allowlisted count, not just presence/absence of the text.
4. **Confirmed the existing regression test** `test_duplicate_text_only_one_allowlisted_flags_the_new_occurrence` in `test_bare_role_comparison_guard.py` (2 identical occurrences, 1 allowlisted → expects exactly 1 violation) passes.
5. **Confirmed clean revert**: `git status --short apps/api/` shows no diff after all deliberate-drift and synthetic testing performed during this verification.

Conclusion: the CR-01 fix holds up under independent scrutiny — the counting logic is correct, not merely claimed-correct.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/scripts/check_bare_role_comparisons.py` | Whole-router-module AST scan, core.roles-import provenance, allowlist matching, reuses `generate_rbac_matrix.py`'s `parse_role_constants` | ✓ VERIFIED | Contains `find_bare_role_comparisons`, `imported_core_roles_names`, `load_allowlist`, `find_violations`, `regenerate_allowlist`, `main()`. Loads `generate_rbac_matrix.py` via `importlib.util.spec_from_file_location` (line 64–68) and calls its `parse_role_constants` (line 157). `ast.walk(tree)` walks the whole module, not just decorated functions. |
| `apps/api/rbac_bare_comparison_allowlist.json` | Reviewable, per-entry-reasoned allowlist, keyed by router filename + exact comparison text | ✓ VERIFIED | 25 entries, `{"entries": [...]}` shape plus a `_matching_semantics` documentation key explaining the count-based matching. Every entry has `router`, `line`, `code`, `reason`. |
| `apps/api/tests/smoke/test_bare_role_comparison_guard.py` | CI enforcement, fails `pytest tests/smoke/` on any un-allowlisted bare comparison | ✓ VERIFIED | Contains `test_no_unlisted_bare_role_comparisons` plus 4 additional fixture-based unit tests (WR-01 fix) covering detection, aliased-import recognition, `require_role()` exclusion, and the CR-01 duplicate-text regression. All 5 tests pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `test_bare_role_comparison_guard.py` | `check_bare_role_comparisons.py` | `importlib.util.spec_from_file_location` | ✓ WIRED | Lines 29–33 of the test file load the script module and call `find_violations` directly. |
| `check_bare_role_comparisons.py` | `generate_rbac_matrix.py` | `parse_role_constants` reuse via importlib | ✓ WIRED | Lines 63–68 load the sibling script; line 157 calls `generate_rbac_matrix.parse_role_constants(...)`. No re-derivation of core.roles parsing. |
| `check_bare_role_comparisons.py` | `rbac_bare_comparison_allowlist.json` | `json.load` + `(router, code)` occurrence-count matching | ✓ WIRED | `load_allowlist()` reads the file and builds per-key counts (lines 127–145); `find_violations()` consumes those counts against a live per-key running count (lines 148–173). |
| `.github/workflows/ci.yml` | `apps/api/tests/smoke/` | existing `pytest tests/smoke/ -v --tb=short` step | ✓ WIRED | Confirmed line 93 of `ci.yml` runs `cd apps/api && python -m pytest tests/smoke/ -v --tb=short` — no workflow changes needed, new test picked up automatically by directory convention. |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|-----------------|
| RBAC-07 (CI check fails build on new bare role-comparison outside `require_role()`/imported core.roles constant) | ✓ SATISFIED | Deliberate-drift proof confirms this functionally; not blocked. Note: `.planning/REQUIREMENTS.md` line 14 still shows the checkbox unticked (`- [ ]`) — a documentation-tracking artifact, not a functional gap. |
| RBAC-08 (pre-existing intentional inline checks handled via explicit documented allowlist, not silent file-wide exclusion) | ✓ SATISFIED | `lost_found.py`'s custody-state set is allowlisted (3 entries with specific reasons); `safety.py`'s self-service exception passes via import-provenance carve-out, confirmed not present in the allowlist. Note: `.planning/REQUIREMENTS.md` line 15 checkbox also unticked — same documentation-tracking note as above. |

Both requirements' checkboxes in `.planning/REQUIREMENTS.md` (lines 14–15, 35–36) remain marked "Pending" / unticked despite the functional work being complete and verified — this is a documentation bookkeeping gap, not a code gap, and does not affect the `status: passed` determination for this phase's goal (which concerns the CI guard's actual behavior, not requirement-tracker checkbox hygiene).

### Anti-Patterns Found

None. No TODO/FIXME/placeholder patterns, no empty implementations, no console-log-only stubs in any of the three phase-created files.

### Human Verification Required

None. All success criteria are mechanically verifiable via AST behavior, pytest results, and git state — no visual, real-time, or external-service-dependent behavior involved.

### Gaps Summary

No gaps found. All 5 observable truths verified directly against the codebase (not merely trusting SUMMARY.md/REVIEW-FIX.md claims):

- Ran the actual `pytest tests/smoke/test_bare_role_comparison_guard.py` (5/5 pass) and the standalone script (0 violations, exit-equivalent "No unlisted bare role comparisons found.").
- Independently reproduced the deliberate-drift proof from scratch (not re-running the SUMMARY's exact same edit) — injected a differently-named bare comparison into `tasks.py`, confirmed failure with correct file/line/text, reverted, confirmed pass and clean `git status`.
- Independently read and re-derived the CR-01 fix's correctness by tracing the count-based matching logic in `find_violations`/`load_allowlist`, then wrote and ran a fresh synthetic test (3 occurrences/2 allowlisted, not reusing the existing 2-occurrence/1-allowlisted test already in the repo) to confirm the counting logic generalizes correctly.
- Read `safety.py` source directly to confirm `MANAGER_ROLES` is imported from `core.roles` and that line 84 is genuinely excluded via the import-provenance carve-out (grep confirms no `safety.py` entry in the allowlist JSON).
- Confirmed allowlist has exactly 25 entries across exactly 10 router files by direct enumeration of the JSON.
- Ran the full `apps/api/tests/` suite: 561 passed, 3 failed — the 3 failures are `test_management_roi.py::test_roi_downtime_revenue_uses_tenant_adr`, `test_roi_housekeeping_efficiency_pairs_in_progress_to_clean`, `test_roi_pm_compliance_reads_pm_deferrals_table`, matching exactly the pre-existing, documented, unrelated failures cited in both `24-01-SUMMARY.md` and `24-REVIEW-FIX.md`.
- Confirmed `.github/workflows/ci.yml` line 93 runs `pytest tests/smoke/ -v --tb=short`, so the new test is picked up automatically without workflow changes.
- Confirmed a fully clean `git status --short apps/api/` at the end of all verification activity — no residual diff from any of the deliberate-drift or synthetic testing performed during this verification pass.

---

*Verified: 2026-08-11*
*Verifier: Claude (gsd-verifier)*

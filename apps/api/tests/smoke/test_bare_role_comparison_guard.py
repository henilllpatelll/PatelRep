"""
Bare-role-comparison drift guard (RBAC-07): fails CI if a router file in
apps/api/routers/ contains a "bare" role comparison -- `current_user.role == "..."`,
`in {...}`, `not in {...}`, etc. -- that is neither a `require_role(...)` call
(route-level gates are already tracked by Phase 23's RBAC-MATRIX drift guard) nor
sourced from a constant imported from `apps/api/core/roles.py`, unless that exact
comparison is already listed -- with a stated reason -- in
apps/api/rbac_bare_comparison_allowlist.json (RBAC-08).

This test MUST fail the moment a new bare role comparison is introduced without
either routing it through require_role()/an imported core/roles.py constant, or
adding a reasoned allowlist entry. Run:
    python apps/api/scripts/check_bare_role_comparisons.py
to see the same violation list this test asserts against.

apps/api/scripts/ has no __init__.py (it's a folder of standalone CLI scripts, not
a package), so the detector module is loaded via importlib.util.spec_from_file_location,
same pattern as test_rbac_matrix_contract.py.
"""

import importlib.util
from pathlib import Path

_API_ROOT = Path(__file__).parents[2]
_SCRIPT_PATH = _API_ROOT / "scripts" / "check_bare_role_comparisons.py"
_ALLOWLIST_PATH = _API_ROOT / "rbac_bare_comparison_allowlist.json"

_spec = importlib.util.spec_from_file_location(
    "check_bare_role_comparisons", _SCRIPT_PATH
)
check_bare_role_comparisons = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_bare_role_comparisons)


def test_no_unlisted_bare_role_comparisons():
    violations = check_bare_role_comparisons.find_violations(_API_ROOT, _ALLOWLIST_PATH)

    assert violations == [], (
        "Found bare role comparison(s) not covered by require_role()/an imported "
        "core/roles.py constant, and not listed in "
        "apps/api/rbac_bare_comparison_allowlist.json:\n"
        + "\n".join(
            f"  {v['router']}:{v['line']}: {v['code']}" for v in violations
        )
        + "\n\nEither route the check through require_role()/an imported "
        "core/roles.py constant, or add a reasoned entry to "
        "apps/api/rbac_bare_comparison_allowlist.json."
    )

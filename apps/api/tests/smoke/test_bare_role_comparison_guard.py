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
import json
from pathlib import Path

_API_ROOT = Path(__file__).parents[2]
_SCRIPT_PATH = _API_ROOT / "scripts" / "check_bare_role_comparisons.py"
_ALLOWLIST_PATH = _API_ROOT / "rbac_bare_comparison_allowlist.json"

_spec = importlib.util.spec_from_file_location(
    "check_bare_role_comparisons", _SCRIPT_PATH
)
check_bare_role_comparisons = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_bare_role_comparisons)

_CORE_ROLES = {"MANAGER_ROLES": ("gm", "housekeeping_supervisor", "engineer")}


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


# --- Fixture-based unit tests for the detector's own classification logic ---
# (WR-01: the test above only exercises find_violations() against the live,
# already-reviewed codebase; these exercise find_bare_role_comparisons() /
# find_violations() directly against synthetic snippets, independent of what the
# real router files currently contain.)


def _write_router(tmp_path: Path, name: str, source: str) -> Path:
    routers_dir = tmp_path / "routers"
    routers_dir.mkdir(exist_ok=True)
    router_path = routers_dir / name
    router_path.write_text(source, encoding="utf-8")
    return router_path


def test_new_bare_comparison_in_temp_file_is_detected(tmp_path):
    router_path = _write_router(
        tmp_path,
        "sample_router.py",
        "def handler(current_user):\n"
        "    if current_user.role == 'gm':\n"
        "        return True\n",
    )

    violations = check_bare_role_comparisons.find_bare_role_comparisons(
        router_path, _CORE_ROLES
    )

    assert len(violations) == 1
    assert violations[0]["code"] == "current_user.role == 'gm'"
    assert violations[0]["router"] == "sample_router.py"


def test_aliased_core_roles_import_is_recognized(tmp_path):
    router_path = _write_router(
        tmp_path,
        "sample_router.py",
        "from core.roles import MANAGER_ROLES as MGMT_ROLES\n\n"
        "def handler(current_user):\n"
        "    if current_user.role in MGMT_ROLES:\n"
        "        return True\n",
    )

    violations = check_bare_role_comparisons.find_bare_role_comparisons(
        router_path, _CORE_ROLES
    )

    assert violations == [], (
        "A comparison against an aliased import of a core/roles.py constant must "
        "not be flagged as a bare comparison."
    )


def test_require_role_calls_are_not_flagged(tmp_path):
    router_path = _write_router(
        tmp_path,
        "sample_router.py",
        "@router.post('/thing')\n"
        "@require_role('gm', 'engineer')\n"
        "def handler(current_user):\n"
        "    return True\n",
    )

    violations = check_bare_role_comparisons.find_bare_role_comparisons(
        router_path, _CORE_ROLES
    )

    assert violations == [], (
        "require_role(...) calls are route-level gates tracked separately by "
        "Phase 23's guard and must never be flagged as bare comparisons."
    )


def test_duplicate_text_only_one_allowlisted_flags_the_new_occurrence(tmp_path):
    """Regression test for CR-01: two identical bare comparisons in the same file,
    only one allowlisted, must yield exactly one violation -- not zero."""
    core_dir = tmp_path / "core"
    core_dir.mkdir()
    (core_dir / "roles.py").write_text(
        "MANAGER_ROLES = ('gm', 'housekeeping_supervisor', 'engineer')\n",
        encoding="utf-8",
    )
    _write_router(
        tmp_path,
        "sample_router.py",
        "def first_check(current_user):\n"
        "    if current_user.role not in MESSAGE_ROLES:\n"
        "        raise Exception('nope')\n\n"
        "def second_unreviewed_check(current_user):\n"
        "    if current_user.role not in MESSAGE_ROLES:\n"
        "        raise Exception('nope')\n",
    )
    allowlist_path = tmp_path / "allowlist.json"
    allowlist_path.write_text(
        json.dumps(
            {
                "entries": [
                    {
                        "router": "sample_router.py",
                        "line": 2,
                        "code": "current_user.role not in MESSAGE_ROLES",
                        "reason": "Only the first occurrence has been reviewed.",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    violations = check_bare_role_comparisons.find_violations(tmp_path, allowlist_path)

    assert len(violations) == 1, (
        "Exactly one occurrence of the duplicated text is allowlisted; the second, "
        "unreviewed occurrence must still be flagged (CR-01 regression)."
    )
    assert violations[0]["code"] == "current_user.role not in MESSAGE_ROLES"

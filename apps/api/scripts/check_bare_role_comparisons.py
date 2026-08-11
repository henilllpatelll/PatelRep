"""Detect "bare" role comparisons in apps/api/routers/*.py -- i.e. a `<name>.role ==
"..."` / `in {...}` / `not in {...}` comparison that is neither a `require_role(...)`
route-level gate (those are already tracked by Phase 23's `generate_rbac_matrix.py`)
nor sourced from a constant imported from `apps/api/core/roles.py` (the canonical
single source of truth for role-group constants).

Run this in two ways:

1. Standalone report: `python apps/api/scripts/check_bare_role_comparisons.py`
   Prints every un-allowlisted bare comparison found and exits 1 if any exist, 0
   otherwise. Reads `apps/api/rbac_bare_comparison_allowlist.json` if present; a
   missing allowlist file is treated as an empty allowlist (everything is flagged),
   not an error.

2. As the engine behind `apps/api/tests/smoke/test_bare_role_comparison_guard.py`,
   which imports `find_violations` and asserts it returns an empty list -- this is
   what actually enforces the guard in CI.

Stdlib `ast` + `json` only -- no router code is imported or executed, and no env
vars/DB/running app are required, matching the zero-dependency style already
established by `generate_rbac_matrix.py` and `test_enum_contracts.py`.

This detector is deliberately **broader in scope** than `generate_rbac_matrix.py`'s
per-route inline-check scan: it walks the entire router module (`ast.walk(tree)`),
not just the bodies of `@router.<verb>(...)`-decorated functions, because real bare
role checks also live in module-level helper functions that route handlers call
(e.g. `work_orders.py`'s `_ensure_engineer_can_update_work_order`/
`_ensure_engineer_can_complete_work_order`, `rooms.py`'s `_validate_undo_permission`)
-- none of which are themselves route handlers.

KNOWN LIMITATION (mirrors `generate_rbac_matrix.py`'s WR-02 note): only a `.role`
attribute access on the *left*-hand side of a comparison is detected (matching the
existing codebase convention). `.role` on the right-hand side, or a chained access
like `.role.lower()`, is not handled -- no such pattern exists in the codebase today.
"""

from __future__ import annotations

import ast
import importlib.util
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
API_ROOT = SCRIPT_DIR.parent
ROLES_PATH = API_ROOT / "core" / "roles.py"
ROUTERS_DIR = API_ROOT / "routers"
ALLOWLIST_PATH = API_ROOT / "rbac_bare_comparison_allowlist.json"

_GENERATE_RBAC_MATRIX_PATH = SCRIPT_DIR / "generate_rbac_matrix.py"
_spec = importlib.util.spec_from_file_location(
    "generate_rbac_matrix", _GENERATE_RBAC_MATRIX_PATH
)
generate_rbac_matrix = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(generate_rbac_matrix)

_COMPARE_OPS = (ast.Eq, ast.NotEq, ast.In, ast.NotIn)


def imported_core_roles_names(
    tree: ast.Module, core_roles: dict[str, tuple[str, ...]]
) -> set[str]:
    """Names imported into this router file directly from core/roles.py -- NOT
    merged with locally-defined router constants (that distinction is the whole
    point of this function: "was this name imported from core/roles.py", not "is
    this name a known constant at all"). Mirrors the module-matching condition
    `generate_rbac_matrix.py`'s `_resolve_router_constants` uses for its import scan."""
    names: set[str] = set()
    for node in tree.body:
        if not isinstance(node, ast.ImportFrom):
            continue
        module = node.module or ""
        if not (module == "roles" or module == "core.roles" or module.endswith(".roles")):
            continue
        for alias in node.names:
            if alias.name in core_roles:
                names.add(alias.asname or alias.name)
    return names


def find_bare_role_comparisons(
    router_path: Path, core_roles: dict[str, tuple[str, ...]]
) -> list[dict]:
    """Walk the entire router module for bare `<name>.role` comparisons -- every
    `ast.Compare` whose left side is a `.role` attribute access and whose comparator
    is not an imported-from-core/roles.py constant name."""
    tree = ast.parse(router_path.read_text(encoding="utf-8"), filename=str(router_path))
    imported_names = imported_core_roles_names(tree, core_roles)

    violations: list[dict] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Compare):
            continue
        left = node.left
        if not (isinstance(left, ast.Attribute) and left.attr == "role"):
            continue
        if not (node.ops and isinstance(node.ops[0], _COMPARE_OPS)):
            continue

        comparator = node.comparators[0]
        if isinstance(comparator, ast.Name) and comparator.id in imported_names:
            continue  # properly sourced from an imported core/roles.py constant

        violations.append(
            {
                "router": router_path.name,
                "line": node.lineno,
                "code": ast.unparse(node),
            }
        )
    return violations


def load_allowlist(allowlist_path: Path) -> set[tuple[str, str]]:
    """Read the allowlist JSON, return a set of (router filename, exact comparison
    text) pairs. A missing file means "nothing is allowlisted yet" -- an empty set,
    not an error -- so this is safe to call before Task 2 populates the file."""
    if not allowlist_path.exists():
        return set()
    data = json.loads(allowlist_path.read_text(encoding="utf-8"))
    return {(entry["router"], entry["code"]) for entry in data.get("entries", [])}


def find_violations(api_root: Path, allowlist_path: Path) -> list[dict]:
    """Every bare role comparison in apps/api/routers/*.py not present in the
    allowlist, sorted by (router, line) for stable, readable output."""
    core_roles = generate_rbac_matrix.parse_role_constants(api_root / "core" / "roles.py")
    router_files = sorted(
        p for p in (api_root / "routers").glob("*.py") if p.name != "__init__.py"
    )
    allowlist = load_allowlist(allowlist_path)

    violations: list[dict] = []
    for router_path in router_files:
        for violation in find_bare_role_comparisons(router_path, core_roles):
            key = (violation["router"], violation["code"])
            if key not in allowlist:
                violations.append(violation)

    violations.sort(key=lambda v: (v["router"], v["line"]))
    return violations


def main() -> None:
    violations = find_violations(API_ROOT, ALLOWLIST_PATH)
    if violations:
        for violation in violations:
            print(f"{violation['router']}:{violation['line']}: {violation['code']}")
        print(
            "Add a reasoned entry to apps/api/rbac_bare_comparison_allowlist.json, "
            "or route this through require_role()/an imported core/roles.py constant "
            "instead."
        )
        sys.exit(1)
    print("No unlisted bare role comparisons found.")


if __name__ == "__main__":
    main()

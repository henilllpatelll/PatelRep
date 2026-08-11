"""
RBAC matrix drift guard: ensures the committed apps/api/RBAC-MATRIX.md stays in
sync with what apps/api/scripts/generate_rbac_matrix.py would produce from the
current apps/api/routers/*.py + apps/api/core/roles.py.

This test MUST fail if a router is added/changed (new route, changed require_role
gate, etc.) without regenerating the matrix. Run:
    python apps/api/scripts/generate_rbac_matrix.py
and commit the result to fix a failure here.

apps/api/scripts/ has no __init__.py (it's a folder of standalone CLI scripts, not
a package), so the generator module is loaded via importlib.util.spec_from_file_location
rather than a normal import.
"""

import importlib.util
from pathlib import Path

_API_ROOT = Path(__file__).parents[2]
_SCRIPT_PATH = _API_ROOT / "scripts" / "generate_rbac_matrix.py"
_MATRIX_PATH = _API_ROOT / "RBAC-MATRIX.md"

_spec = importlib.util.spec_from_file_location("generate_rbac_matrix", _SCRIPT_PATH)
generate_rbac_matrix = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(generate_rbac_matrix)


def test_rbac_matrix_matches_generated_output():
    api_prefix = generate_rbac_matrix.parse_api_prefix(_API_ROOT / "main.py")
    rows = generate_rbac_matrix.build_matrix_rows(_API_ROOT)
    expected = generate_rbac_matrix.render_markdown(rows, api_prefix)

    committed = _MATRIX_PATH.read_text(encoding="utf-8")

    assert committed == expected, (
        "apps/api/RBAC-MATRIX.md is stale relative to apps/api/routers/ and "
        "apps/api/core/roles.py. Run `python apps/api/scripts/generate_rbac_matrix.py` "
        "and commit the result."
    )

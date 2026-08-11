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


def _row(rows: list[dict], router: str, method: str, path: str) -> dict:
    for row in rows:
        if row["router"] == router and row["method"] == method and row["path"] == path:
            return row
    raise AssertionError(f"No matrix row found for {method} {path} in {router}")


# WR-04 (23-REVIEW.md): test_rbac_matrix_matches_generated_output above only catches
# *drift* between the generator and the committed file -- both sides are produced by
# the same code, so a systematic classification bug (like CR-01, where inline
# role-gated routes were mislabeled "none" since inception) passes it indefinitely.
# These spot-checks assert the generator's classification against known route bodies
# directly, so a regression in the classification logic itself -- not just drift from
# the generator's own prior output -- fails CI.
def test_inline_role_gated_routes_are_not_labeled_none():
    """Routes with a body-level `if <cond involving .role>: raise HTTPException(...)`
    gate must not be reported as "none" (no role restriction) -- see CR-01."""
    rows = generate_rbac_matrix.build_matrix_rows(_API_ROOT)
    gated_routes = [
        ("guest_requests.py", "POST", "/v1/guest-requests/{request_id}/messages"),
        ("guest_requests.py", "POST", "/v1/guest-requests/{request_id}/satisfaction"),
        ("guest_requests.py", "POST", "/v1/guest-requests/{request_id}/recovery-actions"),
        ("lost_found.py", "POST", "/v1/lost-found/{item_id}/custody-events"),
        ("lost_found.py", "PATCH", "/v1/lost-found/{item_id}"),
        ("logbook.py", "PATCH", "/v1/logbook/entries/{entry_id}"),
        ("scheduling.py", "PATCH", "/v1/schedules/assignments/{assignment_id}/clock-in"),
        ("scheduling.py", "PATCH", "/v1/schedules/assignments/{assignment_id}/clock-out"),
    ]
    for router, method, path in gated_routes:
        row = _row(rows, router, method, path)
        assert row["required_roles_display"] != "none", (
            f"{method} {path} ({router}) has a body-level HTTPException(403) role gate "
            "but is classified as 'none' (no role restriction) -- this is the CR-01 "
            "regression: generate_rbac_matrix.py must detect inline "
            "`if <cond involving .role>: raise HTTPException(...)` gates."
        )


def test_filtering_only_role_comparisons_remain_none():
    """Routes whose only `.role` comparison scopes a query/response (never denies
    access with a 403) must remain "none" -- guards against over-detection regressions
    in `_collect_role_gated_ifs`."""
    rows = generate_rbac_matrix.build_matrix_rows(_API_ROOT)
    filter_only_routes = [
        ("tasks.py", "GET", "/v1/tasks"),
        ("rooms.py", "PATCH", "/v1/rooms/{room_id}/status"),
        ("safety.py", "GET", "/v1/safety/training/status"),
    ]
    for router, method, path in filter_only_routes:
        row = _row(rows, router, method, path)
        assert row["required_roles_display"] == "none", (
            f"{method} {path} ({router}) only uses `.role` to filter/scope a query or "
            "response (no HTTPException(403) denial) and should remain 'none', but was "
            f"classified as {row['required_roles_display']!r}."
        )

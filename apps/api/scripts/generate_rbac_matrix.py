"""Generate apps/api/RBAC-MATRIX.md by statically introspecting apps/api/routers/*.py.

Regenerate with:  python apps/api/scripts/generate_rbac_matrix.py
(run from apps/api/, or from anywhere -- all paths are derived from this file's
location via Path(__file__)).

This script parses router source text with Python's built-in `ast` module only. It
never imports or executes router modules, so it has zero runtime dependencies (no
env vars, no Supabase credentials, no running app required) -- matching the
zero-dependency style of the enum-drift-guard precedent (test_enum_contracts.py).
"""

from __future__ import annotations

import ast
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
API_ROOT = SCRIPT_DIR.parent
ROLES_PATH = API_ROOT / "core" / "roles.py"
MAIN_PATH = API_ROOT / "main.py"
ROUTERS_DIR = API_ROOT / "routers"
OUTPUT_PATH = API_ROOT / "RBAC-MATRIX.md"

_HTTP_METHODS = {"get", "post", "put", "patch", "delete"}
_AUTH_DEPENDENCY_NAMES = {"get_current_user", "get_current_user_no_hotel"}
_COMPARE_OPS = {
    ast.Eq: "==",
    ast.NotEq: "!=",
    ast.In: "in",
    ast.NotIn: "not in",
}


def _literal_str_tuple(node: ast.AST) -> tuple[str, ...] | None:
    """Extract a tuple of string literals from a Tuple/List/Set AST node, else None."""
    if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
        values: list[str] = []
        for elt in node.elts:
            if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                values.append(elt.value)
            else:
                return None
        return tuple(values)
    return None


def parse_role_constants(roles_path: Path) -> dict[str, tuple[str, ...]]:
    """Parse core/roles.py's top-level constant tuples (ALL_ROLES, MANAGER_ROLES, ...).

    Handles both literal Tuple/List/Set-of-strings assignments and Name references to
    an already-parsed constant (e.g. ALL_STAFF_ROLES = ALL_ROLES).
    """
    tree = ast.parse(roles_path.read_text(encoding="utf-8"), filename=str(roles_path))
    constants: dict[str, tuple[str, ...]] = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            continue
        name = node.targets[0].id
        literal = _literal_str_tuple(node.value)
        if literal is not None:
            constants[name] = literal
        elif isinstance(node.value, ast.Name) and node.value.id in constants:
            constants[name] = constants[node.value.id]
    return constants


def parse_api_prefix(main_path: Path) -> str:
    """Parse main.py's top-level PREFIX = "..." assignment. Do not hardcode "/v1"."""
    tree = ast.parse(main_path.read_text(encoding="utf-8"), filename=str(main_path))
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            continue
        if (
            node.targets[0].id == "PREFIX"
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        ):
            return node.value.value
    raise ValueError(f"Could not find top-level PREFIX assignment in {main_path}")


def _resolve_router_constants(
    tree: ast.Module, core_roles: dict[str, tuple[str, ...]]
) -> dict[str, tuple[str, ...]]:
    """Build {constant_name: role_tuple} for one router file: core.roles imports merged
    with locally-defined constants (e.g. SESSION_ROLES, SHIFT_ROLES). Local names win on
    collision -- they're processed after imports and simply overwrite the dict entry."""
    local: dict[str, tuple[str, ...]] = {}

    for node in tree.body:
        if not isinstance(node, ast.ImportFrom):
            continue
        module = node.module or ""
        if module == "roles" or module == "core.roles" or module.endswith(".roles"):
            for alias in node.names:
                imported_name = alias.asname or alias.name
                if alias.name in core_roles:
                    local[imported_name] = core_roles[alias.name]

    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            continue
        name = node.targets[0].id
        literal = _literal_str_tuple(node.value)
        if literal is not None:
            local[name] = literal
        elif isinstance(node.value, ast.Name) and node.value.id in local:
            local[name] = local[node.value.id]

    return local


def get_router_prefix(tree: ast.Module) -> str:
    """Find `router = APIRouter(prefix="...", ...)` and return the prefix literal."""
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            continue
        if node.targets[0].id != "router" or not isinstance(node.value, ast.Call):
            continue
        for kw in node.value.keywords:
            if (
                kw.arg == "prefix"
                and isinstance(kw.value, ast.Constant)
                and isinstance(kw.value.value, str)
            ):
                return kw.value.value
    return ""


def _resolve_require_role_args(
    call: ast.Call, constants: dict[str, tuple[str, ...]]
) -> tuple[str, ...]:
    """Resolve require_role(...) call args: literal strings and starred constant refs
    (e.g. require_role(*PROGRAM_MANAGER_ROLES, "gm")). Never silently drops a role --
    an unresolvable starred name is kept as a "(unresolved)"-suffixed marker."""
    roles: list[str] = []
    for arg in call.args:
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            roles.append(arg.value)
        elif isinstance(arg, ast.Starred) and isinstance(arg.value, ast.Name):
            const_name = arg.value.id
            if const_name in constants:
                roles.extend(constants[const_name])
            else:
                roles.append(f"{const_name}(unresolved)")
        else:
            roles.append(f"{ast.unparse(arg)}(unresolved)")
    return tuple(roles)


def _resolve_role_comparator(
    node: ast.AST, constants: dict[str, tuple[str, ...]]
) -> tuple[str, ...] | None:
    """Resolve the right-hand side of an inline `<name>.role == ...` comparison."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return (node.value,)
    literal = _literal_str_tuple(node)
    if literal is not None:
        return literal
    if isinstance(node, ast.Name) and node.id in constants:
        return constants[node.id]
    return None


def _iter_default_exprs(func: ast.AST):
    """Yield every default-value expression on a function's parameters (positional and
    keyword-only), in the order FastAPI's Depends(...) params typically appear."""
    args = func.args
    yield from args.defaults
    for default in args.kw_defaults:
        if default is not None:
            yield default


def _expr_involves_role(node: ast.AST, taint_vars: set[str]) -> bool:
    """True if `node`'s subtree contains a `<name>.role` comparison directly, or a
    reference to a boolean variable previously derived from one (see `taint_vars`,
    populated by `_collect_role_gated_ifs`'s fixed-point pass)."""
    for sub in ast.walk(node):
        if isinstance(sub, ast.Compare):
            left = sub.left
            if isinstance(left, ast.Attribute) and left.attr == "role":
                return True
        if isinstance(sub, ast.Name) and sub.id in taint_vars:
            return True
    return False


def _stmts_raise_http_exception(stmts: list[ast.stmt]) -> bool:
    """True if any statement in `stmts` (searched recursively) raises HTTPException(...)."""
    for stmt in stmts:
        for sub in ast.walk(stmt):
            if not isinstance(sub, ast.Raise) or not isinstance(sub.exc, ast.Call):
                continue
            func = sub.exc.func
            if isinstance(func, ast.Name) and func.id == "HTTPException":
                return True
            if isinstance(func, ast.Attribute) and func.attr == "HTTPException":
                return True
    return False


def _collect_role_gated_ifs(func: ast.AST) -> list[ast.If]:
    """Find `if <cond involving .role>: raise HTTPException(...)` gate blocks within a
    route function -- these are genuine authorization denials, not query/data filters.

    Two-step approach:
    1. Fixed-point taint pass: a simple `name = <expr>` assignment is "role-tainted" if
       its RHS involves a `.role` comparison or another already-tainted name (handles the
       common `is_supervisor = current_user.role in X; is_own = ...; if not is_own and not
       is_supervisor: raise HTTPException(...)` pattern used in e.g. scheduling.py and
       logbook.py, where the role check is factored into an intermediate boolean before
       the gating `if`).
    2. Any `ast.If` whose `test` involves role (directly or via a tainted name) AND whose
       `body` or `orelse` raises `HTTPException(...)` is a real gate.

    This is a heuristic, not a full data-flow analysis (see WR-02 in 23-REVIEW.md for a
    documented limitation: checks factored into a separately-defined helper function are
    not seen). It is intentionally conservative: a role comparison used only to filter a
    query or scope a response (no raise in the same `if`) is correctly left undetected,
    e.g. `tasks.py`'s housekeeper query-scoping and `safety.py`'s response-list filtering.
    """
    taint_vars: set[str] = set()
    for _ in range(5):
        changed = False
        for sub in ast.walk(func):
            if not (
                isinstance(sub, ast.Assign)
                and len(sub.targets) == 1
                and isinstance(sub.targets[0], ast.Name)
            ):
                continue
            name = sub.targets[0].id
            if name not in taint_vars and _expr_involves_role(sub.value, taint_vars):
                taint_vars.add(name)
                changed = True
        if not changed:
            break

    gated_ifs: list[ast.If] = []
    for sub in ast.walk(func):
        if not isinstance(sub, ast.If):
            continue
        if not _expr_involves_role(sub.test, taint_vars):
            continue
        if _stmts_raise_http_exception(sub.body) or _stmts_raise_http_exception(sub.orelse):
            gated_ifs.append(sub)
    return gated_ifs


def _extract_route_rows(
    tree: ast.Module,
    router_filename: str,
    api_prefix: str,
    router_prefix: str,
    constants: dict[str, tuple[str, ...]],
) -> list[dict]:
    """Walk top-level function defs for @router.<verb>(...) decorators, resolving each
    route's required role(s) from its require_role(...) gate, its get_current_user*
    dependency (no gate), or a verify_cron(...) call in the body (cron, not role-based).
    Also records inline `<name>.role` comparisons found anywhere in the function body."""
    rows: list[dict] = []
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue

        route_decorators = [
            decorator
            for decorator in node.decorator_list
            if (
                isinstance(decorator, ast.Call)
                and isinstance(decorator.func, ast.Attribute)
                and isinstance(decorator.func.value, ast.Name)
                and decorator.func.value.id == "router"
                and decorator.func.attr in _HTTP_METHODS
            )
        ]
        if not route_decorators:
            continue

        require_role_call: ast.Call | None = None
        auth_dependency_name: str | None = None

        for default in _iter_default_exprs(node):
            if not (
                isinstance(default, ast.Call)
                and isinstance(default.func, ast.Name)
                and default.func.id == "Depends"
                and default.args
            ):
                continue
            inner = default.args[0]
            if isinstance(inner, ast.Call) and isinstance(inner.func, ast.Name):
                if inner.func.id == "require_role":
                    require_role_call = inner
                elif inner.func.id in _AUTH_DEPENDENCY_NAMES:
                    auth_dependency_name = inner.func.id
            elif isinstance(inner, ast.Name) and inner.id in _AUTH_DEPENDENCY_NAMES:
                auth_dependency_name = inner.id

        verify_cron_call: ast.Call | None = None
        if require_role_call is None:
            for sub in ast.walk(node):
                if (
                    isinstance(sub, ast.Call)
                    and isinstance(sub.func, ast.Name)
                    and sub.func.id == "verify_cron"
                ):
                    verify_cron_call = sub
                    break

        inline_notes: list[str] = []
        for sub in ast.walk(node):
            if not isinstance(sub, ast.Compare):
                continue
            left = sub.left
            if not (isinstance(left, ast.Attribute) and left.attr == "role"):
                continue
            op_symbol = _COMPARE_OPS.get(type(sub.ops[0]))
            if op_symbol is None:
                continue
            resolved = _resolve_role_comparator(sub.comparators[0], constants)
            desc = ast.unparse(sub)
            suffix = "" if resolved is not None else " (unresolved)"
            inline_notes.append(f"inline: {desc} [L{sub.lineno}]{suffix}")

        # CR-01: an inline `if <cond involving .role>: raise HTTPException(...)` is a real
        # authorization gate, not a query/data filter -- it must not be reported as "none"
        # (no role restriction). Only relevant when there's no `require_role(...)` gate
        # already (that case wins outright below).
        gated_ifs = _collect_role_gated_ifs(node) if require_role_call is None else []
        gate_notes = [
            f"gate: if {ast.unparse(gated.test)}: raise HTTPException(...) [L{gated.lineno}]"
            for gated in gated_ifs
        ]

        if require_role_call is not None:
            resolved_roles = _resolve_require_role_args(require_role_call, constants)
            required_roles_display = ", ".join(sorted(set(resolved_roles)))
            source_parts = [f"{ast.unparse(require_role_call)} [L{require_role_call.lineno}]"]
        elif verify_cron_call is not None:
            required_roles_display = "N/A (not role-based)"
            source_parts = [f"verify_cron(...) [L{verify_cron_call.lineno}]"]
        elif auth_dependency_name is not None:
            if gated_ifs:
                required_roles_display = "role-restricted (inline, see source)"
            else:
                required_roles_display = "none"
            source_parts = list(gate_notes)
        else:
            required_roles_display = "N/A (not role-based)"
            source_parts = []

        source_parts.extend(inline_notes)
        source = "; ".join(source_parts)

        for decorator in route_decorators:
            method = decorator.func.attr.upper()
            route_path = ""
            if (
                decorator.args
                and isinstance(decorator.args[0], ast.Constant)
                and isinstance(decorator.args[0].value, str)
            ):
                route_path = decorator.args[0].value
            full_path = f"{api_prefix}{router_prefix}{route_path}"
            rows.append({
                "router": router_filename,
                "method": method,
                "path": full_path,
                "required_roles_display": required_roles_display,
                "source": source,
            })

    return rows


def build_matrix_rows(api_root: Path) -> list[dict]:
    """Glob apps/api/routers/*.py (excluding __init__.py), sorted alphabetically by
    filename for deterministic output. Within a file, routes stay in source (line)
    order -- the AST walk already preserves definition order."""
    core_roles = parse_role_constants(api_root / "core" / "roles.py")
    api_prefix = parse_api_prefix(api_root / "main.py")
    router_files = sorted(
        p for p in (api_root / "routers").glob("*.py") if p.name != "__init__.py"
    )
    rows: list[dict] = []
    for router_path in router_files:
        tree = ast.parse(router_path.read_text(encoding="utf-8"), filename=str(router_path))
        constants = _resolve_router_constants(tree, core_roles)
        router_prefix = get_router_prefix(tree)
        rows.extend(
            _extract_route_rows(tree, router_path.name, api_prefix, router_prefix, constants)
        )
    return rows


def render_markdown(rows: list[dict], api_prefix: str) -> str:
    """Render the full route x role Markdown table. No timestamp or other
    non-deterministic content -- repeated runs against unchanged code must be
    byte-identical."""
    router_count = len({row["router"] for row in rows})
    lines = [
        "# RBAC Matrix",
        "",
        "**Generated file -- do not hand-edit.** Regenerate with:",
        "",
        "```",
        "python apps/api/scripts/generate_rbac_matrix.py",
        "```",
        "",
        f"Every route in `apps/api/routers/` (API prefix `{api_prefix}`), its required "
        "role(s), and its source location -- introspected via AST from "
        "`require_role(...)` call sites and `core/roles.py` constants, matching Phase "
        "19's `RBAC-AUDIT.md` route-level-gate/object-level-check classification. "
        '`none` = any authenticated staff member (no role restriction). '
        '`role-restricted (inline, see source)` = no `require_role(...)` dependency, but '
        "the route body has an inline `if <cond involving .role>: raise HTTPException(...)` "
        "gate that denies access to non-matching roles (see the `Source` column for the "
        "resolved condition) -- distinct from an inline `.role` comparison that only "
        "filters/scopes a query or response without denying access, which remains `none`. "
        '`N/A (not role-based)` = gated by a separate auth mechanism (cron secret, '
        "webhook signature) instead of a role. A pytest drift guard "
        "(`apps/api/tests/smoke/test_rbac_matrix_contract.py`) fails CI if this file "
        "ever goes stale relative to the code it describes.",
        "",
        "| Router | Route | Method | Required Role(s) | Source |",
        "|---|---|---|---|---|",
    ]
    for row in rows:
        lines.append(
            f"| {row['router']} | {row['path']} | {row['method']} | "
            f"{row['required_roles_display']} | {row['source']} |"
        )
    lines.append("")
    lines.append(f"**{router_count} routers, {len(rows)} routes.**")
    return "\n".join(lines) + "\n"


def main() -> None:
    api_prefix = parse_api_prefix(MAIN_PATH)
    rows = build_matrix_rows(API_ROOT)
    markdown = render_markdown(rows, api_prefix)
    OUTPUT_PATH.write_text(markdown, encoding="utf-8")
    router_count = len({row["router"] for row in rows})
    print(f"Wrote {OUTPUT_PATH} ({router_count} routers, {len(rows)} routes)")


if __name__ == "__main__":
    main()

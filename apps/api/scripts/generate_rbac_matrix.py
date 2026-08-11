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

        if require_role_call is not None:
            resolved_roles = _resolve_require_role_args(require_role_call, constants)
            required_roles_display = ", ".join(sorted(set(resolved_roles)))
            source_parts = [f"{ast.unparse(require_role_call)} [L{require_role_call.lineno}]"]
        elif verify_cron_call is not None:
            required_roles_display = "N/A (not role-based)"
            source_parts = [f"verify_cron(...) [L{verify_cron_call.lineno}]"]
        elif auth_dependency_name is not None:
            required_roles_display = "none"
            source_parts = []
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


if __name__ == "__main__":
    # Temporary Task-1 debug block: proves the engine against one router
    # (programs.py, which exercises both starred core.roles constants and multiple
    # decorators). Replaced by a real main() in Task 2.
    core_roles = parse_role_constants(ROLES_PATH)
    api_prefix = parse_api_prefix(MAIN_PATH)
    router_path = ROUTERS_DIR / "programs.py"
    tree = ast.parse(router_path.read_text(encoding="utf-8"), filename=str(router_path))
    constants = _resolve_router_constants(tree, core_roles)
    router_prefix = get_router_prefix(tree)
    rows = _extract_route_rows(tree, router_path.name, api_prefix, router_prefix, constants)
    for row in rows:
        print(row)

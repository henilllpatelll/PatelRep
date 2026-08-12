# Phase 23: Route×Role Permission Matrix - Context

**Gathered:** 2026-08-11
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — smart discuss skipped per autonomous workflow's infrastructure-detection rule: goal keywords "auto-generated"/"introspecting", success criteria are all technical — script exists, output reproducible, no user-facing behavior)

<domain>
## Phase Boundary

Auto-generated, deterministic `RBAC-MATRIX.md` produced by introspecting live code in `apps/api/routers/`, replacing the one-time manual `RBAC-AUDIT.md` (Phase 19) as the durable, regenerable source of "what role does each route require." Covers RBAC-05 (the matrix artifact) and RBAC-06 (the generator script that produces it).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase, discuss skipped. Guiding constraints from PROJECT.md and prior phase work:
- Language/tooling: match the codebase (Python script under `apps/api/`, since routers are Python) — mirror the existing drift-guard precedent (`schema/work_order_enums.json` + `test_enum_contracts.py`) and the mobile `verify-i18n-gate.mjs` pattern of a small, focused, checked-in script rather than a new dependency.
- Source of truth for role introspection: `require_role(...)` call sites and any `core/roles.py`-imported constant used in an inline `current_user.role` check, per the Phase 19 `RBAC-AUDIT.md` inventory (`.planning/phases/19-rbac-audit-and-normalization/RBAC-AUDIT.md`) — reuse its classification (route-level gate vs. object-level/business-rule check) rather than reinventing categories.
- Output format: a single Markdown table (router | route | method | required role(s) | source), similar in spirit to RBAC-AUDIT.md's existing table, so a human diff is readable.
- Determinism: sort routers/routes alphabetically or by file order so two runs against unchanged code produce a byte-identical file (RBAC-06's explicit requirement).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/core/roles.py` — single source of truth for role-group constants (`ALL_ROLES`, `MANAGER_ROLES`, `PROGRAM_MANAGER_ROLES`, etc.), built in Phase 19.
- `.planning/phases/19-rbac-audit-and-normalization/RBAC-AUDIT.md` — the existing 30-router manual inventory this phase automates; useful as a correctness spot-check for the generator's output.
- `apps/web/scripts/verify-i18n-gate.mjs` and `schema/work_order_enums.json` + `apps/api/tests/test_enum_contracts.py` — existing "generate/verify an artifact from live code, fail CI on drift" patterns in this codebase to mirror stylistically.

### Established Patterns
- Every router in `apps/api/routers/` uses either `require_role(*roles)` as a FastAPI dependency, or an inline `if current_user.role ...` check (sometimes against an imported `core/roles.py` constant, sometimes a local literal set) — see RBAC-AUDIT.md's per-router breakdown for the full picture.
- Routes are registered in `apps/api/main.py` via `app.include_router(..., prefix="/v1/...")`.

### Integration Points
- New script reads `apps/api/routers/*.py` (and optionally `apps/api/main.py` for prefixes) and writes its output artifact into the repo (e.g. `.planning/` or a docs location — Claude's discretion during planning).

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond REQUIREMENTS.md's RBAC-05/RBAC-06 text — open to standard approaches (AST-based Python introspection is the natural fit given the source is Python).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope (matches REQUIREMENTS.md's explicit Out of Scope: no `apps/web`/`apps/mobile` route-guard matrix, no re-litigating the existing Phase 19 audit).

</deferred>

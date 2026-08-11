# Requirements: PatelRep — v1.5 RBAC Enforcement Tooling

**Defined:** 2026-08-11
**Core Value:** Save a housekeeper or engineer time on the floor without weakening the hotel's ability to prove what occurred.

## v1 Requirements

Closes the RBAC tooling gap deferred from Phase 19 (v1.4): a one-time audit (`RBAC-AUDIT.md`) and a single source-of-truth constants module (`core/roles.py`) exist, but nothing stops new routers/endpoints from reintroducing the same bare-role-comparison drift that audit had to clean up by hand.

### RBAC Tooling

- [ ] **RBAC-05**: A generated `RBAC-MATRIX.md` (or equivalent) artifact exists, listing every route in `apps/api/routers/` with its required role(s) — "none" for identity/self-service endpoints, the specific role tuple/constant name otherwise — produced by introspecting live code, not hand-maintained prose
- [ ] **RBAC-06**: The matrix is produced by a re-runnable script (checked into the repo, e.g. `scripts/` or `apps/api/scripts/`) that a developer or CI can invoke on demand; running it against unchanged code reproduces the same output (no manual editing required to stay accurate)
- [ ] **RBAC-07**: A CI check fails the build when a router file adds a new bare role-comparison (`current_user.role == "..."`, `current_user.role in {...}`/`not in {...}`, equivalent literal-role-set patterns) that isn't a call to `require_role()` and isn't sourced from an imported `core/roles.py` constant
- [ ] **RBAC-08**: Pre-existing inline role checks that are intentional (e.g. `lost_found.py`'s custody-state set, `safety.py`'s self-service exception — both confirmed correct in the Phase 19 audit) are handled via an explicit, documented allowlist rather than causing the new CI check to fail on landing or being silently excluded file-wide

## v2 Requirements

None identified — this milestone's scope is fully contained in v1.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Auto-generating the matrix for `apps/web`/`apps/mobile` route guards | Phase 19's audit and the drift incidents it found were API-router-side (`require_role`/inline checks); frontend `routeGuard.ts` was not implicated and is out of scope for this pass |
| Enforcing the CI check retroactively on unreviewed pre-Phase-19 code paths outside `apps/api/routers/` | RBAC-01 (Phase 19) already inventoried all 30 routers; this milestone only needs the check to prevent *new* drift, not re-litigate the existing audit |
| Object-level/business-rule authorization checks (e.g. "user can only edit their own profile") | Out of scope per Phase 19's own RBAC-01 classification — these are not route-level role gates and don't belong in a role×route matrix |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| RBAC-05 | Phase 23 | Pending |
| RBAC-06 | Phase 23 | Pending |
| RBAC-07 | Phase 24 | Pending |
| RBAC-08 | Phase 24 | Pending |

**Coverage:**
- v1 requirements: 4 total
- Mapped to phases: 4
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-11*
*Last updated: 2026-08-11 after roadmap creation (Phases 23-24)*

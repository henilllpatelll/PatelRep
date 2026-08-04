---
phase: 19-rbac-audit-and-normalization
plan: 04
subsystem: api
tags: [rbac, fastapi, refactor]

requires:
  - phase: 19-rbac-audit-and-normalization
    provides: 19-RESEARCH.md role-group drift findings (Decisions 1-3)
provides:
  - "apps/api/core/roles.py — single source-of-truth module for ALL_ROLES/ALL_STAFF_ROLES/MANAGER_ROLES/PROGRAM_MANAGER_ROLES"
  - "programs.py, safety.py, hotels.py repointed to import role groups instead of defining local tuples"
affects: [rbac, programs, safety, hotels]

tech-stack:
  added: []
  patterns: ["role-group constants centralized in core/roles.py; routers import, never define locally"]

key-files:
  created:
    - apps/api/core/roles.py
  modified:
    - apps/api/routers/programs.py
    - apps/api/routers/safety.py
    - apps/api/routers/hotels.py

key-decisions:
  - "programs.py's local MANAGER_ROLES (4 roles incl. engineer) renamed to PROGRAM_MANAGER_ROLES to end same-name collision with safety.py's 3-role MANAGER_ROLES — same value, pure rename, zero access change"
  - "hotels.py's ALL_STAFF_ROLES duplicate 'engineer' entry dropped on import — set-membership semantics unaffected by a duplicate, zero access change"

patterns-established:
  - "Role-group constants live in core/roles.py (leaf module, no app imports); routers import rather than define local *_ROLES tuples"

duration: ~25min
completed: 2026-08-04
---

# Phase 19 Plan 04: RBAC Role-Group Consolidation Summary

**New `core/roles.py` single source-of-truth module consolidates 3 drifted role-group constant definitions across programs.py, safety.py, and hotels.py into one canonical set, with zero effective access change.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 completed
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- Created `apps/api/core/roles.py` defining `ALL_ROLES`, `ALL_STAFF_ROLES`, `MANAGER_ROLES` (safety tier), `PROGRAM_MANAGER_ROLES` (programs tier) as the single source of truth
- Repointed `programs.py` (9 call sites), `safety.py` (7 usages), and `hotels.py` (2 usages) to import from `core.roles` instead of defining local tuples
- Confirmed zero effective access change: all constant values verified identical to their prior local definitions (programs.py's rename to `PROGRAM_MANAGER_ROLES` carries the same 4-role value; hotels.py's deduped `ALL_STAFF_ROLES` is membership-identical since duplicates don't affect set membership)

## Task Commits

1. **Task 1: Create core/roles.py** - `d8b6636f` (feat)
2. **Task 2: Repoint programs.py/safety.py/hotels.py** - commingled into `710896df` (see Deviations — this is a shared-working-directory environment artifact, not a plan deviation)

## Files Created/Modified
- `apps/api/core/roles.py` - new canonical role-group constants module
- `apps/api/routers/programs.py` - local `MANAGER_ROLES` deleted; imports and uses `PROGRAM_MANAGER_ROLES` at all 9 sites
- `apps/api/routers/safety.py` - local `MANAGER_ROLES` deleted; imports `MANAGER_ROLES` from `core.roles`, all 7 usages unchanged
- `apps/api/routers/hotels.py` - local `ALL_STAFF_ROLES` (with duplicate "engineer") deleted; imports deduped `ALL_STAFF_ROLES` from `core.roles`

## Decisions Made
- Followed RESEARCH Decisions 1-3 exactly as locked: `MANAGER_ROLES` (safety, 3 roles) and `PROGRAM_MANAGER_ROLES` (programs, 4 roles incl. engineer) kept as distinct named tiers rather than merged; `ALL_STAFF_ROLES` dedup-only, retired `chief_engineer` not re-added anywhere.

## Deviations from Plan

**Environment note (not a code/logic deviation):** This execution ran concurrently with sibling plans 19-01/19-02/19-03 in the *same shared git working directory* (not isolated worktrees). Mid-execution, a `git stash`/`stash pop` conflict (triggered by unrelated `.wolf/` auto-tracking file churn from parallel sessions) caused Task 2's staged changes to `programs.py`/`safety.py`/`hotels.py` to be recovered via `git checkout stash@{0} -- <files>`, and a concurrently-running sibling agent's own commit (`710896df feat(19-03): gate lost-found PATCH and DELETE to custody-state roles`) ended up bundling my staged Task 2 changes alongside its own `lost_found.py` change before I could commit them separately. Net result: the code content is 100% correct and matches the plan exactly (re-verified against HEAD after the fact — `python -c "import main"` clean, zero local `MANAGER_ROLES`/`ALL_STAFF_ROLES` definitions remain, `PROGRAM_MANAGER_ROLES` appears exactly 10 times in programs.py), but Task 2's changes are not isolated in their own commit — they are commingled into a sibling plan's commit. Did not attempt to rewrite shared history (rebase/cherry-pick) given 3+ other agents were actively committing to the same branch at the time — that would risk losing concurrent work. No code was altered beyond what Task 2 specified.

## Issues Encountered
- Concurrent multi-agent git operations in a shared working directory (see above) — resolved by re-verifying final committed state against all plan success criteria rather than fighting a live-moving HEAD.
- `test_management_roi.py::test_roi_downtime_revenue_uses_tenant_adr` and `::test_roi_housekeeping_efficiency_pairs_in_progress_to_clean` fail both before and after this plan's changes (confirmed via `git stash` to a pre-change baseline) — pre-existing, unrelated to RBAC role-group consolidation, out of scope for this plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `core/roles.py` is now the canonical role-group source; future routers should import from it rather than defining local `*_ROLES` tuples.
- Full API suite green apart from the 2 pre-existing, unrelated `test_management_roi.py` failures and the 2 sibling-owned in-flight TDD files (`test_guest_requests_delete_rbac.py`, `test_lost_found_delete.py`), both confirmed passing under their own plans.

---
*Phase: 19-rbac-audit-and-normalization*
*Completed: 2026-08-04*

---
phase: 19-rbac-audit-and-normalization
plan: 02
subsystem: auth
tags: [rbac, fastapi, guest-requests, pytest]

# Dependency graph
requires:
  - phase: 19-rbac-audit-and-normalization
    provides: RBAC audit findings (19-RESEARCH.md) identifying RBAC-02 gap
provides:
  - Role-gated DELETE /v1/guest-requests/{request_id}, restricted to SLA_POLICY_ROLES (gm, housekeeping_supervisor)
  - Live-JWT TestClient regression test proving 403 for housekeeper / 204 for gm
affects: [guest-requests, rbac-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline role gate as first statement in handler body, reusing existing module-level role sets (no new constants)"

key-files:
  created: [apps/api/tests/test_guest_requests_delete_rbac.py]
  modified: [apps/api/routers/guest_requests.py]

key-decisions:
  - "Reused existing SLA_POLICY_ROLES {gm, housekeeping_supervisor} for the delete gate rather than introducing a new role constant, matching the router's established inline-check idiom and management-tier precedent."

patterns-established: []

# Metrics
duration: 12min
completed: 2026-08-04
---

# Phase 19 Plan 02: Guest Request Delete RBAC Gate Summary

**Closed RBAC-02 by gating `DELETE /v1/guest-requests/{id}` to management roles, proven live via a real-JWT FastAPI TestClient test.**

## Performance

- **Duration:** 12 min
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `DELETE /v1/guest-requests/{request_id}` now returns 403 for a housekeeper and 204 for a gm/housekeeping_supervisor, closing an ungated permanent-delete path.
- New `test_guest_requests_delete_rbac.py` exercises the full FastAPI + dependency chain with a real signed HS256 JWT (no bypass of `get_current_user`).
- Tenant-scoping (`.eq("tenant_id", current_user.hotel_id)`) and the task/task_comments cascade delete are untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write failing RBAC test (RED)** - `5a1e32c0` (test)
2. **Task 2: Add SLA_POLICY_ROLES gate (GREEN)** - `41520705` (fix)

_TDD-style RED→GREEN across the two tasks; no separate plan-metadata commit was requested by the executor prompt._

## Files Created/Modified
- `apps/api/tests/test_guest_requests_delete_rbac.py` - Live-JWT TestClient tests: housekeeper→403 (row untouched), gm→204 (row deleted)
- `apps/api/routers/guest_requests.py` - `delete_guest_request` now raises 403 first if `current_user.role not in SLA_POLICY_ROLES`

## Decisions Made
- Reused `SLA_POLICY_ROLES` instead of defining a new role set, per RESEARCH Decision 3 (front_desk and engineer deliberately excluded from delete authority) and the file's own precedent (SLA-policy create/delete already gates on this same set).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The RED assertion failed exactly as predicted (housekeeper delete returned 204 pre-fix), confirming the test was meaningful before the fix landed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- RBAC-02 closed; `SLA_POLICY_ROLES` gate pattern available for reuse by any other RBAC-audit findings on guest-requests endpoints.
- Sibling plans 19-01, 19-03, 19-04 were executing concurrently in separate agents against other files; no shared-file conflicts encountered.

---
*Phase: 19-rbac-audit-and-normalization*
*Completed: 2026-08-04*

## Self-Check: PASSED

- FOUND: apps/api/tests/test_guest_requests_delete_rbac.py
- FOUND: apps/api/routers/guest_requests.py
- FOUND: .planning/phases/19-rbac-audit-and-normalization/19-02-SUMMARY.md
- FOUND commit: 5a1e32c0
- FOUND commit: 41520705

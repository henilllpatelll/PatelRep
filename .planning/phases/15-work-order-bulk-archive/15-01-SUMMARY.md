---
phase: 15-work-order-bulk-archive
plan: 01
subsystem: api
tags: [fastapi, supabase, work-orders, audit-log, rbac, tdd]

requires: []
provides:
  - "POST /work-orders/bulk-archive, POST /work-orders/bulk-archive-by-age, POST /work-orders/bulk-unarchive on the work-orders router"
  - "archived_at TIMESTAMPTZ + archived_by UUID columns on work_orders (migration 089, not yet applied to remote)"
  - "archived query param + default archived-row exclusion on GET /work-orders (both engineer-merge and standard branches)"
  - "operational_audit_events rows (work_order.archived / work_order.unarchived) for every archive/unarchive action"
affects: ["15-02"]

tech-stack:
  added: []
  patterns:
    - "Soft-archive via nullable timestamp/actor columns, orthogonal to the status state machine — not a new status value"
    - "Bulk mutation endpoints validate-then-mutate: select+check all rows first, raise 404/409 before any update, so rejected batches leave zero mutation"

key-files:
  created:
    - supabase/migrations/089_work_order_archive.sql
    - apps/api/tests/test_work_order_archive.py
  modified:
    - apps/api/models/requests.py
    - apps/api/routers/work_orders.py
    - apps/api/tests/smoke/test_tenant_isolation.py

key-decisions:
  - "bulk_archive_work_orders_by_age only ever queries status == 'completed' (not 'cancelled'), matching ARCHIVE-06's narrower wording"
  - "bulk_archive_work_orders_by_age scopes by tenant_id only (not assigned_to), a pre-existing engineer-visibility asymmetry already present in list_work_orders, not a new gap"
  - "Unarchive has no status precondition — any archived work order can always be restored, per ARCHIVE-04"
  - "Migration 089 written but not applied to the remote Supabase project, per established convention (deployment handled separately)"

patterns-established:
  - "Fake Supabase query builder for bulk-mutation tests extends the eq/select/maybe_single pattern with in_, is_/not_.is_, update, and list-or-dict insert — reusable template for future bulk-endpoint test files"

duration: ~35min
completed: 2026-08-03
---

# Phase 15 Plan 01: Work-Order Bulk-Archive Backend Summary

**Three new work-orders endpoints (bulk-archive, bulk-archive-by-age, bulk-unarchive) backed by two new nullable columns and the existing append-only audit table, with `list_work_orders` now hiding archived rows by default in both role branches.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 (plan structured as 3, implemented/verified as 3, committed as 2 atomic commits — see Deviations)
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `POST /work-orders/bulk-archive` archives explicitly selected completed/cancelled work orders in one call, rejecting non-archivable status (409) or cross-tenant ids (404) with zero mutation on rejection.
- `POST /work-orders/bulk-archive-by-age` archives every completed work order older than N days for the caller's tenant in one call; zero-match is a valid non-error outcome.
- `POST /work-orders/bulk-unarchive` restores any archived work order (no status precondition), and it reappears in the default `GET /work-orders` list.
- `GET /work-orders` gained an `archived` query param; both the engineer-merge branch and the standard branch now exclude archived rows by default and can filter to archived-only.
- Every archive/unarchive action writes one `operational_audit_events` row per work order (`work_order.archived` / `work_order.unarchived`).
- Non-management roles (housekeeper, housekeeping_supervisor, front_desk) are blocked from all three endpoints via the existing `require_role("engineer", "gm")` guard.

## Task Commits

1. **Task 1: Add archive columns (migration 089) and bulk-archive request models** - `d4d4aef5` (feat)
2. **Tasks 2 + 3: Bulk-archive, bulk-archive-by-age, bulk-unarchive endpoints + archived_at list filter (test-first)** - `b2bed05b` (feat)

_Note: Tasks 2 and 3 share the same router file and the same test file (per the plan's own file list), and were implemented together in one RED→GREEN cycle rather than an artificial mid-file split — see Deviations._

## Files Created/Modified
- `supabase/migrations/089_work_order_archive.sql` - `archived_at`/`archived_by` columns + partial index on `work_orders` (not applied to remote)
- `apps/api/models/requests.py` - `BulkArchiveWorkOrdersRequest`, `BulkArchiveByAgeRequest`, `BulkUnarchiveWorkOrdersRequest`
- `apps/api/routers/work_orders.py` - three new endpoints, `_bulk_archive` helper, `_ARCHIVABLE_STATUSES` constant, `archived` filter on `list_work_orders`
- `apps/api/tests/test_work_order_archive.py` - 12 tests: bulk-archive, bulk-archive-by-age, bulk-unarchive, RBAC, tenant isolation, audit logging, list filtering, full round trip
- `apps/api/tests/smoke/test_tenant_isolation.py` - one-line fix passing `archived=False` explicitly (see Deviations)

## Decisions Made
- Followed the plan's implementation verbatim for the three endpoints and `_bulk_archive` helper.
- Test file uses generated UUIDv4 strings as seeded work-order ids (rather than short string ids like `"work-order-1"`) because `BulkArchiveWorkOrdersRequest.work_order_ids` is typed `List[UUID4]` and validates real UUIDv4 format.
- `test_bulk_archive_by_age_only_archives_completed_older_than_cutoff` asserts `archived_count == 2`, not `1` — the shared fixture's `WO_COMPLETED_ID` row (365 days old, completed) legitimately qualifies under the same 30-day cutoff alongside the purpose-seeded `WO_OLD_COMPLETED_ID` (60 days old); this is correct router behavior, not a test bug.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a regression in `test_tenant_isolation.py::test_work_orders_list_returns_empty_for_hotel_a`**
- **Found during:** Task 2/3 verification (full smoke suite run)
- **Issue:** That pre-existing test calls `list_work_orders(...)` directly as a Python function, bypassing FastAPI's `Query()` resolution. It didn't pass the newly-added `archived` kwarg, so the raw `Query(False)` `FieldInfo` sentinel object (truthy) was used as the argument, taking the `archived=True` code path (`q.not_.is_(...)`) — which that test file's separate fake query-builder class doesn't implement, raising `AttributeError: '_Q' object has no attribute 'not_'`.
- **Fix:** Added `archived=False` explicitly to that one call site, matching how `status`/`category`/`priority`/etc. are already passed explicitly in the same call.
- **Files modified:** `apps/api/tests/smoke/test_tenant_isolation.py`
- **Verification:** Full smoke suite (270 tests: 258 baseline + 12 new) passes.
- **Committed in:** `b2bed05b` (Task 2/3 commit)

**2. [Process deviation, not a Rule 1-4 case] Combined Task 2 and Task 3 into a single commit**
- **Found during:** Commit staging after both tasks were implemented and verified
- **Issue:** The plan's own `<files>` lists for Task 2 and Task 3 both name `apps/api/routers/work_orders.py` and `apps/api/tests/test_work_order_archive.py` — the two tasks are inherently interleaved in the same file (bulk-unarchive is appended directly after bulk-archive-by-age in the router; the round-trip test in Task 3 exercises Task 2's `bulk_archive_work_orders` and `list_work_orders` together). Implementing and testing them as one coherent RED→GREEN cycle was more correct than an artificial mid-file split that would have left an incomplete, uncompilable intermediate state.
- **Resolution:** Committed as one `feat` commit covering both tasks' endpoints and tests, clearly itemized in this summary and in the commit message body.
- **Files modified:** `apps/api/routers/work_orders.py`, `apps/api/tests/test_work_order_archive.py`, `apps/api/tests/smoke/test_tenant_isolation.py`
- **Committed in:** `b2bed05b`

---

**Total deviations:** 2 (1 auto-fixed regression, 1 commit-structure deviation)
**Impact on plan:** The regression fix was necessary for full-suite correctness (no scope creep — one line, in a file already touched by this plan's change). The commit-structure deviation does not change functional scope or content — all planned code and tests exist exactly as specified.

## Issues Encountered
None beyond the auto-fixed regression above.

## User Setup Required
None - no external service configuration required. Migration 089 is written but deliberately not applied to the remote Supabase project (matches the established convention from 12-01/12-02's migrations); applying it to production is a follow-up action requiring explicit confirmation.

## Next Phase Readiness
- The API surface Plan 15-02's frontend (Archived tab, bulk-select modal) needs now exists and is fully tested: exact request/response shapes for `bulk-archive`, `bulk-archive-by-age`, `bulk-unarchive`, and the `archived` query param on `GET /work-orders`.
- Migration 089 must be applied to the remote Supabase project before 15-02's frontend can be exercised against real data — flagged as a pre-requisite, not blocking 15-02's code development.
- Full API smoke suite: 270/270 passing (258 baseline + 12 new), zero regressions.

---
*Phase: 15-work-order-bulk-archive*
*Completed: 2026-08-03*

## Self-Check: PASSED

- FOUND: supabase/migrations/089_work_order_archive.sql
- FOUND: apps/api/tests/test_work_order_archive.py
- FOUND: .planning/phases/15-work-order-bulk-archive/15-01-SUMMARY.md
- FOUND: commit d4d4aef5
- FOUND: commit b2bed05b

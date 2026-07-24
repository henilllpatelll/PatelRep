---
phase: 05-guest-recovery-and-management-roi
plan: 04
subsystem: api
tags: [fastapi, pydantic, cron, pytest, lost-and-found, rbac]

# Dependency graph
requires:
  - phase: 05-guest-recovery-and-management-roi
    provides: "migration 084 lost_found_items.disposition_flagged_at column + retention_due_at 90-day backfill (05-01)"
provides:
  - "POST /v1/lost-found now writes retention_due_at = now + 90 days server-side (D-10)"
  - "GET /v1/lost-found?disposition_due=true — manager review queue of expired unclaimed items (D-11)"
  - "POST /v1/internal/lost-found/retention-check — cron-secret-guarded, flag-only, idempotent (D-11)"
  - "fire lost-found/retention-check registered in the existing daily-6am GitHub Actions cron group"
  - "D-12 disposition RBAC (front_desk/housekeeping_supervisor/gm allow, engineer 403) proven by test"
  - "FakeDB test harness (apps/api/tests/smoke/fake_supabase.py) gains lt/is_/range query-builder support"
affects: [05-05, 05-06, 05-07, 05-08, 05-09, 05-10, 05-11, 05-12, lost-found, management-roi]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Retention flagging via a dedicated disposition_flagged_at column — the cron never writes lost_found_items.status, preserving the human-authorization requirement for disposal (D-11)"
    - "NULL-guard idempotency: WHERE disposition_flagged_at IS NULL makes a cron safely re-runnable without duplicate side effects or extra state tracking"

key-files:
  created:
    - apps/api/tests/test_lost_found_retention.py
  modified:
    - apps/api/routers/lost_found.py
    - apps/api/routers/internal.py
    - .github/workflows/cron-jobs.yml
    - apps/api/tests/smoke/fake_supabase.py
    - apps/api/tests/smoke/test_tenant_isolation.py

key-decisions:
  - "RETENTION_PERIOD_DAYS = 90 is a fixed module constant, not tenant-configurable in this phase (D-10, per plan)"
  - "disposition_due=true implies status=unclaimed internally; combining it with an explicit status=claimed returns an empty list rather than raising, matching the plan's specified behavior"
  - "The retention cron only ever writes disposition_flagged_at — status, disposition_approved_by, and lost_found_custody_events remain untouched, so disposal stays a human-authorized custody event (D-11)"
  - "record_lost_found_custody_event's existing {front_desk, housekeeping_supervisor, gm} role gate was left byte-for-byte unchanged per the plan; only test coverage was added for D-12"

patterns-established:
  - "FakeDB (apps/api/tests/smoke/fake_supabase.py) now supports .lt(), .is_(), and .range() — any future test driving a router that uses these Supabase query-builder methods can rely on the shared harness instead of writing a local fake"

requirements-completed: [D-10, D-11, D-12]

# Metrics
duration: ~25 min active
completed: 2026-07-24
---

# Phase 5 Plan 04: Lost & Found Retention Summary

**90-day retention clock computed server-side at intake, a manager disposition-review queue via `disposition_due=true`, and a cron-secret-guarded flag-only retention cron wired into the existing 06:00 daily GitHub Actions group — disposal remains exclusively human-authorized.**

## Performance

- **Duration:** ~25 min active work
- **Started:** 2026-07-24T19:24:08Z (session start, per STATE.md)
- **Completed:** 2026-07-24T19:52:18Z
- **Tasks:** 2 (both auto/tdd)
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments
- `POST /v1/lost-found` now computes `retention_due_at` server-side (`now + 90 days`, D-10); the request model has no such field, so a client-supplied value is silently dropped.
- `GET /v1/lost-found?disposition_due=true` returns exactly the expired unclaimed items, oldest-first — the manager disposition-review queue (D-11).
- `POST /v1/internal/lost-found/retention-check` flags expired unclaimed items by writing only `disposition_flagged_at`; it is idempotent (a second run flags 0), secret-guarded (401 on bad/missing `X-Cron-Secret`), and records cron health on both paths.
- `fire lost-found/retention-check` runs inside the existing `daily-6am` GitHub Actions job — no new `on.schedule` entry added.
- D-12 disposition RBAC is now proven by test: `front_desk`, `housekeeping_supervisor`, and `gm` succeed; `engineer` gets 403. The existing role gate in `record_lost_found_custody_event` was left byte-for-byte unchanged.
- Full API test suite (352 tests) passes.

## Task Commits

Each task was committed atomically:

1. **Task 1: Start the 90-day retention clock at intake and expose a disposition_due filter** - `059416b4` (feat)
2. **Task 2: Retention-check cron endpoint (flag only, never dispose) and workflow registration** - `28e3e633` (feat)

## Files Created/Modified
- `apps/api/routers/lost_found.py` - `RETENTION_PERIOD_DAYS = 90` constant; `create_lost_found_item` computes `retention_due_at` server-side; `list_lost_found_items` gains a `disposition_due` query param and filter branch
- `apps/api/routers/internal.py` - new `POST /lost-found/retention-check` handler: `verify_cron` → select unclaimed + expired + unflagged → per-item update of `disposition_flagged_at` only → `_record_cron_run` on both paths
- `.github/workflows/cron-jobs.yml` - `fire lost-found/retention-check || rc=1` appended inside the existing `daily-6am` job body
- `apps/api/tests/test_lost_found_retention.py` - 11 tests covering D-10 intake clock, D-11 disposition_due filter + retention cron (flag-only, idempotent, secret-guarded), and D-12 disposition RBAC
- `apps/api/tests/smoke/fake_supabase.py` - added `.lt()`, `.is_()`, `.range()` to the shared `FakeQuery` test harness (needed by both the new list filter and the new cron endpoint's query chain)
- `apps/api/tests/smoke/test_tenant_isolation.py` - one-line fix: an existing direct call to `list_lost_found_items` now passes `disposition_due=False` explicitly (see Deviations)

## Decisions Made
See `key-decisions` in frontmatter. Summary: fixed 90-day non-configurable retention window; `disposition_due=true` implicitly scopes to `unclaimed` and degrades to an empty result rather than an error when combined with a conflicting status filter; the cron is flag-only by construction (writes a single column, nothing else) so disposal stays a human-authorized custody event; the existing D-12 role gate was proven by test, not modified.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended the shared FakeDB test harness with `.lt()`, `.is_()`, and `.range()`**
- **Found during:** Task 1 (writing `test_lost_found_retention.py` against the plan's specified `fake_supabase.py` harness)
- **Issue:** The plan's `read_first` names `apps/api/tests/smoke/fake_supabase.py` as "the harness these router tests drive," but `FakeQuery` only supported `eq/neq/gte/in_/like` — no `.lt()` (needed by the new `disposition_due` filter and the retention cron's expiry check), no `.is_()` (needed by the cron's `disposition_flagged_at IS NULL` guard), and no `.range()` (already used unconditionally by the pre-existing `list_lost_found_items`, but never exercised via `FakeDB` before since no test called that function directly against this harness).
- **Fix:** Added the three methods to `FakeQuery`/`FakeDB`, following the exact style of the existing filter operators (append to `self.filters`, evaluate in `_matches`; `range` slices `matched` post-order like `limit`).
- **Files modified:** `apps/api/tests/smoke/fake_supabase.py`
- **Verification:** Full suite (352 tests) passes; the new methods are additive only — no existing filter behavior changed.
- **Committed in:** `059416b4` (Task 1 commit)

**2. [Rule 1 - Bug] Fixed a regression the new `disposition_due` parameter caused in an existing tenant-isolation test**
- **Found during:** Task 1, running `pytest tests/ -q` after adding `disposition_due: bool = Query(False)` to `list_lost_found_items`
- **Issue:** `apps/api/tests/smoke/test_tenant_isolation.py::test_lost_found_list_returns_empty_for_hotel_a` calls `list_lost_found_items` directly (bypassing FastAPI dependency injection) and explicitly passes every existing parameter by keyword — but not the newly added `disposition_due`. Called this way, `disposition_due` defaulted to the FastAPI `Query(False)` sentinel object itself, not the plain `bool` value `False`. That sentinel is truthy, so the new `if disposition_due:` branch executed unexpectedly, calling `.lt()` on that test's own minimal local `_Q` fake (which intentionally only implements `.eq()` plus explicit no-ops for a few other operators), raising `AttributeError: '_Q' object has no attribute 'lt'`.
- **Fix:** Added `disposition_due=False` to that one call site, matching the file's existing convention of always passing every parameter explicitly for direct router calls.
- **Files modified:** `apps/api/tests/smoke/test_tenant_isolation.py`
- **Verification:** `cd apps/api && python -m pytest tests/ -q` — 352 passed (was 2 failed before this fix, including this regression).
- **Committed in:** `059416b4` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking test-harness gap, 1 blocking regression from the new parameter's default value)
**Impact on plan:** Both fixes were necessary to make the plan's own specified test harness usable and to keep the full suite green, as the plan's acceptance criteria require. No scope creep — no other files or behaviors touched.

## Issues Encountered
- This worktree has no local `apps/api/.env` (per project CLAUDE.md: "No live API credentials in the local environment"). `core/config.py`'s `Settings` has several required fields with no defaults (`supabase_url`, `supabase_service_role_key`, `supabase_jwt_secret`, `cron_secret`), so running `pytest tests/test_lost_found_retention.py` **standalone** fails at collection with a `pydantic_core.ValidationError` — this is pre-existing and reproduces identically on `test_internal_escalations.py`, unrelated to this plan's changes. `apps/api/tests/smoke/conftest.py` sets dummy env vars via `os.environ.setdefault`, and it happens to load before other test modules only when the **full suite** is collected (`smoke/` sorts before `test_*.py` alphabetically). All verification in this plan was therefore performed via `cd apps/api && python -m pytest tests/ -q` (352 passed) and `pytest tests/ -q -k "<filter>"` (equivalent to the plan's standalone-file commands, confirmed 11/11 new tests passing, including the required `-k disposition_rbac` subset of 3). This is an environment quirk of this specific worktree, not a defect introduced by this plan — flagging per project instructions to note when credential/env gaps prevent literal command reproduction.

## User Setup Required
None - no external service configuration required. The retention cron reuses the existing `CRON_SECRET` GitHub Actions secret already configured for the `daily-6am` job group.

## Next Phase Readiness
- Lost & found retention is fully closed: intake clock, review queue, flag-only cron, and D-12 RBAC proof are all live and tested.
- The shared `FakeDB` test harness now supports `.lt()`, `.is_()`, and `.range()` — downstream Phase 5 plans that need similar time-boundary or null-guard query filters (e.g., other cron endpoints, delivery-event queries) can use it directly instead of writing new local fakes.
- No blockers for downstream Phase 5 plans (05-05 through 05-12).

## Self-Check: PASSED

- `apps/api/routers/lost_found.py` — FOUND, contains `RETENTION_PERIOD_DAYS = 90` and `disposition_due` filter
- `apps/api/routers/internal.py` — FOUND, contains `check_lost_found_retention`
- `.github/workflows/cron-jobs.yml` — FOUND, contains `fire lost-found/retention-check`
- `apps/api/tests/test_lost_found_retention.py` — FOUND, 11 tests, all passing
- Commit `059416b4` (Task 1) — FOUND
- Commit `28e3e633` (Task 2) — FOUND

---
*Phase: 05-guest-recovery-and-management-roi*
*Completed: 2026-07-24*

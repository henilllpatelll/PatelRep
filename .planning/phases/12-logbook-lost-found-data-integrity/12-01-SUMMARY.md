---
phase: 12-logbook-lost-found-data-integrity
plan: 01
subsystem: api
tags: [fastapi, dateutil, timezone, supabase, logbook]

requires: []
provides:
  - "Hotel-local timezone helper (_get_hotel_tz/_hotel_today) in routers/logbook.py, mirroring clean_sessions.py's convention"
  - "create_logbook_entry stamps entry_date from hotel-local calendar day instead of UTC CURRENT_DATE"
  - "List endpoint filters entries by the entry_date column directly instead of UTC created_at boundaries"
  - "Migration 086 backfilling entry_date for existing rows via each tenant's timezone"
affects: [logbook, shift-summary]

tech-stack:
  added: []
  patterns:
    - "Hotel-local date derivation: datetime.now(dateutil_tz.gettz(hotel_timezone)).date() -- same pattern as clean_sessions.py's _get_hotel_tz, now duplicated in logbook.py rather than extracted (kept flat per CLAUDE.md A1 services-layer-depth rule; only 2 call sites, not shared cross-domain yet)"

key-files:
  created:
    - apps/api/tests/test_logbook_timezone.py
    - supabase/migrations/086_logbook_entry_date_local.sql
  modified:
    - apps/api/routers/logbook.py

key-decisions:
  - "Did not extract _get_hotel_tz into a shared module -- clean_sessions.py already has an identical private helper; two call sites doesn't meet the 2+-domains-shared threshold for services/ extraction per CLAUDE.md, and the plan explicitly said to mirror (not import) the convention"
  - "Migration 086 does not change the entry_date column's DB default (still UTC CURRENT_DATE) -- the application now sets it explicitly on every insert, which is the authoritative fix going forward; changing shared DDL was explicitly out of scope"

patterns-established:
  - "Frozen-clock test helper (_FrozenDateTime subclass + monkeypatch on the router's `datetime` import) for testing hotel-local time derivation without hitting a real clock"

duration: 15min
completed: 2026-08-02
---

# Phase 12 Plan 01: Logbook Hotel-Local Timezone Fix Summary

**Fixed LOGBOOK-01: logbook entries written in the evening no longer silently file under the wrong UTC calendar day, on both the write and read paths, with a backfill for existing mis-dated rows.**

## Performance

- **Duration:** 15 min
- **Tasks:** 3
- **Files modified:** 3 (1 router file, 1 new test file, 1 new migration)

## Accomplishments
- `create_logbook_entry` now stamps `entry_date` from the hotel's local calendar day (DST-aware via `dateutil.tz`), not the DB's UTC `CURRENT_DATE` default
- `_build_entries_query`'s `entry_date` filter now does a direct equality match on the corrected `entry_date` column instead of comparing `created_at` against naive UTC day boundaries
- New migration 086 backfills `entry_date` for all existing rows from `created_at` converted to each row's tenant timezone
- New test file proves both the evening (8pm-Central) and just-before-local-midnight boundary cases resolve to the correct hotel-local day via real tz-database conversion, and that list filtering returns entries under their local day, not the UTC day

## Task Commits

Each task was committed atomically:

1. **Task 1: Stamp entry_date in hotel-local time on create** - `0932a097` (feat)
2. **Task 2: Filter the list view by the local-day entry_date column** - `d69dc677` (fix)
3. **Task 3: Backfill entry_date for existing rows via migration 086** - `522cc5e8` (fix)

_Note: Task 1 was executed test-first (RED confirmed for both create-path assertions before the fix, then GREEN after); Tasks 2 and 3 were verified against the full test file + smoke suite after each change._

## Files Created/Modified
- `apps/api/routers/logbook.py` - added `_get_hotel_tz`/`_hotel_today`; `create_logbook_entry` stamps `entry_date`; `_build_entries_query` filters by `entry_date` equality
- `apps/api/tests/test_logbook_timezone.py` - 3 tests: evening create, pre-midnight create, list-filter local-vs-UTC-day
- `supabase/migrations/086_logbook_entry_date_local.sql` - backfill UPDATE joining `tenants` for timezone

## Decisions Made
- Mirrored (did not import/share) `clean_sessions.py`'s `_get_hotel_tz` helper into `logbook.py` per the plan's explicit instruction and CLAUDE.md's services-layer-depth convention (only extract to `services/` when logic is shared across 2+ domains — this is now 2 call sites but the plan intentionally chose duplication over premature extraction)
- Left the `entry_date` column's DB default untouched (still UTC `CURRENT_DATE`) — the application is now the single source of truth for the value on insert, and touching the shared DDL default was explicitly out of scope per the plan

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Initial test drafts used non-UUID4 `department_id` values (`"dept-1"`) which the existing `UUID4` Pydantic field type on `CreateLogbookEntryRequest` rejected with 422 — not a bug in the code under test, just a test-fixture correction to a real (existing) v4 UUID string.

## User Setup Required

None - no external service configuration required. Migration 086 was written but, per the plan's explicit instruction, was **not** applied to the remote Supabase project — deployment is handled separately.

## Next Phase Readiness

- LOGBOOK-01 is closed: entries created and listed correctly resolve to the hotel-local calendar day; migration 086 is ready to apply when this plan is deployed.
- Full smoke suite (251 tests) and the new logbook timezone test file (3 tests) pass with zero regressions.
- Two pre-existing failures in `apps/api/tests/test_management_roi.py` (`test_roi_downtime_revenue_uses_tenant_adr`, `test_roi_housekeeping_efficiency_pairs_in_progress_to_clean`) were confirmed via `git stash` to predate this plan and are unrelated to `logbook.py` — out of scope per CLAUDE.md's scope boundary, not fixed here.
- Phase 12's second plan (LOSTFOUND-01) appears to already have commits on `main` from a parallel executor (`0e28ca6d docs(12-02): complete lost & found custody cascade delete plan`) — not touched by this plan.

---
*Phase: 12-logbook-lost-found-data-integrity*
*Completed: 2026-08-02*

## Self-Check: PASSED

All created files and task commits verified present on disk / in git history.

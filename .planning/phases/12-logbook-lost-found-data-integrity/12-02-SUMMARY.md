---
phase: 12-logbook-lost-found-data-integrity
plan: 02
subsystem: database
tags: [postgres, supabase, foreign-key, triggers, fastapi, pytest]

# Dependency graph
requires: []
provides:
  - "Lost & Found items with custody history can be permanently deleted (204, no FK error)"
  - "lost_found_custody_events cascades on parent item delete; no orphaned rows remain"
  - "Custody event content remains immutable to UPDATE (append-only guarantee preserved)"
affects: [lost-found, guest-recovery]

# Tech tracking
tech-stack:
  added: []
  patterns: ["ON DELETE CASCADE for child audit tables that must clear alongside a deleted parent, paired with narrowing an append-only trigger from BEFORE UPDATE OR DELETE to BEFORE UPDATE so the cascade is permitted"]

key-files:
  created:
    - supabase/migrations/087_lost_found_custody_cascade.sql
    - apps/api/tests/test_lost_found_delete.py
  modified: []

key-decisions:
  - "Custody events stay immutable to UPDATE (history cannot be altered) but cascade-delete when their parent item is deleted, since the requirement's own wording (\"permanently delete ... to correct a mistaken record\") implies whole-item removal, not selective history editing."
  - "Rejected explicit child-row cleanup in the router: the pre-existing BEFORE DELETE trigger would have blocked that approach too, so the DB-level CASCADE + UPDATE-only trigger is the minimal correct fix, requiring zero router code changes."
  - "Left the three sibling reject_guest_recovery_mutation() triggers (guest_request_events, guest_messages, guest_recovery_actions) untouched — only the lost_found_custody_events trigger was narrowed."

patterns-established:
  - "FakeDB-based router tests cannot reproduce real FK/trigger errors (no constraint enforcement); when a fix is DB-level (migration), the accompanying test file should explicitly document this limitation in its module docstring and assert the application-level contract (status codes, no manual child-row deletion) rather than claim to prove the DB behavior."

# Metrics
duration: 15min
completed: 2026-08-02
---

# Phase 12 Plan 02: Lost & Found Custody Cascade Delete Summary

**Migration 087 switches `lost_found_custody_events.lost_found_item_id` from `ON DELETE RESTRICT` to `ON DELETE CASCADE` and narrows its immutability trigger to `BEFORE UPDATE` only, unblocking permanent deletion of Lost & Found items with custody history — no router code changes required.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2
- **Files modified:** 2 (both new files)

## Accomplishments
- Root-caused LOSTFOUND-01 to two stacked layers: an `ON DELETE RESTRICT` FK (every item gets an `intake` custody event at creation, so no item with history could ever be deleted) plus a `BEFORE UPDATE OR DELETE` immutability trigger that would also block an explicit child-row-cleanup workaround.
- Fixed both layers in a single migration: FK changed to `ON DELETE CASCADE`; trigger recreated as `BEFORE UPDATE` only, preserving append-only tamper protection for custody event *content* while permitting deletion of the *entire item* (and its custody trail) as a unit.
- Confirmed no router changes were needed — `delete_lost_found_item` in `apps/api/routers/lost_found.py` already only deletes from `lost_found_items`; the DB now permits the cascade it always relied on implicitly.
- Added regression tests locking in the delete endpoint's contract (204 with custody history present, 404 for a missing item, no manual custody-events deletion in the router).

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 087 — cascade custody events on item delete, keep them update-immutable** - `a75a38e7` (fix)
2. **Task 2: Regression tests for permanent delete with custody history** - `4f5bce10` (test)

_No separate plan-metadata commit was made for this response — STATE.md and this SUMMARY.md are committed together as part of plan closure._

## Files Created/Modified
- `supabase/migrations/087_lost_found_custody_cascade.sql` - Drops/recreates the `lost_found_custody_events_lost_found_item_id_fkey` FK as `ON DELETE CASCADE`; drops/recreates the `lost_found_custody_events_immutable` trigger as `BEFORE UPDATE` only (was `BEFORE UPDATE OR DELETE`). Header comment documents the design tradeoff. Not applied to the remote Supabase project as part of this plan (per plan instruction).
- `apps/api/tests/test_lost_found_delete.py` - 3 tests: delete with custody history → 204 and item removed; router performs no manual `lost_found_custody_events` deletion (relies on DB cascade); delete of a nonexistent item → 404. Module docstring documents that FakeDB cannot enforce FK constraints or triggers, so these tests verify the endpoint contract, not the DB-level cascade itself.

## Decisions Made
- See `key-decisions` in frontmatter. Summary: custody events remain UPDATE-immutable but CASCADE-delete with their parent item; no router-side child cleanup; only the one relevant trigger (of four sharing the same function) was narrowed.

## Deviations from Plan

None — plan executed exactly as written. The plan's proposed SQL, trigger recreation, and test coverage were used as specified; the FK constraint name (`lost_found_custody_events_lost_found_item_id_fkey`) was confirmed against migration 072's default Postgres naming (no explicit `CONSTRAINT` clause was used there) and verified no later migration renamed it.

## Issues Encountered

None.

## User Setup Required

None. Per plan instruction, migration 087 was deliberately **not** applied to the remote Supabase project as part of this plan — it exists only as a file in `supabase/migrations/`. Applying it to the shared production database (via Supabase MCP or CLI) is a follow-up action outside this plan's scope, and should be confirmed with the user before running given it alters a live FK/trigger on a shared table.

## Next Phase Readiness

- Roadmap success criteria 3 and 4 for LOSTFOUND-01 (permanent delete succeeds with no FK error; no orphaned custody rows) are satisfied at the migration/DDL level; criterion verification against the live DB requires the migration to be applied to Supabase first.
- `cd apps/api && python -m pytest tests/test_lost_found_delete.py -q` passes (3/3); full smoke suite (`tests/smoke/`, 251 tests) and the sibling `tests/test_lost_found_retention.py` (11 tests) both remain green — no regressions.
- Guest-recovery append-only guarantees for the other three event tables (`guest_request_events`, `guest_messages`, `guest_recovery_actions`) are structurally unchanged (verified by grep: no other migration references `lost_found_custody_events_lost_found_item_id_fkey`).
- Phase 12 has one other plan (12-01, logbook timezone/entry-date fix) tracked separately; this plan (12-02) does not depend on it and vice versa (both `depends_on: []`, wave 1).

---
*Phase: 12-logbook-lost-found-data-integrity*
*Completed: 2026-08-02*

## Self-Check: PASSED

- FOUND: supabase/migrations/087_lost_found_custody_cascade.sql
- FOUND: apps/api/tests/test_lost_found_delete.py
- FOUND: commit a75a38e7
- FOUND: commit 4f5bce10

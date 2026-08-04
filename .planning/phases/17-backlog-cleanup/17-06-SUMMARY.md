---
phase: 17-backlog-cleanup
plan: 06
subsystem: api
tags: [supabase, room-status-history, actor-attribution, opera-import]

requires: []
provides:
  - "import_hk_details() only stamps room_status.stay_reset_at on a genuine fresh-inspection transition (prior status != INSPECTED), not on every imported row that already resolves to INSPECTED"
  - "get_room_history() embeds actor attribution (user_profiles/actor_name) via a batch-fetch merge, matching RoomDetailDrawer.tsx's existing read contract"
affects: [housekeeping, room-detail-drawer]

tech-stack:
  added: []
  patterns:
    - "Batch prior-state pre-fetch before a bulk upsert loop (prior_status_map) to make a conditional stamp decision without N+1 queries"
    - "Two-step fetch + in-memory merge for actor attribution (room_status_history rows, then user_profiles by .in_(changed_by_ids)), matching the established staff.py/housekeeping.py pattern rather than a Postgrest embed"

key-files:
  created: []
  modified:
    - apps/api/routers/rooms.py
    - apps/api/routers/housekeeping.py
    - apps/api/tests/smoke/test_housekeeping_assignments.py
    - apps/api/tests/smoke/test_webhooks_and_transitions.py

key-decisions:
  - "Diagnostic redone fresh (prior parallel-agent run's findings were not persisted) via direct query against the dev Supabase DB rather than only reading code — live data provided the confirming evidence code review alone could not (the 1-minute-window batch-stamp pattern)."
  - "Fix is forward-looking only: it stops future bulk imports from over-stamping stay_reset_at, but does not backfill/repair already-incorrect stay_reset_at values on rooms affected by past bulk imports (e.g. the diagnostic's sample room) — a live data mutation was deliberately out of scope for a targeted bug-fix plan and risky to script against a shared production-backed dev database without a clear, generalizable correction rule."

patterns-established:
  - "Prior-status batch pre-fetch pattern: when a bulk upsert needs to know 'is this truly a new transition', fetch current state for the whole batch first rather than querying inside the loop."

duration: ~35min
completed: 2026-08-04
---

# Phase 17 Plan 06: Room History Visibility + Actor Attribution Summary

**Narrowed the Opera HK-details bulk-import's `stay_reset_at` stamp to genuine INSPECTED transitions (was firing on every already-INSPECTED row) and added batch-fetched actor attribution to `get_room_history()`.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2 (1 diagnostic, 1 fix)
- **Files modified:** 4 (2 source, 2 test)

## Accomplishments

- **Diagnostic (Task 1): CONFIRMED.** Queried the dev Supabase DB directly (same backend the local API server runs against). Found 35 rooms with `room_status.stay_reset_at` stamped within the same one-minute window (`2026-07-31T08:01:2x`–`08:01:2x`), all `status = INSPECTED` — a pattern consistent with a single bulk Opera HK-details import, not 35 independent genuine DEP-inspection passes happening simultaneously. Sampled one of those rooms (`e4d63f38-38e7-4c1a-8465-ca4931af8073`): it has 2 real `room_status_history` entries (2026-06-28, 2026-07-10, both `task_sheet_clean_type` notes with a real `changed_by`), both entirely predating the bulk stamp — meaning `GET /rooms/{room_id}/history` returned an empty array for that room despite genuine history existing. This matches the plan's hypothesis exactly: `import_hk_details()`'s `if resolved_status == "INSPECTED": stay_reset_at = now` fires unconditionally, regardless of whether the room's prior status was already INSPECTED.
- **Fix (Task 2):**
  - `apps/api/routers/housekeeping.py::import_hk_details()` — added a batch pre-fetch of current `room_status.status` per room (one extra query for the whole import, not N+1) into `prior_status_map`, and changed the stamp condition to `resolved_status == "INSPECTED" and prior_status_map.get(room_id) != "INSPECTED"`. A room already at INSPECTED going into the import no longer gets its `stay_reset_at` boundary pushed forward.
  - `apps/api/routers/rooms.py::get_room_history()` — added a batch-fetch of `user_profiles` for the distinct `changed_by` ids in the returned history page, merged as `entry.user_profiles` (nested, matching the pattern already used for `task.user_profiles` elsewhere in the drawer) and `entry.actor_name` (flat convenience field), matching both read paths `RoomDetailDrawer.tsx` already uses (lines 126, 1071).

## Task Commits

1. **Task 1: Live diagnostic** — no commit (read-only investigation; finding documented above and in this summary, per plan's own note that this task "produces no commit").
2. **Task 2: Fix stay_reset_at + add actor attribution** — `ca98ec88` (fix)

## Files Created/Modified

- `apps/api/routers/housekeeping.py` — `import_hk_details()` now batch-fetches prior `room_status` and only stamps `stay_reset_at` on a genuine INSPECTED transition.
- `apps/api/routers/rooms.py` — `get_room_history()` now merges `user_profiles`/`actor_name` onto each history row.
- `apps/api/tests/smoke/test_housekeeping_assignments.py` — 2 new tests: stay_reset_at NOT restamped when prior status already INSPECTED; stay_reset_at IS stamped on a genuine transition into INSPECTED.
- `apps/api/tests/smoke/test_webhooks_and_transitions.py` — 1 new test: `get_room_history()` returns `actor_name`/`user_profiles` when a matching profile exists, and `None` when `changed_by` is absent/unmatched.

## Decisions Made

- Redid the live diagnostic from scratch rather than trusting the prior parallel-agent attempt's (unpersisted) claim, per the orchestrator's explicit instruction — used a direct Supabase query against the dev DB (same env the API server itself uses) instead of relying on code-read inference alone, since the plan explicitly required live evidence over blind implementation.
- Chose not to backfill/correct already-affected `room_status.stay_reset_at` values in the live DB as part of this fix. The plan's Task 2 action text scopes the fix to narrowing the *stamp condition* inside `import_hk_details()`, not a data migration; mutating already-stamped rows would require a judgment call per room (was a later, genuine re-inspection also skipped due to the same bug, or not?) that isn't safely automatable, and this is a shared, production-backed dev database. Documented as a known residual limitation below.

## Deviations from Plan

None — plan executed exactly as written. Both action items in Task 2 (narrow the stamp condition per the CONFIRMED diagnostic; add actor attribution) were implemented as specified, using the exact batch pre-fetch design and two-step fetch/merge pattern the plan called out.

## Issues Encountered

- The local API dev server (`:8003`, `uvicorn --reload`) did not pick up the code changes via its file watcher during live verification (root cause not fully diagnosed — likely a stale/desynced `WatchFiles` state after 11+ minutes of uptime in this heavily-shared multi-agent session, consistent with other executors' notes this session about transient file-state weirdness in the shared working tree). Resolved by killing the stale process (`taskkill`) and restarting `uvicorn main:app --reload --port 8003` fresh; the restarted server picked up the change immediately and live verification succeeded.
- **Residual/known limitation (not a bug in this fix):** the diagnostic's sample room (`e4d63f38-38e7-4c1a-8465-ca4931af8073`) still returns an empty history array after the fix — expected, since the fix is forward-looking only and does not retroactively clear the room's already-set `stay_reset_at` from the 2026-07-31 bulk import. Verified the fix mechanism works correctly on a *different* room (`77ed2143-e101-48c2-86e9-94e8bc4b24bd`, unaffected by the historical over-stamp) via the live authenticated endpoint: its history now returns 9 entries with populated `actor_name`/`user_profiles` (e.g. `"actor_name": "Claudia"`), confirming the actor-attribution half of the fix live. The stay_reset_at narrowing itself is verified via the two new unit tests (restamp-suppressed / restamp-occurs-on-genuine-transition) since reproducing a live bulk-import round trip through the real PDF-upload endpoint was impractical for this verification pass.

## User Setup Required

None — no external service configuration required. No new migration; both fixes are pure application-logic changes.

## Next Phase Readiness

- Room History visibility bug (UX-06, ROADMAP Phase 17 success criterion 4) is closed for all *future* bulk imports and for any room not already affected by the pre-fix bug.
- **Open follow-up (not blocking this plan):** rooms whose `stay_reset_at` was already over-stamped by a prior bulk import (at minimum the 35-room batch from 2026-07-31T08:01, confirmed live) remain with an incorrect visibility boundary until a genuine future DEP-inspection-pass event or a deliberate one-time data correction addresses them. Recommend a follow-up decision: either accept this as self-healing over time (each room's boundary will eventually be superseded by a real DEP-inspection-pass stamp) or script a scoped one-time correction for the known-affected batch.

---
*Phase: 17-backlog-cleanup*
*Completed: 2026-08-04*

## Self-Check: PASSED

- FOUND: commit `ca98ec88`
- FOUND: `.planning/phases/17-backlog-cleanup/17-06-SUMMARY.md`
- FOUND: `apps/api/routers/rooms.py`
- FOUND: `apps/api/routers/housekeeping.py`

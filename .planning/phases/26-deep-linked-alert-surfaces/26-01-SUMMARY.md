---
phase: 26-deep-linked-alert-surfaces
plan: 01
subsystem: api
tags: [fastapi, supabase, ai-copilot, testing]

# Dependency graph
requires: []
provides:
  - "GET /ai/risk-alerts maintenance_risks entries now include an id field (asset id) from the assets table"
  - "FakeDB.select_calls: reusable test-harness capability to assert on select() column args, not just returned rows"
  - "test_risk_alerts_asset_select_includes_id: regression guard that fails if the id column is ever dropped from asset_risks' select"
affects: [26-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FakeQuery.select() now records (table_name, args) into FakeDB.select_calls, mirroring the local FakeQuery.select_args convention already used in test_housekeeping_assignments.py — lets tests assert on selected columns instead of relying on FakeDB's row-echo, which does not simulate PostgREST column projection"

key-files:
  created: []
  modified:
    - apps/api/routers/ai_copilot.py
    - apps/api/tests/smoke/fake_supabase.py
    - apps/api/tests/test_ai_copilot_rbac.py

key-decisions:
  - "Task 2's fake-DB fix and test addition were kept in a single commit (both plan-specified as one action operating on the shared fake + one test file) rather than artificially split, matching the plan's own task grouping."

patterns-established:
  - "select_calls on FakeDB: any future test needing to assert 'was column X selected' (not just 'was row X returned') can use db.select_calls instead of adding a bespoke local FakeQuery subclass."

# Metrics
duration: 12min
completed: 2026-08-12
---

# Phase 26 Plan 01: Add asset id to /ai/risk-alerts Summary

**`/ai/risk-alerts`'s `maintenance_risks` entries now include an `id` field (one-line select change in `get_risk_alerts`), guarded by a new regression test that asserts the actual select-string content via a new `FakeDB.select_calls` capture, not just the echoed row.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-08-12T~10:20Z
- **Completed:** 2026-08-12T~10:32Z
- **Tasks:** 2/2 completed
- **Files modified:** 3

## Accomplishments
- `get_risk_alerts()`'s `asset_risks` query now selects `"id, name, failure_risk_score"` instead of `"name, failure_risk_score"` — the only production code change in this plan.
- `FakeDB`/`FakeQuery` in `apps/api/tests/smoke/fake_supabase.py` gained `select_calls` (list of `(table_name, args)` tuples), purely additive — no existing test reads or depends on its absence.
- New test `test_risk_alerts_asset_select_includes_id` in `apps/api/tests/test_ai_copilot_rbac.py` asserts both (a) `maintenance_risks[0]["id"]` is present in the response and (b) `"id"` actually appears in the captured `select_calls` args for the `assets` table — a genuine regression guard, since FakeDB's `execute()` doesn't filter returned columns by what was selected (a naive row-only assertion would pass even without Task 1's fix).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add id to asset_risks select in get_risk_alerts** - `69a4934a` (fix)
2. **Task 2: Add select-args capture to FakeDB + regression test for the id field** - `f06acced` (test)

_Plan metadata commit: this SUMMARY.md + STATE.md update, committed separately per protocol._

## Files Created/Modified
- `apps/api/routers/ai_copilot.py` - `get_risk_alerts()`'s `asset_risks` select changed from `"name, failure_risk_score"` to `"id, name, failure_risk_score"`
- `apps/api/tests/smoke/fake_supabase.py` - `FakeDB.__init__` gained `self.select_calls = []`; `FakeQuery.select()` now appends `(table_name, args)` to it before returning `self`
- `apps/api/tests/test_ai_copilot_rbac.py` - new `test_risk_alerts_asset_select_includes_id` test, placed after `test_open_endpoints_accept_any_role`

## Decisions Made
- Kept Task 2's fake-harness fix and its consuming test in one commit — the plan itself specifies them as a single task touching both files together, and splitting them would leave an intermediate commit where the new `select_calls` field has no caller (no value in an artificial split).
- Followed the plan's exact fixture shape for the new test (`FakeDB({"assets": [...]})` with `tenant_id: "hotel-1"` matching `_user("gm")`'s default hotel_id) rather than improvising a different row set.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched their `<action>` blocks verbatim; no auto-fixes, no blockers, no architectural questions encountered.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. No migration, no env var, no credential needed for this change (pure Python code + tests).

## Verification Results

1. `cd apps/api && python -m pytest tests/test_ai_copilot_rbac.py -v` — 22/22 passed, including the new test.
2. `cd apps/api && python -m pytest tests/` — 571 passed, 3 failed. The 3 failures are `tests/test_management_roi.py::test_roi_downtime_revenue_uses_tenant_adr`, `test_roi_housekeeping_efficiency_pairs_in_progress_to_clean`, `test_roi_pm_compliance_reads_pm_deferrals_table` — the same pre-existing, unrelated failures documented in STATE.md's 25-01 entry (baseline was 570 passed / 3 failed before this plan; 571 = 570 + 1 new test). Zero regressions from the additive `select_calls` change.
3. `grep -n 'select("id, name, failure_risk_score")' apps/api/routers/ai_copilot.py` — one match inside `get_risk_alerts`, confirmed.

## Next Phase Readiness

- Plan 26-02 (frontend, wave 2) can now rely on `maintenance_risks[].id` being present in the real `/ai/risk-alerts` response — this was the explicit blocking dependency noted in this plan's frontmatter (`key_links`).
- No blockers or concerns for 26-02.

---
*Phase: 26-deep-linked-alert-surfaces*
*Completed: 2026-08-12*

## Self-Check: PASSED

- FOUND: `.planning/phases/26-deep-linked-alert-surfaces/26-01-SUMMARY.md`
- FOUND: commit `69a4934a` (Task 1)
- FOUND: commit `f06acced` (Task 2)

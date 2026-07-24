---
phase: 05-guest-recovery-and-management-roi
plan: 03
subsystem: api
tags: [python, pure-functions, tdd, pytest, roi, forecasting]

# Dependency graph
requires:
  - phase: 05-guest-recovery-and-management-roi
    provides: "tenants.average_daily_rate_cents column (migration 084, plan 05-01) — GM-configured ADR, NULL = not configured"
provides:
  - "calculate_repeat_failures(work_orders, window_start, window_end, window_days=90, minimum_failures=2) — D-08 windowed asset/room repeat-failure grouping"
  - "calculate_room_downtime_hours(transitions, window_end, downtime_status='OOO') — per-room OOO interval accumulation, closes open interval at window_end"
  - "calculate_downtime_revenue_impact(downtime_hours, average_daily_rate_cents) — D-07 hours x (ADR/24), reports configured:false rather than 0 when ADR unset"
  - "calculate_housekeeping_efficiency(clean_sessions, room_type_baselines) — minutes per occupied-room-day + per-room-type variance with explicit 'definition' string"
  - "calculate_inspection_trends(inspections, inspection_results, repeat_threshold=2) — pass rate excluding 'conditional', repeat-defect ranking by distinct inspection count"
  - "calculate_pm_compliance(active_schedules, completions, deferrals, repeated_threshold=2) — completion/deferral rates sourced from real pm_completion_records/pm_deferrals tables"
  - "calculate_training_readiness(assignments, as_of) — readiness_pct + overdue count from safety_training_assignments"
  - "project_seven_day_labor_forecast(historical_completions, avg_clean_minutes_by_room_type, start_date, horizon_days=7, lookback_weeks=4, default_clean_minutes=30.0) — D-09 trailing weekday-average capacity/labor projection, no PMS reservation dependency"
affects: [05-06, management-roi, guest-recovery]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Eight new pure calculators appended to the existing services/guest_recovery/contracts.py module (list-of-dicts in, flat dict out), matching the calculate_guest_request_metrics precedent from plan 05-01: empty input always returns a fully-populated zero shape, never {} or an exception"
    - "Unconfigured-vs-zero distinction: calculate_downtime_revenue_impact returns configured:False + revenue_impact_cents:None when ADR is unset, never a fabricated 0 (T-05-03-02 mitigation)"
    - "PM deferral sourced from the real pm_deferrals table (migration 071), not inferred heuristically from work-order/schedule state — corrects the 05-RESEARCH.md Pitfall 4 speculative-derivation assumption"

key-files:
  created:
    - apps/api/tests/test_management_roi.py
  modified:
    - apps/api/services/guest_recovery/contracts.py

key-decisions:
  - "room_status_history's timestamp column is `created_at` (migration 004 line 111), not a dedicated 'at'/'changed_at' column. calculate_room_downtime_hours's pure-function signature takes a normalized `{'room_id', 'to_status', 'at'}` shape per the plan's interface contract — plan 05-06's router must map `created_at` -> `at` when building the transitions list it passes in."
  - "Resolved a plan self-contradiction: Task 1's literal action text specified a calculate_downtime_revenue_impact docstring containing the phrase 'No Opera dependency', but Task 3's acceptance criteria requires `grep -ci 'opera|reservation' contracts.py` to return 0 for the whole file. Rephrased both docstrings (calculate_downtime_revenue_impact and project_seven_day_labor_forecast) to say 'PMS' instead of 'Opera' — the testable acceptance gate took precedence per deviation Rule 3."
  - "calculate_pm_compliance consumes pm_completion_records and pm_deferrals directly (both real, first-class tables per migration 071) rather than deriving 'deferred' heuristically from work-order reopen patterns, per the plan's explicit read_first correction of 05-RESEARCH.md's speculative Pitfall 4 / Assumption A2."

patterns-established:
  - "Fixture-reconcilable ROI math: every calculator's test fixture is hand-checkable by reading the assertion (e.g. mean(10,12,14,16)=13 rooms x 30min/60=6.5h), satisfying the phase's explicit reconciliation requirement."

requirements-completed: [D-07, D-08, D-09]

# Metrics
duration: ~20 min active
completed: 2026-07-24
---

# Phase 5 Plan 03: Management ROI Calculators Summary

**Eight new pure, deterministic ROI calculators appended to `services/guest_recovery/contracts.py` — repeat-failure windowing, OOO downtime accumulation, ADR-based revenue impact, housekeeping efficiency variance, inspection pass-rate/repeat-defect trends, PM completion/deferral rates (sourced from real tables, not inferred), training readiness, and a 7-day trailing-average labor forecast — all covered by 24 fixture-reconcilable tests in a new `test_management_roi.py`, with zero Supabase or PMS-reservation coupling.**

## Performance

- **Duration:** ~20 min active work across 3 TDD task cycles (RED/GREEN x3)
- **Started:** 2026-07-24T19:41:00Z
- **Completed:** 2026-07-24T19:48:25Z
- **Tasks:** 3 (all `type="auto" tdd="true"`)
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `calculate_repeat_failures` implements D-08's 90-day/2-failure default window, grouping asset and room work orders independently and skipping null keys instead of bucketing them under `None`.
- `calculate_room_downtime_hours` walks OOO transitions per room, closes any interval still open at `window_end`, clamps negative deltas to zero, and ignores an unmatched close event.
- `calculate_downtime_revenue_impact` implements D-07's exact `hours x (ADR/24)` formula and — critically — returns `configured: False` / `revenue_impact_cents: None` rather than a fabricated `0` when no ADR is set (T-05-03-02 mitigation, verified by test).
- `calculate_housekeeping_efficiency` returns an explicit `definition` string alongside `minutes_per_occupied_room` and per-room-type variance, reporting `None` (not `0`) for room types missing a baseline.
- `calculate_inspection_trends` correctly excludes `conditional` results from the pass rate and ranks repeat defects by distinct inspection count (>=2), not raw fail-row count.
- `calculate_pm_compliance` sources completion/deferral rates from the real `pm_completion_records`/`pm_deferrals` tables (migration 071) rather than a heuristic derivation, and is zero-schedule safe (no divide-by-zero).
- `calculate_training_readiness` computes `readiness_pct` and `overdue` (null `completed_at` + past-due `due_date`) from `safety_training_assignments`.
- `project_seven_day_labor_forecast` implements D-09's trailing weekday-average projection: exactly 7 consecutive dates always returned, confidence tiers (low <2 / medium 2-3 / high >=4 observations), default-clean-minutes fallback for room types with no baseline, and zero Opera/reservation-input coupling.

## Task Commits

Each task was committed atomically (TDD RED then GREEN per task):

1. **Task 1: Repeat failures, room downtime, and revenue impact calculators**
   - `bc8bb677` (test) - failing tests for repeat failures, room downtime, revenue impact
   - `2542c77e` (feat) - implementation; all 9 tests pass
2. **Task 2: Housekeeping efficiency, inspection trends, PM compliance, training readiness**
   - `ce266dbc` (test) - failing tests for the four calculators
   - `f88a29c6` (feat) - implementation; 18/18 module tests pass
3. **Task 3: Seven-day rooms-to-clean and labor-hours projection**
   - `779fe98f` (test) - failing tests for the forecast function
   - `69f94310` (feat) - implementation; 24/24 module tests pass, 365/365 full API suite passes

## Files Created/Modified
- `apps/api/tests/test_management_roi.py` - 453 lines, 24 tests, one test class-free module in the `test_guest_recovery.py` style (direct imports, literal fixture dicts, plain asserts, no mocks)
- `apps/api/services/guest_recovery/contracts.py` - grew from 133 to 520 lines; 8 new functions appended, all existing functions (`resolve_sla_minutes`, `validate_guest_request_transition`, `validate_lost_found_custody_event`, `calculate_guest_request_metrics`, `_parse_timestamp`, `_average`) untouched; `date` and `timedelta` added to the existing `datetime` import line

## Decisions Made
See `key-decisions` in frontmatter. Summary: (1) `room_status_history.created_at` is the timestamp column plan 05-06 must map to the pure function's `at` key; (2) rephrased two "Opera" docstring references to "PMS" to satisfy Task 3's file-wide zero-Opera-reference acceptance gate, which contradicted Task 1's literal docstring instruction; (3) PM deferral rates read the real `pm_deferrals` table directly, never heuristically derived.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Resolved plan self-contradiction over "Opera" wording in docstrings**
- **Found during:** Task 3 acceptance-criteria verification (`grep -ci 'opera|reservation' contracts.py` expected to return `0`)
- **Issue:** Task 1's `<action>` block specified the literal docstring text `"""D-07: revenue impact = downtime hours x (GM-configured ADR / 24). No Opera dependency."""` for `calculate_downtime_revenue_impact`, and Task 3's own action block's `project_seven_day_labor_forecast` docstring example referenced "the pilot-gated Opera sync". Task 3's acceptance criteria then required zero case-insensitive matches of `opera|reservation` anywhere in the file — a criterion the Task-1-authored docstring text would fail.
- **Fix:** Reworded both docstrings to say "PMS" instead of "Opera" (`"No external PMS dependency."` and `"outside the pilot-gated PMS sync"`), preserving the intended meaning (no dependency on the Opera Cloud integration) while satisfying the file-wide grep gate.
- **Files modified:** apps/api/services/guest_recovery/contracts.py
- **Verification:** `grep -ci 'opera|reservation' apps/api/services/guest_recovery/contracts.py` returns `0`; all 24 module tests and 365 full-suite tests still pass.
- **Committed in:** `69f94310` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — plan text contradiction)
**Impact on plan:** No behavioral change; docstring wording only. No scope creep.

## Issues Encountered
- Two initial test-fixture bugs (naive vs. timezone-aware `datetime` comparison in the repeat-failures tests) were caught during the Task 1 GREEN run and fixed in the test file before committing — not a plan or implementation defect, just a test-authoring correction made before the GREEN commit.

## User Setup Required
None - no external service configuration required. All eight functions are pure (no Supabase import, no network call — verified by `grep -c 'supabase' contracts.py` returning `0`).

## Next Phase Readiness
- `contracts.py` now exposes all eight calculators plan 05-06's router needs to wire real Supabase rows through; the router work (query construction, tenant scoping, response assembly) is entirely deferred to that plan per this plan's explicit scope boundary.
- Plan 05-06 must map `room_status_history.created_at` → the `at` key expected by `calculate_room_downtime_hours`'s `transitions` argument (recorded above).
- Full API suite (365 tests) is green; no regressions introduced in adjacent domains.
- `contracts.py` is now 520 lines — 20 lines over the project's general "keep files under 500 lines" guideline (global CLAUDE.md). This is plan-directed (all three tasks explicitly append to this single existing module to match the established pure-contracts-module pattern from plan 05-01, and plan 05-06's imports depend on this exact module path). Flagging rather than restructuring unilaterally, since 05-02 and 05-04 are concurrent sibling worktree agents editing other files in this same domain this wave; splitting the module now would be an architectural change out of this plan's scope.

## Self-Check: PASSED

- `apps/api/services/guest_recovery/contracts.py` — FOUND
- `apps/api/tests/test_management_roi.py` — FOUND
- `.planning/phases/05-guest-recovery-and-management-roi/05-03-SUMMARY.md` — FOUND
- Commit `bc8bb677` (Task 1 RED) — FOUND
- Commit `2542c77e` (Task 1 GREEN) — FOUND
- Commit `ce266dbc` (Task 2 RED) — FOUND
- Commit `f88a29c6` (Task 2 GREEN) — FOUND
- Commit `779fe98f` (Task 3 RED) — FOUND
- Commit `69f94310` (Task 3 GREEN) — FOUND
- Commit `4fad2ba5` (SUMMARY) — FOUND

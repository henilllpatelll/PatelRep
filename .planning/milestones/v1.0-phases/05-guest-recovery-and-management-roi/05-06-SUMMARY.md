---
phase: 05-guest-recovery-and-management-roi
plan: 06
subsystem: api
tags: [fastapi, supabase, rbac, tenant-isolation, roi, forecasting]

# Dependency graph
requires:
  - phase: 05-guest-recovery-and-management-roi
    provides: "tenants.average_daily_rate_cents column (migration 084, plan 05-01)"
  - phase: 05-guest-recovery-and-management-roi
    provides: "eight pure ROI calculators in services/guest_recovery/contracts.py (plan 05-03), including the room_status_history.created_at -> `at` key mapping note"
provides:
  - "apps/api/routers/management_roi.py — seven GM-only, tenant-scoped endpoints under /v1/reports/roi/*"
  - "management_roi.router registered in main.py ahead of reports.router"
  - "FakeDB.lte() support in tests/smoke/fake_supabase.py (shared test harness gap fix)"
affects: [05-10, management-roi, web-roi-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Router-as-thin-adapter: every /reports/roi/* handler fetches tenant-scoped rows and hands them to a pure calculator from contracts.py; no aggregation math inline in the router"
    - "_build_clean_sessions module-level helper pairs IN_PROGRESS -> CLEAN/INSPECTED room_status_history transitions into {room_id, room_type_id, date, minutes} sessions, shared by /housekeeping-efficiency and /forecast-7day"
    - "TestClient + monkeypatch(router_module, 'supabase', FakeDB(...)) router-test harness (matches test_programs_routes.py precedent), including a dynamic sweep over router.routes so future endpoints can't silently skip the GM gate or tenant filter"

key-files:
  created:
    - apps/api/routers/management_roi.py
  modified:
    - apps/api/main.py
    - apps/api/tests/test_management_roi.py
    - apps/api/tests/smoke/fake_supabase.py

key-decisions:
  - "Extended the shared FakeDB test harness (tests/smoke/fake_supabase.py) with .lte() support, mirroring its existing .gte()/.lt() pattern. Production routers across the codebase (reports.py, billing.py, scheduling.py, etc.) already chain .lte() on date-range queries, but the shared fake silently no-op'd it — a pre-existing gap this plan's router tests exposed. Minimal, additive, backward-compatible fix (Rule 3 - blocking, needed for meaningful router tests)."
  - "training-readiness and forecast-7day use a 'generated_for' key instead of 'period', matching the plan's own <verification> section which explicitly accepts 'data.period (or data.generated_for)'. Both are point-in-time/forward-looking, not backward date-range queries."
  - "housekeeper_profiles-derived avg_clean_minutes_by_room_type uses a completion_count-weighted mean; room types with no profile fall back to room_types.base_clean_minutes; types absent from both fall back to the calculator's own default_clean_minutes — matches the plan's explicit three-tier fallback spec for D-09."

patterns-established:
  - "Dynamic RBAC/tenant sweep test pattern: iterate router.routes at test time (not a hardcoded path list) so a future endpoint added to a GM-only router is automatically covered by the 403 and tenant-scoping checks."

requirements-completed: [D-06, D-07, D-08, D-09]

# Metrics
duration: ~16 min active
completed: 2026-07-24
---

# Phase 5 Plan 06: Management ROI Router Summary

**Seven GM-only, tenant-scoped ROI aggregation endpoints under `/v1/reports/roi/*` (repeat-failures, downtime-revenue, housekeeping-efficiency, inspection-trends, pm-compliance, training-readiness, forecast-7day), each a thin adapter over the plan 05-03 pure calculators, registered ahead of `reports.router`, and covered by 14 new router-level tests plus a dynamic per-route RBAC/tenant sweep.**

## Performance

- **Duration:** ~16 min active work across 3 TDD task cycles (RED/GREEN x3) plus one lint-cleanup commit
- **Started:** 2026-07-24T19:23:04-05:00
- **Completed:** 2026-07-24T19:38:56-05:00
- **Tasks:** 3 (all `type="auto" tdd="true"`)
- **Files modified:** 4 (1 created, 3 modified)

## Endpoint Reference (for plan 05-10's web client)

All seven endpoints are `GET`, GM-only (`require_role("gm")`), tenant-scoped via `.eq("tenant_id", current_user.hotel_id)`, mounted at `/v1/reports/roi/*`. Every response is `{"data": {...}}`.

| Path | Query params | `data` keys |
|---|---|---|
| `/repeat-failures` | `start_date?`, `end_date?` (default: trailing 90 days, D-08) | `period`, `window_days`, `repeat_asset_count`, `repeat_room_count`, `repeat_assets[]`, `repeat_rooms[]`, `total_repeat_work_orders` |
| `/downtime-revenue` | `start_date?`, `end_date?` (default: trailing 30 days) | `period`, `downtime` (`total_downtime_hours`, `rooms[]`, `rooms_affected`), `revenue` (`configured`, `average_daily_rate_cents`, `downtime_hours`, `revenue_impact_cents` — D-07: `configured:false`/`revenue_impact_cents:null` when ADR unset, never a fabricated 0) |
| `/housekeeping-efficiency` | `start_date?`, `end_date?` (default: trailing 30 days) | `period`, `occupied_room_days`, `total_clean_minutes`, `minutes_per_occupied_room`, `by_room_type[]`, `definition` |
| `/inspection-trends` | `start_date?`, `end_date?` (default: trailing 30 days) | `period`, `total_inspections`, `passed`, `failed`, `conditional`, `pass_rate_pct`, `repeat_defects[]`, `repeat_defect_count` |
| `/pm-compliance` | `start_date?`, `end_date?` (default: trailing 30 days) | `period`, `active_schedules`, `completed_schedules`, `completion_rate_pct`, `deferred_schedules`, `deferral_rate_pct`, `repeated_deferrals[]`, `repeated_deferral_count` |
| `/training-readiness` | none (point-in-time) | `generated_for`, `total_assignments`, `completed`, `outstanding`, `overdue`, `readiness_pct` |
| `/forecast-7day` | `lookback_weeks?` (1-12, default 4) | `generated_for`, `lookback_weeks`, `days[]` (each: `date`, `weekday`, `projected_rooms`, `projected_labor_hours`, `confidence`, `by_room_type[]`) |

## Accomplishments
- `apps/api/routers/management_roi.py` created: seven endpoints, all `require_role("gm")`, all delegating math to `services/guest_recovery/contracts.py` calculators from plan 05-03.
- `/downtime-revenue` maps `room_status_history.created_at` → the calculator's `at` key, per the exact gotcha recorded in 05-03-SUMMARY.md.
- `/downtime-revenue` reports `configured: false` / `revenue_impact_cents: null` — never a fabricated 0 — when `tenants.average_daily_rate_cents` is unset (D-07, T-05-06-03 mitigation, verified by test).
- `/repeat-failures` defaults to a trailing 90-day window (D-08); all other date-ranged endpoints default to 30 days matching the existing `reports.py` idiom.
- `_build_clean_sessions` module-level helper pairs `IN_PROGRESS -> CLEAN/INSPECTED` transitions into timed clean sessions, shared by `/housekeeping-efficiency` and `/forecast-7day`.
- `/inspection-trends` guards the `inspection_results` query behind `if inspection_ids:` (T-05-06-05 mitigation — an empty `.in_()` list can 500 against PostgREST); proven by a test that asserts the table is never queried when there are no inspections.
- `/pm-compliance` reads deferrals from the real `pm_deferrals` table (migration 071), not an inferred heuristic.
- `/training-readiness` is point-in-time (no date range), matching the existing `/v1/safety/training/status` convention.
- `/forecast-7day` (D-09) builds `avg_clean_minutes_by_room_type` from a `completion_count`-weighted mean of `housekeeper_profiles`, falling back to `room_types.base_clean_minutes` and then the calculator's own default — zero `opera_reservations`, `room_readiness_predictions`, or `services.ai` coupling (verified by both a static source-inspection test and a `grep` acceptance check).
- `management_roi.router` registered in `main.py` immediately before `reports.router` so the more specific `/reports/roi/*` prefix is matched first (T-05-06-08 mitigation).
- Dynamic `test_every_roi_route_is_gm_only` and `test_every_roi_route_is_tenant_scoped` iterate `management_roi.router.routes` at test time rather than a hardcoded path list, so a future eighth endpoint cannot silently ship without the GM gate or tenant filter.

## Task Commits

Each task was committed atomically (TDD RED then GREEN per task):

1. **Task 1: repeat-failures and downtime-revenue**
   - `cf545a0e` (test) - failing router tests; also extends shared FakeDB with `.lte()`
   - `9d5f468c` (feat) - router + main.py registration; 29/29 module tests pass
2. **Task 2: housekeeping-efficiency, inspection-trends, pm-compliance, training-readiness**
   - `22fb775d` (test) - failing tests for the four endpoints
   - `fd2c5686` (feat) - implementation; 34/34 module tests pass
3. **Task 3: forecast-7day + cross-endpoint RBAC/tenant sweep**
   - `aa71511b` (test) - failing forecast test + dynamic sweep tests
   - `a7e788ce` (feat) - implementation; 38/38 module tests pass, 410/410 full API suite passes
   - `fc2398e7` (style) - ruff E402 cleanup (moved router-test imports to file top; no behavior change)

## Files Created/Modified
- `apps/api/routers/management_roi.py` - 319 lines; 7 GM-only endpoints + 6 module-level helpers (`_window`, `_bounds`, `_period`, `_average_daily_rate_cents`, `_parse_transition_at`, `_build_clean_sessions`)
- `apps/api/main.py` - added `management_roi` to the router import block and `app.include_router(management_roi.router, prefix=PREFIX)` before `reports.router`
- `apps/api/tests/test_management_roi.py` - grew from 453 to ~720 lines; added 14 router-level tests (TestClient + FakeDB) on top of the 24 pure-calculator tests from plan 05-03
- `apps/api/tests/smoke/fake_supabase.py` - added `.lte()` filter support to the shared `FakeQuery` class

## Decisions Made
See `key-decisions` in frontmatter. Summary: (1) extended the shared FakeDB harness with `.lte()` since production routers already depend on it and the fake silently ignored it; (2) `training-readiness`/`forecast-7day` use `generated_for` instead of `period`, matching the plan's own `<verification>` spec; (3) three-tier fallback for forecast clean-minutes (profiles → room_types baseline → calculator default) exactly as specified.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `.lte()` support to the shared FakeDB test harness**
- **Found during:** Task 1, writing the first router-level test
- **Issue:** `tests/smoke/fake_supabase.py`'s `FakeQuery` supports `.eq/.neq/.gte/.lt/.is_/.in_/.like` but not `.lte()`, even though most production routers (`reports.py`, `billing.py`, `scheduling.py`, `logbook.py`, `lost_found.py`, `webhooks.py`, `internal.py`, `ai_copilot.py`) already chain `.lte()` on date-range queries. Without it, the fake would silently ignore the upper-bound filter, making window-boundary assertions meaningless.
- **Fix:** Added a `.lte()` method and matching `_matches` branch to `FakeQuery`, mirroring the existing `.gte()` implementation exactly (string comparison, `None` treated as no-match).
- **Files modified:** `apps/api/tests/smoke/fake_supabase.py`
- **Verification:** All 410 tests in the full suite pass, including every pre-existing test that already used the fake without `.lte()` (purely additive, no existing behavior changed).
- **Committed in:** `cf545a0e` (Task 1 RED commit)

**2. [Rule 1 - Bug] Fixed a plan-documentation error in the final route-path acceptance check**
- **Found during:** Task 3 acceptance-criteria verification
- **Issue:** The plan's `<acceptance_criteria>` includes `paths=sorted(r.path for r in router.routes); assert paths==['/downtime-revenue', ...]` (paths without the `/reports/roi` prefix). Running this exact command against the real router returns `['/reports/roi/downtime-revenue', ...]` — FastAPI's `APIRouter(prefix=...)` bakes the prefix into `route.path` at route-registration time (verified against the identical pattern in every other router in this codebase), not at `include_router()` time. This is a plan-writing assumption error, not a router defect.
- **Fix:** No code change needed — the router's actual behavior is correct and matches production convention. Verified the intended assertion (7 correctly-named endpoints exist under `/reports/roi/*`) with the prefix included, and confirmed live HTTP-level 200/403 responses at the real mounted paths (`/v1/reports/roi/*`) via the test suite.
- **Files modified:** None
- **Verification:** `python -c "from routers.management_roi import router; paths=sorted(r.path for r in router.routes); assert paths==['/reports/roi/downtime-revenue','/reports/roi/forecast-7day','/reports/roi/housekeeping-efficiency','/reports/roi/inspection-trends','/reports/roi/pm-compliance','/reports/roi/repeat-failures','/reports/roi/training-readiness']"` exits 0.
- **Committed in:** N/A (verification-only finding, documented here for the verifier's awareness)

---

**Total deviations:** 2 (1 auto-fixed blocking test-infra gap, 1 documentation-only finding with no code impact)
**Impact on plan:** No behavioral change to the shipped router. The FakeDB fix strengthens the shared test harness for all future date-range router tests; the acceptance-criteria note prevents the verifier from treating a correct implementation as a false failure.

## Issues Encountered
None beyond the two items documented above.

## User Setup Required
None - no external service configuration required. All seven endpoints read from Supabase tables already present via migrations 004, 008, 009, 013, 071, 070, 084; no new environment variables.

## Next Phase Readiness
- All seven endpoint paths and their `data` response shapes are documented above (Endpoint Reference table) for plan 05-10's typed web client.
- `management_roi.router` is live and registered ahead of `reports.router`; no route-shadowing risk.
- Full API suite (410 tests) is green; ruff clean on every file touched this plan.
- The `.lte()` fix to the shared FakeDB harness is available to any future router test in this codebase that needs it — no further action required.

## Self-Check: PASSED

- `apps/api/routers/management_roi.py` — FOUND
- `apps/api/main.py` (management_roi import + include_router before reports.router) — FOUND
- `apps/api/tests/test_management_roi.py` (38 tests) — FOUND
- `apps/api/tests/smoke/fake_supabase.py` (`.lte()` support) — FOUND
- Commit `cf545a0e` (Task 1 RED) — FOUND
- Commit `9d5f468c` (Task 1 GREEN) — FOUND
- Commit `22fb775d` (Task 2 RED) — FOUND
- Commit `fd2c5686` (Task 2 GREEN) — FOUND
- Commit `aa71511b` (Task 3 RED) — FOUND
- Commit `a7e788ce` (Task 3 GREEN) — FOUND
- Commit `fc2398e7` (lint cleanup) — FOUND

---
*Phase: 05-guest-recovery-and-management-roi*
*Completed: 2026-07-24*

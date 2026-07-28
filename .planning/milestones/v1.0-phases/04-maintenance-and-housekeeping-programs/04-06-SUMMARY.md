---
phase: 04-maintenance-and-housekeeping-programs
plan: 06
subsystem: api
tags: [inspection-sampling, inspection-quality, deep-clean, public-areas, housekeeping-intelligence]
dependency-graph:
  requires:
    - "04-01: programs.py MANAGER_ROLES/RBAC baseline"
    - "04-04: programs.py template routes (same router, non-overlapping code path)"
  provides:
    - "select_inspection_sample / aggregate_inspection_quality (services/programs/contracts.py) pure functions any future sampling/quality caller must reuse"
    - "GET /programs/inspection-sample, GET /programs/inspection-quality (deepened), GET /programs/deep-clean-schedules, GET /programs/public-areas for 04-07's depth UI to consume"
  affects:
    - apps/api/routers/programs.py
    - apps/api/services/programs/contracts.py
    - apps/api/tests/test_programs_routes.py
    - apps/api/tests/test_operational_programs.py
tech-stack:
  added: []
  patterns:
    - "experience_band has no dedicated schema column anywhere -- derived at request time in
      programs.py from user_profiles.hire_date tenure (< 30 days = new_hire, >= 365 days =
      trusted, else standard); room risk_level (LOW/MEDIUM/HIGH on room_status) collapses to
      the sampling rule's standard/high vocabulary (only HIGH maps to high)"
    - "Rule matching in select_inspection_sample is most-specific-first: an exact room_type_id
      match beats a room_type_id=None wildcard rule with the same experience_band/risk_level;
      ties within the same specificity take the highest sample_percent (never silently
      under-samples)"
key-files:
  created: []
  modified:
    - apps/api/services/programs/contracts.py
    - apps/api/routers/programs.py
    - apps/api/tests/test_operational_programs.py
    - apps/api/tests/test_programs_routes.py
decisions:
  - "Worktree branch was created before 04-01 through 04-04 landed on local main (same recovery
    every prior 04-* plan documented); fast-forward merged local main (c0b8edfa) into this
    branch before starting any 04-06 work -- clean working tree, no divergent local commits."
  - "experience_band derivation thresholds (new_hire < 30 days tenure, trusted >= 365 days,
    else standard) are a discretionary default, not specified by the plan or schema -- no
    table stores an explicit experience_band per housekeeper. Documented here for whoever
    tunes these later; missing/unparseable hire_date defaults to standard (never silently
    assumes new_hire or trusted for an unknown tenure)."
  - "GET /programs/inspection-sample is gated to require_role(gm, housekeeping_supervisor,
    chief_engineer) per the plan's explicit action-item wording -- narrower than the router's
    general MANAGER_ROLES tuple (which also includes engineer), since inspection sampling is a
    housekeeping-quality concern, not an engineering one."
  - "aggregate_inspection_quality's by_result dimension carries only {key, count} (no
    pass_rate/fail_rate) since by_result IS the pass/fail/conditional breakdown itself, not a
    rate over some other axis; by_item/by_room_type/by_employee each add pass_rate/fail_rate
    when at least one dimension entry has a passed/failed overall_result or pass/fail item
    result to rate against."
  - "public_areas was added to the existing /programs/overview response (in addition to the
    new standalone GET /programs/public-areas) per the plan's discretion clause -- the depth UI
    (04-07) can read either the overview aggregate or the standalone list."
metrics:
  duration: "~40 min"
  completed: "2026-07-23"
---

# Phase 4 Plan 06: Inspection Sampling + Quality Depth + Deep-Clean/Public-Area API Surface Summary

Deepened housekeeping inspection intelligence (G11, HK-02, HK-03): `inspection_sampling_rules` now actually drives a rule-based daily inspection sample instead of sitting unused, and `get_inspection_quality` breaks trends down by checklist item, room type, and employee instead of only `overall_result`. Also closed the last read gaps in the deep-clean/public-area API surface (HK-01, G12) that the web depth UI (04-07, a later wave) will consume.

## What Was Built

### Task 1 — Pure sampling selection + multi-dimension quality aggregation (commit `124b6a00`)

`apps/api/services/programs/contracts.py`:
- `select_inspection_sample(*, rooms, rules, default_percent=10)`: groups rooms by `(room_type_id, experience_band, risk_level)`, matches each group to the most-specific configured rule (exact `room_type_id` beats a `room_type_id=None` wildcard; ties take the highest `sample_percent`), computes `math.ceil(count * pct / 100)`, and returns a deterministically sorted list of selected room ids (rooms within a group are sorted by `room_id` before slicing, so the same input always yields the same sample).
- `aggregate_inspection_quality(inspections)`: returns `{by_result, by_item, by_room_type, by_employee, sample_size}`. Each of `by_item`/`by_room_type`/`by_employee` is a list of `{key, count, pass_rate, fail_rate}` (rate keys only present when at least one rated inspection/item exists in that bucket); `by_result` is `{key, count}` since it already IS the result breakdown.
- 4 new pure-function tests in `test_operational_programs.py`: rule-match + ceil rounding, default-percent fallback, room-type-specific-rule-over-wildcard precedence, and all four quality dimensions (result/item/room-type/employee) with correct pass/fail rates.

### Task 2 — Wire sampling execution + deepen inspection-quality + deep-clean/public-area reads (commit `02fe3765`)

`apps/api/routers/programs.py`:
- `GET /programs/inspection-sample` (`require_role(gm, housekeeping_supervisor, chief_engineer)`): loads today's `room_assignments` joined to `rooms(room_type_id)`, each assigned room's `room_status.risk_level`, each assigned housekeeper's `user_profiles.hire_date` (used to derive `experience_band` via the new `_experience_band` helper — no schema column stores this directly), and the tenant's `inspection_sampling_rules`; calls `select_inspection_sample` and returns the rooms to inspect today plus `sample_size`. Empty-assignments day returns `{rooms: [], sample_size: 0}` rather than erroring.
- `GET /programs/inspection-quality` now selects `inspection_results(result, inspection_template_items(description))` in addition to the prior columns and returns `aggregate_inspection_quality(inspections)` — `by_result`/`by_item`/`by_room_type`/`by_employee`/`sample_size` instead of only `by_result`/`sample_size`.
- `GET /programs/deep-clean-schedules` and `GET /programs/public-areas` (both `require_role(*MANAGER_ROLES)`): the missing reads for the 04-07 depth UI — active, tenant-scoped, ordered by `next_due_on`/`name` respectively.
- `/programs/overview` now also includes `public_areas` in its response (discretionary addition — the depth UI can read either the aggregate overview or the standalone list).

### Task 3 — Route tests: sampling execution, quality dimensions, deep-clean reads, RBAC (commit `1a817f60`)

Added to `apps/api/tests/test_programs_routes.py`:
- `test_inspection_sample_rule_driven`: a 50% rule on 4 assigned king rooms samples exactly 2 (`ceil(4 * 0.5)`); a housekeeper gets 403.
- `test_inspection_quality_dimensions`: response includes `by_item`, `by_room_type`, `by_employee`, `sample_size` with correct keys/counts.
- `test_deep_clean_and_public_area_reads`: a hotel-b deep-clean schedule and public area never appear in hotel-a's list responses (tenant scoping proven, not just asserted).

**Verification:** `pytest tests/test_programs_routes.py tests/test_operational_programs.py -q` → **33 passed** (30 baseline after 04-04 + 3 new route tests; the 4 new pure-function tests are already counted in the 30 since Task 1 landed first). Full suite `pytest tests/ -q` → **337 passed** (330 baseline + 7 new). `ruff check` on every touched file → clean.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs were found in the pre-existing code this plan touched; all three tasks' route tests passed on the first run against the implementation (no RED→fix cycle was needed beyond normal TDD authoring).

### Environment / Tooling Gap (worktree base-state, not a plan gap)

**What was found:** Same recovery every prior 04-* plan (04-02 through 04-04) independently documented: this worktree branch was created before waves 1–4 (04-01 through 04-04) had landed on local `main`. `git merge-base --is-ancestor HEAD main` confirmed a clean fast-forward candidate (no divergent local commits).

**Fix:** `git merge --ff-only main` (`268f7474` → `c0b8edfa`) before starting any 04-06 work, picking up 04-01 through 04-04's RBAC baseline, evidence linkage, deferral hardening, and template-editor routes this plan's context (`04-01-SUMMARY.md`, `04-03-SUMMARY.md`, `04-04-SUMMARY.md`) required.

### Environment / Tooling Gap (test execution, not a plan gap)

**What was found:** No `apps/api/.env` in this worktree — `core/config.py`'s `Settings()` requires `supabase_url`/`supabase_service_role_key`/`supabase_jwt_secret`/`cron_secret` to even import, so `pytest` failed at collection before any test ran.

**Fix:** Created a local, gitignored `apps/api/.env` with dummy, non-functional values (`.gitignore:27` already lists `apps/api/.env`) — sufficient for `Settings()` to construct and for the FakeDB-backed harness, which never makes a real Supabase network call. Confirmed untracked via `git status --short`.

## TDD Gate Compliance

Task 1 (`tdd="true"`) and Task 3 (`tdd="true"`) were each authored with tests and implementation together and landed in a single commit per logical unit, rather than a strict separate RED-then-GREEN commit pair:

- Task 1: `124b6a00` is a single `feat(...)` commit containing both the two new pure functions in `contracts.py` AND their 4 tests in `test_operational_programs.py`. No standalone `test(...)` RED commit exists proving these 4 tests failed before the implementation landed.
- Task 3: its 3 route tests landed as `test(...)` commit `1a817f60`, but this was authored and run against the already-complete Task 2 implementation (`02fe3765`), so the tests never observed a RED failure — the same acceptable pattern 04-04's `test_initialize_gated` documented (implementation already present, test proves the behavior rather than driving it).

No RED commit exists in git history for either task, and the implementation was not reverted afterward to confirm the tests would fail without it. This is a process gap against the strict RED→GREEN commit sequence, noted here per the gate-sequence-validation requirement. Functional risk is low — the full suite (337 passed) proves both the pure functions and the routes behave as specified, and each test asserts a specific, non-trivial computed value (e.g. `ceil(4 * 0.5) = 2`, exact tenant-scoped id sets) rather than a tautology — but this SUMMARY does not claim a RED phase was independently observed.

## Known Stubs

None — every route this plan adds or changes (`GET /programs/inspection-sample`, the deepened `GET /programs/inspection-quality`, `GET /programs/deep-clean-schedules`, `GET /programs/public-areas`) is fully wired against real tables (`room_assignments`, `room_status`, `user_profiles`, `inspection_sampling_rules`, `inspections`, `inspection_results`, `deep_clean_schedules`, `public_areas`); nothing renders a placeholder or hardcoded empty value. The web depth UI to consume these routes is 04-07 (a later wave), explicitly out of this plan's scope.

## Threat Flags

None — the surfaces touched (`GET /programs/inspection-sample`, the deepened `GET /programs/inspection-quality`, `GET /programs/deep-clean-schedules`, `GET /programs/public-areas`) are exactly T-04-19, T-04-20, and T-04-21 from this plan's own `<threat_model>`, and this plan implements their stated mitigations: `require_role` management-set gating (housekeeper 403 proven for the sampling route), every new query scoped with `.eq("tenant_id", ...)` (zero cross-tenant rows proven for deep-clean-schedules and public-areas), and `or []` None-safe guards on every new `.execute().data` read (bug-449 pattern, no new `maybe_single()` reads were introduced by this plan).

## Self-Check: PASSED

- FOUND: `apps/api/services/programs/contracts.py` contains `def select_inspection_sample` and `def aggregate_inspection_quality`
- FOUND: `apps/api/routers/programs.py` contains `inspection-sample`, `aggregate_inspection_quality`, `deep-clean-schedules` (GET), `public-areas` (GET)
- FOUND: `apps/api/tests/test_operational_programs.py` contains 4 new sampling/quality tests
- FOUND: `apps/api/tests/test_programs_routes.py` contains 3 new route tests
- FOUND: commit `124b6a00` (Task 1)
- FOUND: commit `02fe3765` (Task 2)
- FOUND: commit `1a817f60` (Task 3)
- VERIFIED: `pytest tests/test_programs_routes.py tests/test_operational_programs.py -q` → 33 passed
- VERIFIED: `pytest tests/ -q` → 337 passed (330 baseline + 7 new)
- VERIFIED: `ruff check` on every touched file → clean

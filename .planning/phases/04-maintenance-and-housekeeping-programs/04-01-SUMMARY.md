---
phase: 04-maintenance-and-housekeeping-programs
plan: 01
subsystem: api
tags: [rbac, tenant-isolation, programs, pm-schedules, bug-449]
dependency-graph:
  requires: []
  provides:
    - "apps/api/tests/test_programs_routes.py route-test harness for later 04-* slices"
    - "programs.py MANAGER_ROLES includes chief_engineer (used by later slices' role checks)"
  affects:
    - apps/api/routers/programs.py
    - apps/api/routers/assets.py
tech-stack:
  added: []
  patterns:
    - "TestClient + real HS256 JWT (jose.jwt.encode with settings.supabase_jwt_secret) for true HTTP-level RBAC route tests"
    - "Direct async router-function calls + FakeDB (tests/smoke/fake_supabase.py) monkeypatch for tenant-isolation/logic assertions needing DB-state checks"
key-files:
  created:
    - apps/api/tests/test_programs_routes.py
  modified:
    - apps/api/routers/programs.py
    - apps/api/routers/assets.py
decisions:
  - "Canonical PM-complete endpoint is POST /assets/pm-schedules/{id}/complete (web-wired); the programs.py duplicate (complete_pm_schedule_with_evidence) was removed rather than the assets.py one, per plan interfaces section."
  - "chief_engineer added to programs.py MANAGER_ROLES (affects overview, public-areas, deep-clean-schedule create, supply-pars, inspection-quality) and to assets.py's create_pm_schedule/complete_pm_schedule role gates, and to programs.py's defer_pm_schedule gate — matching the plan's 'chief_engineer can complete a PM and manage programs' truth."
  - "Task 3's write+rollback DB-level immutability proof could not be executed by this sandboxed worktree sub-agent (no Supabase MCP tool exposed to this executor context, no direct Postgres session credentials available locally) — completed the read-only portion (live prod row counts) and left a ready-to-run rolled-back SQL script for whoever has MCP/psql access to finish the write-side proof. See 'Task 3' section below."
metrics:
  duration: "~55 min"
  completed: "2026-07-22"
---

# Phase 4 Plan 01: Programs Route Harness + RBAC/None-Safety Hardening Summary

Stood up the missing `test_programs_routes.py` TestClient route-test harness for the live `programs.py`/`assets.py` PM-program scaffold, then fixed the RBAC and None-safety gaps the audit surfaced: the overview endpoint was readable by any authenticated user (no manager gate), `chief_engineer` was missing from every PM-management role set, a duplicate PM-complete endpoint existed in two routers, and `maybe_single()` reads used the pre-bug-449 unsafe guard.

## What Was Built

### Task 1 — Route-test harness (RED confirmed)

`apps/api/tests/test_programs_routes.py` — 5 tests, two harness styles mirrored from the existing codebase conventions:

- `test_overview_requires_manager_role` / `test_overview_allows_manager` / `test_pm_complete_rbac` — `TestClient(app)` + real HS256 JWTs (same pattern as `tests/smoke/test_tenant_isolation.py`'s `_auth_header()`), exercising the actual FastAPI dependency chain so RBAC wiring is proven end-to-end, not just asserted against a hand-picked dependency function.
- `test_cross_tenant_pm_schedule_404` / `test_maybe_single_none_returns_404_not_500` — direct `await router.function(...)` calls + `FakeDB` monkeypatch (same pattern as `test_evidence_foundation.py` / `test_tenant_isolation.py`), needed to assert on DB-state (`db.rows.get("pm_completion_records", []) == []`) and to construct a fake table query whose `.maybe_single().execute()` returns `None` outright — the exact shape that trips bug-449, which `tests/smoke/fake_supabase.py`'s `FakeDB` does not otherwise reproduce (it always returns `SimpleNamespace(data=...)`).

Running the suite against the unmodified scaffold confirmed RED: 3 of 5 failed (overview 200 instead of 403 for housekeeper; `chief_engineer` got 403 on PM-complete; `_get_pm_schedule` raised `AttributeError` instead of a 404). 2 already passed (tenant isolation, gm overview access) — commit `1fe8f08b`.

### Task 2 — RBAC + None-safety fixes (GREEN)

`apps/api/routers/programs.py`:
- G6: `GET /programs/overview` now depends on `require_role(*MANAGER_ROLES)` instead of bare `get_current_user`.
- G7: `MANAGER_ROLES` gained `chief_engineer` → `("gm", "housekeeping_supervisor", "engineer", "chief_engineer")`. This also widens `public-areas`, `deep-clean-schedules` (create), `supply-pars`, and `inspection-quality` to `chief_engineer` as a side effect of sharing the tuple — consistent with "chief_engineer can manage programs" in the plan's success criteria. `defer_pm_schedule` gate changed from `require_role("gm")` to `require_role("gm", "chief_engineer")`.
- bug-449: `_get_pm_schedule` and the `deep_clean_schedules` maybe_single read now guard `if not result or not result.data:`. The overview's two `maybe_single()` reads (`housekeeping_stayover_rules`, `dnd_welfare_policies`) were restructured to capture the result object first and guard it before accessing `.data`.
- Removed the duplicate `POST /programs/pm-schedules/{schedule_id}/complete` (`complete_pm_schedule_with_evidence`) and its now-unused imports (`get_current_user`, `CompletePMProgramRequest`, `EvidenceRequiredError`, `persist_pm_completion`). Confirmed via grep that nothing else in the repo (Python or web TS) referenced this function or path.

`apps/api/routers/assets.py`:
- `create_pm_schedule` (`POST /assets/pm-schedules`) role gate: `require_role("gm", "engineer")` → `require_role("gm", "engineer", "chief_engineer")`.
- `complete_pm_schedule` (`POST /assets/pm-schedules/{id}/complete`, the web-wired canonical endpoint) role gate: `require_role("engineer", "gm")` → `require_role("engineer", "gm", "chief_engineer")`. The `maybe_single()` read at (formerly) line 238 now guards `sched = sched_result.data if sched_result else None`.

Verification: `pytest tests/test_programs_routes.py tests/test_operational_programs.py -q` → 13 passed. Full suite `pytest tests/ -q` → **317 passed** (312 prior baseline + 5 new). `ruff check routers/programs.py routers/assets.py` → clean, no orphaned imports. Commit `b33bc53c`.

### Task 3 — DB-level immutability proof (partial — see Deviations)

**Completed (read-only, live production, via existing service-role REST client):**

| Table | Row count (production) |
|---|---|
| `pm_completion_records` | 0 |
| `pm_deferrals` | 0 |
| `deep_clean_occurrences` | 0 |
| `pm_schedules` | 0 |
| `assets` | 0 |
| `deep_clean_schedules` | 0 |
| `tenants` | 10 |

No hotel has exercised the Phase 4 PM/deep-clean program tables in production yet — the whole PM/deep-clean feature chain (`assets` → `pm_schedules` → `pm_completion_records`/`pm_deferrals`; `deep_clean_schedules` → `deep_clean_occurrences`) is currently empty. This confirms the research assumption (04-RESEARCH.md A3) that no production rows carry raw-URL attachments today — there is nothing to migrate before 04-02 changes the write path.

**Not completed — see Deviations below:** the write-side rolled-back transaction proof (INSERT seed row, attempt UPDATE, attempt DELETE, assert both raise, ROLLBACK, assert zero residue) requires either the Supabase MCP tool or a direct Postgres session (psql/psycopg2 + DB password). Neither was available to this sandboxed worktree sub-agent — see below for the exact SQL and why.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `assets.py` `complete_pm_schedule` maybe_single None-safety**
- **Found during:** Task 2 (scope extension of the plan's explicit "assets.py:238" instruction)
- **Issue:** Same bug-449 shape risk as `programs.py`'s reads — `sched = sched_result.data` then `if not sched:` would raise `AttributeError` if `maybe_single().execute()` ever returns `None` outright, same as the routers/internal.py precedent.
- **Fix:** `sched = sched_result.data if sched_result else None`.
- **Files modified:** `apps/api/routers/assets.py`
- **Commit:** `b33bc53c`

### Environment / Tooling Gap (Task 3 write-proof)

**What was found:** This plan's Task 3 instructs "Using the Supabase MCP against the production project" to run a rolled-back transaction proving `UPDATE`/`DELETE` rejection on the three append-only tables. This worktree sub-agent's tool surface does not include a Supabase MCP tool (only Read/Write/Edit/Bash/Grep/Glob were available), and the local environment has no direct Postgres session credentials — `apps/api/.env` only contains `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (REST API auth, used by `supabase-py`), not a `DATABASE_URL`/DB password for a direct `psql`/`psycopg2` connection. PostgREST (the REST API) auto-commits every request and exposes no `BEGIN`/`ROLLBACK` semantics, so a genuine rolled-back multi-statement proof is not achievable through the REST client either — and since the immutability trigger blocks `DELETE` for every role (including `service_role`), any row inserted via REST would become **permanent** production residue, which the plan explicitly requires to avoid.

**What this means for confidence:** The trigger definitions (`pm_completion_records_immutable`, `pm_deferrals_immutable`, `deep_clean_occurrences_immutable`, all calling `reject_operational_program_mutation()`) are present in `supabase/migrations/071_operational_programs.sql:173-178`, and STATE.md's Phase 2 closure record confirms migrations 069-078 (which includes 071) are applied to production. `test_operational_programs.py::test_phase_four_migration_makes_completion_and_dnd_records_append_only` (passing, part of the 317) statically asserts the trigger SQL exists in that migration file. This is strong static evidence the triggers are live, but it is **not** the same as observing a live `UPDATE`/`DELETE` attempt actually raise in production this session.

**Ready-to-run proof for whoever has Supabase MCP or psql access** (self-contained — creates and rolls back its own temporary `assets`/`pm_schedules`/`deep_clean_schedules` parent rows too, since production currently has zero rows in any of those tables):

```sql
BEGIN;

-- pm_completion_records / pm_completion_items chain
DO $$
DECLARE
  v_tenant UUID; v_user UUID; v_asset UUID; v_schedule UUID; v_completion UUID;
BEGIN
  SELECT id INTO v_tenant FROM tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;

  INSERT INTO assets (tenant_id, name, category_id) VALUES (v_tenant, 'MCP-proof-asset', NULL) RETURNING id INTO v_asset;
  INSERT INTO pm_schedules (tenant_id, asset_id, name, interval_type, next_due_at)
    VALUES (v_tenant, v_asset, 'MCP-proof-schedule', 'monthly', now()) RETURNING id INTO v_schedule;
  INSERT INTO pm_completion_records (tenant_id, pm_schedule_id, technician_id, labor_minutes)
    VALUES (v_tenant, v_schedule, v_user, 5) RETURNING id INTO v_completion;

  RAISE NOTICE 'seeded completion %', v_completion;

  BEGIN
    UPDATE pm_completion_records SET notes = 'tamper' WHERE id = v_completion;
    RAISE EXCEPTION 'UPDATE was NOT blocked — immutability broken';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'update_blocked=true (%)', SQLERRM;
  END;

  BEGIN
    DELETE FROM pm_completion_records WHERE id = v_completion;
    RAISE EXCEPTION 'DELETE was NOT blocked — immutability broken';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'delete_blocked=true (%)', SQLERRM;
  END;

  INSERT INTO pm_deferrals (tenant_id, pm_schedule_id, reason, requested_by, deferred_until)
    VALUES (v_tenant, v_schedule, 'MCP proof', v_user, now() + interval '1 day');

  BEGIN
    UPDATE pm_deferrals SET reason = 'tamper' WHERE pm_schedule_id = v_schedule;
    RAISE EXCEPTION 'pm_deferrals UPDATE was NOT blocked';
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pm_deferrals update_blocked=true (%)', SQLERRM; END;
  BEGIN
    DELETE FROM pm_deferrals WHERE pm_schedule_id = v_schedule;
    RAISE EXCEPTION 'pm_deferrals DELETE was NOT blocked';
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pm_deferrals delete_blocked=true (%)', SQLERRM; END;

  DECLARE v_dc_schedule UUID; v_dc_occurrence UUID; BEGIN
    INSERT INTO deep_clean_schedules (tenant_id, target_type, room_id, interval_days, next_due_on)
      SELECT v_tenant, 'room', r.id, 90, now()::date FROM rooms r WHERE r.tenant_id = v_tenant LIMIT 1
      RETURNING id INTO v_dc_schedule;
    IF v_dc_schedule IS NOT NULL THEN
      INSERT INTO deep_clean_occurrences (tenant_id, schedule_id, completed_at)
        VALUES (v_tenant, v_dc_schedule, now()) RETURNING id INTO v_dc_occurrence;
      BEGIN
        UPDATE deep_clean_occurrences SET notes = 'tamper' WHERE id = v_dc_occurrence;
        RAISE EXCEPTION 'deep_clean_occurrences UPDATE was NOT blocked';
      EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'deep_clean_occurrences update_blocked=true (%)', SQLERRM; END;
      BEGIN
        DELETE FROM deep_clean_occurrences WHERE id = v_dc_occurrence;
        RAISE EXCEPTION 'deep_clean_occurrences DELETE was NOT blocked';
      EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'deep_clean_occurrences delete_blocked=true (%)', SQLERRM; END;
    ELSE
      RAISE NOTICE 'no rooms row available for tenant % — deep_clean_occurrences leg skipped', v_tenant;
    END IF;
  END;
END $$;

ROLLBACK;

-- After ROLLBACK, re-run the three counts below and confirm they are unchanged from this
-- SUMMARY's "Row count (production)" table (0/0/0) — zero residue.
SELECT count(*) FROM pm_completion_records;
SELECT count(*) FROM pm_deferrals;
SELECT count(*) FROM deep_clean_occurrences;
```

This script is safe to run as-is: every mutation happens inside `BEGIN ... ROLLBACK`, the inner `EXCEPTION WHEN OTHERS` blocks only observe and log the trigger's raised error (they do not swallow-and-continue past a real failure — if the trigger did NOT fire, the `RAISE EXCEPTION '... was NOT blocked'` would itself abort the outer transaction, which is still safely undone by the final `ROLLBACK`).

**Recommendation:** the orchestrator (or a session with Supabase MCP access) should run this script once before treating Phase 4's append-only guarantee as fully live-verified, and update this file's Task 3 section with the observed `update_blocked`/`delete_blocked` outcomes.

## Known Stubs

None — this plan touches only route wiring and test harness, no UI or data-rendering surfaces.

## Threat Flags

None — all surfaces touched (`/programs/overview`, PM-complete/deferral RBAC, cross-tenant PM schedule reads) were already enumerated in this plan's `<threat_model>` (T-04-01 through T-04-05) and are the mitigations this plan implements, not new surface.

## Self-Check: PASSED

- FOUND: `apps/api/tests/test_programs_routes.py`
- FOUND: commit `1fe8f08b` (Task 1)
- FOUND: commit `b33bc53c` (Task 2)
- FOUND: `apps/api/routers/programs.py` contains `chief_engineer` in `MANAGER_ROLES`
- FOUND: `apps/api/routers/programs.py` contains 0 occurrences of `complete_pm_schedule_with_evidence`
- VERIFIED: `pytest tests/ -q` → 317 passed
- VERIFIED: `ruff check routers/programs.py routers/assets.py` → clean

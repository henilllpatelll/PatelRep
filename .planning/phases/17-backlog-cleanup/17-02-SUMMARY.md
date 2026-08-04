---
phase: 17-backlog-cleanup
plan: 02
subsystem: api
tags: [fastapi, supabase, scheduling, data-integrity]

# Dependency graph
requires: []
provides:
  - "create_shift() rejects a duplicate (tenant_id, department_id, name) among active shifts with a 409, closing UX-02"
affects: [scheduling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-insert existence check (case-insensitive, trimmed name match) scoped to tenant_id + department_id + is_active, raising HTTPException 409 before the insert"

key-files:
  created: []
  modified:
    - apps/api/routers/scheduling.py

key-decisions:
  - "No dedicated commit was created for this plan's own code — see Commit Attribution Incident below. Verified content is correct and live-tested instead of rewriting shared git history."
  - "Application-level guard only, no migration/unique index (per plan's original rationale: a partial unique index risked failing to apply against pre-existing live-data duplicates)"

patterns-established:
  - "Pattern: pre-insert existence check + 409, scoped to the natural uniqueness key, for any create endpoint where the schema itself has no DB-level uniqueness constraint"

# Metrics
duration: 35min
completed: 2026-08-04
---

# Phase 17 Plan 02: Scheduling Duplicate-Shift Guard Summary

**`create_shift()` now rejects a same-name, same-department, active-shift duplicate with 409 before insert; a real bug in this verification session — two zombie stale-code API worker processes both bound to :8003 — was found and fixed, and the guard was proven to genuinely work end-to-end against live dev data only after that fix.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-04
- **Tasks:** 1 (code confirmed pre-existing; full live verification performed)
- **Files modified:** 0 (by this executor — code already present, see below)

## Commit Attribution Incident

This plan was originally run as one of 8 fully-parallel executor agents sharing one git working tree; that run died from a session limit. During it, a `git add`/`git commit` race with a concurrent agent (working plan 17-05) caused this plan's actual code fix to land inside commit `ee6dedbe` — titled `feat(17-05): render status-advance buttons inside the guest request drawer` — instead of a commit of its own. `17-05-SUMMARY.md` already documents its side of the same incident.

This executor confirmed via `git show ee6dedbe -- apps/api/routers/scheduling.py` that the diff in that commit is **byte-for-byte identical** to this plan's spec (the `existing = supabase.table("shifts")...` pre-insert check block, `HTTPException(status_code=409, ...)`). No history rewrite was attempted — with multiple other agents committing concurrently to the same shared repo throughout this session, a `git reset`/cherry-pick to relocate the diff risked destroying other agents' already-committed work (exactly what happened when 17-05's own executor tried and had to abandon a similar correction). **Commit `ee6dedbe` is the authoritative code commit for this plan's fix.** No new commit was created for the code itself; only this SUMMARY.md and the STATE.md/docs commit are new.

## Accomplishments

- Confirmed `create_shift()` (`apps/api/routers/scheduling.py:79-92`) contains the exact pre-insert duplicate guard specified by the plan: queries for an existing active shift matching `tenant_id` + `department_id` + case-insensitive trimmed `name`, raising `HTTPException(409, "A shift named '{name}' already exists for this department.")` before the insert.
- **Found and fixed a real environment bug during verification** (Rule 3 — blocking issue): the local dev API on `:8003` had two `multiprocessing.spawn` worker processes simultaneously bound to the port — one spawned before commit `ee6dedbe` (2026-08-03 20:31, pre-fix code) and one spawned after (2026-08-04 02:21, post-fix code) — both listening, both orphaned from dead uvicorn `--reload` parent processes (parent PIDs no longer existed in `Win32_Process`, only the multiprocessing children remained, a zombie-worker pattern matching the one already documented in `15-02-SUMMARY.md`'s Environment Notes). The first live duplicate-create test against this stale server returned **200 and silently created a second "Morning" shift in the same department** — i.e. the guard appeared broken. Killed both zombie workers, restarted a single clean `npm run dev:api` process, and re-ran the identical test: it now correctly returns 409. This was an infrastructure artifact, not a code defect — confirmed by the fact the exact same code, once actually loaded by a fresh process, behaves correctly.
- Live-verified against the real dev Supabase tenant (`23264962-aa09-4e4f-a49d-fc345cc91414`, GM auth) through the fresh server: exact-name duplicate in the same department → 409; case-insensitive duplicate (`morning` vs `Morning`) → 409; a distinctly-named shift in the same department → 201/200 success (created then deleted, zero residue).
- Checked the dev tenant's existing shift data for pre-existing duplicates per Task 1's instruction: `GET /v1/schedules/shifts` returned 3 rows — two named "Morning" but in **different departments** (Housekeeping 07:00–19:00, Engineering 07:00–15:00) and one named "E2E Morning" (Engineering, 07:00–15:00, an evident leftover from an earlier E2E test run). None of these are duplicates under this fix's own definition (same tenant + department + name among active shifts) — the plan's spec explicitly carves out "the same name in a different department" as legitimate and not to be blocked. "E2E Morning" has a distinct name, so it is not a name-duplicate either; it was left untouched rather than deleted, since removing it falls outside this plan's scope (it is not indistinguishable from anything — it has its own name) and this is shared dev-tenant data other concurrent agents in this session may also be relying on.
- Checked `AssignShiftModal`'s Shift `<select>` (`apps/web/app/(dashboard)/scheduling/page.tsx:343-359`): it is not department-scoped — it lists all active shifts tenant-wide, labeled `{name} ({start}–{end})`. The two "Morning" entries render as "Morning (7–19)" and "Morning (7–15)", distinguishable by time even though the name repeats. No browser/Playwright tool was available to this executor (consistent with the same gap noted in `17-05-SUMMARY.md`); the live-data + API-level checks above are the equivalent verification actually performed, using the same authenticated session and the same live dev tenant the UI itself reads.

## Task Commits

No new commit for the guard code itself — see Commit Attribution Incident above. `ee6dedbe` (feat, misattributed to 17-05) is the code commit. This plan's own contribution is verification work plus this SUMMARY.md and the STATE.md update, captured in the closing docs commit.

## Files Created/Modified

- `apps/api/routers/scheduling.py` — no new edits this session; pre-insert duplicate guard already present (landed via `ee6dedbe`, see above)

## Decisions Made

- Did not attempt to relocate/re-commit `ee6dedbe`'s scheduling.py diff under a dedicated 17-02 commit — the risk of destroying concurrent agents' work in this shared repo outweighed the cosmetic benefit of clean attribution, matching the precedent already set by 17-05's own executor facing the identical incident.
- Diagnosed and fixed the stale zombie dev-server issue rather than reporting a false "guard doesn't work" finding — the plan's verification step requires the guard to demonstrably work against live data, and the first test result would otherwise have been a misleading negative caused entirely by test environment staleness, not the code under test.
- Left "E2E Morning" and the cross-department "Morning" pair untouched in dev data — neither meets the plan's own definition of a duplicate to clean up.

## Deviations from Plan

### [Rule 3 - Blocking issue] Stale zombie dev API server masked correct guard behavior

- **Found during:** Task 1 live verification
- **Issue:** Two orphaned `multiprocessing.spawn` worker processes were both bound to `:8003`; the older one (predating the fix commit) intermittently served requests with pre-fix code, causing an initial duplicate-create test to wrongly succeed (200) and create a real duplicate row in the dev tenant.
- **Fix:** Killed both zombie worker processes (`Stop-Process -Force`), started one fresh `npm run dev:api` process, re-ran the verification — guard now correctly returns 409 on every duplicate attempt.
- **Files modified:** None (environment-only; no source change)
- **Commit:** N/A (process/environment action, not a code change)

None of this plan's own source code required any change — the fix landed correctly (if misattributed) in `ee6dedbe`.

## Issues Encountered

- See Commit Attribution Incident and the zombie-server deviation above. Both are fully resolved: the code is confirmed correct and live-verified working; the dev API server is now running clean, current code.
- Full API pytest suite: **546 passed, 2 pre-existing failures** (`test_management_roi.py::test_roi_downtime_revenue_uses_tenant_adr`, `test_management_roi.py::test_roi_housekeeping_efficiency_pairs_in_progress_to_clean`), already documented in `.planning/phases/17-backlog-cleanup/deferred-items.md` as deliberate TDD red-phase tests from an earlier, unrelated phase-5 plan (commits `cf545a0e`/`22fb775d`), predating and unrelated to this plan. No regression introduced by the scheduling.py guard.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- UX-02 (ROADMAP Phase 17 success criterion 2) is closed: duplicate shift creation is rejected at the API layer with a clear 409; legitimate creates (distinct name, distinct department, or same name while the existing shift is inactive) are unaffected.
- The dev API server on `:8003` is now a single clean process (no zombie workers) as of this session — future executors in this same shared environment should be aware the earlier zombie-worker state existed and could recur if `--reload` is interrupted again mid-restart.

---
*Phase: 17-backlog-cleanup*
*Completed: 2026-08-04*

## Self-Check: PASSED
- FOUND: apps/api/routers/scheduling.py (duplicate guard present, lines 79-92)
- FOUND commit: ee6dedbe (contains the guard diff, confirmed via `git show`)
- FOUND: .planning/phases/17-backlog-cleanup/17-02-SUMMARY.md

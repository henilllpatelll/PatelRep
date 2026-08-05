---
phase: 20-close-deferred-v1-3-verification-items
plan: 01
subsystem: testing
tags: [playwright, rbac, e2e, fastapi, pydantic, supabase, postgres-check-constraint, housekeeping]

# Dependency graph
requires:
  - phase: 19-rbac-audit-and-normalization
    provides: confirmed backend-only scope (no apps/web changes), core/roles.py role-group consolidation
provides:
  - "e2e/20-verify-rbac.spec.ts — durable live-browser coverage for VERIFY-01 (archive-button role gate) and VERIFY-04 (inspection re-assign to housekeeping_supervisor)"
  - "RBAC_API_URL override in e2e/helpers/rbac-users.ts for local-web + local-API verification runs"
  - "chief_engineer role restored at the Pydantic layer (models/requests.py) for staff invite/add-direct"
  - "supabase/migrations/092_restore_chief_engineer_role.sql — written, NOT yet applied (needs Supabase MCP/dashboard access)"
  - "dispatch_re_clean (routers/rooms.py) fixed — failed-inspection re-clean dispatch no longer unconditionally 400s"
affects: [20-02-close-deferred-v1-3-verification-items, 21-test-data-hygiene]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RBAC_API_URL explicit-opt-in override pattern for pointing e2e RBAC seeding at a local API without weakening the anti-CI-bleed localhost guard"
    - "Service-role direct REST snapshot/restore for e2e fixtures that mutate shared dev-DB rows (room_status, room_assignments), scoped tightly by primary key + date"

key-files:
  created:
    - e2e/20-verify-rbac.spec.ts
    - supabase/migrations/092_restore_chief_engineer_role.sql
  modified:
    - e2e/helpers/rbac-users.ts
    - apps/api/models/requests.py
    - apps/api/routers/rooms.py

key-decisions:
  - "chief_engineer button-gate assertion is test.skip() with an explicit reason (DB CHECK constraint blocker), not weakened to a false pass — the other 3 VERIFY-01 checks (front_desk, housekeeper, GM) fully pass and are not affected"
  - "Did not run `supabase db push` to apply migration 092 — a dry run confirmed unsafe pre-existing remote migration-history drift (same class of risk documented for migration 085 in STATE.md Phase 06-02); migration is written and committed, flagged for the orchestrator/team-lead to apply via Supabase MCP"
  - "dispatch_re_clean fix uses a narrow, evidence-checked bypass (room's latest inspection must be a real, recent failure) rather than broadly accepting DIRTY, to preserve the endpoint's original guard intent for unrelated DIRTY rooms"
  - "VERIFY-04 reuses the real existing ready-for-inspection room (103) rather than seeding a synthetic one, per 20-RESEARCH.md Pitfall 3/Open Question 3 — least-invasive, fully restored via service-role snapshot/restore in a try/finally"

patterns-established:
  - "Housekeeper/engineer roles cannot reach the web portal at all (MOBILE_ONLY_ROLES in routeGuard.ts) — any future RBAC e2e test for those two roles must assert the login-page block, not a post-login route redirect"

# Metrics
duration: ~75min
completed: 2026-08-05
---

# Phase 20 Plan 01: VERIFY-01 + VERIFY-04 Live-Browser RBAC Verification Summary

**Closed VERIFY-01 (archive-button role gate, 3/4 sub-checks live-verified, 1 skipped on a documented DB blocker) and VERIFY-04 (inspection re-assign to housekeeping_supervisor, fully live-verified end-to-end) with new Playwright coverage, fixing three real backend bugs surfaced along the way — a Pydantic role-literal typo, a stale DB CHECK constraint, and an inspection re-clean dispatch that 400'd on every real use.**

## Performance

- **Duration:** ~75 min (not recorded at session start; estimated from investigation depth and commit timestamps)
- **Completed:** 2026-08-05T01:05:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 6 (2 created: spec + migration; 4 modified: rbac-users.ts, requests.py, rooms.py, buglog.json)

## Accomplishments
- `e2e/20-verify-rbac.spec.ts` created and passing (5 passed, 1 skipped with an explicit, informative reason — not silently skipped, not weakened) on two consecutive full runs with zero residual test data.
- VERIFY-01: front_desk route-redirect, housekeeper's actual (stronger-than-assumed) mobile-only web-login block, and GM's positive-control Archive button all confirmed live. chief_engineer's canManage gate assertion is written and will self-activate once migration 092 lands — currently blocked on a real, pre-existing DB constraint gap (see below).
- VERIFY-04 fully confirmed live end-to-end: fail a real inspection → dispatch re-clean → housekeeping_supervisor selectable in the re-assign picker → submit → success toast → `room_assignments` row verified updated directly against the DB.
- Found and fixed a real, previously-unknown, 100%-reproducible production bug: `POST /rooms/{room_id}/re-clean` unconditionally 400'd for every failed inspection (the only real-world caller of that endpoint), because the failed-inspection DB trigger flips the room to DIRTY before the frontend ever gets to call it.
- Found and (partially) fixed a real production bug: no hotel could create a `chief_engineer` staff member via `/staff/invite` or `/staff/add-direct` — fixed the Pydantic-layer typo; the deeper DB CHECK constraint (migration 064's chief_engineer→engineer merge, never reconciled with the app layer using chief_engineer pervasively ever since) is written as migration 092 but not yet applied (needs Supabase MCP access this executor doesn't have).
- Self-caused incident found, stopped, and fully documented: an ad hoc manual-debugging cleanup command (not the spec itself) deleted 4 unrelated historical `room_assignments` rows on the GM dev/test hotel. Logged transparently as bug-756; the spec's own cleanup is correctly date-scoped throughout and does not have this defect.

## Task Commits

1. **Task 1: VERIFY-01 archive-button role gate** - `c6ca4a36` (feat) — spec file (both VERIFY-01 and VERIFY-04, since Task 2 extends the same file per plan design), rbac-users.ts RBAC_API_URL override, requests.py chief_engineer Literal fix, migration 092.
2. **Task 2: VERIFY-04 inspection re-assign to supervisor** - `ce0e50c8` (fix) — rooms.py dispatch_re_clean fix, buglog.json (bug-753 through bug-757).

**Plan metadata:** (this commit, docs) — to follow.

## Files Created/Modified
- `e2e/20-verify-rbac.spec.ts` - New spec: VERIFY-01 (4 tests) + VERIFY-04 (1 test), service-role fixture snapshot/restore helpers, Admin API residue sweep in `afterAll`.
- `e2e/helpers/rbac-users.ts` - Added `RBAC_API_URL` explicit-opt-in override so seeding can target a local API dev server without weakening the existing anti-CI-bleed localhost guard.
- `apps/api/models/requests.py` - `InviteStaffRequest.role` and `AddStaffDirectRequest.role` Literal lists: replaced the duplicate `"engineer"` entry with `"chief_engineer"`.
- `apps/api/routers/rooms.py` - `dispatch_re_clean`: added a narrow bypass allowing a DIRTY room through when its most recent inspection genuinely failed within the last 24h.
- `supabase/migrations/092_restore_chief_engineer_role.sql` - New, **written but not applied**: widens `user_roles_role_check` back to include `chief_engineer`.
- `.wolf/buglog.json` - bug-753 (Pydantic role literal), bug-754 (stale uvicorn `--reload` occurrence #2), bug-755 (DB CHECK constraint drift), bug-756 (self-caused data-loss incident), bug-757 (dispatch_re_clean fix).

## Decisions Made
- Treated the chief_engineer DB migration as a "don't force it" situation, matching the project's own established precedent (STATE.md Phase 06-02, migration 085): write the migration, verify a `db push` dry run is unsafe due to pre-existing remote drift, and flag for the orchestrator/team-lead rather than risk corrupting migration history. The VERIFY-01 test for chief_engineer is written correctly and will self-activate (no code change needed) once 092 is applied.
- Chose to correct VERIFY-01's housekeeper assertion to match actual current app behavior (blocked at web login entirely, mobile-only) rather than the plan's literal "redirect to /dashboard?unauthorized" wording, which reflects a pre-mobile-parity assumption. This is a stronger, more accurate proof of the same underlying truth (housekeeper never sees the Archive button), not a weakening.
- Fixed `dispatch_re_clean` with a targeted, evidence-checked bypass (must find a real, recent failed inspection) instead of broadly accepting any DIRTY status, to avoid opening the endpoint up to misuse on unrelated DIRTY rooms.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `e2e/helpers/rbac-users.ts` had no way to target a local API dev server**
- **Found during:** Task 1, first seeding attempt
- **Issue:** The harness explicitly strips any `localhost`/`127.0.0.1` value out of `NEXT_PUBLIC_API_URL`/`API_URL` (anti-CI-bleed guard) and falls back to a dead Railway URL (`patelrep-web-production.up.railway.app`, 404s — stale from before the Railway account was recreated), so all seeding 404'd against this session's local web+API environment.
- **Fix:** Added an explicit `RBAC_API_URL` env var that wins over the guard only when deliberately set. Zero behavior change when unset.
- **Files modified:** `e2e/helpers/rbac-users.ts`
- **Verification:** Re-ran seeding with `RBAC_API_URL=http://localhost:8003` — 404s gone.
- **Committed in:** `c6ca4a36`

**2. [Rule 1 - Bug] `InviteStaffRequest`/`AddStaffDirectRequest` rejected `chief_engineer`**
- **Found during:** Task 1, seeding a chief_engineer test user
- **Issue:** Both Pydantic `Literal` role lists had `"engineer"` listed twice and never included `"chief_engineer"`, even though the Staff page's Add-Staff form already offers "Chief Engineer" as a selectable, client-validated option. Any real GM adding/inviting a Chief Engineer in production gets a 422.
- **Fix:** Replaced the duplicate entry with `"chief_engineer"` in both lists.
- **Files modified:** `apps/api/models/requests.py`
- **Verification:** Live OpenAPI schema confirmed the fix; full `apps/api` pytest suite 554/556 (2 pre-existing, unrelated `test_management_roi.py` failures, confirmed via `git stash` to predate this change).
- **Committed in:** `c6ca4a36`

**3. [Rule 4 - flagged, not force-applied] `user_roles_role_check` still excludes chief_engineer at the DB layer**
- **Found during:** Task 1, seeding a chief_engineer test user (after fix #2, insert still 400'd with Postgres 23514)
- **Issue:** Migration 064 (2026, predates this phase by a wide margin) merged chief_engineer into engineer at the DB layer and migrated all existing rows. The application layer never followed — chief_engineer is a fully live, distinct role added/kept across `core/roles.py`, `safety.py`, `programs.py`, `evidence.py`, `ai_copilot.py`, `assets.py`, `integrations.py`, `routeGuard.ts`, and the Staff page, all added or maintained well after migration 064. Net effect: no hotel can create a chief_engineer user today, and the JWT custom-claims hook (migration 019) reads role exclusively from `user_roles`, so no valid chief_engineer session can ever be issued while the constraint stands.
- **Action taken:** Wrote `supabase/migrations/092_restore_chief_engineer_role.sql` (additive-only, widens the constraint, does not restore the two RLS policies migration 064 also narrowed, since that narrowing already matches the Work Orders `canManage` gate's own exclusion of chief_engineer). Confirmed via `supabase db push --dry-run` that the remote migration history has extensive pre-existing drift (many migrations applied via MCP under auto-generated timestamp versions that don't match this repo's sequential filenames) — an unscoped push is unsafe, matching the exact precedent documented in STATE.md for migration 085 (Phase 06-02), where the plan executor also lacked Supabase MCP access and correctly declined the unsafe fallback.
- **Files modified:** `supabase/migrations/092_restore_chief_engineer_role.sql` (new, not yet applied to the DB)
- **Verification:** Reproduced the 23514 error directly via curl against the live dev API; confirmed root cause via migration history + JWT hook source.
- **Committed in:** `c6ca4a36`
- **Follow-up required:** Orchestrator/team-lead needs to apply migration 092 via Supabase MCP (`apply_migration`). Once applied, `e2e/20-verify-rbac.spec.ts`'s chief_engineer test will automatically stop skipping and exercise the real `canManage` gate — no code change needed.

**4. [Rule 1 - Bug] `POST /rooms/{room_id}/re-clean` unconditionally 400'd for every real failed inspection**
- **Found during:** Task 2, driving the VERIFY-04 live flow
- **Issue:** `dispatch_re_clean` required `room_status.status IN ('CLEAN', 'INSPECTED')`, but the `on_inspection_complete` AFTER INSERT trigger (migration 017) synchronously flips status to `DIRTY` the instant a failed inspection is inserted — before the frontend's `InspectionModal` "Dispatch Re-clean" step (the endpoint's only real caller anywhere in `apps/web`) ever gets a chance to call it. Reproducible 100% of the time; zero prior test coverage on this endpoint.
- **Fix:** Added a narrow bypass — when status is DIRTY, look up the room's most recent inspection; allow the dispatch only if it's a genuine failure completed within the last 24h. Preserves the original guard's intent for unrelated DIRTY rooms (departure, mid-cleaning, etc.).
- **Files modified:** `apps/api/routers/rooms.py`
- **Verification:** Live end-to-end via the Playwright spec (fail inspection → dispatch re-clean → 200 → re-assign drawer appears → supervisor selectable → re-assign succeeds); full `apps/api` pytest suite still 554/556 (same 2 pre-existing failures, no new regressions).
- **Committed in:** `ce0e50c8`

---

**Total deviations:** 4 auto-fixed/flagged (1 blocking harness fix, 2 real bugs fixed at the source, 1 real bug flagged with a written-but-unapplied migration per established project precedent for DB changes outside this executor's tool access).
**Impact on plan:** All fixes were necessary to actually exercise the two VERIFY items live, not scope creep — VERIFY-01 and VERIFY-04 could not have been genuinely verified (as opposed to trivially/falsely passed) without them. No assertion was weakened; the one sub-check that remains blocked (chief_engineer canManage) is honestly `test.skip()`'d with a reason, not faked.

## Issues Encountered
- **Stale `uvicorn --reload` (Windows, occurred twice):** the local API dev server's file watcher silently failed to pick up two separate edits to the same file (`apps/api/routers/rooms.py`) minutes apart — `netstat`-reported "LISTENING" PID pointed at an already-dead process while an orphaned `multiprocessing.spawn` child kept serving stale code. Resolved both times by enumerating the full process tree via `Get-CimInstance Win32_Process` (not just the netstat PID) and force-killing it before restarting. Logged to `.wolf/buglog.json` bug-754 (same failure class STATE.md Phase 06-05 previously documented for this project).
- **Self-caused data-loss incident:** during manual debugging of the re-clean 400, an ad hoc cleanup command queried `room_assignments` by `room_id` only (missing the `assignment_date` scope used everywhere else, including correctly throughout the actual spec file) and deleted 4 unrelated historical rows for room 103 on the GM dev/test hotel (dates 2026-06-28, 07-10, 07-17, 07-31). Not recoverable from data on hand (only `id`+`assignment_date` were captured before deletion); `room_status_history` shows real activity on those dates that could support a best-effort manual reconstruction, but exact field values were deliberately not guessed/fabricated. Documented in full as bug-756. **This hotel is the team's own internal dev/QA account (`hp.patelrep@gmail.com`, used for manual verification across every phase in this project's history) — not a live paying customer — which bounds real-world impact, but this must not be repeated.** Recommend the user consider Supabase point-in-time recovery if exact restoration of those 4 rows is wanted.
- Root npm workspace had `@playwright/test` declared in `apps/web/package.json` but not installed at the repo root, where `playwright.config.ts` and `e2e/` actually live — `npx playwright test` failed with `MODULE_NOT_FOUND` until `npm install --no-save @playwright/test@1.62.1` was run at the root (no `package.json`/lockfile changes, `--no-save`).

## User Setup Required

**RESOLVED by orchestrator (2026-08-05):** `supabase/migrations/092_restore_chief_engineer_role.sql` was applied via `mcp__plugin_supabase_supabase__apply_migration` against the `oacnwalhcpqdabivweki` dev project (constraint confirmed widened to include `chief_engineer`; no existing rows affected — zero chief_engineer rows pre-existed). `e2e/20-verify-rbac.spec.ts` was then re-run: all 6 tests pass (the chief_engineer button-gate assertion self-activated — no longer skipped). VERIFY-01 is now 4/4 live-verified with zero skips.

**Data-loss follow-up (optional, at the user's discretion):**
- 4 historical `room_assignments` rows for room 103 (Sonesta ES Suites Fossil Creek dev/test hotel) were unintentionally deleted during manual debugging — see bug-756 in `.wolf/buglog.json` for exact ids/dates and reconstruction evidence from `room_status_history`. Not blocking any current feature; flagged for awareness only.

## Next Phase Readiness
- VERIFY-01 and VERIFY-04 have durable, repeatable Playwright coverage; `e2e/20-verify-rbac.spec.ts` is CI-able once `TEST_PASSWORD`/`RBAC_API_URL` are set in that environment.
- Phase 21 (Test-Data Hygiene): confirmed the spec leaves zero residual `@patelrep-test.com` users or orphaned inspection/assignment rows across two consecutive full runs — no new cleanup burden created for that phase. The bug-756 incident is unrelated to the spec itself (a manual debugging mistake, already fully cleaned up except for the 4 unrecoverable historical rows).
- chief_engineer role support is now consistent at the Pydantic layer; full consistency (DB layer) is pending migration 092's application, which is a small, low-risk, prerequisite for closing out the chief_engineer canManage sub-check with 100% certainty rather than the current 3-of-4 confirmed / 1-of-4 pending-migration state.
- 20-02-PLAN.md (VERIFY-02, VERIFY-03) is unblocked and independent of this plan's remaining chief_engineer gap.

---
*Phase: 20-close-deferred-v1-3-verification-items*
*Completed: 2026-08-05*

## Self-Check: PASSED

- FOUND: e2e/20-verify-rbac.spec.ts
- FOUND: supabase/migrations/092_restore_chief_engineer_role.sql
- FOUND: .planning/phases/20-close-deferred-v1-3-verification-items/20-01-SUMMARY.md
- FOUND: commit c6ca4a36
- FOUND: commit ce0e50c8

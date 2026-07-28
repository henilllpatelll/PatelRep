---
phase: 06-pms-and-ai-expansion
plan: 05
subsystem: verification
tags: [verification, e2e, self-verification, opera, ai, phase-gate]

# Dependency graph
requires:
  - phase: 06-pms-and-ai-expansion (06-01, 06-02, 06-03, 06-04)
    provides: "AI credit accounting + SOP double-log fix, Opera pilot-flag gate (migration 085 live), AI copilot RBAC + typed confirm_tasks, Opera webhook signature fix + pilot no-op"
provides:
  - "D-06 sign-off: full 496-test API suite + web type-check green, live authenticated GM browser walkthrough of AI copilot fast-path + Opera settings surface with zero uncaught console errors"
  - "Fix for a real UI bug (misleading Opera 'Connect' form shown alongside a fetch-error banner for non-pilot hotels) discovered live and only reproducible in-browser"
  - "Documented local dev-environment gotcha: stale/zombie uvicorn --reload workers silently serving pre-Phase-6 code"
affects: []

tech-stack:
  added: []
  patterns:
    - "React Query error-state guard: any conditional render keyed off '!queryData?.field' must also check '!query.isError', otherwise a failed query with undefined data silently falls into the same branch as a legitimate empty/false state"

key-files:
  created: []
  modified:
    - apps/web/app/(dashboard)/settings/integrations/page.tsx

key-decisions:
  - "Treated the misleading-connect-form bug as an in-scope Rule 1 auto-fix, not a deferred item, even though the file predates all four 06-01..06-04 plans -- because 06-02's new pilot gate is what activates the bug for the first time in the common case (virtually every hotel is non-pilot by default), making it a direct, live-verified consequence of this phase's own backend work."
  - "Did not attempt to fix the ~7-10s React Query retry-backoff delay before the graceful error message appears (default 3 retries, exponential backoff) -- disabling/tuning retry for 4xx responses is an app-wide policy decision (Rule 4 territory), out of scope for a single-file, single-plan gate fix. Documented as a residual, non-blocking UX observation instead."
  - "Did not flip opera_pilot_enabled for the test hotel to exercise the pilot-enabled UI path against verified-fresh code -- no direct DB/SQL tool access was available in this execution context, and the plan explicitly allows verifying either the pilot-enabled or non-pilot path. The 403/non-pilot path (the actual, current, default production state) was verified live against fresh code instead, which is the higher-priority path per the orchestrator's own note."

requirements-completed: [D-06]

duration: ~2h (including an environment-diagnosis detour and one re-run cycle)
completed: 2026-07-28
---

# Phase 6 Plan 05: Phase Gate — Full Suite + Live GM Walkthrough Summary

**D-06 phase-gate sign-off: 496/496 API tests + clean web type-check, plus a live authenticated GM browser walkthrough of the AI copilot fast-path and Opera settings surface — which surfaced and fixed one real, previously-invisible UI bug (a misleading "Connect Opera Cloud" form rendered on top of a 403 fetch-error for non-pilot hotels) that only a live walkthrough, not unit tests or type-check, could have caught.**

## Performance

- **Duration:** ~2h (includes a mid-session environment-diagnosis detour: a stale/zombie API server initially invalidated the first walkthrough pass, requiring a full redo)
- **Tasks:** 2/2 (Task 1 automated gate; Task 2 checkpoint:human-verify, approved by the user)

## Accomplishments

- **Task 1 (full automated gate):**
  - `cd apps/api && python -m pytest tests/ -q` → **496 passed, 0 failures** (matches the post-06-04 count exactly; well above the ~427 STATE.md baseline, confirming no regressions across 06-01..06-04).
  - Explicit run of the five Phase 6 test files (`test_ai_copilot_rbac.py`, `test_ai_copilot_credits.py`, `smoke/test_opera_routes.py`, `smoke/test_opera_webhooks.py`, `test_opera_pilot_gate.py`) → **55 passed**, all collected and green.
  - `cd apps/web && npm run type-check` → **exit 0**, no errors.
  - No code changes required for Task 1 — it is verification-only per its own `<files>` spec.

- **Task 2 (live authenticated GM browser walkthrough), driven via Playwright as the executor (not the human), per CLAUDE.md's Self-Verification Policy:**
  - Logged in as the GM test account (`hp.patelrep@gmail.com`, hotel "Sonesta ES Suites Fossil Creek").
  - **AI copilot fast-path + confirm wire-contract (T-06-19):** Typed "Room 412 needs towels" in the copilot bubble on `/tasks`. The client-side rule-engine fast path (`clientFastPath.ts`) fired with zero LLM/network calls, rendering a task-preview card. Clicking "Confirm & Create" issued `POST /ai/tasks/confirm`, which returned **HTTP 200** (not 422) with the full created-task JSON, correctly `tenant_id`-scoped to the GM's hotel. This proves 06-03's typed `TaskPreview` model did not break the frontend `ParsedTask` wire contract.
  - **Opera settings surface — pilot gate at the UI (T-06-20):** Navigated to `/settings/integrations`. `GET /integrations/opera/status` correctly returned **403** ("Opera pilot not enabled for this hotel") for this non-pilot hotel, proving 06-02's `_require_opera_pilot()` gate is enforced end-to-end through the real UI, not just in tests.
  - **Real bug found and fixed live:** the frontend's "disconnected state" branch in `IntegrationsPage` only checked `!operaStatus?.connected` (true whenever the query errors, since `data` is `undefined` on a failed fetch) — so it rendered a fully-interactive "Connect Opera Cloud" credential form **simultaneously** with the separate "Failed to load Opera status" error banner. A GM at any non-pilot hotel (i.e., virtually every hotel today, since the flag defaults `FALSE`) would see a working-looking connect form that would always 403 on submission. Fixed with a one-line guard (`&& !statusQuery.isError`) — see Deviations below.
  - **Console errors:** Zero uncaught JS exceptions/`pageerror`s throughout both walkthrough passes. The only console entries were Chromium's own automatic network-status log lines for the intentionally-triggered 403/503 responses (standard browser devtools behavior for any non-2xx fetch, not an application defect) and one benign `AbortController` cleanup line from the login page's health-check widget firing on navigation-away (by design).
  - **Data hygiene:** Each Playwright run created a duplicate "Towels — Room 412" task row in the live production Supabase database (this dev environment points at the real `oacnwalhcpqdabivweki` project, not a sandbox). All test-created rows were deleted via `DELETE /v1/tasks/{id}` after each run, with a final zero-residue check confirming only the pre-existing, untouched "Test button wave2 verification" task remains. All temporary Playwright spec/config files created for this verification (`apps/web/e2e/zz-*.spec.ts`, `apps/web/playwright.*.config.ts`) were deleted afterward.

## Task Commits

Task 1 required no commit (verification-only, zero files modified). Task 2's live walkthrough produced one code fix, committed atomically:

1. **Fix: suppress misleading Opera connect form on statusQuery.isError** — `df9317f9` (fix)

## Files Created/Modified

- `apps/web/app/(dashboard)/settings/integrations/page.tsx` — guarded the "disconnected state" (feature list + credential form) render branch with `!statusQuery.isError`, so a failed `/opera/status` fetch (e.g. the D-03 pilot-gate 403 for a non-pilot hotel) renders only the existing "Failed to load Opera status. Retry" message, never an interactive connect form the backend will unconditionally reject.

## Environment Notes — Zombie Process / Stale Server Saga (real, reproducible dev gotcha)

The first pass of Task 2's live walkthrough (performed against what appeared to be the already-running dev API on `:8003`) produced results that were **invalid and are superseded by the redo below.** Root cause, diagnosed by the orchestrator mid-session:

1. The `python.exe` process bound to port 8003 had a `CreationDate` of 2026-07-25 — three days before any of today's 06-01..06-04 commits existed. Despite `uvicorn --reload` being configured, the file-watcher never triggered a reload during today's session.
2. A first restart attempt orphaned `multiprocessing.spawn` child workers (Windows does not cascade-kill children when a parent process dies) — those zombie children kept serving every request on the port, including through the first "fresh" restart attempt.
3. That first restart attempt had actually crashed silently on startup with `ModuleNotFoundError: No module named 'apscheduler'` — a real, pre-existing local venv/`requirements.txt` drift, unrelated to any Phase 6 code — so the new process never bound the port at all, and all requests silently kept hitting the stale zombies.
4. After installing `apscheduler==3.11.3`, killing the zombie workers, and confirming a genuinely fresh "Started server process... application startup complete" log, `GET /integrations/opera/status` correctly returned **403** for the first time (previously, against the stale code, it had returned **200** — because the 3-day-old process predated 06-02's pilot-gate migration/code entirely).

**Practical takeaway for future sessions:** on this machine, `uvicorn --reload` cannot be trusted to reflect the latest code without independently confirming the bound process's start time postdates the latest commit — especially after a crash-on-restart, since Windows leaves orphaned child workers listening on the same port with no visible failure signal.

**Additional environment note (unrelated, pre-existing):** port 8000 (which the original task prompt assumed hosted the API) is occupied on this machine by an unrelated trading-bot FastAPI application (`/api/scanner`, `/api/news`, `/api/trade`). The actual PatelRep API runs on `:8003`, per `apps/web/.env.local`'s `NEXT_PUBLIC_API_URL`. Port 8000 was never touched.

## Decisions Made

- **Fixed the Opera connect-form UI bug in-phase (Rule 1 auto-fix)** rather than deferring it, because 06-02's pilot-gate code is what turns this from a dormant edge case into the default experience for every non-pilot hotel (the common case). This is precisely the class of live, cross-runtime bug the plan's own Task 2 rationale anticipated ("type-check alone cannot catch this... verified in-browser").
- **Left the React Query retry-backoff delay (~7-10s of loading skeleton before the graceful error renders) unfixed**, documenting it as a residual, non-blocking UX observation — tuning retry behavior for 4xx responses is an app-wide `QueryClient` policy decision (`components/shared/Providers.tsx`), out of scope for this single-file gate-plan fix.
- **Did not flip `opera_pilot_enabled` for the test hotel** to exercise the pilot-enabled connect/test/sync UI path against verified-fresh code — no direct Supabase SQL/MCP tool access was available in this execution context. Per the plan's own explicit contingency, verifying the non-pilot 403 path (the actual, current, default production state for all real hotels) was treated as the higher-priority, sufficient verification.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Opera settings page showed a misleading, always-403 "Connect Opera Cloud" form when the status fetch failed**
- **Found during:** Task 2's live walkthrough redo (against verified-fresh API code, after the zombie-process saga above)
- **Issue:** `apps/web/app/(dashboard)/settings/integrations/page.tsx`'s disconnected-state branch rendered whenever `!operaStatus?.connected` was true — which is also true whenever the status query errors (since `data` is `undefined`). For any non-pilot hotel (the default for every real hotel today, post-06-02), this meant the full interactive credential form rendered at the same time as the "Failed to load Opera status" banner, misleading a GM into believing they could connect when the backend would always 403 the attempt.
- **Fix:** Added `&& !statusQuery.isError` to the branch's condition, so the pre-existing "Status fetch error" block becomes the single source of truth for that state.
- **Files modified:** `apps/web/app/(dashboard)/settings/integrations/page.tsx`
- **Verification:** Re-ran the full 496-test API suite (unaffected, backend untouched) + `npm run type-check` (clean) + a live re-verification screenshot confirming only the safe error message renders, no connect form.
- **Committed in:** `df9317f9`

---

**Total deviations:** 1 auto-fixed bug, discovered and fixed live during the mandatory browser walkthrough.
**Impact on plan:** No scope creep — the fix is a single-line, single-file guard directly triggered by this phase's own pilot-gate work, closing a real UX gap that undermines trust in the Opera settings page for the vast majority of (non-pilot) hotels.

## Issues Encountered

- **Invalid first walkthrough pass:** superseded by the redo above, due to the zombie-process/stale-server issue (see Environment Notes). Not a Phase 6 code defect — a local dev-environment artifact. No corrective code change was needed once the server was genuinely fresh; only the *frontend UI bug* (found on the valid redo) needed fixing.
- **Residual, accepted:** React Query's default retry backoff means a non-pilot hotel's Opera settings page shows a loading skeleton for ~7-10 seconds before the graceful error message appears. Non-blocking; not fixed in this plan (see Decisions Made).

## User Setup Required

None remaining for this plan. (Separately, the orchestrator's own local venv needed `apscheduler==3.11.3` installed to get a genuinely fresh dev API server running — a pre-existing `requirements.txt`/venv drift unrelated to any Phase 6 code, already resolved for this session.)

## Accepted Deferrals (not gaps)

Per 06-RESEARCH.md and CLAUDE.md's Current Scope constraint (no local AI-provider or OHIP credentials):
- Actual GPT-4o-mini/Claude copilot LLM responses were not exercised live — only the zero-credit client-side rule-engine fast path and the RBAC/credit-cap-rejection paths, which do not require live model calls.
- A real Opera connect → sync → webhook round trip against an OHIP sandbox was not exercised live — only the pilot-gate 403 rejection path (this session, against verified-fresh code) and, in the earlier invalid pass, a safe 503 on a fake OHIP URL (that specific UI behavior is unaffected by 06-02..06-04's backend changes, so it likely still holds, but is flagged here as not independently re-verified against fresh code).

## Next Phase Readiness

- All five Phase 6 plans (06-01 through 06-05) are now execution-complete, each with a green full-suite run and, for this plan, a human-approved live GM walkthrough.
- D-06 (full Phase 1-5 test rigor + live browser walkthrough for both AI copilot and Opera surfaces) is satisfied: 496/496 API tests, clean web type-check, live walkthrough with zero uncaught console errors and one real bug found-and-fixed.
- **Phase 6 is execution-complete but not yet goal-backward verified** — `/gsd-verify-work` (or equivalent phase-verification step) has not yet run against this phase and should be the next step before considering Phase 6 "closed" at the milestone level.

---
*Phase: 06-pms-and-ai-expansion*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: `apps/web/app/(dashboard)/settings/integrations/page.tsx` contains `!statusQuery.isError` guard (confirmed via git diff in this session)
- FOUND: commit `df9317f9` (fix) present in `git log`
- FOUND: full API suite re-verified green (496/496) after the fix
- FOUND: zero residual test-created rows in the live `tasks` table (verified via a final cleanup-and-recount pass)
- FOUND: no leftover temporary Playwright spec/config files in `apps/web/e2e/` or `apps/web/`

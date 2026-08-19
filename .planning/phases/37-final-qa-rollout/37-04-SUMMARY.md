---
phase: 37-final-qa-rollout
plan: 04
subsystem: web-verification
tags: [qa, regression, playwright, pixel-diff, csp, standalone-build, supabase, tenant-flags]

# Dependency graph
requires:
  - phase: 30-foundation
    provides: "room-board-baseline.spec.ts (FOUND-03 regression harness), the regression fixture tenant, and the original chromeMasks() shell-landmark masking"
  - phase: 35-engineering-section-chrome
    provides: "chromeMasks()'s data-testid=\"page-header\" mask, reusable as-is for this run (confirmed already present, no harness edit needed)"
provides:
  - "QA-03 verified: 24/24 total snapshot comparisons (12 flag-off + 12 all-21-flags-on) at zero pixel drift, proving RoomStatusBoard/RoomDetailDrawer/EngineeringRoomBoard stay pixel-identical even when every other section flag is simultaneously v2 — the one new check this close-out phase adds beyond every prior phase's own individual-flag re-run"
  - "Confirmed origin/main is stale (local HEAD 20 commits ahead) — same local-standalone-build workaround needed as every phase since ~32, applied and fully reverted"
  - "Discovered and worked around a build-vs-runtime timing gotcha: next.config.mjs's headers() (and therefore CSP) is baked into routes-manifest.json at `next build` time, not re-evaluated when the standalone server.js starts — REGRESSION_LOCAL_CSP must be set during the build step, not just at server-launch, or the CSP silently omits the localhost allowance and every client-side API fetch gets blocked (visible only via browser console CSP violations, not server logs)"
affects: [37]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "NEXT_DIST_DIR=<isolated-dir> npm run build lets a one-off regression build coexist with a concurrently running dev:web server (same repo checkout, same default .next distDir) without a build-lock collision — cleaner than retrying past a transient lock, and necessary here since this plan ran in parallel with other agents' dev:web usage"
    - "Next.js auto-edits tsconfig.json's include array to add <NEXT_DIST_DIR>/types/**/*.ts entries on any custom-distDir build (pre-existing .next-ops-audit-* entries in tsconfig.json are evidence of this same mechanism from an unrelated prior tool run) — this is an incidental side effect, not requested by this plan's files_modified list, and was reverted via git checkout after each build so the plan's tree footprint stayed exactly at next.config.mjs"

key-files:
  created: []
  modified:
    - apps/web/next.config.mjs

key-decisions:
  - "Rebuilt twice: the first standalone build was made without REGRESSION_LOCAL_CSP set (env var was only exported at server-launch time), which produced 12/12 timeouts because Next.js bakes headers()/CSP into routes-manifest.json at build time, not server-start time — every client fetch to the local API was silently CSP-blocked. Diagnosed via a manual Playwright script capturing browser console output (server logs showed nothing). Fixed by re-running the build itself with REGRESSION_LOCAL_CSP=1 set, which produced the correct baked-in CSP (confirmed via grep on routes-manifest.json before re-running the suite)."
  - "Used NEXT_DIST_DIR=.next-regression (rather than the default .next) for the isolated build, since a dev:web server was already running against the default .next directory for other parallel 37-01/37-02 work — this avoided the 'transient sibling-build lock collision' class of issue documented in several prior phase SUMMARYs, at the cost of Next.js incidentally editing tsconfig.json's include array (reverted via git checkout after each of the two builds, confirmed clean both times)."
  - "Self-corrected mistake: when stopping what was believed to be the regression server on port 3100, initially ran taskkill against the wrong PID (53480) and killed the shared dev:web server on port 3000 instead (used by parallel plans 37-01/37-02). Caught immediately via netstat, restarted `npm run dev:web` in the background, and confirmed it was healthy again (HTTP 200 on /login) before continuing — documented here per this plan's instruction not to silently absorb such an event."
  - "Used a service-role Node script (mirroring seed-regression-tenant.mjs's inline .env loader) to read/write the fixture tenant's web_redesign_sections column directly, matching the plan's own specified mechanism and every prior phase's established pattern for this exact operation."

patterns-established:
  - "For any future regression build that must run alongside an active dev:web server, set REGRESSION_LOCAL_CSP (or any build-time env flag next.config.mjs reads) BEFORE `npm run build`, not just before starting the standalone server.js — CSP headers are compiled into routes-manifest.json, not read live at request time."

# Metrics
duration: ~55min
completed: 2026-08-19
---

# Phase 37 Plan 04: QA-03 Final Room-Board Regression (Baseline + All-21-Flags) Summary

**Re-ran the FOUND-03 Room-Board pixel-diff harness against a local standalone build twice — once at the existing flag-off baseline (12/12, zero drift, matching every close-out since Phase 30) and once with the regression fixture tenant's `web_redesign_sections` set to the full 21-key array simultaneously (12/12, zero drift) — the specific new "all sections v2 at once" condition this close-out phase adds beyond any prior phase's own re-run, proving RoomStatusBoard/RoomDetailDrawer/EngineeringRoomBoard remain pixel-frozen under full post-rollout simulation, not just individually.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-08-19T07:10:36Z
- **Tasks:** 2 completed
- **Files modified:** 1 (`apps/web/next.config.mjs`, net-zero diff — temporarily patched then fully reverted)

## Accomplishments

- Confirmed `origin/main` is stale (`git rev-list --left-right --count origin/main...HEAD` → local HEAD 20 commits ahead), so `playwright.regression.config.ts`'s hardcoded default `baseURL` would 404 — same local-standalone-build workaround every phase since ~32 has needed.
- **Flag-off baseline (Task 1):** confirmed the fixture tenant's `web_redesign_sections` was `[]` via read-back before running; built + served a local standalone build on `:3100`; ran `room-board-baseline.spec.ts` — **12/12 pass, zero pixel drift**.
- **All-21-flags-on run (Task 2):** flipped the fixture tenant to the full 21-key array (`shell, dashboard, tasks, evidence, engineering, reports, managementRoi, aiCopilot, logbook, staff, lostFound, programs, sop, scheduling, safety, guestRequests, billing, settings, guestFeedback, integrations, housekeeping`) via a direct service-role update, confirmed via read-back; re-ran the identical suite against the same running build (no rebuild needed — the flag is read at request time via `/auth/me`, not baked into the build) — **12/12 pass, zero pixel drift**. No masking gap found, no genuine regression found.
- Restored the fixture tenant's `web_redesign_sections` back to `[]`, confirmed via a final read-back.
- Stopped the local standalone server process; removed the isolated `.next-regression` build output directory.
- **Total: 24/24 snapshot comparisons at zero pixel drift**, satisfying QA-03's full success criteria.

## Task Commits

Each task was committed atomically:

1. **Task 1: Local standalone build + baseline regression re-run** - `be221edd` (chore) — temporary `REGRESSION_LOCAL_CSP`-gated CSP patch added to `next.config.mjs`; flag-off baseline confirmed 12/12, zero drift.
2. **Task 2: All-21-flags regression run, restore fixture + revert CSP patch** - `6c50f58f` (chore) — all-21-flags run confirmed 12/12, zero drift; fixture tenant restored to `[]`; CSP patch fully reverted.

**Plan metadata:** (this SUMMARY.md + STATE.md commit, made by the orchestrating step after this summary)

_Net diff of `apps/web/next.config.mjs` across both commits is empty — `git diff 806a2edd 6c50f58f -- apps/web/next.config.mjs` produces no output, confirming byte-identical reversion to the pre-plan state._

## Files Created/Modified

- `apps/web/next.config.mjs` - Temporarily patched (Task 1 commit) to add an env-gated (`REGRESSION_LOCAL_CSP`) localhost allowance to `buildCSP()`'s `connectSrc`, mirroring the file's existing `isDev` pattern; fully reverted (Task 2 commit) — net diff against the pre-plan tree is empty, confirmed via `git diff --exit-code`.

## Decisions Made

See `key-decisions` in frontmatter. Summarized: (1) discovered and worked around a CSP build-vs-runtime baking gotcha — `REGRESSION_LOCAL_CSP` must be set at `next build` time, not `server.js` launch time; (2) used an isolated `NEXT_DIST_DIR=.next-regression` to avoid colliding with the actively-running `dev:web` server other parallel plans depend on, reverting the resulting incidental `tsconfig.json` edit after each build; (3) self-corrected an accidental `taskkill` of the shared `dev:web` server (wrong PID) by immediately restarting it and confirming health before continuing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] CSP baked at build time, not server-start time — first build's flag-off run failed 12/12 on timeout**
- **Found during:** Task 1, first regression run attempt
- **Issue:** The plan's instructions (and every prior phase's precedent) implied `REGRESSION_LOCAL_CSP=1 node .next/standalone/server.js` was sufficient to apply the CSP patch at serve time. In this Next.js version, `headers()` is evaluated once at `next build` and the result is compiled into `routes-manifest.json` — setting the env var only at server launch had no effect. Every client-side API fetch (`/v1/auth/me`, `/v1/housekeeping/board`, etc.) to `http://localhost:8003` was silently blocked by the CSP's `connect-src`, so no room content ever rendered and all 12 tests timed out waiting for room-number text.
- **Fix:** Diagnosed via a standalone Playwright script capturing browser console output directly (server-side logs showed nothing — the block is entirely client-side). Rebuilt with `REGRESSION_LOCAL_CSP=1` set as part of the `npm run build` invocation itself; confirmed via `grep` on the rebuilt `routes-manifest.json` that `http://localhost:*` was now present in the compiled CSP before re-running the suite.
- **Files modified:** None beyond the already-planned `next.config.mjs` patch — this was a build-invocation fix, not a source change.
- **Verification:** Re-ran the full flag-off suite against the correctly-rebuilt server: 12/12 pass, zero pixel drift.
- **Committed in:** be221edd (Task 1 commit; the successful rebuild's result is what's reflected in the commit message)

**2. [Rule 3 - Blocking] Sibling build-lock collision with the actively-running dev:web server**
- **Found during:** Task 1, initial build attempt (before the CSP issue above was even reached)
- **Issue:** `npm run build` failed with a corrupted `.next/dev/types/routes.d.ts` type-check error — caused by a concurrently-running `dev:web` server (used by parallel plans 37-01/37-02) actively writing to the same default `.next` distDir while this plan's build tried to read it.
- **Fix:** Used `NEXT_DIST_DIR=.next-regression npm run build` to build into an isolated directory, avoiding the collision entirely without touching or stopping the other agents' dev server. Incidental side effect: Next.js auto-edited `tsconfig.json`'s `include` array to add `.next-regression/**` entries (consistent with pre-existing `.next-ops-audit-*` entries already in the tracked file from an unrelated prior tool) — reverted via `git checkout -- tsconfig.json` after each of the two builds this plan performed, confirmed clean (`git diff --exit-code`) both times.
- **Files modified:** None (tsconfig.json edit was transient and fully reverted, never committed).
- **Verification:** Both builds completed cleanly (all 43 routes, type-check passed); `git diff --exit-code apps/web/tsconfig.json` clean after each.
- **Committed in:** N/A (no commit — reverted before any commit touched this file)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking issues preventing the planned regression run from completing). Neither required an architectural decision or user input; both were build/tooling-environment issues, not source-code or test-logic changes.
**Impact on plan:** No scope creep — `next.config.mjs`'s final committed state matches the plan's own described patch exactly, and its net diff across the two task commits is empty. No test file, harness, or application source was touched.

## Issues Encountered

**Self-inflicted, immediately-caught-and-corrected mistake (documented per this plan's explicit instruction):** When attempting to stop what was believed to be the local regression server, `taskkill //F //PID 53480` was run against a PID captured earlier from an initial `netstat` snapshot — but that PID was actually the shared `dev:web` server on port 3000 (used by other parallel 37-01/37-02 work), not the regression server (which was running under a different, later-assigned PID on port 3100). Caught immediately via a follow-up `netstat` check; restarted `npm run dev:web` in the background and confirmed `http://localhost:3000/login` returned HTTP 200 before continuing with the plan's own regression work. No further interruption to `dev:web` occurred for the remainder of this plan; all subsequent `taskkill` calls were double-checked against a fresh `netstat` port-to-PID lookup immediately beforehand.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

QA-03 is fully satisfied for Phase 37's close-out: 24/24 total snapshot comparisons (12 flag-off + 12 all-21-flags-on) at zero pixel drift, proving the 3 permanently-frozen Room-Board surfaces stay pixel-identical both individually and under full post-rollout simulation (every section flag on at once). Regression fixture tenant confirmed restored to its permanent `[]` baseline via read-back — zero leakage into any future phase's baseline runs. `next.config.mjs`'s temporary patch fully reverted with zero residual diff. No blockers for 37-03/37-05. The build-time-vs-runtime CSP-baking gotcha discovered here is worth flagging for any future phase that reuses this local-standalone-build workaround: `REGRESSION_LOCAL_CSP` (or any equivalent env-gated `next.config.mjs` flag) must be set during `npm run build`, not just at `server.js` launch.

---
*Phase: 37-final-qa-rollout*
*Completed: 2026-08-19*

## Self-Check: PASSED

- FOUND: `.planning/phases/37-final-qa-rollout/37-04-SUMMARY.md`
- FOUND: commit `be221edd` (Task 1 — temporary CSP patch + flag-off baseline pass)
- FOUND: commit `6c50f58f` (Task 2 — all-21-flags pass + CSP patch revert)
- FOUND: `git diff --exit-code apps/web/next.config.mjs` — zero residual diff confirmed
- Fixture tenant restore independently re-confirmed via a final read-back query (`web_redesign_sections = []`)

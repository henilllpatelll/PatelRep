---
phase: 30-additive-foundation-regression-harness
plan: 01
subsystem: testing
tags: [playwright, pixel-diff, regression, supabase, e2e, visual-regression]

# Dependency graph
requires: []
provides:
  - "Idempotent seed script for a dedicated, never-operated, cron-inert regression fixture tenant (apps/web/e2e/fixtures/seed-regression-tenant.mjs)"
  - "Authenticated globalSetup producing per-role Playwright storageState (apps/web/e2e/global-setup.ts)"
  - "playwright.regression.config.ts — deterministic pixel-diff config (maxDiffPixelRatio 0, reducedMotion, fixed viewport)"
  - "apps/web/e2e/room-board-baseline.spec.ts — 12-assertion capture matrix (3 excluded surfaces x light/dark x 2 real roles)"
affects: [30-04, 31, 32, 33, 34, 35, 36]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-literal `use` object in a Playwright config to route around excess-property-check on a config type gap (reducedMotion) without an `any` cast"
    - "Seed zustand-persist localStorage key via page.addInitScript() before goto(), since a post-render DOM class toggle gets clobbered by React re-render"

key-files:
  created:
    - apps/web/e2e/fixtures/seed-regression-tenant.mjs
    - apps/web/e2e/global-setup.ts
    - apps/web/playwright.regression.config.ts
    - apps/web/e2e/room-board-baseline.spec.ts
  modified:
    - apps/api/scripts/cleanup_test_data.py
    - apps/web/.gitignore
    - apps/web/package.json

key-decisions:
  - "Fixture tenant UUID fixed at a0000000-0000-4000-a000-000000000001, slug regression-fixture-do-not-operate, lives in the SAME (production) Supabase project as the target PLAYWRIGHT_BASE_URL deployment (no separate staging env exists)"
  - "7 fixed rooms (101-107), one per board-rendered status (DIRTY/CLEAN/INSPECTED/IN_PROGRESS/PICKUP/OCCUPIED/OOO), all on floor 1, no building set (keeps the RoomStatusBoard building-filter row hidden entirely — one less variable axis)"
  - "Cron-inert via: every room's checkin_time=NULL (excludes it from predictions.run's get_at_risk_rooms, so no room_readiness_predictions row is EVER created for this tenant) and dnd_flag=FALSE (excludes it from the DND welfare scan); the one work order has assigned_to=NULL AND due_at=2099-01-01 AND escalation_level=0 (escalations.check requires assigned_to IS NOT NULL AND due_at < now(), so it can never escalate regardless of when cron runs)"
  - "No pm_schedules / opera_credentials / lost_found_items / assets / tasks / safety_training_courses rows created for the fixture tenant, per the executor-attention note — every other 30-min/daily cron job is a no-op for this tenant because each only acts on tenants with matching rows"
  - "EngineeringRoomBoard.tsx confirmed (direct source read) to render only room.prediction (room-readiness), never asset failure-prediction data — so no asset/failure_predictions rows were needed to keep it inert"
  - "Fixture UUID added to cleanup_test_data.py's PRESERVE set (not DELETE_ALLOWLIST) — PRESERVE is never deleted; DELETE_ALLOWLIST is what gets deleted"
  - "The two fixture-role credentials (REGRESSION_GM_EMAIL/PASSWORD, REGRESSION_SUP_EMAIL/PASSWORD) are generated once by the seed script into a new gitignored apps/web/.env.regression file if absent, then reused on every subsequent run — keeps the seed idempotent and the Playwright login convergent"
  - "Screenshot masks target only residual live chrome: the housekeeping date-nav span + Previous/Next-day buttons (their accessible name is static but their visible label embeds today's date), the Realtime sync badge, and (defense-in-depth) any risk-titled chip — never room cards, counts, or status colors"
  - "Dark mode is toggled by seeding the `patelrep-ui-prefs` zustand-persist localStorage key via page.addInitScript() before each goto(), not by a post-load DOM class toggle — DashboardShell.tsx derives `.theme-dark` from React state on every render, so a runtime classList.toggle() would be overwritten by the board's periodic refetch-triggered re-render"

patterns-established:
  - "Cron-inertness for a live-prod-shared fixture tenant: verify each 30-min/daily job's actual SQL filter conditions against source (not assumption) and seed values that permanently fail them"

# Metrics
duration: ~70min
completed: 2026-08-14
---

# Phase 30 Plan 01: Regression Pixel-Diff Harness Summary

**Cron-inert Playwright pixel-diff harness (seed script + authenticated globalSetup + maxDiffPixelRatio:0 config + 12-assertion spec) for the 3 excluded Room Board surfaces — snapshot capture itself is NOT yet run (requires live DB write access this sandboxed executor doesn't have).**

## Performance

- **Duration:** ~70 min
- **Tasks:** 3 (all code-complete; live execution deferred to the orchestrator)
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments

- Wrote an idempotent seed script for a dedicated, never-operated, cron-inert regression fixture tenant — every cron-inertness claim (checkin_time NULL, dnd_flag FALSE, WO assigned_to NULL + due_at 2099 + escalation_level 0, no pm_schedules/opera_credentials/lost_found_items rows) was verified against the actual `escalations.check` / `predictions.run` SQL filter conditions in `apps/api/routers/internal.py` and `apps/api/services/ai/predictions.py`, not assumed.
- Confirmed by direct source read that `EngineeringRoomBoard.tsx` never renders asset failure-prediction data (only `room.prediction` from room-readiness), so no `assets`/`failure_predictions` rows were needed — simpler than the plan's contingency.
- Wrote an authenticated `globalSetup` that logs in as both real fixture roles (GM + housekeeping_supervisor) and treats the supervisor credential as a hard prerequisite (throws rather than silently degrading to one role).
- Wrote `playwright.regression.config.ts` (`maxDiffPixelRatio: 0`, `reducedMotion: 'reduce'`, fixed 1440x900 viewport) and `room-board-baseline.spec.ts` (12 `toHaveScreenshot` assertions — confirmed via `--list`).
- Type-check (`tsc --noEmit`) and lint (`eslint`) both pass clean on all 4 new files.
- Added the fixture UUID to `cleanup_test_data.py`'s `PRESERVE` set (not `DELETE_ALLOWLIST`) per the plan's cleanup-safety instruction.

## Task Commits

Each task was committed atomically:

1. **Task 1: Seed script + cleanup_test_data.py PRESERVE entry** — `70a6b7a0` (feat)
2. **Task 2: globalSetup + regression config** — `3ec095da` (feat)
3. **Task 3: Baseline spec (12 assertions, no snapshots yet)** — `74d2d302` (feat)

_No plan-metadata commit yet — deferred until the orchestrator captures the baseline and this plan is fully closed._

## Files Created/Modified

- `apps/web/e2e/fixtures/seed-regression-tenant.mjs` — idempotent Supabase-service-role seed: tenant, room type, 2 fixture users (auth + profile + role), 7 rooms covering every status, 1 cron-inert work order. Generates+persists fixture credentials to a new gitignored `.env.regression` on first run.
- `apps/web/e2e/global-setup.ts` — Playwright `globalSetup`; logs in as `gm` and `supervisor`, writes `e2e/.auth/gm.json` / `e2e/.auth/supervisor.json` (already covered by the repo-root `.gitignore`'s `e2e/.auth/` pattern — no new gitignore entry needed there).
- `apps/web/playwright.regression.config.ts` — regression config mirroring `playwright.phase1.config.ts`'s structure.
- `apps/web/e2e/room-board-baseline.spec.ts` — capture matrix + `chromeMasks()` helper + `gotoWithTheme()` dark-mode helper.
- `apps/api/scripts/cleanup_test_data.py` — `PRESERVE` set gains the fixture UUID.
- `apps/web/.gitignore` — gains `.env.regression`.
- `apps/web/package.json` — gains `test:e2e:regression` and `seed:regression-fixture` scripts (convenience, mirrors the existing `test:e2e:phase1`/`phase4` pattern).

## Decisions Made

See `key-decisions` in frontmatter above — all six are non-obvious and load-bearing for future phases (esp. 30-04 onward, which re-run this diff).

One additional implementation-level decision not in frontmatter: `reducedMotion` is a genuine Playwright `BrowserContext` option but isn't declared on this repo's pinned `@playwright/test` version's `use` config type. Rather than an `any` cast, the `use` object is built as a non-literal `const` first — TypeScript's excess-property check only fires on fresh object literals, so referencing a pre-built object sidesteps the gap without weakening any other type safety in the config.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `reducedMotion` not in the pinned Playwright config type**
- **Found during:** Task 2 (`npx tsc --noEmit`)
- **Issue:** `use: { ..., reducedMotion: 'reduce' }` as a literal failed TS2769 — the installed `@playwright/test` version's `PlaywrightTestOptions`/`UseOptions` type doesn't declare `reducedMotion` even though it's a real, documented, runtime-supported option.
- **Fix:** Built the `use` object as a separate `const` (non-literal) before passing it to `defineConfig`, avoiding TS's fresh-object-literal excess-property check without an `any` escape hatch.
- **Files modified:** `apps/web/playwright.regression.config.ts`
- **Verification:** `npx tsc --noEmit -p tsconfig.json` clean.
- **Committed in:** `3ec095da` (Task 2 commit)

**2. [Rule 3 - Blocking] `import.meta.url` unusable under this repo's CJS Playwright transform**
- **Found during:** Task 3 (`npx playwright test --list`)
- **Issue:** `global-setup.ts` originally computed `__dirname` via `fileURLToPath(import.meta.url)` (ESM-only) — the repo has no `"type": "module"` in `apps/web/package.json`, so Playwright's TS loader transpiles to CommonJS, and `import.meta` threw `SyntaxError: Cannot use 'import.meta' outside a module` at collection time (0 tests found).
- **Fix:** Used the CJS global `__dirname` directly (available automatically post-transpile; `.mjs` files like the seed script are unaffected since `.mjs` forces real ESM regardless of package.json).
- **Files modified:** `apps/web/e2e/global-setup.ts`
- **Verification:** `npx playwright test --config=playwright.regression.config.ts --list` now reports 12/12 tests discovered.
- **Committed in:** `3ec095da` (Task 2 commit, before the spec-discovery check surfaced the issue — both fixes landed together since Task 2 wasn't yet committed when this was found)

**3. [Rule 1 - Bug] Block-comment self-termination in the seed script's header**
- **Found during:** Task 1 (`node --check`)
- **Issue:** The literal text `*/30` inside a `/** ... */` JSDoc header comment (describing the cron schedule) closed the comment early, producing a syntax error.
- **Fix:** Reworded to "every other 30-minute or daily cron job" (no literal `*/`).
- **Files modified:** `apps/web/e2e/fixtures/seed-regression-tenant.mjs`
- **Verification:** `node --check` passes.
- **Committed in:** `70a6b7a0` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (2 blocking type/tooling gaps, 1 blocking syntax bug), all caught by this plan's own verification steps before commit.
**Impact on plan:** All three are tooling/typing corrections with zero behavioral impact on the harness's design. No scope creep.

## Issues Encountered

**Cannot execute the seed script or capture snapshots — no Supabase MCP / live DB access in this sandboxed executor.** This matches the project's long-standing pattern for seed/migration scripts requiring live writes (see prior phase SUMMARYs: 06-02, 21-01, 27-01, 29-01, and this same phase's 30-02-SUMMARY.md). Per this task's explicit instructions, the orchestrator (who has live Supabase MCP access this session) will:

1. Run `node apps/web/e2e/fixtures/seed-regression-tenant.mjs` (from `apps/web`) against the live Supabase project. This generates `apps/web/.env.regression` on first run (gitignored) with the two fixture-role credentials.
2. Verify via a direct query: the fixture tenant + 7 rooms with expected statuses + `checkin_time NULL`/`dnd_flag FALSE` on every room + the 1 work order (`due_at` far-future, `escalation_level 0`) + 2 fixture users all exist; no real tenant rows changed; the fixture UUID is not in `DELETE_ALLOWLIST`.
3. Run `npx playwright test --config=playwright.regression.config.ts --update-snapshots` (from `apps/web`, with `REGRESSION_GM_EMAIL/PASSWORD`, `REGRESSION_SUP_EMAIL/PASSWORD` from `.env.regression`, and `PLAYWRIGHT_BASE_URL` pointed at the deployed web URL backed by this Supabase project) to generate and commit the 12 baseline PNGs under `e2e/room-board-baseline.spec.ts-snapshots/`.
4. Re-run the same command without `--update-snapshots` to confirm zero drift on the same (untouched) tree.
5. Inspect one committed snapshot to confirm masks cover only chrome (date-nav, sync badge) and that room cards / counts / status colors remain fully visible in the diff.

What I verified locally without live access:
- `npx tsc --noEmit -p tsconfig.json` — clean.
- `npx eslint e2e/fixtures/seed-regression-tenant.mjs e2e/global-setup.ts e2e/room-board-baseline.spec.ts playwright.regression.config.ts` — clean (exit 0).
- `node --check e2e/fixtures/seed-regression-tenant.mjs` — valid syntax.
- `npx playwright test --config=playwright.regression.config.ts --list` — reports exactly the expected 12 tests (3 surfaces x 2 modes x 2 roles).

## User Setup Required

None — no external service configuration required. (The Supabase project and Railway deployment already exist; the orchestrator uses existing MCP access, not new setup.)

## Next Phase Readiness

- The harness's code (seed script, auth setup, config, spec) is complete, type-checked, linted, and verified to discover the correct test matrix — ready for the orchestrator to run live.
- **Blocker for phase exit:** the actual baseline PNGs (`e2e/room-board-baseline.spec.ts-snapshots/`, ≥12 files) do not exist yet — Task 3's `<done>` criterion ("≥12 baseline PNGs committed... clean re-run passes at maxDiffPixelRatio 0") is not yet satisfied. This plan cannot be marked fully complete until the orchestrator runs steps 1-5 above and commits the resulting snapshot directory (a follow-up commit, since these are generated binary artifacts this executor cannot produce).
- Phase 30's other plans (tokens, frozen-file guard, feature flag) can proceed in parallel — this baseline only needs to exist *before* any token/primitive change lands, per FOUND-03's own requirement, which is still satisfied as long as the orchestrator captures it before Wave 2+ begins altering tokens.

---
*Phase: 30-additive-foundation-regression-harness*
*Completed: 2026-08-14 (code); snapshot capture pending live execution*

## Self-Check: PASSED

All 5 created files found on disk; all 3 task commit hashes (`70a6b7a0`, `3ec095da`, `74d2d302`) found in `git log --oneline --all`.

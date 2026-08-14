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
    - "apps/web/e2e/room-board-baseline.spec.ts-snapshots/*.png (12 baseline screenshots, orchestrator-captured)"
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

**Cron-inert Playwright pixel-diff harness (seed script + authenticated globalSetup + maxDiffPixelRatio:0 config + 12-assertion spec) for the 3 excluded Room Board surfaces, with the fixture seeded and all 12 baseline snapshots captured and re-verified at zero drift.**

## Performance

- **Duration:** ~70 min (code) + ~15 min (orchestrator live execution: migration apply, seed, 2x Playwright runs)
- **Tasks:** 3 code tasks (all complete) + orchestrator live-execution follow-up (complete)
- **Files modified:** 8 (5 created incl. 12 snapshot PNGs as one artifact set, 3 modified)

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
3. **Task 3: Baseline spec (12 assertions)** — `74d2d302` (feat)
4. **Orchestrator: gitignore fix for `e2e/.auth/`** — `c86d198f` (fix) — the root `.gitignore`'s `e2e/.auth/` pattern is anchored to repo root (mid-string slash), so it never actually matched `apps/web/e2e/.auth/`; caught before the snapshot commit could pull Playwright's per-role storageState (session tokens) into git history. Corrects this SUMMARY's original (incorrect) claim that no new gitignore entry was needed.
5. **Orchestrator: baseline snapshots captured and committed** — `26856b47` (test) — migration 097 applied live, fixture seeded, `--update-snapshots` run (12/12 passed), re-run without the flag to confirm zero drift (12/12 passed again), one snapshot visually spot-checked.

## Files Created/Modified

- `apps/web/e2e/fixtures/seed-regression-tenant.mjs` — idempotent Supabase-service-role seed: tenant, room type, 2 fixture users (auth + profile + role), 7 rooms covering every status, 1 cron-inert work order. Generates+persists fixture credentials to a new gitignored `.env.regression` on first run.
- `apps/web/e2e/global-setup.ts` — Playwright `globalSetup`; logs in as `gm` and `supervisor`, writes `e2e/.auth/gm.json` / `e2e/.auth/supervisor.json`. **Correction:** the repo-root `.gitignore`'s `e2e/.auth/` pattern does NOT cover this (it's anchored to repo root, only matches `./e2e/.auth/`) — the orchestrator added `e2e/.auth/` to `apps/web/.gitignore` (relative to that file, correctly matches `apps/web/e2e/.auth/`) before committing the snapshots, catching this ahead of any credential leak into git history.
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

**Executor had no Supabase MCP / live DB access** (matches the project's long-standing pattern — see 06-02, 21-01, 27-01, 29-01, 30-02-SUMMARY.md). The orchestrator (live Supabase MCP access this session) completed the deferred live steps:

1. ✅ Applied migration 097 (`tenants.web_redesign_sections`, from plan 30-02) live; verified column exists with correct type/nullability/default via `information_schema.columns`.
2. ✅ Ran `node e2e/fixtures/seed-regression-tenant.mjs` from `apps/web` — succeeded, generated `.env.regression`.
3. ✅ Verified via direct SQL query: all 7 rooms present with expected statuses, `checkin_time NULL` + `dnd_flag FALSE` on every room; the work order has `due_at=2099-01-01`, `escalation_level=0`, `assigned_to=NULL`; tenant `is_test=FALSE`.
4. ✅ Found and fixed a real gap before it could leak credentials: the root `.gitignore`'s `e2e/.auth/` pattern didn't actually match `apps/web/e2e/.auth/` (mid-string-slash patterns anchor to the `.gitignore`'s own directory) — added a correctly-scoped entry to `apps/web/.gitignore` and confirmed via `git check-ignore -v` before staging anything.
5. ✅ Ran `npx playwright test --config=playwright.regression.config.ts --update-snapshots` — 12/12 passed, wrote all 12 baseline PNGs.
6. ✅ Re-ran without `--update-snapshots` on the same, untouched tree — 12/12 passed again, confirming genuine `maxDiffPixelRatio: 0` determinism.
7. ✅ Visually inspected `housekeeping-board-gm-light-win32.png` — confirmed only the date-nav chrome is masked (magenta boxes); all 7 room cards, their status pill colors, and counts are fully visible and unmasked, exactly as designed.

What was verified locally before live execution (unchanged from original write-up):
- `npx tsc --noEmit -p tsconfig.json` — clean.
- `npx eslint e2e/fixtures/seed-regression-tenant.mjs e2e/global-setup.ts e2e/room-board-baseline.spec.ts playwright.regression.config.ts` — clean (exit 0).
- `node --check e2e/fixtures/seed-regression-tenant.mjs` — valid syntax.
- `npx playwright test --config=playwright.regression.config.ts --list` — reports exactly the expected 12 tests (3 surfaces x 2 modes x 2 roles).

## User Setup Required

None — no external service configuration required. (The Supabase project and Railway deployment already exist; the orchestrator uses existing MCP access, not new setup.)

## Next Phase Readiness

- The harness is fully complete: code (seed script, auth setup, config, spec), the fixture tenant (seeded, verified cron-inert live), and all 12 baseline PNGs (captured, re-verified at zero drift, committed).
- FOUND-03 is satisfied: baseline exists *before* Wave 2 (plan 30-04, tokens) begins, per the requirement's own ordering constraint.
- Plans 31-36 re-run `npm run test:e2e:regression` (from `apps/web`, with `.env.regression` sourced) against this same baseline to prove the excluded boards never drift as the redesign proceeds. Plan 30-06 wires this into CI as a real job — will need the four `REGRESSION_*` secrets configured (see repo-admin follow-up).

---
*Phase: 30-additive-foundation-regression-harness*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: all 4 code files + 12 baseline snapshot PNGs on disk
- FOUND: all 5 commits in `git log --oneline --all` (`70a6b7a0`, `3ec095da`, `74d2d302`, `c86d198f`, `26856b47`)
- VERIFIED: migration 097 live with correct schema
- VERIFIED: fixture tenant + 7 rooms + 1 work order + 2 users seeded and confirmed cron-inert via direct SQL query
- VERIFIED: `--update-snapshots` run 12/12 passed; immediate re-run without the flag 12/12 passed (genuine zero-drift determinism, not a fluke)
- VERIFIED: one snapshot visually inspected — masks cover chrome only, room content stays in the diff

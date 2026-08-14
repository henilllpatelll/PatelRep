---
phase: 30-additive-foundation-regression-harness
plan: 06
subsystem: infra
tags: [github-actions, ci, playwright, wcag, i18n, regression-testing]

# Dependency graph
requires:
  - phase: 30-01
    provides: "test:e2e:regression npm script, playwright.regression.config.ts, e2e/global-setup.ts (fixture-role login), committed Room-Board baseline screenshots"
  - phase: 30-03
    provides: "check:i18n-parity, verify:i18n-gate, check:floor-copy npm scripts"
  - phase: 30-04
    provides: "additive design-token foundation, frozen-files.json manifest"
  - phase: 30-05
    provides: "check:frozen-files, check:contrast npm scripts"
provides:
  - "Four hard CI gates (frozen-guard, contrast, i18n-parity, room-board-regression) in .github/workflows/ci.yml"
  - "PR status-summary table reflecting all four new gates"
affects: [31, 32, 33, 34, 35, 36]

# Tech tracking
tech-stack:
  added: []
  patterns: ["CI job mirrors lint-web/test-web-public-smoke shape (checkout, setup-node v7 node 22, npm ci, then the check command)"]

key-files:
  created: []
  modified:
    - .github/workflows/ci.yml

key-decisions:
  - "Combined Task 1 (static-analysis jobs) and Task 2 (regression job + pr-comment update) into a single commit since both touch only ci.yml and task 2 mechanically depends on task 1's new job names existing in the needs list"
  - "frozen-guard, contrast, and i18n-parity run with no needs: (pure static analysis, no build required), matching the plan's parallelism guidance"
  - "room-board-regression uses needs: build-web, mirroring test-web-public-smoke's shape exactly, since it also needs Chromium + a real running app to screenshot"
  - "verify:i18n-gate and check:floor-copy (previously orphaned npm scripts) wired as extra steps inside the i18n-parity job rather than a new job, per RESEARCH.md's low-cost sibling-step guidance"

# Metrics
duration: ~20min
completed: 2026-08-14
---

# Phase 30 Plan 06: CI Wiring for Frozen-File, Contrast, i18n-Parity, and Room-Board Regression Gates Summary

**Wired all four Phase 30 verification gates (frozen-file guard, dark-mode WCAG AA contrast, EN/ES i18n parity, and Room-Board pixel-diff regression) into `.github/workflows/ci.yml` as hard, non-continue-on-error jobs, completing the FOUND-02/03/04/05 CI-enforcement requirement.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-14
- **Tasks:** 2 completed
- **Files modified:** 1

## Accomplishments
- Added `frozen-guard`, `contrast`, `i18n-parity`, and `room-board-regression` jobs to `ci.yml`, all hard gates (no `continue-on-error`)
- `i18n-parity` additionally wires the two previously-orphaned scripts (`verify:i18n-gate`, `check:floor-copy`) into CI for the first time
- `pr-comment`'s `needs:` array and status table extended to include all four new gates
- Locally re-ran all five check scripts (`check:frozen-files`, `check:contrast`, `check:i18n-parity`, `verify:i18n-gate`, `check:floor-copy`) to confirm they pass clean before wiring them as CI gates

## Task Commits

Both tasks were implemented together and committed atomically, since they touch only one file (`.github/workflows/ci.yml`) and Task 2's `pr-comment` update mechanically depends on Task 1's new job names already existing:

1. **Task 1 + Task 2: Add all four gate jobs + update pr-comment** - `a7dcb0bb` (chore)

_No separate plan-metadata commit was needed beyond this; STATE.md/SUMMARY.md updates are committed as this plan's final `docs` commit._

## Files Created/Modified
- `.github/workflows/ci.yml` - Added `frozen-guard`, `contrast`, `i18n-parity`, `room-board-regression` jobs; extended `pr-comment`'s `needs:` and status table

## Decisions Made
- Grouped both plan tasks into one commit (see key-decisions above) — no functional difference from two commits since both tasks touch the same single file and there was no meaningful checkpoint between them.
- `room-board-regression` depends on `build-web` (same as `test-web-public-smoke`) rather than running standalone, since the Room-Board pixel-diff needs Chromium plus a real running app instance — this mirrors the plan's explicit "mirroring test-web-public-smoke" instruction.
- Static-analysis-only jobs (`frozen-guard`, `contrast`, `i18n-parity`) have no `needs:`, so they run immediately in parallel with `lint-web`/`lint-api`, matching the plan's "no build required, can run without needs" guidance.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' verify/done criteria were met: `ci.yml` is valid YAML (confirmed via `python -c "import yaml; yaml.safe_load(...)"`), all four new jobs are present and none are `continue-on-error`, each job invokes the correct npm script/Playwright config from the earlier plans, no credentials are hardcoded (`room-board-regression` reads all five values from `${{ secrets.* }}`), and `pr-comment`'s `needs:`/table include all four new gates.

## User Setup Required

**GitHub repo secrets must be configured for `room-board-regression` to run successfully in CI.** This job's `globalSetup` (`apps/web/e2e/global-setup.ts`) throws immediately and fails the job loudly if any of these are missing — by design, so a missing secret is a visible CI failure, not a silently-skipped gate:

- `REGRESSION_GM_EMAIL`
- `REGRESSION_GM_PASSWORD`
- `REGRESSION_SUP_EMAIL`
- `REGRESSION_SUP_PASSWORD`
- `PLAYWRIGHT_BASE_URL` (the deployment reading the fixture-seeded Supabase project; falls back to the Railway prod URL if a value isn't set, but that fallback will not have the regression fixture tenant seeded unless 30-01's `seed:regression-fixture` script has also been run against that same Supabase project)

These currently exist only locally in the gitignored `apps/web/.env.regression`, generated by Plan 30-01's `seed:regression-fixture` script. **This requires GitHub repo-admin access** (Settings → Secrets and variables → Actions) that a sandboxed plan executor does not have — same escalation class as live Supabase migrations in this project. Until these are configured, the `room-board-regression` CI job will fail on every PR/push with a clear "Missing required env var" error (not a silent pass), which correctly signals the gate is not yet armed rather than falsely reporting success.

## Self-Check: PASSED

- FOUND: `.github/workflows/ci.yml` (modified, contains all four new job names) — confirmed via `git show a7dcb0bb --stat` and direct read
- FOUND: commit `a7dcb0bb` — confirmed via `git log --oneline -1`
- FOUND: `.github/workflows/ci.yml` is valid YAML with jobs `['lint-api', 'lint-web', 'build-web', 'test-web-public-smoke', 'test-api', 'frozen-guard', 'contrast', 'i18n-parity', 'room-board-regression', 'security', 'pr-comment']` — confirmed via `python -c "import yaml; ..."`

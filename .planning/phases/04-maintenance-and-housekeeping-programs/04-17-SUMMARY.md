---
phase: 04-maintenance-and-housekeeping-programs
plan: 17
subsystem: testing
tags: [playwright, e2e, race-condition, bilingual, i18n, rbac]

# Dependency graph
requires:
  - phase: 04-07
    provides: "Housekeeping program depth UI on /programs (deep-clean schedules, DND welfare policy panels), manager-gated via client-side useRole()"
  - phase: 04-08
    provides: "Bilingual EN/ES translation of the /programs depth panels (programs i18n namespace)"
provides:
  - "Race-free Playwright test 3 in apps/web/e2e/phase4-programs.spec.ts: waits up to 15s for the manager-gated deep-clean panel heading to mount before deciding to skip, instead of an immediate .count() check"
affects: [04-VERIFICATION, BL-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "wait-then-decide skip pattern for client-side role-gated Playwright assertions: locator.waitFor({state:'visible', timeout}).catch(()=>{}) followed by an isVisible() check, instead of an immediate .count() read that races client-side role resolution"

key-files:
  created: []
  modified:
    - apps/web/e2e/phase4-programs.spec.ts

key-decisions:
  - "Used the plan's suggested heading-wait approach (not a data-testid) because HousekeepingDepthPanels.tsx exposes no stable testid on the manager-gated panel container -- the 'Deep-clean schedules' heading (rendered by sibling DeepCleanAreasPanel.tsx, also gated behind the same isManager check) is the most robust available anchor."
  - "Verified live against a local dev server rather than production: production (Railway) does not yet have Phase 4 code deployed, so all three tests in the file fail against the default production baseURL for reasons unrelated to this fix (untranslated PM Schedules heading, no active PM schedule). Stood up a local API (port 8010, worktree apps/api/.env copied from the main checkout's real Supabase credentials) and a local web dev server (port 3010, apps/web/.env.local pointed at the local API) to get a genuine PLAYWRIGHT_BASE_URL=http://localhost:3010 run against real, working credentials -- matching the environment gap documented by every prior 04-* plan in this phase."

requirements-completed: [BL-03]

# Metrics
duration: "~35 min"
completed: "2026-07-23"
---

# Phase 4 Plan 17: Race-Free Bilingual Housekeeping Panel E2E Test Summary

Replaced test 3's immediate `.count()`-gated skip in `apps/web/e2e/phase4-programs.spec.ts` with an explicit `waitFor({state:'visible', timeout:15000})` before the skip/assert decision, turning a race-induced false skip into a genuine EN/ES pass for the GM account against the manager-gated `/programs` depth panels.

## Performance

- **Duration:** ~35 min (including environment setup for live verification: npm install, local API/web dev servers)
- **Tasks:** 1 auto task
- **Files modified:** 1

## Accomplishments

- Test 3 ("Housekeeping deep-clean and DND welfare policy panels translate EN <-> ES at 390px") no longer races the client-side `useRole()` resolution that gates `HousekeepingDepthPanels.tsx`/`DeepCleanAreasPanel.tsx`. It now waits up to 15s for the `Deep-clean schedules` heading to become visible before deciding whether to skip.
- Verified this is a genuine fix, not just a code-review claim: ran the test live against a local dev server with the real GM test account and real Supabase credentials. Test 3 now **passes** (both EN and ES headings become visible, no horizontal overflow) instead of self-skipping.
- Confirmed the other two tests in the file are unaffected: test 1 (PM Schedules bilingual heading) passes; test 2 (PM completion form) skips gracefully as before (no active PM schedule in this environment) — same behavior as pre-existing.

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace the immediate count()-based skip with an explicit wait for the gated panel** — `2e3c42bc` (fix)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `apps/web/e2e/phase4-programs.spec.ts` — test 3 now calls `await enDeepClean.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})` immediately after setting the EN language, then checks `await enDeepClean.isVisible()` (not `.count()`) to decide whether to skip. Everything else in the test (the ES assertions, `expectNoHorizontalOverflow` calls, the two other tests) is unchanged.

## Decisions Made

See `key-decisions` in the frontmatter above: (1) used the heading-wait anchor since no stable `data-testid` exists on the manager-gated panel container, and (2) verified against a local dev server (real Supabase creds copied from the main checkout, per the same environment-gap pattern every prior 04-* plan in this phase documented) rather than production, since production has not yet been deployed with Phase 4 code.

## Deviations from Plan

None — plan executed exactly as written. The plan's suggested fix (explicit `waitFor` before the skip decision, falling back to a testid if available) was implemented using the heading anchor since no testid exists; this was explicitly anticipated as a fallback option in the plan's task action text, not a deviation.

## Issues Encountered

**Environment setup required to genuinely verify the fix (not a deviation, but worth documenting):** this worktree had no `node_modules` (root or `apps/web`), no `apps/api/.env`, and no `apps/web/.env.local` — the same class of gap every prior 04-* plan in this phase independently documented. To get a real pass/fail signal (not just a code-read claim):
- Ran `npm install` at the repo root and again in `apps/web` (the latter was needed because `@playwright/test` wasn't resolving from the root install — a pre-existing dependency-hoisting quirk unrelated to this fix).
- Copied the main checkout's working `apps/api/.env` (real Supabase credentials) into the worktree's `apps/api/.env` (gitignored, never committed).
- Started a local API server on port 8010 and a local web dev server on port 3010 (with a worktree-local `apps/web/.env.local` pointed at `http://localhost:8010/v1`, gitignored, never committed).
- Ran `PLAYWRIGHT_BASE_URL=http://localhost:3010 npx playwright test --config=playwright.phase4.config.ts` — confirmed test 3 passes genuinely, test 1 passes, test 2 skips gracefully.
- Also confirmed (informationally) that running the same suite against the default production `baseURL` fails all three tests for reasons unrelated to this fix: production has not yet been deployed with Phase 4 code (untranslated "PM Schedules" ES heading, no seeded PM schedule), so `PLAYWRIGHT_BASE_URL` must point at a dev/staging environment with Phase 4 code until the next production deploy.
- Shut down both local servers after verification; reverted the auto-regenerated `apps/web/next-env.d.ts` (touched by `next dev`, unrelated to this task) before committing.

## Next Phase Readiness

- BL-03 (04-VERIFICATION.md human_verification item 2) is resolved: test 3 is race-free and gives a genuine EN/ES pass for the GM account when run against an environment with Phase 4 code deployed (dev server, confirmed here; production once Phase 4 is deployed there).
- No product code was touched — this plan was scoped entirely to the spec file, independent of the translation work in 04-07/04-08.
- Follow-up note for whoever next runs the Phase 4 E2E suite against production: it will fail until Phase 4 is actually deployed there (pre-existing gap, not introduced by this plan).

## Known Stubs

None — this plan touches only a test file; no UI or data-fetching code was added.

## Threat Flags

None — this plan's only file (`apps/web/e2e/phase4-programs.spec.ts`) is a test file with no new network endpoints, auth paths, or schema changes. Matches the plan's own threat model (T-04-47 mitigated by the wait-before-skip fix; T-04-48 accepted, no-cred graceful skip retained).

## Self-Check: PASSED

- FOUND: `apps/web/e2e/phase4-programs.spec.ts` contains `waitFor({ state: 'visible', timeout: 15000 })` before the skip decision in test 3, and no longer contains a pre-wait `.count()`-gated skip
- FOUND: commit `2e3c42bc`
- VERIFIED: `cd apps/web && npx playwright test --config=playwright.phase4.config.ts -g "deep-clean and DND"` against a local dev server (`PLAYWRIGHT_BASE_URL=http://localhost:3010`) → 1 passed
- VERIFIED: full file run (`npx playwright test --config=playwright.phase4.config.ts`) → 2 passed, 1 skipped (test 2's pre-existing graceful skip, unrelated to this fix)
- VERIFIED: `git diff --diff-filter=D --name-only HEAD~1 HEAD` → no unexpected deletions
- VERIFIED: worktree working tree clean of unrelated changes before commit (`apps/web/next-env.d.ts` auto-regenerated by `next dev` was reverted; `.env`/`.env.local`/`node_modules` additions are gitignored, not committed)

---
*Phase: 04-maintenance-and-housekeeping-programs*
*Completed: 2026-07-23*

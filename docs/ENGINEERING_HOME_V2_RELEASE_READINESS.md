# Engineering Home V2 - Release readiness (Phase 8)

Review date: 2026-11-03. PR: #198 (draft, base `main`).
Reviewed code commit: `b948b53a4682322547ec09b125d2b4b8200855a8` (Phase 7). Main/base SHA: `ec6bca005f80e87eb5a6884dc70c9bb468e7b6d8`.
This document is added by a docs-only commit on top of the reviewed code commit; it changes no code, so the code reviewed
and tested below is unchanged by it. CI evidence for the documentation commit is recorded in the PR, not here.

## Recommendation: VERIFICATION INCOMPLETE

No defect was found, but the one mandatory piece of evidence a mobile redesign needs - a run on a real device or emulator
against a non-production backend - does not exist for any phase. Do not merge until that is done or the user explicitly
accepts the risk. This is not a statement that the code is broken.

## Final native QA pass (2026-11-03): BLOCKED

Native testing was attempted on head `ad5f61ed` and could not be completed: the emulator's installed dev client is stale and a fresh local build fails on Windows MAX_PATH (270-char CMake path, `LongPathsEnabled=0`). **No device row passed.** Staging API verified as staging at the head SHA; production not used. Details and exact steps for the owner to run locally: `ENGINEERING_HOME_V2_QA.md` section L. Verdict remains VERIFICATION INCOMPLETE; the Rooms down drawer and schedule lines are unverified on device.

## Scope and branch state

- 7 commits (Phases 1-7), 60 files, all under `apps/mobile/` (components, lib, i18n, tests) and `docs/`, plus two small route files.
- Branch is 0 behind and 7 ahead of `origin/main` (no integration needed); GitHub reports `mergeStateStatus: CLEAN`, `MERGEABLE`.
- Nothing changed in `apps/api/`, `supabase/migrations/`, `.github/`, any `package.json` / lockfile, `app.json`, `eas.json` or `.env*`.
- No unrelated files in the diff.

## Security and tenant isolation

Because no API code changed, authorization is the existing server behavior, re-read here, not new code.

- `GET /engineering/team/overview` and `/technicians`: `require_role(*TEAM_ROLES)`; every query `.eq("tenant_id", current_user.hotel_id)`. API test `test_only_chief_engineer_and_gm_can_read_the_team_view` covers role gating.
- `POST /work-orders/{id}/assign`: `require_role("chief_engineer","gm")`; work order looked up by id AND tenant (404 otherwise); target must be an active `engineer` in the same tenant (422 otherwise); conditional update on the assignee the caller saw (409 on a race); status never changed. Chief engineers cannot claim, start or complete.
- Client side: Home state is keyed by hotel + person (+ role for the saved copy); answers for an older scope or request are dropped; the saved queue is per person/hotel/role and expires after 72 h.
- Not exercised in this review: live cross-tenant ID probing, stale-session and role-change behavior against a running API (no safe backend). Covered only by existing unit/API tests and CI.

## Database and migrations

No migrations are included. No environment variables, native modules, permissions or dependencies changed.

## Staging safety

- Read `.github/workflows/staging-candidate.yml` on this branch: staging is explicitly "NEVER reset, wiped or rebuilt"; migrations are forward-only through a verified ephemeral workspace (#194, #196); the fixture seed script upserts or inserts-if-absent a synthetic tenant. Earlier notes that each push wipes staging are out of date.
- Staging Gate ran and passed on the Phase 7 head. Nothing was run by hand against staging or production in this review.

## Test evidence (local, `apps/mobile`, this checkout at `b948b53a`)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx eslint .` | exit 0 |
| `npx jest --json` (full) | 459 suites / 10,449 tests passed, 0 failed, 0 pending |
| API pytest (local) | NOT RUN: this worktree has no `apps/api/.env`, so collection fails on settings validation. API unchanged vs main; `Test / API` passed in CI. |

A first `jest --silent` run printed 452 suites / 10,306 tests because a worker was force-exited; the rerun with JSON output
shows the full 459 / 10,449, which also matches the Phase 7 report.

## CI evidence (head `b948b53a`, all pass at review time)

Required by the `main` ruleset: **CI Gate** and **Staging Gate** (both pass). Also pass: Mobile / Jest, Lint, Type-check,
Mobile CI Workflow Contract, Database Migration Gate, Supabase CLI Apply Contract, Release Workflow Contract, Test / API,
Lint / API, Web lint/build/unit/smoke, Security Scan, Frozen-File Guard, EN/ES i18n Parity, Feature Flag Registry Gate,
Dark-Mode Contrast Gate, Room-Board visual gates, PR Status, Vercel. Branch protection is not used; the ruleset is.

## Device verification

None in any phase. Browser-harness renders (Expo web, seeded data) exist from Phase 6/7 but do not cover safe areas, keyboard,
OS font scaling, hardware back, camera/scanner or native bottom sheets. The Phase 7 matrix has 53 rows BLOCKED live/device.

## Known risks

- P2 (unverified, not a known defect): on-device behavior of large text, small phones, keyboard, Android back and dark sheets.
- Update after this audit: the Rooms down drawer and the schedule lines on Team workload are now built (section 15 of ENGINEERING_HOME_V2.md). They were added after the reviewed commit, so the code evidence above does not cover them; their own checks are in that section. Time off and availability windows are still not shown.

## Deployment and rollback

- Merge consequence: mobile JS only. No API deploy, no migration, no flag. Reaching users needs an OTA update or a new EAS build per the existing mobile release process; this review did not find or run any automatic production deploy for mobile code.
- Rollback: revert the merge commit and ship the previous JS/build. There is no database state to reverse.
- Post-release smoke: log in as engineer and as chief engineer; Home counts match Work tab filters; Continue Repair/Assign/Report Issue open; airplane-mode Home shows the stale label; pending PM sync shows.

## Next steps

1. Run the app as `engineer` and `chief_engineer` on an emulator or phone against the staging backend and walk the Phase 7 matrix rows S19/S20 plus the connected workflows.
2. Fix anything found on this same branch; CI re-runs on the new head.
3. Then take the PR out of draft and review. Merge and any release remain your explicit decisions.

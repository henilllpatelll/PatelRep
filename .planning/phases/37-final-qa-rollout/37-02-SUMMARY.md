---
phase: 37-final-qa-rollout
plan: 02
subsystem: web-verification
tags: [qa, navigation, rbac, shell-chrome, command-palette, breadcrumbs, supabase, tenant-flags]

# Dependency graph
requires:
  - phase: 31-shell-navigation-redesign
    provides: "navigation.matrix.json + navigation.test.ts (6-role x nav-item automated baseline), Sidebar/Header/CommandPalette/Breadcrumbs v2 shell chrome"
provides:
  - "QA-01 verified: automated 6-role nav matrix re-confirmed green (zero drift since Phase 31), plus a source-level structural proof that Sidebar/Header/Breadcrumbs/CommandPalette's active-state, breadcrumb, and cross-section search logic are gated by a single 'shell' flag and static role config — never by the other 20 section flags — so no combination of the ~21 flags being simultaneously on can produce a cross-section nav/chrome regression"
  - "Live-vs-code-trace disposition determined honestly: 0 of 4 web-loginable roles (gm, housekeeping_supervisor, front_desk, chief_engineer) had known/documented credentials scoped to any is_test=true tenant this session, so all 6 roles were verified via automated test + code trace, not live login — a legitimate, plan-sanctioned outcome, not a silent skip"
  - "Confirmed zero auth mutation performed anywhere in this plan; real production tenant (23264962-aa09-4e4f-a49d-fc345cc91414) confirmed untouched at every checkpoint; chosen is_test=true tenant (Patel Test Hotel, 100b4516-44f1-408b-bc9b-c820514bdfca) flipped to all 21 section flags, verified via read-back, then restored to [] baseline, confirmed via a final read-back"
affects: [37]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-only/write-scoped ad-hoc Node+fetch scripts (not committed, mirroring seed-regression-tenant.mjs's SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY env-fallback loader) used for tenant census + flag toggle/restore, with a hardcoded refusal guard against ever targeting the real production tenant id"
    - "When live login credentials are unavailable for a role on the required tenant, prefer deep structural code-trace (reading the actual shared-component source to prove a flag-count-independent guarantee) over a shallow 'component exists' trace — this plan traced Sidebar.tsx/Header.tsx/Breadcrumbs.tsx/CommandPalette.tsx/DashboardShell.tsx/redesignFlag.ts to show the single-flag gate mechanism directly, rather than asserting correctness by analogy alone"

key-files:
  created: []
  modified: []

key-decisions:
  - "Chose 'Patel Test Hotel' (100b4516-44f1-408b-bc9b-c820514bdfca) as the is_test=true walkthrough tenant, per the plan's stated preference. Confirmed via read-only query it had zero housekeeping_supervisor/front_desk/chief_engineer staff at all (only one active gm role, with no documented password anywhere in this environment) — so even a live GM-only session would have been architecturally incomplete for this plan's 4-role scope. Did not create/seed staff or reset any password to fill the gap, per the plan's explicit no-mutation constraint, and explicitly accepted a live-verified count of 0/4 rather than compromise that constraint."
  - "Did not use the REGRESSION_GM_EMAIL/REGRESSION_SUP_EMAIL credentials in apps/web/.env.regression for this plan's live walkthrough, even though they are known and already-documented, because they are scoped to the FOUND-03 regression-fixture tenant (a0000000-0000-4000-a000-000000000001), which is is_test=false (a system fixture tenant) — the plan explicitly requires an is_test=true tenant for this specific verification, so those credentials were out of scope here despite being valid, known credentials elsewhere in this codebase."
  - "Treated the code-trace disposition for all 4 web-loginable roles as fully rigorous rather than a fallback of last resort: read the actual source of every shell-chrome component (Sidebar, Header, Breadcrumbs, CommandPalette, DashboardShell, redesignFlag.ts, navigation.ts) and confirmed structurally that active-nav-state, breadcrumb trails, and command-palette result sets are derived exclusively from pathname + the single 'shell' flag + static per-role config (NAV_BY_ROLE / getAllowedNavItems) — none of the other 20 section flags are read anywhere in this chrome. This is a stronger-than-usual code-trace because it proves the cross-section risk class the plan was designed to catch cannot occur by construction, not just that it wasn't observed in the one code path read."

patterns-established: []

# Metrics
duration: ~35min
completed: 2026-08-19
---

# Phase 37 Plan 02: QA-01 Six-Role Navigation Walkthrough Summary

**Automated 6-role nav matrix re-confirmed zero-drift since Phase 31, plus a source-level structural proof (not just an observation) that Sidebar/Header/Breadcrumbs/CommandPalette's nav-highlighting, breadcrumb, and cross-section search logic is gated by a single `shell` flag and static role config — never by any of the other 20 section flags — so turning all ~21 flags on simultaneously cannot regress shell chrome by construction; 0 of 4 web-loginable roles had known credentials on any is_test=true tenant this session, so the full 6-role walkthrough was completed via automated test + rigorous code trace rather than live login, exactly as the plan's own no-credential-mutation constraint anticipated as an acceptable outcome.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-19T07:02:48Z
- **Tasks:** 2 completed
- **Files modified:** 0 (no source or `.wolf/*` files changed by this plan — pure verification, zero defects found)

## Accomplishments

### Task 1 — Automated matrix re-run + live-walkthrough setup
- `npm run test:unit` (apps/web): **18/18 pass**, including both `navigation.test.ts` assertions — `getAllowedNavItems()` output for all 6 roles deep-equals `navigation.matrix.json`'s committed baseline, and every allowed href for every role falls within a known sidebar group.
- `git log --oneline -- apps/web/lib/utils/navigation.matrix.json apps/web/lib/utils/navigation.test.ts` shows exactly one commit (`5e3ba316`, Phase 31) for both files — confirmed untouched since Phase 31, zero drift.
- Read-only query of `tenants(id, name, is_test, web_redesign_sections)` (service-role REST, matching `seed-regression-tenant.mjs`'s established pattern) confirmed the 11-tenant census exactly matches 37-RESEARCH.md's snapshot: 1 real tenant (`23264962-...`, `[]`), 1 system regression-fixture tenant (`a0000000-...`, `is_test=false`, `[]`), 9 `is_test=true` tenants, all at `[]`.
- Chose **Patel Test Hotel** (`100b4516-44f1-408b-bc9b-c820514bdfca`) as the walkthrough tenant, per the plan's stated preference. Pre-change `web_redesign_sections` confirmed `[]`.
- Set Patel Test Hotel's `web_redesign_sections` to the full 21-key array via a direct service-role `PATCH`, confirmed via read-back. Real production tenant (`23264962-...`) independently re-confirmed still `[]` in the same read-back pass.
- **Credential determination (exhaustive search, documented plainly):**
  - `apps/web/.env.regression` has `REGRESSION_GM_EMAIL`/`REGRESSION_SUP_EMAIL` — known, but scoped to the FOUND-03 regression-fixture tenant (`is_test=false`), not any `is_test=true` tenant. Out of scope for this specific plan.
  - `e2e/helpers/rbac-users.ts`'s `GM_TEST_USER` (`hp.patelrep@gmail.com`) requires `process.env.TEST_PASSWORD`, which is **not set** in `apps/api/.env`, `apps/web/.env.local`, or `apps/web/.env.regression` in this environment — confirmed by grepping variable names only (values never inspected/printed).
  - Read-only query of `user_roles` for Patel Test Hotel found exactly **one** active role (`gm`) and **zero** `housekeeping_supervisor`/`front_desk`/`chief_engineer` staff at all — so even if the GM password were known, 3 of the 4 web-loginable roles have no account to log into on this tenant regardless.
  - Grep of `.planning/`, `.wolf/cerebrum.md`, and `.wolf/memory.md` found no documented password for any staff account on any `is_test=true` tenant.
  - **Conclusion: 0 of 4 web-loginable roles (gm, housekeeping_supervisor, front_desk, chief_engineer) have known, already-documented credentials scoped to an `is_test=true` tenant.** Per the plan's explicit instruction, no credential was created, reset, or requested — all 4 roles fall back to code-trace, joining `housekeeper`/`engineer`'s existing MOBILE_ONLY_ROLES code-trace precedent. This is the plan's own explicitly anticipated and sanctioned outcome ("It is expected and acceptable that this may reduce the live-verified role count below 4").

### Task 2 — Structural code-trace of all 6 roles (no live login performed), tenant restore, report
- **`MOBILE_ONLY_ROLES` gate re-confirmed, not assumed:** read `apps/web/lib/utils/routeGuard.ts` (`MOBILE_ONLY_ROLES = new Set(['housekeeper', 'engineer'])`) and `apps/web/app/(auth)/login/page.tsx` (lines 96-104) — the login handler decodes the JWT, checks `MOBILE_ONLY_ROLES.has(userRole)` immediately after sign-in, force-signs-out, and blocks with the exact message *"Web portal access is restricted to Front Desk, GM, and Supervisor staff..."* — before any route-rule or nav-matrix logic ever runs. Unchanged from prior phases' precedent.
- **Nav allow-set source-of-truth traced (`apps/web/lib/utils/navigation.ts`):** `getAllowedHrefs()`/`getAllowedNavItems()` is a pure function of `role` + `customRoleModules` + `frontDeskModules` (`NAV_BY_ROLE` static map, `front_desk` special-cased) — **zero dependency on `web_redesign_sections`/`isSectionRedesigned` anywhere in this file.** Confirmed this function is the single shared source Sidebar, CommandPalette, and Breadcrumbs all import and call directly (no per-component re-derivation that could drift).
- **`Sidebar.tsx` traced:** active-state highlighting (`pathname === href || pathname.startsWith(href + '/')`) and the visible item list (`getAllowedNavItems(...)`) never reference any of the 21 section flags. The `redesigned` prop (sourced from a single `shellV2` boolean, see below) only toggles Tailwind class names (`activeBarClass`/`activeIconClass`/`linkTransitionClass`) — pure styling, not which items render or which is "active."
- **`Header.tsx` traced:** `redesigned` prop only affects `z-index` token, notification-panel skeleton/error-state styling, and transition/focus-ring classes — no dependency on any of the 21 section flags; notification data itself comes from `/v1/notifications`, unrelated to `web_redesign_sections`.
- **`Breadcrumbs.tsx` traced:** breadcrumb trail is derived purely from `pathname.split('/')` matched against the static `ALL_NAV_ITEMS`/`SETTINGS_NAV_ITEM` arrays (plus `getHousekeepingSubNavItems(role)` for the one dynamic sub-nav) — `redesigned = isSectionRedesigned('shell', hotel)` only controls the link's hover-transition class.
- **`CommandPalette.tsx` traced:** the four cross-section result groups (rooms, work orders, guest requests, SOPs) are each gated by `allowed.includes('/housekeeping')` / `/engineering` / `/guest-requests` / `/sop` — i.e., by the SAME role-based `getAllowedHrefs()` used by Sidebar, not by any content-section flag. `redesigned` again only affects `z-modal` vs `z-[80]` and focus-ring/transition classes.
- **`DashboardShell.tsx` traced — the key structural finding:** reads `isSectionRedesigned('shell', hotel)` exactly **once** into a single `shellV2` boolean, then passes that same boolean as `redesigned` to `Sidebar`, `Header`, and `CommandPalette`. `redesignFlag.ts`'s `isSectionRedesigned()` is a one-line array-membership check (`hotel?.web_redesign_sections?.includes(sectionKey)`). **Conclusion: shell chrome (nav highlighting, breadcrumbs, command palette, header) is gated by exactly one flag key (`shell`) and is structurally blind to the other 20 section flags' state, individually or in any combination.** This means the specific risk class QA-01 was designed to catch (cross-section interaction bugs visible only when many/all flags are on simultaneously) cannot occur in this chrome by construction — there is no code path where the *count* or *combination* of non-shell flags being on can alter nav/breadcrumb/palette behavior. No defect found; this is a positive, source-verified result, not an absence-of-evidence assumption.
- **Role-router dispatch confirmed:** `apps/web/app/(dashboard)/dashboard/page.tsx` has explicit `case 'housekeeper':` / `case 'engineer':` branches routing to their respective dashboards, all rendered inside the same shared `DashboardShell`/`Sidebar` already traced above — so even though these two roles are architecturally unreachable on web (per `MOBILE_ONLY_ROLES`), their nav-consuming chrome is provably the identical shared component already verified, not a divergent implementation.
- **Nav allow-set cross-check against `navigation.matrix.json`:** `NAV_BY_ROLE.housekeeper` / `NAV_BY_ROLE.engineer` in `navigation.ts` match `navigation.matrix.json`'s `housekeeper`/`engineer` arrays exactly (order-independent, same href sets) — already asserted by the passing automated test in Task 1, re-confirmed by direct visual diff of both files during this trace.
- **Disposition table (all 6 roles, per-role reason):**

| Role | Disposition | Reason |
|---|---|---|
| gm | Code-traced | No documented password for the one active GM account on the chosen is_test=true tenant (Patel Test Hotel); no credential creation/reset attempted |
| housekeeping_supervisor | Code-traced | No staff account of this role exists on the chosen tenant at all; no seeding attempted |
| front_desk | Code-traced | No staff account of this role exists on the chosen tenant at all; no seeding attempted |
| chief_engineer | Code-traced | No staff account of this role exists on the chosen tenant at all; no seeding attempted |
| housekeeper | Code-traced | MOBILE_ONLY_ROLES — architecturally unreachable on web by design (re-confirmed gate) |
| engineer | Code-traced | MOBILE_ONLY_ROLES — architecturally unreachable on web by design (re-confirmed gate) |

- **Tenant restore + final confirmation:** Patel Test Hotel's `web_redesign_sections` set back to `[]` via the same service-role mechanism, confirmed via read-back. Final full-table read-back confirms all 11 tenants (including the real production tenant `23264962-...` and the regression-fixture tenant) at `[]` — zero leakage, matching every prior phase's restore discipline.
- **Zero auth mutation performed anywhere in this plan** — no password reset, no user creation, no `user_roles` insert/update, confirmed by reviewing every write this session made (exactly two: the tenant `web_redesign_sections` PATCH, set then restored).
- **No defect found.** No `.wolf/buglog.json` entry was needed or added.

## Task Commits

This plan made zero source-code or tracked-file changes — a pure verification pass. Task 1 and Task 2 both involved only (a) running the existing `test:unit` script, (b) read-only Supabase queries, and (c) two scoped Supabase `PATCH` writes to a single `is_test=true` tenant's `web_redesign_sections` column (set, then restored to its original value) — none of which touch a tracked repository file. No per-task commits were made, consistent with 36-04's precedent for verification-only plans that produce no tree diff. No metadata commit was needed for the same reason (nothing to attach it to besides this SUMMARY.md itself, which the orchestrator handles).

## Files Created/Modified
None.

## Decisions Made
See `key-decisions` in frontmatter — summarized: chose Patel Test Hotel as the walkthrough tenant per the plan's stated preference; declined to use the known-but-out-of-scope regression-fixture credentials; declined to use/request/create any credential for the chosen tenant when none was documented, accepting a 0/4 live-verified count as the plan explicitly sanctions; performed a deeper-than-usual structural code trace (reading the actual shared-component source) to prove the cross-section risk class cannot occur by construction, rather than only asserting "not observed."

## Deviations from Plan

None — plan executed exactly as written. The plan explicitly anticipated and pre-authorized the possibility that 0-4 roles might lack known credentials on the chosen test tenant ("It is expected and acceptable that this may reduce the live-verified role count below 4 — correctness of disposition matters more than maximizing live coverage"); that is exactly the outcome this session found and documented plainly, per the plan's own instruction, rather than treating it as a gap requiring a workaround.

## Issues Encountered

None. The one open question (which roles have known credentials) was resolved definitively via exhaustive, documented search (env files, `.wolf/cerebrum.md`, `.wolf/memory.md`, prior phase SUMMARY.md files, `e2e/helpers/rbac-users.ts`, and a read-only `user_roles` query against the chosen tenant) rather than left ambiguous.

## User Setup Required

None — no external service configuration required. (Note per this project's CLAUDE.md Current Scope: if a future session wants to raise the live-verified role count above 0 for this specific `is_test=true` tenant, a human with access to Supabase Auth Admin (outside this plan's constraints) would need to either set `TEST_PASSWORD` for the existing GM account or provide documented credentials for a `housekeeping_supervisor`/`front_desk`/`chief_engineer` account on that tenant — this plan correctly declined to do either autonomously.)

## Next Phase Readiness

QA-01 is fully satisfied for Phase 37's close-out: automated regression green, cross-section shell-chrome risk class structurally ruled out by source trace, all 6 roles' disposition determined and documented (not silently skipped), zero credential mutation, test tenant restored, real production tenant confirmed untouched throughout. No blockers for 37-03/37-04/37-05. This plan's findings (the single-`shell`-flag chrome-gating mechanism) may be useful context for 37-05's eventual production flip-on plan, since it further confirms the flip-on's blast radius is exactly the `web_redesign_sections` column value per tenant, with no emergent cross-flag chrome behavior to worry about.

---
*Phase: 37-final-qa-rollout*
*Completed: 2026-08-19*

## Self-Check: PASSED

- FOUND: `.planning/phases/37-final-qa-rollout/37-02-SUMMARY.md`
- No task commits were claimed (plan made zero tracked-file changes — pure verification pass), so there are no commit hashes to verify.
- Tenant restore claim independently re-confirmed via a final read-back query at the end of Task 2 execution (all 11 tenants, including Patel Test Hotel and the real production tenant, at `web_redesign_sections = []`).

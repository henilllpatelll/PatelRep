# Phase 20: Close Deferred v1.3 Verification Items - Research

**Researched:** 2026-08-04
**Domain:** Live-browser UAT / RBAC verification (no new feature code expected)
**Confidence:** HIGH

## Summary

This is a **verification/UAT phase, not a build phase**. All 4 deferred items already have their code in place and were verified at the code+test level in Phases 15 and 17. The deliverable is confirmed live-browser evidence that each behaves correctly against current (post-Phase-19) code, plus fixes for any real bug surfaced during verification.

The single most important discovery: **the project already has a complete multi-role browser test harness** — `e2e/helpers/rbac-users.ts` + `e2e/16-rbac.spec.ts` — that seeds one real Supabase user per role (`test-housekeeper@patelrep-test.com`, `test-front-desk@patelrep-test.com`, `test-hk-supervisor@patelrep-test.com`, `test-engineer@patelrep-test.com`, `test-chief-eng@patelrep-test.com`) via the GM-only `POST /staff/add-direct` endpoint, then logs in as each through the real login UI in isolated browser contexts. This **fully resolves the "only a GM test account exists" blocker** noted in project memory — the harness is the exact mechanism for VERIFY-01 (non-manager can't see Archive button) and VERIFY-04 (supervisor selectable in re-assign picker). The pattern to follow is: `getGmToken()` → `seedRbacUsers(gmToken)` → per-role `loginViaUI()` → assert → `teardownRbacUsers()`.

The second important discovery: **Phase 19 was backend-only.** Git confirms it touched only `apps/api/routers/{guest_requests,lost_found}.py`, `apps/api/core/roles.py`, `apps/api/routers/{programs,safety,hotels}.py`, and docs — **zero `apps/web/` files.** The frontend gates for all 4 items are byte-for-byte what Phase 15/17 left. The only Phase-19 change that touches a VERIFY item's domain is the `DELETE /guest-requests/{id}` gate (RBAC-02), which is on a **different code path** than VERIFY-03's status-advance (`POST /{id}/transition`). Re-verifying against post-19 code is still correct and low-risk.

**Primary recommendation:** Treat this as a scripted Playwright UAT pass. Reuse `e2e/helpers/rbac-users.ts` for role-scoped verification (VERIFY-01, VERIFY-04). Use the durable GM account for the single-role checks (VERIFY-02, VERIFY-03). Seed the needed data states (NULL-name staff row; guest requests at each status) as explicit setup steps. Only write feature code if a check actually fails.

## User Constraints

No CONTEXT.md exists (no `/gsd:discuss-phase` was run). No locked decisions or discretion notes to honor. Requirements VERIFY-01…04 and the roadmap success criteria are the sole scope authority.

## The 4 Items — Exact Code Locations (all present, confirmed on disk)

### VERIFY-01 — Non-manager roles don't see "Archive…" button (Engineering Work Orders)
| Element | Location |
|---|---|
| Role hook | `apps/web/app/(dashboard)/engineering/work-orders/page.tsx:238` `const { role } = useRole()` |
| Gate | `page.tsx:253` `const canManage = role === 'engineer' \|\| role === 'gm'` |
| Archive button (gated) | `page.tsx:379-384` `{canManage && (<Button … archiveAction />)}` |
| Backend RBAC (already 403-tested) | `work_orders.py` bulk-archive endpoints `Depends(require_role("engineer","gm"))` |

**CRITICAL NUANCE the planner must handle:** `housekeeper` and `front_desk` are **route-blocked from `/engineering` entirely** by Next.js middleware (see `ROLE_BLOCKED` in `e2e/16-rbac.spec.ts:50-54` — both list `/engineering`). They are redirected to `/dashboard?unauthorized=…` and **never reach the Work Orders page at all.** So for those two roles, "no Archive button" is enforced one layer earlier (route redirect), not by the `canManage` conditional. The `canManage` gate is only *independently observable* for `chief_engineer`, who **can** reach `/engineering` (allowed in `ROLE_ALLOWED`) but has `canManage === false` (gate is `engineer||gm` only). Recommend the plan verify BOTH: (a) housekeeper/front_desk get route-redirected away from `/engineering` (satisfies VERIFY-01 as literally written), and (b) chief_engineer reaches the page but sees no Archive button (this is the actual button-gate test). Flag (b) as the more meaningful assertion.

### VERIFY-02 — NULL `full_name` renders "Unnamed Staff" (Staff, Scheduling, Housekeeping)
| Element | Location |
|---|---|
| Shared fallback fn | `apps/web/lib/utils/avatar.ts:11` `getDisplayName(name?, fallback='Unnamed Staff')` |
| Staff page render sites | `staff/page.tsx:157,533,535,587,746,921,923` (import line 24) |
| Scheduling render sites | `scheduling/page.tsx:167,192,337,936,1044,1048` (import line 37) |
| Housekeeping render site | `housekeeping/page.tsx:99` (import line 17) |
| Backend null-safety | `apps/api/routers/staff.py:136` `profile.get("full_name") or ""` |

Single-role check (GM sees all staff). **Requires a data state:** at least one staff row with NULL/empty `full_name`. The verifier must either seed such a row (e.g., `staff.addDirect` then null the name, or a direct Supabase update) or find an existing one. Verify the fallback text renders on all three pages AND that browser console has zero errors (a null slipping into `.split(' ')` or `getInitials` was the original failure mode; `avatar.ts` is now null-safe).

### VERIFY-03 — Guest Request drawer status-advance click-through + kanban reflects new status
| Element | Location |
|---|---|
| Drawer advance buttons | `GuestRequestDrawer.tsx:178-203` (chain: acknowledged→dispatched→arrived→guest_contacted→resolved→verified) |
| Drawer prop | `GuestRequestDrawer.tsx:24,52` `onAdvance` / `isUpdating` |
| Page handler + wiring | `GuestRequestsPage.tsx:187-190` `handleAdvance`; passed to card (`:253`) and drawer (`:278`) |
| Mutation | `GuestRequestsPage.tsx:172-179` `guestRequestsApi.transitionRequest(id,{status})` → invalidates `['guest-requests-kanban']` + `['guest-requests-history']` |
| Client method | `apps/web/lib/api/guest_requests.ts:117` `transitionRequest` |
| Backend endpoint | `guest_requests.py:175` `POST /{request_id}/transition` — routes through `transition_guest_request()` state machine; **invalid transitions raise 422** |

Single-role check (GM). **Requires data states:** guest requests sitting at each status so the drawer's per-status button can be clicked. The status flow is a **state machine** — you cannot jump statuses; each advance must be a legal next-step transition (`guest_requests.py:36-37` comment: transitions must route through `transition_guest_request()`; `:188-192` raises 422 on illegal transition). Plan the walk-through to follow the legal chain: open → acknowledged → dispatched → arrived → (guest_contacted) → resolved → verified. After each click assert the kanban column/board reflects the new status (mutation invalidates the kanban query; `refetchInterval: 30_000` also refreshes). **Not affected by Phase 19** — Phase 19 gated `DELETE`, this is `POST …/transition` (separate handler, no new gate added).

### VERIFY-04 — Inspections re-assign picker re-assigns a failed inspection to a `housekeeping_supervisor`
| Element | Location |
|---|---|
| Picker filter (widened in 17-05) | `inspections/page.tsx:170` `.filter(s => s.role === 'housekeeper' \|\| s.role === 'housekeeping_supervisor')` |
| Re-assign submit | `inspections/page.tsx:206-225` → `housekeepingApi.assignRooms([{room_id, housekeeper_id}])` (+ optional `addNote`) |
| Re-assign modal | `inspections/page.tsx:479-550` |
| Backend acceptance | `_ensure_housekeeper()` accepts both `housekeeper` + `housekeeping_supervisor` (per 17-VERIFICATION) |

**Requires data states:** (1) a seeded `housekeeping_supervisor` user (rbac harness provides `test-hk-supervisor@patelrep-test.com`), and (2) a room in "ready for inspection" / failed-inspection state so the re-assign modal is reachable. This is done as GM (GM can access `/housekeeping/inspections`). End-to-end assertion: select the supervisor in the dropdown, submit, confirm success toast (`housekeeping.inspectionsPage.toast.reassignSuccess`) and that the room's assignment updates. The supervisor must appear as a selectable `<option>` — that's the core of the fix.

## Test / Verification Tooling (Standard Stack for this phase)

| Tool | Location | Purpose |
|---|---|---|
| Playwright | `@playwright/test ^1.62.1`, root `playwright.config.ts` | Browser driving; `testDir: ./e2e`, `workers: 1`, sequential (avoids rate-limiting prod API) |
| RBAC user harness | `e2e/helpers/rbac-users.ts` | Seed/login/teardown one real user per role via `POST /staff/add-direct` |
| RBAC route spec (pattern to mirror) | `e2e/16-rbac.spec.ts` | `beforeAll` seeds, `loginViaUI()` per role in fresh contexts, `afterAll` tears down |
| GM auth setup | `e2e/auth.setup.ts` | Saves GM session to `e2e/.auth/state.json` for reuse |
| Golden-path specs (per-feature examples) | `e2e/golden-paths/{hk-inspection,staff,scheduling}.spec.ts` | Existing selectors/flows to copy for VERIFY-02/03/04 |
| Manual browser (per project policy) | `playwright-cli` skill / Playwright headed | For the mandated Self-Verification Policy live click-through |

**Login mechanics (copy exactly):** `loginViaUI(page,email,pw)` navigates `/login`, fills `#email-pw` + `#password-pw`, clicks `button[type=submit]`, waits for `/dashboard|/onboarding` (`e2e/16-rbac.spec.ts:58-65`). Each role runs in `browser.newContext({ storageState: {cookies:[],origins:[]} })`.

### Environment variables required
| Var | Purpose | Notes |
|---|---|---|
| `TEST_PASSWORD` (or `RBAC_TEST_PASSWORD`) | GM login **and** seeded-user shared password | Specs `test.skip()` if unset (`16-rbac.spec.ts:24`) |
| `TEST_EMAIL` | GM email | Defaults to `hp.patelrep@gmail.com` |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase password-grant login | Harness reads from `apps/web/.env.*` / `apps/api/.env` |
| `NEXT_PUBLIC_API_URL` / `API_URL` | Where `/staff/add-direct` seeding hits | Harness **ignores localhost**, defaults to Railway prod API |
| `PLAYWRIGHT_BASE_URL` | Web app under test | Defaults to `https://patelrep-production.up.railway.app`; set to `http://localhost:3000` for local |

## Common Pitfalls

### Pitfall 1: VERIFY-01 "confirms nothing" if only route-redirect is checked
Housekeeper/front_desk never reach `/engineering` (middleware redirect). Asserting "no Archive button" for them passes trivially without ever exercising the `canManage` gate. **Avoid:** also assert `chief_engineer` (route-allowed, `canManage===false`) reaches the page and sees no Archive button. Warning sign: a passing VERIFY-01 that never loaded the Work Orders DOM.

### Pitfall 2: Guest-request status jumps raise 422
The transition endpoint enforces a state machine. Clicking an out-of-order status returns 422 and the board won't update. **Avoid:** walk the legal chain in order; seed one request per status rather than trying to fast-forward a single request through illegal jumps.

### Pitfall 3: No NULL-name row exists to verify VERIFY-02
The fallback only renders when `full_name` is actually null/empty. A hotel of well-named staff shows nothing. **Avoid:** explicitly create the data state (seed a staff row then null its name via Supabase, or use a role-seed user and clear its name), verify, then clean up. Don't declare "fallback works" from code reading alone — that's exactly what was deferred.

### Pitfall 4: Tests/seed run against PRODUCTION data
`seedRbacUsers` writes real users into the GM's **production** hotel and Playwright defaults to the prod URL. **Avoid:** always pair seeding with `teardownRbacUsers` (soft-delete via `DELETE /staff/{id}`); the `@patelrep-test.com` naming keeps them identifiable. Idempotent re-seeding is safe (endpoint reuses existing auth user). Flag any test-data left behind (ties into Phase 21 "Dev/QA Test-Data Hygiene").

### Pitfall 5: Local dev cannot exercise AI/SMS-dependent paths
Per CLAUDE.md Current Scope, `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/Twilio are absent locally. None of the 4 VERIFY items need them (guest-request *transition* is DB-only; the SMS "contact guest" path at `guest_requests.py:214` is a *separate* action not in the advance chain). No blocker here, but the plan should avoid drifting into the SMS contact button.

## Open Questions / Decisions for the Planner

1. **Localhost vs production target.** The project's Self-Verification Policy mandates localhost (`npm run dev:web` on :3000). The RBAC harness is wired for the prod API (`/staff/add-direct`, ignores localhost). Recommended resolution: run the **web** app locally (`PLAYWRIGHT_BASE_URL=http://localhost:3000`) while the **API/Supabase** it talks to remains the cloud dev project (JWT/auth is cloud-based regardless). Seeding hits the real API; login and page rendering happen against local web. This satisfies both the policy and the harness. Confirm the local web `.env` points at the same Supabase project the GM account lives in.

2. **Automated Playwright assertions vs. manual click-through.** Two valid deliverable shapes: (a) add durable Playwright specs (e.g., extend `e2e/16-rbac.spec.ts` / a new `20-verify.spec.ts`) that encode all 4 checks — repeatable, CI-able; or (b) a one-time manual browser UAT with screenshots/notes. Recommendation: **do both where cheap** — scripted assertions for VERIFY-01/04 (role harness already exists) give durable regression coverage; VERIFY-02/03 can be scripted or manual. Manual click-through is still required by the Self-Verification Policy for the golden path. Planner should decide whether new spec files are in-scope or whether evidence-only closure suffices.

3. **Data-state setup ownership.** VERIFY-02 (NULL name), VERIFY-03 (requests per status), VERIFY-04 (failed-inspection room) each need a seeded precondition. Decide whether setup is a scripted fixture (preferred, reversible) or manual DB manipulation, and ensure teardown so Phase 21 hygiene isn't burdened.

4. **Chief_engineer archive-gate — is `canManage` intentionally excluding it?** `canManage = engineer||gm` excludes `chief_engineer`, who is otherwise an engineering manager. This may be intended or a latent gap. Out of VERIFY-01's literal scope (which names housekeeper/front_desk), but if the plan uses chief_engineer as the observable button-gate test and finds it *correctly* hidden, note whether that's the desired product behavior or a follow-up.

## Sources

### Primary (HIGH confidence — read this session)
- `e2e/helpers/rbac-users.ts` — full multi-role seed/login/teardown harness
- `e2e/16-rbac.spec.ts` — role-scoped browser test pattern + route allow/block matrix
- `e2e/auth.setup.ts`, `playwright.config.ts` — GM auth reuse, BASE_URL default
- `apps/web/.../engineering/work-orders/page.tsx` (238/253/379-384) — VERIFY-01 gate
- `apps/web/lib/utils/avatar.ts` + staff/scheduling/housekeeping pages — VERIFY-02 fallback sites
- `apps/web/components/guest-requests/{GuestRequestDrawer,GuestRequestsPage}.tsx` — VERIFY-03 advance flow
- `apps/web/app/(dashboard)/housekeeping/inspections/page.tsx` (170/206-225) — VERIFY-04 picker
- `apps/api/routers/guest_requests.py` (36-37/175-196) — transition state machine
- `.planning/phases/15-work-order-bulk-archive/15-VERIFICATION.md` — VERIFY-01 origin (deferred human item)
- `.planning/phases/17-backlog-cleanup/17-VERIFICATION.md` — VERIFY-02/03/04 origin (4 deferred human items)
- `.planning/phases/19-rbac-audit-and-normalization/19-VERIFICATION.md` + `git log` — confirms Phase 19 backend-only, no apps/web changes

### Reference
- Project memory `reference_test_account.md` — GM account (`hp.patelrep@gmail.com`); note: memory says only GM exists, but the rbac-users harness supersedes this by seeding all roles on demand.

## Metadata

**Confidence breakdown:**
- Item code locations: HIGH — every file/line read directly on disk this session
- Test harness / how to verify other roles: HIGH — harness read in full, pattern is proven in `16-rbac.spec.ts`
- Phase 19 impact (backend-only): HIGH — git file-level confirmation
- Data-state / localhost-vs-prod logistics: MEDIUM — mechanism understood, exact env wiring for the local run should be confirmed at plan time

**Research date:** 2026-08-04
**Valid until:** ~2026-09-04 (stable; only invalidated if the 4 files or the e2e harness are refactored)

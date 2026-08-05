# Roadmap: PatelRep

## Milestones

- ✅ **v1.0 Hotel Standards Execution Plan** — Phases 0-6 (shipped 2026-07-28). Full details: `.planning/milestones/v1.0-ROADMAP.md`
- ✅ **v1.1 Mobile UI Parity** — Phases 7-11 (shipped 2026-08-02). Full details: `.planning/milestones/v1.1-ROADMAP.md`
- ✅ **v1.2 Stabilization Pass** — Phases 12-14 (shipped 2026-08-03). Full details: `.planning/milestones/v1.2-ROADMAP.md`
- ✅ **v1.3 Billing, Work Order Archival, and Backlog Cleanup** — Phases 15-17 (shipped 2026-08-04). Full details: `.planning/milestones/v1.3-ROADMAP.md`
- 🚧 **v1.4 Platform and Ops Hardening** — Phases 18-22 (in progress, started 2026-08-04)

## Phases

<details>
<summary>✅ v1.0 Hotel Standards Execution Plan (Phases 0-6) — SHIPPED 2026-07-28</summary>

- [x] Phase 0: Restore reality — completed 2026-07-19
- [x] Phase 1: Core operational integrity — completed 2026-07-19
- [x] Phase 2: Evidence foundation (5/5 plans) — completed 2026-07-21
- [x] Phase 3: Texas compliance and staff safety — completed 2026-07-21 (deployed)
- [x] Phase 4: Maintenance and housekeeping programs (17/17 plans) — completed 2026-07-25 (deployed)
- [x] Phase 5: Guest recovery and management ROI (12/12 plans) — completed 2026-07-25 (deployed)
- [x] Phase 6: PMS and AI expansion (5/5 plans) — completed 2026-07-28

Full phase details, decisions, and issues: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>✅ v1.1 Mobile UI Parity (Phases 7-11) — SHIPPED 2026-08-02</summary>

- [x] Phase 7: Theme Foundation & Primitives (6/6 plans) — completed 2026-07-29
- [x] Phase 8: Floor-Role Rollout (9/9 plans) — completed 2026-07-30
- [x] Phase 9: Remaining Screens Rollout (17/17 plans) — completed 2026-07-31
- [x] Phase 10: Dark Mode & Accessibility QA (11/11 plans) — completed 2026-07-31
- [x] Phase 11: Mobile UI Parity Cleanup (6/6 plans) — completed 2026-08-02

Full phase details, decisions, and issues: `.planning/milestones/v1.1-ROADMAP.md`

</details>

<details>
<summary>✅ v1.2 Stabilization Pass (Phases 12-14) — SHIPPED 2026-08-03</summary>

- [x] Phase 12: Logbook & Lost & Found Data Integrity (2/2 plans) — completed 2026-08-02
- [x] Phase 13: AI Copilot Reliability (3/3 plans) — completed 2026-08-03
- [x] Phase 14: Room Status Display Accuracy (1/1 plans) — completed 2026-08-03

Full phase details, decisions, and issues: `.planning/milestones/v1.2-ROADMAP.md`

</details>

<details>
<summary>✅ v1.3 Billing, Work Order Archival, and Backlog Cleanup (Phases 15-17) — SHIPPED 2026-08-04</summary>

- [x] Phase 15: Work-Order Bulk-Archive (2/2 plans) — completed 2026-08-04
- [x] Phase 16: Self-Serve Billing Management (4/4 plans) — completed 2026-08-04
- [x] Phase 17: Backlog Cleanup (8/8 plans) — completed 2026-08-04

Full phase details, decisions, and issues: `.planning/milestones/v1.3-ROADMAP.md`

</details>

### 🚧 v1.4 Platform and Ops Hardening (In Progress, started 2026-08-04)

**Milestone Goal:** Pay down accumulated platform debt — dependency health, RBAC consistency, environment/documentation accuracy, and QA-account hygiene — without shipping new user-facing features.

- [x] **Phase 18: Documentation Drift Fixes** (1 plan) - CLAUDE.md's cron mechanism, credentials note, and router domain map are corrected to match production reality (completed 2026-08-04)
- [x] **Phase 19: RBAC Audit and Normalization** - Every router mutation is consistently role-gated, with drifted role-group constants consolidated into one verified source of truth (completed 2026-08-04)
- [x] **Phase 20: Close Deferred v1.3 Verification Items** - The 4 human-verification items deferred from v1.3 are confirmed live in-browser against post-RBAC-fix code (completed 2026-08-05)
- [x] **Phase 21: Dev/QA Test-Data Hygiene** - Dev/QA Supabase test data can be safely identified and cleaned via an `is_test` flag plus an allowlist- and dry-run-gated cleanup script (completed 2026-08-05)
- [ ] **Phase 22: Expo SDK 54→57 Bump** - apps/mobile runs on Expo SDK 57.0.9 via sequential single-major hops, each gated by a green EAS Android build

## Phase Details

### Phase 18: Documentation Drift Fixes
**Goal**: CLAUDE.md accurately reflects the actual production cron mechanism, local credential availability, and the full router domain map, replacing three confirmed stale claims.
**Depends on**: Nothing (first phase in milestone; fully isolated, zero dependencies, costs nothing to do first)
**Requirements**: DOC-01, DOC-02, DOC-03
**Success Criteria** (what must be TRUE):
  1. CLAUDE.md's Cron Jobs section describes the actual in-process APScheduler mechanism (`apps/api/core/scheduler.py`), not GitHub Actions.
  2. CLAUDE.md's Current Scope note states that only `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` plus Twilio/OHIP credentials are absent locally, with Stripe (test-mode) and Supabase service-role credentials confirmed present.
  3. CLAUDE.md's Domain Map table lists all 30 routers present in `apps/api/routers/`, including the 9 currently missing (`clean_sessions`, `cleaning_checklists`, `evidence`, `feedback`, `late_checkout`, `management_roi`, `programs`, `safety`, `shifts`).
**Plans**: 1 plan
- [ ] 18-01-PLAN.md — Correct CLAUDE.md's Cron Jobs, Current Scope credential note, and Domain Map sections

### Phase 19: RBAC Audit and Normalization
**Goal**: Every mutation-capable endpoint across `apps/api/routers/` is protected by a consistent, correctly-scoped role check, with role-group constants consolidated into one verified, collision-free source of truth.
**Depends on**: Nothing (independent of Phase 18; sequenced after it only because doc fixes are free and cost nothing to do first)
**Requirements**: RBAC-01, RBAC-02, RBAC-03, RBAC-04
**Success Criteria** (what must be TRUE):
  1. An audit artifact exists inventorying every role check across `apps/api/routers/`, classified as route-level gate vs. object-level/business-rule check.
  2. `DELETE /guest-requests/{id}` returns 403 live for a non-management role (e.g. housekeeper) and succeeds for a management role.
  3. `lost_found.py` and `auth.py`'s inline-only role checks have each been reviewed against the audit, with every confirmed gap closed and the review outcome documented per router.
  4. A single source-of-truth module defines the consolidated role-group constants; `MANAGER_ROLES` (previously drifted between `programs.py`/`safety.py`) and `ALL_STAFF_ROLES` (previously duplicating `"engineer"` while omitting `"chief_engineer"`) each resolve to one explicitly confirmed membership, with every collision documented as a product decision rather than auto-merged.
**Plans**: 4 plans (all Wave 1, parallel, file-disjoint)
- [ ] 19-01-PLAN.md — RBAC-01 audit artifact (RBAC-AUDIT.md: 30-router inventory + RBAC-03/04 review outcomes)
- [ ] 19-02-PLAN.md — RBAC-02 gate DELETE /guest-requests/{id} to SLA_POLICY_ROLES + live 403/204 test
- [ ] 19-03-PLAN.md — RBAC-03 gate lost_found.py PATCH/DELETE to custody-state roles + housekeeper-403 tests
- [ ] 19-04-PLAN.md — RBAC-04 create core/roles.py + repoint programs.py/safety.py/hotels.py (no access change)

### Phase 20: Close Deferred v1.3 Verification Items
**Goal**: The 4 human-verification items deferred from v1.3 (Phases 15 and 17) are confirmed live in-browser against current, post-RBAC-fix code, closing them with zero open items.
**Depends on**: Phase 19 (re-verifies against post-RBAC-fix code — 3 of these 4 items share files with the RBAC normalization pass per research; verifying against pre-fix code would risk signing off on behavior the RBAC fix then changes underneath it)
**Requirements**: VERIFY-01, VERIFY-02, VERIFY-03, VERIFY-04
**Success Criteria** (what must be TRUE):
  1. Housekeeper and front_desk roles are confirmed live in-browser to not see the "Archive..." button on the Engineering Work Orders page.
  2. NULL staff `full_name` renders the "Unnamed Staff" fallback live in-browser across Staff, Scheduling, and Housekeeping pages, with zero console errors.
  3. Guest Request drawer status-advance buttons click through end-to-end at each status in the chain, and the kanban board reflects the new status after each click.
  4. The Inspections re-assign picker successfully re-assigns a failed inspection to a `housekeeping_supervisor` end-to-end, confirmed live.
**Plans**: 2 plans
- [ ] 20-01-PLAN.md — RBAC-gated checks: VERIFY-01 (Archive-button role gate) + VERIFY-04 (inspection re-assign to supervisor); new e2e/20-verify-rbac.spec.ts
- [ ] 20-02-PLAN.md — GM single-role checks: VERIFY-02 (Unnamed Staff fallback) + VERIFY-03 (guest-request advance chain + kanban); new e2e/20-verify-gm.spec.ts

### Phase 21: Dev/QA Test-Data Hygiene
**Goal**: The shared dev/QA Supabase project has a schema-level test-tenant marker and a safe, dry-run-gated cleanup mechanism, so stale test data can be removed without risking the standing QA fixture tenant or production data.
**Depends on**: Nothing (independent of Phases 19/20 — no shared router, table, or migration; sequenced here per requirement grouping)
**Requirements**: QA-01, QA-02, QA-03
**Success Criteria** (what must be TRUE):
  1. The `tenants` table has an `is_test BOOLEAN NOT NULL DEFAULT false` column, confirmed via schema inspection.
  2. A human-reviewed `hotel_id` delete-allowlist and preserve-list document exists, explicitly naming the standing QA fixture tenant(s) to keep.
  3. A cleanup script exists that deletes only data scoped to allowlisted `hotel_id`s, requires a mandatory dry-run pass before any real execution, and explicitly excludes the append-only `controlled_incidents`/`controlled_incident_events` tables.
  4. Running the script in dry-run mode against the dev/QA project produces a report showing zero deletions outside the allowlist.
**Plans**: 3 plans
- [ ] 21-01-PLAN.md — QA-01: add `tenants.is_test` column (migration 094 via MCP) + flag non-fixture tenants
- [ ] 21-02-PLAN.md — QA-02: write human-reviewed `21-ALLOWLIST.md` preserve/delete-list from live inventory
- [ ] 21-03-PLAN.md — QA-03/#4: dry-run-gated allowlist-scoped cleanup script + clean dry-run report

### Phase 22: Expo SDK 54→57 Bump
**Goal**: `apps/mobile` runs on Expo SDK 57.0.9 with New Architecture consistently enabled across config, `@react-navigation/native` as an explicit direct dependency, and the 19 tracked `npm audit` advisories resolved or explicitly accepted.
**Depends on**: Nothing (fully isolated from `apps/api` and `apps/web`; sequenced last since it's the single highest-risk item and a rollback shouldn't block the other four phases)
**Requirements**: MOBILE-01, MOBILE-02, MOBILE-03, MOBILE-04
**Success Criteria** (what must be TRUE):
  1. `app.json` and `android/gradle.properties` both consistently enable New Architecture, reconciled before the first SDK hop lands.
  2. Each of the three hops (54→55, 55→56, 56→57) passes `expo-doctor`, `npx jest`, a type-check, and produces a green EAS Android cloud build before the next hop begins.
  3. `@react-navigation/native` appears as an explicit direct dependency in `apps/mobile/package.json`, added before the 55→56 hop.
  4. `apps/mobile` is confirmed running `expo@57.0.9`, and the 19 previously-tracked `npm audit` advisories are each either resolved or explicitly re-documented as accepted risk.
**Plans**: 5 plans (5 sequential waves — one per hop plus prereq and audit)
- [x] 22-01-PLAN.md — Prereq: green jest baseline + MOBILE-02 New-Arch reconciliation (delete stale android/)
- [x] 22-02-PLAN.md — Hop 1/3: SDK 54→55 (New Arch mandatory), 4 gates + green EAS build
- [x] 22-03-PLAN.md — Hop 2/3: SDK 55→56, react-navigation fork codemod + MOBILE-03 explicit dep, 4 gates + green EAS build
- [x] 22-04-PLAN.md — Hop 3/3: SDK 56→57.0.9 (exact pin), 4 gates + green EAS build
- [ ] 22-05-PLAN.md — MOBILE-04: npm audit resolved-or-accepted-risk + refreshed overrides

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|-----------------|--------|-----------|
| 0. Restore reality | v1.0 | N/A | Complete | 2026-07-19 |
| 1. Core operational integrity | v1.0 | N/A | Complete | 2026-07-19 |
| 2. Evidence foundation | v1.0 | 5/5 | Complete | 2026-07-21 |
| 3. Texas compliance and staff safety | v1.0 | — | Complete (deployed) | 2026-07-21 |
| 4. Maintenance and housekeeping programs | v1.0 | 17/17 | Complete (deployed) | 2026-07-25 |
| 5. Guest recovery and management ROI | v1.0 | 12/12 | Complete (deployed) | 2026-07-25 |
| 6. PMS and AI expansion | v1.0 | 5/5 | Complete | 2026-07-28 |
| 7. Theme Foundation & Primitives | v1.1 | 6/6 | Complete | 2026-07-29 |
| 8. Floor-Role Rollout | v1.1 | 9/9 | Complete | 2026-07-30 |
| 9. Remaining Screens Rollout | v1.1 | 17/17 | Complete | 2026-07-31 |
| 10. Dark Mode & Accessibility QA | v1.1 | 11/11 | Complete | 2026-07-31 |
| 11. Mobile UI Parity Cleanup | v1.1 | 6/6 | Complete | 2026-08-02 |
| 12. Logbook & Lost & Found Data Integrity | v1.2 | 2/2 | Complete | 2026-08-02 |
| 13. AI Copilot Reliability | v1.2 | 3/3 | Complete | 2026-08-03 |
| 14. Room Status Display Accuracy | v1.2 | 1/1 | Complete | 2026-08-03 |
| 15. Work-Order Bulk-Archive | v1.3 | 2/2 | Complete | 2026-08-04 |
| 16. Self-Serve Billing Management | v1.3 | 4/4 | Complete | 2026-08-04 |
| 17. Backlog Cleanup | v1.3 | 8/8 | Complete | 2026-08-04 |
| 18. Documentation Drift Fixes | v1.4 | Complete    | 2026-08-04 | - |
| 19. RBAC Audit and Normalization | v1.4 | Complete    | 2026-08-04 | - |
| 20. Close Deferred v1.3 Verification Items | v1.4 | Complete    | 2026-08-05 | - |
| 21. Dev/QA Test-Data Hygiene | v1.4 | Complete    | 2026-08-05 | - |
| 22. Expo SDK 54→57 Bump | v1.4 | 4/5 | In Progress | - |

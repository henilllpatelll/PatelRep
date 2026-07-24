---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Ready to execute
last_updated: "2026-07-24T19:16:00.529Z"
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 35
  completed_plans: 22
  percent: 63
---

# GSD State

**Active milestone:** Hotel Standards Execution Plan

## Current phase

**Phase 3 — Texas compliance and staff safety: CLOSED + DEPLOYED (2026-07-21).**

**Deployed to production 2026-07-21** (merge `eba6d066` pushed to origin/main). Railway auto-redeployed both services; API rolled over in ~60s. Verified live: API `/health` 200 (env production, db ok), Phase 3 route `/v1/safety/safety-information` now returns 401 (route exists, auth-gated — was 404 pre-deploy), web `/login` 200. The push cleared three gates unrelated to Phase 3 logic: (1) ruff removed two orphaned imports in safety.py (`c83ab890`); (2) the pre-push `npm audit` gate flagged 4 newly-disclosed 2026 high CVEs (js-yaml, brace-expansion, sharp→libvips) — remediated non-breaking via `overrides.sharp ^0.35.3` (keeps Next 16, avoids npm's proposed Next 16→14.2.35 downgrade) plus `npm audit fix` → 0 vulns (`4a79204c`); (3) origin/main had diverged with 5 Dependabot merges (zustand 4→5, @hookform/resolvers 3→5, next canary.87→preview.6, an 8-pkg non-major group, setup-python 6→7) — merged cleanly, lockfile reconciled, re-verified type-check + web build green against the new majors. **These major dep bumps (zustand 5 / hookform 5 / next preview.6) are now in production for the first time; if prod UI misbehaves, suspect these before Phase 3 code.**

Code implemented (safety.py API router, /safety web route, migration 080). `03-CONTEXT.md` locks the 4 decided gray areas (slice order 3A→3B→3C + webhook design-only; anyone-files/management-views incidents; auto-cron training assignments; EN+ES scoped to staff-facing safety surfaces).

**Closure repair (commit `5e1b11c7`, 2026-07-21):** the Phase 3 API hardening (safety.py, contracts.py, requests.py) and migration 080 were left uncommitted at end of the prior session while `internal.py` + `test_safety_compliance.py` (already committed) imported `should_schedule_training_assignment`/`is_incident_visible_to` from the uncommitted contracts.py — so HEAD would `ImportError` on a clean checkout. All Phase 3 code + migration 080 are now committed; imports resolve; 312 API tests + web type-check green. The 8 Phase 3 commits (through `5e1b11c7`) remain local-only — Railway API/web still run pre-Phase-3 code; migration 080 is already on the shared prod DB (harmless: old code does not touch the new tables). **Deploy = push `main` to origin (holding per instruction).** Logged as bug-454.

**Migration 080 applied to production via Supabase MCP (2026-07-21) and verified:** 4 new tables (`emergency_contacts`, `emergency_role_assignments`, `safety_device_intake_contracts`, `emergency_drill_follow_up_evidence`) all RLS-enabled with one tenant policy each; `append_controlled_incident_event` is `SECURITY DEFINER` with `search_path=public` and EXECUTE granted to `service_role` only (anon/authenticated/PUBLIC revoked — 079 discipline held); partial index present. Security advisor: only project-baseline GraphQL-exposure WARNs on the new tables (RLS gates rows); no new RLS/grant holes.

**Live authenticated verification (2026-07-21, GM `hp.patelrep@gmail.com`, localhost:3000 → API :8003):**

- [x] Migration 080 applied + verified in production (RLS, policies, RPC grants — see above).
- [x] Incident immutability + `append_controlled_incident_event` RPC proven live via a rolled-back transaction (append_ok, update_blocked, delete_blocked all true; **zero residue** — 0 incident/event rows persisted).
- [x] `/safety` renders as GM; `GET /v1/safety/training/status` and `/v1/safety/emergency/plans` return 200; empty states correct; console clean (0 errors).
- [x] Bilingual staff-safety surfaces verified live EN↔ES (headings translate: "Safety actions"↔"Acciones de seguridad", etc.).
- [x] Incident RBAC confirmed in code vs. decisions: `POST /incidents` = any authenticated (D-03); list/append = manager-only; `GET /incidents/{id}` = filer-or-management via `is_incident_visible_to` else 403 (D-04). Negative cases covered by the 311 API tests.
- [x] **Bug found + fixed (bug-448):** sidebar rendered raw i18n keys `nav.safety`/`nav.evidence` — Phase 3 added them to the unused `en.json`/`es.json`; react-i18next loads `en.ts`/`es.ts`. Added keys to `en.ts` (Evidence/Safety) + `es.ts` (Evidencia/Seguridad); verified live in EN and ES. Commit `a5cc3b46`. Web type-check clean.

**Live pipeline verification (2026-07-21, GM token, fresh API instance on :8004 loading current code):**

- [x] GM create endpoints exercised live end-to-end (200, correctly tenant-scoped): training course, chemical, emergency drill, emergency contact. All test rows cleaned up — **zero residue** (verified: 0 across every safety table).
- [x] Training-assignment cron triggered live: with a course present it created assignments for covered employees, and `GET /safety/training/status` returned the correct state machine (covered roles `overdue` with due dates; uncovered roles `not_applicable`), with 9 `notification_deliveries` queued (3 reminders + 6 manager escalations). Wrong `X-Cron-Secret` → 401.
- [x] **Bug found + fixed (bug-449):** the training cron 500'd — `_queue_safety_notification` did `if existing.data:` but supabase-py `maybe_single().execute()` returns `None` on no match. The fake_supabase test harness returned `SimpleNamespace(data=None)` so the 311-test suite never caught it. Fixed to `if existing and existing.data:` (codebase pattern), added a regression test. **312 API tests pass.** Commit `0f523b3b`.
- [x] Dead `apps/web/i18n/locales/{en,es}.json` deleted (nothing imports `.json`); web type-check clean. Commit `0f523b3b`.

**Missing web surfaces — BUILT and verified live (2026-07-21, commit `8a9ec209`).** The earlier gap (GM admin + staff safety-info had no web UI) is closed:

- Staff `/safety` now has **safety-information** (chemicals + SDS signed URLs, PPE, safety procedures) and **emergency contacts**, bilingual EN+ES (`components/safety/SafetyInformation.tsx`). Verified live: `/safety-information` + `/emergency/contacts` return 200; Spanish toggle translates the section headings.
- Manager tabs (English, gm/housekeeping_supervisor/chief_engineer): **Compliance** (training-status dashboard + CSV export + add-course form), **Programs** (chemical inventory, drill logging, emergency-contact management), **Incidents** (controlled-incident list + append-only timeline + append event). Components in `components/safety/`; page refactored to a role-adaptive tabbed layout.
- `lib/api/safety.ts` extended with all endpoints.
- **Live E2E:** created a course through the GM UI form → 200 → compliance table populated the correct state machine (2 housekeepers `overdue`, others `not_applicable`); CSV export returns a valid inspector-ready file. Test data cleaned up — zero residue. Type-check + lint + production build all pass; console clean.

**Env note:** the running API dev server on :8003 is stale (missing the safety cron routes); restart `npm run dev:api` to load current code. The web app's `NEXT_PUBLIC_API_URL` points at :8003.

### Phase 2 — Evidence foundation: CLOSED (2026-07-21)

Deployed to production (Supabase `oacnwalhcpqdabivweki`) and verified end-to-end:

- [x] Migrations 069–078 applied: `property_applicability`, `controlled_documents`, `document_acknowledgements`, `evidence_records`, `evidence_exception_actions` — all tenant-scoped with RLS and canonical `hotel_id` JWT policies.
- [x] Phase 3–6 schema (070–073) applied in the same chain (076 depends on `controlled_incidents` from 070); tables are inert until their phases build on them.
- [x] Private `evidence-files` bucket (`public=FALSE`); attachments delivered by short-lived signed URL, tenant-foldered storage policy.
- [x] **Security fix — migration 079**: `supersede_controlled_document_with_audit`, `queue_evidence_reminder_delivery`, and `create_retraining_assignments_for_approved_document` were `SECURITY DEFINER` and executable by `anon`/`authenticated` (migration 075's `REVOKE ... FROM PUBLIC` was ineffective against Supabase's direct default grants). Revoked `EXECUTE` from `anon, authenticated, PUBLIC`, granted `service_role` only. Same fix applied to Phase 1's `transition_work_order_with_audit`, which shared the identical pre-existing exposure.
- [x] 308 API tests pass (logic, fake Supabase); web `type-check` clean.
- [x] Authenticated GM browser E2E (localhost:3000, Sonesta ES Suites Fossil Creek): `/evidence` renders all five surfaces; `GET applicability|documents|records|exceptions|my-acknowledgements` all 200 against the live schema; `PUT applicability` 200 with row persisted and canonical facility constraint enforced. Zero console errors.

**Residual (not blocking closure):** the inspector-export "mixed compliance states" path was not exercised with real data — the hotel has no seeded controlled documents/evidence, and fabricating compliance records in production was intentionally avoided. Read/render/write paths are proven; a data-backed export walkthrough is deferred to when real documents exist.

### Phase 1 — Core operational integrity: CLOSED (2026-07-19)

- [x] Canonical backend transition contract: `emergency` priority, `escalated` status, structured reason codes.
- [x] Management overrides require a reason note; non-management roles receive 403.
- [x] `POST /v1/work-orders/{id}/transition` validates state machine → atomic `transition_work_order_with_audit` RPC.
- [x] `claim_work_order` and `complete_work_order` use the atomic RPC; direct `status` PATCH returns 422.
- [x] Migration 065: canonical DB constraints + append-only `operational_audit_events` table.
- [x] Migration 066: `inspection_template_items.requires_photo_on_fail` flag.
- [x] Migration 067: `notification_deliveries` table with channel/status/failure tracking.
- [x] RBAC tests: housekeeper, housekeeping_supervisor, front_desk blocked (403); engineer, gm pass.
- [x] Tenant isolation test: cross-hotel work order returns 404, zero audit events written.
- [x] Audit reconstruction test: 4-step lifecycle verified in memory mock.
- [x] 229 API smoke tests pass across all suites.
- [x] Web: emergency-first sort, escalated lane always visible, drag/drop replaced with structured transition drawer.
- [x] Mobile: emergency chip, escalated status label, hold/resume/escalate actions; English + Spanish i18n complete.
- [x] Inspection photo evidence wired into InspectionModal; `requires_photo_on_fail` enforced.
- [x] Notification delivery history recorded per-channel with success/failure outcome.
- [x] **Playwright E2E**: `apps/web/e2e/phase1-work-orders.spec.ts` — 5 tests: emergency creation, escalated visibility, hold/reopen with reason codes, inspection photo prompt.
- [x] **Honest occupancy language**: “Check In/Out” → “Mark Occupied/Departed”; “Ready for check-in” → “Ready for occupancy” in GMDashboard + FrontDeskDashboard.
- [x] **Enum drift CI guard**: `schema/work_order_enums.json` + `test_enum_contracts.py` — fails CI if Python constants diverge from JSON contract.
- [x] **48-hour continuous healthy production monitoring**: clean window from 2026-07-17T15:00Z through 2026-07-19T15:00Z. `gh run list --workflow=deploy-check.yml --status failure --limit 5` confirmed the latest failure was 2026-07-17T14:44:43Z; no failures occurred during the window.

### Phase 0 — Restore reality: CLOSED (2026-07-19)

### All deliverables complete

- [x] Migrations 060, 064–068 applied to production Supabase.
- [x] `operational_audit_events` and `notification_deliveries` tables confirmed in production DB.
- [x] `cron_health` table (migration 068): seeded with 8 job names; each cron endpoint writes `last_success_at`.
- [x] `/health` extended: `cron` (per-job staleness), `notifications.last_delivery`, `pms_sync.last_sync`.
- [x] `work_orders_status_check` and `work_orders_priority_check` constraints confirmed correct.
- [x] Database readiness maps to HTTP status: `200` when ready, `503` when unavailable.
- [x] Login footer shows actual API/database probe result — not static copy.
- [x] CI: web production build + Phase 0 Playwright smoke included.
- [x] `deploy-check.yml`: polls API/web health every 15 min, fails on smoke error.
- [x] `scripts/public-smoke.mjs`: verifies `/login` 200 and `/health` status=ok,db=ok.
- [x] New Railway account (`prishap110113@gmail.com`). Both services deployed and healthy.
  - API: https://stellar-integrity-production-f507.up.railway.app/health
  - Web: https://patelrep-production-0ad1.up.railway.app/login

- [x] **48-hour continuous healthy production monitoring**: clean window from 2026-07-17T15:00Z through 2026-07-19T15:00Z. `gh run list --workflow=deploy-check.yml --status failure --limit 5` confirmed the latest failure was 2026-07-17T14:44:43Z; no failures occurred during the window.

## Language coverage

- Mobile: English + Spanish complete for all Phase 1 work-order states.
- Web: hardcoded English (no `t()` in engineering components). Same as pre-Phase 1 — no regression.
- Web i18n is not production-complete. Phase 4 covers full bilingual enforcement.

## Current blockers

- **None blocking Phase 3 (closed + deployed 2026-07-21).** Push landed (`eba6d066`); production verified healthy (see above). Remaining follow-ups: (a) authenticated prod smoke of `/safety` + the new safety surfaces with a GM session, and (b) confirm the safety crons (`safety.training-assignments`, `safety.drill-follow-up`) actually fire — see the stale-cron item below.
- **Operational (pre-existing, not Phase 3):** production `/health` shows every cron `stale` (predictions, billing, logbook, evidence reminders, safety, etc.) — the Railway cron scheduler appears not to be firing. Investigate before relying on any automated safety/training assignment or reminder in production.
- Non-management staff session for the "anyone-files / non-manager-cannot-view" incident path is still unavailable locally; that RBAC is covered by the passing API tests. `controlled_incidents` is append-only with a DELETE-blocking trigger — any incident created during live testing is permanent in production.

## Verification commands

```bash
cd apps/api && python -m pytest tests/smoke/ -q          # 229 tests
cd apps/web && npm run lint && npm run type-check
cd apps/web && npx playwright test --config=playwright.phase0.config.ts
cd apps/web && npx playwright test --config=playwright.phase1.config.ts
```

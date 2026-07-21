---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-07-21T21:54:07.465Z"
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 5
  completed_plans: 5
  percent: 100
---

# GSD State

**Active milestone:** Hotel Standards Execution Plan

## Current phase

**Phase 3 — Texas compliance and staff safety: CONTEXT GATHERED (2026-07-21)**

Discussion complete. `03-CONTEXT.md` written with 4 decided gray areas (slice order 3A→3B→3C + webhook design-only; anyone-files/management-views incidents; auto-cron training assignments; EN+ES scoped to staff-facing safety surfaces) plus Phase 2 contracts carried forward. Schema already applied via migration 070. **Next:** `/gsd-plan-phase 3`.

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

None.

## Verification commands

```bash
cd apps/api && python -m pytest tests/smoke/ -q          # 229 tests
cd apps/web && npm run lint && npm run type-check
cd apps/web && npx playwright test --config=playwright.phase0.config.ts
cd apps/web && npx playwright test --config=playwright.phase1.config.ts
```

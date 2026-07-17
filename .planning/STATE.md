---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-07-17T17:12:40.137Z"
---

# GSD State

**Active milestone:** Hotel Standards Execution Plan

## Current phase

**Phase 1 — Core operational integrity: CODE + TESTS COMPLETE — awaiting 48-hour production window**

### Phase 1 — ALL deliverables complete

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

**Phase 0 — Restore reality: MONITORING IN PROGRESS**

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

### Open — monitoring window only

- [ ] **48-hour continuous healthy monitoring**: clock started ~2026-07-16. Phase 0 closes ~2026-07-18.
  CI `deploy-check.yml` runs every 15 min and will surface any degradation.

## Language coverage

- Mobile: English + Spanish complete for all Phase 1 work-order states.
- Web: hardcoded English (no `t()` in engineering components). Same as pre-Phase 1 — no regression.
- Web i18n is not production-complete. Phase 4 covers full bilingual enforcement.

## Current blockers

1. **48-hour monitoring window** — Phase 0 cannot formally close until ~2026-07-18. No code work needed; just time.

## Verification commands

```bash
cd apps/api && python -m pytest tests/smoke/ -q          # 229 tests
cd apps/web && npm run lint && npm run type-check
cd apps/web && npx playwright test --config=playwright.phase0.config.ts
cd apps/web && npx playwright test --config=playwright.phase1.config.ts
```

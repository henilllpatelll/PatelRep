---
gsd_state_version: 1.0
milestone: hotel-standards
milestone_name: Hotel Standards
status: executing
last_updated: “2026-07-16T12:00:00-05:00”
---

# GSD State

**Active milestone:** Hotel Standards Execution Plan

## Current phase

**Phase 1 — Core operational integrity: IN PROGRESS (code complete, tests complete, deployment blocked)**

### Phase 1 progress — code and tests DONE

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
- [x] 247 API tests pass across all smoke, integration, and contract suites.
- [x] Web: emergency-first sort, escalated lane always visible, drag/drop replaced with structured transition drawer.
- [x] Mobile: emergency chip, escalated status label, hold/resume/escalate actions; English + Spanish i18n complete.
- [x] Inspection photo evidence wired into InspectionModal; `requires_photo_on_fail` enforced.
- [x] Notification delivery history recorded per-channel with success/failure outcome.
- [ ] **Playwright browser coverage** (emergency creation, escalated visibility, hold/reopen with reasons, inspection photo): NOT YET WRITTEN.
- [ ] **Phase 1 exit: pending deployment** — Railway trial expired; cannot push or verify production health.

**Phase 0 — Restore reality: IN PROGRESS (blocked by Railway billing)**

### Verified (local and DB)

- [x] Migrations 060, 064–067 applied to production Supabase (verified via execute_sql).
- [x] `operational_audit_events` and `notification_deliveries` tables confirmed in production DB.
- [x] `work_orders_status_check` and `work_orders_priority_check` constraints confirmed correct.
- [x] Database readiness maps to HTTP status: `200` when ready, `503` when unavailable.
- [x] Login footer shows actual API/database probe result — not static copy.
- [x] CI: web production build + Phase 0 Playwright smoke included.
- [x] `deploy-check.yml`: polls API/web health every 15 min, fails on smoke error.
- [x] `scripts/public-smoke.mjs`: verifies `/login` 200 and `/health` status=ok,db=ok.

### Blocked — cannot complete until Railway billing resolved

- [ ] Code at `a74c2e1a` is on GitHub but Railway trial has expired — **redeploy fails with “trial expired”**.
- [ ] Production URLs (`patelrep-production.up.railway.app/login` and `patelrep-web-production.up.railway.app/health`) not serving the current codebase.
- [ ] External probe cannot pass until deployment completes.
- [ ] 48-hour continuous healthy monitoring: NOT STARTED — cannot start until deployment is live.
- [ ] Cron/notification-delivery/PMS-sync telemetry probes: not implemented (no probeable data yet).
- [ ] Protected workflow smoke (non-human account): not provisioned.

## Language coverage

- Mobile: English + Spanish complete for all Phase 1 work-order states (`chipEmergency`, `statusEscalated`, `signalOnHold`, `hold`, `resume`, `escalate*`).
- Web: uses hardcoded English strings (no `t()` calls in engineering components). No regression — same as before Phase 1.
- Web i18n is not production-complete: Spanish translation usage is ~5 of 94 TSX files. Phase 4 covers full bilingual enforcement.

## Current blockers (priority order)

1. **Railway trial expired** — Go to Railway dashboard, add a payment method / select a plan, then redeploy both services. Until then, no code can reach production.
2. **48-hour monitoring window** — Cannot close Phase 0 until 48 continuous hours of healthy external monitoring after the production deployment is live.
3. **Playwright browser tests for Phase 1 workflows** — Emergency creation, escalated visibility, hold/reopen with reasons, inspection photo upload not yet covered by browser tests.
4. **Protected workflow smoke** — Requires a non-human Railway/Supabase account with read-only credentials.

## Verification commands

```bash
cd apps/api && python -m pytest tests/smoke/ -q
cd apps/web && npm run lint && npm run type-check && npm run build
cd apps/web && npx playwright test --config=playwright.phase0.config.ts
```

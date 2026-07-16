---
gsd_state_version: 1.0
milestone: hotel-standards
milestone_name: Hotel Standards
status: executing
last_updated: "2026-07-15T14:48:00-05:00"
---

# GSD State

**Active milestone:** Hotel Standards Execution Plan

## Current phase

**Phase 1 — Core operational integrity: IN PROGRESS (code track)**

### Phase 1 progress

- [x] Canonical backend transition contract defines `emergency` priority and `escalated` status.
- [x] Holds, cancellations, and reopens require structured reason codes; management overrides require a note.
- [x] `POST /v1/work-orders/{id}/transition` validates the state machine and calls an atomic database transition-and-audit RPC.
- [x] Migration 065 adds canonical database constraints and an append-only, tenant-scoped `operational_audit_events` table.
- [x] Focused transition/audit contracts pass (10 tests); full API suite passes (235 tests).
- [ ] Migrate existing claim, complete, and direct status-patch callers to the transition workflow.
- [ ] Align web and mobile types, filters, lanes, reports, and notifications for `emergency` / `escalated`.
- [ ] Add inspection photo UI, occupancy-state language, notification delivery history, and Phase 1 browser coverage.

**Phase 0 deployment recovery remains open below.**

**Phase 0 — Restore reality: IN PROGRESS**

### Verified baseline

- [ ] Public web is restored — `https://patelrep-production.up.railway.app/login` currently returns Railway 404.
- [ ] Public API is restored — `https://patelrep-web-production.up.railway.app/health` currently returns Railway 404.
- [x] Database readiness now maps to HTTP status locally: `200` when ready and `503` when unavailable.
- [x] The login footer now shows an actual API/database result instead of static “operational” copy.
- [x] A local Playwright smoke proves login controls enable after hydration at `localhost` and displays the degraded health state honestly.
- [x] CI source includes the web build and Phase 0 unauthenticated Playwright smoke.
- [x] Scheduled deployment checks now run public web/API/database smoke verification and fail when it fails.
- [x] Web build and verification commands are app-scoped; Next Turbopack root is pinned to `apps/web` to avoid root-lockfile inference.

### Remaining Phase 0 work

- [ ] Re-authenticate the Railway CLI/account, restore both public domain routes, deploy these readiness changes, and verify the external probe passes.
- [ ] Add monitors for last successful cron, notification delivery, and PMS synchronization; these telemetry sources do not yet exist in a probeable form.
- [ ] Add a secrets-backed protected-workflow production smoke after a non-human monitoring account is provisioned.
- [ ] Observe continuous healthy external monitoring for 48 hours before closing the phase.

## Language coverage

- Web language toggle exists, but Spanish support is **not production-complete**: the July 15 audit found direct translation usage in only 5 of 94 TSX files. Do not represent the app as bilingual until Phase 4’s floor-facing coverage and CI enforcement are complete.
- Mobile and web workflows require English/Spanish verification whenever they are touched.

## Current blockers and risks

- Railway identity lookup succeeds, but project-scoped service access returns `Unauthorized`; this non-interactive shell cannot refresh OAuth and has no Railway token. Authenticate the CLI in an interactive terminal or provide scoped agent access before domain recovery can proceed.
- The local FastAPI process on port 8000 is not PatelRep (`/health` returns 404); use the application-specific launch command before end-to-end local API checks.
- Root `--workspace` commands are invalid because the root package does not declare npm workspaces. Use `apps/web` and `apps/mobile` package directories directly.

## Verification commands

```bash
cd apps/api && python -m pytest tests/smoke/ -q
cd apps/web && npm run lint && npm run type-check && npm run build
cd apps/web && npx playwright test --config=playwright.phase0.config.ts
```

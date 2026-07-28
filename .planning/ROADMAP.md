# Roadmap: PatelRep Hotel Standards Execution Plan

## Overview

PatelRep moves from production trust through reusable operational evidence, Texas safety, complete programs, guest recovery, and only then pilot-gated PMS and AI expansion.

## Phases

- [x] **Phase 0: Restore reality** - Production, monitoring, CI, and planning status are trustworthy. Closed 2026-07-19.
- [x] **Phase 1: Core operational integrity** - Engineering state, escalation, and audit history are trustworthy. Closed 2026-07-19.
- [x] **Phase 2: Evidence foundation** - Shared documents, acknowledgements, evidence, exceptions, and audit exports. Closed 2026-07-21.
- [x] **Phase 3: Texas compliance and staff safety** - Training, incidents, safety documents, and emergency evidence. Closed 2026-07-21.
- [x] **Phase 4: Maintenance and housekeeping programs** - Complete recurring PM and housekeeping programs, plus bilingual floor coverage. Closed 2026-07-25 (verified 2026-07-24: 36/36 must-haves, security 50/50 threats closed).
- [x] **Phase 5: Guest recovery and management ROI** - Guest-service closure and measurable operational value. Closed 2026-07-25 (verified + deployed; live on Railway, `/health` 200).
- [ ] **Phase 6: PMS and AI expansion** - Audit-first hardening of the already-shipped AI copilot expansion + Opera PMS integration (reframed 2026-07-28; see 06-CONTEXT.md — original "backlog" docs were already implemented in commit `e4ac615a`, 2026-05-22).

## Phase Details

### Phase 2: Evidence foundation
**Goal**: Build one thin evidence platform reused by training, safety, maintenance, SOP, and property-compliance workflows.
**Depends on**: Phase 1
**Requirements**: REQ-201, REQ-202, REQ-203, REQ-204, REQ-205, REQ-206, REQ-207
**Success Criteria**:
  1. A GM can see which obligations apply to the property and what is overdue, expired, failed, or missing evidence.
  2. An authorized person can trace a controlled document version, approver, applicability, retention, acknowledgement, competency, and supersession history.
  3. Attachments are tenant-isolated and delivered only by signed URL.
  4. Reminders and escalations record channel-specific delivery outcomes and all material changes are reconstructable from the existing append-only audit history.
  5. A GM can produce an inspector-ready export for a representative hotel with mixed compliance states.
**Plans**: 5 plans

Plans:
**Wave 1**
- [x] 02-01: Property applicability contract and GM configuration

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 02-02: Controlled-document lifecycle and history

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 02-03: Secure evidence records and private attachments

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 02-04: Staff acknowledgement, competency, and retraining

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 02-05: Exception engine, GM dashboard, reminders, and inspector export

### Phase 3: Texas compliance and staff safety
**Goal**: Make training, controlled incidents, hazard communication, and emergency evidence operational without building hardware.
**Depends on**: Phase 2
**Plans**: `03-EXECUTION-PLAN.md` (slices 3A training, 3B controlled incidents, 3C HazCom/emergency evidence). Complete + deployed — code committed, migration 080 applied to prod DB, 312 API tests + web type-check green, GM browser verification on localhost, and deployed to Railway (`eba6d066`, 2026-07-21) with production verified healthy (Phase 3 API routes live).

### Phase 4: Maintenance and housekeeping programs
**Goal**: Make PM and housekeeping recurring, evidence-backed programs and enforce the bilingual floor contract.
**Depends on**: Phase 3
**Plans**: 8 original plans (slices S0 → 4A → 4B → 4C) + 9 gap-closure plans (04-09..04-17) closing the D-03 bilingual floor contract. Scope authority = HOTEL_STANDARDS_EXECUTION_PLAN.md §Phase 4 + 04-CONTEXT.md (no formal REQ-XXX IDs; behaviors labeled PM-XX / HK-XX / BL-XX). Migrations added: 081 (PM evidence linkage, 04-02), 083 (program template facilities, 04-04) — each confirmed applied to prod (Supabase project oacnwalhcpqdabivweki). (04-03 is code-only — the corrective-WO columns already exist since migration 007, so 082 is intentionally unused.)

Plans:
**Wave 1**
- [x] 04-01-PLAN.md — S0 foundation: route-test harness + RBAC/read-gate/None-guard fixes + DB immutability proof

**Wave 2** *(blocked on Wave 1)*
- [x] 04-02-PLAN.md — S0 PM evidence platform integration (signed-URL attachments) + migration 081

**Wave 3** *(blocked on Wave 2)*
- [x] 04-03-PLAN.md — S0 audit events + deferral approval + corrective-WO hardening (code-only; WO columns pre-exist per 007)

**Wave 4** *(blocked on Wave 3)*
- [x] 04-04-PLAN.md — 4A API: applicability-gated PM template library + editor + generic builder + migration 083

**Wave 5** *(blocked on Wave 4; 04-05 and 04-06 run in parallel — web vs API, no file overlap)*
- [x] 04-05-PLAN.md — 4A Web: full PM completion capture UI + evidence upload + deferral + client
- [x] 04-06-PLAN.md — 4B API: inspection sampling execution + quality trends + deep-clean/public-area completeness

**Wave 6** *(blocked on Wave 5)*
- [x] 04-07-PLAN.md — 4B Web + completion: DND policy config, par alerts (passive), stayover, deep-clean/public-area/sampling UI

**Wave 7** *(blocked on Wave 6)*
- [x] 04-08-PLAN.md — 4C bilingual floor contract: EN/ES coverage + scoped no-literal-string CI gate + EN/ES 390px Playwright

**Gap closure** *(from 04-VERIFICATION.md: 04-08 narrowed the D-03 bilingual floor contract. Full D-03 directory scope = 20 floor files / 462 user-facing literals, incl. 8 app-route pages the verifier's 13-file list did not enumerate but which D-04's gate glob sweeps in. Translation plans share en.ts/es.ts, so they run sequentially by wave; the widened lint gate must run last.)*
- [x] 04-09-PLAN.md — (wave 1) HK board: RoomStatusBoard (Realtime surface), RoomCard, AssignmentSidebar, PredictionPanel → EN/ES
- [x] 04-17-PLAN.md — (wave 1, parallel — spec-file only) Playwright test 3 race fix: wait for gated /programs panels before skip
- [x] 04-10-PLAN.md — (wave 2) HK drawer/modals: RoomDetailDrawer, InspectionModal, OccupancyImportModal → EN/ES
- [x] 04-11-PLAN.md — (wave 3) HK route pages: housekeeping/page, assignments/page → EN/ES
- [x] 04-12-PLAN.md — (wave 4) HK route pages: inspections/page, rooms/page → EN/ES
- [x] 04-13-PLAN.md — (wave 5) ENG WorkOrderDetailDrawer (heaviest floor surface) → EN/ES
- [x] 04-14-PLAN.md — (wave 6) ENG components: CreateWorkOrderModal, WorkOrderList, EngineeringRoomBoard, FailurePredictionSidebar → EN/ES
- [x] 04-15-PLAN.md — (wave 7) ENG route pages: assets/page, predictions/page, work-orders/page, engineering/page → EN/ES
- [x] 04-16-PLAN.md — (wave 8) tasks/page → EN/ES + fix 2 non-word placeholder literals + widen no-literal-string gate to the full floor directory set

### Phase 5: Guest recovery and management ROI
**Goal**: Close guest service loops and quantify hotel operational value.
**Depends on**: Phase 4
**Plans**: 12 plans across 6 waves. Scope authority = HOTEL_STANDARDS_EXECUTION_PLAN.md §Phase 5 + 05-CONTEXT.md (no formal REQ-XXX IDs; decisions labeled D-01…D-17). **Brownfield phase** — commit `fea45b29` already shipped migration 072, `services/guest_recovery/contracts.py`, `routers/guest_requests.py`, `routers/lost_found.py`, and the 9-status kanban; plans extend these in place. One new migration: 084 (guest_phone, retention/disposition, GM ADR field) — `[BLOCKING]` apply gates all of Wave 2+. Live SMS delivery remains UNVERIFIED at phase close: no Twilio credentials exist locally (D-01, accepted deferral).

**Closed 2026-07-25.** `05-VERIFICATION.md`: 17/17 decision contracts (D-01…D-17) verified in code, 60/60 plan truths, 92 phase-5 tests + full 427-test API suite pass. `05-HUMAN-UAT.md`: 5/6 human-verification items PASS on localhost (Management ROI dashboard role-gating, ADR set/clear persistence, guest-request drawer thread/reply/satisfaction, SLA + accessibility settings, lost & found disposition queue); item 1 (live Twilio SMS) blocked on missing local credentials per D-01 — not a gap. **Deployed** — the full Phase 5 commit chain (through `754f0076`) is on `origin/main`; `git rev-list origin/main..main` = 0, and Railway auto-deployed both services. Verified live: API `/health` 200 (env production, db ok), web `/management-roi` 307 → /login (route exists, auth-gated). Live Twilio SMS remains unexercised (no prod Twilio credentials; accepted deferral per D-01).

Plans:
**Wave 1**
- [x] 05-01-PLAN.md — migration 084 + Twilio SDK pin/settings + fake Twilio client + GM ADR field; `[BLOCKING]` apply to live Supabase before any other plan

**Wave 2** *(blocked on Wave 1)*
- [x] 05-02-PLAN.md — Twilio send wrapper, signed inbound webhook (reply-only match, never invents a request), status-callback webhook, reactive opt-out on error 21610, guest_phone capture
- [x] 05-03-PLAN.md — all ROI formulas as pure fixture-reconcilable functions in `services/guest_recovery/contracts.py`
- [x] 05-04-PLAN.md — lost & found 90-day retention clock, daily flag-for-review cron, `disposition_due` filter, disposition role set = gm + housekeeping_supervisor + front_desk

**Wave 3** *(blocked on Wave 2)*
- [x] 05-05-PLAN.md — SLA policy API surface + accessible-room-features enriched with live room status
- [x] 05-06-PLAN.md — seven GM-only tenant-scoped `/v1/reports/roi/*` endpoints feeding 05-03's calculators
- [x] 05-08-PLAN.md — lost & found retention/custody/disposition web UI

**Wave 4** *(blocked on Wave 3)*
- [x] 05-07-PLAN.md — web data layer: typed API clients, guest phone/consent/category fields on new-request modal, EN/ES strings

**Wave 5** *(blocked on Wave 4)*
- [x] 05-09-PLAN.md — drawer message thread with per-message delivery status, role-gated reply box, accessibility room guidance
- [x] 05-10-PLAN.md — GM ADR input + unified Management ROI dashboard at `/management-roi` (time saved / quality / response / revenue protected)
- [x] 05-11-PLAN.md — Settings > Guest Requests (SLA rules) + Accessibility Features tab on Settings > Rooms

**Wave 6** *(blocked on Wave 5)*
- [x] 05-12-PLAN.md — satisfaction capture (D-16) + human-in-the-loop resolution confirmation prompt (D-17)

Cross-cutting constraints:
- Tenant scoping (`.eq("hotel_id"/"tenant_id", current_user.hotel_id)`) on every new query — flagged in research as the phase's highest risk of omission across the ~7 new ROI endpoints.
- Every guest-facing send requires an explicit human action; no unattended templated SMS (D-17).
- Append-only discipline on `guest_request_events`, `guest_messages`, `guest_recovery_actions`, `lost_found_custody_events` — insert only, never UPDATE/DELETE.

### Phase 6: PMS and AI expansion
**Goal**: Verify, harden, and gate the already-shipped AI copilot expansion and Opera PMS integration to production-trust standard, fixing any real bugs found in-phase — before any new AI/PMS capability work.
**Depends on**: Phase 5. Pilot gate confirmed satisfied by user 2026-07-28 (was previously "two successful pilot hotels").
**Plans**: 5 plans across 3 waves (planned 2026-07-28). Audit-first hardening pass — no REQ-XXX IDs; traceability anchored to 06-CONTEXT.md decisions D-01…D-06. One new migration: 085 (`tenants.opera_pilot_enabled`, D-03) — `[BLOCKING]` apply in 06-02 before any live-column dependency. Three real bugs found in research are fixed in-phase (D-05): flat credit cost (credits.py A3 violation), SOP double-log (sop_rag.py/ai_copilot.py), Opera webhook wrong-secret signature (webhooks.py). AI copilot stays ungated (D-04); Opera gets the pilot flag (D-03). Full Phase 1–5 test rigor + live browser walkthrough (D-06). Credential-dependent E2E (live LLM output, real OHIP round-trip) is an accepted deferral — no local keys/sandbox.

Plans:
**Wave 1** *(AI-copilot slice and Opera slice run in parallel — zero file overlap)*
- [x] 06-01-PLAN.md — AI copilot credit-accounting + SOP double-log fix (TDD): token-derived credits in credits.py, single ai_interactions owner (D-02/D-06) — CLOSED 2026-07-28
- [ ] 06-02-PLAN.md — Opera pilot-flag migration 085 + `[BLOCKING]` apply + 403 gate on all 7 Opera endpoints + routes RBAC/tenant-isolation tests (D-01/D-03/D-06)

**Wave 2** *(06-03 blocked on 06-01 — shares ai_copilot.py; 06-04 blocked on 06-02 — needs migration 085 + pilot pattern)*
- [ ] 06-03-PLAN.md — AI copilot RBAC matrix + tenant isolation + typed confirm_tasks (TaskPreview, 422-not-500) (D-01/D-05/D-06)
- [ ] 06-04-PLAN.md — Opera webhook signature fix (opera_credentials.webhook_secret, fail-closed) + webhook pilot no-op + dispatch tests (D-03/D-05/D-06)

**Wave 3** *(blocked on all)*
- [ ] 06-05-PLAN.md — Phase gate: full API suite + web type-check + live authenticated GM browser walkthrough (AI copilot fast-path + Opera settings surface) (D-06)

**Reframed 2026-07-28.** The AI-expansion backlog docs below were discovered during discuss-phase to already be fully implemented and deployed (commit `e4ac615a`, 2026-05-22) — ungated for all hotels, zero test coverage. Opera integration is likewise more built than previously documented (conflict list/resolve endpoints already exist). Phase 6 is therefore an audit-first hardening pass mirroring Phase 4's S0 slice, not a greenfield build. See `.planning/phases/06-pms-and-ai-expansion/06-CONTEXT.md` for full decisions.

## Deferred Backlog

- **Phase 4:** Web i18n for the hardcoded-English engineering components; this is the bilingual floor contract, not a Phase 2 change. *(Resolved 2026-07-25 — gap-closure plans 04-09..04-17 closed this; full D-03 floor scope verified bilingual, ESLint no-literal-string gate widened to the whole floor directory set.)*
- **Resolved 2026-07-28 — Phase 6 backlog docs:** `.planning/ai-copilot-primary-interface.md` and `.planning/sop-voice-fastpath.md` are not backlog — both are already implemented and live in production. Kept as audit-reference docs for Phase 6's discuss-phase decisions (see 06-CONTEXT.md); do not treat as build targets.
- **Resolved 2026-07-26 — Vercel infra decision:** re-investigated via the Vercel MCP; the earlier "broken deployment / invalid CLI token" note was stale. The `patelrep-web` project's GitHub integration deploys successfully on every push to `main` (verified: `patelrep-web.vercel.app/login` returns 200, latest production deployment READY). The local `vercel` CLI being unauthenticated was a separate, local-only issue that never affected the GitHub-triggered builds. No custom domain is attached — only default `*.vercel.app` subdomains — so it isn't presented to users as canonical anywhere. **Decision: keep it as a secondary preview surface (PR preview comments), not production.** Railway remains the sole documented production target (see Infrastructure section); nothing in app docs or onboarding points at the Vercel URL. The only real failures traced to Dependabot PR #26's broken react-dom v19/react v18 mismatch, which is now closed. No deletion tool was available to act on directly if a future session decides to remove it instead — that would be a manual dashboard action.
- **Parked:** All mobile work, including EAS build, mobile i18n handoff, and rooms debugging. Phase 2 is web + API only.

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Restore reality | N/A | Complete | 2026-07-19 |
| 1. Core operational integrity | N/A | Complete | 2026-07-19 |
| 2. Evidence foundation | 5/5 | Complete — deployed + verified | 2026-07-21 |
| 3. Texas compliance and staff safety | 3/3 | Complete — deployed + verified in production | 2026-07-21 |
| 4. Maintenance and housekeeping programs | 17/17 | Complete — verified (36/36 must-haves) + security-audited (50/50 threats closed); deployed on `main` | 2026-07-25 |
| 5. Guest recovery and management ROI | 12/12 | Complete — verified in code + human UAT; deployed + live on Railway | 2026-07-25 |
| 6. PMS and AI expansion | 1/5 | In progress — 06-01 closed (credit accounting + SOP double-log fix); 06-02 next | - |

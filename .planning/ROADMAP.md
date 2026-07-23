# Roadmap: PatelRep Hotel Standards Execution Plan

## Overview

PatelRep moves from production trust through reusable operational evidence, Texas safety, complete programs, guest recovery, and only then pilot-gated PMS and AI expansion.

## Phases

- [x] **Phase 0: Restore reality** - Production, monitoring, CI, and planning status are trustworthy. Closed 2026-07-19.
- [x] **Phase 1: Core operational integrity** - Engineering state, escalation, and audit history are trustworthy. Closed 2026-07-19.
- [x] **Phase 2: Evidence foundation** - Shared documents, acknowledgements, evidence, exceptions, and audit exports. Closed 2026-07-21.
- [x] **Phase 3: Texas compliance and staff safety** - Training, incidents, safety documents, and emergency evidence. Closed 2026-07-21.
- [ ] **Phase 4: Maintenance and housekeeping programs** - Complete recurring PM and housekeeping programs, plus bilingual floor coverage.
- [ ] **Phase 5: Guest recovery and management ROI** - Guest-service closure and measurable operational value.
- [ ] **Phase 6: PMS and AI expansion** - Pilot-gated integrations and approval-based AI loops.

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
**Plans**: 8 plans (slices S0 → 4A → 4B → 4C). Scope authority = HOTEL_STANDARDS_EXECUTION_PLAN.md §Phase 4 + 04-CONTEXT.md (no formal REQ-XXX IDs; behaviors labeled PM-XX / HK-XX / BL-XX). Migrations added: 081 (PM evidence linkage, 04-02), 083 (program template facilities, 04-04) — each applied to prod via Supabase MCP. (04-03 is code-only — the corrective-WO columns already exist since migration 007, so 082 is intentionally unused.)

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
- [ ] 04-07-PLAN.md — 4B Web + completion: DND policy config, par alerts (passive), stayover, deep-clean/public-area/sampling UI

**Wave 7** *(blocked on Wave 6)*
- [ ] 04-08-PLAN.md — 4C bilingual floor contract: EN/ES coverage + scoped no-literal-string CI gate + EN/ES 390px Playwright

### Phase 5: Guest recovery and management ROI
**Goal**: Close guest service loops and quantify hotel operational value.
**Depends on**: Phase 4
**Plans**: TBD

### Phase 6: PMS and AI expansion
**Goal**: Expand integrations and AI only after pilot validation, with evidence and human authorization for every recommendation.
**Depends on**: Phase 5 and two successful pilot hotels
**Plans**: TBD

## Deferred Backlog

- **Phase 4:** Web i18n for the hardcoded-English engineering components; this is the bilingual floor contract, not a Phase 2 change.
- **Phase 6, pilot-gated:** AI expansion material in `.planning/ai-copilot-primary-interface.md` and `.planning/sop-voice-fastpath.md`.
- **One-time infrastructure decision:** Vercel still has a broken deployment because its CLI token is invalid and the built app contains a stale Railway API URL. Railway is production. Decide whether to delete the Vercel project or repair authentication; do not fix it in Phase 2.
- **Parked:** All mobile work, including EAS build, mobile i18n handoff, and rooms debugging. Phase 2 is web + API only.

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Restore reality | N/A | Complete | 2026-07-19 |
| 1. Core operational integrity | N/A | Complete | 2026-07-19 |
| 2. Evidence foundation | 5/5 | Complete — deployed + verified | 2026-07-21 |
| 3. Texas compliance and staff safety | 3/3 | Complete — deployed + verified in production | 2026-07-21 |
| 4. Maintenance and housekeeping programs | 0/8 | Planned — awaiting review gate (D-12) | - |
| 5. Guest recovery and management ROI | 0/TBD | Not started | - |
| 6. PMS and AI expansion | 0/TBD | Deferred — pilot-gated | - |

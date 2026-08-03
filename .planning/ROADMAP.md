# Roadmap: PatelRep

## Milestones

- ✅ **v1.0 Hotel Standards Execution Plan** — Phases 0-6 (shipped 2026-07-28). Full details: `.planning/milestones/v1.0-ROADMAP.md`
- ✅ **v1.1 Mobile UI Parity** — Phases 7-11 (shipped 2026-08-02). Full details: `.planning/milestones/v1.1-ROADMAP.md`
- ✅ **v1.2 Stabilization Pass** — Phases 12-14 (shipped 2026-08-03). Full details: `.planning/milestones/v1.2-ROADMAP.md`
- 🚧 **v1.3 Billing, Work Order Archival, and Backlog Cleanup** — Phases 15-17 (in progress, started 2026-08-03)

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

### 🚧 v1.3 Billing, Work Order Archival, and Backlog Cleanup (In Progress, started 2026-08-03)

**Milestone Goal:** Ship self-serve billing management and bulk-archive for work orders while clearing the carried-forward backlog from v1.2's audit (UX rough edges, the CHECK-constraint bug, and the supervisor-picker product decision).

- [ ] **Phase 15: Work-Order Bulk-Archive** - Managers can bulk-archive and restore completed work orders without losing audit trail or breaking the active board
- [ ] **Phase 16: Self-Serve Billing Management** - GMs self-manage plan/payment via the Stripe portal with accurate usage data, protected by hardened revenue-integrity guarantees
- [ ] **Phase 17: Backlog Cleanup** - UX rough edges, the AI-interaction CHECK-constraint bug, and the supervisor-picker product decision are all resolved

## Phase Details

### Phase 15: Work-Order Bulk-Archive
**Goal**: Managers can select and bulk-archive completed/cancelled work orders to declutter the active Engineering board, with full reversibility (unarchive) and a complete audit trail — no data is ever deleted.
**Depends on**: Nothing (first phase in milestone; sequenced before Phase 16 because it is fully verifiable on localhost, per research, while billing is credential-blocked locally)
**Requirements**: ARCHIVE-01, ARCHIVE-02, ARCHIVE-03, ARCHIVE-04, ARCHIVE-05, ARCHIVE-06
**Success Criteria** (what must be TRUE):
  1. Manager can select multiple completed/cancelled work orders on the Engineering board and archive them in a single bulk action.
  2. Archived work orders no longer appear in the default active work-order view or on the Realtime board.
  3. Manager can view all archived work orders via a dedicated "Archived" filter/tab, and restore any of them back to the active view.
  4. Manager can bulk-archive all completed work orders older than a specified age in one action.
  5. Every archive/unarchive action is recorded in the audit trail, showing who performed it, when, and which work orders were affected.
**Plans**: TBD

### Phase 16: Self-Serve Billing Management
**Goal**: GMs can self-manage their subscription (plan changes, payment method) through the Stripe Customer Portal with accurate real-time usage/cap/cost visibility, while the hotel's revenue collection is hardened against double-charge, lost overage, and duplicate webhook effects before any of this is exposed to self-serve users.
**Depends on**: Nothing (independent of Phase 15 — no shared router, table, or migration per research; sequenced second because local dev has no Stripe credentials, making it the weaker "prove it on localhost" candidate)
**Requirements**: BILLING-01, BILLING-02, BILLING-03, BILLING-04, BILLING-05, BILLING-06, BILLING-07, BILLING-08, BILLING-09
**Success Criteria** (what must be TRUE):
  1. GM can open the Stripe Customer Portal from the billing page to change plan and update payment method.
  2. GM sees accurate current-period AI-credit usage that never goes stale after a billing-period rollover, plus the $2.50/room/month spend cap and remaining headroom.
  3. GM sees a past-due/payment-failed banner that deep-links to the portal, a live projected month-end cost gauge based on current usage pace, and a proactive alert when usage approaches 80% of the spend cap.
  4. The monthly true-up cron cannot double-charge a hotel even if it fires on multiple consecutive nights.
  5. Overage accrued before a mid-cycle self-serve cancellation is still invoiced, and Stripe webhook events are deduplicated by `event.id` so retried webhooks can't double-act.
**Plans**: TBD

### Phase 17: Backlog Cleanup
**Goal**: Clear the small, independent items carried forward from the v1.2 milestone audit — UX rough edges across Staff, Scheduling, Opera, Management ROI, Guest Requests, and Room History; the `ai_interactions` CHECK-constraint bug (deferred 4x prior); and the supervisor-in-assignment-picker product decision.
**Depends on**: Nothing (independent of Phase 15 and Phase 16 — distinct files/domains, no shared code; sequenced last since these are low-risk grab-bag items with no bearing on the two feature phases)
**Requirements**: UX-01, UX-02, UX-03, UX-04, UX-05, UX-06, DATA-01, STAFF-01
**Success Criteria** (what must be TRUE):
  1. Staff display names never render blank anywhere in the app; a fallback displays when name data is missing.
  2. Shift-template dropdowns in Scheduling show no duplicate or leftover entries.
  3. Opera integration connection failures show a specific, actionable error message instead of a generic one, and the Management ROI page no longer leaks its internal calculation formula string to the UI.
  4. The Guest Request drawer includes status-advance actions (not just view), and Room History populates with actual room history data.
  5. Logging an AI interaction with `intent_to_log` values like `general` succeeds instead of 400/500ing on the CHECK constraint, and supervisors appear as assignable staff in the housekeeper room-assignment picker.
**Plans**: TBD

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
| 15. Work-Order Bulk-Archive | v1.3 | 0/TBD | Not started | - |
| 16. Self-Serve Billing Management | v1.3 | 0/TBD | Not started | - |
| 17. Backlog Cleanup | v1.3 | 0/TBD | Not started | - |

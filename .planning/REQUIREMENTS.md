# Requirements: PatelRep v1.7 — AI Copilot Batch Actions & Escalation

**Defined:** 2026-08-13
**Core Value:** Save a housekeeper or engineer time on the floor without weakening the hotel's ability to prove what occurred.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Batch Actions (AI-09 backlog item, unpacked into atomic requirements)

- [ ] **AI-09**: Housekeeping supervisor/GM can select multiple HIGH-risk room-readiness predictions and batch-reassign them in one confirming action, with a per-room outcome reported afterward (e.g. "3 reassigned, 1 escalated: no capacity") — not a single aggregate pass/fail result
- [ ] **AI-10**: Housekeeping supervisor/GM can select multiple HIGH-risk room-readiness predictions and batch-acknowledge them in one confirming action
- [ ] **AI-11**: Engineer/chief_engineer/GM can select multiple HIGH-risk asset-failure predictions and batch-acknowledge them in one confirming action

### Escalation to GM (AI-10 backlog item, unpacked into atomic requirements)

- [ ] **AI-12**: A HIGH-risk room-readiness or asset-failure prediction left un-actioned (not reassigned, escalated, or acknowledged) past a fixed 60-minute threshold automatically triggers a non-silent in-app notification to the GM
- [ ] **AI-13**: Escalation stops permanently for a given prediction the moment it is reassigned, acknowledged, or its risk drops below HIGH — and only resumes counting if the same room/asset re-enters HIGH risk later
- [ ] **AI-14**: The same continuous HIGH-risk episode never generates more than one GM escalation notification, regardless of how many times the 30-minute prediction cron re-runs while it remains un-actioned

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Batch Actions

- **AI-15**: Batch create-work-order from multiple selected asset-failure predictions — deferred as higher-risk (creates real work orders, not just state changes) per ARCHITECTURE.md; revisit once AI-11's batch-acknowledge pattern is proven live
- **AI-16**: Select-all-HIGH-on-this-floor quick filter for batch selection — deferred until AI-09/AI-10's simple select-all-in-list is shipped and the floor-scoped shortcut is confirmed as still needed

### Escalation to GM

- **AI-17**: Multi-tier escalation ladder (mirroring the work-order 30/90/150-minute 3-tier model) — deferred; start with AI-12's single fixed threshold, add tiers only if a single-notification GM escalation proves insufficient in practice
- **AI-18**: Per-hotel configurable escalation threshold — deferred; start with one fixed 60-minute threshold for all tenants, add configurability only if GMs actually ask for it

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Unbounded select-all-across-the-whole-hotel | HIGH-risk lists at a 50-150 room property are inherently small (research: FEATURES.md); this is a pagination-scale problem this domain does not have. Select-all is scoped to the currently-rendered list only. |
| Per-item customization inside one batch flow | Defeats the purpose of batching (research: FEATURES.md). A supervisor who needs to customize one item routes back to the existing single-item confirm flow instead. |
| Full transactional undo/rollback after a batch commits | Disproportionate for a same-shift, small-blast-radius, already-confirmed action; the existing single-item actions have no undo either (research: FEATURES.md). The confirm-before-commit step is the safety net. |
| Escalation as an ownership/assignment transfer to the GM | GMs do not clean rooms or fix assets. Escalation notifies and flags state (mirroring the work-order tier-3 precedent, which sets `status=escalated` without reassigning), it does not transfer task ownership (research: FEATURES.md). |
| Escalating MEDIUM-risk predictions | Scope creep beyond every existing `risk_level == HIGH` action gate (`canAct` in `PredictionPanel.tsx`, the v1.6 reassign/escalate/acknowledge endpoints). Only HIGH is actionable today. |
| Folding escalation checks into `predictions.run` / `ai.failure-predictions` | Those are detection/generation crons with a different lifecycle; the existing `escalations.check` precedent (work orders/tasks) is already split out from creation logic for the same reason (research: ARCHITECTURE.md). AI-12 gets its own cron job. |
| Reusing `is_acknowledged` as the escalation dedup gate | It is a human-suppression signal, not a system dedup counter, and has no tier semantics (research: PITFALLS.md, Pitfall 3). AI-12/AI-14 use a dedicated `escalation_level` watermark column instead, mirroring migration `041_escalation_level.sql`. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AI-09 | Phase 28 | Not started |
| AI-10 | Phase 28 | Not started |
| AI-11 | Phase 28 | Not started |
| AI-12 | Phase 29 | Not started |
| AI-13 | Phase 29 | Not started |
| AI-14 | Phase 29 | Not started |

**Coverage:**
- v1 requirements: 6 total
- Mapped to phases: 6/6
- Unmapped: 0
- Complete: 0/6

---
*Requirements defined: 2026-08-13*
*Last updated: 2026-08-13*

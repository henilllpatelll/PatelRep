# Requirements: PatelRep v1.3 — Billing, Work Order Archival, and Backlog Cleanup

## v1.3 Requirements

### Billing (Self-Serve Management)

- [ ] **BILLING-01**: GM can open the Stripe Customer Portal from the billing page to change plan and update payment method (wires the existing `/billing/portal` endpoint; replaces "Coming soon")
- [ ] **BILLING-02**: GM sees accurate current-period AI-credit usage that never goes stale after a billing period rolls over (fixes `credit_ledger` rollforward)
- [ ] **BILLING-03**: GM sees the $2.50/room/month spend cap and remaining headroom on the billing page
- [ ] **BILLING-04**: GM sees a past-due/payment-failed banner that deep-links to the portal
- [ ] **BILLING-05**: GM sees a live projected month-end cost gauge based on current usage pace
- [ ] **BILLING-06**: GM receives a proactive alert when usage approaches 80% of the spend cap
- [ ] **BILLING-07**: The monthly true-up cron cannot double-charge a hotel even if it fires on multiple consecutive nights (idempotency key + "already invoiced" ledger stamp)
- [ ] **BILLING-08**: Overage accrued before a mid-cycle self-serve cancellation is still invoiced (final true-up runs on `subscription.deleted`, before `plan_status` flips)
- [ ] **BILLING-09**: Stripe webhook events are deduplicated by `event.id` so retried webhooks can't double-act

### Work Order Archive

- [ ] **ARCHIVE-01**: Manager can select multiple completed/cancelled work orders and archive them in one bulk action
- [ ] **ARCHIVE-02**: Archived work orders are removed from the default active work-order view and the Realtime board
- [ ] **ARCHIVE-03**: Every archive/unarchive action is recorded in the audit trail (who, when, which work orders)
- [ ] **ARCHIVE-04**: Manager can restore (unarchive) a work order back to the active view
- [ ] **ARCHIVE-05**: Manager can view archived work orders via a dedicated filter/tab
- [ ] **ARCHIVE-06**: Manager can bulk-archive all completed work orders older than a specified age in one action

### UX Rough Edges

- [ ] **UX-01**: Staff display names never render blank (fallback shown when name data is missing)
- [ ] **UX-02**: Shift-template dropdowns show no duplicate or leftover entries
- [ ] **UX-03**: Opera integration connection failures show a specific, actionable error message instead of a generic one
- [ ] **UX-04**: Management ROI page no longer leaks the internal calculation formula string to the UI
- [ ] **UX-05**: Guest Request drawer includes status-advance actions, not just view
- [ ] **UX-06**: Room History populates with actual room history data

### Data Integrity

- [ ] **DATA-01**: Logging an AI interaction with `intent_to_log` values like `general` succeeds instead of 400/500ing on the `ai_interactions.interaction_type` CHECK constraint (deferred 4x prior)

### Staff Assignment

- [ ] **STAFF-01**: Supervisors (`housekeeping_supervisor` role) appear as assignable staff in the housekeeper room-assignment picker (product decision resolved 2026-08-03: include supervisors)

## Future Requirements (Deferred)

- Per-feature AI-credit breakdown (requires attribution at credit-write time) — deferred from BILLING research, needs middleware changes beyond this milestone's scope
- Opt-in age-based auto-archive for work orders — deferred from ARCHIVE research, manual bulk-archive ships first
- Add-on credit-pack self-purchase — deferred from BILLING research
- General test-data hygiene cleanup on the shared QA account — carried forward from v1.2 audit, not selected for v1.3

## Out of Scope

- Custom in-app plan picker / payment card form — Stripe Customer Portal covers this; building custom UI would add PCI scope and can't be tested without live Stripe credentials (reasoning: FEATURES.md anti-features)
- In-app proration preview/calculator — Stripe portal shows proration natively at switch time
- Self-serve cancellation with retention offers — hotel-ops churns via account manager, not a coupon wizard
- Storing card/PAN or billing address in Supabase — Stripe already holds it; massive compliance liability to duplicate
- Bulk **delete** of work orders — would sever the append-only `operational_audit_events` audit trail; archive (reversible) is the only bulk-removal mechanism offered
- Adding `'archived'` as a work-order `status` enum value — collapses two independent axes (operational state vs. board visibility); modeled as an orthogonal `archived_at` flag instead
- Auto-archive on completion — managers lose the post-completion review window
- Live Stripe end-to-end verification in local dev — no local Stripe credentials exist; billing paths verified via mocked/fixture tests + Stripe-CLI test-mode replay, consistent with the project's standing constraint
- Mobile app changes — this milestone targets `apps/web`/`apps/api` only per CLAUDE.md's Current Scope
- iOS EAS build pipeline (IOS-01) — unchanged, still out of scope

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ARCHIVE-01 | Phase 15 | Pending |
| ARCHIVE-02 | Phase 15 | Pending |
| ARCHIVE-03 | Phase 15 | Pending |
| ARCHIVE-04 | Phase 15 | Pending |
| ARCHIVE-05 | Phase 15 | Pending |
| ARCHIVE-06 | Phase 15 | Pending |
| BILLING-01 | Phase 16 | Pending |
| BILLING-02 | Phase 16 | Pending |
| BILLING-03 | Phase 16 | Pending |
| BILLING-04 | Phase 16 | Pending |
| BILLING-05 | Phase 16 | Pending |
| BILLING-06 | Phase 16 | Pending |
| BILLING-07 | Phase 16 | Pending |
| BILLING-08 | Phase 16 | Pending |
| BILLING-09 | Phase 16 | Pending |
| UX-01 | Phase 17 | Pending |
| UX-02 | Phase 17 | Pending |
| UX-03 | Phase 17 | Pending |
| UX-04 | Phase 17 | Pending |
| UX-05 | Phase 17 | Pending |
| UX-06 | Phase 17 | Pending |
| DATA-01 | Phase 17 | Pending |
| STAFF-01 | Phase 17 | Pending |

**Coverage:** 23/23 v1.3 requirements mapped. No orphans.

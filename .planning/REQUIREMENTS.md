# Requirements: PatelRep v1.2 Stabilization Pass

**Defined:** 2026-08-02
**Core Value:** Save a housekeeper or engineer time on the floor without weakening the hotel's ability to prove what occurred.

## v1 Requirements

Requirements for milestone v1.2. Each maps to roadmap phases. All 5 items were found by a fresh post-v1.1 audit (live web QA as GM + static mobile-code re-check of prior bug reports) rather than pre-planned — see `.planning/PROJECT.md`'s Current Milestone section for full audit context.

### Logbook Data Integrity

- [ ] **LOGBOOK-01**: A staff member's logbook entry appears under the correct hotel-local calendar day regardless of what time (in UTC) it was submitted, so entries never silently disappear from the shift log.

### AI-Assisted Action Reliability

- [ ] **AI-01**: A supervisor using "Auto-Assign with AI" in Housekeeping gets a correct assignment suggestion (or a clear error message) instead of a silent 422 failure.
- [ ] **AI-02**: An engineer using "AI triage" on a Work Order gets a triage result (or a clear error message) instead of a silent 400 failure, and that same clear-error behavior is consistent across every AI Copilot entry point (chat page, housekeeping auto-assign, engineering triage) rather than only the main chat page.

### Lost & Found Data Correction

- [ ] **LOSTFOUND-01**: A staff member can permanently delete a Lost & Found entry — including one with prior custody-transfer history — to correct a mistaken record, instead of hitting a database error.

### Room Status Display Accuracy

- [x] **ROOMSTATUS-01**: A room's assignment status displays the housekeeper actually assigned to it (from `room_status.assigned_to`) even on a day with no matching `room_assignments` row, instead of incorrectly showing "Unassigned."

## Future Requirements

Deferred beyond v1.2 — found by the same audit but not in this milestone's scope (see `.planning/PROJECT.md` for full detail):

- Whether supervisors should appear in the housekeeper assignment picker (unresolved product-intent conflict between two prior mobile audits — needs a product decision, not a code fix)
- Self-serve billing plan/payment management (currently "Coming soon")
- Billing period/usage display doesn't roll forward — shows stale months-old data
- Bulk-archive/cleanup for Engineering work orders (dozens of leftover E2E-test records accumulate with no bulk path)
- UX rough edges: blank staff display-name fallback, duplicate/leftover shift templates in Scheduling dropdowns, generic Opera integration error message (backend has the precise reason), leaked internal formula string on Management ROI page, Guest Request detail drawer missing status-advance actions, Room History panel not populating for at least one observed room
- iOS EAS build pipeline (IOS-01) — Android-only remains the shipped target

## Out of Scope

Explicitly excluded from v1.2. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| New user-facing features | v1.2 is an explicit stabilization pass — bugs first, features in a follow-up milestone. |
| Live-credential-dependent flows | No local AI provider, Stripe, Twilio, or OHIP credentials exist; unchanged since v1.0/v1.1. |
| Vercel deployment repair | Railway is the sole production target; decision made 2026-07-26, still valid. |
| iOS build pipeline | Deferred — see Future Requirements. |
| Test-data hygiene cleanup on the shared QA/staging account | Real but not a code requirement — flagged as an operational note, not a phase. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LOGBOOK-01 | Phase 12 | Pending |
| LOSTFOUND-01 | Phase 12 | Pending |
| AI-01 | Phase 13 | Pending |
| AI-02 | Phase 13 | Pending |
| ROOMSTATUS-01 | Phase 14 | Complete |
</content>

# Roadmap: PatelRep

## Milestones

- ✅ **v1.0 Hotel Standards Execution Plan** — Phases 0-6 (shipped 2026-07-28). Full details: `.planning/milestones/v1.0-ROADMAP.md`
- ✅ **v1.1 Mobile UI Parity** — Phases 7-11 (shipped 2026-08-02). Full details: `.planning/milestones/v1.1-ROADMAP.md`
- 🚧 **v1.2 Stabilization Pass** — Phases 12-14 (in progress, started 2026-08-02)

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

### 🚧 v1.2 Stabilization Pass (In Progress, started 2026-08-02)

**Milestone Goal:** Fix a set of genuine bugs found by a fresh post-v1.1 audit (live web QA + static mobile code re-check) — including one high-severity data-loss bug — before building any new capability. No new user-facing features in this milestone.

- [x] **Phase 12: Logbook & Lost & Found Data Integrity** - Entries never silently vanish or get permanently stuck due to timezone/FK bugs (completed 2026-08-02)
- [x] **Phase 13: AI Copilot Reliability** - Auto-Assign and AI triage return a result or a clear error, never a silent failure, consistently across all 3 entry points (completed 2026-08-03)
- [ ] **Phase 14: Room Status Display Accuracy** - Assigned housekeeper always displays correctly regardless of `room_assignments` row presence

## Phase Details

### Phase 12: Logbook & Lost & Found Data Integrity
**Goal**: Staff-entered records are never silently lost to a timezone bug or permanently stuck due to a delete-time database error.
**Depends on**: Nothing (independent bug fix; highest-severity item in the milestone, sequenced first)
**Requirements**: LOGBOOK-01, LOSTFOUND-01
**Success Criteria** (what must be TRUE):
  1. A logbook entry written in the evening (e.g. 8pm Central, which is after midnight UTC) appears under the hotel-local calendar day it was actually written on, not the next day.
  2. A logbook entry written just before hotel-local midnight still resolves to the correct hotel-local day, proving the fix uses hotel-local timezone conversion rather than a shifted-but-still-wrong constant offset.
  3. A staff member can permanently delete a Lost & Found entry that has at least one prior custody-transfer event, and the delete succeeds without a foreign-key database error.
  4. After deleting a Lost & Found entry with custody history, no orphaned `custody_events` rows remain and no other Lost & Found view (list, reports) errors as a result.
**Plans**: 2 plans (Wave 1, parallel)
- [ ] 12-01-PLAN.md — Logbook entries filed & listed by hotel-local day (LOGBOOK-01): local-date on create, entry_date list filter, backfill migration 086
- [ ] 12-02-PLAN.md — Permanent delete of Lost & Found items with custody history (LOSTFOUND-01): FK → ON DELETE CASCADE + update-only immutability trigger, migration 087

### Phase 13: AI Copilot Reliability
**Goal**: Every AI Copilot entry point (chat, housekeeping auto-assign, engineering triage) returns a correct result or a clear, user-visible error — never a silent failure — with consistent error-handling behavior across all three.
**Depends on**: Nothing (independent bug fix; can run in parallel with Phase 12, sequenced second by convention)
**Requirements**: AI-01, AI-02
**Success Criteria** (what must be TRUE):
  1. A supervisor clicking "Auto-Assign with AI" in Housekeeping receives either a correct room-to-housekeeper assignment suggestion or a clear on-screen error message — never a raw, unexplained 422.
  2. An engineer clicking "AI triage" on a Work Order receives either a triage result or a clear on-screen error message — never a raw, unexplained 400.
  3. The error-handling pattern (how failures are caught, logged, and surfaced to the user) is consistent across all 3 AI Copilot entry points: the main chat page, the housekeeping auto-assign button, and the engineering triage button.
  4. Existing AI Copilot chat-page behavior (intent parsing, SOP Q&A, credit fast-path) is unchanged and regression-verified after the fix.
**Plans**: 3 plans (Wave 1 → 2 → 3, sequential — each fix builds/extends the shared error-handling pattern before the next surface adopts it)
- [ ] 13-01-PLAN.md — Housekeeping "Suggest Assignments with AI" honesty fix (AI-01): fixes the fake-success bug (frontend read nonexistent `assignments_created`/`count` response keys), honest suggestion-only UX, backend response-contract regression test
- [ ] 13-02-PLAN.md — Engineering "AI triage" success/failure honesty fix (AI-02): distinct success vs. error notice styling/wording instead of both reading as "applied", deterministic fallback ordering always applied
- [ ] 13-03-PLAN.md — Chat page confirm-flow error surfacing + full cross-surface consistency and regression verification (AI-02 consistency clause + success criteria 3/4): all 4 confirm handlers + sendMessage now surface real `ApiClientError` detail instead of silently resetting; fast-path/intent-parsing/SOP-Q&A regression-verified unchanged

### Phase 14: Room Status Display Accuracy
**Goal**: Housekeeping's room-status view always reflects who is actually assigned to a room, regardless of whether a `room_assignments` row exists for today.
**Depends on**: Nothing (independent bug fix; touches `housekeeping.py` in the same file area as Phase 13's AI-01 fix — sequenced last so both fixes to that file land with a full-suite regression check between them)
**Requirements**: ROOMSTATUS-01
**Success Criteria** (what must be TRUE):
  1. A room with `room_status.assigned_to` set but no matching `room_assignments` row for today displays the actual assigned housekeeper's name, not "Unassigned."
  2. A room with no assignment at all (both `room_status.assigned_to` and `room_assignments` empty) still correctly displays "Unassigned" — the fix does not invent an assignment where none exists.
  3. A room with both `room_status.assigned_to` and a matching `room_assignments` row for today continues to display consistently (no regression to the already-working case).
**Plans**: TBD

## Backlog

- **Doc drift to fix:** CLAUDE.md's documented cron mechanism (GitHub Actions + `X-Cron-Secret`) is stale — the project now runs crons in-process via APScheduler (`apps/api/core/scheduler.py`). Code is correct; only the doc needs updating. Not blocking; revisit opportunistically.
- **Pending real-world validation:** live Twilio SMS (v1.0 Phase 5) and live Opera/OHIP + LLM-provider round-trips (v1.0 Phase 6) remain unexercised — no credentials exist in the local dev environment. Accepted deferrals, not gaps.
- **Small tidy-up:** `guest_requests.py` uses inline `current_user.role` checks instead of the `require_role()` dependency pattern used elsewhere — functionally equivalent, cosmetic inconsistency.
- **Deferred to future milestone:** iOS EAS build pipeline (IOS-01) — separate initiative, not blocking mobile UI parity.
- **Pre-existing lint smell:** `roleTabs.ts` has a duplicate `case "engineer"` — worth a one-line cleanup if a future wave touches neighboring code, not itself a requirement.
- **Remaining npm audit debt (apps/mobile):** 19 advisories (1 critical, 2 high, 16 moderate) all require the major `expo@57.0.9` bump, explicitly deferred per Phase 11 (v1.1-MILESTONE-AUDIT.md Resolution) — documented, not silently dropped. Revisit when a coordinated Expo major-version upgrade is planned.
- **Deferred beyond v1.2 (found by the v1.2 audit, not code bugs or in scope):** whether supervisors should appear in the housekeeper assignment picker (unresolved product-intent conflict); self-serve billing plan/payment management ("Coming soon"); billing period/usage display not rolling forward; bulk-archive for Engineering work orders; blank staff display-name fallback; duplicate/leftover shift templates in Scheduling dropdowns; generic Opera integration error message; leaked internal formula string on Management ROI; Guest Request detail drawer missing status-advance actions; Room History panel not populating for at least one observed room. See `.planning/REQUIREMENTS.md` Future Requirements.

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
| 12. Logbook & Lost & Found Data Integrity | v1.2 | Complete    | 2026-08-02 | - |
| 13. AI Copilot Reliability | v1.2 | Complete    | 2026-08-03 | - |
| 14. Room Status Display Accuracy | v1.2 | 0/TBD | Not started | - |

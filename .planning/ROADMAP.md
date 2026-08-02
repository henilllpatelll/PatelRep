# Roadmap: PatelRep

## Milestones

- ✅ **v1.0 Hotel Standards Execution Plan** — Phases 0-6 (shipped 2026-07-28). Full details: `.planning/milestones/v1.0-ROADMAP.md`
- ✅ **v1.1 Mobile UI Parity** — Phases 7-11 (shipped 2026-08-02). Full details: `.planning/milestones/v1.1-ROADMAP.md`

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

## Backlog

- **Doc drift to fix:** CLAUDE.md's documented cron mechanism (GitHub Actions + `X-Cron-Secret`) is stale — the project now runs crons in-process via APScheduler (`apps/api/core/scheduler.py`). Code is correct; only the doc needs updating. Not blocking; revisit opportunistically.
- **Pending real-world validation:** live Twilio SMS (v1.0 Phase 5) and live Opera/OHIP + LLM-provider round-trips (v1.0 Phase 6) remain unexercised — no credentials exist in the local dev environment. Accepted deferrals, not gaps.
- **Small tidy-up:** `guest_requests.py` uses inline `current_user.role` checks instead of the `require_role()` dependency pattern used elsewhere — functionally equivalent, cosmetic inconsistency.
- **Deferred to future milestone:** iOS EAS build pipeline (IOS-01) — separate initiative, not blocking mobile UI parity.
- **Pre-existing lint smell:** `roleTabs.ts` has a duplicate `case "engineer"` — worth a one-line cleanup if a future wave touches neighboring code, not itself a requirement.
- **Remaining npm audit debt (apps/mobile):** 19 advisories (1 critical, 2 high, 16 moderate) all require the major `expo@57.0.9` bump, explicitly deferred per Phase 11 (v1.1-MILESTONE-AUDIT.md Resolution) — documented, not silently dropped. Revisit when a coordinated Expo major-version upgrade is planned.

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

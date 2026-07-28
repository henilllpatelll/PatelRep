# Roadmap: PatelRep Hotel Standards Execution Plan

## Milestones

- ✅ **v1.0 Hotel Standards Execution Plan** — Phases 0-6 (shipped 2026-07-28). Full details: `.planning/milestones/v1.0-ROADMAP.md`

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

## Backlog

- **Parked:** All mobile work, including EAS build, mobile i18n handoff, and rooms debugging. Web + API only for v1.0; revisit if a future milestone resumes mobile work.
- **Doc drift to fix in next milestone:** CLAUDE.md's documented cron mechanism (GitHub Actions + `X-Cron-Secret`) is stale — the project now runs crons in-process via APScheduler (`apps/api/core/scheduler.py`), confirmed healthy in production. Code is correct; only the doc needs updating.
- **Pending real-world validation:** live Twilio SMS (Phase 5) and live Opera/OHIP + LLM-provider round-trips (Phase 6) remain unexercised — no credentials exist in the local dev environment. Accepted deferrals, not gaps; verify when credentials are provisioned or during pilot rollout.
- **Small tidy-up:** `guest_requests.py` uses inline `current_user.role` checks instead of the `require_role()` dependency pattern used elsewhere — functionally equivalent, cosmetic inconsistency.

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

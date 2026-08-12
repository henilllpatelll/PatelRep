# Project Milestones: PatelRep

[Entries in reverse chronological order - newest first]

## v1.0 Hotel Standards Execution Plan (Shipped: 2026-07-28)

**Delivered:** Production trust, evidence/compliance platform, Texas safety, recurring bilingual (EN/ES) maintenance/housekeeping programs, guest recovery + management ROI, and an audited/hardened AI copilot + Opera PMS integration.

**Phases completed:** 0-6 (7 phases, 40+ plans — Phase 3 used an older execution-plan format predating per-plan PLAN.md files)

**Key accomplishments:**
- Production trust and monitoring: cron health tracking, real DB-probe login footer, deploy-check smoke CI, new Railway account with both services deployed and healthy
- Core operational integrity: reusable append-only `operational_audit_events` and `notification_deliveries` patterns, established in Phase 1 and reused through every subsequent phase rather than parallel per-domain mechanisms
- Reusable compliance-evidence platform (controlled documents, evidence records, competency/acknowledgment, GM exceptions dashboard) plus Texas-specific safety/training operations
- Recurring bilingual maintenance/housekeeping programs with full EN/ES floor contract enforced via CI (`i18next/no-literal-string` gate)
- Guest recovery workflows (SMS) with measurable management ROI reporting, deployed live
- AI copilot + Opera PMS integration: security-audited and production-hardened, pilot-gated (21/21 threats closed); 5 real bugs found and fixed in-phase or at milestone-audit time (flat-cost credit billing, SOP double-logging, Opera webhook wrong-secret signature, misleading Opera connect-form UI, cross-phase AI-copilot guest-request escalation gap)

**Stats:**
- ~105K LOC (Python + TypeScript)
- 500 API tests passing
- 7 phases, 40+ plans, 833 commits total (project start to ship)
- 140 days from project start to ship (2026-03-11 → 2026-07-28)

**Git range:** first commit → `cb50b6eb` (tag `v1.0`)

**What's next:** TBD via `/gsd-new-milestone`

---

## v1.1 Mobile UI Parity (Shipped: 2026-08-02)

**Delivered:** App-wide visual and interaction parity between the mobile app and the web app's refreshed UI system — a reactive theme foundation, a zero-dependency shared primitive library, full-app migration onto it, dark mode, and full EN/ES i18n coverage — all without changing any behavior, data, routing, or RBAC.

**Phases completed:** 7-11 (5 phases, 49 plans)

**Key accomplishments:**
- Built a reactive theme foundation (`ThemeProvider`/`useTheme()`, light/dark/system preference, persisted across restarts) as the single foundation every later phase built on
- Created a zero-dependency shared primitive library (Button, Card, StatusBadge, EmptyState/StateBlock, Toast) — no new npm packages, matching the fragile-EAS-pipeline constraint
- Migrated all 20+ mobile screens and 15+ shared modals from hardcoded colors onto the shared primitives, including 40+ `Alert.alert` outcome calls converted to non-blocking Toast
- Shipped full app-wide dark mode with WCAG AA contrast independently re-verified (110 passing assertions) and a real human Android device walkthrough (10 rows approved) plus a green EAS production build
- Closed the i18n gap completely — full EN/ES parity across every screen, ESLint `i18next/no-literal-string` gate widened from 10 to 26 directories covering the entire app, zero raw literals remaining
- Milestone audit (post-Phase-10) found 2 real cross-phase integration gaps plus accumulated tech debt (i18n gate coverage hole, one hardcoded dark-mode color, npm audit advisories, a silently-swallowed error); rather than defer, Phase 11 was added in the same milestone to close all of it — 0 open items at ship

**Stats:**
- 211 commits, 103 mobile files changed, +12,574/-4,799 lines
- 5 phases, 49 plans
- 5 days from phase start to ship (2026-07-29 → 2026-08-02)

**Git range:** `d467fdfc` → `fbca2397` (tag `v1.1`)

**What's next:** TBD via `/gsd-new-milestone`

---


## v1.2 Stabilization Pass (Shipped: 2026-08-03)

**Delivered:** A fresh post-v1.1 audit (live web QA + static mobile code re-check) found 5 genuine bugs, including one high-severity data-loss bug; this milestone fixed all of them — no new user-facing features by explicit scope decision.

**Phases completed:** 12-14 (3 phases, 7 plans)

**Key accomplishments:**
- Logbook entries now file under the correct hotel-local calendar day regardless of UTC submission time (real IANA timezone conversion, not a fixed offset), fixing a high-severity data-loss bug where evening entries silently vanished from the shift log
- Lost & Found items with prior custody-transfer history can now be permanently deleted (FK cascade + trigger narrowing) instead of hitting a database error that stuck them forever
- AI Copilot Auto-Assign and AI triage return a real result or a clear error — never a silent/fabricated success — made consistent across all 4 UI entry points (Room Board sidebar, Assignments tab, floating chat bubble, dedicated /ai chat page); found and closed via a re-verification cycle after the initial pass caught 2 remaining inconsistent surfaces
- Housekeeping board now shows a room's actual assignee (from `room_status.assigned_to`) even when there's no `room_assignments` row for the requested date, instead of falsely showing "Unassigned" — a deliberate, user-confirmed reversal of prior "suppress stale assignee" behavior
- Milestone audit found migrations 086/087 (the DB-level fixes for the logbook and Lost & Found bugs above) were code-complete and tested but never applied to the production Supabase project; applied both live and independently verified against actual schema state (not just the migration-history log) before shipping

**Stats:**
- 16 files changed, 746 insertions(+), 84 deletions(-) (phase work only, excludes milestone-completion docs)
- 3 phases, 7 plans
- <1 day from phase start to ship (2026-08-02 → 2026-08-03)

**Git range:** `0932a097` → `473f5397` (phase work), migrations applied and audit closed 2026-08-03

**What's next:** TBD via `/gsd-new-milestone`

---


## v1.3 Billing, Work Order Archival, and Backlog Cleanup (Shipped: 2026-08-04)

**Delivered:** Self-serve billing management via the Stripe Customer Portal with hardened revenue-integrity guarantees, bulk-archive for Engineering work orders, and the full backlog of UX rough edges and data-integrity fixes carried forward from v1.2's audit.

**Phases completed:** 15-17 (3 phases, 14 plans)

**Key accomplishments:**
- Work-order bulk-archive: managers can select-and-archive or age-based bulk-archive completed/cancelled work orders, restore any of them, and every action writes an audit-trail row — archived orders vanish from the Realtime board without a page reload
- Self-serve billing: GM can open the Stripe Customer Portal to change plan/payment method directly from the billing page (previously a disabled "Coming soon"), with accurate rolling usage, spend-cap headroom, a projected month-end cost gauge, and an 80%-cap proactive alert
- Billing revenue-integrity hardening: the monthly true-up cron is now idempotent (`is_finalized` ledger stamp survives Stripe's 24h idempotency-key expiry, closing a real double-charge risk), a final true-up runs on `subscription.deleted` before cancellation, and Stripe webhooks are deduplicated by `event.id`
- Backlog cleanup closed all 8 carried-forward items from v1.2's audit in one phase: staff display names never render blank, shift-template duplicates rejected pre-insert, real Opera error messages surface instead of a generic string, the Management ROI page no longer leaks its internal formula, Guest Request drawer gained status-advance actions, Room History now populates with real data + actor attribution, and supervisors are assignable in the housekeeper picker
- Closed the `ai_interactions.interaction_type` CHECK-constraint drift (DATA-01) that had been deferred 4 times across prior milestones — migration 091 widens it to the real 14-value set
- Milestone audit (this session) found and closed one more instance of this milestone's recurring pattern — migration 091 was code-complete but not yet applied to production; applied and verified live via `pg_get_constraintdef` before shipping, continuing the same discipline that caught migrations 086/087 (v1.2) and 090 (Phase 16's own verification)

**Stats:**
- 39 files changed, +2,590/-478 lines
- 3 phases, 14 plans
- <1 day from phase start to ship (2026-08-03 → 2026-08-04)

**Git range:** `d4d4aef5` → `a661afa1`

**What's next:** TBD via `/gsd-new-milestone`

---


## v1.4 Platform and Ops Hardening (Shipped: 2026-08-11)

**Delivered:** Paid down accumulated platform debt across RBAC consistency, documentation accuracy, dev/QA data hygiene, and mobile dependency health — closing 18/18 requirements and every deferred v1.3 verification item with zero known open issues at ship.

**Phases completed:** 18-22 (5 phases, 16 plans, 32 tasks)

**Key accomplishments:**
- Corrected three drifted CLAUDE.md sections (cron mechanism, local-credential note, 30-router domain map) to match production reality
- Built `core/roles.py` as a single source-of-truth for role-group constants, closed two real RBAC gaps (an ungated guest-request delete endpoint, a lost-found custody-state bypass), and produced a full 30-router audit artifact
- Closed all 4 human-verification items deferred from v1.3 live in-browser, surfacing and fixing 7 previously-undiscovered production bugs along the way — including a guest-request DELETE endpoint that had never worked for any request, a structurally-broken Scheduling roster endpoint, and a CORS-masking rate-limit middleware ordering bug
- Added a schema-level `tenants.is_test` flag, a human-reviewed delete-allowlist, and a dry-run-gated cleanup script for the shared dev/QA Supabase project — verified clean against 339 live rows with zero deletions outside the allowlist
- Upgraded `apps/mobile` from Expo SDK 54 to 57.0.9 across three sequential single-major hops, each gated by a green EAS Android cloud build, resolving all 19 previously-tracked `npm audit` advisories
- The milestone-level audit caught and closed a cross-phase gap invisible to any single phase's own verification: a newly-restored `chief_engineer` role could log in but hit a broken, 403ing dashboard — fixed and live-verified through a real seeded-user browser session before shipping

**Stats:**
- 145 files changed, +34,728/-3,799 lines
- 5 phases, 16 plans, 32 tasks, 62 commits
- 7 days from milestone start to ship (2026-08-04 → 2026-08-11)

**Git range:** `40402245` → `HEAD` (tag `v1.4`)

**What's next:** TBD via `/gsd-new-milestone`

---


## v1.5 RBAC Enforcement Tooling (Shipped: 2026-08-11)

**Delivered:** Closed the RBAC tooling gap deferred from Phase 19 — role-check drift is now structurally hard to reintroduce instead of relying on periodic manual audits.

**Phases completed:** 23-24 (2 phases, 2 plans, 6 tasks)

**Key accomplishments:**
- Auto-generated, deterministic `apps/api/RBAC-MATRIX.md` (30 routers, 286 routes) via a new AST-based generator (`apps/api/scripts/generate_rbac_matrix.py`), replacing the one-time hand-typed Phase 19 `RBAC-AUDIT.md` inventory with a living, regenerable artifact enforced by a pytest CI drift guard
- New CI guard (`apps/api/scripts/check_bare_role_comparisons.py` + `apps/api/rbac_bare_comparison_allowlist.json`) fails the build the moment a router adds a bare `current_user.role` comparison outside `require_role()`/an imported `core/roles.py` constant, with a 25-entry reasoned allowlist for every pre-existing intentional inline check
- Both phases' own code-review-fix cycles caught and closed a critical defect before phase-gate verification: Phase 23 fixed a bug mislabeling real inline 403-denial gates as unrestricted (`none`); Phase 24 fixed an allowlist-matching evasion gap (text-only matching let duplicate-text new violations slip through), replaced with per-occurrence-count matching
- Milestone audit independently re-verified both fixes hold and confirmed the two phases' outputs are mutually consistent post-fix (every Phase-23-labeled inline gate has a matching Phase-24 allowlist entry, no orphans) — 4/4 requirements satisfied, 0 gaps

**Stats:**
- 2 phases, 2 plans, 6 tasks, ~17 commits (docs + code + 2 review-fix cycles)
- <1 day from milestone start to ship (2026-08-11)

**Git range:** `3bc42672` → `HEAD` (tag `v1.5`)

**What's next:** TBD via `/gsd-new-milestone`

---


## v1.6 AI Copilot Proactive Intelligence (Shipped: 2026-08-12)

**Delivered:** Turned the already-computed room-readiness and asset-failure predictions from passive/inconsistent surfaces into an actionable, consistent proactive-alerting system — engineers get notification parity with room-readiness, dashboard alert rows link to the real room/asset instead of dead ends, and supervisors can act on a HIGH-risk room prediction with one tap instead of only reading about it.

**Phases completed:** 25-27 (3 phases, 6 plans, 6/6 requirements — AI-03 through AI-08)

**Key accomplishments:**
- Asset failure-risk predictions gained the same edge-triggered proactive-notification parity room-readiness predictions already had (`notify_engineers_asset_risk_high`, dedup anchored on `assets.failure_risk_score` read before the cron's own overwrite) — engineers/chief engineers/GMs are notified once on a new HIGH crossing, never spammed on unchanged re-runs (Phase 25, AI-06)
- `AIRiskAlertsPanel` rows are real deep links: housekeeping rows open the exact room's detail drawer (was a generic `/housekeeping` link), maintenance rows open the exact asset's prediction card (had no link at all before) — both required a genuinely-scoped one-line backend fix (`asset_risks` select was missing `id`) the roadmap's "pure frontend" framing had missed (Phase 26, AI-07/AI-08)
- Supervisors/GMs can reassign a HIGH-risk room to the least-loaded eligible housekeeper, escalate, or acknowledge-and-suppress directly from the Predictions panel with one confirming tap — reassign/escalate both re-read live room state before acting so a stale prediction can't trigger a bad action, and reassign degrades to notifying a supervisor instead of forcing an assignment onto an already-overloaded housekeeper (Phase 27, AI-03/AI-04/AI-05)
- Phase 27 uncovered and fixed a significant pre-existing production bug while extending the same function: `run_room_predictions`'s buffer-vs-checkin subtraction mixed a timezone-aware and a timezone-naive datetime, raised on every real call, was silently swallowed by the function's own broad `except`, and skipped every room's prediction update — the `predictions.run` cron (already running every 30 minutes in production) had likely never actually recomputed a room's risk level or fired a supervisor notification before this fix
- All three phases ran through a full autonomous discuss→research→plan→plan-check→execute→verify→close cycle with independent spot-checks at every stage (re-running test suites, type-checks, builds, and live Supabase queries rather than trusting agent-reported summaries); the plan-checker step caught one wave/dependency ordering bug (Phase 26) and one test-fixture gap (Phase 27) before either could waste an execution cycle

**Stats:**
- 3 phases, 6 plans, ~30 tasks, 1 new Postgres migration (095, applied and live-verified), 3 new backend endpoints, 0 regressions across a final 589-test backend suite
- 2026-08-12 → 2026-08-12 (single-session milestone)

**Git range:** `070981a1` → `HEAD` (tag `v1.6`)

**What's next:** TBD via `/gsd-new-milestone` — v2 backlog already seeded: AI-09 (batch-reassign/acknowledge) and AI-10 (un-actioned-prediction escalation-to-GM), both deferred pending evidence of real need.

---


# PatelRep

## What This Is

PatelRep is an AI staff copilot for 50–150 room Texas hotels. It gives housekeepers, engineers, supervisors, and GMs short, dependable web and mobile workflows for the work that must happen on the floor, while preserving defensible operational evidence.

## Core Value

Save a housekeeper or engineer time on the floor without weakening the hotel’s ability to prove what occurred.

## Requirements

### Validated

- ✓ Production trust and monitoring — Phases 0–1 closed 2026-07-19.
- ✓ Core engineering state, escalation, and append-only audit integrity — Phase 1 closed 2026-07-19.
- ✓ Recurring, evidence-backed PM and housekeeping programs, plus the full D-03 bilingual (EN/ES) floor contract across housekeeping, engineering/work-orders, tasks, and programs surfaces — Validated in Phase 4: Maintenance and housekeeping programs, closed 2026-07-24 (17/17 plans; gap-closure batch 04-09..04-17 widened the `i18next/no-literal-string` CI gate to the full locked scope after 04-08 shipped a narrowed version).
- ✓ Guest-service closure and measurable operational value (guest recovery workflows + management ROI reporting) — Validated in Phase 5: Guest recovery and management ROI, closed 2026-07-25 (12/12 plans; verified in code + human UAT; deployed live on Railway).
- ✓ Production-trust-grade AI copilot expansion (task/work-order/guest-request/assignment intents, ambiguity handling, SOP Q&A, credit fast-path) and Opera PMS integration, both RBAC/tenant-isolation/credit-accounting tested and Opera pilot-gated — Validated in Phase 6: PMS and AI expansion, closed 2026-07-28 (5/5 plans; UAT passed 0 issues; security verified 21/21 threats closed). Reframed mid-phase from the original roadmap's "greenfield AI/PMS expansion" premise to an audit-first hardening pass, since discuss-phase discovered the AI copilot expansion and much of the Opera integration were already shipped and live (commit `e4ac615a`, 2026-05-22) but untested and ungated.
- ✓ Full mobile UI parity with the web app's refreshed design system — reactive theme foundation (light/dark/system), a zero-dependency shared primitive library (Button, Card, StatusBadge, EmptyState/StateBlock, Toast), every screen and modal migrated onto it, full EN/ES i18n coverage with an app-wide ESLint enforcement gate, and WCAG AA dark mode verified on a real device — Validated across Phases 7-11: Mobile UI Parity, shipped 2026-08-02 (5 phases, 49/49 plans; milestone audit found 2 integration gaps + accumulated tech debt, closed in-milestone via Phase 11 rather than deferred — 0 open items at ship).
- ✓ LOGBOOK-01 — Logbook entries file under the correct hotel-local calendar day regardless of UTC submission time — Validated in Phase 12: Logbook & Lost & Found Data Integrity, closed 2026-08-02 (application-layer fix + migration 086 backfill, applied to production 2026-08-03).
- ✓ LOSTFOUND-01 — Lost & Found items with custody-transfer history can be permanently deleted — Validated in Phase 12, closed 2026-08-02 (FK cascade + trigger narrowing via migration 087, applied to production 2026-08-03 — milestone audit caught that this migration was written and tested but never deployed, and closed the gap before shipping).
- ✓ AI-01 / AI-02 — AI Copilot Auto-Assign and AI triage return a real result or a clear error, never a silent/fabricated success, consistent across all 4 UI entry points — Validated in Phase 13: AI Copilot Reliability, closed 2026-08-03 (initial verification found 2 remaining inconsistent surfaces; 13-04 gap-closure plan fixed both, re-verification passed 4/4).
- ✓ ROOMSTATUS-01 — Housekeeping board shows a room's actual assignee even when there's no today `room_assignments` row, instead of falsely showing "Unassigned" — Validated in Phase 14: Room Status Display Accuracy, closed 2026-08-03 (deliberate reversal of prior "suppress stale assignee" behavior, confirmed via user checkpoint).
- ✓ ARCHIVE-01..06 — Managers can bulk-archive/restore completed or cancelled work orders (individually or by age), archived orders drop out of the default view and Realtime board, and every action is audit-logged — Validated in Phase 15: Work-Order Bulk-Archive, closed 2026-08-04.
- ✓ BILLING-01..09 — GM self-manages plan/payment via the Stripe Customer Portal with accurate rolling usage, spend-cap headroom, month-end cost projection, and an 80%-cap alert; the monthly true-up cron is idempotent and cannot double-charge; overage before a mid-cycle cancellation is still invoiced; Stripe webhooks are deduplicated by `event.id` — Validated in Phase 16: Self-Serve Billing Management, closed 2026-08-04.
- ✓ UX-01..06 — Staff display names never render blank, shift-template duplicates rejected pre-insert, Opera connection errors show real backend detail, Management ROI no longer leaks its internal formula, Guest Request drawer has status-advance actions, Room History populates with real data + actor attribution — Validated in Phase 17: Backlog Cleanup, closed 2026-08-04.
- ✓ DATA-01 — `ai_interactions.interaction_type` CHECK-constraint widened to the real 14-value set (deferred 4x across prior milestones) — Validated in Phase 17, closed 2026-08-04; migration 091 applied to production and verified live during the v1.3 milestone audit (2026-08-04).
- ✓ STAFF-01 — Supervisors (`housekeeping_supervisor`) appear as assignable staff in the housekeeper room-assignment picker (product decision resolved 2026-08-03: include supervisors) — Validated in Phase 17, closed 2026-08-04.
- ✓ DOC-01..03 — CLAUDE.md's cron mechanism, local-credential note, and 30-router domain map corrected to match production reality — Validated in Phase 18, closed 2026-08-04.
- ✓ RBAC-01..04 — Full 30-router role-check audit artifact produced; `DELETE /guest-requests/{id}` and `lost_found.py`'s custody-state endpoints gated to management/custody roles; drifted role-group constants consolidated into `core/roles.py`, the single source of truth — Validated in Phase 19, closed 2026-08-04.
- ✓ VERIFY-01..04 — All 4 human-verification items deferred from v1.3 (archive-button role gate, "Unnamed Staff" fallback, guest-request status-advance chain, inspection re-assign to supervisor) confirmed live in-browser — Validated in Phase 20, closed 2026-08-05 (surfaced and fixed 7 real production bugs along the way, including a guest-request DELETE endpoint that had never worked).
- ✓ QA-01..03 — `tenants.is_test` schema flag, human-reviewed delete-allowlist, and a dry-run-gated cleanup script for the shared dev/QA Supabase project — Validated in Phase 21, closed 2026-08-05 (dry-run verified clean against 339 live rows, zero deletions outside the allowlist).
- ✓ MOBILE-01..04 — `apps/mobile` upgraded Expo SDK 54→57.0.9 via 3 gated single-major hops (each with a green EAS Android build), New Architecture reconciled, `@react-navigation/native@7.3.14` an explicit direct dependency, all 19 tracked `npm audit` advisories resolved — Validated in Phase 22, closed 2026-08-06.

### Active

*(Next milestone not yet defined — run `/gsd-new-milestone` to scope it.)*

## Current Milestone: v1.5 RBAC Enforcement Tooling

**Goal:** Close the RBAC tooling gap deferred from Phase 19 — make role-check drift structurally hard to reintroduce, instead of relying on periodic manual audits.

**Target features:**
- Auto-generated route×role permission matrix (every endpoint's required role(s), derived from live code, regenerable on demand)
- CI lint rule blocking new bare role-comparison checks outside `core/roles.py`

## Next Milestone Goals

TBD — scoped via `/gsd-new-milestone` after v1.5 ships.

### Out of Scope

- Live-credential-dependent AI flows — `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` are genuinely absent locally (commented out in `apps/api/.env`); AI-provider-dependent paths remain verified via mocked/fixture-based tests only. Twilio/OHIP credentials remain genuinely absent too. Stripe (test-mode) and Supabase service-role credentials are present locally — CLAUDE.md's Current Scope note was corrected to reflect this in Phase 18 (DOC-02), closed 2026-08-04.
- Vercel deployment repair — Railway is the sole production target; Vercel kept only as a secondary PR-preview surface, decision made 2026-07-26. Still valid.
- iOS EAS build pipeline (IOS-01) — Android-only mobile builds remain the shipped target; iOS is a separate future initiative, not blocking anything shipped so far.
- Live Stripe end-to-end verification for the billing revenue-integrity paths (true-up cron double-charge protection, real `InvoiceItem.create`) — Phase 16 shipped with 23 unit tests substituting for a live round-trip; deliberate deferral given the shared test account's blast radius, not a credential gap.
- Separate staging Supabase project — deliberate current-state constraint (Phase 21/v1.4), not addressed yet; the dev/QA project now has `is_test` tenant flagging plus a dry-run-gated cleanup script instead.
- Auto-generated route × role permission matrix, and a CI lint rule blocking new bare role comparisons — second-wave RBAC tooling deferred from v1.4 (Phase 19); do after the normalization pattern has settled.

## Context

The stack is FastAPI with direct Supabase SDK queries, Next.js 14/16 web, and Expo/React Native mobile (Android-only EAS builds, now on Expo SDK 57.0.9). Tenant isolation is mandatory in every query and RLS is a second safety layer. Phase 1 established the reusable append-only `operational_audit_events` and `notification_deliveries` patterns, reused through Phases 2-4 rather than parallel mechanisms per domain. Mobile has its own reactive theme/primitive system (Phase 7), fully adopted app-wide (Phases 8-9) with dark mode and WCAG AA contrast (Phase 10). RBAC now has a single source of truth (`apps/api/core/roles.py`, Phase 19) that every router imports role-group constants from, rather than local, drift-prone tuples. As of v1.4: 553 API tests passing (3 pre-existing unrelated failures in `test_management_roi.py`, confirmed predating this milestone via `git stash` A/B comparison), `apps/mobile` Jest 412/412 passing with zero `npm audit` advisories, 1112+ commits since project start.

## Current State (as of v1.4, 2026-08-11)

Everything validated at v1.0-v1.3 remains shipped and deployed. v1.4 was a pure hardening/ops milestone — no new user-facing features, by explicit scope decision. CLAUDE.md's cron-mechanism, credential, and 30-router domain-map doc-drift is corrected. RBAC now has a single source-of-truth module (`core/roles.py`) with two real access-control gaps closed (an ungated guest-request delete, a lost-found custody-state bypass). All 4 human-verification items deferred from v1.3 are confirmed live, which in the process surfaced and fixed 7 previously-undiscovered production bugs (a guest-request DELETE endpoint that had never worked for any request, a structurally-broken Scheduling roster endpoint, a CORS-masking rate-limit middleware ordering bug, a stale-drawer 422 bug, a Pydantic role-literal typo, a stale DB CHECK constraint, and a broken inspection re-clean dispatch). The shared dev/QA Supabase project now has a schema-level `is_test` flag and a dry-run-gated cleanup script, verified clean against 339 live rows. `apps/mobile` is upgraded from Expo SDK 54 to 57.0.9 across three gated hops, each with a green EAS Android build, resolving all 19 previously-tracked `npm audit` advisories. The v1.4 milestone audit — the first audit level no individual phase's own verification could reach — caught one real cross-phase gap: migration 092 restored `chief_engineer` as a live role, but `core/roles.py` (written one phase earlier, before 092 landed) still excluded it, breaking that role's dashboard and two API endpoints with a 403. Fixed and live-verified through a real seeded-user browser session (0 console errors) before shipping, along with the same inline-role-list drift found live in three `reports.py` endpoints during the fix's own verification.

<details>
<summary>Current State as of v1.3 (2026-08-04) — superseded, kept for history</summary>

Everything validated at v1.0, v1.1, and v1.2 remains shipped and deployed. v1.3 shipped two new feature areas plus the full v1.2 backlog: managers can now bulk-archive (individually or by age) and restore completed/cancelled work orders with a full audit trail; GMs can self-manage plan and payment through the Stripe Customer Portal with accurate rolling usage, spend-cap headroom, a month-end cost projection, and an 80%-cap alert, backed by revenue-integrity hardening (idempotent monthly true-up, cancellation-time final true-up, Stripe webhook `event.id` dedup). Phase 17 closed all 8 items carried forward from v1.2's audit in one phase, including the `ai_interactions.interaction_type` CHECK-constraint drift deferred 4 times across prior milestones. The v1.3 milestone audit repeated v1.2's pattern of catching an unapplied-migration gap the phase-level verification missed — migration 091 was code-complete but not yet live; applied and independently verified against live schema state (`pg_get_constraintdef`, all 14 values present) before shipping. Migrations 089/090 (Phase 15/16's own dependencies) were similarly caught unapplied during Phase 16's own verification pass and fixed same-session, before this milestone audit ever ran. A stale factual assumption was also corrected during Phase 16 verification: local Stripe (test-mode) and Supabase service-role credentials are in fact present in `apps/api/.env`/`apps/web/.env.local`, contrary to the project's long-standing "no local Stripe credentials" note — only the AI-provider keys are genuinely absent.

</details>

<details>
<summary>Current State as of v1.2 (2026-08-03) — superseded, kept for history</summary>

Everything validated at v1.0 and v1.1 remains shipped and deployed. v1.2 closed 5 genuine bugs found by a fresh post-v1.1 audit — logbook entries no longer misfile across the UTC/hotel-local day boundary, Lost & Found items with custody history can be permanently deleted, AI Copilot Auto-Assign and AI triage return honest results/errors consistently across all 4 UI surfaces, and the housekeeping board shows a room's real assignee instead of a false "Unassigned." The v1.2 milestone audit caught a deployment gap the phase-level verifications missed: two DB migrations (086, 087) were code-complete and tested but had never been applied to the production Supabase project — both were applied and independently verified against live schema state before shipping. No new user-facing features shipped this milestone, by explicit scope decision.

</details>

<details>
<summary>Current State as of v1.1 (2026-08-02) — superseded, kept for history</summary>

Everything validated at v1.0 remains shipped and deployed. Mobile now has full UI parity with web's refreshed design system — reactive theme (light/dark/system), shared primitives, every screen migrated, full EN/ES i18n coverage enforced by an app-wide ESLint gate, and a green EAS Android production build. The v1.1 milestone audit found 2 cross-phase integration gaps (i18n gate coverage hole, one hardcoded dark-mode color) plus accumulated tech debt (a silently-swallowed FoundItemModal error, a missing i18n key, npm audit advisories) — all closed within the same milestone via Phase 11, not deferred. Remaining known items: 19 npm audit advisories in `apps/mobile` all requiring the out-of-scope `expo@57.0.9` major bump (documented, tracked in ROADMAP.md Backlog); CLAUDE.md's cron-mechanism doc-drift (still unfixed, opportunistic).

</details>

## Constraints

- **Security**: Every table is tenant-scoped in API queries and RLS; every mutation is gated with `require_role()` (or an equivalent inline role check). Role-group constants are consolidated in `apps/api/core/roles.py` (Phase 19) — routers must import from there rather than defining local `*_ROLES` tuples, to prevent silent drift.
- **Storage**: Attachments use the existing private-bucket, signed-URL pattern; public object URLs are prohibited.
- **Delivery**: No local AI (OpenAI/Anthropic), Twilio, or OHIP credentials — no core path may depend on live calls to these for local dev/test; production has real credentials configured. **Correction (2026-08-04):** Stripe (test-mode) and Supabase service-role credentials *are* present locally (`apps/api/.env`, `apps/web/.env.local`) — this constraint no longer applies to billing/Stripe paths, which can and should be live-verified locally going forward.
- **Mobile dependencies**: The Expo/EAS build pipeline is fragile (`dynamic-import-node` babel plugin, New Architecture, `--legacy-peer-deps` for React 19) — zero new npm dependencies by design; any dependency change (including patch-level `npm audit fix` bumps to `expo`/`babel-preset-expo`/`expo-updates`) requires a green EAS build before merging.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| One evidence platform | Training, safety, maintenance, SOP, and compliance must reuse the same evidence and audit contracts. | Shipped — Phase 2's `operational_audit_events` pattern reused through Phases 3–4 (safety, maintenance/housekeeping). |
| Five vertical deliverables | Build applicability, documents, evidence, competency, then exceptions in that order. | Shipped in that order across Phases 2–4. |
| Review before execution | This two-week phase requires plan review before implementation begins. | Applied — gsd-plan-checker gate used on all phases through 6. |
| Phase 6 reframed as audit-first, not greenfield | Discuss-phase discovered the AI copilot expansion + much of Opera integration were already implemented and live (commit `e4ac615a`) but untested/ungated — building "new" features on an unverified, unsafe foundation would compound risk. | Shipped — Phase 6 delivered as a verification/hardening pass (mirroring Phase 4's S0 audit-first slice); found and fixed 3 real bugs beyond what research anticipated (flat-cost credit billing, SOP double-logging, Opera webhook wrong-secret signature) plus 2 more during execution/verification (a second unaudited `/sop/query` billing gap, a misleading Opera UI connect form). New AI/PMS capabilities explicitly deferred to a future phase. |
| Opera pilot-gating via a single boolean column | `tenants.opera_pilot_enabled` vs. a richer `pilot_features` table — only one integration currently needs gating (YAGNI). | Shipped — matches the existing `is_active`-style boolean-flag idiom; migration 085. |
| Fix real cross-phase gaps found during milestone audit immediately, not defer | Consistent with every prior in-phase bug-fix precedent (migration-079, bug-449, Phase 6's own D-05) — a milestone shouldn't ship with a known silent failure in a shipped feature. | Shipped — AI-copilot guest-request escalation gap (found by the v1.0 cross-phase integration audit) fixed same session, `confirm_guest_requests` now mirrors the canonical `create_guest_request` contract. |
| Mobile UI parity built as shared primitives first, not screen-by-screen | Mirrors the same Wave-0-first approach that worked for the web refresh — avoids drift from 20+ screens each reinventing buttons/cards/empty-states in RN. | Shipped — Phase 7 built primitives with zero screen adoption; Phases 8-9 migrated every screen onto them with no drift. |
| Floor-role screens (housekeeper/engineer) prioritized over manager/settings for mobile UI parity | Mobile's entire user base is floor staff — no manager/settings screens exist on mobile today. | Shipped — Phase 8 migrated floor screens first, Phase 9 covered every remaining screen. |
| Milestone audit gaps get closed in-milestone via a new phase, not deferred to backlog | Consistent with the v1.0 precedent (migration-079, bug-449, the AI-copilot guest-request gap) — ship with zero known open items rather than carry debt forward "to fix later." | Shipped — v1.1's audit found 2 integration gaps + accumulated tech debt after Phase 10 closed; Phase 11 was added to the same milestone and closed all of it before archiving. |
| Zero new npm dependencies for mobile tech-debt fixes; only patch-level `npm audit fix`, no `--force` | Mobile's EAS build pipeline is documented as fragile; a major dependency bump risks breaking the production build pipeline for a hardening pass that isn't supposed to touch behavior. | Shipped — Phase 11 reduced npm audit advisories 27→19 via safe fix only, verified with a real green EAS Android build; the remaining 19 (needing `expo@57.0.9`) are documented and tracked in Backlog, not silently dropped. |
| Housekeeping board treats `room_status.assigned_to` as authoritative whenever no today `room_assignments` row exists, even for a stale prior-day assignee | `room_status` carries no per-assignment timestamp, so "current" and "stale-from-yesterday" are indistinguishable in code; ROOMSTATUS-01 resolves the ambiguity toward always surfacing the last known assignee rather than a false "Unassigned." | Shipped — Phase 14, deliberate behavior reversal confirmed via user checkpoint before closing. |
| Verify DB migrations against live schema state during milestone audit, not just the migration-history log | Migrations 086/087 were code-complete, tested, and file-present but silently never applied to production after Phase 12 closed — the phase-level verification (code + tests) couldn't catch this since it doesn't touch the live database. Would have shipped v1.2 with LOSTFOUND-01 still 500ing for real users if the milestone audit had only re-checked code/tests. | Shipped — v1.2's audit caught it, applied both migrations to production via Supabase MCP, and verified the resulting schema state directly (FK delete-rule, trigger event bitmask, backfill row-count) rather than trusting `list_migrations` alone. |
| Sequence bulk-archive before billing within v1.3 | Bulk-archive is fully verifiable on localhost; billing was assumed credential-blocked locally (later found incorrect — see Constraints correction). No shared router/table/migration between the two, so order was a risk-reduction choice, not a dependency. | Shipped — Phase 15 then Phase 16, zero file overlap confirmed by the milestone's integration check. |
| Model orthogonal work-order state as a separate `archived_at` flag, not a new `status` enum value | Collapsing operational state (completed/cancelled/etc.) and board-visibility into one enum conflates two independent axes; a flag keeps them orthogonal and makes "archived but still completed" unambiguous. | Shipped — Phase 15, migration 089. |
| Stripe Customer Portal for plan/payment changes, not a custom in-app picker | Building custom plan-change/payment UI adds PCI scope and can't be verified without live Stripe credentials at the time this was decided; the Portal covers proration, payment methods, and plan switching natively. | Shipped — Phase 16, `POST /billing/portal` wired to the existing endpoint; live round-trip confirmed to `billing.stripe.com` during verification. |
| `credit_ledger.is_finalized` stamp as the true-up idempotency mechanism, not Stripe's Idempotency-Key alone | Stripe's Idempotency-Key expires after 24h and cannot survive the monthly true-up cron re-firing on a later night if the first run silently failed; a persistent DB-level stamp survives indefinitely. | Shipped — Phase 16 (`true_up_tenant`), also fixed a real early-finalization bug the plan-checker caught before execution (cron firing on day 28 of a 30-day month would have permanently dropped 1-3 days of usage without a `require_period_ended` gate). |
| Continue applying migrations directly via Supabase MCP during milestone audits rather than treating "written but unapplied" as acceptable | The exact same deployment-gap pattern recurred 3 more times in v1.3 (migrations 089/090 caught during Phase 16's own verification, 091 caught during this milestone audit) after v1.2 first established the practice — the underlying "write now, deploy separately" convention keeps generating this class of gap every milestone. | Shipped for all 3 — but the recurrence suggests the convention itself, not just the audit safety net, may be worth revisiting in a future milestone. |
| Consolidate role-group constants into one `core/roles.py` module rather than merging every drifted definition to a single value | `MANAGER_ROLES` (leadership/compliance tier) and `PROGRAM_MANAGER_ROLES` (operational tier incl. engineer) serve genuinely different access tiers — collapsing them would either over- or under-grant access; `ALL_STAFF_ROLES` was dedup-only. | Shipped — Phase 19, each collision resolved as an explicit, confirmed product decision, not auto-merged. **Revisited during the milestone audit:** `chief_engineer` was excluded from `ALL_ROLES`/`ALL_STAFF_ROLES` based on a Phase 19 assumption ("retired by migration 064") that Phase 20's migration 092 invalidated one phase later — see the fixed-and-verified gap below. |
| Fix real cross-phase gaps found during milestone audit immediately, not defer (again) | Same precedent as v1.0/v1.1 (migration-079, bug-449, the AI-copilot guest-request gap) — a milestone shouldn't ship with a known broken role/dashboard combination. | Shipped — `core/roles.py`, `dashboard/page.tsx`, and three `reports.py` endpoints fixed and live-verified (seeded `chief_engineer` browser session, 0 console errors) same session, before archiving v1.4. |
| Escalate migrations to the orchestrator/team-lead rather than force-apply from a plan executor's sandboxed toolset | Established in Phase 6 (migration 085) and repeated for migrations 092/093/094 in Phases 20-21 — plan executors have no Supabase MCP access, and an unscoped `db push` is unsafe given this project's known pre-existing remote migration-history drift. | Shipped — consistent pattern across 4+ milestones now; worth eventually giving trusted executors scoped MCP access if the escalation volume keeps growing. |
| Zero new npm dependencies for the Expo 54→57 bump beyond what each hop's own SDK requires | Mirrors v1.1's "zero new deps" mobile constraint — the EAS pipeline is fragile, so scope any dependency change tightly to what the major-version bump itself forces (e.g. `@react-navigation/native` as an explicit direct dependency, required once Expo Router forked from it at SDK 56). | Shipped — 3 sequential single-major hops, each gated by `expo-doctor` + `npx jest` + type-check + a green EAS Android build, committed as a rollback boundary before the next hop began. |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-11 — milestone v1.5 (RBAC Enforcement Tooling) started.*

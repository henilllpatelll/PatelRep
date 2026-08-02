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

### Active

*Defining requirements for milestone v1.2 (see below).*

## Current Milestone: v1.2 Stabilization Pass

**Goal:** Fix a set of genuine bugs found by a fresh post-v1.1 audit (live web QA + static mobile code re-check) before building new capabilities — including one high-severity data-loss bug (Logbook entries silently vanishing due to a UTC/timezone mismatch).

**Target fixes:**
- Logbook `entry_date` computed off UTC instead of hotel-local timezone — entries written after ~6-7 PM Central vanish from the day staff wrote them, with no UI path to recover them
- Housekeeping "Auto-Assign with AI" 422s on a bad Supabase embed query (rule-based, not LLM-related) with zero user feedback
- Engineering "AI triage" 400s on a DB CHECK constraint violation, plus inconsistent AI Copilot error-handling reuse across its 3 entry points (chat page, housekeeping button, engineering button)
- Lost & Found hard-delete fails with an FK violation on any item with custody history — no way to correct a mistaken entry
- Housekeeping room-status display discards `room_status.assigned_to` whenever no `room_assignments` row exists for today (housekeeping.py:532), showing "Unassigned" for rooms that are actually assigned

**Explicitly deferred to a later milestone (found by the audit, not in v1.2 scope):**
- Whether supervisors should appear in the housekeeper assignment picker (unresolved product-intent conflict between two prior audits, not a code bug)
- UX rough edges: blank staff display names, duplicate/leftover shift templates in dropdowns, generic Opera error message, leaked internal formula string on Management ROI, Guest Request drawer missing status-advance actions, Room History not populating
- Capability gaps: self-serve billing management ("Coming soon"), stale/non-rolling billing period-usage display, bulk-archive for Engineering work orders, general test-data hygiene cleanup on the shared QA account

### Out of Scope

- Live-credential-dependent flows — no local AI provider, Stripe, Twilio, or OHIP credentials exist; v1.0/v1.1/v1.2 all ship with these paths verified via mocked/fixture-based tests and accepted as deferred for live validation. Still valid — no credentials added since.
- Vercel deployment repair — Railway is the sole production target; Vercel kept only as a secondary PR-preview surface, decision made 2026-07-26. Still valid.
- iOS EAS build pipeline (IOS-01) — Android-only mobile builds remain the shipped target; iOS is a separate future initiative, not blocking anything shipped so far.
- New user-facing features — v1.2 is a stabilization pass by explicit decision; a feature milestone follows once these bugs are closed.

## Context

The stack is FastAPI with direct Supabase SDK queries, Next.js 14/16 web, and Expo/React Native mobile (Android-only EAS builds). Tenant isolation is mandatory in every query and RLS is a second safety layer. Phase 1 established the reusable append-only `operational_audit_events` and `notification_deliveries` patterns, reused through Phases 2-4 rather than parallel mechanisms per domain. Mobile now has its own reactive theme/primitive system (Phase 7), fully adopted app-wide (Phases 8-9) with dark mode and WCAG AA contrast (Phase 10), zero new npm dependencies added by design given the mobile EAS pipeline's documented fragility. As of v1.1: ~105K+ LOC (Python + TypeScript, web/API baseline; mobile UI parity added ~12.5K lines across 103 files), 500 API tests passing, 1044+ commits since project start (833 at v1.0 + 211 across v1.1).

## Current State (as of v1.1, 2026-08-02)

Everything validated at v1.0 remains shipped and deployed. Mobile now has full UI parity with web's refreshed design system — reactive theme (light/dark/system), shared primitives, every screen migrated, full EN/ES i18n coverage enforced by an app-wide ESLint gate, and a green EAS Android production build. The v1.1 milestone audit found 2 cross-phase integration gaps (i18n gate coverage hole, one hardcoded dark-mode color) plus accumulated tech debt (a silently-swallowed FoundItemModal error, a missing i18n key, npm audit advisories) — all closed within the same milestone via Phase 11, not deferred. Remaining known items: 19 npm audit advisories in `apps/mobile` all requiring the out-of-scope `expo@57.0.9` major bump (documented, tracked in ROADMAP.md Backlog); CLAUDE.md's cron-mechanism doc-drift (still unfixed, opportunistic).

## Constraints

- **Security**: Every table is tenant-scoped in API queries and RLS; every mutation is gated with `require_role()` (or an equivalent inline role check — normalize this in a future pass, see Backlog).
- **Storage**: Attachments use the existing private-bucket, signed-URL pattern; public object URLs are prohibited.
- **Delivery**: No local AI, Stripe, Twilio, or OHIP credentials — no core path may depend on live calls to any of these for local dev/test; production has real credentials configured.
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
*Last updated: 2026-08-02 — milestone v1.2 (Stabilization Pass) started.*

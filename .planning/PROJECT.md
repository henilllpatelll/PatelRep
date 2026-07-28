# PatelRep

## What This Is

PatelRep is an AI staff copilot for 50–150 room Texas hotels. It gives housekeepers, engineers, supervisors, and GMs short, dependable web workflows for the work that must happen on the floor, while preserving defensible operational evidence.

## Core Value

Save a housekeeper or engineer time on the floor without weakening the hotel’s ability to prove what occurred.

## Requirements

### Validated

- ✓ Production trust and monitoring — Phases 0–1 closed 2026-07-19.
- ✓ Core engineering state, escalation, and append-only audit integrity — Phase 1 closed 2026-07-19.
- ✓ Recurring, evidence-backed PM and housekeeping programs, plus the full D-03 bilingual (EN/ES) floor contract across housekeeping, engineering/work-orders, tasks, and programs surfaces — Validated in Phase 4: Maintenance and housekeeping programs, closed 2026-07-24 (17/17 plans; gap-closure batch 04-09..04-17 widened the `i18next/no-literal-string` CI gate to the full locked scope after 04-08 shipped a narrowed version).
- ✓ Guest-service closure and measurable operational value (guest recovery workflows + management ROI reporting) — Validated in Phase 5: Guest recovery and management ROI, closed 2026-07-25 (12/12 plans; verified in code + human UAT; deployed live on Railway).
- ✓ Production-trust-grade AI copilot expansion (task/work-order/guest-request/assignment intents, ambiguity handling, SOP Q&A, credit fast-path) and Opera PMS integration, both RBAC/tenant-isolation/credit-accounting tested and Opera pilot-gated — Validated in Phase 6: PMS and AI expansion, closed 2026-07-28 (5/5 plans; UAT passed 0 issues; security verified 21/21 threats closed). Reframed mid-phase from the original roadmap's "greenfield AI/PMS expansion" premise to an audit-first hardening pass, since discuss-phase discovered the AI copilot expansion and much of the Opera integration were already shipped and live (commit `e4ac615a`, 2026-05-22) but untested and ungated.

### Active

*Defining requirements for milestone v1.1 (see below).*

## Current Milestone: v1.1 Mobile UI Parity

**Goal:** Bring the mobile app's visual and interaction design to parity with the web app's refreshed UI system (Waves 0-6, shipped 2026-07-27), starting with floor-role screens.

**Target features:**
- Shared React Native design-token file (colors/typography/spacing) matching web's warm paper/terracotta palette, dark mode, and semantic status families
- Shared RN primitive components mirroring web's Button/IconButton, Card, EmptyState/StateBlock, and Toast
- Floor-role screens (housekeeper, engineer — My Rooms, Room Board, Work Orders, Tasks, Inspect) migrated first
- Remaining screens (profile, supervisor, home dashboards) migrated after floor-role rollout

### Out of Scope

- Mobile changes (v1.0-era exclusion, no longer current) — v1.0 was web + API only; mobile work was parked for that milestone. Superseded in v1.1, which explicitly targets mobile UI parity. The EAS build issue, rooms-timezone bug, and i18n handoff were all separately resolved in June 2026, before v1.0 began.
- Live-credential-dependent flows — no local AI provider, Stripe, Twilio, or OHIP credentials exist; v1.0 shipped with these paths verified via mocked/fixture-based tests and accepted as deferred for live validation (Twilio SMS since Phase 5, LLM/OHIP round-trips since Phase 6).
- Vercel deployment repair — Railway is the sole production target; Vercel kept only as a secondary PR-preview surface, decision made 2026-07-26.

## Context

The stack is FastAPI with direct Supabase SDK queries and Next.js 14/16. Tenant isolation is mandatory in every query and RLS is a second safety layer. Phase 1 established the reusable append-only `operational_audit_events` and `notification_deliveries` patterns, reused through Phases 2-4 rather than parallel mechanisms per domain. As of v1.0: ~105K LOC (Python + TypeScript), 500 API tests passing, 829 commits since project start.

## Current State (as of v1.0, 2026-07-28)

Production trust, evidence/compliance platform, Texas safety, recurring bilingual maintenance/housekeeping programs, guest recovery + management ROI, and an audited/hardened AI copilot + Opera PMS integration are all shipped and deployed (API on Railway, web on Railway with a secondary Vercel PR-preview surface). Crons run in-process via APScheduler (confirmed healthy in production — 12/12 jobs "ok"), not GitHub Actions as CLAUDE.md currently documents (doc-drift to fix next milestone). The v1.0 cross-phase audit found and same-session-fixed one real gap: AI-copilot-created guest requests were bypassing the SLA/escalation/audit system Phase 5 built.

## Constraints

- **Security**: Every table is tenant-scoped in API queries and RLS; every mutation is gated with `require_role()` (or an equivalent inline role check — normalize this in a future pass, see Backlog).
- **Storage**: Attachments use the existing private-bucket, signed-URL pattern; public object URLs are prohibited.
- **Delivery**: No local AI, Stripe, Twilio, or OHIP credentials — no core path may depend on live calls to any of these for local dev/test; production has real credentials configured.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| One evidence platform | Training, safety, maintenance, SOP, and compliance must reuse the same evidence and audit contracts. | Shipped — Phase 2's `operational_audit_events` pattern reused through Phases 3–4 (safety, maintenance/housekeeping). |
| Five vertical deliverables | Build applicability, documents, evidence, competency, then exceptions in that order. | Shipped in that order across Phases 2–4. |
| Review before execution | This two-week phase requires plan review before implementation begins. | Applied — gsd-plan-checker gate used on all phases through 6. |
| Phase 6 reframed as audit-first, not greenfield | Discuss-phase discovered the AI copilot expansion + much of Opera integration were already implemented and live (commit `e4ac615a`) but untested/ungated — building "new" features on an unverified, unsafe foundation would compound risk. | Shipped — Phase 6 delivered as a verification/hardening pass (mirroring Phase 4's S0 audit-first slice); found and fixed 3 real bugs beyond what research anticipated (flat-cost credit billing, SOP double-logging, Opera webhook wrong-secret signature) plus 2 more during execution/verification (a second unaudited `/sop/query` billing gap, a misleading Opera UI connect form). New AI/PMS capabilities explicitly deferred to a future phase. |
| Opera pilot-gating via a single boolean column | `tenants.opera_pilot_enabled` vs. a richer `pilot_features` table — only one integration currently needs gating (YAGNI). | Shipped — matches the existing `is_active`-style boolean-flag idiom; migration 085. |
| Fix real cross-phase gaps found during milestone audit immediately, not defer | Consistent with every prior in-phase bug-fix precedent (migration-079, bug-449, Phase 6's own D-05) — a milestone shouldn't ship with a known silent failure in a shipped feature. | Shipped — AI-copilot guest-request escalation gap (found by the v1.0 cross-phase integration audit) fixed same session, `confirm_guest_requests` now mirrors the canonical `create_guest_request` contract. |
| Mobile UI parity built as shared primitives first, not screen-by-screen | Mirrors the same Wave-0-first approach that worked for the web refresh — avoids drift from 20+ screens each reinventing buttons/cards/empty-states in RN. | — Pending, v1.1 |
| Floor-role screens (housekeeper/engineer) prioritized over manager/settings for mobile UI parity | Mobile's entire user base is floor staff — no manager/settings screens exist on mobile today. | — Pending, v1.1 |

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
*Last updated: 2026-07-28 — milestone v1.1 "Mobile UI Parity" started.*

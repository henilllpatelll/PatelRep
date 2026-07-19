# PatelRep

## What This Is

PatelRep is an AI staff copilot for 50–150 room Texas hotels. It gives housekeepers, engineers, supervisors, and GMs short, dependable web workflows for the work that must happen on the floor, while preserving defensible operational evidence.

## Core Value

Save a housekeeper or engineer time on the floor without weakening the hotel’s ability to prove what occurred.

## Requirements

### Validated

- ✓ Production trust and monitoring — Phases 0–1 closed 2026-07-19.
- ✓ Core engineering state, escalation, and append-only audit integrity — Phase 1 closed 2026-07-19.

### Active

- [ ] Phase 2 evidence foundation: property applicability, controlled documents, evidence, competency, and exceptions.

### Out of Scope

- Mobile changes — Phase 2 is web + API only; mobile work is parked.
- AI-provider and Stripe-dependent workflows — local credentials are intentionally absent and Phase 2 must not rely on them.
- Vercel deployment repair — Railway is production; the stale Vercel project needs a later delete-or-auth decision.

## Context

The stack is FastAPI with direct Supabase SDK queries and Next.js 14. Tenant isolation is mandatory in every query and RLS is a second safety layer. Phase 1 established the reusable append-only `operational_audit_events` and `notification_deliveries` patterns; Phase 2 extends those rather than adding a parallel compliance mechanism.

## Constraints

- **Scope**: Web + API only — no `apps/mobile/` work in Phase 2.
- **Security**: Every table is tenant-scoped in API queries and RLS; every mutation is gated with `require_role()`.
- **Storage**: Attachments use the existing private-bucket, signed-URL pattern; public object URLs are prohibited.
- **Delivery**: No local AI or Stripe credentials — no Phase 2 core path may depend on either provider.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| One evidence platform | Training, safety, maintenance, SOP, and compliance must reuse the same evidence and audit contracts. | — Pending |
| Five vertical deliverables | Build applicability, documents, evidence, competency, then exceptions in that order. | — Pending |
| Review before execution | This two-week phase requires plan review before implementation begins. | — Pending |

---
*Last updated: 2026-07-19 after GSD bootstrap for Phase 2 planning.*

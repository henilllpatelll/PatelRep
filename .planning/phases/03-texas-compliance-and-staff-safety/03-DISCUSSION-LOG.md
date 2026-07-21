# Phase 3: Texas compliance and staff safety - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-21
**Phase:** 3-texas-compliance-and-staff-safety
**Areas discussed:** Slice order & webhook scope, Incident access & privacy, Training assignment automation, Bilingual floor scope

---

## Slice order & webhook scope

| Option | Description | Selected |
|--------|-------------|----------|
| 3A→3B→3C, webhook design-only | Training first (hardest Texas legal req), then incidents, then hazcom+drills; safety-device webhook designed as feature-flagged contract/stub, not wired live | ✓ |
| 3B first (incidents highest legal risk) | Lead with controlled incidents as biggest liability, then 3A, 3C | |
| Build webhook live this phase | Implement working feature-flagged /webhooks/ intake recording device panic events | |
| 3A+3B only, defer all of 3C | Ship training + incidents; move hazcom/drills/webhook to a later phase | |

**User's choice:** 3A→3B→3C, webhook design-only
**Notes:** Keeps the phase shippable; no device partner/hardware exists yet and live intake is not locally testable, so the webhook is a paper contract + stub mirroring the Opera feature-flag pattern.

---

## Incident access & privacy

| Option | Description | Selected |
|--------|-------------|----------|
| Anyone files, management views | Any authenticated staff files; full view restricted to gm/chief_engineer/housekeeping_supervisor; filer sees own | ✓ |
| Anyone files; GM-only for sensitive types | Anyone files; guest_injury/discrimination/privacy visible to GM only, rest to all management | |
| Management files & views only | Floor staff report verbally; supervisor/GM logs and views | |

**User's choice:** Anyone files, management views
**Notes:** Fast injury/exposure reporting prioritized; single management-view tier chosen over per-type branching for simpler, auditable RBAC.

---

## Training assignment automation

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-generate via cron | Cron creates new-hire + annual-recurrence assignments and queues reminders/escalations, reusing Phase 2 retraining RPC + notification_deliveries | ✓ |
| Manual GM assignment | GM assigns by hand; reminders still fire on due dates | |
| Hybrid: auto recurrence, manual new-hire | Cron handles recurrence; GM assigns new hires manually | |

**User's choice:** Auto-generate via cron
**Notes:** Directly satisfies the "overdue auto-reaches supervisor" exit criterion; endpoint uses the existing X-Cron-Secret + cron_health convention.

---

## Bilingual floor scope

| Option | Description | Selected |
|--------|-------------|----------|
| Staff-facing safety surfaces EN+ES; admin English | Introduce web i18n scoped to training ack, incident filing, safety-info retrieval, drill ack; GM admin stays English | ✓ |
| All Phase 3 surfaces EN+ES | Every screen including GM admin bilingual | |
| English only, defer i18n to Phase 4 | Ship English; do bilingual in Phase 4 | |

**User's choice:** Staff-facing safety surfaces EN+ES; admin English
**Notes:** Web has no existing i18n framework — this phase establishes it, scoped to safety actions only. General engineering-component i18n stays deferred to Phase 4.

---

## Claude's Discretion

- Exact route shapes, schema refinements on top of migration 070, per-mutation role sets, cron cadence, checklist storage shape, and component layout — from existing project patterns, holding the locked contracts.

## Deferred Ideas

- Live third-party staff-safety-device webhook intake (design only in Phase 3).
- General engineering-component web i18n — Phase 4 bilingual floor contract.
- AI expansion material — Phase 6, pilot-gated.
- Vercel remediation decision — not Phase 3; Railway remains production.
- EAS build, mobile i18n handoff, rooms debugging — parked; Phase 3 is web + API only.

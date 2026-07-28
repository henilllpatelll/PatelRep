# Phase 2: Evidence foundation - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Create the reusable web + API evidence foundation: property applicability, controlled documents, evidence records, staff acknowledgement/competency, and an exception engine with a GM dashboard and inspector-ready export. Do not implement Phase 3–6 programs, AI features, Stripe features, Vercel repair, or mobile work.

</domain>

<decisions>
## Implementation Decisions

### Delivery order
- **D-01:** Plan and execute the five deliverables in this order: property applicability; controlled documents; evidence records; staff acknowledgement/competency; exception engine, GM dashboard, and inspector-ready export.
- **D-02:** Build complete vertical web + API slices with focused tests; do not create tables or screens that are disconnected from operational workflows.

### Evidence and audit contracts
- **D-03:** Reuse Phase 1 `operational_audit_events` (migration 065) as the append-only history for Phase 2 material changes; corrections append events rather than rewriting controlled history.
- **D-04:** Reuse structured reason codes and `notification_deliveries` channel/status tracking (migration 067) for deferrals, reminders, and escalations; do not create parallel audit or notification mechanisms.
- **D-05:** Use the existing private Supabase bucket and signed-URL pattern from migration 058 and `routers/clean_sessions.py`; never expose public storage URLs.

### Scope and security
- **D-06:** Phase 2 modifies web and API only; `apps/mobile/` is out of scope.
- **D-07:** Every table and API query must be tenant-scoped, backed by RLS, and every mutation guarded with `require_role()`.
- **D-08:** Phase 2 must not require local AI-provider or Stripe credentials.

### Plan review gate
- **D-09:** Stop after planning and present the complete Phase 2 plan for user review before any execution begins.

### Claude's Discretion
- Select exact schema refinements, route shapes, roles per mutation, and component layout from existing project patterns, provided they preserve the locked contracts above.

</decisions>

<canonical_refs>
## Canonical References

### Product and phase scope
- `HOTEL_STANDARDS_EXECUTION_PLAN.md` §Phase 2 — source of scope, exit criteria, and definition of done.
- `.planning/STATE.md` — Phase 0 and Phase 1 closure evidence and current phase status.
- `.planning/ROADMAP.md` — GSD requirements, success criteria, and deferred backlog.

### Existing contracts to extend
- `supabase/migrations/065_work_order_transition_audit.sql` — append-only operational audit-event schema and mutation guard.
- `supabase/migrations/067_notification_delivery_history.sql` — notification channel and delivery-outcome history.
- `supabase/migrations/058_clean_photos_private.sql` — private storage bucket contract.
- `apps/api/routers/clean_sessions.py` — tenant-scoped private upload and one-hour signed-URL retrieval pattern.
- `supabase/migrations/069_evidence_foundation.sql` — existing Phase 2 foundation schema to validate and complete rather than replace.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `supabase/migrations/069_evidence_foundation.sql`: already defines property applicability, controlled documents, acknowledgements, evidence records, RLS, and the private `evidence-files` bucket.
- `apps/api/routers/clean_sessions.py`: validates upload content type/size, stores a tenant-prefixed object path, and returns a short-lived signed URL.

### Established Patterns
- API handlers use direct Supabase SDK calls and explicitly filter with `.eq("tenant_id", current_user.hotel_id)`.
- `require_role()` is the mutation gate and response bodies use `{ "data": ... }`.
- `operational_audit_events` is append-only; `notification_deliveries` preserves per-channel outcome history.

### Integration Points
- The evidence foundation will be consumed by SOP, inspection, staff, assets, rooms, tasks, and later incident workflows without creating a separate compliance silo.

</code_context>

<specifics>
## Specific Ideas

The GM’s one-screen outcome is the scope test: they can identify overdue/expired items, failures or missing evidence, unacknowledged requirements, record history, and produce an inspector or brand-review export.

</specifics>

<deferred>
## Deferred Ideas

- Web i18n for hardcoded-English engineering components — Phase 4 bilingual contract.
- AI expansion documentation in `.planning/ai-copilot-primary-interface.md` and `.planning/sop-voice-fastpath.md` — Phase 6, pilot-gated.
- Vercel remediation — make a one-time delete-project or repair-auth decision later; Railway remains production and its stale URL must not be touched now.
- EAS build, mobile i18n handoff, and rooms debugging — parked because Phase 2 is web + API only.

</deferred>

---

*Phase: 2-evidence-foundation*
*Context gathered: 2026-07-19*

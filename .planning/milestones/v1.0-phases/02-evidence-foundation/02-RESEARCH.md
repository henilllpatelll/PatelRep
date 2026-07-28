# Phase 2 Research — Evidence Foundation

## Current state

Migration `069_evidence_foundation.sql` and `apps/api/routers/evidence.py` provide a partial foundation: tenant-scoped applicability, documents, acknowledgements, evidence records, a private `evidence-files` bucket, a derived exception queue, reminders, and a read-only web dashboard. The focused suite currently has seven passing tests.

## Planning conclusions

- Extend the existing schema only with forward migrations; do not replace migration 069 or introduce a second evidence/audit/notification system.
- The physical column is `tenant_id`; tenant safety means `.eq("tenant_id", current_user.hotel_id)` plus RLS and same-tenant validation for every linked record.
- Copy the private upload and one-hour signed URL flow in `routers/clean_sessions.py`; never return a public storage URL.
- Existing gaps are applicability enforcement, document lifecycle/history, evidence read access, competency/retraining, idempotent escalation delivery, GM actions/export, and the required tenant/RBAC/browser tests.
- The stale Vercel configuration, AI expansion, Stripe/AI credentials, and all mobile work remain outside this phase.

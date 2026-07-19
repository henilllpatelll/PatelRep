# Phase 2 Requirements — Evidence Foundation

## Requirements

- **REQ-201**: A GM can configure the property’s facilities, services, and brand requirements so obligations are only assigned where applicable.
- **REQ-202**: Authorized staff can create, approve, version, supersede, review, expire, retain, and securely access controlled documents.
- **REQ-203**: Authorized staff can collect and retrieve tenant-isolated evidence records (file, photo, measurement, checklist result, signature, attestation, and external certificate) linked to the relevant operational entity.
- **REQ-204**: Staff can receive a document assignment, acknowledge it, complete optional competency verification, and be retrained when a controlled procedure changes.
- **REQ-205**: A GM can see missing, overdue, expired, failed, deferred, and unacknowledged exceptions; receive role-based reminder/escalation delivery history; and export an inspector-ready evidence packet.
- **REQ-206**: Phase 2 changes append `operational_audit_events` with structured reasons where appropriate, record notification delivery channels/outcomes, enforce RBAC, and filter every tenant query.
- **REQ-207**: The Phase 2 verification suite covers versioning/supersession, retention/authorization, tenant-isolated attachment access, reminder/escalation scheduling, and representative mixed-state exports.

## Deferred Backlog

- Web i18n for engineering’s hardcoded English copy — Phase 4 bilingual contract.
- AI expansion notes in `ai-copilot-primary-interface.md` and `sop-voice-fastpath.md` — Phase 6, pilot-gated.
- Vercel remnants — decide once whether to delete the unauthenticated broken project or repair its invalid CLI token and stale embedded API URL; Railway remains production.
- Mobile threads (EAS build, mobile i18n handoff, and rooms debug) — parked under Phase 2’s web-only scope.

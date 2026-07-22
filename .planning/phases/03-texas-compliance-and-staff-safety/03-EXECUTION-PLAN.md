# Phase 3 Execution Plan — Texas Compliance and Staff Safety

## Scope and sequencing

Build three vertical web/API slices in order. The Phase 3 base schema (`070`) remains the source for its core tables. Migration `080_safety_workflow_hardening.sql` fills only genuine gaps: the service-role-only incident-event RPC, training scheduling indexes, emergency contacts/assigned roles, and the safety-device intake contract registry.

## 3A — Human-trafficking training

- **API:** extend `routers/safety.py` with GM course management, employee-scoped training views, certificate ownership checks, signage attestations through `evidence_records`, CSV inspector export, and a management-only hotel status view.
- **Cron:** add `POST /internal/safety/training-assignments`, guarded by `X-Cron-Secret`; create idempotent new-hire and annual assignments, queue reminder/escalation entries in `notification_deliveries`, and record `cron_health`.
- **Web:** add GM compliance/export controls and the bilingual employee acknowledgement/certificate flow under `/safety`.
- **Tests:** recurrence/date boundary, employee-vs-management status visibility, certificate tenant ownership, assignment idempotency, reminder/escalation queueing, and export content.

## 3B — Controlled incidents

- **Migration/API:** append events exclusively through an atomic `SECURITY DEFINER` RPC. Revoke execution from `anon`, `authenticated`, and `PUBLIC`, then grant only `service_role`. Add filer-only detail access while retaining management list/detail access. Do not expose raw updates/deletes.
- **Web:** retain the fast bilingual filing flow and add management history/review/closure controls.
- **Tests:** any authenticated role may file, non-filer floor staff cannot view, filer and management can view, append events are RPC-backed, tenant isolation, and immutable base-row update/delete rejection.

## 3C — HazCom and emergency evidence

- **Migration/API:** tenant-scoped emergency contacts/roles and a feature-flagged device intake contract stub; safety info endpoint combines chemical SDS signed URLs, PPE and approved spill/exposure documents. Drill records include accountability and follow-up-evidence escalation.
- **Web:** bilingual SDS/PPE/procedure retrieval and drill acknowledgement; GM English controls for chemicals, contacts, drills, and emergency-plan distribution (using existing controlled documents/acknowledgements).
- **Tests:** SDS ownership/signed retrieval, drill acknowledgement, follow-up escalation queueing, emergency-plan acknowledgement reuse, and bilingual keys.

## Shared verification

- Apply migration `080` only after schema review, with RLS and the migration-079 grant discipline.
- Run focused API tests per slice, full API suite, web type-check/lint/floor-copy check/build, security scan, diff review, and the verification loop.
- Start the local API/web servers and browser-test public/authenticated paths only with an authorized fixture. Never create a permanent production incident unless an appropriate test tenant/fixture is available.
- Update `.planning/STATE.md`, `.planning/ROADMAP.md`, `.wolf/memory.md`, `.wolf/cerebrum.md`, and `.wolf/buglog.json` with actual results; commit only files produced by this phase.

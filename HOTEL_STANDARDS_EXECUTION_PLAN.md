# PatelRep Hotel Standards Execution Plan

**Created:** July 15, 2026  
**Planning horizon:** 12–16 weeks for two engineers; 16–22 weeks for one engineer  
**Primary objective:** Turn PatelRep from a broad operations dashboard into a dependable Texas hotel staff copilot with defensible evidence, strong floor usability, and measurable hotel ROI.

## Planning principles

1. Restore production trust before adding product breadth.
2. Build one reusable evidence layer instead of separate compliance silos.
3. Complete one vertical workflow at a time: database, API, web/mobile, audit event, notification, tests, and production verification.
4. Keep floor actions short. Evidence should be captured as part of the task, not through a separate administrative process.
5. Use property applicability so hotels only see requirements relevant to their facilities and services.
6. Do not add speculative AI features until the underlying operational data and outcomes are trustworthy.

## Phase map

| Phase | Duration | Outcome |
|---|---:|---|
| 0. Restore reality | 3–5 days | Production, login, monitoring, CI, and planning status are trustworthy |
| 1. Core operational integrity | 1–2 weeks | Engineering states, escalation, audit history, and occupancy language are consistent |
| 2. Evidence foundation | 2 weeks | Shared documents, acknowledgements, evidence, exceptions, and audit exports exist |
| 3. Texas compliance and staff safety | 2–3 weeks | Training, incidents, safety documents, and emergency evidence are operational |
| 4. Maintenance and housekeeping programs | 3 weeks | PM and housekeeping become complete recurring programs rather than isolated tasks |
| 5. Guest recovery and management ROI | 3 weeks | Guest requests close the loop and management can quantify operational value |
| 6. PMS and AI expansion | Pilot-gated | Integrations and AI expand only after the operating foundation proves itself |

---

## Phase 0 — Restore reality

**Goal:** Establish a production and planning baseline that can be trusted.

### Deliverables

- Restore the documented Railway web and API domains.
- Reproduce and fix the login hydration failure.
- Replace static operational-status copy with real service health.
- Add external monitoring for:
  - web availability;
  - API health;
  - database connectivity;
  - last successful cron execution;
  - notification delivery;
  - last successful PMS synchronization.
- Correct root build and verification documentation.
- Resolve the duplicate-lockfile/workspace ambiguity.
- Update `.planning/STATE.md` to reflect current deployment and language coverage honestly.
- Add the web production build and critical Playwright smoke tests to CI.
- Make the deployment pipeline fail when public smoke verification fails.

### Tests and verification

- Web TypeScript, ESLint, and production build.
- Complete API test suite.
- Login golden path for every role.
- External production probes for web, API, authentication, and one protected workflow.
- Forty-eight hours of continuous healthy monitoring before closing the phase.

### Exit criteria

- Public web and API services are consistently reachable.
- Every supported role can authenticate and reach its correct landing screen.
- Health status represents actual dependencies rather than static copy.
- A deployment cannot be reported as successful while public smoke tests fail.

---

## Phase 1 — Core operational integrity

**Goal:** Eliminate engineering contract drift and create a trustworthy history of important operational changes.

### Deliverables

#### Shared contracts

- Establish one canonical definition for work-order status, priority, and escalation.
- Generate or contract-test database, API, web, and mobile enums.
- Add `emergency` priority everywhere it is expected.
- Add `escalated` status to web/mobile types, filters, board lanes, reports, and notifications.

#### Work-order transitions

- Introduce an explicit transition service.
- Require structured reasons for hold, cancel, reopen, defer, and override.
- Ensure escalation always remains visible at the top of operational queues.
- Record who was notified, when, through which channel, and whether delivery succeeded.

#### Append-only audit events

- Add actor, hotel, role, old state, new state, reason, source, and timestamp.
- Cover work-order transitions, inspections, automated escalation, privileged changes, training, incidents, time edits, and later compliance evidence.
- Make corrections append new events rather than rewriting controlled history.

#### Honest occupancy language

- Rename manual check-in/check-out controls to occupancy-state language unless an authoritative PMS transaction confirms the action.
- Display source and synchronization status when occupancy came from an integration.

#### Inspection evidence quick win

- Connect the existing inspection-photo API and schema to the web inspection workflow.
- Allow templates to require a photo for failed or safety-critical items.

### Tests and verification

- Contract tests that fail when API and clients disagree.
- Transition-table unit tests for every role and state.
- Tenant-isolation and RBAC tests for every mutation.
- Playwright coverage for emergency creation, escalation visibility, hold/reopen, and inspection photo upload.
- Audit reconstruction test proving a complete event sequence can be reproduced.

### Exit criteria

- Emergency and escalated work cannot disappear from normal UI flows.
- Important state changes are reconstructable without relying on mutable current rows.
- Inspection photo evidence works end-to-end.
- Future enum drift breaks CI before deployment.

---

## Phase 2 — Evidence foundation

**Goal:** Build one thin evidence platform reused by training, safety, maintenance, SOP, and property compliance workflows.

### Deliverables

#### Property applicability

- Configure applicable facilities and services, such as pool, spa, elevator, boiler, breakfast, cooling tower, and brand requirements.
- Only assign obligations relevant to the property.

#### Controlled documents

- Document owner and approver.
- Version and approval state.
- Effective, review, and expiration dates.
- Applicability and retention class.
- Superseded-document behavior.

#### Evidence records

- File, photo, measurement, checklist result, signature, attestation, and external certificate support.
- Evidence actor and collection timestamp.
- Evidence linkage to staff, task, asset, room, inspection, incident, or SOP.

#### Staff acknowledgement and competency

- Assignment and due date.
- Read acknowledgement.
- Optional quiz or observed competency.
- Retraining trigger when a controlled procedure changes.

#### Exception engine

- Missing, overdue, expired, failed, deferred, and unacknowledged states.
- Role-based reminders and escalation.
- Notification delivery history.
- GM exception dashboard and inspector-ready export.

### Tests and verification

- Versioning and supersession tests.
- Retention and authorization tests.
- Tenant-isolated document and attachment access.
- Reminder/escalation scheduling tests.
- Export tests with a representative hotel and mixed compliance states.

### Exit criteria

A GM can answer from one screen:

- What is overdue or expired?
- What failed or lacks evidence?
- Who has not acknowledged the requirement?
- Who changed the record?
- Can the evidence be exported for an inspector or brand review?

---

## Phase 3 — Texas compliance and staff safety

**Goal:** Ship the highest-value Texas-specific compliance capability without creating a heavyweight administrative portal.

### 3A — Human-trafficking training

- Approved provider and course metadata.
- Required course assignment for covered employees.
- New-hire deadline and annual recurrence.
- Completion date and certificate upload.
- Signage verification checklist.
- Reminder and escalation workflow.
- Compliance status by employee and hotel.
- Inspector-ready export.

### 3B — Controlled incident records

- Separate controlled incidents from ordinary shift notes.
- Support guest injury, employee injury, chemical exposure, sharps/body-fluid, security, privacy, discrimination, police/fire, and life-safety impairment.
- Capture people involved, witnesses, location, attachments, immediate containment, follow-up tasks, manager review, and closure.
- Append corrections instead of overwriting history.
- Support retention policy and legal hold.

### 3C — Hazard communication and emergency evidence

- Chemical inventory and SDS linkage.
- PPE and secondary-label checks.
- Spill and exposure procedures.
- Safety training acknowledgement.
- Emergency plan distribution and acknowledgement.
- Emergency contacts and assigned employee roles.
- Drill records and staff-accountability evidence.
- Webhook intake strategy for third-party staff-safety devices; do not build hardware.

### Tests and verification

- Training due-date and annual recurrence tests.
- Certificate access and expiration tests.
- Controlled-incident append-only tests.
- Emergency drill and acknowledgement workflows.
- English and Spanish floor verification for all safety actions.

### Exit criteria

- Every employee has a clear compliant, due-soon, overdue, or not-applicable state.
- Controlled incidents cannot be silently deleted or rewritten.
- Staff can retrieve applicable safety information in English and Spanish.
- Missing follow-up evidence automatically reaches the correct supervisor.

---

## Phase 4 — Maintenance and housekeeping programs

**Goal:** Turn recurring operational work into complete, defensible programs.

### Engineering and preventive maintenance

- Immutable PM completion records.
- Versioned checklist results.
- Technician and verifier.
- Measurements and meter readings.
- Photos, labor, structured parts used, defects, and corrective work orders.
- Deferral reason and approval.
- Vendor and certificate attachments.
- Asset criticality, downtime, warranty, and cost context.
- Initial property-configurable templates for:
  - fire extinguishers;
  - emergency lighting;
  - fire alarm and sprinkler vendor checks;
  - elevator certificates;
  - pool checks where applicable;
  - domestic-water monitoring and flushing;
  - backflow and other configured obligations.

### Housekeeping program depth

- Deep-clean and rotational-cleaning schedules.
- Public-area locations and recurring cleaning frequencies.
- Inspection sampling rules by experience, room type, or risk.
- Inspection quality trends by item, room type, and employee.
- Stayover linen and change-frequency rules.
- Lightweight linen, chemical, and amenity par alerts.
- Property-configurable DND welfare timing and documented escalation policy.
- Privacy, guest-present entry, sharps, body-fluid, and spill-response checklist templates.

### Bilingual floor contract

- Translate every housekeeper, engineer, supervisor, safety, validation, notification, empty-state, and error string touched by this plan.
- Add CI detection for new hardcoded floor-facing copy.
- Verify critical workflows at phone width in English and Spanish.

### Tests and verification

- PM completion, deferral, failure, and corrective-work tests.
- Evidence-required checklist tests.
- Deep-clean recurrence and public-area assignment tests.
- DND policy threshold and duplicate-prevention tests.
- Bilingual Playwright coverage at desktop and 390px width.

### Exit criteria

- PM completion proves actual work rather than merely moving a due date.
- Failed checks produce containment and follow-up actions.
- Deep cleans and public-area schedules no longer require separate paper calendars.
- Critical floor workflows are genuinely usable in both supported languages.

---

## Phase 5 — Guest recovery and management ROI

**Goal:** Close the guest-service loop and prove the product's financial value.

### Guest request lifecycle

- Configurable SLA by category, priority, and guest impact.
- Acknowledged, dispatched, arrived, guest-contacted, resolved, verified, and reopened milestones.
- Guest contact preference and consent.
- Service-recovery action and compensation approval.
- Satisfaction capture and follow-up.

### Guest messaging MVP

- Inbound SMS creates or links a guest request.
- Authorized staff can reply from the request.
- Resolution confirmation reaches the guest.
- Opt-out and consent behavior is explicit.
- Message delivery and failure events are auditable.
- Guest messages are excluded from AI training or prompts unless explicitly permitted.

### Accessibility operations

- Specific accessible-room feature metadata.
- Accessibility-related guest request priority.
- Maintenance protection for accessible features.
- Clear staff guidance for matching requests to suitable rooms.

### Lost and found

- Tag or bag identifier.
- Storage location.
- Custody event history.
- Retention clock.
- Identity verification and release acknowledgement.
- Approved disposition workflow.

### Management reporting

- Minutes per occupied room and cleaning-time variance.
- Inspection pass-rate and repeat-defect trends.
- Work-order SLA and mean time to repair.
- Repeat asset and room failures.
- Room downtime and estimated revenue impact.
- PM completion and repeated-deferral rates.
- Training and compliance readiness.
- Guest-request response and verified-resolution rates.
- Seven-day rooms-to-clean and labor-hours projection.

### Tests and verification

- End-to-end guest message to request to verified resolution.
- Consent, opt-out, delivery failure, and tenant-isolation tests.
- Accessible-feature and priority tests.
- Lost-and-found custody reconstruction.
- Metric reconciliation against known fixture data.

### Exit criteria

- Guest requests can enter, progress, resolve, and receive confirmation without the front desk serving as a human API.
- Management can quantify time saved, quality improvement, response performance, and downtime.
- Reports emphasize exceptions and trends rather than totals alone.

---

## Phase 6 — PMS and AI expansion

**Gate:** Begin only after at least two pilot hotels successfully use Phases 0–5.

### Deliverables

- Harden live OHIP two-way synchronization.
- Display source-of-truth and synchronization conflicts clearly.
- Abstract the integration boundary before adding another PMS.
- Choose the next PMS from signed-customer demand.
- Convert predictions into approval-based closed loops:
  - prediction;
  - supporting evidence and confidence;
  - suggested action;
  - authorized execution;
  - outcome capture;
  - feedback measurement.
- Track AI acceptance, override, false-positive, and outcome rates.
- Centralize model-routing configuration.
- Revisit AI credit pricing using actual pilot behavior.
- Prevent AI from clearing safety/compliance records or completing controlled work without an authorized person.

### Exit criteria

- Integration conflicts are visible and recoverable.
- AI recommendations have evidence, confidence, human authorization, and measurable outcomes.
- New integrations and AI features are justified by pilot demand and retention data.

---

## Explicitly deferred

- Full PMS replacement.
- Payroll or full time-and-attendance.
- Key encoding.
- Revenue management.
- General accounting.
- Staff-safety hardware.
- Building, fire, or pool control systems.
- Full warehouse or parts ERP.
- A second PMS without signed-customer demand.
- Additional speculative AI features before operational outcomes are measurable.

## Definition of done for every phase

A phase is complete only when each delivered workflow includes:

1. Backward-compatible migration and rollback strategy.
2. Tenant-scoped API and RBAC enforcement.
3. Web and mobile workflow where applicable.
4. Focused unit and integration tests written first when practical.
5. English and Spanish copy for floor-facing behavior.
6. Audit event and evidence behavior.
7. Error, offline, and notification handling.
8. Desktop and 390px browser verification.
9. Production smoke verification.
10. A metric showing saved staff time, reduced risk, improved service, or protected revenue.

Tables and screens alone do not complete a phase. The hotel must be able to perform the procedure, failures must escalate correctly, and management must be able to prove what occurred.

## Recommended delivery order

> **Production trust → operational integrity → reusable evidence → Texas compliance → complete maintenance and housekeeping programs → guest and ROI loop → PMS and AI expansion.**


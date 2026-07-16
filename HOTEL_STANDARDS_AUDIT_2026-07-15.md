# PatelRep Web App vs. Current Hotel Procedures and Standards

**Brutal operational, safety, compliance, and product audit**  
**Audit date:** July 15, 2026  
**Primary market evaluated:** 50–150 room Texas hotels  
**Repository:** PatelRep current working tree  

> This is a product and operational-readiness assessment, not legal advice. Brand standards, municipal fire codes, local pool rules, insurer requirements, franchise requirements, and property-specific risk assessments may impose additional obligations.

## Executive verdict

**Overall readiness score: 42/100.**

PatelRep has the beginnings of a genuinely useful hotel operations product. The housekeeping board, room assignments, cleaning sessions, item-level inspections, re-clean loop, work orders, photos, guest requests, task SLAs, lost-and-found workflow, and tenant/security foundation are more substantive than a typical dashboard prototype.

But the product is not presently ready to be trusted as the operating layer for a paying Texas hotel.

The blunt reasons are:

1. **The documented production web and API endpoints both returned Railway 404 pages during this audit.** A product that cannot be reached has zero operational value, regardless of code quality.
2. **The locally rendered login claimed “status: operational” while its controls remained disabled in browser verification.** Static trust language is contradicting observable reality.
3. **PatelRep models activity much better than it models evidence.** It can say a PM was completed, but cannot prove who performed which checks, with what readings, photos, exceptions, or corrective work. It can store SOP PDFs, but cannot prove that an employee received required training, acknowledged a procedure, or held a current certificate.
4. **Safety and regulatory workflows are largely absent.** No implemented evidence was found for Texas human-trafficking training records, hazard communication/SDS control, emergency action plans and drills, incident reporting, bloodborne/sharps procedures, water-management monitoring, pool logs, life-safety inspection evidence, or accessible-room operational controls.
5. **The room and engineering state models contain dangerous mismatches.** OOO and OOS are collapsed, “emergency” priority exists in backend SLA math but not in the web/API filters, and auto-escalated work orders are not represented by the primary web type or filter contract.
6. **The Spanish experience is not credible.** Only 5 of 94 TSX files reference the translation mechanism. Most floor-facing workflows remain hardcoded in English. A language toggle is not bilingual support.
7. **The product risks pretending to be a PMS where it is only changing room state.** “Check in” and “check out” actions do not represent identity, payment, key, folio, reservation, consent, accessible-room, or registration-card procedures. Those labels create unsafe operational ambiguity unless OPERA is authoritative and the boundary is explicit.

The most accurate product description today is:

> **A promising housekeeping, task, and maintenance coordination prototype with good technical foundations—but not yet a reliable hotel operations system, compliance system, or production service.**

## Scorecard

| Area | Grade | Assessment |
|---|---:|---|
| Production availability | **F** | Both documented public endpoints returned Railway 404; Railway CLI credentials were expired, blocking deeper deployment diagnosis. |
| Housekeeping execution | **B** | Strong board, assignments, timing, room history, inspections, re-clean, DND welfare, and late-checkout visibility. |
| Housekeeping safety and sanitation evidence | **D** | General workflows exist, but chemical, PPE, blood/sharps, cross-contamination, incident, and sanitation evidence are not operationalized. |
| Reactive engineering | **B-** | Work orders, assignment, photos, parts, labor, SLA timing, comments, and predictions are useful; state/priority inconsistencies weaken reliability. |
| Preventive and life-safety maintenance | **D-** | “Complete PM” advances a date. It is not a defensible PM completion record. |
| Front desk/service recovery overlay | **C+** | Guest requests, room state, arrivals/departures, DND, and late checkout are useful; request SLAs and recovery controls are shallow. |
| PMS/front-office procedure | **D** | Manual status changes are presented too much like check-in/out; critical PMS procedures are intentionally or actually absent. |
| Training and workforce compliance | **F** | No training registry, certificate retention, acknowledgements, qualification gates, or drill records. |
| SOP and knowledge management | **B-** as knowledge; **D** as compliance | Upload, search, AI Q&A, and suggested tasks are valuable. Version approval, effective dates, attestations, and training evidence are missing. |
| Auditability and records | **D+** | Room history is solid; PM, work-order changes, logbook edits/deletes, and other safety records are not consistently immutable. |
| Accessibility and accessible-room operations | **D-** | No visible operational model for accessible features, room blocking, maintenance protection, or accessibility-specific tasking. |
| Spanish/floor usability | **D-** | Mobile-oriented intent is good, but translation coverage is about 5% of TSX files by direct mechanism usage. |
| Security and tenant isolation | **B-** | Tenant scoping, RLS, RBAC, upload controls, secret handling, and tests are a strong foundation; governance and audit evidence lag. |
| Technical build quality | **B** | Build, TypeScript, ESLint, and 225 API tests passed; canary framework use, duplicate lockfiles, stale commands, and deployment drift remain risks. |
| Reporting and management control | **C** | Operational summaries exist, but compliance, incident, training, defect, OOO-reason, and lifecycle reporting are absent. |

## What was evaluated

This audit used four evidence classes:

- **Current source evidence:** all current web routes, typed API clients, relevant FastAPI routers, migrations, state transitions, and tests.
- **Current runtime evidence:** public production URLs and the locally running login surface.
- **Current external standards:** official Texas, federal, CDC, DOJ, OSHA, W3C, PCI SSC, AHLA, and Oracle OPERA material available as of the audit date.
- **Historical evidence:** the existing June 30 `WORKFLOW_AUDIT.md`, used only to identify areas to recheck. Several findings in that file have since been fixed and are not repeated as current defects.

Limitations:

- Authenticated production workflows could not be retested because the public web and API endpoints were unavailable.
- The Railway CLI session was unauthorized due to an expired/revoked OAuth grant, so the exact deployment misconfiguration was not established.
- The local login page rendered, but its hydration-dependent controls remained disabled in the browser session; this prevented a fresh authenticated local walkthrough.
- Source presence shows implementation, not correct daily use by hotel staff. No operator interviews, shadow shifts, brand audits, or property inspections were performed.
- Some standards are risk-, facility-, brand-, or locally adopted-code dependent. The report identifies product readiness gaps, not a final legal applicability opinion for a particular property.

## Critical findings

### 1. Production is down, and the UI makes an unearned reliability claim

During this audit:

- [Documented production web](https://patelrep-production.up.railway.app/) returned a Railway 404 page.
- [Documented production API health endpoint](https://patelrep-web-production.up.railway.app/health) returned a Railway 404 page.
- Railway CLI status checks failed with `invalid_grant` / `Unauthorized`, so service/domain state could not be inspected from the current authenticated context.
- The local `/login` page rendered and had no browser console errors, but the email, password, tabs, submit, reset, and magic-link controls remained disabled because the client hydration flag never became active in the observed browser session.
- The same login page displayed `v2.1.0 · status: operational`.

That footer is more than cosmetic. In hospitality, a false green status teaches users to distrust every other status in the system. Remove it until status comes from a real health signal that checks web, API, database, background jobs, notification delivery, and last successful sync.

**Required standard:** no feature work should outrank restoring availability, adding external uptime monitoring, proving a clean deployment from the documented command path, and making health language data-driven.

### 2. OOO and OOS are collapsed even though they have different inventory consequences

The web defines both `OUT_OF_ORDER` and `OUT_OF_SERVICE`, but labels both “OOO/OOS.” The API status request accepts only `OOO`, and the transition service routes multiple room states into that one value. There is no visible reason code, planned return date/time, service restriction type, inventory consequence, approving role, linked work order requirement, or clearance record.

That is operationally unsafe. Current OPERA Cloud documentation distinguishes the two: OOO removes a room from inventory, while OOS may leave it sellable; OPERA also supports reasons, return timing, and related room-management controls. See [Oracle OPERA Cloud Room Management controls](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.4/ocsuh/c_opera_controls_room_management.htm).

**Consequence:** a leaking room, cosmetic defect, fire/life-safety issue, bedbug concern, HVAC failure, or accessible-feature failure can all be flattened into the same status. Staff cannot tell whether the room must be removed from sellable inventory, who authorized it, or what evidence permits it to return.

**Fix:** introduce an append-only room-restriction record with:

- `restriction_type`: OOO or OOS;
- standardized reason plus free-text detail;
- inventory impact;
- start and expected return timestamps;
- created/approved/cleared by;
- linked work order, incident, inspection, and photos;
- required clearance checklist;
- previous and return room status;
- OPERA sync state and conflict handling.

### 3. Engineering escalation has a contract hole

The backend defines work-order SLAs for `emergency`, `urgent`, `normal`, and `low`. The web work-order type and API list filter accept only `urgent`, `normal`, and `low`. Separately, the escalation cron can change work orders to `escalated`, and the migration permits that state, but the primary web type and backend list filter omit it.

This creates two high-risk outcomes:

- Staff cannot originate or consistently filter the fastest SLA tier.
- A cron-escalated work order may fall outside normal UI assumptions and filters exactly when it most needs visibility.

**Fix:** use one shared state/priority contract, add migration/API/web contract tests, and explicitly render emergency and escalated work in the highest-visibility board lane. Every automated escalation should create an immutable event and identify who was notified, by which channel, when, and whether delivery succeeded.

### 4. Preventive maintenance is a recurrence button, not a maintenance program

The PM schedule stores fields such as interval, instructions, estimated minutes, last completion, and next due date. The complete endpoint updates `last_completed_at` and calculates `next_due_at`.

It does not create a completion record containing:

- performer and verifier;
- checklist item results;
- measurements or meter readings;
- before/after photos;
- parts and labor;
- failed observations;
- lockout/tagout or safety confirmation where applicable;
- certificate/vendor document;
- linked corrective work order;
- asset downtime;
- exception/deferral approval;
- signature or attestation.

Calling this PM completion is too generous. It proves that a button was pressed, not that equipment was maintained. For HVAC, elevators, fire/life-safety systems, pool equipment, domestic water, emergency power, accessible features, and other critical assets, that difference is enormous.

**Fix:** add immutable `pm_completions` and template/versioned checklist results. Never advance the next due date without a completion event or an explicitly authorized deferral.

### 5. The product has no credible compliance-evidence layer

The sharpest comparison is this:

- PatelRep can predict room readiness and asset failure.
- PatelRep cannot show that each hotel employee completed Texas-mandated human-trafficking training and retain the certificate.
- PatelRep can answer questions over SOP PDFs.
- PatelRep cannot prove which version was approved, effective, read, trained, or acknowledged.
- PatelRep can time a room clean.
- PatelRep cannot document a chemical exposure, sharps discovery, slip, injury, emergency drill, water-control reading, or pool exception.

For a Texas hotel with 10 or more rooms, the Attorney General describes annual human-trafficking training, training for new employees within 90 days, approved-course requirements, and employee certificate retention/inspection expectations. See [Texas Attorney General commercial-lodging training standards](https://www.texasattorneygeneral.gov/human-trafficking-section/human-trafficking-training-and-signage/commercial-lodging-training-resources/available-training/application-process/training-standards).

This is not an optional “enterprise feature” for the stated market. It is closer to table stakes.

**Fix:** build a thin compliance-evidence layer on top of current staff, SOP, asset, inspection, task, and document entities. Do not create a bloated separate portal. A GM should be able to answer “what is expired, missing, failed, or unacknowledged?” in one screen, and a floor employee should complete evidence in seconds inside the existing task.

### 6. Spanish support is mostly a visual promise

Only **5 of 94 TSX files** reference `useTranslation` or a direct translation call. Most important workflows contain hardcoded English copy: housekeeping, inspections, guest requests, tasks, lost and found, logbook, engineering, scheduling, staff, reports, settings, and SOP interactions.

For a floor-first Texas hotel product, partial translation is not a polish defect. It is a safety, training, adoption, and response-time defect. OSHA’s hazardous-chemical guidance stresses employee information and training, including understandable hazard communication; see [OSHA hazardous chemicals and housekeeping](https://www.osha.gov/etools/hospitals/housekeeping/hazardous-chemicals).

**Fix:** either remove the language selector until coverage is honest or make every staff-facing string translatable, including validation, notifications, empty states, offline/errors, AI responses, push messages, checklist content, and uploaded SOP metadata. Add a CI rule that rejects new hardcoded user-facing strings on floor workflows.

## Domain-by-domain assessment

### Housekeeping: the strongest part of the product

#### What is good

Current implementation supports:

- daily room board and assignments;
- AI assignment suggestions;
- checkout/stayover/pickup room state handling;
- cleaning-session timing and housekeeper/room-type averages;
- mark stripped and ready-for-inspection actions;
- item-level pass/fail/not-applicable inspection results;
- required items and conditional outcomes;
- failed-inspection re-clean workflow;
- reassignment after inspection failure;
- room notes and status history;
- late-checkout time visibility and approval/denial;
- DND welfare action;
- manual checkout undo and room-status undo;
- arrivals/departures visibility;
- Realtime support on the intended operational surface.

This aligns well with current OPERA-style operating patterns around task sheets, assignments, workload credits, room instructions, mobile status updates, inspections, progress, and change tracking. Relevant benchmarks include [OPERA task sheets](https://docs.oracle.com/en/industries/hospitality/opera-cloud/23.5/ocsuh/c_tasksheets_task_sheets.htm), [task-sheet generation and travel credits](https://docs.oracle.com/en/industries/hospitality/opera-cloud/22.3/ocsuh/t_tasksheets_generating_task_sheets.htm), and [housekeeping reports](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.5/ocsuh/c_reports_housekeeping.htm).

#### What is weak or missing

1. **Inspection photo evidence exists in the database/API but not the web workflow.** The schema includes `inspection_results.photo_url` and the API has an inspection-photo upload endpoint. No corresponding typed web client method or inspection UI control was found. The backend has evidence capability that the floor cannot use.
2. **No sanitation-control evidence.** AHLA’s current Safe Stay guidance covers cross-contamination prevention, linen handling, PPE/training, high-touch surfaces, chemical-label compliance, and ventilation/air-quality practices. PatelRep has generic checklists, but no structured controls, exceptions, chemical references, or audit reports tied to those practices. See [AHLA Safe Stay Guidelines, April 2025 update](https://www.ahla.com/sites/default/files/2025-11/2026_SafeStayGuidelines_AHLA.pdf).
3. **No sharps/blood/body-fluid incident workflow.** OSHA directs employers to assess hotel housekeeping and laundry tasks for occupational exposure; see [OSHA hotel housekeeping bloodborne-pathogen interpretation](https://www.osha.gov/laws-regs/standardinterpretations/1992-08-07-1).
4. **No slip/spill safety action.** OSHA identifies wet floors and immediate spill cleanup as housekeeping hazards and controls; see [OSHA housekeeping slips, trips, and falls](https://www.osha.gov/etools/hospitals/housekeeping/slips-trips-falls).
5. **No ergonomic safeguards or workload risk signals.** Cleaning speed is optimized, but there is no mechanism for mattress-lift assistance, heavy-room flags, cart risk, rotation, pain/injury reporting, or reasonable workload controls. See [OSHA housekeeping ergonomic risks](https://www.osha.gov/etools/hospitals/housekeeping/work-related-musculoskeletal-disorders).
6. **No linen/change-frequency procedure control.** There are no property/brand rules for stayover linen frequency, guest opt-out, eco program, exceptions, or inspection linkage.
7. **No privacy/safety room-entry protocol evidence.** DND welfare is a good start, but the broader workflow lacks guest-present entry, double-lock/privacy indicator, suspicious conditions, prohibited photography, and escalation instructions.

#### Verdict

Housekeeping execution is strong enough to pilot after availability is restored. Housekeeping safety and defensible inspection evidence are not.

### Engineering and maintenance

#### What is good

- Work orders include room/asset context, priority, assignment, claim, status, labor hours, parts, comments, and completion.
- Before, progress, and after photos are supported.
- Assets include manufacturer, model, serial, warranty, purchase, lifespan, and cost fields.
- PM schedules and due dates exist.
- Failure predictions can be acknowledged or converted to work orders.
- Reports include response, repair/resolution time, SLA performance, breaches, categories, and priorities.
- Escalation logic attempts multi-tier notification and eventual auto-escalation.

#### What is weak or missing

- The emergency/escalated contract mismatch described above is launch-blocking.
- Work-order status can be patched without a formal transition state machine comparable to the room-state service.
- Status changes do not consistently create immutable system audit events.
- Reopen, on-hold, cancel, and deferral reasons are not first-class and evidence-rich.
- PM has no completion history.
- No meter-based PM, condition-based thresholds, regulatory interval templates, vendor qualification, certificate storage, recall tracking, warranty-claim workflow, or asset criticality.
- No life-safety category with stricter state control and verification.
- No linkage between a failed housekeeping inspection, OOO/OOS restriction, root cause, engineering repair, and return-to-inventory clearance.
- No property utility/water/pool monitoring despite hotel-specific exposure.

CDC advises that most hotels need an industry-standard water-management program and highlights low-flow/empty rooms, showers, hot tubs, cooling towers, and other building-water risks. A WMP requires control limits, monitoring, and corrective action—not a generic work order. See [CDC considerations for hotel owners and managers](https://www.cdc.gov/control-legionella/php/hospitality/considerations-for-hotel-owners-and-managers.html) and [CDC potable-water controls](https://www.cdc.gov/control-legionella/php/toolkit/potable-water-systems-module.html).

Texas’s current public pool/spa rules are in 25 TAC Chapter 265, Subchapter L, effective April 26, 2024. Pool/spa properties need applicable operational checks, exceptions, closures, and evidence; see [Texas DSHS public swimming pool and spa rules](https://www.dshs.texas.gov/public-swimming-pools-spas/laws-rules-public-swimming-pools-spas).

#### Verdict

Reactive maintenance is useful. Preventive, regulatory, and life-safety maintenance is mostly a shell.

### Front desk and guest service

#### What is good

- Arrivals and departures are now represented.
- Late checkout can be reviewed with a confirmed time.
- DND welfare escalation exists.
- Guest requests create linked tasks and can be assigned, escalated, and resolved.
- Room selection exists for work orders.
- Lost and found captures description, location, photo, room, finder, claimant details, and disposition status.

#### What is weak or missing

1. **Guest-request SLA is hardcoded to 240 minutes.** A crib, extra towel, noise complaint, lockout, no hot water, accessibility failure, smoke smell, and safety concern should not share one response model.
2. **No acknowledgement and arrival milestones.** Open/in-progress/resolved is too coarse to distinguish accepted, dispatched, staff arrived, guest contacted, resolved, verified, or reopened.
3. **No service-recovery authority.** There is no compensation type/value, manager approval, guest-contact preference, recovery promise, follow-up, or satisfaction capture workflow, even though a satisfaction field exists in the schema.
4. **Lost-and-found chain of custody is weak.** No bag/tag ID, storage bin, event ledger, release signature, identity verification, witness, disposition approval, aging policy, or immutable custody history.
5. **Manual check-in/out is mislabeled.** Updating room occupancy is not a full check-in or checkout. PatelRep should say “mark occupied/vacant” unless OPERA confirms the PMS transaction and PatelRep displays authoritative sync state.
6. **Accessible-room operational information is absent.** DOJ rules require lodging reservation services to identify accessible features with enough detail for guests to assess suitability and to block/guarantee accessible rooms under applicable conditions. See [DOJ ADA Title III lodging reservation requirements](https://www.ada.gov/law-and-regs/regulations/title-iii-regulations/).

#### Verdict

PatelRep can be a strong service-execution overlay. It should not imply that it replaces front-office/PMS procedure.

### Tasks, scheduling, and labor records

#### What is good

- Tasks have assignees, due times, SLA fields, comments, and escalation levels.
- Scheduling has shifts, assignments, today’s roster, and clock-in/out.
- Role and department controls exist.

#### What is weak or missing

- No availability, PTO, shift-swap approval, break attestation, missed-punch workflow, manager edit reason, employee acknowledgement, overtime alert, minor restrictions, qualification gate, or occupancy/labor-demand forecast.
- A schedule is not a time record. The U.S. Department of Labor requires complete and accurate actual-hours records for covered workers and retention of payroll/time-computation records. See [DOL FLSA Fact Sheet #21](https://www.dol.gov/agencies/whd/fact-sheets/21-flsa-recordkeeping?lang=en).
- No immutable edit history was found for time records.
- No safety/training qualification prevents assignment of an untrained employee to a task.

#### Verdict

Use scheduling as coordination until payroll-grade controls, approvals, retention, and exports are explicitly built and tested. Do not market it as compliant timekeeping yet.

### SOP library and AI copilot

#### What is good

- SOP PDF upload and category organization.
- Search/indexing and AI Q&A over documents.
- Source references and suggested task creation.
- AI credit accounting architecture aims to use actual token usage.

#### What is weak or missing

- No document owner, approver, revision, superseded status, effective date, expiry/review date, applicability, or controlled-copy model.
- No employee acknowledgement, quiz, observed competency, retraining trigger, or certificate.
- No clear warning when AI answers from an obsolete, draft, conflicting, or property-inapplicable SOP.
- No answer-level approval/escalation for life-safety, chemical, guest privacy, discrimination, or legal topics.
- AI can generate tasks, but there is no strong policy engine preventing unsafe procedural invention.

#### Verdict

This is a useful knowledge assistant. It is not controlled-document management or a training system. AI should retrieve approved procedure, not become the procedure.

### Logbook and shift handoff

#### What is good

- Shift entries and AI summaries support handoff.
- Entries are role/tenant scoped.
- Optional expiry can reduce stale operational clutter.

#### What is dangerous

- Authors and privileged users can edit or hard-delete entries.
- Expired entries may be hard-deleted.
- No acknowledgement/read receipt, manager-on-duty sign-off, correction history, legal hold, incident classification, or immutable revision ledger was found.

A casual handoff note can be mutable. A safety incident, threat, guest injury, discrimination complaint, police contact, key/security event, or life-safety impairment should never share that record policy.

**Fix:** split “ephemeral operational note” from “controlled incident/event record.” Corrections to controlled records should append, not overwrite.

### Reports

Current reports cover room/task/maintenance/staff/AI summaries, but management cannot yet answer:

- Which employees have missing or expired required training?
- Which controlled SOPs are overdue for review or unacknowledged?
- Which OOO/OOS rooms lack a reason, return time, work order, or clearance?
- Which PMs were completed without evidence or deferred repeatedly?
- Which inspection items fail most often, by room type, asset, floor, or attendant?
- Which incidents, injuries, chemical exposures, security events, or accessible-feature failures remain open?
- Which pools/water systems/life-safety assets missed a check?
- Which lost-and-found items are approaching disposition, and is chain of custody complete?
- Which time records were changed, by whom, and why?

Without exception reporting, a dashboard can make management feel informed while systematically hiding the most important omissions.

## Standards and procedure gap analysis

### Texas lodging sanitation

Texas DSHS identifies Health and Safety Code Chapter 341 and related public-health sanitation authority for hotels, motels, inns, and similar lodging. See [Texas DSHS lodging sanitation laws and rules](https://www.dshs.texas.gov/public-health-sanitation-program/laws-rules-public-health-sanitation-program).

PatelRep does not need to encode every statute, but it needs a property-configurable compliance checklist/evidence model. Generic tasks and SOP PDFs do not provide due control, exception escalation, retention, or audit export.

### Human-trafficking prevention

**Current gap: severe.** No employee course assignment, annual due date, 90-day new-hire deadline, provider/course ID, certificate, retention, signage check, reporting acknowledgement, or inspection export was found.

This should be one of the first Texas-market features, not a future add-on.

### Hazard communication and chemical safety

OSHA describes written hazard communication, a hazardous-chemical list, labels, safety data sheets, and employee information/training as key controls. PatelRep currently has SOP storage but no chemical inventory/SDS linkage, secondary-container label check, PPE matrix, spill/exposure workflow, or training evidence. See [OSHA hazardous chemicals](https://www.osha.gov/etools/hospitals/housekeeping/hazardous-chemicals).

### Emergency planning and fire/life safety

OSHA’s Emergency Action Plan rule covers reporting procedures, evacuation, critical operations, accounting for employees, rescue/medical duties, contacts, alarms, and employee review/training. See [29 CFR 1910.38](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.38).

The 2024 International Fire Code is a useful current model baseline for hotel/motel emergency instructions, alarm/notification duties, and evacuation information, but local adoption and amendments must be verified. See [2024 IFC emergency planning and preparedness](https://codes.iccsafe.org/content/IFC2024P1/chapter-4-emergency-planning-and-preparedness).

PatelRep has no visible EAP distribution, staff accountability, drill, impairment, evacuation-assistance, emergency contact, or life-safety inspection evidence. It should not attempt to replace fire systems; it should make required human actions and evidence hard to miss.

### Water management and pools

**Current gap: severe for applicable properties.** No monitoring readings, control limits, exception actions, flushing, closure, supervisor verification, or environmental test attachments were found.

### Accessibility

Two different accessibility responsibilities are relevant:

- **Product accessibility:** W3C recommends WCAG 2.2 as the current web accessibility target. See [WCAG 2.2](https://www.w3.org/TR/WCAG22/). A full automated and manual keyboard/screen-reader audit was not completed because the current authenticated runtime was unavailable.
- **Hotel operational accessibility:** accessible guestroom features, room blocking, maintenance of accessible elements, guest requests, evacuation assistance, and service delivery need first-class data and workflows.

The app’s room model should identify features, not merely label a room “accessible.” An accessible shower, roll-in configuration, communication features, bed configuration, route, and other details matter to the guest and to room assignment.

### Payment security and privacy

Using Stripe is the right architectural direction, but it does not by itself prove PCI compliance. PCI SSC identifies PCI DSS v4.0.1 as the current limited revision and notes that future-dated v4 requirements became effective March 31, 2025. See [PCI SSC’s PCI DSS v4.0.1 publication](https://blog.pcisecuritystandards.org/just-published-pci-dss-v4-0-1) and [PCI SSC document library](https://www.pcisecuritystandards.org/document_library/).

PatelRep should explicitly document:

- that cardholder data never enters PatelRep fields, logs, attachments, or AI prompts;
- the Stripe integration and SAQ responsibility boundary;
- retention/deletion rules for guest and staff data;
- privacy-request and legal-hold handling;
- incident response and breach notification roles;
- vendor/subprocessor inventory;
- audit logging and privileged access review.

Hospitality is a known cyber target. The FTC’s Marriott/Starwood matter is a relevant warning that hotel data security requires a sustained program, not just authentication controls. See [FTC Marriott/Starwood security matter](https://www.ftc.gov/legal-library/browse/cases-proceedings/192-3022-marriott-international-inc-starwood-hotels-resorts-worldwide-llc-matter).

Texas privacy applicability depends on the business and data-processing facts. The Texas Data Privacy and Security Act has been effective since July 1, 2024 and includes important small-business nuances, particularly around sensitive-data sales. Applicability should be reviewed rather than assumed away; see [Texas Attorney General TDPSA overview](https://www.texasattorneygeneral.gov/es/node/259071).

## Technical and architecture assessment

### Strengths worth preserving

- Explicit hotel scoping in Supabase queries and RLS as a second layer.
- JWT hotel/role claims and role gates.
- Flat domain architecture that remains understandable.
- Typed web API clients and React Query separation.
- Realtime limited to operationally justified surfaces.
- Room-status transition service and undo/history behavior.
- Upload size/content controls and tenant-prefixed storage paths.
- Existing security and tenant-isolation tests.
- Successful production build, TypeScript check, ESLint check, and **225/225 API tests**.

### Technical risks

1. **Production deployment is detached from code health.** The repository builds, but the public endpoints are unrouted.
2. **The project uses Next.js `16.3.0-canary.19`.** A canary framework is an unnecessary production risk for a small hotel product unless a required canary-only fix is documented and regression-tested.
3. **Duplicate lockfiles exist.** Next warned that it inferred a workspace root due to both root and web lockfiles.
4. **Documented workspace commands are invalid.** The root package does not declare npm workspaces even though project instructions prescribe `--workspace=@patelrep/web`.
5. **Documentation has migration drift.** The noted `020` collision has already been renamed to `0201_logbook_expires.sql`, but project instructions still describe the old state.
6. **Backend/web enums are drifting.** OOO/OOS, emergency, and escalated are concrete examples. Generate or contract-test API types instead of duplicating literals by hand.
7. **Runtime health is not a release gate.** A build passing did not stop both documented domains from returning 404.

## Prioritized remediation plan

### P0 — restore trust and eliminate unsafe state ambiguity (0–14 days)

1. **Restore both production domains.** Verify web → API → database → background job paths from an external monitor.
2. **Replace static “operational” copy with real health.** Show degraded states honestly; alert before users do.
3. **Reproduce and fix the local login hydration failure.** Add a browser test that asserts the form becomes enabled and can submit.
4. **Unify work-order types.** Add emergency priority and escalated status across database, API request/filters, client types, UI, tests, reports, and notifications.
5. **Separate OOO from OOS.** Require reason, expected return, linked repair/inspection, approver, clearance, and OPERA inventory consequences.
6. **Create append-only audit events.** Cover work-order transitions, PM completion/deferral, room restrictions, inspections, training, incidents, time edits, logbook controlled records, and privileged changes.
7. **Stop calling room-state toggles check-in/out.** Rename to occupancy status unless the PMS confirms the actual transaction.
8. **Either complete Spanish coverage or remove the selector.** Start with housekeeper, engineer, supervisor, emergency, and notification flows.

### P1 — build minimum viable Texas hotel compliance evidence (15–60 days)

Use existing entities and keep phone interactions short.

1. **Training registry:** employee, required course, approved provider/course, assigned date, due date, completion, certificate, expiry, acknowledgement, reminder/escalation, audit export. Ship human-trafficking training first.
2. **Controlled SOPs:** owner, version, status, approval, effective/review dates, supersession, applicability, acknowledgement, competency evidence.
3. **PM completion records:** versioned checklist, technician, verifier, readings, photos, parts/labor, defects, follow-up work orders, deferral authorization.
4. **Incident/event records:** injury, guest safety, chemical/body-fluid/sharps, security, privacy, discrimination, police/fire, life-safety impairment. Corrections append; they do not overwrite.
5. **HazCom/SDS controls:** chemical inventory, SDS document, use location, PPE, label check, training link, exposure/spill action.
6. **Emergency controls:** plan distribution/acknowledgement, contacts, role assignments, drill records, staff accountability, impairment tasks.
7. **Inspection photo UI:** connect the already existing API/schema capability to failed checklist items.
8. **Exception dashboard:** overdue, expired, failed, missing evidence, repeated deferral, unresolved escalation, and notification-delivery failure.

### P2 — close operational depth gaps (61–120 days)

1. Configurable guest-request SLA matrix by category, priority, guest impact, and property promise.
2. Acknowledge/dispatched/arrived/contacted/resolved/verified milestones and service-recovery authority.
3. Accessible-room feature data, maintenance protection, request handling, and OPERA synchronization.
4. Lost-and-found tag/storage/custody/release/disposition ledger.
5. Scheduling availability, missed punches, approvals, edit reasons, acknowledgements, overtime alerts, retention, and payroll export boundaries.
6. Water-management, pool, and life-safety templates only where property applicability is configured.
7. Vendor, certificate, warranty claim, recall, and asset-criticality controls.
8. Management reports for training, compliance, incident, defects, OOO/OOS reasons, PM evidence, and audit changes.

### P3 — add intelligence only after evidence is trustworthy

- Use actual defect, PM, occupancy, sensor, and work-history data for predictions.
- Measure false positives, missed events, staff overrides, and cost/time saved.
- Give every recommendation its evidence and confidence.
- Never let AI close a safety/compliance item or clear a room without an authorized human action.

## What PatelRep should not build

Do not turn this into a bloated pseudo-PMS. Avoid rebuilding:

- folio/payment settlement;
- reservation distribution;
- key encoding;
- rate/revenue management;
- full accounting/payroll;
- fire alarm, pool controller, or building-management systems.

Integrate with authoritative systems. PatelRep’s defensible niche is the last mile between a hotel standard and the employee who must act on it:

> **Right task, right person, right room/asset, right evidence, right escalation—without adding friction to the phone.**

## Recommended product contract

Every important workflow should answer seven questions:

1. **What must be done?** Approved, versioned procedure or checklist.
2. **Why does it matter?** Guest, brand, safety, legal, asset, or service obligation.
3. **Who is qualified and accountable?** Role plus current training/authorization.
4. **When is it due?** SLA, interval, trigger, grace/deferral rules.
5. **What proves completion?** Item results, readings, photo/document, timestamp, actor, and attestation.
6. **What happens when it fails?** Immediate containment, escalation, linked work, and supervisor verification.
7. **Can an auditor reconstruct it?** Immutable history, retention, export, and source system sync.

PatelRep currently answers questions 1, 3, and 4 reasonably well for ordinary tasks. It inconsistently answers 5 and 6, and often cannot answer 7.

## Evidence map to current source

Representative implementation evidence reviewed:

- Room-status request and transitions: `apps/api/models/requests.py:172`, `apps/api/services/room_status_transitions.py:19`
- Web room-status type mismatch: `apps/web/lib/api/rooms.ts:8`, `apps/web/lib/utils/roomStatus.ts:11`
- Housekeeping inspection-photo backend/schema: `apps/api/routers/housekeeping.py:1747`, `supabase/migrations/009_inspections.sql:83`
- Work-order SLA and filter mismatch: `apps/api/routers/work_orders.py:26`, `apps/api/routers/work_orders.py:142`, `apps/web/lib/api/engineering.ts:57`
- Auto-escalation: `apps/api/routers/internal.py:329`, `supabase/migrations/041_escalation_level.sql:15`
- PM completion behavior: `apps/api/routers/assets.py:225`, `supabase/migrations/008_assets_pm.sql:86`
- Guest-request fixed SLA: `apps/api/routers/guest_requests.py:54`
- Unused satisfaction capability: `supabase/migrations/011_guest_requests.sql:28`, `apps/web/lib/api/guest_requests.ts:17`
- Mutable/deletable logbook: `apps/api/routers/logbook.py:89`, `apps/api/routers/logbook.py:141`, `supabase/migrations/0201_logbook_expires.sql:11`
- Translation coverage count: 5 of 94 current TSX files use the translation mechanism directly.

## Final recommendation

**Do not add another AI feature before fixing availability, state integrity, bilingual floor usability, and compliance evidence.** The current product already has enough feature breadth. Its next stage is not “more.” It is making existing actions trustworthy.

The good news is that the underlying architecture does not need to be thrown away. The current task, inspection, asset, staff, SOP, document, notification, and room-history primitives can support most of the remediation. The product needs disciplined state contracts, append-only evidence, property applicability, exception-driven reporting, and brutally honest runtime health.

If those changes are made without burdening floor staff, PatelRep could become a differentiated Texas hotel operations copilot. If they are not, it will remain an attractive dashboard that optimizes visible work while leaving the hotel’s most consequential obligations in spreadsheets, binders, texts, and memory.

## Verification performed

- `npm run type-check` from `apps/web`: **passed**
- `npm run lint` from `apps/web`: **passed**
- `npm run build` from `apps/web`: **passed**, all 38 static routes generated
- `python -m pytest tests -q` from `apps/api`: **225 passed**
- Public production web request: **failed — Railway 404**
- Public API `/health` request: **failed — Railway 404**
- Local `/login` HTTP request: **200**
- Local browser login interactivity: **failed in observed session — hydration-dependent controls remained disabled**
- Railway project diagnosis: **blocked — CLI OAuth `invalid_grant` / unauthorized**


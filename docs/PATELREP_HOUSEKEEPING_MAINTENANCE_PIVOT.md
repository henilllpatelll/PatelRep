# PatelRep Housekeeping and Maintenance Pivot Plan

## Product Definition

PatelRep is a native hotel operations command center for housekeeping, maintenance, and supervised PMS support. PatelRep is the source of truth for room work, work orders, approvals, audit events, and operational state. OPERA Cloud provides PMS context and a supervised execution surface only.

The pivot focuses PatelRep on nine core capabilities:

1. Housekeeping room board
2. Maintenance work orders
3. OPERA Cloud read-only computer-use lookup
4. Human-approved OPERA note writing
5. Room-status mismatch detection
6. Approval inbox
7. Audit trail
8. Verifier agent
9. Optional Slack alerts later for urgent escalations and AI failures only

## Operating Principles

- PatelRep is the brain and source of truth.
- The OPERA worker is hands and eyes, not the brain.
- OPERA Cloud is the PMS context and execution layer only.
- The web app becomes the manager command center.
- The mobile app becomes the staff execution layer for housekeeping and maintenance.
- Slack is not a core workflow. It may later alert on urgent escalations and AI failures only.
- PMS APIs are not an MVP dependency.
- Risky PMS actions are forbidden in the MVP.
- Staff workflows must save time on the floor without adding phone complexity.
- Every external execution must be reviewable, attributable, reversible by process, and auditable.

## Text Architecture Diagram

```text
                         Manager Command Center
                       apps/web: housekeeping, maintenance,
                       approvals, audit, mismatch review
                                      |
                                      v
                         PatelRep API and Task Engine
                    apps/api: source of truth, RBAC, tenant
                    scope, workflow rules, audit emission
                                      |
          +---------------------------+---------------------------+
          |                           |                           |
          v                           v                           v
  Staff Execution App          Verifier Agent              Approval Inbox
  apps/mobile: rooms,          compares PatelRep           human review for
  work orders, notes,          state to OPERA              OPERA note writes
  completion evidence          read-only lookup            and exceptions
          |                           |                           |
          +---------------------------+---------------------------+
                                      |
                                      v
                         OPERA Computer-Use Worker
                read-only lookup first; note writing only after
                explicit human approval; no autonomous decisions
                                      |
                                      v
                                OPERA Cloud
                   PMS context and supervised execution surface

 Optional later:
 Slack alerts for urgent escalations and AI failures only.
 Slack must not become the task board or primary staff workflow.
```

## MVP Scope

The MVP ships the smallest complete loop for daily hotel operations:

- Housekeeping room board that shows room status, assignment, clean type, blockers, readiness, inspection state, and mismatch signals.
- Mobile housekeeping execution flow for assigned rooms, blockers, notes, photos where needed, and completion/submission.
- Maintenance work orders with room/location, priority, assignee, status, comments, photos, parts notes, and completion.
- Manager command center surfaces for housekeeping board, maintenance queue, exceptions, approvals, and audit.
- OPERA read-only lookup through supervised computer use for reservation/room context needed by managers.
- Human-approved OPERA note writing for safe note-only updates, with approval request, reviewer decision, worker execution, and verifier confirmation.
- Room-status mismatch detection between PatelRep state and OPERA-observed PMS state.
- Approval inbox for pending PMS note writes and mismatch resolution decisions.
- Audit trail for every state transition, approval, worker action, verifier result, and configuration change.
- Verifier agent that independently checks OPERA-visible results after approved note writes and flags discrepancies.
- Feature flags/config gates so OPERA and Slack integrations remain dormant unless enabled per hotel.

## Non-Goals

The MVP must not implement or expose flows for:

- Payments
- Refunds
- Charges
- Check-ins
- Checkouts
- Room moves
- Reservation cancellations
- Rate changes
- Inventory edits
- Night audit close
- Guest compensation

Additional non-goals:

- No Slack-first task workflow.
- No dependency on PMS APIs for MVP viability.
- No unsupervised OPERA execution.
- No broad admin console that slows floor staff.
- No replacement project or parallel manager/mobile app.
- No payment, billing automation, or Shift4 automation.
- No AI-only final authority for PMS writes or operational truth.

## User Roles

- Housekeeper: executes assigned room work on mobile, records blockers, adds room notes, submits rooms for inspection, and sees only floor-relevant work.
- Engineer: claims and completes maintenance work orders on mobile, adds comments/photos/parts notes, and updates work status.
- Housekeeping supervisor: manages the room board, assignments, inspections, blockers, mismatch review, and housekeeping approvals.
- Chief engineer: manages maintenance queue, triage, assignment, escalation, and maintenance quality review.
- Front desk: can contribute safe context and view operational status where needed, but does not drive MVP PMS actions through PatelRep.
- GM: hotel-level operational owner with visibility into command center, approvals, audit, configuration, and cross-department health.
- OPERA worker: service actor for computer-use lookup and approved note writing only.
- Verifier agent: service actor that checks observed OPERA outcomes against approved intents and audit records.

## Core Data Models

These models describe the product contract. Exact table names can reuse or extend current Supabase tables where appropriate.

### Hotel and Staff

- `hotels`: tenant root, configuration, enabled providers, operational settings.
- `user_roles`: staff identity, role, hotel scope, active state.
- `staff_profiles`: display name, department, language preference, notification preferences.

### Rooms and Housekeeping

- `rooms`: room number, floor, room type, active/out-of-service metadata.
- `room_status`: PatelRep source-of-truth room state, clean type, occupancy/PMS context snapshot, flags, assignment, inspection state.
- `room_assignments`: date-based room ownership for housekeepers and supervisors.
- `clean_sessions`: staff execution record for room start, pause/block, submit, inspect, pass/fail, and completion evidence.
- `room_notes`: PatelRep notes from staff, supervisor, OPERA lookup context, and approved PMS-note intents.
- `room_status_mismatches`: detected difference between PatelRep state and OPERA-observed state, severity, owner, status, and resolution.

### Maintenance

- `work_orders`: source-of-truth maintenance ticket with room/location, category, priority, status, assignee, SLA, and completion.
- `work_order_comments`: staff trail for updates, diagnosis, and handoff.
- `work_order_photos`: evidence and context images linked to work orders.
- `maintenance_assets`: optional equipment/asset references when work is tied to a known asset.

### OPERA Supervision

- `opera_lookup_sessions`: read-only worker sessions, requested context, observed fields, screenshots/log pointers, and expiration.
- `opera_action_requests`: requested OPERA note write intent, source entity, proposed note text, risk classification, and current approval state.
- `opera_approvals`: reviewer decision, policy checks, comments, timestamp, and reviewer identity.
- `opera_worker_runs`: execution attempt, worker inputs, result, evidence pointers, and failure mode.
- `opera_verifications`: verifier result, observed post-state, mismatch classification, and follow-up requirement.

### Audit and Notifications

- `audit_events`: append-only tenant-scoped event log for all meaningful state, approval, worker, verifier, and configuration changes.
- `approval_inbox_items`: normalized queue item for human review across OPERA notes, mismatches, and exceptions.
- `notification_events`: optional delivery records for later Slack/email/push alerts, never the source of truth.

## Build Phases

### Phase 0: Alignment and Guardrails

- Publish this pivot plan and keep it as the review contract.
- Confirm forbidden PMS actions in product, API, and UI copy.
- Add provider/config flags for OPERA worker and future Slack alerts.
- Define audit event taxonomy and approval states before building execution.

### Phase 1: PatelRep Source-of-Truth Operations

- Tighten housekeeping room board and mobile staff execution around existing rooms, assignments, blockers, inspections, and clean sessions.
- Tighten maintenance work orders around mobile execution and manager triage.
- Ensure tenant-scoped queries and role gates cover every operational route.
- Add focused tests for room/work-order state transitions and audit emission.

### Phase 2: Manager Command Center

- Reframe web surfaces around a daily command center: room board, maintenance queue, exceptions, approvals, and audit.
- Keep the current Warm Operational Hospitality visual system and existing app foundation.
- Prioritize dense, scannable operational information over broad admin pages.

### Phase 3: OPERA Read-Only Lookup

- Add OPERA computer-use lookup as a gated, read-only manager tool.
- Store lookup sessions, observed context, and evidence pointers.
- Use lookup output to inform PatelRep decisions without allowing OPERA to become source of truth.

### Phase 4: Mismatch Detection and Approval Inbox

- Compare PatelRep room status to OPERA-observed state.
- Create mismatch records and approval inbox items for supervisor review.
- Provide deterministic resolution paths: accept PatelRep, update PatelRep after review, request more lookup, or dismiss with reason.

### Phase 5: Human-Approved OPERA Note Writing

- Add note-only OPERA action requests.
- Require policy validation and explicit human approval before worker execution.
- Execute only the approved note text and target.
- Verify the result and write audit events for request, approval, execution, and verification.

### Phase 6: Verifier Agent and Reliability Hardening

- Run independent verifier checks after approved note writes.
- Flag failed, partial, or ambiguous execution.
- Add retry policy, supervisor escalation, and evidence retention.
- Expand regression tests and operational dashboards.

### Phase 7: Optional Slack Alerts

- Add Slack alerts only for urgent operational escalations and AI/worker failures.
- Keep Slack behind provider/config flags.
- Never move the task board, approval flow, or source-of-truth state into Slack.

## Security and Approval Rules

- Every tenant-owned query must filter by `hotel_id` or equivalent tenant key.
- RLS is a second safety layer, not a substitute for application-level tenant filters.
- All manager actions require authenticated users and role gates.
- OPERA lookup requires an authorized manager role and records the requesting user.
- OPERA note writing requires a structured action request and a separate explicit approval.
- The approver must be a permitted role for the hotel and must be recorded in audit.
- The OPERA worker may not change the requested target, note body, or action type after approval.
- Any worker ambiguity must stop execution and return to the approval inbox.
- The verifier must be independent from the worker execution path where practical.
- Secrets, OPERA credentials, screenshots, and logs must follow least-privilege access and retention rules.
- AI may draft, summarize, classify, and recommend. AI may not approve its own PMS action.

## Forbidden PMS Action Rules

The OPERA worker must not perform risky PMS actions in the MVP, including payments, refunds, charges, check-ins, checkouts, room moves, reservation cancellations, rate changes, inventory edits, night audit close, or guest compensation.

If a user request would require one of those actions, PatelRep must offer a supervised/non-executing alternative such as:

- Show context from OPERA read-only lookup.
- Create a PatelRep task for the correct human owner.
- Draft a note for review without writing it.
- Record an internal PatelRep note.
- Escalate to a manager outside the automated workflow.

## Audit Requirements

Audit must be append-only and tenant-scoped. Each event should include:

- `id`
- `hotel_id`
- `event_type`
- `entity_type`
- `entity_id`
- `actor_type`
- `actor_id`
- `source_surface`
- `before_state` when relevant
- `after_state` when relevant
- `decision_reason` when relevant
- `request_id` or correlation id
- `created_at`
- Evidence pointers for OPERA lookup, worker execution, screenshots, logs, or verifier output when relevant

Required audit event families:

- Room status changed
- Room assigned/reassigned/unassigned
- Clean session started/submitted/inspected/failed/passed
- Blocker or room note created/removed
- Work order created/claimed/status changed/completed/commented
- OPERA lookup requested/completed/failed
- Mismatch detected/reviewed/resolved/dismissed
- OPERA action requested/approved/rejected/executed/failed
- Verifier check passed/failed/ambiguous
- Provider flag or integration setting changed
- Slack alert emitted/failed when optional alerts are enabled

## Testing Strategy

### Unit and Contract Tests

- Room state transition rules, including mismatch creation and resolution.
- Work-order state transitions and role restrictions.
- Approval state machine: requested, approved, rejected, executing, executed, verified, failed, needs_review.
- Forbidden PMS action policy checks.
- Audit event creation for every meaningful state transition.
- Tenant scoping and role checks for new API surfaces.

### Integration Tests

- Manager creates/reviews approval request and audit trail records each step.
- OPERA read-only lookup stores observed context without mutating OPERA.
- Approved OPERA note write executes only after approval.
- Verifier flags mismatch when observed result does not match approved intent.
- Slack provider disabled path remains quiet and non-blocking.

### E2E Tests

- Web manager command center: room board, maintenance queue, approval inbox, audit trail.
- Mobile housekeeper flow: assigned room, blocker/note, submit, inspection.
- Mobile engineer flow: claim work order, update, complete with evidence.
- Supervisor mismatch flow: review, resolve, and confirm audit.

### Manual Verification

- Run local API and web/mobile surfaces where practical.
- Confirm feature flags hide OPERA and Slack surfaces when disabled.
- Confirm no UI exposes forbidden PMS actions.
- Confirm audit entries are readable by authorized manager roles.

## Git Branch Strategy

- `main` remains the stable branch.
- `pivot/hk-maint-opera-execution` is the long-lived integration branch for the pivot.
- Focused feature branches branch from `pivot/hk-maint-opera-execution`.
- Pull requests target `pivot/hk-maint-opera-execution`, not `main`.
- Keep PRs scoped to one coherent capability or planning artifact.
- Merge `pivot/hk-maint-opera-execution` into `main` only after the full pivot is working and verified.

This document lives on branch `docs/pivot-plan` and should be updated when the pivot contract changes materially.

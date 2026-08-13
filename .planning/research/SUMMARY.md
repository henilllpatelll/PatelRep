# Project Research Summary

**Project:** PatelRep AI Staff Copilot SaaS (v1.7 milestone)
**Domain:** Batch actions (AI-09) and auto-escalation-to-GM (AI-10) on top of an existing AI room-readiness / asset-risk alerting system
**Researched:** 2026-08-13
**Confidence:** HIGH

## Executive Summary

This is not a greenfield build. It is a two-feature extension milestone bolted onto code that shipped in v1.6 (Phase 27). AI-09 lets a supervisor select multiple HIGH-risk rooms (or asset-failure predictions) and reassign/acknowledge them in one action instead of one row at a time. AI-10 auto-escalates a HIGH-risk prediction to the GM if it sits un-actioned past a time threshold. Every researcher independently converged on the same conclusion: no new libraries, services, or infrastructure are needed. Both features are direct extensions of patterns already proven in this exact codebase: BulkArchiveModal.tsx and POST /work-orders/bulk-archive for batch selection and fan-out, and the escalation_level tiered-ladder (work_orders/tasks, migration 041, check_escalations in internal.py) for escalation dedup.

The recommended approach: AI-09 adds new batch endpoints in housekeeping.py (and optionally assets.py) that loop over the existing single-item reassign_at_risk_room/escalate_at_risk_room/acknowledge_at_risk_room coroutines rather than reimplementing their guard logic, paired with new checkbox-selection UI on PredictionPanel.tsx (no prior multi-select pattern exists in this codebase to reuse, so this is genuinely new frontend surface). AI-10 requires one net-new schema element: an escalation_level counter plus a first-seen-HIGH timestamp (high_risk_since) on room_readiness_predictions and failure_predictions, plus a new cron job that mirrors escalations.check's tiered-notification pattern rather than folding into the detection crons (predictions.run, ai.failure-predictions).

The dominant risk in both features is regression of discipline the codebase already earned the hard way: the single-item endpoints re-read live state before writing (batch code must not read-once-act-on-N-stale-snapshot); the work-order/task ladder already solved notification spam with a persisted watermark (a new escalation path must reuse that idiom, not is_acknowledged, which is a human-suppression signal, not a dedup counter); and the is_acknowledged column already required an explicit preserve-on-upsert and reset-on-resolve test pair (migration 095). Any new escalation column needs the identical two-part test coverage or it will silently misbehave on the second HIGH episode. A secondary, non-technical risk is migration deployment drift: this project has twice (v1.2, v1.3) shipped a merged migration that was never applied to production, caught only by manual schema audits. AI-10's new columns are exactly the small, easy-to-miss kind of change that has slipped through before.

## Key Findings

### Recommended Stack

No new packages, services, or infrastructure. All required tooling (fastapi, apscheduler, supabase, pydantic, @tanstack/react-query, react, zod) is already pinned in apps/api/requirements.txt / apps/web/package.json. Confidence is HIGH because the finding is direct code inspection, not a general recommendation. The project's own zero-added-dependency convention (CLAUDE.md "Services layer depth") makes this the expected outcome, not a surprising one.

Core patterns to reuse (not "technologies" in the traditional sense):
- useState<Set<string>> selection state plus useMutation fan-out: exact shape already proven in BulkArchiveModal.tsx
- SanitizedBaseModel bulk request Pydantic model, capped min_length=1, max_length=200: exact shape already proven in BulkArchiveWorkOrdersRequest (apps/api/models/requests.py:786)
- escalation_level SMALLINT NOT NULL DEFAULT 0 CHECK (BETWEEN 0 AND N) watermark column plus a .lt("escalation_level", N) cron guard: exact shape already proven in migration 041_escalation_level.sql

### Expected Features

Must have (table stakes):
- Multi-select checkboxes scoped only to actionable (HIGH-risk) rows; MEDIUM rows stay read-only, matching today's canAct gating
- Select-all shortcut, scoped to the currently-rendered list, not paginated or hotel-wide (HIGH-risk lists at a 50-150 room property are inherently small)
- Contextual action bar appearing once at least one row is selected, showing count and available actions
- Confirm-before-commit step scaled to N items ("Reassign 4 rooms?"), preserving the safety bar the single-item flow already sets
- Per-item outcome after a batch runs (e.g. "3 reassigned, 1 escalated, no capacity"), not a single pass/fail toast
- Deselect / clear-selection escape hatch
- GM notification on escalation must not be silent; that is the entire point of the feature
- Escalation must stop firing once a room is reassigned, acknowledged, or drops below HIGH, else it is a false alarm
- Escalation must be idempotent; no repeat GM notification every 30-min cron cycle

Should have (competitive differentiators):
- Select-all-HIGH-on-this-floor quick filter, targeting the actual deferral trigger (shift-change tap-fatigue is location-scoped, not property-wide)
- Batch actions reuse the exact single-item endpoints per-row, preserving today's outcome semantics (e.g. reassign's no-capacity fallback) rather than a second business-logic path
- Escalation timer anchored to first-classified-HIGH (a domain-specific signal already computed once in predictions.py but currently discarded), not a generic overdue clock

Defer (v2+, explicitly out of scope):
- Unbounded select-all-across-the-whole-hotel; solves a pagination-scale problem this domain does not have
- Per-item customization inside one batch flow (defeats the purpose of batching; route back to single-row confirm instead)
- Full transactional undo/rollback after a batch commits; disproportionate for a same-shift, small-blast-radius, already-confirmed action, and the single-item flow does not have undo either
- Escalation as an ownership/assignment transfer to the GM; GMs do not clean rooms, escalation should notify and flag state, not reassign
- Escalating MEDIUM-risk predictions; scope creep beyond every existing risk_level HIGH action gate
- Configurable per-hotel escalation thresholds; start with one fixed threshold, add configurability only if GMs ask

### Architecture Approach

Both features stay inside existing domain files: no new router files, no new services/ modules, per the project's flat-architecture convention (services/ reserved for logic shared across 2+ domains, and there is no cross-domain sharing here). AI-09 adds batch-reassign/batch-acknowledge routes to housekeeping.py (and batch-acknowledge to assets.py for asset-failure predictions) that await the existing single-item route coroutines in a loop, mirroring the precedent that reassign_at_risk_room already calls create_assignments directly today. AI-10 adds a new, separate cron job (not folded into predictions.run/ai.failure-predictions, which are detection engines with a different lifecycle) that mirrors escalations.check exactly: new escalation_level and high_risk_since columns, a gated .lt() tier check, and _notify_role for GM notification (the more complete notifications+notification_deliveries pattern, not notify_supervisors_high_risk, which fires once on initial HIGH crossing and has no dedup of its own).

Major components:
1. Batch endpoints (housekeeping.py, assets.py): accept an ID array, loop the existing single-item action functions, return a per-item result list plus aggregate counts
2. Escalation cron (internal.py check_prediction_escalations, new job id in scheduler.py): reads risk_level HIGH, is_acknowledged FALSE, escalation_level below N, and high_risk_since older than the threshold, then notifies GM via _notify_role
3. Schema (supabase/migrations/096, next sequential number): escalation_level and high_risk_since on room_readiness_predictions; same two columns on failure_predictions (which is delete-then-insert per run, so the timestamp must be carried forward across re-runs unless the row is newly crossing HIGH)
4. Frontend selection UI (PredictionPanel.tsx, engineering/predictions/page.tsx): genuinely new checkbox and bulk-action-bar UI; no existing multi-select pattern in this codebase to extend

### Critical Pitfalls

1. Batch-read-then-batch-act on a stale snapshot. Batch handlers must re-validate each item's live state (room_status/risk_level) at the moment of write, not against a request-start bulk read. Avoid by calling the same per-item guard logic the single-item endpoints already use, ideally by invoking the single-item coroutines directly inside the loop.
2. No defined partial-failure contract. This project's only existing multi-item write (create_assignments) already gets this wrong: one try/except around the whole loop leads to an opaque 500 with no per-item breakdown. Batch endpoints must wrap each item in its own try/except and return a per-item result list (succeeded/skipped/error), not an aggregate pass/fail.
3. Escalation reintroduces GM-notification spam. is_acknowledged is a human-suppression boolean, not a dedup counter, and notify_supervisors_high_risk has zero dedup logic of its own. AI-10 must add its own tiered escalation_level column and gate on escalation_level below N, mirroring 041_escalation_level.sql, not reuse is_acknowledged as the gate.
4. New escalation columns silently reset, or fail to reset, on the 30-min upsert cycle. Migration 095's is_acknowledged needed two separate, tested behaviors: preserved-on-upsert-while-HIGH and reset-when-risk-drops-below-HIGH. A new escalation_level/high_risk_since column needs the identical characterization-test pair, or a room that flickers HIGH to clean to HIGH again silently inherits a stale tier and never re-escalates.
5. Migration deployment gap. This project has twice (v1.2, v1.3) shipped a merged, code-complete migration that was never applied to production, caught only by manual schema audits. AI-10's new columns must be confirmed against live production schema (not just git log) before the phase is marked done, and CLAUDE.md's migration table (currently stale at 041 of 99 files) should be updated as part of this phase.

## Implications for Roadmap

AI-09 and AI-10 are independent (confirmed by both ARCHITECTURE.md and FEATURES.md): they touch different code paths (AI-09 touches route handlers and selection UI only, no schema; AI-10 touches prediction-engine stamping, a new cron, and a new migration) and neither blocks the other. The one coordination point if built in parallel: both may want to claim the next migration number. AI-10 should claim 096 since its schema change is a hard prerequisite for its own cron logic; AI-09 needs no migration at all.

### Phase 1: Batch Actions (AI-09)
Rationale: No schema dependency, lower risk, and establishes the per-item result-list contract that both this feature and AI-10's future UI surfacing can reuse. Recommended to build first or in parallel, not blocked by anything.
Delivers: batch-reassign/batch-acknowledge endpoints (room-readiness) and batch-acknowledge (asset-failure); checkbox multi-select and bulk-action bar on PredictionPanel.tsx and engineering/predictions/page.tsx.
Addresses: all FEATURES.md table-stakes items for batch (multi-select scoped to actionable rows, select-all, action bar, confirm step, per-item outcome, deselect).
Avoids: Pitfalls 1, 2, 6, 7 (stale-snapshot writes, opaque partial failure, silent cross-tenant ID drop, lost confirm discipline in new UI).

### Phase 2: Escalation to GM (AI-10)
Rationale: Depends on a schema change (escalation_level, high_risk_since) that is a hard prerequisite for its own cron logic; naturally sequenced after or parallel to Phase 1 once migration numbering is coordinated.
Delivers: new migration adding tiered escalation columns to room_readiness_predictions and failure_predictions; prediction-engine changes to stamp/carry-forward high_risk_since; new check_prediction_escalations cron job registered in scheduler.py; GM notification via _notify_role; UI surfacing of escalation state (e.g. "Escalated to GM 12 min ago").
Addresses: FEATURES.md escalation table-stakes (non-silent GM notification, escalation stops on action, idempotent notification) and the differentiator (timer anchored to first-classified-HIGH).
Avoids: Pitfalls 3, 4, 5 (notification spam, column reset/preserve gap, migration deployment drift).

### Phase Ordering Rationale

- AI-09 has zero schema dependency and the lowest risk profile: sequencing it first (or in parallel) means the per-item result-list UI/response contract exists before AI-10 needs to surface its own escalation state in the same panel.
- AI-10's schema change is self-contained but must claim its migration number before or independently of any other in-flight migration work, given this project's documented history of numbering collisions (020/0201, dual 039 files).
- Both phases should each include their own test-writing sub-step per PITFALLS.md's explicit test mapping (concurrent-mutation test for P1, partial-failure test for P2, 3x-consecutive-cron-run test for P3, preserve+reset characterization test pair for P4, live-schema verification for P5): these are not optional follow-ups, they are the phase's definition of done per the pitfalls research.

### Research Flags

Phases likely needing deeper research during planning:
- AI-10 (Escalation phase): the escalation threshold/tier design is explicitly flagged as unresolved by FEATURES.md: single-tier vs. the WO ladder's 3-tier (30/90/150 min) model, and the exact minute threshold, is a product/roadmap decision that research could not settle. Flag for explicit decision during phase planning, not implementation-time guessing.
- AI-10 vs AI-09 endpoint naming: STACK.md's illustrative examples use bulk-reassign/bulk-acknowledge naming while ARCHITECTURE.md's integration design uses batch-reassign/batch-acknowledge. Both are internally consistent but disagree with each other; resolve to one convention during phase planning (recommend batch- per ARCHITECTURE.md's more detailed endpoint design, but either is uncontroversial as long as it is picked once).

Phases with standard patterns (skip research-phase):
- AI-09 (Batch-actions phase): fully grounded in two existing in-repo precedents (BulkArchiveModal.tsx, BulkArchiveWorkOrdersRequest) with no external unknowns; standard pattern, safe to proceed straight to implementation planning.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Direct code inspection of this repository; no new dependencies means no external library research risk |
| Features | HIGH internal / MEDIUM-HIGH external | Internal grounding is a full read of the actual panel/router/cron code; external validation drew on SaaS bulk-action and incident-escalation-policy guides (PagerDuty, Opsgenie, AlertOps) as secondary confirmation, not primary source |
| Architecture | HIGH | Every file/function/table name verified by direct read on 2026-08-13, not inferred from prior phase docs |
| Pitfalls | HIGH | Grounded in actual v1.6 code plus this project's own documented migration/upsert incident history and existing characterization tests |

Overall confidence: HIGH

### Gaps to Address

- AI-10 threshold/tier design: no single answer from research; FEATURES.md explicitly flags this as a product decision requiring either a conservative default or a roadmap-level call, not something research can settle. Resolve during phase planning.
- Endpoint naming inconsistency (bulk- vs batch-) between STACK.md and ARCHITECTURE.md: cosmetic but should be fixed to one convention before implementation starts.
- Whether AI-09 extends to asset-failure batch actions beyond batch-acknowledge: ARCHITECTURE.md recommends scoping AI-09's first phase to batch-reassign plus batch-acknowledge (room-readiness) and batch-acknowledge only (asset-failure), explicitly deferring batch create-work-order as higher-risk; confirm this scope during requirements/roadmap definition rather than assuming it by default.

## Sources

### Primary (HIGH confidence, direct repository inspection, 2026-08-13)
- apps/web/components/engineering/BulkArchiveModal.tsx: batch-selection UI precedent
- apps/api/routers/work_orders.py lines 518-563: bulk endpoint plus shared-helper backend precedent
- apps/api/routers/housekeeping.py lines 1274-1362 and 828-937: single-item actions and the only existing multi-item write endpoint (create_assignments)
- apps/api/routers/assets.py lines 69-160+: asset-failure prediction endpoints
- apps/api/routers/internal.py lines 461-589: check_escalations tiered-ladder cron precedent
- apps/api/services/ai/predictions.py lines 197-467, apps/api/services/ai/failure_predictions.py lines 312-573: prediction engines and notification helpers
- apps/api/core/scheduler.py lines 26-101: cron registration/cadence, build_scheduler fail-fast on handler/schedule mismatch
- supabase/migrations/041_escalation_level.sql, 095_room_readiness_acknowledgement.sql, 008_assets_pm.sql: schema precedents
- apps/api/tests/test_room_readiness_actions.py lines 42-138: upsert-preserve and reset-on-resolve characterization tests
- apps/web/components/housekeeping/PredictionPanel.tsx, apps/web/app/(dashboard)/engineering/predictions/page.tsx: frontend integration points
- Repo migration count (99 files) vs. CLAUDE.md's migration table (documents only through 041): direct evidence of doc-drift risk

### Secondary (MEDIUM confidence, external validation)
- Bulk action UX: 8 design guidelines, Eleken (https://www.eleken.co/blog-posts/bulk-actions-ux)
- Table multi-select pattern, Helios Design System, HashiCorp (https://helios.hashicorp.design/patterns/table-multi-select)
- Bulk editing pattern, eBay Playbook Design System (https://playbook.ebay.com/design-system/patterns/bulk-edit)
- Best Practices for Alerting Using PagerDuty, DrDroid (https://drdroid.io/engineering-tools/best-practices-for-alerting-using-pagerduty)
- How to set alert policies, Opsgenie/Atlassian docs (https://docs.opsgenie.com/docs/alert-policies)
- Alert Escalation: How It Works and Best Practices, AlertOps (https://alertops.com/blogs/alert-escalation/)

### Tertiary (LOW/MEDIUM confidence, needs validation)
- Project memory re: v1.2/v1.3 unapplied-migration incidents: sourced from project memory/milestone history, not re-verified against a specific commit this session

---
Research completed: 2026-08-13
Ready for roadmap: yes

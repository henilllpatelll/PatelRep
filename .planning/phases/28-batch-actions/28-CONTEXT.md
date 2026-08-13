# Phase 28: Batch Actions - Context

**Gathered:** 2026-08-13
**Status:** Ready for planning
**Mode:** Autonomous (user delegated all discuss/plan decisions up front for this milestone — see PROJECT.md session note; decisions below made by Claude using research findings + existing codebase conventions, not interactively discussed)

<domain>
## Phase Boundary

Supervisors/GMs (room-readiness) and engineers/chief_engineers/GMs (asset-failure) can select multiple HIGH-risk predictions at once and commit a batch reassign/acknowledge action in one confirming step, instead of acting on one row at a time. This is a UI + backend extension of the existing v1.6 single-item reassign/escalate/acknowledge flow (Phase 27) — no new business logic path, no new schema, no new cron.

</domain>

<decisions>
## Implementation Decisions

### Endpoint naming
- Use `batch-` prefix, not `bulk-`, resolving the naming inconsistency SUMMARY.md flagged between STACK.md and ARCHITECTURE.md: `POST /housekeeping/room-readiness/batch-reassign`, `POST /housekeeping/room-readiness/batch-acknowledge`, `POST /assets/failure-predictions/batch-acknowledge` (exact router/path confirmed during planning against the real `assets.py` route prefix).
- Rationale: ARCHITECTURE.md's naming was grounded in a more detailed endpoint design than STACK.md's illustrative example; picking one convention once matters more than which one.

### Batch action semantics
- Batch endpoints loop the existing single-item coroutines (`reassign_at_risk_room`, `acknowledge_at_risk_room`, and the asset equivalent) per selected ID — they do not reimplement guard/validation logic. This re-uses the existing per-item live-state re-read (PITFALLS.md #1: no stale-snapshot batch writes).
- Partial-failure contract: best-effort, not all-or-nothing. Each item gets its own try/except and its own result entry (`succeeded` / `escalated_no_capacity` / `already_resolved` / `error`). Explicitly do NOT copy `create_assignments`' existing all-or-nothing-with-no-per-item-breakdown shape (PITFALLS.md #2 — named as this project's own precedent to avoid repeating).
- Request contract mirrors `BulkArchiveWorkOrdersRequest` (`apps/api/models/requests.py:786`): a `List[UUID4]`, non-empty, capped (cap chosen at plan time — HIGH-risk lists at 50-150 rooms are inherently small, so a generous cap like 50 is sufficient and avoids an arbitrary-feeling small number).

### Selection UI
- Checkbox multi-select, scoped only to actionable rows (`canAct = canAssignRooms && risk_level === 'HIGH'`, matching `PredictionRow`'s existing gate exactly — MEDIUM-risk rows never become selectable).
- Select-all is scoped to the currently-rendered list only, not hotel-wide (FEATURES.md: this domain has no pagination-scale problem at 50-150 rooms). No floor-scoped quick-filter in this phase (that's AI-16, deferred to v2).
- Selection surfaces a contextual action bar (appears once ≥1 row selected, shows count + available batch actions + a Clear/deselect-all escape hatch) rather than a modal dialog — chosen to stay visually consistent with `PredictionPanel.tsx`'s existing inline-confirm-subrow interaction model (mode: `idle` → `confirm-X` → result), not `BulkArchiveModal.tsx`'s modal pattern from a different part of the app. The action bar's own confirm step ("Reassign 4 rooms?") is the equivalent of that inline confirm step, scaled to N items.
- Per-item outcome after a batch commits is shown as a short results list/panel (e.g. "3 reassigned, 1 escalated: no capacity"), not a single pass/fail toast and not N separate toasts — matches the success criteria's explicit wording in ROADMAP.md.

### Scope
- Room-readiness gets both batch-reassign and batch-acknowledge (AI-09, AI-10). Asset-failure gets batch-acknowledge only (AI-11) — assets have no "reassign" concept (ARCHITECTURE.md: no analogous action exists for an asset).
- Batch create-work-order from asset predictions is explicitly NOT in this phase (AI-15, deferred to v2 as higher-risk since it creates real work orders).

### Resolved during phase research (2026-08-13)
- **AI-11 actor scope corrected to `gm`/`engineer` only, not `chief_engineer`.** The real single-item `acknowledge_failure_prediction` endpoint (`apps/api/routers/assets.py:114`) — plus `create-work-order` and most other asset-failure-prediction actions in the same file — gate `require_role("gm", "engineer")`. Only two unrelated PM-schedule endpoints in that file (`assets.py:214`, `:231`) include `chief_engineer`. This is a real, pre-existing inconsistency in the file, but not a clear single-endpoint oversight (majority pattern excludes it), so the new batch-acknowledge endpoint mirrors the existing single-item gate exactly rather than widening it. REQUIREMENTS.md's AI-11 wording corrected to match. If `chief_engineer` genuinely should have this access, that's a separate pre-existing gap outside this phase's scope — not silently fixed here.
- **Batch-selection eligibility for asset-failure predictions mirrors the current single-item Acknowledge button's gate exactly** (currently: any un-acknowledged prediction, no HIGH-only restriction) rather than introducing a new HIGH-only restriction that doesn't exist on the single-item path today. Keeps single-item and batch behavior consistent, per this phase's general "don't reimplement or diverge from single-item logic" principle.

### Claude's Discretion
- Exact per-item request cap value (recommend 50, confirm against any existing FastAPI/Pydantic conventions during planning).
- Exact visual placement/styling of the action bar (top vs. bottom of the panel, sticky vs. inline) — follow whatever fits `PredictionPanel.tsx`'s existing layout with least structural change.
- Whether checkbox state resets on `onActionComplete` refresh (recommend yes, to avoid stale selection referencing rows that may have changed risk level after a refresh).
- Exact i18n key naming for new batch-related EN/ES strings — follow the existing `housekeeping.predictionPanel.*` convention from Phase 27.

</decisions>

<specifics>
## Specific Ideas

No specific UI mockups or references given — this was scoped and decided autonomously per the user's explicit delegation for this milestone (batch through both discuss and plan phases, report back only once Phase 28 is fully executed, verified, and closed). Decisions above are grounded directly in existing in-repo precedents (`PredictionPanel.tsx`'s inline-confirm pattern, `BulkArchiveWorkOrdersRequest`'s request shape) rather than external inspiration.

</specifics>

<deferred>
## Deferred Ideas

- AI-15 (batch create-work-order from asset predictions) — v2, higher-risk, revisit once AI-11 is proven live.
- AI-16 (select-all-HIGH-on-this-floor quick filter) — v2, revisit only if the simple select-all-in-list proves insufficient for real shift-change tap-fatigue.
- Both already tracked in REQUIREMENTS.md's v2 section; not re-litigated here.

</deferred>

---

*Phase: 28-batch-actions*
*Context gathered: 2026-08-13*

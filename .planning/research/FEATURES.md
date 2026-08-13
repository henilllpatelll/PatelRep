# Feature Research

**Domain:** Batch actions + auto-escalation for AI prediction/alerting (room-readiness copilot), hotel ops SaaS
**Researched:** 2026-08-13
**Confidence:** HIGH (internal grounding — full read of `PredictionPanel.tsx`, `housekeeping.py`, `internal.py`, `predictions.py`, migration 013/095); MEDIUM-HIGH external (verified against multiple SaaS bulk-action guides + PagerDuty/Opsgenie/AlertOps escalation-policy docs)

## Scope Recap

Subsequent milestone. Two backlog items deferred at v1.6 close, now being scoped:

- **AI-09 — batch actions:** select a group of HIGH-risk room-readiness alerts (e.g. all HIGH rooms on one floor) and reassign/acknowledge them in one action, instead of one row at a time. Deferred pending "evidence of shift-change tap-fatigue."
- **AI-10 — escalation to GM:** a HIGH-risk prediction left un-actioned (no reassign/escalate/acknowledge) past a time threshold auto-escalates to GM. Deferred pending "evidence that alerts are going un-actioned."

Both extend the existing single-item action set on `PredictionPanel.tsx` (`apps/web/components/housekeeping/PredictionPanel.tsx`) and its three endpoints (`apps/api/routers/housekeeping.py`: `/room-readiness/{room_id}/{reassign,escalate,acknowledge}`). AI-10 is structurally the same shape as the existing work-order/task escalation ladder (`apps/api/routers/internal.py::check_escalations`, tiers at 30/90/150 min, `escalation_level` watermark column).

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist once "batch" or "escalation" is on the table. Missing these makes the feature feel unsafe or half-built.

| Feature | Why Expected | Complexity | Notes / Dependencies |
|---------|--------------|------------|-----------------------|
| Multi-select checkboxes, scoped to actionable rows only | Standard data-table bulk pattern (GitHub Issues, Jira, ClickUp); selection should only be offered where an action is legal. | LOW | Only HIGH-risk rows currently render action buttons (`canAct = canAssignRooms && risk_level === 'HIGH'` in `PredictionPanel.tsx:89`). Selection checkboxes should appear on that same subset — MEDIUM rows stay read-only, matching today's gating. |
| "Select all" shortcut for the current list | Reduces per-row tapping, the entire point of AI-09. | LOW | Scope to the currently-rendered/expanded HIGH list (typically single digits for a 50–150 room property) — not a paginated or hotel-wide select-all. |
| Contextual action bar that appears once ≥1 row selected | Universal SaaS bulk pattern — floating/sticky bar showing count + available actions, replaces hunting for a menu. | LOW-MEDIUM | Reuse existing `Button` primitives; bar shows "N selected" + Reassign/Escalate/Acknowledge, mirrors the per-row button set already built. |
| Confirm-before-commit step, scaled to N items | Existing single-item flow already requires a confirm sub-row before firing (`ActionMode = 'confirm-reassign' | ...`). Bulk actions carry more blast radius, so skipping confirmation here would be a regression versus the safety bar already set for single-item actions. | LOW | Reuse the same inline-confirm visual pattern, restate as "Reassign 4 rooms?" |
| Per-item outcome after the batch runs | Single-item reassign already has two distinct outcomes (`reassigned` vs `escalated: no_eligible_housekeeper`) — a batch call must preserve that granularity, not collapse to one pass/fail toast. | MEDIUM | e.g. "3 reassigned, 1 escalated — no capacity." Loses trust if a batch silently partially fails. |
| Deselect / clear selection control | Table stakes for any multi-select UI; users need an escape hatch before committing. | LOW | Standard checkbox-clear + explicit "Clear" affordance in the action bar. |
| GM notification is not silent (AI-10) | An alert that "auto-escalates" with no notification is invisible — defeats the purpose of a safety net. | LOW | Reuse `notify_role` / `_notify_role` helper already used for WO/task escalation tiers (`internal.py`). |
| Escalation only fires while the alert is still HIGH and un-actioned (AI-10) | Escalating a room that was already reassigned/acknowledged/dropped-to-MEDIUM is a false alarm and erodes trust in the whole ladder — exactly the failure mode PagerDuty's "acknowledge stops escalation" rule and Opsgenie's alert-policy model both guard against. | MEDIUM | Needs a per-room "un-actioned since" signal — see Dependencies below; this does not exist in the schema today. |
| Escalation is idempotent (no repeat-notify every cron cycle) | The existing WO/task ladder explicitly guards against this ("Level tracking prevents duplicate notifications across cron runs" — `internal.py:488`). Skipping it here would immediately create the exact GM-notification spam the ladder pattern was built to avoid. | LOW | One watermark column write per escalation event, same shape as `work_orders.escalation_level`/`tasks.escalation_level`. |

### Differentiators (Competitive Advantage)

Align with core value: save floor staff time without adding phone/dashboard complexity.

| Feature | Value Proposition | Complexity | Notes / Dependencies |
|---------|-------------------|------------|-----------------------|
| "Select all HIGH on this floor" quick filter (AI-09) | Directly targets the deferral trigger — shift-change tap-fatigue is location-scoped (a supervisor walking one floor/wing, not the whole property). A flat select-all doesn't address that; a floor-scoped one does. | LOW-MEDIUM | `room_id` predictions already join `rooms(floor)` in some contexts (see `get_predictions` in `housekeeping.py:1252`) — floor is available to group by client-side without new backend work. |
| Batch action reuses the exact single-item endpoints, per-row (AI-09) | Keeps outcome semantics identical to what's shipped (e.g. reassign's "escalated: no capacity" fallback is preserved per room, not silently dropped). Avoids a second business-logic path that can drift from the single-item one. | LOW-MEDIUM | Implement as either (a) client-side loop calling the three existing POST endpoints per selected `room_id`, or (b) one thin batch endpoint that internally calls the same handler functions in a loop. Either way: no new reassignment/escalation logic, just fan-out over what exists. |
| Escalation timer anchored to "first classified HIGH," not a generic overdue clock (AI-10) | Room-readiness predictions don't have a task-style `due_at`; the meaningful "how long has this sat un-actioned" clock should start when the room first crossed into HIGH (a moment that's already computed once in `services/ai/predictions.py`, just not persisted). This is a genuinely different signal from the WO ladder's SLA-overdue math, tailored to this domain rather than copy-pasted. | MEDIUM | See Feature Dependencies — requires persisting that transition moment. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Unbounded "select all across the whole hotel / all pages" (AI-09) | "Just let me select everything." | HIGH-risk lists at a 50–150 room property are inherently small (rarely more than a handful concurrently) — this is solving a pagination-scale problem the domain doesn't have, and adds UI complexity (indeterminate-select-all, "select all N matching filter" banners) for no real benefit here. | Select-all applies only to the currently-rendered/expanded HIGH list. |
| Per-item customization inside one batch flow (e.g. picking a different housekeeper per room inside the batch modal) (AI-09) | "Let me fine-tune each one while I'm in there." | This is just N single actions wearing a batch costume — it reintroduces the exact per-row decision-making the batch feature exists to remove, while adding a much more complex UI (a mini reassignment picker per row, inside a bulk modal). | Keep batch actions uniform: the same action (reassign to AI-suggested housekeeper / escalate / acknowledge) applied identically to every selected row. Anything needing per-room judgment routes back to the existing single-row confirm flow. |
| Full transactional undo/rollback after a batch commits (AI-09) | "What if I select the wrong rooms and hit reassign?" | Reverting a reassignment write (which cascades into `room_assignments` and downstream workload balance) is disproportionate engineering for a same-shift, small-blast-radius action that's already gated behind an explicit confirm step. Note: the existing single-item actions don't have undo either — adding it only for batch would be an inconsistent safety model. | Strong confirm-before-commit (reuse the inline confirm-subrow pattern, scaled to "Reassign 4 rooms?") instead of undo-after-commit. |
| Escalation as an ownership/assignment change — i.e. actually reassigning the room record to the GM (AI-10) | "Make the GM own it so it's clearly someone's job." | GMs don't clean rooms; forcing an ownership transfer models this like an on-call rotation where the escalated party is expected to personally act, which doesn't fit a GM's role here. The existing WO tier-3 precedent is the right model: it sets `status='escalated'` (a state flag) and notifies GM — it does **not** reassign the work order to a different assignee. | Escalation flags the prediction (state/watermark) and notifies GM — visibility and accountability, not a forced ownership transfer. Matches the "notification-only, shared responsibility" pattern used by AlertOps Response Plays as an alternative to strict on-call ownership handoff. |
| Escalating MEDIUM-risk predictions too (AI-10) | "Why only HIGH? MEDIUM rooms could also slip." | Scope creep beyond what's asked, and inconsistent with every existing action gate in this feature: `canAct` on the frontend and all three backend endpoints already restrict to `risk_level === 'HIGH'` only. Extending escalation to MEDIUM roughly doubles the alert surface for a tier the product has deliberately treated as "watch, don't act" so far. | Keep AI-10 scoped to HIGH only, matching every other action gate already in place. |
| Uncapped repeat GM notification every 30-min cron cycle while still un-actioned (AI-10) | "Keep pinging until someone deals with it." | This is the exact alert-fatigue failure mode the existing WO/task escalation ladder was explicitly built to prevent via its `escalation_level` watermark ("prevents duplicate notifications across cron runs"). Un-capped re-notification would make AI-10 the one alerting path in the app that doesn't follow the house pattern. | One GM notification per HIGH-and-un-actioned episode (watermark-gated), only resettable if the room drops below HIGH and later re-crosses into HIGH. |

## Feature Dependencies

```
AI-09 batch actions
    └──requires──> existing single-item endpoints (reassign/escalate/acknowledge) [EXISTS: housekeeping.py:1274-1362]
    └──requires──> per-row selection state added to PredictionPanel.tsx, scoped to canAct rows [NEW, frontend-only]
    └──does NOT require──> schema changes (fan-out over existing mutations, no new tables/columns)

AI-10 escalation-to-GM
    └──requires──> a persisted "un-actioned since" signal on room_readiness_predictions [GAP — see below]
    └──requires──> escalations.check cron pattern + _notify_role helper [EXISTS: internal.py:481-589]
    └──requires──> the escalation-clock reset must fire on ALL THREE actions (reassign/escalate/acknowledge), not just acknowledge [GAP — see below]
    └──enhances──> the same 30-min cadence already used by predictions.run / escalations.check [EXISTS, no new cron job needed]

AI-09 and AI-10 ──independent──> can ship in either order; AI-09 does not block AI-10 or vice versa
```

### Dependency Notes — confirmed gaps in current schema/logic

- **No "became HIGH at" timestamp exists today.** `room_readiness_predictions` (migration `013_ai_systems.sql`) has `last_calculated_at` (overwritten every 30-min recompute, not a transition marker) and `acknowledged_at`/`is_acknowledged` (migration `095_room_readiness_acknowledgement.sql`, set only by the manual acknowledge action). There is no column marking *when a room first crossed into HIGH*. `services/ai/predictions.py` already computes this moment once per transition (`risk_level == "HIGH" and previous_risk != "HIGH"`, line ~447) to decide whether to fire the one-time notification — but it discards it instead of persisting it. **AI-10 needs this persisted** (recommend a new `escalation_level` column on `room_readiness_predictions`, mirroring the `work_orders.escalation_level` / `tasks.escalation_level` watermark convention already used elsewhere in the codebase, set on the same transition). This is a real schema dependency, not just business-logic reuse — flag as MEDIUM complexity, not LOW.
- **Only `acknowledge` currently marks a room as "actioned."** Checked `reassign_at_risk_room` and `escalate_at_risk_room` in `housekeeping.py` directly: neither writes to `is_acknowledged`/`acknowledged_at`. Reassign changes `room_assignments` (which will organically drop risk on the next `predictions.run` recompute) but doesn't touch the prediction row itself; escalate only re-sends notifications. If AI-10's un-actioned clock is reset by "any of the three actions," reassign and escalate need to also clear/touch the new watermark column — otherwise a supervisor who reassigns a room could still see it auto-escalate to GM minutes later, which would be a confusing regression, not a safety net.
- **AI-09 has no schema dependency** — it is purely a frontend selection/batching concern layered on already-shipped, already-tested single-item mutations. This keeps it the lower-risk of the two features to build first if sequencing matters.

## MVP Definition

### Launch With (if this milestone ships both)

- [ ] **AI-09 batch reassign/acknowledge** on HIGH-risk rows, uniform action applied to a floor-scoped or full-list selection, fanned out over existing single-item endpoints, with per-row outcome reporting.
- [ ] **AI-10 escalation-to-GM** for HIGH-risk predictions left un-actioned past a threshold, using a new watermark column, one-time GM notification, no ownership/assignment change.

### Add After Validation

- [ ] Tuning the AI-10 threshold value itself (see below) once real "how long do HIGH rooms sit un-actioned" data exists — ship with a conservative default, adjust from production telemetry rather than guessing twice.

### Future Consideration (v2+, do not build now)

- [ ] Cross-selection batch actions spanning both HIGH housekeeping rooms and HIGH/failure-risk assets in one UI — no evidence this is needed; the two domains have different actors (supervisor vs engineer) and different action sets.
- [ ] Configurable per-hotel escalation thresholds (GM-tunable minutes) — start with a fixed threshold matching the house pattern; only add configurability if GMs actually ask for it.

## Threshold Guidance for AI-10 (not prescriptive — flag for roadmap/phase decision)

The existing WO/task ladder uses 30/90/150-minute tiers anchored to `due_at` overdue-elapsed time. Room-readiness HIGH predictions don't have an equivalent due-date concept — the closest analog is time since the one-time "newly HIGH" notification already fires. Because `predictions.run` and `escalations.check` both run on a 30-minute cadence, any threshold should be a multiple of 30 minutes to align cleanly with check intervals (a threshold like "45 minutes" would inconsistently span one or two cron runs). Suggest evaluating a single-tier design (unlike the WO ladder's three tiers) given HIGH-risk room windows are typically measured in a few hours until check-in at most — a 3-tier ladder modeled on 150-minute WO thresholds may be too slow for a room that needs to be ready today. This is a product/roadmap decision, not something this research can settle with certainty — flag as an open question for phase planning.

## Sources

- [Bulk action UX: 8 design guidelines with examples for SaaS — Eleken](https://www.eleken.co/blog-posts/bulk-actions-ux) — MEDIUM
- [Data table UI design reference guide for 2026 — Setproduct](https://www.setproduct.com/blog/data-table-ui-design) — MEDIUM
- [Table multi-select pattern — Helios Design System (HashiCorp)](https://helios.hashicorp.design/patterns/table-multi-select) — MEDIUM
- [Bulk editing pattern — eBay Playbook Design System](https://playbook.ebay.com/design-system/patterns/bulk-edit) — MEDIUM
- [Best Practices for Alerting Using PagerDuty — DrDroid](https://drdroid.io/engineering-tools/best-practices-for-alerting-using-pagerduty) — MEDIUM
- [How to set alert policies — Opsgenie/Atlassian docs](https://docs.opsgenie.com/docs/alert-policies) — MEDIUM
- [Escalation policy tools comparison: incident.io vs. PagerDuty vs. Opsgenie](https://incident.io/blog/escalation-policy-tools-comparison) — MEDIUM
- [Incident escalation policies: intelligent alert routing and on-call assignment — incident.io](https://incident.io/blog/incident-escalation-policies-guide) — MEDIUM
- [Alert Escalation: How It Works & Best Practices — AlertOps](https://alertops.com/blogs/alert-escalation/) — MEDIUM
- [Map Opsgenie Escalations to Response Plays — AlertOps](https://alertops.com/blogs/opsgenie-response-plays-vs-escalation-policies/) — MEDIUM
- [Maintenance Escalation Rules: When to Notify Managers Automatically — oxmaint](https://oxmaint.com/article/maintenance-escalation-rules-when-to-notify-managers-automatically) — MEDIUM
- Internal (HIGH): `apps/web/components/housekeeping/PredictionPanel.tsx` (single-item action UI + confirm pattern), `apps/api/routers/housekeeping.py:1274-1362` (reassign/escalate/acknowledge handlers), `apps/api/routers/internal.py:481-589` (`check_escalations` — 3-tier WO/task ladder, `escalation_level` watermark, `_notify_role`), `apps/api/services/ai/predictions.py` (edge-triggered HIGH-transition detection, currently not persisted), `supabase/migrations/013_ai_systems.sql` (`room_readiness_predictions` schema), `supabase/migrations/095_room_readiness_acknowledgement.sql` (`is_acknowledged`/`acknowledged_at`/`acknowledged_by`).

---
*Feature research for: batch actions (AI-09) + escalation-to-GM (AI-10), PatelRep next milestone*
*Researched: 2026-08-13*

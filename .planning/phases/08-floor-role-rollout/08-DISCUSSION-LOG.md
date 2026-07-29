# Phase 8: Floor-Role Rollout - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-29
**Phase:** 8-Floor-Role Rollout
**Areas discussed:** Screen migration order, Alert.alert → Toast conversion boundary, Modal/feature-component scope, Bespoke card replacement

---

## Screen migration order

| Option | Description | Selected |
|--------|-------------|----------|
| Traffic-based | My Rooms → Room Board → Work Orders → Tasks → Inspect, matching daily usage frequency | ✓ |
| Risk-based (small→big) | Smallest files first, huge detail screens last | |
| Independent parallel waves | No fixed order, all 5 screens migrate in parallel waves | |

**User's choice:** Traffic-based.

| Option | Description | Selected |
|--------|-------------|----------|
| Together per feature | index.tsx and [id].tsx for the same feature land in the same plan/wave | ✓ |
| List first, detail later | index.tsx migrates first, [id].tsx gets a dedicated later wave | |

**User's choice:** Together per feature.

| Option | Description | Selected |
|--------|-------------|----------|
| Full migration | Every button/card/badge/state-block in the huge detail screens switches to primitives now | ✓ |
| Shell-only | Migrate only obviously-reusable pieces, leave deeply custom layout untouched | |

**User's choice:** Full migration.

---

## Alert.alert → Toast conversion boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Confirm=Alert, feedback=Toast | Confirm/destructive dialogs stay blocking Alert; outcome-reporting alerts become Toast | (Claude's discretion) |
| Convert everything possible | Every Alert.alert becomes Toast unless it's a literal two-button confirm choice | |
| Leave all Alert.alert as-is | Toast is additive only for new feedback; no existing calls change | |

**User's choice:** "Whatever you feel is best — you make all of the decisions." Claude applied the confirm-vs-feedback rule (first option) as the documented decision (D-04), to be applied consistently across all ~24 existing calls rather than re-litigated per instance.

**Notes:** User then confirmed they wanted Claude to decide the two remaining areas as well and move straight to writing CONTEXT.md, rather than continuing question-by-question.

---

## Modal/feature-component scope

Not put to the user directly — decided by Claude per the user's explicit delegation, grounded in codebase tracing (which modals are reachable from which Phase 8 screens).

**Claude's decision:** All 6 modal/feature components reachable from the 5 Phase 8 screens (`CreateWorkOrderModal`, `ReportIssueModal`, `SupplyRequestModal`, `KnockModal`, `FoundItemModal`, `ChecklistSection`) are in scope for primitive migration, consistent with the "full migration" decision already made for the parent screens. This is independent of Phase 7's i18n-gate deferral (D-06) — primitive migration proceeds without adding new `t()` wiring to the 4 gate-excluded files.

---

## Bespoke card replacement

Not put to the user directly — decided by Claude per the user's explicit delegation.

**Claude's decision:** `WorkOrderCard.tsx` and `TaskCard.tsx` get rebuilt on top of `Card` + `StatusBadge` (not just theme-wired in place) — following Phase 7's own stated intent that `WorkOrderCard` is `StatusBadge`'s reference implementation and "isn't migrated yet — that's Phase 8." `RoomQueueCard`'s card-shell usage in `my-rooms/index.tsx` is replaced the same way; `evening.tsx`'s other exports (`StatusPill`, `StatusRail`, `ProgressBar`, `Chip`) are left untouched since they fall outside this phase's screens and the icon+color+label contract.

---

## Claude's Discretion

- Per-`Alert.alert` classification (confirm-vs-feedback) applied call-by-call during planning/execution, not re-asked individually.
- Modal/feature-component migration scope (all 6 reachable modals, D-05/D-06/D-07).
- Bespoke card replacement approach for `WorkOrderCard`/`TaskCard`/`RoomQueueCard` (D-08/D-09/D-10).
- Internal file/component structure for rebuilt cards — deferred to research/planning against `.planning/research/ARCHITECTURE.md`.
- Wave/plan breakdown mechanics — planner's job, informed by the locked ordering constraints (D-01/D-02).

## Deferred Ideas

- i18n gate widening + `t()` wiring for the 4 files Phase 7 excluded — stays Phase 9 (already tracked in ROADMAP.md backlog, reaffirmed here as D-06).
- `room-status/index.tsx` full migration — Phase 9, SCREENS-04 (D-10).
- Standalone Lost & Found screen migration — Phase 9, SCREENS-03.
- Dark mode activation — Phase 10, unchanged boundary.

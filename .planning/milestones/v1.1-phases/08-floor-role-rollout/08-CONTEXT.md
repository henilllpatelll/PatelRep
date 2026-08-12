# Phase 8: Floor-Role Rollout - Context

**Gathered:** 2026-07-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Floor staff (housekeepers, engineers) do their daily work on the 5 highest-traffic mobile screens — My Rooms (list + detail), Room Board, Work Orders (list + detail), Tasks, Inspect — rendered with Phase 7's new primitives (`Button`/`IconButton`, `Card`, `EmptyState`/`StateBlock`, `StatusBadge`, `Toast`), with **no change to underlying behavior**: offline-sync, RBAC, data contracts, and inspection-submission logic all stay exactly as they are today.

This is a **visual/structural migration, not a rebuild** — screens keep their existing data flow, navigation, and business logic; only the presentation layer swaps from the legacy `C` token constant + hand-rolled UI onto `useTheme()` + the shared primitives. Dark mode is still not enabled (Phase 10). i18n gate widening to the 4 files Phase 7 deferred (`CreateWorkOrderModal`, `ReportIssueModal`, `SupplyRequestModal`, `tasks/index.tsx`) is **not** this phase's job — that stays Phase 9's, per the ROADMAP backlog entry.

</domain>

<decisions>
## Implementation Decisions

### Screen migration order
- **D-01:** Screens migrate in traffic/usage-frequency order: My Rooms → Room Board → Work Orders → Tasks → Inspect. This matches actual housekeeper/engineer daily usage (My Rooms is the housekeeper's primary screen) rather than a risk- or file-size-based ordering.
- **D-02:** List+detail pairs migrate together, in the same plan/wave — `my-rooms/index.tsx` + `my-rooms/[roomId].tsx` land together; `work-orders/index.tsx` + `work-orders/[woId].tsx` land together. A screen and its detail view are one coherent user-facing unit, not two separate migrations.
- **D-03:** Full migration depth — every button, card, badge, and loading/empty/error state in every file (including the two huge detail screens: `[roomId].tsx` at 1137 lines, `[woId].tsx` at 970 lines) switches to the new primitives in this phase. No legacy `C`-token/hand-rolled UI is left behind in these 5 screens after Phase 8 closes.

### Alert.alert → Toast conversion boundary
- **D-04 (Claude's discretion, case-by-case):** Alerts that require the user to confirm/choose before a (typically destructive or state-changing) action proceeds stay as blocking `Alert.alert` — no behavior change for anything that currently blocks on a Yes/Cancel choice. Alerts that only report an outcome after the fact (success confirmation, a non-blocking error/status message) convert to the new non-blocking `Toast`. Apply this rule uniformly across all ~24 existing `Alert.alert` calls in these screens (11 in `my-rooms/[roomId].tsx`, 11 in `work-orders/[woId].tsx`, 2 in `inspect/index.tsx`) rather than re-litigating each one individually.

### Modal/feature-component scope
- **D-05:** All modal/feature components reachable from the 5 Phase 8 screens are in scope for primitive migration, not just the top-level screen files: `CreateWorkOrderModal` (from Work Orders), `ReportIssueModal`, `SupplyRequestModal`, `KnockModal`, `FoundItemModal` (all reachable from `my-rooms/[roomId].tsx`), and `ChecklistSection` (from Inspect, via My Rooms room detail). Consistent with D-03's full-migration decision — a screen that looks fully migrated but opens a modal still built from raw `TouchableOpacity`/`C` tokens would be a visibly broken experience.
- **D-06:** This primitive migration is independent of Phase 7's i18n-gate deferral. `CreateWorkOrderModal`, `ReportIssueModal`, `SupplyRequestModal`, and `tasks/index.tsx` stay excluded from the `i18next/no-literal-string` CI gate in this phase (Phase 9 widens the gate and adds `t()` wiring). Phase 8 migrates their buttons/cards/badges onto the new primitives while passing through their existing hardcoded English strings as-is — primitives accept caller-provided strings (per Phase 7 D-04), so this introduces no new literal-string violations and doesn't trigger the (not-yet-widened) gate either way.
- **D-07:** `FoundItemModal`'s "home" screen is Lost & Found (Phase 9, SCREENS-03) but it is also launched directly from `my-rooms/[roomId].tsx` (a housekeeper reporting a found item mid-room) — include it in Phase 8 scope for that call site since My Rooms detail is FLOOR-01. Phase 9 will find it already migrated when it reaches Lost & Found itself.

### Bespoke card replacement
- **D-08:** `WorkOrderCard.tsx` and `TaskCard.tsx` get rebuilt on top of the new `Card` + `StatusBadge` primitives (not just theme-wired in place, keeping their own layout). This was Phase 7's explicit design intent — Phase 7's context notes `WorkOrderCard`'s icon+color pairing as `StatusBadge`'s reference implementation and states "`WorkOrderCard` itself isn't migrated to use it yet — that's Phase 8."
- **D-09:** `RoomQueueCard` (in `components/shared/evening.tsx`, used only in `my-rooms/index.tsx`) gets its card-shell usage on the My Rooms list replaced with the new `Card` + `StatusBadge`. `evening.tsx`'s other exports (`StatusPill`, `StatusRail`, `ProgressBar`, `Chip`) are left untouched in this phase — they aren't part of the icon+color+label triplet contract and may be used by screens outside Phase 8's scope; only touch what these 5 screens actually render.
- **D-10:** `CreateWorkOrderModal` is also rendered by `room-status/index.tsx`, which is **not** a Phase 8 screen (Room Status ships in Phase 9, SCREENS-04). Migrating the modal in Phase 8 is fine and expected — Phase 9 will simply find it already primitive-based when it migrates Room Status itself. Do not scope-creep into migrating `room-status/index.tsx` itself in this phase.
- **D-11 (resolved during `/gsd-plan-phase 8`, 2026-07-29):** FLOOR-05's success criterion in ROADMAP.md mentions "the photo-on-fail prompt," but `08-RESEARCH.md` confirmed `apps/mobile/app/(app)/inspect/index.tsx` has no photo-capture code today (text/checkbox only, zero ImagePicker usage). Asked the user directly during plan-phase (AskUserQuestion, not inferred): user chose to migrate the existing checklist UI as-is onto the new primitives and NOT build new photo-capture functionality, consistent with this phase's "migration not rebuild" boundary. `08-08-PLAN.md` implements this. ROADMAP.md/REQUIREMENTS.md wording still says "photo-on-fail prompt" — that phrasing is stale relative to this decision, left as-is rather than editing locked roadmap text.

### Claude's Discretion
- Exact per-`Alert.alert` classification (D-04) — apply the confirm-vs-feedback rule call-by-call during planning/execution; no need to re-ask the user for each of the ~24 instances.
- Internal file/component structure for the rebuilt `WorkOrderCard`/`TaskCard` (e.g., whether they become thin wrappers around `Card`+`StatusBadge` or are inlined at each call site) — follow whatever `.planning/research/ARCHITECTURE.md` recommends, consistent with Phase 7's precedent.
- Wave/plan breakdown mechanics (how many plans, how they parallelize) — planner's job, informed by D-01/D-02 ordering constraints.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research (completed for this milestone — read first)
- `.planning/research/SUMMARY.md` — executive summary confirming this is a completion/wiring milestone.
- `.planning/research/ARCHITECTURE.md` — recommended project structure, the `useTheme()`/`makeStyles` pattern, the `C`-bridge migration pattern, phased rollout order (P0–P4) that Phases 7–10 map onto.
- `.planning/research/PITFALLS.md` — 9 critical pitfalls; Phase 8 is where Pitfalls 2 (`C` vs. theme dual source cleanup), 8 (role-tab breakage), and the general migration-regression risk become live (Phase 7 was prevention-only).
- `.planning/research/FEATURES.md` — must-have/should-have/do-not-build feature list.
- `.planning/research/STACK.md` — confirms zero new npm dependencies.

### Project & roadmap
- `.planning/PROJECT.md` §"Current Milestone: v1.1 Mobile UI Parity" — milestone goal and locked "shared primitives first" decision.
- `.planning/ROADMAP.md` §"Phase 8: Floor-Role Rollout" — the 5 success criteria (FLOOR-01..05) this phase must satisfy.
- `.planning/REQUIREMENTS.md` — full text of FLOOR-01 through FLOOR-05.
- `.planning/ROADMAP.md` Backlog §"Deferred from Phase 7 to Phase 9 (i18n gate scope)" — the 4 files excluded from the i18n lint gate; Phase 8 must NOT attempt to close this gap (D-06).

### Phase 7 (prior phase — primitives this phase consumes)
- `.planning/phases/07-theme-foundation-primitives/07-CONTEXT.md` — Toast/Button/Card/StatusBadge/EmptyState design decisions (D-01..D-16), including the explicit note that `WorkOrderCard` migration is Phase 8's job.
- `.planning/phases/07-theme-foundation-primitives/07-PATTERNS.md` — established primitive usage patterns from Phase 7's execution.
- `apps/mobile/lib/theme/ThemeProvider.tsx`, `useTheme.ts`, `ToastProvider.tsx`, `useToast.ts` — the reactive theme/toast shell, mounted app-wide.
- `apps/mobile/components/ui/Button.tsx`, `Card.tsx`, `EmptyState.tsx`, `StateBlock.tsx`, `StatusBadge.tsx` — the 5 primitives this phase applies to floor screens.

### Existing code (source of truth for current screens — being migrated, not rebuilt)
- `apps/mobile/app/(app)/my-rooms/index.tsx` (391 lines), `[roomId].tsx` (1137 lines) — FLOOR-01.
- `apps/mobile/app/(app)/room-board/index.tsx` (413 lines) — FLOOR-02.
- `apps/mobile/app/(app)/work-orders/index.tsx` (474 lines), `[woId].tsx` (970 lines) — FLOOR-03.
- `apps/mobile/app/(app)/tasks/index.tsx` (382 lines) — FLOOR-04 (i18n-gate-excluded per D-06).
- `apps/mobile/app/(app)/inspect/index.tsx` (668 lines) — FLOOR-05.
- `apps/mobile/components/engineering/WorkOrderCard.tsx` (316 lines) — rebuild target, D-08.
- `apps/mobile/components/tasks/TaskCard.tsx` (287 lines) — rebuild target, D-08.
- `apps/mobile/components/shared/evening.tsx` — `RoomQueueCard` (D-09; other exports untouched).
- `apps/mobile/components/engineering/CreateWorkOrderModal.tsx` (318 lines, i18n-gate-excluded), `apps/mobile/components/housekeeping/ReportIssueModal.tsx` (336 lines, i18n-gate-excluded), `SupplyRequestModal.tsx` (167 lines, i18n-gate-excluded), `KnockModal.tsx` (121 lines), `FoundItemModal.tsx` (286 lines), `ChecklistSection.tsx` (326 lines) — modal scope, D-05/D-06/D-07.
- `apps/mobile/app/(app)/room-status/index.tsx` — also renders `CreateWorkOrderModal` but is **not** a Phase 8 screen (D-10, out of scope).
- `apps/mobile/lib/navigation/roleTabs.ts` — still frozen for this milestone; do not touch.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- All 5 Phase 7 primitives (`Button`, `IconButton` theme-wire, `Card`, `EmptyState`/`StateBlock`, `StatusBadge`, `Toast`) exist and are ready to consume — this phase is pure application, no new primitive design.
- `WorkOrderCard.tsx`'s existing icon+color convention is already the exact contract `StatusBadge` implements — the migration is closer to a call-site swap than a redesign.

### Established Patterns
- Legacy `C`-constant usage is heavy and inconsistent across these screens (11–112 occurrences per file) — every occurrence in these 5 screens+detail views needs to route through `useTheme()` instead.
- `Alert.alert` currently mixes confirm-dialogs and outcome-reporting in the same call sites (11 each in the two big detail screens) — D-04's confirm-vs-feedback split needs to be applied consistently, not screen-by-screen ad hoc.
- Modals launched from these screens (6 total) share the same legacy styling as their parent screens and should not be left behind when their parent screen is otherwise fully migrated.

### Integration Points
- `CreateWorkOrderModal` is a shared component between Work Orders (Phase 8) and Room Status (Phase 9) — migrating it once in Phase 8 benefits both, but Room Status itself stays out of scope here.
- `FoundItemModal` is shared between My Rooms room detail (Phase 8) and the standalone Lost & Found screen (Phase 9) — same pattern.

</code_context>

<specifics>
## Specific Ideas

- No new visual design work in this phase — it's a call-site swap from legacy styling to the primitives Phase 7 already built and decided the look of.
- The confirm-vs-feedback split for `Alert.alert`→`Toast` (D-04) should read as one consistent rule applied ~24 times, not 24 independent judgment calls with potentially inconsistent outcomes.

</specifics>

<deferred>
## Deferred Ideas

- i18n gate widening + `t()` wiring for `CreateWorkOrderModal`, `ReportIssueModal`, `SupplyRequestModal`, `tasks/index.tsx` — stays Phase 9's job (D-06), already logged in ROADMAP.md backlog.
- `room-status/index.tsx` migration — Phase 9, SCREENS-04 (D-10); Phase 8 only touches `CreateWorkOrderModal` itself, not its Room Status call site's surrounding screen.
- Lost & Found screen migration — Phase 9, SCREENS-03; Phase 8 only touches `FoundItemModal` itself, not the standalone Lost & Found screen.
- Dark mode activation — Phase 10, unchanged from Phase 7's boundary.
- `evening.tsx`'s `StatusPill`/`StatusRail`/`ProgressBar`/`Chip` — left untouched (D-09); no requirement in this phase touches them.

### Reviewed Todos (not folded)
None — `gsd-tools list-todos` returned 0 pending todos at discussion time.

</deferred>

---

*Phase: 8-Floor-Role Rollout*
*Context gathered: 2026-07-29*

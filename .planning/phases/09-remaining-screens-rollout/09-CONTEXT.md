# Phase 9: Remaining Screens Rollout - Context

**Gathered:** 2026-07-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Every remaining mobile screen not covered by Phase 8 is migrated onto Phase 7's shared primitives (`Button`/`IconButton`, `Card`, `EmptyState`/`StateBlock`, `StatusBadge`, `Toast`, `useTheme()`), completing app-wide visual/interaction parity with web. This is the largest phase in the milestone: 13 screen files (~5,600 lines) across 6 requirement categories (SCREENS-01..10) — roughly 3x Phase 8's footprint (5 screens, 17 files).

In scope: Profile; the 5-role home/dashboard family (Housekeeper/FrontDesk/GM inline in `home/index.tsx`, plus `SupervisorHome.tsx`/`EngineerHome.tsx`); Assignments/Scheduling/Staff (supervisor-facing); Assets/PM Schedules (engineering-adjacent); Guest Requests (list+detail)/Lost & Found; Logbook (list+new); SOP (list+detail); AI Copilot; Alerts/Notifications; Room Status. Also in scope (discovered during discussion, not in the original ROADMAP file list): the 7 `components/supervisor/` modal/sheet files, still fully on legacy `C.*`, reachable from Assignments (this phase) as well as Phase 8's already-closed Room Board and Inspect screens.

This is a **visual/structural migration, not a rebuild**, same boundary as Phase 8: existing data flow, navigation, RBAC, and business logic stay exactly as they are — only the presentation layer swaps from `C`/hand-rolled UI onto `useTheme()` + the shared primitives. Dark mode stays disabled (Phase 10).

**Also locked by ROADMAP.md backlog (not re-discussed, inherited as-is):** the i18n gate widening deferred from Phase 7→8→9 — `CreateWorkOrderModal.tsx`, `ReportIssueModal.tsx`, `SupplyRequestModal.tsx`, and `tasks/index.tsx` must get real `t()` wiring with EN+ES keys, and their `ignores` entries must be removed from `apps/mobile/eslint.config.mjs`, widening the `i18next/no-literal-string` gate to full app coverage. This is explicit, non-negotiable backlog scope for this phase — not a gray area needing a decision.

</domain>

<decisions>
## Implementation Decisions

### Screen migration order
- **D-01:** Waves are ordered by usage frequency, same principle as Phase 8's D-01: Profile + the 5-role home/dashboard family first (everyone opens these daily), then supervisor/engineering-adjacent screens (frequent for those roles), then guest-service/logbook/SOP, then AI Copilot/Alerts/Room Status last.
- **D-02:** List+detail pairs migrate together in the same plan/wave, mirroring Phase 8's D-02: `guest-requests/index.tsx` + `[requestId].tsx` together; `sop/index.tsx` + `[sopId].tsx` together.
- **D-03:** Full migration depth everywhere — every button/card/state/badge in all 13 screens (plus the 7 supervisor-modal files, see below) converts fully, no legacy `C` left behind anywhere in scope, matching Phase 8's D-03 and this phase's own success criterion #5 ("no screen still imports C"). The planner has discretion on exact wave/plan count — this phase is ~3x Phase 8's file count and is not expected to fit the same 6-wave shape.
- **D-04 (Room Status):** `room-status/index.tsx` (576 lines) gets a full ground-up migration pass on its own chrome, plus an explicit verification step confirming the `CreateWorkOrderModal` it renders (already primitive-migrated in Phase 8, D-10) still integrates correctly once its parent screen is themed. Not a re-migration of the modal itself — just a consistency check.

### Home/dashboard screen family (SCREENS-02)
- **D-05:** All 5 role dashboards migrate together in one wave, not split across multiple waves by role — mirrors Phase 8's D-02 "coherent unit" logic. SCREENS-02 is one requirement covering one conceptual screen family, even though it spans 4 files: `home/index.tsx` (570 lines, contains `HousekeeperHomeScreen` default export plus inline `FrontDeskHomeScreen`/`GMHomeScreen` functions), `components/home/SupervisorHome.tsx` (405 lines), `components/engineering/EngineerHome.tsx` (637 lines). `components/home/CompanionHome.tsx` (337 lines, housekeeper-only widgets: `FocusCard`/`ShiftMosaic`/`SignalChips`) is included as part of the same wave since it's imported directly into `home/index.tsx`'s housekeeper path.
- **D-06 (Claude's discretion):** Whether to extract `FrontDeskHomeScreen`/`GMHomeScreen` out of `home/index.tsx` into their own component files (matching the `SupervisorHome.tsx`/`EngineerHome.tsx` pattern) is left to the planner. Default toward NOT restructuring — pure presentation-layer swap in place, consistent with the "migration not rebuild" boundary — unless the planner finds a concrete reason the file split materially helps the migration itself.
- Zero `Alert.alert` calls exist anywhere in the home/dashboard family (`home/index.tsx`, `SupervisorHome.tsx`, `EngineerHome.tsx`, `CompanionHome.tsx` all confirmed at 0) — no Toast-conversion work needed for this cluster.

### Cross-phase supervisor-modal gap
- **D-07:** The 7 files in `components/supervisor/` (`atoms.tsx`, `BroadcastModal.tsx`, `DirectMessageModal.tsx`, `EndShiftModal.tsx`, `HousekeeperPicker.tsx`, `RoomDetailSheet.tsx`, `ShiftNoteModal.tsx`) are explicitly IN SCOPE for this phase's Supervisor-facing work (SCREENS-03), even though some are also reachable from Phase 8's already-closed Room Board and Inspect screens. All 7 are confirmed still on legacy `C.*` with zero `useTheme()` calls — Phase 8 did not touch them despite the reachability overlap. Mirrors Phase 8's own D-05/D-07 cross-phase-reachability precedent (e.g. `FoundItemModal` was migrated once in Phase 8 even though its "home" screen was this phase's Lost & Found). Leaving these out would mean Phase 9 closes without satisfying its own success criterion #5.
- **D-08:** `RoomDetailSheet.tsx` (363 lines, 43 `C.*` references — the largest of the 7 supervisor files, comparable in size/reach to a mid-size screen) gets its own dedicated plan rather than being bundled with the 6 smaller supervisor modals (ranging 104-235 lines each).

### AI Copilot & non-standard screens
- **D-09:** `copilot/index.tsx` (425 lines, chat-style UI) is theme-wired in place — its existing message-bubble/input-bar structure stays exactly as designed; only `C.*` colors route through `useTheme()` and buttons/send-icon swap to `Button`/`IconButton` primitives where they fit naturally. No new chat-UI redesign; matches every other screen's "migration not rebuild" boundary. `Card` is explicitly NOT force-fit onto chat bubbles.
- **D-10:** `copilot/index.tsx`'s 6 `Alert.alert` calls follow the same confirm-vs-feedback classification rule as Phase 8's D-04 (blocking confirms stay `Alert.alert`, outcome-reporting converts to `Toast`) — applied call-by-call during research/planning, not re-litigated as a special case despite these alerts touching AI-driven task/work-order/guest-request confirmations.

### Claude's Discretion
- Exact wave/plan count and internal breakdown mechanics (informed by D-01's ordering + D-02's pairing constraints) — this phase will very likely need more plans than Phase 8's 9.
- `home/index.tsx` internal file-split question (D-06).
- Per-`Alert.alert` classification across all 13 screens + the 7 supervisor files (D-10's rule, applied case-by-case) — no need to re-ask for each instance.
- Exact `copilot/index.tsx` bubble/input primitive mapping beyond "no Card force-fit" (D-09) — whatever best fits Button/Toast without an awkward chat-UI compromise.

### Resolved during research (09-RESEARCH.md Open Questions, confirmed post-research 2026-07-30)
- **D-11 (copilot dark theme):** `copilot/index.tsx` is built entirely on hardcoded `darkTheme.*` tokens (intentional dark AI-chat aesthetic), not `C.*` like other screens — 3 keys (`surfaceElevated`/`glass`/`glassBorder`) have no `lightTheme` equivalent. Resolved: **keep dark, minimal migration** — preserve the dark aesthetic as-is; migrate only the 1 real `C.*` ref (`C.alert`→`theme.status.dirty`), convert all 6 `Alert.alert` calls to Toast, adopt `Button`/`IconButton` on send/mic/quick-action/confirm-card controls. No `tokens.ts` changes; `MobileVisualTokens.test.ts` untouched. The `confirmCard` (chat action-confirmation container) may become a `Card` primitive; message bubbles stay as-is (D-09 still forbids force-fitting `Card` onto bubbles).
- **D-12 (i18n gate width):** The mandatory i18n backlog's 22 raw literals (16 JSX-text nodes the `markupOnly:true` gate enforces + 6 placeholder attributes it doesn't) must ALL be wired with `t()` + EN/ES keys. Resolved: **wire all 22, keep the gate narrow** — do not flip `markupOnly` to enforce placeholder/title/aria-label text app-wide; that stays out of this phase's scope.
- **D-13 (criterion #5 scope):** "No screen still imports the legacy `C` token constant" reads as **route/screen files only** — `components/shared/evening.tsx` (a shared-component library, not a screen) may keep importing `C` for its composites (`StatusPill`/`StatusRail`/`ProgressBar`/`Chip`/`AIBriefingCard`/`SectionHeader`), matching Phase 8's precedent. Screens keep calling these composites unchanged; only each screen's own `C.*` refs migrate.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research (completed for this milestone — read first, same as Phase 7/8)
- `.planning/research/SUMMARY.md` — executive summary confirming this is a completion/wiring milestone.
- `.planning/research/ARCHITECTURE.md` — `useTheme()`/`makeStyles` pattern, `C`-bridge migration pattern, phased rollout order.
- `.planning/research/PITFALLS.md` — 9 critical pitfalls; Phase 9 is where the migration-regression risk peaks (largest file count in the milestone) and where Pitfall 8 (role-tab breakage) is most relevant given the multi-role dashboard family.
- `.planning/research/FEATURES.md` — must-have/should-have/do-not-build feature list.
- `.planning/research/STACK.md` — confirms zero new npm dependencies.

### Project & roadmap
- `.planning/PROJECT.md` §"Current Milestone: v1.1 Mobile UI Parity" — milestone goal and locked "shared primitives first" decision.
- `.planning/ROADMAP.md` §"Phase 9: Remaining Screens Rollout" — the 5 success criteria this phase must satisfy.
- `.planning/REQUIREMENTS.md` — full text of SCREENS-01 through SCREENS-10.
- `.planning/ROADMAP.md` Backlog §"Deferred from Phase 7 to Phase 9 (i18n gate scope)" — the mandatory i18n gate-widening + `t()` wiring for the 4 files named in the Phase Boundary section above. Not optional, not re-discussed here.

### Phase 7 & 8 (prior phases — primitives and precedent this phase consumes)
- `.planning/phases/07-theme-foundation-primitives/07-CONTEXT.md` — Toast/Button/Card/StatusBadge/EmptyState design decisions (D-01..D-16).
- `.planning/phases/07-theme-foundation-primitives/07-PATTERNS.md` — established primitive usage patterns.
- `.planning/phases/08-floor-role-rollout/08-CONTEXT.md` — the D-01..D-11 precedents this phase's D-01/D-02/D-03/D-07 directly mirror (ordering, pairing, full-depth, cross-phase modal reachability).
- `.planning/phases/08-floor-role-rollout/08-PATTERNS.md` — exact current prop signatures for `Button`, `Card`, `StatusBadge`, `StateBlock`, the `C.*`→`theme.*` migration map, the `Alert.alert`→`useToast()` classification rule, and the `Pressable`-wraps-`Card` pattern. All directly reusable for this phase's screens — read in full before planning.
- `apps/mobile/components/ui/Button.tsx`, `Card.tsx`, `EmptyState.tsx`, `StateBlock.tsx`, `StatusBadge.tsx` — the 5 primitives this phase applies to all remaining screens.
- `apps/mobile/lib/theme/useTheme.ts`, `useToast.ts` — the reactive theme/toast hooks.

### Existing code (source of truth for current screens — being migrated, not rebuilt)
- `apps/mobile/app/(app)/profile/index.tsx` (539 lines) — SCREENS-01.
- `apps/mobile/app/(app)/home/index.tsx` (570 lines), `components/home/SupervisorHome.tsx` (405), `components/engineering/EngineerHome.tsx` (637), `components/home/CompanionHome.tsx` (337) — SCREENS-02, D-05/D-06.
- `apps/mobile/app/(app)/assignments/index.tsx` (741 lines), `scheduling/index.tsx` (156), `staff/index.tsx` (158) — SCREENS-03.
- `apps/mobile/components/supervisor/atoms.tsx` (235), `BroadcastModal.tsx` (137), `DirectMessageModal.tsx` (118), `EndShiftModal.tsx` (139), `HousekeeperPicker.tsx` (146), `RoomDetailSheet.tsx` (363), `ShiftNoteModal.tsx` (104) — D-07/D-08, all confirmed still on legacy `C.*`.
- `apps/mobile/app/(app)/assets/index.tsx` (296 lines), `pm-schedules/index.tsx` (336) — SCREENS-04.
- `apps/mobile/app/(app)/guest-requests/index.tsx` (277), `[requestId].tsx` (317), `lost-found/index.tsx` (290) — SCREENS-05.
- `apps/mobile/app/(app)/logbook/index.tsx` (206), `logbook/new.tsx` (156) — SCREENS-06.
- `apps/mobile/app/(app)/sop/index.tsx` (133), `sop/[sopId].tsx` (122) — SCREENS-07.
- `apps/mobile/app/(app)/copilot/index.tsx` (425 lines, chat UI, 6 `Alert.alert` calls) — SCREENS-08, D-09/D-10.
- `apps/mobile/app/(app)/alerts/index.tsx` (177), `notifications/index.tsx` (152) — SCREENS-09.
- `apps/mobile/app/(app)/room-status/index.tsx` (576 lines) — SCREENS-10, D-04.
- `apps/mobile/components/engineering/CreateWorkOrderModal.tsx` — already primitive-migrated (Phase 8), rendered by `room-status/index.tsx`; D-04 verification target only, not a re-migration.
- `apps/mobile/app/(auth)/login.tsx` — also imports `tokens.ts`/`C`, but is explicitly OUT of scope (not in SCREENS-01..10, not covered by success criterion #5's "every screen" claim — auth screens were never in this milestone's target feature list per PROJECT.md).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- All 5 Phase 7 primitives plus the exact `C.*`→`theme.*` migration map, `Pressable`-wraps-`Card` pattern, and `Alert.alert`→`Toast` classification rule are already fully documented in `08-PATTERNS.md` — this phase applies the same contracts, no new primitive design work.
- `SupervisorHome.tsx`/`EngineerHome.tsx` already exist as separate component files (unlike the inline `FrontDeskHomeScreen`/`GMHomeScreen` in `home/index.tsx`) — useful precedent if D-06's file-split question resolves toward extraction.

### Established Patterns
- Legacy `C`-constant usage is present in all 13 in-scope screen files plus the 7 supervisor-modal files and `home/index.tsx`'s 3 inline dashboard functions — every occurrence routes through `useTheme()` per the same migration map Phase 8 used.
- `Alert.alert` usage is uneven across this phase's scope: heaviest in `copilot/index.tsx` (6) and `room-status/index.tsx` (5); `assets/index.tsx` (3); single calls in `profile/index.tsx`, `pm-schedules/index.tsx`, `lost-found/index.tsx`; zero in the entire home/dashboard family, `scheduling/index.tsx`, `staff/index.tsx`, `guest-requests` (both files), `logbook` (both files), `sop` (both files), `alerts/index.tsx`, `notifications/index.tsx`.
- The `components/supervisor/` directory was not on Phase 8's or Phase 9's original file list in ROADMAP.md/REQUIREMENTS.md — it surfaced only during this discussion's codebase scout (grep for all `tokens.ts` importers). Treat this as a real scope addition, not an oversight to silently skip.

### Integration Points
- `room-status/index.tsx` renders the already-migrated `CreateWorkOrderModal` (D-04) — the one direct integration point between this phase and Phase 8's work.
- `RoomDetailSheet.tsx` and other supervisor components are opened from Room Board (Phase 8) and Inspect (Phase 8) in addition to this phase's Assignments — migrating them here benefits all three call sites.

</code_context>

<specifics>
## Specific Ideas

- No new visual design work in this phase — same as Phase 8, it's a call-site swap onto primitives Phase 7 already built and decided the look of.
- Chat UI in `copilot/index.tsx` should NOT be forced into `Card` styling just for consistency — a chat bubble is not a card, and D-09 explicitly protects against that mistake.

</specifics>

<deferred>
## Deferred Ideas

- Dark mode activation — Phase 10, unchanged from Phase 7/8's boundary.
- `apps/mobile/app/(auth)/login.tsx`'s legacy `C`/`tokens.ts` usage — out of scope entirely; not part of any SCREENS-XX requirement or this milestone's target feature list.
- Any further `evening.tsx` exports beyond what Phase 8 already excluded (`StatusPill`/`StatusRail`/`ProgressBar`/`Chip`) — no requirement in this phase touches them either.

### Reviewed Todos (not folded)
None — `gsd-tools list-todos` returned 0 pending todos at discussion time.

</deferred>

---

*Phase: 9-Remaining Screens Rollout*
*Context gathered: 2026-07-30*

# Phase 35: Engineering Section Chrome - Context

**Gathered:** 2026-08-18
**Status:** Ready for planning
**Mode:** Autonomous (user delegated discuss+plan+execute end-to-end for this phase, same as Phase 34; no AskUserQuestion prompts, decisions made from Phase 30/33/34 precedent + codebase scout)

<domain>
## Phase Boundary

ENG-01 — the Engineering section's surrounding chrome (PageHeader, tabs/actions, and the work-orders/assets/pm-schedules/predictions pages) is redesigned on the new visual system, including non-happy-path states, while `EngineeringRoomBoard` renders visually and functionally identical inside the new chrome (Room-Board pixel-diff against the Phase-30 baseline must pass). This is a "chrome" phase like the not-yet-done Phase 36 (Housekeeping), structurally different from Phase 33/34's "content" phases: the redesign wraps AROUND a frozen, must-not-change component rather than redesigning a page's own primary content.

</domain>

<decisions>
## Implementation Decisions

### Flag key

One new flag, `engineering` (camelCase, matches existing `tasks`/`sop`/`safety`/.../`integrations`/`aiCopilot` convention — confirmed unused/unregistered anywhere in production code today, only appears as a negative-case string in `redesignFlag.test.mjs`). Unlike Phase 34's Settings sub-pages (which each got their own flag because they're independently-scoped SEC-01b items), Engineering is ONE requirement (ENG-01) covering all 4 pages as a single section — so all 4 pages read `isSectionRedesigned('engineering', hotel)` under the SAME flag, consistent with how Reports' 5 tabs shared one `reports` flag in Phase 34's 34-02.

### No shared layout.tsx — thread the flag per page

Confirmed (scout): there is no `engineering/layout.tsx` (unlike `settings/layout.tsx`). Each of the 4 pages (`work-orders/page.tsx` 522 LOC, `assets/page.tsx` 1120 LOC, `pm-schedules/page.tsx` 967 LOC, `predictions/page.tsx` 849 LOC) already independently imports and renders its own `PageHeader`. Decision: each page reads the `engineering` flag itself (no new layout file introduced) and applies v2 treatment to its own `PageHeader`/chrome/states — same "read once, thread via ternary/early-return" pattern used throughout Phase 32-34, just applied 4 times instead of via one shared shell.

### EngineeringRoomBoard — chrome only, zero internal changes

`EngineeringRoomBoard` renders only inside `work-orders/page.tsx`, as one of 3 tabs (`work-orders` / `room-board` / `archived`) on that single page, rendered completely bare (`{activeTab === 'room-board' ? <EngineeringRoomBoard /> : ...}`, no wrapping card/div today). It is content-hash-frozen in `apps/web/frozen-files.json` (`EngineeringRoomBoard.tsx`) — same class of file as Phase 30's other 3 frozen Room-Board files. Decision:
- The `PageHeader`/tab-bar chrome ABOVE `EngineeringRoomBoard` can be freely restyled with v2 tokens.
- `<EngineeringRoomBoard />` itself is NOT touched, NOT wrapped in a new StateBlock/Skeleton (it manages its own loading/empty/error internally, using its own already-i18n'd `engineering.roomBoard.*` keys — confirmed pre-existing), and its frozen hash must not change.
- The Room-Board pixel-regression harness (established Phase 30, re-run every close-out since) is the load-bearing safety net here — wave 3 close-out MUST re-run it, same as every prior phase, with extra attention since this phase's chrome sits directly adjacent to the frozen component for the first time (Phase 32-34 never rendered a frozen board on the same page).

### Loading/empty/error pattern (identical established convention)

- None of the 4 pages currently use the shared `StateBlock`/`Skeleton`/`EmptyState` primitives — all use bespoke hand-rolled `animate-pulse` divs and inline `AlertTriangle`+retry blocks. Convert these to the shared primitives, same skeleton-not-spinner convention as Phase 32-34.
- Predictions page currently has NO explicit error UI (no `isError` destructured) — this is a genuine gap, add one wired to that query's own `refetch()`, not a new query (same "extend destructuring, wire onRetry to existing refetch" pattern as every prior phase).
- Work-orders' `room-board` tab is explicitly OUT of this treatment (see above — EngineeringRoomBoard owns its own states). The `work-orders` and `archived` tabs on that same page ARE in scope for the shared-primitive conversion.
- Modals (`CreateWorkOrderModal`, `BulkArchiveModal`, `WorkOrderDetailDrawer`, the inline assets create/edit modal, `PMCompletionModal`) get the same "close a genuine gap only, don't do a ground-up rewrite" treatment Phase 34 applied to Staff's 4 modals — visual v2-token polish plus fixing any modal-level query with literally no loading/error UI today; full redesign of every modal's internals is not required by this phase's goal (which names "PageHeader, tabs, and the ... pages," not modals specifically).

### i18n

- `engineering` namespace already exists and is substantial (`workOrderCard`, `workOrderDetail`, `createWorkOrder`, `workOrderList`, `roomBoard`, `failurePrediction`, `assetsPage`, `predictionsPage`, `workOrdersPage`) in both `en.ts`/`es.ts`, line-aligned (~357 lines, starting ~line 973) — confirming existing parity discipline. This phase EXTENDS it additively (new loading/empty/error copy for the now-shared-primitive states) rather than creating it fresh, unlike every Phase 34 section.
- **Naming inconsistency confirmed, decision made:** `pm-schedules/page.tsx` does NOT use an `engineering.pmSchedulesPage.*` namespace — it reuses a pre-existing `programs.pmSchedules.*` namespace (also line-aligned in both locale files) built for a Programs-section PM view. Decision: **keep reusing `programs.pmSchedules.*` for existing copy** (title, existing labels) — do NOT migrate/rename into a new `engineering.pmSchedulesPage.*` namespace. Migrating working, already-correct translations is unnecessary churn with no user-facing benefit and risks breaking the Programs section's own (already-shipped, Phase-33-verified) usage of the same keys if a migration is done carelessly. Only genuinely NEW copy this phase introduces for the pm-schedules page's states (if `programs.pmSchedules.*` doesn't already have a matching key) gets added under `programs.pmSchedules.*` additively, keeping the single-namespace convention for that page intact.
- Every new empty/error/loading string introduced in this phase (for work-orders/archived-tab, assets, predictions) goes under the existing `engineering.*` namespace's relevant sub-key (extend `workOrdersPage`, `assetsPage`, `predictionsPage`) — single wave-1-owner-of-locale-files pattern from Phase 33/34 applies again: one plan is sole editor of `en.ts`/`es.ts` for this phase, all content plans consume read-only.

### Frozen/careful files

- `apps/web/components/engineering/EngineeringRoomBoard.tsx` — frozen (content-hash), zero changes, confirmed via `apps/web/frozen-files.json`.
- `RoomCard.tsx`/`RoomDetailDrawer.tsx` (used inside `EngineeringRoomBoard`) — also frozen from Phase 30, not directly touched by this phase but transitively relevant: any global token/theme change this phase might be tempted to make must not alter the CSS custom properties these components read (`--alert`/`--info`/`--ready`/etc. room-status colors), or the Room-Board pixel-diff harness fails.
- `WorkOrderDetailDrawer.tsx`, `CreateWorkOrderModal.tsx`, `BulkArchiveModal.tsx`, `PMCompletionModal.tsx`, `FailurePredictionSidebar.tsx` — not frozen, but treat with the same "touch only to close a genuine gap, don't rewrite" discipline as Phase 34's Staff modals.

### RBAC — zero behavior change

- Web-route gate (`ROLE_ROUTE_RULES`, `routeGuard.ts`): `/engineering` prefix allows `gm`/`engineer`/`chief_engineer`/`housekeeping_supervisor`, but `engineer` is also in `MOBILE_ONLY_ROLES` and is redirected off all non-public web routes before that rule is even consulted — so in practice only `gm`/`chief_engineer`/`housekeeping_supervisor` reach these pages on web today. This is pre-existing, out of scope, do not change.
- Each page has its own local `isEngineer`/`canManage`/`canEdit` boolean (via `useRole()`) gating action-button visibility (Create/Archive/AI-Triage/Add). These per-page role checks are preserved EXACTLY — v2 treatment restyles the buttons/chrome, never changes which role sees which action. Same "zero behavior change" bar as every prior phase.
- The `engineer` role's dead-on-web `isEngineer` checks are NOT to be "cleaned up" or removed by this phase (out of scope, potentially load-bearing for some other path not investigated here) — leave exactly as-is.

### Sidebar tab navigation — out of scope

Switching between work-orders/assets/pm-schedules/predictions happens via the Phase-31-redesigned sidebar `subNav` (`apps/web/lib/utils/navigation.ts` + `Sidebar.tsx`), NOT a `PageHeader` tabs prop (only `work-orders` itself uses `tabs`, for its own internal 3-way work-orders/room-board/archived split). The sidebar subNav is already redesigned (Phase 31) and out of this phase's boundary. `MobileFloorNav.tsx` currently only lists `work-orders` among the 4 sub-routes (assets/pm-schedules/predictions absent) — this is a pre-existing gap belonging to nav/mobile-shell work, not this phase; do not fix it here, note as a deferred idea.

### Claude's Discretion

- Exact plan/wave shape — left to gsd-planner. Given each of the 4 pages is independently substantial (500-1120 LOC) and none share a file, a natural shape mirrors Phase 34: wave 1 = i18n-foundation plan (extends `engineering.*`/`programs.pmSchedules.*` additively, sole owner of both locale files for this phase), wave 2 = up to 4 parallel content plans (one per page, or grouped by effort if some pages are small enough to bundle — planner's call using RESEARCH.md's precise LOC/complexity findings), wave 3 = close-out verification with EXTRA emphasis on the Room-Board regression re-pass given this phase renders chrome directly adjacent to the frozen board for the first time.
- Whether work-orders' 3-tab restyle (tab bar itself, not the room-board tab's content) is its own plan or bundled with the rest of work-orders' redesign — planner's call.
- Exact new i18n key names for the states being converted from bespoke markup to shared primitives — planner/implementer's call, following the existing `engineering.<page>Page.*` sub-key convention already established for 3 of the 4 pages.

</decisions>

<specifics>
## Specific Ideas

No specific visual references given — inherits the same v2 visual system verbatim (tokens: `duration-fast`/`ease-standard`/`focus-visible:ring-[var(--focus-ring)]`/`bg-brand`/`--brand-soft`/`--focus-ring`, shared `PageHeader`/`StateBlock`/`Skeleton`/`EmptyState` components). No new component primitives expected.

</specifics>

<deferred>
## Deferred Ideas

- `MobileFloorNav.tsx`'s missing subNav entries for assets/pm-schedules/predictions (only work-orders present) — belongs to nav/mobile-shell work, not this chrome phase.
- Migrating `pm-schedules/page.tsx`'s copy from `programs.pmSchedules.*` into a new `engineering.pmSchedulesPage.*` namespace for naming consistency with the other 3 pages — deliberately not done this phase (unnecessary churn/risk); could be a future cleanup item if it ever becomes confusing in practice.
- Full ground-up redesign of Engineering's modals (`CreateWorkOrderModal`, `WorkOrderDetailDrawer`, `PMCompletionModal`, etc.) beyond gap-closing — out of this phase's boundary per its own stated goal (chrome + pages, not modals).
- bug-965 (from Phase 34's 34-08 close-out): `StateBlock` error messages are systemically vulnerable to the same `domTranslations.ts` EN/ES mangling as `PageHeader` — flagged for a dedicated future hardening phase, NOT this phase's job to fix app-wide, but this phase's own NEW `StateBlock` error usages should proactively apply whatever mitigation pattern that future phase settles on if it lands first, or at minimum get live EN/ES verified at this phase's own close-out (same as every prior phase already does).

</deferred>

---

*Phase: 35-engineering-section-chrome*
*Context gathered: 2026-08-18*

# Phase 36: Housekeeping Section Chrome - Context

**Gathered:** 2026-08-19
**Status:** Ready for planning
**Mode:** Autonomous (user delegated discuss+plan+execute end-to-end for this phase; no AskUserQuestion prompts, decisions made from Phase 30/31/35 precedent + codebase scout)

<domain>
## Phase Boundary

HSK-01 — the Housekeeping section's surrounding chrome is redesigned on the new visual system while `RoomStatusBoard`/`RoomDetailDrawer` render unchanged inside it and Supabase Realtime sync stays live. Per the ROADMAP's own success-criteria wording (PageHeader, sync badge, date/shift controls, housekeeper "my rooms" list — no mention of assignments/inspections/rooms sub-routes), this phase's scope is exactly one file: `apps/web/app/(dashboard)/housekeeping/page.tsx` (791 LOC) and the two chrome components it renders around the frozen board (`AssignmentSidebar.tsx`, `PredictionPanel.tsx`). This is a "chrome" phase like Phase 35 (Engineering): the redesign wraps AROUND a frozen, must-not-change board component rather than redesigning a page's own primary content — but narrower in scope than Phase 35 (1 file, not 4 pages), matching the ROADMAP's own narrower success-criteria list for HSK-01 vs ENG-01.

</domain>

<decisions>
## Implementation Decisions

### Flag key

One new flag, `housekeeping` (camelCase, matches `tasks`/`engineering`/`safety`/`sop`/.../`aiCopilot` convention — confirmed unused/unregistered anywhere in production code today via full-codebase grep of `isSectionRedesigned(`). Single flag for the single HSK-01 requirement, same as `engineering` covered all of ENG-01 under one flag in Phase 35.

### Scope: `housekeeping/page.tsx` only — sub-routes explicitly out of scope

Confirmed (scout): the `/housekeeping` route group also contains `assignments/page.tsx` (248 LOC), `inspections/page.tsx` (559 LOC), and `rooms/page.tsx` (861 LOC) — none have been touched by any prior phase (checked Phase 33's SEC-01 batch a and Phase 34's SEC-01 batch b requirement lists; neither names them). However, the ROADMAP's HSK-01 success criteria for Phase 36 explicitly enumerate only "PageHeader, sync badge, date/shift controls, and the housekeeper 'my rooms' list" — all four live inside `housekeeping/page.tsx` alone. Decision: **do not touch `assignments/`, `inspections/`, or `rooms/` sub-pages this phase** — treat their redesign as an unplanned gap for a future phase, not silently expand HSK-01's boundary. Recorded in `<deferred>` below.

### No shared layout.tsx — flag threaded directly in the one page file

Confirmed (scout): there is no `housekeeping/layout.tsx`. `housekeeping/page.tsx` is a single client component file containing multiple named function components: `SyncBadge`, `HousekeeperBar` (assign-mode chip bar), `HousekeeperRoomItem` (my-rooms list row), `HousekeeperMyRoomsView` (housekeeper role's own page), `SupervisorHousekeepingPage` (gm/housekeeping_supervisor/front_desk board view), and the default-exported `HousekeepingPage` role router. Decision: the flag is read once inside the default-exported `HousekeepingPage` router (or threaded to both `HousekeeperMyRoomsView` and `SupervisorHousekeepingPage`, planner's call) — same "read once, thread via ternary/early-return" pattern used throughout Phase 31-35, applied within a single file instead of across multiple page files.

### RoomStatusBoard / RoomDetailDrawer / RoomCard — chrome only, zero internal changes

All three are content-hash-frozen in `apps/web/frozen-files.json` (confirmed): `RoomCard.tsx`, `RoomStatusBoard.tsx`, `RoomDetailDrawer.tsx` — the same class of files as Phase 30's frozen Room-Board set, and the exact files this phase's own success criteria names as "render unchanged." Decision:
- `<RoomStatusBoard />` (rendered bare inside `SupervisorHousekeepingPage`, wrapped only in a `Suspense` boundary with no fallback) is NOT touched, NOT given a new wrapping card/Skeleton, and its frozen hash must not change.
- `<RoomDetailDrawer />` (rendered in both `HousekeeperMyRoomsView` and — internally, unseen by this file — inside `RoomStatusBoard`) is NOT touched.
- The Room-Board pixel-regression harness (established Phase 30, re-run every close-out since) is the load-bearing safety net — the close-out wave MUST re-run it, same as every prior chrome/content phase.

### AssignmentSidebar and PredictionPanel — chrome components, IN scope for v2 restyle

Unlike the frozen board trio, `AssignmentSidebar.tsx` (97 LOC) and `PredictionPanel.tsx` (563 LOC) are NOT in `frozen-files.json` — they are chrome that renders alongside/above the board (assignment-mode sidebar; risk-alert panel above the board) and are explicitly analogous to Phase 35's non-frozen `FailurePredictionSidebar` treatment. Decision: restyle both with v2 tokens and convert their loading/error states to shared primitives, same "close a genuine gap, don't rewrite" discipline as every prior phase's modal/sidebar work. `PredictionPanel`'s action-confirmation flows (reassign/escalate/acknowledge — the same Room-Readiness one-click actions from Phase 27) are preserved exactly; this phase changes visuals only.

### Loading/empty/error pattern (identical established convention)

- `HousekeeperMyRoomsView`'s board query (`isLoading` destructured, no `isError`) has a genuine gap: no error UI at all today if the query fails — same class of gap as Phase 35's Predictions page. Add an error state wired to the existing query's own `refetch`, following the "extend destructuring, wire onRetry to existing refetch" pattern, not a new query.
- `HousekeeperMyRoomsView`'s loading state is a bespoke `animate-pulse` div list (3 skeleton rows) — convert to the shared `Skeleton` primitive (`@/components/ui/Skeleton`). Its empty state (`myRooms.emptyTitle`/`emptySubtitle`, plain centered text) — convert to the shared `EmptyState` primitive (`@/components/ui/EmptyState`).
- `HousekeeperBar`'s staff-list query (`useQuery` with `isLoading` destructured at line ~92) — check for a matching `isError` gap during planning/implementation; if absent, close it the same way.
- The role-loading guard in the default-exported `HousekeepingPage` (bespoke `animate-pulse` skeleton blocks while `isAuthLoading || !role`) — convert to shared `Skeleton` primitive for consistency, same treatment Phase 32 gave dashboard-home auth-loading skeletons.
- `PredictionPanel`'s own `isLoading` prop (passed from `SupervisorHousekeepingPage`'s `fetchPredictions`, which silently swallows fetch errors — "predictions are optional") — this silent-failure design is intentional (non-critical enrichment data) and stays as-is; only convert its visual loading treatment to shared primitives, do not add new error UI where the code deliberately has none today.

### i18n

- `housekeeping.page.*` namespace already exists and is substantial (`shifts`, `sync`, `assignBar`, `roomItem`, `myRooms`, `board`, `noAccess`) in both `en.ts`/`es.ts`, line-aligned (~65 lines, starting ~line 732) — this phase EXTENDS it additively (new loading/error copy for the now-shared-primitive states) rather than creating it fresh.
- New error copy should follow the existing `housekeeping.roomStatus.error.*` naming convention already established in the same top-level `housekeeping` namespace (`failedToLoad`/`retry`/`dismiss`) for consistency — e.g. `page.myRooms.loadError` mirroring that shape, exact key name left to planner/implementer.
- `assignmentSidebar.*` and `predictionPanel.*` sub-namespaces (both already exist under `housekeeping.*`, confirmed in scout) already carry most copy needed for those two components' existing states — extend additively only for genuinely new error/loading copy, no restructuring of existing keys.
- Single wave-1-owner-of-locale-files pattern from Phase 33/34/35 applies: one plan is sole editor of `en.ts`/`es.ts` for this phase, all content plans consume read-only.

### Frozen/careful files

- `apps/web/components/housekeeping/RoomCard.tsx`, `RoomStatusBoard.tsx`, `RoomDetailDrawer.tsx` — frozen (content-hash in `apps/web/frozen-files.json`), zero changes.
- `AssignmentSidebar.tsx`, `PredictionPanel.tsx` — not frozen, but treat with the same "touch only to close a genuine gap, don't rewrite" discipline as Phase 34/35's modals/sidebars.
- Realtime subscription logic itself (the `hk_my_rooms_realtime` channel setup in `HousekeeperMyRoomsView`, and whatever `RoomStatusBoard` does internally) is NOT touched — only the `SyncBadge` chrome that visually surfaces "Live" status is redesigned. Zero behavior change to the subscription/invalidation logic, consistent with this phase's own success criterion that Realtime sync stays live throughout and after the redesign.

### RBAC — zero behavior change

- Web-route gate (`ROLE_ROUTE_RULES` in `routeGuard.ts`): `/housekeeping` prefix allows `gm`/`housekeeping_supervisor`/`housekeeper`/`front_desk`. But `housekeeper` is also in `MOBILE_ONLY_ROLES` (alongside `engineer`, confirmed same set Phase 35 already noted) and is redirected off all non-public web routes before that rule is even consulted — so in practice only `gm`/`housekeeping_supervisor`/`front_desk` reach `SupervisorHousekeepingPage` on web today, and `HousekeeperMyRoomsView` is effectively unreachable on web in production (its logic exists for defense-in-depth / potential future web access, mirroring Phase 35's `EngineerDashboard` finding). This is pre-existing, out of scope, do not change — but the ROADMAP explicitly names "the housekeeper 'my rooms' list" in HSK-01's success criteria, so it still gets full v2 visual treatment despite the web-unreachability, same as Phase 32 restyled `EngineerDashboard` despite the identical mobile-only situation.
- `canAssignRooms` (from `useRole()`) gates the assign-mode toggle button, the `HousekeeperBar` chip bar, and the `AssignmentSidebar` panel's visibility. Preserved EXACTLY — v2 treatment restyles the button/bar/sidebar, never changes which role sees which action.
- `role !== 'gm' && role !== 'housekeeping_supervisor' && role !== 'front_desk'` no-access branch (bespoke centered text, not yet using `EmptyState`) — convert to shared primitive for visual consistency, condition unchanged.

### Claude's Discretion

- Exact plan/wave shape — left to gsd-planner. Given this phase touches one 791-LOC page file plus two smaller chrome components (unlike Phase 35's four independent page files), a natural shape is smaller than Phase 35: likely 1 i18n+small-restyle combined plan or a 2-plan split (chrome/board-view restyle + my-rooms/housekeeper-view restyle) plus a close-out verification wave — planner's call using RESEARCH.md's findings.
- Whether the i18n extension is its own tiny plan or folded into wave 1 of the restyle work, given how small the additive key set is compared to Phase 33-35's from-scratch namespaces — planner's call.
- Exact new i18n key names — planner/implementer's call, following the existing `housekeeping.<subarea>.*` sub-key convention already established.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `@/components/shared/PageHeader`, `@/components/ui/Button`, `@/components/ui/Card`, `@/components/ui/primitives` (`Pill`) — already imported and used throughout the file today (pre-v2 usage); same primitives Phase 30-35 extended with v2 variants.
- `@/components/ui/StateBlock`, `@/components/ui/Skeleton`, `@/components/ui/EmptyState` — the shared primitives established Phase 30, used by every content/chrome phase since (33/34/35) to replace bespoke `animate-pulse`/centered-text markup.
- Room-status CSS custom properties (`--alert-soft`/`--progress-soft`/`--ready-soft`/`--caution-soft`/`--info-soft`/`--blocked-soft` + matching `-line` border variants) are ALREADY in use in `HousekeeperRoomItem`'s `statusConfig` map — these are the frozen room-status value tokens from Phase 30's token freeze, not v2-exclusive, safe to keep using verbatim (do not touch — they're shared with the frozen `RoomCard`).

### Established Patterns
- Flag-gate via `isSectionRedesigned(key, hotel)` reading `hotel.web_redesign_sections` (from `useHotelStore`/`hotelStore`, confirmed used the same way across all 20+ prior gated files) — this file currently has NO `hotelStore`/`isSectionRedesigned` import at all; it will be a net-new import, same pattern as every prior phase's first touch of a page.
- `RedesignGate` wraps the shell (`DashboardShell.tsx`) already under the `shell` flag from Phase 31 — Housekeeping's own `housekeeping` flag is independent and additive on top of that, same layering as every content-phase flag.

### Integration Points
- `useHousekeepingStore` (Zustand) owns `selectedDate`/`selectedShift`/`assignmentMode`/`lastSyncedAt`/`rooms` — state management untouched, only the chrome reading/rendering it changes.
- `useRole()` → `{ role, canAssignRooms }` — RBAC source of truth, untouched.
- `useAuthStore` → `isLoading` — used for the role-loading guard skeleton.

</code_context>

<specifics>
## Specific Ideas

No specific visual references given — inherits the same v2 visual system verbatim (tokens: `duration-fast`/`ease-standard`/`focus-visible:ring-[var(--focus-ring)]`/`bg-brand`/`--brand-soft`/`--focus-ring`, shared `PageHeader`/`StateBlock`/`Skeleton`/`EmptyState` components). No new component primitives expected.

</specifics>

<deferred>
## Deferred Ideas

- `housekeeping/assignments/page.tsx`, `housekeeping/inspections/page.tsx`, `housekeeping/rooms/page.tsx` — none redesigned by any prior phase (not in Phase 33's or Phase 34's SEC-01 batch lists) and not named in HSK-01's success criteria either. These remain on the pre-v2 visual system after Phase 36 closes — a genuine roadmap gap, belongs in its own future phase (not silently absorbed into HSK-01's narrower, ROADMAP-defined scope).
- `apps/web/app/(dashboard)/settings/housekeeping/page.tsx` (cleaning checklists settings) — separate route already covered under the `settings` flag territory from Phase 34, not this phase's concern.
- Any deeper investigation into whether `HousekeeperMyRoomsView`'s web-unreachability (per `MOBILE_ONLY_ROLES`) means it should eventually be deleted from the web bundle entirely — out of scope, same "leave exactly as-is" call Phase 35 made for the analogous `engineer` dead-web-code finding.

</deferred>

---

*Phase: 36-housekeeping-section-chrome*
*Context gathered: 2026-08-19*

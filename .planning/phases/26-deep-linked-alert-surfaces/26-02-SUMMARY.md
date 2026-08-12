---
phase: 26-deep-linked-alert-surfaces
plan: 02
subsystem: ui
tags: [nextjs, react, suspense, deep-linking, useSearchParams, ai-copilot, housekeeping, engineering]

# Dependency graph
requires:
  - phase: 26-deep-linked-alert-surfaces
    provides: "Plan 26-01's `id` field added to get_risk_alerts()'s asset_risks select, exposed as maintenance_risks[].id"
provides:
  - "AIRiskAlertsPanel housekeeping rows link to /housekeeping?room={room_id} instead of a generic /housekeeping link"
  - "AIRiskAlertsPanel maintenance rows gain a brand-new View link to /engineering/predictions?asset={id} (previously no link existed)"
  - "RoomStatusBoard reads ?room= and opens the exact room's RoomDetailDrawer, matching against the unfiltered displayRooms so active board filters never block the deep link"
  - "Engineering predictions page split into PredictionsPageContent/PredictionsPage (Suspense-wrapped), reads ?asset=, scrolls to and highlights the target card for ~3s, resetting risk/status filters only when the target would otherwise be hidden"
affects: [27-room-readiness-one-click-reassign-escalate-acknowledge]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Content/Page Suspense split for useSearchParams: rename the page body to `{Name}Content`, wrap it in a new default-export `{Name}` that renders `<Suspense><{Name}Content /></Suspense>` (mirrors apps/web/app/(dashboard)/tasks/page.tsx)"
    - "Deep-link match against the unfiltered/normalized list (displayRooms), never the UI-filtered list (rooms), so query-param navigation is immune to whatever filter chips happen to be active"
    - "Ref-forwarding via a wrapping <div ref={...}> when the target component (Card) is a plain function component, not React.forwardRef"

key-files:
  created: []
  modified:
    - apps/web/lib/api/ai.ts
    - apps/web/components/dashboard/AIRiskAlertsPanel.tsx
    - apps/web/components/housekeeping/RoomStatusBoard.tsx
    - apps/web/app/(dashboard)/housekeeping/page.tsx
    - apps/web/app/(dashboard)/engineering/predictions/page.tsx

key-decisions:
  - "Removed a plan-specified eslint-disable-next-line react-hooks/exhaustive-deps comment on the scroll/highlight effect — ESLint flagged it as an unused directive since that effect's [filtered, highlightedId] deps were already exhaustive; kept the one on the deep-link-resolution effect, which genuinely omits setRiskFilter/setStatusFilter (stable setters) and allPredictions/searchParams-driven re-runs by design"
  - "Verified live browser behavior against real Supabase-backed data using a real room_id (from /v1/housekeeping/board) and a real asset_id (from /v1/assets/failure-predictions/history) fetched via curl with the session's own bearer token, since the live dashboard's AI Risk Alerts panel currently has 0 housekeeping_risks and 0 maintenance_risks rows for this tenant (only SLA-breach alerts are present) — direct URL navigation to both destination routes proves the same code path the panel's generated hrefs would drive"
  - "Proved the filter-survives-deep-link truth (both surfaces) live by clicking a filter chip first, then updating the URL via history.pushState + a synthetic popstate event (Next.js App Router's client-side router intercepts and re-renders on this) rather than a full page reload — a full reload would reset the filter Zustand state to its default before the deep-link effect ever ran, since AIRiskAlertsPanel's links are plain <a href> full-page navigations by design"

# Metrics
duration: 14min
completed: 2026-08-12
---

# Phase 26 Plan 02: Deep-Linked Alert Surfaces (Frontend) Summary

**Both `AIRiskAlertsPanel` rows now carry working deep links — housekeeping opens the exact room's drawer, maintenance opens and highlights the exact asset's prediction card — with both new `useSearchParams()` call sites Suspense-wrapped and the production build passing.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-08-12T21:10:00Z
- **Completed:** 2026-08-12T21:24:09Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- `RiskAlerts.maintenance_risks` typed with `id: string`; housekeeping row `Reassign` link now points to `/housekeeping?room={room_id}`; new maintenance row `View` link (previously absent) points to `/engineering/predictions?asset={id}`, styled identically to the existing SLA-breach row's `View` link.
- `RoomStatusBoard` reads `?room=` via `useSearchParams`, matches against the unfiltered/normalized `displayRooms` (never the UI-filtered `rooms`), and opens `RoomDetailDrawer` via the existing `setSelectedRoom` — confirmed live that the drawer opens even while a status filter chip that would otherwise hide the room is active.
- `apps/web/app/(dashboard)/engineering/predictions/page.tsx` split into `PredictionsPageContent` (all existing logic plus the new deep-link effects) and a Suspense-wrapped default-export `PredictionsPage`, mirroring the live `tasks/page.tsx` pattern. `PredictionCard` gained optional `cardRef`/`isHighlighted` props, applied via a wrapping `<div ref={cardRef}>` since `Card` is a plain component, not `forwardRef`.
- `?asset=` resolves against `allPredictions`, resets `riskFilter`/`statusFilter` to `'all'` only when the target isn't already visible under the current filters, scrolls the card into view once it's confirmed present in the filtered DOM output, and applies a `ring-2 ring-[var(--caution)] ring-offset-2` highlight that clears after 3s — kept entirely separate from the pre-existing user-toggled `expandedId` state.
- `npm run build` (equivalent to `--workspace=@patelrep/web` — see Deviations) succeeded with no missing-Suspense-boundary error for either `/housekeeping` or `/engineering/predictions`.

## Task Commits

Each task was committed atomically:

1. **Task 1: RiskAlerts type + both panel links in AIRiskAlertsPanel** - `88d6c4a1` (feat)
2. **Task 2: Housekeeping deep link — RoomStatusBoard read + Suspense wrap** - `90dc3158` (feat)
3. **Task 3: Engineering deep link — predictions page Suspense split + scroll/highlight** - `46906c0f` (feat)

**Plan metadata:** (this commit, see below)

## Files Created/Modified

- `apps/web/lib/api/ai.ts` — `RiskAlerts.maintenance_risks` gained `id: string`
- `apps/web/components/dashboard/AIRiskAlertsPanel.tsx` — housekeeping row href now room-specific; new maintenance row View link
- `apps/web/components/housekeeping/RoomStatusBoard.tsx` — `useSearchParams` read + deep-link-open effect matched against `displayRooms`
- `apps/web/app/(dashboard)/housekeeping/page.tsx` — `<RoomStatusBoard />` wrapped in `<Suspense>`
- `apps/web/app/(dashboard)/engineering/predictions/page.tsx` — Content/Page Suspense split; `PredictionCard` ref + highlight props; two new effects for asset-id resolution and scroll

## Decisions Made

- See `key-decisions` in frontmatter for the eslint-disable cleanup, the real-data verification strategy, and the popstate technique used to prove filter-survives-deep-link live without a full page reload.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `npm run build --workspace=@patelrep/web` is not a valid command in this repo**
- **Found during:** Task 2 verification (and re-confirmed at Task 3/final verification)
- **Issue:** The repo's root `package.json` has no `workspaces` field — it isn't an npm-workspaces monorepo, so `npm run build --workspace=@patelrep/web` fails with `npm error No workspaces found`. The plan's own `verification` block specified this exact command.
- **Fix:** Ran the equivalent the root `build` script itself already uses: `cd apps/web && npm run build` (i.e. `next build` inside `apps/web`). This is functionally identical — same `next build` invocation, same Suspense-boundary check — just without the (non-functional) `--workspace` flag.
- **Files modified:** none (command-only)
- **Verification:** Build completed successfully; route table showed both `/housekeeping` and `/engineering/predictions` as `○ (Static)` with no Suspense-boundary error.
- **Committed in:** N/A (verification step, not a code change)

**2. [Rule 1 - Bug] Unused eslint-disable directive on the scroll/highlight effect**
- **Found during:** Task 3, `npm run lint`
- **Issue:** The plan's Task 3 code included `// eslint-disable-next-line react-hooks/exhaustive-deps` on both new effects. ESLint flagged the one on the second effect (`useEffect(..., [filtered, highlightedId])`) as an unused directive — that effect's dependency array was already exhaustive, so the disable comment was dead weight.
- **Fix:** Removed the unnecessary disable comment from the second effect only; kept it on the first (deep-link-resolution) effect, which genuinely needs it (`setRiskFilter`/`setStatusFilter` are stable setters correctly omitted, and re-running on every `filtered` change would fight the reset logic).
- **Files modified:** `apps/web/app/(dashboard)/engineering/predictions/page.tsx`
- **Verification:** `npm run lint` returned 0 errors, 0 warnings.
- **Committed in:** `46906c0f` (Task 3 commit)

---

**Total deviations:** 2 (1 blocking command-name mismatch, 1 lint cleanup). **Impact on plan:** Neither affected the shipped behavior — both are verification-tooling corrections. No scope creep.

## Issues Encountered

- **Live data gap for full end-to-end click verification:** the real dashboard's `AI Risk Alerts` panel currently has 9 active alerts for this tenant, all SLA breaches — 0 `housekeeping_risks` and 0 `maintenance_risks` rows exist right now (no room is at HIGH/MEDIUM predicted risk, and no asset has `failure_risk_score >= 70`, the threshold `get_risk_alerts()` filters on). This meant the two new/changed panel row types weren't literally clickable in this session's data. Worked around it by fetching a real `room_id` (`375646b7-f567-4ad4-8887-01ff2d13018c`, Room 101) via `GET /v1/housekeeping/board` and a real `asset_id` (`ec2d49bf-049f-481a-a145-f8185d6658e5`, Rooftop HVAC Unit A) via `GET /v1/assets/failure-predictions/history`, then navigating directly to `/housekeeping?room=...` and `/engineering/predictions?asset=...` — the exact URLs the panel's now-fixed `href`s construct — and confirming both destination behaviors live. This proves the receiving-page logic end-to-end; the panel's `href` template strings were separately confirmed correct by direct code read and by `npm run type-check` (which would fail if `r.room_id`/`r.id` didn't exist on the typed response). Not a code gap — a live-data availability gap in this pilot tenant's current state.
- **Filter-survives-deep-link scenarios required a non-obvious verification technique:** because `AIRiskAlertsPanel`'s links are plain `<a href>` (full-page navigations, per the plan's explicit design choice), every real click-through always starts with default (`null`/`'active'`) filter state — a full reload can never co-occur with a pre-existing active filter chip in this shipped design. To still prove the `displayRooms`-not-`rooms` (and equivalent risk/status filter) matching logic live rather than by code-read alone, filter chips were clicked first, then the URL was changed client-side via `history.pushState` + a synthetic `popstate` event (which Next.js App Router's client router picks up and re-renders `useSearchParams` from) instead of a full `page.goto` reload. Confirmed live: housekeeping — `Inspected` filter chip stayed `[pressed]` (Room 101 hidden from the grid) while `RoomDetailDrawer` still opened for Room 101; engineering — `High` risk filter (which hides the risk-score-20 HVAC asset) was reset back to `All Risk` once the `?asset=` param resolved to a hidden target, and the card rendered.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- AI-07 and AI-08 are closed: both `AIRiskAlertsPanel` row types now deep-link to the exact room/asset, verified via `npm run type-check`, `npm run lint`, `npm run build` (production, Suspense-boundary check), and a live authenticated browser walkthrough (login, both destination routes, filter-active and stale/invalid-id edge cases, non-regression check on manual room-card clicks and prediction-card action buttons).
- Phase 26 is now fully closed (26-01 backend + 26-02 frontend). Phase 27 (Room-Readiness One-Click Reassign / Escalate / Acknowledge) depends on Phase 26 for UX completeness per `.planning/STATE.md` — clear to start.
- No blockers. The live-data gap noted above (no current `housekeeping_risks`/`maintenance_risks` rows for this tenant) is an operational/data-seeding matter, not a code readiness concern — the moment either type of alert exists for a hotel, the panel's real links will resolve through the exact same verified code paths.

## Self-Check: PASSED

- FOUND: `.planning/phases/26-deep-linked-alert-surfaces/26-02-SUMMARY.md`
- FOUND: commit `88d6c4a1` (Task 1)
- FOUND: commit `90dc3158` (Task 2)
- FOUND: commit `46906c0f` (Task 3)
- FOUND: `maintenance_risks: Array<{ id: string; name: string; failure_risk_score: number }>` in `apps/web/lib/api/ai.ts`
- FOUND: `/housekeeping?room=${r.room_id}` in `apps/web/components/dashboard/AIRiskAlertsPanel.tsx`
- FOUND: `useSearchParams` usage in `apps/web/components/housekeeping/RoomStatusBoard.tsx`
- FOUND: `PredictionsPageContent` in `apps/web/app/(dashboard)/engineering/predictions/page.tsx`

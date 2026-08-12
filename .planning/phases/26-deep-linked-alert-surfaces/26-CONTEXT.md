# Phase 26: Deep-Linked Alert Surfaces - Context

**Gathered:** 2026-08-12
**Status:** Ready for planning

**Session note:** Continuing the same autonomous session as Phase 25 — user instructed Claude to keep going through Phase 26 and Phase 27 without further check-ins. This context was authored by Claude alone after reading `AIRiskAlertsPanel.tsx`, `apps/web/lib/api/ai.ts`, `apps/api/routers/ai_copilot.py::get_risk_alerts`, `apps/web/app/(dashboard)/housekeeping/page.tsx`, `apps/web/components/housekeeping/RoomStatusBoard.tsx`, `apps/web/stores/housekeepingStore.ts`, and `apps/web/app/(dashboard)/engineering/predictions/page.tsx`. No AskUserQuestion interaction occurred.

<domain>
## Phase Boundary

Every row in `AIRiskAlertsPanel` (dashboard) becomes a working deep link to the exact room or asset it describes: housekeeping rows link to that room's detail on the housekeeping board (opening the existing `RoomDetailDrawer`), maintenance rows link to that asset's card on the engineering predictions page (currently maintenance rows have no link element at all — not even a generic one). A stale/cross-tenant deep link degrades gracefully (target simply isn't found — no crash, no cross-tenant leak) rather than being explicitly caught with a dedicated error page.

</domain>

<decisions>
## Implementation Decisions

### Deviation from ROADMAP.md's "pure frontend, no new backend endpoints" framing
- ROADMAP.md Phase 26 description says "pure UI change against existing routes, no new backend endpoints." Codebase research found this is *almost* true but not quite: `GET /ai/risk-alerts` (`apps/api/routers/ai_copilot.py::get_risk_alerts`) currently selects `asset_risks = supabase.table("assets").select("name, failure_risk_score")...` — it does **not** select `id`, so the frontend has no `asset_id` to link with at all for maintenance rows. `housekeeping_risks` already selects `"*, rooms(room_number)"` on `room_readiness_predictions`, which includes `room_id` (confirmed present in the existing `RiskAlerts` TS type) — no backend change needed there.
- **Decision:** This phase makes one minimal one-line backend change — add `"id"` to the existing `asset_risks` select in the existing `/ai/risk-alerts` endpoint (`"id, name, failure_risk_score"`). This is not a new endpoint and not new business logic, just exposing a column the existing query's own table already has — squarely within "no new backend endpoints," and AI-08 is not implementable without it. Documenting this explicitly since ROADMAP.md's phrasing implied zero backend touch.

### Housekeeping deep link (AI-07)
- Convention: `/housekeeping?room={room_id}` query param (mirrors the existing `?tab=` / `?step=` query-param convention already used on `/tasks` and `/onboarding` in this codebase).
- Target component: `apps/web/components/housekeeping/RoomStatusBoard.tsx`, which already owns `selectedRoom` state and renders `RoomDetailDrawer` (confirmed at lines 331, 687-689) — GMs/supervisors always render this component (`SupervisorHousekeepingPage`), never the housekeeper's separate `HousekeeperMyRoomsView`, and `AIRiskAlertsPanel` only appears on the GM/manager dashboard, so this is the correct and only target.
- On read of `?room=`, find the matching room in the already-fetched room list (`useHousekeepingStore`'s `rooms`, which `RoomStatusBoard` consumes) and call the existing `setSelectedRoom(...)` — i.e. reuse the exact same state transition a manual card click already triggers. Do not build a second/parallel "highlighted room" visual system — opening the existing `RoomDetailDrawer` (the same UI a manual click produces) **is** the "highlight," since it already surfaces every relevant field for that room. No new scroll-to/pulse-animation infrastructure.
- Not-found case (room already cleaned into a different day's board, or belongs to a different tenant): the room simply isn't in the current tenant-scoped `rooms` array — no drawer opens, no error, no crash. This is the same tenant-scoping guarantee every other query in this codebase already provides (the board query is already `.eq("tenant_id", ...)`-scoped server-side) — no new guard code needed to satisfy the "graceful, no cross-tenant leak" success criterion.
- Clean up the query param after consuming it (`router.replace` without the param) is Claude's discretion below — not required for correctness, since the effect only needs to fire once on the room list becoming available.

### Engineering deep link (AI-08)
- Convention: `/engineering/predictions?asset={asset_id}` query param.
- Target page: `apps/web/app/(dashboard)/engineering/predictions/page.tsx`. Unlike housekeeping, this page has no separate detail drawer — each `PredictionCard` in the flat list *is* the detail (asset name, risk ring, failure window, recommendation, indicators, actions). "Opens the specific asset's failure-prediction detail" means: land on this page with the correct card visible, distinguished, and scrolled into view — not navigating to some new standalone page.
- Match by `prediction.asset_id === assetIdFromQuery` (confirmed `FailurePrediction.asset_id: string` exists on the type in `apps/web/lib/api/engineering.ts`).
- The page defaults `statusFilter` to `'active'` (hides acknowledged predictions). A deep-linked asset must always be reachable regardless of current filter state — when a `?asset=` param is present and its target isn't in the currently-filtered list, reset both `riskFilter` and `statusFilter` to `'all'` so the target becomes visible. Do this only when the deep-linked target would otherwise be hidden, not unconditionally on every page load with the param present, so it doesn't clobber the user's filter choice for the common case where the target is already visible under 'active'.
- Visually distinguish the target card (e.g. a temporary ring/border treatment) and scroll it into view on mount, using a `useRef` map keyed by prediction id — do not auto-expand `expandedId` (that's a distinct, user-toggled "show more reasoning" affordance; conflating it with deep-link-arrival would silently change unrelated UI state).
- Not-found case (asset deleted, or belongs to a different tenant): `getFailurePredictionHistory()` is already tenant-scoped server-side, so a cross-tenant `asset_id` simply never appears in the returned list — no match, no scroll, no error, page renders normally (empty-state if genuinely no predictions, or the full list otherwise). No new guard code needed.

### Shared conventions
- Both links use plain Next.js navigation (`<a href>` in `AIRiskAlertsPanel.tsx` today uses raw `<a>` tags, not `next/link`'s `<Link>` — keep consistency with the existing two rows in that file rather than mixing navigation primitives within the same component; this is a full page nav either way since the panel lives on `/` and both targets are different routes).
- `RiskAlerts` TS interface (`apps/web/lib/api/ai.ts`) needs `id: string` added to `maintenance_risks` (the `housekeeping_risks` type already has `room_id: string`, no change needed there).

### Claude's Discretion
- Whether to strip the `?room=`/`?asset=` param from the URL after consuming it (`router.replace`) — either is acceptable; a lingering param on a page that's just been reloaded/shared is harmless since the effect is idempotent (same room/asset re-highlights).
- Exact visual treatment for the engineering predictions page's "target card" highlight (ring color/duration) — should read as a clear, obviously-temporary highlight consistent with existing `--alert`/`--caution` CSS variables already used throughout this file, not a new color.
- Test approach: since this is a mix of a 1-line backend change (easily unit-testable) and React component/page behavior (URL-param-driven state), Claude should follow whatever test convention already exists for these specific files (check for existing frontend test coverage patterns before deciding whether to add new tests, vs. relying on `type-check`/`lint`/manual browser verification per this repo's `apps/web` conventions — CLAUDE.md's Self-Verification Policy already mandates a live browser walkthrough regardless).

</decisions>

<specifics>
## Specific Ideas

No specific UI/copy references from the user. Reuse existing interaction patterns exactly (the drawer for housekeeping, inline card highlight for engineering) rather than inventing new UI chrome.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Phase 27 (reassign/escalate/acknowledge actions) explicitly depends on this phase's links existing but is out of scope here.

</deferred>

---

*Phase: 26-deep-linked-alert-surfaces*
*Context gathered: 2026-08-12*

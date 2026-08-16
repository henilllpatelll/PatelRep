# Phase 32: Role Dashboard Homes - Research

**Researched:** 2026-08-16
**Domain:** Next.js 16 App Router dashboard-home redesign (frontend-only), reusing existing components/endpoints behind the Phase-30 `web_redesign_sections` feature flag
**Confidence:** HIGH (all findings are direct codebase reads; no external library research needed — this phase composes existing app surfaces)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**GM home content (HOME-02)**
- Lead with a **portfolio health snapshot**: aggregate cross-department status at a glance (rooms dirty/clean/pickup counts, open work orders by urgency, active guest requests, staff on shift).
- Secondary section: **risk & alerts feed** (reuse `AIRiskAlertsPanel` — already exists, already exposes room/asset ids per Phase 26) surfaced *below* the snapshot, not above.
- Financial/credit usage is **not** the lead module — compact summary card (reuse `ROIMetricsStrip` if its shape fits) linking into Management ROI / Billing for full detail, not inlined at report depth.
- Compose entirely from **existing endpoints/components** (`LiveOpsGrid`, `ROIMetricsStrip`, `TrendChartsRow`, `AIRiskAlertsPanel`, management_roi, ai_copilot risk alerts, housekeeping/engineering summary endpoints). **No new backend endpoints.** If a genuine data gap is found, prefer composing from what exists; flag any hard gap rather than silently building around it.

**GM density**
- **Light / drill-down**, not a dense BI report: a handful of large, clear summary cards/modules with links into full sections. Matches the existing density-toggle convention (`uiPreferencesStore`).

**Per-role information priority (HOME-01, all 6 roles)**
- **housekeeper** — active room assignment queue for today, in priority order
- **engineer** — open work orders assigned to them, prioritized by SLA/urgency
- **housekeeping_supervisor** — room status board summary + team assignment overview (keep existing `SupervisorDashboard` informational shape, redesign chrome only — GM no longer reuses this after HOME-02)
- **chief_engineer** — cross-team work order overview + asset health/failure predictions (keep existing `ChiefEngineerDashboard` shape, redesign chrome)
- **front_desk** — room readiness for arriving guests, late checkout requests, guest requests needing attention (keep existing `FrontDeskDashboard` shape, redesign chrome)
- **gm** — portfolio health snapshot (net-new dedicated component)
- For the 5 non-GM roles this phase is a **visual/chrome redesign of already-correct information architecture** — do NOT restructure their information priority; restyle to v2 tokens and rebuild empty/loading/error states.

**Shared shell vs bespoke layout**
- **Shared shell, bespoke content.** All 6 homes reuse a common header + card/grid shell and the same `StateBlock`/density/token contracts, but which cards appear and in what order is bespoke per role — no generic template.

**Empty/loading/error states (Success Criterion #3)**
- Use the existing `StateBlock` component/pattern for all three states across all 6 homes.
- Loading: **skeleton cards** matching each home's redesigned card shell (not spinners), sized to avoid layout shift.
- Empty: role-appropriate copy per home, added to **both `en`/`es`** locale files to keep `check:i18n-parity` green.
- Error: consistent with existing dashboard error-state handling (retry affordance where one already exists).

### Claude's Discretion
- Exact card/grid breakpoints and spacing values within the v2 token system.
- Whether the GM's cross-department snapshot is one combined module or 3-4 smaller per-department cards — pick whichever composes more cleanly from existing endpoint shapes.
- Order of secondary modules below the lead content on each home, as long as the single most-important-thing stays first.
- Any minor endpoint/query composition details needed to assemble the GM portfolio snapshot from existing data.

### Deferred Ideas (OUT OF SCOPE)
None. Discussion stayed within phase scope.
</user_constraints>

## Summary

Phase 32 is a **frontend-only, additive restyle** of the six role dashboard homes, gated behind the existing `web_redesign_sections` feature flag. All six render from a single role-switch in `apps/web/app/(dashboard)/dashboard/page.tsx`. Five roles already have dedicated components (`HousekeeperDashboard`, `SupervisorDashboard`, `EngineerDashboard`, `ChiefEngineerDashboard`, `FrontDeskDashboard`) with correct information architecture and their own data-fetching; those need chrome-only v2 restyling plus rebuilt empty/loading/error states. The GM (HOME-02) is the one genuinely new component.

**One important correction to the phase framing:** CONTEXT.md and REQUIREMENTS.md state the GM "currently borrows `SupervisorDashboard`" / uses a "borrowed-supervisor-view composition." **This is not what the live code does.** `page.tsx` already contains a *bespoke inline* `GMDashboard()` function (lines 24–132) that composes `DashboardGreeting` + departures/ready cards + `ROIMetricsStrip` + `AIRiskAlertsPanel` + `LiveOpsGrid` + `TrendChartsRow`. It does **not** render `SupervisorDashboard`. So HOME-02 is accurately: *extract the inline `GMDashboard` into its own first-class dedicated component file and redesign it around the portfolio-snapshot layout* — not "stop reusing SupervisorDashboard." The success criterion ("no longer composed from the borrowed supervisor view") is still satisfiable and even easier than stated, but the planner should not go looking for a `SupervisorDashboard` reference in the GM path — there isn't one.

**Primary recommendation:** Add a new redesign section key (e.g. `'dashboard'`) checked via `isSectionRedesigned('dashboard', hotel)`. In each of the 6 homes (and the page-level loading state), branch on that flag: legacy branch unchanged, v2 branch restyled with the Phase-30/31 additive tokens and rebuilt `StateBlock`-based empty/error states + inline skeleton-card loading. Extract GM into `components/dashboard/GMDashboard.tsx` composed from existing endpoints (`hotelsApi.getStats`, `reportsApi.getDailySummary`, `aiApi.getRiskAlerts`, `guestRequestsApi.listRequests`). No backend changes.

## Current Architecture (verified file/line references)

### Dashboard home entry point — the role switch
`apps/web/app/(dashboard)/dashboard/page.tsx`:
- `default function DashboardPage()` (line 134): reads `role` from `useRole()`; while `isAuthLoading || !role`, renders a **top-level loading skeleton** (lines 138–149: an `h-9` title bar + three `h-28` cards). This is the closest existing "loading skeleton" precedent at page level.
- `switch (role)` (lines 151–170): `housekeeper → HousekeeperDashboard`, `housekeeping_supervisor → SupervisorDashboard`, `engineer → EngineerDashboard`, `chief_engineer → ChiefEngineerDashboard`, `front_desk → FrontDeskDashboard`, `gm → GMDashboard` (the inline one), default → "No dashboard available."
- `GMDashboard()` is defined **inline in this file** (lines 24–132). It fetches `housekeepingApi.getBoard(today, undefined, false)`, derives `depRooms`/`readyRooms`, has `markCheckedOut`/`markCheckIn` mutations, and renders `DashboardGreeting` + two `Card`+`StateBlock` columns (Departures / Ready for occupancy) + `ROIMetricsStrip` + `AIRiskAlertsPanel` + `LiveOpsGrid` + `TrendChartsRow`. **This is the code HOME-02 replaces/extracts.**

### The five existing role components (data-fetching + shape)
All live in `apps/web/components/dashboard/`. All use `DashboardGreeting` as their header and `Stat`/`Pill`/`SectionLabel`/`Mono` primitives.

| Component | Key queries (React Query) | Renders | Existing skeleton |
|---|---|---|---|
| `HousekeeperDashboard.tsx` | `housekeepingApi.getMyRooms(today)`, `getBoard(today)`, `tasksApi.list({assigned_to,status:'open'})`, `aiApi.getRiskAlerts()` | Stat strip (rooms today/done/avg/inspect-now) + "My queue" room list + AI "Heads up" predictions + "My tasks" | Inline `h-[58px]` pulse rows; empty = centered `CheckCircle2` + text |
| `EngineerDashboard.tsx` | `engineeringApi.listWorkOrders({assigned_to})` | Stat strip (open/urgent/completed/PM-due) + prioritized WO list + urgent callout banner | `SkeletonRow()` local component; empty = centered icon + text |
| `SupervisorDashboard.tsx` | `reportsApi.getDailySummary()`, `aiApi.getRiskAlerts()`, `guestRequestsApi.listRequests({status:'open'})`, `tasksApi.list({status:'open'})`, `housekeepingApi.getAssignments(today)`, `getBoard(today)` | Greeting+actions (Broadcast modal / New task) + AI morning-briefing card + stat strip + `LiveOpsGrid` + `StaffProgress` + `PredictionsWidget` + `RoomGridMini` + `ActivityFeed` (all internal sub-components) | `h-16` pulse tiles for stat strip; per-widget empty text |
| `ChiefEngineerDashboard.tsx` | `engineeringApi.listWorkOrders({per_page:100})`, `listPMSchedules()`, `getFailurePredictions()`, `reportsApi.getMaintenance(30d)` | Stat strip (open/urgent/PM-due/assets) + WO queue + "PM due 7d" + "High-risk assets" AI card + SLA compliance callout | `SkeletonRow()` local; empty = centered icon |
| `FrontDeskDashboard.tsx` | `getBoard(today)`, `hotelsApi.getStats(hotelId)`, `guestRequestsApi.listRequests` (open + active), `lateCheckoutApi.list({status:'pending'})` + mutations (checkOut/checkIn/welfareCheck/resolve) | Stat strip (ready%/open-reqs/in-progress/needs-cleaning) + Room status breakdown + Guest requests + Late checkouts + Arrivals&departures + DND welfare + Lost&Found link | `SkeletonRow()` local; per-section empty = centered icon |

### Shared dashboard modules (reusable for the GM home)
| Module | File | Fetches | Output |
|---|---|---|---|
| `LiveOpsGrid` | `components/dashboard/LiveOpsGrid.tsx` | `reportsApi.getDailySummary()` | 6 room-status tiles (DIRTY/IN_PROGRESS/CLEAN/INSPECTED/PICKUP/OOO) with counts + bars; has its own loading skeleton (6 `h-[88px]` tiles) |
| `ROIMetricsStrip` | `components/dashboard/ROIMetricsStrip.tsx` | `reportsApi.getDailySummary()` + `hotelsApi.getStats()` | 4 `Stat`s: Occupancy%, Rooms Inspected, Open Work Orders, Tasks Completed. **NOTE: this is operational KPIs, NOT financial.** Has loading skeleton (4 `h-24` cards) |
| `TrendChartsRow` | `components/dashboard/TrendChartsRow.tsx` | `reportsApi.getMaintenance(30d)` + `getStaffPerformance(30d)` | 2 Recharts cards: SLA gauge + top staff bar chart. Has `SkeletonChart` + an explicit **error branch** ("Unable to load") — the cleanest existing error-state precedent |
| `AIRiskAlertsPanel` | `components/dashboard/AIRiskAlertsPanel.tsx` | `aiApi.getRiskAlerts()` | Collapsible panel of housekeeping_risks / sla_breaches / maintenance_risks with deep links (`/housekeeping?room=`, `/engineering`, `/engineering/predictions?asset=`). Loading skeleton + explicit empty ("No active alerts") |
| `DashboardGreeting` | `components/dashboard/DashboardGreeting.tsx` | none (props: `name`, `subtitle`) | The **sanctioned role-dashboard header** — its own doc-comment says "spacing matches PageHeader's eyebrow/title/subtitle." i18n-wired (`dashboard.greeting.*`), `suppressHydrationWarning` on the date line |

## The feature-flag contract (Phase 30/31 pattern)

**Utility:** `apps/web/lib/utils/redesignFlag.ts` — `isSectionRedesigned(sectionKey: string, hotel): boolean` → `hotel?.web_redesign_sections?.includes(sectionKey) ?? false`.

**Two established consumption patterns (from Phase 31, `31-01-SUMMARY.md`):**
1. **Prop-threaded `redesigned`** — for components DashboardShell mounts directly (Sidebar/Header/CommandPalette). `DashboardShell` computes `const shellV2 = isSectionRedesigned('shell', hotel)` once and passes `redesigned={shellV2}`.
2. **Direct flag read** — for components NOT mounted by DashboardShell (Breadcrumbs, MobileFloorNav): `const redesigned = isSectionRedesigned('shell', hotel)` using `useHotelStore((s) => s.hotel)`.

**Which applies to dashboard homes:** The 6 home components are rendered as page *content* (`children` of `DashboardShell` via the `(dashboard)/dashboard` route), **not** mounted by `DashboardShell`. So they follow **pattern 2 (direct read)** — each home (or a thin wrapper) calls `isSectionRedesigned('dashboard', hotel)` itself. `RedesignGate` (`components/shared/RedesignGate.tsx`, `<RedesignGate section=... v2=... legacy=.../>`) is available if the planner prefers a declarative v2/legacy swap at the `page.tsx` switch level rather than an internal branch.

**Section key is a free-form string.** `web_redesign_sections` is a plain `string[]` on the hotel/tenant record (`stores/hotelStore.ts` line 10; `lib/api/hotels.ts` `UpdateHotelData.web_redesign_sections`; API select in `apps/api/routers/auth.py:19`). There is **no fixed registry of keys** — `'shell'` is the only one used so far. Phase 32 introduces a new key (recommend `'dashboard'` — short, matches the route; the planner decides). Enable it for a hotel by adding the string to that array via `PATCH /v1/hotels/{id}` (`hotelsApi.update`) or directly in Supabase. There is **no settings-UI toggle** for redesign sections yet (grep found none) — enabling is manual/DB, exactly as Phase 31 did for `'shell'`.

## GM portfolio snapshot — data sources (all existing, no new endpoints)

Every field the locked GM snapshot needs is already served:

| Snapshot element | Source (existing) | Exact fields |
|---|---|---|
| Rooms dirty/clean/pickup/inspected counts | `reportsApi.getDailySummary()` | `data.room_status_breakdown: Record<string, number>` (keys DIRTY/CLEAN/PICKUP/INSPECTED/IN_PROGRESS/OCCUPIED/OOO) |
| Open work orders (total) | `reportsApi.getDailySummary()` **or** `hotelsApi.getStats()` | `data.open_work_orders` |
| Open work orders **by urgency** | `aiApi.getRiskAlerts()` (`sla_breaches`) + optionally `engineeringApi.listWorkOrders({per_page})` filtered by `priority==='urgent'` | breakdown by urgency requires client-side filter of the WO list (getDailySummary only gives the total). This is the one "by urgency" split not pre-aggregated — compose client-side from `listWorkOrders`, matching how `EngineerDashboard`/`ChiefEngineerDashboard` already do it |
| Active guest requests | `guestRequestsApi.listRequests({ status: 'open' })` | `data.length` (SupervisorDashboard/FrontDeskDashboard already do this) |
| Staff on shift | `hotelsApi.getStats(hotelId)` | `data.active_staff` (**already served** — no gap) |
| Room total | `hotelsApi.getStats(hotelId)` | `data.room_count` |
| Open tasks | `hotelsApi.getStats(hotelId)` | `data.open_tasks` |

`hotelsApi.getStats` returns `{ hotel_id, room_count, active_staff, open_tasks, open_work_orders }` — a ready-made portfolio aggregate. `getHotelIdFromSession(session.access_token)` (decode JWT `hotel_id`) is the established way to get `hotelId` for these calls (used in `ROIMetricsStrip`, `LiveOpsGrid`, `FrontDeskDashboard`, `TrendChartsRow`).

**Financial/credit compact card (secondary, per CONTEXT):**
- The CONTEXT suggests reusing `ROIMetricsStrip` "if its shape fits." **Caveat:** `ROIMetricsStrip` is operational KPIs (occupancy, inspected, open WOs, tasks), **not** financial/credit. A genuine financial/credit summary would come from `reportsApi.getAIUsage()` (`total_credits_used`, `total_interactions`) and/or `managementRoiApi.getDowntimeRevenue()` (`revenue.revenue_impact_cents`, gated by `revenue.configured`). Planner's discretion: either (a) reuse `ROIMetricsStrip` as an "ops summary" card and put a link to Management ROI/Billing, or (b) build a thin compact card from `getAIUsage`/`getDowntimeRevenue`. Recommend (a) for scope-minimalism unless the user's "financial/credit usage" intent specifically means dollars — flag if ambiguous. Full financial detail already lives at `/management-roi` and `/settings/billing`.

**No hard data gap found** for the GM snapshot. The only non-pre-aggregated element is "open WOs *by urgency*," solvable client-side from the existing `listWorkOrders` endpoint.

## Empty / Loading / Error state contract

**`StateBlock`** (`components/ui/StateBlock.tsx`): props `status?: 'loading' | 'empty' | 'error' | null`, `loadingLabel`, `empty: EmptyStateProps`, `error: { message?, onRetry? }`, `children`. When `status` is null/omitted it renders `children` (the data-present state).
- `status='loading'` → a **spinner** (`Loader2` + `common.loading`). ⚠️ **This conflicts with the CONTEXT requirement "skeleton cards, not spinners."** Resolution: use `StateBlock` for **empty** and **error** states, and render **inline skeleton cards** for loading (as `LiveOpsGrid`/`ROIMetricsStrip`/`TrendChartsRow`/the `SkeletonRow` components already do). Do NOT route the card-shell loading state through `StateBlock`'s spinner. This is the correct reading of the locked decision and is called out here so the planner doesn't naively pass `status='loading'`.
- `status='empty'` → `EmptyState` (`components/ui/EmptyState.tsx`, props `icon?`, `title`, `body?`, `action?`). i18n default `common.noResults` ("Nothing here yet").
- `status='error'` → alert-icon + `error.message ?? common.error` + optional retry button (`common.retry`).

**Error precedent:** `TrendChartsRow` (explicit `isError` → "Unable to load" cards) and `StateBlock`'s error branch are the two existing patterns. React Query exposes `isError` on every query; wire `status={isError ? 'error' : isLoading ? 'loading' : empty ? 'empty' : null}` per card, but split loading to skeletons per above.

**Skeleton precedents to reuse (don't invent new ones):**
- Page-level: `page.tsx` lines 138–149 (`h-9` bar + three `h-28` cards).
- `LiveOpsGrid`: 6 × `h-[88px]` tiles.
- `ROIMetricsStrip`: 4 × `h-24` cards.
- `TrendChartsRow`: `SkeletonChart` (h-3 title + h-40 body).
- `EngineerDashboard`/`ChiefEngineerDashboard`/`FrontDeskDashboard`: local `SkeletonRow()` (icon + two text bars + pill).
- `HousekeeperDashboard`: `h-[58px]` pulse rows.
All use `animate-pulse` + `bg-surface-2`/`bg-surface-3`. Match the redesigned card shell's dimensions to avoid layout shift.

## i18n contract

- Locale files: `apps/web/i18n/locales/en.ts` and `es.ts` (plain nested TS objects; `en` starts `const en = {`).
- Dashboard block already exists at `dashboard:` (en.ts line 129) but currently only holds `greeting.{morning,afternoon,evening}`. **New dashboard-home keys (empty-state copy, section labels) go under `dashboard.*` in BOTH files.** Follow the Phase-31 namespacing precedent (`nav.*`).
- Shared state copy already present under `common.*`: `loading` ("Loading..."), `noResults` ("Nothing here yet"), `error` ("Something went wrong"), `retry` ("Retry"). Reuse these for generic states; add role-specific empty copy (e.g. `dashboard.empty.housekeeperNoRooms`, `dashboard.empty.engineerNoWorkOrders`, `dashboard.empty.gmNoAlerts`) to both locales.
- Gate: `npm run check:i18n-parity` (`scripts/check-i18n-parity.mjs`) — every en key must have an es counterpart. Also `verify:i18n-gate`. Any new key added to one locale MUST be added to the other or CI fails.

## Frozen-file constraints (Phase 30 — MUST NOT violate)

Manifest: `apps/web/frozen-files.json`; human companion: `.planning/phases/30-.../FROZEN.md`; guard: `npm run check:frozen-files` (`scripts/check-frozen-files.mjs`).

**None of the 6 dashboard home components are frozen** — all are freely editable. But the homes **consume** frozen primitives, which is fine (reading is allowed; editing is not):
- **NAME-frozen files you must NOT edit:** `components/ui/Button.tsx`, `components/ui/primitives.tsx` (`StatusDot`/`Pill` tone→color maps specifically; `Stat`/`Bar`/`AILabel`/`SectionLabel`/`Mono` are additive-safe but editing them re-triggers the board pixel-diff gate), `components/housekeeping/RoomCard.tsx`, `components/shared/LogFoundItemModal.tsx`, `components/housekeeping/RoomStatusBoard.tsx`, `components/housekeeping/RoomDetailDrawer.tsx`, `components/engineering/EngineeringRoomBoard.tsx`. Dashboard homes import `Stat/Pill/SectionLabel/Mono/StatusDot/Bar/AILabel` from `primitives.tsx` — keep them as imports; **do not modify `primitives.tsx`.** If a home needs a new primitive variant, add a NEW component/file, don't edit the frozen one.
- **VALUE-frozen room-status colors (HARD, no allowlist escape):** `--alert/--info/--ready/--progress/--caution/--blocked` (+ soft/line) encode DIRTY/CLEAN/INSPECTED/IN_PROGRESS/PICKUP/OOO. The GM snapshot and `LiveOpsGrid` render these room-status colors — keep using the exact same tokens for room-status meaning. **Double-duty warning:** those six tokens are also generic chrome tokens; if a redesigned home wants a *different* generic "alert"/"info" tint for non-room chrome, introduce a NEW token (e.g. `--danger-v2`), never re-tint `--alert`/`--info` in `globals.css`.
- Prefer the Tailwind aliases already registered in Phase 30/31 (`duration-base`, `ease-standard`, `z-*`, `bg-brand`, `text-brand`, `--focus-ring`, `--motion-*`) over raw `var(...)` for new v2 chrome, per `31-01-SUMMARY.md` patterns-established.

## Verification gates (run before declaring any task done)

```bash
cd apps/web
npm run type-check            # tsc --noEmit
npm run check:frozen-files    # frozen manifest guard
npm run check:contrast        # dark-mode WCAG contrast gate (scripts/check-contrast.mjs)
npm run check:i18n-parity     # en/es key parity
npm run build                 # Next.js build (Phase 31 gated each task on this)
```
Plus the mandatory Self-Verification Policy (CLAUDE.md): run `npm run dev:web`/`dev:api`, log in (GM test account in memory), toggle the new section flag on for the test hotel, and click through each of the 6 homes in the browser (light + dark, EN + ES) confirming empty/loading/error render. The Room-Board regression harness (`e2e/room-board-baseline.spec.ts`, `playwright.regression.config.ts`) asserts the frozen boards render byte-identically — dashboard-home changes should be inert to it, but it's the safety net.

## Architecture Patterns (prescriptive for the planner)

### Pattern 1: Per-home flag branch (direct read)
```tsx
// inside each home component (e.g. HousekeeperDashboard)
const hotel = useHotelStore((s) => s.hotel)
const v2 = isSectionRedesigned('dashboard', hotel)
// legacy JSX unchanged when !v2; v2 JSX applies new tokens + rebuilt StateBlock states
```
Legacy branch must stay byte-behaviorally identical (flag off = today's UI), mirroring how Phase 31 kept the legacy sidebar untouched.

### Pattern 2: Extract GM into a dedicated file (HOME-02)
Create `apps/web/components/dashboard/GMDashboard.tsx` exporting `GMDashboard`, move the inline function out of `page.tsx`, and import it in the switch. Then redesign its body to: (1) portfolio health snapshot (from `hotelsApi.getStats` + `getDailySummary` + `guestRequestsApi.listRequests` + client-side WO-urgency split), (2) `AIRiskAlertsPanel` below it, (3) compact ops/financial summary card linking to `/management-roi` + `/settings/billing`, optionally `LiveOpsGrid`/`TrendChartsRow` as tertiary. Keep the departures/ready-room action columns only if they still fit the "light/drill-down" GM density — they duplicate FrontDesk functionality and may be better dropped or slimmed for the GM (planner's call under "order of secondary modules").

### Pattern 3: State handling per card
Loading → inline skeleton card (reuse existing shapes). Empty → `<StateBlock status='empty' empty={{ title: t('dashboard.empty.xxx') }} />`. Error → `<StateBlock status='error' error={{ message: t('common.error'), onRetry: () => refetch() }} />`. Data → `status={null}` / render children.

### Anti-patterns to avoid
- **Don't** route card loading through `StateBlock status='loading'` (spinner) — violates the "skeleton not spinner" decision.
- **Don't** edit `primitives.tsx`/`Button.tsx` or any frozen file to add a home-specific style — add new files/classes.
- **Don't** re-tint the six room-status tokens for generic chrome — add `*-v2` tokens.
- **Don't** add a backend endpoint — the GM snapshot is fully composable from existing APIs.
- **Don't** restructure the 5 non-GM homes' information priority — chrome/state only.
- **Don't** assume a `SupervisorDashboard` reference exists in the GM path — it doesn't (see Summary).

## Open Questions

1. **Section key name.** Recommend `'dashboard'`. Planner to confirm (any string works; must match whatever gets added to `web_redesign_sections` for testing). — LOW risk, pure naming.
2. **"Financial/credit usage" card semantics.** Whether the user means ops KPIs (reuse `ROIMetricsStrip`) or actual dollars/credits (`getAIUsage`/`getDowntimeRevenue`). CONTEXT hedges ("if its shape fits"). Recommend reusing `ROIMetricsStrip` + deep link for scope-minimalism; flag to user only if they later expect dollar figures. — LOW/MEDIUM.
3. **GM departures/ready action columns.** The inline GM currently has checkout/checkin mutations duplicating FrontDesk. Keep, slim, or drop under "light/drill-down" density? Recommend dropping or making them a compact read-only count in the snapshot, since GM density is explicitly light. — Planner discretion (within locked scope).
4. **Whether to keep `DashboardGreeting` or switch to `PageHeader`.** CONTEXT says "common PageHeader + card/grid shell," but the actual dashboard header today is `DashboardGreeting` (which is explicitly the sanctioned dashboard-equivalent of `PageHeader`, already i18n-wired and used by all 6 homes). Recommend **keep `DashboardGreeting`** as the shared header — swapping to `PageHeader` would lose the greeting/subtitle pattern for no benefit. Treat "PageHeader contract" as "the header spacing/typography contract that DashboardGreeting already implements." — LOW.

## Sources

### Primary (HIGH confidence — direct codebase reads, 2026-08-16)
- `apps/web/app/(dashboard)/dashboard/page.tsx` (role switch + inline GMDashboard)
- `apps/web/components/dashboard/{HousekeeperDashboard,EngineerDashboard,SupervisorDashboard,ChiefEngineerDashboard,FrontDeskDashboard,LiveOpsGrid,ROIMetricsStrip,TrendChartsRow,AIRiskAlertsPanel,DashboardGreeting}.tsx`
- `apps/web/components/ui/{StateBlock,PageHeader — via components/shared/PageHeader}.tsx`, `components/ui/EmptyState.tsx` (props)
- `apps/web/lib/utils/redesignFlag.ts`, `components/shared/RedesignGate.tsx`, `components/shared/DashboardShell.tsx`
- `apps/web/lib/api/{reports,ai,hotels,managementRoi}.ts` (endpoint shapes)
- `apps/web/stores/hotelStore.ts`, `apps/api/routers/auth.py` (flag storage)
- `apps/web/frozen-files.json`, `.planning/phases/30-.../FROZEN.md`
- `apps/web/i18n/locales/en.ts` (dashboard/common blocks), `package.json` scripts
- `.planning/phases/31-shell-navigation-redesign/31-01-SUMMARY.md` (redesigned-prop + direct-read patterns, token aliases)
- `.planning/phases/32-role-dashboard-homes/32-CONTEXT.md`
- `apps/web/e2e/fixtures/seed-regression-tenant.mjs` (`web_redesign_sections: []` seed)

### Secondary / Tertiary
None — no external library research required; this phase is internal composition only.

## Metadata

**Confidence breakdown:**
- Current architecture / file map: HIGH — every claim is a direct read with line refs.
- GM data sources: HIGH — all endpoints and response types verified in the API client files.
- Flag/state/frozen/i18n contracts: HIGH — verified against source + Phase 30/31 artifacts.
- "Financial card" intent: MEDIUM — depends on user's meaning of "financial/credit"; flagged as open question.

**Research date:** 2026-08-16
**Valid until:** ~2026-09-15 (stable; the only fast-moving dependency is the Next.js canary version, which does not affect this phase's component-level work)

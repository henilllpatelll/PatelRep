# Handoff: GM (manager) dashboard redesign — "the 3pm clock"

## Overview

Replaces the GM role dashboard at `/dashboard` (`apps/web/components/dashboard/GMDashboard.tsx`, the `v2` branch behind `isSectionRedesigned('dashboard', hotel)`).

The current v2 layout is a 4-card "Portfolio snapshot" of stat tiles plus an AI risk-alerts panel and an AI credit-usage card. Research with the product owner narrowed what a GM actually opens this page for:

1. Are rooms ready for arrivals?
2. What's broken and blocking a room?
3. Who's on shift, who's behind?
4. What happened overnight?

The dashboard is **read-only** — every row links out to the module that owns the action. Time horizon is **live/now**. AI appears in exactly two places: one pace projection inside the hero and one overnight-recap strip.

Removed from the current dashboard (deliberate, confirmed with the owner):
- `AIRiskAlertsPanel` (its content is absorbed into the "What's holding rooms back" list)
- AI credit usage card (lives in `/settings/billing` and `/management-roi`)
- `TrendChartsRow` (SLA gauge + top-staff chart) — belongs in `/reports`
- Staffing stat tiles (replaced by the shift board)

## About the Design Files

The files in this bundle are **design references created in HTML** — runnable prototypes showing intended look and behavior. They are **not production code to copy**. Recreate them inside the existing PatelRep web app: Next.js 14 App Router, Tailwind mapped to the token system in `apps/web/app/globals.css` + `tailwind.config.ts`, React Query for data, Zustand stores, Supabase Realtime for live updates, `components/ui/` primitives (`Card`, `Pill`, `Stat`, `SectionLabel`, `Mono`, `Bar`, `AILabel`), and `lucide-react` icons at `strokeWidth={1.6}`.

Keep all API contracts and store shapes. This is a UI-layer change plus a small amount of derived-metric logic (see State Management).

The prototypes render the full app shell (Sidebar, Header) so the design can be judged in context. **Do not re-implement the shell** — it already exists as `components/shared/Sidebar.tsx` and `Header.tsx`. Only the `<main>` content is new.

## Fidelity

**High-fidelity.** Exact colors, type, and spacing below and in the prototype. `Manager Dashboard - wireframes.dc.html` is low-fidelity and included for context only (three explored directions; option **1b** was chosen and is what `GM Dashboard - v3 (3pm clock).dc.html` builds out).

## Screens / Views

### 1. GM Dashboard (`/dashboard`, role `gm`) — the deliverable

File: `GM Dashboard - v3 (3pm clock).dc.html`

Page container: `<main>` keeps its existing `flex-1 overflow-y-auto p-4 md:p-5 md:pb-20`. Content column is `max-width:1240px`, vertical stack, `gap: 20px`.

#### 1a. Greeting header

Row, `justify-content: space-between`, `align-items: flex-start`, gap 24px.

Left — reuse `DashboardGreeting` unchanged (eyebrow date 11px/600/uppercase/`0.12em`/`--ink-3`; H1 Instrument Serif 34px italic, `-0.5px`, line-height 1.1; subtitle 14px `--ink-2`, line-height 1.45). Subtitle becomes `"{hotel.name} · {arrivalsCount} arrivals expected today"`.

Right (new, `padding-top: 4px`):
- "Live" pill: `--ready-soft` bg, 1px `--ready-line` border, `--ready` text, 12px, radius 999px, padding 4px 10px, leading 6px dot in `--ready` with a 2s pulse (`animate-pulse`), `shrink-0`.
- `Mono` 12px `--ink-3`: `updated {h:mm A}` — the last successful refetch time.

#### 1b. Hero — "Ready for arrivals"

Card: `--surface`, 1px `--line`, radius `--r-xl` (20px), `--shadow-md`, padding 24px, row with `gap: 32px`, `align-items: stretch`.

**Dial** (184×184, `shrink-0`, `position: relative`):
- SVG 184×184 rotated `-90deg`. Track: `circle r=78 cx=92 cy=92`, stroke `--surface-3`, width 16. Progress: same geometry, stroke `--ready`, width 16, `stroke-linecap: round`, `stroke-dasharray: "{pct/100 × 490} 490"` (circumference of r=78 ≈ 490).
- Centered overlay, column, centered, gap 4px: Instrument Serif 52px/1 `--ink` (ready count) · 12px `--ink-3` `"of {arrivals} arrivals"` · 11px/600/uppercase/`0.08em` `--ready` "Ready now" with `margin-top: 2px`.

**Right column** (flex 1, column, gap 16px, `min-width: 0`):
- Header row, baseline: `SectionLabel` "Ready for arrivals" + `Mono` 12px `--ink-3` `"{h}h {m}m to 3:00 PM"` (hide the countdown after 3pm; show `"3:00 PM passed"` in `--ink-4`).
- 4-up grid, `gap: 14px`. Each tile: `--surface-2` bg, 1px `--line-2`, radius `--r-md`, padding 12px 14px, column gap 6px — dot row (7px `StatusDot`, `shrink-0`, + 11px/500 `--ink-3` label) then Instrument Serif 30px/1 `--ink` value. Tiles, in order: **Inspected** `--ready`, **Awaiting inspection** `--info`, **Being cleaned** `--progress`, **Not started** `--alert`.
- Stacked bar: 12px tall, radius 6px, `overflow: hidden`, bg `--surface-3`, four segments in the same four colors sized by share of departure rooms in play. Under it a `Mono` 11px `--ink-4` row, space-between: `"{n} departure rooms in play"` / `"{n} blocked · see below"`.
- AI pace callout (pinned with `margin-top: auto`): 1px `--ai-line`, bg `--ai-soft`, radius `--r-md`, padding 12px 14px, row gap 12px. `AILabel` with confidence (white bg variant, `shrink-0`) then Instrument Serif **italic** 16px/1.35 `--ink`. Copy pattern: *"At the current pace all {n} arrival rooms are ready by {time} — but floor {x} is {m} minutes behind and holds {k} of today's VIP rooms."*

#### 1c. Two-column body

`display: grid; grid-template-columns: 1.15fr 1fr; gap: 20px; align-items: start`. Collapses to one column below 1280px.

**Left — "What's holding rooms back"**

`Card` (`--surface`, `--line`, `--r-lg`, `--shadow-md`, padding 16px). Header: `SectionLabel` + `Mono` 12px `--ink-4` count, right-aligned 11px/500 `--ink-3` link "All work orders" → `/engineering/work-orders`.

Rows: `padding: 12px 0`, 1px `--line-2` bottom border (none on last), row gap 12px, centered.
- Room chip: `Mono` 13px/600, `--surface-2` bg, 1px `--line`, radius 6px, padding 3px 8px, `shrink-0`.
- Middle: 13px `--ink` title (`"{summary} — WO-{number}"` or the housekeeping reason), then 11.5px `--ink-3` meta (`"{department} · {assignee|unassigned} · {arrival or duration}"`), `margin-top: 3px`.
- Right: `Pill size="sm"` — `alert` for overdue/urgent, `caution` for behind pace, `blocked`/`ooo` for out-of-order.

Whole row navigates: work orders → `/engineering/work-orders?wo={id}`, housekeeping → `/housekeeping?room={room_id}`.

Content = union of (a) open work orders on rooms with an arrival today, urgent or SLA-breached first, (b) rooms whose clean has exceeded the expected duration, (c) OOO/OOS rooms. Cap at 6 rows; overflow becomes a `"+{n} more"` link.

**Right — "On shift"**

`Card`, padding 16px. Header: `SectionLabel` "On shift" + `Mono` 12px `--ink-4` `"{n} · {k} behind pace"`, right link "Staff" → `/staff`.

2-up grid, gap 10px. Each person tile: 1px `--line-2`, radius `--r-md`, padding 11px 12px, column gap 8px:
- Row: 22px `Avatar` (deterministic color via `getAvatarColor`), 12.5px/500 `--ink` name (truncate), `Mono` 11px `--ink-3` `"{done}/{assigned}"`.
- `Bar` height 4: tone `ready` when on/ahead of pace, `caution` when behind.
- 10.5px caption: `--caution` `"{m}m behind · {area}"` when behind, else `--ink-3` `"on pace · {area}"`.

Footer row, `margin-top: 12px`, 11.5px `--ink-3`: `"{n} more on shift — engineering, front desk"` + link "Schedule" → `/scheduling`. Show 6 housekeeping/inspection tiles max.

#### 1d. Overnight recap strip

`Card`, padding 14px 16px, single row, gap 16px, centered: `AILabel` (`shrink-0`) · `SectionLabel`-style 11px/600/uppercase "Overnight" · 13px `--ink-2` one-line summary truncated with ellipsis · 12px/500 accent link "Read full recap" → `/logbook`.

Source: the AI shift-summary logbook entry for the night shift. If none exists, render the strip with `--ink-3` copy "No overnight summary yet" and drop the link.

### 2. GM Dashboard — current (reference only)

File: `GM Dashboard - current.dc.html`. Faithful recreation of today's v2 layout, for before/after comparison. Nothing to build.

## Interactions & Behavior

- **Read-only.** No mutations on this page — the old `markCheckedOut` / `markCheckIn` buttons from the legacy GM layout are not carried over. Every list row and card is a link.
- **Live data.** Rooms, work orders and guest requests come through the existing Supabase Realtime subscriptions; the "updated {time}" label reflects the latest successful fetch. Keep the existing `refetchInterval: 120_000` React Query fallbacks (30s for the room breakdown, as `LiveOpsGrid` already does).
- **Countdown** to 3:00 PM recomputes each minute (client-side interval, no request).
- **Hover.** Card hover keeps the existing 150ms shadow lift (`Card` default). List rows hover `--surface-2`. Links go `--ink-3` → `--brand`.
- **Loading.** Skeletons matching the existing pattern: `bg-surface-3 animate-pulse` blocks at the final heights (dial 184px circle, tiles 96px, list rows 44px). Never collapse the layout.
- **Error / empty.** Use `StateBlock` per card, exactly as `GMDashboard` does today (`status="error"` with `onRetry`, `status="empty"` with a title). An empty blockers list is a positive state: teal check + "Nothing blocking a room right now."
- **Responsive.** ≥1280px as designed. 768–1280px: body grid collapses to one column, hero dial stays inline. <768px: hero becomes a column (dial above the tiles), person tiles go 1-up, the recap strip wraps to two lines. Tap targets stay ≥44px per the global mobile rule in `globals.css`.
- **Reduced motion** is already handled globally; the pulse dot and dial both respect it.

## State Management

New derived values (compute in a hook, e.g. `useArrivalReadiness(hotelId)` — no new API endpoints required):

| Value | Source |
|---|---|
| `arrivalsCount` | arrivals for today from the occupancy/PMS import (`housekeepingApi.getBoard` room rows with an arrival flag, or `reportsApi.getDailySummary`) |
| `readyForArrivals` | rooms with `status === 'INSPECTED'` that have an arrival today |
| `awaitingInspection` / `beingCleaned` / `notStarted` | `room_status_breakdown` CLEAN / IN_PROGRESS / (DIRTY + PICKUP) restricted to arrival rooms |
| `departureRoomsInPlay` | board rows with `clean_type === 'DEP'` not yet inspected |
| `blockers` | `engineeringApi.listWorkOrders({ per_page: 100 })` filtered to open/in-progress on arrival rooms + overdue cleans from the board + OOO rooms |
| `shift` | `staffApi` performance/pace per housekeeper for today, plus assignment counts from the board |
| `paceProjection` | existing AI risk-alert / prediction payload (`aiApi.getRiskAlerts`) — reuse rather than a new call |
| `overnightSummary` | `logbookApi` latest AI shift summary for the night shift |

Existing stores are unchanged: `authStore`, `hotelStore`, `uiPreferencesStore`.

**Open questions for the product owner** (flagged during design, not decided):
1. Should `arrivalsCount` come from the PMS occupancy import or be derived from the departure board?
2. Should OOO rooms with no arrival today appear in the blockers list, or only rooms needed today?

## Design Tokens

All already defined in `apps/web/app/globals.css` — no new tokens.

Surfaces `--paper #f7f4ee` · `--surface #ffffff` · `--surface-2 #fbf9f4` · `--surface-3 #f1ede4` · `--line #e6dfd1` · `--line-2 #efe9dc`
Ink `--ink #1a1815` · `--ink-2 #4a4640` · `--ink-3 #6e685e` · `--ink-4 #a8a195`
Accent `--accent #b8431c` · `--accent-soft #fbe9df` · `--accent-line #f0c8b3` (v2 ramp: `--brand #b8431c`)
Semantic `--ready #0c6e63` / `-soft #d6eae5` / `-line #a4cfc7` · `--info #265d8a` / `#d8e6f0` / `#a8c2d8` · `--progress #7c3aed` / `#ede9fe` / `#c4b5fd` · `--caution #a16207` / `#f5e9cf` / `#e0c890` · `--alert #a6263c` / `#f5d8de` / `#e8a8b3` · `--blocked #57534e` / `#f5f5f4` / `#d6d3d1` · `--ai #4a2c8f` / `#ece4f8` / `#c8b8e3`

Radius `--r-sm 6` · `--r-md 10` · `--r-lg 14` · `--r-xl 20`.
Shadows `--shadow-sm/md/lg/pop` as defined.
Spacing used: 4, 6, 8, 10, 12, 14, 16, 20, 24, 32.
Type: IBM Plex Sans (UI), IBM Plex Mono (numbers, times, room codes), Instrument Serif (H1 italic 34px, stat values 30–52px, AI italic body 16px).

## Assets

None. Icons are `lucide-react` (`layout-dashboard`, `bed`, `wrench`, `clipboard-list`, `package`, `message-square`, `list-checks`, `sparkles`, `library`, `shield-check`, `life-buoy`, `file-text`, `trending-up`, `users`, `calendar`, `book-open`, `settings`, `search`, `bell`, `chevron-down`, `panel-left-close`). The prototypes load lucide from a CDN purely for preview; production uses the npm package already in the app. The AI spark glyph is the inline SVG path already in `AILabel`.

## Files

- `GM Dashboard - v3 (3pm clock).dc.html` — the design to build
- `GM Dashboard - current.dc.html` — recreation of today's v2 GM dashboard (before state)
- `Manager Dashboard - wireframes.dc.html` — the three explored directions (1b chosen)
- `support.js` — runtime for the prototypes; not part of the deliverable

Repo files these were read from / that will change: `apps/web/app/(dashboard)/dashboard/page.tsx`, `components/dashboard/GMDashboard.tsx`, `components/dashboard/DashboardGreeting.tsx`, `components/dashboard/AIRiskAlertsPanel.tsx`, `components/dashboard/ROIMetricsStrip.tsx`, `components/dashboard/LiveOpsGrid.tsx`, `components/dashboard/TrendChartsRow.tsx`, `components/ui/primitives.tsx`, `components/ui/Card.tsx`, `components/ui/StateBlock.tsx`, `components/shared/DashboardShell.tsx`, `components/shared/Sidebar.tsx`, `components/shared/Header.tsx`, `lib/utils/navigation.ts`, `app/globals.css`, `tailwind.config.ts`, `i18n/locales/en.ts` + `es.ts` (new keys under `dashboard.gm.*`; Spanish is required — the app ships both).

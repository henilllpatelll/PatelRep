# PatelRep — Frontend Rework · Developer Handoff

## Overview

This package contains a high-fidelity design rework for **PatelRep** — an AI staff copilot SaaS for independent 50–150 room Texas hotels. The rework covers the entire web app (desktop + mobile web) across 17+ screens and 6 user roles (housekeeper, supervisor, engineer, chief engineer, front desk, GM).

The aesthetic direction is **warm operational hospitality**: calm utility for staff on the floor, hospitality warmth for the operators above them. Off-white paper, deep charcoal, a single terracotta accent for action, deep teal for ready states, amber for caution.

## About the Design Files

The files in this bundle are **design references created in HTML/React** — runnable prototypes built with `<script type="text/babel">` and inline styles for fast iteration. They are NOT production code to copy directly.

The task is to **recreate these designs inside the existing PatelRep codebase** — Next.js 14 App Router (web), Expo React Native (mobile) — using its established patterns:

- Tailwind classes / existing utility patterns (the current codebase uses Tailwind)
- React Query for data fetching
- Zustand for client state
- Supabase Realtime for live data
- The existing `components/ui/` primitives (Button, Card, Badge, Input, Skeleton) — but extended to match the new visual language

**Treat the HTML prototypes as a visual spec**, not as code to port. Re-implement using idiomatic Next.js + Tailwind. Keep all existing data flow, API clients, and state stores — only the UI layer changes.

## Fidelity

**High-fidelity.** Exact colors, typography, spacing, and component states are documented below and visible in the HTML prototypes. Developer should aim for pixel-perfect reproduction in production code.

---

## Design System Foundations

### Color tokens

All colors live in `tokens.css` as CSS variables. Port these to your Tailwind config (`tailwind.config.js` → `theme.extend.colors`) so they're usable as `bg-paper`, `text-ink`, `border-line`, etc.

#### Surfaces

| Token | Hex | Usage |
|---|---|---|
| `--paper` | `#f7f4ee` | App background — warm paper |
| `--surface` | `#ffffff` | Cards, panels |
| `--surface-2` | `#fbf9f4` | Hover state, secondary surface |
| `--surface-3` | `#f1ede4` | Inset / muted card |
| `--line` | `#e6dfd1` | Hairline divider |
| `--line-2` | `#efe9dc` | Faint divider (inside cards) |

#### Type (ink)

| Token | Hex | Usage |
|---|---|---|
| `--ink` | `#1a1815` | Primary text |
| `--ink-2` | `#4a4640` | Secondary text |
| `--ink-3` | `#807a70` | Tertiary / metadata |
| `--ink-4` | `#a8a195` | Placeholder / disabled |

#### Accent (brand action — terracotta)

| Token | Hex | Usage |
|---|---|---|
| `--accent` | `#b8431c` | Primary buttons, links, brand action |
| `--accent-soft` | `#fbe9df` | Soft accent fill |
| `--accent-line` | `#f0c8b3` | Accent borders |

#### Semantic

| Token | Hex | Usage |
|---|---|---|
| `--ready` | `#0c6e63` | Deep teal — inspected/ready states |
| `--ready-soft` | `#d6eae5` | Ready soft fill |
| `--ready-line` | `#a4cfc7` | Ready border |
| `--caution` | `#a16207` | Amber — pickup, attention-needed |
| `--caution-soft` | `#f5e9cf` | |
| `--caution-line` | `#e0c890` | |
| `--alert` | `#a6263c` | Deep rose — vacant dirty, overdue, failure |
| `--alert-soft` | `#f5d8de` | |
| `--alert-line` | `#e8a8b3` | |
| `--info` | `#265d8a` | Blue — clean (ready for inspection) |
| `--info-soft` | `#d8e6f0` | |
| `--info-line` | `#a8c2d8` | |
| `--ai` | `#4a2c8f` | Deep violet — AI features ONLY (used sparingly) |
| `--ai-soft` | `#ece4f8` | |
| `--ai-line` | `#c8b8e3` | |

#### Dark mode

Variables are remapped under `.theme-dark` in `tokens.css` — port to Tailwind's dark variant or use a `[data-theme="dark"]` selector strategy.

### Typography

Three families, all available on Google Fonts:

| Family | Usage | Weights |
|---|---|---|
| **IBM Plex Sans** | UI, body, labels | 400, 500, 600, 700 |
| **Instrument Serif** | Editorial moments — page titles, AI message quotes, hero headlines | 400, 400 italic |
| **IBM Plex Mono** | Codes, times, numbers, room numbers | 400, 500, 600 |

Google Fonts import:
```html
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
```

### Type scale

| Use | Family | Size | Weight | Line height | Letter-spacing |
|---|---|---|---|---|---|
| Page H1 (editorial) | Instrument Serif | 34–38px | 400 | 1.05–1.1 | -0.5 |
| Section H2 | Instrument Serif | 20–22px | 400 | 1.2–1.25 | -0.2 |
| Card title | IBM Plex Sans | 13–14px | 500 | 1.4 | — |
| Body | IBM Plex Sans | 13–14px | 400 | 1.5 | — |
| Small / metadata | IBM Plex Sans | 11–12px | 400 | — | — |
| Label / eyebrow | IBM Plex Sans | 11px | 600 UPPERCASE | 1 | 1.2 |
| Number / code | IBM Plex Mono | 11–22px | 500–600 | — | — |
| Stat value (display) | Instrument Serif | 28–36px | 400 | 1 | — |

### Spacing & radius

| Token | Value |
|---|---|
| `--r-sm` | 6px (chips, dots) |
| `--r-md` | 10px (inputs, buttons) |
| `--r-lg` | 14px (cards, primary surfaces) |
| `--r-xl` | 20px (hero panels) |

Standard padding inside cards: 14–16px. Standard gap between cards: 14–20px. Page padding: 24–32px on desktop, 16–18px on mobile.

### Density

Three density classes on the root (`density-comfortable`, `density-balanced`, `density-dense`) shift row heights and gaps. Default is `density-balanced`.

### Shadows

| Token | Value |
|---|---|
| `--shadow-sm` | `0 1px 2px rgba(26,24,21,0.04), 0 0 0 1px rgba(26,24,21,0.04)` |
| `--shadow-md` | `0 2px 6px rgba(26,24,21,0.05), 0 1px 2px rgba(26,24,21,0.04)` |
| `--shadow-lg` | `0 10px 30px rgba(26,24,21,0.08), 0 2px 8px rgba(26,24,21,0.04)` |
| `--shadow-pop` | `0 18px 40px rgba(26,24,21,0.12), 0 4px 12px rgba(26,24,21,0.06)` |

---

## Room Status Color System

Room status colors follow universally-intuitive hotel industry conventions. **Users should be able to read the board without a legend.**

| Status | Color | Visual treatment |
|---|---|---|
| **Inspected / Ready** | Green (`--ready`) | Solid teal — go signal |
| **Clean** — ready for inspection | Blue (`--info`) | Solid blue — awaiting inspector |
| **Vacant dirty** | Red (`--alert`) | Solid red — needs cleaning |
| **Occupied** | Striped red | Red diagonal stripe pattern — clearly "guest in room" |
| **Pickup** | Yellow (`--caution`) | Solid amber — touch-up only |
| **Out of order** | Gray (`--surface-3` / `--ink-3`) | Muted gray — unavailable |

**Apply consistently** across:
- Room status board cards (top strip color + status pill at bottom)
- Mini room grid on the dashboard
- Status filter chips
- Mobile room list tiles
- Any place a room number appears

In the mini room grid specifically, "ready" rooms are muted toward the baseline so the eye is drawn to action items.

---

## Component Inventory

The prototype defines these reusable components. Map to your codebase:

| Component | File | Purpose |
|---|---|---|
| `Icon` | `primitives.jsx` | Inline SVG icon set (~50 icons) |
| `Pill` | `primitives.jsx` | Status pill — `tone="dirty/progress/clean/inspected/pickup/ooo/accent/ai/alert/caution/info"` |
| `StatusDot` | `primitives.jsx` | Tiny colored dot |
| `Btn` | `primitives.jsx` | Button — variants: `primary, secondary, ghost, dark, outline, ai`. Sizes: `sm, md, lg`. |
| `Card` | `primitives.jsx` | Surface container with hairline border + small shadow |
| `SectionLabel` | `primitives.jsx` | Eyebrow label with hint + action slot |
| `AILabel` | `primitives.jsx` | Violet "AI" badge with optional confidence % |
| `Mono` | `primitives.jsx` | Monospace span for codes/times |
| `Bar` | `primitives.jsx` | Thin progress bar |
| `Stat` | `primitives.jsx` | KPI tile with label / display value / delta pill |
| `Avatar` | `shell.jsx` | Deterministic-color initial avatar |
| `Sidebar` | `shell.jsx` | Left nav with hotel switcher + grouped sections |
| `TopBar` | `shell.jsx` | Search + date + AI copilot button + bell |
| `PageHeader` | `shell.jsx` | Eyebrow + Instrument Serif H1 + actions + tabs |
| `CopilotBubble` | `shell.jsx` | Floating bottom-right AI trigger (collapsed + expanded states) |

Reuse the existing `components/ui/` primitives in the codebase; extend them to match the new design tokens rather than introducing a parallel set.

---

## Screens

The full list of redesigned screens. Each is implemented in the prototype as a React function component — use it as a visual spec.

### Auth & Onboarding

- **Login** (`screen-auth.jsx · LoginScreen`) — Two-pane: form on the left, dark hero with mini-dashboard preview + testimonial quote on the right. Mobile variant: single column, condensed.
- **Onboarding · staff step** (`screen-auth.jsx · OnboardingScreen`) — Step 3 of 5. Stepper across the top, team list + CSV upload on the left, AI helper dark card on the right.

### Dashboards (role-based)

All dashboards share `GreetingHeader` ("Good morning, {name}." in Instrument Serif italic) + a 4-tile `Stat` row.

- **Supervisor** (`dashboards.jsx · SupervisorDashboard`) — Morning briefing (split white + dark panel), live ops strip (6 status tiles), staff progress, predictions widget, mini room map, activity feed.
- **Housekeeper** (`HousekeeperDashboard`) — Focused on personal queue and pacing.
- **Engineer** (`EngineerDashboard`) — Work orders list + failure predictions.
- **Chief / GM** (`GMDashboard`) — ROI metrics, labor variance chart, operational risks, activity.
- **Front desk** (`FrontDeskDashboard`) — Arrivals list with VIPs, open guest requests.

Switching is exposed via the Tweaks panel in the prototype; in production this is determined by the authenticated user's role from the JWT.

### Housekeeping

- **Room status board** (`screen-housekeeping.jsx · HousekeepingBoard`) — Header meta + filter chips + grouped-by-floor grid (`RoomCard` components) + AI predictions sidebar.
- **Assignments** (`AssignmentsView`) — Per-housekeeper cards with load bar + room chips + AI pairing insight.
- **Inspections** (`InspectionsView`) — Queue list on left, active inspection panel with AI pre-check + photo grid + checklist on right.

### Engineering

- **Work orders** (`screen-engineering.jsx · WorkOrdersScreen`) — 4-column kanban (Open / In progress / Review / Completed) + sticky detail drawer with AI insight + timeline + photos + action bar. Use Supabase Realtime as per the existing `WorkOrderDetailDrawer`.

### Intelligence

- **AI Copilot** (`screen-ai.jsx · AICopilotScreen`) — Chat thread with user bubbles (dark) + AI bubbles (white card with Instrument Serif italic body + source chips + violet suggested-actions panel). Composer at the bottom. Right rail with examples, credit usage, recent threads.
- **SOP Library** (`SOPLibraryScreen`) — Searchable list + preview panel. Stale SOPs get an AI refresh suggestion.

### Operations

- **Tasks** (`screen-ops.jsx · TasksScreen`) — Grouped by Overdue / Today / This week. Quick-capture card with natural language → AI parses to task.
- **Guest requests** (`GuestRequestsScreen`) — Table with SLA timers (BREACH banner row) + detail panel with AI service-recovery suggestion + quick actions.
- **Logbook** (`LogbookScreen`) — Card per entry. AI-generated shift summaries use Instrument Serif italic body.
- **Lost & Found** (`LostFoundScreen`) — Photo card grid with 30-day disposition countdown.

### Org

- **Staff** (`screen-org.jsx · StaffScreen`) — Table with pace per housekeeper. Coaching insights in dark AI card.
- **Scheduling** (`SchedulingScreen`) — 7-day matrix with demand forecast strip on top showing coverage gaps.
- **Reports** (`ReportsScreen`) — KPI strip + big chart + 6-up grid of mini reports.

### Settings

- **Settings** (`screen-auth.jsx · SettingsScreen`) — Tabbed (Hotel profile / Roles / AI / Integrations / Billing / Audit log) with subsection nav on the left + Plan & billing + AI behavior toggles on the right.

### Mobile (390px width)

Floor-staff focused. The prototype renders these inside a phone-frame `Phone` component for presentation purposes — in production they're just normal responsive Next.js pages at mobile breakpoints, or the Expo `apps/mobile` views.

- **Login** (`MobileLogin`)
- **Housekeeper home** (`MobileHome`) — Greeting + progress ring + AI nudge + up-next queue + bottom tab bar
- **My rooms** (`MobileMyRooms`) — Filter chips + room cards list
- **Room detail** (`MobileRoomDetail`) — Hero card (room number on accent background for VIPs) + AI pre-set + VIP checklist + action grid
- **Copilot** (`MobileCopilot`) — Dark theme. Chat with chips + voice button + composer.
- **Guest request** (`MobileGuestRequest`) — Single-request view with AI service recovery + quick actions
- **Work order** (`MobileWorkOrder`) — Step-through checklist with current step highlighted

---

## AI Treatment

AI is woven throughout — **prominent without being overwhelming**:

1. **Persistent CopilotBubble** in bottom-right of every page (collapsed by default, expandable).
2. **Morning briefing** card on supervisor dashboard with Instrument Serif italic body + key metrics on dark panel.
3. **Predictions sidebar** on Room Status Board.
4. **AI insight callouts** on Work Order detail, Guest Request detail, Inspections active panel — same visual pattern: `var(--ai-soft)` background, `var(--ai-line)` border, `AILabel` with confidence %, Instrument Serif italic body, inline action buttons.
5. **Inline AI chips** on items (rooms, requests, SOPs) showing AI suggestions with the spark icon.
6. **AI shift summaries** in the Logbook get Instrument Serif italic body to distinguish from human entries.

The `--ai` token (violet) is **reserved exclusively for AI elements** — don't use it for non-AI features.

Treat the AI prominence as a brand decision: every screen should have one obvious AI affordance.

---

## Interactions & Behavior

### Sidebar

- Active item: white surface background, hairline border, accent-color 3px left bar, accent-color icon.
- Hover (non-active): subtle surface-2 background.
- Hotel switcher: dropdown on click — shows other hotels the user has access to.

### Top bar

- Search opens command palette on `⌘K` / `Ctrl+K`.
- "Ask copilot" button (violet) opens the CopilotBubble in expanded mode. Keyboard: `⌘J` / `Ctrl+J`.
- Bell with red badge for unread notifications.

### Room Status Board

- Filter chips: click to filter by status. Active state: dark `--ink` background, white text.
- Room cards: click opens `RoomDetailDrawer` (existing component, restyled).
- "Assign mode" button toggles tap-to-assign UX (existing behavior).
- Live indicator: green dot pulses every refresh from Supabase Realtime subscription.

### Work Orders

- Kanban columns: drag-drop between columns updates status.
- Card click opens drawer.
- "AI triage" button posts to an AI endpoint and animates the suggested ordering.
- "New WO" opens existing `CreateWorkOrderModal`, restyled.

### AI Copilot

- Composer: `⌘ + Enter` submits.
- Each AI message shows model + token cost in the metadata row.
- Suggested-action buttons in the violet panel are clickable — they trigger the corresponding action (e.g., "Reassign 313/314 to Maria" calls the assignments API).
- Sources are clickable chips that deep-link to the source record.

### Animations

Use existing motion patterns:
- Card hover: 150ms ease shadow lift
- Drawer slide-in: 220ms cubic-bezier(.2,.7,.3,1)
- Status filter chip switch: 120ms color transition
- AI insight bubble entrance: 280ms fade + 8px slide-up

---

## State Management

Preserve all existing flows:

- **Auth**: `authStore` (Zustand) + `useAuth` hook
- **Server data**: React Query — existing `housekeepingApi`, `staffApi`, `workOrdersApi`, etc.
- **Realtime**: Supabase Realtime subscriptions on rooms, work orders, AI alerts (already implemented in `RoomStatusBoard.tsx`)
- **Tweaks (density, theme, accent)**: Add `uiPreferencesStore` (Zustand, persisted to localStorage)

The rework is purely a UI layer. Do not change API contracts or store shapes.

---

## Responsive Breakpoints

| Breakpoint | Behavior |
|---|---|
| `< 768px` | Mobile layout — sidebar becomes bottom tab bar, page padding → 16px, multi-column layouts collapse to single column. |
| `768–1280px` | Tablet — sidebar collapses to icon-only, drawers full-screen modals. |
| `> 1280px` | Desktop — full layouts as designed. |

The mobile screens in the prototype are the explicit mobile-first designs for `< 768px`. The Expo React Native app (`apps/mobile`) gets the same visual language re-implemented natively.

---

## Files in this Handoff

### Design references (HTML / React prototypes)

- `index.html` — entry point that loads all scripts
- `tokens.css` — all design tokens as CSS variables
- `primitives.jsx` — Icon, Pill, Btn, Card, AILabel, Avatar, Stat, etc.
- `shell.jsx` — Sidebar, TopBar, PageHeader, CopilotBubble
- `dashboards.jsx` — All 5 role dashboards
- `screen-housekeeping.jsx` — Room board, Assignments, Inspections
- `screen-engineering.jsx` — Work orders + detail drawer
- `screen-ai.jsx` — Copilot, SOP Library
- `screen-ops.jsx` — Tasks, Guest Requests, Logbook, Lost & Found
- `screen-org.jsx` — Staff, Scheduling, Reports
- `screen-auth.jsx` — Login, Onboarding, Settings
- `screen-mobile.jsx` — All mobile views
- `app.jsx` — Main app composition with design canvas + Tweaks panel
- `design-canvas.jsx`, `tweaks-panel.jsx` — Layout starter components (not needed in production)

### How to view the prototype

Open `index.html` in any modern browser. It loads React + Babel from a CDN and renders all screens in a pan/zoomable design canvas. Use the Tweaks panel (bottom-right) to switch roles, accent colors, and density.

---

## Implementation Checklist

Suggested order of work:

1. **Foundations first** — Port `tokens.css` to `tailwind.config.js`. Update `apps/web/app/globals.css` to import the new fonts and set the body font-family. Verify `--paper` background renders correctly across all existing pages before touching components.

2. **Primitives** — Restyle `components/ui/Button`, `Card`, `Badge`, `Input` to match the new tokens. Add new primitives: `Pill`, `Stat`, `AILabel`, `SectionLabel`, `Mono`, `Bar`. Add the `Icon` set (or use Lucide with matching stroke weights).

3. **Shell** — Restyle `components/shared/Sidebar.tsx`, `Header.tsx`, `DashboardShell.tsx`. Add the new TopBar with search/copilot/bell. Wire up the floating CopilotBubble component.

4. **Dashboards** — Restyle each role-specific dashboard component in `components/dashboard/`. The Morning Briefing card is new — implement it as a dedicated component fed by the existing AI risk alerts data.

5. **Housekeeping** — Restyle `RoomStatusBoard.tsx` + `RoomCard.tsx` first; biggest visual impact. Then `AssignmentSidebar.tsx`, `InspectionModal.tsx` → convert to inline panel.

6. **Engineering** — Restyle work order kanban + `WorkOrderDetailDrawer.tsx`. The 4-column board with sticky drawer is the main change.

7. **AI surfaces** — Restyle `AICopilotBubble.tsx`, the AI Copilot page (`/ai/page.tsx`), SOP library. Add the AI insight callout component (reusable) and wire it into Work Order detail, Guest Request detail, Inspections.

8. **Ops + Org + Settings** — Apply patterns from the above to the remaining screens.

9. **Mobile responsiveness** — Verify all screens collapse correctly. The Expo mobile app gets the same visual language ported.

10. **Tweaks** — Add a small floating panel (or a settings drawer item) for density + accent color + dark mode toggles, persisted in `uiPreferencesStore`.

---

## Notes for the implementer

- **Don't reproduce the design canvas** (`design-canvas.jsx`) or the Tweaks panel chrome (`tweaks-panel.jsx`) — those are presentation tools for the prototype only.
- The prototype uses **inline styles** for speed. In the codebase, use Tailwind utility classes mapped to the token system.
- The `IBM Plex Sans` body font is set on `<body>` in `index.html`. In production, set it in `app/layout.tsx`.
- All icons in the prototype are inline SVG paths from a custom icon set. In production, use Lucide React (`lucide-react` npm package) with matching stroke widths (`strokeWidth={1.6}` default). Most prototype icon names map 1:1 to Lucide.
- The mobile phone frame (`Phone` component in `screen-mobile.jsx`) is a presentation device only — the inner content is what gets implemented as the real mobile page.
- Several mock data structures in the prototype mirror the existing API shapes (rooms with `status`, work orders with `priority/category/asset_id`, etc.). Use the existing typed API clients.

If anything is ambiguous, the HTML prototype is the source of truth for visual decisions. Open it in a browser, expand any artboard to fullscreen via the canvas header, and inspect.

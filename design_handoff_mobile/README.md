# Handoff: PatelRep Mobile App — Floor-Staff Screens

## Overview
This bundle is the design spec for the **PatelRep native mobile app** (the `apps/mobile/` Expo workspace). It covers the floor-staff experience across three roles — **Housekeeper**, **Inspector / HK Supervisor**, and **Engineer / Chief Engineer** — plus shared screens used by everyone (alerts, lost & found, scheduling, SOP library, profile). The defining product idea is an **AI copilot that is front-and-center**: every role's home screen opens with a copilot "hero" that proposes the next best action.

## About the Design Files
The files in this bundle are **design references authored in HTML/React (Babel-in-browser)** — prototypes that show the intended look, layout, copy, and behavior. **They are not production code to copy directly.** The task is to **recreate these designs inside the existing `apps/mobile/` Expo React Native app**, using its established patterns: the components in `apps/mobile/components/`, the API clients in `apps/mobile/lib/api/`, `appStore.ts` (Zustand), i18n in `apps/mobile/i18n/`, and the existing navigation under `app/(app)/` and `app/(auth)/`.

Translate web idioms to React Native equivalents:
- `div`/`span` → `View` / `Text`
- CSS fl
ex → RN flexbox (already the default; `flexDirection: 'column'` is RN's default, unlike web)
- `overflowY: auto` scroll regions → `ScrollView` / `FlatList`
- box-shadow → RN `shadow*` props / `elevation`
- the bottom tab bar → the existing Expo Router tab navigator
- SVG icons → `react-native-svg` (icon paths are provided verbatim in `primitives.jsx`)
- Google Fonts (IBM Plex Sans/Mono, Instrument Serif) → `expo-font` / `@expo-google-fonts/*`

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii, and copy are all intentional and specified in `tokens.css`. Recreate the UI to match, using RN primitives. Pixel parity on the AI-hero blocks, status colors, and room-number tiles matters most.

## How to read the prototypes
Open **`Mobile Designs.html`** in a browser to see everything laid out by role. Source of truth for each screen is the JSX:

| File | What's in it |
|---|---|
| `tokens.css` | **All design tokens** — colors, type stacks, radii, shadows, status classes. Start here. |
| `primitives.jsx` | Shared atoms: `Icon` (full SVG path set), `Pill`, `StatusDot`, `Btn`, `Card`, `SectionLabel`, `AILabel`, `Mono`, `Bar`, `Stat`, `RoomNumberTile`. |
| `mobile-kit.jsx` | Mobile-specific building blocks: **`CopilotHero`** (the signature AI block), `HeroBtn`, `Segmented`, `RoleTabBar`, `Row`, `Ring`, `Sheet`, `IconBtn`. |
| `screen-mobile.jsx` | `Phone` frame, `MobileHeader`, `MobileTabBar`, and the kept-as-is screens: Login, My Rooms, Room Detail, Copilot chat, Guest Request, Active Inspection, Reopen sheet. |
| `mobile-housekeeper.jsx` | `HKHomeA`, `HKHomeB` (two home layouts), `HKTasksA`, `HKTasksB` (two task layouts). |
| `mobile-ops.jsx` | `EngHome`, `EngWorkOrder`, `InspectorQueue`. |
| `mobile-domains.jsx` | `NotificationsScreen`, `LostFound`, `Scheduling`, `SOPLibrary`, `SOPDetail`, `Profile`. |
| `shell.jsx` / `screen-auth.jsx` | `Logo`, `Avatar`, `Input` helpers reused by mobile login. |

## Screens / Views

### Auth
- **Login** (`MobileLogin`) — email + password, "sign in with phone" alt path, invite link. Phone-first.

### Housekeeper
- **Home — Variation A** (`HKHomeA`): warm/light, "plan-forward". Greeting header → **CopilotHero (dark)** proposing the smart cleaning order → pace card with progress `Ring` → "Up next" room rows.
- **Home — Variation B** (`HKHomeB`): dark, "one-thing-now". Charcoal background, a single elevated focus card for the next room with a primary CTA, a compact "then" queue, and a 3-up pace strip. *Pick one direction with the team; both are built so you can compare on-device.*
- **My rooms** (`MobileMyRooms`): filter chips + status-tinted room list.
- **Room detail** (`MobileRoomDetail`): VIP hero, AI pre-set note, checklist, action grid.
- **Tasks — Variation A** (`HKTasksA`): tasks grouped on a shift timeline (Now / Before 12:00 / Afternoon).
- **Tasks — Variation B** (`HKTasksB`): priority-sorted cards (P1–P3) with swipe-to-complete affordance.
- **Copilot** (`MobileCopilot`): full-screen dark chat with suggestion chips and a composer.

### Inspector / HK Supervisor
- **Inspection queue** (`InspectorQueue`): **CopilotHero** fast-track recommendation → passed/queue summary split → filter chips → queue rows each showing an AI pass-likelihood %.
- **Active inspection** (`MobileInspection`): room hero, AI pre-check, cleaner photos, area-grouped checklist, sticky Pass/Reopen footer.
- **Reopen room** (`MobileInspectionReopen`): bottom sheet to select failing items and send back to the cleaner.

### Engineer / Chief Engineer
- **Engineer home** (`EngHome`): **CopilotHero** failure-prediction → day stat trio → PM-due nudge → work-order list with priority pills.
- **Work order** (`EngWorkOrder`): title + location + assignee, AI insight to batch adjacent units, ordered steps with a "now" step highlighted, parts used, sticky "complete step" footer.
- **Guest request** (`MobileGuestRequest`): service-recovery flow with AI suggestion + action list.

### Shared
- **Alerts feed** (`NotificationsScreen`): grouped by time; the top item is a dark **AI service-recovery** card with Apply/Open.
- **Lost & found** (`LostFound`): violet AI-match hero, filter chips, item rows, "Log a found item" CTA.
- **My shifts** (`Scheduling`): terracotta "today" card, AI coverage tip, week list with shift-type dots.
- **SOP library** (`SOPLibrary`): AI "ask how-to" search, suggested guide, category grid, recently viewed.
- **SOP detail** (`SOPDetail`): AI-tailored step list with per-step AI tags and a "now" step.
- **Profile / Me** (`Profile`): identity, month stats, settings list, sign out.

## Interactions & Behavior
- **Tab bar** is role-aware (`RoleTabBar` / `ROLE_NAV` in `mobile-kit.jsx`): center "Copilot" FAB is elevated; housekeeper = Home/Rooms/Copilot/Tasks/Me, inspector = Home/Inspect/Copilot/Tasks/Me, engineer = Home/Orders/Copilot/Assets/Me.
- **CopilotHero** is the recurring pattern: a kicker label + spark avatar, optional confidence %, a large Instrument Serif *italic* body, 1–2 action buttons, optional mono footnote. `tone="dark"` for the home hero moment, `tone="violet"` for inline nudges.
- **Checklists**: tappable rows; done = teal fill + check + strikethrough; "now" = accent-bordered + accent-soft background; AI-suggested items carry an `AILabel`.
- **Sheets** (`Sheet`, Reopen): dimmed backdrop + rounded top + grab handle, slide up from bottom.
- **Swipe-to-complete** on task cards (Variation B) — implement with a RN swipeable row.
- **Status color system** is global and must stay consistent across screens (see Design Tokens).

## State Management
Use the existing `apps/mobile/stores/appStore.ts` (Zustand) + `lib/api/` clients. Data each screen needs:
- Home: today's room assignments + AI smart-order prediction + pace/avg-clean-time.
- Tasks: assigned tasks with priority/due/source (guest vs. system) + AI reordering hint.
- Inspector queue: rooms awaiting inspection + AI pass-likelihood score per room.
- Work order: WO detail, ordered steps with completion state, parts, AI batch-insight.
- Alerts: notifications stream incl. AI service-recovery (the three realtime surfaces per CLAUDE.md: HK board, work orders, AI service recovery).
- Lost & found / Scheduling / SOP / Profile: their respective domain clients.

Per repo conventions: every query scopes to `hotel_id`; AI routing splits gpt-4o-mini (parsing) vs claude-sonnet-3.5 (reasoning); log **actual** token usage for credit accounting.

## Design Tokens
All in `tokens.css`. Key values:
- **Surfaces**: paper `#f7f4ee`, surface `#ffffff`, surface-2 `#fbf9f4`, surface-3 `#f1ede4`, line `#e6dfd1`.
- **Ink**: `#1a1815` / `#4a4640` / `#807a70` / `#a8a195`.
- **Accent (action)**: `#b8431c`, soft `#fbe9df`, line `#f0c8b3`.
- **Status**: ready/teal `#0c6e63`, caution/amber `#a16207`, alert/rose `#a6263c`, info/blue `#265d8a`, **AI/violet `#4a2c8f`** (soft `#ece4f8`, line `#c8b8e3`).
- **Radii**: 6 / 10 / 14 / 20. **Shadows**: sm/md/lg/pop (see file).
- **Type**: sans = IBM Plex Sans; mono = IBM Plex Mono (codes, times, counts); display = Instrument Serif (headlines + AI hero body, used *italic*).
- A **dark theme** variant (`.theme-dark`) is already defined — use it for Home Variation B and the Copilot chat.

## Assets
No raster assets. All icons are inline SVG path strings in `primitives.jsx` (`ICONS`) — port to `react-native-svg`. The PatelRep logo mark is an inline SVG in `shell.jsx` (`Logo`). Avatars are initials-on-color (deterministic palette in `shell.jsx`). Photo placeholders use a striped CSS gradient; replace with real `Image` components.

## Files
See the table above. Open `Mobile Designs.html` for the visual index; read the matching `*.jsx` for exact structure, copy, and inline styles.

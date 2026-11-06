# PatelRep Design System V2 — "Precision Slate + Electric Blue"

Status: **Phase 6 of 8 (Front Desk and GM mobile; see section 47 onward).** Phase 3 was Housekeeper (section 26), Phase 4 Inspector and Supervisor, Phase 5 Engineering. Phase 2 was shell, navigation, auth and headers (section 14 onward). Phase 1 was the
foundation + reference previews. V2 is disabled by default; production
still renders the legacy "Evening Lobby" look everywhere. Branch `feat/patelrep-design-system-v2`,
one draft PR for all eight phases.

Sources of truth (keep in sync; a test fails if they drift):

| Platform | Tokens | Preview |
|---|---|---|
| Mobile | `apps/mobile/components/shared/tokensV2.ts` | `apps/mobile/components/design-v2/HousekeeperHomePreview.tsx` |
| Web | `apps/web/lib/design/designV2Tokens.ts` | `apps/web/components/design-v2/DashboardPreview.tsx` |

`apps/web/lib/design/designV2Tokens.test.ts` asserts the web tokens equal the mobile tokens
value-for-value and re-checks every contrast pair. `apps/mobile/__tests__/lib/design/tokensV2.test.ts`
does the same on mobile.

## 1. Design principles

1. **Floor first.** Every screen must save a housekeeper or engineer time on the floor. Modern, calm, fast.
2. **One primary action per surface.** Everything else is secondary, tertiary or guarded.
3. **Never color alone.** Every status, priority, AI marker and error pairs color with an icon and text.
4. **Restraint.** No glassmorphism, neon, large gradients, decorative motion or empty hero space.
5. **Reuse before invent.** Extend `Button`, `Card`, `StatusBadge`, `StateBlock`; add primitives only where none existed.
6. **Preserve behavior.** V2 changes appearance only: workflows, permissions, tenant isolation, offline behavior and navigation contracts are untouched.

## 2. Color

### Light and dark (headline palette)

| Role | Light | Dark |
|---|---|---|
| Background | `#F6F8FC` | `#0B1220` |
| Surface | `#FFFFFF` | `#111C2E` |
| Secondary surface | `#EEF2F8` | `#19263A` |
| Primary text | `#0D1728` | `#F3F7FC` |
| Secondary text | `#536277` | `#A8B6CA` |
| Muted text | `#5B6B82` | `#8A9BB3` |
| Border (separators, card edges) | `#DDE4EE` | `#2A3B51` |
| Border strong (inputs, outlined controls) | `#7A8BA1` | `#6B7F99` |
| Primary action | `#2563EB` | `#60A5FA` |
| Primary pressed | `#1D4ED8` | `#3B82F6` |
| Text on primary | `#FFFFFF` | `#0B1220` |
| Destructive | `#C2414B` | `#F87171` |
| Dark navigation surface | `#0D1728` | `#070D18` (tab bar/sidebar are dark in both modes) |
| AI accent | `#7C3AED` | `#A78BFA` |

### Semantic status (text/icon color; each has `…Soft` fill and `…Line` edge)

| Status | Light | Dark | Icon (web / mobile) |
|---|---|---|---|
| Ready / Inspected | `#047857` | `#34D399` | circle-check |
| Clean | `#0E7490` | `#22D3EE` | double-check |
| In progress | `#7C3AED` | `#B9A2FC` | spinner / stopwatch |
| Dirty / Critical | `#C2414B` | `#FA8686` | flame / brush |
| Occupied | `#475569` | `#A3B1C4` | person |
| Pickup / Attention | `#B04F08` | `#FBBF24` | alert / clock |
| Out of order | `#566379` | `#A3B1C4` | wrench / close |

Dark soft fills are the status color at 14% alpha over the surface.

### Intentional deviations from the brief

| Token | Brief | Shipped | Why |
|---|---|---|---|
| Light Pickup | `#B45309` | `#B04F08` | 4.47:1 on secondary surface; `#B04F08` clears 4.5:1 |
| Light Out of order | `#64748B` | `#566379` | 4.2:1 on its soft fill; `#566379` clears 4.5:1 |
| Muted text | (none) | `#5B6B82` / `#8A9BB3` | needed a third tier that still passes on every surface |
| Border strong | (none) | `#7A8BA1` / `#6B7F99` | `#DDE4EE` is 1.28:1, fine for separators but not for form-field edges (needs 3:1) |
| Dark mode AI soft | n/a | 12% alpha | 16% dropped AI text on the secondary surface to 4.29:1 |

### Contrast contract (asserted in tests)

Text tiers, primary-action text, every status on its soft fill and on every surface, filled-control
labels (idle and pressed), nav chrome, toasts and the offline banner are all ≥ 4.5:1. Form-field
edges are ≥ 3:1. Disabled labels are kept ≥ 3:1 although WCAG exempts them.

### Protected legacy status contract

Legacy `statusTokens` / `darkStatusTokens` (mobile) and the room-status values frozen in
`apps/web/frozen-files.json` are **unchanged**. V2 introduces parallel values; it never rewrites
them. Any future change to status meaning or hue must land on mobile and web together, in the
migration phase for the affected screens, with the protected contract tests updated deliberately.

## 3. Typography (system sans-serif; numbers tabular)

| Role | Size / line | Weight | Use |
|---|---|---|---|
| display | 28 / 34 | 700 | hero numbers (room number uses 44/50) |
| title | 22 / 28 | 700 | screen title, KPI value |
| headline | 18 / 24 | 600 | section heading |
| body | 16 / 24 | 400 | default text |
| bodyStrong | 16 / 24 | 600 | row titles |
| label | 14 / 20 | 600 | field labels, small headings |
| caption | 13 / 18 | 500 | supporting text |
| micro | 12 / 16 | 500 | badges, provenance |

No unnecessary uppercase. Monospace only for identifiers (work-order IDs). Display/title cap font
scaling at 1.3×/1.5×; everything else scales to 2× and wraps rather than truncates.

## 4. Spacing, radius, elevation, touch

- Spacing (4-pt): 4 · 8 · 12 · 16 · 20 · 24; phone gutter 16.
- Radius: input 12 · control (buttons) 14 · **card 16** · hero card 18 · sheet 24 · pill full.
- Elevation: light = one soft shadow (`0 1px 2px / 8px` at ≤ 6%); dark = border only, no shadow.
- Touch targets: 44 minimum, 48 comfortable, 56 for the one primary action.

## 5. Components

| Component | Mobile | Web | Notes |
|---|---|---|---|
| Buttons (primary / secondary / tertiary / destructive) | `ui/Button` (+`tertiary`) | `Btn` | extended, not duplicated |
| Card, interactive row | `ui/Card` (V2 branch), `ui/InteractiveRow` | `Card` | cards use the subtle border |
| Status badge | `ui/StatusBadge` (V2: sentence case) | `StatusBadge`, `PriorityBadge` | always icon + text |
| Typography | `ui/AppText` | CSS | roles above |
| Text / search field | `ui/TextField`, `SearchField` | `.field` / `.input` | visible label, ≥ 3:1 edge, icon+text error |
| Segmented control | `ui/SegmentedControl` | `Segmented` | selected = raised + bolder |
| Metric card | `ui/MetricCard` | KPI card | |
| Progress | `ui/LinearProgress` | `ProgressRow` | static (reduced-motion safe), progressbar semantics |
| Icon button | `ui/IconButton` | `.iconButton` | 44 px, required label, text badge |
| Loading / empty / error / offline | `ui/StateBlock` (+`offline`) | `StatesShowcase` | |
| Sheet / drawer | `ui/BottomSheet` | `Drawer` (Radix Dialog) | see §7 |
| AI treatment | `ui/AiSurface` | `.ai` panel | soft violet + sparkle + literal "AI" chip + provenance line |

Overlap with legacy primitives (`mobileHandoff` `Segmented`/`IconButton`/`ProgressRing`, `evening`
`ProgressBar`/`Chip`) is deliberate and temporary: they bake in the old look and are used on ~100
screens. They are replaced screen by screen in later phases, then removed.

## 6. Layout guidelines

**Mobile:** 16 px gutter, 16 px vertical rhythm, content in cards on the tinted background, dark
bottom navigation (4–5 items), one primary action per card, secondary actions beside or beneath it.
Guarded actions are disabled with a visible reason, never hidden.

**Web:** dark 248 px sidebar + white header (property selector, search, notifications, account) +
max-width 1440 content. KPI row 5 → 3 → 2 → 1 columns. Two-column body collapses below 1100 px.
Below 1024 px the sidebar becomes a left drawer opened from the header. Tables collapse to labeled
stacked cards below 720 px.

## 7. Drawer, sheet and modal conventions

- **Mobile bottom sheet:** one task, ≤ 88% height, handle + title + close, scrim tap and system back
  close it, pinned footer for actions, `accessibilityViewIsModal`, no slide under Reduce Motion.
- **Web right drawer (440 px):** records and short forms. Radix Dialog gives focus trap, Esc, scroll
  lock and focus return (verified). Never stack drawers.
- **Left drawer:** navigation on small screens only.
- **Centered dialog:** confirmations of destructive/irreversible actions only.

## 8. Accessibility requirements

Contrast contract above; 44 px targets; every icon-only control has a spoken name; status and AI
never color-only; visible 3 px focus ring on web; text fields keep a visible label; dynamic text
supported with wrapping layouts; reduced-motion: static progress, no sheet/drawer animation under
the OS setting; forced-colors borders on web; English and Spanish strings tested for key/placeholder parity.

## 9. Preview configuration

Both flags are **off by default**, ignored when the environment is `production`, grant nothing, and
touch no database or migration.

| | Mobile | Web |
|---|---|---|
| Flag | `EXPO_PUBLIC_DESIGN_V2_PREVIEW=true` | `NEXT_PUBLIC_DESIGN_V2_PREVIEW=true` |
| Production guard | `EXPO_PUBLIC_APP_ENV=production` disables it | `NEXT_PUBLIC_APP_ENV=production` disables it |
| Route | `patelrep://design-v2-preview` / web `/design-v2-preview` | `/design-v2-preview` |
| Flag off | redirects to app root | 404 |

```bash
# Web (needs real or dummy NEXT_PUBLIC_SUPABASE_* values as usual)
NEXT_PUBLIC_DESIGN_V2_PREVIEW=true npm run dev:web      # then open http://localhost:3000/design-v2-preview

# Mobile
cd apps/mobile && EXPO_PUBLIC_DESIGN_V2_PREVIEW=true npx expo start
# open the dev build with the deep link patelrep://design-v2-preview
```

Notes: the web route is in `PUBLIC_ROUTES` so it can be reviewed without a session; it 404s itself
when the flag is off. Never set either flag in an EAS profile, Dockerfile, Railway or Vercel env.
For a browser view of the mobile preview use `npx expo start --web` with `"web.output": "single"`
temporarily in `app.json` (default static output crashes on the Supabase client; do not commit that).

How V2 stays isolated on mobile: `useTheme()` returns V2 tokens **only inside an active
`<DesignV2Scope>`**, and the scope is inert when the flag is off. Existing light/dark/system
appearance still drives the mode; the preview adds its own local toggle. Static `C.*` token reads
(frozen) are not affected.

Previews use clearly labeled sample data; the AI panel says the text is not generated from real
data. They are not linked from any navigation.

## 10. Migration strategy for remaining phases

1. Phase 2+: migrate one role/area per phase (screen by screen) by wrapping the area in
   `DesignV2Scope` (mobile) or swapping to the V2 shell (web), behind the same flag.
2. Replace legacy primitives with V2 ones as each screen moves; keep behavior and testIDs.
3. When an area is done, update its protected-status tests deliberately (mobile + web together).
4. Final phase: make V2 the default theme, delete legacy tokens, `C.*`, `mobileHandoff`/`evening`
   look-specific components, `Evening Lobby` CSS variables, and the flag.

## 11. Legacy patterns targeted for removal

Warm paper/forest-green/terracotta palette; shouting uppercase micro-labels (`StatusBadge` 800
uppercase); Instrument Serif headline accents; IBM Plex Mono as a general UI font; ad-hoc card
shells; per-screen status color mappings; `C.*` static tokens; the housekeeper-only terracotta accent.

## 12. Preservation requirements (never regress)

Role permissions and RBAC, tenant isolation (`hotel_id` scoping), offline queue and sync behavior,
AI credit accounting, safety workflows, Opera feature flag, notification and deep-link contracts,
i18n parity, protected room-status values, and every existing navigation route and testID.

## 13. Differences from the example mockups

- Web preview uses lucide icons and the already-loaded IBM Plex Sans instead of a new font load.
- Light-mode nav is the same dark slate as dark mode (per the brief), not a tinted light rail.
- "Pickup" and "Out of order" light hues are slightly darker for contrast (see §2).
- Sample figures differ from any screenshot; they are invented and labeled as such.

---

# Phase 2 of 8: shared app shell, navigation, authentication and headers

Status: implemented on the same branch/PR as Phase 1. Everything below renders **only while the
Phase 1 preview flags are on** (`EXPO_PUBLIC_DESIGN_V2_PREVIEW` / `NEXT_PUBLIC_DESIGN_V2_PREVIEW`,
off by default, ignored when the app environment is `production`). With a flag off, the platform
renders exactly what it rendered before Phase 2. No backend, database, migration, RBAC, route or
authentication-logic change is part of this phase.

## 14. How Phase 2 stays isolated (the rule for every later phase)

The Phase 1 `DesignV2Scope` recolors everything inside it, so putting it at the app root would
recolor ~100 unmigrated screens. Phase 2 therefore uses three narrow mechanisms:

| Mechanism | Where | What it affects |
|---|---|---|
| `useChromeTheme()` (`lib/theme/useTheme.ts`) | mobile tab bar (outside any scope) | V2 tokens only for layout-level chrome while the flag is on; screens keep `useTheme()` |
| `<DesignV2Scope>` around a *fully migrated* area | mobile `(auth)` stack, `OfflineBanner`, `ToastViewport`, Settings screens | everything inside is V2 when the flag is on; inert pass-through otherwise |
| Remap of legacy CSS token names on a *chrome subtree* | web header (`.chromeLight`), web sign-in (`.page`) | the existing component keeps its logic; only its colors change. Page bodies in `<main>` are never inside a remap scope (a test enforces this) |

Screens that reuse a migrated frame for non-matching content opt out explicitly:
`SettingsScreen v2Chrome={false}` is used by Team, Team member and Engineering Sync.

## 15. Mobile bottom navigation

Source: `lib/navigation/tabChromeV2.ts` (pure, tested) and `components/shared/TabIconV2.tsx`;
applied in `app/(app)/_layout.tsx` only when the flag is on.

- **Surface:** the dark-slate `shell` tokens, dark in both light and dark app mode (Phase 1 contract).
- **Selected tab:** electric blue (`NAV_ACTIVE_V2` = the dark-mode primary `#60A5FA`, the blue that
  clears 4.5:1 on the slate; the light-mode blue does not), a filled glyph and a raised pill behind
  the icon. Selection is therefore shape + weight + color, never color alone.
- **Idle tab:** `shell.ink2`, 4.5:1 or better on the bar.
- **Geometry:** 64 dp bar + the device inset (minimum 8 dp, so 72 dp on a phone without a home indicator), instead of the legacy fixed 76. Items
  keep a 44 dp minimum. 12 sp labels (11 sp when five or more tabs). No shadow/elevation.
- **Badge:** destructive fill, 18 dp pill, nudged onto the icon corner (`tabBarBadgeStyle`).
- **No flicker/remount:** the glyph pill is static; tab screens are unchanged `Tabs.Screen`s.
- **Icons:** Home is now a house; Room Board keeps the grid (they were both a grid in the legacy
  set). Idle = outline, focused = filled. Routes, `HIDDEN_APP_ROUTES`, `ALL_ROLE_TAB_ROUTES` and
  role tab sets are untouched, and the hidden-route workaround (`tabBarItemStyle: display none`,
  never `href: null`) is preserved.

| Role | Tabs (unchanged) |
|---|---|
| Housekeeper | Home, My Rooms, Tasks, Profile |
| Inspector | Home, Inspect, Tasks, Profile |
| Engineer / Chief Engineer | Home, Work, PM, Assets, More |
| Housekeeping Supervisor | Home, Room Board, Assign, Inspect, Profile |
| Front Desk | Home, Requests, Rooms, Logbook, Lost & Found, Profile (six; unchanged for now) |
| General Manager | Home, Alerts, Staff, Profile |

## 16. Mobile header contract

Source: `components/shared/HeadersV2.tsx`. Presentation only: no fetching, navigation or
permission decisions. Colors via `useTheme()`, so a header is V2 inside a `DesignV2Scope`.

| Component | Use | Contract |
|---|---|---|
| `HomeHeader` | role home screens | title, optional subtitle, **hotel context line**, `ConnectionIndicator`, `NotificationBell`, optional `AvatarButton` |
| `ScreenHeader` | tab roots | title, optional subtitle, trailing slot (max two controls) |
| `DetailHeader` | pushed screens | 44 dp back at the leading edge, wrapping title, optional trailing action |
| `SheetHeader` | modals/sheets | title + named Close; the sheet owns the handle and inset |
| `AccountHeader` | Profile and Settings | same grammar as Detail; keeps the legacy `settings-back` / `settings-title` test IDs |

Shared rules: the header applies the safe-area top inset itself; titles wrap (never one-line
truncate) and cap font scaling at 1.5x; every icon-only control has a spoken name; the unread count
is text and part of the accessible label (`Notifications, 3`); a connection chip always pairs an
icon with text. `useConnectionState()` reports only what the app store knows: **offline**, **N
changes waiting to send**, or **online** (hidden when online). Strings: `headerV2.*` (EN/ES).

**Migrated:** `AccountHeader` is live in all Settings/Profile screens via `SettingsScreen`.
**Not migrated (documented for the role phases):** the role-specific home headers
(`components/home/HomeHeader`, `supervisor/today/TodayHeader`, `engineering/home/TechnicianHomeHeader`,
`engineering/more/MoreHeader`) have role-specific layout (shift status, sync drawer, serif greeting).
They keep their own look and will adopt `HomeHeader`/`ScreenHeader` in their phases; the preview
screen has its own header. No screen was forced onto these components in this phase.

## 17. Mobile authentication

The `(auth)` stack is wrapped in `DesignV2Scope`, so Login, Forgot password, Reset password and the
callback states take V2 colors together. Behavior is untouched (Supabase password and email-link
sign-in, `classifyAuthError`, rate-limit/offline messages, `shouldCreateUser:false`, recovery store,
redirects, app-lock hand-off): only presentation changed, and only with the flag on.

- Login: dark-slate logo tile with a blue glyph, "Welcome back." as a 30 sp system-bold heading (no
  serif, no uppercase eyebrow), **visible field labels** above the fields, 52 dp controls with 14 dp
  radius, a 1.5 dp field edge that turns blue on focus, red + text for errors, named show/hide
  password toggle, secondary email-link button, forgot-password link.
- Forgot/Reset use `AuthFrame` (V2: tinted 44 dp back button, 28 sp title) and `Button`/`AuthTextField`.
- Existing test IDs are unchanged.

## 18. Mobile shared chrome

- Offline banner: adds a cloud-off icon in V2 (inside `DesignV2Scope`); same role/alert semantics.
- Toasts: render inside `DesignV2Scope` (V2 toast tokens); position math unchanged.
- Tab bar, Settings frame and section groups (sentence-case section labels, subtle card edge) as above.

## 19. Web management shell

Source: `components/design-v2/shell/` (`ShellV2`, `SidebarV2`, `HeaderLeadingV2`, `shellV2.module.css`)
and `lib/design/shellNav.ts`. `DashboardShell` returns `ShellV2` only when
`isDesignV2PreviewEnabled()`; the legacy markup below it is unchanged.

```
+-----------+---------------------------------------------------------------+
| sidebar   | header: [menu<1024] property | route trail | search(Ctrl K)  |
| 248 / 72  |         language, notifications, account (existing Header)     |
| dark slate+---------------------------------------------------------------+
| brand     | main#main-content  (max-width 1440, 24 px gutter, V2 background)|
| Overview  |   page bodies are still legacy until their phase                |
| Operations|                                                                 |
| Records   |                                                                 |
| prefs/    |                                                                 |
| settings  |                                                                 |
| collapse  |                                                                 |
| identity  |                                                                 |
+-----------+---------------------------------------------------------------+
```

- **Navigation data:** `buildShellNavGroups` re-buckets `getAllowedNavItems`, the same single source
  of truth the legacy sidebar, command palette and breadcrumbs use. A test proves the V2 sidebar
  shows exactly the legacy set for every base role, custom-role modules and hotel front-desk
  modules. No second permission list exists. Settings stays `canAccessSettings`-gated (GM).
- **Active destination:** raised tile + 4 px blue bar + bold weight + `aria-current="page"`.
- **Collapse:** an explicit toggle (persisted in the existing `uiPreferencesStore.sidebarCollapsed`)
  collapses to a 72 px icon rail. Between 1024 and 1279 px the rail is forced (the toggle is hidden).
  Collapsed items keep a visually-hidden label (accessible name) and show a Radix tooltip on hover
  *and* keyboard focus.
- **Header:** the existing `Header` (notifications panel, language toggle, account menu with
  focus management, sign-out, environment badge) with a V2 leading area: menu button (< 1024 px),
  property chip (the signed-in property, read-only; PatelRep has no multi-property switcher), a
  Section / Page trail from the same nav tables, and a search button that opens the **existing**
  command palette (`command-palette:open`, also Ctrl/Cmd K). No new search backend.
- **Small screens (< 1024 px):** the sidebar becomes a left Radix Dialog drawer: focus trap, Esc,
  overlay click, scroll lock; route change and link clicks close it; focus returns to the menu
  button; growing past 1024 closes it. Reduced motion removes the slide.
- **Skip link** to `#main-content`; `main` is focusable; sidebar and trail are labelled landmarks.
- **Not touched:** `AICopilotBubble`, `FeedbackButton`, `TweaksPanel`, `Toaster`, `CommandPalette`,
  `MobileFloorNav` render as before; page bodies keep legacy styling.

## 20. Web authentication

`app/(auth)/login/page.tsx` has one flag-guarded V2 branch that reuses the page's state and handlers
verbatim (password, magic link, `MOBILE_ONLY_ROLES` sign-out, redirect rules, service-health
probe). V2: centered 440 px card, slate logo tile, "Welcome back" heading in system bold, segmented
sign-in method, labelled 48 px fields (16 px text, 3:1 edge), a 44 px named show/hide toggle with
`aria-pressed`, 52 px primary button with a spinner state, `role="alert"` errors, no marketing hero or
invented figures. The legacy two-pane layout is untouched when the flag is off. The separate
`/auth/reset-password` and `/auth/callback` pages are not restyled in this phase.

## 21. Responsive behavior (web)

| Width | Sidebar | Header |
|---|---|---|
| >= 1280 | 248 px (or 72 px rail if the user collapsed it) | full |
| 1024-1279 | 72 px rail (forced) | full |
| 721-1023 | left drawer from the menu button | menu, property, trail, search, account |
| <= 720 | drawer | search collapses to an icon, property and trail text hide |

Content: `max-width 1440`, gutters 24 px (16 px under 1024).

## 22. Previewing Phase 2

```bash
# Web (use dummy or staging NEXT_PUBLIC_* values; sign in, or use the hermetic mock below)
NEXT_PUBLIC_DESIGN_V2_PREVIEW=true npm run dev:web      # shell on every dashboard route, V2 sign-in at /login

# Mobile
cd apps/mobile && EXPO_PUBLIC_DESIGN_V2_PREVIEW=true npx expo start   # tab bar, auth, Settings, banner/toasts
```

A credential-free web preview: run `node e2e/hermetic/mock-backend.mjs` and start the app with
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_API_URL` set to `http://127.0.0.1:4010`, then sign in as
`gm@hermetic.invalid` with the fixture password in `e2e/hermetic/mock-backend.mjs`.

## 23. Known limitations

- Role home screens, Tasks, My Rooms, Work Orders, etc. keep legacy colors and headers under the V2
  tab bar (intentional mix until their phases); the dark nav is therefore next to warm legacy
  screens in preview.
- Web page bodies, the Tweaks panel, notifications dropdown internals and the command palette keep
  legacy styling (the dropdown picks up V2 colors because it lives inside the remapped header).
- Web `/auth/reset-password` and `/auth/callback` are not restyled.
- The web property chip is read-only; the legacy user-menu items remain the account entry points.
- The Tweaks panel still offers accent/density; V2 ignores accent in chrome (primary is fixed).
- Six-tab bars (Front Desk) on a 320 dp phone truncate the longest labels ("Requests", "Logbook", "Lost & Found") with an ellipsis, as the legacy bar did; the Front Desk destination review is a later phase.
- The mobile offline banner sits at the very top and does not add the top inset (pre-existing).
- No native-device run: iPhone/Android safe-area, keyboard and screen-reader behavior are verified
  by unit tests and structure only. Mobile web rendering was checked in a browser where noted below.

## 24. Manual QA checklist (before promoting beyond preview)

Mobile (flag on, light + dark, EN + ES, large text): each role's tab set and order; selected pill and
label contrast; badge placement; bar height on notch and no-notch phones; a 5-6 tab bar at 320 dp;
hidden routes (open Profile > Language, Notifications, a detail screen) do not bounce to Home;
login/forgot/reset/callback with keyboard open; offline banner; toast position; Settings headers
and back; legacy appearance with the flag off is pixel-identical.

Web (flag on): each base role's sidebar vs the legacy list; collapse/expand and reload persistence;
tooltips on hover and keyboard focus; drawer open, Tab cycling, Esc, overlay click, focus return,
route change; resize across 1280 / 1024 / 720; no horizontal scroll at 390 px; skip link; Ctrl K;
notifications, language and account menu; sign-in with error, magic link, show/hide password,
mobile-only redirect; flag off is the legacy shell.

## 25. Outstanding migrations (later phases)

Role home headers -> `HomeHeader`/`ScreenHeader`; each role's tab roots and detail screens ->
`DetailHeader`; sheets -> `SheetHeader`/`BottomSheet`; Front Desk destination review (six tabs);
web page bodies, `PageHeader`, notifications panel, command palette, Tweaks and `MobileFloorNav`;
web `/auth/*` recovery pages; removal of the legacy `Sidebar` and the per-hotel `shell` redesign
flag once V2 is the default.

---

# Phase 3 of 8: Housekeeper mobile redesign

Status: implemented on the same branch/PR. Renders **only** for the Housekeeper role while the Phase 1
preview flag is on (`EXPO_PUBLIC_DESIGN_V2_PREVIEW`, off by default, ignored in production). No API,
database, migration, RBAC, route or production-config change. Flag off = the legacy look, unchanged.

## 26. How Phase 3 is scoped

`DesignV2Scope` gained an `enabled` prop. `app/(app)/_layout.tsx` wraps the tab screens, hidden routes
and the assistant in `<DesignV2Scope enabled={isHousekeeperV2Role(effectiveRole)}>`, so every screen a
housekeeper can reach (including Notifications, SOP, Lost & Found, Profile) takes V2 colors, and every
other role renders outside the scope. Shared components branch on `useIsDesignV2()` / `useV2Text()`
(`lib/design/housekeeperV2.ts`): label (sentence case), num/display (system sans, tabular digits),
title, and `edge` (separator edge for card-like surfaces; controls and inputs keep the strong edge).
Outside the scope every override is `null` and `edge` is the old `theme.border`.

## 27. Migration checklist

| Area | Migrated |
|---|---|
| Home header (hotel line via read-only `GET /hotels/:id`, sentence-case date, shift status, bell, sync chip) | yes |
| Home hero card (active, recovery, recommended), Up next, Needs attention, Today's progress, supervisor note (Kicker/Card), AI briefing entry | yes |
| Home states (before shift, break, clocked out, no assignments, unavailable, submitted, all handled) | via Kicker/Card/Button/Chip tokens; layouts unchanged |
| My Rooms header, summary card, segments, search, floor groups, route cards, compact rows, current/recovery card | yes |
| Room Detail (header, timer, checklist, before/active/submitted/ready/attention/unavailable views, sticky actions, restriction/reclean/rush panels) | yes (tokens + label/num/edge overrides) |
| Sheets: one `roomDetail/BottomSheet` carries all of them: Room information, actions/more, completion, notes, issue, supplies, service exception, damage/photo, flags, linen, sync details, found item, mark clean, finish shift, shift progress, briefing, supervisor message, recommendation, issue details, sync status, task sheets | yes (V2 radius 24, handle, tinted 44 close, ruled footer) |
| Guest knock / entry guidance (full-screen) | recolors with the V2 slate shell tokens |
| Tasks header, summary, segments, task cards, history, detail/add/complete/unable/activity sheets | yes |
| Housekeeper assistant sheet | geometry only; keeps its pinned dark palette |

## 28. Behavior preserved and deliberate choices

- Primary action on the hero card still only opens the existing room workflow. Quick "Mark clean"
  appears only when `canQuickMarkClean` allows it; otherwise V2 shows "N checklist steps left before
  you can mark this room clean" (derived from real checklist counts).
- Elapsed time shows only from a real session start; no invented ETAs.
- AI: the briefing entry shows the deterministic on-phone headline and a provenance line; opening Home
  or refreshing makes no AI call. A written briefing is still requested only inside the drawer.
- The terracotta housekeeper accent is retired in V2 (hold-to-confirm uses slate track + blue fill).
- All test IDs, accessibility roles and handlers are kept. The only new network read is the hotel name,
  and only while V2 is on.
- Added strings (EN/ES): `home.current.{title,titleNext,badge*,remaining}`, `home.briefing.{aiChip,v2Provenance}`.

## 29. Verification

Mobile `tsc`, ESLint and the full Jest suite pass (see the PR for the final run), including
`__tests__/components/HousekeeperV2.test.tsx` (role gate, flag-off contract, hero guard, header, tabs,
sheets, copy). A temporary browser harness (not committed) rendered Home, My Rooms, Room Detail, Tasks
and a sheet in light, dark and Spanish at 390 px with no console errors. No native device run.

## 30. Known limitations and cleanup

- No iPhone/Android device or screen-reader run; run the manual QA below.
- Notifications, SOP (list and detail), Lost & Found and the Guest knock screen use theme tokens, so they
  take the V2 colors, and (verification pass) now also take the sentence-case labels, separator edge on
  cards and the system-sans title. Their layouts are unchanged and other roles that share them (Engineering
  SOP, every role's Notifications) are unaffected, because every override is `null` outside the scope.
- The Housekeeper assistant sheet keeps its pinned dark palette (decision D-11); a V2 violet restyle is
  not part of this phase's commits.
- No screenshots are committed: the browser harness used for the 390 px light/dark/Spanish checks was
  temporary. Visual evidence is therefore the test suite plus the manual QA below.
- `StaffTasksScreen`, `SupervisorHome` and other-role uses of shared primitives stay legacy.
- Cleanup once every role is migrated: legacy `serifFont`/`monoFont` call sites, `housekeeperAccent`,
  the `evening`/`mobileHandoff` primitives, uppercase `headerMeta`.

## 31. Manual QA (flag on, Housekeeper account)

Light/dark, EN/ES, 320 dp and large phones, largest text: Home in each shift state; start/resume/
complete a room (hold-to-confirm, offline queue); My Rooms tabs, search, floor collapse, "Why next?";
every room sheet with keyboard open; Tasks claim/start/complete/unable, add task, offline sync; confirm
other roles are unchanged and the flag-off app looks as before.

## 32. Sheet and drawer inventory (all render through `roomDetail/BottomSheet` or the full-screen knock view)

| Group | Surfaces |
|---|---|
| Home sheets | Shift progress, Finish shift review, Completed shift summary, Supervisor message, Recommendation ("Why next?"), Issue details, Mark clean confirmation, Room quick actions, AI briefing, Sync status, service sheets |
| Room sheets | Room information, Report more, Complete cleaning, Room note, Service exception, Room flags, Sync details, linen exchange |
| Room modals and panels | Report issue, Supply request, Found item, Room restriction, Reclean corrections, Rush priority |
| Tasks sheets | Add task, Task detail, Complete task, Unable to complete, Activity notes, Task sync |
| Full-screen | Guest knock guidance (V2 title and step edge; the all-steps-required confirm and exits are unchanged) |

## 33. Design deviations and flag behavior

- The terracotta housekeeper accent is retired inside V2 only (hold-to-confirm: slate track, blue fill).
- Kicker, header-meta and field labels lose their capitals inside V2; the text itself is the translated string.
- Assistant sheet: not restyled (see section 30).
- Flag behavior: `EXPO_PUBLIC_DESIGN_V2_PREVIEW` off (default) or a non-Housekeeper role renders exactly the
  legacy look; the flag is ignored in production builds.

---

# Phase 4 of 8: Inspector and Housekeeping Supervisor mobile redesign

Status: implemented on the same branch/PR (#200, draft). Renders **only** for the `inspector` and
`housekeeping_supervisor` roles (plus the Housekeeper from Phase 3) while the preview flag is on
(`EXPO_PUBLIC_DESIGN_V2_PREVIEW`, off by default, ignored in production). No API, database, migration,
RBAC, route or production-config change. Flag off = the legacy look, unchanged.

## 32. How Phase 4 is scoped

`isInspectorSupervisorV2Role` / `isV2SurfaceRole` (`lib/design/housekeeperV2.ts`) widen the Phase 3 gate.
`app/(app)/_layout.tsx` wraps the tabs, hidden routes and assistant in
`<DesignV2Scope enabled={isV2SurfaceRole(effectiveRole)}>`. Engineering, Front Desk and GM stay outside the
scope and render exactly as before. `useV2Text()` gained `pill` (readable 12 px sentence-case status text) and
`caps(text)` (uppercase outside the scope, the translated sentence case inside). Shared supervisor/inspection
components therefore need no role branches: every override is `null` or legacy outside the scope.

## 33. Inspector

| Surface | Migrated |
|---|---|
| Inspector Home (new, `components/home/InspectorHome.tsx`; replaces the Housekeeper fallback **only inside the scope**) | yes |
| Home: header (property, date, bell, status), Next inspection hero, Today's inspections overview, Needs attention first, Recent results | yes |
| Home states: loading, offline note, stale banner, unavailable (retry), restricted account, empty, all complete | yes |
| Inspections queue (`inspect/index`): header, summary, segments, search, filter sheet, cards, correction cards, done rows | yes |
| Active inspection workspace: room summary, progress, section headers, review view, reinspection panel, result views, state views | yes |
| Workspace sheets: context, guidance, issue sheets | yes |
| History: toolbar, filter sheet, quality insights card/sheet, result badge | yes |
| Inspection record (`inspect/record/[id]`) parts | yes |
| Correction card, summary and detail sheet | yes |

The Home reads the existing inspection queue hooks through `lib/inspections/inspectorHome.ts` (a pure view-model
over the existing queue model). It adds no endpoint, no parallel store, and invents no assignments, ETAs or records.
The primary action opens the existing workspace; a room that is not startable shows its real blocking reason.

## 34. Housekeeping Supervisor

| Surface | Migrated |
|---|---|
| Today (`SupervisorHome`): shared `RoleHomeHeader` (property, date, data freshness, bell, profile), readiness, exceptions, Team Pulse, quick actions | yes |
| Quick actions: one calm surface for all actions (legacy keeps four status tints); every action and label kept | yes |
| Room Board: header, readiness card, filter sheet, list rows, tiles, room detail sheet | yes |
| Assignments: header, room card/rows, room sheet and chooser, workload parts, team staff card, staff detail sheet | yes |
| Bulk assign/edit/review, Smart Balance entry/preview/detail/exceptions, midshift select/review/parts, remove step, outcome step | yes |
| Attention Center screen and detail sheet | yes |
| Team scheduling: header, week selector, staffing summary, shift detail sheet/body, call-out, find coverage, forecast day sheet, request and form parts | yes (tokens/labels) |
| Communications: broadcast, direct message, shift note, shared comms parts | yes |
| Shift handoff panels and staff quick view | yes |
| Assistant sheet (`ai/palette.ts`, `AssistantSheet`) | Inside the scope the compact sheet and its nested controls use the scoped V2 palette (new `AssistantPaletteContext`); outside it the assistant stays pinned dark (D-11). Capability flags and credit boundaries untouched |

Room cleanliness, inspection state, occupancy and availability stay separate dimensions with their own words and
icons; the redesign changes color and type only, never the status model, filters, realtime subscriptions or deep links.

## 35. Behavior preserved

- Assignment eligibility, workload math, Smart Balance, midshift handling, draft restore, duplicate-submit guards and
  server-confirmed outcomes are untouched (only style props changed in those files).
- Inspection submit-once, required evidence, draft persistence and the "conditional never releases a room" rule are untouched.
- Messages are never sent or re-addressed by the redesign; sent, failed and pending states keep their separate treatments.
- All test IDs, accessibility roles and handlers are kept. Added strings (EN/ES): `inspectorHome.*`,
  `supervisorToday.header.*`.

## 36. Verification

Mobile `tsc` and ESLint (`--max-warnings=0`) are clean. New focused tests: `InspectorSupervisorV2.test.tsx`,
`InspectorHomeV2.test.tsx`, `inspectorHome.test.ts`, `AssistantPaletteV2.test.tsx` (role gate, Home routing flag on/off,
text helpers, shared pieces following the scope, header, quick actions, uppercase-kicker guard, Inspector Home states).
The full Jest suite result is recorded in the PR. No native device or screen-reader run, and no committed screenshots.

## 37. Migration coverage and known limitations

- Scheduling and the Attention Center take V2 colors and sentence-case labels; their layouts are unchanged
  (progressive-disclosure rework was not attempted).
- Phase 4 fixes no layout of screens that already worked; dynamic type, Spanish expansion and safe areas rely on the
  existing layouts and are unverified on device.
- Light/dark: both are exercised by token-based rendering and the contrast tests; not visually reviewed on a device.
- Remaining legacy (other roles): Engineering, Front Desk, GM, and shared uses of legacy primitives outside the scope.
- Cleanup once every role is migrated: legacy `serifFont`/`monoFont` call sites, uppercase `headerMeta`, the
  `evening`/`mobileHandoff` primitives.

## 38. Previewing Phase 4

```bash
# Mobile (Expo dev build); sign in as an Inspector or a Housekeeping Supervisor
EXPO_PUBLIC_DESIGN_V2_PREVIEW=1 npx expo start --dev-client
# Flag off (default): every role looks exactly as before.
```

## 39. Manual QA (flag on, Inspector and Supervisor accounts)

Inspector: Home in each state, start/continue an inspection, save-and-exit, review and submit, history filters,
record. Supervisor: Today, Room Board filter and detail, single and bulk assign, Smart Balance, midshift, Attention,
schedule and coverage sheets, broadcast/DM/shift note/handoff. Check light, dark, Spanish, large text, offline.

---

# Phase 5 of 8: Engineer and Chief Engineer mobile redesign

Status: implemented on the same branch/PR (#200, draft). Renders **only** for the `engineer` and
`chief_engineer` roles (plus the Phase 3 and 4 roles) while the preview flag is on
(`EXPO_PUBLIC_DESIGN_V2_PREVIEW`, off by default, ignored in production). No API, database, migration, RBAC,
route, offline-engine or production-config change. Flag off = the legacy look, unchanged.

## 40. How Phase 5 is scoped

`isEngineeringV2Role` (`lib/design/housekeeperV2.ts`) widens `isV2SurfaceRole`, so
`app/(app)/_layout.tsx` wraps the five tabs, every hidden route and every sheet an engineer can reach in
`<DesignV2Scope>`. 136 of the 140 engineering screen/component files already read colors through `useTheme()`, so
the scope recolors them to the V2 light/dark palette without per-file color edits. Front Desk and GM stay outside
the scope and render exactly as before. Shared screens an engineer reaches through More (Settings, Notifications,
SOP, Scheduling, Profile pages) are role-gated by the same wrapper, so other roles are unaffected.

What Phase 5 changed beyond the gate:

| Change | Where |
|---|---|
| Uppercase micro-labels become readable sentence case (`x.label` / `x.pill`; `x.caps()` for strings built in code) | 36 engineering files, 50+ call sites (queue headers, filter sheets, work-order sections, PM, assets, rooms, sync, team) |
| Monospace figures become tabular system sans (`x.num`) | work-order number, labor timer, activity stamps, home summary values, card codes, Room Status figures |
| Category chips follow dark mode: `useCategoryMeta()` returns the V2 live theme inside the scope and the unchanged static `CATEGORY_META` outside it | `WorkOrderCard.tsx`, `WorkOrderReportedIssue.tsx` |
| Repair Assist suggestion is framed with the V2 violet AI surface (soft fill, violet edge); AI is still only requested by the explicit "Get suggestions" button | `RepairAssistSheet.tsx` |
| Dead uppercase style removed | `pm-schedules/inspect/[scheduleId].tsx` |

Not changed on purpose: the printed QR label (`assets/label/[assetId].tsx`) and `QrCode.tsx` stay fixed
black-on-white, because they are a physical sticker and a scannable code, not UI.

## 41. Migration matrix

Legend: scoped = renders in the V2 scope (palette + typography); layout unchanged.

| Destination | Roles | Status |
|---|---|---|
| Home: Engineer (`EngineerHome`, `home/Technician*`) | engineer | [x] scoped, labels/figures migrated |
| Home: Chief Engineer (`ChiefEngineerHome`, `ChiefOversight`, `PropertyPriorities`, `TeamWorkloadPreview`) | chief | [x] scoped, labels migrated |
| Rooms Down sheet, Assign Technician sheet | chief | [x] |
| Work queue (`work-orders/index`, header, tabs, summary and manager tiles, card, filter sheet) | both | [x] |
| Work-order detail (`[woId]`, header/summary, reported issue, asset context, PM source, progress, next action, checklist, repair tools, activity timeline, record card, sticky bar) | both | [x] |
| Work-order sheets: more actions, labor, diagnosis, evidence, parts, hold, escalation, notes, completion, repair assist, technician assignment | both | [x] |
| Report Issue (`components/engineering/report/**`) | both | [x] scoped |
| PM overview (today, plan/week, calendar, history, filters, cards) | both | [x] |
| PM detail, inspection/execution, review, failure sheet, queued notice, completion summary | both | [x] |
| PM management (overview, programs, performance, schedule form, approvals, assignment, deferrals) | chief | [x] |
| Assets list, filters, cards, scan entry | both | [x] |
| Asset detail, maintenance section, readings, room impact, downtime, photos, registration/edit forms | both | [x] |
| Asset QR scan; QR label | both | [x] scan scoped; label intentionally fixed (print) |
| More (identity card, `MORE_CATALOG` rows, notifications, sync, settings, sign-out) | both | [x] |
| Engineering Room Board, room availability, release and recovery sheets | both | [x] |
| Room Status (`room-status/index`) | engineering and others | [x] figures follow the scope; other roles unchanged |
| Team management (`team/**`, `TeamParts`) | chief | [x] |
| Engineering Sync screen and issue sheet | both | [x] |
| Settings, Notifications, SOP, Scheduling, Profile/Help/FAQ/Report/My Reports/Diagnostics | both | [x] via the scope (Settings keeps its own Phase 2 scope) |

## 42. Behavior preserved

Queue state, query keys, tab state, scroll restoration, filters and claim-conflict handling; work-order
authorization and routing; checklist, labor, repair-status and completion contracts (evidence requirements,
submission guards, no duplicate submits); Report Issue validation, idempotency and queued submission; PM
recurrence, completion eligibility, drafts and offline evidence; asset permissions, validation, scanning and offline
cache; room-availability safety (cleanliness, occupancy and availability remain separate; no presentation-only
release); Engineering Sync ordering, retry and "queued is not confirmed" wording; Chief-only management actions
(RBAC and effective role untouched); AI capability flags, consent, credit accounting and human confirmation. Only
`style` props, text-transform and color sources changed; no handler, query, store or string was edited.

## 43. Verification

Mobile `tsc` and ESLint (`--max-warnings=0`) are clean. Full mobile Jest: 479 suites, 10,811 tests pass.
New: `EngineeringV2.test.tsx` (role gate and earlier-phase gates, `useCategoryMeta` on/off/flag-off, scope-on
sentence case vs flag-off uppercase 10.5 px, and a source guard that fails if an engineering file adds an
uppercase style or `toUpperCase()` without the V2 text helper). The Phase 4 gate test was updated deliberately
(engineering roles now belong to the migrated surface). No test was deleted or weakened.

## 44. Known limitations (be honest about what was not done)

- Layouts were **not restructured**. Phase 5 delivers the V2 palette, typography, status wording and AI surface
  across the whole engineering surface; it does not redesign card arrangements, the Chief Engineer command-center
  hierarchy, or add progressive-disclosure rework. Treat that as a follow-up if wanted.
- No native-device, screen-reader, dynamic-type, Spanish-expansion or safe-area run; no committed screenshots.
  Light/dark are covered by token tests and the contrast suite, not visual review. Offline/sync behavior is
  unchanged code and covered by the existing engineering tests, not re-verified on device.
- Remaining legacy: Front Desk, GM, and shared legacy primitives outside the scope; `monoFont`/`SectionHeader`
  legacy fallbacks stay until the final cleanup phase.

## 45. Previewing Phase 5

```bash
# Mobile (Expo dev build); sign in as an Engineer or a Chief Engineer
EXPO_PUBLIC_DESIGN_V2_PREVIEW=1 npx expo start --dev-client
# Flag off (default): every role looks exactly as before.
```

## 46. Manual QA (flag on, Engineer and Chief Engineer accounts)

Engineer: Home states, claim and start a work order, labor, diagnosis, evidence, parts, hold, complete; Report
Issue; PM inspection through completion; asset detail, readings, QR scan; More and nested screens; Sync queue.
Chief: Home command view, assign technician, rooms down, PM management, team. Check light, dark, Spanish, large
text, offline, keyboard-open forms.

---

# Phase 6 of 8: Front Desk and General Manager mobile redesign

Status: implemented on the same branch/PR (#200, draft). Renders **only** for the `front_desk` and `gm` roles (plus the
earlier phases' roles) while the preview flag is on (`EXPO_PUBLIC_DESIGN_V2_PREVIEW`, off by default, ignored in
production). No API, database, migration, RBAC, route or production-config change. Flag off = the legacy look, unchanged.

## 47. How Phase 6 is scoped

`isFrontDeskGmV2Role` (`lib/design/housekeeperV2.ts`) widens `isV2SurfaceRole`, so `app/(app)/_layout.tsx` wraps every
tab, hidden route and sheet a Front Desk or GM user can reach in `<DesignV2Scope>`. Shared screens (Notifications, Profile,
Settings) are role-gated by the same wrapper, so no other role changes. Screens that were restructured branch at their
route file (`useIsDesignV2() ? <XV2 /> : <Legacy />`), so with the flag off the original component renders untouched.

## 48. Contract findings that shaped the work (pre-existing; decided with the owner: "wire to the real API")

Before redesigning, the mobile screens were compared with the real API. Four mismatches existed on `main`:

| Screen | Mobile expected | API actually does | Phase 6 handling |
|---|---|---|---|
| Guest Request detail | `GET /guest-requests/{id}` | no such endpoint | detail is found in the newest list page; "not found" is stated honestly |
| Status / assign / notes | `PATCH` with `status`, `assigned_to`, `resolution_notes` | `PATCH` ignores them; status moves only through `POST /{id}/transition` (strict lifecycle, role-checked) | changes use `POST /transition`; only server-allowed steps are offered; **no assign control** (the API has no assignee) |
| Guest Request list | statuses `new`/`escalated`, flat `room_number`, `request_type`, `assigned_to_name` | nine statuses (`open` ... `reopened`), `title`, nested `rooms.room_number`, no assignee | `normalizeGuestRequest` reads the real shape and still accepts the legacy one |
| GM Alerts | array of alerts with `severity` | `GET /ai/risk-alerts` returns an object of six lists and no severity; `alerts.filter` would throw | `adaptRiskAlerts` reads the real shape (and the legacy array); nothing is scored |

Also found: the legacy Home asked `/work-orders?per_page=200`, but the API caps `per_page` at 100, so that call fails
validation and the GM tiles never filled. Both new Homes use exact sources instead (section 51). The legacy Guest
Requests list also wrote the *new-request count* over the notification unread badge; V2 does not.

## 49. Screen and state inventory

Reachable Front Desk screens: Home, Guest Requests (list, detail), Room Status (list), Logbook (list, new entry, saved
report), Lost & Found (list, found-item form), More (new), Notifications, Profile and its pages, Settings, SOP,
Scheduling. GM: Home, Alerts, Staff, Profile and its pages, Notifications, plus Room Status, Work Orders, Guest Requests
and Logbook through the Home links (existing screens).

| Destination | Roles | Phase 6 status |
|---|---|---|
| Front Desk Home | front desk | **rebuilt** (V2 only): guest requests, room readiness, attention, quick actions |
| GM Home | GM | **rebuilt** (V2 only): overview, exceptions, progress, links |
| Guest Requests list | front desk, GM | **rebuilt** (V2): summary, segments, search, cards, honest states |
| Guest Request detail | front desk, GM | **rewritten** on the real contract (one implementation; theme tokens, V2 inside the scope) |
| Room Status list | front desk, GM | palette + typography + freshness line + honest failure state (V2); shared occupancy rule; layout kept |
| Logbook list | front desk, GM | V2 header, hotel-local day grouping and times, sentence-case figures, failure state |
| Logbook new entry | front desk, GM | V2 palette and sentence-case labels; double-submit guard (both modes) |
| Logbook saved report | front desk, GM | scope only (already hotel-time aware) |
| Lost & Found | front desk, GM | V2 header, segments, translated strings, sheet conventions (section 52) |
| GM Alerts | GM | **rebuilt** (V2): grouped by the server's own rules; legacy screen adapted to the real shape |
| GM Staff | GM | **rebuilt** (V2): searchable directory that says it is not attendance |
| Front Desk More | front desk (V2) | **new**: Lost & Found, Notifications, Profile and settings, Help, Sign out |
| Notifications, Profile pages, Settings, SOP, Scheduling | all | via the scope only |

## 50. Navigation decisions

- Front Desk under V2 has **five tabs**: Home, Requests, Rooms, Logbook, More (`getTabsForRole(role, { v2: true })`).
  Lost & Found and Profile moved under More. With V2 off, `getTabsForRole("front_desk")` is the original six, unchanged.
- No route URL changed. `lost-found/index`, `profile/index` and `more/index` stay registered tab routes; the ones not in the
  visible bar are hidden with `display: none` (not `href: null`), so the Expo Router 58 hidden-route bounce is not reintroduced.
  Deep links, notification destinations and back history are untouched (`backBehavior="history"`).
- The More tab stays the selected one while Lost & Found, Profile or Notifications is open (`isFrontDeskMoreChild`).
- The More route renders the Front Desk hub only for `front_desk` **and** V2 on; Engineering keeps its hub; every other role
  is still sent Home.
- GM keeps four tabs (Home, Alerts, Staff, Profile). The Home links reach Work Orders, Room Status, Guest Requests and
  Logbook through the existing routes.
- The layout's pinned line `const visibleTabs = effectiveRole ? getTabsForRole(effectiveRole) : [];` is unchanged; the V2
  Front Desk set is a separate additive line.

## 51. KPI data provenance (nothing is invented, nothing is a complete total unless it is)

| Figure | Source | Honesty rule |
|---|---|---|
| Guest requests (open, in progress, urgent, resolved today) | `GET /guest-requests?per_page=100` (newest page; the API returns no total) | when 100 rows come back every count shows as `N+` and the screen says "latest 100"; "resolved today" uses the hotel's calendar day |
| Urgent requests | `priority` of `urgent` (or legacy `emergency`) on a request that is open or in progress | no urgency is derived from age or text |
| Room readiness | `GET /housekeeping/board?date=<hotel date>` (one row per room, not paginated) | condition (inspected/clean/dirty), occupancy and out-of-order are counted separately and never added |
| Active work orders, overdue, urgent, completed today | `GET /work-orders/stats` (exact tenant counts) | replaces the legacy `per_page=200` page count |
| Alerts | `GET /ai/risk-alerts` (deterministic, no AI credit) | tier = the server's own selection rule; asset and guest lists are server-capped (5, 10) and the screen says so |
| Staff | `GET /staff` | a directory; **no attendance or coverage figure is shown** |

Every dashboard source is a read-only GET, loaded once on mount and on pull-to-refresh. A failed source keeps its last good
data marked stale, or shows "Couldn't load"; it never becomes `0` or "all clear". A late answer from an older request cannot
overwrite a newer one. Offline with nothing loaded says so.

## 52. Drawers, forms and confirmations migrated

| Surface | Result |
|---|---|
| Lost & Found "Log a found item" | stays a React Native `Modal` (its lifecycle and keyboard handling are reliable); in V2 it gains the 24 px sheet radius, grab handle, 44 px close target, bottom safe-area spacer, Android back (`onRequestClose`, both modes), translated labels and placeholders. Entered text is only cleared by an explicit close or a successful save. |
| Guest request cancel | inline two-step confirmation (not a system dialog); only offered to management roles |
| Guest request status steps | single in-flight lock, disabled while saving or offline, outcome via toast |
| Logbook new entry | unchanged form and handlers; sentence-case labels; submit ignored while saving |
| Sign out (More) | existing `SignOutSheet` |

## 53. Light/dark, status colors, AI

All new surfaces read colors through `useTheme()` (the V2 light/dark palette inside the scope) and the shared primitives
(`Card`, `MetricCard`, `StatusBadge`, `SegmentedControl`, `ScreenHeader`, `RoleHomeHeader`); a source-guard test fails if a
new file adds an uppercase style, monospace font or a hex color. Status is always icon + words. Alerts use the real model:
"needs attention" is amber, "keep an eye on" is neutral; red appears only for an older payload that actually carries
`severity: critical`. No Phase 6 screen invokes AI on mount. The Guest Request detail keeps an explicit "Ask the assistant"
entry and the list keeps the "+" that opens the assistant to create a request. The old hard-coded "AI triage" and "AI recovery"
cards were static English text with no AI behind them and are not part of the V2 screens.

## 54. Functional preservation

Preserved: tab destinations and URLs, role gating, offline handling, the realtime subscription on guest requests (the V2 list
uses the `tenant_id` column, which is the real one; the legacy list's `hotel_id` filter never matched), Lost & Found
create/validate/room-select behavior, claimed/unclaimed semantics, Logbook creation and saved-report access, AI capability
flags and credit accounting (untouched). Changed on purpose: the Guest Request detail and the Guest Request list and GM Alerts
data layers (section 48). The honest failure states on Guest Requests, Alerts and Logbook apply in both modes; Room Status's
applies in V2 only (a legacy test pins its empty state); Lost & Found's translated strings are V2-only (legacy tests pin the
English strings).

## 55. Verification

- Mobile `tsc --noEmit` clean; ESLint clean on every file the repo config covers (it skips paths outside its configured scopes).
- Full mobile Jest, final run: see the PR description for exact counts. New: `__tests__/lib/frontDeskGmV2.test.ts` (nav, gate,
  real-contract adapters, honest counting, copy/style hygiene, EN/ES key parity) and `__tests__/screens/FrontDeskGmV2.test.tsx`
  (both Homes, list, detail, Alerts, Staff, More: read-only on mount, `N+` lower bounds, failures never shown as zero or
  all-clear, server-allowed steps only, double-tap sends once, cancel needs confirmation, offline does not write).
- Three earlier tests pinned facts Phase 6 changes on purpose and were **updated, not weakened**: two role-gate tests (Front Desk and
  GM are now in the migrated surface, as Phase 5 did for Phase 4) and one layout source pin (`navTabs.map`).
- Browser check (Expo web, seeded data, no backend, 390 px light and dark, 320 px light, Chromium; temporary harness, not committed):
  Front Desk Home, GM Home, Guest Requests, detail, Alerts (data and failure), Staff, More, Lost & Found, Logbook rendered in the V2
  palette with no console errors. It caught a real bug the mocked tests could not: `lostFound.itemsHeld` showed as a raw key because
  the locale files use `_one`/`_other` plurals and this app's i18next reads `_plural`; fixed by adding the keys it reads (also fixes
  the legacy header). A scan of rendered text found no other raw keys.
- **Not verified:** a physical iPhone or Android device; a screen reader; dynamic type beyond the browser; Spanish rendered in the
  browser (Spanish is covered by key-parity and string tests only); a signed-in real Front Desk or GM account (no real credentials
  were used); the Room Status and Logbook screens beyond a render check.

## 56. Accessibility findings

Every interactive row, tile and card has a spoken label composed from visible text; icon-only controls (bell, new request) have names;
status is icon + words; metric cards read as "label, value, caption"; titles wrap and cap font scaling; touch targets are at least
44 dp; no animation was added (reduced motion is not a concern); Notices are announced politely. Contrast comes from the shared V2
tokens (already covered by the contrast suite). Layout holds at 320 dp in the browser. Not checked on a device or with a screen reader.

## 57. Known limitations and screens not fully migrated

- Room Status keeps its existing layout (dark hero, floor groups); V2 changes its palette, figure/label typography, adds a freshness
  line and an honest failure state. Its cards are not tappable for Front Desk (unchanged); the engineering room detail is not shown to them.
- Logbook entry cards and the new-entry form keep their layout; V2 changes palette, header, labels and date handling.
- Guest request detail loads from the newest 100 requests because the API has no single read; an older request shows "not found".
- The API has no assignee for guest requests, so assignment is not offered anywhere.
- Lost & Found's form is still a React Native `Modal`, not the shared bottom sheet; there is no claim or hand-over flow in the API or
  app and none was invented.
- Notifications, Settings, SOP, Scheduling and Profile pages are scope-only.
- The GM has no Staff coverage figure and no operational-report links (the app has no mobile reports screen).
- Legacy screens (flag off) keep their old data bugs where a legacy test pins them: for example Room Status shows an empty state when the
  board request fails, and Lost & Found keeps its English-only strings.

## 58. Previewing Phase 6

```bash
# Mobile (Expo); sign in as a Front Desk or GM account in a development or staging build
EXPO_PUBLIC_DESIGN_V2_PREVIEW=true npx expo start --dev-client
# The flag must be exactly "true" (1 does nothing). It is ignored when EXPO_PUBLIC_APP_ENV=production.
# Flag off (default): every role, including Front Desk's six tabs, looks exactly as before.
```

## 59. Manual QA (flag on, Front Desk and GM accounts)

Front Desk: five-tab bar at 320 dp and with large text; Home with real requests and board; open the next request; Requests list segments,
search, pull to refresh; open a request, add a note, take each allowed step (a second device or the API to confirm the server state),
reopen; More rows (Lost & Found, Notifications, Profile, Help, Sign out) and that More stays selected inside them; Room Status; Logbook
create and read; log a found item with the keyboard open. GM: Home figures against the web dashboard; each exception row; Alerts groups;
Staff search. Both: light, dark, Spanish, offline (airplane mode), a failing API, large text, the iPhone safe area and Android back button.

## 60. Outstanding cleanup (wait for Phase 8)

Legacy `FrontDeskHomeScreen` / `GMHomeScreen` in `app/(app)/home/index.tsx`, the legacy Guest Requests list, Alerts and Staff screens,
the six-tab Front Desk set, `monoFont`/`displayFont` on Room Status and Lost & Found (legacy branch), and the English-only Lost & Found
strings can go once V2 is the only look. Backend contract follow-ups for the owner: a `GET /guest-requests/{id}`, an assignee on guest
requests, and a total on the list response.

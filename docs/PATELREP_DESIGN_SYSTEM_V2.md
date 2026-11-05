# PatelRep Design System V2 — "Precision Slate + Electric Blue"

Status: **Phase 1 of 8 (foundation + reference previews).** V2 is disabled by default; production
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

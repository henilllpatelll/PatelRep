# UI Redesign Spec: "Lobby" Design System
**Date:** 2026-03-19
**Status:** Approved
**Scope:** Full redesign — all pages, components, layout shell

---

## Overview

PatelRep's current web app is functionally complete (8 sessions of built features, UAT-passed) but visually broken — Tailwind color/background classes fail to render on the deployed site, font conflicts exist between Inter (next/font) and Plus Jakarta Sans (globals.css), and the overall palette is near-invisible pastel. The "Lobby" redesign replaces the entire visual layer with a warm, boutique-hotel aesthetic that matches the product's identity as an AI staff copilot for independent Texas hotels.

**Design Direction:** Warm & inviting — amber & cream palette, humanist typography, glassy sidebar, fully animated. Every page feels like a well-designed hotel lobby: spacious, warm, everything in its right place.

---

## 1. Color System

### Design Tokens (CSS custom properties in globals.css)

```css
/* Backgrounds */
--color-bg:          #FEFAF4;  /* warm cream — page background */
--color-surface:     #FFFDF8;  /* cards, modals */
--color-surface-2:   #FEF9EE;  /* hover fills, secondary surfaces */

/* Amber (primary accent) */
--color-amber-50:    #FFFBEB;
--color-amber-100:   #FEF3C7;  /* active nav fills, badge backgrounds */
--color-amber-400:   #FBBF24;  /* primary buttons, active indicators */
--color-amber-500:   #F59E0B;  /* hover states, focus rings */
--color-amber-600:   #D97706;  /* logo, text accents */

/* Stone (text + structure) */
--color-stone-900:   #1C1917;  /* headings */
--color-stone-800:   #292524;  /* subheadings */
--color-stone-700:   #44403C;  /* primary body text */
--color-stone-600:   #57534E;  /* secondary body text */
--color-stone-400:   #A8A29E;  /* muted / captions */
--color-stone-300:   #D6D3D1;  /* borders (light) */
--color-stone-200:   #E7E5E4;  /* dividers */
--color-stone-100:   #F5F5F4;  /* subtle backgrounds */
--color-stone-50:    #FAFAF9;  /* near-white fills */
```

### Status Colors (functional — unchanged)
| Status | Background | Border | Text |
|---|---|---|---|
| DIRTY | `#FEF2F2` | `#FECACA` | `#991B1B` |
| IN_PROGRESS | `#EFF6FF` | `#BFDBFE` | `#1E40AF` |
| CLEAN | `#ECFDF5` | `#A7F3D0` | `#065F46` |
| INSPECTED | `#F5F3FF` | `#DDD6FE` | `#5B21B6` |
| VIP | amber glow border `#FBBF24` | — | — |
| DO_NOT_DISTURB | `#F5F5F4` | `#D6D3D1` | `#78716C` |
| OUT_OF_ORDER | `#E7E5E4` | `#A8A29E` | `#57534E` |

### Tailwind Config Extension
Extend `tailwind.config.ts` with:
- `colors.brand.*` → amber tokens mapped above
- `colors.stone.*` → already in Tailwind defaults (use directly)
- `backgroundImage['lobby-bg']` → removed; use `bg-[#FEFAF4]` directly
- Remove `bg-app-gradient`; replace all usages with `bg-[#FEFAF4]`

---

## 2. Typography

### Font Stack

| Face | Usage | Weight | Source |
|---|---|---|---|
| Figtree | All UI text, headings, body | 400, 500, 600, 700, 800 | Google Fonts |
| JetBrains Mono | Room numbers, IDs, timestamps, code | 400, 500 | Google Fonts |

**Implementation:**
- Remove `Inter` import from `layout.tsx`
- Remove Google Fonts `<link>` for Plus Jakarta Sans from `<head>`
- Import both fonts via `next/font/google` in `layout.tsx`
- Apply `figtree.variable` + `jetbrainsMono.variable` as CSS variables on `<html>`
- Update `tailwind.config.ts` `fontFamily.sans` → `['var(--font-figtree)', ...defaultTheme.fontFamily.sans]`
- Update `fontFamily.mono` → `['var(--font-jetbrains-mono)', ...defaultTheme.fontFamily.mono]`

### Type Scale
| Role | Class | Weight |
|---|---|---|
| Page title | `text-2xl` | 700 |
| Section heading | `text-base` | 600 |
| Card heading | `text-sm` | 600 |
| Body | `text-sm` | 400 |
| Caption / muted | `text-xs` | 400 |
| Metric / KPI | `text-3xl` | 800 |
| Room number | `font-mono text-xl` | 600 |

---

## 3. Layout Shell

### File: `apps/web/app/(dashboard)/layout.tsx`

```
┌─────────────────────────────────────────────────────┐
│  Sidebar (220px fixed)  │  Main (flex-1)            │
│  bg-white/60            │  bg-[#FEFAF4]             │
│  backdrop-blur-2xl      │  ┌──────────────────────┐ │
│  border-r amber-100/50  │  │ Header (h-14 sticky) │ │
│  rounded-r-2xl          │  ├──────────────────────┤ │
│  shadow amber glow      │  │ <PageTransition>     │ │
│                         │  │   {children}         │ │
│                         │  │ </PageTransition>    │ │
│                         │  └──────────────────────┘ │
│                         │  AICopilotBubble (fixed)  │
└─────────────────────────────────────────────────────┘
```

**Body background:** `bg-[#FEFAF4]` on `<html>` or `<body>` — no gradient.

### PageTransition Component (new)
`components/shared/PageTransition.tsx` — Framer Motion wrapper:
```tsx
<motion.div
  initial={{ opacity: 0, y: 12 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.3, ease: 'easeOut' }}
>
  {children}
</motion.div>
```
Wrap `{children}` in layout.tsx with this component.

---

## 4. Sidebar (`components/shared/Sidebar.tsx`)

### Visual Spec
- Container: `w-[220px] h-screen flex flex-col bg-white/60 backdrop-blur-2xl border-r border-amber-100/50 rounded-r-2xl shadow-[4px_0_24px_rgba(251,191,36,0.08)]`
- **Logo zone:** `PatelRep` in `font-extrabold text-lg text-amber-600`, subtitle `text-xs text-stone-400`; add `✦` amber star character before logo text
- **Section labels:** `text-[9px] font-bold tracking-widest text-stone-300 uppercase`
- **Nav item (default):** `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium text-stone-500 hover:bg-amber-50 hover:text-stone-700 transition-colors`
- **Nav item (active):** `bg-amber-100 text-amber-800 font-semibold border-l-2 border-amber-400 rounded-xl`
- **Icon (default):** `text-stone-400 size-[15px]`
- **Icon (active):** `text-amber-500`
- **Sub-nav:** `ml-5 pl-2 border-l border-amber-100 space-y-0.5` — items: `text-xs rounded-lg px-2.5 py-1`
- **User badge:** `bg-amber-50 border border-amber-100 rounded-2xl px-3 py-2.5` at bottom

### Framer Motion additions
- Active left-bar indicator: `<motion.div layoutId="sidebar-active" />` — shared layout animation across nav items
- Icon: `whileTap={{ scale: 1.15 }}` spring on click

---

## 5. Header (`components/shared/Header.tsx`)

- Container: `h-14 flex items-center justify-between px-6 bg-white/70 backdrop-blur-xl border-b border-stone-100 sticky top-0 z-10`
- Left: current page breadcrumb — `text-sm font-semibold text-stone-800`
- Right: notification bell icon + hotel name chip (`bg-amber-50 text-amber-700 text-xs font-medium rounded-full px-3 py-1 border border-amber-100`) + user avatar circle

---

## 6. Component Primitives

### Button (`components/ui/Button.tsx`)
| Variant | Classes |
|---|---|
| primary | `bg-gradient-to-r from-amber-400 to-amber-500 text-white shadow-md shadow-amber-200/60 hover:from-amber-500 hover:to-amber-600 rounded-xl` |
| secondary | `bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 rounded-xl` |
| ghost | `bg-white/70 border border-stone-200 text-stone-600 hover:bg-stone-50 rounded-xl` |
| destructive | `bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 rounded-xl` |

All buttons: `whileTap={{ scale: 0.97 }}` via Framer Motion.

### Input (`components/ui/Input.tsx`)
- Base: `bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-800 placeholder:text-stone-300`
- Focus: `focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none`

### Card (new: `components/ui/Card.tsx`)
- `bg-white rounded-2xl border border-stone-100 shadow-[0_2px_12px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(251,191,36,0.10)] hover:-translate-y-0.5 transition-all duration-200`

### Badge (new: `components/ui/Badge.tsx`)
- Variants matching status/priority colors
- `rounded-full px-2.5 py-0.5 text-xs font-semibold`

### Skeleton (new: `components/ui/Skeleton.tsx`)
- `bg-stone-100 animate-pulse rounded-xl` with shimmer overlay via CSS keyframes
- Variants: `card`, `text`, `room-card` (aspect-[4/3])

---

## 7. Room Status Board (`components/housekeeping/RoomStatusBoard.tsx` + `RoomCard.tsx`)

### Grid Layout
- Container: `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3`
- Each card: `aspect-[4/3] rounded-2xl p-4 flex flex-col justify-between cursor-pointer`
- Status-driven background (see color table in Section 1)

### RoomCard States
- **Default:** soft status background + border
- **VIP:** `border-2 border-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.3)]`
- **IN_PROGRESS:** `ring-2 ring-blue-300 ring-offset-2 animate-pulse`
- **Hover:** action buttons slide up `translateY(0) opacity(1)` from `translateY(8px) opacity(0)`
- **Drag active:** `opacity-80 rotate-2 scale-105 shadow-xl`

### Drag & Drop
- Library: `@dnd-kit/core` + `@dnd-kit/sortable`
- DndContext wraps the board; rooms are draggable, housekeeper columns are droppable
- Drop zone highlight: `bg-amber-50 border-2 border-amber-400 border-dashed`

### Status Filter Chips
- `flex gap-2 flex-wrap` row above grid
- Each chip: `px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer`
- Active: `bg-amber-100 text-amber-800 border-amber-300`
- Inactive: `bg-stone-100 text-stone-500 border-stone-200 hover:bg-stone-200`

---

## 8. Dashboard Components

### Metric Cards (`components/dashboard/ROIMetricsStrip.tsx`)
- Grid: `grid grid-cols-2 lg:grid-cols-4 gap-4`
- Each card: Card primitive + icon pill (`bg-amber-50 rounded-xl p-2.5`) + animated counter + trend badge
- Counter animation: `useCountUp(value, 800)` custom hook

### useCountUp Hook (new: `lib/hooks/useCountUp.ts`)
```ts
// Counts from 0 to target over duration ms using requestAnimationFrame
export function useCountUp(target: number, duration = 800): number
```

### AI Risk Alerts (`components/dashboard/AIRiskAlertsPanel.tsx`)
- Container: `bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-4`
- HIGH alert row: `border-l-4 border-red-400 bg-white/60 rounded-xl`
- MEDIUM alert row: `border-l-4 border-amber-400 bg-white/60 rounded-xl`

### Charts (`components/dashboard/TrendChartsRow.tsx`)
- Recharts Area/Bar charts
- Color: `stroke="#FBBF24"` (amber-400), `fill="url(#amberGradient)"`
- SVG gradient def: amber-400 @ 30% opacity → transparent
- Grid lines: `stroke="#E7E5E4"` (stone-200), `strokeDasharray="3 3"`
- Custom tooltip: white card, `border-l-2 border-amber-400`, stone text

---

## 9. Animations Summary

| Element | Animation | Library | Duration |
|---|---|---|---|
| Page entry | fade + slide up (y:12→0) | Framer Motion | 300ms |
| Card stagger | children stagger 50ms apart | Framer Motion | — |
| Metric counters | count up 0→value | rAF hook | 800ms |
| Drawer open/close | x: 100%→0 spring | Framer Motion | spring |
| Modal open/close | scale: 0.95→1 + fade | Framer Motion | 200ms |
| AI Copilot expand | circle→panel shared layout | Framer Motion layoutId | — |
| Room card status change | scale pulse 1→1.03→1 | Framer Motion | 150ms |
| Sidebar active indicator | layoutId shared element | Framer Motion | — |
| Button press | scale: 0.97 whileTap | Framer Motion | — |
| Drag ghost | rotate:2deg scale:1.05 | @dnd-kit | — |
| Skeleton shimmer | CSS keyframes | CSS | 1.5s loop |

---

## 10. Page-Level Designs

### Login Page
- Full-page `bg-[#FEFAF4]` with radial amber glow: `radial-gradient(ellipse at 50% 40%, rgba(251,191,36,0.08) 0%, transparent 70%)`
- Card: `bg-white/80 backdrop-blur-2xl rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.08)] border border-amber-100/60 p-8 w-full max-w-md`
- Logo: `✦ PatelRep` in amber-600, Figtree 800
- Tab toggle: `bg-stone-100 rounded-2xl p-1` — active `bg-white shadow-sm text-amber-700`
- Input focus: amber ring
- CTA button: amber gradient
- Card entry: `y:20→0 opacity:0→1` on mount

### Dashboard
- Greeting with time-of-day awareness
- Metric strip staggered animation on mount
- Risk alerts panel with warm gradient background
- Area charts with amber gradient fill

### Housekeeping Board
- Toolbar card: date nav + shift selector + view toggle — all in one `bg-white rounded-2xl` pill
- Status chip filters row
- Room grid (grid-cols-4 default)
- PredictionPanel: `border-l-4 border-red-400` warm urgency treatment
- AssignmentSidebar: fixed right panel, slides in

### Engineering
- Kanban columns: `TODO | IN PROGRESS | DONE`
- Work order cards with priority badges
- Asset failure prediction sidebar with amber/orange warm gradient

### Consistent Patterns (all other pages)
- Tables: `hover:bg-amber-50/50` row hover
- Empty states: centered + amber CTA
- Modals: `rounded-3xl` with amber CTA buttons
- Onboarding steps: amber filled (complete) / amber ring (current) / stone (future)

---

## 11. Dependencies to Add

```
framer-motion        # Page transitions, micro-animations, shared layout
@dnd-kit/core        # Drag & drop core
@dnd-kit/sortable    # Sortable utilities for room cards
```

## 12. Dependencies to Remove / Fix

```
# layout.tsx: Remove Inter import, replace with Figtree + JetBrains Mono via next/font
# globals.css: Move @tailwind directives to TOP of file (before any rules)
# globals.css: Remove body font-family (handled by next/font CSS variable)
# globals.css: Remove body background (handled by Tailwind bg-[#FEFAF4] on html/body)
# Sidebar.tsx: Replace all indigo-* classes with amber-*/stone-* equivalents
# Button.tsx: Replace indigo gradient with amber gradient
# All pages: Replace text-indigo-600/bg-indigo-* with amber equivalents
```

## 13. Files to Create (New)

| File | Purpose |
|---|---|
| `components/shared/PageTransition.tsx` | Framer Motion page wrapper |
| `components/ui/Card.tsx` | Warm card primitive |
| `components/ui/Badge.tsx` | Status/priority badge |
| `components/ui/Skeleton.tsx` | Loading skeleton with shimmer |
| `lib/hooks/useCountUp.ts` | Animated counter hook |

## 14. Files to Modify (Existing)

| File | Changes |
|---|---|
| `app/layout.tsx` | Font swap (Inter→Figtree+JetBrains), remove Google Fonts link |
| `app/globals.css` | Move @tailwind to top, remove body bg/font rules, add design tokens |
| `tailwind.config.ts` | Font families, remove app-gradient, keep status/risk colors |
| `app/(dashboard)/layout.tsx` | Add PageTransition, update bg class |
| `components/shared/Sidebar.tsx` | Full visual restyle (amber/stone) |
| `components/shared/Header.tsx` | Full visual restyle |
| `components/ui/Button.tsx` | Amber variants, Framer whileTap |
| `components/ui/Input.tsx` | Amber focus ring, warm base |
| `components/housekeeping/RoomCard.tsx` | Grid card layout, status colors, drag |
| `components/housekeeping/RoomStatusBoard.tsx` | Grid layout, DndContext, status chips |
| `components/dashboard/ROIMetricsStrip.tsx` | Card primitive, useCountUp, icon pills |
| `components/dashboard/AIRiskAlertsPanel.tsx` | Warm gradient container |
| `components/dashboard/TrendChartsRow.tsx` | Amber chart theme |
| `app/(auth)/login/page.tsx` | Full login page restyle |
| All other pages | Amber/stone color substitutions |

---

## 15. Success Criteria

- [ ] Website background is visibly warm cream (not white or near-invisible pastel)
- [ ] Sidebar has glassy amber-tinted appearance with correct active states
- [ ] Figtree font loads correctly with no fallback flash
- [ ] Login page has amber branding and warm card
- [ ] Dashboard metric counters animate up on mount
- [ ] Room board renders as a grid (not a flat list) with status-colored cards
- [ ] Drag-to-assign works on the room board
- [ ] Page transitions play on navigation
- [ ] No indigo colors remain in the UI
- [ ] All interactive elements have hover/active states
- [ ] Skeleton screens replace spinners during loading

---

*Spec written: 2026-03-19*
*Approved by user: yes (all 5 sections)*

# Design Overhaul Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PatelRep's flat white UI with a light glassmorphism design system — pastel gradient background, frosted glass surfaces, indigo-400 primary, Plus Jakarta Sans, grouped sidebar nav, and 9 room status colors.

**Architecture:** Token-first approach — Tailwind config and global CSS are updated first so every subsequent component change inherits the design automatically. Shell components (layout, sidebar, header) are overhauled next, then shared primitives, then pages in priority order.

**Tech Stack:** Next.js 14 App Router, Tailwind CSS v3, TypeScript, Lucide React

**Spec:** `docs/superpowers/specs/2026-03-14-patelrep-design-overhaul.md`

---

## Chunk 1: Foundation — Tailwind Config + Global CSS + Shared Utilities

### Files
- Modify: `apps/web/tailwind.config.ts`
- Modify: `apps/web/app/globals.css` (or create if absent)
- Modify: `apps/web/app/layout.tsx`
- Create: `apps/web/lib/utils/avatar.ts`
- Modify: `apps/web/lib/utils/roomStatus.ts`

---

### Task 1: Update Tailwind config

- [ ] **Step 1: Open `apps/web/tailwind.config.ts`**

Replace the entire file with:

```ts
import type { Config } from 'tailwindcss'
import defaultTheme from 'tailwindcss/defaultTheme'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', ...defaultTheme.fontFamily.sans],
      },
      spacing: {
        '13': '52px',
      },
      backgroundImage: {
        'app-gradient': 'linear-gradient(135deg, #EFF6FF 0%, #F0FDF4 50%, #F5F3FF 100%)',
      },
      colors: {
        // brand-* removed — use indigo-* from Tailwind defaults instead
        status: {
          inspected:    '#4ADE80',
          'inspected-text': '#064E3B',
          clean:        '#99F6E4',
          'clean-text': '#134E4A',
          'in-progress': '#7DD3FC',
          'in-progress-text': '#0C4A6E',
          pickup:       '#DDD6FE',
          'pickup-text': '#5B21B6',
          occupied:     '#FC8D8D',
          'occupied-text': '#7F1D1D',
          dirty:        '#FF4D4D',
          'dirty-text': '#FFFFFF',
          checkout:     '#FF4D4D',
          'checkout-text': '#FFFFFF',
          oos:          '#70767D',
          'oos-text':   '#FFFFFF',
          vip:          '#FCD34D',
          'vip-text':   '#78350F',
        },
        risk: {
          high:   '#ef4444',
          medium: '#f97316',
          low:    '#22c55e',
        },
      },
    },
  },
  plugins: [],
}

export default config
```

- [ ] **Step 2: Verify dev server still compiles**

```bash
cd apps/web && npm run dev
```
Expected: No compile errors in terminal. Browser shows app (even if unstyled for now).

- [ ] **Step 3: Commit**

```bash
git add apps/web/tailwind.config.ts
git commit -m "feat(design): update tailwind config — indigo palette, h-13, app-gradient, status colors"
```

---

### Task 2: Global CSS + font

- [ ] **Step 1: Add Plus Jakarta Sans to `apps/web/app/layout.tsx`**

In the `<head>` section (or using Next.js font optimization), add:
```tsx
// At top of layout.tsx, add the Google Font link in metadata or directly in <head>
// The simplest approach for Next.js 14 App Router:
import { Metadata } from 'next'

// Add this <link> inside the returned <html> element's <head>:
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap"
/>
```

- [ ] **Step 2: Update `apps/web/app/globals.css`**

Add at the top (preserve any existing rules):
```css
/* Base */
body {
  background: linear-gradient(135deg, #EFF6FF 0%, #F0FDF4 50%, #F5F3FF 100%);
  background-attachment: fixed;
  font-family: 'Plus Jakarta Sans', sans-serif;
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 3: Verify font loads**

In browser dev tools, confirm `computed` font-family on `<body>` shows "Plus Jakarta Sans".

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/layout.tsx apps/web/app/globals.css
git commit -m "feat(design): add Plus Jakarta Sans font and app gradient background"
```

---

### Task 3: Shared avatar utility

- [ ] **Step 1: Create `apps/web/lib/utils/avatar.ts`**

```ts
export function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}

const AVATAR_COLORS = [
  'bg-indigo-400',
  'bg-violet-500',
  'bg-amber-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-rose-500',
]

export function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
```

- [ ] **Step 2: Update room status color map in `apps/web/lib/utils/roomStatus.ts`**

Find the `STATUS_COLORS` or equivalent export and replace with:
```ts
export const STATUS_BG: Record<string, string> = {
  INSPECTED:     '#4ADE80',
  CLEAN:         '#99F6E4',
  IN_PROGRESS:   '#7DD3FC',
  PICK_UP:       '#DDD6FE',
  OCCUPIED:      '#FC8D8D',
  DIRTY:         '#FF4D4D',
  CHECK_OUT:     '#FF4D4D',
  OUT_OF_SERVICE:'#70767D',
  VIP:           '#FCD34D',
}

export const STATUS_TEXT: Record<string, string> = {
  INSPECTED:     '#064E3B',
  CLEAN:         '#134E4A',
  IN_PROGRESS:   '#0C4A6E',
  PICK_UP:       '#5B21B6',
  OCCUPIED:      '#7F1D1D',
  DIRTY:         '#FFFFFF',
  CHECK_OUT:     '#FFFFFF',
  OUT_OF_SERVICE:'#FFFFFF',
  VIP:           '#78350F',
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/utils/avatar.ts apps/web/lib/utils/roomStatus.ts
git commit -m "feat(design): add shared avatar utility and update room status color map"
```

---

## Chunk 2: Shell — Layout, Sidebar, Header

### Files
- Modify: `apps/web/app/(dashboard)/layout.tsx`
- Modify: `apps/web/components/shared/Sidebar.tsx`
- Modify: `apps/web/components/shared/Header.tsx`

---

### Task 4: Dashboard layout shell

- [ ] **Step 1: Update `apps/web/app/(dashboard)/layout.tsx`**

```tsx
import { Sidebar } from '@/components/shared/Sidebar'
import { Header } from '@/components/shared/Header'
import { AICopilotBubble } from '@/components/ai/AICopilotBubble'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-app-gradient">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-5">
          {children}
        </main>
      </div>
      <AICopilotBubble />
    </div>
  )
}
```

- [ ] **Step 2: Verify layout renders without errors**

Open browser at `http://localhost:3000/dashboard`. Pastel gradient should be visible as the app background.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(dashboard)/layout.tsx
git commit -m "feat(design): update dashboard layout — app-gradient bg, p-5 main padding"
```

---

### Task 5: Sidebar overhaul

- [ ] **Step 1: Replace `apps/web/components/shared/Sidebar.tsx`**

Key changes:
- Import `getInitials`, `getAvatarColor` from `@/lib/utils/avatar`
- Remove all `brand-*` class references
- Width: `w-52`
- Glass surface: `bg-white/[0.62] backdrop-blur-xl border-r border-white/[0.85]`
- Add 3 nav groups: Operations, People, Knowledge
- Active item: `bg-indigo-400/[0.12] text-indigo-600 font-semibold border border-indigo-300/[0.20] rounded-lg`
- Inactive item: `text-slate-600 hover:bg-indigo-400/[0.06] hover:text-indigo-600 rounded-lg transition-colors duration-200 cursor-pointer`
- Section label: `text-[9px] font-bold text-slate-400 uppercase tracking-widest px-2 pt-3 pb-1`
- Sub-nav: `ml-6 pl-2 border-l border-indigo-200/[0.20]`
- User badge: `bg-indigo-400/[0.06] rounded-lg`
- Logo: `text-indigo-600 font-extrabold` name, `text-slate-400 text-xs` subline

Nav groups:
```
Operations: Dashboard, Housekeeping (+subNav), Engineering (+subNav), Guest Requests, Lost & Found, Tasks
People: Staff, Schedule
Knowledge: SOP Library, Reports, Logbook
Bottom: Settings, user badge
```

- [ ] **Step 2: Verify sidebar renders with grouped nav**

Check browser — sidebar should show glass surface, 3 section labels, active state in indigo.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/shared/Sidebar.tsx
git commit -m "feat(design): overhaul sidebar — glass surface, grouped nav, indigo active states"
```

---

### Task 6: Header overhaul

- [ ] **Step 1: Replace `apps/web/components/shared/Header.tsx`**

Key changes:
- Import `getInitials`, `getAvatarColor` from `@/lib/utils/avatar`
- Remove all `brand-*` class references
- Glass surface: `bg-white/[0.55] backdrop-blur-lg border-b border-white/[0.80] h-13`
- Add date below hotel name:
  ```tsx
  <p className="text-xs text-slate-400 mt-0.5">
    {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
  </p>
  ```
- Notification bell button: `bg-white/70 border border-white/90 rounded-lg w-8 h-8 cursor-pointer`
- User dropdown panel: `bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-xl shadow-lg`
- Avatar: use `bg-indigo-400` as fallback (from `getAvatarColor`)

- [ ] **Step 2: Verify header renders**

Check browser — header should show glass surface, hotel name + date, notification bell.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/shared/Header.tsx
git commit -m "feat(design): overhaul header — glass surface, date field, glass dropdown panel"
```

---

## Chunk 3: Shared Components — Glass Primitives + Buttons

### Files
- Create: `apps/web/components/ui/GlassCard.tsx`
- Create: `apps/web/components/ui/Button.tsx`
- Create: `apps/web/components/ui/Input.tsx`

---

### Task 7: GlassCard primitive

- [ ] **Step 1: Create `apps/web/components/ui/GlassCard.tsx`**

```tsx
import { cn } from '@/lib/utils'

type GlassVariant = 'default' | 'accent' | 'danger' | 'success' | 'elevated'

const VARIANTS: Record<GlassVariant, string> = {
  default:  'bg-white/[0.65] border-white/90 shadow-[0_2px_12px_rgba(99,102,241,0.05)]',
  accent:   'bg-indigo-400/[0.10] border-indigo-400/[0.22]',
  danger:   'bg-red-400/[0.08] border-red-400/[0.20]',
  success:  'bg-green-400/[0.10] border-green-400/[0.25]',
  elevated: 'bg-white/[0.88] border-white/[0.95]',
}

interface GlassCardProps {
  variant?: GlassVariant
  className?: string
  children: React.ReactNode
}

export function GlassCard({ variant = 'default', className, children }: GlassCardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border backdrop-blur-md p-4',
        VARIANTS[variant],
        className
      )}
    >
      {children}
    </div>
  )
}
```

Note: If `lib/utils.ts` with `cn` doesn't exist, create it:
```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
```
Install if needed: `npm install clsx tailwind-merge`

- [ ] **Step 2: Create `apps/web/components/ui/Button.tsx`**

```tsx
import { cn } from '@/lib/utils'
import { ButtonHTMLAttributes, forwardRef } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:     'bg-gradient-to-r from-indigo-400 to-indigo-600 text-white shadow-sm shadow-indigo-200 hover:from-indigo-500 hover:to-indigo-700',
  secondary:   'bg-indigo-50 border border-indigo-200 text-indigo-600 hover:bg-indigo-100',
  ghost:       'bg-white/70 border border-white/90 backdrop-blur-sm text-slate-600 hover:bg-white/90',
  destructive: 'bg-red-50 border border-red-200 text-red-700 hover:bg-red-100',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
)
Button.displayName = 'Button'
```

- [ ] **Step 3: Create `apps/web/components/ui/Input.tsx`**

```tsx
import { cn } from '@/lib/utils'
import { InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full px-3 py-2 rounded-lg text-sm text-slate-900 placeholder:text-slate-400',
        'bg-white/70 border border-indigo-200/[0.40] backdrop-blur-sm',
        'focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400',
        'transition-colors duration-200',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/ui/
git commit -m "feat(design): add GlassCard, Button, and Input glass primitives"
```

---

## Chunk 4: Dashboard Page

### Files
- Modify: `apps/web/components/dashboard/ROIMetricsStrip.tsx`
- Modify: `apps/web/components/dashboard/AIRiskAlertsPanel.tsx`
- Modify: `apps/web/components/dashboard/LiveOpsGrid.tsx`
- Modify: `apps/web/components/dashboard/TrendChartsRow.tsx`
- Modify: `apps/web/app/(dashboard)/dashboard/page.tsx`

---

### Task 8: Dashboard page + components

- [ ] **Step 1: Update dashboard `page.tsx`**

```tsx
'use client'
import { ROIMetricsStrip } from '@/components/dashboard/ROIMetricsStrip'
import { AIRiskAlertsPanel } from '@/components/dashboard/AIRiskAlertsPanel'
import { LiveOpsGrid } from '@/components/dashboard/LiveOpsGrid'
import { TrendChartsRow } from '@/components/dashboard/TrendChartsRow'
import { useHotelStore } from '@/stores/hotelStore'

export default function DashboardPage() {
  const { hotel } = useHotelStore()
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
          Good morning{hotel ? `, ${hotel.name}` : ''}!
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>
      <ROIMetricsStrip />
      <AIRiskAlertsPanel />
      <LiveOpsGrid />
      <TrendChartsRow />
    </div>
  )
}
```

- [ ] **Step 2: Update `ROIMetricsStrip.tsx`**

Wrap each metric card in `<GlassCard>` with appropriate variant. Stat cards use:
- `variant="success"` for positive metrics (rooms clean, inspected)
- `variant="accent"` for in-progress counts
- `variant="danger"` for at-risk/urgent counts
- `variant="default"` for neutral metrics

Label: `text-[9px] font-bold uppercase tracking-widest text-slate-400`
Value: `text-2xl font-extrabold text-slate-900`
Sub-label: `text-xs text-slate-400 mt-1`

- [ ] **Step 3: Update `AIRiskAlertsPanel.tsx`**

Wrap panel in `<GlassCard>`. Alert items use colored dot + `text-sm text-slate-700` text + `text-xs text-slate-400` timestamp. Panel title: `text-sm font-bold text-slate-700`. AI badge: `bg-purple-50 text-purple-700 text-xs font-semibold px-2 py-0.5 rounded-md`.

- [ ] **Step 4: Update `LiveOpsGrid.tsx` and `TrendChartsRow.tsx`**

Wrap each panel/card in `<GlassCard variant="default">`. Remove any `bg-white`, `border-gray-*`, `shadow-*` classes — let GlassCard handle surfaces.

- [ ] **Step 5: Verify dashboard looks correct**

Open `http://localhost:3000/dashboard`. Should show glass cards on pastel gradient, indigo sidebar active state.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(dashboard\)/dashboard/ apps/web/components/dashboard/
git commit -m "feat(design): overhaul dashboard page and components — glass cards, indigo accents"
```

---

## Chunk 5: Housekeeping Pages

### Files
- Modify: `apps/web/components/housekeeping/RoomCard.tsx`
- Modify: `apps/web/components/housekeeping/RoomStatusBoard.tsx`
- Modify: `apps/web/components/housekeeping/RoomDetailDrawer.tsx`
- Modify: `apps/web/components/housekeeping/AssignmentSidebar.tsx`
- Modify: `apps/web/components/housekeeping/PredictionPanel.tsx`
- Modify: `apps/web/components/housekeeping/InspectionModal.tsx`
- Modify: `apps/web/app/(dashboard)/housekeeping/page.tsx`
- Modify: `apps/web/app/(dashboard)/housekeeping/assignments/page.tsx`
- Modify: `apps/web/app/(dashboard)/housekeeping/inspections/page.tsx`
- Modify: `apps/web/app/(dashboard)/housekeeping/rooms/page.tsx`

---

### Task 9: Room cards + status board

- [ ] **Step 1: Update room status colors in `RoomCard.tsx`**

Import `STATUS_BG`, `STATUS_TEXT` from `@/lib/utils/roomStatus`. Replace any hardcoded color classes with inline styles:
```tsx
style={{ backgroundColor: STATUS_BG[room.status] ?? '#E2E8F0', color: STATUS_TEXT[room.status] ?? '#1E293B' }}
```

Card wrapper: `rounded-xl border border-white/60 backdrop-blur-sm shadow-sm cursor-pointer hover:scale-[1.02] transition-transform duration-200`

- [ ] **Step 2: Update `RoomStatusBoard.tsx`**

Page wrapper: `space-y-4`. Status summary chips use the new status colors inline. Board grid: `grid grid-cols-4 gap-3 md:grid-cols-6 lg:grid-cols-8`.

- [ ] **Step 3: Update `RoomDetailDrawer.tsx`**

Drawer panel: `bg-white/[0.88] backdrop-blur-2xl border-l border-white/[0.95]`. Overlay: `bg-indigo-950/20 backdrop-blur-sm`. All action buttons use `<Button>` primitive.

- [ ] **Step 4: Update housekeeping `page.tsx`**

Replace `bg-white`, `shadow`, `border-gray-*` throughout with GlassCard variants. Date nav buttons use `<Button variant="ghost">`.

- [ ] **Step 5: Update remaining housekeeping pages**

Apply same pattern to `assignments/page.tsx`, `inspections/page.tsx`, `rooms/page.tsx`:
- Page headings: `text-xl font-extrabold text-slate-900 tracking-tight`
- Tables: wrapped in `<GlassCard>`, `thead` uses `bg-indigo-50/60` rows, `tbody` rows `hover:bg-indigo-50/40`
- Filter dropdowns/inputs: use `<Input>` primitive
- CTA buttons: use `<Button>` primitive

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/housekeeping/ apps/web/app/\(dashboard\)/housekeeping/
git commit -m "feat(design): overhaul housekeeping pages — new status colors, glass surfaces"
```

---

## Chunk 6: Remaining Dashboard Pages

### Files
- All pages under `apps/web/app/(dashboard)/` not yet updated
- All components under `apps/web/components/engineering/`
- `apps/web/components/ai/SOPQueryModal.tsx`
- `apps/web/components/ai/AICopilotBubble.tsx`

---

### Task 10: Engineering pages + components

- [ ] **Step 1: Update `WorkOrderCard.tsx`, `WorkOrderList.tsx`, `WorkOrderDetailDrawer.tsx`, `CreateWorkOrderModal.tsx`, `FailurePredictionSidebar.tsx`**

Apply the same pattern as housekeeping:
- Cards → `<GlassCard>`
- Drawers/modals → elevated glass surface (`bg-white/[0.88] backdrop-blur-2xl`)
- Buttons → `<Button>` primitive
- Inputs → `<Input>` primitive
- Priority badges: use semantic pastel colors (danger=red-50/red-700, warning=amber-50/amber-700, info=blue-50/blue-700)

- [ ] **Step 2: Update engineering pages**

`/engineering`, `/engineering/assets`, `/engineering/pm-schedules`, `/engineering/predictions` — same pattern: glass panels, indigo accents, page headings `text-xl font-extrabold`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/engineering/ apps/web/app/\(dashboard\)/engineering/
git commit -m "feat(design): overhaul engineering pages and components — glass surfaces"
```

---

### Task 11: People + Knowledge + AI pages

- [ ] **Step 1: Update staff, scheduling pages**

`/staff/page.tsx`: Staff list table in `<GlassCard>`. Invite modal uses elevated glass. Role badges use semantic pastel colors.

`/scheduling/page.tsx`: Calendar grid cells — current day uses `bg-indigo-400/[0.12] border-indigo-300/[0.30]`. Shift chips use pastel colors by department. TodayRoster strip in `<GlassCard variant="accent">`.

- [ ] **Step 2: Update SOP, logbook, reports, tasks, guest-requests, lost-found pages**

Each page: wrap main content in `<GlassCard>`. Page heading `text-xl font-extrabold text-slate-900`. Remove all `bg-white border-gray-200` panel patterns.

- [ ] **Step 3: Update `SOPQueryModal.tsx` and `AICopilotBubble.tsx`**

SOPQueryModal: elevated glass surface. AI bubble: `bg-gradient-to-br from-indigo-400 to-indigo-600 rounded-full w-11 h-11 shadow-lg shadow-indigo-400/40`.

- [ ] **Step 4: Update settings pages**

`/settings`, `/settings/integrations`, `/settings/billing`: form sections in `<GlassCard>`. Tab navigation uses indigo active state. Danger zone uses `<GlassCard variant="danger">`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(dashboard\)/ apps/web/components/ai/
git commit -m "feat(design): overhaul remaining dashboard pages — staff, sop, settings, AI components"
```

---

## Chunk 7: Auth Pages

### Files
- Modify: `apps/web/app/(auth)/login/page.tsx`
- Modify: `apps/web/app/auth/reset-password/page.tsx`
- Modify: `apps/web/app/(dashboard)/onboarding/page.tsx`

---

### Task 12: Login + auth pages

- [ ] **Step 1: Update `apps/web/app/(auth)/login/page.tsx`**

Outer wrapper: `min-h-screen bg-app-gradient flex items-center justify-center`

Card: `w-full max-w-md bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl p-8 shadow-xl`

Logo: `text-3xl font-extrabold text-indigo-600` + `text-sm text-slate-400 mt-1`

Tab toggle: `bg-indigo-50/60 border border-indigo-100 rounded-xl p-1`. Active tab: `bg-white text-indigo-600 shadow-sm font-semibold`. Inactive: `text-slate-500`.

Form inputs: use `<Input>` primitive. Submit button: use `<Button variant="primary" className="w-full">`.

"Magic link sent" confirmation card: same elevated glass surface, green check icon in `bg-green-100 rounded-full`.

- [ ] **Step 2: Update `apps/web/app/auth/reset-password/page.tsx`**

Same elevated glass card treatment as login. `<Input>` and `<Button>` primitives.

- [ ] **Step 3: Update `apps/web/app/(dashboard)/onboarding/page.tsx`**

Step indicator: active step = `bg-indigo-400 text-white`, completed = `bg-green-400 text-white`, pending = `bg-white/60 text-slate-400 border border-indigo-200/[0.40]`.

Each step panel: `<GlassCard variant="elevated" className="p-6">`. Navigation buttons: `<Button>` primitive.

- [ ] **Step 4: Final visual pass**

Open each page in browser and check:
- [ ] Login: glass card on gradient, Plus Jakarta Sans, indigo tab toggle
- [ ] Dashboard: glass sidebar, glass header, glass stat cards
- [ ] Housekeeping: all 9 room status colors visible in board
- [ ] Engineering: glass work order cards
- [ ] Staff/Schedule: glass panels, indigo accents
- [ ] Settings: glass form sections

- [ ] **Step 5: Final commit**

```bash
git add apps/web/app/\(auth\)/ apps/web/app/auth/ apps/web/app/\(dashboard\)/onboarding/
git commit -m "feat(design): overhaul auth and onboarding pages — elevated glass surfaces"
```

---

## Summary

| Chunk | Tasks | Key Output |
|---|---|---|
| 1 — Foundation | 1–3 | Tailwind config, fonts, CSS, utilities |
| 2 — Shell | 4–6 | Layout, Sidebar, Header |
| 3 — Primitives | 7 | GlassCard, Button, Input |
| 4 — Dashboard | 8 | Dashboard page + 4 components |
| 5 — Housekeeping | 9 | Room board with 9 status colors |
| 6 — Remaining pages | 10–11 | Engineering, staff, SOP, settings |
| 7 — Auth | 12 | Login, onboarding |

Total: **12 tasks**, ~50 steps. Execute chunks in order — each builds on the previous.

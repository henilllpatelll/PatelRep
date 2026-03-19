# Lobby UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PatelRep's broken/bland visual layer with the "Lobby" design system — amber/cream palette, Figtree font, glassy sidebar, Framer Motion animations, dnd-kit drag & drop.

**Architecture:** Bottom-up dependency order: design tokens → core primitives → shell (sidebar/header) → feature components → pages. Each task is self-contained and visually verifiable in the browser.

**Tech Stack:** Next.js 14 App Router, Tailwind CSS, Framer Motion (new), @dnd-kit/core + @dnd-kit/sortable (new), Recharts (existing), Google Fonts (Figtree + JetBrains Mono via next/font)

**Spec:** `docs/superpowers/specs/2026-03-19-ui-redesign-design.md`

---

## Task 1: Install Dependencies + Fix CSS Foundation

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/tailwind.config.ts`

- [ ] **Step 1: Install new packages**

```bash
cd apps/web
npm install framer-motion @dnd-kit/core @dnd-kit/sortable
```

Expected: packages added to `node_modules`, `package-lock.json` updated.

- [ ] **Step 2: Rewrite `apps/web/app/globals.css`**

Replace entire file with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --color-bg: #FEFAF4;
    --color-surface: #FFFDF8;
    --color-surface-2: #FEF9EE;
  }

  html, body {
    background-color: #FEFAF4;
  }
}

@layer utilities {
  .shimmer {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 3: Rewrite `apps/web/tailwind.config.ts`**

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
        sans: ['var(--font-figtree)', ...defaultTheme.fontFamily.sans],
        mono: ['var(--font-jetbrains-mono)', ...defaultTheme.fontFamily.mono],
      },
      colors: {
        status: {
          inspected:        '#8B5CF6',
          'inspected-text': '#5B21B6',
          'inspected-bg':   '#F5F3FF',
          clean:            '#10B981',
          'clean-text':     '#065F46',
          'clean-bg':       '#ECFDF5',
          'in-progress':    '#3B82F6',
          'in-progress-text': '#1E40AF',
          'in-progress-bg': '#EFF6FF',
          dirty:            '#EF4444',
          'dirty-text':     '#991B1B',
          'dirty-bg':       '#FEF2F2',
          oos:              '#A8A29E',
          'oos-text':       '#57534E',
          'oos-bg':         '#F5F5F4',
          vip:              '#FBBF24',
          'vip-text':       '#78350F',
        },
        risk: {
          high:   '#ef4444',
          medium: '#f97316',
          low:    '#22c55e',
        },
      },
      spacing: { '13': '52px' },
      boxShadow: {
        'amber-glow': '0 0 12px rgba(251,191,36,0.3)',
        'card': '0 2px 12px rgba(0,0,0,0.04)',
        'card-hover': '0 8px 24px rgba(251,191,36,0.10)',
        'sidebar': '4px 0 24px rgba(251,191,36,0.08)',
      },
    },
  },
  plugins: [],
}

export default config
```

- [ ] **Step 4: Grep for legacy status class usages**

```bash
grep -r "status-dirty\|status-clean\|status-in-progress\|status-inspected\|status-ooo\|risk-high\|risk-medium" apps/web/ --include="*.tsx" --include="*.ts"
```

If any results found: replace the class string with the new inline Tailwind classes from `STATUS_CARD_STYLES` (defined in Task 10). These legacy utility classes no longer exist in globals.css.

- [ ] **Step 5: Verify dev server starts without errors**

```bash
cd apps/web && npm run dev
```

Open `http://localhost:3000` — background should now be warm cream `#FEFAF4` (not white/gray).

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/app/globals.css apps/web/tailwind.config.ts
git commit -m "feat: install framer-motion + dnd-kit, fix CSS foundation and design tokens"
```

---

## Task 2: Font System

**Files:**
- Modify: `apps/web/app/layout.tsx`

- [ ] **Step 1: Rewrite `apps/web/app/layout.tsx`**

```tsx
export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { Figtree, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/shared/Providers'

const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-figtree',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'PatelRep — Hotel Operations AI',
  description: 'AI-powered hotel staff operations platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans bg-[#FEFAF4]">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Verify fonts load**

Open `http://localhost:3000/login` — text should render in Figtree (rounded, humanist). Room numbers will use JetBrains Mono when applied.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/layout.tsx
git commit -m "feat: swap Inter→Figtree + JetBrains Mono via next/font"
```

---

## Task 3: Core UI Primitives

**Files:**
- Modify: `apps/web/components/ui/Button.tsx`
- Modify: `apps/web/components/ui/Input.tsx`
- Create: `apps/web/components/ui/Card.tsx`
- Create: `apps/web/components/ui/Badge.tsx`
- Create: `apps/web/components/ui/Skeleton.tsx`
- Delete: `apps/web/components/ui/GlassCard.tsx`

- [ ] **Step 1: Rewrite Button**

```tsx
'use client'

import { cn } from '@/lib/utils'
import { ButtonHTMLAttributes, forwardRef } from 'react'
import { motion } from 'framer-motion'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:     'bg-gradient-to-r from-amber-400 to-amber-500 text-white shadow-md shadow-amber-200/60 hover:from-amber-500 hover:to-amber-600',
  secondary:   'bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100',
  ghost:       'bg-white/70 border border-stone-200 text-stone-600 hover:bg-stone-50',
  destructive: 'bg-red-50 border border-red-200 text-red-700 hover:bg-red-100',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className, children, disabled, ...props }, ref) => (
    <motion.button
      ref={ref}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      className={cn(
        'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        className
      )}
      {...(props as React.ComponentProps<typeof motion.button>)}
    >
      {children}
    </motion.button>
  )
)
Button.displayName = 'Button'
```

- [ ] **Step 2: Rewrite Input**

```tsx
import { cn } from '@/lib/utils'
import { InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-800 placeholder:text-stone-300',
        'focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none',
        'transition-colors duration-150',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'
```

- [ ] **Step 3: Create Card**

```tsx
import { cn } from '@/lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  hover?: boolean
}

export function Card({ children, className, hover = true }: CardProps) {
  return (
    <div
      className={cn(
        'bg-white rounded-2xl border border-stone-100 shadow-card',
        hover && 'hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200',
        className
      )}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Create Badge**

```tsx
import { cn } from '@/lib/utils'

type BadgeVariant =
  | 'dirty' | 'in_progress' | 'clean' | 'inspected'
  | 'do_not_disturb' | 'out_of_order'
  | 'high' | 'medium' | 'low' | 'vip' | 'default'

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  dirty:          'bg-red-50 text-red-800 border-red-200',
  in_progress:    'bg-blue-50 text-blue-800 border-blue-200',
  clean:          'bg-emerald-50 text-emerald-800 border-emerald-200',
  inspected:      'bg-violet-50 text-violet-800 border-violet-200',
  do_not_disturb: 'bg-stone-100 text-stone-600 border-stone-200',
  out_of_order:   'bg-stone-200 text-stone-700 border-stone-300',
  high:           'bg-red-100 text-red-700 border-red-200',
  medium:         'bg-orange-100 text-orange-700 border-orange-200',
  low:            'bg-stone-100 text-stone-600 border-stone-200',
  vip:            'bg-amber-100 text-amber-800 border-amber-300',
  default:        'bg-stone-100 text-stone-600 border-stone-200',
}

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border',
        BADGE_VARIANTS[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
```

- [ ] **Step 5: Create Skeleton**

```tsx
import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
  variant?: 'text' | 'card' | 'room-card' | 'circle'
}

export function Skeleton({ className, variant = 'text' }: SkeletonProps) {
  const BASE = 'bg-stone-100 animate-pulse relative overflow-hidden rounded-xl'
  const AFTER = 'after:absolute after:inset-0 after:shimmer'

  const VARIANTS = {
    text:      'h-4 w-full',
    card:      'h-32 w-full rounded-2xl',
    'room-card': 'aspect-[4/3] w-full rounded-2xl',
    circle:    'rounded-full w-8 h-8',
  }

  return <div className={cn(BASE, AFTER, VARIANTS[variant], className)} />
}
```

- [ ] **Step 6: Delete GlassCard**

```bash
rm apps/web/components/ui/GlassCard.tsx
```

Search for any imports: `grep -r "GlassCard" apps/web/` — replace with `Card` if found.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/ui/
git commit -m "feat: replace UI primitives with amber design system (Button, Input, Card, Badge, Skeleton)"
```

---

## Task 4: PageTransition + useCountUp Hook

**Files:**
- Create: `apps/web/components/shared/PageTransition.tsx`
- Create: `apps/web/lib/hooks/useCountUp.ts`

- [ ] **Step 1: Create PageTransition**

```tsx
'use client'

import { motion } from 'framer-motion'

export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}
```

- [ ] **Step 2: Create useCountUp**

```ts
'use client'

import { useEffect, useRef, useState } from 'react'

export function useCountUp(target: number, duration = 800): number {
  const [count, setCount] = useState(0)
  const frameRef = useRef<number>()
  const startTimeRef = useRef<number>()

  useEffect(() => {
    startTimeRef.current = undefined
    const animate = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp
      const elapsed = timestamp - startTimeRef.current
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setCount(Math.round(eased * target))
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate)
      }
    }
    frameRef.current = requestAnimationFrame(animate)
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current) }
  }, [target, duration])

  return count
}
```

- [ ] **Step 3: Wire PageTransition into dashboard layout**

Edit `apps/web/app/(dashboard)/layout.tsx`:

```tsx
import { Sidebar } from '@/components/shared/Sidebar'
import { Header } from '@/components/shared/Header'
import { AICopilotBubble } from '@/components/ai/AICopilotBubble'
import { PageTransition } from '@/components/shared/PageTransition'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-[#FEFAF4]">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      {/* AICopilotBubble is a top-level sibling — NOT inside PageTransition.
          It uses position:fixed and must stay outside animated wrappers
          to avoid stacking context issues. */}
      <AICopilotBubble />
    </div>
  )
}
```

- [ ] **Step 4: Verify page transitions work**

Open `http://localhost:3000/dashboard` and navigate between pages — content should fade+slide in.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/shared/PageTransition.tsx apps/web/lib/hooks/useCountUp.ts apps/web/app/(dashboard)/layout.tsx
git commit -m "feat: add PageTransition and useCountUp hook, wire into dashboard layout"
```

---

## Task 5: Sidebar Redesign

**Files:**
- Modify: `apps/web/components/shared/Sidebar.tsx`

- [ ] **Step 1: Update Sidebar container and logo**

In `Sidebar.tsx`, replace the `<aside>` opening tag and logo section:

```tsx
// aside container:
<aside className="w-[220px] bg-white/60 backdrop-blur-2xl border-r border-amber-100/50 rounded-r-2xl shadow-sidebar flex flex-col shrink-0">

// Logo zone:
<div className="px-4 pt-5 pb-3">
  <h1 className="text-lg text-amber-600 font-extrabold leading-tight">✦ PatelRep</h1>
  <p className="text-stone-400 text-xs mt-0.5">Hotel Operations AI</p>
</div>
```

- [ ] **Step 2: Update nav item styles**

Replace `renderNavItem` function classes:

```tsx
// Default nav item:
`flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-xl transition-colors duration-200 relative
 ${active
   ? 'text-amber-800 font-semibold'
   : 'text-stone-500 hover:bg-amber-50 hover:text-stone-700 cursor-pointer'
 }`

// Active background — render as absolute positioned motion.div inside the link wrapper:
// Wrap each nav item in a relative div, then inside:
{active && (
  <motion.div
    layoutId="sidebar-active"
    className="absolute inset-0 bg-amber-100 border-l-2 border-amber-400 rounded-xl"
    style={{ zIndex: -1 }}
    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
  />
)}

// Icon: active → text-amber-500, default → text-stone-400
// Sub-nav border: border-l border-amber-100
// Sub-nav active: bg-amber-100/80 text-amber-800, default: text-stone-500 hover:bg-amber-50
```

- [ ] **Step 3: Update section labels + user badge**

```tsx
// Section labels:
<p className="text-[9px] font-bold text-stone-300 uppercase tracking-widest px-2 pt-3 pb-1">

// User badge container:
<div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-amber-50 border border-amber-100">
```

- [ ] **Step 4: Update bottom links (Settings/Billing)**

Same pattern as nav items but without sub-nav. Active: amber-100 bg, amber-800 text.

- [ ] **Step 5: Verify in browser**

Navigate to `http://localhost:3000/dashboard` — sidebar should have glassy amber appearance, active item highlighted amber, ✦ PatelRep in amber text.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/shared/Sidebar.tsx
git commit -m "feat: redesign sidebar — glassy amber panel with Framer Motion active indicator"
```

---

## Task 6: Header Redesign

**Files:**
- Modify: `apps/web/components/shared/Header.tsx`

- [ ] **Step 1: Read the current Header**

Read `apps/web/components/shared/Header.tsx` to understand current structure.

- [ ] **Step 2: Rewrite Header**

```tsx
'use client'

import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { useHotelStore } from '@/stores/hotelStore'
import { getInitials, getAvatarColor } from '@/lib/utils/avatar'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/housekeeping': 'Housekeeping',
  '/housekeeping/assignments': 'Assignments',
  '/housekeeping/inspections': 'Inspections',
  '/housekeeping/rooms': 'All Rooms',
  '/engineering': 'Engineering',
  '/engineering/assets': 'Assets',
  '/engineering/pm-schedules': 'PM Schedules',
  '/engineering/predictions': 'Predictions',
  '/staff': 'Staff',
  '/scheduling': 'Schedule',
  '/logbook': 'Logbook',
  '/sop': 'SOP Library',
  '/reports': 'Reports',
  '/settings': 'Settings',
  '/settings/billing': 'Billing',
  '/settings/integrations': 'Integrations',
  '/guest-requests': 'Guest Requests',
  '/lost-found': 'Lost & Found',
  '/tasks': 'Tasks',
}

export function Header() {
  const pathname = usePathname()
  const { user } = useAuth()
  const { hotel } = useHotelStore()

  const title = PAGE_TITLES[pathname] ?? 'PatelRep'
  const fullName = (user?.user_metadata?.full_name as string) || user?.email || 'User'
  const initials = getInitials(fullName)
  const avatarBg = getAvatarColor(fullName)

  return (
    <header className="h-14 flex items-center justify-between px-6 bg-white/70 backdrop-blur-xl border-b border-stone-100 sticky top-0 z-10 shrink-0">
      <span className="text-sm font-semibold text-stone-800">{title}</span>
      <div className="flex items-center gap-3">
        {hotel && (
          <span className="bg-amber-50 text-amber-700 text-xs font-medium rounded-full px-3 py-1 border border-amber-100">
            {hotel.name}
          </span>
        )}
        <div className={`w-8 h-8 rounded-full ${avatarBg} flex items-center justify-center text-white text-xs font-semibold`}>
          {initials}
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Verify**

Header should show page title on left, hotel name chip + avatar on right.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/shared/Header.tsx
git commit -m "feat: redesign header — breadcrumb + hotel chip + avatar"
```

---

## Task 7: Login + Reset Password Pages

**Files:**
- Modify: `apps/web/app/(auth)/login/page.tsx`
- Modify: `apps/web/app/auth/reset-password/page.tsx`

- [ ] **Step 1: Update login page background + card**

In `login/page.tsx`, replace all instances of:
- `className="min-h-screen bg-app-gradient ...` → `className="min-h-screen bg-[#FEFAF4] ...` with radial amber glow:
  ```
  style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(251,191,36,0.08) 0%, transparent 70%), #FEFAF4' }}
  ```
- Card: `bg-white/[0.88] ... border border-white/[0.95] rounded-2xl` → `bg-white/80 backdrop-blur-2xl rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.08)] border border-amber-100/60`
- Logo: `text-indigo-600` → `text-amber-600`, change text to `✦ PatelRep`
- Tab toggle: `bg-indigo-50/60 border border-indigo-100` → `bg-stone-100` ; active tab: `text-amber-700` instead of `text-indigo-600`
- `text-indigo-500 hover:text-indigo-700` links → `text-amber-600 hover:text-amber-800`

- [ ] **Step 2: Wrap card in Framer Motion entry animation**

```tsx
import { motion } from 'framer-motion'

// Wrap the card div:
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.35, ease: 'easeOut' }}
  className="w-full max-w-md bg-white/80 ..."
>
```

- [ ] **Step 3: Apply same treatment to reset-password page**

Read `apps/web/app/auth/reset-password/page.tsx`, then apply same changes:
- `bg-app-gradient` → warm cream + radial glow
- Card: `rounded-3xl border-amber-100/60`
- Button: amber gradient variant
- Any `indigo-*` → amber equivalents

- [ ] **Step 4: Verify both pages**

Visit `http://localhost:3000/login` and `http://localhost:3000/auth/reset-password` — both should show warm cream background, glass card, amber branding.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(auth)/login/page.tsx apps/web/app/auth/reset-password/page.tsx
git commit -m "feat: redesign auth pages — warm cream background, glass card, amber branding"
```

---

## Task 8: AI Copilot Bubble

**Files:**
- Modify: `apps/web/components/ai/AICopilotBubble.tsx`

- [ ] **Step 1: Read the current AICopilotBubble**

Read `apps/web/components/ai/AICopilotBubble.tsx` to understand all indigo usages.

- [ ] **Step 2: Replace all indigo references**

Find and replace these patterns throughout the component:
- FAB button gradient: `from-indigo-*` → `from-amber-400`, `to-indigo-*` → `to-amber-500`
- FAB shadow: `shadow-indigo-*` → `shadow-amber-200`
- Pulse ring: `ring-indigo-*` → `ring-amber-200/50`
- User message bubble background: any `indigo` gradient → `from-amber-400 to-amber-500`
- Quick action chips: `bg-indigo-*` → `bg-amber-50`, `border-indigo-*` → `border-amber-200`, `text-indigo-*` → `text-amber-700`
- Insights/action text: `text-indigo-*` → `text-amber-600`
- Input focus ring: `ring-indigo-*` or `border-indigo-*` → `ring-amber-400` / `border-amber-400`
- Any remaining `indigo-*` → amber equivalent

- [ ] **Step 3: Verify bubble appearance**

Open dashboard — FAB should show amber gradient. Click to open — chat panel should have amber accents.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/ai/AICopilotBubble.tsx
git commit -m "feat: replace AICopilotBubble indigo colors with amber theme"
```

---

## Task 9: Dashboard Components

**Files:**
- Modify: `apps/web/components/dashboard/ROIMetricsStrip.tsx`
- Modify: `apps/web/components/dashboard/AIRiskAlertsPanel.tsx`
- Modify: `apps/web/components/dashboard/LiveOpsGrid.tsx`
- Modify: `apps/web/components/dashboard/TrendChartsRow.tsx`

- [ ] **Step 1: Read all four files**

Read each file to understand current structure.

- [ ] **Step 2: Update ROIMetricsStrip**

- Wrap each metric in the new `<Card>` primitive
- Add icon in `bg-amber-50 rounded-xl p-2.5` pill
- Replace static numbers with `useCountUp(value)` hook
- Add trend badge using `<Badge variant="low|high">` with green/red
- Replace any `indigo-*` colors with amber equivalents

- [ ] **Step 3: Update AIRiskAlertsPanel**

- Container: `bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-4`
- HIGH alert rows: `border-l-4 border-red-400 bg-white/60 rounded-xl mb-2 p-3`
- MEDIUM alert rows: `border-l-4 border-amber-400 bg-white/60 rounded-xl mb-2 p-3`
- Remove any `indigo-*`

- [ ] **Step 4: Update LiveOpsGrid**

- Table/row hover: `hover:bg-amber-50/50`
- Status badges: replace with `<Badge variant="...">` using correct variant names
- Remove any `indigo-*`

- [ ] **Step 5: Update TrendChartsRow (Recharts)**

- Set chart colors: primary series `stroke="#FBBF24"` (amber-400)
- Add SVG gradient for area fill:
  ```tsx
  <defs>
    <linearGradient id="amberGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="5%" stopColor="#FBBF24" stopOpacity={0.3} />
      <stop offset="95%" stopColor="#FBBF24" stopOpacity={0} />
    </linearGradient>
  </defs>
  ```
- Grid lines: `stroke="#E7E5E4"` `strokeDasharray="3 3"`
- Replace any `indigo-*` in tooltip or legend

- [ ] **Step 6: Verify dashboard**

Visit `http://localhost:3000/dashboard` — metrics should animate up, risk panel amber/warm, charts amber-colored.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/dashboard/
git commit -m "feat: redesign dashboard components — amber metrics, warm risk panel, amber charts"
```

---

## Task 10: Room Status Board (Grid + Drag & Drop)

**Files:**
- Modify: `apps/web/components/housekeeping/RoomCard.tsx`
- Modify: `apps/web/components/housekeeping/RoomStatusBoard.tsx`

- [ ] **Step 1: Read both files**

Read `RoomCard.tsx` and `RoomStatusBoard.tsx` to understand current structure.

- [ ] **Step 2: Rewrite RoomCard as grid card**

Replace the card layout with:

```tsx
// Card container — aspect-ratio grid card:
<div
  className={cn(
    'aspect-[4/3] rounded-2xl p-4 flex flex-col justify-between cursor-pointer',
    'transition-all duration-200',
    STATUS_CARD_STYLES[room.status], // bg + border classes per status
    isVIP && 'border-2 border-amber-400 shadow-amber-glow',
    isInProgress && 'ring-2 ring-blue-300 ring-offset-2 animate-pulse',
  )}
  onClick={onOpen}
>
  {/* Top row: room number + VIP badge */}
  <div className="flex items-start justify-between">
    <span className="font-mono text-xl font-semibold text-stone-900">{room.room_number}</span>
    {isVIP && <Badge variant="vip">VIP</Badge>}
  </div>

  {/* Middle: status */}
  <Badge variant={statusVariant}>{STATUS_LABELS[room.status]}</Badge>

  {/* Bottom: housekeeper + time */}
  <div className="flex items-center justify-between">
    <span className="text-xs text-stone-400 truncate">{assignedTo ?? '—'}</span>
    {eta && <span className="text-xs text-stone-400 font-mono">{eta}</span>}
  </div>

  {/* Hover actions — slide up on hover */}
  <div className="absolute inset-x-3 bottom-3 flex gap-1.5 opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150">
    {/* action buttons */}
  </div>
</div>
```

STATUS_CARD_STYLES map (add near top of file):
```tsx
const STATUS_CARD_STYLES: Record<string, string> = {
  DIRTY:          'bg-red-50 border-2 border-red-200',
  IN_PROGRESS:    'bg-blue-50 border-2 border-blue-200',
  CLEAN:          'bg-emerald-50 border-2 border-emerald-200',
  INSPECTED:      'bg-violet-50 border-2 border-violet-200',
  DO_NOT_DISTURB: 'bg-stone-100 border-2 border-stone-200 opacity-75',
  OUT_OF_ORDER:   'bg-stone-200 border-2 border-stone-300',
  VACANT:         'bg-white border-2 border-stone-100',
  BLOCKED:        'bg-stone-100 border-2 border-stone-200',
  OCCUPIED:       'bg-orange-50 border-2 border-orange-200',
}
```

- [ ] **Step 3: Update RoomStatusBoard to grid layout**

Replace the room list rendering with:

```tsx
// Status filter chips:
<div className="flex gap-2 flex-wrap mb-4">
  {STATUS_OPTIONS.map(status => (
    <button
      key={status}
      onClick={() => setStatusFilter(status)}
      className={cn(
        'px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer transition-colors',
        activeFilter === status
          ? 'bg-amber-100 text-amber-800 border-amber-300'
          : 'bg-stone-100 text-stone-500 border-stone-200 hover:bg-stone-200'
      )}
    >
      {STATUS_LABELS[status]} ({count})
    </button>
  ))}
</div>

// Room grid:
<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
  {filteredRooms.map(room => (
    <RoomCard key={room.id} room={room} ... />
  ))}
</div>
```

- [ ] **Step 4: Add dnd-kit for drag-to-assign**

Wrap the board with `DndContext` from `@dnd-kit/core`. Make room cards `useDraggable`, make housekeeper columns in AssignmentSidebar `useDroppable`. On `onDragEnd`, call the existing assign API.

```tsx
import { DndContext, DragEndEvent } from '@dnd-kit/core'

<DndContext onDragEnd={handleDragEnd}>
  {/* room grid */}
</DndContext>
```

- [ ] **Step 5: Verify room board**

Visit `http://localhost:3000/housekeeping` — rooms should show as a grid of colored cards, filter chips work, drag works in Assign mode.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/housekeeping/RoomCard.tsx apps/web/components/housekeeping/RoomStatusBoard.tsx
git commit -m "feat: room board — grid layout, status-colored cards, dnd-kit drag to assign"
```

---

## Task 11: Engineering + Remaining Pages

**Files:**
- Modify: `apps/web/app/(dashboard)/engineering/page.tsx`
- Modify: `apps/web/components/engineering/WorkOrderCard.tsx`
- Modify: All remaining dashboard pages (amber/stone color substitutions)

- [ ] **Step 1: Read engineering page + WorkOrderCard**

Read both files.

- [ ] **Step 2: Add kanban layout to engineering page**

Wrap work orders in three columns: TODO / IN PROGRESS / DONE.

```tsx
<div className="grid grid-cols-3 gap-4">
  {(['open', 'in_progress', 'completed'] as const).map(status => (
    <div key={status} className="bg-stone-50 rounded-2xl p-3 min-h-[400px]">
      <h3 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-3">
        {STATUS_LABELS[status]}
      </h3>
      <div className="space-y-3">
        {workOrders.filter(wo => wo.status === status).map(wo => (
          <WorkOrderCard key={wo.id} workOrder={wo} />
        ))}
      </div>
    </div>
  ))}
</div>
```

- [ ] **Step 3: Update WorkOrderCard**

- Use `<Card>` primitive
- Priority badge: `<Badge variant="high|medium|low">`
- Remove any `indigo-*`

- [ ] **Step 4: Global indigo sweep — remaining pages**

Run: `grep -r "indigo" apps/web/app/(dashboard)/ apps/web/components/ --include="*.tsx" -l`

For each file found, replace:
- `text-indigo-600` → `text-amber-600`
- `bg-indigo-*` → amber equivalent (50→`bg-amber-50`, 100→`bg-amber-100`, 400/500/600→gradient buttons)
- `border-indigo-*` → `border-amber-200`
- `ring-indigo-*` → `ring-amber-400`
- `hover:text-indigo-*` → `hover:text-amber-700`

- [ ] **Step 5: Final visual check**

Visit every page in the app:
- `/dashboard` — amber metrics, warm charts ✓
- `/housekeeping` — colored room grid ✓
- `/engineering` — kanban columns ✓
- `/staff` — table with amber row hover ✓
- `/scheduling` — amber shift fills ✓
- `/sop` — amber "Ask AI" button ✓
- `/reports` — amber tab indicator ✓
- `/settings` — amber save button ✓
- `/logbook` — no indigo remaining ✓
- Sidebar active states — all amber ✓
- No indigo anywhere ✓

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/ apps/web/components/engineering/
git commit -m "feat: engineering kanban, global indigo→amber sweep across all pages"
```

---

## Task 12: Final Polish + Success Criteria Verification

- [ ] **Step 1: Run global indigo check**

```bash
grep -r "indigo" apps/web/app/ apps/web/components/ --include="*.tsx" --include="*.ts" --include="*.css"
```

Expected: zero matches (or only in comments/strings that are not class names).

- [ ] **Step 2: Check Figtree loads**

In browser DevTools → Fonts — confirm `Figtree` and `JetBrains Mono` are listed as loaded fonts.

- [ ] **Step 3: Verify all success criteria from spec**

Walk through Section 15 of spec `docs/superpowers/specs/2026-03-19-ui-redesign-design.md`:
- [ ] Background is warm cream (not white)
- [ ] Sidebar is glassy amber panel
- [ ] Figtree loads without fallback flash
- [ ] Login page has amber branding
- [ ] Dashboard metric counters animate
- [ ] Room board is a grid with status-colored cards
- [ ] Drag-to-assign works
- [ ] Page transitions on navigation
- [ ] No indigo in UI
- [ ] All interactive elements have hover/active states
- [ ] Skeleton screens for loading states

- [ ] **Step 4: Fix any remaining issues found in Step 3**

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Lobby UI redesign — amber/cream design system, Figtree font, animations"
```

---

## Summary

| Task | What | Key Files |
|---|---|---|
| 1 | Install deps + CSS foundation | globals.css, tailwind.config.ts |
| 2 | Font system | layout.tsx |
| 3 | Core primitives | Button, Input, Card, Badge, Skeleton |
| 4 | PageTransition + useCountUp | PageTransition.tsx, useCountUp.ts |
| 5 | Sidebar redesign | Sidebar.tsx |
| 6 | Header redesign | Header.tsx |
| 7 | Auth pages | login/page.tsx, reset-password/page.tsx |
| 8 | AI Copilot Bubble | AICopilotBubble.tsx |
| 9 | Dashboard components | ROIMetricsStrip, AIRiskAlertsPanel, LiveOpsGrid, TrendChartsRow |
| 10 | Room board grid + dnd | RoomCard.tsx, RoomStatusBoard.tsx |
| 11 | Engineering + global sweep | engineering/page.tsx, all remaining pages |
| 12 | Final polish + verification | — |

**Estimated files modified/created:** ~25
**New dependencies:** `framer-motion`, `@dnd-kit/core`, `@dnd-kit/sortable`

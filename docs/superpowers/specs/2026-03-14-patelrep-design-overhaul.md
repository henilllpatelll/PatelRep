# PatelRep Frontend Design Overhaul
**Date:** 2026-03-14
**Status:** Approved
**Scope:** Full visual redesign of all web pages (`apps/web`)

---

## 1. Design Direction

**Style:** Light Glassmorphism
**Approach:** Token-first — update Tailwind config with full design token set first, then shell, then components, then pages.

The app background is a soft three-stop pastel gradient. All surfaces sit on top as frosted glass panels (backdrop-blur + translucent white). Light, airy, modern — suitable for hotel staff on long shifts.

---

## 2. Design Tokens

### Background
```
App background: linear-gradient(135deg, #EFF6FF 0%, #F0FDF4 50%, #F5F3FF 100%)
Tailwind: bg-gradient-to-br from-blue-50 via-emerald-50 to-violet-50
```

### Glass Surfaces
| Variant | Background | Border | Blur class | Use |
|---|---|---|---|---|
| Default | `rgba(255,255,255,0.65)` | `rgba(255,255,255,0.9)` | `backdrop-blur-md` | Cards, panels |
| Accent | `rgba(129,140,248,0.10)` | `rgba(129,140,248,0.22)` | `backdrop-blur-md` | Highlighted cards |
| Danger | `rgba(255,77,77,0.08)` | `rgba(255,77,77,0.20)` | `backdrop-blur-md` | Alert cards |
| Success | `rgba(74,222,128,0.10)` | `rgba(74,222,128,0.25)` | `backdrop-blur-md` | Positive metric cards |
| Elevated | `rgba(255,255,255,0.88)` | `rgba(255,255,255,0.95)` | `backdrop-blur-2xl` | Modals, drawers |
| Sidebar | `rgba(255,255,255,0.62)` | `rgba(255,255,255,0.85)` | `backdrop-blur-xl` | Sidebar panel |
| Header | `rgba(255,255,255,0.55)` | `rgba(255,255,255,0.80)` | `backdrop-blur-lg` | Top header bar |

### Brand Token Migration
The existing `brand-*` Tailwind tokens (`bg-brand-600`, `text-brand-700`, `bg-brand-50`, etc.) are **replaced entirely** by the indigo palette below. Remove the `brand` key from `tailwind.config.js` and update all references:
- `brand-50` → `indigo-50`
- `brand-600` → `indigo-400`
- `brand-700` → `indigo-600`
- The `getAvatarColor` helper in `Sidebar.tsx` and `Header.tsx` uses `bg-brand-600` — replace with `bg-indigo-400`. Also consolidate the duplicated `getInitials` / `getAvatarColor` helpers into `lib/utils/avatar.ts`.

### Primary Color — Indigo
| Token | Hex | Use |
|---|---|---|
| `indigo-50` | `#EEF2FF` | Active nav bg, tag bg |
| `indigo-200` | `#C7D2FE` | Borders, dividers |
| `indigo-300` | `#A5B4FC` | Inactive nav icons |
| `indigo-400` | `#818CF8` | **Primary CTA, active accents** |
| `indigo-600` | `#4F46E5` | Primary text on light bg, logo |
| `indigo-700` | `#3730A3` | Hover states |

### Custom Tailwind Config Additions
Add to `tailwind.config.js` under `theme.extend`:
```js
spacing: {
  '13': '52px',   // h-13 header height
},
fontFamily: {
  sans: ['Plus Jakarta Sans', ...defaultTheme.fontFamily.sans],
},
backgroundImage: {
  'app-gradient': 'linear-gradient(135deg, #EFF6FF 0%, #F0FDF4 50%, #F5F3FF 100%)',
},
```

### Text
| Token | Hex | Use |
|---|---|---|
| Heading | `#0F172A` | Page titles, stat values |
| Body | `#334155` | Paragraph text, nav items |
| Muted | `#64748B` | Subtitles, timestamps |
| Subtle | `#94A3B8` | Labels, placeholders |

### Semantic Colors (Pastel)
| Intent | Background | Text |
|---|---|---|
| Success | `#DCFCE7` | `#15803D` |
| Warning | `#FEF3C7` | `#B45309` |
| Danger | `#FEE2E2` | `#B91C1C` |
| Info | `#DBEAFE` | `#1D4ED8` |
| AI/Purple | `#F3E8FF` | `#7E22CE` |

### Typography
- **Font:** Plus Jakarta Sans (Google Fonts)
- **Weights:** 300, 400, 500, 600, 700, 800
- **Import:** `https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap`
- Add to `apps/web/app/layout.tsx` as a `<link>` in `<head>`, and set `font-sans` in Tailwind config (see above)

| Role | Size | Weight |
|---|---|---|
| Page heading | `text-xl` / `text-2xl` | 800 |
| Section title | `text-sm` | 700 |
| Nav item | `text-xs` / `text-sm` | 500–600 |
| Body | `text-sm` | 400 |
| Label / badge | `text-xs` | 600–700 |
| Stat value | `text-2xl`–`text-3xl` | 800 |

### Buttons
| Variant | Style |
|---|---|
| Primary | `bg-gradient-to-r from-indigo-400 to-indigo-600`, white text, `shadow-sm shadow-indigo-200` |
| Secondary | `bg-indigo-50 border border-indigo-200 text-indigo-600` |
| Ghost | `bg-white/70 border border-white/90 backdrop-blur-sm text-slate-600` |
| Destructive | `bg-red-50 border border-red-200 text-red-700` |

### `prefers-reduced-motion`
Add this global rule in `apps/web/app/globals.css`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 3. Room Status Colors

| Status | Background | Text | Semantic Meaning |
|---|---|---|---|
| **Inspected** | `#4ADE80` | `#064E3B` | True green — Ready to sell, final state |
| **Clean** | `#99F6E4` | `#134E4A` | Soft teal — Cleaned, not yet inspected |
| **In Progress** | `#7DD3FC` | `#0C4A6E` | Sky blue — Housekeeper actively cleaning |
| **Pick Up** | `#DDD6FE` | `#5B21B6` | Soft pastel purple — Stayover light refresh |
| **Occupied** | `#FC8D8D` | `#7F1D1D` | Salmon — Guest in room, do not disturb |
| **Dirty** | `#FF4D4D` | `#FFFFFF` | Bright red — Highest urgency |
| **Check-Out** | `#FF4D4D` | `#FFFFFF` | Same as Dirty — Guest departed, needs turnover |
| **Out of Service** | `#70767D` | `#FFFFFF` | Gray — Blocked, cannot be sold |
| **VIP** | `#FCD34D` | `#78350F` | Gold — Premium guest, elevated priority |

Export these as a typed constant in `lib/utils/roomStatus.ts` (file already exists — add/replace the color map).

---

## 4. Shell Layout

### Layout Structure
```tsx
<div className="flex h-screen bg-app-gradient">   {/* pastel gradient bg */}
  <Sidebar />                                       {/* glass, w-52 = 208px */}
  <div className="flex-1 flex flex-col overflow-hidden">
    <Header />                                      {/* glass, h-13 = 52px (custom spacing) */}
    <main className="flex-1 overflow-y-auto p-5">  {/* p-5 = 20px, intentional change from p-6 */}
      {children}
    </main>
  </div>
  <AICopilotBubble />                               {/* fixed bottom-right */}
</div>
```

**Sidebar width is `w-52` (208px)** — a deliberate reduction from the current `w-56` (224px) to give content more room.

### Sidebar
- **Width:** `w-52` (208px) — replaces current `w-56`
- **Surface:** `bg-white/[0.62] backdrop-blur-xl border-r border-white/[0.85]`
- **Logo:** "PatelRep" in `text-indigo-600 font-extrabold`, subline "Hotel Operations AI" in `text-slate-400 text-xs`
- **Navigation:** Flat list replaced with **3 grouped sections** with uppercase labels (`text-[9px] font-bold text-slate-400 uppercase tracking-widest`):
  - **Operations:** Dashboard, Housekeeping (w/ sub-nav: Room Board, Assignments, Inspections, All Rooms), Engineering (w/ sub-nav), Guest Requests, Lost & Found, Tasks
  - **People:** Staff, Schedule
  - **Knowledge:** SOP Library, Reports, Logbook
- **Active nav item:** `bg-indigo-400/[0.12] text-indigo-600 font-semibold border border-indigo-300/[0.20] rounded-lg`
- **Inactive nav item:** `text-slate-600 hover:bg-indigo-400/[0.06] hover:text-indigo-600 rounded-lg`
- **Sub-nav:** `ml-6 pl-2 border-l border-indigo-200/[0.20]`, items `text-xs text-slate-500`
- **Bottom section:** Settings link + user identity badge `bg-indigo-400/[0.06] rounded-lg`

### Header
- **Height:** `h-13` (52px via custom spacing token)
- **Surface:** `bg-white/[0.55] backdrop-blur-lg border-b border-white/[0.80]`
- **Left:** Hotel name (`font-bold text-slate-900 text-sm`) + current date below (`text-slate-400 text-xs`, format: `new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })`, client-side)
- **Right:** Notification bell (with red dot `bg-red-400` badge) + user avatar/name/chevron dropdown
- **Dropdown panel:** Use **Elevated glass surface** (`bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-xl shadow-lg`) — same treatment as modals

### AI Copilot Bubble
- `fixed bottom-4 right-4`
- `bg-gradient-to-br from-indigo-400 to-indigo-600 rounded-full w-11 h-11 shadow-lg shadow-indigo-400/40`
- Chat icon (Lucide `MessageCircle`) in white

---

## 5. Component Design Principles

### Glass Cards
- `rounded-2xl` + appropriate glass surface variant (see Section 2)
- Inner padding: `p-4` standard, `p-5` for larger panels
- Default cards only: `shadow-[0_2px_12px_rgba(99,102,241,0.05)]`

### Stat Cards (Dashboard)
- `grid grid-cols-4 gap-3` on desktop
- Label: `text-[9px] font-bold uppercase tracking-widest` (muted or semantic color)
- Value: `text-2xl font-extrabold`
- Sub-label: `text-xs text-slate-400 mt-1`

### Modals & Drawers
- Elevated glass surface: `bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95]`
- Overlay: `bg-indigo-950/20 backdrop-blur-sm`

### Forms & Inputs
- `bg-white/70 border border-indigo-200/[0.40] rounded-lg backdrop-blur-sm`
- Focus: `ring-2 ring-indigo-400/50 border-indigo-400`

### Login Page (`/(auth)/login`)
- Full-page layout (no sidebar): `min-h-screen bg-app-gradient flex items-center justify-center`
- Centered card: `w-full max-w-md` using Elevated glass surface (`bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl p-8 shadow-xl`)
- Same PatelRep logo + "Hotel Operations AI" subline at top of card

---

## 6. Page Inventory

All pages under `apps/web/app/(dashboard)/` plus auth pages:

| Page | Key Components |
|---|---|
| `/dashboard` | Stat cards, AI risk alerts, mini room board, trend charts |
| `/housekeeping` | Room status board (all 9 colors), prediction panel |
| `/housekeeping/assignments` | Assignment table, HK workload bars |
| `/housekeeping/inspections` | Inspection history table |
| `/housekeeping/rooms` | Room list, import modal |
| `/engineering` | Work order list/cards |
| `/engineering/assets` | Asset table |
| `/engineering/pm-schedules` | PM schedule list |
| `/engineering/predictions` | Failure prediction sidebar |
| `/staff` | Staff list, invite modal |
| `/scheduling` | Weekly calendar grid |
| `/sop` | Document grid, RAG query modal |
| `/tasks` | Task list |
| `/guest-requests` | Request list |
| `/lost-found` | Lost & found list |
| `/logbook` | Log entries |
| `/reports` | Report views |
| `/settings` | Hotel profile form |
| `/settings/integrations` | Opera Cloud integration |
| `/settings/billing` | Billing page |
| `/onboarding` | 6-step wizard |
| `/(auth)/login` | Centered elevated glass card on gradient |
| `/auth/reset-password` | Same treatment as login |

---

## 7. Implementation Order (Token-First)

1. **Tailwind config** — add `h-13` spacing, `font-sans` → Plus Jakarta Sans, `bg-app-gradient`, remove `brand-*` tokens
2. **Global CSS** — Plus Jakarta Sans `<link>` in `layout.tsx`, `prefers-reduced-motion` rule in `globals.css`, set `body` bg to `bg-app-gradient`
3. **Shared utilities** — create `lib/utils/avatar.ts` (consolidate `getInitials` + `getAvatarColor`), update `roomStatus.ts` color map
4. **Shell** — `layout.tsx` (new className), `Sidebar.tsx` (grouped nav, glass surface, replace `brand-*`), `Header.tsx` (glass surface, date field, dropdown panel, replace `brand-*`)
5. **Shared components** — button variants, input styles, glass card primitives
6. **Dashboard page** — stat cards, panels
7. **Housekeeping pages** — room board (9-color system), cards, drawers (highest visual impact)
8. **Remaining dashboard pages** — engineering, staff, scheduling, SOP, tasks, etc.
9. **Auth pages** — login, reset password, onboarding wizard

---

## 8. Tools & References

| Tool | Role |
|---|---|
| **UI UX Pro Max** | Design system rules (accessibility, spacing, animation timing) |
| **Google Stitch** | Mockup generation for individual screens before coding |
| **21st.dev** | Production-ready React component registry for complex UI elements |
| **Plus Jakarta Sans** | Google Fonts — all text |
| **Lucide React** | Icon set (already installed) |

### Key Rules (from UI UX Pro Max)
- Minimum 44×44px touch targets
- All transitions 150–300ms (`transition-colors duration-200`)
- `cursor-pointer` on all interactive elements
- Skeleton loaders on all async content (no layout shift)
- `prefers-reduced-motion` handled via global CSS rule (see Section 2)
- 4.5:1 contrast ratio minimum — verify room status colors against their text
- No emoji icons — Lucide SVG only

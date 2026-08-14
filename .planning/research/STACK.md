# Stack Research

**Domain:** Full UI/UX + navigation/IA + workflow redesign of an existing, mature Next.js App Router SaaS (v2.0 "Web UI/UX Redesign")
**Researched:** 2026-08-13
**Confidence:** HIGH

## TL;DR (read this first)

**The existing foundation already IS a design system.** `apps/web` has a complete CSS-variable
token layer (`--paper/--ink/--accent` + full semantic status ramps), light+dark WCAG-AA sets, **4
switchable accent themes** (terracotta/teal/blue/rose), **3 density modes** (comfortable/balanced/dense
via `--row-h/--pad-y/--gap`), radius/shadow tokens, `prefers-reduced-motion` handling, CVA +
tailwind-merge + clsx variants, Radix primitives, and framer-motion micro-interactions. A redesign
does **not** need a new component-system dependency — it needs *net-new tokens*, a handful of
*additive same-family Radix primitives*, and Next.js *built-in* routing patterns for the IA overhaul.

**The single most important build-order rule:** net-new design tokens (refreshed palette values +
motion/elevation/z-index scales) must land as CSS variables **before** any component restyling,
because every primitive already reads from `var(--…)`. Restyle the tokens, and 80% of the visual
identity shifts app-wide for free — including inside the excluded Room Board, which is why token
*values* may change but token *names* and shared-primitive *prop/variant contracts* must not.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended (for THIS codebase) |
|------------|---------|---------|-----------------|
| **Keep hand-rolled primitives** (Radix + CVA + Tailwind) | current | The component system to redesign *on top of* | The UI Refresh Plan already built the shadcn-equivalent architecture. Adopting shadcn/ui as a dep introduces a **competing token vocabulary** (`--background/--primary/--muted/--ring` in oklch) that collides with the existing `--paper/--ink/--accent` hex system — and shadcn's `--accent` means "muted hover bg" while this repo's `--accent` is the primary terracotta action. A swap would fork the design system and put the **out-of-scope Room Board** (which imports the existing `Button`/`Card`) at risk. |
| **Tailwind CSS** | **stay on 3.4.19** (do NOT migrate to 4.3.3) | Styling engine | Tailwind v4 is a CSS-first rewrite (`@tailwindcss/postcss`, `@theme` blocks, utility renames, removed `tailwind.config.ts` JS API this repo depends on). Migrating touches *every* file including the excluded Room Board and the CI i18n/lint gates — high risk, zero visual-identity payoff. A presentation redesign does not need it. Defer v4 to its own dedicated milestone. |
| **CSS custom properties** (existing `globals.css` `:root`) | native | Design-token layer | This is already the industry-standard token approach. No Style Dictionary / token-pipeline dependency is warranted for a single web app with one dark theme — it would add build complexity for no benefit. Extend the existing `:root` / `.theme-dark` / `.accent-*` blocks. |
| **motion** (framer-motion) | **13.1.0** (repo on 13.0.0) | Animation / micro-interactions / route + shared-layout transitions | Already the animation engine (`Button` `whileTap`, `PageTransition`, `AnimatePresence`). `framer-motion` is now published as **`motion`** (import `motion/react`, same API, homepage motiondivision/motion). Bump the existing dep to 13.1.0; optionally rename the import to `motion/react` in a mechanical pass. **Do not add a second animation library.** |

### Supporting Libraries (additive, same-family — safe to add)

These are Radix primitives from the **same family already in use** (dialog/dropdown-menu/select/tabs/
toast). They are unstyled, read no color tokens of their own, compose with CVA exactly like the
current primitives, and cannot conflict with the Room Board. Add only the ones a given redesign
surface actually needs.

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@radix-ui/react-navigation-menu` | 1.2.22 | Accessible grouped/flyout nav | If the IA overhaul introduces grouped or mega-menu navigation across the 16 sections × 6 roles. Otherwise extend the existing `Sidebar`. |
| `@radix-ui/react-tooltip` | 1.2.16 | Hover/focus affordance labels | Dense floor-facing surfaces where icon-only actions need a label without adding phone clutter (honors the "save floor staff time" filter). |
| `@radix-ui/react-popover` | 1.1.23 | Inline filters / quick actions / menus | Workflow redesign: inline row filters, quick-edit popovers, column pickers on Reports/Management ROI. |
| `@radix-ui/react-scroll-area` | 1.2.18 | Consistent styled scroll in panels | Redesigned side panels/drawers/nav that need cross-browser scrollbars matching the new visual identity. |
| `@radix-ui/react-collapsible` | 1.1.20 | Expandable nav groups / settings sections | Grouped sidebar navigation and progressive-disclosure workflow panels. |
| `@radix-ui/react-accordion` | 1.2.20 | Stacked disclosure (SOP, settings, FAQ) | SOP Library / Settings redesign where multiple sections expand independently. |
| `@radix-ui/react-separator` | 1.1.15 | Semantic dividers | Trivial but a11y-correct dividers in the new nav/toolbar chrome. |
| `@radix-ui/react-avatar` | 1.2.6 | Staff/user avatars with fallback | Staff, Scheduling, Logbook surfaces if the redesign standardizes avatar rendering (repo currently has `lib/utils/avatar`). |

### Navigation / IA patterns (Next.js **built-ins — no new dependency**)

The dashboard today is a single client `DashboardShell` under one route group. For a 16-section,
6-role restructure, use App Router primitives already available in `next@16.3.0-preview.10`:

| Pattern | Use For | Notes |
|---------|---------|-------|
| **Route groups** `(dashboard)` `(auth)` | Already in use | Extend with role- or domain-scoped groups (e.g. `(ops)`, `(admin)`) to give sections distinct layouts without URL changes. |
| **Parallel routes** `@slot` | Role-composed dashboards | Compose the role-specific dashboard views (Housekeeper/Supervisor/Engineer/ChiefEngineer/FrontDesk/GM) as parallel slots in one layout instead of the current runtime component switch — cleaner per-role IA, independent loading/error states. |
| **Intercepting routes** `(.)` `(..)` | Modal detail views | Present detail drawers/modals (tasks, work orders, guest requests) as intercepted routes so they're deep-linkable and shareable while preserving the list behind them. **Do NOT retrofit the excluded Room Board / `RoomDetailDrawer` this way.** |
| **`loading.tsx` / `error.tsx` / `template.tsx`** | Per-section skeletons + transitions | Pair with the existing `Skeleton` primitive and `PageTransition` for consistent perceived-performance across the redesigned IA. |

## Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| shadcn/ui website + CLI (v4.18.0) | **Reference only — not installed** | Use `ui.shadcn.com` component *recipes* as a copy-paste starting point for net-new complex primitives (Combobox, Command, HoverCard). Paste the JSX/behavior, then **re-tokenize** to `--paper/--ink/--accent` and drop shadcn's `--background/--primary` classes. Never run `npx shadcn init` — it rewrites `globals.css`/`tailwind.config` to shadcn's token scheme and would clobber the existing system. |
| Existing i18n CI gate (`eslint-plugin-i18next`, `verify-i18n-gate.mjs`) | Guardrail during redesign | Every new/restyled component with copy must route through `react-i18next` with EN/ES keys — the redesign inherits the `no-literal-string` gate, so budget i18n keys per new surface. |
| Playwright (`@playwright/test` 1.62.1) | Visual/interaction regression | Existing e2e configs (phase1/phase4). Add smoke coverage that the excluded Room Board (`RoomStatusBoard`, `RoomDetailDrawer`, `EngineeringRoomBoard`) renders unchanged after shared-primitive edits. |

## Installation

```bash
# From apps/web/ — additive Radix primitives (add only surfaces that need them)
npm install @radix-ui/react-navigation-menu@1.2.22 @radix-ui/react-tooltip@1.2.16 \
  @radix-ui/react-popover@1.1.23 @radix-ui/react-scroll-area@1.2.18 \
  @radix-ui/react-collapsible@1.1.20 @radix-ui/react-accordion@1.2.20 \
  @radix-ui/react-separator@1.1.15 @radix-ui/react-avatar@1.2.6

# Align animation engine to current patch (optional import rename to motion/react)
npm install motion@13.1.0        # replaces framer-motion@13.0.0; same API

# NOTHING ELSE. No shadcn, no Tailwind v4, no second animation/icon/component library.
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Keep hand-rolled Radix+CVA system | **shadcn/ui (installed)** | Only worth it on a greenfield app with no existing token vocabulary. Here the token/primitive collision + Room Board dependency make it net-negative. Use it as a *recipe reference*, not a dep. |
| Stay on Tailwind 3.4 | **Tailwind v4 (4.3.3)** | Justified as its own isolated migration milestone (perf, CSS-first ergonomics) — never bundled into a visual redesign that must leave the Room Board untouched. |
| Extend CSS variables in `globals.css` | **Style Dictionary / token pipeline** | Only if tokens must be shared across web + mobile + native design tools from a single source. Out of scope (mobile is explicitly excluded this milestone). |
| framer-motion/motion 13 | **@formkit/auto-animate, react-spring, GSAP** | Never here — each is a *competing* animation runtime. motion already covers layout, presence, gesture, and scroll animation. |
| Radix Navigation Menu | **Custom Zustand-driven nav** | If the new IA is a simple flat sidebar, the existing hand-rolled `Sidebar` + Zustand is enough; skip navigation-menu entirely. |
| Intercepting routes for modals | **Existing in-component drawer state** | Keep in-component state for the excluded Room Board and any surface where deep-linking a modal adds no user value. |

## What NOT to Use

| Avoid | Why (specific to this codebase) | Use Instead |
|-------|-----|-------------|
| **shadcn/ui as an installed dependency** | oklch `--background/--primary/--muted/--ring` collides with hex `--paper/--ink/--accent`; shadcn's `--accent` semantics differ from this repo's; `init` rewrites `globals.css` + `tailwind.config`; forks the system the Room Board depends on | Keep the hand-rolled system; borrow shadcn *recipes* re-tokenized to existing vars |
| **Tailwind CSS v4 (now)** | Breaking CSS-first rewrite touches every file incl. excluded Room Board + CI gates; no visual-identity payoff | Stay on 3.4.19; schedule v4 as a separate milestone |
| **A second component library** (MUI, Chakra, Mantine, Ant, Park UI, HeroUI) | Ships its own styling engine + tokens + primitives → two design systems, doubled bundle, guaranteed Room Board drift | Extend existing Radix+CVA primitives |
| **A second animation library** (auto-animate, react-spring, GSAP) | Competes with motion already powering `Button`/`PageTransition`; inconsistent easing/reduced-motion handling | motion 13.1.0 (`AnimatePresence`, `layout`, `useScroll`) |
| **A second icon set** (Heroicons, react-icons, Tabler, Phosphor) | lucide-react is the established set (`Loader2` etc.); mixing sets breaks visual consistency and bloats the bundle | lucide-react 1.30→1.31 |
| **sonner** (toast) | Duplicates the existing `useToast` + `Toaster` (Radix Toast) built in the UI Refresh Plan | Existing `components/ui/Toast.tsx` |
| **next-themes** | Duplicates existing theme switching via `uiPreferencesStore` + `.theme-dark` class + `TweaksPanel`; would fight the existing accent/density system | Existing `uiPreferencesStore` |
| **vaul** (drawer) | Competes with existing Radix Dialog + `RoomDetailDrawer` pattern | Radix Dialog / existing drawer pattern; only reconsider if a *net-new* mobile bottom-sheet is required and Radix Dialog proves insufficient |
| **Style Dictionary / design-token build pipeline** | Overkill for one web app with one dark theme; adds a build step | Plain CSS variables in `globals.css` |

## Room Board backward-compatibility contract (hard constraint)

`RoomStatusBoard.tsx`, `RoomDetailDrawer.tsx`, and `EngineeringRoomBoard.tsx` are OUT OF SCOPE and
must remain visually + functionally unchanged. They import shared primitives (`Button`, `Card`, etc.)
that the redesign will touch. Rules that keep them safe:

- **Token *values* may change; token *names* must not.** Renaming/removing a CSS var or a Tailwind
  color alias (`bg`, `surface`, `ink`, `accent`, `status.*`, `risk.*`) breaks the board. Add new
  tokens; don't delete old ones (the config already keeps "legacy compat" aliases — preserve them).
- **Shared-primitive changes must be additive.** New `Button`/`Card` variants/sizes/props are fine;
  changing the default variant, existing variant class strings, or existing prop semantics is not.
- **Because the board reads the same tokens,** a palette refresh will restyle it too. If the board
  must look byte-identical, pin its surfaces to fixed hex (the `status.*` scale is already hardcoded
  hex, so status chips are inherently insulated) rather than the refreshed semantic vars.
- Add a Playwright visual smoke test on all three components as a regression tripwire before any
  shared-primitive edit lands.

## Build-order implications (for the roadmapper)

1. **Tokens first.** Land refreshed palette values + net-new semantic tokens (motion durations,
   elevation/z-index scales, any new spacing) in `globals.css` `:root`/`.theme-dark`/`.accent-*`
   **before** touching any component. Re-verify WCAG-AA on light + dark + all 4 accents at this gate.
2. **Shared-primitive hardening (additive) next.** Any `Button`/`Card`/`Input` changes needed by the
   redesign land as additive variants with the Room Board smoke test green.
3. **IA restructure is orthogonal to visual restyle** — parallel routes / intercepting routes /
   route groups can be sequenced independently of the palette work; they share no code with the
   token layer.
4. **Per-surface restyle + new Radix primitives** are leaf work — install each additive primitive in
   the phase that needs it, not up front. Each restyled surface re-runs the i18n gate.
5. **motion patch bump** is low-risk and can land anytime; the optional `motion/react` import rename
   is a mechanical codemod, best done in its own small pass.

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `next@16.3.0-preview.10` | React 18.3.1 | Preview/canary; `AGENTS.md` warns APIs differ from training data — read `node_modules/next/dist/docs/` before using route-group/parallel/intercepting patterns. |
| Radix primitives 1.x | React 18.3.1, existing CVA setup | New primitives match the version line of the 5 already installed; unstyled, no token coupling. |
| `motion@13.1.0` | React 18.3.1 | Drop-in for `framer-motion@13.0.0`; `motion/react` import path. |
| Tailwind 3.4.19 | `tailwind.config.ts` (JS API), autoprefixer, postcss 8 | Do not bump to v4 — config API and PostCSS plugin change is breaking. |
| lucide-react 1.31.0 | React 18.3.1 | Patch bump from 1.30.0; safe. |

## Sources

- Local npm registry via `npm view` (2026-08-13) — **authoritative for installable versions in this
  environment**: motion/framer-motion 13.1.0, tailwindcss 4.3.3, shadcn 4.18.0, lucide-react 1.31.0,
  and all Radix primitive versions above. HIGH confidence.
- `apps/web/package.json`, `tailwind.config.ts`, `app/globals.css`, `components/ui/Button.tsx`,
  `components/shared/DashboardShell.tsx` — ground truth for the existing token/primitive/theme system.
  HIGH confidence.
- https://ui.shadcn.com/docs/theming — verified shadcn's default token names
  (`--background/--foreground/--primary/--muted/--accent/--border/--ring`, oklch) → substantiates the
  token-collision argument. HIGH confidence.
- https://motion.dev/docs/react-quick-start — verified `framer-motion` is now published as `motion`,
  import `motion/react`, same API. HIGH confidence.
- Next.js App Router routing patterns (route groups / parallel / intercepting routes) — built-in;
  verify exact API in `node_modules/next/dist/docs/` per repo `AGENTS.md`. MEDIUM confidence (preview
  build may differ from stable docs).

---
*Stack research for: v2.0 Web UI/UX Redesign of an existing Next.js App Router SaaS*
*Researched: 2026-08-13*

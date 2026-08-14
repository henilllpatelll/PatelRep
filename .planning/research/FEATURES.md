# Feature Research

**Domain:** UI/UX redesign IA patterns for a 16-section, 6-role operational B2B SaaS dashboard (hotel ops — floor staff on phones/tablets + managers/GMs on desktop)
**Researched:** 2026-08-13
**Confidence:** HIGH (internal — full read of `DashboardShell.tsx`, `Sidebar.tsx`, `navigation.ts`, `housekeepingNavigation.ts`, `MobileFloorNav.tsx`, `components/dashboard/*`); MEDIUM external (WebSearch across B2B SaaS nav/notification/mobile-nav guides, not verifiable against a single authoritative doc)

## Scope Recap

v2.0 is a **redesign of already-built features**, not new capability. The frontend already ships a fairly mature shell — this research measures the *expected redesign patterns* against what exists so the roadmapper knows what is "evolve" vs "net-new."

**What already exists (baseline — do not re-derive):**
- **Grouped role-gated sidebar** (`Sidebar.tsx`): three sections — Operations / Intelligence / People (`OPERATIONS_HREFS` / `INTELLIGENCE_HREFS` / `PEOPLE_HREFS`), active-state left-rail indicator, hotel switcher dropdown, i18n labels, GM-only Settings at bottom. Fixed 232px, no collapse.
- **Single source of truth for RBAC nav** (`getAllowedHrefs` / `getAllowedNavItems` in `navigation.ts`) — Sidebar, CommandPalette, and Breadcrumbs all read through it. Handles `NAV_BY_ROLE`, `custom_role` modules, and `front_desk_modules`.
- **Mobile bottom tab bar for floor roles only** (`MobileFloorNav.tsx`): housekeeper / engineer / front_desk get 3–4 thumb-reach tabs; managers keep sidebar + mobile drawer.
- **Per-role dashboard home views** (`components/dashboard/`): Housekeeper, Supervisor, Engineer, ChiefEngineer, FrontDesk + shared `LiveOpsGrid`, `ROIMetricsStrip`, `TrendChartsRow`, `AIRiskAlertsPanel`, `DashboardGreeting`. **No dedicated `GMDashboard` component** — GM appears to compose from shared strips.
- **CommandPalette**, **Breadcrumbs**, **PageHeader**, **StateBlock/EmptyState**, **useToast/Toaster**, **density/theme/accent prefs** (`uiPreferencesStore`).

So the redesign's real opportunity is **shell + IA evolution**, not greenfield.

## Feature Landscape

### Table Stakes (Expected in Any Redesign of Software Like This)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Stable role-gated primary nav (sidebar desktop / bottom-tab floor) | Mature B2B SaaS ties default view to each role's 2–3 daily decisions; nav must not shift under the user | LOW (evolve) | Already present and well-structured. Redesign = visual refresh + grouping tune, NOT rebuild. **Hard dependency: all nav routes MUST stay routed through `getAllowedHrefs`** or nav drifts from API RBAC. |
| Collapsible / icon-rail sidebar (desktop) | Managers on 16 sections need a way to reclaim horizontal space for data-dense tables; expected in modern dashboards | MEDIUM | Net-new — current sidebar is fixed 232px. Persist collapsed state in `uiPreferencesStore`. Collapsed rail must still show role-gated items only. |
| Per-role dashboard "home" landing | 2026 baseline: sales-rep home ≠ admin home. Each persona lands on their decisions | LOW (evolve) | Mostly built. **Gap: no explicit GM home** — GM is the data-densest persona; redesign should give GM a first-class composed landing (ops health + ROI + exceptions), not a borrowed supervisor view. |
| Global search / command palette | Users expect ⌘K to jump anywhere; table stakes once surface area exceeds ~10 sections | LOW (evolve) | Exists. See differentiator for evolving it from nav-only → record search. |
| Breadcrumbs on nested sections | Orientation inside Engineering / Settings sub-trees | LOW (exists) | Keep. Must resolve correctly for the Room Board route (see boundary note). |
| Empty / loading / error states | Floor staff hit spotty hotel wifi; blank screens read as "broken" | LOW (exists) | `StateBlock` already standardizes this. Redesign = ensure every redesigned section uses it. |
| Responsive breakpoint behavior (drawer on mobile for managers, bottom-tab for floor) | Same system serves phone + desktop | LOW (exists) | Already handled via `md:` breakpoints + `MobileFloorNav`. Preserve the floor-vs-manager split. |
| Toast confirmations for in-context actions | "Now" feedback after an action (mark clean, close WO) | LOW (exists) | Keep toasts *rare* — reserve for action confirmations, not passive events. |

### Differentiators (Would Meaningfully Improve Floor/Manager Experience)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Persistent notification inbox in the shell header** | The one clear gap: `notifications.py` API exists and toasts fire, but there's **no persistent, reviewable inbox** for "what happened while I was on the floor" (WO assigned to me, escalation, guest request). Toasts say "now," inbox says "later." | MEDIUM | Net-new shell surface. **RBAC/tenant dependency: must scope to current `hotel_id` + user** (multi-tenant scoping is the thing generic guides miss). Optimistic mark-read/archive. Foundational — lives in the shared Header. |
| **Command palette → record search (not just nav jump)** | Let a supervisor type a room number, WO#, guest name, or SOP title and jump to the record, not just the section. Highest-leverage way to flatten a 16-section IA | MEDIUM–HIGH | Evolve existing CommandPalette. **Must filter results through `getAllowedHrefs`/role** so a housekeeper can't palette-jump to Billing. Can ship incrementally (add one record type per section). |
| **Manager global filters (property + date-range) in the chrome** | GM/chief manage across time and (occasionally) properties. Hotel switcher exists; a persistent **date-range control** for reporting-heavy sections (Reports, Management ROI, Logbook) removes per-page re-selection | MEDIUM | Scope carefully — a *global* date filter is only coherent on data-dense manager sections; floor sections should ignore it. Consider section-scoped rather than truly global to avoid the anti-feature below. |
| **Density-aware layouts wired to the existing `uiPreferencesStore`** | Same system, two body types: floor = few large tap targets; manager = dense tables. `density` (comfortable/balanced/dense) already exists but redesign should make section layouts genuinely respond to it | MEDIUM | Differentiator only if sections actually honor density. Low risk since store is built. |
| **Floor "one primary action" home** | Housekeeper/engineer home should surface the single next task (next room, next WO) above the fold — progressive disclosure, minimum info to act | LOW–MEDIUM | Extends existing per-role dashboards; aligns with the project filter "save floor staff time, don't add phone complexity." |
| **Contextual sub-nav in content area, not sidebar** | 2026 guidance: contextual options in the sidebar make users lose their place. Housekeeping/Engineering/Settings sub-tabs should live as in-content tabs, keeping the primary sidebar stable | MEDIUM | Current design puts Engineering/Housekeeping subnav *inside* the sidebar (expands under active item). Moving sub-nav into the content area is a defensible redesign choice — **but note the Room Board is reached via the Housekeeping sub-nav "Room Board" tab; see boundary.** |

### Anti-Features (Sound Good, Don't Earn Their Keep Given the Floor-First Filter)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Fully customizable / drag-drop dashboard widgets | "Let each user build their own home" | Huge build + per-user state + support burden; floor staff will never touch it; violates "don't add complexity to their phone" | Ship strong role-default homes; let personalization be density/theme only (already exists). |
| Truly global app-wide date/property filter applied to every section | Feels "powerful" and consistent | Meaningless on floor sections (a housekeeper's "today" is now); creates confusing state bleed between ops and reporting screens | Section-scoped filters on manager/reporting screens only. |
| Multi-level mega-menu / deeply nested sidebar tree | "We have 16 sections + sub-pages, need hierarchy" | Deep nav trees bury actions; field-service evidence shows moving top items to a flat bottom-tab lifted engagement ~38% vs buried hamburger | Keep the flat 3-group sidebar + flat floor bottom-tab; use command palette + record search for the long tail. |
| Notification badges/toasts on passive/background events | "Keep users informed" | Alert fatigue; toasts lose meaning if frequent; floor staff mid-task get interrupted | Route passive events to the persistent inbox (badge count only); reserve toasts for the user's own actions and true escalations. |
| Replacing the floor bottom-tab bar with a hamburger to "unify" mobile nav | "One nav pattern everywhere is cleaner" | Hamburger hides primary actions; measurably worse for high-frequency task apps; floor staff are one-handed and mid-task | Keep the role-split: bottom-tab for floor roles, drawer for managers on mobile. |
| Onboarding tours / coach-marks layered over the redesigned nav | "New IA needs explaining" | Interrupts the exact people (floor staff) who need zero friction; ages badly | If nav is well-designed it shouldn't need a tour; rely on clear labels + empty-state guidance. |

## Room Board Chrome-vs-Board Boundary (Explicit — Quality Gate)

The Housekeeping **Room Status Board** and Engineering **Room/Work-Order Board** are OUT OF SCOPE and must stay visually + functionally identical. The boundary is subtle because they render *inside* the shared shell:

**In scope (redesign may touch — the chrome around the board):**
- `DashboardShell.tsx` wrapper (the `<main>` padding, header, mobile-nav) — the board renders inside this `<main>`, so shell padding/spacing changes **will** reposition the board on the page. Allowed, but must not alter the board component's own internal grid/kanban layout.
- Sidebar/nav **entry points** to the board: the Housekeeping section item, its `getHousekeepingSubNavItems` "Room Board" tab, and the Engineering work-orders board link — labels, icons, grouping, active-state highlighting are all fair game.
- `Header`, `Breadcrumbs`, `PageHeader` chrome that appears above the board.
- `MobileFloorNav` tabs that link into the board.

**Out of scope (must NOT touch):**
- The board components themselves (the real-time room-grid / kanban surfaces) — their internal visual design, columns, cards, drag interactions, and Realtime subscription behavior.

**Concrete risks to flag for the roadmapper:**
1. If sub-nav moves from sidebar → in-content tabs (a differentiator above), the "Room Board" tab is one of those tabs — moving it changes how the board page is *reached* without touching the board. Acceptable, but the board page's tab strip must still render the board untouched below it.
2. Active-nav highlighting: `pathname.startsWith('/housekeeping')` currently lights up both the Housekeeping item and the Room Board sub-tab. Any nav-highlight refactor must preserve correct highlighting on `/housekeeping` (the board route) or the board *appears* orphaned even though it's unchanged.
3. Any change to `uiPreferencesStore` density classes on the shell root cascades into the board's container — verify the board is visually unchanged at all three density settings.

## Feature Dependencies

```
Nav shell redesign (Sidebar + Header + MobileFloorNav + DashboardShell)
    └──requires──> getAllowedHrefs / getAllowedNavItems (RBAC single source of truth) stays authoritative
                       └──requires──> API role model (core roles, custom_role_modules, front_desk_modules)

Notification inbox ──lives-in──> shell Header (foundational chrome)
    └──requires──> tenant/role scoping (hotel_id + user) on notifications API

Command palette record-search ──requires──> getAllowedHrefs (result filtering by role)

Global/section date filter ──enhances──> manager/reporting sections only
    └──conflicts──> floor "now"-oriented sections (don't apply there)

Per-section redesigns ──independent-of──> each other (can parallelize AFTER shell lands)
Contextual sub-nav move ──touches──> Room Board entry point (boundary care required)
```

### Dependency Notes
- **Everything routes through `getAllowedHrefs`:** the strongest constraint. The frontend nav does not re-implement RBAC — it reads one function fed by role + custom-role modules + front-desk modules. Every new nav surface (collapsed rail, notification links, palette results) must read the same function or it silently exposes routes a role can't access.
- **Shell is foundational, sections are leaves:** the shell (nav + header + mobile nav + density root) wraps all 16 sections and the Room Board. It must land first and stabilize; section redesigns are independent leaves that can be parallelized behind it.
- **Notification inbox is net-new but constrained:** API exists; the work is a reviewable header surface with correct multi-tenant scoping and optimistic read/archive.

## Sequencing Guidance for Roadmapper

### Foundational (must land first — shared chrome, everything renders inside it)
- [ ] **Nav shell redesign** — Sidebar (+ collapsible rail), Header, MobileFloorNav, DashboardShell visual pass. Keep `getAllowedHrefs` authoritative. **Highest Room-Board-boundary risk lives here.**
- [ ] **Notification inbox in Header** — net-new, tenant/role-scoped.
- [ ] **Command palette evolution** — nav-jump → record search, role-filtered.
- [ ] **Density/theme contract** — confirm `uiPreferencesStore` classes behave across redesigned sections AND leave the Room Board visually unchanged.

### Section-by-section (independent — parallelizable once shell is stable)
- [ ] Each of the 16 sections' internal layouts, redesigned to honor density + PageHeader/StateBlock/Breadcrumb contracts.
- [ ] Per-role dashboard homes — **prioritize a first-class GM home** (the current gap), then refine floor "one primary action" homes.

### Defer / avoid
- [ ] Widget customization, global-everything filters, onboarding tours, nav-pattern "unification" — see Anti-Features.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Nav shell redesign (role-gated, collapsible) | HIGH | MEDIUM | P1 |
| Notification inbox in header | HIGH | MEDIUM | P1 |
| Dedicated GM dashboard home | HIGH | LOW–MEDIUM | P1 |
| Command palette → record search | HIGH | MEDIUM–HIGH | P2 |
| Density-aware section layouts | MEDIUM | MEDIUM | P2 |
| Floor "one primary action" home | HIGH | LOW–MEDIUM | P2 |
| Contextual sub-nav → content area | MEDIUM | MEDIUM | P2 (boundary care) |
| Section-scoped manager date filters | MEDIUM | MEDIUM | P3 |
| Widget customization / global filters / tours | LOW | HIGH | P3 (avoid) |

## Sources

- Internal codebase (HIGH): `apps/web/components/shared/{DashboardShell,Sidebar,Header,MobileFloorNav,CommandPalette,Breadcrumbs}.tsx`, `apps/web/lib/utils/{navigation,housekeepingNavigation}.ts`, `apps/web/components/dashboard/*`, `apps/web/stores/uiPreferencesStore`.
- [Role-Based Design for B2B SaaS Dashboards — The Higher Pitch](https://thehigherpitch.com/blogs/insights-role-based-design-b2b-dashboards/)
- [B2B SaaS Design Trends and Examples for 2026 — ProCreator](https://procreator.design/blog/b2b-saas-design-trends-and-examples/)
- [SaaS Navigation Design: 6 Patterns to Prevent Confusion — DesignPixil](https://designpixil.com/blog/saas-navigation-design-patterns)
- [In-App Notification Center for SaaS — SuprSend](https://www.suprsend.com/post/in-app-notification-center)
- [SaaS Notification UX: Real Examples & Patterns (2026) — SaaSUI](https://www.saasui.design/blog/saas-notification-toast-ux-patterns)
- [Hamburger Menu vs Tab Bar — Onething Design](https://www.onething.design/post/hamburger-menu-vs-tab-bar)
- [Bottom Navigation Pattern On Mobile Web — Smashing Magazine](https://www.smashingmagazine.com/2019/08/bottom-navigation-pattern-mobile-web-pages/)

---
*Feature research for: web UI/UX redesign IA — 16-section, 6-role hotel-ops B2B SaaS*
*Researched: 2026-08-13*

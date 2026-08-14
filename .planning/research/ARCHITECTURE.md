# Architecture Research

**Domain:** UI/UX redesign integration for an existing Next.js App Router SaaS (PatelRep v2.0 "Web UI/UX Redesign")
**Researched:** 2026-08-13
**Confidence:** HIGH (all integration points read from source, not assumed)

## Executive Answer

This is a **presentation + IA-layer redesign with zero implied backend/API change.** The existing app is well-structured for it: 16 dashboard sections are already independent routes under a single `(dashboard)` route group, all fed by one shell (`DashboardShell` → `Sidebar` + `Header`), and all styled through **one semantic design-token layer** (`app/globals.css` `:root` custom properties, aliased into Tailwind via `tailwind.config.ts`).

That single token layer is also the **primary danger surface.** The two board components in the hard-exclusion set (`RoomStatusBoard.tsx`, `EngineeringRoomBoard.tsx`) and their shared child `RoomCard.tsx` consume the semantic tokens *directly and pervasively* (`bg-surface`, `text-ink`, `border-line`, `--ai`, `--alert`, `--r-lg`, etc.). **Redefining the value of any existing token silently re-skins all three excluded components** — violating the "rendered output must not change" constraint. The safe strategy is therefore an **additive token/variant system**: never mutate existing token *values* or existing shared-primitive APIs; introduce new tokens and new component variants alongside, and migrate route-by-route.

One correction to the brief: **there is no `middleware.ts` in the web app** (`apps/web/**/middleware.ts` resolves only inside `node_modules`). Route guarding is done **client-side in `components/shared/Providers.tsx`** (`router.replace('/login')` / `router.replace('/onboarding')`). This *simplifies* the redesign — route-group restructuring will not collide with an edge middleware — but means RBAC nav visibility lives entirely in `lib/utils/navigation.ts` (client config), which is the file to guard when routes change.

## Standard Architecture (as-built, in scope)

```
┌──────────────────────────────────────────────────────────────────────┐
│  app/(dashboard)/layout.tsx  →  DashboardShell  (SHELL / NAV / IA)    │
│  ┌────────────┐  ┌────────────────────────────────────────────────┐  │
│  │  Sidebar   │  │  Header                                         │  │
│  │ (nav, RBAC)│  ├────────────────────────────────────────────────┤  │
│  │            │  │  <main> → PageTransition → {route page}         │  │
│  │            │  │     ┌──────────────────────────────────────┐    │  │
│  │            │  │     │  PageHeader (title/tabs/actions)      │    │  │
│  │            │  │     │  ...section content...                │    │  │
│  │            │  │     └──────────────────────────────────────┘    │  │
│  └────────────┘  └────────────────────────────────────────────────┘  │
│  Overlays mounted once by shell: AICopilotBubble, CommandPalette,     │
│  MobileFloorNav, TweaksPanel, FeedbackButton, Toaster                 │
├──────────────────────────────────────────────────────────────────────┤
│  SHARED PRIMITIVE LAYER  components/ui/*  +  components/shared/*       │
│  Button/IconButton · primitives(StatusDot,Pill,Stat,Bar…) · Card ·    │
│  Badge · Input · EmptyState · StateBlock · Skeleton · Toast           │
├──────────────────────────────────────────────────────────────────────┤
│  DESIGN-TOKEN LAYER  app/globals.css :root  ⇄  tailwind.config.ts     │
│  --paper --surface --ink --line --accent --ai --alert --r-lg …        │
│  (+ .theme-dark, .accent-*, .density-* variants)                      │
├──────────────────────────────────────────────────────────────────────┤
│  CLIENT STATE  Zustand: auth · hotel · housekeeping · engineering ·   │
│                uiPreferences        SERVER DATA  TanStack React Query  │
│  ROUTE GUARD  components/shared/Providers.tsx (client redirect)       │
└──────────────────────────────────────────────────────────────────────┘
```

## The Hard-Exclusion Dependency Trace (read from source)

These are the exact imports of the three untouchable files. **Everything listed under "shared" is now a handle-with-extreme-care surface** — a change flowing into it changes the excluded output.

### `components/housekeeping/RoomStatusBoard.tsx`
| Imports (shared/reusable) | Kind |
|---|---|
| `Button, IconButton` from `components/ui/Button` | shared primitive |
| `StatusDot` from `components/ui/primitives` | shared primitive |
| `RoomCard` from `components/housekeeping/RoomCard` | shared child component |
| `RoomDetailDrawer` (also excluded) | excluded child |
| Zustand `useHousekeepingStore`, `useAuthStore` | client state |
| Semantic token classes used inline | `bg-surface` `bg-surface-2` `bg-surface-3` `text-ink` `text-ink2` `text-ink3` `bg-ink` `text-paper` `border-line` `border-line-2` `--ai` `--ai-soft` `--ai-line` `--alert` `--alert-soft` `--alert-line` `--r-lg` `--r-md` |

### `components/engineering/EngineeringRoomBoard.tsx`
| Imports (shared/reusable) | Kind |
|---|---|
| `StatusDot` from `components/ui/primitives` | shared primitive |
| `Button` from `components/ui/Button` | shared primitive |
| `RoomCard`, `RoomDetailDrawer` | shared/excluded children |
| `normalizeHousekeepingBoardRoom` (lib util) | pure util |
| Semantic token classes used inline | `bg-surface` `bg-ink` `text-paper` `border-line` `border-line-2` `text-ink2` `text-ink3` `--ai*` `--alert` |

### `components/housekeeping/RoomDetailDrawer.tsx`
| Imports (shared/reusable) | Kind |
|---|---|
| `Button` from `components/ui/Button` | shared primitive |
| `LogFoundItemModal` from `components/shared/LogFoundItemModal` | shared component |
| `useRole`, `useModalFocusTrap` (hooks), `useAuthStore` | hooks/state |
| **Styling note** | Uses **hard-coded Tailwind palette** (`stone-*`, `rose-*`, `violet-*`, `teal-*`, `amber-*`, `blue-*`, `orange-*`) almost everywhere — **largely insulated from token redefinition.** Its only token-layer exposure is via `Button`. |

### Transitive: `components/housekeeping/RoomCard.tsx` (child of BOTH boards)
Imports `Pill` from `primitives` and `Button`; consumes semantic tokens heavily (`--alert` `--progress` `--info` `--ready` `--caution` `--blocked` `--ai` `--line` `bg-surface` `text-ink*` `--r-lg`). **RoomCard is effectively part of the exclusion boundary** even though it wasn't named — both boards render it, so its visual output is protected too.

### The complete "must-not-alter-output" shared set
`Button` · `IconButton` · `StatusDot` · `Pill` · `RoomCard` · `LogFoundItemModal` · **and the values of every CSS token those consume**. Hooks (`useRole`, `useModalFocusTrap`) and utils (`normalizeHousekeepingBoardRoom`, `cleanType`, `roomStatus`) are logic-only — safe to leave alone; not a visual surface.

## Recommended Integration Strategy: Additive Tokens + Parallel Variants

**Chosen strategy (one, concrete):** *Freeze the existing token values and shared-primitive APIs as an invariant contract; build the new visual system additively; migrate per-route.*

Rules:
1. **Never change the *value* of an existing token** in `globals.css` `:root` (`--surface`, `--ink`, `--line`, `--accent`, `--ai`, `--alert`, `--r-lg`, …) or its Tailwind alias in `tailwind.config.ts`. Add *new* tokens (e.g. `--surface-elevated`, `--radius-2xl`, a new type scale) for the redesign. Existing tokens keep their current hex → excluded components render byte-identical.
2. **Never change existing shared-primitive variant behavior.** `Button`'s `primary|dark|outline|secondary|ghost|destructive|ai` variants and `Pill`/`StatusDot` tones are consumed by the boards. To restyle buttons in the redesign, **add a new variant** (e.g. `variant="v2"`) or a new `ButtonV2` — do not repaint the existing variants.
3. **Redesign at the composition level, not the primitive level.** New pages/sections use new layout components + new tokens + (optionally) new variants. The old primitives keep working underneath.
4. **Verify the invariant, don't trust it.** After any shell/token/primitive change, load `/housekeeping` (GM/supervisor), `/engineering/work-orders`'s room board, and the room-detail drawer, and confirm no visual/behavior diff. This is the required non-regression gate for every phase that touches shared code.

Why this over alternatives:
- *"Just edit the tokens for a fresh look"* — **rejected.** The boards read tokens directly; this is exactly what the exclusion forbids.
- *"Fork RoomStatusBoard/RoomCard into v2 copies"* — unnecessary and risky; these are two of three Realtime surfaces (subscription + optimistic-merge logic in `RoomStatusBoard.tsx` lines 366-450). Duplicating that logic invites drift. Keep them as-is behind frozen primitives.
- *Additive layer* — lowest blast radius, lets 15 of 16 sections modernize freely while the board pages stay pixel-stable.

## Nav / IA / Route-Group Restructuring

**No route-group restructuring is required, and none is recommended.** The 16 sections are already discrete routes under `app/(dashboard)/`. The nav/IA redesign is almost entirely **shell work**:

| Redesign target | File | Notes |
|---|---|---|
| Nav grouping, active state, hotel switcher, identity | `components/shared/Sidebar.tsx` | Reads RBAC via `getAllowedNavItems` — keep that call intact |
| Top bar, search, breadcrumbs, mobile menu toggle | `components/shared/Header.tsx` | — |
| Shell composition, density/theme/accent classes, overlay mounts | `components/shared/DashboardShell.tsx` | Applies `theme-dark` / `accent-*` / `density-*` from `uiPreferencesStore` |
| Nav taxonomy (Operations/Intelligence/Organization groups), labels, RBAC | `lib/utils/navigation.ts` | **Single source of truth** — Sidebar, CommandPalette, Breadcrumbs all read it |
| Per-page title/tabs/actions | `components/shared/PageHeader.tsx` | Used by most sections; changing it touches many pages (verify each) |

**Interaction with route guards:** Because guarding is client-side in `Providers.tsx` (not edge middleware), adding/renaming/reorganizing routes needs **no middleware change**. Two things must stay in sync if routes change:
- `lib/utils/navigation.ts` (`ALL_NAV_ITEMS`, `NAV_BY_ROLE`, `OPERATIONS_HREFS`/`INTELLIGENCE_HREFS`/`PEOPLE_HREFS`, `NAV_LABEL_KEYS`) — controls both visibility and RBAC.
- `Providers.tsx` `isPublicRoute()` allowlist — controls which paths escape the login redirect.

If the redesign introduces new nav *groupings* only (no new URLs), `navigation.ts` is the only file to edit and RBAC is unaffected.

## Suggested Incremental Build Order (maps to roadmap phases)

Ordering is driven by the hard constraint: **do the token/primitive foundation first and prove the boards are unaffected before touching any section.**

**Phase A — Additive foundation (shared, highest care).**
Add new design tokens to `globals.css` (new names only) + Tailwind aliases; add new shared component variants (`Button` v2 etc.) *without altering existing ones*. Establish the non-regression harness: a screenshot/behavior check of the 3 excluded surfaces. **Gate:** boards render identically. Nothing else proceeds until this passes.

**Phase B — Shell & navigation.**
Redesign `DashboardShell`, `Sidebar`, `Header`, `PageHeader`, `Breadcrumbs`, `CommandPalette` using the Phase-A tokens/variants. Highest-leverage visual change; touches every route via the shell. **Gate:** re-verify the 3 excluded surfaces (shell wraps them) + RBAC nav visibility per role.

**Phase C — Independent low-risk sections (parallelizable, no excluded components).**
Any section that does *not* render `RoomStatusBoard`/`EngineeringRoomBoard`/`RoomDetailDrawer`/`RoomCard`: `tasks`, `sop`, `logbook`, `reports`, `management-roi`, `guest-requests`, `lost-found`, `safety`, `evidence`, `programs`, `scheduling`, `staff`, `settings/*`, `ai`, `dashboard` (role views). These can be split across multiple phases/agents freely — each is a self-contained route.

**Phase D — Engineering section (contains an excluded board).**
`/engineering/*` — redesign the section chrome (`PageHeader`, tabs, `work-orders`/`assets`/`pm-schedules`/`predictions` pages) but **leave `EngineeringRoomBoard` untouched** and confirm it still renders identically inside the new chrome.

**Phase E — Housekeeping section (the mixed page, most care) — do LAST.**
`app/(dashboard)/housekeeping/page.tsx` mixes redesignable chrome (`PageHeader`, `SyncBadge`, `HousekeeperBar`, date/shift controls, the housekeeper "my rooms" list) **with the excluded `RoomStatusBoard` and `RoomDetailDrawer`** rendered inside `SupervisorHousekeepingPage`. Redesign only the surrounding chrome; the `<Suspense><RoomStatusBoard/></Suspense>` block and the drawer must be left as-is. Sequencing it last means the token/variant system is fully proven before touching the page with the tightest constraint. **Gate:** GM/supervisor board view, housekeeper my-rooms view, and the drawer all unchanged in behavior; Realtime still live (watch the sync badge).

## Data Flow — No Backend/API Change Implied

**Confirmed: this milestone requires zero `apps/api` change.** Verification:
- All redesign targets are React components, CSS tokens, and layout — presentation only.
- Server data continues to flow through the existing React Query hooks (`housekeepingApi.getBoard`, `staffApi.list`, etc.); the redesign does not alter query keys, endpoints, or payloads.
- The three Realtime surfaces keep their existing Supabase subscription + optimistic-merge logic verbatim (it lives inside the excluded/frozen components and the housekeeping page's `HousekeeperMyRoomsView`).
- RBAC/nav is client config (`navigation.ts`) + client guard (`Providers.tsx`), not an API contract.

**Flag:** the *only* way this redesign would leak into the backend is if someone "improves" the boards' data shape or adds a new data-backed nav feature (e.g., unread badges from a new endpoint). That is out of scope — keep it out. If a proposed nav enhancement needs new server data, stop and re-scope: `apps/api` is excluded this milestone.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Re-theming by editing existing token values
**What people do:** "New look = change `--surface`/`--ink`/`--accent` in `globals.css`."
**Why it's wrong:** Those tokens are read directly by `RoomStatusBoard`, `EngineeringRoomBoard`, and `RoomCard`; changing values re-skins the excluded surfaces, breaking the hard exclusion.
**Do this instead:** Add new tokens; apply them only in redesigned components.

### Anti-Pattern 2: Repainting shared `Button`/`Pill`/`StatusDot` variants in place
**What people do:** Edit `VARIANTS.primary` or a `Pill` tone to match the new design.
**Why it's wrong:** Every excluded component and the whole app consume those variants; in-place edits are global and hit the boards.
**Do this instead:** Add a new variant/tone (or a v2 primitive) and adopt it only in new UI.

### Anti-Pattern 3: Forking the board components to "modernize" them
**What people do:** Copy `RoomStatusBoard`/`RoomCard` into redesigned versions.
**Why it's wrong:** They carry Realtime subscription + optimistic cache-merge logic; duplication causes silent data-staleness drift on a live production surface.
**Do this instead:** Leave them frozen behind stable primitives; redesign only their surrounding page chrome.

### Anti-Pattern 4: Assuming an edge `middleware.ts` guards routes
**What people do:** Plan route/route-group changes around Next.js middleware.
**Why it's wrong:** No `middleware.ts` exists in the app; guarding is client-side in `Providers.tsx`. Planning around a non-existent file wastes a phase.
**Do this instead:** Treat `navigation.ts` (RBAC/visibility) and `Providers.tsx` `isPublicRoute()` (public allowlist) as the guard surfaces.

## Integration Points

### Internal Boundaries
| Boundary | Communication | Notes |
|---|---|---|
| Shell ↔ sections | `layout.tsx` → `DashboardShell` → `{children}` | Redesign the shell once; every section inherits it |
| Sidebar/CommandPalette/Breadcrumbs ↔ RBAC | `lib/utils/navigation.ts` `getAllowedNavItems`/`getAllowedHrefs` | Single source of truth; keep intact when adding routes |
| Components ↔ theme | CSS custom properties in `globals.css` ⇄ `tailwind.config.ts` aliases | The frozen contract protecting the excluded surfaces |
| Excluded boards ↔ server | React Query hooks + Supabase Realtime channels | Do not touch; presentation redesign only |
| Shell ↔ user prefs | `uiPreferencesStore` (`density`/`theme`/`accent` classes on shell root) | Existing dark-mode + accent-swap system already token-based; extend additively |

### External Services
| Service | Integration Pattern | Notes |
|---|---|---|
| Supabase Realtime | `postgres_changes` channels inside the 3 excluded surfaces + HK my-rooms | Out of scope; must remain live after redesign |
| FastAPI (`apps/api`) | React Query clients in `lib/api/*` | **No change this milestone** |

## Confidence Assessment

| Area | Confidence | Reason |
|---|---|---|
| Excluded-component dependency trace | HIGH | Read all 3 files + `RoomCard` + every shared import directly |
| Token layer as danger surface | HIGH | Read `globals.css` + `tailwind.config.ts`; confirmed boards use aliases/vars inline |
| No middleware / client-side guard | HIGH | `middleware.ts` absent from app source (Glob); redirects found in `Providers.tsx` |
| No API change implied | HIGH | All targets are presentation; data hooks unchanged |
| Build-order safety | MEDIUM-HIGH | Order is sound; exact phase count is the roadmapper's call |

## Sources

- `apps/web/components/housekeeping/RoomStatusBoard.tsx`, `RoomDetailDrawer.tsx`, `RoomCard.tsx`
- `apps/web/components/engineering/EngineeringRoomBoard.tsx`
- `apps/web/components/ui/Button.tsx`, `components/ui/primitives.tsx`
- `apps/web/components/shared/DashboardShell.tsx`, `Sidebar.tsx`, `PageHeader.tsx`, `Providers.tsx`
- `apps/web/app/(dashboard)/layout.tsx`, `app/(dashboard)/housekeeping/page.tsx`, `app/(dashboard)/engineering/page.tsx`
- `apps/web/app/globals.css`, `tailwind.config.ts`, `lib/utils/navigation.ts`, `lib/hooks/useAuth.ts`

---
*Architecture research for: Next.js App Router UI/UX redesign integration*
*Researched: 2026-08-13*

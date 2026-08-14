# Phase 31: Shell & Navigation Redesign - Research

**Researched:** 2026-08-14
**Domain:** App-shell redesign (Sidebar / Header / Breadcrumbs / CommandPalette / MobileFloorNav) on the Phase-30 token foundation, plus command-palette record search and RBAC re-verification, in a Next.js App Router SaaS.
**Confidence:** HIGH (all findings are direct reads of current code; the two "net-new" build items — collapse + record search — are verified against real endpoints and stores).

## Summary

The shell is small, centralized, and already well-factored. All five shell components live in `apps/web/components/shared/` and are mounted once in `DashboardShell.tsx`. RBAC nav visibility flows through a single pure module (`lib/utils/navigation.ts`) that `Sidebar`, `CommandPalette`, and `Breadcrumbs` all consume identically — so NAV-01 is a "keep reading through this" constraint, not new work. The Phase-30 foundation delivered v2 **tokens** (`--brand*`, `--focus-ring`, `--motion-*`, `--ease-*`, `--z-*`) in `globals.css`; the shell restyle is a token-migration pass, not a rebuild.

Three items are genuinely net-new or gap-closing: (1) sidebar collapse-to-rail (no collapse mechanism exists today), (2) notification inbox "review history" gap + string cleanup (~80% built), (3) command-palette record search (today only filters nav labels). Record search is achievable **with zero backend change for Rooms and SOPs** (their list endpoints already return the full tenant set, so client-side substring filtering is trivial) and **needs one minimal additive query param for Work Orders and Guest Requests** (those endpoints are paginated with no text filter). The 6-role × nav matrix is fully automatable because `navigation.ts` is pure/deterministic.

**Primary recommendation:** Apply Phase-30 v2 tokens to the five shell components via `className` (`bg-[var(--brand)]`, `--z-*`, `--motion-*`), add `sidebarCollapsed` to `uiPreferencesStore` for the rail, close the notification history + i18n gaps in `Header.tsx`, extend `CommandPalette.tsx` with grouped record search (client-side for rooms/SOPs, one additive `q` param for work-orders/guest-requests), and add a Node script that imports `navigation.ts` to emit the 6×N matrix. Do **not** add a `Button` v2 variant (see Correction #1) and do **not** touch any frozen file.

---

<user_constraints>
## User Constraints (from 31-CONTEXT.md)

### Locked Decisions
- **NAV-01 (RBAC source of truth):** `lib/utils/navigation.ts` (`getAllowedHrefs`/`getAllowedNavItems`) is already the single source of truth, consumed identically by `Sidebar.tsx`, `CommandPalette.tsx`, `Breadcrumbs.tsx`. Redesign must keep reading through this — never hardcode a route list in a redesigned component.
- **NAV-02 (collapsible sidebar) is genuinely net-new.** No toggle, no collapsed-state rendering, no persisted preference exists today (only a stale "Logo + collapse button" comment).
- **NAV-03 (notification inbox) is ~80% built.** Bell + unread badge + dropdown + mark-one-read + mark-all-read already exist on real endpoints. Gaps: only fetches `is_read: false` (no history review); hardcoded English literals; needs v2 tokens.
- **NAV-04 (command-palette record search) is net-new.** Today only substring-filters nav labels; no record search.
- **Visual identity is a continuation of Phase 30** ("evolve, not repalette"): consume the v2 brand ramp / focus ring / motion / elevation / z-index scales and the `Button` v2 variant slot; do not introduce a second visual direction.

### Claude's Discretion (decided in CONTEXT.md)
- **NAV-02:** collapse to an icon-only rail (icons + Radix `tooltip` on hover), not overlay/drawer; persist per-user in `uiPreferencesStore` as new `sidebarCollapsed: boolean` mirroring density/theme/accent; desktop-only (`MobileFloorNav` untouched); hotel switcher + labels hide collapsed, icons + active highlight remain; toggle button replaces the stale comment's intent.
- **NAV-03:** keep bell-in-header + dropdown pattern, restyle onto v2 tokens; add a simple unread/all toggle that re-queries with `is_read` unset (server already supports it, client-only change); fix hardcoded strings + add i18n keys in both locales as in-scope cleanup.
- **NAV-04:** stay within "zero `apps/api` change" wherever realistic; research must determine exactly what filtering the existing endpoints support; a **minimal additive query param** (NOT a new endpoint / microservice / index) is an acceptable, documented deviation (v1.6 Phase 26 precedent); every result filtered through the current role's access; results grouped by entity type, each navigating to that record's existing detail view/route.
- **NAV-05/06:** build a 6-role × nav-item matrix as a concrete artifact, captured pre-redesign and re-run identically post-redesign; automatable via a script reading `navigation.ts` directly (pure/deterministic); live per-role browser verification still required per Self-Verification Policy. NAV-06 is qualitative — no nav restructuring beyond NAV-01/02; consistent icon/label/active treatment across sidebar, rail, and bottom-tab; palette doubles as fast-path.
- **Feature flag:** gate all Phase-31 work behind `RedesignGate` with section key `"shell"`.
- **Room-Board regression gate:** `npm run test:e2e:regression` (from `apps/web`) must re-pass as the last step before close.
- Everything else is delegated — use established conventions, document rationale in phase artifacts.

### Deferred Ideas (OUT OF SCOPE)
- Global app-wide date/property filter, multi-level mega-menu, badges/toasts on passive events, hamburger replacing the floor bottom-tab, onboarding tours — all rejected anti-features.
- Role dashboard homes (HOME-01/02) — Phase 32.
- Per-section redesigns beyond the shell chrome — Phases 33–36.
</user_constraints>

---

## CRITICAL CORRECTIONS to upstream assumptions

These three items in the task brief / CONTEXT.md are imprecise against the *current* code. The planner must plan against reality, not the brief.

### Correction #1 — There is NO `Button` `v2` variant. The v2 direction is tokens-only.
The task context states "`Button` has an additive `v2` variant slot (not yet used anywhere)." **False against the current file.** `apps/web/components/ui/Button.tsx` variants are exactly: `primary | dark | outline | secondary | ghost | destructive | ai`. There is no `v2`. Grep for `v2` in `Button.tsx` returns nothing.

The entire v2 identity lives in `globals.css` tokens: `--brand` `--brand-ink` `--brand-soft` `--brand-line` `--focus-ring` (lines 102–107 light, 160–169 dark), plus `--motion-fast/base/slow`, `--ease-standard/emphasized/exit`, and the `--z-*` scale (lines 79–94). **`Button.tsx` is frozen** (sha in `frozen-files.json`). Implication: the shell restyle applies v2 via `className` (`bg-[var(--brand)]`, `text-[var(--brand-ink)]`, `border-[var(--brand-line)]`, `focus-visible:ring-[var(--focus-ring)]`, `duration-[var(--motion-base)]`, `z-[var(--z-header)]`), **not** through a Button variant. Adding a `Button` v2 variant would trip the frozen-file guard and force a hash bump + allowlist entry for a frozen primitive — avoid it. The shell components are not frozen, so restyling them directly is the correct, additive-safe path.

### Correction #2 — The `no-literal-string` CI gate does NOT currently scope `components/shared/**`.
CONTEXT.md says the hardcoded Header strings "violate this repo's `i18next/no-literal-string` CI gate." **Not currently true.** `eslint.config.mjs` scopes the rule to `components/housekeeping/**`, `components/engineering/**`, `components/programs/**`, and specific `app/(dashboard)/{housekeeping,engineering,tasks,programs}/**` routes (with reports/billing/settings carved out). `components/shared/` — where `Header.tsx`, `Sidebar.tsx`, `CommandPalette.tsx`, `MobileFloorNav.tsx`, `Breadcrumbs.tsx` live — is **not in scope**, so today's raw literals are *not* a gate failure. Fixing them is correct hygiene and consistency (and the CONTEXT.md decision to fix them stands), but the planner should frame it accurately: it is *not* unblocking a red gate. **The gate that IS live and WILL bite: `check:i18n-parity`** (EN/ES key-set parity, `scripts/check-i18n-parity.mjs`) — every new key MUST be added to *both* `en.ts` and `es.ts` or CI fails.

### Correction #3 — The "~22 role guards in Sidebar" estimate is wrong; RBAC is centralized and small.
PITFALLS.md's "Sidebar has ~22 role guards" does not match the code. `Sidebar.tsx` contains **no** table of inline role checks. All role→route logic is centralized in `navigation.ts` (`NAV_BY_ROLE` table + `getAllowedHrefs` branching for `customRoleModules` and `front_desk`). `Sidebar.tsx` has only four small role-dependent behaviors: (a) housekeeper relabel `/housekeeping` → "My Rooms" (line 61–62), (b) housekeeping subnav via `getHousekeepingSubNavItems(role)` (line 63–67), (c) `bottomItems = role === 'gm' ? [SETTINGS_NAV_ITEM] : []` (line 72), (d) `ROLE_LABELS` display. The real regression surface is therefore small and enumerable (see Common Pitfalls) — but includes one non-obvious trap (the group-filter drop, Pitfall #2).

---

## Standard Stack

### Core (already installed — reuse)
| Library | Version | Purpose | Why Standard here |
|---------|---------|---------|-------------------|
| `@radix-ui/react-dialog` | installed | Command palette shell | `CommandPalette.tsx` already uses `Dialog.Root/Portal/Overlay/Content` — extend, don't replace. |
| `@tanstack/react-query` | installed | Notification + search data fetching | `Header.tsx` already fetches notifications via `useQuery`; palette search should use the same. |
| `zustand` + `persist` | installed | Per-user prefs persistence | `uiPreferencesStore` (key `patelrep-ui-prefs`) already persists density/theme/accent — add `sidebarCollapsed` here. |
| `lucide-react` | 1.30→1.31 | Icons | Established set (`Bell`, `CheckCheck`, `PanelLeftClose`, etc.). Do not add a second icon set. |
| `motion` (framer-motion) | 13.0.0→13.1.0 | Collapse/rail + panel transitions | Already the animation engine; use `--motion-*`/`--ease-*` tokens for durations. |

### Supporting (additive — add only what this phase needs)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@radix-ui/react-tooltip` | 1.2.16 | Collapsed-rail icon labels on hover/focus | **Required for NAV-02.** Wrap the shell (or sidebar) in one `Tooltip.Provider`; each collapsed nav icon gets a `Tooltip.Root`. Give the tooltip content `z-[var(--z-tooltip)]` (1700) so it clears header (1200) and sidebar. |
| `@radix-ui/react-collapsible` | 1.1.20 | *Optional* — animated group/subnav expand | Only if you want animated subnav disclosure; the current expand/collapse of subnav is state-driven CSS and is fine as-is. Not required for the rail. |

**Do NOT add for this phase:** `@radix-ui/react-navigation-menu` (the IA stays a flat grouped sidebar — no mega-menu, per NAV-06 anti-features), `scroll-area`, `accordion`, `separator`, `avatar` (nice-to-have, not needed for shell chrome), shadcn/ui, Tailwind v4, any second animation/icon/component library (per STACK.md "What NOT to Use").

**Installation (from `apps/web/`):**
```bash
npm install @radix-ui/react-tooltip@1.2.16
# @radix-ui/react-collapsible@1.1.20 only if animated subnav disclosure is pursued
```

---

## Architecture Patterns

### The shell mount point (where the flag goes)
`components/shared/DashboardShell.tsx` mounts `Sidebar`, `Header`, `CommandPalette`, `MobileFloorNav` (and `PageTransition`, copilot, toaster). It applies density/theme/accent classes on the root `div`. This is the single integration point.

**Feature-flag pattern (`RedesignGate`, section `"shell"`):** `RedesignGate` is `{ section, v2, legacy }` and reads `hotel.web_redesign_sections`. Because the shell wraps *every* page, wrapping the whole `DashboardShell` body in one gate would double-mount the app tree — instead, gate at the component level: pass a `redesigned` boolean into each shell component (derived once via `isSectionRedesigned('shell', hotel)` from `lib/utils/redesignFlag.ts`), or render `<RedesignGate section="shell" v2={<Sidebar variant="v2"/>} legacy={<Sidebar/>} />` per component. **Recommended:** compute `const shellV2 = isSectionRedesigned('shell', hotel)` once in `DashboardShell` and thread it as a prop — avoids five separate store reads and keeps the legacy path a pure branch inside each component. This is also the phase's first real end-to-end test of the per-section flag (per CONTEXT.md).

### Pattern 1 — Sidebar collapse to icon rail (NAV-02)
**Store change** (`uiPreferencesStore.ts`, mirrors existing fields exactly):
```typescript
// add to the interface + create():
sidebarCollapsed: false,
setSidebarCollapsed: (sidebarCollapsed: boolean) => set({ sidebarCollapsed }),
toggleSidebarCollapsed: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
```
`zustand/persist` (name `patelrep-ui-prefs`) picks up the new field automatically — no migration needed.

**Rendering:** current sidebar is `w-[232px]` (md) / `w-[240px]` (mobile). Collapsed rail ≈ `w-16` (64px). When `sidebarCollapsed` (desktop only — guard with the existing `md:` breakpoints so mobile drawer behavior is untouched):
- Hide: hotel-switcher text, nav-item `<span>` labels, group heading `<p>` eyebrows, user-identity text block, `tag` badges.
- Keep: the logo mark, each item's `<Icon>`, the active-state left-bar indicator, the gm-only Settings icon, the user avatar circle.
- Wrap each collapsed icon-link in `Tooltip.Root`/`Trigger`(asChild the `<Link>`)/`Content` showing `navLabel(label)`; tooltip `side="right"`, `z-[var(--z-tooltip)]`.
- Collapse toggle button replaces the stale "Logo + collapse button" comment (line 162) — a small `IconButton` with `PanelLeftClose`/`PanelLeft` from lucide, calling `toggleSidebarCollapsed`. Give it `aria-label` + `aria-expanded`, add i18n keys.
- Animate width with `motion` + `--motion-base`/`--ease-standard`; respect the existing `transition-transform duration-300` mobile pattern (don't fight it — the collapse is a desktop width change, the mobile slide is a transform).

**Non-obvious:** the sidebar groups items into Operations/Intelligence/People via the hardcoded `OPERATIONS_HREFS`/`INTELLIGENCE_HREFS`/`PEOPLE_HREFS` lists (lines 74–76 + 99–101 of `navigation.ts`). The collapsed rail must still render all three groups' icons (a divider between groups reads well as a thin rule at rail width). Do not "flatten" the rail in a way that drops the grouping — and see Pitfall #2 about items that belong to no group.

### Pattern 2 — Notification inbox: history toggle + i18n (NAV-03)
`Header.tsx` currently hardcodes the query to unread-only:
```typescript
queryKey: ['notifications-unread'],
queryFn: () => notificationsApi.list({ is_read: false, limit: 20 }),
```
**Server contract (confirmed):** `GET /notifications` in `apps/api/routers/notifications.py` is `is_read: bool = Query(False)`, and the handler only adds `.eq("is_read", False)` **when `is_read` is falsy** (`if not is_read:`). So passing `is_read: true` returns read+unread history (the guard is skipped), already `tenant_id`+`user_id` scoped, ordered `created_at desc`, `limit` capped. **This means "show all history" = call `list({ is_read: true, limit: 20 })` — a pure client change, no backend edit.** (Note the slightly counter-intuitive semantics: the param name is `is_read` but its effect is "include-read"; `false`/absent = unread-only, `true` = all. Document this in the client so a future reader doesn't "fix" it.)

Implementation: add a two-tab toggle (Unread / All) atop the panel; keep two query keys (`['notifications', 'unread']` and `['notifications', 'all']`) or one key parameterized by the toggle. The unread **badge count** must keep reading the unread query only (`is_read:false`) regardless of which tab is shown, so the badge stays a true unread count.

**i18n keys to add (both `en.ts` and `es.ts` — parity gate enforces this):**
| Current hardcoded literal | File:line | Proposed key | EN value |
|---|---|---|---|
| `Notifications` (panel title `<p>`) | Header.tsx:221 | reuse `header.notifications` (already exists = 'Notifications') | — |
| `Mark all read` | Header.tsx:229 | `header.markAllRead` | Mark all read |
| `No new notifications` | Header.tsx:234 | `header.noNotifications` | No notifications |
| (new) Unread tab | — | `header.notificationsUnread` | Unread |
| (new) All tab | — | `header.notificationsAll` | All |

**Also fix the locale-hardcoded timestamp bug (Header.tsx:247):** `new Date(n.created_at).toLocaleTimeString('en-US', …)` is hardcoded to `en-US` — it should use `i18n.language === 'es' ? 'es-US' : 'en-US'` to match the date/shift formatting pattern already used at lines 133–138. This is a real i18n defect the redesign is touching anyway.

### Pattern 3 — Command palette record search (NAV-04) — per-entity approach
`CommandPalette.tsx` today: `getAllowedNavItems(...)` → `.filter(label.includes(query))` → nav-jump. Extend it to *additionally* search records, grouped by entity, only fetching entities the role can reach (gate each entity fetch behind `getAllowedHrefs(...).includes('/housekeeping')` etc., so a housekeeper's palette never queries work orders).

Endpoint reality (all confirmed by direct read):

| Entity | List endpoint | Returns | Text search today? | Recommended approach | Backend change? |
|---|---|---|---|---|---|
| **Rooms** | `GET /rooms` (`rooms.py:112`) | **ALL** `room_status` rows for tenant (≤ ~150; hotels are 50–150 rooms) with `rooms(room_number, floor, building, room_types)` joined | No (`status`/`floor`/`assigned_to`/`risk_level` only) | **Pure client-side** substring filter on `rooms.room_number`. The full set is already returned. | **None** |
| **SOPs** | `GET /sop/documents` (`sop.py:53`) | **ALL** `sop_documents` for tenant (unpaginated) | No | **Pure client-side** substring filter on `title` (+ `category`). Full set already returned. | **None** |
| **Work Orders** | `GET /work_orders` (`work_orders.py:168`) | **Paginated** (`per_page` default 20, max 100), filters `status`/`category`/`priority`/`assigned_to`/`room_id`; joins `rooms(room_number)` | No title/description filter | **One minimal additive query param.** Add optional `q: Optional[str] = Query(None)`; when present, apply `.ilike("title", f"%{q}%")` (Supabase PostgREST supports `ilike`). Client-side-only filtering would only see the first page — insufficient. | **Minimal additive** (acceptable per CONTEXT/v1.6 Phase 26 precedent) |
| **Guest Requests** | `GET /guest_requests` (`guest_requests.py:508`) | **Paginated** (default 20), filters `status`/`room_id`; joins `rooms(room_number)` | No | Same as work orders: add optional `q` → `.ilike("title", …)` (guest_requests has a `title` column, referenced at :29/:108). | **Minimal additive** |

**Why the split:** rooms and SOPs already ship the entire tenant dataset in one call, so filtering client-side is correct and free. Work orders and guest requests are paginated with no text index and could be large, so a client-side filter over one page would silently miss records — the honest fix is a single `ilike` param on each list endpoint. Keep it to `title` (both tables have it); do **not** build FTS, a new index, or a general search endpoint. Reuse the existing `.eq("tenant_id", …)` scoping already in both handlers — role/tenant filtering comes for free.

**Navigation target reality (IMPORTANT — see Open Question #1):** there are **no dynamic `[id]` detail routes** for any of these entities. All are list pages (`/engineering/work-orders`, `/guest-requests`, `/sop`, `/housekeeping`); detail is rendered in in-component drawers/modals via local state, and neither `work-orders/page.tsx` nor `guest-requests/page.tsx` reads a query param to auto-open a record (grep for `useSearchParams` → none). And the room detail drawer lives inside the **frozen** `RoomStatusBoard`/`RoomDetailDrawer`. So a palette result can, without further work, navigate only to the **parent list route**, not to the specific record's open drawer. Deep-linking to a record would require adding a `?focus=<id>` (or similar) convention to the non-frozen list pages — rooms cannot get this (board is frozen), so a room result navigates to `/housekeeping`. Recommend: ship "navigate to list route" as the baseline; treat per-record deep-link as an optional stretch on the non-frozen pages, explicitly out for rooms.

### Pattern 4 — 6-role × nav-item matrix automation (NAV-05/06)
`navigation.ts` is **pure and deterministic** given `{ role, customRoleModules, frontDeskModules }` (confirmed: `getAllowedHrefs` is a total function over the `NAV_BY_ROLE` table + two branches; `getAllowedNavItems` filters `ALL_NAV_ITEMS` by it). A Node ESM script can import it directly and emit the matrix without a browser:
```
scripts/nav-matrix.mjs  (or a vitest test):
  for role of ['gm','housekeeping_supervisor','housekeeper','engineer','chief_engineer','front_desk']:
    items = getAllowedNavItems({ role, customRoleModules: null, frontDeskModules: null })
    row[role] = items.map(i => i.href)
  → print a markdown table (roles × ALL_NAV_ITEMS.href), commit as the pre-redesign baseline,
    re-run post-redesign, diff must be byte-identical.
```
**Caveats the planner must encode:**
- `front_desk` default = `getAllowedHrefs` uses `DEFAULT_FRONT_DESK_MODULES` when `frontDeskModules` is null; a *specific hotel's* `front_desk_modules` (from `hotel.front_desk_modules`) can differ — the static matrix covers the **default** front-desk set. Note this explicitly; it is not a regression if a hotel customized modules.
- `customRoleModules` (custom roles, migrations 028/029) are per-hotel data — not statically enumerable. The matrix covers the **6 base roles**; custom roles are asserted separately via the same function at runtime.
- Two Sidebar-only transforms are NOT captured by `getAllowedNavItems` and should be snapshotted separately if you want full fidelity: housekeeper "My Rooms" relabel, and housekeeping subnav from `getHousekeepingSubNavItems(role)`.
- The matrix asserts the **RBAC allow-set** (the thing that must not drift). Live per-role login is still required by the Self-Verification Policy for the human pass — but the matrix diff itself is the machine guarantee.

**Importability note:** `navigation.ts` imports `lucide-react` icons and a type from `@/stores/authStore`. A plain Node script may choke on the `@/` alias and the icon imports. Cleanest path: write the matrix check as a **vitest test** (the repo's test runner resolves `@/` and JSX/TS) rather than a bare `.mjs`, OR use `tsx` with the tsconfig paths. Recommend vitest — it also runs in CI naturally.

### Pattern 5 — Shell restyle scope (NAV-01, token migration)
Concrete class → token migrations per file (all additive, all in non-frozen files):
- **Header.tsx:** `sticky top-0 z-50` → `z-[var(--z-header)]` (1200). Search focus ring `ring-[var(--accent-soft)]` and copilot `--ai-*` chrome stay (they're semantic, not brand). Apply `--brand*` where a primary brand accent is wanted; apply `--focus-ring` to interactive focus states; durations `duration-150` → `duration-[var(--motion-fast)]`.
- **Sidebar.tsx:** `z-40` → a `--z-*` token below header if it must sit under, or keep as chrome; active-item accent bar `bg-accent` may adopt `--brand`; transitions → `--motion-*`.
- **CommandPalette.tsx:** already uses `z-[80]/[81]` and `--r-xl`; migrate overlay/content z to `--z-modal`/`--z-popover` scale; it already reads `shadow-pop` and tokens.
- **Breadcrumbs.tsx / MobileFloorNav.tsx:** mostly `--ink*`/`--line`/`--accent` semantic tokens already; light touch — align active color and focus ring only. MobileFloorNav is explicitly **not** getting collapse behavior (NAV-02 is desktop-only).

**Frozen-file adjacency check (must stay additive):** none of the five shell files import from or are imported by the frozen set (`ui/Button.tsx`, `ui/primitives.tsx`, `housekeeping/RoomCard.tsx`, `shared/LogFoundItemModal.tsx`, `housekeeping/RoomStatusBoard.tsx`, `housekeeping/RoomDetailDrawer.tsx`, `engineering/EngineeringRoomBoard.tsx`). Confirmed: shell files import `next/link`, `next/navigation`, hooks, stores, `lib/utils`, `navigation.ts`, `react-i18next`, `lucide-react`, `@radix-ui/react-dialog` — **no frozen import edges**. The shell restyle therefore cannot break a frozen file *by import*. The only way it breaks the Room Board is via **token values** (the board reads the same CSS vars), which is exactly what the `check:frozen-files` room-status value-freeze + `test:e2e:regression` catch. Do not change any `--alert/--info/--ready/--progress/--caution/--blocked` value or any `colors.status.*` hex.

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Collapsed-rail hover labels | Custom absolutely-positioned tooltip div | `@radix-ui/react-tooltip` | Focus/keyboard/escape/collision handling + a11y roles for free; STACK.md already cleared it as safe/same-family. |
| Persisting collapse state | `localStorage` calls in the component | `uiPreferencesStore` new field | Density/theme/accent already persist here under `patelrep-ui-prefs`; one store, one hydration path, no SSR-mismatch surprises. |
| Notification "show history" | New backend query / endpoint | Existing `GET /notifications?is_read=true` | The server already returns all rows when `is_read` is truthy; it's a one-line client change. |
| Rooms/SOP palette search | New search endpoint | Client-side filter over existing full-set list calls | Both endpoints already return the entire tenant set (≤150 rooms; all SOP docs). |
| WO/Guest palette search | FTS / new index / new endpoint | One additive `q` → `.ilike("title", …)` param | Minimal, scoped, reuses existing tenant scoping; matches the v1.6 Phase 26 "one minimal fix" precedent. |
| Role×nav matrix | Manual 6-login screenshot diff | Vitest importing `navigation.ts` | The function is pure; a machine diff is exact and re-runnable in CI. Live login stays for the human pass only. |
| Command palette dialog | New modal | Extend existing `@radix-ui/react-dialog` in `CommandPalette.tsx` | Already built, already keyboard/`⌘K`-wired. |

**Key insight:** almost every NAV-03/04 "feature" is a gap-close over existing, correct infrastructure. The only genuinely new *code* is the collapse rail (NAV-02) and the palette's record-search grouping/rendering (NAV-04); the only genuinely new *capability* is two `ilike` query params. Everything else is restyle + rewire.

---

## Common Pitfalls

### Pitfall 1 — Rebuilding RBAC into a redesigned component instead of reading `navigation.ts`
**What goes wrong:** a redesigned Sidebar/CommandPalette inlines its own route list or role check, drifting from the allow-set. **Avoid:** every allowed-route decision must come from `getAllowedHrefs`/`getAllowedNavItems`. The matrix (Pattern 4) is the tripwire. **Warning sign:** any string route literal or `role === …` appearing in a shell component that wasn't there before (except the four known Sidebar transforms in Correction #3).

### Pitfall 2 — The group-filter silently drops nav items (the real regression surface, not "22 guards")
**What goes wrong:** the Sidebar only renders items that fall into `OPERATIONS_HREFS` / `INTELLIGENCE_HREFS` / `PEOPLE_HREFS` (lines 74–76). An allowed item whose href is in **none** of these three lists is computed as visible by RBAC but **never rendered** (only `SETTINGS` is handled by the separate `bottomItems` path). Today all role routes happen to be covered, but the collapsed-rail rewrite must preserve this exact partition — if the rail iterates a different list, an item could appear/disappear per role. **Avoid:** the rail renders from the same `opsItems/intelItems/peopleItems` (+ `bottomItems`) arrays; assert in the matrix test that `union(the three groups) ⊇ getAllowedNavItems(role)` for every role, so an ungrouped-but-allowed item is caught. **Warning sign:** a role's rail shows fewer icons than its expanded sidebar shows rows.

### Pitfall 3 — Adding a new key to only one locale → `check:i18n-parity` fails CI
**What goes wrong:** notification/toggle/collapse strings added to `en.ts` but not `es.ts` (or vice-versa). `scripts/check-i18n-parity.mjs` statically diffs the two key sets and exits 1. **Avoid:** add every new key to both locales in the same change. **Warning sign:** local `npm run check:i18n-parity` red.

### Pitfall 4 — Changing a frozen room-status token value while restyling
**What goes wrong:** a palette/brand refresh retints `--alert`/`--info`/`--ready`/`--progress`/`--caution`/`--blocked` (which double as chrome tokens) or a `colors.status.*` hex → hard, non-allowlistable `check:frozen-files` failure, and the Room Board visibly changes. **Avoid:** introduce any new generic semantic color as a NEW token name (e.g. `--danger-v2`), never retint a room-status var; use `--brand*` for brand accents. **Warning sign:** `check:frozen-files` "ROOM-STATUS VALUE CHANGED" or a `test:e2e:regression` snapshot diff.

### Pitfall 5 — Collapse toggle leaking to mobile / fighting the drawer
**What goes wrong:** applying `sidebarCollapsed` width changes on mobile collides with the existing `-translate-x-full` drawer mechanism. **Avoid:** gate all collapse styling behind `md:` and leave the mobile `mobileOpen` transform path untouched; `MobileFloorNav` is out of scope for collapse entirely. **Warning sign:** mobile sidebar renders as a 64px rail instead of sliding in full-width.

### Pitfall 6 — SSR/hydration flash of the wrong collapse state
**What goes wrong:** `uiPreferencesStore` persists to `localStorage`; on first paint the server renders expanded, then the client hydrates collapsed → layout flash. The existing store already has this shape for theme/density, so follow whatever hydration guard the app already uses (the density/theme classes are applied in `DashboardShell` after mount). **Avoid:** apply the collapsed width the same way density/theme are applied so the behavior is consistent; don't introduce a new hydration path. **Warning sign:** a visible width jump on load.

### Pitfall 7 — Palette querying entities the role can't see
**What goes wrong:** firing all four search fetches unconditionally leaks existence/counts and wastes calls (a housekeeper has no work-orders route). **Avoid:** gate each entity fetch behind `getAllowedHrefs(...)`.includes of its route before querying. **Warning sign:** network tab shows `/work_orders` requests from a housekeeper session.

---

## Code Examples

### Radix Tooltip on a collapsed rail item (Provider once at shell root)
```tsx
// Source: https://www.radix-ui.com/primitives/docs/components/tooltip  (v1.2.16)
import * as Tooltip from '@radix-ui/react-tooltip'

// In DashboardShell (or Sidebar root), wrap once:
<Tooltip.Provider delayDuration={200}>{/* sidebar tree */}</Tooltip.Provider>

// Per collapsed nav item:
<Tooltip.Root>
  <Tooltip.Trigger asChild>
    <Link href={href} aria-label={navLabel(label)}><Icon className="w-4 h-4" /></Link>
  </Tooltip.Trigger>
  <Tooltip.Portal>
    <Tooltip.Content side="right" sideOffset={8}
      className="z-[var(--z-tooltip)] rounded-[var(--r-md)] bg-ink text-paper px-2 py-1 text-[12px] shadow-pop">
      {navLabel(label)}
      <Tooltip.Arrow className="fill-ink" />
    </Tooltip.Content>
  </Tooltip.Portal>
</Tooltip.Root>
```

### Notification history toggle (client-only; server already supports it)
```tsx
// Source: apps/api/routers/notifications.py:8-25 (is_read truthy ⇒ returns all rows)
const [tab, setTab] = useState<'unread' | 'all'>('unread')
const { data } = useQuery({
  queryKey: ['notifications', tab],
  queryFn: () => notificationsApi.list({ is_read: tab === 'all', limit: 20 }),
  refetchInterval: 60_000,
})
// Badge stays unread-only via a separate query keyed ['notifications','unread'].
```

### Minimal additive `q` on the work-orders list (only if pursuing WO/guest search)
```python
# apps/api/routers/work_orders.py — add to list_work_orders signature + each _base()/query:
q: Optional[str] = Query(None),
...
if q:
    query = query.ilike("title", f"%{q}%")   # PostgREST ilike; tenant scope already applied
```

### Matrix assertion (vitest — resolves @/ and TS)
```ts
// Source: apps/web/lib/utils/navigation.ts (pure functions)
import { getAllowedNavItems, ALL_NAV_ITEMS, OPERATIONS_HREFS, INTELLIGENCE_HREFS, PEOPLE_HREFS } from '@/lib/utils/navigation'
const ROLES = ['gm','housekeeping_supervisor','housekeeper','engineer','chief_engineer','front_desk'] as const
for (const role of ROLES) {
  const hrefs = getAllowedNavItems({ role, customRoleModules: null, frontDeskModules: null }).map(i => i.href)
  // regression baseline: compare against committed snapshot
  // group-coverage guard (Pitfall #2):
  const grouped = new Set([...OPERATIONS_HREFS, ...INTELLIGENCE_HREFS, ...PEOPLE_HREFS, '/settings'])
  expect(hrefs.filter(h => !grouped.has(h))).toEqual([])
}
```

---

## State of the Art / What changed

| Old assumption (brief/PITFALLS/CONTEXT) | Current reality | Impact |
|---|---|---|
| `Button` has a `v2` variant slot | No `v2` variant; v2 is tokens-only; `Button` is frozen | Restyle via `className`+tokens, not a Button variant (Correction #1) |
| Header literals violate the `no-literal-string` gate | `components/shared/**` is out of the gate's scope | Fixing is hygiene, not un-blocking a red gate; the live gate is EN/ES **parity** (Correction #2) |
| Sidebar has ~22 role guards | RBAC centralized in `navigation.ts`; Sidebar has 4 small role transforms | Regression surface is small; real trap is the group-filter drop, not guard count (Correction #3) |
| Palette navigates to record detail views | No `[id]` detail routes exist; detail is in-drawer local state | Baseline = navigate to list route; per-record deep-link is a stretch and impossible for frozen rooms (Open Q #1) |

---

## Open Questions

1. **Palette result navigation target.** No entity has a deep-linkable detail route; rooms' drawer is frozen. **Recommendation:** ship "navigate to the parent list route" as the NAV-04 baseline (meets "navigates to that record's existing view" loosely — the record's *screen*). If the planner wants true per-record focus, add a `?focus=<id>` param handled by the non-frozen list pages (`/engineering/work-orders`, `/guest-requests`, `/sop`) and explicitly exclude rooms (→ `/housekeeping`). Flag as a scoping decision for the planner.

2. **Whether to pursue WO/Guest palette search at all in Phase 31, or ship rooms+SOPs first.** Rooms+SOPs are zero-backend and cover the most common "find a room / find an SOP" floor need. WO/Guest need the additive `q` param. **Recommendation:** include the two `ilike` params (small, precedented) so the palette matches its own placeholder ("Search rooms, work orders, guests…"), but the planner may phase WO/Guest as a follow-on task if minimizing `apps/api` touch is prioritized.

3. **`Tooltip.Provider` placement.** One provider at `DashboardShell` root is cleanest, but the shell also renders the command-palette dialog and copilot — verify no z-index/portal conflict between tooltip (`--z-tooltip` 1700) and the palette overlay. Low risk (tooltip is highest in the scale by design), verify during implementation.

---

## Sources

### Primary (HIGH — direct code reads, 2026-08-14)
- `apps/web/lib/utils/navigation.ts` — RBAC source of truth; pure/deterministic; group HREF lists.
- `apps/web/components/shared/{Sidebar,Header,Breadcrumbs,CommandPalette,MobileFloorNav,DashboardShell,RedesignGate}.tsx` — full shell.
- `apps/web/stores/uiPreferencesStore.ts` — persistence shape for the collapse field.
- `apps/web/components/ui/Button.tsx` + `apps/web/frozen-files.json` — proves no `v2` variant; freeze manifest.
- `apps/web/app/globals.css` (lines 79–107, 160–169) — v2 tokens (`--brand*`, `--focus-ring`, `--motion-*`, `--ease-*`, `--z-*`).
- `apps/api/routers/{notifications,rooms,work_orders,guest_requests,sop}.py` — endpoint filter/search capability; `is_read` semantics.
- `apps/web/lib/api/notifications.ts` — client contract.
- `apps/web/eslint.config.mjs` — `no-literal-string` scope (excludes `components/shared/**`).
- `apps/web/scripts/{check-frozen-files,verify-i18n-gate,check-i18n-parity}.mjs`, `apps/web/package.json` — live CI gates + `test:e2e:regression`.
- `apps/web/i18n/locales/en.ts` (header/nav blocks) — existing keys, parity target.
- `apps/web/app/(dashboard)/**` route glob + grep — confirms no `[id]` detail routes, no query-param record-open.

### Secondary (from milestone research, MEDIUM)
- `.planning/research/STACK.md` — cleared additive Radix primitives + versions (`tooltip@1.2.16`, `collapsible@1.1.20`), "what NOT to use," Room-Board contract.
- Radix Tooltip docs (radix-ui.com) — API for the collapsed-rail pattern.

## Metadata

**Confidence breakdown:**
- Shell structure / NAV-01 / restyle scope: HIGH — direct reads, no frozen import edges.
- NAV-02 collapse: HIGH — store + render pattern is a mirror of existing persisted prefs.
- NAV-03 inbox: HIGH — server `is_read` semantics verified in the handler.
- NAV-04 record search: HIGH on endpoint capability (read directly); MEDIUM on navigation-target UX (no detail routes → scoping decision needed).
- NAV-05/06 matrix: HIGH — function is pure; only caveat is custom-role/front-desk-module data-dependence, noted.
- Corrections #1–#3: HIGH — each verified by grep/read against current files.

**Research date:** 2026-08-14
**Valid until:** ~2026-09-14 (stable internal codebase; re-verify if Phase 30 tokens or `navigation.ts` change before planning).

# Project Research Summary

**Project:** PatelRep — v2.0 "Web UI/UX Redesign"
**Domain:** Full visual-identity + navigation/IA + workflow redesign of an existing, mature Next.js App Router B2B ops SaaS (16 sections, 6 roles, floor staff on phones + managers on desktop)
**Researched:** 2026-08-13
**Confidence:** HIGH

## Executive Summary

This milestone is a **presentation- and IA-layer redesign of already-built features with zero implied backend/API change.** All four research tracks independently converged on the same reality: `apps/web` already *is* a design system. It ships a complete CSS-variable token layer (`--paper/--ink/--accent` + full semantic status ramps), light+dark WCAG-AA sets, 4 switchable accent themes, 3 density modes, Radix + CVA + tailwind-merge primitives, and framer-motion micro-interactions. The redesign therefore does **not** need a new component-system dependency (no shadcn install, no Tailwind v4, no second animation/icon/component library) — it needs *net-new additive tokens*, a handful of *same-family Radix primitives* added per-surface, and Next.js built-in routing patterns for the IA work.

**The single most important cross-cutting constraint — flagged by all four researchers — is that the Room-Board exclusion is NOT clean at the file level.** The three "untouchable" surfaces (`RoomStatusBoard`, `RoomDetailDrawer`, `EngineeringRoomBoard`) are built on top of shared primitives that ARE in scope: `Button`/`IconButton`, `ui/primitives` (`StatusDot`/`Pill`), `RoomCard` (which lives in `components/housekeeping/` and looks like fair game but is the shared visual unit of BOTH boards), `LogFoundItemModal`, and the global CSS token layer every surface reads. **Redefining any existing token value or repainting any existing shared-primitive variant silently re-skins the excluded boards without anyone editing an "excluded" file.** This shapes the entire recommended approach: an **additive-only strategy** (never mutate existing token *values* or existing primitive APIs; add new tokens and new variants alongside), with a **foundation/tokens phase first** that owns a frozen-primitive list, pre-redesign baseline screenshots, and a dedicated **Room-Board regression gate** that every subsequent shared-primitive-touching phase re-runs.

The other key risks are all downstream of shipping incrementally across a live, RBAC'd, i18n-gated, dark-mode app: i18n key/parity drift as new copy lands (the CI gate only proves "no raw literal," not EN/ES parity), dark-mode WCAG-AA contrast regressions on new fg/bg pairings, RBAC/role-nav regressions from IA restructuring (must be verified across all 6 roles, not just GM), scope creep from "redesign" into behavior/workflow change, and weeks of jarring half-old/half-new production state. Each is mitigable with per-phase gates plus a rollout strategy (backward-compatible tokens and/or feature flag, sections batched into coherent slices, shell/nav changes late).

## Key Findings

### Recommended Stack

The foundation already is a shadcn-equivalent architecture, so the guiding principle is **extend, don't replace.** Adopting shadcn/ui as a dependency would introduce a competing token vocabulary (`--background/--primary/--muted/--ring` in oklch, where shadcn's `--accent` means "muted hover bg" vs. this repo's primary terracotta action) that collides with the existing hex `--paper/--ink/--accent` system and would put the excluded Room Board at risk — use it as a *recipe reference only*, re-tokenized. Tailwind stays on 3.4.19 (v4 is a breaking CSS-first rewrite touching every file incl. the excluded board and CI gates, for zero visual-identity payoff — defer to its own milestone). See [STACK.md](STACK.md).

**Core technologies:**
- **Keep hand-rolled Radix + CVA + Tailwind primitives** — the system to redesign *on top of*; a swap forks the design system the Room Board depends on
- **CSS custom properties in `globals.css`** (native) — extend the existing `:root`/`.theme-dark`/`.accent-*` blocks with *new* token names; no Style Dictionary/token pipeline warranted for one web app
- **motion (framer-motion) 13.1.0** — already the animation engine; bump patch, optional `motion/react` import rename; do NOT add a second animation library
- **Additive same-family Radix primitives** (navigation-menu, tooltip, popover, scroll-area, collapsible, accordion, separator, avatar) — unstyled, no token coupling, added only on the surface that needs them
- **Next.js App Router built-ins** (route groups, parallel routes `@slot`, intercepting routes, `loading`/`error`/`template`) for IA — no new dependency; do NOT retrofit the excluded Room Board with intercepting routes

### Expected Features

The redesign's real opportunity is **shell + IA evolution, not greenfield** — the app already has a grouped role-gated sidebar, single-source-of-truth RBAC nav (`getAllowedHrefs`/`getAllowedNavItems`), mobile bottom-tab for floor roles, per-role dashboard homes, command palette, breadcrumbs, and density/theme prefs. See [FEATURES.md](FEATURES.md).

**Must have (table stakes — mostly evolve, not rebuild):**
- Stable role-gated primary nav (sidebar desktop / bottom-tab floor) — hard dependency: every route stays routed through `getAllowedHrefs`
- Per-role dashboard "home" landing — mostly built; **gap: no first-class GM home** (the data-densest persona currently borrows a supervisor view)
- Global command palette, breadcrumbs, empty/loading/error states (`StateBlock`), responsive floor-vs-manager split, toast confirmations — all exist; ensure every redesigned section honors them

**Should have (competitive differentiators):**
- **Persistent notification inbox in the shell header** — the one clear gap; `notifications.py` exists but there's no reviewable "what happened while I was on the floor" surface; must scope to `hotel_id` + user
- **Command palette → record search** (room #, WO#, guest, SOP — not just nav jump), role-filtered through `getAllowedHrefs`
- **Collapsible/icon-rail sidebar** (persist state in `uiPreferencesStore`), density-aware section layouts, floor "one primary action" home, contextual sub-nav moved into content area (boundary care: the "Room Board" tab is one of these)

**Defer / avoid (anti-features given the floor-first filter):**
- Drag-drop customizable dashboard widgets, truly global app-wide date/property filter, multi-level mega-menu, badges/toasts on passive events, replacing floor bottom-tab with a hamburger, onboarding tours over the new nav

### Architecture Approach

**Zero `apps/api` change is implied** — all targets are React components, CSS tokens, and layout; server data keeps flowing through existing React Query hooks; RBAC/nav is client config (`navigation.ts`) + client guard (`Providers.tsx`, **not** an edge `middleware.ts` — that file does not exist in the app, which simplifies route-group work). The recommended strategy is **additive tokens + parallel variants: freeze existing token values and shared-primitive APIs as an invariant contract, build the new visual system additively, migrate per-route.** No route-group restructuring is required — the 16 sections are already discrete routes under `(dashboard)/`. See [ARCHITECTURE.md](ARCHITECTURE.md).

**Major components:**
1. **Design-token layer** (`globals.css` `:root` ⇄ `tailwind.config.ts` aliases) — the primary danger surface AND the highest-leverage lever; add new tokens, never mutate existing values
2. **Shared primitive layer** (`Button`/`IconButton`, `primitives` StatusDot/Pill, `RoomCard`, `LogFoundItemModal`, Card/Badge/Input) — the frozen contract; restyle via *new* variants only
3. **Shell / nav / IA** (`DashboardShell`, `Sidebar`, `Header`, `PageHeader`, `Breadcrumbs`, `CommandPalette` + `navigation.ts` RBAC source of truth) — wraps all sections; foundational, must stabilize before section work
4. **16 leaf sections** — independent routes, parallelizable behind a stable shell; split into Engineering (contains an excluded board) and Housekeeping (the mixed page — do LAST)

### Critical Pitfalls

1. **Partial-exclusion breakage via shared primitives** ("the excluded surface breaks and no one edited it") — enforce a frozen-primitive list, capture pre-redesign baseline screenshots (light+dark, ≥2 roles) of all 3 excluded surfaces, prefer additive variants over mutation, and gate every frozen-primitive change behind a Room-Board pixel-diff.
2. **i18n gate regressions** — the CI `no-literal-string` rule proves no raw literals, NOT EN/ES key parity. Add keys to BOTH locales *first* in each section phase; add a locale-parity check to the verify gate; treat IA label renames as a copy task that deletes orphaned keys.
3. **Dark-mode WCAG-AA contrast regressions** — contrast is a fg/bg-*pair* property that inverts under dark mode. Build a contrast matrix as a foundation deliverable, automate a dark-mode axe/contrast check, design dark tokens independently (don't auto-derive), re-run for any new pairing.
4. **RBAC/role-nav regression from IA restructuring** — moving nav items can drop/misattach role conditions. Keep server `require_role` authoritative (nav hiding is never the security boundary); produce a role×nav visibility matrix (6 roles × every item) from the old app, re-verify against the new nav logged in as each of the 6 roles.
5. **Scope creep — "redesign" silently becomes behavior/workflow change** — write a bright-line rule (allowed: layout/style/component-swap/nav-placement/copy/states; NOT: what an action does, what's fetched, payloads, step order). Enforce a "same inputs → same outputs" network-diff per section.
6. **Half-old/half-new production confusion** — a foundation/token change is globally visible the instant it merges while sections land over weeks. Sequence backward-compatible tokens and/or a feature flag, batch sections into coherent slices, land always-visible shell/nav late.

See [PITFALLS.md](PITFALLS.md).

## Implications for Roadmap

The hard constraint drives the order: **do the token/primitive foundation first and prove the boards are unaffected before touching any section.** All four researchers converged on this same phase-1-foundation-with-a-regression-gate shape.

### Phase 1: Additive Foundation & Regression Harness
**Rationale:** Every primitive already reads from `var(--…)`, and the excluded boards read the same tokens + shared primitives. This phase must land — and be proven safe — before anything else, or the exclusion is violated invisibly.
**Delivers:** New design tokens (refreshed palette values as *new* names, motion/elevation/z-index scales) in `globals.css`; new additive shared-primitive variants (e.g. `Button` v2) leaving existing variants untouched; the **frozen-primitive list** (`Button`, `IconButton`, `primitives`, `RoomCard`, `LogFoundItemModal` + board-consumed tokens); pre-redesign **baseline screenshots** of all 3 excluded surfaces (light+dark, ≥2 roles); the **dark-mode contrast matrix + automated check** added to the verify gate; the **EN/ES key-parity check** added to the gate; the **role×nav baseline matrix**; and the **rollout strategy** (backward-compatible tokens vs. feature flag + section batching).
**Addresses:** foundational styling for every downstream feature.
**Avoids:** Pitfalls 1, 3 (and sets up 2, 4, 6). **Exit gate: Room-Board regression check proves the excluded surfaces are pixel-identical.**

### Phase 2: Shell & Navigation Redesign
**Rationale:** The shell wraps all 16 sections and the Room Board; it's the highest-leverage visual change and carries the highest RBAC risk. Isolate it so nav/RBAC risk is reviewable, and (per Pitfall 6) consider landing it behind the flag or late so the always-visible chrome doesn't get "ahead" of the sections.
**Delivers:** Redesigned `DashboardShell`, `Sidebar` (+ collapsible rail persisted in `uiPreferencesStore`), `Header`, `PageHeader`, `Breadcrumbs`, `CommandPalette`, `MobileFloorNav` using Phase-1 tokens/variants; **notification inbox** in the header (tenant/role-scoped); command-palette record-search evolution.
**Uses:** Additive Radix primitives (navigation-menu, tooltip, popover, collapsible) added here as needed; Next.js route-group/parallel-route patterns if role-composed dashboards are pursued.
**Implements:** Shell / nav / IA component; keeps `getAllowedHrefs` authoritative.
**Avoids:** Pitfall 4 (role×nav re-verified across all 6 roles) + re-runs the Room-Board gate (shell wraps the board).

### Phase 3: Independent Low-Risk Sections (batched, parallelizable)
**Rationale:** Any section that does NOT render an excluded board/`RoomCard` is a self-contained route that can modernize freely once the shell is stable. Batch into coherent slices (Pitfall 6) rather than 16 arbitrary one-at-a-time ships.
**Delivers:** Redesigned internal layouts for `tasks`, `sop`, `logbook`, `reports`, `management-roi`, `guest-requests`, `lost-found`, `safety`, `evidence`, `programs`, `scheduling`, `staff`, `settings/*`, `ai`, and the role dashboard homes — **prioritizing a first-class GM home** (the current gap). Each honors density + PageHeader/StateBlock/Breadcrumb contracts and redesigns empty/loading/error, not just the happy path.
**Addresses:** most FEATURES.md section-level and differentiator work.
**Avoids:** Pitfalls 2, 3, 5 per section (keys-in-both-locales-first, new-pairing contrast re-check, same-inputs/same-outputs network diff).

### Phase 4: Engineering Section (contains an excluded board)
**Rationale:** `/engineering/*` mixes redesignable chrome with the untouchable `EngineeringRoomBoard`; sequence after the token/variant system is proven.
**Delivers:** Redesigned section chrome (PageHeader, tabs, work-orders/assets/pm-schedules/predictions pages) with `EngineeringRoomBoard` left as-is and confirmed rendering identically inside the new chrome.
**Avoids:** Pitfall 1 (Room-Board regression re-check).

### Phase 5: Housekeeping Section (the mixed page — do LAST)
**Rationale:** `housekeeping/page.tsx` has the tightest constraint — it renders both `RoomStatusBoard` and `RoomDetailDrawer` (two of three Realtime surfaces) inside redesignable chrome. Doing it last means the token/variant system is fully proven first.
**Delivers:** Redesigned surrounding chrome (PageHeader, SyncBadge, HousekeeperBar, date/shift controls, housekeeper "my rooms" list) only; the `<Suspense><RoomStatusBoard/></Suspense>` block and the drawer left verbatim.
**Avoids:** Pitfall 1. **Gate:** board view, my-rooms view, and drawer unchanged; Realtime still live (watch the sync badge).

### Phase 6: Final QA
**Rationale:** Cross-cutting verification that per-phase gates can't fully cover.
**Delivers:** Full 6-role nav walkthrough vs. the role×nav matrix, full ES walkthrough of all 16 sections, dark-mode axe sweep, cross-section visual-consistency check, and a final pixel-diff of the 3 excluded surfaces vs. the original Phase-1 baseline.

### Phase Ordering Rationale

- **Dependency-driven:** tokens → shared primitives → shell → sections is the strict dependency chain; the token layer is read by everything (incl. the excluded boards), so it must be additive-first and proven before any leaf work.
- **Risk-isolated:** RBAC risk (Phase 2), the two board-adjacent sections (Phases 4-5), and behavior-scope risk (bright-line rule, all section phases) are each isolated so a single class of regression is reviewable in one place.
- **Rollout-aware:** shell/nav lands behind a flag or late, sections ship in coherent batched slices, so daily hotel staff never see a half-broken workflow (Pitfall 6).

### Research Flags

Phases likely needing deeper research during planning (`/gsd:research-phase`):
- **Phase 2 (Shell & Nav):** Next.js `next@16.3.0-preview.10` route-group/parallel/intercepting-route APIs are a preview build; `AGENTS.md` warns APIs differ from training data — verify against `node_modules/next/dist/docs/` before relying on them. The notification-inbox surface (net-new, tenant/role scoping, optimistic read/archive) also warrants a design pass.
- **Phase 1 (Foundation):** the dark-mode contrast matrix + automated tooling choice (axe/Lighthouse CI in dark mode) and the rollout strategy (feature flag vs. backward-compatible tokens) are decisions worth a focused pass.

Phases with standard patterns (can skip research-phase):
- **Phase 3 (independent sections):** self-contained route restyles against an established primitive/token contract — well-understood, repetitive.
- **Phases 4-5 (Engineering/Housekeeping chrome):** same restyle pattern as Phase 3 plus the already-defined Room-Board regression gate; no new research, just discipline.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Installable versions verified via local `npm view` (authoritative for this env); existing token/primitive system read from `package.json`, `tailwind.config.ts`, `globals.css`, `Button.tsx`, `DashboardShell.tsx`. One MEDIUM caveat: Next.js preview-build routing APIs. |
| Features | HIGH (internal) / MEDIUM (external) | Full read of shell/nav/dashboard source; external B2B-SaaS nav/notification pattern guidance is multi-source consensus, not a single authoritative doc. |
| Architecture | HIGH | Every integration point + all 3 excluded files + `RoomCard` + shared imports read from source; confirmed no `middleware.ts` and no API change implied. |
| Pitfalls | HIGH | Grounded in the actual repo — excluded surfaces' imports, the CSS-variable token layer, the i18n eslint rule, and role-gated Sidebar all inspected directly. |

**Overall confidence:** HIGH

### Gaps to Address

- **Next.js preview-build routing APIs:** route groups / parallel / intercepting routes must be confirmed against `node_modules/next/dist/docs/` (not training data) before Phase 2 relies on them. Handle in Phase 2 planning.
- **Rollout mechanism (feature flag vs. backward-compatible tokens):** researchers named both as viable; the roadmapper/Phase 1 must pick one explicitly, since it changes how much old/new mixing production tolerates.
- **GM dashboard composition:** there is no dedicated `GMDashboard` component today (GM composes from shared strips) — the first-class GM home is net-new UI, so budget design time in Phase 3 rather than treating it as a restyle.
- **Contrast tooling choice:** the automated dark-mode contrast/axe check is recommended but the specific tool/CI wiring is unspecified — decide in Phase 1.
- **Exact phase count:** the 6-phase shape is the research-implied ordering; the precise split (e.g., batching of the ~15 independent sections) is the roadmapper's call.

## Sources

### Primary (HIGH confidence)
- Local repository inspection — `apps/web/package.json`, `tailwind.config.ts`, `app/globals.css`, `components/ui/Button.tsx`, `components/ui/primitives.tsx`, `components/shared/{DashboardShell,Sidebar,Header,PageHeader,Providers,MobileFloorNav,CommandPalette,Breadcrumbs}.tsx`, `components/housekeeping/{RoomStatusBoard,RoomDetailDrawer,RoomCard}.tsx`, `components/engineering/EngineeringRoomBoard.tsx`, `lib/utils/navigation.ts`, `eslint.config.mjs`
- Local npm registry via `npm view` (2026-08-13) — authoritative for installable versions (motion 13.1.0, Radix primitives, lucide-react 1.31.0, and the deliberately-avoided shadcn 4.18.0 / tailwind 4.3.3)
- Project policy docs — CLAUDE.md Non-Regression, Self-Verification, Current Scope (web-only), Realtime-scope note (the 3 realtime surfaces)
- https://ui.shadcn.com/docs/theming — verified shadcn token names substantiate the token-collision argument
- https://motion.dev/docs/react-quick-start — verified `framer-motion` now published as `motion` (`motion/react`, same API)

### Secondary (MEDIUM confidence)
- Next.js App Router routing patterns (route groups / parallel / intercepting) — built-in but preview build; verify in `node_modules/next/dist/docs/`
- B2B SaaS nav/notification/mobile-nav pattern guides (The Higher Pitch, ProCreator, DesignPixil, SuprSend, SaaSUI, Onething Design, Smashing Magazine) — multi-source consensus on IA/notification/bottom-tab patterns
- Established design-system/token-migration + WCAG-AA-as-a-fg/bg-pair-property practice — well-understood domain knowledge

---
*Research completed: 2026-08-13*
*Ready for roadmap: yes*

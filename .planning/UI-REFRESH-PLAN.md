---
title: UI Refresh Plan — Phases 0–5 Web Surfaces
status: ready-to-execute
author: Claude (planning session 2026-07-26)
scope: apps/web only (apps/api untouched; apps/mobile out of scope)
nature: presentation-only — NO behavior, data, routing, or API changes
execution: hand to a fresh session; execute wave-by-wave, verify each wave before the next
---

# UI Refresh Plan — Make Phases 0–5 Cleaner and Easier to Use

## 0. How to use this document

You are a fresh execution session. Read this whole file first, then execute the
**Waves** in order (Wave 0 → Wave 6). Each wave is independently shippable and
must pass its **Acceptance** gate before you start the next. This is a **pure
presentation refactor**: you are unifying how the UI is built and how it reads —
you must **not** change API calls, query logic, routing, RBAC, or business rules.

Every decision here is already made. Do not re-open them. If you hit something
genuinely undecided, prefer the option most consistent with the existing
"Warm Operational Hospitality" design system and the principles in §2.

**Hard constraints that override convenience (from project CLAUDE.md / prior phases):**
- **Bilingual floor contract (Phase 4, D-03/D-04):** every user-facing string on floor
  surfaces (`components/housekeeping/**`, `components/engineering/**`,
  `components/programs/**`, `app/(dashboard)/{housekeeping,engineering,tasks,programs}/**`)
  must render through `useTranslation()`/`t()`. The ESLint `i18next/no-literal-string`
  gate fires across those directories — **any raw JSX literal you add there fails
  `npm run lint`.** All new strings get keys in **both** `apps/web/i18n/locales/en.ts`
  and `es.ts` with **key parity** (1307+ leaf keys, 0 orphans — verify parity after every wave).
- **Self-verification (CLAUDE.md):** after each wave, run the dev servers and click the
  affected routes on localhost yourself. Do not declare a wave done on code alone.
- **Non-regression (CLAUDE.md):** every previously-working screen must still work. This
  refactor touches shared components — after changing a shared component, spot-check every
  surface that uses it.
- Keep files **under 500 lines**. Extract when a page grows past that.
- Use the existing `cn()` helper and design tokens. **Never** introduce new raw hex colors —
  use the CSS variables / Tailwind token aliases already defined in `app/globals.css` +
  `tailwind.config.ts`.

**Verification commands (run from `apps/web` unless noted):**
```bash
npm run type-check                 # tsc --noEmit — must be exit 0
npm run lint                       # eslint . (incl. no-literal-string floor gate) — exit 0
node scripts/verify-i18n-gate.mjs  # i18n gate proof fixtures
npm run dev                        # localhost:3000 for manual verification
npx playwright test --config=playwright.phase1.config.ts   # regression
npx playwright test --config=playwright.phase4.config.ts   # floor + EN/ES 390px
# API (only to run the app end-to-end): cd ../api && python -m pytest tests/ -q
```
Log bugs to `.wolf/buglog.json` and update `.wolf/anatomy.md` when you add/rename files,
per the OpenWolf protocol in `.wolf/OPENWOLF.md`.

---

## 1. Current state (grounded baseline)

**What's already good — keep it, build on it, do not replace it:**
- Token system in `app/globals.css`: paper/ink surfaces, semantic families
  (`accent`/`ready`/`caution`/`alert`/`info`/`progress`/`ai`/`blocked`), light+dark
  (`.theme-dark`), density modes (`.density-*`), swappable accent (`.accent-*`).
- Primitives in `components/ui/`: `Button` (7 variants), `Card`, `Badge`, `Skeleton`,
  and `primitives.tsx` (`Pill`, `StatusDot`, `AILabel`, `Mono`, `SectionLabel`, `Bar`, `Stat`).
- Shell: `DashboardShell` (density/theme/accent wiring + `TweaksPanel`), role-aware `Sidebar`
  (Operations / Intelligence / Organization groups), `Header`, `PageHeader`, `PageTransition`.
- Installed and available (no new deps needed): `@radix-ui/react-{dialog,dropdown-menu,select,tabs,toast}`,
  `framer-motion`, `lucide-react`, `clsx`, `tailwind-merge`.
- i18n (EN/ES) via react-i18next across the app.

**Measured problems this plan fixes (baseline numbers — track these down):**

| # | Problem | Baseline | Target |
|---|---------|----------|--------|
| P1 | Pages hand-roll their own `<h1>` header instead of `PageHeader` | 22 pages raw `<h1>`; only **3** use `PageHeader` | All content pages use `PageHeader` (or the sanctioned dashboard greeting variant) |
| P2 | Interactive buttons hand-rolled instead of `Button`/`IconButton` | **330** raw `<button className=…>`; `Button` imported in 45 files | < 25 raw buttons (only inside primitives/very-custom cases) |
| P3 | Toast/feedback reinvented per page (local `useState` + manual render) | ad hoc in ≥5 settings pages; **no** provider (despite `@radix-ui/react-toast` installed) | 1 `useToast()` + `<Toaster>` in shell; 0 per-page toast state |
| P4 | No shared empty / loading / error states | ad hoc "Loading…", "No X…" strings everywhere | `StateBlock` + `EmptyState` used for all three states |
| P5 | Inline card pattern drift | 15 hand-rolled `bg-surface rounded border` vs `Card` in 33 files | Card everywhere; < 5 justified inline exceptions |
| P6 | Navigation friction | Safety & Evidence share `ShieldCheck` icon; GM has 16 nav items; no search; sub-pages lack back/breadcrumb; no mobile floor nav | Distinct icons; ⌘K palette; breadcrumbs on sub-routes; mobile bottom nav for floor roles |
| P7 | Dense manager screens (housekeeping 809 / reports 764 / evidence 504 lines) read as walls | monolithic | progressive disclosure, scannable sections, consistent tables |

---

## 2. North-star principles (decided — apply to every change)

1. **Floor-first.** Optimize every screen for a phone held one-handed mid-shift. The
   primary action is always visible, thumb-reachable, and unmistakable. Managers get
   density on desktop; floor staff get focus on mobile.
2. **One of everything.** One header, one button system, one card, one empty/loading/error,
   one toast. Zero hand-rolled duplicates of a thing a primitive already does.
3. **Calm by default, dense on demand.** Default density stays `balanced`. Heavy manager
   screens use progressive disclosure (collapsible sections, tabs, "show more") instead of
   dumping everything at once.
4. **Color means status, never decoration.** Every status is conveyed by **text + icon +
   color together**, never color alone (accessibility). Reuse the semantic families.
5. **Refine, don't rebrand.** Keep the warm paper/terracotta identity, the display serif,
   the fonts. This plan changes *consistency and clarity*, not the brand.
6. **Motion is feedback, not flourish.** Keep `framer-motion` taps and `PageTransition`;
   respect `prefers-reduced-motion` (already handled globally). No new decorative animation.

---

## 3. Locked design decisions

- **Keep** the existing palette, fonts, tokens, dark mode, density, and accent theming. No new colors/fonts.
- **`PageHeader` is the only page-title pattern.** Convention:
  `eyebrow` = context/section (uppercase), `title` = page name (display serif), `subtitle` =
  one plain-language line on what the page is for, `tabs` = in-page section switch, `actions` =
  primary/secondary page actions (right-aligned). Role dashboards keep their greeting but use a
  sanctioned `DashboardGreeting` component (§5.1) so spacing matches `PageHeader`.
- **`Button` is the only interactive-button pattern**; add `size` (`sm`/`md`/`lg`) and `loading`
  props, and a sibling **`IconButton`** for icon-only actions. Every async action shows a loading
  state; every button has a visible focus ring and ≥44px touch target on coarse pointers.
- **Toast:** build **one** system on `@radix-ui/react-toast`, mount `<Toaster>` in `DashboardShell`,
  expose `useToast()` → `toast.success/error/info(msgKey)`. Delete all per-page toast state.
- **State primitives:** new `StateBlock` (renders loading | empty | error from one prop) and
  `EmptyState` (icon + title + body + optional action). Used for all list/data regions.
- **Command palette (⌘K / Ctrl-K):** build `CommandPalette` on `@radix-ui/react-dialog` + a
  simple case-insensitive filter (no new dependency). It lists the user's **allowed** routes only
  (reuse the exact allow-list logic from `Sidebar`) and jumps to them.
- **Mobile floor navigation:** add a role-aware bottom tab bar (max 5 items) shown only on mobile
  (`md:hidden`) for `housekeeper` / `engineer` / `front_desk`, surfacing their top routes/actions.
  Managers keep the sidebar (via the existing mobile drawer).
- **Distinct nav icons:** Safety = `LifeBuoy` (or `Siren`), Evidence keeps `ShieldCheck`; verify no
  two nav items share an icon. Rename the `/programs` nav label to match its page ("Programs").
- **No behavior changes.** Same routes, same queries, same RBAC, same data. Presentation only.

---

## 4. New / upgraded shared components (build in Wave 0)

All live under `components/ui/` or `components/shared/`. Each must: use tokens, support dark mode
+ density, be keyboard-accessible with visible focus, and take an optional `className`.

| Component | File | Spec |
|-----------|------|------|
| `Button` (upgrade) | `components/ui/Button.tsx` | Add `size?: 'sm'\|'md'\|'lg'` (min-h 32/36/44), `loading?: boolean` (shows `Loader2` spinner, disables, keeps width). Keep 7 variants. Add `focus-visible:ring-2 ring-accent/40 ring-offset-1`. |
| `IconButton` (new) | `components/ui/Button.tsx` (same file) | Square, icon-only, `aria-label` **required** (TS-enforced), same variants/sizes, same focus ring, 44px on coarse pointers. |
| `EmptyState` (new) | `components/ui/EmptyState.tsx` | Props: `icon`, `title`, `body?`, `action?`. Centered, muted, generous padding. |
| `StateBlock` (new) | `components/ui/StateBlock.tsx` | Props: `status: 'loading'\|'empty'\|'error'`, `loadingLabel?`, `empty?: EmptyStateProps`, `error?: {message, onRetry?}`, `children` (rendered when data present). One place decides which of the 3 states shows. Error variant offers a retry button. |
| `Toaster` + `useToast` (new) | `components/ui/Toast.tsx` | Radix toast provider + viewport; `useToast()` returns `{ success, error, info }` taking an already-translated string. Mount `<Toaster/>` in `DashboardShell`. Auto-dismiss 3.5s, swipe/keyboard dismiss, `alert`/`ready`/`info` tones. |
| `CommandPalette` (new) | `components/shared/CommandPalette.tsx` | ⌘K/Ctrl-K + a Header search button open it. Radix Dialog; filter the user's allowed nav routes (import/reuse the allow-list from `Sidebar` — extract that logic to `lib/utils/navigation.ts` so both share it). Enter navigates. Mount in `DashboardShell`. |
| `DashboardGreeting` (new) | `components/dashboard/DashboardGreeting.tsx` | The sanctioned greeting header for role dashboards (date eyebrow + "Good morning, {name}." + hotel line), spacing identical to `PageHeader`. Replaces the inline block in `dashboard/page.tsx` `GMDashboard` and the other role dashboards. |
| `Breadcrumbs` (new) | `components/shared/Breadcrumbs.tsx` | For sub-routes (e.g. Engineering → Work Orders). Derives from pathname + a label map (reuse `NAV_LABEL_KEYS`). Renders in `PageHeader` `eyebrow` slot on sub-pages. |
| `MobileFloorNav` (new) | `components/shared/MobileFloorNav.tsx` | Bottom tab bar, `md:hidden`, role-aware (housekeeper/engineer/front_desk), max 5 items, active state, safe-area padding. Mount in `DashboardShell`. |

Add generic i18n keys (both `en.ts`+`es.ts`) for shared copy: `common.loading`, `common.retry`,
`common.noResults`, `common.error`, `common.search`, `common.searchPlaceholder`,
`common.commandHint`, plus per-surface empty-state strings as you migrate them.

**Wave 0 acceptance:** all components exist, are exported, type-check + lint clean, i18n parity holds,
and a temporary `/dev/ui` scratch page (or Storybook-free manual mount) demonstrates each in light+dark
+ all 3 densities. Remove any scratch page before Wave 6. No existing screen changed yet.

---

## 5. Execution waves

> Sequence matters: Wave 0 builds the tools; Waves 1–3 roll them out app-wide; Wave 4 fixes
> navigation; Wave 5 polishes each surface; Wave 6 is the QA/a11y sweep. Ship and verify each wave.

### Wave 0 — Foundation (build the shared components in §4)
- Build every component in §4. Extract the `Sidebar` allow-list logic to `lib/utils/navigation.ts`.
- **Do not** touch feature screens yet.
- Acceptance: §4 acceptance above.

### Wave 1 — Header unification (fixes P1)
- Migrate all 22 hand-rolled `<h1>` content pages to `PageHeader`. For each, set eyebrow/title/
  subtitle/tabs/actions per the §3 convention. Preserve existing tab logic and counts.
- Convert role dashboards' inline greeting to `DashboardGreeting`.
- **Files:** every `app/(dashboard)/**/page.tsx` currently rendering a raw `<h1>` (see P1 list:
  ai, billing, dashboard, engineering, evidence, logbook, lost-found, management-roi, onboarding,
  reports, safety, scheduling, sop, staff, tasks, plus sub-route pages under engineering/housekeeping/settings).
- Acceptance: `grep -rn "<h1" app/(dashboard) --include=page.tsx` returns **0** outside
  `PageHeader`/`DashboardGreeting`; every page title reads consistently; i18n parity holds;
  type-check + lint clean; manual walk of 6 representative pages in light+dark.

### Wave 2 — Button & interactive unification (fixes P2)
- Replace hand-rolled `<button className=…>` with `Button`/`IconButton` app-wide. **Order:** floor
  surfaces first (`components/housekeeping/**`, `components/engineering/**`, `app/(dashboard)/{housekeeping,engineering,tasks,programs}/**`),
  then guest-facing (guest-requests, lost-found), then managers/settings.
- Wire `loading` on every button tied to a React Query mutation. Add `aria-label` to every `IconButton`.
- Do not change onClick handlers or logic — swap the element/classes only.
- Acceptance: raw `<button` count < 25 (from 330); every mutation button shows a loading state;
  keyboard-tab through 3 floor screens shows visible focus on every control; Playwright phase1+phase4
  green; manual verification.

### Wave 3 — States & feedback (fixes P3, P4)
- Replace ad hoc loading/empty/error regions with `StateBlock`/`EmptyState`.
- Replace every per-page toast `useState` with `useToast()`. Every create/update/delete gives a
  success toast; every failure gives an error toast (translated). Keep optimistic updates where they exist.
- **Files:** settings pages using local toast (general, front-desk, guest-requests, inspections, …),
  plus any list page with bespoke "No X" / "Loading…" text.
- Acceptance: `grep -rn "type: 'success' | 'error'" app` (per-page toast state) returns 0; consistent
  empty states across lists; type-check + lint + i18n parity; manual: trigger a success and an error toast.

### Wave 4 — Navigation & IA (fixes P6)
- Distinct nav icons (Safety ≠ Evidence); rename `/programs` label to "Programs"; verify no duplicate icons.
- Add `CommandPalette` (⌘K + Header search button) and `Breadcrumbs` on sub-routes.
- Add `MobileFloorNav` for floor roles. Confirm the existing mobile sidebar drawer still works for managers.
- Optional tightening: within the sidebar Operations group, keep the most-used 5 for each role at top
  (order by role: housekeeper → rooms/board first; engineer → work-orders first).
- Acceptance: no two nav items share an icon; ⌘K opens, filters allowed routes only, navigates; breadcrumbs
  on all `*/sub` routes; bottom nav appears only ≤ md for floor roles and never for managers; RBAC unchanged
  (a housekeeper never sees a route they couldn't before — reuse the exact allow-list); manual on mobile viewport (390px).

### Wave 5 — Per-surface polish (fixes P5, P7) — see §6 for the per-route checklist
- Apply `Card` everywhere (remove inline card drift). Apply progressive disclosure to the heavy
  manager screens. Standardize table/list rows. Tighten spacing rhythm to the density tokens.
- Acceptance: inline `bg-surface rounded border` < 5; the 3 heaviest pages (housekeeping, reports,
  evidence) use collapsible/tabbed sections; every list uses `StateBlock`; manual walk of all §6 routes.

### Wave 6 — Accessibility, dark mode, density, motion QA
- Contrast audit to WCAG AA on text/status (fix any token pair that fails; adjust the token, not one-offs).
- Keyboard: full tab order + focus-visible on every interactive element; Esc closes every overlay;
  focus trap in modals (there is a `useModalFocusTrap` hook — ensure all modals use it).
- Dark-mode parity pass on all new components and touched screens. Density pass (comfortable/balanced/dense)
  on new components. Confirm `prefers-reduced-motion` still honored.
- Update Playwright a11y snapshots if they assert structure; add a couple of smoke assertions for the
  new palette + toaster if cheap.
- Acceptance: no AA contrast failures on core text/status; keyboard-only can complete the housekeeper
  golden path and the GM guest-request flow; dark mode has no broken/invisible elements; full lint +
  type-check + i18n parity + Playwright phase1/phase4 green; **final manual self-verification per CLAUDE.md.**

---

## 6. Per-surface checklist (Phase → routes → concrete changes)

Apply the cross-cutting waves to all of these; the notes below are the surface-specific asks.

**Phase 0 — Login / health / shell**
- `app/(auth)/login`: tighten vertical rhythm, ensure the live API/DB status footer uses a `Pill`
  (`ready`/`alert`) with text+icon, not color alone. `PageHeader` not applicable (auth layout).
- Shell: mount `Toaster`, `CommandPalette`, `MobileFloorNav`; keep `TweaksPanel`/`FeedbackButton`.

**Phase 1 — Engineering / work orders** (`engineering`, `engineering/{work-orders,assets,pm-schedules,predictions}`)
- `PageHeader` + `Breadcrumbs` on all four sub-routes. Emergency/escalated work orders: make the
  priority unmistakable (leading `Pill tone="alert"` + icon), keep the escalated lane always visible.
- Convert the structured transition drawer's buttons to `Button`; loading states on transitions.
- Floor surface → strict i18n (no literal strings).

**Phase 2 — Evidence** (`evidence`, 504 lines)
- Split the five surfaces (applicability / documents / records / exceptions / acknowledgements) into
  `PageHeader` tabs (they likely already tab — standardize via `PageHeader.tabs`). Progressive disclosure
  on long tables. `StateBlock` for each region. Inspector-export action as a primary `Button`.

**Phase 3 — Safety** (`safety`, 82 lines but role-adaptive tabbed) + evidence overlap
- Standardize the role-adaptive tabs through `PageHeader.tabs`. Staff safety-info (chemicals/PPE/
  procedures/contacts) is floor-facing → i18n strict, big tap targets, `EmptyState` when empty.
- Give Safety its own nav icon (§3). Manager Compliance/Programs/Incidents tabs: `Card` + `StateBlock`.

**Phase 4 — Housekeeping & programs** (`housekeeping`, `housekeeping/{assignments,inspections,rooms}`,
`programs`, `tasks`, `engineering/pm-schedules`) — **the floor. Highest priority for "easier to use."**
- `housekeeping/page.tsx` (809 lines): break into scannable sections; the room board is the hero —
  ensure `RoomCard` status uses text+icon+color; primary actions thumb-reachable; `MobileFloorNav`
  surfaces "My Rooms"/board.
- Inspection modal: `useModalFocusTrap`, `Button` actions, photo-on-fail prompt obvious.
- Programs / PM completion: `Button loading` on submit; `EmptyState` for empty schedules.
- **Everything here is under the bilingual floor gate — EN/ES parity is mandatory, lint will enforce.**

**Phase 5 — Guest recovery & ROI** (`guest-requests`, `lost-found`, `management-roi`, `reports`,
`settings/{guest-requests,rooms}`)
- Guest-requests kanban: consistent column headers via `SectionLabel`; card actions as `Button`/`IconButton`;
  the drawer thread uses `StateBlock`; reply box gated exactly as today (no RBAC change); success/error toasts
  on send/resolve/satisfaction.
- `management-roi` (494): lead with `Stat` cards (already have `Stat` primitive); group the four ROI
  families (time saved / quality / response / revenue protected) into clear `Card` sections with
  `SectionLabel`; charts get captions; `StateBlock` while loading.
- `reports` (764): progressive disclosure — collapse secondary report blocks; primary export as `Button`.
- Lost & found disposition queue: `StateBlock`, clear disposition actions, retention countdown as a `Pill`.

**Settings** (`settings` + 11 sub-pages)
- All sub-pages: `PageHeader` + `Breadcrumbs`; forms use `Input`/`Button`; save = `Button loading` +
  success/error `useToast`; destructive actions use `DeleteConfirmDialog` (exists) + `Button variant="destructive"`.

---

## 7. Guardrails & do-not-break list

**Never change (presentation-only refactor):**
- API clients (`lib/api/**`), React Query keys/queries, Zustand stores, Supabase calls.
- Routing, middleware route guards, RBAC allow-lists (reuse them; do not widen).
- Realtime subscriptions (Housekeeping board, Engineering WOs, AI alerts) — do not alter their wiring.
- The honest occupancy language ("Mark Occupied/Departed", "Ready for occupancy") from Phase 1.
- Feature flags / Opera pilot gating.

**Must preserve:**
- EN/ES parity + the no-literal-string floor gate (run `verify-i18n-gate.mjs` + a key-parity diff each wave).
- 44px touch targets on coarse pointers (already enforced in `globals.css` — keep it working for new components).
- `prefers-reduced-motion`, dark mode, and all three density modes on everything you add or touch.
- Existing Playwright suites (phase0/phase1/phase4) stay green; update selectors only if you intentionally
  restructure DOM, and re-run to confirm.

**Regression protocol (per wave):** after editing a shared component, open every surface that imports it
and confirm it still renders and behaves. If a wave touches floor files, run the phase4 EN/ES 390px suite.

---

## 8. Definition of done (whole initiative)

- All P1–P7 targets in §1 met (track the baseline numbers down).
- `npm run type-check`, `npm run lint`, `node scripts/verify-i18n-gate.mjs` all exit 0; EN/ES key parity intact.
- Playwright phase0/phase1/phase4 green.
- Manual self-verification (CLAUDE.md) completed for: housekeeper golden path, GM guest-request flow,
  engineering work-order transition, safety staff-info, management-ROI dashboard — in **both** light and dark,
  and on a 390px mobile viewport for floor roles.
- No behavior/data/RBAC change (diff review confirms presentation-only).
- `.wolf/anatomy.md` updated for new files; `.wolf/memory.md` session summary written; any bugs in `.wolf/buglog.json`.

---

## 9. Suggested commit sequence (one PR-worthy commit per wave)

```
feat(web): UI foundation — Button sizes/loading, IconButton, EmptyState, StateBlock, Toaster, CommandPalette   [Wave 0]
refactor(web): adopt PageHeader across all dashboard pages + DashboardGreeting                                  [Wave 1]
refactor(web): replace hand-rolled buttons with Button/IconButton, add loading states                          [Wave 2]
refactor(web): unify empty/loading/error via StateBlock + single useToast feedback                             [Wave 3]
feat(web): command palette, distinct nav icons, breadcrumbs, mobile floor nav                                  [Wave 4]
polish(web): per-surface card/section/density cleanup + progressive disclosure on heavy screens                [Wave 5]
chore(web): accessibility + dark-mode + density QA pass                                                        [Wave 6]
```
Commit only when a wave's acceptance gate passes. Push to `main` (repo deploys from `main`); the pre-push
gate runs `npm audit` + lint + type-check — all must be green (they already are as of 2026-07-26).
```

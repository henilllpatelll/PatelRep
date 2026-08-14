# Phase 30: Additive Foundation & Regression Harness - Research

**Researched:** 2026-08-14
**Domain:** Design-token foundation + CI regression harness for a Next.js 14 App Router B2B ops SaaS (v2.0 "Web UI/UX Redesign")
**Confidence:** HIGH (every claim below read from source in this repo, not from training data)

<user_constraints>
## User Constraints (from 30-CONTEXT.md)

### Locked Decisions

**HARD CONSTRAINT — Room-status badge colors (dirty / clean / inspected / occupied) must stay exactly as currently implemented, EVERYWHERE they render** — not only inside the 3 excluded board files, but also in any redesigned chrome that later displays a room-status color (legend, filter chip, "my rooms" list in Phase 36). Staff are trained on these color meanings. This is *narrower* than the full frozen list: only the specific token(s)/values encoding room cleanliness state are frozen at their current values. Other status vocabularies (task status, work-order priority, risk levels) are **not** frozen. This phase must identify and document the exact tokens/hardcoded values that encode room-status colors, tagged distinctly in the frozen list.

**Feature-flag rollout control:**
- Per-tenant, mirroring the `tenants.opera_pilot_enabled` precedent (naming consistent with that convention).
- No GM-facing toggle this phase — flipped directly via DB/admin tooling, same operational pattern as Opera pilot gating.
- Gates **per-section**, not all-or-nothing: as each later phase's section lands, it becomes visible under the flag for a flagged tenant while not-yet-redesigned sections keep rendering old UI for that same tenant. Build the mechanism to support this granularity, not a single blanket switch.
- Lifecycle: flag + old-UI path are meant to be removed in a later cleanup (not a permanent rollback switch). Removal is out of scope for Phase 30; just don't intertwine flag checks with business logic in a way that makes future removal harder.

**Existing theming system:**
- 3 density modes (comfortable/balanced/dense) — **keep all 3**; new token system must continue to support density.
- `prefers-reduced-motion` continues to be respected as it is today.

**Frozen-primitive enforcement rigor: CI-enforced, not documentation-only**, following the RBAC-05..08 precedent (automated script guards, not manual audits). Two layers:
1. A file-change guard failing CI if any frozen file changes without an explicit, reasoned allowlist entry — mirrors `apps/api/rbac_bare_comparison_allowlist.json`.
2. The Playwright pixel-diff baseline comparison mandated by FOUND-03.

### Claude's Discretion (research options, recommend)
- Overall mood, palette, typography — propose a direction grounded in the existing token architecture.
- Accent color — open to changing terracotta, not required to preserve it.
- 4 switchable accent themes — keep all 4, reduce, or fold into one refined default.
- Light-vs-dark design priority.
- Motion/micro-interaction expressiveness — functional, not decorative.
- Contrast-tooling choice (axe vs. Lighthouse CI vs. custom).
- Exact new token names/values, accent-theme/density integration specifics.
- **User instruction: do not return to the user until Phase 30 is fully planned, executed, verified, and closed.** Document all discretionary calls with rationale in phase artifacts.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within Phase 30 scope. (Task/WO/risk status colors are not deferred; they're simply open to their own later section phases.)
</user_constraints>

## Summary

This phase lands **new CSS tokens (additive only), extended primitive variants (additive only), a per-section feature flag, and four CI gates** (frozen-file guard, Playwright pixel-diff of the 3 excluded boards, dark-mode contrast check, EN/ES key-parity check). It restyles **nothing** — Phases 31-36 do that.

The single governing rule, confirmed by direct source reads: **the 3 excluded boards and `RoomCard` read the global CSS token layer directly and consume `Button`/`IconButton`/`StatusDot`/`Pill`. Changing any existing token *value* or any existing primitive *variant* silently re-skins the excluded surfaces.** So every deliverable is additive: new token *names* alongside the old, new variants alongside the old, and a hard freeze on the room-status color values specifically.

The good news for tooling: **Playwright is already installed and wired into CI** (`@playwright/test` 1.62.1, 4 configs, `e2e/` dir, phase0 smoke runs in `ci.yml`). TypeScript 5.5 is available for a key-parity script. The migration pattern for a per-tenant flag is well-established (`085_opera_pilot_flag.sql`, `094_tenant_is_test_flag.sql`), and `front_desk_modules text[]` is a **direct precedent for a per-tenant array of enabled keys surfaced to the web via `/auth/me` and read client-side** — which is exactly the shape the per-section flag needs.

**Primary recommendation:** Evolve, don't repalette. Keep the warm-paper + terracotta identity (it is distinctive and dodges the "dull white-coded SaaS" trap), freeze the room-status ramp at its current values, and land the real upgrade as *new additive systems the old palette never had*: a motion scale, a z-index scale, an elevation/surface-tint scale, a focus-ring token, and a tightened-contrast "v2" ink/brand ramp under new names. Introduce a new `--brand` token (not a mutation of `--accent`) plus `Button variant="v2"` so later phases restyle by *opting in*, leaving the board's render path byte-identical.

## Standard Stack

Per `.planning/research/STACK.md` (HIGH confidence, versions verified via local `npm view`): **extend, don't replace.** No new dependency is required for THIS phase. Everything is native CSS variables + the existing Playwright + a new TS/Node script or two.

### Core (already in repo — this phase only extends them)
| Tool | Version | Purpose in Phase 30 |
|------|---------|--------------------|
| CSS custom properties (`app/globals.css` `:root`/`.theme-dark`) | native | Where all new additive tokens land |
| `tailwind.config.ts` color aliases | Tailwind 3.4.19 | New tokens get new aliases here (never rename existing) |
| `@playwright/test` | 1.62.1 | Pixel-diff harness (built-in `toHaveScreenshot()`) |
| `typescript` (devDep) | ^5.5.2 | Compiler API to statically parse `en.ts`/`es.ts` for key-parity |
| Node (CI uses node 22) | 22 | Runs the new `.mjs` guard scripts, mirroring `verify-i18n-gate.mjs` |

### Supporting — do NOT add for this phase
No axe-core, no Lighthouse CI, no `wcag-contrast`, no Style Dictionary, no shadcn, no Tailwind v4, no second animation/icon library. The contrast check is a ~50-line pure-Node computation over static hex (see below) — heavier a11y tooling (axe) belongs to the final-QA phase's rendered-page sweep, not this token-matrix gate.

**Installation:** none required. (Optional, only if the key-parity script is built to *execute* the locale modules instead of statically parsing them: `npm i -D tsx` — but the recommended static-AST approach needs only the already-present `typescript`.)

## Architecture Patterns

### The exact frozen list (read from source — this is the FOUND-02 deliverable, verbatim)

**Frozen files (component APIs frozen — additive variants/props only, never mutate an existing variant/prop):**
| File | What the boards consume | Freeze rule |
|------|------------------------|-------------|
| `apps/web/components/ui/Button.tsx` | `Button` variants `primary\|dark\|outline\|secondary\|ghost\|destructive\|ai`, sizes `sm\|md\|lg`; `IconButton` | Existing variant class strings + defaults frozen. Add `v2` variants/new sizes only. |
| `apps/web/components/ui/primitives.tsx` | `StatusDot` (`DOT_COLORS` map), `Pill` (`PILL_CLASSES` tones) | `StatusDot`/`Pill` tone→color maps frozen. Other exports (`Stat`, `Bar`, `AILabel`, `SectionLabel`, `Mono`) are additive-safe but touching them re-runs the board gate. |
| `apps/web/components/housekeeping/RoomCard.tsx` | Rendered by BOTH boards; owns 4 status→color maps | Entire component frozen. Lives in `housekeeping/` but is an exclusion-boundary primitive. |
| `apps/web/components/shared/LogFoundItemModal.tsx` | Imported by `RoomDetailDrawer` | Frozen (transitive). |
| `apps/web/components/housekeeping/RoomStatusBoard.tsx` | (excluded surface) | Never edit. |
| `apps/web/components/housekeeping/RoomDetailDrawer.tsx` | (excluded surface) | Never edit. Mostly hardcoded Tailwind palette (`stone-*` etc.), so token-refresh-insulated except via `Button`. |
| `apps/web/components/engineering/EngineeringRoomBoard.tsx` | (excluded surface) | Never edit. |

**Frozen tokens — NAMES frozen (all of them; the redesign adds new names, never renames/removes these).** The boards + `RoomCard` read these inline (traced in `.planning/research/ARCHITECTURE.md`): `--paper --surface --surface-2 --surface-3 --line --line-2 --ink --ink-2 --ink-3 --ink-4 --accent --accent-soft --accent-line --accent-ink --ai --ai-soft --ai-line --alert --alert-soft --alert-line --ready --ready-soft --ready-line --caution --caution-soft --caution-line --info --info-soft --info-line --progress --progress-soft --progress-line --blocked --blocked-soft --blocked-line --r-sm --r-md --r-lg --r-xl --shadow-sm/md/lg/pop` plus every Tailwind alias in `tailwind.config.ts`. Renaming/removing any breaks the board; the "Legacy compat" aliases (`--color-bg` etc.) must also be preserved.

**Frozen tokens — VALUES frozen (the HARD CONSTRAINT, room-status colors only, tagged `room-status` and distinct from the name-freeze).** These encode room cleanliness state and their hex must not change in `:root` OR `.theme-dark`. Traced through `RoomCard.tsx` (`STATUS_STRIP_COLOR`, `STATUS_BORDER`, `STATUS_PILL_TONE`), `primitives.tsx` (`PILL_CLASSES`, `DOT_COLORS`):

| Room status | Token(s) frozen at value | Light hex | Dark hex |
|-------------|--------------------------|-----------|----------|
| DIRTY, OCCUPIED | `--alert` `--alert-soft` `--alert-line` | `#a6263c` / `#f5d8de` / `#e8a8b3` | `#d96479` / `#2e1620` / `#5a2a38` |
| CLEAN | `--info` `--info-soft` `--info-line` | `#265d8a` / `#d8e6f0` / `#a8c2d8` | `#5b9bd5` / `#182a3d` / `#34557a` |
| INSPECTED | `--ready` `--ready-soft` `--ready-line` | `#0c6e63` / `#d6eae5` / `#a4cfc7` | `#4ab8a8` / `#14302d` / `#2d5550` |
| IN_PROGRESS | `--progress` `--progress-soft` `--progress-line` | `#7c3aed` / `#ede9fe` / `#c4b5fd` | `#a78bfa` / `#2e2348` / `#5b4a86` |
| PICKUP | `--caution` `--caution-soft` `--caution-line` | `#a16207` / `#f5e9cf` / `#e0c890` | `#d4a64a` / `#322811` / `#5a4920` |
| OOO / OUT_OF_ORDER / OUT_OF_SERVICE | `--blocked` `--blocked-soft` `--blocked-line` | `#57534e` / `#f5f5f4` / `#d6d3d1` | `#d6d3d1` / `#292524` / `#57534e` |

> Note: DIRTY/OCCUPIED reuse `--alert` and CLEAN reuses `--info` — these tokens serve double duty (generic "alert"/"info" chrome AND room-status). Because the *value* is frozen, later phases that want a different generic "alert/error" color for redesigned non-room chrome **must introduce a new token** (e.g. `--danger-v2`) rather than re-tinting `--alert`. Flag this to the planner: the room-status value-freeze constrains what `--alert`/`--info`/`--caution` etc. can become app-wide.

**Also encoding room-status (hardcoded hex duplicates — freeze at value, tag `room-status`):** `tailwind.config.ts` `colors.status.*` (`inspected #0c6e63`, `clean #265d8a`, `in-progress #7c3aed`, `dirty #a6263c`, `oos #b8431c`, `vip #a16207`). These are static hex (won't move with a token refresh) but carry the same trained meaning; include them in the frozen manifest so a future edit is caught. `colors.risk.*` is **not** room-status (risk levels are explicitly un-frozen).

### Recommended additive token proposal (the visual-identity direction — Claude's discretion)

**Direction: "Warm operational calm, systematized."** Rationale: (1) the existing warm-paper/terracotta identity is already distinctive and domain-fitting (hospitality, not generic dashboard-blue) and avoids the dull-SaaS trap OpenWolf's designqc flags; (2) an additive constraint makes a full repalette self-defeating — you'd have to add a whole parallel palette anyway; (3) the genuine gaps are *systems the current tokens lack*: no motion scale, no z-index scale, no elevation/surface-tint scale, no dedicated focus token, and thin dark-mode contrast headroom. Fix those.

Propose adding to `:root` and `.theme-dark` (all NEW names — nothing above is touched):

```css
/* Motion — functional, floor-appropriate; reduced-motion already handled globally */
--motion-fast: 120ms;  --motion-base: 180ms;  --motion-slow: 260ms;
--ease-standard:   cubic-bezier(0.2, 0, 0, 1);
--ease-emphasized: cubic-bezier(0.3, 0, 0, 1);
--ease-exit:       cubic-bezier(0.4, 0, 1, 1);

/* Z-index scale — currently ad-hoc; codify the overlay stack */
--z-base: 0; --z-dropdown: 1000; --z-sticky: 1100; --z-header: 1200;
--z-drawer: 1300; --z-modal: 1400; --z-popover: 1500; --z-toast: 1600; --z-tooltip: 1700;

/* Elevation / surface tint — additive, does NOT touch --surface-2/3 */
--surface-raised:  #ffffff;   /* dark: #211e1a */
--surface-overlay: #fbf9f4;   /* dark: #262320 */
--shadow-xs: 0 1px 1px rgba(26,24,21,0.03);

/* v2 brand + tightened ink (opt-in; existing --accent/--ink stay frozen) */
--brand:      #b8431c;   /* keep terracotta hue; dark: #e08a63 (brighter for AA headroom) */
--brand-ink:  #ffffff;
--brand-soft: #fbe9df;   /* dark: #2e1e16 */
--brand-line: #f0c8b3;   /* dark: #5e3c2a */
--focus-ring: color-mix(in srgb, var(--brand) 45%, transparent);
```

- **Typography: KEEP the existing IBM Plex Sans / Mono + Instrument Serif display stack.** Recommendation, not a required change: Plex Sans has tabular numerals (already used via `tabular-nums`/`font-mono` on room numbers, timers, stats) which is exactly right for dense ops data; a new webfont adds first-paint cost on floor phones, violating the "save floor-staff time" filter. No new `--font-*` needed. If the planner wants a display refresh, do it as a new `--font-display-v2` token, opt-in.
- **4 accent themes:** recommend **keep all 4** (`terracotta/teal/blue/rose`) but note the room-status value-freeze means the `teal`/`blue`/`rose` accent values overlap conceptually with `--ready`/`--info`/`--alert`; that's cosmetic-accent only and doesn't touch the frozen room-status tokens, so it's safe. Folding to one default is a larger UX call better made in the shell phase (31), not here.
- **Density:** the new tokens above are all density-agnostic; the existing `.density-*` blocks (`--row-h/--pad-y/--gap`) are untouched and continue to work.
- **Light-first, dark independently verified:** design light values first, then hand-pick dark values (do NOT auto-derive) and prove them with the contrast gate below (Pitfall 3).

### Anti-patterns to avoid (from ARCHITECTURE/PITFALLS, confirmed against source)
- **Editing existing token values for a "fresh look"** — re-skins the boards. Add new names.
- **Repainting `Button.primary` / `Pill` tones in place** — global, hits the boards. Add `v2`.
- **Forking `RoomStatusBoard`/`RoomCard` into v2 copies** — they carry Realtime subscription + optimistic-merge logic (`RoomStatusBoard.tsx` ~lines 366-450); duplication causes live data-staleness drift.
- **Assuming an edge `middleware.ts` guards routes** — it does not exist; guarding is client-side in `components/shared/Providers.tsx`.

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Pixel-diff of the excluded boards | A custom screenshot-compare | Playwright's built-in `expect(page).toHaveScreenshot()` | Already installed + in CI; handles baseline storage, per-pixel threshold, `maxDiffPixelRatio`, animation-freezing, `mask` for dynamic regions |
| Deterministic screenshots (kill flakiness) | Manual sleeps | Playwright `use: { reducedMotion: 'reduce' }` + `toHaveScreenshot({ mask: [...], animations: 'disabled' })` | The board has Realtime + timestamps; mask them or the diff is never zero |
| Loading `en.ts`/`es.ts` to compare keys | Regex over TS source | `typescript` compiler API (`ts.createSourceFile` → walk the object literal) | Already a devDep; static parse avoids executing app code / needing `tsx` |
| Per-section flag storage | A bespoke config table | A `text[]` column on `tenants` (exactly like `front_desk_modules`) surfaced via `/auth/me` | Proven precedent already read client-side for nav gating |
| Contrast ratios | Eyeballing / a browser tool | ~50-line pure-Node WCAG relative-luminance computation over the static token hex | Deterministic, no browser, enumerates ALL pairings CI-side |

## CI Enforcement — concrete designs (FOUND-02, FOUND-03, FOUND-04, FOUND-05)

**Current CI reality (`.github/workflows/ci.yml`, read directly):** jobs are `lint-api`, `lint-web` (`npm run lint` = eslint incl. `i18next/no-literal-string`, + `type-check`), `build-web`, `test-web-public-smoke` (runs `playwright.phase0.config.ts`), `test-api`, `security`. **Important gap:** `verify:i18n-gate` and `check:floor-copy` exist as package.json scripts but are **NOT wired into `ci.yml`** — only the eslint rule runs in CI. Phase 30 should add its new gates as real CI jobs/steps (and ideally wire the two existing i18n scripts in too).

### 1. Frozen-file guard (mirror `rbac_bare_comparison_allowlist.json`)
Build `apps/web/scripts/check-frozen-files.mjs` + `apps/web/frozen-files-allowlist.json`. **Recommend content-hash over git-diff** (more robust: deterministic, works outside PR context, no `fetch-depth: 0` needed):
- Manifest `apps/web/frozen-files.json`: `{ "files": { "<path>": "<sha256>" }, "tokens": { "--alert": "#a6263c", ... } }` — the frozen file hashes + the room-status frozen *values* (parsed from `globals.css`).
- Guard recomputes each file's sha256 and re-parses the room-status token values from `globals.css`; any mismatch not covered by an allowlist entry → exit 1.
- Allowlist shape mirrors the RBAC one: `{ "entries": [ { "file": "...", "new_hash": "...", "reason": "...", "approved": "phase-3X" } ] }`. Changing a frozen file legitimately (e.g. adding a `Button v2` variant) requires bumping the manifest hash AND adding a reasoned allowlist entry in the same PR — the reviewer sees the intent.
- The room-status *value* freeze has **no allowlist path** (per CONTEXT: "can never change"): a room-status token value change is always a hard failure.
- Wire as a new `frozen-guard` job in `ci.yml` (node 22, `npm ci`, `node scripts/check-frozen-files.mjs`).

### 2. Playwright pixel-diff baseline (FOUND-03) — the exit gate
- New `apps/web/playwright.regression.config.ts` (copy `phase0`'s structure) + `apps/web/e2e/room-board-baseline.spec.ts`.
- Capture matrix: 3 surfaces (Housekeeping `RoomStatusBoard`, `RoomDetailDrawer`, `EngineeringRoomBoard`) × {light, dark} × ≥2 roles (e.g. `housekeeping_supervisor` + `gm`) → ≥12 snapshots, committed to git under `e2e/room-board-baseline.spec.ts-snapshots/`.
- **Determinism (critical, the boards are Realtime + time-sensitive):** set `use: { reducedMotion: 'reduce' }`; call `toHaveScreenshot({ animations: 'disabled', mask: [<timestamp/ETA/sync-badge locators>], maxDiffPixelRatio: 0 })`. Toggle dark via the app's `.theme-dark` mechanism (`uiPreferencesStore` writes the class on the shell root).
- **The hard part — flag to the planner (MEDIUM confidence):** these are *authenticated, data-dependent* screenshots. `phase0` runs public-only with placeholder Supabase; `phase1`/`phase4` run against the production URL. Recommended approach: a Playwright `globalSetup` that logs in once (using the GM test account in memory `reference_test_account.md`) and saves `storageState`, run against a **stable seeded environment** with fixed room data, and mask any residual dynamic regions. Without a pinned data seed the pixel-diff will be noisy; decide the seed/environment in planning. This is the phase's biggest execution risk.
- Exit gate: baseline captured on the pre-redesign tree; the diff run at phase exit must show **zero drift**.

### 3. Dark-mode contrast check (FOUND-04) — custom Node script, no new dep
- `apps/web/scripts/check-contrast.mjs`: parse hex tokens from `globals.css` (`:root` + `.theme-dark`), compute WCAG relative luminance + contrast ratio for a declared **pairings matrix** (allowed fg-on-bg combos — e.g. `--ink` on `--surface`, `--brand-ink` on `--brand`, each status text on its `-soft`, etc.), assert ≥4.5:1 body text / ≥3:1 large text & UI, in BOTH modes.
- Output a table (record ratios in the phase artifact per PITFALLS Pitfall 3). Fail CI on any pair below threshold. Recommend this over axe/Lighthouse because it enumerates *token pairings* exhaustively without a rendered page; save axe for the final-QA rendered sweep.

### 4. EN/ES key-parity check (FOUND-05) — beyond `no-literal-string`
- `apps/web/scripts/check-i18n-parity.mjs`: use the `typescript` compiler API to `createSourceFile` on `i18n/locales/en.ts` and `es.ts` (each is `const x = {…}; export default x`, 1425 lines each today, currently equal line count), statically walk the nested object literal to produce flattened key sets, diff them, exit 1 listing any missing/orphaned key (in either direction).
- This is a *separate* check from the eslint `no-literal-string` rule (which only proves no raw JSX literal, not locale parity — see PITFALLS Pitfall 2). Add `"check:i18n-parity"` to package.json and a CI step. Precedent for locale-aware scripts: `scripts/check-programs-i18n.mjs`, `scripts/verify-i18n-gate.mjs`.

## Feature Flag — concrete implementation (FOUND-06)

**Read path confirmed from source:** web bootstraps the tenant via `apiClient.get('/auth/me')` in `components/shared/Providers.tsx:119` → `setHotel(data.hotel)`. The API handler `apps/api/routers/auth.py:18` selects `id, name, timezone, room_count, logo_url, front_desk_modules` from `tenants`. `front_desk_modules text[]` is already surfaced to the web and read client-side for nav gating (`getAllowedNavItems(... frontDeskModules ...)`). **This is the exact pattern to reuse.**

**Recommended shape — a `text[]` of enabled section keys (not a single boolean):** this natively delivers the required per-section granularity and stays trivially removable.

1. **Migration `supabase/migrations/097_web_redesign_sections.sql`** (highest existing is `096`; mirror `085`/`094`):
   ```sql
   ALTER TABLE public.tenants
     ADD COLUMN IF NOT EXISTS web_redesign_sections TEXT[] NOT NULL DEFAULT '{}';
   COMMENT ON COLUMN public.tenants.web_redesign_sections IS
     'Per-section v2.0 redesign rollout gate. Each element is a section key (e.g. "shell","tasks","engineering") whose redesigned UI is live for this tenant. Empty = all old UI. DB/admin-flipped, no GM toggle. Removed in the v2.0 cleanup once all tenants migrated (v2.0 FOUND-06).';
   -- ROLLBACK: ALTER TABLE public.tenants DROP COLUMN web_redesign_sections;
   ```
   > Naming note: CONTEXT suggested a boolean like `web_redesign_enabled`, but the same section explicitly requires *per-section* granularity and warns against "just a single blanket switch." A `text[]` of section keys satisfies both the precedent (a per-tenant column, DB-flipped, like `front_desk_modules`) and the granularity requirement. Recommend the array; note the boolean alternative below.
2. **API:** add `web_redesign_sections` to the `tenants` select in `auth.py:18` and to the `/me` response model. (No new endpoint; no gating logic in the API — the flag is a data field the web reads. This keeps flag checks out of business logic per the lifecycle constraint.)
3. **Web types:** add `web_redesign_sections?: string[]` to the `Hotel` interface (`stores/hotelStore.ts`), the `MeResponse` hotel type (`Providers.tsx`), and `HotelResponse`/hotel shape (`lib/api/hotels.ts`) — mirroring how `front_desk_modules` threads through.
4. **Client gate:** a single small helper `lib/utils/redesignFlag.ts` → `isSectionRedesigned(sectionKey, hotel): boolean` (returns `hotel?.web_redesign_sections?.includes(sectionKey) ?? false`), plus a thin boundary component (e.g. `<RedesignGate section="tasks" v2={<NewTasks/>} legacy={<OldTasks/>}/>`). Phase 30 ships the mechanism + helper + one no-op usage/test; later phases opt each section in. Keeping the check at a single section-entry boundary (not sprinkled through logic) makes the eventual cleanup a delete-the-wrapper operation.

**Alternative (simpler, weaker):** a single `web_redesign_enabled boolean` gating a hardcoded, client-side "sections done so far" list. Rejected as the primary because it couples per-section rollout to code deploys and can't be tuned per-tenant-per-section from the DB, which the granularity requirement wants.

## Common Pitfalls (phase-specific, from PITFALLS.md + source)

### Pitfall 1: The exclusion breaks and no one edited an "excluded" file
Frozen primitives (`Button`/`primitives`/`RoomCard`/`LogFoundItemModal`) + token *values* are the transitive risk. **Avoid:** the frozen-file guard (gate 1) + the pixel-diff (gate 2) are the entire enforcement mechanism — capture the baseline on the pre-redesign tree *before* landing any new token. **Warning sign:** a PR touches only shared components but its checklist doesn't name the boards.

### Pitfall 2: Room-status value drift via double-duty tokens
`--alert`/`--info`/`--caution`/`--ready`/`--progress`/`--blocked` are BOTH generic chrome AND room-status. A later phase re-tinting "alert" app-wide would move room DIRTY/OCCUPIED. **Avoid:** the value-freeze in the manifest has no allowlist escape; new generic semantics get new tokens (`--danger-v2`). Document this constraint prominently for Phases 31-36.

### Pitfall 3: Dark-mode contrast silently below AA
Contrast is a fg/bg *pair* property that inverts in dark mode; the app targets night-shift staff. **Avoid:** gate 3 computes every declared pairing in both modes; hand-pick dark values, don't auto-derive; record ratios in the artifact.

### Pitfall 4: i18n key drift (EN-only keys pass `no-literal-string`)
The eslint rule proves no raw literal, not parity. **Avoid:** gate 4 (key-parity) + keys-in-both-locales-first discipline in every later phase. Phase 30 owns *adding the gate*.

### Pitfall 5: Half-old/half-new production confusion
A token/foundation change is globally visible the instant it merges. **Avoid:** the additive strategy means old sections keep reading old tokens/variants → they stay coherent; the feature flag hides new sections until each is complete. Phase 30's additive-only rule is precisely what makes the long rollout safe.

## Code Examples (verified against this repo)

**Room-status color source of truth** (`components/ui/primitives.tsx` — the maps to freeze):
```ts
const DOT_COLORS = { dirty:'var(--alert)', progress:'var(--progress)', clean:'var(--info)',
  inspected:'var(--ready)', ready:'var(--ready)', pickup:'var(--caution)', ooo:'var(--blocked)', /* … */ }
// PILL_CLASSES maps the same tones to bg/text/border via the -soft/-line variants.
```
**RoomCard status mapping** (`components/housekeeping/RoomCard.tsx` — DIRTY/OCCUPIED→alert, CLEAN→info, INSPECTED→ready, IN_PROGRESS→progress, PICKUP→caution, OOO→blocked). OCCUPIED renders a striped `--alert`/`--alert-soft` gradient.

**Existing per-tenant array flag, end to end** (the pattern to copy): `tenants.front_desk_modules text[]` → selected in `auth.py:/me` → `data.hotel.front_desk_modules` in `Providers.tsx` → `hotelStore` → consumed by `getAllowedNavItems`.

**Existing CI guard to mirror** (`apps/api/scripts/check_bare_role_comparisons.py` + `rbac_bare_comparison_allowlist.json`): script scans, compares against a reasoned allowlist JSON, exits 1 with actionable message. `apps/web/scripts/verify-i18n-gate.mjs` shows the Node/ESLint-API gate style.

## State of the Art

| Old approach (in-repo) | This phase adds | Impact |
|------------------------|-----------------|--------|
| Ad-hoc z-index, no motion/elevation scale | Named `--z-*`, `--motion-*`, `--ease-*`, `--surface-raised` tokens | Later phases compose consistently |
| Manual "don't touch the board" convention | Frozen-file hash guard + pixel-diff CI gates | Structural enforcement (RBAC-05..08 precedent) |
| `no-literal-string` only | + EN/ES key-parity + dark-mode contrast gates | Closes the two silent-regression classes |
| No web rollout flag | `tenants.web_redesign_sections text[]` per-section gate | Safe incremental prod rollout |

## Open Questions

1. **Authenticated, deterministic board screenshots.** *Known:* Playwright is installed and can mask/freeze. *Unclear:* which environment + data seed produces byte-stable board renders (Realtime + timestamps + live room data). *Recommendation:* `globalSetup` login via the GM test account, run against a fixed-seed environment, mask timestamp/ETA/sync-badge regions, `maxDiffPixelRatio: 0`. Decide the seed/env in planning — this is the phase's main execution risk (MEDIUM confidence).
2. **Flag column type — `text[]` vs boolean.** Recommendation: `text[]` of section keys (matches the granularity requirement + `front_desk_modules` precedent). Confirm naming with the roadmap's section-key taxonomy (shell, tasks, engineering, housekeeping, …).
3. **Wire the two orphaned i18n scripts into CI?** `verify:i18n-gate`/`check:floor-copy` aren't in `ci.yml` today. Low-cost to add alongside the new parity gate; recommend doing so.

## Sources

### Primary (HIGH — read directly from this repo, 2026-08-14)
- `apps/web/app/globals.css` — full token layer (`:root`, `.theme-dark`, `.accent-*`, `.density-*`, reduced-motion)
- `apps/web/components/ui/primitives.tsx`, `components/ui/Button.tsx`, `components/housekeeping/RoomCard.tsx` — the room-status color maps + frozen primitives
- `apps/web/tailwind.config.ts` — aliases + hardcoded `status.*`/`risk.*` hex
- `apps/web/components/shared/Providers.tsx`, `stores/hotelStore.ts`, `lib/api/hotels.ts`, `apps/api/routers/auth.py` — the flag read path
- `apps/api/scripts/check_bare_role_comparisons.py`, `rbac_bare_comparison_allowlist.json` — CI guard precedent
- `apps/web/scripts/verify-i18n-gate.mjs`, `playwright.phase0/phase1.config.ts`, `e2e/*.spec.ts`, `.github/workflows/ci.yml`, `package.json` — existing tooling
- `supabase/migrations/085_opera_pilot_flag.sql`, `094_tenant_is_test_flag.sql`; latest migration `096` — flag migration pattern + numbering
- `apps/web/i18n/locales/en.ts` / `es.ts` — 1425 lines each, nested object, `export default`

### Secondary (HIGH — prior milestone research, read directly)
- `.planning/research/STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md`, `SUMMARY.md`

## Metadata

**Confidence breakdown:**
- Frozen list (files/tokens/room-status values): HIGH — read every relevant file; the room-status mapping is exhaustively traced.
- CI gate designs (frozen guard, contrast, key-parity): HIGH — patterns mirror existing in-repo scripts.
- Playwright pixel-diff harness: HIGH on tooling availability, MEDIUM on the authenticated/deterministic capture approach (needs a seed/env decision in planning).
- Feature flag: HIGH — read the exact read path end to end; `front_desk_modules` is a direct precedent.
- Visual identity proposal: MEDIUM — a reasoned recommendation (Claude's discretion), not an empirical finding; grounded in the additive constraint + the floor-staff filter.

**Research date:** 2026-08-14
**Valid until:** ~2026-09-13 (stable; re-verify migration number and CI job list if planning slips a month)

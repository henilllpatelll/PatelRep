---
phase: 31-shell-navigation-redesign
plan: 01
subsystem: ui
tags: [nextjs, react, zustand, radix-ui, tailwind, i18n, tooltip]

requires:
  - phase: 30-additive-foundation-regression-harness
    provides: additive v2 design tokens (--motion-*, --ease-*, --z-*, --brand*, --focus-ring), frozen-file guard, contrast gate, i18n-parity gate, RedesignGate/isSectionRedesigned utility (from 30-01/30-04/30-05)
provides:
  - sidebarCollapsed persisted preference (uiPreferencesStore) with setter/toggle, mirroring density/theme/accent
  - shellV2 flag computed once in DashboardShell via isSectionRedesigned('shell', hotel) and threaded to Sidebar/Header/CommandPalette as a redesigned prop
  - single Tooltip.Provider mounted in DashboardShell (delayDuration 200) for all Phase-31 tooltip consumers
  - collapsible desktop icon-rail Sidebar (NAV-02) with Radix tooltips, iterating the same RBAC-derived opsItems/intelItems/peopleItems/bottomItems arrays
  - v2 token restyle for Sidebar/Breadcrumbs/MobileFloorNav gated by the redesigned/shell flag, legacy branch untouched when flag is off
  - declaration-only redesigned? prop on Header and CommandPalette (unused this plan, consumed by 31-02/31-04)
  - @radix-ui/react-tooltip@1.2.16 installed
affects: [31-02-header-notifications, 31-04-command-palette-record-search, 31-05-nav-group-coverage-test, 31-06-shell-live-verification]

tech-stack:
  added: ["@radix-ui/react-tooltip@1.2.16"]
  patterns:
    - "Direct flag read (useHotelStore + isSectionRedesigned('shell', hotel)) for shell components not mounted by DashboardShell (Breadcrumbs, MobileFloorNav), vs prop-threaded redesigned for components DashboardShell mounts directly (Sidebar, Header, CommandPalette)"
    - "Desktop-only responsive collapse: gate all collapse-state styling behind md: className variants (via cn(baseClass, sidebarCollapsed && 'md:hidden')) rather than a separate JS breakpoint check, so mobile always renders the full/expanded DOM regardless of the persisted collapse preference"
    - "CollapsedTooltip wrapper component: pass-through when not collapsed, wraps in Tooltip.Root/Trigger/Content (side=right) when collapsed, reused for both primary nav items and the Settings bottom item to avoid duplicating the Tooltip JSX"

key-files:
  created: []
  modified:
    - apps/web/stores/uiPreferencesStore.ts
    - apps/web/components/shared/DashboardShell.tsx
    - apps/web/components/shared/Sidebar.tsx
    - apps/web/components/shared/Header.tsx
    - apps/web/components/shared/CommandPalette.tsx
    - apps/web/components/shared/Breadcrumbs.tsx
    - apps/web/components/shared/MobileFloorNav.tsx
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts
    - apps/web/package.json

key-decisions:
  - "Rail width: 64px (md:w-16) collapsed vs 232px (md:w-[232px]) expanded, matching the plan's stated ~64px target"
  - "Collapsed state hides: hotel-switcher (entire block, not just its text -- simpler and lower-risk than keeping a working dropdown trigger at 64px), nav-item label spans, group-heading eyebrows, tag badges, sub-nav list, and the user-identity text block; keeps: logo mark, every item icon, active-state left bar, gm-only Settings icon, avatar circle"
  - "Collapse-to-rail (NAV-02) ships unconditionally, independent of the shellV2/redesigned flag -- only the token/color restyle (NAV-01) is gated by redesigned, per the plan's explicit 'apply ONLY when redesigned is true' instruction for the RESTYLE section vs the unconditional COLLAPSE section"
  - "Tooltip wrap decision is driven by the sidebarCollapsed boolean directly (not a separate isDesktop check): when collapsed, every rail link is wrapped in Tooltip.Root even on a mobile drawer render, but Tooltip.Content carries an explicit 'hidden md:block' safeguard and mobile has no hover, so this is inert on touch and does not visually affect the mobile drawer (Pitfall #5 held)"
  - "Header/CommandPalette get a declaration-only redesigned? prop this plan (unused); Sidebar also required an equivalent declaration-only addition beyond the plan's Task-1 file list because DashboardShell threads redesigned into Sidebar in the same step -- applied as a Rule 3 (blocking-issue) auto-fix so npm run build stays green after Task 1, with full behavior landing in Task 2 as originally scoped"

patterns-established:
  - "New v2-token classes for shell surfaces should use the Tailwind aliases already registered in tailwind.config.ts (duration-base, ease-standard, z-tooltip, bg-brand, text-brand) rather than raw var(...) arbitrary values, since those aliases already exist"

duration: ~55min
completed: 2026-08-14
---

# Phase 31 Plan 01: Shell Redesign Foundation Summary

**Persisted sidebarCollapsed preference + shellV2 flag threading through DashboardShell, collapsible desktop icon-rail Sidebar with Radix tooltips (NAV-02), and v2 token restyle for Sidebar/Breadcrumbs/MobileFloorNav gated by the shell redesign flag (NAV-01 partial)**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-08-14T17:50:38Z
- **Tasks:** 3/3 completed
- **Files modified:** 10 (7 components/store, 2 locale files, package.json + lockfile)

## Accomplishments
- `sidebarCollapsed` now persists per-user in `patelrep-ui-prefs` (zustand/persist), mirroring the existing density/theme/accent fields exactly
- `DashboardShell` computes the `shell` section's redesign flag once (`isSectionRedesigned('shell', hotel)`) and threads it as a `redesigned` prop into `Sidebar`, `Header`, and `CommandPalette`; mounts a single `Tooltip.Provider`
- Desktop Sidebar collapses to a 64px icon rail with Radix tooltips on hover, toggled via a new `PanelLeftClose`/`PanelLeft` button; the rail iterates the exact same RBAC-derived `opsItems`/`intelItems`/`peopleItems`/`bottomItems` arrays as the expanded sidebar, so no role can lose a nav entry when collapsed
- Collapse state persists across reload and re-login; mobile drawer behavior is completely unaffected (verified live)
- Breadcrumbs and MobileFloorNav read the shell flag directly and apply v2 tokens (`--brand`, `--focus-ring`, `--motion-base`/`--ease-standard`) only when the flag is on; legacy styling is unchanged otherwise
- `@radix-ui/react-tooltip@1.2.16` installed; new `nav.collapseSidebar`/`nav.expandSidebar` i18n keys added to both locales

## Task Commits

Each task was committed atomically:

1. **Task 1: Add sidebarCollapsed to uiPreferencesStore + thread shellV2 flag + Tooltip.Provider in DashboardShell** - `ea75c097` (feat)
2. **Task 2: Sidebar collapse-to-rail (NAV-02) + v2 token restyle** - `707f0535` (feat)
3. **Task 3: Breadcrumbs + MobileFloorNav v2 token restyle (NAV-01, light touch)** - `6c1ad656` (feat)

_No separate plan-metadata commit was made for this SUMMARY; STATE.md/SUMMARY.md are committed together per the orchestrator's docs-commit step._

## Files Created/Modified
- `apps/web/stores/uiPreferencesStore.ts` - added `sidebarCollapsed` + `setSidebarCollapsed`/`toggleSidebarCollapsed`
- `apps/web/components/shared/DashboardShell.tsx` - computes `shellV2`, threads `redesigned` prop, mounts `Tooltip.Provider`
- `apps/web/components/shared/Sidebar.tsx` - collapse-to-rail rendering, `CollapsedTooltip` helper, v2 token restyle gated by `redesigned`
- `apps/web/components/shared/Header.tsx` - declaration-only `redesigned?: boolean` prop (unused this plan)
- `apps/web/components/shared/CommandPalette.tsx` - declaration-only `redesigned?: boolean` prop (unused this plan)
- `apps/web/components/shared/Breadcrumbs.tsx` - direct flag read, v2 hover/focus tokens on the parent link when redesigned
- `apps/web/components/shared/MobileFloorNav.tsx` - direct flag read, v2 active-color/focus-ring when redesigned, no structural change
- `apps/web/i18n/locales/en.ts` / `es.ts` - `nav.collapseSidebar` / `nav.expandSidebar` keys
- `apps/web/package.json` (+ `package-lock.json`) - `@radix-ui/react-tooltip@1.2.16`

## Decisions Made
See `key-decisions` in frontmatter above (rail width/hide-keep list, collapse shipping unconditionally vs restyle being flag-gated, tooltip-wrap approach and its mobile safety, and the Sidebar declaration-only prop deviation).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Sidebar needed a declaration-only `redesigned?: boolean` prop in Task 1, one task earlier than its file list implied**
- **Found during:** Task 1 (`DashboardShell.tsx` threading step)
- **Issue:** The plan's Task 1 action step 4 explicitly threads `redesigned={shellV2}` into `<Sidebar>` in the same step it threads Header/CommandPalette, but Task 1's `<files>` list and step 3 ("the props added in step 3 make these type-check") only cover Header/CommandPalette. Without a matching prop on `Sidebar`, `npm run build` (Task 1's own `<verify>` requirement) would fail with an excess-property/unknown-prop TypeScript error.
- **Fix:** Added `redesigned?: boolean` to `SidebarProps` in Task 1 (declaration-only, unused until Task 2's real implementation in the same file).
- **Files modified:** `apps/web/components/shared/Sidebar.tsx`
- **Verification:** `npm run build` green after Task 1's changes.
- **Committed in:** `ea75c097` (Task 1 commit)

**2. [Rule 3 - Blocking] Stray `node .next/standalone/server.js` process held a lock on `.next/standalone`, failing `npm run build`**
- **Found during:** Task 2 verification
- **Issue:** An orphaned production-preview server process (started by an earlier `npm run start`, unrelated to this session) was still running and holding an open handle on `apps/web/.next/standalone`, causing `next build`'s cleanup step to fail with `EBUSY: resource busy or locked, rmdir '.next/standalone'` on Windows.
- **Fix:** Identified and stopped the specific orphaned process (PID captured via `Get-CimInstance Win32_Process`), leaving the active `dev:web`/`dev:api` dev servers untouched; re-ran `npm run build`, which then succeeded.
- **Files modified:** none (environment-only)
- **Verification:** `npm run build` succeeded on retry.
- **Committed in:** N/A (no code change)

---

**Total deviations:** 2 auto-fixed (1 blocking type-check gap, 1 blocking stale-process build failure)
**Impact on plan:** Both were necessary to keep each task's own `<verify>` step (which explicitly requires `npm run build`) green; no scope creep, no plan intent changed.

## Issues Encountered
- Two files outside this plan's scope (`apps/web/lib/api/engineering.ts`, `apps/web/lib/api/guest_requests.ts`, plus the auto-generated `apps/web/next-env.d.ts`) were already modified in the working tree at session start from a concurrently-executing plan (31-03). Left untouched throughout; confirmed via `git log` that 31-03's own commits (`45a72a89`, `d99f6c73`, `041ed69f`, `77c2709b`) landed independently and interleaved cleanly with this plan's three commits with no conflicts.
- `apps/web/AGENTS.md` (auto-generated by `next dev`) warns that this Next.js canary version (`16.3.0-preview.10`) may have breaking API changes versus training data. Reviewed and determined not relevant to this plan's scope (no new Next.js routing/config/metadata APIs were touched — only React component props, Tailwind classNames, a zustand store field, and a Radix UI primitive already used elsewhere in the codebase).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `redesigned` prop threading pattern (DashboardShell → Sidebar/Header/CommandPalette) and the direct-flag-read pattern (Breadcrumbs/MobileFloorNav) are both in place and proven end-to-end; Plans 31-02 (Header restyle + notifications) and 31-04 (CommandPalette restyle + record search) can now consume their already-declared `redesigned` prop without touching `DashboardShell.tsx` again.
- Single `Tooltip.Provider` is mounted at the shell root — no later plan needs to add another one.
- Rail group-coverage (Pitfall #2) was held structurally (same `opsItems`/`intelItems`/`peopleItems`/`bottomItems` arrays reused, no new list or role branch introduced) and confirmed live for the GM role (16 nav links, identical count collapsed vs expanded); Plan 31-05's automated group-coverage test can assert this for every role.
- No blockers for 31-02 through 31-06.

---
*Phase: 31-shell-navigation-redesign*
*Completed: 2026-08-14*

## Self-Check: PASSED

All 8 claimed key-files exist on disk (verified via `[ -f ... ]`); all 3 task commit hashes (`ea75c097`, `707f0535`, `6c1ad656`) confirmed present in `git log --oneline --all`.

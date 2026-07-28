---
phase: 05-guest-recovery-and-management-roi
plan: 10
subsystem: ui
tags: [nextjs, react-query, roi, dashboard, i18n, rbac]

# Dependency graph
requires:
  - phase: 05-guest-recovery-and-management-roi
    provides: "tenants.average_daily_rate_cents column (migration 084, plan 05-01) and UpdateHotelRequest.average_daily_rate_cents field"
  - phase: 05-guest-recovery-and-management-roi
    provides: "seven GM-only /v1/reports/roi/* endpoints (plan 05-06)"
provides:
  - "apps/web/lib/api/managementRoi.ts — typed client for all seven /reports/roi/* endpoints"
  - "GM-editable Average Daily Rate ($) field on Settings > General, persisted as cents via hotelsApi.update"
  - "apps/web/app/(dashboard)/management-roi/page.tsx — GM-only ROI dashboard, four outcome sections plus exception tables and 7-day forecast strip"
  - "GM-only /management-roi sidebar entry, translated in EN/ES"
affects: [management-roi, settings-general, sidebar]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dollars-in-UI / cents-in-API boundary conversion pattern: convert once at submit (Math.round(dollars * 100)) and once at load (cents / 100), never store the raw dollar field on the API payload"
    - "GM-only page pattern: enabled: isGM on every useQuery plus an early access-denied return, so a direct navigation by a non-GM issues zero requests instead of a wall of 403s"
    - "Honest-state rendering: revenue.configured drives a Not set branch instead of a fabricated $0; an all-zero cross-query check renders a Not enough data yet empty state instead of a zero grid"

key-files:
  created:
    - apps/web/lib/api/managementRoi.ts
    - apps/web/app/(dashboard)/management-roi/page.tsx
  modified:
    - apps/web/lib/api/hotels.ts
    - apps/web/app/(dashboard)/settings/general/page.tsx
    - apps/web/components/shared/Sidebar.tsx

key-decisions:
  - "Used react-hook-form's setValueAs instead of the plan's suggested valueAsNumber for the ADR field — valueAsNumber together with a plain z.number().optional() zod schema produced a TS2322 resolver-type mismatch (zodResolver requires the parsed output type and the raw field type to align exactly); setValueAs normalizes blank/NaN input to undefined at the form layer instead, keeping the zod schema simple and the types correct."
  - "Work Order SLA and Mean Time To Repair are rendered as a single Stat card (value = sla_compliance_pct%, hint = MTTR in hrs) rather than two cards, since the plan describes them as one combined bullet ('Work Order SLA / Mean Time To Repair') and the Response section's other three bullets already fill the 4-column grid."
  - "Revenue Protected section renders 3 Stat cards (not 4, unlike the other three sections) — matches the plan's own bullet list for that section exactly; the 4-column responsive grid still lays these out cleanly at 3 items."

patterns-established:
  - "Nine-query GM dashboard fan-out: nine independent useQuery calls (seven ROI endpoints + guest-recovery + maintenance), each gated by enabled: isGM and keyed by the shared date range, aggregated into per-section loading/error/empty derivations rather than one combined isLoading flag"

requirements-completed: [D-06, D-07]

# Metrics
duration: ~55 min active
completed: 2026-07-24
---

# Phase 5 Plan 10: ADR Setting + Management ROI Dashboard Summary

**GM-configured Average Daily Rate (dollars-in-UI/cents-in-API) on Settings > General, a typed client for all seven `/reports/roi/*` endpoints, and a new GM-only `/management-roi` page organizing housekeeping efficiency, inspection quality, guest/maintenance response, and revenue-protected metrics into four `Stat`-card sections plus exception tables and a 7-day forecast strip — reachable only from the GM sidebar, in English and Spanish.**

## Performance

- **Duration:** ~55 min active work (3 tasks, all `type="auto"`)
- **Started:** 2026-07-24 (session start, after worktree base correction)
- **Completed:** 2026-07-24
- **Tasks:** 3/3
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `apps/web/lib/api/hotels.ts` now carries `average_daily_rate_cents` on both `UpdateHotelData` and the hotel response shape.
- Settings > General has a new "Average Daily Rate ($)" field with a `$` adornment, dollars-to-cents conversion at exactly one boundary (submit), cents-to-dollars at load and on Discard/reset, and helper text pointing to the Management ROI dashboard.
- `apps/web/lib/api/managementRoi.ts` created: 9 exported interfaces + `managementRoiApi` with one typed method per `/reports/roi/*` endpoint, field names reconciled against `05-06-SUMMARY.md`'s endpoint reference table.
- `apps/web/app/(dashboard)/management-roi/page.tsx` created: GM-only gate with zero queries issued for non-GMs, a cloned `DateRangeSelector`, nine parallel `useQuery` calls, four `Stat`-card sections (Time Saved/`--ready`, Quality/`--info`, Response/`--caution`, Revenue Protected/`--accent`), two exception tables (repeated PM deferrals, worst-downtime rooms), and a 7-day forecast strip with confidence `Pill`s.
- Unconfigured-ADR and all-zero states render honestly (`Not set` / `Not enough data yet`) — the file contains no literal `$0` fallback.
- Sidebar entry added: `/management-roi` (TrendingUp icon) in `ALL_NAV_ITEMS`, `NAV_BY_ROLE.gm` only, `NAV_LABEL_KEYS` → `nav.managementRoi`, and `INTELLIGENCE_HREFS`. Confirmed by direct array inspection that no other role's `NAV_BY_ROLE` entry includes `/management-roi`.
- `nav.managementRoi` already existed in both `en.ts` (`Management ROI`) and `es.ts` (`ROI Gerencial`) from plan 05-07 — no locale files needed changes.
- Web `type-check`, `lint`, and production `build` all pass (build required the same placeholder-Supabase-env workaround documented in `05-08-SUMMARY.md`, since this worktree has no local Supabase credentials — see Issues Encountered).

## Task Commits

Each task was committed atomically:

1. **Task 1: ADR setting on Settings > General plus the typed ROI client** - `b4379724` (feat)
2. **Task 2: The Management ROI dashboard page** - `0094a710` (feat)
3. **Task 3: GM-only sidebar entry for Management ROI** - `3da13c12` (feat)

## Files Created/Modified
- `apps/web/lib/api/hotels.ts` - added `average_daily_rate_cents?: number | null` to `UpdateHotelData` and the hotel response shape
- `apps/web/app/(dashboard)/settings/general/page.tsx` - new ADR form field (zod schema, hydration, save-time cents conversion, Discard-reset conversion)
- `apps/web/lib/api/managementRoi.ts` - typed client for all seven `/reports/roi/*` endpoints (new file)
- `apps/web/app/(dashboard)/management-roi/page.tsx` - GM-only ROI dashboard (new file)
- `apps/web/components/shared/Sidebar.tsx` - `/management-roi` nav entry, GM-only, translated

## Decisions Made
See `key-decisions` in frontmatter. Summary: (1) `setValueAs` instead of `valueAsNumber` on the ADR field to keep the zodResolver types aligned; (2) Work Order SLA / MTTR collapsed into one Stat card per the plan's own combined bullet; (3) Revenue Protected section intentionally has 3 Stat cards, matching the plan's bullet list exactly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a TypeScript resolver-type mismatch on the ADR field**
- **Found during:** Task 1, running `npm run type-check` after adding the ADR field per the plan's literal `register(..., { valueAsNumber: true })` guidance
- **Issue:** `register('average_daily_rate', { valueAsNumber: true })` combined with `z.number().min(0).max(100000).optional()` produced `TS2322`/`TS2345`: the resolver's expected input type included `average_daily_rate?: unknown`, which does not satisfy react-hook-form's `Resolver<TFieldValues>` constraint, breaking `handleSubmit`'s callback typing.
- **Fix:** Replaced `valueAsNumber: true` with `setValueAs: (v) => (v === '' || v === null || v === undefined ? undefined : Number(v))`, keeping the zod schema as a plain `z.number().min(0).max(100000).optional()`. This also fixes a latent UX bug the plan's literal approach would have introduced: `valueAsNumber` on an empty input yields `NaN`, which `z.number().optional()` rejects (only `undefined` is treated as "not provided"), so a blank ADR field would have failed validation instead of being treated as unset.
- **Files modified:** `apps/web/app/(dashboard)/settings/general/page.tsx`
- **Verification:** `npm run type-check` exits 0; `npm run build` completes; blank/cleared ADR field round-trips to `average_daily_rate_cents: undefined` in the save payload.
- **Committed in:** `b4379724` (Task 1 commit)

**2. [Rule 3 - Blocking] Installed `apps/web` dependencies before verification could run**
- **Found during:** Task 1, before the first `npm run type-check`
- **Issue:** Neither the repo root nor `apps/web/` had an installed `node_modules` in this fresh worktree (`apps/web` is not an npm workspace of the root `package.json` — a root-level `npm install` does not provision it).
- **Fix:** Ran `npm install --legacy-peer-deps` inside `apps/web/` (matching the documented workaround from `05-08-SUMMARY.md` and `05-09`'s node_modules note). Reverted the resulting `apps/web/package-lock.json` churn before every commit, per the executor's explicit instruction not to commit lockfile drift from this workaround.
- **Files modified:** none committed (lockfile churn discarded each time via `git checkout --`)
- **Verification:** `tsc`, `eslint`, and `next build` all resolve and run correctly afterward.
- **Committed in:** N/A (environment-only fix, no code committed)

---

**Total deviations:** 2 auto-fixed (1 bug fix improving on the plan's literal guidance, 1 blocking environment-provisioning fix)
**Impact on plan:** No behavioral change to the shipped feature beyond a more correct ADR-field type/UX handling. No scope creep.

## Issues Encountered
- **`npm run build` requires Supabase env vars that are intentionally absent locally**, exactly as documented in `05-08-SUMMARY.md`: `Sidebar.tsx` → `useAuth()` → `createClient()` throws at prerender time for every `(dashboard)` page (including the new `/management-roi` route) without `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Supplied placeholder values (`https://placeholder.supabase.co` / `placeholder-anon-key`, not committed anywhere) as inline env vars for the build command only, for all three verification builds (Tasks 1, 2, 3). This confirmed `/management-roi` and every other route prerender without error. Pre-existing environment condition, not introduced by this plan.
- **Live authenticated browser verification (the plan's `<verification>` "Live localhost... as GM" step, and the explicit sidebar-translation browser check called for by Task 3's acceptance criteria) was not performed.** Two compounding constraints in this specific run: (1) per CLAUDE.md's "Current Scope" section, this worktree has no local `.env` with real Supabase credentials, matching the same constraint flagged in `05-04-SUMMARY.md` and `05-08-SUMMARY.md`; (2) this plan executed as one of three concurrent parallel worktree agents (05-09, 05-10, 05-11) in the same wave, and ports 3000/8000/8003 were already occupied by another process at verification time — starting a competing dev server against those ports risked interfering with a sibling agent's in-flight verification. Instead, the sidebar translation was verified by code-path inspection: `navLabel = (label) => t(NAV_LABEL_KEYS[label] ?? label)` is the exact mechanism already proven correct in production for every other nav item (including the bug-448 regression fix for `nav.safety`/`nav.evidence`), `NAV_LABEL_KEYS['Management ROI'] = 'nav.managementRoi'` is present, and `nav.managementRoi` resolves to `'Management ROI'` in `en.ts` and `'ROI Gerencial'` in `es.ts` (confirmed via direct file read, not grep alone). All other verification (type-check, lint, production build, exhaustive grep against every plan acceptance criterion) passed. Recommend a single manual authenticated pass across `05-05` through `05-12`'s new UI once real local credentials are available, as already recommended in `05-08-SUMMARY.md`.

## User Setup Required
None - no external service configuration required. The ADR field writes through the already-GM-gated `PATCH /v1/hotels/{hotel_id}` endpoint (extended by plan 05-01); the ROI dashboard reads from endpoints already live from plan 05-06.

## Next Phase Readiness
- This is the phase's exit-criterion plan (D-06, D-07): a GM can configure the ADR and see time saved, quality, response, and revenue-protected metrics together on one page, with honest empty/unconfigured states and no per-domain tabs.
- No blockers for any other in-flight Phase 5 plan — this plan's files (`lib/api/hotels.ts`, `settings/general/page.tsx`, `lib/api/managementRoi.ts`, `management-roi/page.tsx`, `components/shared/Sidebar.tsx`) are not touched by any sibling plan in this wave (05-09, 05-11) per the plan's own `files_modified` scoping.
- Outstanding: the live authenticated GM browser pass across all of Phase 5's new UI (05-05 through 05-12), blocked on real local Supabase credentials, as tracked cumulatively since `05-04-SUMMARY.md`.

## Self-Check: PASSED

- `apps/web/lib/api/hotels.ts` — FOUND, contains `average_daily_rate_cents` (2 occurrences)
- `apps/web/app/(dashboard)/settings/general/page.tsx` — FOUND, contains ADR field (15 `average_daily_rate` occurrences, 1 `Math.round(values.average_daily_rate * 100)`)
- `apps/web/lib/api/managementRoi.ts` — FOUND, `export const managementRoiApi` present, 7 `/reports/roi/` calls, 9 `export interface` declarations
- `apps/web/app/(dashboard)/management-roi/page.tsx` — FOUND, starts with `'use client'`, 7 `managementRoiApi.` calls, 9 `enabled: isGM`, 17 `<Stat` usages, 0 `KpiCard`, 0 forbidden arbitrary px sizes, empty-state and unconfigured-ADR copy present verbatim, no literal `$0`
- `apps/web/components/shared/Sidebar.tsx` — FOUND, `/management-roi` present exactly 3 times (`ALL_NAV_ITEMS`, `NAV_BY_ROLE.gm`, `INTELLIGENCE_HREFS`), confirmed absent from every other role's array
- Commit `b4379724` (Task 1) — FOUND
- Commit `0094a710` (Task 2) — FOUND
- Commit `3da13c12` (Task 3) — FOUND

---
*Phase: 05-guest-recovery-and-management-roi*
*Completed: 2026-07-24*

---
phase: 30-additive-foundation-regression-harness
plan: 02
subsystem: feature-flag
tags: [migration, tenants, redesign-rollout, feature-flag]

# Dependency graph
requires: []
provides:
  - "supabase/migrations/097_web_redesign_sections.sql: tenants.web_redesign_sections text[] column"
  - "apps/api/routers/auth.py: /auth/me selects web_redesign_sections"
  - "apps/web/stores/hotelStore.ts: Hotel.web_redesign_sections field, Hotel type exported"
  - "apps/web/lib/utils/redesignFlag.ts: isSectionRedesigned(section, hotel)"
  - "apps/web/components/shared/RedesignGate.tsx: <RedesignGate section v2 legacy> boundary component"
affects: ["31", "32", "33", "34", "35", "36"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "text[] per-tenant flag column mirroring the existing tenants.front_desk_modules precedent, read end-to-end through /auth/me -> Providers -> hotelStore -> a single gate component"

key-files:
  created:
    - supabase/migrations/097_web_redesign_sections.sql
    - apps/web/lib/utils/redesignFlag.ts
    - apps/web/lib/utils/redesignFlag.test.mjs
    - apps/web/components/shared/RedesignGate.tsx
  modified:
    - apps/api/routers/auth.py
    - apps/web/stores/hotelStore.ts
    - apps/web/components/shared/Providers.tsx
    - apps/web/lib/api/hotels.ts

key-decisions:
  - "text[] of section keys, not a boolean, per CONTEXT.md's locked per-section granularity requirement — a single boolean can't express 'tasks is v2 but engineering is still legacy' for the same tenant"
  - "DB/admin-flipped only, no GM-facing settings UI — matches the tenants.opera_pilot_enabled precedent; this phase ships the mechanism only"
  - "Single boundary component (RedesignGate) rather than scattered isSectionRedesigned() checks through business logic, so the eventual cleanup (once all tenants migrate) is a delete-the-wrapper operation, not a grep-and-remove hunt"
  - "Section-key naming convention seeded for later phases to use verbatim: shell, tasks, engineering, housekeeping (and by extension one key per redesigned section as Phases 31-36 land)"

patterns-established:
  - "Feature-gate a section by wrapping its top-level entry point in <RedesignGate section=\"x\" v2={...} legacy={...} />, never by threading the check into data-fetching or business logic"

# Metrics
duration: ~20min (across two sessions — Tasks 1-2 completed before a session-limit interruption, Task 3 completed and verified afterward)
completed: 2026-08-14
---

# Phase 30 Plan 02: Per-Section Feature Flag Summary

**Per-tenant `text[]` column (`web_redesign_sections`) surfaced through `/auth/me` to a single `RedesignGate` boundary component, giving Phases 31-36 a mechanism to roll each redesigned section out per-tenant without a GM-facing toggle or a big-bang cutover.**

## Accomplishments
- Migration 097: `tenants.web_redesign_sections TEXT[] NOT NULL DEFAULT '{}'`, documented inline, with a rollback comment
- `/auth/me` (`apps/api/routers/auth.py`) selects the new column into the hotel object
- Web-side threading mirrors the existing `front_desk_modules` pattern exactly: `hotelStore.ts` (field + exported `Hotel` type), `Providers.tsx` (response typing), `lib/api/hotels.ts` (client type)
- `isSectionRedesigned(sectionKey, hotel)` — pure helper, `hotel?.web_redesign_sections?.includes(sectionKey) ?? false`
- `<RedesignGate section v2 legacy>` — the single opt-in boundary; renders `v2` only when the tenant's array includes that section key, otherwise `legacy`
- 4 unit tests (Node's built-in `node --test`, no web unit-test runner exists in this repo) covering empty array, matching key, unrecognized key, and null/undefined hotel — all pass
- `npm run type-check` clean

## Task Commits

1. **Task 1: Migration 097 + /auth/me field** — `c83d1296` (feat)
2. **Task 2: Web types threading** — `a4bed617` (feat)
3. **Task 3: isSectionRedesigned + RedesignGate + test** — `49a7d67c` (feat)

## Files Created/Modified
- `supabase/migrations/097_web_redesign_sections.sql` — new column, comment, rollback note
- `apps/api/routers/auth.py` — `/auth/me` select list
- `apps/web/stores/hotelStore.ts` — field + exported `Hotel` interface
- `apps/web/components/shared/Providers.tsx` — response typing
- `apps/web/lib/api/hotels.ts` — client type
- `apps/web/lib/utils/redesignFlag.ts` — `isSectionRedesigned`
- `apps/web/lib/utils/redesignFlag.test.mjs` — 4 unit tests
- `apps/web/components/shared/RedesignGate.tsx` — boundary component

## Decisions Made
See `key-decisions` above (text[] over boolean, DB-flipped only, single-boundary gating, seeded section-key naming).

## Deviations from Plan

None — plan executed exactly as written. Execution spanned two sessions (a mid-flight session-usage-limit interruption after Tasks 1-2 committed; Task 3 was already fully written to disk but uncommitted when the interruption hit, verified against the plan spec, test-run, type-checked, and committed in the follow-up session without changes).

## Issues Encountered

The executing agent hit a session usage limit partway through Task 3 (files written, not yet committed). No data was lost — Task 3's three files (`redesignFlag.ts`, `redesignFlag.test.mjs`, `RedesignGate.tsx`) and the `hotelStore.ts` `export interface Hotel` change were exactly as the plan specified, verified against `30-02-PLAN.md`'s literal Task 3 text before committing.

## User Setup Required

**Migration 097 must be applied to the live Supabase project.** This plan's executor has no Supabase MCP tool access (consistent with this project's established pattern — see `06-02`, `21-01`, `27-01`, `29-01` SUMMARYs for the same situation); the orchestrator (which has live Supabase MCP access this session) will apply it after this plan and 30-01/30-04's migrations are all ready, batched.

## Next Phase Readiness

- FOUND-06 met: a per-tenant, per-section flag exists end-to-end (DB → API → web store → gate component), no GM UI, no business-logic entanglement
- Phases 31-36 opt each redesigned section in by wrapping its entry point in `<RedesignGate section="x" v2={...} legacy={...} />` using the seeded key convention (shell, tasks, engineering, housekeeping, etc.)
- Plan 30-06 will not need to touch this plan's files — this plan doesn't produce a CI gate itself (FOUND-06 has no CI enforcement requirement, unlike FOUND-02/04/05)

---
*Phase: 30-additive-foundation-regression-harness*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: supabase/migrations/097_web_redesign_sections.sql
- FOUND: apps/web/lib/utils/redesignFlag.ts
- FOUND: apps/web/components/shared/RedesignGate.tsx
- FOUND: apps/web/lib/utils/redesignFlag.test.mjs
- FOUND: commit c83d1296 (Task 1)
- FOUND: commit a4bed617 (Task 2)
- FOUND: commit 49a7d67c (Task 3)
- VERIFIED: 4/4 unit tests pass (node --test)
- VERIFIED: npm run type-check clean

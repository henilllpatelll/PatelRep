# Phase 40: GM Morning Brief Dashboard Wiring - Context

**Gathered:** 2026-09-17
**Status:** Ready for planning
**Mode:** Autonomous (user delegated all decisions — picked "dashboard wiring" from a menu of three findings surfaced at the end of Phase 39's verification; continuing the same fully-autonomous loop established across Phases 38-39. No interactive discussion was run; decisions below are Claude's, grounded in a direct read of `SimplifiedDashboard.tsx`, `OvernightRecapStrip.tsx`, `useArrivalReadiness.ts`, and the Logbook page's existing role-gating precedent, done immediately before writing this file.

<domain>
## Phase Boundary

**The core finding from Phase 39's verification:** `OvernightRecapStrip.tsx` (the component 39-04 correctly extended with acknowledgment UI) and its assumed parent, `useArrivalReadiness()`, are never actually rendered anywhere in the live app. `/dashboard` unconditionally renders `SimplifiedDashboard.tsx` (confirmed via `apps/web/app/(dashboard)/dashboard/page.tsx`), which is a separate, ~950-line, already-live, shared-across-all-roles component with its own entirely different "AI briefing hero" mechanism (`briefingView`/`renderBriefingCell`) — a client-computed synthetic briefing derived from already-fetched board/risk data, with zero backend AI call, zero relation to the `shift_summaries`/`generate_shift_summary` AI engine Phase 39 built on.

**This phase's job:** wire the real, AI-generated, acknowledgeable overnight shift-summary recap into `SimplifiedDashboard.tsx` as an additional, small, additive surface — NOT a replacement for or merge into the existing synthetic briefing hero (they serve different purposes: hero = "live current-state snapshot," new strip = "what happened overnight, written by the real AI shift-summary engine, needs acknowledgment"). This directly closes the gap Phase 39 discovered: the enriched, acknowledgeable AI summary work is fully live on the backend but was invisible to any real GM.

**Explicitly NOT in scope:**
- Importing or resurrecting the full `useArrivalReadiness()` hook (it fires 5 queries — board, work-orders, risk-alerts, roster, logbook — 4 of which `SimplifiedDashboard` already fetches independently under different query keys; importing the whole hook would double up redundant network calls and risk showing inconsistent numbers between the hero and the unused hook's parallel copies of the same data).
- Touching, fixing, or retiring `useArrivalReadiness.ts`, `ArrivalReadinessHero.tsx`, `OnShiftBoard.tsx`, `RoomBlockersList.tsx`, `TrendChartsRow.tsx`, `ROIMetricsStrip.tsx` — all remain orphaned/unused after this phase; whether to wire them in elsewhere or delete them is a separate decision, not this phase's job.
- Restructuring, refactoring, or otherwise modifying any existing logic, query, or layout in `SimplifiedDashboard.tsx` beyond the one additive block described below. This is a live, heavily-used, ~950-line shared component — the Non-Regression Policy applies strictly here.
- Fixing the two OTHER pre-existing bugs Phase 39 found (the `shift_id: 'today'` Logbook generate-button bug, and the `PGRST205` logbook-entry-creation issue) — separate, deferred findings, not this phase's job.
- Any change to the backend (migration 105, the enrichment logic, the acknowledge endpoint) — all already shipped and live-verified in Phase 39. This phase is web-UI-only.

</domain>

<decisions>
## Implementation Decisions

### Data wiring (in `SimplifiedDashboard.tsx`)
Add a small, self-contained block — NOT the full `useArrivalReadiness` hook — replicating only the exact logic already proven correct in `useArrivalReadiness.ts` lines 293-326 (the `overnightBase` → `overnightAckQuery` → `overnightSummary` chain):

1. **New query** for today's AI-generated logbook entry:
   ```ts
   const overnightLogbookQuery = useQuery({
     queryKey: ['gm-overnight-summary', todayISO],
     queryFn: () => logbookApi.listEntries({ entry_date: todayISO, per_page: 20 }),
     staleTime: 120_000,
     refetchInterval: 120_000,
   })
   ```
   Reuse the `todayISO` constant already computed at the top of `SimplifiedDashboard` (line ~592) — do not recompute a second "today" value. The query key `['gm-overnight-summary', todayISO]` is LOCKED — `OvernightRecapStrip`'s own internal acknowledge-mutation `onSuccess` invalidates exactly this key (plus `['overnight-shift-summary']`), so it must match verbatim for the strip's own re-fetch-after-acknowledge to work.

2. **`overnightBase` useMemo** — copy verbatim from `useArrivalReadiness.ts` lines 296-303 (filters `is_ai_generated` entries, sorts by `created_at`, takes the earliest, returns `{ text, href: '/logbook', shiftId }` or `null`).

3. **`overnightAckQuery`** — copy verbatim from `useArrivalReadiness.ts` lines 309-314 (`queryKey: ['overnight-shift-summary', overnightShiftId]`, `queryFn: () => logbookApi.getShiftSummary(overnightShiftId as string)`, `enabled: !!overnightShiftId`, `retry: false`). This query key is also LOCKED for the same invalidation-matching reason.

4. **`overnightSummary` useMemo** — copy verbatim from `useArrivalReadiness.ts` lines 316-326, producing the exact `OvernightSummary` shape `OvernightRecapStrip` already consumes (`text`, `href`, `id`, `acknowledgedAt`, `acknowledgedByName`).

5. Import `OvernightSummary` as a **type-only** import from `@/lib/hooks/useArrivalReadiness` (reuse the existing exported interface — do not redefine it locally or duplicate it into a new file). Import `logbookApi` from `@/lib/api/logbook` and `OvernightRecapStrip` from `./OvernightRecapStrip`.

### Role gating
Show the strip only to roles that receive shift handoffs on the Logbook page today: `gm` and `housekeeping_supervisor` — i.e., reuse `useRole()`'s existing `isSupervisor` flag (`SUPERVISOR_ROLES = ['gm', 'housekeeping_supervisor']` in `useRole.ts`), matching the exact gate `AISummaryPanel` already uses on the Logbook page (`if (!isSupervisor) return null`) for consistency. `SimplifiedDashboard` already calls `useRole()` and destructures `role` — add `isSupervisor` to that same destructure, do not add a second `useRole()` call. Do not invent a broader or narrower role set than this existing precedent.

### Placement
Render `<OvernightRecapStrip summary={overnightSummary} isLoading={overnightLogbookQuery.isLoading} />` as its own row, positioned **between the Greeting row and the "AI briefing hero" section** (i.e., right after the `<div className="shrink-0 flex items-end justify-between gap-6">...</div>` greeting block, before the `<section className="shrink-0 relative overflow-hidden rounded-[var(--r-xl)] bg-ink text-paper shadow-card">` hero) — a morning brief reads first, before the live-state hero. Wrap the render in the `isSupervisor` gate (render nothing, not even a loading skeleton, for roles that don't qualify). Do not place it inside, above, or competing with the hero's own grid/cross-fade layout — it is a fully separate, self-contained `Card` element per `OvernightRecapStrip`'s own existing implementation (already handles its own loading skeleton, its own "no summary yet" empty state, and its own acknowledge button/badge — no changes needed to `OvernightRecapStrip.tsx` itself, it is complete and correct from Phase 39).

### What NOT to touch
- `OvernightRecapStrip.tsx` needs zero code changes — it is already complete, correct, and type-safe from Phase 39-04. This phase only wires data INTO it.
- i18n: all five translation keys `OvernightRecapStrip` uses (`dashboard.gm.overnightTitle`, `readFullRecap`, `noOvernightSummary`, `acknowledge`, `acknowledged`) already exist in both `apps/web/i18n/locales/en.ts` (confirmed, lines 184-188) and presumably `es.ts` (verify at plan time, but do not assume missing — check before adding).
- No new backend calls beyond the three `logbookApi` methods already shipped and tested in Phase 39 (`listEntries`, `getShiftSummary`, `acknowledgeShiftSummary`).

### Claude's Discretion
- Exact insertion point in JSX if the greeting/hero boundary described above turns out to have some wrapping element not captured in this description — the intent (between greeting and hero, own row, gated to isSupervisor) is locked; the literal JSX mechanics are not.
- Whether to add a brief code comment explaining why this block duplicates rather than imports `useArrivalReadiness` (recommended, given the Deferred Ideas section below is exactly the kind of thing a future reader might wonder about) — not required.
- Test file naming/organization — follow this project's existing conventions for `SimplifiedDashboard`-adjacent tests, if any exist; if none exist for this component, a lightweight test is optional given the component is enormous and this is a small additive change verified primarily via live browser testing.

### Deferred Ideas (explicitly out of scope)
- Wiring in any other orphaned component from the `useArrivalReadiness` family (ArrivalReadinessHero, OnShiftBoard, RoomBlockersList, TrendChartsRow, ROIMetricsStrip).
- Retiring/deleting `useArrivalReadiness.ts` or its orphaned consumer components.
- Extending role visibility beyond `gm`/`housekeeping_supervisor` (e.g., to engineer/chief_engineer, even though the backend generate-endpoint technically allows those roles) — out of scope, follow existing Logbook-page precedent exactly.
- Fixing the `shift_id: 'today'` generate-button bug or the `PGRST205` logbook-entry-creation bug (separate Phase 39 findings).
- Any visual/layout redesign of the existing "AI briefing hero" section.

</decisions>

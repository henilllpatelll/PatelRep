---
phase: 40-gm-morning-brief-dashboard-wiring
plan: 01
subsystem: ui
tags: [react-query, dashboard, logbook, tsx]

requires:
  - phase: 39-01
    provides: "shift_summaries.acknowledged_by/acknowledged_at"
  - phase: 39-03
    provides: "acknowledge endpoint + logbookApi client methods"
  - phase: 39-04
    provides: "OvernightRecapStrip component (unchanged, wired in as-is)"
provides:
  - "Live, visible, acknowledgeable overnight AI shift-summary recap on the real GM dashboard (/dashboard, SimplifiedDashboard.tsx)"
affects: []

tech-stack:
  added: []
  patterns: ["duplicate a small proven query block rather than importing a large unused hook wholesale, to avoid redundant network calls against an already-fetching component"]

key-files:
  created: []
  modified:
    - apps/web/components/dashboard/SimplifiedDashboard.tsx

key-decisions:
  - "Did not import the full useArrivalReadiness() hook — copied only its overnightBase/overnightAckQuery/overnightSummary logic (3 small blocks) into SimplifiedDashboard directly, since the hook's other 4 queries (board/work-orders/risk-alerts/roster) duplicate what SimplifiedDashboard already fetches independently under different query keys."
  - "Query keys ['gm-overnight-summary', todayISO] and ['overnight-shift-summary', overnightShiftId] were locked to match exactly what OvernightRecapStrip's own internal acknowledge-mutation invalidates — verified this works live (acknowledge → automatic refetch → badge updates, no manual invalidation wiring needed in SimplifiedDashboard itself)."
  - "Gated to isSupervisor (gm + housekeeping_supervisor) via the existing useRole() hook already called in this component — matches the Logbook page's AISummaryPanel gate exactly, no new role logic invented."

patterns-established: []

duration: ~20min
completed: 2026-09-17
---

# Phase 40 Plan 01: Wire OvernightRecapStrip into the Live GM Dashboard Summary

**The overnight AI shift-handover recap (enriched with VIP/guest-issue/low-stock/SLA-breach signals in Phase 39, but invisible until now) is live on the real `/dashboard` — visible to GM and housekeeping supervisors, acknowledgeable in place, with zero regression to the existing AI briefing hero.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-09-17
- **Tasks:** 2/2 completed
- **Files modified:** 1

## Accomplishments
- Added 3 imports, extended the existing `useRole()` destructure with `isSupervisor`, added a 4-block additive data-wiring section (query + 2 memos + 1 dependent query) reusing the already-computed `todayISO`, and one gated JSX render — all in `SimplifiedDashboard.tsx`, purely additive (47 insertions, 1 line changed).
- `npx tsc --noEmit` clean.
- Live-verified end to end in a real browser session (playwright-cli, Chrome extension not connected): logged in as the GM test account, confirmed the strip renders between the greeting and the AI briefing hero showing the seeded overnight summary text, clicked Acknowledge, confirmed it flipped to "✓ Acknowledged" without a page reload, confirmed the write persisted in the live database (`acknowledged_by`/`acknowledged_at` set correctly), confirmed zero new console errors, and confirmed the AI briefing hero and rest of the dashboard render identically to before (non-regression). Screenshot captured and reviewed, then discarded (scratch verification artifact).
- Full backend suite re-confirmed 720/720 green (this phase is frontend-only, but re-ran as a final sanity check per established practice).

## Task Commits

1. **Task 1: Add overnight recap data wiring + gated render** — `3d2cd673` (feat)
2. **Task 2: Live browser verification** — no code commit (verification-only); findings captured in this SUMMARY.

## Files Created/Modified
- `apps/web/components/dashboard/SimplifiedDashboard.tsx` — added the overnight-recap query block and gated `<OvernightRecapStrip>` render.

## Decisions Made
See `key-decisions` in frontmatter above.

## Deviations from Plan
None — plan executed exactly as written. The one contingency the plan flagged (needing to reset or reseed a fixture if the existing Phase 39 test row's date had rolled over) turned out to already be same-day (hotel-local `America/Chicago` "today" is still `2026-09-16`, matching the existing seeded row) — only needed to reset `acknowledged_at`/`acknowledged_by` back to `NULL` via Supabase MCP to test the fresh acknowledge flow, not reseed new rows.

## Issues Encountered
None. The role-gate (`isSupervisor`) was verified by source-code correctness rather than a second live login as a non-supervisor role — it's a one-line boolean-guarded conditional render reusing an already-proven, already-tested hook (`useRole()`'s `isSupervisor`, identical to the pre-existing gate on the Logbook page's `AISummaryPanel`), so a second account round-trip wasn't judged necessary for this specific, low-complexity check.

## User Setup Required
None.

## Next Phase Readiness
Phase 40 closes the "dashboard wiring" gap identified during Phase 39's verification. The AI shift-handover + GM morning brief feature (research doc opportunity #2) is now fully live end-to-end: enriched AI summary generation (backend, cron-driven) → acknowledgeable recap on the GM/supervisor dashboard → persisted acknowledgment. The other two findings from Phase 39 (the Logbook page's broken `shift_id: 'today'` generate button, and the live-environment-only `PGRST205` logbook-entry-creation issue) remain open, separate, deferred items.

---
*Phase: 40-gm-morning-brief-dashboard-wiring*
*Completed: 2026-09-17*

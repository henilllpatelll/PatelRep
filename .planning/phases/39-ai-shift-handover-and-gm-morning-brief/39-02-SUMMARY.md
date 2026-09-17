---
phase: 39-ai-shift-handover-and-gm-morning-brief
plan: 02
subsystem: ai-services
tags: [ai, shift-summary, anthropic, enrichment, inventory, guest-requests, sla]

requires:
  - "shift_summaries.stats JSONB (migration 012)"
provides:
  - "generate_shift_summary() enriched with VIP arrivals, pending guest issues, low-stock parts, SLA breaches"
  - "shift_summaries.stats keys: vip_arrivals_count, pending_guest_issues_count, low_stock_parts_count, sla_breaches_count"
affects: [39-03, 39-04, 39-05]

tech-stack:
  added: []
  patterns:
    - "reuse locked predicates inline (do not import routers) to keep the flat services layer — replicate two-query low-stock pattern from inventory.py rather than importing it"
    - "prompt renders [:10] cap while stats stores full len() — matches existing completed_tasks[:20]/open_work_orders[:10] truncation style"

key-files:
  created:
    - apps/api/tests/test_shift_summary_enrichment.py
  modified:
    - apps/api/services/ai/shift_summary.py

key-decisions:
  - "Engineering parts only (no housekeeping_supply_pars) per CONTEXT discretion — kept the query surface tight."
  - "Guest-issue label uses guest_requests.title (short human-readable) with description fallback; request_type is not a selected column in guest_requests.py."
  - "Low-stock predicate replicated inline (active engineering_parts + summed engineering_part_stock, total < float(minimum_stock or 0)) rather than importing inventory._total_on_hand_map, per CLAUDE.md A1 flat-services rule."
  - "SLA-breach ground truth = status IN (open,in_progress) AND due_at < now() for both work_orders and tasks — combined count, mirrors internal.py check_escalations; escalation_level deliberately NOT used as the signal."

patterns-established: []

metrics:
  duration: ~15min
  tasks: 2
  files: 2
completed: 2026-09-16
---

# Phase 39 Plan 02: Shift-Summary AI Enrichment Summary

**`generate_shift_summary()` now pulls four additional tenant-scoped signals — VIP arrivals, pending guest issues, low-stock engineering parts, and SLA-breached WOs+tasks — into the prompt (each capped at 10 rendered items) and records four additive full-count keys in the `stats` JSONB.**

## Performance
- **Duration:** ~15 min
- **Completed:** 2026-09-16
- **Tasks:** 2/2 completed
- **Files:** 2 (1 modified, 1 created)

## Accomplishments
- Added four new queries inside `generate_shift_summary()` after the existing open-work-orders step, each guarded to `[]` on empty:
  - **VIP arrivals** — `room_status` where `clean_type='DEP'` AND `vip_flag=true`, `rooms!inner(room_number)` join; collects room numbers.
  - **Pending guest issues** — `guest_requests` with `.not_.in_("status", ["resolved","verified","cancelled"])`; collects title (description fallback).
  - **Low-stock parts** — active `engineering_parts` + summed `engineering_part_stock.quantity`, kept where `total < float(minimum_stock or 0)`; collects part names.
  - **SLA breaches** — `work_orders` and `tasks` where `status IN ('open','in_progress')` AND `due_at < now_iso`; combined titles, combined count.
- Rendered four new prompt sections (`VIP ARRIVALS TODAY`, `PENDING GUEST ISSUES`, `LOW-STOCK PARTS`, `SLA BREACHES`) in the existing `- item` bullet style with `[:10]` caps and `No ...` fallbacks.
- Added a 5th writing-guidance instruction bullet directing the model to flag those four signals for the next shift.
- Extended `stats` with `vip_arrivals_count`, `pending_guest_issues_count`, `low_stock_parts_count`, `sla_breaches_count` (full un-truncated counts). The four pre-existing keys, the `anthropic` model call, `credits_charged: 3.0`, and the `ai_interactions` insert are all untouched.
- Added `from datetime import datetime, timezone` and `now_iso = datetime.now(timezone.utc).isoformat()`.
- Created `test_shift_summary_enrichment.py` (6 tests, all green) with a fake-Supabase harness supporting `.not_.in_` and `.lt`, plus a stubbed `anthropic.Anthropic` so no network call is made.

## Task Commits
1. **Task 1: Enrichment queries, prompt sections, stats keys** — `f5ffa736`
2. **Task 2: Enrichment test file** — `a5999e19`

## Files Created/Modified
- **Modified:** `apps/api/services/ai/shift_summary.py`
- **Created:** `apps/api/tests/test_shift_summary_enrichment.py`

## Verification
- `python -c "import ast; ast.parse(...)"` on the service file parses clean.
- `python -m pytest tests/test_shift_summary_enrichment.py -v` → **6 passed** (VIP/guest/low-stock/SLA counts, terminal-status exclusion, low-stock boundaries, SLA future/non-open exclusion, additive-stats guarantee, full-count-vs-cap). No real anthropic call.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
- First test run failed because `datetime.datetime.now` is an immutable C-type attribute and cannot be monkeypatched directly. Fixed by replacing the module-level `datetime` name (`shift_summary_module.datetime`) with a fake datetime class exposing a `now()` staticmethod. Tests green after that.

## Coordination Note
Stayed strictly within this plan's file list. Did NOT touch `apps/api/routers/logbook.py` or `apps/web/lib/api/logbook.ts` (the acknowledge-endpoint additions owned by plan 39-03, running concurrently in the same wave).

## Next Phase Readiness
The enriched summary inputs are in place. Plan 39-03's acknowledge endpoint and the UI plans (39-04/05) are unaffected by these service-layer changes. No blockers.

## Self-Check: PASSED
- Files: shift_summary.py, test_shift_summary_enrichment.py, 39-02-SUMMARY.md — all FOUND.
- Commits: f5ffa736, a5999e19 — both FOUND.

---
*Phase: 39-ai-shift-handover-and-gm-morning-brief*
*Completed: 2026-09-16*

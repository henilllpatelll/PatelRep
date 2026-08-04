---
phase: 17-backlog-cleanup
plan: 07
subsystem: database
tags: [postgres, supabase, ai_interactions, check-constraint, migration]

requires:
  - phase: 13-ai-copilot-reliability
    provides: "migration 088, which documented the interaction_type CHECK constraint drift this plan closes"
provides:
  - "Migration 091 widening ai_interactions_interaction_type_check to cover all 14 real-in-use interaction_type values"
affects: [ai-copilot, ai_interactions logging, billing/credit-usage stats]

tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - supabase/migrations/091_ai_interactions_widen_interaction_type.sql
  modified: []

key-decisions:
  - "Migration is additive only: kept all 9 previously-allowed values, added the 5 confirmed-in-use-but-rejected values (work_order_creation, guest_request_creation, task_assignment, general, housekeeping_briefing). Did not remove the 3 allowed-but-unused values (room_prediction, failure_prediction, assignment_suggestion) - left for forward-compat since those flows write directly to their own tables today."
  - "Not applied to remote Supabase project in this plan, per established milestone convention (086, 087, 089, 090 all followed the same split) - executor writes the file, a separate orchestrator step with Supabase MCP access applies it live."

patterns-established: []

duration: 5min
completed: 2026-08-04
---

# Phase 17 Plan 07: Widen ai_interactions interaction_type CHECK constraint Summary

**Migration 091 widens `ai_interactions_interaction_type_check` from 9 to 14 allowed values, closing the 4x-deferred DATA-01 gap where `general` and 4 other real-in-use interaction types 400/500'd on write.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-08-04T00:00:00Z (approx)
- **Completed:** 2026-08-04
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Root cause (already confirmed by 17-RESEARCH.md) closed: live constraint only allowed 9 values while 5 real `log_ai_interaction(interaction_type=...)` call sites in `apps/api` use values outside that set.
- New migration `091_ai_interactions_widen_interaction_type.sql` adds `work_order_creation`, `guest_request_creation`, `task_assignment`, `general` (the `ai_copilot.py` unmapped-intent default), and `housekeeping_briefing` to the CHECK constraint.
- Change is additive-only: all 9 previously-allowed values retained, nothing removed.

## Task Commits

1. **Task 1: Write migration 091 widening the interaction_type CHECK constraint** - `7bd278e4` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `supabase/migrations/091_ai_interactions_widen_interaction_type.sql` - drops and recreates `ai_interactions_interaction_type_check` with all 14 real-in-use values

## Decisions Made
- Kept the 3 allowed-but-currently-unused values (`room_prediction`, `failure_prediction`, `assignment_suggestion`) in the new constraint rather than removing them — those code paths write to their own tables directly today, not via `log_ai_interaction`, so removing them would be an unrelated scope-narrowing change with no upside.
- Did not apply the migration to the remote Supabase project, matching the established convention for every prior migration-writing plan this milestone (086, 087, 089, 090) — this sandboxed executor has no Supabase MCP tool access.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**External service requires manual configuration.** Migration 091 must be applied to the remote Supabase project (`oacnwalhcpqdabivweki`) before DATA-01 is functionally closed:
- Apply via `mcp__plugin_supabase_supabase__apply_migration` or the Supabase CLI, using the exact SQL in `supabase/migrations/091_ai_interactions_widen_interaction_type.sql`.
- Verify via `pg_get_constraintdef` (or equivalent) that all 14 values are present on `ai_interactions_interaction_type_check`.
- This mirrors the exact same pending-apply pattern as migrations 086, 087, 089, and 090 in this milestone.

## Next Phase Readiness
- Migration file is ready for the orchestrator/human apply step. Once applied, logging an AI interaction with `general`, `work_order_creation`, `guest_request_creation`, `task_assignment`, or `housekeeping_briefing` will succeed instead of 400/500ing, closing DATA-01 and ROADMAP Phase 17 success criterion 5.
- No blockers for other Phase 17 plans — this plan had no dependencies and no dependents declared.

---
*Phase: 17-backlog-cleanup*
*Completed: 2026-08-04*

## Self-Check: PASSED
- FOUND: supabase/migrations/091_ai_interactions_widen_interaction_type.sql
- FOUND: commit 7bd278e4
- FOUND: .planning/phases/17-backlog-cleanup/17-07-SUMMARY.md

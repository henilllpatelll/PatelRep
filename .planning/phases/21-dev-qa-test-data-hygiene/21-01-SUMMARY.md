---
phase: 21-dev-qa-test-data-hygiene
plan: 01
subsystem: database
tags: [supabase, postgres, migration, tenants, qa, test-data]

# Dependency graph
requires: []
provides:
  - "tenants.is_test BOOLEAN NOT NULL DEFAULT false column, live on oacnwalhcpqdabivweki"
  - "9 non-fixture tenants flagged is_test=true; PRESERVE fixture 23264962-aa09-4e4f-a49d-fc345cc91414 flagged is_test=false"
  - "Migration 094 on disk as source-of-truth for the is_test column"
affects: [21-02, 21-03]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Boolean tenant-flag migration idiom (mirrors 085_opera_pilot_flag.sql): ALTER TABLE ... ADD COLUMN IF NOT EXISTS ... COMMENT ON COLUMN ... with a commented-out ROLLBACK line"]

key-files:
  created: [supabase/migrations/094_tenant_is_test_flag.sql]
  modified: []

key-decisions:
  - "Flagged is_test=true by excluding the locked PRESERVE fixture (WHERE id <> fixture-uuid) rather than an explicit IN-list of candidate UUIDs, because the research doc's prose count (10) and its inventory table (9 UUIDs) disagreed — exclusion-based scoping is correct regardless of which count is right and self-corrects if the tenant set drifts before Plan 03 runs."
  - "Migration applied to the live dev/QA project via Supabase MCP apply_migration (not `supabase db push`), consistent with the established project convention documented in migrations 085 and 093 — this executor has no Supabase MCP tool access and did not attempt any live DB call."

patterns-established:
  - "Boolean tenant-flag migration idiom (mirrors 085_opera_pilot_flag.sql): ALTER TABLE ... ADD COLUMN IF NOT EXISTS ... COMMENT ON COLUMN ... with a commented-out ROLLBACK line"

# Metrics
duration: 5min
completed: 2026-08-05
---

# Phase 21 Plan 01: Tenant is_test Flag Summary

**Added `tenants.is_test BOOLEAN NOT NULL DEFAULT false` (migration 094) and flagged 9 of 10 tenants on the dev/QA project as test data, preserving the one standing QA fixture.**

## Performance

- **Duration:** ~5 min (file + git work; DB work performed and verified by the orchestrator via Supabase MCP prior to this execution)
- **Started:** 2026-08-05T07:46:00Z
- **Completed:** 2026-08-05T07:52:00Z
- **Tasks:** 2 completed
- **Files modified:** 1

## Accomplishments
- `supabase/migrations/094_tenant_is_test_flag.sql` created on disk, mirroring the `085_opera_pilot_flag.sql` idiom verbatim (Task 1)
- Migration applied live to the dev/QA Supabase project `oacnwalhcpqdabivweki` via MCP `apply_migration` (name `tenant_is_test_flag`) by the orchestrator, and independently confirmed via `information_schema.columns`: `column_name=is_test`, `data_type=boolean`, `is_nullable=NO`, `column_default=false` — Phase Success Criterion #1 satisfied
- All non-fixture tenants flagged `is_test=true` via `UPDATE public.tenants SET is_test = true WHERE id <> '23264962-aa09-4e4f-a49d-fc345cc91414'` (Task 2), executed and verified by the orchestrator via MCP `execute_sql`
- Confirmed distribution: `is_test=false` → 1 row (the PRESERVE fixture `23264962-aa09-4e4f-a49d-fc345cc91414`), `is_test=true` → **9 rows** (actual flagged count — resolves the research doc's 9-vs-10 discrepancy in favor of 9, the count enumerated in its own inventory table)
- Fixture row `23264962-aa09-4e4f-a49d-fc345cc91414` independently confirmed `is_test=false`

## Task Commits

Each task was committed atomically:

1. **Task 1: Write and apply migration 094 (is_test column)** - `b0e5978d` (feat) — file authored and committed here; live `apply_migration` call and schema verification performed by the orchestrator via Supabase MCP (this executor has no Supabase MCP tool access)
2. **Task 2: Flag every non-fixture tenant is_test = true** - no separate commit (no file change; `<files>` for this task is the same `094_tenant_is_test_flag.sql`, already committed under Task 1) — live `UPDATE` and verification performed by the orchestrator via Supabase MCP

**Plan metadata:** (this commit) `docs(21-01): complete tenant is_test flag plan`

_Note: Tasks 1 and 2 share a single on-disk artifact (the migration file); the only code change to commit was Task 1's file, so Task 2 has no independent commit — its work was a live data write performed by the orchestrator, not a file change._

## Files Created/Modified
- `supabase/migrations/094_tenant_is_test_flag.sql` - Adds `tenants.is_test BOOLEAN NOT NULL DEFAULT FALSE` with column comment and rollback instructions

## Decisions Made
- Excluded the fixture rather than enumerating candidate UUIDs for the flagging UPDATE (see key-decisions above) — self-correcting regardless of the exact candidate count.
- DB application performed by the orchestrator via Supabase MCP `apply_migration`/`execute_sql` because this plan's executor sandbox has no Supabase MCP tool access; this mirrors the established project pattern from migrations 085 (Phase 6) and 093 (Phase 20), where the same tool-access split occurred.

## Deviations from Plan

None — plan executed exactly as written. The DB-application steps described in Tasks 1 and 2 (`apply_migration`, `execute_sql` UPDATE and verification queries) were performed by the orchestrator ahead of this execution, per the plan's own fallback instruction ("If the Supabase MCP tools are not available in your execution context... SendMessage the lead... treat this task as blocked pending that confirmation") — the confirmation was already in hand at the start of this execution, so no blocking occurred.

## Issues Encountered

None. No destructive operations were performed; no `--execute` flag was passed anywhere; no rows were deleted.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `tenants.is_test` is live and correctly flagged, unblocking Plan 21-02 (whatever it builds against the flag) and Plan 21-03 (the cleanup script, which intersects `is_test = true` with a hardcoded allowlist constant per the plan's stated belt-and-suspenders design).
- No blockers.

---
*Phase: 21-dev-qa-test-data-hygiene*
*Completed: 2026-08-05*

## Self-Check: PASSED

- FOUND: `supabase/migrations/094_tenant_is_test_flag.sql`
- FOUND: `.planning/phases/21-dev-qa-test-data-hygiene/21-01-SUMMARY.md`
- FOUND: commit `b0e5978d`

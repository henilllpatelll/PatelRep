---
phase: 38-engineering-work-order-labor-and-cost-capture
plan: 01
subsystem: database
tags: [postgres, supabase, migration, work-orders, inventory]

requires: []
provides:
  - "user_roles.hourly_rate (nullable NUMERIC(8,2))"
  - "engineering_parts.unit_cost (nullable NUMERIC(10,2))"
  - "work_orders.labor_cost / parts_cost / total_cost (nullable NUMERIC(10,2))"
affects: [38-02, 38-03, 38-04, 38-05]

tech-stack:
  added: []
  patterns: ["nullable cost columns computed in application code at completion time, not generated columns"]

key-files:
  created:
    - supabase/migrations/104_work_order_labor_cost_capture.sql
  modified: []

key-decisions:
  - "Applied live to the Supabase dev project (oacnwalhcpqdabivweki) via Supabase MCP tooling directly by the orchestrator, not the executor — matches this repo's established precedent that the gsd-executor agent has no Supabase MCP tool access (documented in prior phase summaries, e.g. Phase 21)."
  - "All five columns left nullable with no default, per CONTEXT.md's explicit NULL-means-unknown-never-zero rule."

patterns-established:
  - "Cost columns are plain nullable NUMERIC, not GENERATED ALWAYS AS — the computation joins across tables (user_roles, engineering_parts) and happens in application code, which Postgres generated columns can't express."

duration: 5min
completed: 2026-09-16
---

# Phase 38 Plan 01: Migration 104 — Labor/Cost Columns Summary

**Added `hourly_rate`, `unit_cost`, and `labor_cost`/`parts_cost`/`total_cost` columns across `user_roles`, `engineering_parts`, and `work_orders`, applied live to the Supabase dev project.**

## Performance

- **Duration:** ~5 min
- **Completed:** 2026-09-16
- **Tasks:** 2/2 completed
- **Files modified:** 1

## Accomplishments
- `supabase/migrations/104_work_order_labor_cost_capture.sql` written matching CONTEXT.md's locked schema verbatim (3 ALTER TABLE statements, 5 columns, 5 COMMENT ON COLUMN statements).
- Migration applied live to `oacnwalhcpqdabivweki` via `mcp__plugin_supabase_supabase__apply_migration`.
- Verified all 5 columns present via `information_schema.columns` query (exactly 5 rows returned).
- Verified via `get_advisors(type=security)` that no new security advisories reference any of the 5 new columns — RLS already covers `user_roles`/`engineering_parts`/`work_orders` from earlier migrations, no new policy needed for plain column additions.

## Task Commits

1. **Task 1: Write migration 104** — `5eeac12b` (feat, bundled with Task 2 in a single commit since both are part of the same atomic schema change)
2. **Task 2: Apply migration 104 live** — Supabase MCP call, no separate commit (database-side change, not a file change); verification results captured in this summary.

## Files Created/Modified
- `supabase/migrations/104_work_order_labor_cost_capture.sql` — the 5 new nullable columns.

## Decisions Made
- Task 2 (live apply + verify) was performed directly by the orchestrator using Supabase MCP tools rather than delegated to a gsd-executor subagent, since the gsd-executor agent definition has no MCP tool access (Read/Write/Edit/Bash/Grep/Glob only) — this matches the documented precedent from Phase 21 (`21-01-SUMMARY.md`: "Migration applied live to the dev/QA project ... via Supabase MCP apply_migration by the orchestrator (this executor has no Supabase MCP tool access)").
- Tasks 1 and 2 were bundled into a single git commit rather than two separate atomic commits, since Task 2 has no file-level output of its own (a live database mutation, not a code change) — the migration file commit already fully represents both tasks' output.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required (Supabase project was already provisioned and connected).

## Next Phase Readiness
Wave 2 (38-02: cost computation in `complete_work_order`; 38-03: unit_cost/hourly_rate CRUD + RBAC) can now read and write all 5 new columns against the live dev database. No blockers.

---
*Phase: 38-engineering-work-order-labor-and-cost-capture*
*Completed: 2026-09-16*

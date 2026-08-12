---
phase: 21-dev-qa-test-data-hygiene
plan: 03
subsystem: database
tags: [supabase, python, cleanup-script, tenancy, dry-run, fk-safe-delete]

# Dependency graph
requires:
  - phase: 21-dev-qa-test-data-hygiene (plan 01)
    provides: migration 094 (tenants.is_test flag, live-applied and populated)
  - phase: 21-dev-qa-test-data-hygiene (plan 02)
    provides: 21-ALLOWLIST.md — ratified PRESERVE/DELETE_ALLOWLIST constants
provides:
  - apps/api/scripts/cleanup_test_data.py — dry-run-default, allowlist-scoped, FK-safe cleanup tool for the 9 ratified test tenants
  - Verified-clean dry-run report (Success Criterion #4 evidence)
affects: [any future phase that needs to actually run --execute against the 9 allowlisted tenants]

# Tech tracking
tech-stack:
  added: []
  patterns: [dry-run-default CLI gating, fixpoint FK-violation retry loop for unordered deletes, is_test flag cross-check guardrail]

key-files:
  created: [apps/api/scripts/cleanup_test_data.py]
  modified: []

key-decisions:
  - "Table discovery attempts an information_schema RPC first, falls back to a documented explicit 85-table list (88 tenant-scoped tables minus the 2 excluded minus tenants) verified live against oacnwalhcpqdabivweki at authoring time — avoids hand-maintaining a list while staying correct if the RPC is unavailable via the SDK singleton"
  - "FK-safe ordering for --execute mode uses a fixpoint retry loop (attempt every table, defer on FK-violation, repeat until no progress) instead of a hand-maintained topological sort — self-healing as schema grows"
  - "Script deletes CHILD data only; the tenants row itself is never dropped (no --drop-tenant-row option), per the phase's locked decision"

patterns-established:
  - "Pattern: dry-run is the fail-safe default for any destructive cleanup script — `dry_run = not args.execute`, never invert this"

# Metrics
duration: 12min
completed: 2026-08-05
---

# Phase 21 Plan 03: Dev/QA Cleanup Script Summary

**Dry-run-default, allowlist-scoped Supabase cleanup script for the 9 ratified test tenants, proven clean via a live dry-run against oacnwalhcpqdabivweki showing 339 rows across 10 tables, zero rows outside the allowlist, and zero rows in the two excluded append-only compliance tables.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-05T (session start)
- **Completed:** 2026-08-05
- **Tasks:** 2
- **Files modified:** 1 created

## Accomplishments
- Built `apps/api/scripts/cleanup_test_data.py`: `--execute`-gated (dry-run by default), transcribes `PRESERVE`/`DELETE_ALLOWLIST`/`EXCLUDE_TABLES` from 21-ALLOWLIST.md, guardrails (disjoint sets, non-empty allowlist, live `is_test` cross-check against the `tenants` table), table discovery with a documented 85-table fallback, and a fixpoint FK-violation retry loop for `--execute` mode.
- Ran the script in its default dry-run mode against the live dev/QA Supabase project (`oacnwalhcpqdabivweki`) — exited 0, produced a clean allowlist-scoped report.
- Zero real deletes performed anywhere in this plan. `--execute` was never invoked.

## Task Commits

1. **Task 1: Write cleanup_test_data.py** - `0ca4450d` (feat) — script created, guardrails/discovery/FK-retry/report implemented
   - Follow-up fix `50d1b18e` (fix) — swapped an em-dash in the report's excluded-tables line for a plain ASCII `--` after it rendered as a mojibake byte (`�`) under the Windows console's default codepage during Task 2's dry-run capture. Purely cosmetic (stdout formatting), no logic change; re-ran the dry-run afterward to confirm clean output.
2. **Task 2: Run dry-run, capture report** - no code commit (verification-only task; the encoding fix above was committed as part of closing out Task 1's output correctness)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/api/scripts/cleanup_test_data.py` (188 lines) - Dry-run-gated, allowlist-scoped, FK-safe cleanup tool for the 9 ratified test tenants; imports the existing `core.database.supabase` service-role singleton, no new dependencies.

## Decisions Made
- Table discovery: primary path is an `information_schema.columns` RPC via the SDK; documented explicit fallback list is used since the RPC is not guaranteed to exist in this project and the orchestrator had already live-verified the fallback set. Both `discover_tenant_tables()` and `FALLBACK_TENANT_TABLES` are unioned in `main()` so the fallback is always at minimum applied even if the RPC returns a partial set.
- FK ordering for `--execute` uses a fixpoint retry loop, not a hand-maintained topological sort — matches the plan's explicit guidance and self-heals as the schema grows.
- `--execute` mode was never invoked. Dry-run mode's per-table counts use `select(..., count="exact")` with a try/except fallback (`select("id", ...)` first, then `select("tenant_id", ...)` for tables that error on an `id`-based select) so one odd-shaped join table can't abort the whole report — no table actually needed the fallback in this run's live report, but the guard is in place and documented per the plan's implementation caveat.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Em-dash rendered as mojibake in Windows console output**
- **Found during:** Task 2 (dry-run capture)
- **Issue:** The report's "Excluded tables ... — 0 rows." line used a Unicode em-dash (—), which the Windows console's default codepage (cp1252) mangled into a stray `�` byte in the captured stdout.
- **Fix:** Replaced the em-dash with a plain ASCII `--` in that one print statement.
- **Files modified:** apps/api/scripts/cleanup_test_data.py
- **Verification:** Re-ran the dry-run; output line now reads cleanly with no mojibake.
- **Committed in:** `50d1b18e`

---

**Total deviations:** 1 auto-fixed (1 bug, cosmetic stdout-encoding only — no logic, scope, or guardrail change)
**Impact on plan:** No impact on correctness or scope. Zero change to allowlist logic, guardrails, discovery, or delete semantics.

## Issues Encountered
None beyond the cosmetic encoding fix above.

## Captured Dry-Run Report (verbatim, `python apps/api/scripts/cleanup_test_data.py`, no flags, exit code 0)

```
============================================================
DRY-RUN (no writes)
============================================================
Allowlisted tenants: 9  |  Preserved: 1

  cleaning_checklist_items                         225
  cleaning_checklist_templates                      36
  departments                                       36
  inspection_template_items                          6
  inspection_templates                               1
  room_status                                        8
  rooms                                              8
  staff_invitations                                  2
  subscriptions                                      9
  user_roles                                         8

TOTAL rows would be deleted: 339
Scope: only tenant_ids in DELETE_ALLOWLIST (9 tenants). Zero rows touched outside the allowlist (every query is .in_('tenant_id', DELETE_ALLOWLIST)-scoped).
Excluded tables (never touched, append-only): ['controlled_incident_events', 'controlled_incidents'] -- 0 rows.
tenants row itself: NOT deleted (child data only).
EXIT_CODE=0
```

**Interpretation:** All 10 non-zero tables belong to the discovered tenant-scoped set minus `EXCLUDE_TABLES` minus `tenants`; every count query was `.in_("tenant_id", DELETE_ALLOWLIST)`-scoped, so by construction no row outside the 9 allowlisted tenants was counted. `controlled_incidents` and `controlled_incident_events` were never queried at all (subtracted from the discovered table set before counting), confirming 0 rows touched in both — consistent with 21-ALLOWLIST.md's independent finding that all 9 allowlisted tenants have `incidents = 0`. Note: `user_roles` (8) and `staff_invitations` (2) show non-zero counts even though 21-ALLOWLIST.md's `users` column reads 0 for every allowlisted tenant — these are two different underlying tables (`user_profiles` vs. `user_roles`/`staff_invitations`), and the discrepancy is orphaned role/invitation rows with no corresponding `user_profiles` row, not a scope violation. Flagged here for visibility; not investigated further as it is out of this plan's scope (dry-run only, no delete performed).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The cleanup tool exists, is guardrail-protected, and has a proven-clean dry-run report satisfying Success Criteria #3 and #4 of Phase 21.
- A real `--execute` run remains a distinct, later, human-authorized action per 21-ALLOWLIST.md Section 5 — it was never invoked in this plan and must re-query live tenant inventory immediately before any future destructive run.

---
*Phase: 21-dev-qa-test-data-hygiene*
*Completed: 2026-08-05*

## Self-Check: PASSED

- FOUND: apps/api/scripts/cleanup_test_data.py
- FOUND: .planning/phases/21-dev-qa-test-data-hygiene/21-03-SUMMARY.md
- FOUND: commit 0ca4450d
- FOUND: commit 50d1b18e

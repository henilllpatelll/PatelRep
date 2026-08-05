---
phase: 21-dev-qa-test-data-hygiene
plan: 02
subsystem: testing
tags: [supabase, multi-tenancy, dev-data-hygiene, allowlist]

# Dependency graph
requires: []
provides:
  - "Ratified delete-allowlist / preserve-list document (21-ALLOWLIST.md) naming the standing QA fixture tenant and every delete-eligible tenant by UUID"
affects: [21-03]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: [".planning/phases/21-dev-qa-test-data-hygiene/21-ALLOWLIST.md"]
  modified: []

key-decisions:
  - "Live re-query at authoring time (2026-08-05) confirmed 9 delete-eligible tenants, resolving the research doc's internal prose-vs-table discrepancy (10 vs 9) in favor of 9"
  - "PRESERVE fixture is identified strictly by UUID (23264962-aa09-4e4f-a49d-fc345cc91414), not by name, since two empty near-duplicate 'Sonesta ES Suites Fossil Creek' tenants exist on the delete side"
  - "controlled_incidents and controlled_incident_events are documented as permanently excluded (migration 070 immutability triggers), independent of the allowlist content"

patterns-established: []

# Metrics
duration: 8min
completed: 2026-08-05
---

# Phase 21 Plan 02: Delete Allowlist / Preserve List Summary

**Wrote the human-reviewed `21-ALLOWLIST.md` ratifying 1 PRESERVE fixture and 9 delete-eligible dev/QA tenants, sourced from a live Supabase re-query, with append-only tables explicitly excluded.**

## Performance

- **Duration:** ~8 min
- **Tasks:** 2 (live inventory supplied by orchestrator re-query; doc authored)
- **Files modified:** 1 created

## Accomplishments

- Created `.planning/phases/21-dev-qa-test-data-hygiene/21-ALLOWLIST.md` with 5 required sections: ratification statement, PRESERVE table, DELETE ALLOWLIST table, excluded-tables section, scope note.
- PRESERVE fixture named explicitly: `23264962-aa09-4e4f-a49d-fc345cc91414` (Sonesta ES Suites Fossil Creek, slug `sonesta-es-suites-fossil-creek-2`) — 6 users, 114 rooms, 16 tasks, 43 work orders, marked never-delete.
- DELETE ALLOWLIST enumerates all 9 non-fixture tenants by UUID/name/slug/users/rooms/why-safe, resolving the research document's "10 candidates" prose vs. 9-row table discrepancy — live re-query confirms **9** is the correct count.
- Explicitly flagged the two confusing empty near-duplicate "Sonesta ES Suites Fossil Creek" tenants (slugs `-1` and un-suffixed) and the `isoval-20260512190107` isolation-validation leftover, so a reviewer understands why each is safe despite name similarity to the real fixture.
- Recorded `controlled_incidents` + `controlled_incident_events` as permanently excluded append-only tables (migration 070 BEFORE UPDATE/DELETE immutability triggers, fire even for service-role).
- Scope note makes explicit this document authorizes only the tool's allowlist, not a real `--execute` destructive run.

## Task Commits

1. **Task 1: Re-query live tenant inventory** — no file changes (inventory supplied directly by the orchestrator's fresh live re-query, transcribed verbatim; no Supabase MCP access available to this executor)
2. **Task 2: Write 21-ALLOWLIST.md** — `368c0a86` (docs)

**Plan metadata:** captured in this SUMMARY + STATE.md update (see below)

## Files Created/Modified

- `.planning/phases/21-dev-qa-test-data-hygiene/21-ALLOWLIST.md` — ratified PRESERVE/DELETE ALLOWLIST/excluded-tables/scope-note document; source-of-truth for Plan 21-03's `DELETE_ALLOWLIST`/`PRESERVE` constants

## Decisions Made

- Used the orchestrator-supplied live re-query (this executor has no Supabase MCP tool access) as the authoritative Task 1 source, per the plan's own tiebreaker instruction ("live data is the tiebreaker" over stale research prose).
- Identified the PRESERVE fixture strictly by UUID in the document text, not by name alone, given two empty near-duplicate same-named tenants exist in the delete set — reduces risk of a future reviewer or script matching on name and preserving the wrong row.

## Deviations from Plan

None — plan executed exactly as written. This plan is documentation-only; no tenant data was queried directly by this executor (no DB tool access) and none was modified.

## Issues Encountered

None. The live inventory was provided directly in this executor's task context (already re-queried by the orchestrator immediately before spawning), so Task 1 required no additional tool calls — only verification that the counts and exact UUID set matched what Task 2 needed to transcribe.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 21-03 (the cleanup tool) can now transcribe its `PRESERVE`/`DELETE_ALLOWLIST` constants directly from this document's Section 2 and Section 3 tables.
- Before any real `--execute` run against the shared dev/QA Supabase project, the live tenant inventory must be re-queried and diffed against this document's Section 3 list (Scope Note, Section 5) — not yet performed, correctly deferred as a separate human-authorized step.
- Plan 21-01 (a sibling plan in this phase) was also completed by a concurrent session during this execution (`21-01-SUMMARY.md` present on disk); no file overlap with this plan — untouched.

---
*Phase: 21-dev-qa-test-data-hygiene*
*Completed: 2026-08-05*

## Self-Check: PASSED

- FOUND: .planning/phases/21-dev-qa-test-data-hygiene/21-ALLOWLIST.md
- FOUND: commit 368c0a86

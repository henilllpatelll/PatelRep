---
phase: 21-dev-qa-test-data-hygiene
verified: 2026-08-05T09:00:00Z
status: passed
score: 4/4 must-haves verified
---

# Phase 21: Dev/QA Test-Data Hygiene Verification Report

**Phase Goal:** Dev/QA Supabase test data can be safely identified and cleaned via an `is_test` flag plus an allowlist- and dry-run-gated cleanup script.
**Verified:** 2026-08-05
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (Phase Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | `tenants.is_test BOOLEAN NOT NULL DEFAULT false` exists, confirmable via schema inspection | ✓ VERIFIED | Orchestrator-confirmed live schema fact (`data_type=boolean`, `is_nullable=NO`, `column_default=false`) matches `supabase/migrations/094_tenant_is_test_flag.sql` on disk verbatim (`ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE`); live distribution (1 row `is_test=false` = fixture, 9 rows `is_test=true`) matches 21-01-SUMMARY.md's claim exactly |
| 2 | A human-reviewed hotel_id delete-allowlist and preserve-list document exists, explicitly naming the standing QA fixture tenant to keep | ✓ VERIFIED | `.planning/phases/21-dev-qa-test-data-hygiene/21-ALLOWLIST.md` read directly — Section 2 (PRESERVE) names `23264962-aa09-4e4f-a49d-fc345cc91414` (Sonesta ES Suites Fossil Creek) with an explicit "MUST NOT include it in any delete operation" instruction; Section 3 (DELETE ALLOWLIST) enumerates all 9 delete-eligible tenants by UUID/name/slug/why-safe; Section 4 explicitly excludes `controlled_incidents`/`controlled_incident_events` (append-only, migration 070 immutability triggers) |
| 3 | An allowlist-scoped, dry-run-mandatory, append-only-excluding (`controlled_incidents`/`controlled_incident_events`) cleanup script exists | ✓ VERIFIED | `apps/api/scripts/cleanup_test_data.py` (188 lines) read directly and re-parsed (`ast.parse` — clean). `dry_run = not args.execute` (dry-run is structurally the default, `--execute` required for real deletes). `EXCLUDE_TABLES = {"controlled_incidents", "controlled_incident_events"}` subtracted from the discovered/fallback table set before any query is built — these two tables are never queried at all, not merely skipped in a loop. Every table query is `.in_("tenant_id", ids)`-scoped to `DELETE_ALLOWLIST`. Guardrails (`run_guardrails()`) assert `DELETE_ALLOWLIST`/`PRESERVE` disjoint, non-empty, and cross-check live `is_test` values against both sets before any write. FK-safe ordering for `--execute` mode implemented as a fixpoint retry loop (`execute_with_fk_retry`, deferring on SQLSTATE `23503`/"foreign key"/"violates" until a full pass makes no progress) — code-inspected only, not exercised (correctly out of scope per the HARD SCOPE BOUNDARY; `--execute` was never invoked by this verification or by Plan 03) |
| 4 | The cleanup script's dry-run report shows zero deletions outside the allowlist | ✓ VERIFIED | Independently re-ran `python apps/api/scripts/cleanup_test_data.py` live against project `oacnwalhcpqdabivweki` this session (default mode, no flags) — exited 0, output byte-for-byte matches the report captured in 21-03-SUMMARY.md: `339` total rows across the same 10 tables with the same per-table counts, `Allowlisted tenants: 9 \| Preserved: 1`, explicit "Zero rows touched outside the allowlist" line, `controlled_incident_events`/`controlled_incidents` confirmed 0 rows (never queried). This is a fresh, independent execution, not a re-read of the SUMMARY's claim |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `supabase/migrations/094_tenant_is_test_flag.sql` | On-disk source-of-truth for the `is_test` column add + rollback comment | ✓ VERIFIED | 7 lines; `ALTER TABLE ... ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE`, column comment, commented-out `ROLLBACK` line — mirrors the `085_opera_pilot_flag.sql` idiom exactly as the plan specified; matches the live-confirmed schema fact |
| `.planning/phases/21-dev-qa-test-data-hygiene/21-ALLOWLIST.md` | Ratified delete-allowlist + preserve-list, source-of-truth for the script's constants | ✓ VERIFIED | 5 required sections present (ratification statement, PRESERVE, DELETE ALLOWLIST, excluded-tables, scope note); PRESERVE UUID and all 9 DELETE ALLOWLIST UUIDs transcribed byte-for-byte into the script (verified via `diff` below) |
| `apps/api/scripts/cleanup_test_data.py` | Dry-run-gated, allowlist-scoped test-data cleanup tool | ✓ VERIFIED | 188 lines (well above the plan's `min_lines: 90`); contains `--execute`, `EXCLUDE_TABLES`, `controlled_incidents`, `DELETE_ALLOWLIST`, `from core.database import supabase`, `in_("tenant_id"` (all required greps pass); `ast.parse` clean; live-executed successfully this session |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `supabase/migrations/094_tenant_is_test_flag.sql` | live project `oacnwalhcpqdabivweki` | Supabase MCP `apply_migration` | ✓ WIRED | Orchestrator-confirmed live: column exists with exact spec (`boolean`, `NOT NULL`, `default false`); not merely a file on disk |
| `.planning/phases/21-dev-qa-test-data-hygiene/21-ALLOWLIST.md` (Section 2/3 UUIDs) | `apps/api/scripts/cleanup_test_data.py` `PRESERVE`/`DELETE_ALLOWLIST` constants | manual transcription | ✓ WIRED | Ran a UUID-set diff between the two files this session: script's 10 UUIDs (1 PRESERVE + 9 DELETE_ALLOWLIST) are an exact match, byte-for-byte, to the allowlist doc's 10 UUIDs — zero drift |
| `apps/api/scripts/cleanup_test_data.py` | `core.database.supabase` service-role singleton | `sys.path.insert` + `from core.database import supabase` | ✓ WIRED | Import present; live dry-run this session actually connected and returned real per-table counts (339 rows across 10 real tables) — proves the import resolves and the singleton is a live, working Supabase client, not a stub |
| `apps/api/scripts/cleanup_test_data.py` guardrails | live `tenants.is_test` column | `run_guardrails()` cross-check query | ✓ WIRED | Script executed successfully end-to-end this session without raising any `AssertionError` from `run_guardrails()` — this is only possible if the live cross-check (every `DELETE_ALLOWLIST` UUID has `is_test=true`, every `PRESERVE` UUID has `is_test=false`) genuinely passed against real data, confirming the guardrail is load-bearing, not decorative |
| `apps/api/scripts/cleanup_test_data.py` every discovered table | live tenant-scoped tables | `.in_("tenant_id", DELETE_ALLOWLIST)` | ✓ WIRED | Live dry-run counts (225/36/36/6/1/8/8/2/9/8 across 10 tables, total 339) are real query results, not placeholders — structurally guaranteed allowlist-only by the `.in_()` scoping used on every count/delete call |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|---|---|---|
| QA-01 (`tenants.is_test` column) | ✓ SATISFIED | None — live-confirmed schema fact matches spec exactly. (Note: `.planning/REQUIREMENTS.md` row still shows `[ ]`/"Pending" — a tracking-doc field expected to be updated by the orchestrator post-verification, consistent with the same non-functional note in Phase 20's verification, not a functional gap.) |
| QA-02 (human-reviewed allowlist/preserve doc) | ✓ SATISFIED | None — `21-ALLOWLIST.md` exists, is human-readable, and explicitly names the fixture and every delete-eligible tenant. Same REQUIREMENTS.md tracking-doc caveat as above. |
| QA-03 (allowlist-scoped, dry-run-mandatory, append-only-excluding cleanup script) | ✓ SATISFIED | None — script exists, dry-run is the structural default, both append-only tables are excluded at the query-construction level (never queried, not just skipped), FK-safe fixpoint retry implemented for `--execute` mode. Same REQUIREMENTS.md tracking-doc caveat as above. |

### Anti-Patterns Found

None. Scanned all three phase-deliverable files (`supabase/migrations/094_tenant_is_test_flag.sql`, `.planning/phases/21-dev-qa-test-data-hygiene/21-ALLOWLIST.md`, `apps/api/scripts/cleanup_test_data.py`) for TODO/FIXME/XXX/HACK/PLACEHOLDER/"coming soon" markers — zero matches. No stub return values, no empty handlers, no console-log-only implementations.

### Live Verification Performed This Session

- `python -c "import ast; ast.parse(...)"` on `cleanup_test_data.py` — parses clean.
- `git log --oneline -1` on all 4 commits referenced across the three SUMMARYs (`b0e5978d`, `368c0a86`, `0ca4450d`, `50d1b18e`) — all 4 exist and match their claimed messages.
- UUID-set diff between `21-ALLOWLIST.md` and `cleanup_test_data.py`'s `PRESERVE`/`DELETE_ALLOWLIST` constants — exact match, 10/10 UUIDs, zero drift.
- Live re-run of `python apps/api/scripts/cleanup_test_data.py` (default dry-run, no `--execute`) against `oacnwalhcpqdabivweki` this session — exit code 0, output byte-for-byte identical to the report captured in 21-03-SUMMARY.md (339 rows, 10 tables, 9 allowlisted tenants, 1 preserved, zero rows outside the allowlist, zero rows in the two excluded append-only tables). This independently reproduces Success Criterion #4 rather than trusting the SUMMARY's transcription.
- No `--execute` flag was ever passed by this verification. No tenant data was modified, deleted, or written to. The only DB interaction performed was the script's own built-in read-only guardrail check and dry-run `SELECT ... count="exact"` queries.

### Human Verification Required

None. All four success criteria are objectively, mechanically verifiable (schema inspection, document existence/content, static code inspection + `ast.parse`, and a live dry-run re-execution), and all four were independently re-verified against the actual codebase and a live re-run this session — not inferred from SUMMARY prose.

### Gaps Summary

No gaps. All 4 phase success criteria are met:

1. `tenants.is_test BOOLEAN NOT NULL DEFAULT false` — live-confirmed via schema inspection, matches the on-disk migration exactly.
2. `21-ALLOWLIST.md` — exists, human-readable, explicitly names the fixture (`23264962-aa09-4e4f-a49d-fc345cc91414`) and all 9 delete-eligible tenants with rationale.
3. `apps/api/scripts/cleanup_test_data.py` — exists, dry-run is the structural default, allowlist-scoped via `.in_("tenant_id", ...)` on every query, `controlled_incidents`/`controlled_incident_events` are excluded at table-discovery time (never queried), FK-safe fixpoint retry loop implemented for `--execute` mode.
4. Dry-run report — independently re-run live this session, zero deletions outside the allowlist, exit code 0, matches the captured SUMMARY report exactly.

One item is code-inspected but not execution-tested by design: the FK-safe fixpoint retry loop (`execute_with_fk_retry`) only runs under `--execute`, which this phase's HARD SCOPE BOUNDARY correctly forbids invoking. This is not a gap — a real `--execute` run remains a distinct, later, human-authorized action per `21-ALLOWLIST.md` Section 5, and the plan explicitly deferred it.

---

_Verified: 2026-08-05_
_Verifier: Claude (gsd-verifier)_

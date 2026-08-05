# Phase 21: Dev/QA Test-Data Hygiene - Research

**Researched:** 2026-08-04
**Domain:** Postgres/Supabase schema change + Python maintenance script (destructive-delete tooling, dry-run-gated)
**Confidence:** HIGH (all findings verified against live dev/QA Supabase project `oacnwalhcpqdabivweki` and on-disk migrations)

> No CONTEXT.md exists for this phase (no `/gsd:discuss-phase` was run). There are no locked user decisions to honor; this research + the phase requirements are the sole inputs for planning.

---

## Summary

This phase is small and self-contained: (1) add one boolean column to `tenants`, (2) produce a human-reviewed allowlist/preserve-list document, and (3) write one dry-run-gated Python cleanup script. The dev/QA project (there is only ONE Supabase project — dev/QA and everything else share `oacnwalhcpqdabivweki`) currently has **11 tenants, of which exactly one is the live QA fixture** (`23264962-…`, "Sonesta ES Suites Fossil Creek", 6 users incl. `henill@gmail.com`, 114 rooms, 16 tasks, 43 work orders). The other 10 tenants are empty or near-empty stale test rows — these are the natural delete-allowlist.

The single largest technical hazard: `controlled_incidents` and `controlled_incident_events` carry live `BEFORE UPDATE OR DELETE` triggers that unconditionally `RAISE EXCEPTION` (migration 070, verified live). Because those tables also FK to `tenants(id) ON DELETE CASCADE`, **any attempt to delete a tenant ROW that owns even one incident will abort the entire transaction** when the cascade hits the trigger. This is exactly why QA-03 mandates excluding these two tables. The correct script design is per-table, tenant-scoped deletes over an explicit table list that excludes the two append-only tables — NOT a `DELETE FROM tenants` cascade.

**Primary recommendation:** Add `is_test BOOLEAN NOT NULL DEFAULT false` to `tenants` via migration `094` (mirror the `085_opera_pilot_flag.sql` idiom). Write a Python script at `apps/api/scripts/cleanup_test_data.py` using the existing `core.database.supabase` service-role singleton, `argparse` with dry-run as the DEFAULT (require an explicit `--execute` flag to actually delete), a hardcoded ALLOWLIST + PRESERVE constant reviewed by a human, an exclusion set `{controlled_incidents, controlled_incident_events}`, and per-table `count` (dry-run) / `delete` (execute) scoped by `tenant_id`. Apply the migration via Supabase MCP `apply_migration` (remote migration-history drift makes `supabase db push` unsafe — same mechanism used for 093).

---

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Supabase Python SDK (`supabase`) | as pinned in `apps/api/requirements.txt` | All DB reads/deletes via `core.database.supabase` singleton | Project convention — "No ORM"; every existing script/router uses this exact singleton |
| `argparse` (stdlib) | Py 3.13 | `--dry-run`/`--execute` CLI gating | Zero-dependency, matches "keep files small / no new deps" |
| Supabase MCP `apply_migration` | — | Apply migration 094 to remote | Remote migration-history drift; used for 093 in Phase 20 |
| Postgres `information_schema.columns` | PG 17 | Dynamically discover tables with a `tenant_id` column | Avoids hardcoding/maintaining a 60+ table list |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `os.environ` | Read `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` | Already loaded transitively via `core.database` import |
| Supabase MCP `execute_sql` | Ad-hoc verification / generating the allowlist doc from live data | Read-only checks during planning/review |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-table scoped deletes | `DELETE FROM tenants WHERE id = ANY(allowlist)` (rely on ON DELETE CASCADE) | Elegant for fully-empty tenants, but **aborts the moment a tenant owns any `controlled_incidents` row** (trigger blocks the cascade). Violates QA-03's "exclude append-only tables" intent. Do NOT use as primary. |
| `argparse` | Click / Typer | New dependency for a one-off maintenance script — unjustified |
| Hardcoded table list | `information_schema` discovery | Discovery is more robust to future tables; hardcoding rots. Recommend discovery + explicit exclusion set. |

**Installation:** None. All tooling already present (`supabase` SDK, stdlib `argparse`, Supabase MCP).

---

## Key Facts (verified live — 2026-08-04)

### The `tenants` table today (live column list)
`id, name, slug, address, city, state, zip, phone, room_count, timezone, logo_url, is_active(bool NOT NULL default true), trial_ends_at, created_at, updated_at, front_desk_modules(jsonb), layout(jsonb), average_daily_rate_cents, opera_pilot_enabled(bool NOT NULL default false)`.

**`is_test` does NOT exist yet** — QA-01 is genuinely needed. Two existing boolean columns (`is_active`, `opera_pilot_enabled`) establish the exact idiom to copy.

### Tenant inventory (live) — the QA-02 allowlist/preserve source data
| tenant_id | name | users | rooms | tasks | WOs | incidents | Classification |
|-----------|------|:----:|:----:|:----:|:---:|:---------:|----------------|
| `23264962-aa09-4e4f-a49d-fc345cc91414` | Sonesta ES Suites Fossil Creek (slug `-2`) | 6 | 114 | 16 | 43 | 0 | **PRESERVE — active QA fixture** |
| `912fb2e2-5d3a-4974-adde-ee41ba4e4cc7` | Lakeside Inn & Suites | 0 | 0 | 0 | 0 | 0 | delete candidate |
| `c42bea9e-da6a-405d-95a1-e32b53b0b811` | Lakeside Inn & Suites (`-1`) | 0 | 0 | 0 | 0 | 0 | delete candidate |
| `c1d12e19-7400-4be3-b1d6-b2319f5cf7b2` | Lakeside Inn & Suites (`-2`) | 0 | 0 | 0 | 0 | 0 | delete candidate |
| `9745ef9b-257b-4241-90f5-191d5f28e4c4` | Lakeside Inn & Suites (`-3`) | 0 | 0 | 0 | 0 | 0 | delete candidate |
| `fc67f917-939e-44b7-a6fe-be4a44bfc0ef` | Sonesta ES Suites | 0 | 0 | 0 | 0 | 0 | delete candidate |
| `4a32bb39-9bae-42de-9db9-142b92eb8475` | Sonesta ES Suites Fossil Creek | 0 | 0 | 0 | 0 | 0 | delete candidate |
| `100b4516-44f1-408b-bc9b-c820514bdfca` | Patel Test Hotel | 0 | 8 | 0 | 0 | 0 | delete candidate |
| `b442eb82-85f2-4bff-b2cd-f7fea51559ec` | Sonesta ES Suites Fossil Creek (`-1`) | 0 | 0 | 0 | 0 | 0 | delete candidate |
| `d8994fd3-9028-41bb-bbcb-056867521023` | Validation Tenant isoval-20260512190107 | 0 | 0 | 0 | 0 | 0 | delete candidate (isolation-validation leftover) |

> The `isoval-…` tenant name pattern indicates an automated isolation-validation flow that mints throwaway tenants — these will keep accumulating, which is part of the motivation for this phase.
> **A human must still ratify this list (QA-02).** The data above is the evidence to review, not an auto-approval. Note the several confusingly-named near-duplicate "Sonesta ES Suites Fossil Creek" rows — a human must confirm `-2` (the one with data) is the keeper and the empty duplicates are safe to delete.

### The two append-only tables (verified live)
`controlled_incidents` and `controlled_incident_events` each have a live `BEFORE UPDATE OR DELETE` trigger (`controlled_incidents_immutable` / `controlled_incident_events_immutable`) executing `reject_controlled_incident_mutation()` which does `RAISE EXCEPTION 'Controlled incidents are append-only…'`. Source: `supabase/migrations/070_texas_safety_compliance.sql:98-101`. **Triggers fire even for the service-role key** (service role bypasses RLS, NOT triggers). These two tables MUST be in the script's exclusion set.

---

## Architecture Patterns

### Migration 094 (QA-01) — copy the 085 idiom verbatim
```sql
-- supabase/migrations/094_tenant_is_test_flag.sql
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN public.tenants.is_test IS
  'Marks a tenant as dev/QA test data eligible for the cleanup script. Standing QA fixture(s) stay FALSE. (Phase 21 QA-01).';

-- ROLLBACK:
-- ALTER TABLE public.tenants DROP COLUMN is_test;
```
Apply via Supabase MCP `apply_migration` (name `tenant_is_test_flag`), NOT `supabase db push`. Next sequential number is **094** — verified no `082` (gap, harmless) and no existing `094` collision.

> Design note for the planner: decide whether the script's allowlist is driven by (a) the hardcoded UUID constant, (b) the new `is_test = true` flag, or (c) both (flag as the source of truth, constant as a defense-in-depth cross-check). Recommendation: set `is_test = true` on the 10 candidate tenants as part of this phase (a data step, reversible), and have the script select `WHERE is_test = true` **intersected with** a hardcoded allowlist constant — belt-and-suspenders so a mis-flag can't nuke the fixture.

### Script (QA-03) — structure to match project conventions
Location: **`apps/api/scripts/cleanup_test_data.py`** (mirrors the existing `apps/api/scripts/seed_hotel_layout.py`). That file is the canonical template for this project:
- Module docstring with a `Run:` line and required env vars.
- `sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))` then `from core.database import supabase`.
- `main()` guarded by `if __name__ == "__main__":`.
- Uses the service-role singleton (bypasses RLS; needed to read/delete across tenants).

Recommended shape:
```python
"""
Delete stale dev/QA test-tenant data. DRY-RUN BY DEFAULT.
Run (dry-run, safe):   python apps/api/scripts/cleanup_test_data.py
Run (real delete):     python apps/api/scripts/cleanup_test_data.py --execute
Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment.
"""
import argparse, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from core.database import supabase

# Human-reviewed. Source: 21-ALLOWLIST.md (QA-02).
DELETE_ALLOWLIST = { ...10 UUIDs... }
PRESERVE = { "23264962-aa09-4e4f-a49d-fc345cc91414" }        # active QA fixture
EXCLUDE_TABLES = { "controlled_incidents", "controlled_incident_events" }  # QA-03 append-only

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true",
                    help="Perform real deletes. Omit for dry-run (default).")
    args = ap.parse_args()
    dry_run = not args.execute

    # Guardrail 1: allowlist and preserve set MUST be disjoint.
    assert not (DELETE_ALLOWLIST & PRESERVE), "Fixture tenant is in the delete allowlist!"
    # Guardrail 2 (optional but recommended): confirm each allowlisted tenant has is_test=true.
    # Guardrail 3: refuse to run if allowlist is empty.

    tables = discover_tenant_scoped_tables()   # information_schema, minus EXCLUDE_TABLES + 'tenants'
    report = []
    for tbl in delete_order(tables):
        ids = list(DELETE_ALLOWLIST)
        if dry_run:
            n = supabase.table(tbl).select("id", count="exact")\
                  .in_("tenant_id", ids).execute().count
        else:
            n = len(supabase.table(tbl).delete().in_("tenant_id", ids).execute().data or [])
        report.append((tbl, n))
    # Print report; assert zero rows would be touched for any tenant NOT in the allowlist.
```

Delete precedent (Supabase SDK) already in codebase — `apps/api/routers/internal.py:693`:
```python
result = supabase.table("logbook_entries").delete().not_.is_("expires_at","null").lt("expires_at", now).execute()
deleted = len(result.data) if result.data else 0
```

### Allowlist/preserve document (QA-02)
Create `.planning/phases/21-dev-qa-test-data-hygiene/21-ALLOWLIST.md` (or a `docs/` file — planner's choice). It must explicitly name the PRESERVE fixture `23264962-…` and list the 10 delete UUIDs with their name/why. The table in this research is ready-to-transcribe source data.

### Anti-Patterns to Avoid
- **`DELETE FROM tenants WHERE id = ANY(allowlist)` relying on cascade.** Aborts on any tenant owning a `controlled_incidents` row (trigger). Also deletes the tenant row + users, which may not be intended. Use per-table scoped deletes instead.
- **Hardcoding "no dry-run" or dry-run as opt-in.** QA-03 mandates dry-run is MANDATORY *before* execution. Make dry-run the DEFAULT and real deletion require an explicit `--execute` flag (fail-safe, not fail-open).
- **Scoping by RLS/JWT.** The service-role key bypasses RLS, so `.eq("hotel_id"…)` app-layer scoping doesn't apply here — the script must scope every query itself with `.in_("tenant_id", allowlist)` and assert nothing outside the allowlist is affected.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| List of tenant-scoped tables | A hand-maintained 60-table Python constant | `information_schema.columns WHERE column_name='tenant_id'` minus exclusion set | Auto-stays-correct as schema grows; ~85 tables carry `tenant_id` |
| Boolean flag column | Custom status enum / separate marker table | `is_test BOOLEAN NOT NULL DEFAULT false` mirroring `opera_pilot_enabled` | Established project idiom (085) |
| CLI flag parsing | Manual `sys.argv` inspection | stdlib `argparse` | Free, standard, self-documenting `--help` |
| Deleting the immutable tables | Trying to disable/rebuild the trigger | Just exclude them | They are compliance/append-only by design (Texas safety, migration 070) |

**Key insight:** Almost every table FKs to `tenants(id) ON DELETE CASCADE`, so the temptation is to delete the tenant row and let the DB cascade. The append-only triggers make that path fragile. Explicit per-table deletes with an exclusion set are both safer and exactly what QA-03 specifies.

---

## Common Pitfalls

### Pitfall 1: Cascade delete aborts on immutable incident rows
**What goes wrong:** `DELETE FROM tenants … ` cascades into `controlled_incidents`, the immutability trigger raises, the whole delete rolls back.
**Why:** `controlled_incidents.tenant_id … ON DELETE CASCADE` + `BEFORE DELETE` reject trigger (070:31-33, 100-101). Verified live.
**How to avoid:** Never delete the tenant row via cascade. Per-table scoped deletes, excluding the two append-only tables, leaving the tenant row (and its incidents) intact.
**Warning sign:** `RAISE EXCEPTION 'Controlled incidents are append-only…'` during a delete.

### Pitfall 2: Inter-table FK ordering (RESTRICT) during real deletes
**What goes wrong:** Deleting a parent child-table before its children hits `ON DELETE RESTRICT` FKs (e.g. `safety_training_assignments.course_id → safety_training_courses RESTRICT`; `emergency_drill_participants.drill_id → emergency_drills RESTRICT`). The dry-run (pure `count`) never surfaces this; only `--execute` does.
**How to avoid:** Either (a) delete in reverse-FK-dependency (topological) order, or (b) run each per-table delete and, if a RESTRICT FK error occurs, iterate/retry until stable, or (c) run all deletes inside a single transaction so a partial failure rolls back cleanly. Recommend (a) with a documented order, or wrap in a transaction via a single `execute_sql`/RPC. **The planner should treat ordering as a real task, not an afterthought — the dry-run success criterion (#4) does not exercise it.**
**Note:** For the current allowlist (all 10 candidates are empty except Patel Test Hotel's 8 rooms), ordering barely matters in practice today, but the script must be correct for future non-empty test tenants.

### Pitfall 3: `tenant_id` is the DB column; `hotel_id` is the app/JWT alias
**What goes wrong:** Grepping only for `hotel_id` misses tables — the physical column is `tenant_id` everywhere; `hotel_id` is the JWT claim name (`auth.jwt() ->> 'hotel_id'` in RLS policies).
**How to avoid:** Discover/scope by the physical column name `tenant_id`.

### Pitfall 4: Migration applied via wrong mechanism
**What goes wrong:** `supabase db push` fails or double-applies due to known remote migration-history drift (documented in CLAUDE.md; 093 was applied via MCP for this reason).
**How to avoid:** Apply 094 via Supabase MCP `apply_migration`. Also write the file to `supabase/migrations/094_*.sql` for on-disk source-of-truth parity.

---

## Scope Boundary (flagged per orchestrator instruction)

**This phase builds and dry-run-verifies the tool. It does NOT run a real destructive delete.** Success criterion #4 requires only a dry-run report showing zero deletions outside the allowlist. Do NOT plan or execute a `--execute` pass against any data in this phase — that is a separate, later, human-authorized action. The planner should ensure the "verify" task runs the script in its default (dry-run) mode and asserts the report is clean; no task should invoke `--execute`.

Corollary: setting `is_test = true` on the 10 candidate tenants (a reversible flag write, not a destructive delete) is acceptable within this phase if the planner wants the flag to be the script's source of truth — but it is optional and can also be deferred to the human-authorized cleanup step. Flag this as a planner decision.

---

## State of the Art

| Old Approach | Current Approach | Why |
|--------------|------------------|-----|
| Ad-hoc manual row deletion in Supabase Studio | Scripted, allowlist-gated, dry-run-first cleanup | Repeatable, auditable, prevents fixture/prod loss |
| No test-tenant marker | `tenants.is_test` boolean | Schema-level, queryable, mirrors `opera_pilot_enabled` |

**Deprecated/outdated:** none relevant.

---

## Open Questions

1. **Flag-driven vs constant-driven allowlist (planner decision).**
   - Known: both the new `is_test` flag and a hardcoded UUID constant are viable selectors.
   - Recommendation: use both — `is_test = true` as source of truth, intersected with a hardcoded constant as a safety cross-check; PRESERVE fixture stays `is_test = false`.

2. **Does the script delete the tenant ROW too, or only child data?**
   - Known: append-only incidents make full tenant-row deletion impossible for any tenant owning incidents; all current candidates own zero.
   - Recommendation: script deletes child data table-by-table and leaves the `tenants` row (and any incidents) by default; optionally add a separate `--drop-tenant-row` step that only fires when the tenant's `controlled_incidents` count is zero. Let the planner decide; not required for success criteria (which only need a dry-run report).

3. **Where does the allowlist doc live?**
   - Known: no established `docs/` location for ops runbooks was found.
   - Recommendation: `.planning/phases/21-dev-qa-test-data-hygiene/21-ALLOWLIST.md` keeps it with the phase; acceptable to also/instead place under `docs/`.

---

## Sources

### Primary (HIGH confidence)
- Live dev/QA Supabase project `oacnwalhcpqdabivweki` via MCP `execute_sql` — tenant inventory, per-tenant data counts, live `tenants` columns, live append-only triggers, fixture user emails.
- `supabase/migrations/070_texas_safety_compliance.sql:31-33,98-101` — controlled_incidents append-only trigger + FK.
- `supabase/migrations/085_opera_pilot_flag.sql` — boolean-flag column idiom to copy.
- `supabase/migrations/002_tenants.sql` — base tenants schema; `is_active` precedent.
- `supabase/migrations/093_guest_requests_delete_cascade.sql` — immutability-trigger + FK pattern reference; MCP-apply precedent.
- `apps/api/scripts/seed_hotel_layout.py` — canonical script template (singleton import, structure).
- `apps/api/routers/internal.py:688-700` — Supabase SDK `.delete()` + `len(result.data)` precedent.
- CLAUDE.md — migration numbering gotchas, remote-history drift, "No ORM", multi-tenancy scoping.

### Secondary / Tertiary
- None required; all critical claims verified against primary sources.

## Metadata

**Confidence breakdown:**
- QA-01 (schema/idiom): HIGH — live schema confirmed `is_test` absent; 085 idiom exact.
- QA-02 (allowlist data): HIGH for the raw data; the human-review/ratification step is a process gate, not a research gap.
- QA-03 (script design): HIGH — template, delete precedent, exclusion rationale, and dry-run gating all grounded; FK delete-ordering is the one area needing careful planner attention (dry-run doesn't exercise it).

**Research date:** 2026-08-04
**Valid until:** ~2026-09-04 for the stack/patterns; the tenant inventory is a live snapshot and can drift (re-query before the human-authorized `--execute` step).

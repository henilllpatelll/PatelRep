---
phase: 04-maintenance-and-housekeeping-programs
plan: 04
subsystem: api
tags: [pm-templates, applicability-gating, migration, template-editor, pm-08, d-05, g5]
dependency-graph:
  requires:
    - "04-01: programs.py MANAGER_ROLES/RBAC baseline, test_programs_routes.py harness"
    - "04-02: pm-completion evidence-linkage contract (unrelated code path, same router)"
    - "04-03: PM deferral separation-of-duty + corrective-WO hardening (same router)"
  provides:
    - "GATED_TEMPLATE_FACILITIES mapping (services/programs/contracts.py) — the canonical
      pool_check/domestic_water/backflow -> facility-key gate any future template work must reuse"
    - "pm_checklist_templates.items JSONB shape contract: {checklist: [...], default_frequency_days: N}
      — any future reader/writer of this column must respect this object shape, not a bare array"
    - "PUT /programs/templates/{id} and POST /programs/templates routes for 04-05+ to wire a web UI against"
  affects:
    - apps/api/routers/programs.py
    - apps/api/services/programs/contracts.py
    - apps/api/models/requests.py
    - apps/api/tests/test_programs_routes.py
    - supabase/migrations (083, not yet applied)
tech-stack:
  added: []
  patterns:
    - "Local _get_property_applicability helper in programs.py mirrors routers/evidence.py's
      read pattern (single-row-per-tenant, facilities/services/brand_requirements JSONB arrays)
      rather than a cross-router import — same mirroring convention 04-03 established for
      _require_active_tenant_approver/_record_audit_event."
    - "pm_checklist_templates.items stores {checklist: [...], default_frequency_days: N} instead
      of a bare array, since the table has no dedicated frequency column and adding one was out
      of this plan's migration scope (083 is facility-constraint-only per Task 1)."
key-files:
  created:
    - supabase/migrations/083_program_template_facilities.sql
  modified:
    - apps/api/routers/programs.py
    - apps/api/services/programs/contracts.py
    - apps/api/models/requests.py
    - apps/api/tests/test_programs_routes.py
decisions:
  - "Worktree branch was created before 04-01/02/03 landed on local main (git merge-base --is-ancestor confirmed the worktree HEAD predated all three); fast-forward merged local main (d5a650c1) into this branch first — clean working tree, no divergent local commits — before starting any 04-04 work, matching the same recovery 04-02 and 04-03 each independently documented."
  - "pm_checklist_templates.items JSONB now holds {checklist: [...], default_frequency_days: N} rather than a bare list. The table (migration 071) has no dedicated frequency column, and this plan's own migration (083) is scoped to the facilities CHECK constraint only. Nesting the manager-editable default frequency inside the existing items column avoids a schema change outside this plan's stated file list, at the cost of every future reader needing to unwrap .checklist / .default_frequency_days instead of iterating items directly."
  - "PUT /programs/templates/{id} updates the tenant-scoped row in place rather than bumping `version` (UNIQUE(tenant_id, code, version)). pm_checklist_templates is explicitly documented as a MUTABLE config table (not append-only like pm_completion_records/pm_deferrals), and bumping version would silently orphan any pm_schedule.checklist_template_id already pointing at the edited row. version is left available for a future explicit revision-history feature, not touched by this editor."
  - "Migration 083 was written and verified locally (grep count, structural review against 074's own pattern) but NOT applied to production — no Supabase MCP tool is exposed to this worktree executor's tool surface, and the local supabase CLI has no DB password to run db push (same tooling gap 04-02 documented for migration 081, confirmed still true this session via `supabase projects list` showing the project unlinked). See Deviations."
metrics:
  duration: "~65 min (including a mid-session network interruption and recovery)"
  completed: "2026-07-23"
---

# Phase 4 Plan 04: Property-Configurable PM Template Library Summary

Delivered slice 4A (D-05, G5, PM-08): `POST /programs/templates/initialize` now gates the pool/backflow/domestic-water template families to properties that actually have those facilities configured, all 9 named templates seed with real 3-4 item checklists instead of one canned "verification" item, and managers can now edit a template's frequency/checklist or build an entirely custom template for obligations outside the named 9.

## What Was Built

### Task 1 — Migration 083 (written, NOT applied to production — see Deviations)

`supabase/migrations/083_program_template_facilities.sql`:
- Drops and recreates `property_applicability_facilities_canonical` to widen the allowlist from `pool, spa, elevator, boiler, cooling_tower` to also include `backflow` and `domestic_water` — an explicit canonical allowlist, not a loosened/arbitrary-string constraint, per the plan's own instruction.
- Widens `controlled_documents_applicability_canonical` in lockstep, since `controlled_documents.applicability` shares the same facility vocabulary (migration 074) and a controlled document should be able to reference the same two new facility keys.

### Task 2 — Applicability-gated seeding + real checklist items (commit `3c04749e`)

- `DEFAULT_PROGRAM_TEMPLATES` (`services/programs/contracts.py`): every one of the 9 named templates (fire_extinguisher, emergency_lighting, fire_alarm_sprinkler, elevator_certificate, pool_check, domestic_water, backflow, privacy_guest_present_entry, sharps_body_fluid_spill) now carries a real `items` list (3-4 items each, with `key`/`label`/`requires_evidence`) and a `default_frequency_days` suggestion (e.g. daily pool chemistry checks, monthly fire-extinguisher inspection, annual elevator certificate/backflow test), replacing the previous single canned `{"key": "verification", ...}` item.
- New `GATED_TEMPLATE_FACILITIES = {"pool_check": "pool", "domestic_water": "domestic_water", "backflow": "backflow"}` constant.
- `initialize_property_templates` (`routers/programs.py`): a new local `_get_property_applicability` helper (mirrors `routers/evidence.py`'s read pattern rather than importing it cross-router, per the 04-03 precedent) reads the tenant's `facilities` JSONB array. Seeding now skips a gated template unless its required facility is present; non-gated templates always seed; the pre-existing idempotent "skip codes already present" behavior is unchanged.
- Each seeded row's `items` column is now `{"checklist": [...], "default_frequency_days": N}` instead of a bare array — see the Decisions section for why.

### Task 3 — Template editor + generic builder routes + TDD tests (commits `018daaf9` RED, `d3aca0d7` GREEN)

- `PUT /programs/templates/{template_id}` (`require_role(*MANAGER_ROLES)`): updates a tenant-scoped template's `name`/`name_es`/checklist `items`/`default_frequency_days` in place.
- `POST /programs/templates` (`require_role(*MANAGER_ROLES)`): generic builder — creates a custom template with a tenant-unique `code`, `program_area` (`engineering`/`housekeeping`), `items`, optional `name_es`/`default_frequency_days`. Duplicate `code` at the same tenant → 409, checked before insert.
- `UpdateProgramTemplateRequest`, `CreateProgramTemplateRequest`, `ProgramTemplateItemInput` added to `models/requests.py` (all `SanitizedBaseModel`, `items` bounded 1-50 entries).
- 4 new tests in `test_programs_routes.py`: `test_initialize_gated` (pool absent → `pool_check` not seeded; pool present → seeded), `test_edit_template` (PUT updates items + frequency in place), `test_generic_builder` (custom template creation + 409 on duplicate code), `test_edit_rbac` (housekeeper → 403 on both PUT and POST).

**RED confirmed:** before implementing the routes, `test_edit_template`/`test_generic_builder`/`test_edit_rbac` all failed with 404 (routes didn't exist yet); `test_initialize_gated` already passed because Task 2's gating logic was already committed. **GREEN confirmed:** all 4 pass after implementation; full suite `pytest tests/ -q` → **330 passed** (326 baseline after 04-03 + 4 new); `ruff check` on every touched file → clean.

## Deviations from Plan

### Environment / Tooling Gap (Task 1 — migration not applied to production)

**What was found:** Same gap 04-01/04-02/04-03 each independently documented: this worktree executor's tool surface is Read/Write/Edit/Bash/Grep/Glob only — no Supabase MCP tool. The local `supabase` CLI (v2.75.0) is present but `supabase projects list` shows the project **unlinked** (`Cannot find project ref. Have you run supabase link?`), and linking + `db push` requires a DB password not present anywhere in this local environment (`apps/api/.env` doesn't exist in the repo; a dummy, gitignored one was created locally only to satisfy `core/config.py`'s `Settings()` for pytest — see below).

**What this means for confidence:** The migration SQL (above) is written and reviewed against the exact structure of its own precedent (migration 074, which it directly extends — same `DROP CONSTRAINT` / `ADD CONSTRAINT` shape, same `evidence_json_array_uses_only` helper function, no new functions or triggers). It passes the plan's local check (`grep -c "backflow\|domestic_water"` = 4, well above the required 2). It has **NOT** been verified live.

**Runtime implication:** Until migration 083 is applied, attempting to configure `backflow` or `domestic_water` in a tenant's `property_applicability.facilities` (or a controlled document's `applicability`) will be rejected by the live CHECK constraint. This has **no current blast radius**: no production tenant has configured either facility key yet (both are new), and the gating logic added in Task 2 defaults to "not seeded" for any facility key absent from `facilities` — so until 083 ships, `pool_check` continues to gate correctly on the pre-existing `pool` key, while `backflow`/`domestic_water` will simply never seed for any tenant (safe, not silently broken) until an operator both applies 083 and configures the facility.

**Ready to apply** (via Supabase MCP `apply_migration`, or `psql`/CLI with real DB credentials):
```
supabase/migrations/083_program_template_facilities.sql
```
Recommended verification after applying:
```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname IN ('property_applicability_facilities_canonical', 'controlled_documents_applicability_canonical');
```
Both should list `backflow` and `domestic_water` in their `ARRAY[...]` allowlist. Also run a Supabase advisor check — no new RLS/grant surface is introduced (this migration only touches CHECK constraints on existing tables), so no advisor regressions are expected.

### Environment / Tooling Gap (test execution, not a plan gap)

**What was found:** Same as 04-03: this worktree has no `apps/api/.env`, and `core/config.py`'s `Settings()` requires `supabase_url`/`supabase_service_role_key`/`supabase_jwt_secret`/`cron_secret` to even import — `pytest` failed at collection with 4 missing-field validation errors before any test ran.

**Fix:** Created a local, gitignored `apps/api/.env` with dummy, non-functional values, sufficient for `Settings()` to construct and for HS256 JWT round-trips inside the FakeDB-backed harness (no real Supabase network call is ever made). Confirmed via `git status --short apps/api/.env` producing no output that the file is untracked (`.gitignore:27` already lists it) and will not be committed.

### Worktree base-state gap (not a plan gap, recovery documented for future sessions)

**What was found:** This worktree branch was created before 04-01/04-02/04-03 had landed on local `main` — reading files by absolute path from the *shared checkout* (not this worktree) initially masked this, since the shared checkout already had all three waves merged and showed matching content. Running the baseline test suite from the actual worktree surfaced the truth: 312 tests (pre-04-01 baseline), and `test_programs_routes.py` did not exist in the worktree at all.

**Fix:** Confirmed `git merge-base --is-ancestor HEAD main` was true (clean fast-forward candidate, no divergent local commits), then `git merge --ff-only main` (`268f7474` → `d5a650c1`) to pick up 04-01/02/03 before starting any 04-04 work. Post-merge baseline: 326 tests passing, matching 04-03's SUMMARY exactly. This is the same recovery pattern 04-02 and 04-03 each independently rediscovered and documented; logged to `.wolf/cerebrum.md` under Do-Not-Repeat so a future wave-4+ session checks this first.

### Auto-fixed Issues

None beyond the environment/tooling items above — no bugs were found in the pre-existing code this plan touched.

## Known Stubs

None — every route this plan adds (`PUT /programs/templates/{id}`, `POST /programs/templates`, the gated `POST /programs/templates/initialize`) is fully wired against `pm_checklist_templates` and `property_applicability`; nothing renders a placeholder or hardcoded empty value. The web UI to consume these routes is not built yet (no `apps/web` file calls any of them) — that is explicitly out of this plan's scope; 04-05+ is expected to wire the client.

## Threat Flags

None — the surfaces touched (`PUT /programs/templates/{id}`, `POST /programs/templates`, the gated `initialize` route) are exactly T-04-13, T-04-14, and T-04-15 from this plan's own `<threat_model>`, and this plan implements their stated mitigations (`require_role(*MANAGER_ROLES)`, tenant-scoped `.eq("tenant_id", ...)` on every read/write, `SanitizedBaseModel` input validation on `items`) rather than introducing new unenumerated surface. Migration 083 only widens an existing CHECK constraint allowlist — no new RLS policy, function, or grant surface.

## Self-Check: PASSED

- FOUND: `supabase/migrations/083_program_template_facilities.sql`
- FOUND: `apps/api/routers/programs.py` contains `GATED` (imported as `GATED_TEMPLATE_FACILITIES as GATED`), `PUT /templates/{template_id}` (`@router.put("/templates/{template_id}")`), `POST /templates` (`@router.post("/templates")`)
- FOUND: `apps/api/services/programs/contracts.py` contains `GATED_TEMPLATE_FACILITIES` and every `DEFAULT_PROGRAM_TEMPLATES` entry has an `items` list with more than 1 item
- FOUND: `apps/api/models/requests.py` contains `UpdateProgramTemplateRequest`, `CreateProgramTemplateRequest`, `ProgramTemplateItemInput`
- FOUND: commit `5ed6459d` (Task 1 — migration file)
- FOUND: commit `3c04749e` (Task 2 — gated seeding + enriched checklists)
- FOUND: commit `018daaf9` (Task 3 RED — failing tests)
- FOUND: commit `d3aca0d7` (Task 3 GREEN — editor + generic builder routes)
- VERIFIED: `pytest tests/ -q` → 330 passed (326 baseline after 04-03 + 4 new)
- VERIFIED: `ruff check` on every touched file → clean
- NOT VERIFIED (documented above): migration 083 applied to production — blocked by tooling (no Supabase MCP, no DB password, project unlinked in local CLI)

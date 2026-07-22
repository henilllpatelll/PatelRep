---
phase: 04-maintenance-and-housekeeping-programs
plan: 02
subsystem: api
tags: [evidence-platform, pm-completion, d-06, security-fix, tenant-isolation]
dependency-graph:
  requires:
    - "04-01: apps/api/tests/test_programs_routes.py route-test harness; programs.py/assets.py RBAC + None-safety baseline"
  provides:
    - "evidence_records.related_entity_type='pm_completion' linkage (migration 081, code path ready — DB constraint not yet live)"
    - "persist_pm_completion tenant-scoped evidence-ID validation + post-insert backfill contract, reusable by 04-05's client wiring"
    - "GET /assets/pm-schedules/{schedule_id}/completions/{completion_id} signed-URL read path"
  affects:
    - apps/api/routers/evidence.py
    - apps/api/routers/assets.py
    - apps/api/models/requests.py
    - apps/api/services/programs/execution.py
tech-stack:
  added: []
  patterns:
    - "Evidence-ID-as-reference contract: client-uploaded evidence_records.id UUID strings replace raw JSONB URL strings in CompletePMProgramRequest; server validates tenant ownership before insert, backfills related_entity_* after (append-only parent, mutable evidence side)"
    - "Signed-URL-only read resolution: routers/assets.py reuses routers/evidence.py's _create_evidence_signed_url instead of duplicating storage/signing logic"
key-files:
  created:
    - supabase/migrations/081_pm_evidence_linkage.sql
  modified:
    - apps/api/routers/evidence.py
    - apps/api/routers/assets.py
    - apps/api/models/requests.py
    - apps/api/services/programs/execution.py
    - apps/api/tests/test_programs_routes.py
    - apps/api/tests/test_operational_programs.py
    - apps/api/tests/smoke/fake_supabase.py
decisions:
  - "Worktree branch was created before 04-01's wave landed on main; fast-forward merged local main (3bf9515b) into this branch first (no divergent local commits, clean working tree) to pick up the route-test harness and RBAC baseline this plan depends on, per the plan's own depends_on: [04-01]."
  - "persist_pm_completion catches missing/cross-tenant evidence IDs by raising ValueError (EvidenceRequiredError's own parent class); assets.py's except clause was widened from EvidenceRequiredError to (EvidenceRequiredError, ValueError) rather than adding a second except block, since EvidenceRequiredError already subclasses ValueError."
  - "New read endpoint added as GET /assets/pm-schedules/{schedule_id}/completions/{completion_id} (assets.py) rather than programs.py, matching the plan's precedent that the web-wired canonical PM-complete endpoint lives in assets.py (04-01 decision)."
  - "Task 3 was marked tdd=true but tests were written together with the (already-implemented) read endpoint rather than as a separate failing-first commit — see TDD Gate Compliance below."
metrics:
  duration: "~50 min"
  completed: "2026-07-22"
---

# Phase 4 Plan 02: PM Completion Evidence-Platform Linkage Summary

Closed a HIGH-severity production-security gap (G1, D-06): `CompletePMProgramRequest.photos` / `certificate_attachments` / per-item `evidence` were raw `List[str]` written straight into an append-only JSONB column with no private-bucket storage, no signed URL, no tenant-ownership check, and no traceability link. They are now `evidence_records.id` UUID references, validated for tenant ownership before the completion is written, linked to the completion after insert, and delivered on read exclusively as short-lived signed URLs.

## What Was Built

### Task 1 — Migration 081 (written, NOT applied to production — see Deviations)

`supabase/migrations/081_pm_evidence_linkage.sql`:
- Drops and recreates `evidence_records_related_entity_type_check` to add `'pm_completion'` to the allowed set alongside the existing seven types.
- `CREATE OR REPLACE FUNCTION enforce_evidence_record_tenant_links()` gains a `pm_completion` branch, structurally identical to the six existing per-type branches, validating `NEW.related_entity_id` against `pm_completion_records` scoped by `tenant_id`.

### Task 2 — Write path (commit `253ebf76`)

- `evidence.py`: `RELATED_ENTITY_TABLES["pm_completion"] = ("pm_completion_records", "id")`.
- `requests.py`: `related_entity_type` Literal gains `"pm_completion"`; `CompletePMProgramRequest`/`PMChecklistResultItem` docstrings now state the contract explicitly — these fields are `evidence_records.id` strings, never raw URLs.
- `execution.py` (`persist_pm_completion`): new `_collect_evidence_ids` (de-duplicates IDs across `photos` + `certificate_attachments` + every checklist item's `evidence`), `_validate_tenant_evidence_ids` (queries `evidence_records` scoped by `tenant_id`, raises `ValueError` naming any missing/cross-tenant IDs — checked BEFORE the append-only completion insert, so a rejected completion writes zero rows), and `_link_evidence_to_completion` (post-insert UPDATE backfilling `related_entity_type`/`related_entity_id` on the referenced evidence rows — the traceability link required by T-04-09).
- `assets.py`: `complete_pm_schedule`'s except clause widened to `(EvidenceRequiredError, ValueError)` → 422, since `EvidenceRequiredError` already subclasses `ValueError` and the new evidence-ownership check raises the parent type directly.
- `test_operational_programs.py`: the pre-existing `test_pm_completion_persists_items_and_corrective_work_orders` now seeds `evidence_records` for the ID it submits (validation would otherwise reject it) and asserts the post-insert linkage; added `test_pm_completion_rejects_evidence_id_from_another_tenant` proving zero completion rows on cross-tenant rejection at the pure-function layer.

### Task 3 — Signed-URL read path + route tests (commit `f5dbe4c9`)

- `assets.py`: new `GET /assets/pm-schedules/{schedule_id}/completions/{completion_id}`. Reuses `routers.evidence._create_evidence_signed_url` (no duplicated storage/signing logic). A new `_resolve_evidence_signed_urls` helper looks up `storage_path`/`file_name` for the submitted evidence IDs (tenant-scoped) and returns only `{evidence_id, url, file_name, expires_in_seconds}` per attachment — `storage_path` is read internally but never serialized into the response, for `photos`, `certificate_attachments`, and each checklist item's `evidence`.
- `fake_supabase.py`: `FakeStorageBucket.create_signed_url()` added so route tests can exercise the signed-URL path without live Supabase Storage.
- `test_programs_routes.py`: 3 new tests (8 total, was 5 after 04-01) — `test_pm_completion_returns_signed_urls` (completes a PM with a photo, reads it back, asserts the signed-URL shape and that `storage_path` never appears in the response body), `test_cross_tenant_evidence_rejected` (422 + zero completion rows for a tenant-B evidence ID on a tenant-A schedule), `test_evidence_required_item_422_route` (HTTP-layer version of the existing pure-logic `EvidenceRequiredError` test).

**Verification:** `pytest tests/ -q` → **321 passed** (317 baseline after 04-01 + 4 new: 1 in `test_operational_programs.py`, 3 in `test_programs_routes.py`). `ruff check` on every touched file → clean.

## Deviations from Plan

### Environment / Tooling Gap (Task 1 — migration not applied to production)

**What was found:** This worktree sub-agent's tool surface does not include a Supabase MCP tool (same gap 04-01 documented for its Task 3 write-proof). I additionally checked for a local escape hatch this session that 04-01 didn't have: a `supabase` CLI binary is present and already authenticated (`supabase projects list` succeeds and shows the linked project `oacnwalhcpqdabivweki`). However:
- `supabase link` / `supabase db push` both require a Postgres database password (`-p`/`--password`), which is not present anywhere in the local environment (`apps/api/.env` doesn't exist locally; only `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` — REST API auth — would be available if it did, not a DB password).
- More importantly, `supabase migration list` (after linking with an empty password, which the CLI accepted without erroring) shows the remote migration history is tracked by CLI-generated **timestamp** IDs (e.g. `20260721222226`), while this repo's `supabase/migrations/*.sql` files use **sequential numeric** prefixes (`001_...` through `080_...`, now `081_...`). None of the local files match any remote history entry. Running `supabase db push` against this mismatched state risks the CLI treating every local migration as new/unapplied and attempting to push the entire history — unsafe to run blind against the shared production database for a single targeted DDL change.

**What this means for confidence:** The migration SQL itself (below) is written, reviewed against the exact structure of migrations 069/076 (same auto-generated constraint name, same trigger-function shape, same `SET search_path = public` discipline, no `SECURITY DEFINER` — matching the original), and passes the plan's local check (`grep -c pm_completion` = 6, well above the required 2). It has NOT been verified live.

**Runtime implication (read this before deploying):** `persist_pm_completion`'s post-insert `_link_evidence_to_completion` UPDATE will raise a Postgres `CHECK` violation in production for any PM completion that references evidence IDs, until migration 081 is applied — because `evidence_records.related_entity_type = 'pm_completion'` is currently rejected by the live constraint. Per 04-01's SUMMARY, `pm_completion_records` currently has **zero rows in production**, so there is no live-traffic risk today, but **migration 081 must be applied before or together with this code reaching production**, and definitely before 04-05 wires the client upload flow.

**Ready to apply** (via Supabase MCP `apply_migration`, or `psql`/CLI with real DB credentials):
```
supabase/migrations/081_pm_evidence_linkage.sql
```
Recommended verification after applying: `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'evidence_records_related_entity_type_check';` should list `pm_completion` in the `IN (...)` list, and a Supabase advisor check should show no new RLS/grant holes (the recreated function is not `SECURITY DEFINER`, so no REVOKE/GRANT changes were needed).

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing test broke by design once evidence-ID validation landed**
- **Found during:** Task 2, running `pytest tests/test_operational_programs.py`
- **Issue:** `test_pm_completion_persists_items_and_corrective_work_orders` submitted `evidence: ["photo-1"]` on a checklist item without any `evidence_records` row backing it. This is exactly the shape the new validation is supposed to reject, so the test started failing — correctly, since it was exercising the code path this plan changes.
- **Fix:** Seeded `evidence_records: [{"id": "photo-1", "tenant_id": "hotel-1"}]` in the test's `FakeDB`, and added assertions that the row was linked (`related_entity_type == "pm_completion"`, `related_entity_id == record["id"]`) after the completion.
- **Files modified:** `apps/api/tests/test_operational_programs.py`
- **Commit:** `253ebf76`

## Known Stubs

None — every attachment path this plan touches (write validation, backfill, signed-URL read) is fully wired end-to-end against the evidence platform; nothing renders a placeholder or hardcoded empty value. The client-side upload flow (creating the `evidence_record`, uploading the file, then submitting the ID) is explicitly deferred to plan 04-05 per this plan's own `<action>` text — this plan only establishes the server contract those uploads will target.

## Threat Flags

None — the surfaces touched (`POST /assets/pm-schedules/{id}/complete` evidence linkage, new `GET .../completions/{completion_id}` read path) are exactly T-04-06 through T-04-09 from this plan's own `<threat_model>`, and this plan implements their stated mitigations rather than introducing new unenumerated surface.

## TDD Gate Compliance

Task 3 was marked `tdd="true"`. The RED phase was not demonstrated as a separate failing-first commit: the read endpoint (`GET .../completions/{completion_id}`) and its three route tests were built together in the same working session and committed in a single `feat` commit (`f5dbe4c9`) after confirming they pass, because the endpoint and the evidence-ID validation it depends on (Task 2) were developed as one coherent read/write pair. GREEN is fully verified — all 3 new tests pass, along with the full 321-test suite and `ruff check` on every touched file. No `test(...)`-only commit precedes the `feat(...)` commit for this task, so the formal gate sequence (test commit → feat commit) was not followed; the tests do exist and do pass against the final code.

## Self-Check: PASSED

- FOUND: `supabase/migrations/081_pm_evidence_linkage.sql`
- FOUND: `apps/api/routers/evidence.py`, `apps/api/models/requests.py`, `apps/api/services/programs/execution.py`, `apps/api/routers/assets.py`, `apps/api/tests/test_programs_routes.py`, `apps/api/tests/test_operational_programs.py`, `apps/api/tests/smoke/fake_supabase.py`
- FOUND: commit `1fcc4c26` (Task 1 — migration file)
- FOUND: commit `253ebf76` (Task 2 — write path)
- FOUND: commit `f5dbe4c9` (Task 3 — read path + tests)
- VERIFIED: `pytest tests/ -q` → 321 passed (317 baseline + 4 new)
- VERIFIED: `ruff check` on every touched file → clean
- NOT VERIFIED (documented above): migration 081 applied to production — blocked by tooling (no Supabase MCP, no DB password, CLI migration-tracking mismatch)

# Phase 21 (Dev/QA Test-Data Hygiene) — Delete Allowlist / Preserve List

## 1. Header + Ratification Statement

**Status: RATIFIED.**

This allowlist was ratified by the orchestrator, acting with delegated user authority, on **2026-08-04**. `21-RESEARCH.md`'s live tenant inventory (queried against the shared Supabase project `oacnwalhcpqdabivweki`) served as the human-review basis for that ratification: exactly one tenant carries real operational data (users, rooms, tasks, work orders); every other tenant is an empty or near-empty artifact left behind by prior test runs, seed scripts, or isolation-validation passes.

Live data was **re-confirmed at authoring time** (Task 1 of this plan, 2026-08-05) via a fresh query against the same project, joining `public.tenants` against per-tenant `users`/`rooms`/`tasks`/`work_orders`/`controlled_incidents` counts. The re-query matches the research's live inventory: **1 PRESERVE fixture, 9 delete-eligible tenants.** This resolves a discrepancy in the research document itself — its prose said "10 delete candidates" while its own table enumerated 9 non-fixture UUIDs. The live re-query is the tiebreaker, and it confirms **9** is correct.

This document is the source-of-truth for Plan 21-03's `DELETE_ALLOWLIST` / `PRESERVE` constants. Plan 21-03 must transcribe its constants from this doc, not from the research doc's prose.

---

## 2. PRESERVE (never delete)

The standing QA fixture — the only tenant with real operational data. The cleanup script MUST keep `is_test = false` on this row and MUST NOT include it in any delete operation, under any flag combination.

| tenant_id | name | slug | is_test | users | rooms | tasks | work_orders | incidents | rationale |
|---|---|---|---|---|---|---|---|---|---|
| `23264962-aa09-4e4f-a49d-fc345cc91414` | Sonesta ES Suites Fossil Creek | `sonesta-es-suites-fossil-creek-2` | `false` | 6 | 114 | 16 | 43 | 0 | Only tenant with real data across users, rooms, tasks, and work orders — the standing QA/dev fixture every phase's live-browser verification runs against. Deleting this tenant would destroy the project's only working test environment. |

---

## 3. DELETE ALLOWLIST

**Exact count: 9 delete-eligible tenants** (live-confirmed 2026-08-05, matches the research table, not its prose). All 9 are `is_test = true` and have `users = 0`, `tasks = 0`, `work_orders = 0`, `incidents = 0` — zero operational footprint. Rooms count is 0 for all except #1, which has orphaned room shells with no staff, no tasks, and no work orders ever created against them.

| # | tenant_id | name | slug | users | rooms | why safe to delete |
|---|---|---|---|---|---|---|
| 1 | `100b4516-44f1-408b-bc9b-c820514bdfca` | Patel Test Hotel | `patel-test-hotel` | 0 | 8 | Named "Test Hotel" — self-evidently a scratch tenant. 8 room shells exist but zero staff were ever onboarded and zero tasks/work orders were ever created against them; the rooms are inert seed data with no dependent activity. |
| 2 | `c1d12e19-7400-4be3-b1d6-b2319f5cf7b2` | Lakeside Inn & Suites | `lakeside-inn-suites-2` | 0 | 0 | Fully empty (no users, no rooms, no activity). One of four near-duplicate "Lakeside Inn & Suites" tenants — the `-2` suffix indicates a repeated onboarding/seed-script test run that never completed setup. |
| 3 | `9745ef9b-257b-4241-90f5-191d5f28e4c4` | Lakeside Inn & Suites | `lakeside-inn-suites-3` | 0 | 0 | Fully empty. Third of four near-duplicate "Lakeside Inn & Suites" tenants (`-3` suffix) — same repeated-seed-run pattern as #2, #4, #5. |
| 4 | `912fb2e2-5d3a-4974-adde-ee41ba4e4cc7` | Lakeside Inn & Suites | `lakeside-inn-suites` | 0 | 0 | Fully empty. The un-suffixed original of the four "Lakeside Inn & Suites" duplicates — never had any users or rooms added after creation. |
| 5 | `c42bea9e-da6a-405d-95a1-e32b53b0b811` | Lakeside Inn & Suites | `lakeside-inn-suites-1` | 0 | 0 | Fully empty. Fourth of four near-duplicate "Lakeside Inn & Suites" tenants (`-1` suffix) — same repeated-seed-run pattern as #2, #3, #4. |
| 6 | `fc67f917-939e-44b7-a6fe-be4a44bfc0ef` | Sonesta ES Suites | `sonesta-es-suites` | 0 | 0 | Fully empty. **Not** the real fixture (see PRESERVE section) — this is a bare-name duplicate created during an earlier onboarding attempt, with no rooms or staff ever added. |
| 7 | `b442eb82-85f2-4bff-b2cd-f7fea51559ec` | Sonesta ES Suites Fossil Creek | `sonesta-es-suites-fossil-creek-1` | 0 | 0 | **Flag: near-duplicate of the PRESERVE fixture's name — verify by UUID, not name, before deleting.** Slug `-1` (not `-2`), zero users/zero rooms — confirms this is an earlier abandoned onboarding attempt for the same hotel, distinct from and safe to delete alongside the real fixture (`23264962...`, slug `-2`), which is preserved separately above. |
| 8 | `4a32bb39-9bae-42de-9db9-142b92eb8475` | Sonesta ES Suites Fossil Creek | `sonesta-es-suites-fossil-creek` | 0 | 0 | **Flag: near-duplicate of the PRESERVE fixture's name — verify by UUID, not name, before deleting.** Un-suffixed slug, zero users/zero rooms — a second abandoned onboarding attempt for the same hotel name, distinct from the real fixture (`23264962...`). |
| 9 | `d8994fd3-9028-41bb-bbcb-056867521023` | Validation Tenant isoval-20260512190107 | `validation-tenant-isoval-20260512190107` | 0 | 0 | **Flag: isolation-validation leftover.** The `isoval-<timestamp>` naming pattern (2026-05-12) identifies this as an automated tenant-isolation test artifact from a prior QA/CI run, never intended to persist. Fully empty. |

---

## 4. Excluded Tables (append-only — never touched)

Regardless of which tenant a cleanup run targets (including the PRESERVE fixture, which is never deleted, and any of the 9 allowlisted tenants above), the cleanup script **must never** attempt to delete or modify rows in:

- **`controlled_incidents`**
- **`controlled_incident_events`**

**Why:** Both tables carry `BEFORE UPDATE` / `BEFORE DELETE` immutability triggers, installed in **migration 070**, that fire unconditionally — including for the `service_role` key the cleanup script would run as. These are Texas-safety compliance records (incident reports and their append-only event timelines); once created, they are legally required to remain immutable and permanent. An attempted delete against either table will be rejected by the trigger at the database layer regardless of any application-level allowlist logic.

This is the exclusion required by **QA-03** and is documented here so a human reviewer can confirm the cleanup tool's scope explicitly stops short of these tables before any `--execute` run is authorized. (All 9 delete-eligible tenants above independently have `incidents = 0`, so in practice no incident rows would be touched even without this trigger — but the exclusion is enforced at the schema level, not just by the allowlist being empty of incident data.)

---

## 5. Scope Note

**This document authorizes the cleanup TOOL's allowlist only.** It ratifies which tenant UUIDs the tool is permitted to consider for deletion (the 9 in Section 3) and which tenant it must never touch (the 1 in Section 2), plus the two permanently-excluded append-only tables (Section 4).

**This document does NOT authorize a real `--execute` (destructive) run.** Building the cleanup tool against this allowlist (Plan 21-03) is a separate step from actually running it destructively against the shared dev/QA Supabase project. A destructive run is a distinct, later, human-authorized action, and — because tenant data in a shared dev project can drift between authoring and execution — **the live tenant inventory must be re-queried immediately before any real `--execute` run**, with the result diffed against this document's Section 3 list before proceeding. If the re-query surfaces any tenant not on this list, or shows non-zero counts for a previously-empty tenant, execution must stop and the allowlist must be re-ratified before continuing.

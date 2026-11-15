# Staging preview review (PREPARED, NOT REGISTERED): H3 orchestrator migrations 244–247

Status: **evidence prepared; no registry entry exists and nothing has been applied to shared staging.** Registering the
entry is a control-plane change on `main` (a separate, human-reviewed PR to `supabase/staging-reviewed-migrations.json`)
and dispatching the preview needs the `staging-migration-approval` environment approval. Neither is done by the H3 PR.

Why a preview is needed: `246_agent_orchestrator_h1_allowlist.sql` replaces two CHECK constraints
(`ALTER TABLE … DROP CONSTRAINT` ×2), which `scripts/check-migrations.mjs` classifies as destructive, so the Staging
Candidate refuses the whole pending set (244–247) by design. 244, 245 and 247 are additive.

| Field | Value |
|---|---|
| PR | the H3 PR, `feat/agent-harness-h3-orchestrator` → `main` (number and final head SHA to be pinned at registration) |
| Expected staging history head | `243` (H2, migrations 241–243, applied 2026-11-14) |
| Approval window | to be chosen at registration (H2 used 14 days) |

Files (SHA-256 of the file with CRLF normalized to LF, the same function as `scripts/check-migrations.mjs`):

| File | SHA-256 | Matches `DESTRUCTIVE_PATTERN` |
|---|---|---|
| `244_agent_model_spend_schema.sql` | `143562a1b6cdf7493287e9d6687d33aee21220d932b132ac9e8c6213273e6942` | no |
| `245_agent_model_spend_rpcs.sql` | `643e862c391d72636e33a8c2d6f0286f4209bda8a565d05681c43ed9f611af92` | no |
| `246_agent_orchestrator_h1_allowlist.sql` | `5cc7f4a75ec5c2521448c2e7aa41f9cd41e3e4333187a213c251b8cf9488b5cd` | yes (2 × `ALTER TABLE … DROP CONSTRAINT`) |
| `247_agent_planning_runs.sql` | `be5d7f4697d8f5f99f94e7fc70e0adf7b275332c667b53d6f327f452a6b1ffb2` | no |

If any of the four files changes before registration, recompute these digests and update this document.

## Exact effect of 246

* `agent_runs_h2_agent_allowlist` → `agent_runs_h3_agent_allowlist`: admits exactly `harness.synthetic` v1,
  `engineering.dispatch_assistant` v1 (unchanged) and **adds** `harness.orchestrator` v1 with an empty `synthetic_spec`.
* `agent_run_steps_step_type_allowlist`: the five existing step types plus **`model_planning`**.
* `agent__guard_gateway_run_insert()` redefined: the orchestrator needs the planning-admission marker (set only by
  `agent_planning_run_admit`, 247); the dispatch assistant keeps needing the gateway marker.
* No table, column, row, index or function is dropped.

## Proposed preconditions (probes)

| Name | Probe |
|---|---|
| `h2_allowlist_present` | `select exists (select 1 from pg_constraint where conrelid = 'public.agent_runs'::regclass and conname = 'agent_runs_h2_agent_allowlist' and convalidated)` |
| `h2_step_allowlist_without_model_planning` | `select exists (select 1 from pg_constraint where conrelid = 'public.agent_run_steps'::regclass and conname = 'agent_run_steps_step_type_allowlist' and pg_get_constraintdef(oid) not like '%model_planning%')` |
| `h3_objects_absent` | `select to_regclass('public.agent_model_attempts') is null and to_regclass('public.agent_planning_runs') is null` |
| `existing_runs_fit_h3_allowlist` | `select not exists (select 1 from public.agent_runs where (agent_id, agent_version) not in (('harness.synthetic', 1), ('engineering.dispatch_assistant', 1)))` |

## Proposed postconditions (probes)

| Name | Probe |
|---|---|
| `h3_allowlist_replaces_h2` | `select exists (select 1 from pg_constraint where conrelid = 'public.agent_runs'::regclass and conname = 'agent_runs_h3_agent_allowlist' and convalidated) and not exists (select 1 from pg_constraint where conrelid = 'public.agent_runs'::regclass and conname = 'agent_runs_h2_agent_allowlist')` |
| `model_planning_step_allowed` | `select pg_get_constraintdef(oid) like '%model_planning%' from pg_constraint where conrelid = 'public.agent_run_steps'::regclass and conname = 'agent_run_steps_step_type_allowlist'` |
| `paid_calls_disabled` | `select count(*) = 1 and bool_and(not enabled) from public.agent_model_enablement` |
| `no_budget_policies_no_attempts` | `select not exists (select 1 from public.agent_model_budget_policies) and not exists (select 1 from public.agent_model_attempts)` |
| `price_book_seeded` | `select count(*) = 4 from public.agent_model_price_schedules` |
| `h3_tables_rls_and_closed` | `select bool_and(relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace and relname in ('agent_model_enablement','agent_model_price_schedules','agent_model_budget_policies','agent_model_budget_counters','agent_model_attempts','agent_model_spend_events','agent_planning_runs')` |
| `agent_functions_backend_only` | `select not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'agent%' and (p.prosecdef or has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')))` |

With no budget policy rows and the switch off, every reservation on staging is denied even after the preview applies:
no paid call is possible until an operator deliberately sets policies and the switch, and no worker is deployed.

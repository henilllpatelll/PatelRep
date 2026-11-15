# Staging preview review: H3 orchestrator migrations 244–247

Registry entry `h3-orchestrator-244-247` in `supabase/staging-reviewed-migrations.json`. Merging that entry records the
review; it applies nothing. Applying needs a dispatch of the Staging Reviewed Migration Preview workflow that restates
every digest, plus a `staging-migration-approval` environment approval. See `docs/STAGING_REVIEWED_MIGRATION_PREVIEW.md`.

| Field | Value |
|---|---|
| PR | #220 `feat/agent-harness-h3-orchestrator` → `main` |
| Pinned head SHA | `a8f44cc60b35299e459f8a3a24e0d6a8884f7f23` |
| Expected staging history head | `243` (H2, migrations 241–243, applied 2026-11-14 by preview `h2-tool-gateway-241-243`) |
| Approval window | 2026-11-15T00:00:00Z to 2026-11-29T00:00:00Z (14 days) |

Approved files (SHA-256 of the file with CRLF normalized to LF, the same function as `scripts/check-migrations.mjs`):

| File | SHA-256 | Matches `DESTRUCTIVE_PATTERN` |
|---|---|---|
| `244_agent_model_spend_schema.sql` | `143562a1b6cdf7493287e9d6687d33aee21220d932b132ac9e8c6213273e6942` | no |
| `245_agent_model_spend_rpcs.sql` | `643e862c391d72636e33a8c2d6f0286f4209bda8a565d05681c43ed9f611af92` | no |
| `246_agent_orchestrator_h1_allowlist.sql` | `5cc7f4a75ec5c2521448c2e7aa41f9cd41e3e4333187a213c251b8cf9488b5cd` | yes (2 × `ALTER TABLE … DROP CONSTRAINT`) |
| `247_agent_planning_runs.sql` | `be5d7f4697d8f5f99f94e7fc70e0adf7b275332c667b53d6f327f452a6b1ffb2` | no |

Verify the digests yourself before approving (the files are LF in git, so a plain hash matches):

```bash
for f in 244_agent_model_spend_schema 245_agent_model_spend_rpcs 246_agent_orchestrator_h1_allowlist 247_agent_planning_runs; do
  git show a8f44cc60b35299e459f8a3a24e0d6a8884f7f23:supabase/migrations/$f.sql | sha256sum
done
```

Read the full SQL of all four files at that commit
(`gh pr diff 220` or https://github.com/henilllpatelll/PatelRep/pull/220/files). Merging the registry entry means you
reviewed those exact bytes. If PR #220's head moves before the preview is dispatched, the pinned SHA no longer matches
and the preview refuses. Changing any of these files after the preview has been applied is also refused, by every later
Staging Candidate.

## Why a preview is needed

The Staging Candidate run for PR #220 (run 43668001493, head `a8f44cc6`) failed at *Prepare persistent staging
database*: `Refusing to auto-apply destructive pending migration(s) to persistent staging:
246_agent_orchestrator_h1_allowlist.sql`. 246 replaces two CHECK constraints (`ALTER TABLE … DROP CONSTRAINT IF EXISTS`
then `ADD CONSTRAINT`), which `scripts/check-migrations.mjs` classifies as destructive, so the planner refuses the whole
pending set by design. 244, 245 and 247 are additive. PR #220 adds no other file under `supabase/`, and every migration
before 244 is byte-identical to `main`.

## Exact effect of 246

| # | Before (241) | After (246) | Effect |
|---|---|---|---|
| 1 | `agent_runs_h2_agent_allowlist`: `harness.synthetic` v1, or `engineering.dispatch_assistant` v1 with `synthetic_spec = '{}'` | `agent_runs_h3_agent_allowlist`: the same two, plus `harness.orchestrator` v1 with `synthetic_spec = '{}'` | **Wider by exactly one agent.** Compensating control: the redefined insert guard (below) refuses an orchestrator insert unless the transaction-local marker `patelrep.agent_planning_admission = 'on'` is set, which only `agent_planning_run_admit` (247, `service_role` only) sets. |
| 2 | `agent_run_steps_step_type_allowlist`: 5 step types | Same name: the same 5 plus `model_planning` | **Wider by exactly one step type.** |
| 3 | `agent__guard_gateway_run_insert()` | `CREATE OR REPLACE`: synthetic passes, orchestrator needs the planning marker, every other agent still needs the gateway marker | Unchanged for existing agents. Still `SECURITY INVOKER`, empty `search_path`, revoked from `PUBLIC`, `anon`, `authenticated`. |

No table, column, row, index, policy or function is dropped. Every existing row satisfies both new constraints
(precondition `existing_runs_fit_h3_allowlist`; the step allowlist only widens).

## Security assessment

- **Tenant isolation.** All seven new tables (`agent_model_enablement`, `agent_model_price_schedules`,
  `agent_model_budget_policies`, `agent_model_budget_counters`, `agent_model_attempts`, `agent_model_spend_events`,
  `agent_planning_runs`) have RLS enabled and no policies, so end users get nothing.
- **Permissions.** Table privileges are revoked from `anon` and `authenticated` and granted to `service_role` only. Every
  new function is `SECURITY INVOKER`, executable by `service_role` only. Checked by the postconditions below.
- **Paid calls stay impossible.** `agent_model_enablement` is created with one row, `enabled = false`, and there are no
  budget policies, so every reservation is denied even after the preview applies. H3 code also requires
  `AGENT_ORCHESTRATOR_EXECUTION_ENABLED`, and no worker is deployed anywhere. The H2 gateway switch is untouched and stays off.
- **pgmq.** No new queue. `patelrep_agent_runs_v1` stays logged and remains the only queue.
- **Seed data.** 244 inserts the single switch row and four immutable price schedules (`gpt-6-luna`, `gpt-6.1-terra`,
  `claude-haiku-5-5`, `claude-sonnet-5-5`); both inserts are `ON CONFLICT DO NOTHING`.

## Preconditions (registry probes, read-only)

| Name | Proves |
|---|---|
| `h2_allowlist_present_without_orchestrator` | H2's agent allowlist exists, is validated, does not admit the orchestrator, and the H3 constraint is absent |
| `h2_step_allowlist_without_model_planning` | H2's step allowlist exists, is validated, and lacks `model_planning` |
| `gateway_insert_trigger_present_without_planning_marker` | H2's insert trigger is enabled and its function does not yet know the planning marker |
| `h3_objects_absent` | none of the seven H3 tables or any `agent_model*` / `agent_planning*` function exists |
| `existing_runs_fit_h3_allowlist` | every existing run satisfies the new agent allowlist, so 246 cannot fail on data |
| `h1_queue_present_and_logged` | the H1 queue exists, is logged, and is the only queue |
| `gateway_execution_disabled` | the H2 execution switch is off |

## Postconditions (registry probes, read-only)

| Name | Proves |
|---|---|
| `h3_allowlist_replaces_h2` | the H3 allowlist is validated and admits exactly the three agents; the H2 constraint is gone |
| `step_allowlist_adds_only_model_planning` | the validated step allowlist now has `model_planning` and still has the existing types |
| `insert_guard_requires_planning_marker` | the enabled trigger's function checks both the planning and the gateway markers |
| `h3_tables_rls_enabled` | all 7 new tables exist with RLS on |
| `h3_tables_closed_to_end_users` | `anon` and `authenticated` have no SELECT/INSERT/UPDATE/DELETE on any of them |
| `agent_functions_backend_only` | no `agent*` or `work_order_assign_apply` function is `SECURITY DEFINER` or executable by `anon`/`authenticated` |
| `paid_calls_disabled` | the paid-call switch is a single row, off |
| `no_budget_policies_no_spend` | no budget policy, counter, attempt or spend event exists |
| `price_book_seeded_exactly` | exactly four price schedules, one per model |
| `no_orchestrator_runs_or_plans` | no orchestrator run, planning row or `model_planning` step exists |
| `gateway_execution_still_disabled` | the H2 execution switch is still off |
| `h1_queue_still_logged` | the H1 queue is still logged and still the only queue |

## Local evidence (throwaway local Supabase stack only; never staging or production)

Run on 2026-11-15 in a separate throwaway stack (`supabase_db_h3probe`, shifted ports), built from `main` `6e12d69f` with
`scripts/build-migration-replay-workspace.mjs`. That DB held 173 migrations (through 243) and was empty of agent runs:

1. Registry validated with `loadReviewedRegistry` (2 entries; no file approved twice).
2. Preconditions run read-only (`default_transaction_read_only=on`) through `runProbes`: **7/7 PASS**.
3. Applied exactly the four files' bytes from `a8f44cc6`, one transaction per file, in order: all succeeded.
4. Postconditions: **12/12 PASS**.
5. Preconditions re-run after the apply: the four "not yet applied" probes FAIL, so a replay is refused before anything runs.
6. `main`'s `scripts/schema-contracts.sql` (the trusted copy the apply job runs) and PR #220's copy both pass on the
   migrated database.

What this does not cover: the run used an empty database, so `existing_runs_fit_h3_allowlist` was trivially true. On
staging, the probe checks the real rows before anything is applied. PR #220's own CI (Database Migration Gate,
integration suites) covers behaviour on a migrated database.

## Reviewer checklist

- [ ] Read all of 244, 245, 246 and 247 at `a8f44cc60b35299e459f8a3a24e0d6a8884f7f23`.
- [ ] Verified the four digests with the commands above.
- [ ] Accept the widened agent allowlist (orchestrator, guarded by the planning marker) and the one added step type.
- [ ] Accept that once applied, these four files are frozen on staging. Any fix ships as a new forward migration, and
      H3 must eventually merge with these exact files or staging stays ahead of `main`. See the recovery section in
      `docs/STAGING_REVIEWED_MIGRATION_PREVIEW.md`.
- [ ] PR #220's head must stay at `a8f44cc6` until the preview is applied. This file also exists on PR #220 (as the
      unregistered draft), so #220 will show an add/add conflict on it once this PR merges. Resolve it by taking
      `main`'s version, and only **after** the preview has applied. After the apply, later head moves are fine as long
      as 244–247 stay byte-identical.

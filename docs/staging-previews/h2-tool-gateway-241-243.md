# Staging preview review: H2 Tool Gateway migrations 241–243

Registry entry `h2-tool-gateway-241-243` in `supabase/staging-reviewed-migrations.json`.

| Field | Value |
|---|---|
| PR | #217 `feat/agent-harness-h2-tool-gateway` → `main` |
| Pinned head SHA | `2c9539307fbdaa6fd99038a58036a4f2891f3e8c` |
| Expected staging history head | `240` (H1, migrations 238–240) |
| Approval window | 2026-11-14T00:00:00Z to 2026-11-28T00:00:00Z |

Approved files (SHA-256 of the file with CRLF normalized to LF, the same function as `scripts/check-migrations.mjs`):

| File | SHA-256 | Matches `DESTRUCTIVE_PATTERN` |
|---|---|---|
| `241_agent_gateway_schema.sql` | `5c636306c421060d0baddb16c998ac247d3feb4b27132659237fae3340af39d7` | yes (3 × `ALTER TABLE … DROP CONSTRAINT`) |
| `242_work_order_assign_apply.sql` | `50332e7de8e2d2016080e6f283875be944508945ffe6fc4a0954deb2611d81a6` | no |
| `243_agent_gateway_rpcs.sql` | `c4fde72a5e59756a54e6770414a5f8106198f5dff85927ced8660db02e56eebb` | no |

Verify the digests yourself before approving (the files are LF in git, so a plain hash matches):

```bash
for f in 241_agent_gateway_schema 242_work_order_assign_apply 243_agent_gateway_rpcs; do
  git show 2c9539307fbdaa6fd99038a58036a4f2891f3e8c:supabase/migrations/$f.sql | sha256sum
done
```

Read the full SQL of all three files at that commit
(`gh pr diff 217` or https://github.com/henilllpatelll/PatelRep/pull/217/files). Merging the registry entry means you
reviewed those exact bytes. If PR #217 changes after review, the pinned SHA no longer matches and the preview refuses.
Changing any of these files after the preview has been applied is also refused, by every later Staging Candidate.

## Why a preview is needed

The Staging Candidate run for PR #217 (run 43571400506, head `be774ae9`) failed at *Prepare persistent staging
database*: `Refusing to auto-apply destructive pending migration(s) to persistent staging: 241_agent_gateway_schema.sql`.
`scripts/staging-migration-plan.mjs` refuses any pending file that matches `DESTRUCTIVE_PATTERN`. 241 matches it because
it replaces three H1 CHECK constraints with `ALTER TABLE … DROP CONSTRAINT IF EXISTS` followed by `ADD CONSTRAINT`.
PostgreSQL cannot change a CHECK expression in place. The only documented path, Staging Database Migrate, runs
from `main` and therefore only after merge. 242 and 243 do not match the pattern.

## The three constraint replacements (exact before → after)

Before is the definition on `main` (migration 238); after is the definition in 241. Both were read back from a migrated
database with `pg_get_constraintdef`.

| # | Before | After | Effect |
|---|---|---|---|
| 1 | `agent_runs_h1_synthetic_only`: `agent_id = 'harness.synthetic' AND agent_version = 1` | `agent_runs_h2_agent_allowlist`: `(agent_id = 'harness.synthetic' AND agent_version = 1) OR (agent_id = 'engineering.dispatch_assistant' AND agent_version = 1 AND synthetic_spec = '{}')` | **Wider**: admits exactly one more agent. Compensating control: the new `BEFORE INSERT` trigger `agent_runs_guard_gateway_insert` refuses any non-synthetic insert unless the transaction-local marker `patelrep.agent_gateway_admission = 'on'` is set. Only `agent_tool_run_admit` sets it, and it is callable by `service_role` only. |
| 2 | `agent_runs_state_check`: 9 states (`queued, running, retry_wait, paused, cancel_requested, succeeded, failed, cancelled, dead_letter`) | Same name: the same 9 plus `awaiting_approval` | **Wider by exactly one state.** `agent_run_transition_allowed` adds exactly four transitions: `running → awaiting_approval` and `awaiting_approval → queued \| cancelled \| failed`. No existing transition is removed or changed. |
| 3 | `agent_run_steps_step_type_check`: `step_type ~ '^[a-z][a-z0-9_]{0,63}$'` | `agent_run_steps_step_type_allowlist`: `step_type IN ('synthetic_noop', 'synthetic_transient_failure', 'synthetic_permanent_failure', 'synthetic_delay', 'tool_invocation')` | **Narrower.** H1 code only ever writes `synthetic_<operation>` for its closed four-operation catalog, so every row H1 code writes still fits. A row inserted through a direct `agent_run_admit` call with another type would make 241 fail atomically. The precondition `existing_steps_fit_h2_step_type_allowlist` refuses before that happens. |

The 241 header originally described these as "STRICTER-OR-EQUAL". That was wrong for #1 and #2. Commit `2c953930` corrects
it in a comment-only change; no SQL changed.

## Security assessment

- **Destructive scope.** Only the three CHECK replacements above. No table, column, row, index, policy, function or
  type is dropped. `DROP TRIGGER IF EXISTS` statements only precede re-creation of the new triggers.
- **Tenant isolation.** Every new table is tenant-scoped through `(run_id, tenant_id)` or `tenant_id` foreign keys.
  RLS is enabled on all seven new tables. There are no policies at all, so end users get nothing.
- **Permissions.** Table privileges are revoked from `anon` and `authenticated` and granted to `service_role` only.
  Every new function is `SECURITY INVOKER` with an empty `search_path` and executable by `service_role` only. That is
  checked by the postconditions, by `scripts/schema-contracts.sql` (both copies) and by the local probe run below.
  - The only end-user-visible object is the sequence `agent_tool_events_id_seq`. It inherits Supabase's default
    sequence grant, as do H1's `agent_run_events_id_seq` and every other public sequence (7/7 locally). It exposes
    nothing and cannot write the table.
- **Execution stays disabled.** `agent_execution_enablement` is created with one row, `enabled = false`, and there are
  no tool grants. H2 code additionally refuses production `APP_ENV` and requires `AGENT_GATEWAY_EXECUTION_ENABLED`.
  No worker is deployed anywhere.
- **Domain operation (242).** `work_order_assign_apply` is a new function. `main`'s API never calls it, so applying 242
  changes no current behaviour. PR #217's route uses it after merge.
- **pgmq.** No new queue. `patelrep_agent_runs_v1` stays logged. 243 redefines `agent_run_claim` only so that a stray
  message for an `awaiting_approval` run is dropped like a paused run's.

## Compatibility evidence (isolated local replay database only; never staging or production)

All runs below used the local `supabase_db_replay` container.

1. Rebuilt from `main` (through 240). Seeded H1 synthetic runs with `main`'s own H1 worker in 8 of the 9 H1 states:
   queued, running (live lease), retry_wait, paused, cancel_requested, succeeded (multi-step and delay), failed and
   cancelled. `dead_letter` was not seeded.
2. Forward-applied exactly 241–243 on top with `supabase migration up`. All 9 runs and 10 steps were unchanged, and
   all replacement constraints are `convalidated`.
3. Drove the **pre-existing** runs to completion with `main`'s H1 worker against the migrated schema:
   - queued, retry_wait (after the delay) and paused (after resume) → succeeded
   - running → lease takeover → succeeded
   - cancel_requested → cancelled
   - 0 queue messages left
4. `main`'s full API integration suites against the migrated schema:
   - H1 suites: 47 passed, 1 skipped, 1 expected failure. `test_admission_refuses_unknown_members_inactive_hotels_and_real_agents`
     asserts the old constraint name. The insert is still refused, now by the gateway trigger.
   - All other suites: 132 passed, 2 skipped, 0 failed.
5. PR #217's schema contracts and `main`'s schema contracts both pass on the migrated database.
6. Registry probes:
   - On `main`'s schema: 8/8 preconditions true.
   - After 241–243: 11/11 postconditions true, and the four "not yet applied" preconditions are false, so a replay is
     refused.
7. Fault injection: an H1 step with step type `legacy_custom` makes precondition 6 false. Applying anyway fails 241
   atomically: nothing is recorded and the H1 constraint is intact.
8. Re-executing the raw SQL inside `BEGIN … ROLLBACK`:
   - 241 is **not** re-runnable: `constraint "agent_runs_h2_agent_allowlist" … already exists`. It rolls back without
     damage.
   - 242 and 243 are re-runnable (`CREATE OR REPLACE`).
   - Replay is prevented by migration history, the preconditions and the exact pending-set rule, never by
     re-executing SQL.
9. PR #217's gateway integration suites on the forward-applied database: see the PR for the run counts.

## Reviewer checklist

- [ ] Read all of 241, 242 and 243 at `2c9539307fbdaa6fd99038a58036a4f2891f3e8c`.
- [ ] Verified the three digests with the commands above.
- [ ] Accept the widened agent allowlist (with its trigger) and the widened state list described above.
- [ ] Accept that once applied, these three files are frozen on staging. Any fix ships as a new forward migration,
      and H2 must eventually merge with these exact files or staging stays ahead of `main`. See the recovery section in
      `docs/STAGING_REVIEWED_MIGRATION_PREVIEW.md`.

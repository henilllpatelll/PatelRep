# Staging Reviewed Migration Preview

A single-use, human-approved path that lets **exactly pinned** migration files reach the persistent shared staging
database **before** their PR merges. It covers files that Staging Candidate refuses because they match the
destructive-SQL pattern, such as H2's CHECK constraint replacements.

Staging Candidate is unchanged: it still refuses every destructive pending migration, and nothing it reads can enable
this path. The workflow is `.github/workflows/staging-reviewed-migration-preview.yml`.

## What must all be true before anything is applied

| # | Check | Where |
|---|---|---|
| 1 | The workflow definition and every executed script come from `main` (`github.sha`), in a clean checkout. | `staging-trusted-control-plane.mjs assert` |
| 2 | The PR contributes only its `supabase/migrations` directory, as data. No candidate script, package, interpreter or SQL contract runs. | Workflow layout and contract tests |
| 3 | A registry entry on `main` (`supabase/staging-reviewed-migrations.json`) pins all of the following: repository, PR number, head branch, full head SHA, expected staging history head, an approval window of at most 14 days, a SHA-256 per file, and read-only pre/postconditions. | `staging-reviewed-migrations.mjs` |
| 4 | The dispatch restates the entry id, PR, head SHA and every `filename=sha256`. All of it must equal the entry. | `selectPreviewEntry` |
| 5 | The live PR is open, targets `main`, comes from the same repository and branch, and its head is the pinned SHA. The candidate checkout is that SHA. | `assertLivePullRequest`, plus a fresh API read in every job |
| 6 | Every approved file at that SHA hashes to its approved digest. The pending set on staging equals the approved set exactly, so no extra file of any kind can be applied. | `verifyCandidateFiles`, `planStagingMigrations({ reviewed })` |
| 7 | Staging is the expected host and never the production host. Both production host denylist values must be set. | `staging-target-guard.mjs` |
| 8 | Staging history head equals the reviewed base, and every precondition probe returns true. | `assertStagingBase`, `runProbes` |
| 9 | The pinned Supabase CLI 2.112.0 is used. The verified ephemeral workspace mirrors history, and the dry run proposes exactly the approved files. | `staging-migration-apply-workspace.mjs` |
| 10 | The GitHub Environment `staging-migration-approval` requires reviewers, does not let admins bypass, and is restricted to protected branches. One of its configured required reviewers approved **this run** for it, as shown by the run's own approval record. | `authorize` job, `assertApprovalEnvironmentProtection`, `assertRunApproved` |
| 11 | The plan and apply jobs share the `staging-release-candidate` concurrency group with Staging Candidate and Staging Database Migrate, and never cancel in progress. | Job-level `concurrency` |

The apply job re-proves checks 1 to 10 immediately before its single push. That push goes through the same verified
workspace, which itself builds twice: a verification pass, then a rebuild before the real push.

After the push, the apply job verifies three things:

- staging history is `CLEAN` against the candidate,
- each approved version is recorded under its approved name,
- every postcondition probe is true, and main's schema contracts pass.

**Afterwards, for every candidate:** Staging Candidate, Staging Database Migrate and any later preview refuse a
candidate whose copy of an *applied*, reviewed file differs from the approved digest (`verifyReviewedBindings`).
Applied SQL is never re-run, so a fix must ship as a new forward migration, which then goes through the normal rules.

Nothing in this path resets, wipes or rebuilds staging, writes migration history by hand, runs
`supabase migration repair` or touches production.

## One-time setup (repository settings, done by a maintainer)

Create the GitHub Environment `staging-migration-approval` with these settings:

- **Required reviewers:** the maintainer(s), added as individual users rather than teams, so the apply job can match the recorded approver.
  - "Prevent self-review" may stay off in a single-maintainer repository. The approval is still a separate deliberate
    act, and it is recorded on the run.
- **Allow administrators to bypass configured protection rules:** off.
- **Deployment branches:** protected branches only.
- **Secrets and variables:** none. The approval job holds none, and the database credential stays in the existing
  `staging` environment.

Until this exists, every job fails closed with `GitHub Environment staging-migration-approval does not exist`.

## Procedure

Work through these steps in order.

1. **Review.** Read the review document named by the entry, for example
   `docs/staging-previews/h2-tool-gateway-241-243.md`. Read the full SQL at the pinned SHA and verify the digests.
2. **Record the review.** Merge the PR that adds the registry entry to `main`. This applies nothing.
3. **Check backups** (see below). Make sure no other PR needs staging for the next hours. After the apply, any PR
   whose branch lacks these migrations fails Staging Candidate until the previewed PR merges and those branches rebase.
4. **Dispatch** the workflow from `main`:

   ```bash
   gh workflow run staging-reviewed-migration-preview.yml --ref main \
     -f preview_id=h2-tool-gateway-241-243 -f pr_number=217 \
     -f head_sha=2c9539307fbdaa6fd99038a58036a4f2891f3e8c \
     -f file_digests='241_agent_gateway_schema.sql=5c636306c421060d0baddb16c998ac247d3feb4b27132659237fae3340af39d7,242_work_order_assign_apply.sql=50332e7de8e2d2016080e6f283875be944508945ffe6fc4a0954deb2611d81a6,243_agent_gateway_rpcs.sql=c4fde72a5e59756a54e6770414a5f8106198f5dff85927ced8660db02e56eebb'
   ```

5. **Read the plan job.** It shows the approved files with digests, the staging base, `PASS` for each precondition,
   and "Dry run proposes exactly the 3 approved file(s); nothing was applied."
6. **Approve or reject** the `staging-migration-approval` deployment on the run page. Rejecting stops the run, and
   nothing is applied.
7. **Read the apply job.** It shows `Applied <file>` for exactly the approved files, `Status: CLEAN`, `PASS` for each
   postcondition, the schema contracts and staging API readiness.
8. **Run normal staging verification** of the PR: re-run Staging Candidate (`workflow_dispatch`, `pr_number=217`) for
   the same head, or let it run after the next CI success. It now finds nothing pending. Its destructive-SQL guard is
   untouched, and its bindings check confirms the candidate files equal the approved ones.

## Failure handling and recovery

| Situation | Result | What to do |
|---|---|---|
| Any refusal in verify-request or plan | Nothing touched staging | Fix the cause. A changed PR head, changed file, expired window or drifted staging base needs a **new registry entry** through a new reviewed PR. |
| Approval rejected or never given | Nothing applied | No action. |
| The apply push fails part-way | Each file is applied in its own transaction. Files before the failing one stay recorded; the failing one is rolled back and unrecorded. The error lists exactly which approved files staging now records. | Do not reset or repair. The staging base has moved, so the same entry is refused from now on. Review a new entry whose base is the new head, with the remaining files or a forward fix. |
| A postcondition fails after apply | The migrations are applied; verification failed | Treat as an incident on staging only. Inspect with read-only queries. Fix forward with a new reviewed migration. |
| The PR is abandoned after the preview | Staging history is ahead of `main`. Every candidate is BLOCKED ("history is not a prefix"). | Land the **same** files on `main` (with an immediate forward revert migration if the feature is not wanted) through a reviewed PR. History is never rewritten. |

**Turning a flag off is not a schema rollback.** Disabling `agent_execution_enablement`, leaving
`AGENT_GATEWAY_EXECUTION_ENABLED` unset, or pausing tools only stops execution; the schema stays. Reverting 241's
constraints requires a new forward migration, which is itself destructive and needs review. Example statements:

```sql
-- Only valid while no row uses the H2 additions (check first):
--   select count(*) from public.agent_runs where state = 'awaiting_approval' or agent_id <> 'harness.synthetic';
--   select count(*) from public.agent_run_steps where step_type = 'tool_invocation';
ALTER TABLE public.agent_runs DROP CONSTRAINT agent_runs_h2_agent_allowlist;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_h1_synthetic_only CHECK (agent_id = 'harness.synthetic' AND agent_version = 1);
ALTER TABLE public.agent_runs DROP CONSTRAINT agent_runs_state_check;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_state_check CHECK (state IN ('queued', 'running', 'retry_wait', 'paused', 'cancel_requested', 'succeeded', 'failed', 'cancelled', 'dead_letter'));
ALTER TABLE public.agent_run_steps DROP CONSTRAINT agent_run_steps_step_type_allowlist;
ALTER TABLE public.agent_run_steps ADD CONSTRAINT agent_run_steps_step_type_check CHECK (step_type ~ '^[a-z][a-z0-9_]{0,63}$');
DROP TRIGGER IF EXISTS agent_runs_guard_gateway_insert ON public.agent_runs;
-- plus: re-create agent_run_transition_allowed (238) and agent_run_claim (239/240) at their H1 definitions.
```

**Backups.** This workflow takes no backup and cannot restore one. Before approving, the maintainer confirms in the
Supabase dashboard for the **staging** project (Database → Backups) that a recent restorable backup exists, or
point-in-time recovery if the plan includes it.

- Restoring a backup is a manual, dashboard-only, last-resort action on staging.
- A restore rolls back every change made since the backup, including fixture data and other PRs' migrations.
- It must be followed by verifying history with `check-db-drift.mjs --environment staging`.
- In normal operation, recovery is always forward.

## Adding a future preview

1. Open a PR that adds one entry to `supabase/staging-reviewed-migrations.json` and a review document under
   `docs/staging-previews/`. The document names the head SHA and every digest; a test enforces that.
2. Keep the window short (14 days at most). A file can be approved by only one entry, ever.
3. Write preconditions that prove staging is in the exact state the SQL expects, including that existing rows satisfy
   any new constraint. Write postconditions that prove the intended result, that permissions did not widen, and that
   execution switches stay off.

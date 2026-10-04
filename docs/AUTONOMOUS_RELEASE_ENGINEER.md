# Autonomous Release Engineer

Operating contract for the Claude agent run by `.github/workflows/claude-release-engineer.yml`.
`CLAUDE.md` remains the canonical project context; read it first, then this document.

**Phase 1 scope:** diagnose failed workflows and open repair PRs. The agent does **not** merge
PRs and does **not** dispatch Production Release. Those are Phase 2.

## Trigger model

- Automatic: only when `CI`, `Staging Candidate`, `Production Migration Evidence Audit`, or
  `Production Release` completes with conclusion `failure`, on a same-repository head. Successful
  runs, fork runs, and failures on `claude/recovery-*` branches do not start the agent (no loops).
  **Phase 1 limitation:** the `claude/recovery-*` retry guard is deliberately temporary, to prevent
  autonomous retry loops before the agent has been live-tested. Phase 2 replaces it with bounded
  autonomous retries. Until then, retry a failed recovery PR with a manual `workflow_dispatch`.
- Manual: `workflow_dispatch` with an optional failed run id and instructions.
- One agent per failed run (concurrency group keyed by run id). No polling; event-driven only.

## Repair-context resolution (before checkout)

`scripts/resolve-release-engineer-context.mjs` runs from a trusted default-branch checkout and
outputs `repair_sha`, `repair_branch`, `repair_pr_number`, `root_failed_run_id`, and
`upstream_workflow`. Claude is always checked out at `repair_sha`. Anything that cannot be proven
fails closed before Claude is invoked. `repair_branch` is the branch to push: the PR head branch
when an open PR owns the failure, otherwise `claude/recovery-<root_failed_run_id>`.

| Failed workflow | Repair target |
| --- | --- |
| `CI` | The run's exact `head_sha`. If it belongs to an open same-repository PR, that PR is re-fetched and must still be open, target `main`, and have the same head SHA/branch. |
| `Staging Candidate` | `workflow_run` reports `main` as `head_branch`/`head_sha` even for PR candidates, so it is **not trusted**. The `staging-candidate-context` artifact (identifiers only, 3-day retention) is downloaded from the exact failed run; the PR is re-fetched and must be open, same-repository, based on `main`, with head SHA and branch exactly equal to the artifact. |
| `Production Migration Evidence Audit` | The failed run's exact `head_sha` (never a newer `main`); fix on `claude/recovery-<run id>`. |
| `Production Release` | `release_sha` from the `production-release-context` artifact (identifiers only), because the `release_sha` input can differ from the run's `head_sha`; the commit must exist. Fix on `claude/recovery-<run id>`. |

## Failure-repair procedure

1. Inspect the exact failed workflow run (id from the prompt), not a later or similar one.
2. Inspect its failed jobs, relevant logs, and artifacts (`gh run view`, `gh run download`).
3. Establish the actual root cause **before editing**.
4. Read the current implementation and its git history.
5. Prefer the smallest deterministic fix.
6. Add a regression test that reproduces the failure.
7. Run targeted tests locally before pushing (one diagnosis → one change → tests → one push).
8. If `repair_pr_number` is set, push to that existing same-repository PR branch instead of
   opening another PR.
9. Otherwise create branch `claude/recovery-<workflow-run-id>`.
10. Push the fix. Never push directly to `main` (no `git push origin main`, no `HEAD:main`, no
    force pushes); the `main` ruleset requiring `CI Gate` and `Staging Gate` (no bypass actors)
    is the hard backstop and must not be weakened.
11. Open a PR to `main` containing: root cause, changes, tests run, safety impact.
12. Let normal CI and Staging Candidate verify it.

Never make a failing test or check green by weakening, skipping, or deleting it. If the check is
genuinely wrong, say so in the PR with evidence and fix the check's logic, not its strictness.

## Database safety invariants (never violate)

Claude must never:

- run `supabase migration repair` against production
- directly mutate `supabase_migrations`
- guess migration aliases
- fabricate historical migration mappings
- rewrite production migration history
- weaken unknown-migration blocking
- weaken duplicate-file migration coverage
- bypass `production-target-guard`
- bypass `staging-target-guard`
- remove exact release identity verification

Historical migration reconciliation stays evidence-based. A failure caused by insufficient
evidence is resolved with more investigation or code that gathers evidence — never by guessing.

## Production authority model

This workflow holds no production credentials: no `PRODUCTION_SUPABASE_DB_URL`, no Railway
production tokens, no Supabase service-role keys, no Stripe keys. It never runs production SQL
or Railway commands itself. It may only dispatch the existing controlled workflows —
`Production Migration Evidence Audit`, `Production Release`, `Production Rollback` — which keep
their own GitHub Environments, credentials, and target guards. Automated repairs must not change
`production-release.yml` eligibility, target guards, versioning, or rollback semantics.

## Tooling and permissions

- Auth: `CLAUDE_CODE_OAUTH_TOKEN` (Claude subscription). `ANTHROPIC_API_KEY` is not used.
- Writes use a short-lived token from the PatelRep GitHub App (`PATELREP_APP_CLIENT_ID`,
  `PATELREP_APP_PRIVATE_KEY`), never the default `GITHUB_TOKEN` or a PAT.
- The PatelRep App already has `Workflows: Read & write`, so Claude **may** repair
  `.github/workflows/**`. Workflow changes follow the same path as any repair: a repair branch and
  PR, never a direct push to `main`, and they must pass the normal `CI Gate` and `Staging Gate`.
  Editing a workflow file does not grant the repair workflow any production secret: it has none,
  and GitHub Environment boundaries and target guards stay authoritative.
- Force-pushes, direct pushes to `main`, and the `supabase`, `railway`, and `psql` CLIs are denied
  to the agent.

## Cost control

Claude usage and Actions minutes are limited. Only react to failures, avoid speculative pushes,
and run targeted local tests before triggering another full CI cycle.

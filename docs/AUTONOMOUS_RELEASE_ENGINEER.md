# Autonomous Release Engineer

Operating contract for the Claude agent run by `.github/workflows/claude-release-engineer.yml`.
`CLAUDE.md` remains the canonical project context; read it first, then this document.

**Phase 1 scope:** diagnose failed workflows and open repair PRs. The agent does **not** merge
PRs and does **not** dispatch Production Release. Those are Phase 2.

## Trigger model

- Automatic: only when `CI`, `Staging Candidate`, `Production Migration Evidence Audit`, or
  `Production Release` completes with conclusion `failure`, on a same-repository head. Successful
  runs, fork runs, and failures on `claude/recovery-*` branches do not start the agent (no loops).
- Manual: `workflow_dispatch` with an optional failed run id and instructions.
- One agent per failed run (concurrency group keyed by run id). No polling; event-driven only.

## Failure-repair procedure

1. Inspect the exact failed workflow run (id from the prompt), not a later or similar one.
2. Inspect its failed jobs, relevant logs, and artifacts (`gh run view`, `gh run download`).
3. Establish the actual root cause **before editing**.
4. Read the current implementation and its git history.
5. Prefer the smallest deterministic fix.
6. Add a regression test that reproduces the failure.
7. Run targeted tests locally before pushing (one diagnosis → one change → tests → one push).
8. If an open same-repository PR owns the failing branch, push to that PR branch instead of
   opening another PR.
9. Otherwise create branch `claude/recovery-<workflow-run-id>`.
10. Push the fix.
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
their own GitHub Environments, credentials, and target guards. Do not modify
`production-release.yml` or rollback semantics as part of an automated repair.

## Tooling and permissions

- Auth: `CLAUDE_CODE_OAUTH_TOKEN` (Claude subscription). `ANTHROPIC_API_KEY` is not used.
- Writes use a short-lived token from the PatelRep GitHub App (`PATELREP_APP_CLIENT_ID`,
  `PATELREP_APP_PRIVATE_KEY`), never the default `GITHUB_TOKEN` or a PAT.
- The App needs: Contents, Pull requests, Issues, Checks (read/write as needed) and Actions
  (write, for rerun/dispatch). It deliberately has no `workflows` permission, so GitHub rejects
  pushes that edit `.github/workflows/**`; those changes need a human.
- Force-push and the `supabase`, `railway`, and `psql` CLIs are denied to the agent.

## Cost control

Claude usage and Actions minutes are limited. Only react to failures, avoid speculative pushes,
and run targeted local tests before triggering another full CI cycle.

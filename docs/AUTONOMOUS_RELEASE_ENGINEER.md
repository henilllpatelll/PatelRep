# Autonomous Release Engineer

Operating contract for the Claude agent run by `.github/workflows/claude-release-engineer.yml`.
`CLAUDE.md` remains the canonical project context; read it first, then this document.

**Current scope (Phase 2C):** diagnose failed workflows and publish repair PRs with a bounded
recovery lineage (at most 3 automatic Claude attempts per recovery root), and safely auto-merge a
narrow class of those PRs after CI and Staging pass (see "Safe autonomous merge (Phase 2C)").
Claude itself never merges, and nothing dispatches Production Release; that is Phase 2D.

## Separated authority

| Job | Holds | Does |
| --- | --- | --- |
| `resolve` | read-only workflow token | Runs the trusted resolver (checked out from `main`) to decide the exact failing code, recovery root and attempt number. |
| `repair` | read-only workflow token + Claude OAuth token | Claude diagnoses, edits and tests locally. It cannot `git push`, commit, create/edit/merge PRs, or dispatch workflows. A trusted step proves `HEAD` is still the repair SHA and hands over a net patch. |
| `publish` | the PatelRep GitHub App token (the only holder) | `scripts/publish-release-engineer-repair.mjs` (from `main`) creates exactly one commit per attempt, stamps the lineage trailers, pushes normally (never force) and creates or updates exactly one PR. |

## Trigger model

- Automatic: only when `CI`, `Staging Candidate`, `Production Migration Evidence Audit`,
  `Production Release`, or `Deploy Health Check` completes with conclusion `failure`, on a
  same-repository head. Successful runs and fork runs do not start the agent.
- Manual: `workflow_dispatch` with an optional failed run id and instructions. Manual runs may
  continue past the automatic attempt cap, are marked manual in the PR, and use the same trusted
  publishing; they never force push, push `main`, merge, or hold production credentials.
- Repair and publish are serialized by the **resolved recovery root**
  (`claude-recovery-root-<root>`), not the latest failing run id; running repairs are never
  cancelled and independent roots run in parallel. No polling; event-driven only.

## Safe autonomous merge (Phase 2C)

`.github/workflows/claude-release-engineer-auto-merge.yml` makes ONE deterministic merge decision per
successful `Staging Candidate` run (`workflow_run` completed, conclusion `success`). No polling and
no GitHub native "auto-merge later". It ends at merge-to-main: it never dispatches Production
Release/Rollback and holds no production credentials or environments.

| Job | Holds | Does |
| --- | --- | --- |
| `resolve` | read-only workflow token | Trusted scripts from `main`; freezes the 40-character control-plane SHA; decides eligibility. No write credential. |
| `merge` | PatelRep GitHub App token (only here, `contents`+`pull-requests` write) | Runs trusted code at the frozen SHA (never candidate code), serialized by `patelrep-release-engineer-auto-merge-main` (no cancel), re-validates everything from fresh GitHub state, then merges the exact head SHA. |

A PR is eligible only if ALL hold (re-checked independently immediately before merging):

1. Created by exactly `patelrep-release-engineer[bot]` (id 337493489, type Bot).
2. Head branch is `claude/recovery-<numeric-root>`. `claude/recovery-manual-*` and any `manual-` root
   never auto-merge. Ordinary, Dependabot and human PRs never auto-merge, even if Claude repaired them.
3. Publisher-only history: 1-3 commits, trailers valid (root equals the branch root, attempts exactly
   1..n, attempt 1 source run equals the root), authored and committed as the publisher, no extra commits.
4. PR open, non-draft, base `main`, same repository, head SHA and branch equal the staging artifact.
5. Exact successful `CI` run (same SHA, branch, `pull_request` event) and exact successful
   `Staging Candidate` run, plus completed successful `CI Gate` and `Staging Gate` check runs produced by
   GitHub Actions (app id 15368). The `Staging Gate` must have been reported by that staging run.
6. No `CHANGES_REQUESTED`, no unresolved review threads, none of the labels `do-not-merge`,
   `do not merge`, `hold`, `manual-review`, `needs-human`; mergeable state `clean`.
7. No changed (or renamed-from) file is high-risk. High-risk always requires a human merge:
   database/persistence (`supabase/**`, migrations, `*.sql`, `apps/api/core/**`, schema/drift/replay/
   reconciliation), billing (billing, Stripe, payment, subscription, checkout, invoice, webhook,
   credits), auth/security (auth, oauth, rbac, permission, credential, secret, session, token, jwt,
   `apps/api/middleware/**`, `apps/web/proxy.ts`), `.github/**` (including this workflow), `scripts/**`
   and production/release/rollback/deploy/staging-guard paths, and infrastructure/dependency/config files.

8. Recovery branches are provably publisher-only: a fresh read of the repository rulesets finds an ACTIVE
   branch ruleset for `refs/heads/claude/recovery-*` with `creation` and `update` rules whose ONLY bypass
   actor is the PatelRep GitHub App (an `Integration` whose id equals the id GitHub reports for the slug
   `patelrep-release-engineer`; the id is never hard-coded). Publisher commits are unsigned and their
   email/trailers are forgeable, so this ruleset (not the commit identity) is the provenance anchor.
   Without it auto-merge stays ineligible (fail-closed): `Auto-merge ineligible: dedicated recovery
   branches are not protected for publisher-only creation and updates.` This never triggers a repair.

A refusal is reported in the job summary (`Auto-merge ineligible: human review required because changed
file <path> is classified as <risk>.`), leaves the PR open and does not start another Claude attempt.

Merge: `PUT /pulls/<n>/merge` with `sha=<validated head>` and `merge_method=merge` (GitHub rejects it if the
head moved). Afterwards the PR must report `merged` with the same head SHA. No force push, rebase, branch
update or branch deletion; the `main` ruleset (strict `CI Gate` + `Staging Gate`, thread resolution, no
bypass actors) stays the final backstop.

### One-time setup: publisher-only recovery-branch ruleset

Do this once in the GitHub UI (Settings -> Rules -> Rulesets -> New ruleset -> New branch ruleset). It is
never created or changed by a workflow, and it is separate from the `main` ruleset (id `17358515`, which keeps
strict `CI Gate` + `Staging Gate`, thread resolution, 0 approvals, NO bypass actors; do not edit it and do not
add the App to it).

- **Ruleset name:** `claude-recovery-branches` (any name works; the validator matches on content).
- **Enforcement status:** `Active` (not Disabled, not Evaluate).
- **Bypass list:** exactly one entry: the GitHub App `patelrep-release-engineer`, bypass mode `Always`
  (API shape: `actor_type: Integration`, `bypass_mode: always`). No repository roles, admins, users, teams,
  Dependabot or other Apps.
- **Target branches:** Add target -> Include by pattern -> `claude/recovery-*`
  (stored as `refs/heads/claude/recovery-*`). No exclusions.
- **Branch rules:** enable `Restrict creations` (`creation`) and `Restrict updates` (`update`). Leave
  `Restrict deletions` off for now so test branches can still be cleaned up manually.

Until this ruleset exists and matches exactly, Phase 2C auto-merge remains ineligible. If the workflow
token cannot read ruleset bypass actors, auto-merge also stays ineligible (it never guesses).

## Bounded recovery lineage

`MAX_AUTOMATIC_REPAIR_ATTEMPTS = 3` (`scripts/recovery-lineage.mjs`): attempt 1 is the initial
repair, attempts 2 and 3 are automatic retries, and a failure of attempt 3 stops automation (no
Claude run, no push, no new PR; the repair PR stays open and the workflow summary says so).

The authoritative counter is **commit trailers** written only by the trusted publisher, never
commit counts, PR comments, run searches, timestamps or branch age:

```
PatelRep-Recovery-Root: <root run id | manual-<run id>>
PatelRep-Recovery-Attempt: <integer>
PatelRep-Recovery-Source-Run: <failed workflow run id>
```

- A failure with no managed lineage starts a new root: root = the exact failed run id, attempt 1.
- A failure of an open same-repository PR candidate head that carries valid trailers (authored by the
  publisher identity) keeps the same root and uses attempt + 1. Works for `claude/recovery-<root>`
  branches and for ordinary branches repaired in place (e.g. `feature/foo`).
- On a `claude/recovery-<root>` branch the root in the name must equal the root in the head
  commit; disagreement, malformed or partial trailers, forged trailers (wrong author), or a
  recovery head with no trailers all fail closed.
- Main-based failures (CI on `main`, Deploy Health Check, Evidence Audit, Production Release) always
  start a NEW root, even if a commit on `main` happens to contain old trailers.
- PR body text (`Autonomous attempt N/3`, history) is informational only.

## Publishing guarantees

Before and again immediately before the push the publisher re-fetches the PR and requires: open,
base `main`, same repository, same head branch, and head SHA equal to the `repair_sha` Claude started
from. If a human or bot moved the PR meanwhile it stops rather than overwriting. A new recovery
root uses `claude/recovery-<root>`; if that branch or an open PR for it already exists it is
refused, never reused or overwritten. A PR is created only after re-querying that none exists;
otherwise the existing one is updated, preserving its recovery history. Known gap: between the
`repair` and `publish` jobs another queued agent for the same root could start; its publish then
fails closed on the stale head check.

## Trusted control plane

The resolver is checked out from `main` once, in the `resolve` job, and its exact commit SHA is
captured and validated as `trusted_control_plane_sha`. The publisher is checked out at that **same
SHA** (never mutable `main`), so a moving `main` cannot make the two run different trusted code.
In the `publish` job the trusted publisher (`trusted-publisher/`, no persisted credentials) and the
repair worktree (`repair-worktree/`, the exact `repair_sha`, App-authenticated) are sibling
directories: the patch is only ever applied inside the worktree, so a Claude-produced patch cannot
replace the publisher or its lineage code before privileged execution. The repair SHA and the
control-plane SHA are distinct.

## Repair-context resolution (before checkout)

`scripts/resolve-release-engineer-context.mjs` runs from a trusted default-branch checkout and
outputs `repair_sha`, `repair_branch`, `repair_pr_number`, `root_failed_run_id`,
`failed_run_id`, `repair_attempt`, `automatic_retry_allowed`, `skip` and `upstream_workflow`. Claude is always checked out at `repair_sha`. Anything that cannot be proven
fails closed before Claude is invoked. `repair_branch` is the branch to push: the PR head branch
when an open PR owns the failure, otherwise `claude/recovery-<root_failed_run_id>`.

| Failed workflow | Repair target |
| --- | --- |
| `CI` | The run's exact `head_sha`. If it belongs to an open same-repository PR, that PR is re-fetched and must still be open, target `main`, and have the same head SHA/branch. |
| `Staging Candidate` | `workflow_run` reports `main` as `head_branch`/`head_sha` even for PR candidates, so it is **not trusted**. The `staging-candidate-context` artifact (identifiers only, 3-day retention) is downloaded from the exact failed run; the PR is re-fetched and must be open, same-repository, based on `main`, with head SHA and branch exactly equal to the artifact. |
| `Production Migration Evidence Audit` | The failed run's exact `head_sha` (never a newer `main`); fix on `claude/recovery-<run id>`. |
| `Deploy Health Check` | The failed run's exact `head_sha` (scheduled/push runs execute trusted `main` code, so that exact monitoring revision is repaired); fix on `claude/recovery-<run id>`. |
| `Production Release` | `release_sha` from the `production-release-context` artifact (identifiers only), because the `release_sha` input can differ from the run's `head_sha`; the commit must exist. Fix on `claude/recovery-<run id>`. |

GitHub Actions run ids are validated as decimal strings of up to 20 digits (current ids have 11);
PR numbers are validated separately. Unsafe or malformed ids fail closed.

## Production monitoring contract

`Deploy Health Check` runs `scripts/production-monitor-smoke.mjs`, which verifies what is actually
deployed. It classifies `/health` into an explicit contract family and logs which one it detected:

- **legacy** (predates `/ready`; `env` field, no release identity): requires healthy API/database and
  `env: production`; does not request `/ready`.
- **modern** (release-aware): requires `/ready` with a compatible database, a consistent 40-character
  release SHA and version across `/health`, `/ready` and the Web meta tags.
- Anything else (partial identity fields, mixed shapes, unknown shapes) fails closed. A `/ready` 404
  is never ignored: a modern deployment that loses `/ready` fails.

`scripts/public-smoke.mjs` is the separate strict release-verification contract used by Production
Release and always requires `/ready` and the exact expected release identity. Repairs must not add a
legacy/no-`/ready` fallback there. `check:floor-copy` stays a CI source gate and is not part of the
runtime monitor.

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
10. The trusted publisher pushes the fix (Claude itself cannot push). Never push directly to `main`
    (no `git push origin main`, no `HEAD:main`, no force pushes); the `main` ruleset requiring `CI Gate` and `Staging Gate` (no bypass actors)
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
- Only the publisher job uses a short-lived token from the PatelRep GitHub App (`PATELREP_APP_CLIENT_ID`,
  `PATELREP_APP_PRIVATE_KEY`) for writes, never a PAT. Claude itself only gets the read-only workflow token.
- The PatelRep App already has `Workflows: Read & write`, so Claude **may** repair
  `.github/workflows/**`. Workflow changes follow the same path as any repair: a repair branch and
  PR, never a direct push to `main`, and they must pass the normal `CI Gate` and `Staging Gate`.
  Editing a workflow file does not grant the repair workflow any production secret: it has none,
  and GitHub Environment boundaries and target guards stay authoritative.
- Claude gets only the read-only workflow token. It cannot push, commit, edit PRs or dispatch
  workflows (its tool list allows read-only git and `gh` inspection only); `supabase`, `railway` and
  `psql` are denied.

## Cost control

Claude usage and Actions minutes are limited. Only react to failures, avoid speculative pushes,
and run targeted local tests before triggering another full CI cycle.

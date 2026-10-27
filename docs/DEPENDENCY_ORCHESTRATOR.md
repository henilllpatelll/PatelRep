# Dependency Orchestrator

Autonomous maintenance of the Dependabot backlog. You approve the automation once, start one batch, and come
back to a consolidated report (the run summary, plus `report.md` in the checkpoint artifact). Implemented by
`.github/workflows/dependency-orchestrator.yml`, `scripts/dependency-orchestrator*.mjs` and the trusted policy
`.github/dependency-orchestrator.policy.json`.

It is **separate from, and does not touch**, the Release Engineer auto-merge policy
(`docs/AUTONOMOUS_RELEASE_ENGINEER.md`), which intentionally excludes Dependabot PRs. It never dispatches
Production Release or Rollback, never holds production credentials and never changes migration history.

## What one batch does

1. **Discover** open, same-repository PRs authored by `dependabot[bot]` on `dependabot/*` branches into `main`.
2. **Compare with current `main`**: updates are parsed from the manifest diffs (never from PR prose). A proposal whose
   target version `main` already has, or whose package `main` no longer declares, is `superseded`.
3. **Classify risk** deterministically (low / medium / high), flag files outside the dependency manifests, and detect
   incompatibilities (policy-declared, plus registry requirements for packages the repository itself declares).
4. **Research** (optional, advisory): a read-only Claude job reads upstream changelogs for medium/high-risk PRs. Its
   findings can only **raise** risk, never lower it or clear a violation.
5. **Order** the queue: lower risk first, then ecosystem, then PR number, with dependency edges respected
   (e.g. a PR that provides a peer another PR needs goes first). Cycles are blocked.
6. **Advance exactly one PR at a time**, one mutating action per tick:
   `update_branch` (merge latest `main` into the branch via the GitHub API; falls back to `@dependabot rebase`
   for Dependabot-only branches) -> wait for CI -> `dispatch_staging` (only when the shared staging stack is idle)
   -> wait for the Staging Gate -> record a **verified candidate** (exact head SHA, `main` SHA, CI and Staging run ids).
7. **Failures**: a CI/Staging failure may request the existing Claude Release Engineer once (bounded). A failure that is
   only the live-tenant Room-Board gate is classified as credential infrastructure and spends nothing.
8. **Blocked PRs never stall independent ones.** Each is marked blocked with the reason and the next PR proceeds.
9. **Re-verify**: if `main` moves, verification is stale and re-run (bounded). Each verified candidate records the
   `main` SHA it was proven against.

The batch is **event-driven**: `workflow_run` completions of CI, Staging Candidate and the Release Engineer continue it
(there is no polling loop and no sleeping job), with a slow 30-minute schedule backstop because Dependabot-actor
events carry no secrets. Progress is checkpointed in the `dependency-orchestrator-state` workflow artifact (14-day
retention), so an interrupted run resumes from GitHub. A later tick trusts a checkpoint only if it came from a run of this
workflow in this repository that was a `workflow_run`, or a `workflow_dispatch`/`schedule` on `main`; the checkpoint is
strictly re-validated on load and can never authorize a merge (approvals come only from the policy on `main`).

## Modes

| | Mode A - prepare and verify (default) | Mode B - approved automatic merge |
| --- | --- | --- |
| Policy | `merge.mode: "prepare-only"` | `merge.mode: "approved-only"` plus exact `merge.approvals` |
| Updates branches, runs CI/Staging, records candidates | yes | yes |
| Merges | **never** | only exact approved identities that pass every gate |

Nothing is approved by default. Nothing mutates until `mutation_enabled: true` lands in the policy on `main`.

### Mode B approval (human-reviewed change to the policy file on `main`)

```json
{ "pr": 151,
  "updates": [{ "ecosystem": "pip", "name": "reportlab", "from": "4.4.4", "to": "5.1.0" }],
  "acknowledge_major": true, "approved_by": "your-github-login", "approved_at": "2026-10-27", "expires_at": "2026-11-10" }
```

An approval is an **identity**: PR number + the exact set of dependency changes (+ optional `head_sha` pin).
A label, comment, version number or PR file can never authorize a merge. It expires. Before each merge the **merge job**
recomputes, from fresh GitHub state: approval match and scope; exact head SHA; branch contains latest `main`;
CI Gate, Database Migration Gate and Staging Gate succeeded **for that head SHA** (produced by GitHub Actions); the
recorded verification equals the current head and `main`; staging stack idle; no changes requested; no unresolved
threads; trusted commit authors only; mergeable state `clean`. Merges are serialized and capped per batch
(`max_merges_per_batch`); after each merge `main` moved, so every later candidate is re-verified. The `main`
ruleset remains the final backstop and is never bypassed.

### Never automatic (hard-coded; policy can only add to this)

Billing/Stripe (any bump), auth/security packages (`@supabase/*`, `cryptography`, JWT libs, ...), frameworks
(`next`, `react`, `react-dom`, ...), anything under `.github/**`, database/migration files, **any file outside the
dependency manifests**, and major bumps of SFTP (`paramiko`), CSS frameworks (`tailwindcss`, `tailwind-merge`) and
AI SDKs (`anthropic`, `openai`; token-accounting dependency). These are audited and tested like everything else but
require a human merge, even with an approval entry and green CI.

## Security model

| Job | Credentials | Authority |
| --- | --- | --- |
| `resolve` | read-only workflow token | Plans the next single action from live state. No secret. |
| `research` | read-only token + Claude token | Reads changelogs, writes advisory JSON. No write token, no shell, no edit tools. |
| `execute` | read-only token; App token minted **per planned action**: branch update/comment = `contents`+`pull-requests` write, or staging/Release-Engineer dispatch = `actions` write | Re-plans from fresh state and refuses on any drift. Cannot merge. |
| `merge` | App token `contents`+`pull-requests` write | The only merge path; exact SHA; serialized with `execute`. |

* All scripts and the policy come from `main` at one frozen SHA; PR branches are never checked out or executed, and no
  dependency from a PR is ever installed in these jobs. Untrusted text (titles, bodies, changelogs) reaches code only
  through validated fields; Release-Engineer instructions are built from regex-validated package names and versions.
* Privileged jobs run only on `refs/heads/main` and never for a Dependabot-actor event.
* No job holds Issues write (the repository reserves it for the production notifier; its contract test still passes).
* GitHub writes are limited to: one PR comment (`@dependabot rebase`), `update-branch`, dispatching
  `staging-candidate.yml` and `claude-release-engineer.yml`, and the exact-SHA merge. Contract tests pin this list.
* Retries are bounded everywhere (branch updates per `main` revision, repair requests, staging dispatches,
  re-verifications, merges, ticks, batch hours, Claude invocations and dollars); every limit has a hard ceiling in code
  that the policy cannot raise. Failed writes still consume their attempt.
* Staging is never entered concurrently: a single PR is active, staging is dispatched only when no Staging Candidate run is
  queued or running, and the existing `staging-release-candidate` lock stays authoritative. The whole staging sequence
  (database reset, API, web, identity verification, six-role smoke) is unchanged.

## Controls

* **Pause immediately:** set repository variable `DEPENDENCY_ORCHESTRATOR_PAUSED=true` (or `paused: true` in the policy).
  Every job honors it, including the merge job. **Resume:** delete the variable; the checkpoint continues.
* **Hold one PR:** label it `orchestrator-hold`, `hold`, `do-not-merge`, `manual-review` or `needs-human`.
* **Stop the 30-minute backstop completely:** `DEPENDENCY_ORCHESTRATOR_TICKS=off`.
* **Report only:** run the workflow with `action: plan` (no mutation, no branch updates), any time.
* **Start over:** dispatch with `restart: true`.

## Enable and run (one unattended batch)

1. Review and merge the implementation PR (a human merge; this workflow is control-plane, so it is never auto-merged).
2. In a reviewed PR set `"mutation_enabled": true` in `.github/dependency-orchestrator.policy.json` (leave `merge.mode`
   `prepare-only` for the first batch).
3. Actions -> **Dependency Orchestrator** -> Run workflow: `action: process`. Leave `pr_numbers` empty for the whole backlog.
4. Return to the latest run's summary (and `report.md` in the `dependency-orchestrator-state` artifact): status table, order, blockers, audit trail, cost.

Requirements already used by existing workflows: `PATELREP_APP_CLIENT_ID` (variable), `PATELREP_APP_PRIVATE_KEY` and
`CLAUDE_CODE_OAUTH_TOKEN` (secrets). The App must permit `Actions: write`, `Contents: write`, `Pull requests: write`; it does **not** need `workflows` (a branch refresh that would touch workflow files is handed to
Dependabot's own rebase instead).

## Dependabot and the Room-Board gate

Dependabot-triggered runs receive no repository secrets, so the live-tenant Room-Board regression could never run and its
fixture credentials must not be given to dependency code. `Room-Board Hermetic Visual Regression` runs the **same spec and
the same zero-tolerance comparison** (`maxDiffPixelRatio: 0`) against the PR's **own production build**, with a local mock
backend (`apps/web/e2e/hermetic/`) standing in for Supabase auth and the API, serving the same synthetic fixture tenant
(rooms 101-107, one per status). It reads no secret. The CI Gate requires it for every PR and, for PRs **opened by**
`dependabot[bot]`, requires the live job to have been *skipped* (a failed or cancelled live job is never forgiven, and the
author name alone grants nothing outside a `pull_request` event). Regenerate its baselines (after an intentional visual change)
with the `Update Room-Board Snapshots` workflow, `suite: hermetic`.

## Costs and known limitations

* Actions: an idle tick is one ~25 s read-only job every 30 minutes (stop with `DEPENDENCY_ORCHESTRATOR_TICKS=off`). A PR
  costs one CI run plus one Staging run (~35-60 min of runner time) per verification; sequential processing of ~10 PRs is
  hours of wall clock, not interactive time. Claude: at most `max_claude_research_invocations` (10) reviews, capped at
  `max_claude_usd` ($25); the Release Engineer is requested at most once per PR.
* A merge-from-`main` refresh stops Dependabot from auto-rebasing that branch; conflicts in `package-lock.json` after a merge
  are handed to `@dependabot rebase` (Dependabot honors comments from users with write access; if it does not honor the App's
  comment the PR is reported `blocked` after its bounded attempts).
* The Release Engineer is dispatched, never reimplemented; its own eligibility rules still apply.
* Registry compatibility is advisory (npm peers excluding optional ones; PyPI requirements for packages the repository pins).
  Dependency version metadata cannot see runtime behavior: that is what CI and Staging are for.
* A re-dispatch during an active batch is a no-op (idempotent) unless `restart: true`; GitHub keeps only one pending run per
  concurrency group, so a *restart* queued behind a running tick can be superseded: re-dispatch if the run shows cancelled.

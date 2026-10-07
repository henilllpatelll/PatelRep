# Claude Feature Orchestrator

Claude is the **front door** for normal feature development, not a new privileged path. It turns a request into
requirements, starts the existing Autonomous Feature Builder, and then reports what GitHub says about the result.

```text
Human request → Claude (orchestrates) → Claude Feature Orchestrator workflow (dispatch only)
  → Autonomous Feature Builder → read-only coding agent → trusted publisher
  → feature/ai-<run>-<slug> → PR → main → CI Gate → Staging Candidate → READY FOR HUMAN REVIEW → STOP
```

There is still exactly one product-development path. The orchestrator replaces none of it.

## What Claude may do

- Write good requirements/acceptance criteria from your request.
- Start a feature by dispatching **only** `.github/workflows/claude-feature-orchestrator.yml` on `main`
  (`gh workflow run claude-feature-orchestrator.yml --ref main -f feature_name=… -f requirements=…`).
- Read GitHub state with `node scripts/resolve-feature-orchestrator-status.mjs` (GET requests only) and report it.

## What Claude cannot do

Merge PRs, push to `main`, force-push, bypass or weaken CI Gate / Staging Gate / SHA-and-tree provenance, deploy via
Railway or anything else, mutate Supabase or touch migration history, dispatch Production Release / Rollback /
incident re-entry, approve a production deployment, create tags/releases, or read production credentials. None of the
orchestration code contains any of these capabilities (`feature-orchestrator-workflow.test.mjs` fails the build if one
appears). **Claude is never handed a write-capable GitHub token by this system.**

## Starting a feature

The `Claude Feature Orchestrator` workflow has one job with `contents: read` and `actions: write`, no secrets, no
GitHub App token, and no Environment. It:

1. proves it runs from `refs/heads/main` and that `GITHUB_SHA` equals the *current* remote `main` SHA;
2. resolves the builder by its stable file path (`.github/workflows/autonomous-feature-builder.yml`, active) — never by
   display name — and dispatches that workflow id with `ref: main` and only `feature_name` + `requirements`;
3. identifies the new builder run (new run id, same workflow, `workflow_dispatch`, `main`, exact SHA; several or zero
   matches fail closed) and uploads a sanitized `feature-orchestrator-dispatch` artifact (builder run id, base SHA,
   orchestrator run id, requester, hash of the requirements — not the requirements themselves).

The dispatcher has no parameter for a workflow, file, or ref, so it cannot be pointed at anything else.

## Following a feature

`resolve-feature-orchestrator-status.mjs --builder-run <id> | --orchestrator-run <id> | --latest [--json]` rebuilds the
state from GitHub on every call, so a brand-new Claude session recovers it without conversation memory.

| State | Meaning |
|---|---|
| `building` | Feature Builder run is queued/running |
| `ci_running` | PR exists; CI for the **exact current head** is queued/running or not yet started |
| `ci_failed` | CI Gate failed for the exact head (failed checks are listed) |
| `staging_running` | CI Gate passed; Staging Candidate for the exact candidate is queued/running |
| `staging_failed` | Staging Gate failed for the exact candidate |
| `ready_for_human_review` | Everything below is proven. **Not** merge approval, **not** production approval |
| `blocked` | Builder failed, PR closed/merged, or head is outside the proven feature lineage |
| `unproven` | GitHub evidence is missing, ambiguous, cancelled, skipped, or changed mid-check — never treated as ready |

`ready_for_human_review` is reachable only through `finalizeReadiness()` and requires **all** of: builder run is the
trusted workflow (by path), same repo, from `main`, concluded `success`; exactly one `feature/ai-<run-id>-*` branch
and one open same-repository PR into `main`; head lineage proven; authoritative `CI Gate` success on the exact head;
`Staging Gate` success for the exact candidate; and the head unchanged at the end of resolution.

## How candidate provenance is established

- **Branch / PR:** branch is found by the run-id prefix, must match `feature/ai-<run-id>-<slug>`; PR must be
  same-repo, base `main`, head ref equal to that branch.
- **Lineage:** the first PR commit must be parented on the builder's exact base SHA, carry the
  `PatelRep-Feature-Builder-Run` / `PatelRep-Feature-Base-SHA` trailers for this run, and be authored by the Feature
  Builder bot. Any later commit must be a linear, trusted Release Engineer repair (publisher identity + recovery
  trailers, at most the Release Engineer attempt cap). Anything else (human commits, merges, rewrites) → `blocked`.
- **CI:** CI runs are matched by workflow **path** + exact head SHA + this PR; `CI Gate` must be a GitHub Actions check
  bound (by details URL) to that same run. A check from another app or another run does not count.
- **Staging:** a Staging Candidate run's own `head_branch` is `main`, so it proves nothing. Identity comes only from
  the trusted `staging-candidate-context` artifact: exact keys, and PR number, branch, candidate SHA and CI run id must
  all equal this candidate. `Staging Gate` must be bound to that staging run.

## Release Engineer interaction

The Release Engineer remains the only repair agent; the orchestrator never invokes Claude or edits anything. When the
Release Engineer pushes a trusted repair, the PR head changes; the next status call re-resolves the new head, requires
fresh CI and a fresh Staging Candidate for it, and never reuses green evidence from the previous head.

## Human review boundary

The workflow ends at `ready_for_human_review`. A human reviews the feature in staging and manually merges. Production
Release remains a separate, human-controlled decision.

## Conversational use

```text
You:    Build a preventive maintenance calendar for Engineering. Web only. …
Claude: (drafts requirements, dispatches the orchestrator) Feature Builder started. Run #123. Do not merge yet.
You:    check
Claude: Implementation finished. PR #130. CI is running. Do not merge yet.
You:    check
Claude: CI passed. Staging is running. Do not merge yet.
You:    check
Claude: 🟢 READY FOR HUMAN REVIEW — PR #130, CI ✅, Staging ✅. Review in staging; merge manually if correct.
```

Each `check` is `node scripts/resolve-feature-orchestrator-status.mjs --latest` (or with a remembered run id). Run it from
`main`, so the resolver code itself is trusted.

## One-time repository setup

Claude should be allowed to run only `gh workflow run claude-feature-orchestrator.yml …` and read-only `gh api`
GETs; do not grant it other `gh workflow` / `gh pr merge` permissions. No new secrets or App permissions are required.

# Autonomous Feature Builder

The Autonomous Feature Builder automates the development path from a human feature request through PR creation. Existing PatelRep CI and Staging Candidate workflows remain authoritative after the PR opens.

## Human workflow

1. Open **Actions → Autonomous Feature Builder → Run workflow** on `main`.
2. Enter a short feature name and detailed requirements.
3. The builder captures the exact `main` SHA, runs Claude in a read-only checkout, collects a patch, and hands the patch to a trusted deterministic publisher.
4. The publisher creates exactly one `feature/ai-<run-id>-<slug>` branch and one PR to `main`.
5. Normal CI runs automatically. A green CI Gate hands the exact candidate to the existing Staging Candidate workflow.
6. A human reviews the feature and manually merges the PR. Production Release remains a separate human decision.

## Authority model

The coding agent receives only the workflow's read-only token. It may edit the local working tree and run tests, but it cannot commit, push, create/edit/merge PRs, dispatch workflows, deploy, run Railway/Supabase/psql mutation commands, or access production credentials.

The trusted publish job is the only job that receives the PatelRep GitHub App token. Its deterministic publisher:

- refuses if `main` moved while the feature was being built;
- refuses an existing target branch or open PR;
- applies only the captured patch;
- blocks all `.github/workflows/**` changes and release/recovery/staging control-plane scripts/docs;
- permits **new** Supabase migration files but refuses modification/deletion/rename of existing migration history;
- creates exactly one feature commit;
- pushes normally, never force-pushes;
- opens a PR to `main`;
- has no merge or production-deployment behavior.

## Failure behavior

A failure before publication leaves no feature branch or PR. A CI or Staging failure after publication remains governed by the existing CI/Staging and Release Engineer systems; no gate is bypassed. The Feature Builder itself never merges or releases.

## Branch and provenance

Every branch is deterministic:

`feature/ai-<builder-run-id>-<feature-slug>`

Every initial commit records:

- `PatelRep-Feature-Builder-Run`
- `PatelRep-Feature-Base-SHA`

The publisher requires the remote `main` SHA to still equal the captured base immediately before publication.

## Claude orchestration

Claude can start this builder through the narrowly scoped `Claude Feature Orchestrator` workflow and report CI/Staging status; see [CLAUDE_FEATURE_ORCHESTRATOR.md](CLAUDE_FEATURE_ORCHESTRATOR.md). It adds no merge or production authority.

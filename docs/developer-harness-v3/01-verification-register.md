# Developer Harness V3 — 01 Repository Audit and Verification Register

Phase D3.2. Read-only verification performed 2026-11-24 against `henilllpatelll/PatelRep` main
`fbbc50b22f0ca27367032822f5d6dafc361ea323` (PR #250, Developer Harness V2 Phase 8). Latest migration on main: `262_agent_verified_human_identity.sql`
(263 is free). Latest GitHub release: v1.11.6 (2026-11-09). Method labels: **LIVE** = read from GitHub/host in this phase, **REPO** = read from
the repository at that SHA, **DOCS** = Anthropic documentation retrieved in this phase, **NOT MEASURED** = could not or should not be measured.

D3.2 changes no ruleset, environment, secret, variable, workflow, hook, `.claude/settings.json`, migration, V2 file or the H7 P3 task.

## 1. Capability status (implemented ≠ enabled ≠ exercised ≠ production-verified)

| Capability | Implemented | Tested | Merged | Enabled | Exercised | Production-verified |
|---|---|---|---|---|---|---|
| V2 policy engine + PreToolUse hook (`.claude/hooks`) | yes (REPO) | yes (V2 suites) | yes (#247) | **only in checkouts that contain it**; the owner's main checkout is on `feature/settings-workspace-redesign` and lacks it (project memory, not re-measured) | yes, locally | n/a (developer tooling) |
| V2 coordination CLI, checkpoints, resume | yes | yes | yes | local utility only | yes on disposable fixtures (this phase) | n/a |
| V2 CI integration (`run-ci-suites.mjs` in `Release Workflow Contract`) | yes | yes | yes (#250) | yes: CI run 45333230055 passed 7/7 suites | yes | n/a |
| Autonomous Feature Builder | yes | workflow contract tests | yes | `workflow_dispatch` only (REPO) | not exercised here | NOT MEASURED |
| Claude Release Engineer (+ auto-merge, + production request) | yes | contract tests | yes | auto-merge limited to `claude/recovery-*` PRs (LIVE ruleset `claude-recovery-branches`, App bypass; policy logic not re-audited here) | NOT MEASURED | NOT MEASURED |
| Dependency Orchestrator | yes | yes | yes | **paused**: `DEPENDENCY_ORCHESTRATOR_PAUSED=true`, `DEPENDENCY_ORCHESTRATOR_TICKS=off` (LIVE) | no | n/a |
| Production release / rollback / watchdog / readiness / incident reentry | yes | yes | yes | **`PRODUCTION_AUTO_RELEASE_ENABLED=true`, `PRODUCTION_AUTO_ROLLBACK_ENABLED=true` (LIVE)** | NOT MEASURED in D3.2 | NOT MEASURED in D3.2 |
| **V3 D3.2 authority contract, evaluator, evidence verifier, lifecycle reducer** | yes | yes (see 11 for the final count) | **no (this PR)** | **no: contract-only, no active action** | disposable fixtures only | **no** |

## 2. Revalidation of the previous audit findings

| # | Prior finding | Verdict | Evidence |
|---|---|---|---|
| 1 | Bypass Permissions explicitly disabled in `.claude/settings.json` | **CONFIRMED** | REPO: `"disableBypassPermissionsMode": "disable"`. D3.2 does not touch it. |
| 2 | Human approval and stop conditions embedded in V2 | **CONFIRMED** | REPO: `contract.json` action classes `human_approval` / `forbidden`; router `STOP.*` codes. |
| 3 | Coordination is an advisory local library, not a persistent runtime | **CONFIRMED** | REPO: `coordination/cli.mjs` header: "a thin LOCAL utility, not a privileged executor"; no daemon, queue or lease. |
| 4 | Local checkpoints are not authenticated evidence | **CONFIRMED** | REPO: CLI `inspect` states "integrity hash is not authentication". |
| 5 | Self-asserted reviewer attribution | **CONFIRMED** | REPO: `coordination/handoff.mjs`: "The `by` role label is self-asserted". |
| 6 | CI contract guard can be modified by the candidate it validates | **CONFIRMED (structural)** | REPO: `scripts/developer-harness-v2-ci-workflow.test.mjs` and the pinned `ci.yml` hash live in the same candidate checkout. Not exploited. D3.2 design: verifier runs from a pinned trusted checkout, never the candidate's (see 03 §4). |
| 7 | Auto-merge limited to certain recovery PRs | **CONFIRMED (partly re-read)** | LIVE: ruleset `claude-recovery-branches` (creation/update/non_fast_forward, App bypass). V2 doc 03 §8. The auto-merge policy script was not re-audited. |
| 8 | Release Engineer scope limited to particular actors/lineages | **CONFIRMED from V2 audit**, not re-audited | V2 doc 01/03. |
| 9 | `main` ruleset needs CI Gate + Staging Gate, zero approving reviews | **CONFIRMED** | LIVE ruleset 17358515: required checks `CI Gate`, `Staging Gate`, strict up-to-date, `required_approving_review_count: 0`, `required_review_thread_resolution: true`, no bypass actors, deletion and non-fast-forward blocked. |
| 10 | Production automation configuration unverified | **NOW VERIFIED** | LIVE repo variables: `PRODUCTION_AUTO_RELEASE_ENABLED=true`, `PRODUCTION_AUTO_ROLLBACK_ENABLED=true`. Consequence: an existing, enabled path can already request patch production releases after a recovery auto-merge. V3 must treat production as live. |

### New findings in D3.2

| ID | Finding | Source | Consequence |
|---|---|---|---|
| N-1 | `claude -p` always uses `ANTHROPIC_API_KEY` when it is present, even if the account is logged in with a subscription, and bills API rates | DOCS (code.claude.com authentication, support article on API key variables) | Subscription-only needs an enforced launch environment, not a convention (implemented as `authority/spend.mjs`). |
| N-2 | Three GitHub workflows use the subscription token `CLAUDE_CODE_OAUTH_TOKEN` (Feature Builder, Release Engineer, Dependency Orchestrator; REPO) | REPO + DOCS (GitHub Actions guide documents the token as drawing on the subscription) | Automated GitHub runs and any local V3 sessions **share one Pro allowance**. The Subscription Governor must account for them. Dependency Orchestrator is currently paused. |
| N-3 | The same secret exists as a repository secret named `CLAUDE_CODE_OAUTH_TOKEN` (LIVE secret names) | LIVE | If the same token is ever placed in a V3 worker environment it can be exfiltrated. `OAUTH_TOKEN` is a forbidden worker-environment pattern in the contract. |
| N-4 | Anthropic documents that dev containers do not prevent exfiltration of credentials stored in `~/.claude` | DOCS (devcontainer page) | A V3 isolated VM holds the owner's Claude login. Egress allow-listing is a requirement, not an option (05 §4). |
| N-5 | Anthropic states advertised plan limits assume ordinary, individual usage | DOCS (legal-and-compliance) | A continuously running autonomous harness may exceed "ordinary individual usage". Owner risk, **not resolvable by code**; recorded in 07 §7 and the D3.3 handoff. |
| N-6 | `staging` environment has no protection rules; 8 provider-generated `*/production` environments have none either | LIVE | Matches V2 audit S-4. Not changed. |
| N-7 | The V2 `.claude` PreToolUse policy hook is not present in the owner's main checkout | project memory | Hooks are per checkout; V3 must run only from a checkout whose enforcement is verified. |

## 3. Reproduced H7 P3 defects (disposable fixtures only; checkpoint untouched)

R-06 **Migration classification depends on a human label.** Reproduced against the real router and a throwaway repository:

| Input | V2 router result | Correct answer |
|---|---|---|
| existing `262_agent_verified_human_identity.sql`, `--modification add` | `routed`, approval `author_new_forward_only_migration`, **no STOP** | historical modification, forbidden |
| new `263_new_thing.sql`, `--modification migration` | **`STOP.EXISTING_MIGRATION`** | new forward-only migration |
| new `263_new_thing.sql`, `--modification edit` | **`STOP.EXISTING_MIGRATION`** | new forward-only migration |
| coordination CLI `create` with the same new file | `plan_status: blocked` with label `migration`, `routed` with label `add` | identical |

Cause: `routing/router.mjs:131-133` decides purely on `modification === 'add'`. D3.2 does **not** edit V2 (it remains authoritative). The V3
classifier (`authority/migration-facts.mjs`) takes no label and is pinned against this exact behavior by a characterization test
(`git-facts.test.mjs`); if V2 is ever fixed that test must be updated deliberately.

R-07 **Coordination CLI blocked on `STORE.NOT_GIT_IGNORED`** in a minimal fixture (plan status was unaffected). Reproduced as stated, and it
is a fixture-setup condition (the store directory must be git-ignored), not an authority defect.

R-08 **Context recovery failure: NOT REPRODUCED.** The report did not include enough detail to build a fixture, and the preserved H7 P3 checkpoint
was deliberately not touched. `resume-check` on a missing store returns `BLOCKED_INVALID_CHECKPOINT` / `STORE.MISSING`, which is correct. Left open
for D3.4, where context recovery is redesigned around durable events rather than a checkpoint file.

## 4. Live configuration read in D3.2 (read-only)

| Item | Value | Method |
|---|---|---|
| Rulesets | `main` (17358515), `claude-recovery-branches` (24446750), `release-tags` (24964838), all `active` | LIVE |
| Default workflow token permission | `read`; `can_approve_pull_request_reviews: false` | LIVE |
| Protected environments | `Production` (branch policy), `release-recording` (branch policy), `staging-migration-approval` (branch policy + required reviewers). `staging`, `Preview`: none. | LIVE |
| Variables | `PRODUCTION_AUTO_RELEASE_ENABLED=true`, `PRODUCTION_AUTO_ROLLBACK_ENABLED=true`, `DEPENDENCY_ORCHESTRATOR_PAUSED=true`, `DEPENDENCY_ORCHESTRATOR_TICKS=off`, `PATELREP_APP_CLIENT_ID` | LIVE |
| Repository secrets (names only) | 17, including `CLAUDE_CODE_OAUTH_TOKEN`, `PATELREP_APP_PRIVATE_KEY`, `RAILWAY_TOKEN`, `VERCEL_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` | LIVE (values never read) |
| Environment secret names (`production`) | 4, including `PRODUCTION_SUPABASE_DB_URL` | LIVE (values never read) |
| CODEOWNERS | none | REPO (V2 audit) |
| Anthropic subscription plan, usage, reset times | **NOT MEASURED** | no supported read path was used |
| Host: Windows 11 Home, hypervisor present, VBS running, 16 GB (≈3.9 GB free at measurement), C: ≈416 GB free, system-managed pagefile, commit limit ≈35.5 GB | LIVE host read |
| WSL2 installed: `Ubuntu` (the owner's), `docker-desktop`; `.wslconfig`: `memory=6GB`, `swap=4GB`, `autoMemoryReclaim=gradual`; Docker Desktop present; VirtualBox, QEMU, Podman not installed | LIVE host read |
| Inside-distro settings (`/etc/wsl.conf`: automount, interop) | **NOT MEASURED**: reading would start the owner's distro |

## 5. What this register does not claim

- No runtime isolation, persistent orchestration, automatic recovery or autonomous delivery exists after D3.2.
- Passing library tests prove the primitives' behavior on fixtures. They do not prove a deployed boundary.
- Anything marked NOT MEASURED stays unknown until D3.3 or the owner supplies it.

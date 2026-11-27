# Developer Harness V3 — 31 D3.6 delivery infrastructure audit

Read-only audit of `.github/workflows/**` and the scripts they run, at main `41995dcb` (the D3.5 merge, verified). **D3.6 modifies none of it.** The existing CI Gate, Staging Gate, publishers, Release Engineer and production workflows stay authoritative; V3 delivery is designed to *reuse* them and is **inactive**.

## 1. What exists
| Component | Where | Facts that matter for V3 |
|---|---|---|
| CI Gate | `ci.yml` job `ci-gate` (`if: always()`) | needs 18 jobs; each must be exactly `success` (the only exception: Dependabot's Room-Board skip, which never applies to a V3 branch). Triggered by `pull_request` → `main` (opened, synchronize, reopened); `ci-<ref>` concurrency with cancel-in-progress. Check runs from the `github-actions` app (15368). |
| Mobile CI | `mobile-ci.yml` | `Mobile CI Workflow Contract`, `Mobile / Type-check`, `Mobile / Lint`, `Mobile / Jest`; advisory in the ruleset, independent of CI Gate. V3 **requires** all four (a V3 rule may add, never relax). |
| Supabase Preview | — | **not found.** If one appears in the trusted workflows, V3 derivation fails closed until its semantics are pinned. |
| Staging Candidate | `staging-candidate.yml` | started by a successful PR CI run (`workflow_run`) or `workflow_dispatch(pr_number)` (no SHA input); re-checks PR open/base main/head == candidate/same repo and CI Gate on that SHA; exact-SHA checkout proofs; ONE workflow-level group `staging-release-candidate`, cancel-in-progress **false** (GitHub keeps one pending run per group: a newer pending run **replaces** an older one); environment `staging`; migrations via trusted control-plane scripts (plan + pinned-CLI dry run, destructive and security-sensitive refusal without a reviewed preview, `supabase/staging-reviewed-migrations.json`, drift + verify-applied); smoke checks bind `release_sha`; reports the `Staging Gate` check on the head SHA. |
| Trusted publishers | `publish-release-engineer-repair.mjs`, `publish-feature-builder-change.mjs` | GitHub App token (`PATELREP_APP_CLIENT_ID` / `PATELREP_APP_PRIVATE_KEY`), never force-push, deterministic branch names, existing-PR re-checks before and after the push, ≤5 MiB patch. |
| Release Engineer | `claude-release-engineer*.yml` | repair cap 3 (commit trailers), pushes onto an existing PR branch (including feature branches); auto-merge only `claude/recovery-*` under a strict policy. |
| Rulesets | GitHub settings (docs only) | main ruleset `17358515`: **strict** (up to date) `CI Gate` + `Staging Gate`, thread resolution, no bypass. |

## 2. How V3 delivery maps onto it
| Need | Decision |
|---|---|
| CI | **Reused unchanged.** V3 never triggers CI except by pushing its own branch; it only reads results, through the trusted reader, and only for the exact head, the github-actions app, the expected workflow/event/branch and the latest attempt (`delivery/required-checks.mjs`). The expected checks are derived from the TRUSTED base's workflow text and must equal a pinned expectation. |
| Staging | **Reused unchanged.** Staging normally starts automatically after CI. V3 adds (a) one durable V3-side shared-staging reservation (V3 never has two tasks' runs in flight, so it never displaces its own pending run), (b) a bounded re-dispatch only when staging is idle (never displacing anyone), (c) a head re-check at read time (gap 2 below). |
| Publishing | **Adapter around the trusted-publisher pattern**: a deterministic task-owned branch `dh3/<task>`, fast-forward-only pushes from the publisher adapter, PR creation guarded by remote observation. The implementer never holds a credential. Live credentials: gate G-PUBLISHER-CREDENTIAL. |
| Re-runs | **New narrowly-defined action** `rerun_ci_jobs` (proposal P7), authorized only by a single-use verifier diagnosis of a TRANSIENT failure. |
| Strict ruleset | a newer main requires a new candidate: **base update** (doc 33 §4), a new head, full re-verification. |
| Merge, release | **Not touched.** D3.6 has no merge or release action, credential or code path. |

## 3. Gaps found in the EXISTING infrastructure (recorded, not changed — control-plane work needs its own human-approved PR)
1. Staging Candidate's own `CI Gate` lookup and its reuse of an existing `Staging Gate` check do not filter by app (staging-candidate.yml ~90, ~94-106). V3's reader filters by app 15368, workflow, event and attempt.
2. Staging Gate is reported without re-checking that the PR head is still the candidate (finalize, ~474-506). V3's verifier re-checks the PR head when it issues `staging_gate`.
3. The Release Engineer can push onto an existing feature PR branch. On a V3 branch that is a FOREIGN head: V3 never adopts or overwrites it; it becomes ONE owner decision (`DELIVERY_FOREIGN_HEAD`).
4. `docs/RELEASE_PROCESS.md` says staging "resets the disposable staging database"; the workflow says it is never reset. Its CI Gate list is stale (5 needs missing).

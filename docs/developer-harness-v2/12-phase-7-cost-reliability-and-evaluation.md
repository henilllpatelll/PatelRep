# Developer Harness V2 — 12 Phase 7: Cost, Reliability & Evaluation

Status: implemented on PR #247 (draft). Local, read-only, offline. Authorizes nothing; it does not change product code, workflows, hooks, roles, the policy engine, `contract.json`, migrations or any environment.

## 1. What this phase adds

`scripts/developer-harness-v2/evaluation/` (all new):

| File | Responsibility |
|---|---|
| `schema.mjs` | Metric schema (`MEASURED` / `ESTIMATE` / `NOT MEASURED`), populations, secret detection/redaction, canonical digests |
| `usage-import.mjs` | Importer for **sanitized local** usage/billing evidence and per-task records (untrusted data) |
| `scenarios.mjs` | Data-only registry of the 20 doc-05 scenarios with independently authored expected outcomes |
| `executor.mjs`, `executor-recovery.mjs` | Fixture-only executor; disposable temp repos for B-11/B-12 (split to stay under 500 lines) |
| `scorer.mjs` | Deterministic scoring; not-run and missing observations never pass |
| `false-positives.mjs` | False-positive analysis against the Phase 2 fixtures plus a Phase 7 corpus |
| `reliability.mjs`, `compare.mjs`, `report.mjs`, `cli.mjs` | Reliability/safety report, baseline-vs-V2 comparison, local JSON/Markdown report writer, read-only CLI |

Approved edits to Phase 6 files (only because the Phase 6 selector fails closed on unregistered harness tests): one `harness.evaluation` suite in `testing/catalog.mjs`; `harness.evaluation` added to `HARNESS_ALL` (`rules.mjs`) and the harness checklist list (`checklist.mjs`); a catalog reachability test; the hard-coded harness-suite count in `checklist.test.mjs` changed 6 → 7.

## 2. Honesty rules enforced in code

* **Populations are never merged:** `real_task`, `synthetic_fixture`, `reported_prior`.
* **Real usage only.** Tokens/cost come from provider reports, Claude Code usage output with provenance, or human billing records. `.wolf/token-ledger.json` (character-ratio estimates), character counts, file sizes, transcript lengths and assumed rates are rejected. Cost is `MEASURED` only when billed cost exists for **every** record of a task and none was rejected; otherwise `NOT MEASURED` (never `$0`). Derived costs need a dated, sourced rate and stay in a separate `ESTIMATE` list. Shared or unattributable usage is reported as unattributed, never distributed.
* **Scoring.** A scenario that was not run cannot pass; a missing observation fails; an adversarial scenario passes only if every attempt is classified exactly as expected (class **and** action) and **nothing executes**. `completion` is always `null` (real task completion is not derivable from fixtures).
* **Baseline comparison.** A difference exists only when both sides are `MEASURED`, real-task, same unit, with task counts and windows, and is computed as a per-task rate. At the baseline every metric is `NOT MEASURED` (doc 05), so no improvement is claimed.
* **Execution safety.** Offline. Forbidden commands are only *classified* by the real policy engine; a test double executes nothing unless the decision is `no_objection`. Only `git` runs, against temp repositories the benchmark creates and removes, with hooks/templates/fsmonitor disabled. No network, agents, or Claude sessions.
* **Reports** go only to `.wolf/runtime-logs/developer-harness-v2/evaluation/` after verifying the target is git-ignored and no component is a symlink/junction; secrets are redacted; reports carry the harness commit, whether the harness paths (including untracked files) are clean, a digest of the evaluation sources, and the benchmark configuration digest.

## 3. Usage

```
node scripts/developer-harness-v2/evaluation/cli.mjs                      # preview only
node scripts/developer-harness-v2/evaluation/cli.mjs run --fixtures-only [--usage F] [--tasks F] [--write] [--json]
node scripts/developer-harness-v2/evaluation/cli.mjs import-usage F | import-tasks F
```

Evidence schemas: `developer-harness-v2/usage-evidence@1`, `developer-harness-v2/task-records@1` (see `usage-import.mjs`).

## 4. Test selection (Phase 6) restated, not re-measured

128/128 historical failing jobs represented (in-sample); 66/69 locally runnable failures recalled; 48 CI-only failing jobs (19 recalled only by the unconditional passthrough); no genuine developer-harness failure case (`EVALUATION_GAP:developer`). Per the Phase 7 instructions, PR #247's first Phase 6 CI attempt failed on a live authentication-hook environmental error and a later exact-head rerun and Staging Gate passed; this is not attributable to the Phase 6 implementation (not independently re-verified by the evaluator).

## 5. Known limitations and gaps

* A passing fixture benchmark is **not** evidence of production reliability. Development scenarios B-01..B-12 are harness-component checks or disposable-repo simulations, never complete real-agent tasks.
* Expected outcomes were written by the same project as the contract: independent of engine output, not of the authors.
* `verifyDiffAgainstPlan` accepts a code file added to a docs-only plan (scope is enforced by checkpoint scope on resume). The harness has no test-weakening detector, so B-10's "no test weakened" is not evaluated.
* Model tokens/cost, real task completion, regressions, failed checks, interventions, review findings and CI/staging/approval durations are `NOT MEASURED` until sanitized evidence is supplied.
* Content-based duplicate detection can drop genuinely repeated identical calls that carry different record ids (visible in `rejected`). Report writing checks for an existing target and then renames (not atomic against a concurrent writer).

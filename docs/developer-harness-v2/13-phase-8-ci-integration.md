# Developer Harness V2 — 13 Phase 8: Protected CI Integration

Status: implemented on branch `feat/developer-harness-v2-ci-integration` (PR B), based on main `eb597d55`. This is
control-plane work that only adds checks. It authorizes nothing, deploys nothing and changes no ruleset, environment, secret,
production or staging workflow, migration, hook, policy rule, `contract.json` or customer Agent Harness behaviour.

## 1. What runs in CI now

The existing `Release Workflow Contract` job in `.github/workflows/ci.yml` (a CI Gate dependency at baseline) gained one step:

```
- name: Run Developer Harness V2 contract and security regression suites
  timeout-minutes: 30
  run: node scripts/developer-harness-v2/ci/run-ci-suites.mjs
```

and its existing `node --test` list gained `scripts/developer-harness-v2-ci-workflow.test.mjs` at the end. Nothing was removed
or reordered. Any failure fails the job, and CI Gate requires it to succeed. CI Gate's `needs`, result wiring and required checks
are unchanged, and so is the required-status set on `main` (`CI Gate`, `Staging Gate`).

Option B (a separate job wired into CI Gate) was rejected. It would have edited CI Gate itself, plus the catalog job mapping and the
gate test fixtures, with no safety benefit.

## 2. The runner (`scripts/developer-harness-v2/ci/run-ci-suites.mjs`)

* **Coverage.** It takes the suites from the Phase 6 catalog and checks each one with `validateSuite`. The `harness.*` set must
  equal `rules.HARNESS_ALL` and contain the seven baseline suites. Every `*.test.mjs` under `scripts/developer-harness-v2/` must
  belong to exactly one suite, and any other test-like file fails the run.
* **Execution.** Commands come only from `testing/runner.resolveSuite` and are checked to be exactly
  `<node> --test --test-concurrency=1 <catalog files>`. The runner adds only fixed reporter flags. Suites run one at a time, with
  the catalog `node` profile (`--max-old-space-size=2048`), the allowlisted child environment (no tokens, no `GITHUB_*`) and each
  suite's catalog timeout. It uses argv arrays only; it has no shell, installs nothing and makes no network or model call.
* **Results** come from structured node:test events written by the module itself acting as a reporter, not from scraped
  text. The run fails on any of the following:
  * a non-zero exit, a signal, a timeout or a spawn error;
  * missing, truncated or unparseable results;
  * a file without its own summary (crash, top-level throw, no tests), or a file with no passing test;
  * any failed test, a todo, or a per-file vs global count mismatch;
  * any skip not in the allowlist below.
* **Reporting.** Each suite prints passed, failed, cancelled, allowed-skip and unexpected-skip counts. The report goes to the job
  log and the step summary. Allowed skips are listed as **NOT EXECUTED** and are never counted as passed.
* **Usage.** The runner accepts no arguments, so there is nothing to narrow or weaken.

## 3. Expected-skip allowlist (exact; human-approved)

PR #247 was **squash-merged** into main as `eb597d55`. Its Phase 2 / Phase 3 source commit,
`8cccb11b944ef77b1f29897d0d7575f519f54e90`, is therefore not an ancestor of main. It is reachable only from the old PR branch,
and it is absent from the CI checkout. The provenance tests below compare current files against that commit and skip themselves
when it is missing. `fetch-depth: 0` was rejected because it would make CI depend on a mutable branch that may be deleted.

| File | Test name | Skip reason |
|---|---|---|
| `context/archive.test.mjs` | manifest entries match the source commit blobs (when history is available) | `source commit not in local history` |
| `context/archive.test.mjs` | only approved paths were untracked relative to the source commit | `source commit not in local history` |
| `context/memory-curate.test.mjs` | old-to-new mapping re-derived from the source blob (when available in local history) | `source blob 8cccb11b944e not in local history (shallow clone)` |
| `context/openwolf-hooks.test.mjs` | simulated session: Phase 2 baseline hooks wrote tracked .wolf files; the Phase 3 hooks write nothing | `Phase 2 settings not in local history` |
| `context/openwolf-hooks.test.mjs` | enforcement and hook source files are byte-identical to Phase 2; graphify auto_update untouched | `Phase 2 commit not in local history` |

One sixth entry has a **different cause** (added after the first Linux CI run of PR #250). It is not a squash-merge skip: the
external Phase 3 archive is optional, local-only evidence kept outside the repository on a developer machine, so it is never
available in CI. When the archive is present locally, the test runs and verifies it byte for byte exactly as before, and the
runner reports it as an allowed skip that now passes. The skip reason is a fixed string; before the fix it contained the
Windows archive path, so the CI skip could never match an exact allowlist entry.

| File | Test name | Skip reason |
|---|---|---|
| `context/archive.test.mjs` | external archive verifies byte-for-byte against the manifest (when the archive is present locally) | `external Phase 3 archive not available in this environment (optional local-only evidence)` |

Matching is exact on file, full name, nesting level 0 and full reason (`===`, with no patterns). The list has at most six entries
(`MAX_ALLOWED_SKIPS = 6`) and is pinned by `scripts/developer-harness-v2-ci-workflow.test.mjs`. Every allowed skip is listed as
**NOT EXECUTED** and never counted as passed. Each entry must be observed exactly once per run (as a
skip or a pass), so a renamed or deleted test fails the run. An entry that now passes is reported as such. Any change to the list
needs human approval. The historical tests themselves are unchanged.

One more partial case is reported but not allowlisted: `context/openwolf-hooks.test.mjs`, test 1, emits the diagnostic
`SKIPPED deep-equal vs Phase 2: commit not in local history (shallow clone)`. Its historical comparison does not execute, while
the test's other assertions do and pass. The runner lists it as *historical assertion skipped inside a passing test*.

## 4. Workflow-contract guard (`scripts/developer-harness-v2-ci-workflow.test.mjs`)

The guard runs in the **existing** step, not in the step it guards. It is a **tripwire against accidental or unnoticed
weakening, not a security boundary**: under `pull_request` a PR's own `ci.yml` and guard both run, so one PR could edit both.
Human review of `.github/**` and `scripts/**` remains the backstop.

It compares `ci.yml` against baselines from `eb597d55`:
* the preamble and top-level keys (exactly `name, on, concurrency, jobs`, so no workflow-wide `defaults:`, `env:` or
  `permissions:`), and the triggers and concurrency;
* the 20 jobs and their names;
* the 67-file release list, pinned by sha256 as an **ordered prefix**, so nothing can be removed or reordered;
* the **entire CI Gate job, byte for byte** (sha256), together with its 18 `needs` and 17 always-required checks and the
  Room-Board Dependabot rule;
* permissions per job, and secrets as an **allowlist** with no expression parsing. Every occurrence of the word `secrets` in
  the raw file, in any letter case, must be exactly `secrets.<one of the six baseline names>`, except one baseline prose comment
  that is pinned verbatim and must appear exactly once. That rejects `SECRETS.X`, `secrets[...]`, `toJSON(secrets)`,
  `join(secrets.*, ',')`, any new name, references on `#`-looking lines inside `run: |` blocks, `}}` inside string literals and
  multi-line `if:` values, because GitHub expressions are case-insensitive. Because the scan reads raw text before YAML
  decoding, any backslash escape or unterminated value in a YAML double-quoted scalar is also rejected (the baseline has
  none), so `\x73ecrets` or an escaped line join cannot hide the word, even behind a YAML anchor or tag. Any YAML anchor,
  alias or tag is rejected outright, since the baseline uses none. Also the absence of environments.

It also executes the real CI Gate script, with `CI`/`GITHUB_ACTIONS` set as on a runner. The script must accept all-green and
reject a failed, cancelled, skipped or empty `Release Workflow Contract`, and every other failed baseline check. In addition,
99 disposable in-memory mutations of `ci.yml` must each be rejected (the guard also pins the entire approved `ci.yml`, the
Release Workflow Contract job block, exact job ids and names, and canonical YAML key spellings), among them:

* removing, duplicating or moving the step, or adding `if`, `continue-on-error`, `shell` or `|| true` / `; exit 0`;
* a narrowing argument, or removing the timeout;
* dropping the guard or a baseline file;
* job-level `if` or `continue-on-error`, broadened or top-level permissions, a secret, an environment, a Node version change or a
  new trigger;
* unwiring or dropping a CI Gate requirement, forcing the gate's exit status, accepting skipped results, or widening the
  Dependabot exception;
* the independent review's probes: `if: false` or a `shell:` override on the gate step, a gate that exits early only when
  `GITHUB_ACTIONS` is set, workflow-wide `defaults:` or `env:` before `on:` or after the last job, and `secrets[...]`,
  `toJSON(secrets)`, the `secrets.*` object filter, a baseline name used as a prefix, any upper- or mixed-case `SECRETS` /
  `Secrets` spelling, an expression on a `#`-looking line inside a `run: |` block, a secret in a bare or multi-line `if:`
  expression, `}}` inside a string literal, a duplicate of the pinned prose line, and YAML double-quoted escapes (`\x73ecrets`,
  `secrets`, an escaped line join, a flow-sequence item).

## 5. Fail-closed evidence (fixtures only)

`scripts/developer-harness-v2/ci/ci-integration.test.mjs` runs real `node --test` children against disposable temp fixtures, or
a stub executor. Each of these fails the run:

* a failing test, a crash, a top-level throw, an empty file, a skip-only file, a todo or a hang (killed at the timeout);
* an unexpected skip, a different reason, name, file or nesting level, or an extra skip with an allowed reason;
* a stale or failing allowlist entry;
* for the local-only archive entry: the old path-based reason, any other reason, a sibling test that skips with the same reason,
  a duplicated skip event, a deleted test or a failing verification (an archive that is present and passes is reported, not failed);
* missing, truncated or unparseable results, a masked exit status, a signal or an interruption, a count mismatch, or an
  unexpected file;
* a tampered allowlist (wildcard, regex, extra key, nesting, unregistered file, duplicate, too many);
* registry drift (an unregistered, missing, duplicated or unsupported test file, a removed suite, a `HARNESS_ALL` mismatch, a
  blocked suite or an extra step);
* CLI arguments.

Live CI was never broken deliberately. The optional canary PR was not approved and was not created.

## 6. End-to-end verification and benchmark labelling

The real GitHub task is the Phase 8 PR itself: PR → CI Gate → Staging Gate → human review, on an exactly verified head SHA. The
doc 06 correction in this phase is the B-08-style documentation task. The Phase 7 benchmark scenarios (B-01…B-12, A-01…) run
inside `harness.evaluation` as **fixture simulations**. They are not real-agent task completions, and a passing simulation is not
evidence of production reliability.

## 7. Limitations

* A single PR that deletes the step, the guard test and its catalog entry together would pass every test. Only human review of
  `.github/**` catches that, and the repository has no CODEOWNERS file.
* **Pre-existing, not caused by Phase 8:** in a *full local clone* that still has the old PR branch,
  `context/archive.test.mjs` › *manifest entries match the source commit blobs* **fails** at its "source commit is an ancestor of
  HEAD" assertion, because the squash merge made `8cccb11b` a non-ancestor. In CI the commit is absent and the test takes the
  allowlisted skip. If CI ever had the commit, the runner would report a failure, never a pass. Fixing that test is outside the
  Phase 8 file scope.
* Coverage is pinned per file and per suite, not per test. Deleting single tests inside a registered file, or a test that returns
  early without `t.skip()`, is not detected.
* The `Release Workflow Contract` job keeps the baseline token posture: no job `permissions:` block, so the repository default
  applies. That default was `read` when read live on 2026-11-23 through `gh api repos/{owner}/{repo}/actions/permissions/workflow`,
  a read-only call from the repository owner's account; it is a repository setting and can change. Checkout also persists
  credentials into `.git/config`, readable by every test in the job. That exposure is unchanged
  from baseline. Hardening it (`permissions: contents: read`, `persist-credentials: false`) is a recommended follow-up
  control-plane change and would need a matching guard update.
* `ci/ci-integration.test.mjs` runs twice per CI run: once in `harness.contract`, and again inside the Phase 6
  `runner.test.mjs` end-to-end test, which executes `harness.contract` for real. It spawns many short `node --test` children.
  That is slow on Windows (minutes) and fast on Linux, and it stays within the catalog timeouts and the 30-minute step timeout.
* Locally on Windows the runner reports a FAIL because of one platform skip (`path-resolution.test.mjs` directory-symlink
  privilege). That is correct fail-closed behaviour: the skip is not allowlisted, and Linux runners allow symlinks.
* The allowlisted provenance checks and the partial openwolf comparison never execute in CI. They verify only locally, where
  the old PR branch is present.
* Results come from node:test reporter events (verified on Node 22.23 and 24.19). A future Node change to the event schema
  fails the run closed instead of passing.
* Opening the PR deploys its head to the shared staging environment through the existing Staging Candidate workflow.
* **First Linux CI run of PR #250 (head `2afbde22`).** Phase 1–7 suites had never run on Linux before, and three failures, plus
  the archive skip above, were found and fixed:
  * Phase 5 `saveCheckpoint` and Phase 6 `writeRunRecord` asked `git check-ignore` before inspecting the store path. Linux git
    refuses a path beyond a symbolic link, so a symlinked store was reported as `NOT_GIT_IGNORED` instead of as a link (Windows
    git does not treat a junction as a link, so this passed locally). Both now inspect the existing components first, with
    `lstat`, following no link and creating nothing, and then run the unchanged git-ignore check and the unchanged creating
    walk. A platform-independent regression test uses a non-ignored repository, where the old order returns `NOT_GIT_IGNORED`.
  * The FINAL-E head/tail test wrote `TAIL` to stderr after a large stdout write. The two pipes have no guaranteed relative
    order, so `TAIL` could arrive early and fall out of the retained tail window. The head/tail retention test now uses one
    ordered stream. Stderr redaction has its own test. `sanitizeOutput` and `assembleOutput` are unchanged.
  * The Phase 5 store-ordering fix has no permanent ordering test in `coordination.test.mjs`, because that file was outside the
    approved scope. It is covered on Linux by the existing N-9 assertions, and it was reproduced locally against disposable
    copies of the code before and after the fix.

## 8. Rollback

Revert PR B. The change is additive (one step, one appended test file, two catalog lines, new files), so CI returns to its
`eb597d55` behaviour.

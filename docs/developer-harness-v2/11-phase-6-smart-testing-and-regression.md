# Developer Harness V2 — Phase 6: Smart Testing and Regression Prevention

Scope: the **developer** harness only (not the customer Agent Harness). Code: `scripts/developer-harness-v2/testing/`.
Tests: `testing/*.test.mjs`. `contract.json`, Phase 1–5 files, `.claude/**`, workflows, migrations and every `CLAUDE.md` are unchanged
(this phase only **adds** files).

> **LOCAL TEST SELECTION — NON-AUTHORITATIVE. CI Gate and Staging Gate remain required.**
> Every report, preview and rendered text begins and ends with that sentence and carries `authoritative: false`, `ci_equivalent: false`.

Guiding rule: **avoid missed regressions, not run the fewest tests.** When the selector is uncertain it broadens or reports `COVERAGE.UNPROVEN`.

## What this is — and is not

A deterministic, read-only **planner** (changed files → suites, reasons, gaps, escalations), a **preview-first runner** for an allowlist of
local commands, a **regression checklist** generator and a **historical-corpus evaluator**. It is not CI, is not a gate, makes no network
request, never installs a dependency, never starts Docker or Supabase, never dispatches a workflow and **never writes a Phase 5 checkpoint**.
No LLM decides anything (Haiku could draft prose around the output; deterministic rules own the selection).

| File | Responsibility |
|---|---|
| `catalog.mjs` | the suites (every one is an existing CI job / npm script / test directory), structured `steps`, env profiles, `validateStep`/`validateSuite` allowlist |
| `changes.mjs` | read-only change collection (committed + staged + unstaged + untracked; renames carry old **and** new path; deletions kept), path normalization, change-set digest, `buildRepoIndex` (which tests read which repo paths) |
| `rules.mjs` | additive path → suites/tags/escalations rules; reuses Phase 4 `SECURITY_TRIGGERS` unchanged |
| `select.mjs` | pure selector: change set (+ index) → suites with reason codes, coverage gaps, escalations |
| `runner.mjs` | `previewPlan` (executes nothing) and `runPlan` (sequential, allowlisted, bounded, scrubbed) |
| `report.mjs` | identity-bound report, `evidenceCandidate`, text rendering, run-record writer |
| `checklist.mjs` | regression checklist keyed to real PatelRep modules |
| `evaluate.mjs` + `corpus.json` | historical-diff evaluation over real GitHub Actions failures |
| `cli.mjs` | `plan` / `run [--execute]` / `checklist` / `evaluate` |

## Test catalog (stable ids, grounded commands)

Tiers: **lightweight** (node + git only, runs now) · **prereq** (needs installed dependencies — never installed here) · **expensive**
(explicit per-suite `--approve`) · **ci_only** (network, secrets, runner, live environment, Docker — never local). Sequential only; Jest
is pinned to `--ci --maxWorkers=2`; every Node child gets `--max-old-space-size=2048`. Python has no portable memory cap on Windows: it is
bounded by sequential execution plus the per-suite timeout (documented limitation).

| Suite id | Tier | Command (cwd) | CI job it mirrors |
|---|---|---|---|
| `harness.contract` / `.policy` / `.context` / `.routing` / `.coordination` / `.testing` | lightweight | `node --test --test-concurrency=1 <phase test files>` (repo) | — (Phases 1–6) |
| `repo.release_workflow_contract` | lightweight | `node --test` on the 67 files of the ci.yml list | Release Workflow Contract |
| `repo.feature_flag_registry` | lightweight | `node scripts/check-feature-flag-registry.mjs` + its test | Feature Flag Registry Gate |
| `repo.mobile_ci_workflow_contract` | lightweight | `node --test scripts/mobile-ci-workflow.test.mjs` | Mobile CI Workflow Contract |
| `repo.db_static_contract` | lightweight | `npm run db:test` file list via `node --test` | — |
| `db.migration_history` | lightweight | `node scripts/check-migrations.mjs` | Database Migration Gate (static part) |
| `db.replay_and_schema_contracts`, `db.api_integration` | expensive, **BLOCKED** | need Docker + one disposable Supabase stack | Database Migration Gate |
| `api.ruff` / `api.smoke` | prereq | `python -m ruff check --no-cache .` / `python -m pytest tests/smoke/ -v --tb=short -p no:cacheprovider` (`apps/api`, fixed placeholder env copied from ci.yml) | Lint / API, Test / API |
| `api.security_contracts` | prereq | pytest on the auth / RBAC / tenant / rate-limit contract files | (subset of smoke + roles) |
| `api.pytest_targeted` | prereq | pytest on existing root `tests/test_*.py` adjacent to the changed domain (not CI-gated) | — |
| `api.pytest_full` | expensive | `pytest tests/ --ignore=tests/integration` (not CI-gated) | — |
| `web.lint` / `web.typecheck` / `web.unit` | prereq | `eslint .` / `tsc --noEmit` / `tsx --test <75 files>` (`apps/web`, via `node_modules`, not npm) | Lint + Type-check, Test / Web unit |
| `web.feature_flag_scripts` | prereq | `node --test` on the 5 rollout-script test files (`apps/web`); they import `@supabase/supabase-js`, so without `apps/web/node_modules` the suite is `BLOCKED PREREQ.NODE_MODULES` (it is never installed, and a missing module is never reported as a test failure) | Test / Web unit |
| `web.environment_safety`, `web.frozen_files`, `web.contrast` | lightweight | `node --test …` / `node scripts/check-*.mjs` (`apps/web`) | Test / Web unit, Frozen-File Guard, Dark-Mode Contrast Gate |
| `web.i18n_parity` | prereq | the three i18n scripts | EN/ES i18n Parity |
| `web.build`, `web.hermetic` | expensive, **NOT AUTOMATED** | next build / Playwright against a mock origin | Build / Web, Room-Board Hermetic |
| `mobile.typecheck` / `mobile.lint` | prereq | `tsc --noEmit` / `eslint .` (`apps/mobile`) | Mobile / Type-check, Mobile / Lint |
| `mobile.jest_related` | prereq | `jest --ci --maxWorkers=2 --findRelatedTests <changed files>` | Mobile / Jest (subset) |
| `mobile.jest_full` | expensive | `jest --ci --maxWorkers=2` | Mobile / Jest |
| `ci.security_scan`, `ci.web_public_smoke`, `ci.pixel_diff`, `ci.supabase_cli_apply`, `ci.actions_runtime_contract`, `ci.deploy_check`, `ci.gate` | ci_only | never run locally | the same-named jobs |

`catalog.test.mjs` fails if the catalog drifts from `.github/workflows/ci.yml` / `mobile-ci.yml` (job names, the release-contract list, the
API test env) or from `package.json` (`db:test`, `test:unit`, `test:feature-flag-scripts`, lint/type-check), if a harness test file is
in no suite or two, or if a named test file does not exist.

## Selection rules (summary)

Rules are **additive**: the selection is the union over every matching rule of every changed path (both paths of a rename). Property tests
prove monotonicity (adding a file never removes a suite) and that a risky variant of a path never selects less than the ordinary one.

* **API** (`apps/api`): ruff + smoke + targeted pytest; shared runtime (`core`, `middleware`, `models`, `main.py`, policy/ai/opera) adds security contracts and the full pytest tree; router/model changes add `web.typecheck` and `mobile.typecheck`; any runtime change adds `db.api_integration` (BLOCKED) because the Database Migration Gate runs the integration tests against the real API code.
* **Web / Mobile**: lint, type-check, unit/Jest; UI source adds i18n, contrast, frozen-file, build and hermetic; config and dependency manifests select every consumer; snapshots add the hermetic/pixel/frozen/contrast suites.
* **Developer harness** (`scripts/developer-harness-v2`, `docs/developer-harness-v2`, `.claude`, `.carl`, `CLAUDE.md`, `.wolf` control files, `.mcp.json`): **all six** harness suites + security review, not the nearest test.
* **Workflows / release scripts / hooks**: the contract suites, `CI_AUTHORITATIVE_REQUIRED`, `SECURITY_REVIEW_REQUIRED`; `ci.yml` itself selects every CI-mirroring suite (it defines them all). Nothing is dispatched.
* **Database / migrations**: static migration + db contract suites, replay and API integration as **BLOCKED** (Docker + stack), `MIGRATION_NOT_LIGHTWEIGHT`, `DB_STACK_APPROVAL_REQUIRED`; editing/deleting/renaming an existing migration raises `MIGRATION_HISTORY_MUTATION`.
* **Cross-cutting**: auth/RBAC/tenant paths (Phase 4 triggers) add API security contracts plus web and mobile coverage; a changed product domain (housekeeping, engineering, guest requests, tasks, scheduling, logbook, billing/AI, integrations, reports, notifications, auth, settings) selects the adjacent surfaces (`CROSS.DOMAIN.*`).
* **Hidden couplings**: `buildRepoIndex` reads the tests' own string literals; a changed file that a test names selects that test's suite (`READS.CHANGED_FILE`) — e.g. an API smoke test that parses `apps/mobile/lib/housekeeping/supervisorTeam.ts`, workflow-contract tests that read workflow files.
* **Dependencies**: any `requirements*.txt` / `package*.json` selects every CI-mirroring suite (shared toolchain).
* **Docs-only**: still selects the repository-scanning guards (contract, feature-flag, migration history, frozen-file, contrast).
* **CI passthrough**: ci.yml has no path filters, so every non-empty change also lists every ci-only suite (`CI.NO_PATH_FILTERS`). It is excluded from the "targeted" measure.

### Conservative fallback

| Situation | Behaviour |
|---|---|
| Unknown path | all lightweight suites + `COVERAGE.UNPROVEN` |
| Unknown file type inside a known app | whole area selected + `COVERAGE.AMBIGUOUS_TYPE` |
| Invalid / escaping / absolute / control-character path | kept visible, `COVERAGE.UNPROVEN`, lightweight fallback |
| Git unavailable, base unresolved/invalid, the two change views disagree, > 20 000 paths | **every** suite listed, `COVERAGE.UNPROVEN` |
| > 400 changed files | every suite + `LARGE_DIFF` |
| No base given, or a base equal to HEAD (`base_is_head`: no committed work is examined) | `CHANGES.NO_BASE` (committed work not examined) → `COVERAGE.UNPROVEN`, on a clean **and** on a dirty tree. Only a base that is a real ancestor of HEAD gives `NO_CHANGES_DETECTED` / a proven set. A `--task-id` base comes from checkpoint data and is only as trusted as that checkpoint |
| Deleted test (or a test renamed away) | the whole area's suites + `TEST.DELETED` + `LOST_COVERAGE_REVIEW` |
| Changed test config (`jest.config.js`, `pytest.ini`, `conftest.py`, eslint/tsconfig, playwright) | the suite is selected without product code |
| Selected suite cannot run | stays visible as `BLOCKED` / `NOT_RUN` / `CI_ONLY` with a code — never dropped |
| Test discovery failure (zero `pass` count / skipped-only, unparseable count, exit 5, missing file; checked per step) | `NO_TESTS_DISCOVERED` / `BLOCKED`, never PASSED |
| A changed file cannot be passed safely to `jest_related` / `pytest_targeted` | `BLOCKED PARAMS.UNSAFE_DROPPED` (never silently dropped); the full suite covers it |
| A changed test file or check script | selects the suite that runs it (`TEST.FILE_OF_SUITE`, generic from the catalog) |
| Empty change set | explicit `NO_CHANGES` result |

## Runner safety

* **Preview first.** `plan` and `run` (without `--execute`) execute nothing and list every command, working directory, timeout and environment *names*.
* **Allowlist, not shell.** Commands are re-derived from `(suite id, validated path params)`; `validateStep` accepts only `node_bin` (eslint/tsc/jest), `node_script` (an allowlisted set of `check-*`/`verify-*` scripts), `node_test`/`tsx_test` (files ending `.test.mjs|ts`), `python` (pytest/ruff with fixed flags). `-e`, `--fix`, `--config`, `-p <plugin>`, `-w`, `--watch`, `-u`, traversal, absolute and flag-looking paths are rejected. Argument arrays, `shell:false`. Forged argv/steps/params in a selection, checkpoint or fixture are ignored.
* **Resources.** One process at a time (`concurrency ≠ 1` rejected); Jest exactly `--maxWorkers=2`; `STACK.TOO_MANY` (>1), `STACK.UNAPPROVED`, `STACK.START_NOT_SUPPORTED` (Docker/Supabase) and `DEPENDENCY.INSTALL_NOT_AUTOMATIC` are rejected before anything runs; Docker/DB suites carry no command at all. Default automatic stacks: **0**.
* **Credentials.** The child environment is built from an allowlist of OS names plus a fixed profile (the `Test / API` placeholders copied from ci.yml). No parent token, `SUPABASE_*`, `STRIPE_*`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `DATABASE_URL` is inherited. API suites refuse to run while `apps/api/.env` exists (it can point at production; it is never read). Remote-credential, network and live-environment suites are `ci_only`.
* **Output.** Bounded (256 KB, head + tail), control characters stripped, secret patterns and the literal values of sensitive parent variables redacted. When nothing was dropped the retained chunks are sanitized as ONE text (a secret straddling a chunk boundary is still redacted and no "omitted" marker is shown); when the middle was dropped, head and tail are sanitized separately, the partial word each cut leaves (≤ 512 characters) is removed, and the omission is stated with its size. A failing step's report entry keeps a sanitized `output_head` (first 1000 characters, only when the output is longer than 3000) and `output_tail` (last 2000). Exit codes are kept; a failing step is never turned into a pass; later steps show `NOT_RUN`.
* **Interpreter provenance.** The Python interpreter is never read from a plan, selection, checkpoint or report (the preview does not even echo one; `runPlan` re-derives everything). It comes only from the human's own `--python <abs path>` or `apps/api/.venv`. An explicit path must be absolute, non-UNC, named `python[3[.N]][.exe]`, free of control characters and **outside the repository** unless it is the API virtualenv itself, with trailing-dot/space path components refused and symlinks/junctions/8.3 names resolved (`realpath`) before the in-repository check; anything else is `BLOCKED PREREQ.PYTHON_ENV`. **Limits of this protection:** it stops plan/selection data and a casually planted `python.exe`; it does not make an untrusted worktree safe, because the default `apps/api/.venv` interpreter (its `pyvenv.cfg` can redirect it) and the repository's own tests (`conftest.py`, `*.test.mjs`) execute repository code by design.
* **CI-only coverage.** CI-only suites and permanently blocked ones (Docker/DB, not automated) are never executed here. Every report (preview and executed) carries `ci_required_suites`, the text report prints them under "CI-required suites (never run or passed by this tool)", their outcome is `NOT_RUN CI.ONLY` / `BLOCKED`, they never appear in `summary.passed`, and a PASS evidence candidate lists them as `ci_required`.
* **Timeouts and interruption.** Per-suite timeout kills the whole process tree (`taskkill /T /F` on Windows, process-group `SIGKILL` elsewhere). `SIGINT`/abort keeps completed results, marks the running suite `INTERRUPTED`, the rest `NOT_RUN`. The working-tree digest is compared before and after each suite; a change makes the result `INVALID_TREE_CHANGED` and stops the run.
* **Dedup.** A suite id or an identical resolved command runs once.

## Regression checklist

`buildChecklist` emits, per relevant behaviour: what may regress, **why it is adjacent** (the real module), the automated suites selected for it,
whether a manual check is still needed, the environment (localhost/hermetic only — never staging or production, never `apps/api/.env`) and
the evidence that would establish a pass. Examples: an API auth change → web **and** mobile login for all six roles; a housekeeping assignment change →
room status, assignment visibility, Room Board / Assignments / My Rooms; a work-order change → task views, PM scheduling, asset links; billing → *actual* token usage logged;
tenant isolation → cross-hotel negative tests, with RLS only via an approved disposable stack; a deleted test → a lost-coverage review. Every item is
`manual_status: NOT_VERIFIED`; automated outcomes are attached only from results that actually ran.

## Historical-diff evaluation

`corpus.json` holds **136** entries mined from the GitHub Actions REST API on 2026-11-23 (72 pull-request heads, 64 `main` pushes; the `method`,
`inclusion_rule` and `caveats` are in the file). Each has run ids/URLs, head SHA, changed files, the jobs that failed (excluding the aggregate `CI Gate`) and a baseline
check. A job already failing on the baseline (parent for a push, merge base for a PR; up to three ancestors if the baseline had no CI run) is recorded as
`inherited_failed_jobs` and **not** scored against the diff (83 baselines known, 24 via an ancestor, 29 unknown → all their jobs are kept). Nothing was invented
or hand-edited; synthetic entries are used only in negative tests and never enter the corpus.

Result (selector as committed, frozen index snapshot; recomputed after the A–E corrections below — `node cli.mjs evaluate`, asserted by `evaluate.test.mjs`).
**Read the rows separately: the headline 1.0 is NOT a measure of local test-selection accuracy.**

| Measure | Value |
|---|---|
| Entries / known failed jobs (introduced) | 136 / 128 (all map to a catalog suite; 0 outside the catalog) |
| **1. Real historical failing jobs recalled** (a suite for the job was *selected*, whether or not this tool can run it) | **128 / 128 (1.0)** — but see rows 3 and 4: 48 of these are CI-only jobs listed for every diff |
| **2. Locally runnable failing jobs recalled** (a suite this tool can actually RUN for that diff: lightweight/prereq, not blocked, parameters available) | **66 / 69 (0.957)**. Three misses, none hidden: `ci-42309249824` Database Migration Gate (covered only by a BLOCKED integration suite) and `ci-44465879046` + `ci-41160832111` Mobile / Jest (API-only diffs: `mobile.jest_related` has no mobile file to pass → `BLOCKED PARAMS.NONE`; `mobile.jest_full` is selected but needs explicit approval). A further 11 jobs have only blocked / unapproved / not-automated suites (Room-Board Hermetic 7, Build / Web 4) and are **not** claimed as locally catchable |
| **3. CI-only required coverage** | **48 jobs** (Pixel-Diff 37, Security Scan 8, Web public smoke 2, Supabase CLI 1). They are *required coverage that only CI can provide*: this tool never runs, passes or vouches for them. They appear in every report as `ci_required_suites` / "CI-required suites" and as `NOT_RUN CI.ONLY` |
| **4. Unconditionally selected suites** | **6 per non-empty diff** (the ci.yml always-on jobs, `CI.NO_PATH_FILTERS`). Of the 48 CI-only jobs, 19 (Pixel-Diff 17, Security Scan 2) are recalled by nothing except this passthrough; the other 29 are also targeted by rules. Either way the passthrough says nothing about selection accuracy |
| Rule targeting without the passthrough | 0.852 over all 128 jobs; **80 / 80 (1.0)** over the 80 jobs that have a non-CI-only suite; the 19 misses are all CI-only jobs (Pixel-Diff 17, Security Scan 2) |
| **5. Actual missed known failures** | **0** (2 when inherited failures are also scored: Build / Web on `.wolf` files; Frozen-File Guard on `update-room-board-snapshots.yml`) |
| **6. Unknown / unsupported coverage** | 9 entries with unknown or ambiguous coverage (`infra/opera-sftp/*`, `.planning`, `.wolf`, snapshot combinations); 29 entries with an unknown baseline; the entire `developer` category (see Evaluation gap); 131 entries include expensive or blocked suites |
| Mean suites selected per entry / of which not tied to any failing job | 28.3 / 27.1 (over-selection is high on purpose; recall comes first) |

**In-sample disclosure.** The corpus was used while building the rules, so 1.0 is an *in-sample* figure, not a hold-out estimate. The first
pass (before any corpus-driven rule) recalled 167 / 190 (87.9%) when inherited failures were still counted. The rules added because the corpus
showed a miss: ci.yml as the definition of every job; API runtime → integration tests (Database Migration Gate); the tests-read-this-file index; dependency manifests →
all CI-mirroring suites (manifest-only diffs failed jobs of other surfaces); docs-only → the repository-scanning guards; snapshots → frozen/contrast. A property test also caught a real
selector bug (a risk trigger wrongly suppressed the ambiguity fallback, so a risky filename selected *fewer* suites) before the corpus run.

**Evaluation gap (acceptance is not fully claimed).** No `developer`-harness change has ever failed CI (the harness is new), so that required category has no real evidence:
`acceptance.met` is `false` with reason `EVALUATION_GAP:developer`, asserted by `evaluate.test.mjs`. Searched read-only on 2026-11-23 and **no genuine case exists**: all 22 workflow runs on `feat/developer-harness-v2-core` (PR #247) concluded `success`, so there is no failing run with run-id evidence; the only corpus entry that touches harness-adjacent paths (`ci-29511910425`) changed `.claude/settings.json` and `.wolf/*` bookkeeping long before the harness existed, and its failure (`Test / Web public smoke`, a live-environment job) is unrelated to those files, so it was **not** relabelled as a developer case. A real case can only be added from a future failing run; nothing was fabricated. Environment-dependent jobs (Room-Board Pixel-Diff) fail independently of file content, so
"a job failed on this diff" is evidence, not proof of causation.

## Phase 5 compatibility

Read-only consumer. `gatherFacts` supplies head SHA, branch, tree digest and the Phase 5 scope digest; the report adds a `changed_file_digest` (statuses + renames) and, with `--task-id`, reads the
checkpoint **read-only** and reports `TASK.ID/BASE/BRANCH_MISMATCH`. The run record goes to the git-ignored `.wolf/runtime-logs/developer-harness-v2/testing/` (atomic, no symlinks, refused unless
`git check-ignore` confirms the path). `evidenceCandidate` returns a `local_tests` candidate bound to `{head_sha, tree_digest}`: **fail** whenever anything failed/timed out/was interrupted/found no tests/was invalidated; **pass**
only if EVERY selected non-CI-only suite (including expensive, blocked and DB suites, so a withheld suite makes a pass ineligible) ran and passed on an unchanged tree with no unproven coverage; nothing at all for a preview. The caller must hand it to Phase 5 `recordEvidence` itself — this module never writes a
checkpoint, changes a transition or authorizes anything. The Phase 5 coordinator and spawn guard remain advisory exactly as documented in doc 10; no binding integration is claimed.

## Limitations and prerequisites for Phase 7

* The worktree used here had no `node_modules` / `.venv`, so the `prereq` suites were verified by resolution and stub executors, and the only real suite executions were the lightweight node suites (a real `harness.contract` run is an end-to-end test). Running web/mobile/API suites for real needs a human-approved install.
* `web.build` and `web.hermetic` are defined but not automated; DB/Docker suites are always BLOCKED. A future phase needs a separately approved disposable-stack runner.
* The repo index is regex-over-string-literals (comments count; dynamically built paths are missed); `api.pytest_targeted` uses name patterns. Root `tests/test_*.py` are not part of CI Gate and may fail for pre-existing reasons.
* In-sample evaluation, a missing `developer` category, 29 entries with unknown baselines, and the `inherited` heuristic (assumes a failing baseline job stayed failing).
* No Windows memory cap for Python; Node heap is capped via `NODE_OPTIONS`.
* Phase 7 (metrics) can consume `report.summary`, `selection_digest` and the corpus metrics, but must label any timing/cost field it adds as measured or `NOT MEASURED`.

## Review follow-up (independent Opus 5.5 review)

The review found one high and several medium/low issues; all were fixed and covered by tests. High: a repo-index match marked a path "known" and switched off the ambiguity fallback (it now only adds suites). Medium: `runPlan` ran whatever a plan carried (it now re-derives every command from the suite id, re-checks approval and `apps/api/.env` at run time and ignores the plan's argv); a PASS evidence candidate ignored blocked/unapproved selected suites (now ineligible); no-base-on-clean-tree reported NO_CHANGES (now `COVERAGE.UNPROVEN`); the local-recall figure counted suites that cannot run (now honest, above). Low: dropped unsafe params, skipped-only node runs, the step-file rule, extra token formats, exit code 3 for "nothing proven" (1 = failure), a sanitized tail kept for failing steps, SIGTERM handling, UNC interpreter paths rejected. Final validation round (corrections A–E, each pinned by a `FINAL-*` regression test that was mutation-checked to fail without the fix): **A** the historical figures were stale after the honest-local-recall change (the pinned "one miss" was really three) — recomputed above and split into recalled / locally runnable / CI-only / unconditional / missed / unknown; **B** CI-only and permanently blocked suites are now an explicit `ci_required_suites` list in every report, never executed or passing; **C** the interpreter can no longer come from plan data and an explicit `--python` inside the repository is refused; **D** a clean tree with no verified base is `COVERAGE.UNPROVEN` end to end (collection → selection → evidence → CLI exit status), while a verified base on a clean tree is an explicit `NO_CHANGES_DETECTED`; **E** a failing command's output is sanitized in head and tail, contiguous chunks as one text, partial words at the cut removed. Also fixed: `web.feature_flag_scripts` is documented and tested as a PREREQ suite (it imports `@supabase/supabase-js`; its earlier failure in a worktree without `node_modules` was a prerequisite problem, not a product failure). The A–E labels are this round's own grouping of the review follow-ups.

Independent re-review of that round (0 critical / 0 high; 3 medium, 5 low, 2 nit — all addressed, each with a `REVIEW-*` test): **M1** a PEM key whose BEGIN is in the head and body/END in the tail leaked across the dropped middle (tail-side redaction up to END); **M2** a PASS candidate was offered while DB / not-automated suites were selected, contradicting this document (they now make a PASS ineligible: `CI_REQUIRED_NOT_RUNNABLE:<id>`; a FAIL is still offered); **M3** a base equal to HEAD counted as "verified" and hid committed branch work (now `base_is_head` → not examined → `COVERAGE.UNPROVEN`); **L1** `--python` path spellings (trailing dot/space, symlink/junction, 8.3) and the doc's overstated rationale; **L2** the misnamed `jobs_recalled_only_by_ci_passthrough` (now `ci_only_jobs_recalled` + `ci_only_jobs_recalled_solely_by_passthrough` = 19); **L3** the list of the 11 withheld jobs; **L4** a forged PASSED/FAILED result on a CI-required suite is ignored (`CI.RESULT_IGNORED`); **L5** a quadratic secret-assignment regex is bounded; **N1** ANSI sequences are stripped before redaction; **N2** (see end of paragraph). Follow-up verification added: PEM keys still open at the end of the output and ANSI codes inside the END marker are redacted; only a claimed PASS/DEDUPED on a CI-required suite is ignored — a claimed failure is kept (fail closed). **Accepted residuals (documented, not fixed):** an older-ancestor base still narrows the examined diff (it is human- or checkpoint-chosen); a fresh task whose base equals HEAD with only uncommitted work is `UNPROVEN` until its first commit, so no local PASS candidate exists before then (fail closed); because DB / not-automated suites make a PASS ineligible, only 30 of the 136 historical diffs could ever have produced a local PASS; a literal `-----END PRIVATE KEY-----` line in a dropped-middle tail over-redacts the text before it. **N2:** only `run --execute` has a non-zero exit status for unproven coverage — `plan` and a preview always exit 0 and report `COVERAGE.UNPROVEN` in their output.

Known and left: `--python` accepts any absolute `python*` path **outside the repository** (a human CLI choice, documented); `flagged_outside_catalog` is true by construction because of the CI passthrough, so `OUTSIDE_CATALOG_UNFLAGGED` cannot fire; POSIX detached process groups are not reaped if the harness itself is hard-killed.

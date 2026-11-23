# Developer Harness V2 — 04 Phase Roadmap and Acceptance

| PR | Title | Branch | Phases |
|---|---|---|---|
| **A** | Developer Harness V2 Core — Phases 1–7 | `feat/developer-harness-v2-core` | 1–7, one commit (or small commit set) per phase |
| **B** | Developer Harness V2 CI Integration and Final Verification | created only in Phase 8 | 8 |

PR A stays **draft** until the complete core (Phases 1–7) has been independently reviewed. Neither PR is merged,
set to auto-merge or deployed by an agent. Each phase starts only on the human owner's explicit instruction.

**Invariants every phase must keep unchanged** unless the phase explicitly owns the change and the human
approves it: CI Gate and Staging Gate semantics, trusted publishers and provenance checks, migration history
(including 262) and approval records, rulesets/secrets/environments/permissions, production and staging
workflows, the recovery auto-merge exception, customer-agent activation, grants and billing.

---

## Phase 1 — Baseline and architecture contract  *(this phase)*

- **Dependencies:** none.
- **Deliverables:** `docs/developer-harness-v2/01–06`, `contract.json`, Node contract tests in
  `scripts/developer-harness-v2/`.
- **Model:** Opus 5.5.
- **Safety risks:** documenting a weakness as if it were enforcement; tests that freeze current weaknesses.
- **Acceptance:** documents exist and are consistent with `contract.json`; contract tests pass locally; diff
  touches only `docs/developer-harness-v2/**` and `scripts/developer-harness-v2/**`; `git diff --check` clean.
- **Rollback:** revert the Phase 1 commit (documentation and tests only; no runtime effect).
- **Unchanged:** everything outside the two new directories.

## Phase 2 — Permission and action safety

- **Dependencies:** Phase 1 contract (`actions`, `protected_paths`, action classes).
- **Deliverables:** a deterministic local policy engine (pure Node module plus tests) that classifies proposed
  tool actions by effect; a fail-closed `PreToolUse` policy hook; a tightened `.claude/settings.json`
  (`deny`/`ask` for remote Supabase, EAS publish, deploy CLIs, force-push, `--no-verify`, merge, workflow
  dispatch, `.env*` reads); removal of the stale port probe and auto-start of production-connected dev
  servers; role tool scopes as data.
- **Model:** Opus 5.5 (security reasoning); Sonnet for mechanical edits.
- **Safety risks:** locking the human out of normal work (false positives); a hook that crashes open; breaking
  OpenWolf bookkeeping; changing behavior in CI (hooks must stay inert under `CI`).
- **Acceptance:** negative tests N-1…N-11 (doc 06) pass against the policy engine; compound/interpreter
  smuggling cases are denied; the hook denies on internal error; existing allowed workflows (lint, test, build,
  commit, push dedicated branch) still pass; `isCI()` behavior unchanged; false-positive rate recorded.
- **Rollback:** revert the Phase 2 commit; settings and hooks return to baseline.
- **Unchanged:** GitHub workflows, rulesets, environments; the trusted publishers.

## Phase 3 — Context and memory optimization

- **Dependencies:** Phase 2 (redaction and denied paths exist before memory is restructured).
- **Deliverables:** task-scoped context packs; curated, size-bounded memory (cerebrum split into an index plus
  topical files); OpenWolf per-turn mandates made optional; append-only logs and the estimate ledger moved out
  of version control (archived, not deleted, with human approval); refreshed or retired anatomy; untracked
  graph caches and device dumps; reconciliation of stale `CLAUDE.md` facts (G-1…G-4) **with human approval**.
- **Model:** Sonnet 5.5; Haiku for summarization.
- **Safety risks:** losing curated learnings; leaking sensitive content into new memory; destructive cleanup of
  tracked history.
- **Acceptance:** context pack for a benchmark task is under its token budget; no curated Do-Not-Repeat entry is
  lost (diff-audited); no secrets in memory (scanner); no historical data deleted without an archive.
- **Rollback:** revert the commit; archived files restore the prior state.
- **Unchanged:** product code; workflows.

## Phase 4 — Developer roles and task routing

- **Dependencies:** Phases 2–3.
- **Deliverables:** `.claude/agents/` definitions for coordinator, planner, implementer, test coordinator,
  independent reviewer, security reviewer, with tool scopes matching `contract.json` → `roles`; a deterministic
  risk router (which tasks need planner/security reviewer); model routing per contract.
- **Model:** Sonnet 5.5; Opus for the security-reviewer definition.
- **Safety risks:** a role definition granting broader tools than the contract; reviewer contamination by
  implementer context; agent proliferation.
- **Acceptance:** a test proves every role's tools are a subset of the contract; reviewers have no write tools;
  default routing uses two agents; the security reviewer is triggered for agent-harness, migration, auth,
  billing and control-plane paths.
- **Rollback:** delete the role definitions (revert commit).
- **Unchanged:** customer Agent Harness code and activation.

## Phase 5 — Coordination and checkpoint recovery

- **Dependencies:** Phase 4.
- **Deliverables:** task state machine; durable checkpoint records (local, untracked) bound to
  `{task_id, base_sha, branch, head_sha}`; resume validation; evidence invalidation on head change.
- **Model:** Opus 5.5 (correctness of invariants).
- **Safety risks:** resuming with stale approvals; checkpoint files treated as authority; corrupted state.
- **Acceptance:** N-9 and N-7 (doc 06) pass; a simulated interruption at each state resumes or blocks correctly;
  tampered checkpoints are rejected.
- **Rollback:** revert; checkpoints are local and disposable.
- **Unchanged:** GitHub as source of truth for PR/CI state.

## Phase 6 — Smart testing and regression prevention

- **Dependencies:** Phases 4–5.
- **Deliverables:** deterministic changed-file → test-set map (API, web, mobile, scripts contracts, workflow
  contracts, DB suites flagged as expensive); a local runner respecting concurrency limits (Jest ≤2 workers,
  one Supabase stack); regression checklist generation for adjacent features.
- **Model:** Sonnet 5.5; Haiku for classification.
- **Safety risks:** under-selection hiding regressions; reporting a local subset as CI-equivalent.
- **Acceptance:** for a fixed corpus of historical diffs, the selected set includes every suite that failed in
  CI for that diff; reports always label local selection as non-authoritative.
- **Rollback:** revert; CI remains the full authoritative suite.
- **Unchanged:** CI Gate composition.

## Phase 7 — Cost, reliability, and evaluation

- **Dependencies:** Phases 2–6.
- **Deliverables:** metrics from **real** usage data (provider usage reports or Claude Code usage output, not
  character estimates); the ~20-task benchmark suite (doc 05) with scoring; reliability and false-positive
  dashboards as local reports.
- **Model:** Sonnet 5.5; Haiku for summaries.
- **Safety risks:** fabricated or estimated numbers presented as measured; benchmark tasks touching real
  environments.
- **Acceptance:** every metric names its source or is `NOT MEASURED`; adversarial benchmark tasks run against
  fixtures only; baseline vs V2 comparison produced.
- **Rollback:** revert; metrics are read-only.
- **Unchanged:** product and workflows.

## Phase 8 — Protected CI integration and end-to-end verification  *(PR B)*

- **Dependencies:** PR A reviewed; explicit human instruction (control-plane work).
- **Deliverables:** add the Developer Harness V2 contract tests to CI (e.g. to the Release Workflow Contract
  list) **without removing or weakening any existing check**; end-to-end verification of a benchmark task
  through PR → CI Gate → Staging Gate.
- **Model:** Opus 5.5.
- **Safety risks:** any modification of protected workflows; accidental gate weakening; staging side effects.
- **Acceptance:** existing workflow contract tests still pass; the CI Gate required-check list is a superset of
  baseline; human control-plane review.
- **Rollback:** revert PR B.
- **Unchanged:** rulesets, environments, secrets, production workflows, the recovery exception.

# Developer Harness V2 — Phase 5: Coordination, Checkpoints and Recovery

Scope: the **developer** harness only (not the customer Agent Harness). Code: `scripts/developer-harness-v2/coordination/`.
Tests: `coordination/coordination.test.mjs`. `contract.json` is unchanged (no Phase 5 metadata was needed).

## What this is — and is not

A small, deterministic, in-process **state machine library plus a thin local CLI**. It decides whether a lifecycle transition is legal
given a record and *independently gathered* facts, stores a local checkpoint, and decides whether an interrupted task may resume.

It is **not** a runtime enforcement layer. It cannot stop a Claude Code session from calling the Agent tool, running a command or
pushing; those remain governed by the Phase 2 policy hook, Claude Code permission prompts, GitHub rulesets, CI Gate and Staging Gate.
Enforcement exists only for callers that route lifecycle changes through `applyTransition` / `requestAction` / `buildHandoff`
(the coordination CLI does). No daemon, no background process, no swarm, no network, no nested sessions.

## Lifecycle

`requested → planned → implementing → testing → reviewing → pr_open → ci_running → staging_running → ready_for_human_review`,
with stop outcomes `blocked` (terminal) and `unproven` (remote evidence missing; leaves only to `pr_open` — so every pr_open guard is re-run — to `implementing` after a head change, or to `blocked`).
`reviewing` with every review valid and a task-authorized push is reported as **awaiting_push** (a derived label, not a state).
Rework (`implementing`) is reachable from `testing` onward. Any transition not in `TRANSITIONS` (`states.mjs`) fails closed, and each
guarded transition requires its evidence **through `applyTransition`**. That is the only thing enforced: a person who edits a checkpoint's stored `state`
to something internally consistent is caught only by resume's re-derivation (identity, plan, scope, evidence-vs-state consistency), not prevented. Each transition records `reason_code`, `reason`, `actor`, `event_id` and the evidence ids that justified it.
Duplicate `event_id`s are ignored (idempotent).

| Transition | Guards (all objective, all SHA/tree-bound) |
|---|---|
| requested→planned | plan recomputes from stored input, routes, digest and contract digest unchanged |
| planned→implementing | required planner handoff done; an approval for every protected path is consumed from the in-process ledger (via the CLI this is a **self-attested** `--human-approved` flag — see Limitations) |
| implementing→testing | implementer handoff completed; `verifyDiffAgainstPlan` ok on the real diff; diff within approved scope |
| testing→reviewing | passing `local_tests` evidence bound to the current tree |
| reviewing→pr_open | push + draft-PR named by the human task; tests, independent (and security) review valid for this head; no open blocking finding; clean tree; **provider-verified** open draft PR at this exact head |
| pr_open→ci_running | provider-verified CI Gate observed for this exact head |
| ci_running→staging_running | CI Gate passed for this head; Staging Candidate whose **own** `candidate_sha`, PR and branch match |
| staging_running→ready | Staging Gate passed for this head; all local evidence still valid; PR head == local head; clean tree |

Remote gates (CI Gate, Staging Candidate identity, Staging Gate, PR open at head with `head_ref` == task branch and base `main`) are decided **from the live
provider-verified snapshot passed to that very call**. Remote-kind evidence read from a checkpoint is historical and never satisfies a gate; a newer
failing result is never outvoted by an older pass (`latestPass`: for each recorder the newest valid verdict must be a pass — a writer's later pass cannot overwrite the test coordinator's fail).

## Roles, models, tools

Roles/models/tools come only from `contract.json`, the Phase 4 router plan (rebuilt from the stored task input on every use; every stored summary field must equal what that input derives — but the stored
input itself, e.g. `authorize`, has no anchor outside the checkpoint, so a plan edited **and** re-digested is indistinguishable from a real one, which is why
every side effect still needs a fresh approval) and the
role definition files. `buildHandoff` calls `checkSpawn` (one writer, no nesting/background/shell launch, no overrides, once per role per head),
verifies the role file's model equals the contract's (no silent substitution) and that its tools are a subset of the contract grant, and enforces
prerequisites (planner, current tests, independent review before security review). Reviewers receive the task, final diff and objective evidence —
never the implementer's reasoning.

**Limitation (unchanged, deliberate):** `checkSpawn` is advisory. Making it binding needs a hook/settings change, which is outside Phase 5's
approved scope and is **not** claimed. Reviewer evidence is attributed to a *self-asserted* role label plus a recorded handoff at the same head.

## Checkpoints (`checkpoint.mjs`)

Local, untracked, non-authoritative JSON at `.wolf/runtime-logs/developer-harness-v2/checkpoints/<task_id>.json` in the task worktree
(`.wolf/runtime-logs/` is git-ignored). Before **every** write: `git check-ignore` must confirm the exact path is ignored; every path component
must be a real directory (no symlink/junction), inside the repo; the target must be a regular, non-hardlinked file. Writes are atomic
(`wx` temp file, fsync, rename), mode 0600 where supported, lock-protected (`wx` lockfile; a writer removes only its own lock, a **stale/foreign lock is never deleted automatically**), re-verified under the lock
(store path, target kind, existence), and optimistically versioned (`revision` must equal on-disk + 1, which also makes a concurrent create lose). A residual
TOCTOU window between the final path check and `rename` remains; it requires a local attacker already able to write the worktree. Max 256 KB. Schema is strict (unknown keys rejected, bounded strings/arrays,
`audit_only` approvals, safe task ids). Secret-looking content is rejected; nothing but identifiers, digests and short summaries is stored
(no `.env` content, raw reasoning, customer data or tool output). Crash leftovers (`*.tmp-*`, locks) are inert, reported and never auto-deleted.

The embedded `integrity` sha256 detects **accidental** corruption only. It is **not authentication**: anyone who can edit the file can recompute it.
Resume therefore never trusts a checkpoint; it re-derives everything below from live facts.

## Resume (`resume.mjs`)

Facts come from read-only git (`GIT_OPTIONAL_LOCKS=0`, no shell): worktree identity, branch, head, base ancestry, relation of the recorded head to
the current head (`same|ancestor|unrelated`), dirtiness, unmerged paths / in-progress merge-rebase, tree digest (head + diff + untracked content),
changed files. Remote facts exist **only** if the library caller passes a provider function whose output passes `verifyRemoteSnapshot`;
the CLI has none, so remote evidence is always `unproven` there.

Outcomes: `RESUME_PERMITTED_AFTER_FRESH_VERIFICATION`, `RESUME_READ_ONLY_INSPECTION`, `BLOCKED_INVALID_CHECKPOINT`,
`BLOCKED_REPOSITORY_IDENTITY_MISMATCH`, `BLOCKED_STALE_SHA_OR_SCOPE`, `BLOCKED_MISSING_HUMAN_APPROVAL`, `BLOCKED_DIRTY_WORKTREE_UNRECONCILED`,
`BLOCKED_OPEN_BLOCKING_FINDING`, `BLOCKED_TERMINAL_STATE`, `UNPROVEN_REMOTE_EVIDENCE`. Resume evaluation is read-only and repeatable; persisting
a projected regression is an explicit mutating CLI step. Nothing resets, stashes, cleans, rebases, force-pushes or deletes. A dirty tree in
`implementing`+ is preserved and reported; conflicts/in-progress operations or out-of-scope changes stop for a human.

## Stale evidence and approvals

A head change invalidates **all** prior evidence (local tests, independent review, security review, PR-ready, PR, CI Gate, Staging Candidate,
Staging Gate) and regresses the task to `implementing` with `EVIDENCE.HEAD_CHANGED`; a working-tree change invalidates tests/review
(`EVIDENCE.TREE_CHANGED`); a changed changed-file set invalidates reviews (`EVIDENCE.SCOPE_CHANGED`); a moved PR head invalidates remote evidence
(`EVIDENCE.REMOTE_HEAD_MOVED`). Invalidated records stay, marked with code and reason. A Staging Candidate is identified by its own code SHA;
the workflow run's head (main) is dropped at parse time. Fresh independent review is required after any invalidation.

Approvals are **audit data in a checkpoint, never authorization**. Usable approvals exist only in the in-memory `ApprovalLedger` (never serialized):
exact action + target + task + head SHA, unexpired, single-use. **N-7:** an approval given at SHA A and presented at SHA B is revoked, the task
becomes `blocked` (`APPROVAL.STALE_SHA`), and the supplied `run` callback never executes. A resumed task always lists `fresh_authorizations_required`.
The CLI flag `--human-approved action@target` creates an in-process grant for that one invocation; it is only as strong as the human's permission
prompt for that exact command, and the per-write policy hook / permission prompts remain the binding gate.

**These mutating entry points** (`applyTransition`, `buildHandoff`, `recordEvidence`, `recordFinding`, `requestAction`) refuse facts from another worktree, branch, rewritten
history, or an in-progress merge/rebase (`identityProblems`). `requestAction` additionally refuses stopped tasks, requires a lifecycle state that fits the
action (push/draft PR only from `reviewing` with every local pr_open guard met), and runs the side-effect callback only after the fresh grant is consumed.
`updateHandoff` and `claimFindingResolution` take no repository facts and are not identity-checked; the CLI checks identity before calling them.
Acting on an existing PR (`interact_with_pull_request_or_issue`, `modify_pull_request_state`, `mark_pull_request_ready_for_review`) additionally requires a
verified live snapshot, current local test/review support and no open blocking finding — recorded state alone is never enough. A recorded **fail** at
`reviewing` or later regresses the task to `implementing`. A stale grant (same action and target, unexpired, given for another head) is always revoked and
blocks the task only when the action would otherwise have been legal in the recorded state (N-7). Transitioning to `blocked` is always recordable, even if the plan, contract or checkpoint consistency is what failed. Resume applies the same live-gate
predicates (`liveGateProblems`) to the recorded remote state: a failing gate, closed PR, another branch's PR or wrong candidate yields `BLOCKED_STALE_SHA_OR_SCOPE`.

## Findings

A stored `resolution.kind` is a claim. Caveat: a re-review closes a finding when ANY later passing review of the right kind exists on a newer head — it is not tied to the finding's subject. A blocking (critical/high) finding is closed only by (a) a *verified* re-review — valid, passing evidence of the
right kind, recorded after the finding, on a head different from the one where it was found — or (b) a human decision present in the in-session ledger.
`evaluateFinding` (Phase 4) is called only with a verified resolution. Open blocking findings block `pr_open` and `ready_for_human_review`.

## CLI (`cli.mjs`)

Read-only: `inspect`, `resume-check`, `invalidated`, `blockers`, `summary`. Mutating (output carries `mutates_checkpoint: true`): `create`, `transition`,
`record-evidence`, `handoff`, `handoff-status`, `record-finding`, `claim-resolution` (stores an UNVERIFIED claim only). It runs read-only git only, never spawns agents/shells/workflows, makes no network
requests, refuses to mutate from another branch/worktree or on rewritten history, refuses `main`, and never executes anything found in a checkpoint.

## Remaining limitations / Phase 6 prerequisites

* No runtime-binding spawn guard; no hook sees checkpoint state. Phase 8 (protected CI) or a separately approved hook change would be needed.
* Remote evidence needs a real authenticated provider (read-only GitHub API); none ships here, so end-to-end remote transitions are exercised with mocks.
* Role labels on evidence are self-asserted; a malicious local editor can fabricate local evidence and recompute hashes. Mitigation is re-derivation of
  identity/plan summary/scope and demanding fresh approvals, and, ultimately, GitHub CI/Staging and human review — not checkpoint trust. Resume checks that
  an approval audit trail EXISTS for a protected-path plan, not that each recorded approval covers each path or head (they are audit data and never usable).
* `--human-approved` is a grant by whoever runs the command (any process that may run `node`); within the lifecycle it can satisfy planned→implementing for protected paths, but per-write policy hooks and permission prompts still gate the writes; it is only as strong as the human's permission prompt for that exact command. Do not "always allow" the CLI.
* A failed reviewer handoff counts as a launch: a reviewer cannot be re-rolled at the same head without new commits or a human.
* Untracked files larger than 64 MB are identified by size only in the tree digest. `git status` is run with `core.fsmonitor=false` and `GIT_OPTIONAL_LOCKS=0`.
* Deterministic test selection, coverage mapping and regression prevention belong to Phase 6.

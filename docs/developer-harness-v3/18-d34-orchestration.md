# Developer Harness V3 — 18 D3.4 Persistent Orchestration: architecture and trust boundaries

**Status: implemented and tested; V3 remains INACTIVE and live execution is refused.** Every end-to-end result in this PR is **simulated** (scripted sessions emitting the observed
`stream-json` shapes; no model, VM, network, provider credential or production key was involved). D3.4 changes no V2 file, workflow, ruleset, pin, hook, migration or `.claude/**`.
It adds only `scripts/developer-harness-v3/{orchestrator,ci}/**`, `scripts/developer-harness-v3/tests/d34-*`, and docs 18–23 with `proposals/`.

## 1. Components (`scripts/developer-harness-v3/orchestrator/`)

| Part | File(s) | What it is |
|---|---|---|
| Ledger | `ledger/{schema,ledger,evidence-store,intents,backup}.mjs` | SQLite (`node:sqlite`, built in, no service/dependency): tasks, append-only events, plans, executions, leases, candidates, checkpoints, reviews/findings, test runs, evidence + nonces, retry budgets, waits, recovery history, resources, dependencies, action intents, outbox |
| Engine | `engine.mjs`, `stages.mjs`, `session-runner.mjs`, `recovery.mjs` | deterministic single-threaded state machine; AI only inside session stages. Lease TTL (35 min) exceeds the longest work unit (30 min) |
| Routing | `routing.mjs` | pure model/effort routing, forbidden-argument/env checks, actual-model verification |
| Context | `context-renewal.mjs`, `snapshot.mjs` | renewal decision, checkpoints, restore prompt, worktree snapshots |
| Reviews | `review.mjs` | structured-findings normalization; severity decides what is mandatory |
| Issuers | `issuer/{issuer-core,ipc,issuer-client,issuer-main,key-custody,facts-git}.mjs`, `trusted-git.mjs` | separate processes, narrow operations, authenticated IPC |
| D3.3 wiring | `d33-adapters.mjs` | real governors / liveness / launcher plan; live session adapters deliberately absent |
| Gates | `activation-gates.mjs` | the register; `liveExecutionAllowed()` is false |
| Simulation | `sim/*` | harness, world, adapters, stream shapes; every output labelled simulated |

Reused UNCHANGED from D3.2/D3.3: the lifecycle reducer (all state transitions go through it), the Ed25519 evidence verifier, `admitTask`/Resource Governor `admit`, Subscription
Governor (`admitAiWork`, `classifyObservation`, `nextGovernorState`, `lifecycleFor`), session telemetry (`feedLine`, `verifyInit`), launcher `buildInvocation`, `recoveryDecision`.

## 2. Ledger semantics

* **Durable**: WAL, `synchronous=FULL`, foreign keys, schema `user_version` with ordered migrations (a newer database is refused), `quick_check` on open, 512 MB cap, 1 MB per JSON blob, 20 000 events per task.
* **Immutable identity**: triggers forbid updating a task's repository, base, requirements, scope, acceptance or risk class and forbid deleting tasks, events or evidence. Requirements are digest-bound; `requirementsIntact()` is re-checked before every session and every restore.
* **CAS**: every lifecycle event runs the reducer inside `BEGIN IMMEDIATE` and updates the row `WHERE state_revision = <judged revision>`. Stale revision/token and idempotency conflicts are rejected; replays older than the reducer's window are caught by `UNIQUE(task_id, idempotency_id)`.
* **One reasoning slot** across all tasks and reviewers is a *partial unique index* (`leases … WHERE state IN ('active','termination_unverified')`), not just code. A slot is released **only** after termination is independently verified.
* **Fencing**: the task's token advances only through the reducer's `worker_recovered`, once per recovery. A clean renewal does not advance it.
* **Evidence**: accepted through the D3.2 verifier inside one transaction; nonce→digest table (same nonce+digest = idempotent, different digest = conflict); `consumeAll` is all-or-none and one-time; a head change invalidates candidate-bound evidence and open reviews.
* **Remote effects**: `beginIntent` consumes evidence and records the intent in ONE transaction; `dispatched` becomes `uncertain` at restart; an uncertain intent must be reconciled against the remote before any retry. A database transaction cannot commit a GitHub call; this is the interface D3.6 must use.
* **Backup**: `VACUUM INTO` + sha256 sidecar + read-only verification; restore only produces a verified candidate file, never overwrites the live ledger.

## 3. One task, end to end

`submitted → queued → planning → implementing → testing → independent_review → security_review → publishing`, ending at a **verified delivery handoff** (`handoff_ready`), never `completed`.

1. **Admission** before any stage: `requirementsIntact`; the single slot; Resource Governor `admit` (memory/CPU/disk/pressure, guest metrics); for AI stages the Subscription Governor `admitAiWork` (extra usage verified-off and fresh, login valid, shared-headroom, retry time). Not admitted ⇒ `waiting_resources` / `waiting_subscription` / `waiting_external` with a wake-up time; the engine resumes by itself. Owner-only conditions (expired login, unverified extra usage, unauthorized billing, tampered requirements) ⇒ genuine `blocked` with ONE actionable outbox package.
2. **Routing** (`routing.mjs`): planning/implementation Sonnet medium (complex: Sonnet high; architecture or escalated remediation: Opus high); independent review Sonnet high; security review Opus high; summarization Haiku low (non-authoritative). Scheduling, authorization, quota waiting, monitoring, evidence verification and testing use **no model**. A mandatory security review is **never downgraded**: it waits. `--fallback-model`, API keys, base URLs, bypass, alternative accounts are refused outright.
3. **Session** (`session-runner.mjs`): lease → worker ready → prompt from the ledger → work units (≤20 turns / 30 min, configurable) → telemetry fed through the D3.3 parser → init verified (no API-key source, pinned CLI, `dontAsk`) → requested vs actual model verified → governor updated. The session's *claims* are never used: the candidate is re-derived by the controller's git adapter, scope/secret/customer-agent/historical-migration checked on the re-derived path list.
4. **Testing** is deterministic. A passing run is signed by the `orchestrator` issuer process; a failing run enters `remediation` with the failure as fenced untrusted data.
5. **Reviews**: a fresh context each, read-only candidate, enforced independently (the controller recomputes the tree digest after the session). The reviewer submits structured findings; the issuer computes the verdict. critical/high are always mandatory, low/info never; optional findings never cause another round.
6. **Failure policy**: back-off with jitter per failure fingerprint; the 2nd identical failure escalates the implementer to Opus once; an exhausted fingerprint after escalation (or 8 failures in a stage) becomes ONE genuine blocker (`OWNER_DECISION_REQUIRED`, never `TEST_FAILED`).

## 4. Context renewal (brief §7)

`renewalDecision` renews at **≥70 %** only when every input is present, fresh (≤5 min), model-matched, CLI-version-matched and consistent (`used ≤ window`, window ≥ 8 000); the ratio is compared **unrounded**. Cumulative tokens, cost and subscription utilization are never used. Otherwise it renews on bounded work units (20 turns / 30 min), labelled `bounded_work_unit_*`, `measured:false`, `utilization:null`. A compaction event forces renewal. **Suitability of the ceilings is a heuristic, not a measurement**: 20 turns stay under 70 % of a 200 k window only if average growth is ≤ 7 000 tokens/turn (≤ 35 000 for a 1 M window); no live telemetry was available to validate this (gate G-LIVE-ADAPTER).

Sequence (tested, with SIGKILL at each boundary): boundary → worktree snapshot (untrusted-input validated) → task enters `context_recovery/CONTEXT_RENEWAL` → checkpoint recorded → **verified** → graceful stop → **verified stop** → fresh lease and fresh context id → restore + verify head/snapshot → resume → continue. The prompt takes requirements, scope, acceptance, plan and remaining work **verbatim from the ledger**; model notes are fenced as untrusted data last. A crash at any point is recovered: uncommitted scoped work of a dead session is preserved as a verified `CRASH_RECOVERY` checkpoint before the tree is reset.

## 5. Recovery

Controller start: single-controller OS lock (stale lock from a dead pid is broken, a live one refuses), uncertain intents, un-acked outbox, clock-jump record, then `reconcileSlot` regardless of lease expiry. `reconcileSlot` uses D3.3 `recoveryDecision` (unknown liveness or PID reuse ⇒ investigate, slot stays held), then **guest cleanup (kill + verify)** before `supersedeLease` (token +1) and before any new lease. Unrelated processes are never touched. Stage handlers resume from durable facts (saved plan, pending candidate, recorded test run, submitted review, persisted stage deliverable) instead of repeating paid work. **Residual (documented, not fixed):** a REVIEW session's result is persisted only when its findings are stored as submitted; a crash between the review lease close and that transaction repeats one review session (planning/implementing deliverables are persisted before the session is torn down). After a recovery the token has advanced, so earlier approvals no longer verify (D3.2 binds evidence to the token); `handoff` therefore **re-attests**: each issuer re-issues the same verdict under the new epoch after re-checking the ledger and its own candidate derivation. A *changed* candidate is never re-attested.

## 6. Trust boundaries (what protects what)

| Boundary | Enforced by | Residual |
|---|---|---|
| Candidate/worker → controller | candidate re-derivation, scope + secrets + customer-agent + migration checks, untrusted snapshot/checkpoint/notes handling, read-only tree digest check | the worker kernel boundary is the D3.3 VM (gates G-WORKER-ACCOUNT, G-FULL-WORKER) |
| Controller → issuer keys | the controller imports only `issuer-client.mjs` (static test); keys live in a directory outside every repository; issuers open the ledger read-only | **same OS account in dev**: separate processes are not credential isolation. Real isolation needs per-role accounts + ACLs (G-ISSUER-ACCOUNTS, plan in `key-custody.aclPlan`) |
| IPC | per-connection challenge + HMAC with a per-role secret; closed request schema; ≤64 KB frames; ≤8 connections | Node cannot read a pipe client's SID: authentication is secret possession |
| Reviewer output → approval | issuer recomputes the verdict, independence, model identity and read-only proof from the ledger | the orchestrator issuer trusts the controller-recorded test run (the controller *is* that identity) |
| Money/accounts | `--fallback-model`/API-key/base-URL refusal, extra-usage re-check per stage, no setup-token code | provider eligibility is not established (doc 20) |
| Customer agent | candidate refused if it touches `apps/api/**/agent*`; D3.2 evaluator denies the prohibited actions | heuristic path globs |

## 7. Not done in D3.4 (see 20, 21, 23)

Live session adapter, live candidate/test adapters, publishing/CI/staging/merge/production (D3.6–D3.7), parallel execution and advanced self-healing (D3.5), Telegram/dashboard (D3.8), real issuer keys and the owner ceremony, any activation. **Runtime activation verdict: NO-GO.**

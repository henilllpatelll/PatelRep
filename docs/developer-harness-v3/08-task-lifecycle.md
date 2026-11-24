# Developer Harness V3 — 08 Persistent Task Lifecycle Contract

Machine-readable: [`task-lifecycle.json`](task-lifecycle.json). Reference reducer: `scripts/developer-harness-v3/lifecycle/lifecycle.mjs` (pure, tested).
**No runtime, database, scheduler or lease manager exists in D3.2.** The reducer pins the invariants the D3.4 orchestrator must preserve.

## 1. States

Main flow: `submitted → queued → planning → implementing → testing → independent_review → security_review → publishing → ci_running → staging_verification →
merge_eligible → merged → production_release → production_verification → completed` (`security_review` is skipped only when the risk class does not require it;
`production_release/verification` are skipped only when the task's acceptance says production is not required).

Recoverable states, each with an enumerated set of reasons: `waiting_resources`, `waiting_subscription`, `waiting_external`, `remediation`, `context_recovery`,
`worker_recovery`, `dependency_waiting`, `paused`, `blocked` (genuine blocker), `production_incident`.

## 2. Rules (all enforced and tested in the reducer)

1. **A finished session is not a finished task.** `session_completed` is recorded and changes no state. `completed` is reachable only from `production_verification`, or from `merged`
   when `production_required` is false.
2. **Legal transitions only.** Skips and unknown states are rejected and leave the task untouched.
3. **Recoverable states remember `resume_to`** (the state left) and may exit only to it; moving between waiting states keeps the original target; `remediation` returns to `implementing`.
4. **`blocked` is genuine only.** Subscription limits, memory/disk/CPU pressure, worker death, lost context, failed CI and failed tests can never be a `blocked` reason. The permitted reasons are owner-only:
   expired native login, root-of-trust ceremony, an owner decision, a request that requires a prohibited action, unproven isolation, an unresolvable requirement conflict.
5. **Revisions, fencing and idempotency.** Every event carries `expected_revision`, a `fencing_token` and an `idempotency_id`. Stale revision or token (older **or newer**) → rejected. A repeated idempotency ID → a
   no-op that returns the same task. State revision increases by one per accepted event.
6. **Evidence invalidation.** A head change returns the task to `testing` and invalidates test, review, publication, CI, staging and delivery evidence; a policy revision change invalidates all evidence.
   After `merged` a head change is an error.
7. **More events.** `policy_changed` invalidates all evidence (`*`) exactly as a head change does; `worker_recovered` is the only way a fencing token advances, and only by exactly one.
   A head or policy change is judged by the task's **effective** state (where it will resume, if waiting), so a task waiting after merge cannot be reset, and a blocked or paused task that had been
   verified now resumes at `testing`. Replays of an idempotency id must match the original event byte for byte (`EVENT.IDEMPOTENCY_CONFLICT` otherwise) and are checked after the fencing token.
8. **Risk-conditional steps are enforced.** `security_review` is mandatory unless the task was created with `security_review_required: false`, and then it may not be entered. Leaving `blocked`
   requires an `owner_action_id`; a wait that began as remediation can only return to `implementing`; `production_incident` is entered only from a post-merge effective state.
9. **Concurrency.** One reasoning session; CI/staging monitoring, the notification outbox and the resource governor are deterministic and may run beside it.

## 2a. Context renewal (D3.4 design requirement; NOT implemented in D3.2)

The owner selected **70 % context utilization** as the default threshold for automatic session renewal (configurable). When a session reaches it, the orchestrator must:

1. detect utilization from **officially supported telemetry only** (verified empirically in D3.3 before it is relied on);
2. stop starting new work and reach a **safe execution boundary** (finish or safely abandon the current step);
3. write a **durable checkpoint before the session ends**: original task requirements, the plan, remaining work, base/head SHAs, worktree snapshot, evidence references;
4. terminate the session gracefully;
5. start a **fresh Claude session** from an optimized context pack plus the restored original requirements and remaining-work list;
6. verify the restored state against the checkpoint and **continue automatically with no owner prompt**.

If exact utilization is not available from a supported source, use a **conservative, supported fallback** chosen in D3.4 (for example a lower proxy threshold, or renewal at step boundaries after a bounded amount of work); a guess is never presented as a measurement.
**Forbidden:** a blind `/clear` or any reset not preceded by a verified durable checkpoint; renewal that drops or rewrites the original requirements; renewal that needs another owner prompt.
In the lifecycle this is a `context_recovery` wait with reason `CONTEXT_RENEWAL`; it resumes to the recorded state and is never a genuine blocker (the reducer already enforces both; the Context Manager itself is not built).

## 3. Recovery contract (design)

A task must be reconstructable from persisted events, the context-pack reference, base/head SHAs and the worktree, **not** from Claude's session history. Committed work is recovered from the branch;
uncommitted work from a worktree snapshot taken at every checkpoint. Leases carry a fencing token that increments on every recovery, so a resurrected old worker cannot write.

## 4. Open items for D3.4

Owner cancellation (`cancelled` terminal state); dependency graphs between tasks; the durable event schema and its migrations in SQLite; the reproduction of the unreported H7 P3 *context recovery* failure (01 R-08);
the duration and policy for `paused`.

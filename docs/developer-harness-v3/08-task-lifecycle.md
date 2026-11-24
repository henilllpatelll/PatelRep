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
7. **Concurrency.** One reasoning session; CI/staging monitoring, the notification outbox and the resource governor are deterministic and may run beside it.

## 3. Recovery contract (design)

A task must be reconstructable from persisted events, the context-pack reference, base/head SHAs and the worktree, **not** from Claude's session history. Committed work is recovered from the branch;
uncommitted work from a worktree snapshot taken at every checkpoint. Leases carry a fencing token that increments on every recovery, so a resurrected old worker cannot write.

## 4. Open items for D3.4

Owner cancellation (`cancelled` terminal state); dependency graphs between tasks; the durable event schema and its migrations in SQLite; the reproduction of the unreported H7 P3 *context recovery* failure (01 R-08);
the duration and policy for `paused`.

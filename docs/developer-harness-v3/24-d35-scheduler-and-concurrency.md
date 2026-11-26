# Developer Harness V3 — 24 D3.5 durable multi-slot execution and the resource-aware scheduler

Status: **implemented, SIMULATED, INACTIVE.** The operational default is unchanged: **one reasoning session** (task-lifecycle contract `concurrency.max_reasoning_sessions = 1`, D3.3 governor `max_reasoning_sessions = 1`), one heavy test workload. Raising either is gate **G-PARALLEL-REASONING**.

## 1. Schema V3 (additive, `orchestrator/ledger/schema.mjs`)
V1 and V2 are byte-for-byte unchanged (sha256 `071f80d1…0ea8` / `7c4c0e4d…42e6`, pinned in `d35-slots.test.mjs`). V3 runs in one transaction like every migration; a database newer than the code is refused, a foreign database is refused, and a fault or a real `SIGKILL` inside the V3 transaction leaves the file at V2 (tested with a real child process).

| Need | V3 object | Enforced by |
|---|---|---|
| one live lease per slot | the **V1 index `one_reasoning_slot` is kept**: `leases.reasoning_slot` is now the slot number, so the same index means "one live lease per slot" (capacity 1 = the D3.4 global slot) | database |
| one live reasoning execution per task | `one_live_lease_per_task` | database |
| slot capacity | `slot_config` (reasoning 1, heavy_test 1; cannot shrink under a live lease; kinds fixed) | triggers |
| lease identity / no resurrection | `leases_identity_immutable`, `leases_no_resurrection` (a closed lease never reopens; an unverified termination never becomes active), `leases_no_delete` | triggers |
| heavy-test work slots | `work_leases` (+ per-slot and per-task uniqueness, range, immutability) | database |
| resource reservations | `reservations`, bound to exactly one holder (`holder_ref UNIQUE`), immutable, created in the same transaction as the slot, released only by a VERIFIED stop | database + `acquireLease` |
| per-task isolation | `task_workspaces` (worktree, overlay, checkpoint and candidate namespaces; unique; immutable; derived from a digest of the task id) | database |
| write-footprint serialization | `scope_claims`, `schedule_state` | scheduler |
| resumable tests, recovery, quarantine, ownership, cleanup | `test_units`, `resource_samples`, `recovery_attempts`, `quarantine`, `resources` identity columns, `cleanup_intents` | see 25 |
| authority high-water mark | `authority_log` + 14 triggers | see 26 |

## 2. Lease call sites (audited)
`acquireLease` picks the lowest free slot; with capacity 1 it returns the D3.4 codes unchanged (`LEASE.SLOT_BUSY`, `LEASE.SLOT_HELD_TERMINATION_UNVERIFIED`); with free slots a task that already holds a lease gets `LEASE.TASK_ALREADY_LEASED` / `LEASE.TASK_TERMINATION_UNVERIFIED`. `supersedeLease` takes a `leaseId`; without one and with several live leases it refuses (`RECOVERY.LEASE_REQUIRED`) — it never guesses whose. `slotHolder()` remains (lowest slot) for D3.4 callers; the two places that asked "is this execution the slot holder" (`stages.consumeDeliverable`, `issuer-core`) now ask `liveLeaseOfExecution`. `reconcileSlot` is task-scoped (`lease` / `taskId`) and passes the lease to every worker adapter call; `engine.reconcileOrphans` reconciles each orphan on its own and the controller start-up (`recoverOnStart`) reconciles every live lease separately. `checkAdmission` derives `active.reasoning_sessions` / `heavy_test_workloads` from DURABLE leases (an unverified termination still counts) and subtracts durable, not-yet-materialized reservations.

## 3. Scheduler (`orchestrator/scheduler.mjs`)
One round: outbox → orphan leases and orphan work slots (supersession only with a verified stop) → dependency graph (Tarjan; a cycle — possible only by tampering — is one owner-level `UNRESOLVABLE_REQUIREMENT_CONFLICT`) → dependency bases → rank → `planRound` → concurrent `engine.advance` per admitted task → release finished claims.

* **Footprints** come from the task's immutable submitted scope (`allowed_paths`, optional `mutable_resources`), never from a model's claim. Empty, malformed or repository-wide footprints are *unknown* and conflict with everything; any path under `supabase/migrations/**` adds the shared resource `db:migrations`. Glob overlap is conservative (case-insensitive, a directory overlaps what is below it).
* **Claims** are taken atomically (re-checked inside the write transaction) only when the task's dependencies are satisfied — never while it waits, so claims and dependencies cannot deadlock — and released at the D3.4 handoff or cancellation. **handoff-ready is not completed/merged/deployed**; it stays the temporary dependency boundary until D3.6/D3.7.
* **Dependency bases**: when a dependent starts, the dependencies' candidates are recorded; if one changes later (or loses its handoff) the dependent's approvals are withdrawn and its handoff undone; a cancelled dependency is an owner-level conflict.
* **Capacity** per round: AI = min(free reasoning slots, governor max − live leases); heavy likewise; deterministic steps ≤ 8. Memory/disk/pressure admission stays inside the stage (D3.3 governor, unchanged) — backpressure moves only the affected task to `waiting_resources`.
* **Fairness**: effective priority = priority − 10 × ⌊waited / 30 min⌋, then age, then id; a task passed over 6 times reserves the next slot of its kind.

## 4. Demonstrated (SIMULATED models/VM/tests; real ledger, scheduler and invariants)
`d35-scheduler.test.mjs`, seven tasks: two independent, one conflicting with another (same files), one repository-wide, a three-task dependency chain, one cancelled during its own session, and 60 s of memory pressure first. Result: every non-cancelled task reaches its handoff; conflicting claims are never held together (checked every round); the chain is respected; never more than one live reasoning lease; a reasoning session and a heavy test ran in the same round; zero owner interventions. Crash with two orphaned leases: the one whose worker cannot be inspected keeps its slot and still counts against the single reasoning allowance (no replacement session), the other recovers; once the first becomes inspectable both finish. Multi-slot support itself (N = 3) is proven at the ledger level with **real OS-process races** (6 processes / 3 slots → exactly 3 winners in distinct slots; 5 processes for one task → exactly one execution) and on the pure planning surface.

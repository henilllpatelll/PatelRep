# Developer Harness V3 — 06 Resource Governor (architecture + admission primitive)

Memory exhaustion has repeatedly interrupted PatelRep work (mobile Jest killed for lack of memory, stale Docker workloads holding RAM, the full V2
regression run reaped under low memory, Claude pausing while waiting for memory). V3 therefore treats host resources as **scheduling constraints**
with their own deterministic component, and memory pressure as a **recoverable task state**, never a failure.

Implemented in D3.2: `scripts/developer-harness-v3/lifecycle/resource-admission.mjs` (pure `admitTask`, tested). **Everything else is design.**
Every threshold below is a **proposed starting value, not a measurement**; `thresholds_calibrated` stays `false` until D3.3 measures the real host.

## 1. Inputs (sampled by a D3.3 sampler; unreadable = fail closed)

Available physical memory · committed bytes and commit limit (host ≈35.5 GB limit, system-managed pagefile at measurement) · paging rate · CPU ·
disk free · memory of **task-owned** process trees and containers · test-worker concurrency · host responsiveness (a heartbeat the controller can miss).
A metric that cannot be read is not "healthy": `RESOURCE.METRIC_UNAVAILABLE:<name>` keeps the task waiting.

## 2. Admission and states

`admitTask(measurements, {heavy, reasoning})` returns `admit | wait | critical` and the task state `running | waiting_resources`:

| Condition (proposed) | Result |
|---|---|
| available < 4096 MB | wait (`MEMORY_LOW`) |
| available < 1536 MB or disk < 20 GB | **critical** (stop new work, checkpoint) |
| commit > 85 %, paging > 1000 pages/s, CPU > 90 % | wait |
| a reasoning session already active (limit 1) | wait for reasoning tasks only; deterministic work may proceed |
| a heavy test workload already active (limit 1) | wait for heavy tasks only |
| host heartbeat missed | wait |

Waiting is `waiting_resources` in the task lifecycle with reasons `MEMORY_PRESSURE | DISK_PRESSURE | CPU_PRESSURE | HOST_UNRESPONSIVE`; it resumes to the
recorded state automatically, with no owner prompt.

## 3. Enforcement (design; OS quotas, not instructions)

- **VM ceiling:** fixed RAM/CPU on the worker VM (proposed ≈6 GB initial ceiling, 2 GB target host headroom); the hypervisor, not Claude, enforces it.
- **Per-process caps:** `NODE_OPTIONS=--max-old-space-size` for Node tools (V2's runner already uses a catalog heap cap of 2048 MB); Jest `--maxWorkers=1`
  (or resource-aware) for mobile; one Playwright worker; large TypeScript checks sequential; existing GitHub CI for the comprehensive runs.
- **Reservations:** a heavy task reserves its budget before start; reservations are released on exit or lease expiry.
- **Sharding:** only deterministic, memory-bounded shards; never concurrent heavy suites.
- **Windows:** system-managed pagefile stays on (measured: on). The Governor never edits host-wide memory, pagefile or WSL settings; any change is an owner-only setup item.
- **Unowned load:** the owner's browser, WSL/Docker Desktop VM and other projects are *not* controllable. The Governor accounts for them as background load and may **never** terminate them.

## 4. Cleanup rules (what may be killed, and when)

Only resources with **verified ownership** (created by the controller for this task, recorded with task ID and lease) and a **safe lifecycle** (`idle|stale|exited`) are
eligible, and only after a checkpoint. Encoded in the contract as `cleanup_task_owned_resources` with the `resource_ownership` check (tested): a resource owned by
another task, a `running` resource, and any `migration` are all denied; `terminate_unowned_processes` is **prohibited**. Idle environments are shut down on a timer; caches have
bounded retention; stale task containers are removed by label, never by name pattern across the host.

## 5. Recovery

Worker killed → lease expires → `worker_recovery` → new lease with higher fencing token → resume from the last checkpoint snapshot. Pressure clears → resume
with no owner prompt. Repeated kills at the same step escalate to `remediation` (reduce concurrency) before any `blocked` state (`blocked` is never used for resource pressure).

## 6. Acceptance tests (to be run in D3.3; D3.2 must not stress the live host)

| Scenario | Pass condition |
|---|---|
| sustained elevated memory pressure | admission holds new work; running task checkpoints; resumes when pressure clears |
| critical memory pressure | new work stops; checkpoint; no host freeze |
| worker memory exhaustion | VM-level kill only; task → `worker_recovery`; resumes |
| stale task-owned processes / containers | removed once idle; unrelated processes untouched |
| insufficient disk | critical state; no partial migration or half-written checkpoint |
| worker terminated mid-task | resume from checkpoint with higher fencing token; duplicate effects prevented by idempotency keys |
| safe resumption | no owner prompt |

D3.2 evidence: the admission function's unit tests (`tests/lifecycle.test.mjs`) pass on fixture numbers. **No host stress test was run.**

# Developer Harness V3 — 30 D3.6 handoff

D3.6 scope (09): automatic PR, CI and staging management, reusing the existing trusted publisher, CI Gate and Staging Gate. D3.5 built none of it. D3.5 is SIMULATED and INACTIVE.

## Interfaces D3.6 can build on
| Need | Where |
|---|---|
| multi-slot leases, per-task exclusivity, reservations, work slots, per-task workspaces | `ledger/ledger.mjs` (`acquireLease` with `reservation`, `liveLeases`, `leaseOfTask`, `activeCounts`, `pendingReservations`), `ledger/slots.mjs` |
| scheduling of independent tasks, footprints, dependency bases | `scheduler.mjs` (`Scheduler.round`, `planRound`, `footprintOf`) |
| incident handling with persisted bounds | `recovery-supervisor.mjs` (`reportIncident`, `superviseIncident`, `attempt`) |
| resumable unit-granular tests and the resource floor; process identity and proof that an interrupted workload stopped | `test-units.mjs`, `ci/resumable-runner.mjs`, `ci/process-facts.mjs` |
| what a downstream task was built and verified on (observed / build / verified dependency basis) | `dependency-basis.mjs` |
| safe cleanup | `cleanup.mjs` (identity + evaluator + durable intents) |
| backups, restore, the authority sequence | `ledger/disaster-recovery.mjs`, `authority_log` |
| failure classes and anti-gaming | `engineering-recovery.mjs` |

## Mandatory for D3.6 (carried forward; nothing here is closed)
1. **Authority evaluator before every real effect (G-INTENT-EVALUATOR), with correct consumed-evidence semantics.** This reconciles 18 §8 (which notes that a literal `evaluate()` at dispatch denies by construction once single-use evidence was consumed at creation) with 23 ("call evaluate() before every dispatch/retry"): D3.6 must (a) run `evaluate()` with controller-derived trusted facts BEFORE consumption, at intent creation, and consume only on allow; (b) immediately before dispatch and before every retry, re-run `evaluate()` in a revalidation mode in which evidence already consumed **by this same intent** (`consumed_by` = the intent id) counts as held — never as a replay — while evidence consumed by anything else, expired, invalidated or bound to another candidate refuses; (c) never weaken the evaluator to avoid a duplicate-consumption refusal. `beginIntent`/`markDispatched` success is never permission.
2. **Authenticated remote-state reconciliation** before any retry of an uncertain intent; after a ledger restore every unfinished intent is uncertain (26).
3. **V3 in protected CI (G-V3-CI) at the latest in D3.6**: P2 plus the D3.5 file list (the pinned list in `run-v3-suites.mjs` now has 55 files; 606 tests). Consider running the resumable runner in CI only if the control-plane review accepts its state file; the plain runner is sufficient there.
4. **Linux execution of the V3 suite** (never run; WSL/Docker were not started for it).
5. Delivery states: handoff-ready is still the dependency boundary; D3.6/D3.7 must replace it with real delivery states (published, CI passed, staging passed, merged) and update `openDependencies` and the scheduler's claim release accordingly.
6. Owner-only integrations: P6 (G-LIFECYCLE-P6, G-TECH-SUSPENSION-STATE), P1v2 (G-TRUSTED-GIT), owner-action evidence (G-OWNER-ACTION-EVIDENCE), the ledger freshness witness (G-LEDGER-FRESHNESS-WITNESS).

## Known limits D3.6 must respect
* Independent-verification remediation (doc 29 §6): the scheduler uses all-settled rounds (a never-settling step holds the exclusion by design: D3.6 needs a watchdog, R-20); a changed dependency basis fails closed in the authoritative lifecycle and is REBUILT only under proposal P6 (`dependency_rebuild`); the host runner's workload recovery is Windows-only and polled (R-15, R-16: the real fix is a Job Object / the VM guest-user kill under G-LIVE-RECOVERY-ADAPTERS); the operator release `--release-unproven-unit` (R-18). The runner's termination path is live host code, not simulation.
* One reasoning session (G-PARALLEL-REASONING). Two worker VMs do not fit the measured host.
* Every recovery, cleanup, golden and process-fact adapter is simulated (G-LIVE-RECOVERY-ADAPTERS); real destructive cleanup is refused.
* Long quota waits still need ONE owner billing re-verification per stale fact (28).
* The scheduler's footprint is the submitted scope; a task with a broad scope serializes against everything (safe, slow).
* All D3.4 carry-forwards in 23 that D3.5 did not address: context-renewal ceilings unvalidated (4), issuer trust in controller-written rows (6, G-ISSUER-INDEPENDENT-FACTS), live adapter coverage of untracked files (13), the unreproduced H7 P3 failure (01 R-08).

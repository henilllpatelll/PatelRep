# Developer Harness V3 — 23 D3.5 handoff

D3.5 scope (09): self-healing recovery and resource-aware **parallel** development. D3.4 deliberately built none of it; it left these interfaces and known limits.

## Interfaces D3.5 can build on
| Need | Where |
|---|---|
| per-task durable state, events, leases, fencing, recovery history | `orchestrator/ledger/ledger.mjs` (`acquireLease`, `supersedeLease`, `recoveryHistory`) |
| the single-slot rule to relax | partial unique index `one_reasoning_slot` (schema) + `engine.tick` (one task per tick) |
| admission | `engine.checkAdmission` (resource `admit` + `admitAiWork`); `reservations` are already accepted by `admit` |
| resumption without repeating paid work | `stage_done:*`, `candidate_pending:*`, submitted-review reuse, test-run reuse in `stages.mjs` |
| re-attestation after a recovery | `stages.reattest` + issuer epoch rule |
| fault injection for new recovery work | `hook(point)` names in `session-runner.mjs`/`stages.mjs`, `sim/controller-main.mjs` (`crash_at`), `d34-crash.test.mjs` |
| simulation | `sim/harness.mjs`, `sim-adapters.mjs` scenario keys: `stages`, `tests`, `pressure`, `quota`, `units`, `tamper`, `actualModel`, `extraFiles`, `modified` |

## Known limits D3.5 must respect or remove deliberately
1. **Parallelism**: the engine is single-threaded and `acquireLease` refuses a second active lease for ANY task. Parallel work needs a per-slot lease table, per-task worktrees/VM overlays, and re-deriving the Resource Governor `active` counts.
2. **Self-healing** is limited to: slot recovery, token advance, uncommitted-work preservation, stage-resume markers, re-attestation. Not done: automatic VM re-provision after a failed sanitizer, golden-image reseal, corrupt-ledger restore (backup/restore helpers exist; no automatic use), disk-pressure cleanup of task-owned resources through `cleanupPlan` (the registry table exists, the engine does not call it).
3. **Evidence TTL**: approvals expire (4–6 h). Re-attestation covers token changes only; a controller outage longer than the TTL fails the handoff closed (`needs_reverification`). Proposal P3(c).
4. **Context renewal** ceilings are unvalidated heuristics; measured renewal needs a live window figure (the telemetry only learns it at a `result`).
5. **Cancellation** is a flag; **dependency** satisfaction means handoff-ready (nothing completes before D3.6).
6. The issuers trust the controller-recorded test run; real isolation of issuer identities needs the per-role accounts.
7. The simulation's `completedRuns` index drives scenario selection from the ledger; live adapters must not depend on it.

## Open owner-visible items carried forward
All activation gates (21 §5), provider eligibility (20), P1–P4 (21), the Linux execution of the V3 suite, and the unreproduced H7 P3 failure (the failure classes testable on disposable fixtures were tested; the original was never reported in enough detail to reproduce — 01 R-08 stays open).

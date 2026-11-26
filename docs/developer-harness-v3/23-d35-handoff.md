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
| simulation | `sim/harness.mjs`, `sim-adapters.mjs` scenario keys: `stages`, `tests`, `pressure`, `quota`, `units`, `tamper`, `actualModel`, `extraFiles` (+ `extraFilesOnUnit`), `modified`, `steps` (plan with `covers`/`touches`), `completes`, `coverage`, `omitCoverage` |
| work preservation / suspension | `preserve.mjs` (`captureWork`, `persistCheckpoint`, `preserveOnExit`), `suspension.mjs` (`suspendTechnically`, `budgetExceeded`, `resumeSuspended`) |

## Known limits D3.5 must respect or remove deliberately
1. **Parallelism**: the engine is single-threaded and `acquireLease` refuses a second active lease for ANY task. Parallel work needs a per-slot lease table, per-task worktrees/VM overlays, and re-deriving the Resource Governor `active` counts.
2. **Self-healing** is limited to: slot recovery, token advance, uncommitted-work preservation, stage-resume markers, re-attestation. Not done: automatic VM re-provision after a failed sanitizer, golden-image reseal, corrupt-ledger restore (backup/restore helpers exist; no automatic use), disk-pressure cleanup of task-owned resources through `cleanupPlan` (the registry table exists, the engine does not call it).
3. **Evidence TTL**: approvals expire (4–6 h). Handoff re-attests tokens AND expired approvals (the issuer re-issues under a successor subject after re-deriving everything); an issuer outage longer than the technical cool-downs ends in a terminal technical suspension, not an owner block. A lifecycle back-edge `publishing → testing` remains proposal P3(c); P5 adds the suspension state.
4. **Context renewal** ceilings are unvalidated heuristics; measured renewal needs a live window figure (the telemetry only learns it at a `result`).
5. **Cancellation** is a flag + `paused`; a running session notices it at the next unit boundary (stop verified, work checkpointed). **Dependency** satisfaction means handoff-ready (nothing completes before D3.6). A task whose dependency was cancelled still returns no progress and no disposition (`deadDependencies`) — not addressed in this round.
6. The issuers trust the controller-recorded test run; real isolation of issuer identities needs the per-role accounts.
7. The simulation's `completedRuns` index drives scenario selection from the ledger; live adapters must not depend on it.

## Open owner-visible items carried forward
All activation gates (21 §5), provider eligibility (20), P1–P4 (21), the Linux execution of the V3 suite, and the unreproduced H7 P3 failure (the failure classes testable on disposable fixtures were tested; the original was never reported in enough detail to reproduce — 01 R-08 stays open).

## Limits added or confirmed by the verification round (F1–F6)
8. **Unattended waits > 6 h** need an owner re-verification of extra usage (gate G-UNATTENDED-LONG-WAIT); technical cool-downs are deliberately shorter.
9. **Sessions per task are capped (150) and epochs are capped (3)**: a task that exhausts them is *terminally suspended* until `resumeSuspended`; D3.5 parallelism must keep the caps per task, not global.
10. **Completeness depends on an independent reviewer's coverage report**; the deterministic part is only the plan's declared `touches`. A planner that declares none gives the controller nothing deterministic to check beyond "every step claimed".
11. **Review-deliverable consumption** trusts the controller-written execution/lease rows (gate G-ISSUER-INDEPENDENT-FACTS is unchanged).
12. **P5** must be applied (owner, root of trust) before D3.5 relies on the lifecycle showing suspensions; until then the ledger `suspensions` table is authoritative.

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
5. **Cancellation** is a flag + `paused`; a running session notices it at the next unit boundary (stop verified, work checkpointed). **Dependency** satisfaction means handoff-ready (nothing completes before D3.6). A task whose dependency was cancelled becomes an explicit owner-level conflict (`UNRESOLVABLE_REQUIREMENT_CONFLICT`, one package).
6. The issuers trust the controller-recorded test run; real isolation of issuer identities needs the per-role accounts.
7. The simulation's `completedRuns` index drives scenario selection from the ledger; live adapters must not depend on it.

## Open owner-visible items carried forward
All activation gates (21 §5), provider eligibility (20), P1–P4 (21), the Linux execution of the V3 suite, and the unreproduced H7 P3 failure (the failure classes testable on disposable fixtures were tested; the original was never reported in enough detail to reproduce — 01 R-08 stays open).

## Limits added or confirmed by the verification round (F1–F6)
8. **Unattended waits > 6 h** need an owner re-verification of extra usage (gate G-UNATTENDED-LONG-WAIT); technical cool-downs are deliberately shorter.
9. **Sessions per task are capped (150) and epochs are capped (3)**: a task that exhausts them is *terminally suspended* until `resumeSuspended`; D3.5 parallelism must keep the caps per task, not global.
10. **Completeness depends on an independent reviewer's coverage report**; the deterministic part is only the plan's declared `touches`. A planner that declares none gives the controller nothing deterministic to check beyond "every step claimed".
11. **Review-deliverable consumption** trusts the controller-written execution/lease rows (gate G-ISSUER-INDEPENDENT-FACTS is unchanged).
13. **Adapter contract for the live read-only proof (G-LIVE-ADAPTER)**: `treeDigestAfterReview` and `captureSnapshot` must cover untracked and ignored-but-present files; the simulator's "clean worktree" check is only as strong as the live adapter's.
14. **Re-attestation is bounded** (the ledger's review/run time must be ≤ 24 h old in every epoch; ≤ 6 re-issues): beyond that the handoff ends in an immediate terminal `HANDOFF_APPROVALS_TOO_OLD` suspension. **No code path buys the required new test run and reviews** until the lifecycle back-edge `publishing → testing` (P3(c)) exists — D3.5/D3.6 must provide it.
12. **P5** must be applied (owner, root of trust) before D3.5 relies on the lifecycle showing suspensions; until then the ledger `suspensions` table is authoritative.
15. **The intent layer is not the authority evaluator (gate G-INTENT-EVALUATOR).** Intents check evidence presence, kind, freshness, bindings and — since F3b — that every cited evidence *satisfies* (`isSatisfying`). They do not run the evaluator's per-action checks (scope, protected paths, migrations, spend, environment, credential scope, identity) or re-verify signatures against the active key set. D3.5 must not treat `beginIntent`/`markDispatched` success as permission; D3.6 must call `evaluate()` with trusted facts before every dispatch/retry and supply an **authenticated** remote-state reader for reconciliation (doc 18 §8). D3.4's reconciliation input is caller-supplied and unauthenticated.

## D3.5 acceptance scenario recorded from a REAL interruption (2026-11-26): low memory during a full-suite run
Observed, not simulated: a sequential full V3 run on Node 22.23.2 was killed by the host's low-memory reaper while `d34-crash` was running (11 files already green; the runner reported that file as 29/30 with the kill as the only known cause), with ~1.4 GB of 16 GB physical memory free, an idle review agent still alive, and the owner's own dev servers (`next dev`, `npm run dev`) resident. The harness instructed the agent **not** to restart the work on its own. Required D3.5 behaviour, to be an automated acceptance test (no owner intervention):
1. **Classify** the interruption as resource pressure (reaper kill / admission denial), never as a test or task failure: no failure fingerprint is recorded, no retry budget is spent, no owner blocker is raised, and a partial runner result is never reported as a regression.
2. **Release what the task owns first**: gracefully stop idle review/worker agents and task-owned processes; **never** touch unrelated processes (the owner's dev servers, editors, browsers) and never bypass or disable the reaper or any resource protection.
3. **Wait automatically**: re-admit through the resource governor (a free-physical-memory floor above the per-unit heap bound, here ≥ 3 GB for a 1 GB-heap runner) using the supported monitoring mechanism, with a bounded wait and a `waiting_resources` state — not a polling loop and not an owner notification for a routine wait.
4. **Resume safely**: re-run the *interrupted unit first* (here the single `d34-crash` file) to decide resource-exhaustion vs genuine regression; only if it passes, continue the remaining units sequentially with bounded memory; if it fails, reproduce, fix and independently re-verify before anything is pushed. Completed units (already-green Node 24 run, completed reviews) are not repeated.
5. Evidence of the interruption, the wait and the resumption is recorded (ledger events + the run transcript) so a handoff can show it happened.

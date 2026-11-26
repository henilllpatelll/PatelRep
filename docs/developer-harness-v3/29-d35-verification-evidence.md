# Developer Harness V3 — 29 D3.5 verification evidence, independent reviews and residual risks

Everything below is SIMULATED unless marked REAL. REAL = real temporary SQLite files, real OS processes and real process termination in disposable fixtures, the real host-side resumable runner on the real V3 suite. SIMULATED = models, the worker VM, provider streams, the governor's inputs, process tables of the worker, golden images, cleanup executors.

## 1. Regression and acceptance (final head: see §5)
| Run | Node | Files | Tests | Result |
|---|---|---|---|---|
| baseline (D3.4 suite, before any D3.5 change) | 24.19.0 | 38 | 486 | pass |
| final head, `ci/resumable-runner.mjs` (REAL subprocesses, sequential, 1 GB heap) | 24.19.0 | __F24__ | __T24__ | __R24__ |
| final head, same runner | 22.23.2 | __F22__ | __T22__ | __R22__ |
All 486 D3.4 tests are preserved; two expectations changed intentionally (the F1 stale-billing-fact cases, doc 28). One INTERMITTENT failure of `d35-slots.test.mjs` was observed once on Node 22 before the review fixes (the runner then kept no output); 6 isolated Node 22 reruns and two full Node 22 runs passed. The runner now stores a redacted output tail of every non-passing unit; the residual is recorded in §4 (R-12). Linux: NOT run (no authorized running environment; WSL/Docker not started for it).

Acceptance mapping (brief §14): 1 `d35-slots` (migration from V1 and V2, injected fault and REAL SIGKILL mid-migration, unknown versions) · 2 `d35-slots` (REAL 6-process and 5-process races) · 3–4 `d35-slots`, `d35-review-remediation` · 5 `d35-slots` (workspaces), `d35-cleanup` · 6–7 `d35-scheduler` · 8–10 `d35-resource-interruption`, `d35-runner` (REAL) · 11–13 `d35-recovery` · 14 `d35-cleanup` (REAL junction) · 15–16 `d35-disaster-recovery`, `d35-review-remediation` · 17–18 `d35-engineering` · 19–20 `d35-lifecycle-proposal` · 21 `d35-long-wait` · 22 `d35-scheduler` · 23 `d35-scheduler` (cancel during its own session) · 24 `d35-scheduler` · 25 `d35-boundaries`.

## 2. Independent reviews (separate contexts, read-only, sequential)
| Round | Reviewer | Candidate | Verdict | Findings |
|---|---|---|---|---|
| 1 | Sonnet (high), code | 1c2315ee / 89311d74 | **NO-GO** | 7 mandatory (CR-1..CR-7), 8 non-mandatory |
| 2 | Opus (high), security | 2cf801a6 | **NO-GO** | 2 mandatory (S-1: CR-5 half fixed; S-2: CR-8 not real), 7 non-mandatory; CR-1/2/3/4/6/7 verified fixed; protected files byte-identical |
| 3 | Opus (high), security re-verification | 17ae89fd | **GO** | S-1 and S-2 FIXED (reproductions re-run: s1b 4000 MB now counted host-side; s2/s2b forged plans refused, no kill); S-4/S-6/S-8/S-9 fixed, S-7 partial (R-11); no new finding; protected files byte-identical; conditional on R-1, R-2, R-11 being recorded as activation preconditions (they are) |

Dispositions: CR-1 in-flight leases + single-flight tick/round — fixed (verified). CR-2 re-verification = new unit epoch — fixed (verified). CR-3 WAL/SHM swap — fixed (verified). CR-4 half-open + decay — fixed (verified). CR-5 → S-1 reservations before launch, real expiry, host + worker — fixed (verified, round 3). CR-6 adapter billing trust root — fixed (verified). CR-7 proposal reducer before file creation — fixed (verified). CR-8 → S-2 fresh re-plan at execution — fixed (verified, round 3). CR-9 rollback guard at start-up (when a witness is configured); backup/restore/registration are LIBRARY functions not yet scheduled by a controller loop (doc wording). CR-10 incidents bounded per epoch, anchored classes — fixed. CR-12 comment stripping — partial (still a floor, R-7). CR-13 parked tasks take no claim; scope-conflict never overwrites a wait — fixed. CR-15 failed cleanup status, unknown incident kinds, owner-held suspension state, unknown-worktree preservation, runner timeout flag, non-zero complete exit — fixed. S-4 start-up refuses a pending restore journal — fixed. S-6 success keeps a minimum back-off — fixed. S-7 wider digest, redacted stdout, child killed with the runner — fixed (grandchild residual R-11). S-8, S-9 — fixed.

## 3. Real low-memory incident reproduction
`d35-resource-interruption.test.mjs` reproduces doc 23 with zero owner interventions (pinned call order: 11 green units, the reaped `d34-crash`, `d34-crash` again first, the remaining 26; one transition into `waiting_resources`; the 3072 MB runner floor, distinct from the VM threshold; the idle task-owned reviewer stopped, the owner's dev servers untouched). `d35-runner.test.mjs` does the same with REAL child processes killed by the test (as the reaper), including a reaped runner resumed by a second invocation.

## 3a. A second REAL low-memory interruption during D3.5's own final verification (2026-11-26)
While the session was idle, Claude Code's low-memory reaper stopped the final Node 24 → Node 22 suite chain (Node 24 had 17/50 files green; free memory 2.1 GB). Handled per D3.5: classified as resource pressure (no failure recorded), nothing of the owner's touched, a bounded monitor waited for ≥ 3 GB free on 3 consecutive samples (admitted after the owner's load dropped: 3955 MB), then the runner RESUMED from its state — Node 24 reused the 17 completed files and finished 568/568. **New finding from it:** the reaper stopped the shell but the Node 22 runner survived as an orphan and kept running; a second runner on the same state file then took the orphan's in-progress unit for LOST (it summarized early, exit 75, no wrong pass/fail recorded). Fixed: the runner now holds an exclusive, liveness-checked lock on its state file (`RUNNER_ALREADY_ACTIVE`; a dead holder's lock is broken), tested with real processes. This fix came after the independent reviews and was NOT independently re-reviewed (tooling only; no authority path).

## 4. Residual-risk register (activation preconditions; nothing here is closed by simulation)
| Id | Risk | Gate / owner |
|---|---|---|
| R-1 (S-3) | `authority_log` does not cover every safety-relevant table (retry budgets, recovery attempts, outbox delivery, lease state changes, work leases, reviews/findings/candidates, waits, suspensions, test units, some meta): a backup whose sequence equals the witness could still reset budgets or re-deliver an outbox item | G-LEDGER-FRESHNESS-WITNESS: extend the triggers or define freshness as an authority-state digest BEFORE the gate closes |
| R-2 (S-5, CR-11) | golden trust: `verifyGolden` reports both the measured and the sealed digest; no controller-held pin; no post-reprovision check | G-LIVE-RECOVERY-ADAPTERS |
| R-3 | owner-action authenticity (reducer checks presence only) | G-OWNER-ACTION-EVIDENCE |
| R-4 | the authoritative reducer still has the blocked-state hop (mitigated in the controller) | G-LIFECYCLE-P6 |
| R-5 | no independent freshness witness: every real restore candidate is quarantined | G-LEDGER-FRESHNESS-WITNESS |
| R-6 | stale billing facts still need one owner re-verification per stale period | G-UNATTENDED-LONG-WAIT |
| R-7 (CR-12) | test-weakening detection is count-based (a floor, not a control); missing `diffContents` checks deletions only | reviews remain the control |
| R-8 (CR-14) | `createBackup` may report `INCONSISTENT_COPY` under a concurrent writer (fails closed); a forced restore does not compare with a readable live ledger's own sequence | before a live backup schedule |
| R-9 | all recovery/cleanup/golden/process adapters are simulated; real destructive cleanup refused | G-LIVE-RECOVERY-ADAPTERS |
| R-10 | parallel reasoning > 1 never validated on the host | G-PARALLEL-REASONING |
| R-11 (S-7) | host runner: grandchild processes are not killed on Windows; a SIGINT/hard kill of the runner skips its exit handler; git state is not in the reuse digest (d34-proposals reads git); ambiguous reruns (max 2) can mask a flaky crash | host runner is a developer tool; CI uses the plain runner |
| R-14 | `reserveFor` without `expiresAt` and without a matching slot counts 0 MB (no such caller today); a `':memory:'` file name with an on-disk db passes the temp check (no caller) | make `expiresAt` mandatory for unbound holders before activation |
| R-12 | one unexplained intermittent `d35-slots` failure on Node 22 (not reproduced) | watch in CI / Linux |
| R-13 | Linux execution of the V3 suite never performed | G-V3-CI |

## 5. Exact candidate
Final head and exact-head CI: __HEAD__ (filled after the final push).

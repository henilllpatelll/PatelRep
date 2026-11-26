# Developer Harness V3 — 40 D3.6 verification evidence, independent reviews and residual risks

Everything below is SIMULATED (simulated GitHub/staging world, test keys, temp ledgers) unless stated otherwise. Nothing was activated, merged, released or deployed; no real GitHub write, staging dispatch, remote database change or credential was made or requested by V3 code.

## 1. Regression (exact code commit `2d32c712`; the PR head adds only documentation)
| Run | Result |
|---|---|
| Full V3 suite, Windows, Node 24.19.0 (`run-v3-suites.mjs`, sequential, 1 GB heap, no skips) | see §6 (filled from the final run) |
| Full V3 suite, Windows, Node 22.23.2 | see §6 |
| V2 suites (`run-ci-suites.mjs`, Windows) | see §6 |
| Linux | **NOT RUN** — needs the protected CI integration (doc 39); no other authorized Linux environment exists and WSL/Docker were not started |
New files: `d36-authority` (11), `d36-reconcile` (14), `d36-ci-staging` (14), `d36-lifecycle` (7), `d36-watchdog` (5), `d36-e2e` (1), `d36-proposals` (4). The brief's 40 required scenarios are covered across them (authority 1–10, 38; reconciliation 14–18; publication 12–13; CI 19–24, 26; base 25; staging 27–30; eligibility and dependencies 31–32; watchdog and cancellation 33–35; boundaries 36–37, 39; proposals 40; the end-to-end scenario with an implementation failure, a transient and a genuine CI failure, a head replacement, a lost publication response, a controller restart, staging contention, two concurrent tasks with a dependency and zero owner interventions).

## 2. Independent reviews (separate read-only contexts, sequential)
| Round | Reviewer | Candidate | Verdict | Findings → disposition |
|---|---|---|---|---|
| 1 | Sonnet (high), code | 6135e679 | NO-GO | M1 suspended/blocked owner kept shared staging · M2 supersession chain not followed · M3 stale pre-dispatch staging/rerun precondition; O2 skew tolerance, O3 unresolved staging hold unwired, O5 mark-ready ordering, O6 file size → all fixed in e56a83c4 with regression tests; O1 (settle anchored to dispatch) superseded by r2's fix; O4 (64-item pool) and O7 (intent primitives exported) recorded as R-27, R-26 |
| 2 | Opus (high), security | e56a83c4 | NO-GO | MAND-1 absence concluded while our own timed-out request was in flight → fixed (86a49f74); OPT-2/3/4/6 fixed; OPT-1, OPT-5, OPT-7, OPT-8 recorded (R-25, R-31, R-28, R-29) |
| 3 | Opus, re-verification | 86a49f74 / 552dc030 | NO-GO | restart liveness trap (rows of a dead process) and reads taken in flight counting toward absence → fixed: `start()` ends the dead process's effect rows; the absence window starts at max(dispatch, our call's end) |
| 4 | Opus, re-verification | **2d32c712** | **GO** | lock residual accepted (R-32) |
Reviewers were shut down after reporting.

## 3. Intentional expectation changes (existing tests; nothing weakened)
* `d34-rem-f3-intents`, `d34-evidence`, `d34-rem-f3b-verdicts`: a reported failure (timeout) is now `uncertain`, not `failed`; reconciliation needs a SIGNED observation (fixtures `signedObservation` / `proveAbsent` in `tests/helpers.mjs`), and absence needs two spaced reads. Each test still asserts its original property, now through the authenticated path, and additionally asserts that the old caller object is refused.
* `d35-slots`: schema version 4; V3 is now pinned byte-for-byte (`6cb67c39…`); V4 may drop only the outbox it rebuilds.
* `d35-boundaries`: 31 activation gates (D3.6 adds G-DELIVERY-AUTHORITY, G-REMOTE-READER, G-PUBLISHER-CREDENTIAL), none closed.
* `tests/helpers.mjs` issuer map knows the P7 evidence types (unused until P7 is applied).
* Real finding during development: an existing guard (`d33-acceptance-review` S4) caught a bare `spawnSync('git')` in the new sim harness; it now uses the hardened `resolveGit`/`trustedGit`.

## 4. Proposal verification
P1v2 `d12edfdd…` and P2 `c42ca081…` re-verified against main and unchanged. P6 `705290e0…` superseded by P6v2 (kept). P7 first revision changed `publish_candidate_branch`; running the D3.2 authority suites against it on a disposable copy FAILED 7 tests that assert the existing contract, so P7 was revised to leave every existing action byte-identical; the revised P7 passes those suites (the one repository-scanning test `sec #2` cannot run in a copy and is part of the owner procedure, doc 39 step 3). Digests are in `proposals/manifest.json`.

## 5. Residual-risk register (activation preconditions; simulation closes nothing)
| Id | Risk | Gate |
|---|---|---|
| R-25 | staging dispatch carries only the PR number (the workflow has no SHA input); a head moving between the last check and the dispatch is caught only by the Staging Gate re-check afterwards | G-PUBLISHER-CREDENTIAL / a control-plane change to bind the head |
| R-26 | the intent primitives (`beginIntent`, `markDispatched`) are still exported: "evaluator first" is enforced by the delivery path, not by the primitives; a live adapter must be reachable only through `reauthorize` | G-INTENT-EVALUATOR |
| R-27 | the evaluator pool is capped at 64 usable artifacts (liveness, not safety) | — |
| R-28 | an `observation_id` collision is silently ignored (requires a misbehaving reader) | G-REMOTE-READER |
| R-29 | verifier/issuer calls have no deadline (a hung reader stalls the delivery tick); a rate-limit window smaller than one step's reads would livelock | G-REMOTE-READER |
| R-30 | task authority carries no migration/protected-path authorization, so tasks adding migrations cannot publish (fails closed) | owner decision |
| R-31 | P7 leaves `publish_candidate_branch` / `mark_pull_request_ready` without `delivery_target`; their target binding and publish's independent-review requirement live in the delivery layer | G-DELIVERY-AUTHORITY follow-up with updated D3.2 tests |
| R-32 | the delivery controller does not itself take the D3.4 single-controller OS lock; a live controller MUST take it before `start()` (a second controller would end the first one's live effect rows) | G-INTENT-EVALUATOR |
| R-33 | pre-merge dependent development is unsupported; ordering dependents fail closed when the upstream is rebuilt under the authoritative lifecycle (P6v2 rebuilds) | G-LIFECYCLE-P6 / D3.7 |
| carried | R-1…R-24 (docs 29), the simulated reader (G-REMOTE-READER), controller-written task facts (G-ISSUER-INDEPENDENT-FACTS), Linux (G-V3-CI) | — |

## 6. Final runs
(filled below from the final run of `2d32c712`)

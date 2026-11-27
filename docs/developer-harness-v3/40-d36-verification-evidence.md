# Developer Harness V3 — 40 D3.6 verification evidence, independent reviews and residual risks

Everything below is SIMULATED (simulated GitHub/staging world, test keys, temp ledgers) unless stated otherwise. Nothing was activated, merged, released or deployed; no real GitHub write, staging dispatch, remote database change or credential was made or requested by V3 code.

## 1. Regression (exact code commit `e707b28a`, clean tree; the commits after it add only documentation)
| Run | Result |
|---|---|
| Full V3 suite, Windows, Node 24.19.0 (`ci/resumable-runner.mjs`, sequential, 1 GB heap, 3 GB free-memory admission floor, no skips) | **713/713 tests, 65 files, PASS** (0 reused, 0 interrupted; group `ug-e32bd297…`) |
| Full V3 suite, Windows, Node 22.23.2 (same runner, run after Node 24 finished, never concurrently) | **713/713 tests, 65 files, PASS** (0 reused, 0 interrupted; group `ug-3efc96f3…`) |
| V2 suites (`run-ci-suites.mjs`, Windows) | FAIL only on the two host-dependent suites already recorded by D3.5 (doc 29 §5: `harness.policy`, `harness.context`); no V2 file is changed; GitHub CI Gate runs V2 in its supported environment |
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
| R-34 | the `Supabase Preview` check comes from an app integration outside the workflow files; V3's trusted derivation cannot see it (not required today) | G-V3-CI review |
| carried | R-1…R-24 (docs 29), the simulated reader (G-REMOTE-READER), controller-written task facts (G-ISSUER-INDEPENDENT-FACTS), Linux (G-V3-CI) | — |

## 6. Final runs and their history (honest record)
* `2d32c712` full runs: Node 24 had 2 intermittent failures under full-suite load (`d34-crash`, `d35-rem2-f3-runner`; both pass in isolation, D3.4/D3.5 real-process tests, unchanged code paths); Node 22 exposed 2 REAL portability defects in D3.6 code — an unref'd watchdog timer let Node 22 end the event loop while awaited (`d36-watchdog`), and the P7 regression assertion matched only the spec reporter (`d36-proposals`). Fixed in `aa119828`.
* `aa119828` (final code): Node 24.19.0 **673/673 PASS**, Node 22.23.2 **673/673 PASS** (62 files each). The Opus security GO is for `2d32c712`; `aa119828` changes only the timer reference and a test reporter flag (not security-material) and was not re-reviewed.
* **Final remediation code `e707b28a`** (F1/F2 remediation plus review rounds; Opus GO on this exact commit): Node 24.19.0 **713/713 PASS** and Node 22.23.2 **713/713 PASS** (65 files each). A first Node 24 full run was interrupted by host memory pressure (about 2 GB free against the 3 GB floor) — a resource interruption, not a regression. Its 45 completed files left no state on disk and were not bound to a recorded code digest, so nothing was reused; the full suite was re-run under the supported resumable runner, which waited for the 3 GB admission floor (never bypassing the low-memory reaper) and then ran every file. No unrelated or recovered process was terminated.
* Proposals re-verified at `e707b28a`: all 8 manifest digests match their files; P6v3 supersedes P6v2 (which supersedes P6/P5); P1v2, P6v3, P7 and P2 each pass `git apply --check` on the branch tree; the owner procedure (doc 39) lists P1v2, P6v3, P7, P2 in that order.
* GitHub, PR #257: see the PR checks on the exact head. Note: a `Supabase Preview` check appears on PRs from the Supabase GitHub app integration (no workflow file defines it; it reported *skipping*). V3 does not treat it as a required check; deriving it from a trusted source is recorded as R-34.

## 7. D3.6 Workstream B — owner-controlled protected integration (branch `control-plane/dh3-d36-integration`)

Base: verified main `c557c5b05d480f0e2f29a2a2a1701842300b58aa` (PR #257 merged; accepted head `657af4bc`). Explicitly owner-requested control-plane work; every protected
operation went through the existing V2 hook (no bypass, no alternate interpreter, no direct object writes). Nothing was activated; no policy revision, credential or trust root
was created; no real V3 staging dispatch was made.

### 7.1 Proposals (applied byte-for-byte with `git apply -p1`, digests verified first, one commit each)
| Order | Id | sha256 | Commit | Disposition |
|---|---|---|---|---|
| 1 | P1v2 | `d12edfdd…c20bac2` | `c9dbf92` | integrated (trusted-git.mjs moved unchanged, sha256 `0228632e…`) |
| 2 | P6v3 | `57679d68…cb2a1cb` | `3655cd6` | integrated |
| 3 | P7 | `c0f997a0…17a065` | `9e708ba` | integrated |
| 4 | P2 | `c42ca081…a6c52ec` | `269f9af` | integrated |
| — | P1, P5, P6, P6v2 | unchanged | — | superseded, historical, never applied (they apply to the reconstructed pre-integration base: `d34-proposals`) |

### 7.2 Integration corrections (separate, digest-pinned in the manifest, separately reviewed)
| Id | Files | Purpose |
|---|---|---|
| C1 `5254b815…` | authority/evaluator.mjs, git-facts.mjs, trusted-git.mjs | R-25 / exact bindings: `delivery_target` REQUIRES the target fields of each P7 action (staging dispatch: pr_number + head_sha; re-run: run_id + attempt + head_sha; draft PR: base + head_sha; metadata: pr_number). Two stale comments. Nothing removed. |
| C2 `3b85d522…` (revised after review M2; first revision `617a3102…`) | .github/workflows/staging-candidate.yml | R-25: optional `head_sha` dispatch input (full lowercase 40-hex), refused before any staging work unless it equals the PR head; latest `ci.yml` run for the exact head (dispatch path); CI run must be the repository CI workflow for that head; CI Gate bound to the github-actions check of THAT run's check suite (newest attempt). |
| (non-protected) | orchestrator/sim/delivery-harness.mjs | P1v2 missed a third importer of `orchestrator/trusted-git.mjs` (D3.6 added it after P1v2 was cut) |
| (non-protected) | delivery/controller.mjs, sim/sim-github.mjs | R-25 adapter: V3 dispatch always sends the exact head; the simulator binds a dispatched run to the REQUESTED head |
| (non-protected) | delivery/authorize.mjs, sim/sim-delivery-facts.mjs | the risk class always reaches the (now P7) evaluator (`security_review_required`) |

The manifest records `status` (integrated / superseded / integrated_correction) and the chain. Reversing the chain on a disposable copy reproduces main `c557c5b0` for every
protected file byte-for-byte (tests: `d34-proposals`, `d35-boundaries`).

### 7.3 Changed expectations (every one asserts the STRONGER integrated behaviour; no test deleted)
| Test(s) | Before (unintegrated) | After (integrated) |
|---|---|---|
| `d34-proposals` (5→7) | every patch "applies or is already applied" against the tree | the chain is applied EXACTLY (reverse on a disposable copy = base; replay = repository byte-for-byte); integrated/superseded status exact; superseded patches apply to the reconstructed base and are NOT the applied state; corrections digest-pinned; C1 removes only comments; P5's properties hold in the AUTHORITATIVE lifecycle |
| `d35-lifecycle-proposal` | P6 on a disposable copy; "the loophole is still present in the authoritative reducer" | the authoritative reducer: blocked-state escape CLOSED (the pre-integration reducer shows the removed hop); re-verification only from the declared states (now 4: publishing + delivery states); engine end to end with NO proposal configuration; owner-action verifier on the authoritative ledger |
| `d36-proposals` | P6v2/P7/P6v3 "not applied" | integrated (contract has the 4 inactive actions + 3 evidence types; lifecycle has every edge); P7 changes NO existing action (contract diff against the reconstructed base); lifecycle == base + P6v3 exactly; owner decision known to the authoritative verifier but owner_action_id still presence-only (gate open) |
| `d36-authority` | P7 actions `ACTION.UNKNOWN`; risk-class review only in the delivery layer under the authoritative evaluator | known, safeguarded, trusted_publisher-only, `requires_activation`, inactive, refused, no intent; the EVALUATOR requires the security review in both configurations; new C1 tests: every omitted target field refused, a non-candidate head refused |
| `d36-ci-staging` (14→15), `d36-authority`, `d36-lifecycle`, `d36-e2e`, `d36-rem-stale-eligibility` (14→16), `d35-rem2-f2-dependency`, `d34-rem-round3` R5-1 | technical suspension a ledger row in `ci_running`; P6v2/P6v3 copies; authoritative = fail closed | `technical_suspension` is a lifecycle state (resume_to recorded); the AUTHORITATIVE lifecycle rebuilds / steps back / re-verifies; the fail-closed paths stay covered on the labelled pre-integration reducer (temp-only); a newer FAILED same-head CI run is remediated into a NEW candidate and the failed head is never eligible again |
| `d35-boundaries` | protected files byte-identical to D3.5 | untouched protected files identical; reversing the chain reproduces every pinned D3.5 digest; every authority file is pinned or added by the chain |
| `d34-issuer`, `d34-ledger`, `d36-authority`, `d36-watchdog` | `ledger.cancel(id)` | a bare cancel is REFUSED (`TASK.OWNER_ACTION_REQUIRED`, nothing changes); the owner cancellation is terminal |
| `d34-engine`, `d34-evidence`, `d34-rem-f1-readmission`, `d34-rem-f2-preserve`, `d34-rem-f3-intents`, `d34-rem-round2`, `d35-disaster-recovery`, `d35-rem2-f1-concurrency` | cancellation as a mechanism | the same mechanism with an explicit (test) owner action id |
| `d35-scheduler` | `ownerActions: 0` | exactly one owner action, the test's own cancellation of E; still 0 blocked events / blocker rows |
| `d34-ci-runner` (4→5) | — | the REAL runner CLI exits 0 for an all-passing registry and 1 when one registered file fails |
| `d35-rem2-f3-runner`, `d35-runner`, `d33-acceptance` | Windows-only (one test SKIPPED elsewhere) | Windows unchanged; off Windows explicit fail-closed assertions (facts UNSUPPORTED, no identity recorded, HELD exit 75, nothing re-run/killed, operator attestation = containment NOT_VERIFIED; PE control not runnable → S2 refuses acceptance) |
| `scripts/staging-candidate-workflow.test.mjs` (+10), `scripts/developer-harness-v2-ci-workflow.test.mjs` (+1) | — | the workflow's resolve script executed against fixtures (R-25 cases); mutations of the new prep and V3 steps rejected |


### 7.4 Regression and CI evidence (counts: 713 accepted + 6 new integration tests = 719; plus 11 new root-level workflow tests)
| Run | Code | Result |
|---|---|---|
| Linux, GitHub CI (ubuntu-latest, Node 22), Release Workflow Contract, run 45923411093 | `988cce6c` | FIRST Linux execution: **717/719** — `d33-infra` (bundle import hard-coded the Windows git path / `;` PATH: a genuine portability defect in `runtime/artifact-transfer.mjs`) and `d35-runner` (no failure output printed) |
| Linux, CI run 45926564838 | `98e514eb` | **718/719**; the new failure tail showed `d35-runner`'s off-Windows assertion over-reached (forbade the CAUSE label `verified_resource_kill`; the runner correctly HELD) |
| **Linux, CI run 45927988900** | **`2f1a8c38` (reviewed)** | **719/719, 65 files, `{"ok":true,"problems":[]}`**; prep step, V2 suites, contract step all success; **CI Gate success** |
| Windows, Node 24.19.0 (resumable runner, 3 GB floor, 1 GB heap) | `988cce6c` | **719/719, 65 files**. The first invocation was stopped by Claude Code's low-memory reaper while idle (a resource interruption, not a failure); 39 passed files were reused for the identical code group; the one unit running at the kill (`d35-rem2-f3-lock`, no identity recorded) was HELD by the runner and released by operator attestation after a process-table check showed no surviving process (`containment: NOT_VERIFIED`), then re-ran first and passed |
| Windows, Node 22.23.2 | `988cce6c` | 718/719: `d34-crash` failed once under host saturation (two reviewer contexts + edits in parallel); **33/33 in isolation on Node 22**; recorded D3.5/D3.6 load-sensitivity of this real-process file |
| Windows, final | final head | §7.9 |
| V2 suites (`run-ci-suites.mjs`) | every CI run above | success on Linux CI (the step the V2 guard pins) |
The failing-file output tail (`run-v3-suites.mjs`) is bounded (120 lines / 12 kB) and comes from the rebuilt minimal child environment (no secrets).

### 7.5 Independent reviews (separate read-only contexts, sequential, shut down after reporting)
| Reviewer | Candidate | Verdict | Findings → disposition |
|---|---|---|---|
| Sonnet (high), code + integration | `988cce6c` | NO-GO | **M1** whole-chain reversal against live files would break ~10 V3 files on any later ci.yml / staging edit → reconstruction scoped to the V3 root of trust (`--include`), pinned by a test (`0cc973d4`); **M2** unverified run `path` shape → live GET showed the plain path; still hardened with `split('@')[0]` + tests (C2 `3b85d522…`); O1 post-chain digests pinned; O3 rename destinations from patch headers; O4 LF copies; O5 no PE spawn off Windows; O2 → R-37; O6 Linux = CI evidence above; O7 doc 18 annotated; O8 → R-35 |
| Sonnet, re-verification | delta `988cce6c..2f1a8c38` | **GO** | none mandatory |
| Opus (high), security | **`2f1a8c38`** | **GO** | no mandatory; OPT-1..6 recorded as pre-activation residuals R-38..R-43; R-31: keep open, close before activation |

### 7.6 Activation-gate accounting (none closed by this PR; closing a gate is a reviewed owner commit after the evidence exists)
| Gate | Exact requirement | Implemented | Verification evidence | Remaining condition | Recommended disposition |
|---|---|---|---|---|---|
| G-V3-CI | V3 suite wired into the protected CI gate | P2: V3 step in Release Workflow Contract (required by CI Gate), sequential, 1 GB heap, pinned registry, no skips/masking; guarded by the V2 workflow guard (+ mutations) | first Linux run on PR #258 (§7.4); runner CLI negative fixture; guard mutations | the integrated ci.yml must run from `main` on a post-merge PR or push; CI Gate must stay required (ruleset) | close after the first post-merge CI run on `main` shows the V3 step passing |
| G-V2-PROVENANCE-FETCH | the V2 provenance test no longer fetches inside the test | P2: `fetch-pinned-provenance.mjs` as an explicit step; the test only reads git objects | Linux CI: the prep step and the V2 suites passed on PR #258 | same post-merge run on `main` | close with G-V3-CI |
| G-TRUSTED-GIT | authority git-facts runs only a trusted, absolute, hardened git | P1v2: git-facts imports the in-authority `trusted-git.mjs`; no `child_process` in git-facts; all prior hardening flags kept (superset) | `git-facts`, `security`, `d34-issuer` (planted git, hostile config) on Windows and Linux CI; independent security review | owner re-pin of the dh3 closure from the reviewed commit; residual: same-OS-user PATH/`~/.gitconfig` planting (14-v2 §4) is outside the checkout | close after merge + pin refresh (no workflow dependency) |
| G-LIFECYCLE-P6 | consolidated lifecycle applied (re-verification, cancellation, provider/billing waits, sticky owner hold) | P6v3 authoritative | `d35-lifecycle-proposal`, `d36-lifecycle`, `d36-rem-stale-eligibility`, `lifecycle` on both platforms | merge + re-pin; owner-action AUTHENTICITY is a separate open gate | close after merge + pin refresh |
| G-TECH-SUSPENSION-STATE | technical suspension is a first-class lifecycle state | P6v3; the engine transitions into it (`d36-ci-staging`, `d36-authority`, `d35-lifecycle-proposal`) | as above | merge + re-pin | close after merge + pin refresh |
| G-DELIVERY-AUTHORITY | narrowly defined delivery actions, delivery_target, risk-based security review, delivery evidence types | P7 + C1 (mandatory target fields) | `d36-authority`, `d36-proposals`, D3.2 suites in place | **R-31**: publish/mark-ready carry no `delivery_target` in the contract itself (see §7.7) | keep `prepared` until R-31 is closed or explicitly accepted by the owner |

### 7.6a Trusted pins
Owner-approved in this session after both GO verdicts: `bypass-pins.mjs --scope dh3-d33 --write --from-ref 2f1a8c38abe3f3614cb156f066bce541acee9c7a` (dh3-cli 96 files; previously 40 files at `62f6a40f`); `--verify-provenance` ok; pin-only commit `c104ad21`. Only `digests` and `reviewed_source` changed (scope id, worktree binding, branch, writable/excluded paths unchanged). The tool keeps the legacy `reviewed_source.pr: 252` label; the authoritative identity is the full sha. The D3.3 worktree was not modified (its bypass execution stays refused while it differs). Any later change to the closure needs renewed review and a new re-pin.

### 7.7 Residuals added or changed by the integration
| Id | Risk | Gate |
|---|---|---|
| R-25 | **addressed** by C2 + C1 + adapter (exact head at authority, adapter and workflow); live behaviour verified only post-merge (the trusted workflow runs from `main`) | post-merge verification |
| R-31 | **kept open**: publish_candidate_branch / mark_pull_request_ready still carry no `delivery_target` in the contract; their target binding and publish's independent review live in the delivery layer. Closing it changes the representative action of ~36 D3.2 evaluator assertions; it needs its own reviewed proposal with updated D3.2 tests | G-DELIVERY-AUTHORITY |
| R-35 (new, review O8) | on live GitHub a `workflow_dispatch` / `workflow_run` staging run reports `main`'s `head_sha`, not the candidate's; V3's read side (controller, `effect-subjects`) matches the run `head_sha` to the candidate as the simulator models. A live reader must take the candidate identity from the Staging Gate check (`head_sha`) / the uploaded `staging-candidate-context` artifact | G-REMOTE-READER |
| R-36 (new) | without process facts (non-Windows), an interrupted resumable-runner unit with no recorded runner waits the full `--workload-wait-min` (default 5 min) before HOLDING (fail closed, slow) | — |
| R-37 (new, review O2) | commit `60182f36` adds 28 test-only lines to the V2 guard `scripts/developer-harness-v2-ci-workflow.test.mjs` (control-plane class) outside a digest-pinned patch; flagged for the human reviewer | owner review |
| Ruleset | the `main` ruleset requires `CI Gate` / `Staging Gate` by context name WITHOUT an integration id: any app reporting those names could satisfy it server-side. Owner action: bind both to GitHub Actions (integration 15368) | owner |
### 7.8 Post-merge verification (cannot be shown before merge)
1. `staging-candidate.yml` (C2) runs from `main`: after merge, the next `workflow_run` staging run must resolve eligible for a real PR (live check selection: latest ci.yml run, CI Gate of its check suite), and a manual `workflow_dispatch` with a wrong `head_sha` must end `eligible=false` with no Staging Gate — run only by the owner, never by V3 (`dispatch_staging_candidate` stays inactive).
2. The first CI run on `main` (or a PR based on it) must show the prep + V3 steps passing in Release Workflow Contract → evidence for G-V3-CI / G-V2-PROVENANCE-FETCH.
3. Owner ruleset action: bind the required `CI Gate` / `Staging Gate` contexts to GitHub Actions (integration 15368).
The ordinary Staging Gate of PR #258 runs main's trusted (old) staging definition; it is NOT evidence that C2 executed.

### 7.8a Pre-activation residuals from the Opus review (none mandatory for this inactive merge)
R-38 (OPT-1) a same-suite spoofed CI Gate via a candidate job's GITHUB_TOKEN (unproven; fix: ci.yml `permissions: contents: read`, `persist-credentials: false`, bind to the CI Gate JOB) · R-39 (OPT-2) an action with `delivery_target` but no required-field entry fails open → fail closed with the R-31 proposal · R-40 (OPT-3) `security_review_required` optional in TASK_SPEC → required or default true · R-41 (OPT-4) re-run `attempt` checked only in the delivery layer · R-42 (OPT-5, pre-existing) `checkShape` uses `in` (inherited names) → `Object.hasOwn` · R-43 (OPT-6) git-facts does not re-hash the cached git (`expectSha256`).

### 7.9 Final state
Final Windows Node 24 / Node 22 runs on the final head and the exact-head CI Gate / Mobile CI / Staging Gate are recorded in the PR description. Gate dispositions: §7.6 (none closed). D3.6 merge readiness: ready for owner review once those final checks are green; merging activates nothing; D3.7 not started.

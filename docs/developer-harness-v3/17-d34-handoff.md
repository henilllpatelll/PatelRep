# Developer Harness V3 — 17 D3.3 Review Evidence, Readiness Verdicts and D3.4 Handoff

## 1. Readiness verdicts

| Question | Verdict | Why |
|---|---|---|
| Human merge of the D3.3 PR | **GO for owner review** (merging activates nothing) | code + docs only under V3 paths; D3.2 contract/evaluator/lifecycle and all V2/CI files unchanged; 2 AI reviews + re-verification; tests green. Merge is your decision. |
| Isolation acceptance | **PASS (D3.3 scope)** | run 2, 2026-11-25, WHPX: 13/13 scenarios on the real VM for candidate `b7bbae10` (closure digest `c1605655…`, owner-pinned), golden image rebuilt with guest hardening. Evidence and limits in 15. Not an external audit; the full 3 GB worker and an active WSL/Docker neighbour network were not exercised |
| Runtime readiness for autonomous execution | **NO-GO** | owner login (O-2) and extra-usage verification (O-3) not done, and O-3 is currently blocked by defect D-1 (15); QEMU runs as the owner (O-7); provider-terms decision open (O-4); no issuer keys, so no `isolation_attestation`; V3 not in CI |
| V3 active | **no** | `activation.active_actions = []`; no Bypass Permissions anywhere |

## 2. Independent review (AI reviewers, not human or external auditors)

### 2.1 Independent code review — Sonnet (high effort), separate context, read-only

3 blocking, 10 should-fix and ~15 nits. Every item was remediated and then **re-verified by the same reviewer**, which also found 2 new issues in the fixes. Those were fixed afterwards and have no further review (they have tests).

| # | Finding | Remediation | Re-verified |
|---|---|---|---|
| B1 | wall-time/cancel killed only the local `ssh`; remote `claude` could survive while the lock was released | `guestSessionCommand` adds a guest-side `timeout --kill-after`; `runSession` calls `terminateRemote` (kill every guest `worker` process) and releases the lock **only after `verifyStopped`**, else record `termination_unverified` and keep the lock | FIXED |
| B2 | `stopVm` could `taskkill` a reused PID | identity = name + unique marker in the command line + creation time (CIM); `exited` records are final; kill only a freshly verified supervisor | FIXED |
| B3 | extra-usage TTL not enforced at admission | `admitAiWork` re-checks `verified_at` (and rejects future timestamps) | FIXED |
| S4 | any `allow` decision could launch | `buildInvocation` requires the D3.2 decision schema, a launch action and the same task id | FIXED |
| S5 | missing init fields failed open | `verifyInit` fail-closed; init required before any other event; no init → never `available` | FIXED |
| S6 | null metrics counted as "good" in the hysteresis window | every sample must be fully measured and responsive | FIXED |
| S7 | crash safety / lock TOCTOU | try/catch/finally, child `error`, rename-claim stale break with restore | FIXED; **residual**: a sub-millisecond window remains between claim and restore |
| S8 | reattach fenced only the controller | `recoveryDecision` requires `guest_cleanup` (kill + verify) | FIXED (declarative; D3.4 wires it) |
| S9 | proxy: dead-client leak, no backpressure, cap overshoot, `once('error')`, IPv6-first | rewritten (slot before lookup, client-gone check, pause/drain, persistent handlers, IPv4 preference) | FIXED (no backpressure test) |
| S10 | stray `%SystemDrive%\ProgramData\…` tree in the checkout | `SYSTEMDRIVE` added to every minimal environment; tree deleted (never committed) | FIXED |
| S11 | test plan below its floor | returns null (caller waits) | FIXED |
| S12 | unobserved `pro`/`pro` mapping, unbounded reset, no automatic resume, cancellations escalating | observed pair only; resets > 8 days ignored; one retry once eligible; neutral kills leave state unchanged | FIXED |
| S13 | acceptance scenarios 8/9/12 could pass vacuously | ENOSPC required; OOM-kill/`MemoryError` required (not `timeout`); CPU sampled during burn; real forged-tree check | FIXED, verified on the real VM by run 2 (15): host-side fail-closed evaluators, binding-cap CPU enforcement test, scenario-13 plant control, retained evidence. Scenario 12 still proves the host-recompute rule, not the evaluator binding |
| N1 | (fix-induced) lock never released if VM already dead | `verifyStopped` returns true when the VM is verifiably not running | fixed after re-verification |
| N2 | (fix-induced) probe crash on neutral kill without prior state | null-safe | fixed after re-verification |

Accepted nits: `waitingReason` maps concurrency/guest-metric codes onto the nearest D3.2 reasons (the lifecycle contract has no better reason; proposal in §5).

### 2.2 Independent security and isolation review — Opus (high effort), separate context, read-only, plus one re-verification

Verdict: **the isolation design is sound for later activation**, but it is not activatable until the gates in §3 are met. Status after re-verification:

| # | Finding | Status |
|---|---|---|
| B1 | the root home sanitizer could follow a planted symlink and write attacker JSON into ctl's shell init (root in the next task); it also failed open | **FIXED**: fd-relative `O_NOFOLLOW`; read, wipe everything, then `O_EXCL` create; credentials shape-checked; wipe and exit 1 on error; sshd *requires* it; marker checked by the controller; attack added to scenario 13 |
| B2 | QEMU runs with the owner's token; TCG is not a security boundary | **ACCEPTED RESIDUAL = activation gate** (O-1 WHPX, O-7 dedicated account) |
| S1 | QMP on loopback TCP is reachable from Docker/WSL | **FIXED**: QMP removed (also observed: QEMU's Windows pipe chardev blocks VM start until a client connects) |
| S2 | `git clone` of guest bytes follows `gitdir:` redirects | **FIXED**: `importBundle` (header, size cap, verify, fsck fetch into a fresh bare repo) |
| S3 | the bypass flag could be built from a forged decision object | **FIXED**: the launcher evaluates the request itself; managed settings disable bypass until activation |
| S4 | the same-uid worker can ptrace or forge the CLI stream | **FIXED + residual**: `ptrace_scope=2`; guest-relayed facts are labelled defence in depth |
| S5 | the attestation was reusable | **FIXED**: one-shot, 24 h, consumed before launch |
| S6 | the login relay passed escape sequences and allowed API-key-scope URLs | **FIXED**: fresh overlay, escape stripping, host/scope checks, line-buffered display. Re-review N1 (`URIError` crash leaving ssh reading keys) and N2 (partial URL shown) were fixed afterwards and **not re-reviewed** |
| S7 | no SNI check, unbounded lookup, profile switch kept tunnels | **PARTIAL**: all three fixed; Host-header/ECH fronting is residual (V3-T16) |
| S8 | the QEMU validator was a denylist | **FIXED**: exact allow-list; N3 (protocol-prefixed drive names) fixed afterwards: absolute drive-letter paths only |
| S9 | no process/UI limits on the Job Object | **PARTIAL**: ActiveProcessLimit = 1 + UI restrictions; no low-integrity token (O-7) |
| S10 | QEMU unpinned; Claude pin was guest-reported | **PARTIAL**: version pin enforced; Claude pin host-computed; no QEMU hash pin (pacman signatures) |
| N4 | permanent sanitizer failure makes the worker unreachable | documented in 16 recovery |
| N5 | a forced stop could seal an unclean golden image | **FIXED**: only `guest_poweroff` seals it |
| N6 | the bundle import and host hashing write to `%TEMP%` | accepted; they clean up |

Also found **in the real VM run** (not by the reviewers): (1) the in-process proxy was frozen by the controller's synchronous SSH calls, so the proxy now runs as its own process; (2) Debian 13 apt uses `mirror+file` lists that still pointed at plain HTTP; (3) IPv6-first resolution broke tunnels; (4) `-accel` vs `-machine accel=` and the deprecated `debug-threads` broke QEMU 11 start; (5) PowerShell under `DETACHED_PROCESS` exits silently; (6) a missing `SYSTEMDRIVE` created a stray `%SystemDrive%` tree in the checkout (deleted, never committed).

### 2.3 Acceptance-remediation review after run 1 — Opus (high effort), separate context, read-only, three rounds

| Round | Verdict | Findings → status |
|---|---|---|
| 1 | NO-GO | **B1** the provision script's hardening check piped `modprobe -c` into `grep -q` under `pipefail`, so every provision would abort. Fixed: the config is captured once, and a real-bash regression test reproduces the old failure. Also, a stale `provisioned.json` survived a failed provision. Fixed: the record is invalidated first, and `start` refuses an unsealed image. **S1** the worker gets `EACCES` on the root-only `/dev/vsock`. Fixed: root-side open plus node facts. **S2** static `/dev` nodes caused false fails. Fixed: only nodes the kernel registered count. **S3** CPU-cap confounds. Fixed: work per guest CPU-second plus host-measured QEMU share, with 3 host samples. **S4** bare tool names resolved from the cwd. Fixed: absolute host tools and clean-env git. **S5** LAN IPs in `problems`. Fixed: masked document-wide. **S6** guest proxy claims were not corroborated. Fixed: host decision log, and doc 15 says which facts are guest-reported. **S7** doctor accepted stale PASSes. Fixed: `acceptanceStatus`. Nits fixed: hardened image required, ISO-validated evidence names, fw_cfg limitation, credential guard. |
| 2 | GO | N1 predictable global git config path (fixed: no `git status`, object-id comparison, fresh temp config). N2 burn window budget (fixed: 40 s burn, window 8–30 s, raw window recorded). N3 masked keys could collide (fixed: indexed placeholders). N4 threshold notes (informational). N5 bare `git` in `authority/git-facts.mjs`: unreachable from dh3, **deferred to D3.4**. |
| 3 (delta N1–N3) | GO | no new defect. Notes: a CRLF-committed file would be listed as differing (informational only); repo-local git config is still read by `rev-parse`/`ls-tree` (no escalation). |

## 3. Hardening required before any activation (D3.9 gate)

1. **O-1 WHPX**: done. WHPX is enabled and acceptance run 2 passed under WHPX (15). Re-run the suite after any re-provision or trusted-code change, including the D-1/D-2 fixes (15 "Known defects").
2. **Dedicated Windows account for QEMU** (O-7): create a standard local user `dh3-worker` (admin), grant it read/write only to `%LOCALAPPDATA%\PatelRep\dh3\workers`, launch the supervisor through a scheduled task running as that user. A QEMU escape then lands in an account without the owner's files or credentials. Not implemented in D3.3.
3. **QEMU outbound firewall rule** (O-6) as a second network layer.
4. Owner login + `auth-check` + `probe-subscription`; verify that `--setting-sources ""` and the residue sanitizer keep the login usable (14 §5).
5. Issuer services and keys (D3.4) so a `delivery_verifier` can sign `isolation_attestation` bound to the environment id after a passing suite.
6. V3 suite wired into CI (protected control-plane change, unchanged prerequisite).

## 4. Owner decisions still open

* **Provider terms (V3-T18).** Anthropic's Consumer Terms §3 restrict access "through automated or non-human means … except when you are accessing our
  Services via an Anthropic API Key or where we otherwise explicitly permit it"; the Claude Code legal page says plan limits "assume ordinary, individual
  usage" and that signing in to the unmodified binary with one's own subscription is permitted. No page explicitly permits or forbids an owner running
  their own subscription unattended. API-key billing is prohibited by your constraints, so this is **your** decision; V3 stays inactive until you make it.
* **GitHub workflows sharing the subscription (N-2, re-assessed).** `claude-release-engineer.yml`, `autonomous-feature-builder.yml` and the paused
  `dependency-orchestrator.yml` use `CLAUDE_CODE_OAUTH_TOKEN` (a `setup-token` subscription token "for CI and scripts"). They consume the same Max 5x
  allowance invisibly to the local governor (handled as unobservable background with a 10–15 % headroom reserve), and they fall under the same terms
  question. They spend nothing extra while usage credits are off. **No workflow was changed in D3.3.**

## 5. D3.4 handoff (interfaces delivered)

| D3.4 needs | D3.3 interface |
|---|---|
| start/stop/health of the worker | `infra/provision.mjs startTaskWorker`, `runtime/vm-controller.mjs stopVm/liveness/killWorkerProcesses/sshExec, runtime/egress-proxy-process.mjs, runtime/artifact-transfer.mjs importBundle` |
| resource-aware scheduling | `runtime/resource-governor.mjs admit(profile, ctx)`, `planTestExecution`, reservations helpers; host sampler `sampleWindowsHost`, guest `GUEST_SAMPLE_SCRIPT`/`parseGuestSample` |
| subscription-aware scheduling | `normalizeAuthStatus`, `classifyObservation`, `nextGovernorState`, `admitAiWork`, `lifecycleFor` |
| launching a session | `buildWorkerEnvironment`, `verifyEffectiveSettings`, `verifyBinary`, `buildTrustedLaunch`, `evaluateLaunch`, `buildInvocation`, `runSession` |
| context renewal at 70 % | `session-telemetry.mjs contextUtilization` (null unless both numbers are provider-reported), `compactions`, `result`/`terminal_reason`; recommendation in 14 §4 |
| recovery | `issueLease`, `checkLease`, `recoveryDecision`, `registerResource`, `cleanupPlan`; atomic state in `lib/atomic.mjs` |
| proposals for D3.4 contract review | add a `waiting_external` reason `PROVIDER_UNAVAILABLE` (currently mapped to `NETWORK_UNAVAILABLE`); decide whether `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` joins the worker allow-list (today the proxy denies telemetry hosts instead); decide whether the owner-attested probe becomes a contract-level action |

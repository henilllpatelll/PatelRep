# Developer Harness V3 — 17 D3.3 Review Evidence, Readiness Verdicts and D3.4 Handoff

## 1. Readiness verdicts

| Question | Verdict | Why |
|---|---|---|
| Human merge of the D3.3 PR | @@MERGE_VERDICT@@ | |
| Isolation acceptance | @@ISOLATION_VERDICT@@ | see 15 |
| Runtime readiness for autonomous execution | **NO-GO** | owner login (O-2) and extra-usage verification (O-3) not done; WHPX not enabled (O-1); QEMU runs as the owner (O-7); provider-terms decision open (O-4); no issuer keys, so no `isolation_attestation`; V3 not in CI |
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
| S13 | acceptance scenarios 8/9/12 could pass vacuously | ENOSPC required; OOM-kill/`MemoryError` required (not `timeout`); CPU sampled during burn; real forged-tree check | PARTIAL: CPU cap recorded not asserted; scenario 12 proves the host-recompute rule, not the evaluator binding |
| N1 | (fix-induced) lock never released if VM already dead | `verifyStopped` returns true when the VM is verifiably not running | fixed after re-verification |
| N2 | (fix-induced) probe crash on neutral kill without prior state | null-safe | fixed after re-verification |

Accepted nits: `waitingReason` maps concurrency/guest-metric codes onto the nearest D3.2 reasons (the lifecycle contract has no better reason; proposal in §5).

@@SECURITY_REVIEW_SECTION@@

## 3. Hardening required before any activation (D3.9 gate)

1. **O-1 WHPX** and re-run of the acceptance suite under WHPX (the TCG run does not exercise the hypervisor boundary).
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
| start/stop/health of the worker | `infra/provision.mjs startTaskWorker`, `runtime/vm-controller.mjs stopVm/liveness/qmp/sshExec` |
| resource-aware scheduling | `runtime/resource-governor.mjs admit(profile, ctx)`, `planTestExecution`, reservations helpers; host sampler `sampleWindowsHost`, guest `GUEST_SAMPLE_SCRIPT`/`parseGuestSample` |
| subscription-aware scheduling | `normalizeAuthStatus`, `classifyObservation`, `nextGovernorState`, `admitAiWork`, `lifecycleFor` |
| launching a session | `buildWorkerEnvironment`, `verifyEffectiveSettings`, `verifyBinary`, `buildTrustedLaunch`, `evaluateLaunch`, `buildInvocation`, `runSession` |
| context renewal at 70 % | `session-telemetry.mjs contextUtilization` (null unless both numbers are provider-reported), `compactions`, `result`/`terminal_reason`; recommendation in 14 §4 |
| recovery | `issueLease`, `checkLease`, `recoveryDecision`, `registerResource`, `cleanupPlan`; atomic state in `lib/atomic.mjs` |
| proposals for D3.4 contract review | add a `waiting_external` reason `PROVIDER_UNAVAILABLE` (currently mapped to `NETWORK_UNAVAILABLE`); decide whether `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` joins the worker allow-list (today the proxy denies telemetry hosts instead); decide whether the owner-attested probe becomes a contract-level action |

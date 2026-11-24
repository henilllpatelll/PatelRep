# Developer Harness V3 — 10 D3.3 Handoff

## 1. Owner-only setup requirements (the harness cannot do these)

0. **Confirm your subscription is Claude Max 5x with paid extra usage OFF.** The harness cannot measure either; the launcher (D3.3) must verify extra usage positively and normalize the plan into a canonical identity (07 §2a).
1. **Review and merge the D3.2 PR yourself.** It adds root-of-trust files; merging them is an owner decision (04 §5). Nothing activates on merge.
2. Decide whether you accept the Anthropic plan-limit/"ordinary individual usage" risk for a continuously running harness (07 §7, N-5).
3. Confirm the owner-side baselines D3.3 will rely on: power plan "never sleep on AC"; BIOS virtualization enabled (the hypervisor is already running); you accept installing a free VM runtime (VirtualBox or QEMU).
4. Decide how to handle Docker Desktop / the `docker-desktop` and `Ubuntu` WSL distros during V3 runs (they hold up to 6 GB under the current `.wslconfig` and cannot be managed by the harness).
5. Log in to Claude **inside** the future worker VM yourself; the harness never touches your login.
6. When ready: create a **new** Telegram bot (token held in the controller only) and supply your numeric user ID.
7. Optional: pause or keep paused the GitHub workflows that share your subscription (`DEPENDENCY_ORCHESTRATOR_*` already paused).

## 2. D3.3 prerequisites and tasks

- **V3 CI integration is a mandatory protected control-plane follow-up before V3 activation:** wire the V3 suite into CI through a human-approved change (update the V2 guard's `ci.yml` pin, add the suite to the protected job). Not done in D3.2.
- **Provider normalization:** implement the launcher step that turns the official CLI's own plan and extra-usage report into the canonical identities in `contract.subscription` and the `extra_usage_enabled` fact; test it against the real CLI on this account; unnormalizable output must fail closed.
- Provide `env_value_origins` from the launcher so `NODE_OPTIONS`, proxy and certificate variables are provably launcher-set.

- Re-verify the Anthropic documentation in 07 §1 (including Max-tier limits, which are not assumed equal to Pro's); empirically test headless limit behavior, `claude auth status` output, model availability and `--dangerously-skip-permissions` inside the VM.
- Provision the VM and network design (05 §3–4) and run the **adversarial isolation suite** (05 §5). If it cannot pass: record `ISOLATION_UNPROVEN` and stop.
- Measure the real host (memory, commit, paging, disk) and calibrate `DEFAULT_THRESHOLDS`; run the Resource Governor acceptance tests (06 §6) safely, not on the owner's live session.
- Measure and fix the proxy allow-list.
- Implement the sampler and the launcher that supplies `trusted.launch` (positive subscription verification).
- Wire the evaluator in **dry-run only** (log decisions, enforce nothing) against real tasks to find false positives before any enforcement.

## 3. Remaining risks carried forward

Z3 holds the Claude login (T9) · no issuer services or keys exist, so no evidence authenticates yet · the verifier-from-pinned-checkout and Z3→Z2 isolation are design only · V2's
router defect R-06 is still present in V2 · the H7 P3 context-recovery failure was not reproduced · `PRODUCTION_AUTO_RELEASE_ENABLED` and `PRODUCTION_AUTO_ROLLBACK_ENABLED` are `true` today ·
`staging` environment is unprotected · the heuristic customer-agent tripwire is not a boundary · D3.2's V3 tests are **not in CI** (control-plane change needed, 09 refinement 1).

## 4. Explicitly not done in D3.2

No host install or configuration; no Bypass Permissions anywhere; no change to `.claude/settings.json`, hooks, workflows, rulesets, environments, secrets, variables, migrations, V2 code, the H7 P3 task,
or the unrelated `settings-workspace-redesign` checkout; no merge, deployment, production action or purchase; no V3 activation.

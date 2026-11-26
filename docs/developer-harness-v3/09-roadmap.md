# Developer Harness V3 — 09 Roadmap

D3.2 does not implement any later phase. Boundaries below are those in the brief; the only refinements are noted with their repository evidence.

| Phase | Scope | Status |
|---|---|---|
| **D3.1** | Architecture and repository audit | folded into this PR's register (01) because the prior audit was a ChatGPT-side artifact; no separate code |
| **D3.2** | Autonomous authority, deterministic safety and trust bootstrap | **this PR** |
| **D3.3** | Local infrastructure, secure isolation, Resource Governor and Subscription Governor (provisioning, measurement, the isolation suite, calibration, empirical CLI behavior tests) | next, only on owner instruction |
| **D3.4** | Persistent orchestration, model routing, independent reviews, **context management with automatic session renewal at a configurable 70 % default threshold** (durable checkpoint first, graceful stop at a safe boundary, fresh session from optimized context packs, original requirements and remaining work restored, automatic continuation, official telemetry only with a conservative supported fallback, no blind `/clear`; see 08 §2a), issuer processes and key custody, durable ledger | |
| **D3.5** | Self-healing recovery and resource-aware parallel development | implemented, SIMULATED, INACTIVE (24-30); operational default stays one reasoning session |
| **D3.6** | Automatic PR, CI and staging management (reusing the existing publisher, CI Gate, Staging Gate) | |
| **D3.7** | Automatic merging, production releases and recovery (reusing Release Engineer and production workflows; activation is an owner ceremony) | |
| **D3.8** | Telegram bot, local dashboard, autonomous maintenance | |
| **D3.9** | End-to-end validation, security audit and trusted activation (the first time Bypass Permissions may be enabled, only inside the proven VM) | |

## Refinements justified by repository evidence

1. **CI wiring of the V3 test suite is a mandatory control-plane follow-up before activation (target D3.4/D3.6).** V2's CI runner discovers only `scripts/developer-harness-v2/**`, and `.github/workflows/ci.yml` is pinned by a hash in a V2 guard.
   Adding V3 suites requires a human-approved control-plane PR that updates that pin; D3.2 does not touch workflows.
2. **Key custody and issuer processes belong to D3.4**, not D3.3: they depend on the orchestrator's process model.
3. **The Subscription Governor's empirical CLI tests are D3.3 prerequisites** (headless limit behavior is undocumented).
4. **V2 defects found here (R-06) are not patched in D3.2**: V2 stays authoritative and unchanged; V3 supersedes the classification and a separate human-approved V2 fix is optional.

## Mandatory activation prerequisite: V3 in CI

Wiring the V3 test suite into CI is a **mandatory protected control-plane follow-up before V3 activation**. V2's CI runner discovers only `scripts/developer-harness-v2/**` and `.github/workflows/ci.yml` is pinned by a V2 guard, so this needs a human-approved control-plane PR that updates the pin and adds the suite to the protected job. It is recorded in the contract as
`activation_prerequisites` and is **not** done in D3.2 (workflows are out of scope).

## Gates between phases

Each phase ends with an owner review. No phase activates a safeguarded action until D3.9 proves the system end to end; until then V2 plus the existing gates and rulesets remain in force.

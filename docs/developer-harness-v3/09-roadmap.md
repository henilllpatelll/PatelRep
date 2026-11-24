# Developer Harness V3 — 09 Roadmap

D3.2 does not implement any later phase. Boundaries below are those in the brief; the only refinements are noted with their repository evidence.

| Phase | Scope | Status |
|---|---|---|
| **D3.1** | Architecture and repository audit | folded into this PR's register (01) because the prior audit was a ChatGPT-side artifact; no separate code |
| **D3.2** | Autonomous authority, deterministic safety and trust bootstrap | **this PR** |
| **D3.3** | Local infrastructure, secure isolation, Resource Governor and Subscription Governor (provisioning, measurement, the isolation suite, calibration, empirical CLI behavior tests) | next, only on owner instruction |
| **D3.4** | Persistent orchestration, model routing, independent reviews, context management, issuer processes and key custody, durable ledger | |
| **D3.5** | Self-healing recovery and resource-aware parallel development | |
| **D3.6** | Automatic PR, CI and staging management (reusing the existing publisher, CI Gate, Staging Gate) | |
| **D3.7** | Automatic merging, production releases and recovery (reusing Release Engineer and production workflows; activation is an owner ceremony) | |
| **D3.8** | Telegram bot, local dashboard, autonomous maintenance | |
| **D3.9** | End-to-end validation, security audit and trusted activation (the first time Bypass Permissions may be enabled, only inside the proven VM) | |

## Refinements justified by repository evidence

1. **CI wiring of the V3 test suite moves to D3.4/D3.6 as a control-plane change.** V2's CI runner discovers only `scripts/developer-harness-v2/**`, and `.github/workflows/ci.yml` is pinned by a hash in a V2 guard.
   Adding V3 suites requires a human-approved control-plane PR that updates that pin; D3.2 does not touch workflows.
2. **Key custody and issuer processes belong to D3.4**, not D3.3: they depend on the orchestrator's process model.
3. **The Subscription Governor's empirical CLI tests are D3.3 prerequisites** (headless limit behavior is undocumented).
4. **V2 defects found here (R-06) are not patched in D3.2**: V2 stays authoritative and unchanged; V3 supersedes the classification and a separate human-approved V2 fix is optional.

## Gates between phases

Each phase ends with an owner review. No phase activates a safeguarded action until D3.9 proves the system end to end; until then V2 plus the existing gates and rulesets remain in force.

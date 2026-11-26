# Developer Harness V3

Autonomous developer harness for PatelRep, built in phases. **This directory is D3.2: contract, deterministic safety primitives and design. Nothing here is active.**
Developer Harness V2, the existing gates and the rulesets stay authoritative.

| Doc | Content |
|---|---|
| [01-verification-register.md](01-verification-register.md) | verified repository/host/provider facts, audit revalidation, reproduced defects |
| [02-authority-contract.md](02-authority-contract.md) + [authority-contract.json](authority-contract.json) | allowed / safeguarded / prohibited actions, identities, evidence types |
| [03-threat-model-and-trust-boundaries.md](03-threat-model-and-trust-boundaries.md) | zones, threats, required external controls |
| [04-policy-bootstrap-and-promotion.md](04-policy-bootstrap-and-promotion.md) | revision pinning, promotion protocol, owner ceremony |
| [05-local-execution-architecture.md](05-local-execution-architecture.md) | Windows 11 Home local-first design and isolation evaluation |
| [06-resource-governor.md](06-resource-governor.md) | memory/disk/CPU governance |
| [07-subscription-governor.md](07-subscription-governor.md) | subscription-only guard and limit handling |
| [08-task-lifecycle.md](08-task-lifecycle.md) + [task-lifecycle.json](task-lifecycle.json) | persistent task state machine |
| [09-roadmap.md](09-roadmap.md) | D3.1â€“D3.9 |
| [10-d33-handoff.md](10-d33-handoff.md) | owner-only setup, D3.3 prerequisites, remaining risks |
| [11-review-evidence.md](11-review-evidence.md) | independent review findings and remediation |
| [12-d33-implementation.md](12-d33-implementation.md) | **D3.3**: selected VM runtime, components, implemented vs design-only |
| [13-host-calibration.md](13-host-calibration.md) | D3.3 host measurements and calibrated Resource Governor thresholds |
| [14-cli-capability-report.md](14-cli-capability-report.md) | D3.3 official CLI/auth/telemetry verification (live vs documented vs unverified) |
| [15-isolation-acceptance.md](15-isolation-acceptance.md) | D3.3 13-scenario adversarial isolation results on the real VM |
| [16-owner-setup-and-recovery.md](16-owner-setup-and-recovery.md) | D3.3 owner commands, owner-only actions, recovery |
| [17-d34-handoff.md](17-d34-handoff.md) | D3.3 review findings, GO/NO-GO, risks, D3.4 handoff |

Code: `scripts/developer-harness-v3/` (`authority/`, `lifecycle/`, `lib/`, `tests/`). Run the suite (sequential, bounded heap):

```
node --max-old-space-size=1024 --test --test-concurrency=1 scripts/developer-harness-v3/tests/*.test.mjs
```

| Capability | Status after D3.2 |
|---|---|
| Authority contract, evaluator, evidence verifier, migration classifier from Git facts, promotion rules, lifecycle reducer, resource-admission function | **implemented and tested on fixtures** |
| Issuer services, key custody, durable ledger, pinned trusted checkout, schedulers, Telegram, dashboard, automatic merge/release | **design only / not implemented** |
| D3.3: QEMU worker VM + provisioning, egress proxy, samplers, Resource/Subscription Governors, trusted launcher (dry-run), lifecycle/recovery primitives, `bin/dh3.mjs` | **implemented; V3 still inactive** (see 12, 15, 17) |

## D3.4 — persistent orchestration (implemented, INACTIVE)
* [18 architecture and trust boundaries](18-d34-orchestration.md) · [19 issuers and key custody](19-d34-issuers-and-key-custody.md) · [20 provider eligibility](20-d34-provider-eligibility.md) · [21 protected-change proposals, owner procedure, gate register](21-d34-protected-changes.md) · [22 verification evidence](22-d34-verification-evidence.md) · [23 D3.5 handoff](23-d35-handoff.md)
* Proposals: [proposals/](proposals/manifest.json). Retained simulation: [evidence/d34-e2e-simulation-SIMULATED.json](evidence/d34-e2e-simulation-SIMULATED.json). **Runtime activation: NO-GO.**

## D3.5 - self-healing recovery and resource-aware parallel development (implemented, SIMULATED, INACTIVE)
* [24 multi-slot execution and scheduler](24-d35-scheduler-and-concurrency.md) - [25 self-healing recovery, resource interruption, cleanup, engineering recovery](25-d35-self-healing-recovery.md) - [26 ledger disaster recovery](26-d35-ledger-disaster-recovery.md) - [27 lifecycle security and proposal P6](27-d35-lifecycle-proposal.md) - [28 long unattended waits](28-d35-long-unattended-waits.md) - [29 verification evidence and review](29-d35-verification-evidence.md) - [30 D3.6 handoff](30-d36-handoff.md)
* Proposals added: P6 (supersedes P5) and P1v2 (supersedes P1) in [proposals/](proposals/manifest.json). 28 activation gates, none closed. **Runtime activation: NO-GO.**

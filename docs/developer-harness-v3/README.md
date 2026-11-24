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
| [09-roadmap.md](09-roadmap.md) | D3.1–D3.9 |
| [10-d33-handoff.md](10-d33-handoff.md) | owner-only setup, D3.3 prerequisites, remaining risks |
| [11-review-evidence.md](11-review-evidence.md) | independent review findings and remediation |

Code: `scripts/developer-harness-v3/` (`authority/`, `lifecycle/`, `lib/`, `tests/`). Run the suite (sequential, bounded heap):

```
node --max-old-space-size=1024 --test --test-concurrency=1 scripts/developer-harness-v3/tests/*.test.mjs
```

| Capability | Status after D3.2 |
|---|---|
| Authority contract, evaluator, evidence verifier, migration classifier from Git facts, promotion rules, lifecycle reducer, resource-admission function | **implemented and tested on fixtures** |
| Issuer services, key custody, durable ledger, pinned trusted checkout, VM isolation, samplers, schedulers, Telegram, dashboard, automatic merge/release | **design only / not implemented** |

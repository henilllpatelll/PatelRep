# PatelRep Master Strategy

> **PatelRep exists to give people their time back.** AI, integrations, agents, automation, analytics and
> development infrastructure are mechanisms for accomplishing that mission, not the mission itself.

This directory is the version-controlled, long-term strategic source of truth for PatelRep: the company, the product,
the architecture, the customer experience, development priorities and acceptance standards. It is authoritative for
long-term intent; the architecture, roadmap and standards it proposes stay subordinate to the executable contracts
below until reviewed work adopts them.

> **Phase 0 — Strategic Foundation.** Documentation only. Nothing here authorizes implementing, activating, deploying
> or releasing any proposed functionality.
> **Baseline:** repository facts in these documents were checked against `origin/main` @ `90204d83` (2026-11-26);
> statements about live production state are limited to what the repository records.

## Authority and precedence

* **Authoritative for long-term product intent.** When an older description of what PatelRep is for, who it serves or
  where it is going disagrees with this strategy, this strategy states the intended direction, and the older text is
  listed for reviewed correction in the [conflicts register](15-strategic-decision-register.md#9-conflicts-and-recommended-resolutions).
* **Never overrides what is allowed now.** Executable security policies, technical contracts, deployment requirements
  and existing authority controls keep governing behavior: GitHub rulesets and environments, trusted workflows,
  database constraints and RLS, code-level ceilings, the Customer Agent Harness contracts
  ([agent-harness/](../agent-harness/roadmap.md)), Developer Harness V2 and V3 contracts
  ([developer-harness-v2/](../developer-harness-v2/02-architecture-contract.md),
  [developer-harness-v3/](../developer-harness-v3/README.md)), [RELEASE_PROCESS.md](../RELEASE_PROCESS.md),
  [FEATURE_FLAGS.md](../FEATURE_FLAGS.md), [DATABASE_MIGRATIONS.md](../DATABASE_MIGRATIONS.md) and the routing and
  authority rules in [`CLAUDE.md`](../../CLAUDE.md). The full model is in
  [13 §2](13-security-privacy-and-governance.md#2-how-authority-works).
* **Changes go through the register.** A strategic decision changes only by a reviewed pull request that updates the
  [decision register](15-strategic-decision-register.md#10-change-process).

## Status vocabulary

Decision status and implementation status are kept separate.

| Decision status | Meaning |
|---|---|
| **Founder-approved** | Decided by the founder; recorded with an `FD-` identifier |
| **Proposed** | Introduced by this strategy for review; not yet decided (`PA-`, milestones) |
| **Open** | A decision that must be made, with no recommendation adopted yet (`OC-`, `TD-`) |

| Implementation status | Meaning |
|---|---|
| **Active** | Implemented on `main` and in use by default where deployed |
| **Inactive** | Implemented on `main` but default-disabled, flag-gated, not deployed, or refused in production by code |
| **Designed** | A contract or design exists; nothing executes |
| **Future** | Intended; not yet designed |

Claims about capabilities follow the stricter ladder implemented ≠ tested ≠ merged ≠ enabled ≠ exercised ≠
production-verified ([14 §4](14-development-and-acceptance-standards.md#4-status-vocabulary-for-every-claim)).

## Document map

| # | Document | What it answers |
|---|---|---|
| 01 | [Company vision](01-company-vision.md) | Mission, brand promise, the problem, market, the balance PatelRep keeps |
| 02 | [Product constitution](02-product-constitution.md) | The fifteen permanent product decisions, capability domains, experience and truthfulness principles |
| 03 | [Master product roadmap](03-master-product-roadmap.md) | Sixteen workstreams, dependencies, milestones, gates and risks |
| 04 | [Platform architecture](04-platform-architecture.md) | Logical foundations, where they live today, flows, topology, roles |
| 05 | [Integration strategy](05-integration-strategy.md) | PatelRep Connect: authorized connectivity to existing hotel software |
| 06 | [AI and autonomy strategy](06-ai-and-autonomy-strategy.md) | Autonomy levels and boundaries, Ask PatelRep, delegation, model strategy |
| 07 | [Adaptive intelligence](07-adaptive-intelligence.md) | Capability readiness declarations, states and deterministic checks |
| 08 | [Data intelligence strategy](08-data-intelligence-strategy.md) | Ingestion, provenance, quality, knowledge, prediction, data-use boundaries |
| 09 | [Performance & Impact Engine](09-performance-and-impact-engine.md) | Hours Returned, evidence classes, metric registry, improvement cycle |
| 10 | [Employee protection policy](10-employee-protection-policy.md) | What PatelRep must never do to the people who use it |
| 11 | [Commercial strategy](11-commercial-strategy.md) | One all-inclusive subscription, cost tracking, open pricing decisions |
| 12 | [Customer pilot strategy](12-customer-pilot-strategy.md) | The founder-hotel pilot: baselines, evaluation, expansion and rollback |
| 13 | [Security, privacy and governance](13-security-privacy-and-governance.md) | Preserved boundaries, principles for new foundations, governance |
| 14 | [Development and acceptance standards](14-development-and-acceptance-standards.md) | Strategy Fit Record, acceptance, evaluation, rollout ladder |
| 15 | [Strategic decision register](15-strategic-decision-register.md) | Every decision, dependency, status and conflict, with identifiers |

**Reading order.** Leaders: 01 → 02 → 03 → 11 → 12. Engineers: 02 → 04 → 07 → 06 → 13 → 14. Everyone working on
workforce features also reads 10.

## Glossary

| Term | Meaning in this strategy |
|---|---|
| **Hours Returned** | The North Star metric: time PatelRep measurably gives back to people, net of time it adds ([09 §2](09-performance-and-impact-engine.md#2-hours-returned-the-north-star)) |
| **Capability domain** | One of Operations, People, Guest, Growth, Owner, Connect; an organizing unit, never a separately sold module ([02 §3](02-product-constitution.md#3-capability-domains-fd-34)) |
| **PatelRep Workspace** | The one role-adaptive application on web and mobile ([04 §6](04-platform-architecture.md#6-patelrep-workspace-and-roles)) |
| **Ask PatelRep** | Universal conversational access, delegation and follow-up ([06 §5](06-ai-and-autonomy-strategy.md#5-ask-patelrep)) |
| **PatelRep Connect** | The integration framework (platform foundation). Distinct from the `connect` agent product family in H8 ([05](05-integration-strategy.md)) |
| **Capability readiness** | A capability's declared requirements and its computed state: full, partial, stale, insufficient history, restricted, unavailable or inactive ([07](07-adaptive-intelligence.md)) |
| **Customer Agent Harness (H0–H8)** | Customer-facing AI execution and governance ([agent-harness/roadmap.md](../agent-harness/roadmap.md)) |
| **Developer Harness (V2, V3)** | Tooling for changing the repository; V2 authoritative, V3 inactive until activated ([developer-harness-v3/09-roadmap.md](../developer-harness-v3/09-roadmap.md)) |
| **Autonomy levels 1–4** | Observe, human-approved, bounded, coordinated (`apps/api/services/agent_harness/vocabulary.py`) |
| **Evidence class** | Measured, estimated, financially realized or potential opportunity; a figure whose inputs are missing is `unavailable`, a readiness state rather than a class ([09 §3](09-performance-and-impact-engine.md#3-evidence-classes)) |
| **Strategy Fit Record** | The thirteen-item record proposed for every implementation (PA-14, [14 §3](14-development-and-acceptance-standards.md#3-the-strategy-fit-record)) |
| **Founder / repository owner** | The founder, who owns the repository and makes control-plane, activation and commercial decisions |
| **Hotel owner** | A customer: the owner of a property or portfolio, served by the Owner capability domain |

## Relationship to other planning documents

Component-level roadmaps stay authoritative for their own scope: the Customer Agent Harness
([agent-harness/roadmap.md](../agent-harness/roadmap.md), [agent-harness/h7-rollout-plan.md](../agent-harness/h7-rollout-plan.md)),
Developer Harness V2 ([04-phase-roadmap-and-acceptance.md](../developer-harness-v2/04-phase-roadmap-and-acceptance.md))
and V3 ([09-roadmap.md](../developer-harness-v3/09-roadmap.md)). The [master roadmap](03-master-product-roadmap.md)
sequences them with the product workstreams and does not redesign them. Older planning material in `.planning/` and at
the repository root is historical context; overlaps are listed in the
[conflicts register](15-strategic-decision-register.md#9-conflicts-and-recommended-resolutions).

## Maintaining this strategy

* Verify facts against `main` and update the baseline line when a document is revised.
* Keep one home document per concept; link instead of copying.
* Keep every file under 500 lines with repository-relative links.
* Adoption into instructions and automated governance is a separate reviewed follow-up
  ([14 §10](14-development-and-acceptance-standards.md#10-adoption-plan-recommended-follow-up-not-performed-in-this-pr)).

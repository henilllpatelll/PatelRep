# 13 — Security, Privacy and Governance

> **Status:** Preservation of every existing boundary is founder-approved (FD-24, FD-26, FD-39 in the
> [decision register](15-strategic-decision-register.md#1-founder-approved-decisions)). Principles for new foundations
> are **proposed**. This document changes no policy, contract, workflow, ruleset, permission or credential.
> **Baseline:** `origin/main` @ `90204d83` (2026-11-26). **Authority:** [README § Authority and precedence](README.md#authority-and-precedence).

## 1. Purpose

PatelRep's strategy asks for more connectivity, more intelligence and more autonomy. Each of those increases what can
go wrong. This document records the security boundaries that already exist and must not weaken, the principles every
new foundation must satisfy, and how strategic and security decisions are governed.

## 2. How authority works

Two kinds of authority apply at once and neither overrides the other:

* **Product intent** (what PatelRep is for and where it is going): this strategy is authoritative.
* **What is allowed now** (who may do what, which code may run, how changes reach production): executable
  enforcement and technical contracts are authoritative, in this order of strength:

| Layer | Examples | Strength |
|---|---|---|
| L0 GitHub server-side | `main` ruleset (CI Gate + Staging Gate, no bypass), environments, required reviewers | Authoritative |
| L1 Trusted workflows and the database | Publishers, provenance checks, Database Migration Gate, production target guards, RLS, DEFINER RPC guards and triggers | Authoritative for what they guard |
| L1 Code ceilings | `H0_EXECUTION_SUPPORTED = False`, `POLICY_AUTONOMY_CEILING = HUMAN_APPROVED`, production refusals in harness code | Authoritative until changed by a reviewed PR |
| L2 Local developer harness | Developer Harness V2 policy hook and bypass scopes | Defense in depth |
| L3 Instructions | `CLAUDE.md`, `AGENTS.md`, skills, memory | Guidance, never relied on as enforcement |

The layer model extends the one Developer Harness V2 uses
([developer-harness-v2/02-architecture-contract.md §5](../developer-harness-v2/02-architecture-contract.md)) with
the database and code-ceiling rows. When the
strategy and a lower-layer contract disagree, the contract keeps governing behavior until a reviewed change updates it;
the disagreement is recorded in the [conflicts register](15-strategic-decision-register.md#9-conflicts-and-recommended-resolutions).

## 3. Boundaries preserved unchanged

| Boundary | Mechanism | Defined in |
|---|---|---|
| Tenant isolation | Every API query filters by `hotel_id`. The API connects with the Supabase service role, which bypasses RLS, so scoping in code is the enforcement for API paths; RLS (migrations 016, 035) protects direct client access; an agent worker would run as a least-privileged role bound to one hotel | [`CLAUDE.md`](../../CLAUDE.md) conventions, [agent-harness/security.md §2](../agent-harness/security.md) |
| Identity and roles | Supabase JWT carrying `hotel_id` and the application role in the `user_role` claim (migration 019 hook, corrected by migration 053); `get_current_user()`; `require_role(*roles)`; six canonical roles in `apps/api/core/roles.py` | [`CLAUDE.md`](../../CLAUDE.md), `apps/api/middleware/auth.py` |
| Release control | Tenant-scoped, fail-closed flags; deploy ≠ release; hotels cannot enable their own unreleased features | [FEATURE_FLAGS.md](../FEATURE_FLAGS.md) |
| Agent authorization | Default-deny policy, explicit capability→role grants, trusted identity, digest-bound single-use approvals | [agent-harness/security.md](../agent-harness/security.md), [agent-harness/contracts.md](../agent-harness/contracts.md) |
| Agent execution | Durable runs, fenced leases, Tool Gateway with exact `(tool, version)` bindings, database-side approval guards | [agent-harness/durable-execution.md](../agent-harness/durable-execution.md), [agent-harness/tool-gateway.md](../agent-harness/tool-gateway.md) |
| Agent identity | A least-privileged `agent_worker` role (255) bound to one hotel and environment (261), which no deployed worker holds yet; migration 262 adds database-verified human-identity helpers that are inactive (the probe is off and unrouted, decide v2 has no EXECUTE grant), so active control writes still rely on API-verified identity | [agent-harness/worker-identity.md](../agent-harness/worker-identity.md), [agent-harness/h7-p2-verified-identity.md](../agent-harness/h7-p2-verified-identity.md) |
| Agent audit and approvals | Append-only audit integrity and database-enforced independent approval (254) | [agent-harness/pre-h6-security-hardening-230-231.md](../agent-harness/pre-h6-security-hardening-230-231.md) |
| Agent spend and billing | Atomic provider-spend reservations (H3); customer billing default `disabled`, Stripe test mode only (H4) | [agent-harness/orchestrator.md](../agent-harness/orchestrator.md), [agent-harness/customer-billing.md](../agent-harness/customer-billing.md) |
| Emergency stops | Platform pause, cost stop, hotel/agent/tool pause, credential revocation, kill switches | [agent-harness/security.md](../agent-harness/security.md), [agent-harness/adr-0006-h7-bounded-autonomy.md](../agent-harness/adr-0006-h7-bounded-autonomy.md) |
| Developer vs customer agents | Developer agents may never activate customer execution, grants, decide-v2 or billing | [developer-harness-v2/02-architecture-contract.md §6](../developer-harness-v2/02-architecture-contract.md) |
| Developer Harness V3 | Inactive; activation only after every gate in the register is closed (D3.9 owner ceremony); V2 authoritative until then | [developer-harness-v3/21-d34-protected-changes.md §5](../developer-harness-v3/21-d34-protected-changes.md) |
| Delivery | CI Gate and Staging Gate on the exact head; human merge; Production Release as a separate decision; Release Engineer as the only repair path. The one narrow exception is the Release Engineer recovery path (auto-merge of eligible recovery PRs, an automatically requested release when the owner has enabled it, automatic rollback under its policy) | [RELEASE_PROCESS.md](../RELEASE_PROCESS.md), [AUTONOMOUS_RELEASE_ENGINEER.md](../AUTONOMOUS_RELEASE_ENGINEER.md) |
| Migrations | Forward-only; never edit history; destructive-SQL guard; security-sensitive migrations need a reviewed staging preview | [DATABASE_MIGRATIONS.md](../DATABASE_MIGRATIONS.md), [STAGING_REVIEWED_MIGRATION_PREVIEW.md](../STAGING_REVIEWED_MIGRATION_PREVIEW.md) |
| Credentials | Adapters own provider credentials; credentials never enter model context, tool arguments, traces or audit metadata; production and publisher credentials are never exposed to coding agents | [agent-harness/architecture.md §7](../agent-harness/architecture.md), [`CLAUDE.md`](../../CLAUDE.md) |
| Environments | Isolated development, staging and production configuration; integrations disabled without a dedicated sandbox | [ENVIRONMENTS.md](../ENVIRONMENTS.md) |

## 4. Security principles for the new foundations

| Foundation | Principal risks | Required controls before activation |
|---|---|---|
| PatelRep Connect ([05](05-integration-strategy.md)) | Credential theft; over-broad scopes; hostile payloads; acting in the wrong tenant; silent overwrites of the source of truth | Per-tenant credentials held by the adapter; least-privilege scopes; revocation and rotation; signed-webhook verification; integration payloads treated as untrusted input; per-provider rate and cost limits; external writes only through reviewed operations and the harness |
| Data Intelligence ([08](08-data-intelligence-strategy.md)) | Cross-tenant leakage; re-identification; stale or wrong data driving decisions | Tenant-keyed storage under RLS; provenance on derived facts; quality and freshness checks feeding readiness; no cross-tenant joins without an authorized aggregate path |
| Capability Readiness ([07](07-adaptive-intelligence.md)) | Readiness mistaken for authorization; fail-open evaluation | Readiness never grants authority; evaluation failure resolves to `unavailable` |
| Performance & Impact ([09](09-performance-and-impact-engine.md)) | Metrics used for surveillance or discipline; inflated claims | Person-level visibility rules in the registry; evidence classes on every figure; employee protection review |
| Ask PatelRep ([06 §5](06-ai-and-autonomy-strategy.md#5-ask-patelrep)) | Prompt injection; permission leaks through retrieval; actions taken from conversation | Permission filter before retrieval; untrusted-content handling for SOPs, guest text and integration data; actions only as harness proposals; sensitive payloads off in traces |
| Memory (H8) | Persistent injection; cross-user leakage | Scoped, visible, deletable memory treated as data; never a source of authority |
| New roles and portfolio tenancy ([04 §6](04-platform-architecture.md#6-patelrep-workspace-and-roles)) | Privilege escalation across hotels | Reviewed RBAC and JWT-claim changes, cross-hotel tests, security review (TD-08, TD-09) |

## 5. Privacy principles

1. **Access is not ownership.** PatelRep's access to customer information does not imply ownership or unrestricted
   secondary use (FD-29).
2. **No automatic model training** on customer information, and **no automatic cross-customer benchmarking**; any
   such use needs explicit, documented authorization ([08 §7](08-data-intelligence-strategy.md#7-customer-data-use-boundaries)).
3. **Minimization and purpose limitation.** Collect what a capability needs, use it for that purpose, and declare it
   in the capability's readiness declaration.
4. **Employee data is sensitive by default.** Schedules, availability, leave, performance and voice inputs follow
   [10](10-employee-protection-policy.md).
5. **Guest data is minimal.** PatelRep does not build guest-facing platforms (FD-06); guest information arriving
   through integrations is limited to what operations need and is treated as untrusted input.
6. **Retention and deletion are explicit.** Today: the `logbook.cleanup-expired` job **archives** expired logbook
   entries (it does not hard-delete them, although `CLAUDE.md` and migration `0201_logbook_expires.sql` describe
   deletion); lost-and-found items are flagged for manager review after 90 days and never disposed automatically;
   controlled documents carry retention classes and legal-hold metadata without a purge job; AI logs, guest messages,
   PMS reservations and status history have no retention rule; no tenant offboarding, erasure or data-export path
   was found. New data classes declare a retention rule before release, and the gaps are recorded in
   [CF-26](15-strategic-decision-register.md#9-conflicts-and-recommended-resolutions).
7. **Subprocessors are known.** Data flows to model providers, payments, messaging, email, hosting and mobile
   distribution are documented per capability. Provider data-handling terms are verified, not assumed (ED-07): the
   harness OpenAI adapter requests no storage (`store=False`), while the legacy AI paths have no documented
   retention configuration.
8. **Existing boundary to keep.** Guest SMS messages are stored with `excluded_from_ai = true` (migration 072); any
   future AI path that reads guest communications must honor it.

## 6. AI governance

* Evaluation gates before release ([14 §6](14-development-and-acceptance-standards.md#6-evaluation-requirements-for-ai-features)).
* Effect-based risk classification and human authority for financial, personnel, safety and guest-facing effects
  ([06 §4](06-ai-and-autonomy-strategy.md#4-effect-based-risk-boundaries)).
* Cost governance: actual-usage metering, pre-flight allowance checks before paid calls, atomic spend reservations.
* Audit: every agent attempt, approval and execution recorded append-only; tracing with sensitive payloads off.
* Human oversight surfaces: the AI Control Center (H6, default disabled) is the governance view for agents.

## 7. Integration governance

Integration access, consent and credential rules are defined once in [05 §2](05-integration-strategy.md#2-principles)
and [05 §9](05-integration-strategy.md#9-security-and-authorization-for-integrations) (FD-27, FD-28). Governance adds
one requirement: every connection's authorization, scopes and revocation path are reviewable by the founder.

## 8. Governance process

| Decision type | Where it is decided | Who decides |
|---|---|---|
| Strategic intent and founder decisions | [Decision register](15-strategic-decision-register.md) in a reviewed PR | The founder |
| Architecture | ADRs beside the component (pattern: `docs/agent-harness/adr-*`) | Reviewed PR; security review when classified sensitive |
| Security-sensitive change | Agent harness, migrations, auth, billing, control plane, agent instructions and hooks | Independent security review, human merge |
| Pricing policy (H4) | Versioned two-person pricing policies | Two operators, after the product decision |
| Activation | Explicit, separate request per activation | The founder as repository owner |
| Developer Harness V3 root of trust | Owner ceremonies | The founder as repository owner |

This strategy is reviewed at least quarterly and after each pilot phase; changes follow
[15 §10](15-strategic-decision-register.md#10-change-process).

## 9. Compliance considerations (to be assessed; nothing is claimed today)

Formal security attestations, payment-card scope, applicable privacy laws for hotel, employee and guest data,
employment law for workforce features, and accessibility obligations are assessed with qualified advisers before
the commercialization workstream ([03](03-master-product-roadmap.md)). No certification or compliance status is
claimed by this strategy. No customer-facing privacy policy or terms of service exist in the repository today; both
are prerequisites for commercialization (W16).

## 10. Incident response and recovery

Production incidents follow [PRODUCTION_RUNBOOK.md](../PRODUCTION_RUNBOOK.md) (feature problems, web, API and database
failures, rollback evidence, re-entry). Product features are disabled through their flags; agent execution through the
harness emergency stops. A strategy-level incident (a prohibited outcome from [10 §2](10-employee-protection-policy.md#2-prohibited-outcomes),
a misleading impact claim, an unauthorized integration) is handled with the same discipline: stop, notify, fix, record.

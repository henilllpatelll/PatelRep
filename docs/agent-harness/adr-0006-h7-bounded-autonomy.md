# ADR-0006: H7 bounded autonomy (level 3)

Status: **proposed** (H7 Phase 1: architecture and security contracts only). Nothing in this ADR is implemented.
No migration, executable tool, worker path, flag or grant is added by Phase 1. Level 3 stays unreachable in code
(`POLICY_AUTONOMY_CEILING = HUMAN_APPROVED`), in the database (`agent_tool_grants.max_level CHECK (1, 2)`) and in the
manifest (schema v1 cannot declare a low-risk write). `tests/smoke/test_agent_h7_autonomy_contracts.py` pins all three.

Baseline: `origin/main` `961a012b` (H0–H6 merged, including migration 261 / PR #241).

Companion documents: [h7-authorization-contract.md](h7-authorization-contract.md) (evidence matrix, manifest v2,
grants, enforcement algorithm), [threat-model-h7.md](threat-model-h7.md) (H6 residuals A–G, new threats),
[risk-model-h7.md](risk-model-h7.md) (effect classification), [h7-rollout-plan.md](h7-rollout-plan.md) (Phases 2–8,
migrations).

## 1. Context (verified in code, not assumed)

* Every write the harness can perform today (`engineering.work_orders.assign` v2, `housekeeping.room_assignments.assign`
  v1) needs a server-recorded, single-use, digest-bound human approval. The database enforces this twice: in the
  write RPC (`agent_tool_execute_work_order_assign`, 243; `agent_tool_execute_room_assignment`, 253) and in the 254
  BEFORE INSERT trigger `agent__guard_execution_approval` on `agent_tool_executions`.
* The H0 autonomy contract (`services/agent_harness/autonomy.py`) already models level 3 as "low risk, operational, no
  human-authority consequence", and caps every write at level 2 through `requires_human_authority()`.
* The worker runs as `agent_worker` (255), bound to one hotel and one stamped environment (261); it cannot decide
  approvals, change controls or write any table directly.
* Open draft advisories: GHSA-frh4 (control-write actor is caller-asserted), GHSA-xm55 (approval decisions made outside
  the RPC are not audited), GHSA-98wq (TRUNCATE on non-agent tables). frh4 is the blocker: an autonomy grant is the
  most powerful control write the harness will have, so its issuer must be proven by the database, not asserted by the
  API.

## 2. Decisions

### D1. Definition of level 3

Level 3 ("bounded") is a narrowly scoped, explicitly granted, **low-risk, operational, internal** write that executes
without a per-action approval. It is:

* **default deny**: no grant → observe only; any missing, stale, malformed or unverifiable input → refuse;
* **never wildcard**: one hotel × one agent version × one tool version × an explicit resource scope;
* **never high-risk**: financial, personnel, guest-facing, safety, PMS, security or emergency effects can never be
  level 3 (risk-model-h7.md);
* **never self-extending**: a grant cannot enable a disabled worker, platform switch, entitlement, paid calls, billing
  or another tool. It is one more necessary condition, never a sufficient one;
* **delegation depth 0**: an agent acting under a grant can never create, widen or pass on a grant (H8 may add scoped
  delegation; the H7 schema reserves the columns with `CHECK` constraints that force depth 0).

### D2. Manifest schema v2 beside v1

A new `patelrep.agent-manifest/v2` (agent) and tool contract v2, validated deterministically in code and pinned by
digest in the database. v1 classes, the v1 schema string and every existing version stay byte-for-byte unchanged;
v2 never re-interprets a v1 manifest. Risk, effect type and consequence come from the **reviewed capability catalog**
and the **database-side tool spec**, never from a model, a request or a manifest field the model can influence; a v2
tool whose declared risk is lower than its capability's floor fails validation. Full rule set:
h7-authorization-contract.md §3.

### D3. Durable autonomy grants in a new table

Level 3 is represented in a new `agent_autonomy_grants` table, **not** by widening `agent_tool_grants.max_level`
(which stays `CHECK (max_level IN (1, 2))`). Each grant records issuer, issuer role, the database-verified issuance
proof, issuance time, mandatory expiry (≤ 30 days), resource scope, quotas, manifest and policy digests, status and
revocation. Consumption is recorded in an append-only ledger. Issuance is possible **only** through a SECURITY DEFINER
RPC executable by the `authenticated` role whose actor is `auth.uid()` from the PostgREST-verified human JWT (D5);
`service_role` and `agent_worker` can never issue. Any principal with authority (and `service_role`, operator CLI)
may **revoke**, because revocation only removes authority.

### D4. The database is the final enforcement point

Python policy (`policy.evaluate`) remains a pre-check and explanation layer; an `allow` from Python never authorizes a
write. Each level-3 tool version gets exactly one fenced, atomic SQL RPC that, in one transaction and in a fixed lock
order, validates lease fence, controls, autonomy switches, grant, quota, tenant, resource ownership and freshness,
action digest and idempotency, performs the domain change through the shared domain operation, records the execution,
the grant consumption and the audit event. The 254 execution guard is extended by a new forward function so that a
succeeded write must carry **either** a valid approval **or** a valid grant consumption written in the same
transaction; the approval branch is not relaxed. Lock order and the revocation linearization point:
h7-authorization-contract.md §5.

### D5. Human identity provenance at the PostgreSQL boundary (prerequisite, Phase 2)

Before any grant table exists, the database must be able to prove which human issued a control write. Chosen
mechanism: issuance RPCs are executed **with the human's own Supabase access token** through PostgREST (role
`authenticated`), are SECURITY DEFINER with `search_path = ''`, derive the actor from `auth.uid()` (never a parameter),
re-read the actor's single active role in the token's hotel (`agent__human_authority … FOR SHARE`), and require a
fresh token (`iat` within a short step-up window). The API forwards the user's bearer token for these calls only; it
cannot mint one. This closes GHSA-frh4 for the new grant path and is the pattern later reused for approval decisions.

### D6. Emergency controls are preserved and become linearizable

Platform pause, cost emergency stop, hotel pause, agent pause, tool pause, worker credential revocation, the
`REVOKE agent_worker FROM authenticator` kill switch, the H6 process/env gates and per-grant revocation all keep
working unchanged and every one of them refuses level-3 work. New: a platform autonomy switch (default off) and a
per-hotel autonomy state row that every stop path locks, so a stop that commits is observed by every later level-3
transaction, and a stop that is waiting blocks until in-flight transactions finish (h7-authorization-contract.md §6).

### D7. Shadow mode precedes live execution

The first level-3 tool runs in shadow mode (decide and record "would act", never write) on staging before any live
write is considered. Live execution and production remain separate human decisions.

## 3. Alternatives considered

| Option | Verdict |
|---|---|
| Widen `agent_tool_grants.max_level` to 3 | Rejected. Mixes per-action-approved and unapproved authority in one row; the existing grant RPC trusts a caller-asserted GM (frh4); no room for scope, quota, digests or issuance proof without rewriting a reviewed table. |
| Allow 254's existing low-risk self-approval branch to stand in for autonomy | Rejected. It still needs a human decision per action, and it is an approval semantics, not a grant. H7 must not rely on it (threat-model-h7.md G2). |
| Python-only gate (feature flag + `evaluate` allow) | Rejected. Python is not a transactional authority; revocation, quotas and stale facts must be checked in the same transaction as the write. |
| Per-request signed assertion minted by the API (HMAC) | Rejected for issuance: the API would hold the signing key, so a compromised API could still mint assertions. Acceptable only as a later defence-in-depth layer. |
| Human token via PostgREST (`auth.uid()`) for issuance | **Chosen** (D5). The database verifies the signature itself; the API never sees a reusable secret beyond the user's own short-lived token. |
| Generic "autonomous execute" RPC taking a tool name | Rejected. Same reason as H2: one reviewed RPC per tool version, so a typo or a model can never reach an arbitrary operation. |
| Model-suggested risk or effect classification | Rejected. Risk is a reviewed property of the capability and the DB spec. |

## 4. Why the existing stack is retained; why new orchestration frameworks are deferred

* The guarantees H7 needs (atomic grant checks, revocation linearization, idempotency, tenant isolation, audit) are
  **database transaction properties**. PostgreSQL + the H1 durable execution tables + pgmq + the H2 gateway already
  provide them and are covered by real-database concurrency and crash tests. A new orchestrator (Temporal, LangGraph,
  a vendor agent runtime, Vercel/eve workflows) would add a second source of truth for run state and a second
  privilege boundary, without removing the need for the database checks.
* The worker identity (255/261) is the narrowest principal we have; any new framework would need its own credential
  and reviewed surface.
* The H3 planner (OpenAI Agents SDK behind `BudgetedModel`) stays the only model-facing layer, and level 3 tools take
  closed-enum arguments only, so model choice is not on the authorization path.
* Revisit when H8 needs long-running multi-agent coordination; any adoption must keep the database as the final
  authority and pass the same contract tests.

## 5. Trade-offs

* Issuance with the human's own token adds an API plumbing path (forwarding the bearer for one RPC) and a step-up UX;
  in exchange the most powerful control write is no longer API-trusted.
* Fixed lock ordering with FOR SHARE on control and grant rows serialises revocations behind in-flight level-3
  transactions (bounded by `statement_timeout`); a revoke can wait up to that bound.
* Closed-enum arguments sharply limit what level-3 tools can express; that is the point.
* Two classes of grant (`agent_tool_grants` and `agent_autonomy_grants`) is more schema, but each stays simple and
  separately reviewable.

## 6. Consequences

* H7 Phases 2–8 follow h7-rollout-plan.md; each migration is forward-only, reviewed, and reaches persistent staging
  only through the reviewed preview path when the guard classifies it as destructive.
* The contract tests in `test_agent_h7_autonomy_contracts.py` must be updated in the same PR that deliberately
  changes any pinned item (executable set, agent set, ceilings, grant levels, manifest schemas).
* Production activation, worker deployment, credential issuance, paid calls and billing remain separate,
  explicit human decisions and are not implied by any H7 phase.

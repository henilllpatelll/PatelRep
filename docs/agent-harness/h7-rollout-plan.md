# H7 rollout plan: Phases 2–8 and anticipated migrations

Status: Phase 1 plan. **No migration exists for any phase below.** Numbers are provisional (next free number at
`961a012b` is 262) and are assigned only when a phase starts, after re-checking `main` (avoid the #239 → 261
renumbering). Every migration is forward-only; none edits a historical migration or the migration history.

## 1. Dependency graph

```
P1 contracts (this PR)
  │
  ├─▶ P2 DB-verified human provenance + H6 residual fixes (A, E-tests, F) ──┐
  │                                                                         ▼
  ├─▶ P4 manifest v2 (code only, inert) ─────────────────────────▶ P5 enforcement RPC + first L3 tool (disabled)
  │                                                                         ▲          │
  └──────────────▶ P3 autonomy schema (grants, ledger, quotas, state) ──────┘          ▼
                          │                                                  P6 shadow mode (staging)
                          └─▶ P7 durable notification outbox + review records + Control Center grant UI
                                                                                       │
                                                       P6 + P7 ───────────────────────▶ P8 staging rehearsal,
                                                                                         chaos tests, readiness review
```

P3 depends on P2 (issuance needs provenance). P5 depends on P3 and P4. P8 depends on P5–P7. Production activation is
**not** a phase: it is a separate human decision after P8.

## 2. Phases

| Phase | Deliverable | Migration? | Exit criteria |
|---|---|---|---|
| P2 | `authenticated`-executable DEFINER issuance pattern (`auth.uid()` + live `auth.sessions` row + current role; `iat` recorded as metadata only) and a step-up design proposal (MFA/AAL or a re-authentication challenge; stays deferred until approved), applied first to a no-op probe RPC and to approval decide v2 behind a flag; real-DB test of residual E (pause/revoke race on level 2); fix F (credential journal tenant scope / redaction); xm55 tool-event for out-of-RPC decisions | yes (262) | frh4 closed for new paths; E characterised by test; F fixed and tested; step-up decision recorded (or explicitly still deferred) |
| P3 | `agent_autonomy_platform_state` (default disabled), `agent_autonomy_tenant_state`, `agent_autonomy_grants`, `agent_autonomy_consumptions`, `agent_autonomy_quota_counters`, issuance/revoke RPCs, journal triggers, registry + privilege matrix; **no executor** | yes (263) | no role but the functions can write; issuance refuses `service_role`; revocation linearization test (no executor yet: lock-holder simulation); a production-stamped DB refuses issuance (`step_up_required`); quota-counter first-use concurrency test |
| P4 | `AgentSpecV2`/`ToolSpecV2`, effect enum, risk floors, digests, validation; v1 untouched | no | v1 contract tests unchanged; v2 cannot register a medium+ or human-authority tool as `bounded_grant` |
| P5 | `agent__autonomy_tool_spec` (DB authority for bounded-grant mode, disjoint from `agent__gateway_tool_spec`) + digests for candidate 1; bounded admission RPC (server-derived run key through the unchanged `agent_run_admit`); `agent_tool_execute_<tool>_bounded` RPC (contract §5 lock order); 254 guard replaced (exactly one of approval or bound consumption; consumption inserted first; deferred orphan check); worker wrapper #24 + Python mirror; policy L3 branch behind a code constant still `False` | yes (264, plus the domain table for the candidate) | the 12 tests in contract §5.5 plus crash, stale-fact and cross-tenant real-DB tests; executable set unchanged until the constant flips in a reviewed PR |
| P6 | Shadow mode: worker records `autonomy_would_act` events, never calls the write RPC | maybe (265: event types) | staging shadow run on a seeded hotel with human review of decisions |
| P7 | API-side durable notification outbox (closes L3), review-record surface, Control Center grant issue/revoke UI (issue path uses the user's own token) | yes (266) | outbox tests: a row exists iff the effect committed, none on replay, leased at-least-once redelivery after a dispatcher crash, dead letter after N attempts, idempotent consumer; UI never offers what the backend refuses |
| P8 | Staging rehearsal with a credentialed staging worker (separately approved), chaos tests (revoke/pause mid-transaction, lease loss, crash after commit), readiness review | no | written readiness report; production remains a separate decision |

## 3. Anticipated migrations

| # | Intended schema / functions | Privilege & tenant boundary | Preconditions | Postconditions | Review & rollout | Rollback / forward recovery |
|---|---|---|---|---|---|---|
| 262 (P2) | DEFINER helper `agent__verified_human()` (reads `auth.uid()` and `session_id`, checks a live `auth.sessions` row, re-reads `user_profiles`/`user_roles` FOR SHARE; `iat` metadata only); approval decide v2; credential journal tenant fix | EXECUTE to `authenticated` only for the v2 entry points; none to `service_role`/`agent_worker`; hotel from the verified token, cross-checked | 261 recorded; 254/258/259/260/261 function digests match | privilege violations 0; journal for new credential rows carries the bound tenant; schema contract updated | likely non-destructive → Staging Candidate auto-apply; if it carries TRUNCATE triggers → reviewed preview registry PR + human approval | forward-only; disable by revoking EXECUTE in a follow-up migration; old H2 decide path unchanged |
| 263 (P3) | 5 autonomy tables (quota counters keyed by binding + window kind + window start + resource key) + issuance/revoke/read RPCs + triggers (append-only, TRUNCATE refusal, update guards, journal) | `service_role`: SELECT only (+ revoke RPC); `authenticated`: issuance/revoke RPCs only; `agent_worker`: nothing yet; every row tenant-keyed with tenant-consistent FKs; RLS on | 262 recorded and its digest pinned | registry 35 → 40 tables; violations 0; platform switch row exists and is `false`; no grant rows | destructive-reviewed (TRUNCATE keyword) → reviewed preview + fresh restore-verified staging backup + human approval | forward-only; kill: platform switch stays false; tables never dropped |
| 264 (P5) | `agent__autonomy_tool_spec` (owner-only, IMMUTABLE; digests; disjointness postcondition with `agent__gateway_tool_spec`), bounded admission RPC, candidate domain table/column, shared domain function, `agent_tool_execute_*_bounded`, `agent_tool_executions.autonomy_consumption_id` (nullable, composite FK, UNIQUE), deferred consumption constraint trigger, replaced 254 guard (approval branch unchanged, swapped in the same txn), worker wrapper | wrapper EXECUTE to `agent_worker` only with 261 tenant check; INVOKER RPC; no new `service_role` table writes | 263 recorded; platform switch false | 24 wrappers; violations 0; guard refuses a succeeded write with neither or both of approval and consumption | destructive-reviewed likely → reviewed preview | forward-only; revoke wrapper EXECUTE or keep platform switch false |
| 265 (P6) | journal / tool event type extensions for shadow decisions | no new privilege | 264 recorded | closed event type lists extended | non-destructive expected | forward-only |
| 266 (P7) | notification outbox (written in the execution txn; `UNIQUE (execution_id, kind)`; leased at-least-once delivery by the API, dead letter), review records | worker: insert only via the execute RPC; API: claim/deliver RPC; tenant-keyed | 264 recorded | outbox rows only created inside execute RPCs | per guard classification | forward-only |

Existing protections that apply unchanged: CI Gate (smoke + real-DB integration + Database Migration Gate +
`scripts/schema-contracts.sql`), the destructive-SQL guard, Staging Candidate (auto-applies only non-destructive
migrations), `staging-reviewed-migration-preview.yml` (registry on `main`, exact PR/SHA/digest pins, human approval),
staging backup + restore verification. H7 does not modify any workflow or the registry.

## 4. Never implied by any phase

Worker deployment, worker credential issuance, `APP_ENV=production` execution, paid model calls, customer billing
`enforced`, enabling `ai_agents`/`ai_control_center` for a real hotel, or flipping the platform autonomy switch outside
staging. Each needs its own explicit request.

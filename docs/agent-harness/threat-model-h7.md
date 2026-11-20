# H7 threat model: bounded autonomy

Scope: the H7 design in [ADR-0006](adr-0006-h7-bounded-autonomy.md) and
[h7-authorization-contract.md](h7-authorization-contract.md), and the H6 residuals it depends on. Baseline
`961a012b`. Nothing here is implemented in Phase 1.

Classification used below: **addressed** · **partially addressed** · **verified vulnerability** (confirmed from code;
severity stated) · **design limitation** (intended, documented trade-off) · **not yet implemented** · **requires
further validation** (suspected; no evidence of exploitability yet). Nothing is called exploitable without evidence.

## 1. H6 residual analysis

### A. Human identity provenance at the PostgreSQL boundary — **verified design limitation (blocks H7 issuance)**

* Evidence: `243: agent_tool_approval_decide(p_tenant_id, p_approval_id, p_actor_user_id, …)` and
  `243: agent_tool_grant_set(p_tenant_id, p_actor_user_id, …)` are SECURITY INVOKER, executable by `service_role`, and
  take the actor as a parameter. The DB re-reads that actor's current role (`agent__human_authority … FOR SHARE`) but
  cannot tell whether the actor id came from a verified JWT. `258` grants `service_role` INSERT/UPDATE on
  `agent_tool_grants` and `agent_tool_approvals`; 260's row guard checks the named decider's current role but not
  provenance. Tracked as GHSA-frh4 (medium) and ADR-0005 L1.
* Mitigations in place: the worker no longer holds `service_role` (255); the API verifies the JWT and re-reads
  membership per request (`agent_control_center/access.py:revalidate`); every control change is journaled (256/260).
* H7 requirement: level-3 grant issuance must not exist until Phase 2 delivers DB-verified provenance (ADR-0006 D5).
* **Phase 2 (262): partially addressed.** The DB-verified pattern exists (`agent__verified_human*`, live
  `auth.sessions` row, no actor argument) and is proven over real PostgREST by the non-mutating probe; the v2 decision
  is implemented but ungranted. Every legacy caller-asserted path above is unchanged. Remaining boundary: the API holds
  the legacy HS256 secret PostgREST accepts ([h7-p2-verified-identity.md](h7-p2-verified-identity.md) §6).

### B. Per-tenant and per-environment worker authorization after 261 — **addressed (with two follow-ups)**

* Evidence: `261: agent__worker_tenant()` is the only tenancy source (registered, unrevoked, unexpired, ≤ 7 days,
  bound to one active hotel, environment = `agent_deployment_identity`, stamp ≠ production, no person claims); RESTRICTIVE
  `agent_worker_tenant_gate` on all 8 readable tables; every wrapper refuses foreign run/step/invocation/attempt/tenant
  arguments. ADR-0005 L2 (cross-tenant reads) is therefore closed for `agent_worker`.
* Follow-ups for H7: (1) new level-3 wrappers must call the same tenant check first (contract test in Phase 5);
  (2) a production stamp grants no worker tenancy at all — H7 does not change that, and production autonomy needs a
  separate reviewed migration and decision.

### C. Post-commit worker notification reliability — **not yet implemented**

* Evidence: `agent_execution/__main__.py` logs `write_notify_deferred` and drops the staff push because the restricted
  worker cannot read device tokens (ADR-0005 L3). There is no outbox; delivery is not durable.
* H7 impact: level-3 candidate tools must not depend on a notification for correctness. A durable API-side
  transactional outbox (written in the execution transaction, delivered by the API at-least-once with leases, retries
  and a dead letter; exactly-once external delivery is not achievable) is Phase 7 and is required before any tool
  whose value depends on a human noticing it.

### D. Effective role privileges and control/audit integrity — **partially addressed**

* Addressed: exact privilege matrix and enforcement (254/258/259/261), no DELETE/TRUNCATE for app roles on harness
  tables, control-row identity immutability (260), append-only governance journal (256).
* Open: GHSA-xm55 (low) — a `service_role` UPDATE of an approval outside the RPC passes 260's guard when the named
  decider currently holds a valid role, and is journaled only as a control change, not as a tool event. GHSA-98wq
  (medium) — TRUNCATE on non-agent public tables outside the H6 registry. Neither lets the worker write, but both mean
  the API principal is broader than the harness needs.
* **Phase 2 (262):** xm55 closed for new transitions (deferred constraint trigger journals an out-of-RPC transition as
  `operator` / `unverified`, no duplicate for RPCs); 98wq inventoried only (h7-p2-verified-identity.md §10).
* H7 requirement: the new autonomy tables must give `service_role` **no** INSERT/UPDATE (functions only), and must
  be in the registry and privilege matrix from their first migration.

### E. Grant-revocation versus action-commit races — **verified design limitation (level 2); must not carry into H7**

* Evidence: in the level-2 execute RPCs, `agent__control_block_reason` (239), `agent__tool_block_reason` and
  `agent__tool_grant_level` (243) read `agent_runtime_controls`, `agent_execution_enablement`, `agent_tool_controls` and
  `agent_tool_grants` **without row locks**. A pause or grant revocation that commits after those reads but before the
  write commits does not block or refute the write. The approval row is locked (`FOR UPDATE`), so approval revocation
  **is** linearized.
* Impact today: bounded — every level-2 write also needs a fresh, single-use human approval for the exact action, so
  the race window can only complete an action a human already approved. **Requires further validation**: a real-DB
  concurrency test that pauses/revokes between the control read and commit (Phase 2 test backlog).
* H7 requirement: the level-3 RPC uses the lock order and linearization point in h7-authorization-contract.md §5.
* **Phase 2: confirmed by real-Postgres two-session tests** (`test_agent_h7_level2_race.py`); behaviour unchanged;
  a separate hardening PR is proposed (h7-p2-verified-identity.md §7).

### F. Platform audit visibility and information disclosure — **verified vulnerability (low) + design limitation**

* Design limitation (ADR-0005 L4): platform journal rows are shown to every hotel's GM, without operator identity.
* Verified (code inspection): after 261 worker credentials are **per hotel**, but `260: agent__journal_control_change`
  still journals `agent_worker_credentials` changes with `tenant_id = NULL` (platform scope), including
  `subject_ref` = credential id, `detail` = `{label, app_env, expires_at}` and the revoke reason code;
  `256: agent_control_center_events_page` returns platform rows' `subject_ref`/`detail` to any hotel, and
  `agent_control_center/service.py:audit` passes them through. So any hotel's GM can see metadata of other hotels'
  worker credentials. Not a privilege escalation (a jti cannot be used without the signing secret) and only reachable
  with `ai_control_center` enabled (default off). Confirming with a real-DB test and fixing (journal credential rows
  with the bound tenant, or omit `subject_ref`/`detail` for platform credential rows) is a Phase 2 item.
* **Phase 2 (262): fixed** for historical and new rows by the read model (bound hotel only, label dropped; unbound →
  no hotel); confirmed and tested with real-DB tests across three hotels.

### G. Other gaps that could permit an unauthorized autonomous write — **none found that are reachable today**

* G1 (**addressed**): no path can represent level 3 — Python ceiling, v1 manifest rules, `CHECK (1,2)`, grant RPC level
  check, 254 guard (all pinned by `test_agent_h7_autonomy_contracts.py`).
* G2 (**design limitation, latent**): `254: agent__guard_execution_approval` accepts self-approval when the DB spec
  risk is `low` and the approval allows initiator approval. No write tool is low risk today, so it is unreachable;
  H7 must not depend on it and Phase 5 should forbid it for any tool with `approval = bounded_grant`.
* G3 (**design limitation**): `agent__gateway_tool_spec` is the DB authority for risk; any H7 tool spec must be added
  there by reviewed migration with digest pins, never derived from Python input.
* G4 (**design limitation**, verified in `243: agent_tool_grant_set`): the `ON CONFLICT … DO UPDATE` re-activates a
  revoked level-2 grant in place (`revoked_at = NULL`); history survives only in the 256/260 journal. Acceptable for
  level 2; H7 grants must be new rows (history preserved by status), never resurrected.

## 2. New threats introduced by level 3

| # | Threat | Control (designed) |
|---|---|---|
| H7-T1 | Compromised API issues an autonomy grant on a GM's behalf | Issuance only as `authenticated` with the GM's own token; actor = `auth.uid()`; live `auth.sessions` row; current GM role re-read; no `service_role` EXECUTE (ADR-0006 D5) |
| H7-T1b | Stolen but unexpired GM token used to issue a grant | The session must still be live (sign-out or revocation stops it). `iat` freshness is not step-up; step-up is deferred, so a production-stamped database refuses all issuance until it is designed (contract §4.1) |
| H7-T2 | Model escalates risk/effect or picks a broader tool | Risk/effect from catalog + DB spec only; exact (id, version); closed-enum arguments |
| H7-T3 | Grant used after revocation/pause | FOR SHARE on platform/tenant/grant rows; revocation linearization (contract §5) |
| H7-T4 | Runaway volume | Per-binding hour / day / resource-day counters created atomically and locked FOR UPDATE; incremented only after a successful effect; re-issue cannot reset them; `max_writes_per_run ≤ 1` (contract §5.4) |
| H7-T5 | Cross-hotel action | 261 tenant check in wrapper + tenant predicate on every lock + grant tenant = run tenant |
| H7-T6 | Stale or concurrently changed resource | expected-version check under resource row lock; refuse + escalate |
| H7-T7 | Replay/duplicate | layer A: server-derived run key, atomic `agent_run_admit` (ON CONFLICT) collapses duplicate triggers into one run and one invocation; layer B: replay of that invocation's committed execution before authorization and quota, with no effect, consumption or quota; any key/invocation mismatch is `idempotency_conflict`; unique indexes as backstop (contract §5.3) |
| H7-T15 | Invocation treated as bounded without database authority | mode derived only from disjoint SQL specs (`agent__autonomy_tool_spec` vs `agent__gateway_tool_spec`) and their digests; no stored or caller-supplied mode (contract §5.1.1) |
| H7-T13 | Consumption forged, orphaned or attached to another execution | consumption inserted before the execution; replaced 254 guard requires exactly one of approval or bound consumption; deferred constraint trigger; composite FKs; `UNIQUE (autonomy_consumption_id)`; append-only (contract §5.1) |
| H7-T14 | Duplicate or lost staff notification | transactional outbox row in the effect transaction; leased at-least-once delivery with dead letter; duplicates possible and tolerated (contract §7.1) |
| H7-T8 | Grant widening by the agent (delegation) | `delegation_depth = 0`, `parent_grant_id IS NULL` CHECKs; no worker EXECUTE on issuance |
| H7-T9 | Silent autonomous changes | immutable tool event + consumption ledger; Control Center activity; reversible internal effects only |
| H7-T10 | Grant enables something else | issuance changes no switch/entitlement/level-2 grant; contract tests snapshot switches |
| H7-T11 | Prompt injection via resource text | level-3 tools take no free text; context text never reaches the authorization path |
| H7-T12 | Partial migration | autonomy RPCs fail closed if any table/function/spec digest is missing; schema contract |

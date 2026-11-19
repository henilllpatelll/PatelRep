# ADR-0005: H6 AI Control Center and worker/database identity separation

Status: implemented on `feat/agent-harness-h6-control-center` (not merged). Migrations 255–256 are
`destructive-reviewed` (TRUNCATE keyword only) and reach persistent staging only through a reviewed preview with
human approval. Agent execution, paid model calls, customer billing and autonomy ≥ 3 stay disabled; nothing in H6
changes a switch.

Baseline: `origin/main` `028d8df2` (H0–H5 + pre-H6 hardening #233, migration 254).

## 1. Context (audited, not assumed)

| Area | Behaviour at 254 (verified in code and on a real PostgreSQL 17 Supabase stack) |
|---|---|
| DB identity | API **and** worker use `service_role` (BYPASSRLS, EXECUTE on every harness RPC). `services/agent_execution/__main__.py` built the worker client from `SUPABASE_SERVICE_ROLE_KEY`; the worker imported `core.config`, whose `Settings` **requires** that key. |
| Worker DB surface | 22 harness RPCs + direct `.table()` reads of `tenants`, `user_profiles`, `user_roles`, `work_orders`, `rooms`, `room_status`, `room_assignments`, `room_occupancy_discrepancies`, `agent_runtime_controls`. |
| Harness SQL | 155 `agent*` functions, all SECURITY INVOKER, none PUBLIC-executable, none checks `current_user`/`auth.role()`. |
| Human decisions | `agent_tool_approval_decide` re-reads the decider's CURRENT role (`agent__human_authority … FOR SHARE`) but trusts `p_actor_user_id` (254 §4 residual): anyone holding `service_role` — including a compromised worker — could name a manager as decider. |
| Controls | `agent_runtime_controls` (H1), `agent_execution_enablement`/`agent_tool_controls`/`agent_tool_grants` (H2), `agent_model_enablement` (H3), `agent_customer_billing_controls` (H4); changed only by operator CLI / service-role RPCs, with no change journal. |
| Web | No Control Center. `/ai` is a retired redirect to `/dashboard` (the copilot lives elsewhere and is untouched). Engineers and housekeepers are mobile-only on web (`MOBILE_ONLY_ROLES`). |
| Staging | Staging Candidate auto-applies **non-destructive** pending migrations to persistent staging and refuses destructive ones without a reviewed-preview registry entry on `main`. |

## 2. Decision summary

1. **Worker identity:** a NOLOGIN PostgreSQL role `agent_worker`, reached **only through PostgREST** with a short-lived
   JWT (`role: agent_worker`, registered `jti`), executing only 23 reviewed SECURITY DEFINER pass-through wrappers and
   reading only reviewed columns. The worker process never holds or loads the `service_role` key and refuses to start
   if it is present (§3–§4).
2. **Governance journal:** one append-only, metadata-only `agent_control_center_events` table written **only** by
   AFTER triggers on the control tables (so every path, including the legacy operator CLI, is journaled in the same
   transaction) and by one reviewed refusal recorder. No role holds INSERT/UPDATE/DELETE/TRUNCATE on it (§5).
3. **Control-plane API** `/v1/agent-control-center/*` behind a separate default-off release flag `ai_control_center`,
   re-validating membership/role on every request and reusing H1/H2 services for every mutation (§6).
4. **Web** `/ai-control-center` (six sections) in the existing Dashboard Shell V2 using existing workspace components;
   every status and button comes from the backend (§7).
5. Migrations are destructive-reviewed on purpose: that is what keeps them off persistent staging until a human
   approves the reviewed preview (§9).

## 3. Worker/database identity: alternatives considered

| Option | Verdict |
|---|---|
| A. Keep `service_role` for the worker | Rejected: the 254 residual (worker can call the human decision RPC with any manager id). |
| B. Direct Postgres LOGIN role (Supavisor) + psycopg | **Rejected after a probe.** A fresh role can execute every PUBLIC-executable function in every schema it can use. On the Supabase image `net.http_delete`, `net.wake`, `net.worker_restart` etc. are PUBLIC-executable (pg_net) — an arbitrary-HTTP primitive for any SQL-capable login. Also requires rewriting every store/adapter. |
| C. **PostgREST + custom JWT role** | **Chosen.** PostgREST exposes only the `public` API schema; the role can call only what it holds EXECUTE on. Keeps supabase-py and every H1–H5 store unchanged. Supabase-supported (custom role claim; `GRANT agent_worker TO authenticator`). |
| D. Make existing RPCs SECURITY DEFINER | Rejected: changes semantics for the API path and every reviewed body. |
| E. Grant table rights to `agent_worker` and keep INVOKER RPCs | Rejected: INVOKER bodies need table rights, which would let the worker write approvals/ledgers directly. |

### 3.1 Effective privilege of each SECURITY DEFINER function (owner `postgres`, `search_path = ''`)

| Function | Executable by | What it can do | Identity / parameter validation |
|---|---|---|---|
| `agent_worker_rpc__<rpc>` ×22 | `agent_worker` only | Exactly the wrapped H1–H5 function with the caller's arguments | `agent__worker_assert()` first; then the unchanged function's own tenant, lease-fence, approval-binding and 254-trigger checks. Same signature and defaults (generated from `pg_proc`). |
| `agent_worker_rpc__agent_runtime_controls_snapshot` | `agent_worker` only | Read pause/stop flags (no ids beyond scope/tenant/agent) | credential check |
| `agent__worker_credential_ok()` | `agent_worker` (RLS policies) | Read one row of `agent_worker_credentials` | `request.jwt.claims` role = `agent_worker`, jti is a UUID, registered, unrevoked, unexpired; malformed claims → false |
| `agent__worker_assert()` | nobody (called inside wrappers) | raises `agent_worker_credential_invalid` | as above |
| `agent__control_center_journal(...)` | nobody (triggers) | INSERT one journal row | actor parsed from `updated_by` (`user:<uuid>` → human); free text never stored |
| `agent__journal_control_change()` | trigger only | calls the writer with allowlisted columns | old/new values of control columns only |
| `agent_control_center_record_refusal(...)` | `service_role` | INSERT one `security_refusal` row | reason-code regex, closed subject types, unknown hotel → no row, `detail` always `{}` |

`request.jwt.claims` is set by PostgREST from the **verified** token for each request; `agent_worker` runs no SQL of its
own, so it cannot set the GUC. A direct-SQL session as owner could, but owners already bypass everything (254 §4).

### 3.2 Credential lifecycle (rotation and revocation)

* Minting: `python -m services.agent_execution worker-credential-issue --label L --days N --operator O` on a trusted
  operator machine (service-role key to register the jti, project JWT secret to sign). Max 31 days (DB CHECK);
  production issuance refused in H6.
* Revocation: `worker-credential-revoke --id J` — refused on the very next request (wrapper raises; RLS hides rows).
  Kill switch for all worker tokens: `REVOKE agent_worker FROM authenticator` (reviewed migration/administrator).
* Rotation: issue new → deploy to the worker's secret store → confirm liveness → revoke old. Issue/revoke are
  journaled. Full runbook: [worker-identity.md](worker-identity.md).
* Limitation: the token is HS256 with the project JWT secret (as the API verifies today). If the project moves to
  asymmetric signing keys, minting must use an imported signing key (Supabase supports importing a private key).

## 4. Worker contract (enforced in SQL, mirrored in Python)

* **Allowed RPCs (23):** `agent_run_claim/heartbeat/acknowledge`, `agent_step_complete/fail`, `agent_runs_recover`,
  `agent_worker_heartbeat`, `agent_runtime_controls_snapshot`, `agent_tool_authorization_snapshot/step_context/
  request_approval/record_outcome/approvals_expire`, `agent_tool_execute_work_order_assign`,
  `agent_tool_execute_room_assignment`, `agent_planning_step_context/record_plan/record_context`,
  `agent_billing_attempt_reserve/dispatch/release/settle`, `agent_model_attempts_recover`.
* **Explicitly impossible:** `agent_tool_approval_decide/revoke`, `agent_tool_grant_set`, every enablement/control/
  pricing/budget/overage/reconciliation setter, every admission (`agent_run_admit`, `agent_tool_run_admit`,
  `agent_planning_run_admit`, `agent_proposal_handoff_admit`), run cancel/pause/resume, the H3 direct attempt RPCs (the
  worker goes through H4), `work_order_assign_apply`, `publish_assignment_batch`, `agent_audit_privileges_enforce`,
  credential registration — no EXECUTE, none PUBLIC (asserted by `agent_worker_privilege_violations()`).
* **Reads:** column-level SELECT on 8 domain tables (identity + gateway context columns only; no guest names, notes,
  descriptions or profile names) behind `agent_worker_read` RLS policies that also require an active credential.
  **No right at all** on any harness table.
* **Role:** NOLOGIN, NOINHERIT, NOBYPASSRLS, no memberships, owns nothing; not a member of `service_role`.
* **Fail closed:** the migration and `agent_audit_privileges_enforce()` (called by CI and Staging Candidate after
  blanket grants) raise if any violation exists; `schema-contracts.sql` asserts the same on every environment.
* **Tenant isolation for the worker** remains code-enforced (the worker is multi-tenant by design and reads every
  hotel's reviewed columns); every RPC still filters by tenant in SQL and binds runs/leases.

Python: `services/agent_execution/worker_identity.py` (`RestrictedWorkerClient` maps the 23 names to wrappers and
refuses anything else before a request; read-only table proxy with column allowlist; token/api-key/environment/target
guards). The worker entrypoint no longer imports `core.config`; provider keys come from `ProviderCredentialSettings`.

## 5. Governance persistence (migration 256)

* `agent_control_center_events`: append-only (row guard; tenant offboarding cascade only; platform rows never
  deleted), BEFORE TRUNCATE refusal, `detail` ≤ 2 KB object, metadata only. Index `(tenant_id, id DESC)`.
* Journal triggers on 7 tables: `agent_runtime_controls`, `agent_tool_grants`, `agent_execution_enablement`,
  `agent_model_enablement`, `agent_tool_controls`, `agent_customer_billing_controls`, `agent_worker_credentials`. No-op
  upserts are not journaled.
* 254 registry → 33 tables / 12 append-only; enforcement additionally strips every `agent_worker` right on harness
  tables, INSERT on the journal, and EXECUTE on wrappers and the journal writer for every other role.
* Not duplicated: approvals (H2), runs/events (H1), tool events (H2), spend and billing ledgers (H3/H4). Run controls
  are already in `agent_run_events` with the human actor (`user:<uuid>`).
* One new index `idx_agent_tool_approvals_tenant_created` (history paging; H2 indexed only pending rows).
  `agent_runs` paging uses the existing `idx_agent_runs_tenant_created`.

## 6. API contract (`/v1/agent-control-center`, router `routers/agent_control_center.py`)

All responses `{ "data": … }`; lists add `meta` (`per_page`, `next_cursor` / `next_before_id`). Errors
`{"detail": {"code": "<stable_code>"}}`. Request bodies `extra="forbid"`; reason codes `^[a-z][a-z0-9_]{0,63}$`;
cursors `created_at|uuid`; limits ≤ 100.

| Route | Roles (coarse / authoritative) | Notes |
|---|---|---|
| `GET /session` | viewers | sections and capabilities for this person now |
| `GET /overview` | gm, chief_engineer, housekeeping_supervisor | effective controls, readiness `blocked_by`, counts, refusals |
| `GET /agents` | viewers | reviewed agents at exact versions; grants for GM |
| `GET /runs`, `GET /runs/{id}` | viewers (GM: hotel; others: own) | metadata only; no `detail` blobs, specs or digests |
| `POST /runs/{id}/{cancel,pause,resume}` | GM any; initiator cancel/pause own; resume GM | `agent_control_center_run_control` → H1 |
| `GET /approvals?view=needs_my_review,submitted_by_me,history` | viewers | capability per row |
| `GET /approvals/{id}` | approver roles, initiator, GM | facts: exact proposal (reviewed keys), resource now, staleness, names, risk, expiry, `assignee_evidence = active_role_member_shift_unverified` |
| `POST /approvals/{id}/{approve,reject,withdraw}` | per capability | H2 `approvals.approve/reject/revoke` (unchanged); approve additionally needs the gateway process gate |
| `GET /controls`, `POST /controls/hotel-pause`, `POST /grants/revoke` | GM | pause/unpause (operator pause locked), revoke only |
| `GET /audit` | GM | journal page; platform rows without operator identity |

Every request: release flag (404 when off) → JWT role coarse gate → **re-read membership/role** via H1
`SupabaseIdentityAuthority` (refuses missing hotel, inactive hotel/profile/role, >1 active role, role ≠ session role).
Security refusals (authority, tenancy, races) are journaled best-effort. Reads never depend on execution gates.
AI usage reuses H4 `GET /billing/ai-usage`. No endpoint enables execution, paid calls, billing, a grant or autonomy.

## 7. Web

`/ai-control-center` (route guard: gm, chief_engineer, housekeeping_supervisor; nav item only while
`ai_control_center` is in `hotel.enabled_features` — Sidebar, Sidebar V2, command palette and breadcrumbs share
`getAllowedNavItems`). Sections: Overview, Agents, Approvals, Activity, Controls, Audit, exactly as the session
allows. Buttons only where the backend capability says so; race refusals (`not_pending`, `approval_expired`, …) show
plain-language messages and refresh. Assignees are described as "has an active role here; on-shift not checked".
Admin copy stays English (project decision D-03); the nav label is in EN/ES. No production mock data.

## 8. Limitations (explicit)

* **L1 Trusted API boundary.** The API still uses `service_role`; human decisions are authorized by the API's verified
  JWT + DB re-read of CURRENT role, but the database does not independently verify that the actor id came from a JWT.
  H6 removes the worker from that trust; the API remains trusted.
* **L2 Worker reads are cross-tenant by role.** `agent_worker` can read the reviewed columns of every hotel; tenant
  scoping of those reads is in code (as before for `service_role`).
* **L3 Post-commit push deferred.** The restricted worker cannot read device tokens or call push; the committed change
  stands and `write_notify_deferred` is logged. Delivering it needs an API-side outbox (H7 candidate).
* **L4 Platform rows** of the journal are visible (without operator identity) to every hotel's GM.
* **L5 Local-stack finding** (pg_net PUBLIC EXECUTE) was observed on the Supabase CLI image; the staging preview should
  record it. It does not affect the chosen design.

## 9. Rollout

1. Review this PR (CI Gate incl. real-DB tests; Staging Candidate will refuse 255/256 by design).
2. Separate registry PR pinning this PR + exact head SHA, base 254, digests of 255/256, preconditions (254 recorded,
   255/256 absent, role `agent_worker` absent, `authenticator` exists) and postconditions (violations 0, 23 wrappers,
   7 journal triggers, registry 33/12).
3. Human: fresh restore-verified staging backup, dispatch preview, approve `staging-migration-approval`.
4. Then CI/Staging on the exact head; human review; human merge. `ai_control_center` stays off until a rollout
   decision. No worker credential is issued and no worker is deployed in H6.

## 10. H7/H8 compatibility

* H7 (bounded autonomy) adds wrappers only for new reviewed RPCs; `agent__worker_allowed_rpcs()` and the Python
  mirror change together under contract tests. Autonomy ≥ 3 stays unreachable from the Control Center.
* The journal's closed `event_type` list extends by forward migration. Notification outbox (L3) and a DB-verified
  human principal (L1, e.g. per-request signed approval assertions) are the natural H7 follow-ups.

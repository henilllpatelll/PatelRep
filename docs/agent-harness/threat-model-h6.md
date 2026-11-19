# H6 threat model: AI Control Center and the worker database identity

Scope: migrations 255–256, `services/agent_execution/worker_identity.py`, `services/agent_control_center/`,
`routers/agent_control_center.py`, `/ai-control-center`. Design: [ADR-0005](adr-0005-h6-control-center.md).

## 1. Trust boundaries

```
 Browser (GM / chief / supervisor) ──JWT──▶ API (service_role, trusted) ──▶ PostgreSQL (RLS, harness RPCs, triggers)
                                                                              ▲
 Worker process ──apikey(public) + agent_worker JWT──▶ Kong ▶ PostgREST ──────┘  (role agent_worker; wrappers only)
 Operator machine ──service_role + JWT secret──▶ credential issue/revoke, controls CLI (journaled)
```

| Boundary | Trusted for | Not trusted for |
|---|---|---|
| Browser | nothing | identity (only the signed JWT), hotel, role, capability, any id |
| API | verifying the JWT, choosing the hotel from it, re-reading role, calling reviewed RPCs | — (residual L1: DB does not independently verify the human principal) |
| Worker | running reviewed steps under fencing | deciding approvals, changing controls, writing tables, reading unreviewed data |
| PostgreSQL | tenant predicates, lease fencing, approval binding/independence (254), privilege enforcement | — |
| Owner / superuser | migrations (governed by review) | everything else; can bypass any control (254 §4) |

## 2. Threats and controls

| # | Threat | Control | Evidence |
|---|---|---|---|
| T1 | Compromised worker approves on a manager's behalf | No EXECUTE on `agent_tool_approval_decide/revoke`; not PUBLIC; no wrapper; Python allowlist refuses first | `test_agent_worker_identity.py::test_the_database_refuses_every_unreviewed_rpc…`, `…a_real_pending_approval_cannot_be_decided…` |
| T2 | Worker changes controls / grants / pricing / enablement | Same (all setters denied); role has no table rights | same suite (parametrized 14 RPCs) |
| T3 | Worker writes approvals, ledgers, audit or business rows directly | No INSERT/UPDATE/DELETE/TRUNCATE on any table; harness tables: no right at all | `…cannot_write_any_table_directly` (11 tables via PostgREST), `…sql_as_the_worker_role…` (TRUNCATE/DML/decide as the role) |
| T4 | Worker fabricates a successful write or executes without approval | Wrappers call the unchanged fenced RPCs; 254 triggers require an approved, unconsumed, independent approval | `…fabricated_success_and_unapproved_execution_are_refused…` |
| T5 | Worker reads guest data | Column-level grants exclude guest names, notes, descriptions, profile names | `…reads_only_reviewed_columns` |
| T6 | Stolen worker token | ≤ 31-day life; per-jti revocation effective next request; role kill switch; token alone grants only the wrapper set | `…unregistered_revoked_and_foreign_role_tokens_are_refused` |
| T7 | Worker silently falls back to `service_role` | Startup refuses if any service-role/secret key is in the environment, if the token is not an `agent_worker` token, or the apikey is privileged; `cmd_worker` imports no `core.config` | `tests/smoke/test_agent_worker_identity.py` |
| T8 | Arbitrary HTTP / SQL via PUBLIC functions | Only PostgREST-exposed objects reachable; definer functions executable by the role = reviewed set (verifier) | `agent_worker_privilege_violations()`; ADR §3 option B |
| T9 | Blanket grants in CI/staging reopen privileges | `agent_audit_privileges_enforce()` (extended) runs after blanket grants and fails closed | simulated CI grant → 0 violations; schema contract |
| T10 | Cross-hotel enumeration in the Control Center | Hotel only from JWT; every read model filters `p_tenant_id` in SQL; detail ids of other hotels → 404 and journaled | `test_agent_control_center.py::test_cross_hotel…` |
| T11 | Demoted / deactivated / multi-role / stale-token user | Per-request re-read through H1 `SupabaseIdentityAuthority`; DB re-reads role again for every decision | `…identity_revalidation_refuses…` |
| T12 | Self-approval or double decision | Capability hides it; H2 + 254 refuse; concurrent decisions resolve to one | `…inbox_facts_and_an_independent_approval…`, `…concurrent_decisions…` |
| T13 | Approval on stale facts / after expiry | Facts show current resource + `resource_changed_since_proposal`; execution re-checks; expired → refused | `…expired_and_stale_approvals…` |
| T14 | Dashboard mutation activates agents | No endpoint writes enablement, paid-call, billing, grants-on or autonomy; approve needs the gateway process gate; switches unchanged after mutations | `…hotel_pause_is_gm_only…` (switch snapshot), static `test_no_control_center_code_can_enable…` |
| T15 | Forged / rewritten / erased governance history | Journal: no INSERT/UPDATE/DELETE/TRUNCATE for any app role; row + statement guards for the owner | `…governance_journal_cannot_be_written…` |
| T16 | Sensitive data in responses or logs | Field-by-field builders; no `detail` blobs, plans, prompts, specs, digests of requests, credentials; intent instruction text never exposed | static contracts + facts assertions (no guest name/note) |
| T17 | Partial / missing migration | Read models fail closed (`schema_unavailable`); schema contract refuses partial 255/256 | `…missing_or_partial_schema…`; contract run with partial history |
| T18 | UI offers an action the backend refuses | Buttons from server capability; race refusal messages + refresh | Playwright `ai-control-center-hermetic.spec.ts` |

## 3. Schema and privilege inventory (after 256)

| Object | Owner | `service_role` | `agent_worker` | `anon` / `authenticated` / PUBLIC |
|---|---|---|---|---|
| 31 H1–H5 harness tables | postgres | as after 254 | **none** | none |
| `agent_worker_credentials` (mutable, revoke-once) | postgres | SELECT, INSERT, UPDATE | none | none |
| `agent_control_center_events` (append-only) | postgres | **SELECT only** | none | none |
| 8 domain tables (reviewed columns) | postgres | unchanged | SELECT on reviewed columns, RLS `agent_worker_read` | unchanged |
| `agent_worker_rpc__*` (23, DEFINER) | postgres | none (re-asserted) | EXECUTE | none |
| `agent__worker_credential_ok` (DEFINER) | postgres | none | EXECUTE | none |
| journal writer / trigger (DEFINER) | postgres | none | none | none |
| `agent_control_center_record_refusal` (DEFINER) | postgres | EXECUTE | none | none |
| `agent_control_center_*` read models + 2 controls (INVOKER) | postgres | EXECUTE | none | none |
| credential register/revoke/list, `agent_runtime_controls_snapshot` (INVOKER) | postgres | EXECUTE | none | none |
| 254 functions (registry, violations, enforce) | postgres | none (owner-only) | none | none |
| Role `agent_worker` | — | — | NOLOGIN NOINHERIT NOBYPASSRLS, no memberships; member **of** nothing; `authenticator` may SET ROLE to it | — |

## 4. Residual risks

L1–L5 in ADR-0005 §8. Highest: L1 (the API is a trusted boundary for the human principal). Mitigations in place:
JWT verification, per-request role re-read, DB role re-read at decision, independence triggers, journal of refusals.

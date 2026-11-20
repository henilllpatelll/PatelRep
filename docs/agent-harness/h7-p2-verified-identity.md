# H7 Phase 2: database-verified human identity and H6 residual hardening

Status: implemented as migration **262** (`agent_verified_human_identity`) on branch
`security/h7-p2-verified-human-identity`, base `origin/main` `5403ad74`. **Nothing is activated**: the only new
executable entry point is a non-mutating probe; the v2 approval decision ships with no grant; the legacy H2 paths are
unchanged and remain the active ones. No grant table, quota, consumption ledger, autonomous tool or manifest v2
runtime exists (Phase 3+). Companion: [ADR-0006](adr-0006-h7-bounded-autonomy.md),
[h7-authorization-contract.md](h7-authorization-contract.md), [threat-model-h7.md](threat-model-h7.md).

## 1. Evidence matrix: PostgreSQL-enforced versus API-trusted (before and after 262)

| Property | Before 262 | After 262 | Evidence |
|---|---|---|---|
| Which human acted (H2 decide / revoke / grant, Control Center pause / run control) | **API-trusted**: `p_actor_user_id` argument from a verified `CurrentUser`; DB re-reads that id's role | unchanged for these legacy paths | 243/256 bodies unchanged (pinned md5) |
| Which human acted (new verified paths: probe, decide v2) | n/a | **DB**: `auth.uid()` of the PostgREST-verified JWT; role GUC `authenticated` on login `authenticator`; no actor argument exists | `agent__verified_human_claims`; `test_agent_h7_verified_human.py` |
| Session still live (sign-out / revocation) | not checked anywhere | **DB**: `auth.sessions` row of that user, `not_after` unset or future | `test_a_token_from_a_signed_out_session_cannot_authorize` |
| Hotel of the actor | API: JWT `hotel_id` claim | **DB**: active `user_profiles.tenant_id`; a hotel claim must match; user_metadata never read | `test_a_hotel_claim_for_another_hotel_is_refused`, `test_user_editable_metadata_is_never_authority` |
| Current role, exactly one, in the permitted set | DB (243 `agent__human_authority`, FOR SHARE) for the asserted id | DB, for the verified id, plus "exactly one active role across all hotels" | `test_multiple_active_roles_are_ambiguous_and_refused`, demotion test |
| service_role / agent_worker / anon cannot act as a human | API discipline | **DB**: no EXECUTE for anon / agent_worker / public; service_role refused inside every function even when a blanket grant reaches it | `test_service_role_is_never_a_verified_human`, `test_the_agent_worker_is_never_a_verified_human` |
| Approval decision gates (Control Center entitlement, execution enabled, non-production) | API (`approve_gate_open`, route flag) | DB as well, for v2 | `test_database_gates_hold_even_if_the_api_gate_is_bypassed` |
| Worker-credential journal visible only to its hotel | **not enforced** (any GM saw every hotel's credential id / label / env / expiry) | **DB** read model, historical and new rows | `test_agent_h7_credential_audit_isolation.py` |
| Approval state transitions always audited | RPCs only; a direct `service_role` UPDATE was silent (GHSA-xm55) | **DB** deferred constraint trigger, attributed `operator` / `unverified` | `test_agent_h7_approval_audit.py` |
| Level-2 stop linearized with in-flight writes | not linearized (unlocked control / grant reads) | unchanged (characterized, §7) | `test_agent_h7_level2_race.py` |

## 2. Identity helper (`agent__verified_human_claims`, `agent__verified_human`)

Facts verified on the replayed stack before design (GoTrue v2.186.0, PostgREST v14.3, PostgreSQL 17.6; the migration
re-checks them and refuses to apply if any differ):

* `auth.sessions(id, user_id, not_after)` and `auth.users(id, deleted_at, banned_until, is_anonymous)` exist; only the
  table owner `postgres` (BYPASSRLS) may read them. `authenticated`, `anon`, `service_role` and `agent_worker` may not
  (262 adds no Auth privilege; the schema contract asserts it).
* `service_role` and `agent_worker` are not members of `authenticated`; `GRANT EXECUTE … TO authenticated` therefore
  excludes them.
* Inside a SECURITY DEFINER function called through PostgREST, `current_setting('role')` is the caller's PostgREST
  role (`authenticated` / `anon` / `service_role`), `session_user` is `authenticator`, `current_user` is the owner.
* `auth.uid()` prefers the legacy `request.jwt.claim.sub` variable; the helper requires it to agree with
  `request.jwt.claims->>'sub'`.
* GoTrue access tokens carry `session_id`, `aal`, `amr`, `iat`, `is_anonymous`; GoTrue sign-out deletes the
  `auth.sessions` row while the access token stays cryptographically valid until `exp` (PostgREST still accepts it).

Order of checks (any failure returns `{ok:false, reason}` with a stable code; nothing personal is returned):
`not_authenticated_role` → `invalid_claims` (shape, `aud`, `sub` = `auth.uid()`, `iat`) → `token_expired` →
`user_not_eligible` (anonymous) → `session_missing` → `session_not_live` → `user_not_eligible` (deleted / banned) →
`hotel_mismatch` (hook / app_metadata hint vs. profile) → `not_a_member` / `inactive_member` → `hotel_inactive` →
`ambiguous_membership` → `role_not_permitted` (243 `agent__human_authority`, role rows FOR SHARE). Auth rows are read
without locks; a sign-out that commits before the statement snapshot is observed, one that commits later is not
(bounded by the statement; documented, not a lock).

SECURITY DEFINER is used only because Auth tables are owner-readable; every function has `search_path = ''`,
schema-qualified objects, no dynamic SQL, owner `postgres`, and EXECUTE revoked from every role (probe: authenticated
only). The helpers are not reachable through PostgREST (tested).

## 3. Entry points

* `agent_verified_human_probe(p_operation)` — operations `control_center_gm` (gm) and `tool_approval_review`
  (chief_engineer, gm, housekeeping_supervisor). Non-mutating (row-count fingerprint test). Returns
  `{ok, operation, role, hotel_id, verified_by:'database', step_up:'none'}` or `{ok:false, reason, operation}`.
* `agent_tool_approval_decide_v2(p_approval_id, p_decision, p_reason_code)` — the 243 decision with the actor and hotel
  derived by the database; same lock order (approval → run → role rows), same state machine, independence, expiry,
  events (plus `detail.identity = 'database_verified'`), resume / fail behaviour. **Unlike 243, the full current
  authority (identity, live session, hotel, exactly one active approver role) is verified immediately after the two
  row locks and before anything else**: an unauthorized caller cannot expire / revoke a stale approval, end its run or
  learn its state; its only possible write is the append-only `policy_denied` event 243 also records. Real-DB tests:
  demoted, inactive, cross-hotel, non-approver and signed-out callers on an expired approval leave the approval, run,
  lifecycle events and run events byte-for-byte unchanged; a current approver still runs the cleanup. It re-checks in SQL the gates the
  API applies: `ai_control_center` entitlement (approve and reject), and for approve a deployment stamp that exists and
  is not `production` plus platform execution enabled. **Inactive: no grant.** Its logic is tested over real PostgREST
  under a test-only grant that the fixture always revokes.
* API plumbing: `services/agent_control_center/verified_identity.py` forwards the caller's own bearer token
  (`HumanAccessToken`, redacted, unpicklable) with the PUBLIC key only (service-role / secret keys refused) to the probe.
  The target must be **exactly** the origin of the API's own Supabase project (`settings.supabase_project_url`: same
  scheme, host and effective port; no userinfo, path, query or fragment; http only for loopback); anything else is
  refused before a request exists, redirects are never followed and any 3xx is refused (15 look-alike / smuggling
  targets tested with a transport that fails the test if called). Disabled by default (`AGENT_VERIFIED_HUMAN_ENABLED`),
  mounted on no route.

Activation (separate, explicit request; not part of Phase 2): a reviewed migration `GRANT EXECUTE ON FUNCTION
public.agent_tool_approval_decide_v2(uuid, text, text) TO authenticated` + contract update, an API route that forwards
the token to v2 instead of calling 243 as service_role, and the §6 signing-key change. Until then GHSA-frh4 is closed
**only** for the probe (and, once granted, v2); every legacy `service_role` mutation remains caller-asserted.

## 4. Cross-hotel credential audit (threat-model-h7 §F) — fixed

The unchanged 256/260 journal writes credential events with `tenant_id NULL` (operator record; never deleted with a
hotel). 262 replaces only `agent_control_center_events_page`: a credential row is returned to the hotel the credential
is bound to (261 `agent_worker_credential_scopes`) as `scope = hotel` with `{app_env, expires_at}` only; an unbound
credential's rows go to no hotel; every other row is byte-for-byte the previous projection. Historical rows have
exactly the stored shape the filter handles, so they stop leaking with no rewrite. Platform operators keep full rows
through the table / `agent_worker_credentials_list` (service_role). Tested with three hotels plus an unbound credential.

## 5. Approval transition audit (GHSA-xm55) — fixed for new transitions

`agent_tool_approvals_transition_audit` (constraint trigger, `AFTER UPDATE`, `DEFERRABLE INITIALLY DEFERRED`) checks at
commit that a transition to approved / rejected / revoked / expired has its tool event (each target state is reached
at most once per approval, 241). If not, it appends one: `actor_kind = operator`, `actor_ref = db_role:<PostgREST
role>`, `reason_code = out_of_band_change`, `detail = {provenance: unverified, asserted_decided_by_user_id,
asserted_decided_role}` — never `human`. Reviewed RPCs already wrote their event, so no duplicate. `SET CONSTRAINTS …
IMMEDIATE` makes it fire earlier (it then writes the operator event); it cannot skip it. The trigger has
`WHEN (OLD.state IS DISTINCT FROM NEW.state)`, so consumption / expiry-only updates queue nothing. Operational
consequence: a transaction that changes an approval's **state** and then runs `ALTER TABLE agent_tool_approvals`
(only owner fault-injection or a future migration would) fails with "pending trigger events"; such a migration must
alter the table first or in a separate transaction. Pre-262 silent transitions are
counted read-only by the migration (0 on a fresh replay) and kept as they are.

## 6. Trust boundary that remains (stated, not hidden)

The database verifies the token signature (PostgREST), the live session and current authority. It cannot tell **who
signed** the token. PostgREST in this project still accepts HS256 tokens signed with the legacy shared JWT secret
(the integration tests mint them), and the API process holds that secret (`SUPABASE_JWT_SECRET`, used by
`middleware/auth.py`). A compromised API therefore can mint a token for any user **whose live session id it knows**
(it sees every caller's token) — equivalent to replaying that user's real token within its lifetime. Pinned by
`test_characterization_a_holder_of_the_jwt_signing_secret_with_a_live_session_id_is_accepted`. Closing it (before v2
activation or any grant issuance): move the project to asymmetric signing keys only (GoTrue already signs ES256
locally), revoke the legacy HS256 secret so PostgREST stops accepting it, and remove `SUPABASE_JWT_SECRET` from the API
(the middleware already verifies ES256 via JWKS). Step-up (§8) additionally bounds replay of a stolen token.

## 7. Level-2 pause / revocation race (threat-model-h7 §E) — characterized, not changed

Protocol (`test_agent_h7_level2_race.py`, real PostgreSQL, no sleeps decide order): session A (psql, `service_role`)
`BEGIN`s and runs `agent_tool_execute_work_order_assign` for a claimed run with a fresh approval; the RPC passes every
check, performs the write and A stays `idle in transaction` (tagged with the RPC outcome). Session B then acts; A commits.

| B (committed while A is open) | B waited? | A's write | Result |
|---|---|---|---|
| platform pause, cost emergency stop, hotel pause, agent pause, tool pause, platform execution disabled, level-2 grant revoked (7 cases) | **no** (A holds no lock on control / grant rows; no ungranted lock) | **commits after the stop** | stop not linearized with the in-flight write |
| approval revocation (`agent_tool_approval_revoke`) | **yes** (approval row `FOR UPDATE`) | commits first | B then returns `not_revocable`, `consumed = true` — linearized |
| initiator demotion (`UPDATE user_roles`) | **yes** (role rows `FOR SHARE` via `agent__human_authority`) | commits first | linearized |
| any stop committed **before** A starts | n/a | refused | stops are effective for every write not yet past its checks |

Exact lock behaviour: the execute RPC locks the run (`agent__owned_run`, `FOR UPDATE`), the approval (`FOR UPDATE`),
the initiator and approver role rows (`FOR SHARE`), and the work-order row it writes; `agent__control_block_reason`,
`agent__tool_block_reason` and `agent__tool_grant_level` read `agent_runtime_controls`, `agent_execution_enablement`,
`agent_tool_controls` and `agent_tool_grants` with plain snapshots. A stop is a single-row upsert / update on those
tables, so it neither waits for nor is waited on by the write.

Severity: bounded. Each such write still carries a fresh, single-use human approval of that exact action (254 guard),
so the window (at most one statement plus commit) can only complete an action a human approved moments earlier. It is
**not** acceptable for level 3, where no per-action approval exists: the level-3 RPC must take `FOR SHARE` on the
platform / tenant autonomy state and grant rows in the contract §5.2 order so a stop either waits for or refutes it.

Why not fixed here: adding `FOR SHARE` to the shared level-2 helpers changes the timing of every H1/H2/H5 path that
calls them (claim, admission, both execute RPCs, Control Center pause), needs a deadlock proof against the claim path
(run `FOR UPDATE` → controls) and the stop paths (controls → nothing), and is a behaviour change to human-approved
execution the brief says must not be made silently. **Proposed separate PR:** in the two execute RPCs only (not the
shared read helpers), after `agent__owned_run` and before the approval lock, take `FOR SHARE` on the platform row and
the hotel / agent rows of `agent_runtime_controls` that exist, the `agent_execution_enablement` singleton, the
`agent_tool_controls` row of the tool and the `agent_tool_grants` row of the binding; lock-order proof: no stop path
locks a run, approval or role row, and every stop path locks exactly one control row, so no cycle exists; rollback =
a forward `CREATE OR REPLACE` restoring the unlocked bodies; tests = this file's seven characterization cases flipped
to "B waits, then A's write is either committed before the stop or refused".

## 8. Step-up authentication design (deferred; nothing implemented)

Deployed capabilities (local replay; hosted settings must be re-checked read-only before any implementation): GoTrue
v2.186 supports TOTP, phone and WebAuthn factors (`auth.mfa_factors` with `status verified`, `auth.mfa_challenges`,
`auth.mfa_amr_claims(session_id, authentication_method, created_at, updated_at)`), session `aal` (`aal1|aal2|aal3`) and
`factor_id` on `auth.sessions`, and `aal` / `amr` claims in the access token. This project's `supabase/config.toml`
has every MFA factor **disabled**.

Why `iat` is not step-up: a refresh re-mints the access token (new `iat`) from the refresh token without the person
doing anything (`test_a_refreshed_token_of_the_same_live_session_still_verifies`). `iat` proves only that some holder
of the refresh token asked recently.

| Option | Proves | Replay protection | Weakness |
|---|---|---|---|
| A. AAL2 checked in the DB: token `aal = aal2` **and** the `auth.sessions` row `aal = aal2` with a `factor_id` naming a `verified` factor of that user **and** an `auth.mfa_amr_claims` row for the session with an MFA method whose `updated_at` is within N minutes | the session was MFA-verified, recently | none per action (a stolen aal2 token works until the window closes) | depends on Auth-internal tables whose shape can change; needs MFA enrolment for every GM |
| B. DB single-use re-authentication challenge: the user re-proves (MFA verify or password re-entry via GoTrue) and the API asks an `authenticated`-only RPC to mint a challenge row bound to (user, session, hotel, operation, digest, expiry ≤ 5 min); the issuance RPC consumes it `FOR UPDATE` exactly once | a fresh, operation-bound act by the person (if the re-proof itself is MFA) | single use, digest-bound, short expiry | the challenge is only as strong as the re-proof; password-only re-entry is not MFA |
| C. A + B (recommended) | fresh MFA bound to one operation | single use + bound to digest / session / hotel | most work; requires enabling MFA in the hosted project |

**Recommendation: C.** Trust boundary = the database (never the API) checks: verified identity (§2) **and** session
`aal2` with a verified factor and a recent MFA AMR entry **and** a single-use challenge row created by the same
session for the same hotel and the exact operation digest, consumed in the issuing transaction. Expiry ≤ 5 minutes;
replay impossible (unique consume, digest binding); tenant binding from the profile; recovery = an operator can only
**revoke** (never issue) when MFA is lost, and factor reset follows Supabase's admin flow with a fresh enrolment;
compatibility = a production-stamped database keeps refusing issuance until C is implemented, reviewed and its tables
pinned in the schema contract. Phase 2 implements **none** of this; the production grant-issuance prohibition stays.

## 9. Rollback / forward recovery

Forward-only. Disable without restoring history: (1) probe — `REVOKE EXECUTE ON FUNCTION
public.agent_verified_human_probe(text) FROM authenticated` (owner or follow-up migration); (2) v2 — already ungranted;
(3) credential read model — a reviewed `CREATE OR REPLACE` of `agent_control_center_events_page` (never back to the
leaking body); (4) audit trigger — a reviewed migration replacing `agent__audit_approval_transition` (disabling it
re-opens xm55). No data is written by 262, so nothing needs reversing. If the Auth schema ever changes shape, the
helpers fail closed (`session_not_live` / `user_not_eligible`), they never fail open.

## 10. Residuals and advisories after Phase 2

* GHSA-frh4 — **open for legacy paths** (H2 decide / revoke / grant, Control Center pause / run control remain
  caller-asserted `service_role`); closed for the probe; v2 ready but inactive; §6 signing-key boundary.
* GHSA-xm55 — **closed for new transitions**; historical silent transitions (if any) are counted, not rewritten.
* GHSA-98wq — **inventoried, not changed**: on the replayed schema `anon` / `authenticated` hold TRUNCATE on 151 and
  `service_role` on 154 public tables outside the harness registry (TRUNCATE bypasses RLS; reachable only through SQL,
  not PostgREST). Needs its own reviewed database-wide privilege PR and a read-only check of the hosted grants.
* Threat-model §E — level-2 stops are not linearized with in-flight approved writes (§7); proposed separate PR.
* `agent_control_center_overview.live_workers` counts heartbeats platform-wide (a count, no credential data) — low.
* Step-up — deferred (§8); production grant issuance stays prohibited.

## 11. Effective privilege matrix (measured on a fresh replay of 1–262)

EXECUTE on the 262 entry points (`X` = may execute; `-` = may not). `public` and `anon` and `agent_worker` are `-`
everywhere in every column.

| Function | after 262 (= intended; = staging; = production) | after the CI fixture's `GRANT EXECUTE ON ALL FUNCTIONS … TO service_role` |
|---|---|---|
| `agent_verified_human_probe` | authenticated `X`, service_role `-` | authenticated `X`, service_role `X` (refused inside: `not_authenticated_role`) |
| `agent_tool_approval_decide_v2` | **nobody** (inactive) | service_role `X` (refused inside); authenticated `-` |
| `agent__verified_human_claims`, `agent__verified_human`, `agent__audit_approval_transition` | nobody | service_role `X` (refused inside / trigger function) |
| `agent_control_center_events_page` (replaced read model) | service_role `X` only (unchanged) | unchanged |
| `agent_tool_approval_decide` (243, unchanged) | service_role `X` only | unchanged |

No application role can read `auth.sessions` / `auth.users` in either state. Why the columns differ: only the CI
Database Migration Gate fixture (`ci.yml`) grants EXECUTE on all functions to service_role (the throwaway stack lacks
hosted default grants). Staging Candidate's `prepare-staging-database` grants service_role **tables and sequences
only**, then re-runs `agent_audit_privileges_enforce()`; it grants no function. Hosted default privileges grant new
public functions to anon / authenticated / service_role at creation, which 262 revokes in the same transaction. So on
staging and production the effective ACL is the intended one (left column) and service_role cannot even call the
definers; in CI the in-function role check is what refuses it, and the integration suite proves that refusal for every
entry point (`test_service_role_with_a_broad_function_grant_still_cannot_use_any_entry_point`). The schema contract
tolerates only service_role in the CI column and fails on any end-user widening (8 mutations tested).

## 12. Staging-safe PR plan (not executed)

Fact (verified in `.github/workflows/staging-candidate.yml` on `main`): CI runs on every same-repository PR to `main`
(drafts included); a successful CI `workflow_run` makes `resolve-candidate` eligible for any open same-repo PR whose head
is not `main` (no draft check), and `prepare-staging-database` then runs `staging-migration-apply-workspace.mjs plan`
and, when `has_pending == 'true'`, `apply` against persistent staging. The plan refuses only migrations matching the
destructive-SQL pattern; 262 does not match. All privileged scripts run from a second checkout of trusted `main`; the PR
contributes migrations as data only.

* **Route 1 — owner-authorized PR.** The owner explicitly authorizes opening the Phase 2 PR, acknowledging that the first
  green CI Gate applies 262 to persistent staging (forward-only; any later change to 262 then needs a new migration or
  a staging restore). Cheap; no control-plane change; but an unreviewed security migration (SECURITY DEFINER reading
  Auth tables) reaches shared staging before review, with no digest pin and no approval gate.
* **Route 2 — reviewed-preview gate first (recommended).** A separate, reviewed control-plane PR on `main` (with contract
  tests) makes the trusted staging plan refuse to **auto**-apply any pending migration whose content is
  security-sensitive by rule — e.g. it defines a `SECURITY DEFINER` function or references `auth.` relations — exactly
  as it refuses destructive SQL today. Content-based, so a PR cannot strip a marker to evade it; it does not
  misclassify 262 as destructive. Then 262 follows the existing reviewed-preview procedure: registry entry on `main`
  pinning PR / head SHA / 262 digest and the window, fresh restore-verified staging backup, read-only preflight,
  dispatch of `staging-reviewed-migration-preview.yml`, human approval in the `staging-migration-approval` environment,
  then Staging Candidate for the exact head. Only after that is the Phase 2 PR opened (its Staging Candidate then finds
  262 already applied with the pinned digest).

Recommendation: **Route 2.** 262 is the trust root for human identity at the database boundary; it should be applied to
shared staging only after review, with its digest pinned and a named human approving the apply. Route 1 is acceptable
only with the owner's explicit, informed authorization.

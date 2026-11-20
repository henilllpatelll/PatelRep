-- =============================================================================
-- Migration 262: Agent Harness H7 Phase 2 -- database-verified human identity, tenant-safe credential audit,
--                complete approval-transition audit
-- =============================================================================
-- migration-safety: additive. New functions, one new deferred constraint trigger, and ONE CREATE OR REPLACE of an
--   existing read model with the same signature, owner, volatility, SECURITY INVOKER flag, search_path and ACL. No
--   table, column, policy, row, grant on a table or historical migration changes. No switch, flag, credential, grant
--   or entitlement is created or enabled. Agent execution, paid model calls and customer billing stay disabled.
-- rollback-plan: forward-only. Each new entry point is disabled by a follow-up migration (or the table owner) with
--   REVOKE EXECUTE; agent_tool_approval_decide_v2 is created with NO grant at all, so it is inactive until a separately
--   reviewed migration grants it. The read-model change and the audit trigger are replaced, never removed, by a later
--   reviewed CREATE OR REPLACE. The legacy H2 decide path (243) is not modified.
--
-- What this adds (H7 Phase 2; design: docs/agent-harness/h7-p2-verified-identity.md):
--   (1) agent__verified_human_claims() / agent__verified_human(roles): the database derives the acting human from the
--       PostgREST-verified JWT. Requires the PostgREST role `authenticated` (role GUC) on the `authenticator` login, a
--       well-formed claim set whose sub equals auth.uid() (and the legacy request.jwt.claim.sub when present), an
--       unexpired exp, a session_id naming a LIVE auth.sessions row of that same user (signed out / revoked / ended =
--       refused), an eligible auth.users row (not deleted, not banned, not anonymous), the user's ACTIVE profile hotel
--       (authoritative; a hotel claim, when present, must match it), an active hotel, exactly one active role across
--       all hotels, and that role in the operation's canonical role set (agent__human_authority, FOR SHARE).
--       user_metadata, app roles in claims and caller arguments are never authority. iat is recorded, never trusted.
--       Owner-only (no EXECUTE for any application role). SECURITY DEFINER only because auth.sessions / auth.users are
--       readable by the owner alone; no role gains any right on Auth tables; Auth rows are read, never locked.
--   (2) agent_verified_human_probe(operation): NON-MUTATING proof of (1) over real PostgREST. Returns ok + stable
--       reason code (+ own role/hotel on success). EXECUTE for `authenticated` only.
--   (3) agent_tool_approval_decide_v2(approval, decision, reason): the H2 decision with the actor and hotel derived by
--       the database. Same state machine, events, independence, expiry, tenant, digest and fencing rules as 243 (the
--       243 body is unchanged and stays the only active path). It re-checks inside the database the gates the API
--       applies (ai_control_center entitlement; for approve also the deployment stamp present and not production and
--       platform execution enabled). Created with NO grant: inactive until separately approved.
--   (4) agent_control_center_events_page: platform-scoped worker-credential journal rows (written with tenant_id NULL
--       by the 256/260 journal, which is NOT changed here) are shown only to the hotel the credential is bound to (261
--       scopes), with app_env and expires_at only (label dropped). Unbound credentials are shown to no hotel. Applies
--       to historical and new rows alike; no journal row is changed. Every other row is returned exactly as before.
--   (5) agent_tool_approvals_transition_audit: a DEFERRABLE INITIALLY DEFERRED constraint trigger. At commit, a state
--       transition (approved / rejected / revoked / expired) without its tool event for that approval gets one,
--       attributed to the database role (actor_kind operator, reason out_of_band_change, provenance unverified, the
--       asserted decider kept as asserted_*). Reviewed RPCs already write that event in the same transaction, so they
--       get no duplicate.
-- Not changed: 243 agent_tool_approval_decide / revoke / grant_set (legacy caller-asserted paths remain), 254 guards,
--   256/260 journal, 260 update guard, 261 worker functions, the privilege detector and remover.
-- =============================================================================

DO $pre$
DECLARE
  v_missing text;
BEGIN
  -- 261 recorded (worker tenant binding) and the exact reviewed objects this migration builds on.
  IF to_regprocedure('public.agent__worker_tenant()') IS NULL
     OR to_regclass('public.agent_worker_credential_scopes') IS NULL
     OR to_regclass('public.agent_deployment_identity') IS NULL
     OR to_regclass('public.agent_control_center_events') IS NULL THEN
    RAISE EXCEPTION 'migration 262 requires migration 261 (agent_worker_tenant_binding)' USING ERRCODE = '55000';
  END IF;
  SELECT pg_catalog.string_agg(x.name, ', ') INTO v_missing
    FROM (VALUES ('agent_control_center_events_page', '46523c687cf2221e626c366c7505192a'),
                 ('agent__human_authority', '1a59f0750d1a00b7f7cea33d81d3303d'),
                 ('agent_tool_approval_decide', 'ce2e5d578022a5d4422a7c48168f7701'),
                 ('agent__tool_event', '45b26a004b45bffc9eb7ffc25aa37703'),
                 ('agent__try_uuid', 'a551312274f715cd2a73e70ddf5db76f'),
                 ('agent__journal_control_change', '30071c963f16c289896055d8e0507a42'),
                 ('agent__guard_control_update', '28451748327504469ba6383959ddb805'),
                 ('agent__guard_approval_independence', '3d13d90b9afe9d0e793459fd80b4d256'),
                 ('agent__guard_approval_update', '9068eb9bd7b826f4e5163c4200664807')) AS x(name, body_md5)
   WHERE (SELECT count(*) FROM pg_catalog.pg_proc p
           WHERE p.pronamespace = 'public'::pg_catalog.regnamespace AND p.proname = x.name
             AND pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13), '')) = x.body_md5) <> 1
      OR (SELECT count(*) FROM pg_catalog.pg_proc p
           WHERE p.pronamespace = 'public'::pg_catalog.regnamespace AND p.proname = x.name) <> 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'migration 262 expects the reviewed bodies of: %', v_missing USING ERRCODE = '55000';
  END IF;
  -- Fail closed if any 262 object already exists (never adopt an out-of-band variant).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'public'::pg_catalog.regnamespace
              AND p.proname IN ('agent__verified_human_claims', 'agent__verified_human', 'agent_verified_human_probe',
                                'agent_tool_approval_decide_v2', 'agent__audit_approval_transition'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'agent_tool_approvals_transition_audit') THEN
    RAISE EXCEPTION 'migration 262 objects already exist; refusing to adopt them' USING ERRCODE = '42501';
  END IF;
  -- The Supabase Auth facts the identity design depends on (verified, not assumed). Missing => refuse.
  SELECT pg_catalog.string_agg(x.rel || '.' || x.col, ', ') INTO v_missing
    FROM (VALUES ('sessions', 'id', 'uuid'), ('sessions', 'user_id', 'uuid'),
                 ('sessions', 'not_after', 'timestamp with time zone'),
                 ('users', 'id', 'uuid'), ('users', 'deleted_at', 'timestamp with time zone'),
                 ('users', 'banned_until', 'timestamp with time zone'), ('users', 'is_anonymous', 'boolean')) AS x(rel, col, typ)
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
                      WHERE c.table_schema = 'auth' AND c.table_name = x.rel AND c.column_name = x.col
                        AND c.data_type = x.typ);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'migration 262: the Supabase Auth schema lacks %', v_missing USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL
     OR NOT pg_catalog.has_table_privilege('postgres', 'auth.sessions', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('postgres', 'auth.users', 'SELECT')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticator')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'agent_worker')
     OR pg_catalog.pg_has_role('service_role', 'authenticated', 'MEMBER')
     OR pg_catalog.pg_has_role('agent_worker', 'authenticated', 'MEMBER') THEN
    RAISE EXCEPTION 'migration 262: Auth access or role separation is not as reviewed' USING ERRCODE = '55000';
  END IF;
END
$pre$;

-- -----------------------------------------------------------------------------
-- (1a) The verified token and live session. No locks; never returns a token, email or factor.
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.agent__verified_human_claims()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  c_uuid   CONSTANT text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_claims jsonb;
  v_sub    text;
  v_legacy text;
  v_sid    uuid;
  v_uid    uuid;
  v_now    numeric := extract(epoch FROM now());
  v_hotel  text;
  v_meta   text;
BEGIN
  -- Only PostgREST's authenticated role, on its own login. service_role, anon, agent_worker and any SQL session that
  -- merely set the claim variables are refused here even if a blanket grant ever made the caller able to execute.
  IF current_setting('role', true) IS DISTINCT FROM 'authenticated' OR session_user <> 'authenticator' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated_role');
  END IF;
  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_claims');
  END;
  IF v_claims IS NULL OR jsonb_typeof(v_claims) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_claims');
  END IF;
  IF jsonb_typeof(v_claims->'role') IS DISTINCT FROM 'string' OR v_claims->>'role' <> 'authenticated' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated_role');
  END IF;
  -- COALESCE: a missing aud makes the comparison NULL, and NOT NULL would not refuse (three-valued logic).
  IF NOT COALESCE(v_claims->'aud' = '"authenticated"'::jsonb
                  OR (jsonb_typeof(v_claims->'aud') = 'array' AND v_claims->'aud' ? 'authenticated'), false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_claims');
  END IF;
  v_sub := CASE WHEN jsonb_typeof(v_claims->'sub') = 'string' THEN v_claims->>'sub' END;
  IF v_sub IS NULL OR v_sub !~ c_uuid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_claims');
  END IF;
  v_uid := v_sub::uuid;
  -- auth.uid() prefers the legacy per-claim variable; it must agree with the verified claim set.
  v_legacy := NULLIF(current_setting('request.jwt.claim.sub', true), '');
  IF (v_legacy IS NOT NULL AND v_legacy IS DISTINCT FROM v_sub) OR auth.uid() IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_claims');
  END IF;
  IF jsonb_typeof(v_claims->'exp') IS DISTINCT FROM 'number' OR (v_claims->>'exp')::numeric <= v_now THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'token_expired');
  END IF;
  IF jsonb_typeof(v_claims->'iat') IS DISTINCT FROM 'number' OR (v_claims->>'iat')::numeric > v_now + 60 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_claims');
  END IF;
  IF v_claims->'is_anonymous' = 'true'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'user_not_eligible');
  END IF;
  IF jsonb_typeof(v_claims->'session_id') IS DISTINCT FROM 'string' OR v_claims->>'session_id' !~ c_uuid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_missing');
  END IF;
  v_sid := (v_claims->>'session_id')::uuid;
  -- A live session of THIS user: signed out / revoked (row gone), another user's session, or ended (not_after) = refuse.
  IF NOT EXISTS (SELECT 1 FROM auth.sessions s
                  WHERE s.id = v_sid AND s.user_id = v_uid AND (s.not_after IS NULL OR s.not_after > now())) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_live');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u
                  WHERE u.id = v_uid AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= now())
                    AND u.is_anonymous IS NOT TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'user_not_eligible');
  END IF;
  -- Server-set hotel hints (access-token hook / admin app_metadata) are cross-checks only; user_metadata is never read.
  IF v_claims ? 'hotel_id' AND jsonb_typeof(v_claims->'hotel_id') IS DISTINCT FROM 'string' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_claims');
  END IF;
  v_hotel := v_claims->>'hotel_id';
  IF jsonb_typeof(v_claims->'app_metadata') = 'object' AND v_claims->'app_metadata' ? 'hotel_id' THEN
    IF jsonb_typeof(v_claims->'app_metadata'->'hotel_id') IS DISTINCT FROM 'string' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_claims');
    END IF;
    v_meta := v_claims->'app_metadata'->>'hotel_id';
    IF v_hotel IS NOT NULL AND lower(v_meta) IS DISTINCT FROM lower(v_hotel) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'hotel_mismatch');
    END IF;
    v_hotel := COALESCE(v_hotel, v_meta);
  END IF;
  RETURN jsonb_build_object('ok', true, 'user_id', v_uid, 'session_id', v_sid, 'hotel_claim', v_hotel,
                            'aal', CASE WHEN jsonb_typeof(v_claims->'aal') = 'string' THEN v_claims->>'aal' END,
                            'iat', (v_claims->>'iat')::numeric);
END;
$function$;

-- -----------------------------------------------------------------------------
-- (1b) The verified human's CURRENT authority for one operation (role rows FOR SHARE via agent__human_authority).
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.agent__verified_human(p_roles text[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  c_canonical CONSTANT text[] := ARRAY['chief_engineer', 'engineer', 'front_desk', 'gm', 'housekeeper',
                                       'housekeeping_supervisor'];
  v_claims jsonb;
  v_uid    uuid;
  v_tenant uuid;
  v_active boolean;
  v_total  integer;
  v_here   integer;
  v_role   text;
BEGIN
  IF p_roles IS NULL OR cardinality(p_roles) = 0 OR NOT (p_roles <@ c_canonical) THEN
    RAISE EXCEPTION 'agent__verified_human needs a non-empty set of canonical roles' USING ERRCODE = '22023';
  END IF;
  v_claims := public.agent__verified_human_claims();
  IF NOT COALESCE((v_claims->>'ok')::boolean, false) THEN
    RETURN v_claims;
  END IF;
  v_uid := (v_claims->>'user_id')::uuid;
  -- The authoritative hotel is the person's profile, never a claim or an argument.
  SELECT p.tenant_id, p.is_active INTO v_tenant, v_active FROM public.user_profiles p WHERE p.id = v_uid;
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_member');
  END IF;
  IF v_active IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive_member');
  END IF;
  IF v_claims->>'hotel_claim' IS NOT NULL
     AND public.agent__try_uuid(v_claims->>'hotel_claim') IS DISTINCT FROM v_tenant THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'hotel_mismatch');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = v_tenant AND t.is_active) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'hotel_inactive');
  END IF;
  SELECT count(*), count(*) FILTER (WHERE r.tenant_id = v_tenant) INTO v_total, v_here
    FROM public.user_roles r WHERE r.user_id = v_uid AND r.is_active;
  IF v_here = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_member');
  END IF;
  IF v_total <> 1 OR v_here <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ambiguous_membership');
  END IF;
  -- Re-read under FOR SHARE (a concurrent demotion serialises behind this transaction, exactly as in 243).
  v_role := public.agent__human_authority(v_tenant, v_uid, p_roles);
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'role_not_permitted');
  END IF;
  RETURN jsonb_build_object('ok', true, 'user_id', v_uid, 'tenant_id', v_tenant, 'role', v_role,
                            'session_id', v_claims->'session_id', 'aal', v_claims->'aal', 'iat', v_claims->'iat');
END;
$function$;

-- -----------------------------------------------------------------------------
-- (2) Non-mutating identity probe (the only new entry point any application role can execute)
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.agent_verified_human_probe(p_operation text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_roles text[] := CASE p_operation
                      WHEN 'control_center_gm' THEN ARRAY['gm']
                      WHEN 'tool_approval_review' THEN ARRAY['chief_engineer', 'gm', 'housekeeping_supervisor']
                    END;
  v_who   jsonb;
BEGIN
  IF v_roles IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_operation');
  END IF;
  v_who := public.agent__verified_human(v_roles);
  IF NOT COALESCE((v_who->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', v_who->>'reason', 'operation', p_operation);
  END IF;
  RETURN jsonb_build_object('ok', true, 'operation', p_operation, 'role', v_who->>'role', 'hotel_id', v_who->'tenant_id',
                            'verified_by', 'database', 'step_up', 'none');
END;
$function$;

-- -----------------------------------------------------------------------------
-- (3) Database-authenticated approval decision (INACTIVE: created without any grant)
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.agent_tool_approval_decide_v2(p_approval_id uuid, p_decision text, p_reason_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_claims jsonb;
  v_who    jsonb;
  v_uid    uuid;
  v_tenant uuid;
  v_env    text;
  v_appr   public.agent_tool_approvals%ROWTYPE;
  v_run    public.agent_runs%ROWTYPE;
  v_role   text;
  v_actor  text;
  v_reason text := CASE WHEN p_reason_code ~ '^[a-z][a-z0-9_]{0,63}$' THEN p_reason_code END;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'invalid decision' USING ERRCODE = '22023';
  END IF;
  v_claims := public.agent__verified_human_claims();
  IF NOT COALESCE((v_claims->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', v_claims->>'reason');
  END IF;
  v_uid := (v_claims->>'user_id')::uuid;
  v_actor := 'user:' || v_uid::text;
  SELECT p.tenant_id INTO v_tenant FROM public.user_profiles p WHERE p.id = v_uid AND p.is_active;
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_member');
  END IF;
  -- The gates the API applies, re-checked here: a database-callable mutation must not depend on an API-only flag.
  IF NOT EXISTS (SELECT 1 FROM public.tenant_feature_flags f
                  WHERE f.tenant_id = v_tenant AND f.feature_key = 'ai_control_center' AND f.enabled) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF p_decision = 'approve' THEN
    SELECT d.environment INTO v_env FROM public.agent_deployment_identity d WHERE d.id = 1;
    IF v_env IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'deployment_identity_missing');
    END IF;
    IF v_env = 'production' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'production_refused');
    END IF;
    IF NOT COALESCE((SELECT e.enabled FROM public.agent_execution_enablement e WHERE e.id = 1), false) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'gateway_disabled');
    END IF;
  END IF;

  -- From here: the 243 decision, with the verified actor and hotel (lock order unchanged: approval, run, roles).
  SELECT * INTO v_appr FROM public.agent_tool_approvals WHERE id = p_approval_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_appr.state <> 'requested' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending', 'state', v_appr.state);
  END IF;
  SELECT * INTO v_run FROM public.agent_runs WHERE id = v_appr.run_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_appr.expires_at <= now() OR v_run.state IN ('succeeded', 'failed', 'cancelled', 'dead_letter') THEN
    UPDATE public.agent_tool_approvals
       SET state = CASE WHEN v_appr.expires_at <= now() THEN 'expired' ELSE 'revoked' END,
           ended_by = CASE WHEN v_appr.expires_at <= now() THEN 'recovery:expired' ELSE 'recovery:run_terminal' END,
           ended_at = now()
     WHERE id = v_appr.id RETURNING * INTO v_appr;
    PERFORM public.agent__tool_event(v_tenant, v_appr.run_id, v_appr.invocation_id, v_appr.id, NULL,
                                     CASE WHEN v_appr.state = 'expired' THEN 'approval_expired' ELSE 'approval_revoked' END,
                                     'recovery', 'agent_tool_approval_decide_v2', v_appr.state, NULL, '{}'::jsonb);
    IF v_appr.state = 'expired' THEN
      PERFORM public.agent__end_run_for_approval(v_appr.run_id, 'approval_expired', 'recovery',
                                                 'agent_tool_approval_decide_v2');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', CASE WHEN v_appr.state = 'expired' THEN 'expired' ELSE 'run_terminal' END,
                              'state', v_appr.state);
  END IF;

  v_who := public.agent__verified_human(v_appr.required_approver_roles);
  IF NOT COALESCE((v_who->>'ok')::boolean, false) THEN
    IF v_who->>'reason' = 'role_not_permitted' THEN
      PERFORM public.agent__tool_event(v_tenant, v_appr.run_id, v_appr.invocation_id, v_appr.id, NULL,
                                       'policy_denied', 'human', v_actor, 'approver_not_authorized', NULL,
                                       '{"identity": "database_verified"}'::jsonb);
      RETURN jsonb_build_object('ok', false, 'reason', 'approver_not_authorized');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', v_who->>'reason');
  END IF;
  IF (v_who->>'tenant_id')::uuid IS DISTINCT FROM v_tenant OR (v_who->>'user_id')::uuid IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  v_role := v_who->>'role';
  IF p_decision = 'approve' AND NOT v_appr.approver_may_be_initiator AND v_uid = v_appr.initiated_by_user_id THEN
    PERFORM public.agent__tool_event(v_tenant, v_appr.run_id, v_appr.invocation_id, v_appr.id, NULL,
                                     'policy_denied', 'human', v_actor, 'self_approval_forbidden', NULL,
                                     '{"identity": "database_verified"}'::jsonb);
    RETURN jsonb_build_object('ok', false, 'reason', 'self_approval_forbidden');
  END IF;

  UPDATE public.agent_tool_approvals
     SET state = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
         decided_by_user_id = v_uid, decided_role = v_role, decided_at = now(), decision_reason_code = v_reason
   WHERE id = v_appr.id RETURNING * INTO v_appr;
  PERFORM public.agent__tool_event(v_tenant, v_appr.run_id, v_appr.invocation_id, v_appr.id, NULL,
                                   CASE WHEN p_decision = 'approve' THEN 'approval_approved' ELSE 'approval_rejected' END,
                                   'human', v_actor, v_reason, NULL,
                                   jsonb_build_object('role', v_role, 'identity', 'database_verified'));

  IF v_run.state = 'awaiting_approval' THEN
    IF p_decision = 'approve' THEN
      PERFORM public.agent__set_event_context('operator', v_actor, 'approval_granted');
      UPDATE public.agent_runs SET state = 'queued' WHERE id = v_run.id;
      PERFORM public.agent__dispatch(v_run.id, 0);
      PERFORM public.agent__tool_event(v_tenant, v_run.id, v_appr.invocation_id, v_appr.id, NULL, 'approval_resumed',
                                       'human', v_actor, NULL, NULL, '{"identity": "database_verified"}'::jsonb);
    ELSE
      PERFORM public.agent__set_event_context('operator', v_actor, 'approval_rejected');
      PERFORM public.agent__finish_run(v_run.id, 'failed', 'authorization_denied', 'approval_rejected', false);
    END IF;
  END IF;
  SELECT state INTO v_run.state FROM public.agent_runs WHERE id = v_run.id;
  RETURN jsonb_build_object('ok', true, 'state', v_appr.state, 'run_state', v_run.state, 'approval_id', v_appr.id);
END;
$function$;

-- -----------------------------------------------------------------------------
-- (4) Credential journal rows: only the bound hotel sees them, with permitted metadata only (historical + new)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_control_center_events_page(
  p_tenant_id uuid, p_before_id bigint DEFAULT NULL, p_limit integer DEFAULT 50, p_event_types text[] DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'scope', CASE WHEN e.tenant_id IS NULL AND NOT e.is_credential THEN 'platform' ELSE 'hotel' END,
           'event_type', e.event_type, 'actor_kind', e.actor_kind,
           'actor_user_id', CASE WHEN e.tenant_id IS NOT NULL THEN e.actor_user_id END,
           'subject_type', e.subject_type, 'subject_ref', e.subject_ref, 'reason_code', e.reason_code,
           'detail', CASE WHEN e.is_credential
                          THEN jsonb_strip_nulls(jsonb_build_object('app_env', e.detail->'app_env',
                                                                    'expires_at', e.detail->'expires_at'))
                          ELSE e.detail END,
           'created_at', e.created_at) ORDER BY e.id DESC), '[]'::jsonb)
    FROM (SELECT ev.*,
                 (ev.subject_type = 'worker_credential'
                  OR ev.event_type IN ('worker_credential_issued', 'worker_credential_revoked')) AS is_credential
            FROM public.agent_control_center_events ev
           WHERE (ev.tenant_id = p_tenant_id
                  OR (ev.tenant_id IS NULL
                      AND ((ev.subject_type <> 'worker_credential'
                            AND ev.event_type NOT IN ('worker_credential_issued', 'worker_credential_revoked'))
                           OR EXISTS (SELECT 1 FROM public.agent_worker_credential_scopes s
                                       WHERE s.credential_id = public.agent__try_uuid(ev.subject_ref)
                                         AND s.tenant_id = p_tenant_id))))
             AND (p_before_id IS NULL OR ev.id < p_before_id)
             AND (p_event_types IS NULL OR ev.event_type = ANY (p_event_types))
           ORDER BY ev.id DESC
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)) e;
$function$;

-- -----------------------------------------------------------------------------
-- (5) An approval state transition is never silent (deferred: reviewed RPCs write their event before commit)
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.agent__audit_approval_transition()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_type text;
  v_role text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
BEGIN
  IF TG_OP <> 'UPDATE' OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW' OR TG_TABLE_NAME <> 'agent_tool_approvals' THEN
    RAISE EXCEPTION 'agent__audit_approval_transition runs only as the agent_tool_approvals constraint trigger'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NULL;
  END IF;
  v_type := CASE NEW.state WHEN 'approved' THEN 'approval_approved' WHEN 'rejected' THEN 'approval_rejected'
                           WHEN 'revoked' THEN 'approval_revoked' WHEN 'expired' THEN 'approval_expired' END;
  IF v_type IS NULL THEN
    RETURN NULL;
  END IF;
  -- Each target state is reached at most once per approval (241 transition guard), so "its event exists" is exact.
  IF EXISTS (SELECT 1 FROM public.agent_tool_events e
              WHERE e.invocation_id = NEW.invocation_id AND e.tenant_id = NEW.tenant_id AND e.approval_id = NEW.id
                AND e.event_type = v_type) THEN
    RETURN NULL;
  END IF;
  PERFORM public.agent__tool_event(NEW.tenant_id, NEW.run_id, NEW.invocation_id, NEW.id, NULL, v_type, 'operator',
                                   'db_role:' || left(v_role, 80), 'out_of_band_change', NULL,
                                   jsonb_build_object('provenance', 'unverified',
                                                      'asserted_decided_by_user_id', NEW.decided_by_user_id,
                                                      'asserted_decided_role', NEW.decided_role));
  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER agent_tool_approvals_transition_audit
  AFTER UPDATE ON public.agent_tool_approvals DEFERRABLE INITIALLY DEFERRED
  -- Only real state transitions queue an event: consumption / expiry-only updates queue nothing (and so never block a
  -- later ALTER TABLE in the same transaction with "pending trigger events").
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION public.agent__audit_approval_transition();

-- -----------------------------------------------------------------------------
-- Privileges: exactly one new entry point (the probe, authenticated only); everything else owner-only
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.agent__verified_human_claims() FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent__verified_human(text[]) FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent_verified_human_probe(text) FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent_tool_approval_decide_v2(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent__audit_approval_transition() FROM PUBLIC, anon, authenticated, service_role, agent_worker;
GRANT EXECUTE ON FUNCTION public.agent_verified_human_probe(text) TO authenticated;
-- CREATE OR REPLACE keeps the read model's ACL; re-assert it (service_role only, as in 256).
REVOKE ALL ON FUNCTION public.agent_control_center_events_page(uuid, bigint, integer, text[]) FROM PUBLIC, anon, authenticated, agent_worker;
GRANT EXECUTE ON FUNCTION public.agent_control_center_events_page(uuid, bigint, integer, text[]) TO service_role;

COMMENT ON FUNCTION public.agent__verified_human_claims() IS
  'H7 P2 (262): the PostgREST-verified human (role authenticated on authenticator, sub = auth.uid(), unexpired, live auth.sessions row of that user, eligible auth.users row). Owner-only; reads Auth rows without locks; never returns a token.';
COMMENT ON FUNCTION public.agent__verified_human(text[]) IS
  'H7 P2 (262): agent__verified_human_claims() + the active profile hotel (authoritative), active hotel, exactly one active role across all hotels, and that role in the given canonical set (agent__human_authority, FOR SHARE). Owner-only.';
COMMENT ON FUNCTION public.agent_verified_human_probe(text) IS
  'H7 P2 (262): non-mutating proof of the database-verified human boundary. EXECUTE for authenticated only. Disable with REVOKE EXECUTE.';
COMMENT ON FUNCTION public.agent_tool_approval_decide_v2(uuid, text, text) IS
  'H7 P2 (262): the 243 approval decision with the actor and hotel derived by the database. INACTIVE: no role may execute it until a separately reviewed migration grants it to authenticated.';
COMMENT ON FUNCTION public.agent__audit_approval_transition() IS
  'H7 P2 (262): deferred constraint trigger; an approval state transition without its tool event gets one at commit, attributed to the database role as unverified (GHSA-xm55).';

-- -----------------------------------------------------------------------------
-- Postconditions (fail the migration on any deviation) and read-only reports
-- -----------------------------------------------------------------------------
DO $post$
DECLARE
  v_bad         text;
  v_silent      integer;
  v_cred_rows   integer;
BEGIN
  SELECT pg_catalog.string_agg(x.name, ', ') INTO v_bad
    FROM (VALUES ('agent__verified_human_claims', 's'), ('agent__verified_human', 'v'),
                 ('agent_verified_human_probe', 'v'), ('agent_tool_approval_decide_v2', 'v'),
                 ('agent__audit_approval_transition', 'v')) AS x(name, volatility)
   WHERE (SELECT count(*) FROM pg_catalog.pg_proc p
           WHERE p.pronamespace = 'public'::pg_catalog.regnamespace AND p.proname = x.name AND p.prosecdef
             AND p.provolatile = x.volatility AND p.proowner = 'postgres'::pg_catalog.regrole
             AND p.proconfig = ARRAY['search_path=""']) <> 1
      OR (SELECT count(*) FROM pg_catalog.pg_proc p
           WHERE p.pronamespace = 'public'::pg_catalog.regnamespace AND p.proname = x.name) <> 1
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  CROSS JOIN unnest(ARRAY['public', 'anon', 'service_role', 'agent_worker']) AS g(role_name)
                  WHERE p.pronamespace = 'public'::pg_catalog.regnamespace AND p.proname = x.name
                    AND pg_catalog.has_function_privilege(g.role_name, p.oid, 'EXECUTE'))
      OR (SELECT bool_or(pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
            FROM pg_catalog.pg_proc p
           WHERE p.pronamespace = 'public'::pg_catalog.regnamespace AND p.proname = x.name)
         IS DISTINCT FROM (x.name = 'agent_verified_human_probe');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 262 function shape or ACL is not as reviewed: %', v_bad USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = 'public.agent_control_center_events_page(uuid, bigint, integer, text[])'::pg_catalog.regprocedure
                    AND NOT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']
                    AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
                    AND NOT pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')
                    AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                    AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND NOT pg_catalog.has_function_privilege('agent_worker', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'migration 262: the events read model changed shape or ACL' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.agent_tool_approvals'::pg_catalog.regclass
                    AND t.tgname = 'agent_tool_approvals_transition_audit' AND t.tgenabled = 'O'
                    AND t.tgtype = 17 AND t.tgdeferrable AND t.tginitdeferred AND t.tgconstraint <> 0
                    AND t.tgfoid = 'public.agent__audit_approval_transition()'::pg_catalog.regprocedure) THEN
    RAISE EXCEPTION 'migration 262: the approval transition audit trigger is missing or not deferred' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.agent_audit_privilege_violations())
     OR EXISTS (SELECT 1 FROM public.agent_worker_privilege_violations()) THEN
    RAISE EXCEPTION 'agent privilege violations after migration 262' USING ERRCODE = '42501';
  END IF;
  -- Read-only reports (history is kept; nothing is rewritten).
  SELECT count(*) INTO v_silent FROM public.agent_tool_approvals a
   WHERE a.state <> 'requested'
     AND NOT EXISTS (SELECT 1 FROM public.agent_tool_events e
                      WHERE e.invocation_id = a.invocation_id AND e.tenant_id = a.tenant_id AND e.approval_id = a.id
                        AND e.event_type = 'approval_' || a.state);
  SELECT count(*) INTO v_cred_rows FROM public.agent_control_center_events
   WHERE tenant_id IS NULL AND subject_type = 'worker_credential';
  RAISE NOTICE 'migration 262: % historical approval transition(s) lack their tool event (kept as is; new ones cannot); % platform-scoped credential journal row(s) are now shown only to their bound hotel',
    v_silent, v_cred_rows;
END
$post$;

NOTIFY pgrst, 'reload schema';

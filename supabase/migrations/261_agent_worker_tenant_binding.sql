-- =============================================================================
-- Migration 261: Agent Harness H6 P1 -- per-hotel worker credentials, database environment identity, tenant gates
-- =============================================================================
-- migration-safety: destructive-reviewed
-- rollback-plan: forward-only. Nothing is dropped, renamed, deleted or rewritten; no existing row changes. The
--   destructive-SQL guard flags this file only because it contains the TRUNCATE keyword (BEFORE TRUNCATE refusal
--   triggers on the two new registry tables). Requires 254-260 recorded (checked below). Exact effect:
--   (1) agent_deployment_identity: the database's OWN environment (development|test|staging|production), written once
--       by the table owner (never service_role, never the worker), immutable afterwards. Unstamped = no worker access.
--   (2) agent_worker_credential_scopes: the immutable binding of each worker credential to exactly ONE hotel and one
--       environment, created in the same transaction as the credential (agent_worker_credential_register_v2). The
--       unbound 255 registration path now refuses. A credential is never re-bound, deleted or truncated. A new
--       credential lives at most 7 days (registration RPC, insert trigger, binding trigger and the tenant source all
--       enforce it; the 255 31-day CHECK stays as the outer bound).
--   (3) agent__worker_tenant(): the ONLY source of worker tenancy. role = agent_worker, a registered, active,
--       unexpired jti with a lifetime of at most 7 days, bound, environment = the stamp, hotel active, stamp not production (no production worker in
--       P1), and no person/hotel claims at all. Every other JWT claim is ignored or refused; nothing is read from
--       hotel_id. agent__worker_credential_ok() (255) now means exactly "agent__worker_tenant() IS NOT NULL", so the
--       255 policies and every wrapper's agent__worker_assert() require a bound credential.
--   (4) A RESTRICTIVE policy agent_worker_tenant_gate TO agent_worker on each of the 8 worker-readable tables. It is
--       ANDed with every permissive policy, including the pre-existing TO public tenant_isolation policies that trust
--       the hotel_id claim, so a revoked/expired/unregistered/unbound token reads nothing and a bound one reads only
--       its hotel. Other roles (service_role, authenticated hotel users) are not affected: the policy names only
--       agent_worker.
--   (5) The 23 reviewed wrappers are re-created with the same signatures: each also refuses a run, invocation, step,
--       attempt or tenant argument outside the bound hotel (agent_worker_tenant_mismatch). The claim and the three
--       recovery sweeps call tenant-scoped copies of the unchanged H1-H3 functions (original body + pinned
--       substitutions); the originals keep their exact behaviour for service_role. The runtime-controls snapshot shows
--       only platform rows and the bound hotel; the worker heartbeat requires a "<tenant>:" worker id and an APP_ENV
--       equal to the stamp.
--   (6) The 255 verifier and the 254/256 registry (35 tables / 14 append-only) are re-created as strict supersets (gate
--       present and exact on every worker-readable table). The privilege detector is the 259 allowlist body plus the
--       two new tables' matrix rows (deployment identity: SELECT; credential scopes: SELECT, INSERT, as append-only)
--       and the owner-only check of the new helpers; the remover is the 258 body plus the helpers' revocation. Both
--       keep 258's universe-wide allowlist, the structural TRIGGER/REFERENCES/MAINTAIN check on every relation in
--       public, and 259's "no DELETE for any application role". No credential, stamp, switch or worker deployment is
--       created here. Agent execution, paid model calls and customer billing stay disabled. REVOKE agent_worker FROM
--       authenticator remains the kill switch.
-- Numbering: written and reviewed as migration 257 (PR #239), renumbered to 261 after 257-260 merged with #235. Function
--   bodies are byte-identical to that review (their comments still say "257" = this migration) EXCEPT
--   agent_audit_privilege_violations() and agent_audit_privileges_enforce(), rebuilt on 258/259 below. 258/259/260
--   are not modified: the 259 DELETE guards and the 260 UPDATE guards / journal body stay as they are.
-- =============================================================================

DO $require$
BEGIN
  IF to_regclass('public.agent_worker_credentials') IS NULL OR to_regclass('public.agent_control_center_events') IS NULL
     OR to_regprocedure('public.agent__worker_credential_ok()') IS NULL
     OR to_regprocedure('public.agent__refuse_truncate()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'agent_worker') THEN
    RAISE EXCEPTION 'migration 261 requires migrations 254, 255 and 256' USING ERRCODE = '55000';
  END IF;
  -- 261 replaces the privilege detector and remover, so it must replace exactly the reviewed 259/258 bodies, on a schema
  -- that carries the 259 DELETE guard and the 260 UPDATE guard + journal (never an older or out-of-band variant).
  IF (SELECT pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13), '')) FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.agent_audit_privilege_violations()'::pg_catalog.regprocedure)
       IS DISTINCT FROM '9b368df4cb0eb890ebaa7f7e58d3f582'
     OR (SELECT pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13), '')) FROM pg_catalog.pg_proc p
          WHERE p.oid = 'public.agent_audit_privileges_enforce()'::pg_catalog.regprocedure)
       IS DISTINCT FROM '37248313075777a945bad80155845f7d'
     OR to_regprocedure('public.agent__guard_control_delete()') IS NULL
     OR to_regprocedure('public.agent__guard_control_update()') IS NULL
     OR (SELECT pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13), '')) FROM pg_catalog.pg_proc p
          WHERE p.oid = 'public.agent__journal_control_change()'::pg_catalog.regprocedure)
       IS DISTINCT FROM '30071c963f16c289896055d8e0507a42' THEN
    RAISE EXCEPTION 'migration 261 requires the reviewed migrations 258, 259 and 260' USING ERRCODE = '55000';
  END IF;
END;
$require$;

-- -----------------------------------------------------------------------------
-- (1) The database's own environment identity
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_deployment_identity (
  id           smallint    PRIMARY KEY CHECK (id = 1),
  environment  text        NOT NULL CHECK (environment IN ('development', 'test', 'staging', 'production')),
  stamped_by   text        NOT NULL CHECK (stamped_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  stamped_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_deployment_identity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_deployment_identity FROM PUBLIC, anon, authenticated, service_role, agent_worker;
GRANT SELECT ON TABLE public.agent_deployment_identity TO service_role;
COMMENT ON TABLE public.agent_deployment_identity IS
  'H6 P1 (migration 261): the database''s own environment, stamped ONCE by the table owner (psql as postgres, reviewed runbook step), never by service_role or the worker. Worker credentials must match it; production never grants worker tenancy in P1.';

-- Written once, only by the table owner (or a superuser); never changed, deleted or truncated. Independent of grants:
-- a blanket GRANT to service_role still cannot stamp or restamp.
CREATE OR REPLACE FUNCTION public.agent__guard_deployment_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'the agent deployment identity is immutable' USING ERRCODE = 'P0001';
  END IF;
  IF current_user::text <> (SELECT pg_catalog.pg_get_userbyid(c.relowner)::text FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID)
     AND NOT COALESCE((SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user), false) THEN
    RAISE EXCEPTION 'only the table owner may stamp the agent deployment identity' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- -----------------------------------------------------------------------------
-- (2) Immutable credential -> hotel binding
-- -----------------------------------------------------------------------------
-- No foreign key to tenants: a binding must never block or be erased by tenant offboarding (P2 decides retention);
-- a binding to a missing or inactive hotel simply grants nothing (agent__worker_tenant joins active tenants).
CREATE TABLE IF NOT EXISTS public.agent_worker_credential_scopes (
  credential_id uuid        PRIMARY KEY REFERENCES public.agent_worker_credentials(id) ON DELETE RESTRICT,
  tenant_id     uuid        NOT NULL,
  app_env       text        NOT NULL CHECK (app_env IN ('development', 'test', 'staging', 'production')),
  bound_by      text        NOT NULL CHECK (bound_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  bound_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_worker_credential_scopes_tenant_idx ON public.agent_worker_credential_scopes (tenant_id);
ALTER TABLE public.agent_worker_credential_scopes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_worker_credential_scopes FROM PUBLIC, anon, authenticated, service_role, agent_worker;
GRANT SELECT, INSERT ON TABLE public.agent_worker_credential_scopes TO service_role;
COMMENT ON TABLE public.agent_worker_credential_scopes IS
  'H6 P1 (migration 261): immutable binding of a worker credential (jti) to exactly one hotel and environment, created in the credential''s own registration transaction. Never updated, deleted or truncated.';

CREATE OR REPLACE FUNCTION public.agent__guard_worker_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
DECLARE
  v_cred public.agent_worker_credentials%ROWTYPE;
  v_env  text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'agent worker credential scopes are immutable' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_cred FROM public.agent_worker_credentials c WHERE c.id = NEW.credential_id FOR SHARE;
  -- Bound at birth only: the credential row must have been created by this very transaction, so no earlier (unbound,
  -- possibly already-distributed) credential can ever acquire a hotel.
  IF NOT FOUND OR (SELECT c.xmin FROM public.agent_worker_credentials c WHERE c.id = NEW.credential_id)
                  IS DISTINCT FROM pg_catalog.pg_current_xact_id()::xid THEN
    RAISE EXCEPTION 'agent_worker_scope_not_at_registration' USING ERRCODE = '42501';
  END IF;
  SELECT d.environment INTO v_env FROM public.agent_deployment_identity d WHERE d.id = 1;
  IF v_env IS NULL THEN
    RAISE EXCEPTION 'agent_deployment_identity_missing' USING ERRCODE = '42501';
  END IF;
  IF v_env = 'production' OR NEW.app_env = 'production' THEN
    RAISE EXCEPTION 'agent_worker_production_refused' USING ERRCODE = '42501';
  END IF;
  IF NEW.app_env IS DISTINCT FROM v_env OR v_cred.app_env IS DISTINCT FROM v_env THEN
    RAISE EXCEPTION 'agent_worker_environment_mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_cred.revoked_at IS NOT NULL OR v_cred.expires_at <= now() THEN
    RAISE EXCEPTION 'agent_worker_credential_not_active' USING ERRCODE = '42501';
  END IF;
  IF v_cred.expires_at > v_cred.issued_at + interval '7 days' THEN
    RAISE EXCEPTION 'agent_worker_credential_lifetime_out_of_range' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = NEW.tenant_id AND t.is_active) THEN
    RAISE EXCEPTION 'agent_worker_tenant_not_active' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- Every NEW credential must name the stamped, non-production environment and live at most 7 days from an issue time
-- that is not in the future (a backstop below the registration RPC; the 255 CHECK still caps every row at 31 days).
CREATE OR REPLACE FUNCTION public.agent__guard_worker_credential_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
DECLARE
  v_env text;
BEGIN
  SELECT d.environment INTO v_env FROM public.agent_deployment_identity d WHERE d.id = 1;
  IF v_env IS NULL THEN
    RAISE EXCEPTION 'agent_deployment_identity_missing' USING ERRCODE = '42501';
  END IF;
  IF v_env = 'production' OR NEW.app_env = 'production' THEN
    RAISE EXCEPTION 'agent_worker_production_refused' USING ERRCODE = '42501';
  END IF;
  IF NEW.app_env IS DISTINCT FROM v_env THEN
    RAISE EXCEPTION 'agent_worker_environment_mismatch' USING ERRCODE = '42501';
  END IF;
  IF NEW.issued_at IS NULL OR NEW.issued_at > now() OR NEW.expires_at IS NULL OR NEW.expires_at <= now()
     OR NEW.expires_at > NEW.issued_at + interval '7 days' THEN
    RAISE EXCEPTION 'agent_worker_credential_lifetime_out_of_range' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DO $trg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'agent_deployment_identity_guard'
                  AND tgrelid = 'public.agent_deployment_identity'::regclass) THEN
    CREATE TRIGGER agent_deployment_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON public.agent_deployment_identity
      FOR EACH ROW EXECUTE FUNCTION public.agent__guard_deployment_identity();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'agent_refuse_truncate'
                  AND tgrelid = 'public.agent_deployment_identity'::regclass) THEN
    CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_deployment_identity
      FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'agent_worker_credential_scopes_guard'
                  AND tgrelid = 'public.agent_worker_credential_scopes'::regclass) THEN
    CREATE TRIGGER agent_worker_credential_scopes_guard BEFORE INSERT OR UPDATE OR DELETE ON public.agent_worker_credential_scopes
      FOR EACH ROW EXECUTE FUNCTION public.agent__guard_worker_scope();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'agent_refuse_truncate'
                  AND tgrelid = 'public.agent_worker_credential_scopes'::regclass) THEN
    CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_worker_credential_scopes
      FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'agent_worker_credentials_environment_guard'
                  AND tgrelid = 'public.agent_worker_credentials'::regclass) THEN
    CREATE TRIGGER agent_worker_credentials_environment_guard BEFORE INSERT ON public.agent_worker_credentials
      FOR EACH ROW EXECUTE FUNCTION public.agent__guard_worker_credential_insert();
  END IF;
END;
$trg$;

-- -----------------------------------------------------------------------------
-- (3) The single source of worker tenancy
-- -----------------------------------------------------------------------------
-- PostgREST sets request.jwt.claims from the VERIFIED token. Only role and jti are read; a token that also carries a
-- person or hotel claim is refused outright (a real worker token never has one), so no claim can steer tenancy.
CREATE OR REPLACE FUNCTION public.agent__worker_tenant()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_claims jsonb;
  v_jti    text;
  v_tenant uuid;
BEGIN
  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF v_claims IS NULL OR jsonb_typeof(v_claims) <> 'object' OR v_claims->>'role' IS DISTINCT FROM 'agent_worker'
     OR jsonb_typeof(v_claims->'role') IS DISTINCT FROM 'string'
     OR v_claims ?| ARRAY['sub', 'hotel_id', 'tenant_id', 'user_role', 'app_metadata', 'user_metadata', 'email', 'aal'] THEN
    RETURN NULL;
  END IF;
  v_jti := v_claims->>'jti';
  IF jsonb_typeof(v_claims->'jti') IS DISTINCT FROM 'string'
     OR v_jti !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN NULL;
  END IF;
  SELECT s.tenant_id INTO v_tenant
    FROM public.agent_worker_credentials c
    JOIN public.agent_worker_credential_scopes s ON s.credential_id = c.id AND s.app_env = c.app_env
    JOIN public.agent_deployment_identity d ON d.id = 1 AND d.environment = c.app_env
    JOIN public.tenants t ON t.id = s.tenant_id AND t.is_active
   WHERE c.id = v_jti::uuid AND c.revoked_at IS NULL AND c.expires_at > now()
     AND c.expires_at <= c.issued_at + interval '7 days'  -- P1 lifetime ceiling, independent of the 255 31-day CHECK
     AND d.environment <> 'production';  -- P1: no production worker, whatever is stamped or issued
  RETURN v_tenant;
END;
$function$;

-- 255's check now requires the full binding (used by the 255 agent_worker_read policies and agent__worker_assert()).
CREATE OR REPLACE FUNCTION public.agent__worker_credential_ok()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  RETURN public.agent__worker_tenant() IS NOT NULL;
END;
$function$;

-- Owner-only helper used inside the SECURITY DEFINER wrappers: a run/invocation/step/attempt/tenant that is missing or
-- belongs to another hotel is refused with one code (no existence oracle).
CREATE OR REPLACE FUNCTION public.agent__worker_check_tenant(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_bound uuid := public.agent__worker_tenant();
BEGIN
  IF v_bound IS NULL THEN
    RAISE EXCEPTION 'agent_worker_credential_invalid' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS NULL OR p_tenant_id <> v_bound THEN
    RAISE EXCEPTION 'agent_worker_tenant_mismatch' USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- Reviewed data: the tenant column of every worker-readable table (the gate and the verifier use it).
CREATE OR REPLACE FUNCTION public.agent__worker_tenant_columns()
RETURNS TABLE (table_name text, column_name text) LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT v.table_name, v.column_name FROM (VALUES
    ('tenants', 'id'), ('user_profiles', 'tenant_id'), ('user_roles', 'tenant_id'), ('work_orders', 'tenant_id'),
    ('rooms', 'tenant_id'), ('room_status', 'tenant_id'), ('room_assignments', 'tenant_id'),
    ('room_occupancy_discrepancies', 'tenant_id')
  ) AS v(table_name, column_name);
$function$;

-- -----------------------------------------------------------------------------
-- Operator lifecycle: register + bind atomically (service_role). The 255 unbound path refuses.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_worker_credential_register_v2(
  p_id uuid, p_label text, p_app_env text, p_expires_at timestamptz, p_issued_by text, p_tenant_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_env text;
  v_row public.agent_worker_credentials%ROWTYPE;
BEGIN
  SELECT d.environment INTO v_env FROM public.agent_deployment_identity d WHERE d.id = 1;
  IF v_env IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'deployment_identity_missing');
  END IF;
  IF v_env = 'production' OR p_app_env = 'production' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'production_refused');
  END IF;
  IF p_app_env IS DISTINCT FROM v_env THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'environment_mismatch');
  END IF;
  IF p_tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_tenant_id AND t.is_active) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tenant_not_active');
  END IF;
  -- P1: at most 7 days from now (issued_at defaults to now() in this same transaction).
  IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '7 days' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'lifetime_out_of_range');
  END IF;
  INSERT INTO public.agent_worker_credentials (id, label, app_env, issued_by, expires_at)
  VALUES (p_id, p_label, p_app_env, p_issued_by, p_expires_at)
  ON CONFLICT (id) DO NOTHING
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'credential_exists');
  END IF;
  INSERT INTO public.agent_worker_credential_scopes (credential_id, tenant_id, app_env, bound_by)
  VALUES (v_row.id, p_tenant_id, v_row.app_env, p_issued_by);
  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'tenant_id', p_tenant_id, 'app_env', v_row.app_env,
                            'expires_at', v_row.expires_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_credential_register(
  p_id uuid, p_label text, p_app_env text, p_expires_at timestamptz, p_issued_by text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $function$
BEGIN
  -- 257: an unbound credential would grant nothing; refuse instead of creating one.
  RETURN jsonb_build_object('ok', false, 'reason', 'tenant_binding_required');
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_credentials_list(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label, 'app_env', c.app_env,
                                               'issued_by', c.issued_by, 'issued_at', c.issued_at,
                                               'expires_at', c.expires_at, 'revoked_at', c.revoked_at,
                                               'revoked_by', c.revoked_by, 'revoke_reason', c.revoke_reason,
                                               'tenant_id', s.tenant_id, 'bound', s.credential_id IS NOT NULL,
                                               'active', c.revoked_at IS NULL AND c.expires_at > now()
                                                         AND s.credential_id IS NOT NULL)
                            ORDER BY c.issued_at DESC), '[]'::jsonb)
    FROM (SELECT * FROM public.agent_worker_credentials ORDER BY issued_at DESC
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)) c
    LEFT JOIN public.agent_worker_credential_scopes s ON s.credential_id = c.id;
$function$;

-- -----------------------------------------------------------------------------
-- (5a) Tenant-scoped copies of the global claim and recovery sweeps (owner-only; called by the wrappers below)
-- -----------------------------------------------------------------------------
-- Tenant-scoped copy of public.agent_run_claim(text,integer,integer,integer,integer): the original body with the substitutions pinned in
-- apps/api/tests/integration/agent_worker_scoped_copies.py (equality asserted against pg_proc).
CREATE OR REPLACE FUNCTION public.agent__run_claim_scoped(p_tenant_id uuid, p_worker text, p_lease_seconds integer, p_vt_margin integer, p_poison_read_ct integer, p_blocked_retry integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_lease   integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 60), 5), 900);
  v_margin  integer := LEAST(GREATEST(COALESCE(p_vt_margin, 15), 1), 300);
  v_msg     record;
  v_run_id  uuid;
  v_run     public.agent_runs%ROWTYPE;
  v_step    public.agent_run_steps%ROWTYPE;
  v_block   text;
  v_token   bigint;
  v_takeover boolean;
  v_wait    integer;
  v_valid   boolean;
BEGIN
  IF p_worker IS NULL OR p_worker !~ '^[A-Za-z0-9._:-]{1,100}$' THEN
    RAISE EXCEPTION 'invalid worker id' USING ERRCODE = '22023';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'agent_worker_tenant_required' USING ERRCODE = '42501';
  END IF;
  -- 257: pgmq.read (1.5) restricted to messages naming a run of the bound hotel: same CTE, FIFO order, SKIP
  -- LOCKED, vt and read_ct semantics. A foreign or unattributable message is never read, locked or delayed.
  WITH cte AS (
    SELECT q.msg_id FROM pgmq.q_patelrep_agent_runs_v1 q
      JOIN public.agent_runs r
        ON r.id = CASE WHEN (q.message->>'run_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       THEN (q.message->>'run_id')::uuid END
     WHERE q.vt <= clock_timestamp() AND r.tenant_id = p_tenant_id
     ORDER BY q.msg_id ASC LIMIT 1
     FOR UPDATE OF q SKIP LOCKED)
  UPDATE pgmq.q_patelrep_agent_runs_v1 m
     SET vt = clock_timestamp() + make_interval(secs => v_lease + v_margin), read_ct = m.read_ct + 1
    FROM cte WHERE m.msg_id = cte.msg_id
  RETURNING m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message, m.headers INTO v_msg;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'empty');
  END IF;

  -- Closed envelope schema v1: exactly {"v": 1, "run_id": "<uuid>"}. Evaluated step by step (no reliance on OR order).
  v_valid := jsonb_typeof(v_msg.message) = 'object';
  IF v_valid THEN
    v_valid := COALESCE(v_msg.message->>'v' = '1', false)
           AND COALESCE((v_msg.message->>'run_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false);
  END IF;
  IF v_valid THEN
    v_valid := (SELECT count(*) FROM jsonb_object_keys(v_msg.message)) = 2;
  END IF;
  IF NOT v_valid THEN
    PERFORM pgmq.archive('patelrep_agent_runs_v1', v_msg.msg_id);
    RETURN jsonb_build_object('outcome', 'poison', 'reason', 'malformed_envelope', 'msg_id', v_msg.msg_id);
  END IF;
  v_run_id := (v_msg.message->>'run_id')::uuid;

  SELECT * INTO v_run FROM public.agent_runs WHERE id = v_run_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM pgmq.archive('patelrep_agent_runs_v1', v_msg.msg_id);
    RETURN jsonb_build_object('outcome', 'poison', 'reason', 'unknown_run', 'msg_id', v_msg.msg_id);
  END IF;

  IF v_run.state IN ('succeeded', 'failed', 'cancelled', 'dead_letter') THEN
    PERFORM pgmq.delete('patelrep_agent_runs_v1', v_msg.msg_id);
    RETURN jsonb_build_object('outcome', 'stale_message', 'run_id', v_run.id, 'state', v_run.state);
  END IF;

  PERFORM public.agent__set_event_context('worker', p_worker, NULL);

  IF v_run.queue_msg_id IS NULL THEN
    -- The authoritative message went missing and this one names the run: adopt it rather than enqueue another.
    UPDATE public.agent_runs SET queue_msg_id = v_msg.msg_id WHERE id = v_run.id;
    v_run.queue_msg_id := v_msg.msg_id;
  ELSIF v_run.queue_msg_id <> v_msg.msg_id THEN
    PERFORM pgmq.delete('patelrep_agent_runs_v1', v_msg.msg_id);
    INSERT INTO public.agent_run_events (tenant_id, run_id, event_type, actor_kind, actor_ref, reason_code, detail)
    VALUES (v_run.tenant_id, v_run.id, 'duplicate_delivery', 'worker', p_worker, 'duplicate_message',
            jsonb_build_object('msg_id', v_msg.msg_id, 'authoritative_msg_id', v_run.queue_msg_id));
    RETURN jsonb_build_object('outcome', 'duplicate', 'run_id', v_run.id);
  END IF;

  IF v_msg.read_ct > GREATEST(COALESCE(p_poison_read_ct, 10), 2)
     AND NOT (v_run.lease_expires_at IS NOT NULL AND v_run.lease_expires_at > now()) THEN
    INSERT INTO public.agent_run_events (tenant_id, run_id, event_type, actor_kind, actor_ref, reason_code, detail)
    VALUES (v_run.tenant_id, v_run.id, 'poison_message', 'worker', p_worker, 'redelivery_limit',
            jsonb_build_object('msg_id', v_msg.msg_id, 'read_ct', v_msg.read_ct));
    PERFORM public.agent__set_event_context('worker', p_worker, 'redelivery_limit');
    PERFORM public.agent__finish_run(v_run.id, 'dead_letter', 'poison_message', 'redelivery_limit', true);
    RETURN jsonb_build_object('outcome', 'dead_letter', 'run_id', v_run.id, 'reason', 'redelivery_limit');
  END IF;

  IF v_run.state IN ('paused', 'awaiting_approval') THEN
    -- A paused or approval-waiting run holds no dispatch; resume / approval sends a fresh one.
    PERFORM public.agent__drop_dispatch(v_run.id, v_msg.msg_id, false);
    RETURN jsonb_build_object('outcome', v_run.state, 'run_id', v_run.id);
  END IF;

  IF v_run.lease_expires_at IS NOT NULL AND v_run.lease_expires_at > now() THEN
    v_wait := GREATEST(CEIL(EXTRACT(EPOCH FROM (v_run.lease_expires_at - now())))::integer, 0) + v_margin;
    PERFORM public.agent__redispatch(v_run.id, v_msg.msg_id, v_wait);
    RETURN jsonb_build_object('outcome', 'busy', 'run_id', v_run.id);
  END IF;

  IF v_run.state = 'cancel_requested' THEN
    -- The owning worker's lease expired before it acknowledged: the cancellation completes here.
    PERFORM public.agent__set_event_context('worker', p_worker, 'cancelled_after_lease_expiry');
    PERFORM public.agent__finish_run(v_run.id, 'cancelled', NULL, 'cancelled', false);
    RETURN jsonb_build_object('outcome', 'cancelled', 'run_id', v_run.id);
  END IF;

  IF v_run.deadline_at <= now() THEN
    PERFORM public.agent__set_event_context('worker', p_worker, 'deadline_exceeded');
    PERFORM public.agent__finish_run(v_run.id, 'failed', 'deadline_exceeded', 'deadline_exceeded', false);
    RETURN jsonb_build_object('outcome', 'deadline_exceeded', 'run_id', v_run.id);
  END IF;

  IF v_run.state = 'retry_wait' AND v_run.next_attempt_at > now() THEN
    v_wait := GREATEST(CEIL(EXTRACT(EPOCH FROM (v_run.next_attempt_at - now())))::integer, 1);
    PERFORM public.agent__redispatch(v_run.id, v_msg.msg_id, v_wait);
    RETURN jsonb_build_object('outcome', 'not_due', 'run_id', v_run.id);
  END IF;

  v_block := public.agent__control_block_reason(v_run.tenant_id, v_run.agent_id);
  IF v_block IS NOT NULL THEN
    PERFORM public.agent__redispatch(v_run.id, v_msg.msg_id, LEAST(GREATEST(COALESCE(p_blocked_retry, 30), 1), 3600));
    IF v_run.state = 'running' THEN  -- expired lease of a crashed worker: hand the run back to the queue
      PERFORM public.agent__set_event_context('worker', p_worker, v_block);
      UPDATE public.agent_run_steps SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL
       WHERE run_id = v_run.id AND state = 'running';
      UPDATE public.agent_runs SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL, lease_acquired_at = NULL
       WHERE id = v_run.id;
    END IF;
    INSERT INTO public.agent_run_events (tenant_id, run_id, event_type, actor_kind, actor_ref, reason_code)
    VALUES (v_run.tenant_id, v_run.id, 'control_blocked', 'worker', p_worker, v_block);
    RETURN jsonb_build_object('outcome', 'blocked', 'run_id', v_run.id, 'reason', v_block);
  END IF;

  IF v_run.attempt_count >= v_run.max_attempts THEN
    PERFORM public.agent__set_event_context('worker', p_worker, 'attempts_exhausted');
    PERFORM public.agent__finish_run(v_run.id, 'dead_letter', 'attempts_exhausted', 'attempts_exhausted', true);
    RETURN jsonb_build_object('outcome', 'dead_letter', 'run_id', v_run.id, 'reason', 'attempts_exhausted');
  END IF;

  SELECT * INTO v_step FROM public.agent_run_steps
   WHERE run_id = v_run.id AND state <> 'succeeded' ORDER BY step_number LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_step.state NOT IN ('pending', 'running', 'retry_wait') THEN
    PERFORM public.agent__set_event_context('worker', p_worker, 'inconsistent_run');
    PERFORM public.agent__finish_run(v_run.id, 'dead_letter', 'invalid_job', 'inconsistent_run', true);
    RETURN jsonb_build_object('outcome', 'dead_letter', 'run_id', v_run.id, 'reason', 'inconsistent_run');
  END IF;
  IF v_step.attempt_count >= v_step.max_attempts THEN
    PERFORM public.agent__set_event_context('worker', p_worker, 'step_attempts_exhausted');
    PERFORM public.agent__finish_run(v_run.id, 'dead_letter', 'attempts_exhausted', 'step_attempts_exhausted', true);
    RETURN jsonb_build_object('outcome', 'dead_letter', 'run_id', v_run.id, 'reason', 'step_attempts_exhausted');
  END IF;

  v_takeover := v_run.state = 'running';
  v_token := v_run.fencing_token + 1;
  PERFORM public.agent__set_event_context('worker', p_worker, CASE WHEN v_takeover THEN 'lease_takeover' ELSE 'claimed' END);

  UPDATE public.agent_runs
     SET state = 'running', fencing_token = v_token, lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => v_lease), lease_acquired_at = now(), last_heartbeat_at = now(),
         attempt_count = attempt_count + 1, started_at = COALESCE(started_at, now()), next_attempt_at = NULL,
         current_step_number = v_step.step_number
   WHERE id = v_run.id
  RETURNING * INTO v_run;
  UPDATE public.agent_run_steps
     SET state = 'running', attempt_count = attempt_count + 1, lease_owner = p_worker,
         lease_expires_at = v_run.lease_expires_at, fencing_token = v_token, started_at = COALESCE(started_at, now()),
         next_attempt_at = NULL
   WHERE id = v_step.id
  RETURNING * INTO v_step;
  INSERT INTO public.agent_run_events (tenant_id, run_id, step_id, event_type, attempt, fencing_token, actor_kind, actor_ref, detail)
  VALUES (v_run.tenant_id, v_run.id, v_step.id, CASE WHEN v_takeover THEN 'lease_takeover' ELSE 'claimed' END,
          v_run.attempt_count, v_token, 'worker', p_worker, jsonb_build_object('msg_id', v_msg.msg_id, 'read_ct', v_msg.read_ct));

  RETURN jsonb_build_object('outcome', 'claimed', 'takeover', v_takeover, 'fencing_token', v_token,
                            'lease_expires_at', v_run.lease_expires_at, 'msg_id', v_msg.msg_id,
                            'run', public.agent__run_json(v_run), 'step', public.agent__step_json(v_step));
END;
$function$;

-- Tenant-scoped copy of public.agent_runs_recover(integer): the original body with the substitutions pinned in
-- apps/api/tests/integration/agent_worker_scoped_copies.py (equality asserted against pg_proc).
CREATE OR REPLACE FUNCTION public.agent__runs_recover_scoped(p_tenant_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000);
  v_run public.agent_runs%ROWTYPE;
  v_cancelled integer := 0;
  v_expired integer := 0;
  v_redispatched integer := 0;
  v_delay integer;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'agent_worker_tenant_required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.agent__set_event_context('recovery', 'agent_runs_recover', NULL);

  -- 1. Cancellation requested, but the owning worker's lease has expired: finish the cancellation.
  FOR v_run IN
    SELECT * FROM public.agent_runs
     WHERE tenant_id = p_tenant_id AND state = 'cancel_requested' AND (lease_expires_at IS NULL OR lease_expires_at <= now())
     ORDER BY updated_at LIMIT v_limit FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.agent__set_event_context('recovery', 'agent_runs_recover', 'cancelled_after_lease_expiry');
    PERFORM public.agent__finish_run(v_run.id, 'cancelled', NULL, 'cancelled', false);
    v_cancelled := v_cancelled + 1;
  END LOOP;

  -- 2. Deadline passed and nobody holds a live lease: fail it.
  FOR v_run IN
    SELECT * FROM public.agent_runs
     WHERE tenant_id = p_tenant_id AND state IN ('queued', 'retry_wait', 'paused', 'running') AND deadline_at <= now()
       AND (lease_expires_at IS NULL OR lease_expires_at <= now())
     ORDER BY deadline_at LIMIT v_limit FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.agent__set_event_context('recovery', 'agent_runs_recover', 'deadline_exceeded');
    PERFORM public.agent__finish_run(v_run.id, 'failed', 'deadline_exceeded', 'deadline_exceeded', false);
    v_expired := v_expired + 1;
  END LOOP;

  -- 3. Committed runnable work whose authoritative message is missing: dispatch it again (never a new run).
  FOR v_run IN
    SELECT r.* FROM public.agent_runs r
     WHERE r.tenant_id = p_tenant_id AND (r.state IN ('queued', 'retry_wait')
            OR (r.state = 'running' AND r.lease_expires_at <= now()))
       AND (r.queue_msg_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM pgmq.q_patelrep_agent_runs_v1 q WHERE q.msg_id = r.queue_msg_id))
     ORDER BY r.updated_at LIMIT v_limit FOR UPDATE OF r SKIP LOCKED
  LOOP
    v_delay := CASE WHEN v_run.state = 'retry_wait' AND v_run.next_attempt_at > now()
                    THEN CEIL(EXTRACT(EPOCH FROM (v_run.next_attempt_at - now())))::integer ELSE 0 END;
    PERFORM public.agent__dispatch(v_run.id, v_delay);
    INSERT INTO public.agent_run_events (tenant_id, run_id, event_type, actor_kind, actor_ref, reason_code, detail)
    VALUES (v_run.tenant_id, v_run.id, 'redispatched', 'recovery', 'agent_runs_recover', 'dispatch_missing',
            jsonb_build_object('previous_msg_id', v_run.queue_msg_id));
    v_redispatched := v_redispatched + 1;
  END LOOP;

  RETURN jsonb_build_object('cancelled', v_cancelled, 'deadline_failed', v_expired, 'redispatched', v_redispatched);
END;
$function$;

-- Tenant-scoped copy of public.agent_tool_approvals_expire(integer): the original body with the substitutions pinned in
-- apps/api/tests/integration/agent_worker_scoped_copies.py (equality asserted against pg_proc).
CREATE OR REPLACE FUNCTION public.agent__tool_approvals_expire_scoped(p_tenant_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_limit   integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000);
  v_appr    public.agent_tool_approvals%ROWTYPE;
  v_run     public.agent_runs%ROWTYPE;
  v_expired integer := 0;
  v_closed  integer := 0;
  v_deadline integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'agent_worker_tenant_required' USING ERRCODE = '42501';
  END IF;
  FOR v_appr IN
    SELECT a.* FROM public.agent_tool_approvals a
     WHERE a.tenant_id = p_tenant_id AND a.state IN ('requested', 'approved') AND a.consumed_at IS NULL AND a.expires_at <= now()
     ORDER BY a.expires_at LIMIT v_limit FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.agent_tool_approvals SET state = 'expired', ended_by = 'recovery:expired', ended_at = now()
     WHERE id = v_appr.id;
    PERFORM public.agent__tool_event(v_appr.tenant_id, v_appr.run_id, v_appr.invocation_id, v_appr.id, NULL,
                                     'approval_expired', 'recovery', 'agent_tool_approvals_expire', 'expired', NULL, '{}'::jsonb);
    PERFORM public.agent__end_run_for_approval(v_appr.run_id, 'approval_expired', 'recovery', 'agent_tool_approvals_expire');
    v_expired := v_expired + 1;
  END LOOP;

  FOR v_appr IN
    SELECT a.* FROM public.agent_tool_approvals a JOIN public.agent_runs r ON r.id = a.run_id AND r.tenant_id = a.tenant_id
     WHERE a.tenant_id = p_tenant_id AND a.state IN ('requested', 'approved') AND a.consumed_at IS NULL
       AND r.state IN ('succeeded', 'failed', 'cancelled', 'dead_letter')
     ORDER BY a.created_at LIMIT v_limit FOR UPDATE OF a SKIP LOCKED
  LOOP
    UPDATE public.agent_tool_approvals SET state = 'revoked', ended_by = 'recovery:run_terminal', ended_at = now()
     WHERE id = v_appr.id;
    PERFORM public.agent__tool_event(v_appr.tenant_id, v_appr.run_id, v_appr.invocation_id, v_appr.id, NULL,
                                     'approval_revoked', 'recovery', 'agent_tool_approvals_expire', 'run_terminal', NULL, '{}'::jsonb);
    v_closed := v_closed + 1;
  END LOOP;

  FOR v_run IN
    SELECT * FROM public.agent_runs WHERE tenant_id = p_tenant_id AND state = 'awaiting_approval' AND deadline_at <= now()
     ORDER BY deadline_at LIMIT v_limit FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.agent__set_event_context('recovery', 'agent_tool_approvals_expire', 'deadline_exceeded');
    PERFORM public.agent__finish_run(v_run.id, 'failed', 'deadline_exceeded', 'deadline_exceeded', false);
    v_deadline := v_deadline + 1;
  END LOOP;

  RETURN jsonb_build_object('approvals_expired', v_expired, 'approvals_closed', v_closed, 'deadline_failed', v_deadline);
END;
$function$;

-- Tenant-scoped copy of public.agent_model_attempts_recover(integer,integer): the original body with the substitutions pinned in
-- apps/api/tests/integration/agent_worker_scoped_copies.py (equality asserted against pg_proc).
CREATE OR REPLACE FUNCTION public.agent__model_attempts_recover_scoped(p_tenant_id uuid, p_stale_seconds integer, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_a        public.agent_model_attempts%ROWTYPE;
  v_run      public.agent_runs%ROWTYPE;
  v_released integer := 0;
  v_uncertain integer := 0;
  -- The threshold is only a courtesy delay: an attempt whose worker still holds a live lease is always skipped, a
  -- reserved attempt is safe to release (never dispatched) and a dispatched one only becomes uncertain.
  v_stale    interval := make_interval(secs => greatest(COALESCE(p_stale_seconds, 900), 0));
  v_limit    integer := least(greatest(COALESCE(p_limit, 100), 1), 1000);
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'agent_worker_tenant_required' USING ERRCODE = '42501';
  END IF;
  FOR v_a IN SELECT * FROM public.agent_model_attempts
              WHERE tenant_id = p_tenant_id AND state IN ('reserved', 'dispatched') AND reserved_at < now() - v_stale
              ORDER BY reserved_at LIMIT v_limit FOR UPDATE SKIP LOCKED LOOP
    SELECT * INTO v_run FROM public.agent_runs WHERE id = v_a.run_id;
    -- The worker that owns this attempt still holds a live lease under the same token: leave it alone.
    CONTINUE WHEN v_run.fencing_token = v_a.fencing_token AND v_run.lease_owner = v_a.worker_id
                  AND v_run.lease_expires_at > now();
    IF v_a.state = 'reserved' THEN
      -- The dispatch marker never committed, so the provider was never contacted.
      PERFORM public.agent__model_release(v_a, 'recovered_never_dispatched', 'recovery', 'agent_model_attempts_recover');
      v_released := v_released + 1;
    ELSE
      UPDATE public.agent_model_attempts
         SET state = 'uncertain', reconciliation_required = true, error_code = COALESCE(error_code, 'recovered_unsettled')
       WHERE id = v_a.id;
      PERFORM public.agent__model_event(v_a.tenant_id, v_a.run_id, v_a.id, 'recovered', v_a.reserved_usd,
                                        'recovered_unsettled', 'recovery', 'agent_model_attempts_recover');
      v_uncertain := v_uncertain + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('released', v_released, 'uncertain', v_uncertain);
END;
$function$;

-- -----------------------------------------------------------------------------
-- (5b) The 23 reviewed wrappers, re-created with the same signatures and a bound-hotel check
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_runtime_controls_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  PERFORM public.agent__worker_assert();
  v_tenant := public.agent__worker_tenant();
  -- 257: platform-wide rows (no hotel) and the bound hotel's rows only; never another hotel's pauses.
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('scope', c.scope, 'tenant_id', c.tenant_id, 'agent_id', c.agent_id,
                                                       'paused', c.paused, 'cost_emergency_stop', c.cost_emergency_stop)), '[]'::jsonb)
            FROM (SELECT * FROM public.agent_runtime_controls
                   WHERE tenant_id IS NULL OR tenant_id = v_tenant
                   ORDER BY scope, tenant_id, agent_id LIMIT 1000) c);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_run_claim(p_worker text, p_lease_seconds integer DEFAULT 60, p_vt_margin integer DEFAULT 15, p_poison_read_ct integer DEFAULT 10, p_blocked_retry integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_res jsonb;
BEGIN
  PERFORM public.agent__worker_assert();
  -- 257: only messages of the bound hotel are ever read (agent__run_claim_scoped); the H1/H2 claim logic is unchanged.
  v_res := public.agent__run_claim_scoped(public.agent__worker_tenant(), p_worker, p_lease_seconds, p_vt_margin,
                                          p_poison_read_ct, p_blocked_retry);
  -- Defence in depth: a run any outcome names must belong to the bound hotel, or the whole claim rolls back.
  IF v_res ? 'run_id' OR v_res ? 'run' THEN
    PERFORM public.agent__worker_check_tenant((SELECT r.tenant_id FROM public.agent_runs r
                                                WHERE r.id = public.agent__try_uuid(COALESCE(v_res->>'run_id', v_res->'run'->>'id'))));
  END IF;
  RETURN v_res;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_run_heartbeat(p_run_id uuid, p_fencing_token bigint, p_worker text, p_lease_seconds integer DEFAULT 60, p_vt_margin integer DEFAULT 15)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant((SELECT r.tenant_id FROM public.agent_runs r WHERE r.id = p_run_id));
  RETURN public.agent_run_heartbeat(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_lease_seconds => p_lease_seconds, p_vt_margin => p_vt_margin);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_step_complete(p_run_id uuid, p_step_id uuid, p_fencing_token bigint, p_worker text, p_result_meta jsonb DEFAULT '{}'::jsonb, p_next_step_type text DEFAULT NULL::text, p_next_step_max_attempts integer DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant((SELECT r.tenant_id FROM public.agent_runs r WHERE r.id = p_run_id));
  RETURN public.agent_step_complete(p_run_id => p_run_id, p_step_id => p_step_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_result_meta => p_result_meta, p_next_step_type => p_next_step_type, p_next_step_max_attempts => p_next_step_max_attempts);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_step_fail(p_run_id uuid, p_step_id uuid, p_fencing_token bigint, p_worker text, p_error_class text, p_error_code text, p_retryable boolean, p_retry_delay_seconds integer DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant((SELECT r.tenant_id FROM public.agent_runs r WHERE r.id = p_run_id));
  RETURN public.agent_step_fail(p_run_id => p_run_id, p_step_id => p_step_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_error_class => p_error_class, p_error_code => p_error_code, p_retryable => p_retryable, p_retry_delay_seconds => p_retry_delay_seconds);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_run_acknowledge(p_run_id uuid, p_fencing_token bigint, p_worker text, p_action text, p_reason text DEFAULT NULL::text, p_yield_delay_seconds integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant((SELECT r.tenant_id FROM public.agent_runs r WHERE r.id = p_run_id));
  RETURN public.agent_run_acknowledge(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_action => p_action, p_reason => p_reason, p_yield_delay_seconds => p_yield_delay_seconds);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_runs_recover(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent__runs_recover_scoped(public.agent__worker_tenant(), p_limit);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_worker_heartbeat(p_worker_id text, p_status text, p_app_env text, p_version text, p_concurrency integer, p_in_flight integer, p_started_at timestamp with time zone)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  PERFORM public.agent__worker_assert();
  v_tenant := public.agent__worker_tenant();
  -- 257: a worker id is namespaced by its bound hotel ("<tenant uuid>:<name>") so no credential can overwrite another
  -- hotel's liveness row, and the reported APP_ENV must equal the database's own stamped environment.
  IF p_worker_id IS NULL OR length(p_worker_id) < 38 OR left(p_worker_id, 37) <> v_tenant::text || ':' THEN
    RAISE EXCEPTION 'agent_worker_id_not_bound' USING ERRCODE = '42501';
  END IF;
  IF p_app_env IS DISTINCT FROM (SELECT d.environment FROM public.agent_deployment_identity d WHERE d.id = 1) THEN
    RAISE EXCEPTION 'agent_worker_environment_mismatch' USING ERRCODE = '42501';
  END IF;
  PERFORM public.agent_worker_heartbeat(p_worker_id => p_worker_id, p_status => p_status, p_app_env => p_app_env, p_version => p_version, p_concurrency => p_concurrency, p_in_flight => p_in_flight, p_started_at => p_started_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_tool_authorization_snapshot(p_tenant_id uuid, p_agent_id text, p_agent_version integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant(p_tenant_id);
  RETURN public.agent_tool_authorization_snapshot(p_tenant_id => p_tenant_id, p_agent_id => p_agent_id, p_agent_version => p_agent_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_tool_step_context(p_run_id uuid, p_fencing_token bigint, p_worker text, p_step_number integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant((SELECT r.tenant_id FROM public.agent_runs r WHERE r.id = p_run_id));
  RETURN public.agent_tool_step_context(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_step_number => p_step_number);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_tool_request_approval(p_run_id uuid, p_fencing_token bigint, p_worker text, p_invocation_id uuid, p_approval_policy_id text, p_approver_may_be_initiator boolean, p_ttl_seconds integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant((SELECT r.tenant_id FROM public.agent_runs r WHERE r.id = p_run_id));
  PERFORM public.agent__worker_check_tenant((SELECT i.tenant_id FROM public.agent_tool_invocations i WHERE i.id = p_invocation_id AND i.run_id = p_run_id));
  RETURN public.agent_tool_request_approval(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_invocation_id => p_invocation_id, p_approval_policy_id => p_approval_policy_id, p_approver_may_be_initiator => p_approver_may_be_initiator, p_ttl_seconds => p_ttl_seconds);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_tool_record_outcome(p_run_id uuid, p_fencing_token bigint, p_worker text, p_invocation_id uuid, p_state text, p_result jsonb DEFAULT '{}'::jsonb, p_error_class text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant((SELECT r.tenant_id FROM public.agent_runs r WHERE r.id = p_run_id));
  PERFORM public.agent__worker_check_tenant((SELECT i.tenant_id FROM public.agent_tool_invocations i WHERE i.id = p_invocation_id AND i.run_id = p_run_id));
  RETURN public.agent_tool_record_outcome(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_invocation_id => p_invocation_id, p_state => p_state, p_result => p_result, p_error_class => p_error_class, p_error_code => p_error_code);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_tool_execute_work_order_assign(p_run_id uuid, p_fencing_token bigint, p_worker text, p_invocation_id uuid, p_action_digest text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant((SELECT r.tenant_id FROM public.agent_runs r WHERE r.id = p_run_id));
  PERFORM public.agent__worker_check_tenant((SELECT i.tenant_id FROM public.agent_tool_invocations i WHERE i.id = p_invocation_id AND i.run_id = p_run_id));
  RETURN public.agent_tool_execute_work_order_assign(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_invocation_id => p_invocation_id, p_action_digest => p_action_digest);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_tool_execute_room_assignment(p_run_id uuid, p_fencing_token bigint, p_worker text, p_invocation_id uuid, p_action_digest text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant((SELECT r.tenant_id FROM public.agent_runs r WHERE r.id = p_run_id));
  PERFORM public.agent__worker_check_tenant((SELECT i.tenant_id FROM public.agent_tool_invocations i WHERE i.id = p_invocation_id AND i.run_id = p_run_id));
  RETURN public.agent_tool_execute_room_assignment(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_invocation_id => p_invocation_id, p_action_digest => p_action_digest);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_tool_approvals_expire(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent__tool_approvals_expire_scoped(public.agent__worker_tenant(), p_limit);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_planning_step_context(p_run_id uuid, p_fencing_token bigint, p_worker text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant((SELECT r.tenant_id FROM public.agent_runs r WHERE r.id = p_run_id));
  RETURN public.agent_planning_step_context(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_planning_record_plan(p_run_id uuid, p_fencing_token bigint, p_worker text, p_outcome text, p_plan jsonb, p_plan_digest text, p_reason_codes text[], p_model_attempts integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant((SELECT r.tenant_id FROM public.agent_runs r WHERE r.id = p_run_id));
  RETURN public.agent_planning_record_plan(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_outcome => p_outcome, p_plan => p_plan, p_plan_digest => p_plan_digest, p_reason_codes => p_reason_codes, p_model_attempts => p_model_attempts);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_planning_record_context(p_run_id uuid, p_fencing_token bigint, p_worker text, p_agent_id text, p_agent_version integer, p_context_digest text, p_fact_keys text[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant((SELECT r.tenant_id FROM public.agent_runs r WHERE r.id = p_run_id));
  RETURN public.agent_planning_record_context(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_agent_id => p_agent_id, p_agent_version => p_agent_version, p_context_digest => p_context_digest, p_fact_keys => p_fact_keys);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_billing_attempt_reserve(p_run_id uuid, p_fencing_token bigint, p_worker text, p_step_id uuid, p_logical_call_key text, p_attempt_number integer, p_provider text, p_model text, p_schedule_version text, p_max_input_tokens integer, p_max_output_tokens integer, p_exposure_usd numeric)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant((SELECT r.tenant_id FROM public.agent_runs r WHERE r.id = p_run_id));
  PERFORM public.agent__worker_check_tenant((SELECT s.tenant_id FROM public.agent_run_steps s WHERE s.id = p_step_id AND s.run_id = p_run_id));
  RETURN public.agent_billing_attempt_reserve(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_step_id => p_step_id, p_logical_call_key => p_logical_call_key, p_attempt_number => p_attempt_number, p_provider => p_provider, p_model => p_model, p_schedule_version => p_schedule_version, p_max_input_tokens => p_max_input_tokens, p_max_output_tokens => p_max_output_tokens, p_exposure_usd => p_exposure_usd);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_billing_attempt_dispatch(p_attempt_id uuid, p_run_id uuid, p_fencing_token bigint, p_worker text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant((SELECT r.tenant_id FROM public.agent_runs r WHERE r.id = p_run_id));
  PERFORM public.agent__worker_check_tenant((SELECT a.tenant_id FROM public.agent_model_attempts a WHERE a.id = p_attempt_id AND a.run_id = p_run_id));
  RETURN public.agent_billing_attempt_dispatch(p_attempt_id => p_attempt_id, p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_billing_attempt_release(p_attempt_id uuid, p_fencing_token bigint, p_reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant((SELECT a.tenant_id FROM public.agent_model_attempts a WHERE a.id = p_attempt_id));
  RETURN public.agent_billing_attempt_release(p_attempt_id => p_attempt_id, p_fencing_token => p_fencing_token, p_reason => p_reason);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_billing_attempt_settle(p_attempt_id uuid, p_fencing_token bigint, p_outcome text, p_cost_usd numeric, p_usage_status text, p_usage jsonb, p_cost_status text, p_cost_cause text, p_cost_tier text, p_reported_model text, p_provider_request_id text, p_provider_response_id text, p_error_code text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent__worker_check_tenant((SELECT a.tenant_id FROM public.agent_model_attempts a WHERE a.id = p_attempt_id));
  RETURN public.agent_billing_attempt_settle(p_attempt_id => p_attempt_id, p_fencing_token => p_fencing_token, p_outcome => p_outcome, p_cost_usd => p_cost_usd, p_usage_status => p_usage_status, p_usage => p_usage, p_cost_status => p_cost_status, p_cost_cause => p_cost_cause, p_cost_tier => p_cost_tier, p_reported_model => p_reported_model, p_provider_request_id => p_provider_request_id, p_provider_response_id => p_provider_response_id, p_error_code => p_error_code);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_model_attempts_recover(p_stale_seconds integer DEFAULT 900, p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent__model_attempts_recover_scoped(public.agent__worker_tenant(), p_stale_seconds, p_limit);
END;
$function$;

-- -----------------------------------------------------------------------------
-- Privileges of everything new or re-created above (explicit: hosted default privileges would otherwise grant
-- EXECUTE to anon/authenticated/service_role on new functions).
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.agent__guard_deployment_identity() FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent__guard_worker_scope() FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent__guard_worker_credential_insert() FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent__worker_tenant() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent__worker_tenant() TO agent_worker;  -- evaluated by the RLS gates below
REVOKE ALL ON FUNCTION public.agent__worker_credential_ok() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent__worker_credential_ok() TO agent_worker;  -- evaluated by the 255 policies
REVOKE ALL ON FUNCTION public.agent__worker_check_tenant(uuid) FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent__worker_tenant_columns() FROM PUBLIC, anon, authenticated, agent_worker;
GRANT EXECUTE ON FUNCTION public.agent__worker_tenant_columns() TO service_role;
REVOKE ALL ON FUNCTION public.agent__run_claim_scoped(uuid, text, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent__runs_recover_scoped(uuid, integer) FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent__tool_approvals_expire_scoped(uuid, integer) FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent__model_attempts_recover_scoped(uuid, integer, integer) FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_credential_register_v2(uuid, text, text, timestamptz, text, uuid) FROM PUBLIC, anon, authenticated, agent_worker;
GRANT EXECUTE ON FUNCTION public.agent_worker_credential_register_v2(uuid, text, text, timestamptz, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.agent_worker_credential_register(uuid, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated, agent_worker;
GRANT EXECUTE ON FUNCTION public.agent_worker_credential_register(uuid, text, text, timestamptz, text) TO service_role;
REVOKE ALL ON FUNCTION public.agent_worker_credentials_list(integer) FROM PUBLIC, anon, authenticated, agent_worker;
GRANT EXECUTE ON FUNCTION public.agent_worker_credentials_list(integer) TO service_role;

DO $wrappers$
DECLARE
  v_fn record;
BEGIN
  FOR v_fn IN SELECT p.oid::regprocedure AS sig FROM pg_catalog.pg_proc p
               WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'agent\_worker\_rpc\_\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO agent_worker', v_fn.sig);
  END LOOP;
END;
$wrappers$;

-- -----------------------------------------------------------------------------
-- (4) RESTRICTIVE tenant gates: ANDed with every permissive policy (incl. the legacy TO public hotel_id policies)
-- -----------------------------------------------------------------------------
DO $gates$
DECLARE
  v record;
BEGIN
  FOR v IN SELECT * FROM public.agent__worker_tenant_columns() LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = v.table_name
                    AND policyname = 'agent_worker_tenant_gate') THEN
      EXECUTE format('CREATE POLICY agent_worker_tenant_gate ON public.%I AS RESTRICTIVE FOR ALL TO agent_worker '
                     'USING (%I = (SELECT public.agent__worker_tenant())) WITH CHECK (false)', v.table_name, v.column_name);
    END IF;
  END LOOP;
END;
$gates$;

-- -----------------------------------------------------------------------------
-- (6) Verifier: 255's checks, the tenant function as the second reviewed definer helper, and the gates
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_worker_privilege_violations()
RETURNS TABLE (object_name text, violation text) LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT x.object_name, x.violation FROM (
    SELECT 'role:agent_worker' AS object_name, 'missing' AS violation
     WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'agent_worker')
    UNION ALL
    SELECT 'role:agent_worker', 'privileged_attribute' FROM pg_catalog.pg_roles
     WHERE rolname = 'agent_worker'
       AND (rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolcanlogin OR rolreplication OR rolbypassrls)
    UNION ALL
    SELECT 'role:' || r.rolname, 'membership' FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
     WHERE m.member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'agent_worker')
    UNION ALL
    -- Invoker functions outside this set run with agent_worker's own read-only rights and are not listed.
    SELECT 'function:' || p.oid::regprocedure::text, 'executable_by_worker'
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
       AND (p.prosecdef OR p.proname LIKE 'agent%' OR p.proname LIKE 'billing%'
            OR p.proname IN ('work_order_assign_apply', 'publish_assignment_batch'))
       AND p.proname NOT LIKE 'agent\_worker\_rpc\_\_%'
       AND p.proname NOT IN ('agent__worker_credential_ok', 'agent__worker_tenant')
       AND pg_catalog.has_function_privilege('agent_worker', p.oid, 'EXECUTE')
    UNION ALL
    SELECT 'function:public.agent_worker_rpc__' || a.rpc, 'wrapper_missing'
      FROM public.agent__worker_allowed_rpcs() a(rpc)
     WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                        WHERE n.nspname = 'public' AND p.proname = 'agent_worker_rpc__' || a.rpc AND p.prosecdef
                          AND p.proconfig @> ARRAY['search_path=""'])
    UNION ALL
    SELECT 'function:' || p.oid::regprocedure::text, 'wrapper_not_reviewed'
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'agent\_worker\_rpc\_\_%'
       AND substr(p.proname, 19) NOT IN (SELECT a.rpc FROM public.agent__worker_allowed_rpcs() a(rpc))
    UNION ALL
    SELECT 'function:' || p.oid::regprocedure::text, 'wrapper_executable_by_' || r.role_name
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role']) r(role_name)
     WHERE n.nspname = 'public' AND p.proname LIKE 'agent\_worker\_rpc\_\_%'
       AND pg_catalog.has_function_privilege(r.role_name, p.oid, 'EXECUTE')
    UNION ALL
    -- 257: the two definer helpers the RLS policies evaluate: exactly one overload each, definer, empty search_path,
    -- executable only by agent_worker among the API roles.
    SELECT 'function:public.' || h.proname, 'tenant_helper_unsafe'
      FROM unnest(ARRAY['agent__worker_tenant', 'agent__worker_credential_ok']) h(proname)
     WHERE (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'public'::regnamespace
               AND p.proname = h.proname AND p.pronargs = 0 AND p.prosecdef
               AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']) <> 1
        OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'public'::regnamespace
               AND p.proname = h.proname) <> 1
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role']) r(role_name)
                    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = h.proname
                      AND pg_catalog.has_function_privilege(r.role_name, p.oid, 'EXECUTE'))
    UNION ALL
    SELECT 'table:' || c.oid::regclass::text, 'table_privilege:' || pr.privilege
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr(privilege)
     WHERE n.nspname IN ('public', 'graphql_public') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND pg_catalog.has_table_privilege('agent_worker', c.oid, pr.privilege)
    UNION ALL
    SELECT 'table:' || c.oid::regclass::text, 'column_privilege:' || pr.privilege
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'REFERENCES']) pr(privilege)
     WHERE n.nspname IN ('public', 'graphql_public') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND pg_catalog.has_any_column_privilege('agent_worker', c.oid, pr.privilege)
    UNION ALL
    SELECT 'column:' || c.relname || '.' || a.attname, 'unreviewed_read'
      FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND a.attnum > 0 AND NOT a.attisdropped
       AND pg_catalog.has_column_privilege('agent_worker', c.oid, a.attnum, 'SELECT')
       AND (c.relname::text, a.attname::text) NOT IN (SELECT w.table_name, w.column_name
                                                       FROM public.agent__worker_read_columns() w)
    UNION ALL
    -- 257: every relation the worker can read in an exposed schema is a reviewed plain table with RLS enabled and exactly the
    -- reviewed RESTRICTIVE gate (FOR ALL, TO agent_worker only, tenant column = agent__worker_tenant(), WITH CHECK false).
    SELECT 'table:' || c.oid::regclass::text, 'tenant_gate_missing'
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND n.nspname IN ('public', 'storage', 'graphql_public')  -- every schema PostgREST exposes
       AND pg_catalog.has_any_column_privilege('agent_worker', c.oid, 'SELECT')
       AND NOT (n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
                AND EXISTS (SELECT 1 FROM public.agent__worker_tenant_columns() g
                             JOIN pg_catalog.pg_policy pol ON pol.polrelid = c.oid AND pol.polname = 'agent_worker_tenant_gate'
                            WHERE g.table_name = c.relname AND NOT pol.polpermissive AND pol.polcmd = '*'
                              AND pol.polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'agent_worker')]::oid[]
                              AND pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
                                  = format('(%I = ( SELECT public.agent__worker_tenant() AS agent__worker_tenant))', g.column_name)
                              AND pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) = 'false'))
  ) x
  ORDER BY 1, 2;
$function$;

REVOKE ALL ON FUNCTION public.agent_worker_privilege_violations() FROM PUBLIC, anon, authenticated, agent_worker;
GRANT EXECUTE ON FUNCTION public.agent_worker_privilege_violations() TO service_role;

-- -----------------------------------------------------------------------------
-- (6) The 254/256 registry, violations and enforcement as strict supersets (same signatures)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent__audit_protected_tables()
RETURNS TABLE (table_name text, append_only boolean)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT v.table_name, v.append_only FROM (VALUES
    -- H1 (238)
    ('agent_runs', false), ('agent_run_steps', false), ('agent_run_events', true), ('agent_runtime_controls', false),
    ('agent_worker_heartbeats', false),
    -- H2 (241)
    ('agent_execution_enablement', false), ('agent_tool_controls', false), ('agent_tool_grants', false),
    ('agent_tool_invocations', true), ('agent_tool_approvals', false), ('agent_tool_executions', true),
    ('agent_tool_events', true),
    -- H3 (244, 247)
    ('agent_model_enablement', false), ('agent_model_price_schedules', false), ('agent_model_budget_policies', false),
    ('agent_model_budget_counters', false), ('agent_model_attempts', false), ('agent_model_spend_events', true),
    ('agent_planning_runs', false),
    -- H4 (248, 250)
    ('agent_customer_billing_controls', false), ('agent_customer_pricing_policies', false),
    ('agent_customer_overage_authorizations', true), ('agent_customer_credit_holds', false),
    ('agent_billing_operations', false), ('agent_customer_credit_charges', false),
    ('agent_customer_billing_events', true), ('agent_billing_operation_events', true),
    ('billing_trueup_operations', false), ('billing_trueup_operation_events', true),
    -- H5 (252)
    ('agent_planning_events', true), ('agent_proposal_handoffs', true),
    -- H6 (255, 256)
    ('agent_worker_credentials', false), ('agent_control_center_events', true),
    -- H6 P1 (257): both immutable after insert
    ('agent_worker_credential_scopes', true), ('agent_deployment_identity', true)
  ) AS v(table_name, append_only);
$function$;

COMMENT ON FUNCTION public.agent__audit_protected_tables() IS
  'Reviewed registry (migrations 254, 256, 261) of the 35 H1-H6 harness tables protected from TRUNCATE; append_only marks the 14 whose backend rights are at most SELECT and INSERT (the H6 journal and the deployment identity: SELECT only).';

-- The 259 allowlist detector with exactly two additions (everything else is the 259 body): the deployment identity is
-- SELECT-only for service_role like the journal (the two P1 tables reach the registry through
-- agent__audit_protected_tables() above, so the credential scopes get the append-only SELECT, INSERT), and the P1
-- owner-only helpers are executable by no API role.
CREATE OR REPLACE FUNCTION public.agent_audit_privilege_violations()
RETURNS TABLE (table_name text, role_name text, privilege text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  WITH registry AS (
    SELECT t.table_name, t.append_only, pg_catalog.format('public.%I', t.table_name)::pg_catalog.regclass AS rel
      FROM public.agent__audit_protected_tables() t
  ), universe AS (
    -- every right a table can carry on this server (PostgreSQL 17: arwdDxtm); oid 10 is the bootstrap superuser
    SELECT DISTINCT a.privilege_type AS privilege
      FROM pg_catalog.aclexplode(pg_catalog.acldefault('r', 10::pg_catalog.oid)) a
  ), allowed AS (
    -- the reviewed backend matrix (migrations 238-256 grant S/I/U, S/I and S; 259 removed the fixture-only DELETE;
    -- 261 grants the credential scopes S/I and the deployment identity S)
    SELECT r.table_name, p.privilege
      FROM registry r
     CROSS JOIN LATERAL unnest(CASE
             WHEN r.table_name IN ('agent_control_center_events', 'agent_deployment_identity') THEN ARRAY['SELECT']
             WHEN r.append_only THEN ARRAY['SELECT', 'INSERT']
             -- 259: DELETE is no longer tolerated; rows leave only through a tenant offboarding cascade, which
             -- PostgreSQL runs as the table owner and the row guards admit (tenant row already gone)
             ELSE ARRAY['SELECT', 'INSERT', 'UPDATE']
           END) AS p(privilege)
  ), held AS (
    SELECT r.table_name, g.role_name, u.privilege
      FROM registry r
     CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role', 'agent_worker']) AS g(role_name)
     CROSS JOIN universe u
     WHERE pg_catalog.has_table_privilege(g.role_name, r.rel, u.privilege)
        OR (u.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
            AND pg_catalog.has_any_column_privilege(g.role_name, r.rel, u.privilege))
  ), structural AS (
    -- schema-changing rights on ANY relation in public; no application role needs them (only migrations, as owner)
    SELECT c.relname::text AS table_name, g.role_name, u.privilege
      FROM pg_catalog.pg_class c
     CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role', 'agent_worker']) AS g(role_name)
     CROSS JOIN universe u
     WHERE c.relnamespace = 'public'::pg_catalog.regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND u.privilege IN ('TRIGGER', 'REFERENCES', 'MAINTAIN')
       AND c.relname NOT IN (SELECT r.table_name FROM registry r)
       AND (pg_catalog.has_table_privilege(g.role_name, c.oid, u.privilege)
            OR (u.privilege = 'REFERENCES' AND pg_catalog.has_any_column_privilege(g.role_name, c.oid, u.privilege)))
  )
  SELECT x.table_name, x.role_name, x.privilege FROM (
    -- 258: nothing for end users, PUBLIC or the worker; service_role only within the matrix
    SELECT h.table_name, h.role_name, h.privilege
      FROM held h
     WHERE h.role_name <> 'service_role'
        OR NOT EXISTS (SELECT 1 FROM allowed a WHERE a.table_name = h.table_name AND a.privilege = h.privilege)
    UNION ALL
    -- 258: TRIGGER/REFERENCES/MAINTAIN on every other relation in public (a trigger attached by a non-owner runs as
    --      whoever writes the table, including SECURITY DEFINER code running as the owner)
    SELECT s.table_name, s.role_name, s.privilege FROM structural s
    UNION ALL
    -- 256: the journal writer (SECURITY DEFINER) is executable by no role; only owner-defined triggers call it
    SELECT 'agent__control_center_journal', r.role_name, 'EXECUTE'
      FROM unnest(ARRAY['public', 'anon', 'authenticated', 'service_role', 'agent_worker']) AS r(role_name)
     WHERE pg_catalog.has_function_privilege(r.role_name,
             'public.agent__control_center_journal(uuid, text, text, text, text, text, jsonb)'::pg_catalog.regprocedure,
             'EXECUTE')
    UNION ALL
    -- 261 (H6 P1): the owner-only helpers (row guards, tenant check, scoped claim/sweeps) are executable by no API role
    SELECT p.oid::pg_catalog.regprocedure::text, r.role_name, 'EXECUTE'
      FROM pg_catalog.pg_proc p
     CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role', 'agent_worker']) AS r(role_name)
     WHERE p.pronamespace = 'public'::pg_catalog.regnamespace
       AND p.proname IN ('agent__guard_deployment_identity', 'agent__guard_worker_scope',
                         'agent__guard_worker_credential_insert', 'agent__worker_check_tenant',
                         'agent__run_claim_scoped', 'agent__runs_recover_scoped',
                         'agent__tool_approvals_expire_scoped', 'agent__model_attempts_recover_scoped')
       AND pg_catalog.has_function_privilege(r.role_name, p.oid, 'EXECUTE')
    UNION ALL
    -- 255: everything else the worker contract forbids (role attributes, functions, columns, wrapper grantees; 261: the
    --      tenant gates and the two tenant helpers)
    SELECT w.object_name, 'agent_worker', w.violation FROM public.agent_worker_privilege_violations() w
  ) x
  ORDER BY 1, 2, 3;
$function$;

-- The 258 remover with one addition: it also revokes the P1 helpers (owner-only) and keeps the two tenant helpers the
-- RLS policies evaluate executable by agent_worker alone. Everything else is the 258 body.
CREATE OR REPLACE FUNCTION public.agent_audit_privileges_enforce()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_row   record;
  v_fn    record;
  v_left  text;
  v_count integer;
BEGIN
  -- Remove exactly what the detector reports on relations in public: any right on a registered table, and the
  -- structural rights (TRIGGER, REFERENCES, MAINTAIN) elsewhere. A table-level REVOKE also clears the same right
  -- granted per column. A right that reaches a role only through membership survives and fails closed below.
  FOR v_row IN SELECT DISTINCT v.table_name, v.role_name, v.privilege
                 FROM public.agent_audit_privilege_violations() v
                 JOIN pg_catalog.pg_class c ON c.relname = v.table_name
                  AND c.relnamespace = 'public'::pg_catalog.regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
                WHERE v.role_name IN ('public', 'anon', 'authenticated', 'service_role', 'agent_worker')
                  AND v.privilege IN (SELECT DISTINCT a.privilege_type
                                        FROM pg_catalog.aclexplode(pg_catalog.acldefault('r', 10::pg_catalog.oid)) a)
                  AND (v.table_name IN (SELECT t.table_name FROM public.agent__audit_protected_tables() t)
                       OR v.privilege IN ('TRIGGER', 'REFERENCES', 'MAINTAIN')) LOOP
    EXECUTE pg_catalog.format('REVOKE %s ON TABLE public.%I FROM %s', v_row.privilege, v_row.table_name,
      CASE v_row.role_name WHEN 'public' THEN 'PUBLIC' ELSE pg_catalog.quote_ident(v_row.role_name) END);
  END LOOP;
  REVOKE ALL ON FUNCTION public.agent__control_center_journal(uuid, text, text, text, text, text, jsonb)
    FROM PUBLIC, anon, authenticated, service_role, agent_worker;
  FOR v_fn IN SELECT p.oid::pg_catalog.regprocedure AS sig FROM pg_catalog.pg_proc p
               WHERE p.pronamespace = 'public'::pg_catalog.regnamespace AND p.proname LIKE 'agent\_worker\_rpc\_\_%' LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_fn.sig);
  END LOOP;
  -- 261 (H6 P1): owner-only helpers; the tenant source and the credential check stay executable by agent_worker only
  FOR v_fn IN SELECT p.oid::pg_catalog.regprocedure AS sig FROM pg_catalog.pg_proc p
               WHERE p.pronamespace = 'public'::pg_catalog.regnamespace
                 AND p.proname IN ('agent__guard_deployment_identity', 'agent__guard_worker_scope',
                                   'agent__guard_worker_credential_insert', 'agent__worker_check_tenant',
                                   'agent__run_claim_scoped', 'agent__runs_recover_scoped',
                                   'agent__tool_approvals_expire_scoped', 'agent__model_attempts_recover_scoped') LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, agent_worker',
                              v_fn.sig);
  END LOOP;
  REVOKE ALL ON FUNCTION public.agent__worker_tenant() FROM PUBLIC, anon, authenticated, service_role;
  REVOKE ALL ON FUNCTION public.agent__worker_credential_ok() FROM PUBLIC, anon, authenticated, service_role;
  SELECT pg_catalog.string_agg(pg_catalog.format('%s:%s:%s', v.table_name, v.role_name, v.privilege), ', ') INTO v_left
    FROM public.agent_audit_privilege_violations() v;
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'agent audit privileges could not be enforced; still granted: %', v_left USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_count FROM public.agent__audit_protected_tables();
  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION public.agent_audit_privilege_violations() IS
  'Allowlist check (migrations 258, 259, 261) for the protected harness tables: any table right of PUBLIC, anon, authenticated or agent_worker, any service_role right outside SELECT/INSERT/UPDATE (mutable), SELECT/INSERT (append-only) or SELECT (H6 journal, deployment identity), table- or column-level; TRIGGER/REFERENCES/MAINTAIN of those roles on any relation in public; the H6 journal-writer and P1 owner-only helper EXECUTE; plus the worker-identity checks.';
COMMENT ON FUNCTION public.agent_audit_privileges_enforce() IS
  'Revokes exactly the rights agent_audit_privilege_violations() reports on the protected harness tables after any blanket grant, re-asserts the H6 and H6 P1 function revocations, and fails closed if a forbidden right remains. Run as the table owner (migrations, CI, Staging Candidate).';

REVOKE ALL ON FUNCTION public.agent__audit_protected_tables() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.agent_audit_privilege_violations() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.agent_audit_privileges_enforce() FROM PUBLIC, anon, authenticated, service_role;

-- Repair and postcondition, as in 258/259: snapshot service_role's rights on the protected tables, let the extended
-- remover run, and fail closed unless nothing service_role held within the matrix changed, nothing forbidden remains,
-- the reviewed minimum (258's 33 tables + the two P1 tables) holds exactly over the registry, no application role holds
-- DELETE on a protected table, and the 259 DELETE guards and 260 UPDATE guards are still in place.
DO $post$
DECLARE
  -- table -> rights its creating migration granted to service_role (the reviewed minimum; 258's list + 261)
  v_minimum constant jsonb := jsonb_build_object(
    -- 238 (H1)
    'agent_runs', '["SELECT","INSERT","UPDATE"]'::jsonb, 'agent_run_steps', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_run_events', '["SELECT","INSERT"]'::jsonb, 'agent_runtime_controls', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_worker_heartbeats', '["SELECT","INSERT","UPDATE"]'::jsonb,
    -- 241 (H2)
    'agent_execution_enablement', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_tool_controls', '["SELECT","INSERT","UPDATE"]'::jsonb, 'agent_tool_grants', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_tool_approvals', '["SELECT","INSERT","UPDATE"]'::jsonb, 'agent_tool_invocations', '["SELECT","INSERT"]'::jsonb,
    'agent_tool_executions', '["SELECT","INSERT"]'::jsonb, 'agent_tool_events', '["SELECT","INSERT"]'::jsonb,
    -- 244, 247 (H3); price schedules: SELECT, INSERT only (244)
    'agent_model_enablement', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_model_budget_policies', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_model_budget_counters', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_model_attempts', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_model_price_schedules', '["SELECT","INSERT"]'::jsonb, 'agent_model_spend_events', '["SELECT","INSERT"]'::jsonb,
    'agent_planning_runs', '["SELECT","INSERT","UPDATE"]'::jsonb,
    -- 248, 250 (H4)
    'agent_customer_billing_controls', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_customer_pricing_policies', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_customer_credit_holds', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_customer_credit_charges', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_billing_operations', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_customer_overage_authorizations', '["SELECT","INSERT"]'::jsonb,
    'agent_customer_billing_events', '["SELECT","INSERT"]'::jsonb, 'agent_billing_operation_events', '["SELECT","INSERT"]'::jsonb,
    'billing_trueup_operations', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'billing_trueup_operation_events', '["SELECT","INSERT"]'::jsonb,
    -- 252 (H5)
    'agent_planning_events', '["SELECT","INSERT"]'::jsonb, 'agent_proposal_handoffs', '["SELECT","INSERT"]'::jsonb,
    -- 255, 256 (H6)
    'agent_worker_credentials', '["SELECT","INSERT","UPDATE"]'::jsonb, 'agent_control_center_events', '["SELECT"]'::jsonb,
    -- 261 (H6 P1)
    'agent_worker_credential_scopes', '["SELECT","INSERT"]'::jsonb, 'agent_deployment_identity', '["SELECT"]'::jsonb);
  v_before   text[];
  v_after    text[];
  v_left     text;
  v_missing  text;
  v_unlisted text;
BEGIN
  -- service_role's in-matrix rights before and after the remover (the identity's only in-matrix right is SELECT)
  SELECT pg_catalog.array_agg(pg_catalog.format('%s:%s', t.table_name, p.privilege) ORDER BY 1) INTO v_before
    FROM public.agent__audit_protected_tables() t
   CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']) AS p(privilege)
   WHERE pg_catalog.has_table_privilege('service_role', pg_catalog.format('public.%I', t.table_name), p.privilege)
     AND NOT (t.table_name = 'agent_deployment_identity' AND p.privilege <> 'SELECT');
  PERFORM public.agent_audit_privileges_enforce();
  SELECT pg_catalog.array_agg(pg_catalog.format('%s:%s', t.table_name, p.privilege) ORDER BY 1) INTO v_after
    FROM public.agent__audit_protected_tables() t
   CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']) AS p(privilege)
   WHERE pg_catalog.has_table_privilege('service_role', pg_catalog.format('public.%I', t.table_name), p.privilege)
     AND NOT (t.table_name = 'agent_deployment_identity' AND p.privilege <> 'SELECT');
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'migration 261 changed a service_role right it should have kept' USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.string_agg(v.object_name || ':' || v.violation, ', ') INTO v_left
    FROM public.agent_worker_privilege_violations() v;
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'agent_worker exceeds its reviewed privileges: %', v_left USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.string_agg(pg_catalog.format('%s:%s:%s', v.table_name, v.role_name, v.privilege), ', ') INTO v_left
    FROM public.agent_audit_privilege_violations() v;
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'agent audit privileges violated after 261: %', v_left USING ERRCODE = '42501';
  END IF;
  -- The minimum must cover exactly the registry (a newly registered table needs its entry here and in the contract).
  SELECT pg_catalog.string_agg(coalesce(t.table_name, m.key), ', ') INTO v_unlisted
    FROM public.agent__audit_protected_tables() t
    FULL JOIN pg_catalog.jsonb_object_keys(v_minimum) AS m(key) ON m.key = t.table_name
   WHERE t.table_name IS NULL OR m.key IS NULL;
  IF v_unlisted IS NOT NULL THEN
    RAISE EXCEPTION 'migration 261 minimum matrix does not match the protected registry: %', v_unlisted USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.string_agg(pg_catalog.format('%s:%s', m.key, p.privilege), ', ') INTO v_missing
    FROM pg_catalog.jsonb_each(v_minimum) AS m(key, rights)
   CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(m.rights) AS p(privilege)
   WHERE NOT pg_catalog.has_table_privilege('service_role', pg_catalog.format('public.%I', m.key), p.privilege);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'service_role lost a reviewed backend right: %', v_missing USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.string_agg(pg_catalog.format('%s:%s', t.table_name, g.role_name), ', ') INTO v_left
    FROM public.agent__audit_protected_tables() t
   CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role', 'agent_worker']) AS g(role_name)
   WHERE pg_catalog.has_table_privilege(g.role_name, pg_catalog.format('public.%I', t.table_name), 'DELETE');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'DELETE held on a protected agent table after 261: %', v_left USING ERRCODE = '42501';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger tr
       WHERE tr.tgname = 'agent_control_delete_guard' AND tr.tgenabled = 'O'
         AND tr.tgfoid = 'public.agent__guard_control_delete()'::pg_catalog.regprocedure) <> 7
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger tr
          WHERE tr.tgname = 'agent_control_update_guard' AND tr.tgenabled = 'O'
            AND tr.tgfoid = 'public.agent__guard_control_update()'::pg_catalog.regprocedure) <> 4 THEN
    RAISE EXCEPTION 'migration 261 found the 259 DELETE guards or the 260 UPDATE guards altered' USING ERRCODE = '42501';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';

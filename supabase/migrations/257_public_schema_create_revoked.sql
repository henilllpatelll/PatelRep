-- =============================================================================
-- Migration 257: revoke the legacy PUBLIC CREATE privilege on schema public
-- =============================================================================
-- migration-safety: privilege-only (one REVOKE on schema public; nothing dropped, renamed or rewritten; no row changes)
-- rollback-plan: forward-only. Re-granting would need a new reviewed migration, and scripts/schema-contracts.sql refuses
--   any non-owner CREATE on schema public once this migration (name public_schema_create_revoked) is recorded.
--
-- Why: hosted projects created before PostgreSQL 15 carry `GRANT ALL ON SCHEMA public TO PUBLIC` (USAGE + CREATE);
--   persistent staging has it at every recorded head (240, 243, 254, 256) and no repository migration ever granted it.
--   Every role therefore inherits CREATE on public: anon, authenticated, service_role, authenticator, the platform
--   login roles and the H6 worker identity agent_worker, whose reviewed contract is "no CREATE anywhere" (the reviewed
--   staging preview of 255/256 failed exactly this postcondition, agent_worker_role_restricted). With SECURITY DEFINER
--   functions pinned to a search_path that includes public, PUBLIC CREATE is also the CVE-2018-1058 object-planting
--   precondition. PostgreSQL has no per-role deny, so the privilege can only be removed from PUBLIC.
--   Kept: the schema owner (and its members) keep CREATE; PUBLIC keeps USAGE; explicit USAGE grants are untouched.
--   Fresh PostgreSQL 15+ images (local Supabase, CI) never had the grant, so there this migration is a verified no-op.
--   Supabase services create objects only in their own schemas (auth, storage, realtime, ...) through explicit grants.
-- =============================================================================

-- (1) Fail closed if a role that would lose CREATE owns an object in public (it could no longer CREATE OR REPLACE it).
DO $pre$
DECLARE
  v_owner oid := (SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname = 'public');
  v_bad text;
BEGIN
  SELECT string_agg(DISTINCT pg_catalog.pg_get_userbyid(o.owner), ', ') INTO v_bad
    FROM (SELECT relowner AS owner FROM pg_catalog.pg_class WHERE relnamespace = 'public'::regnamespace
          UNION SELECT proowner FROM pg_catalog.pg_proc WHERE pronamespace = 'public'::regnamespace
          UNION SELECT typowner FROM pg_catalog.pg_type WHERE typnamespace = 'public'::regnamespace
          UNION SELECT oprowner FROM pg_catalog.pg_operator WHERE oprnamespace = 'public'::regnamespace) o
    JOIN pg_catalog.pg_roles r ON r.oid = o.owner
   WHERE NOT r.rolsuper AND NOT pg_catalog.pg_has_role(o.owner, v_owner, 'MEMBER');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Roles own objects in schema public but would lose CREATE on it: %', v_bad USING ERRCODE = '42501';
  END IF;
END
$pre$;

-- (2) The only change.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- (3) Fail closed unless the intended privileges hold: no PUBLIC CREATE, CREATE only for the owner (its members) and
--     superusers, and the API roles keep USAGE. A REVOKE that removed nothing (for example a grant made by another
--     grantor) is caught here instead of being recorded as done.
DO $post$
DECLARE
  v_owner oid := (SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname = 'public');
  v_bad text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n, pg_catalog.aclexplode(n.nspacl) a
              WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE') THEN
    RAISE EXCEPTION 'PUBLIC still holds CREATE on schema public' USING ERRCODE = '42501';
  END IF;
  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO v_bad FROM pg_catalog.pg_roles r
   WHERE r.rolname !~ '^pg_' AND NOT r.rolsuper AND NOT pg_catalog.pg_has_role(r.oid, v_owner, 'MEMBER')
     AND pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Roles other than the owner still hold CREATE on schema public: %', v_bad USING ERRCODE = '42501';
  END IF;
  IF NOT pg_catalog.has_schema_privilege('anon', 'public', 'USAGE')
     OR NOT pg_catalog.has_schema_privilege('authenticated', 'public', 'USAGE')
     OR NOT pg_catalog.has_schema_privilege('service_role', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'An API role lost USAGE on schema public' USING ERRCODE = '42501';
  END IF;
END
$post$;

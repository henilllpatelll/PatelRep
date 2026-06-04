-- Migration 053: Fix JWT role claim for PostgREST compatibility
--
-- Problem: migration 019 puts the app role (gm, housekeeper, etc.) into the
-- top-level "role" claim of the JWT. PostgREST reads "role" and tries
-- SET LOCAL ROLE <value>, which fails because app roles are not PostgreSQL
-- database roles. This breaks all direct Supabase client queries (mobile app).
--
-- Fix: store the app role under "user_role" instead. Leave "role" alone so
-- PostgREST gets "authenticated" (the actual PostgreSQL role it expects).

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims        jsonb;
  user_hotel_id text;
  user_role     text;
BEGIN
  claims := event -> 'claims';

  SELECT r.tenant_id::text, r.role
  INTO   user_hotel_id, user_role
  FROM   public.user_roles r
  WHERE  r.user_id = (event ->> 'user_id')::uuid
    AND  r.is_active = true
  ORDER  BY r.created_at DESC
  LIMIT  1;

  IF user_hotel_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{hotel_id}',  to_jsonb(user_hotel_id));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));
    -- Do NOT override '{role}' — PostgREST needs it to remain "authenticated"
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT   EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE  EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

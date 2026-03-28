-- Migration 022: JWT hook — surface null-role state
-- When a user has no active role (invitation not accepted, role deactivated),
-- inject a 'pending_invite' claim instead of silently omitting hotel_id/role.
-- The API middleware and frontend can then return a clear error rather than
-- silently failing every RLS-gated query.

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

  -- Look up the active role for this user
  SELECT r.tenant_id::text, r.role
  INTO   user_hotel_id, user_role
  FROM   public.user_roles r
  WHERE  r.user_id = (event ->> 'user_id')::uuid
    AND  r.is_active = true
  ORDER  BY r.created_at DESC   -- newest role wins if somehow multiple rows
  LIMIT  1;

  IF user_hotel_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{hotel_id}',       to_jsonb(user_hotel_id));
    claims := jsonb_set(claims, '{role}',           to_jsonb(user_role));
    claims := jsonb_set(claims, '{pending_invite}', 'false'::jsonb);
  ELSE
    -- No active role: mark as pending so the app can show a clear error
    claims := jsonb_set(claims, '{pending_invite}', 'true'::jsonb);
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Permissions unchanged from migration 019
GRANT   EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE  EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

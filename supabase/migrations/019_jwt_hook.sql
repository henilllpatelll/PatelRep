-- Migration 019: Custom Access Token Hook (JWT Claims)
-- Injects hotel_id and role into every JWT so middleware and API auth
-- can trust custom claims without extra DB round-trips.
--
-- After running this migration you MUST register the hook in:
--   Supabase Dashboard → Authentication → Hooks
--   Hook type: Customize Access Token (JWT Claims)
--   Function: public.custom_access_token_hook

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
    claims := jsonb_set(claims, '{hotel_id}', to_jsonb(user_hotel_id));
    claims := jsonb_set(claims, '{role}',     to_jsonb(user_role));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Only supabase_auth_admin (the auth service) may call this function.
-- Remove access from all other roles to prevent privilege escalation.
GRANT   EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE  EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

-- Phase 2 (mobile settings): safe self-service profile editing + private avatar storage.
--
-- 1. user_profiles.avatar_path: key of the caller's own photo in the private `avatars` bucket.
--    (avatar_url stays the GM-managed external URL used by the web app.)
-- 2. The existing "own_profile_write" RLS policy lets a signed-in user UPDATE *every* column of
--    their own row (tenant_id, full_name, is_active, ...). A trigger now restricts direct
--    authenticated (PostgREST) updates to the self-service columns. The API's service-role
--    connection and SQL migrations are unaffected, so GM staff editing keeps working.
-- 3. Private `avatars` bucket with no storage.objects policies: only the API (service role) writes,
--    and clients read through short-lived signed URLs.

ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS avatar_path TEXT;

COMMENT ON COLUMN public.user_profiles.avatar_path IS
  'Storage key in the private avatars bucket ({tenant_id}/{user_id}/{file}); written only by the API.';

CREATE OR REPLACE FUNCTION public.enforce_user_profile_self_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only constrain end-user (PostgREST "authenticated") writes.
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF NEW.id            IS DISTINCT FROM OLD.id
  OR NEW.tenant_id     IS DISTINCT FROM OLD.tenant_id
  OR NEW.full_name     IS DISTINCT FROM OLD.full_name
  OR NEW.phone         IS DISTINCT FROM OLD.phone
  OR NEW.employee_id   IS DISTINCT FROM OLD.employee_id
  OR NEW.avatar_url    IS DISTINCT FROM OLD.avatar_url
  OR NEW.avatar_path   IS DISTINCT FROM OLD.avatar_path
  OR NEW.is_active     IS DISTINCT FROM OLD.is_active
  OR NEW.hire_date     IS DISTINCT FROM OLD.hire_date
  OR NEW.created_at    IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'user_profiles: this field is managed by your hotel'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_profiles_self_update_guard ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_self_update_guard
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_profile_self_update();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', FALSE, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = FALSE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

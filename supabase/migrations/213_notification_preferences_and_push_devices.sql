-- Mobile Settings Phase 4: per-person notification preferences and multi-device push registration.
-- Additive only. The legacy user_profiles.expo_push_token column is left untouched (old API builds keep
-- reading it); new registrations live in push_devices.

-- ---------------------------------------------------------------------------
-- notification_preferences: one row per (property, person, category). A missing row means "default"
-- (enabled), so a new category never needs a backfill. The API is the only writer (service role); a
-- signed-in client may only read its own rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  tenant_id  UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category   TEXT        NOT NULL CHECK (category ~ '^[a-z][a-z_]{0,39}$'),
  enabled    BOOLEAN     NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, category)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_notification_preferences_read" ON public.notification_preferences
  FOR SELECT
  USING (
    tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid
    AND user_id = (SELECT auth.uid())
  );

COMMENT ON TABLE public.notification_preferences IS
  'Per-person opt-outs for OPTIONAL push delivery by category. Never gates the in-app inbox row or any operational record. Written only by the API.';

-- ---------------------------------------------------------------------------
-- push_devices: one row per physical install that may receive push for a person. Rows are revoked,
-- never deleted, so delivery diagnostics survive; a token is active for at most one person at a time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_devices (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token TEXT        NOT NULL,
  installation_id TEXT,
  platform        TEXT        CHECK (platform IN ('ios', 'android')),
  app_version     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  revoke_reason   TEXT
);

-- A token belongs to one active registration; a phone handed to a new employee detaches the old one.
CREATE UNIQUE INDEX IF NOT EXISTS push_devices_active_token_uidx
  ON public.push_devices (expo_push_token) WHERE revoked_at IS NULL;

-- One active registration per install per person: a rotated token replaces the old one.
CREATE UNIQUE INDEX IF NOT EXISTS push_devices_active_install_uidx
  ON public.push_devices (tenant_id, user_id, installation_id)
  WHERE revoked_at IS NULL AND installation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS push_devices_active_user_idx
  ON public.push_devices (tenant_id, user_id) WHERE revoked_at IS NULL;

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
-- No client policies: tokens are written and read only by the API (service role).

COMMENT ON TABLE public.push_devices IS
  'Expo push registrations per person and install. Active = revoked_at IS NULL. API-only.';

-- Carry existing single-device registrations over. A token that appears on more than one profile is
-- ambiguous, so it is skipped (that device simply re-registers on next launch) rather than guessed.
INSERT INTO public.push_devices (tenant_id, user_id, expo_push_token)
SELECT p.tenant_id, p.id, p.expo_push_token
FROM public.user_profiles p
WHERE p.expo_push_token IS NOT NULL
  AND p.tenant_id IS NOT NULL
  AND p.expo_push_token IN (
    SELECT expo_push_token FROM public.user_profiles
    WHERE expo_push_token IS NOT NULL
    GROUP BY expo_push_token HAVING count(*) = 1
  )
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
ON CONFLICT DO NOTHING;

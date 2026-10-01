-- Phase 5: general tenant-scoped product feature flags (release control, deploy != release).
-- Purely additive. Does NOT touch or migrate the existing single-purpose flags
-- (tenants.web_redesign_sections, tenants.opera_pilot_enabled) — those stay as-is.
--
-- Fail-closed by design: a missing row for (tenant_id, feature_key) means the
-- feature is OFF. Application code (apps/api/core/feature_flags.py) never
-- special-cases "no row" vs "row with enabled=false" — both resolve to False.

CREATE TABLE IF NOT EXISTS public.tenant_feature_flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  feature_key   TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT NOT NULL,
  UNIQUE (tenant_id, feature_key)
);

COMMENT ON TABLE public.tenant_feature_flags IS
  'General-purpose per-tenant release flags. Missing row = OFF (fail-closed). Written only by the admin-only feature-rollout GitHub Action via the service-role client, never by the app API.';
COMMENT ON COLUMN public.tenant_feature_flags.updated_by IS
  'Change actor identifier, e.g. github-actions:feature-rollout:<run_id>:<actor>. Never a credential.';

CREATE INDEX IF NOT EXISTS idx_tenant_feature_flags_tenant ON public.tenant_feature_flags (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_feature_flags_key ON public.tenant_feature_flags (feature_key);

ALTER TABLE public.tenant_feature_flags ENABLE ROW LEVEL SECURITY;

-- Mirrors migration 016's tenant_isolation pattern, SELECT-only: authenticated
-- users may read their own tenant's flag rows (e.g. for future client-side RLS
-- reads), but there is deliberately no INSERT/UPDATE/DELETE policy at all, so
-- only the service-role client (which bypasses RLS entirely) can write. That
-- is what keeps writes to the rollout workflow only.
CREATE POLICY "tenant_isolation_select" ON public.tenant_feature_flags
  FOR SELECT
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- feature_flag_events: append-only audit trail of every flag change.
-- Never relies solely on GitHub Action run logs — this is the durable record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feature_flag_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  feature_key    TEXT NOT NULL,
  old_value      BOOLEAN,
  new_value      BOOLEAN NOT NULL,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_source  TEXT NOT NULL
);

COMMENT ON TABLE public.feature_flag_events IS
  'Append-only audit trail for tenant_feature_flags changes. old_value NULL means the row did not exist before (prior state was fail-closed OFF). Service-role write-only; never exposed over the app API.';
COMMENT ON COLUMN public.feature_flag_events.change_source IS
  'e.g. github-actions:feature-rollout:<run_id>:<actor>. Never a credential.';

CREATE INDEX IF NOT EXISTS idx_feature_flag_events_tenant_key ON public.feature_flag_events (tenant_id, feature_key);
CREATE INDEX IF NOT EXISTS idx_feature_flag_events_changed_at ON public.feature_flag_events (changed_at);

ALTER TABLE public.feature_flag_events ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policy at all: this table is written and read
-- exclusively via the service-role client (rollout workflow writes, status
-- script reads). RLS is enabled purely so no future authenticated-role grant
-- accidentally exposes it.

-- ROLLBACK:
-- DROP TABLE IF EXISTS public.feature_flag_events;
-- DROP TABLE IF EXISTS public.tenant_feature_flags;

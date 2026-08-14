ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS web_redesign_sections TEXT[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.tenants.web_redesign_sections IS
  'Per-section v2.0 redesign rollout gate. Each element is a section key (e.g. "shell","tasks","engineering") whose redesigned UI is live for this tenant. Empty = all old UI. DB/admin-flipped, no GM toggle. Removed in the v2.0 cleanup once all tenants migrated (v2.0 FOUND-06).';

-- ROLLBACK:
-- ALTER TABLE public.tenants DROP COLUMN web_redesign_sections;

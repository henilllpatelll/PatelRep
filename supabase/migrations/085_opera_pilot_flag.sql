ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS opera_pilot_enabled BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN public.tenants.opera_pilot_enabled IS
  'Gates Opera Cloud/OHIP connect, sync, and webhook processing to explicitly enrolled pilot hotels (Phase 6 D-03).';

-- ROLLBACK:
-- ALTER TABLE public.tenants DROP COLUMN opera_pilot_enabled;

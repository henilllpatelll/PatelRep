ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN public.tenants.is_test IS
  'Marks a tenant as dev/QA test data eligible for the cleanup script. Standing QA fixture(s) stay FALSE. (Phase 21 QA-01).';

-- ROLLBACK:
-- ALTER TABLE public.tenants DROP COLUMN is_test;

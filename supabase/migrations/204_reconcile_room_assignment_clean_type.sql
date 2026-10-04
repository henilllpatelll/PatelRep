-- Forward reconciliation point for the grandfathered duplicate 042_room_assignment_clean_type.sql.
-- Production history cannot prove which numeric 042 row corresponds to that file, but its effects were proven
-- present. This idempotent migration re-asserts the canonical contract with a unique, deterministic identifier.
-- It never drops data: NULLs are repaired to 'DEP' before NOT NULL is enforced, and an equivalent allowed-values
-- CHECK is added only when none exists. The historical 042 file is intentionally left untouched.
DO $$
BEGIN
  ALTER TABLE public.room_assignments ADD COLUMN IF NOT EXISTS clean_type TEXT DEFAULT 'DEP';

  UPDATE public.room_assignments SET clean_type = 'DEP' WHERE clean_type IS NULL;

  ALTER TABLE public.room_assignments ALTER COLUMN clean_type SET DEFAULT 'DEP';
  ALTER TABLE public.room_assignments ALTER COLUMN clean_type SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.room_assignments'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%clean_type%'
      AND pg_get_constraintdef(c.oid) LIKE '%DEP%'
      AND pg_get_constraintdef(c.oid) LIKE '%FULL%'
      AND pg_get_constraintdef(c.oid) LIKE '%LIGHT%'
  ) THEN
    ALTER TABLE public.room_assignments
      ADD CONSTRAINT room_assignments_clean_type_check CHECK (clean_type IN ('DEP', 'FULL', 'LIGHT'));
  END IF;
END
$$;

COMMENT ON COLUMN public.room_assignments.clean_type IS
  'Opera housekeeping task code for the assigned clean: DEP, FULL, or LIGHT.';

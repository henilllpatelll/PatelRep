-- =============================================================================
-- Migration 226: call-outs and emergency shift coverage
-- (Team Scheduling & Shift Coverage V2, Phase 4)
-- =============================================================================
-- Adds the persistence for the workflows declared in services/scheduling_contracts.py:
--   absence_records   a supervisor-recorded call-out / early departure for ONE scheduled shift
--   coverage_gaps     a shift occurrence that needs a person (born from an absence, or posted as an open shift)
--   coverage_offers   "will you take this shift?" -- an offer is NOT a scheduled shift
--   coverage_claims   an employee's interest in a claimable open shift; a supervisor approves or declines it
--
-- The original shift_assignments row is NEVER rewritten or deleted by this feature: it stays as the history of who
-- was scheduled. A fill inserts a NEW shift_assignments row for the replacement (migration 225's trigger still
-- enforces no-overlap per employee) and links it from the gap.
--
-- fill_coverage_gap() is the only multi-table step and is ONE function (one transaction): it locks the gap, checks
-- status + version, inserts the replacement assignment, marks the gap filled, marks the absence covered and settles
-- the offers/claims. Everything else is a single-row compare-and-set done by the API.
--
-- Not touched: hk_shift_sessions (attendance), room_assignments, shift_assignments rows that already exist.
--
-- migration-safety: additive
-- rollback-plan: remove public.fill_coverage_gap(uuid, uuid, integer, jsonb, text, uuid, uuid, uuid), then remove coverage_claims, coverage_offers, coverage_gaps and absence_records in that order (reverse of their foreign keys). Nothing existing depends on them and no existing table or row is modified.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.absence_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assignment_id  uuid NOT NULL REFERENCES public.shift_assignments(id) ON DELETE CASCADE,
  department_id  uuid,
  work_date      date NOT NULL,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('called_out', 'unavailable', 'leaving_early', 'emergency', 'other')),
  status         text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('reported', 'confirmed', 'covered', 'withdrawn')),
  leaving_at     timestamptz,
  note           text,
  withdraw_reason text,
  recorded_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at   timestamptz,
  idempotency_key text,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT absence_records_window_check CHECK (ends_at > starts_at),
  CONSTRAINT absence_records_leaving_check CHECK (kind <> 'leaving_early' OR leaving_at IS NOT NULL)
);
COMMENT ON TABLE public.absence_records IS
  'A supervisor-confirmed absence for one scheduled shift. NOT attendance: hk_shift_sessions stays the only attendance source and a missing clock-in never creates a row here.';
COMMENT ON COLUMN public.absence_records.note IS
  'Operational note, visible to managers only. Must not hold medical or other sensitive personal detail.';

-- One live absence per scheduled shift: a second call-out for the same shift is a duplicate, not a new record.
CREATE UNIQUE INDEX IF NOT EXISTS uq_absence_live_per_assignment
  ON public.absence_records (assignment_id) WHERE status IN ('reported', 'confirmed', 'covered');
CREATE UNIQUE INDEX IF NOT EXISTS uq_absence_idempotency
  ON public.absence_records (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_absence_tenant_date ON public.absence_records (tenant_id, work_date);
CREATE INDEX IF NOT EXISTS idx_absence_user ON public.absence_records (tenant_id, user_id, work_date);

CREATE TABLE IF NOT EXISTS public.coverage_gaps (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  department_id           uuid NOT NULL,
  source                  text NOT NULL CHECK (source IN ('absence', 'open_shift')),
  absence_id              uuid REFERENCES public.absence_records(id) ON DELETE CASCADE,
  original_assignment_id  uuid REFERENCES public.shift_assignments(id) ON DELETE SET NULL,
  shift_id                uuid NOT NULL REFERENCES public.shifts(id) ON DELETE NO ACTION,
  shift_name              text NOT NULL,
  work_date               date NOT NULL,
  start_time              time NOT NULL,
  end_time                time NOT NULL,
  starts_at               timestamptz NOT NULL,
  ends_at                 timestamptz NOT NULL,
  required_role           text,
  status                  text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'offered', 'filled', 'waived')),
  claimable               boolean NOT NULL DEFAULT false,
  resolution              text CHECK (resolution IN ('direct_assignment', 'offer_accepted', 'claim_approved', 'waived', 'cancelled')),
  resolution_reason       text,
  filled_assignment_id    uuid REFERENCES public.shift_assignments(id) ON DELETE SET NULL,
  filled_user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes                   text,
  version                 integer NOT NULL DEFAULT 1,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at             timestamptz,
  idempotency_key         text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coverage_gaps_window_check CHECK (ends_at > starts_at),
  CONSTRAINT coverage_gaps_absence_link_check CHECK ((source = 'absence') = (absence_id IS NOT NULL)),
  CONSTRAINT coverage_gaps_filled_check CHECK (status <> 'filled' OR filled_assignment_id IS NOT NULL OR filled_user_id IS NOT NULL),
  CONSTRAINT coverage_gaps_waived_check CHECK (status <> 'waived' OR resolution_reason IS NOT NULL)
);
COMMENT ON TABLE public.coverage_gaps IS
  'A shift occurrence that needs a person. status filled is only written by fill_coverage_gap(), together with the replacement assignment.';

-- A called-out shift has at most one live gap.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gap_live_per_absence
  ON public.coverage_gaps (absence_id) WHERE absence_id IS NOT NULL AND status IN ('open', 'offered', 'filled');
CREATE UNIQUE INDEX IF NOT EXISTS uq_gap_idempotency
  ON public.coverage_gaps (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gap_tenant_status_date ON public.coverage_gaps (tenant_id, status, work_date);

CREATE TABLE IF NOT EXISTS public.coverage_offers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  gap_id        uuid NOT NULL REFERENCES public.coverage_gaps(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'expired', 'superseded')),
  expires_at    timestamptz,
  offered_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  responded_at  timestamptz,
  response_note text,
  delivery      text NOT NULL DEFAULT 'not_sent' CHECK (delivery IN ('not_sent', 'sent', 'failed')),
  version       integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.coverage_offers.delivery IS
  'not_sent until a notification channel reports otherwise (Phase 7 owns delivery). An offer row alone never means the employee was told.';
CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_pending_per_user
  ON public.coverage_offers (gap_id, user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_offer_user ON public.coverage_offers (tenant_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_offer_gap ON public.coverage_offers (gap_id);

CREATE TABLE IF NOT EXISTS public.coverage_claims (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  gap_id         uuid NOT NULL REFERENCES public.coverage_gaps(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn')),
  decided_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at     timestamptz,
  decision_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_claim_pending_per_user
  ON public.coverage_claims (gap_id, user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_claim_user ON public.coverage_claims (tenant_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_claim_gap ON public.coverage_claims (gap_id);

-- Service-role writes only (the API enforces tenant scope + role); no policy means no direct client access.
ALTER TABLE public.absence_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverage_gaps   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverage_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverage_claims ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- The one atomic step: fill a gap with a replacement assignment.
-- Errors (stable SQLSTATEs the API maps): CV001 version conflict, CV002 not fillable, CV003 not found.
-- A replacement who overlaps another shift raises 23P01 from migration 225's trigger and rolls everything back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fill_coverage_gap(
  p_tenant_id        uuid,
  p_gap_id           uuid,
  p_expected_version integer,
  p_assignment       jsonb,
  p_resolution       text,
  p_offer_id         uuid,
  p_claim_id         uuid,
  p_actor            uuid
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_gap      public.coverage_gaps%ROWTYPE;
  v_assign   uuid;
  v_user     uuid := (p_assignment->>'user_id')::uuid;
BEGIN
  SELECT * INTO v_gap FROM public.coverage_gaps
   WHERE id = p_gap_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coverage gap not found' USING ERRCODE = 'CV003';
  END IF;
  IF v_gap.status NOT IN ('open', 'offered') THEN
    RAISE EXCEPTION 'coverage gap is already %', v_gap.status USING ERRCODE = 'CV002';
  END IF;
  IF v_gap.version <> p_expected_version THEN
    RAISE EXCEPTION 'coverage gap changed' USING ERRCODE = 'CV001';
  END IF;

  INSERT INTO public.shift_assignments (
    tenant_id, user_id, shift_id, work_date, shift_name, department_id, start_time, end_time,
    starts_at, ends_at, snapshot_source, publication_state, notes, created_by, updated_by
  ) VALUES (
    p_tenant_id, v_user, (p_assignment->>'shift_id')::uuid, (p_assignment->>'work_date')::date,
    p_assignment->>'shift_name', (p_assignment->>'department_id')::uuid,
    (p_assignment->>'start_time')::time, (p_assignment->>'end_time')::time,
    (p_assignment->>'starts_at')::timestamptz, (p_assignment->>'ends_at')::timestamptz,
    'occurrence', 'published', p_assignment->>'notes', p_actor, p_actor
  ) RETURNING id INTO v_assign;

  UPDATE public.coverage_gaps
     SET status = 'filled', resolution = p_resolution, filled_assignment_id = v_assign, filled_user_id = v_user,
         resolved_by = p_actor, resolved_at = now(), version = version + 1, updated_at = now()
   WHERE id = p_gap_id;

  IF v_gap.absence_id IS NOT NULL THEN
    UPDATE public.absence_records
       SET status = 'covered', version = version + 1, updated_at = now()
     WHERE id = v_gap.absence_id AND status = 'confirmed';
  END IF;

  UPDATE public.coverage_offers
     SET status = CASE WHEN id = p_offer_id THEN 'accepted' ELSE 'superseded' END,
         responded_at = CASE WHEN id = p_offer_id THEN now() ELSE responded_at END,
         version = version + 1, updated_at = now()
   WHERE gap_id = p_gap_id AND status = 'pending';

  UPDATE public.coverage_claims
     SET status = CASE WHEN id = p_claim_id THEN 'approved' ELSE 'declined' END,
         decided_by = p_actor, decided_at = now(),
         decision_reason = CASE WHEN id = p_claim_id THEN NULL ELSE 'Shift was filled' END,
         updated_at = now()
   WHERE gap_id = p_gap_id AND status = 'pending';

  RETURN jsonb_build_object('assignment_id', v_assign, 'gap_id', p_gap_id, 'user_id', v_user);
END;
$function$;

REVOKE ALL ON FUNCTION public.fill_coverage_gap(uuid, uuid, integer, jsonb, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fill_coverage_gap(uuid, uuid, integer, jsonb, text, uuid, uuid, uuid) TO service_role;

-- =============================================================================
-- Migration 236: AI shift-summary generation claims (issue #204)
-- =============================================================================
-- Additive only: one new table and three new functions. No existing table, row, policy or function is changed, and no
-- backfill is attempted, so staging and production data are untouched.
--
-- Problem: POST /v1/internal/logbook/shift-summary and the manual Generate/Regenerate endpoint all end in one model call
-- followed by a credit charge. "Is there a summary row yet?" was a read-then-act check, so two replicas (or a cron tick and
-- a manual click) could both pass it, both call the model and both charge AI credits before either wrote the row.
--
-- Fix: a per-occurrence claim taken in ONE database transaction BEFORE the model call.
--   * shift_summary_generation_claims: one row per (tenant, shift, shift_date), the same identity shift_summaries uses.
--   * claim_shift_summary_generation(): INSERT .. ON CONFLICT DO NOTHING, then SELECT .. FOR UPDATE. Concurrent callers
--     serialise on the primary key, so exactly one receives claimed = true. The loser learns why (in_progress,
--     already_generated, backoff, retry_exhausted) and must NOT call the model.
--   * A claim is a lease. A crashed replica's lease expires and another caller may take it over (attempts + 1). Each claim
--     carries a fresh claim_token; the owner re-checks it (shift_summary_claim_owned) immediately before it writes the
--     summary and charges credits, so a slow owner that lost its lease writes and charges nothing.
--   * Failed attempts are retried with a backoff and an attempt cap; a person using the manual endpoint may override both.
--   * complete_shift_summary_generation() records success/failure, only for the current token holder.
--
-- Rollback: remove the three functions and then the claims table (nothing else depends on them; shift_summaries is
-- unaffected). Until then a stuck claim only blocks that one occurrence until its lease expires.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.shift_summary_generation_claims (
  tenant_id        uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shift_id         uuid        NOT NULL REFERENCES public.shifts(id)  ON DELETE CASCADE,
  shift_date       date        NOT NULL,
  status           text        NOT NULL CHECK (status IN ('claimed', 'succeeded', 'failed')),
  claim_token      uuid        NOT NULL,
  attempts         integer     NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  claimed_by       text,
  claimed_at       timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NOT NULL,
  completed_at     timestamptz,
  last_error       text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, shift_id, shift_date)
);

COMMENT ON TABLE public.shift_summary_generation_claims IS
  'Cross-replica claim/lease taken before an AI shift-summary model call so cron and manual requests cannot both generate and charge for the same shift occurrence. Written only by the API service role.';

-- Server-side bookkeeping: no end-user policy exists, so authenticated/anon clients can read and write nothing.
ALTER TABLE public.shift_summary_generation_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shift_summary_generation_claims FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_shift_summary_generation(
  p_tenant_id            uuid,
  p_shift_id             uuid,
  p_shift_date           date,
  p_claimed_by           text    DEFAULT NULL,
  p_lease_seconds        integer DEFAULT 300,
  p_max_attempts         integer DEFAULT 3,
  p_retry_after_seconds  integer DEFAULT 900,
  p_replace_existing     boolean DEFAULT false,
  p_ignore_retry_limits  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_token  uuid := gen_random_uuid();
  v_lease  timestamptz := now() + make_interval(secs => GREATEST(p_lease_seconds, 1));
  v_row    public.shift_summary_generation_claims%ROWTYPE;
  v_inserted integer;
BEGIN
  IF NOT p_replace_existing AND EXISTS (
    SELECT 1 FROM public.shift_summaries
    WHERE tenant_id = p_tenant_id AND shift_id = p_shift_id AND shift_date = p_shift_date
  ) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'already_generated');
  END IF;

  INSERT INTO public.shift_summary_generation_claims
    (tenant_id, shift_id, shift_date, status, claim_token, attempts, claimed_by, claimed_at, lease_expires_at, updated_at)
  VALUES
    (p_tenant_id, p_shift_id, p_shift_date, 'claimed', v_token, 1, p_claimed_by, now(), v_lease, now())
  ON CONFLICT (tenant_id, shift_id, shift_date) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 1 THEN
    RETURN jsonb_build_object('claimed', true, 'reason', 'claimed', 'claim_token', v_token, 'attempts', 1);
  END IF;

  -- A row exists. Lock it: a concurrent claimer blocks here until the holder's transaction ends, then re-reads it.
  SELECT * INTO v_row FROM public.shift_summary_generation_claims
  WHERE tenant_id = p_tenant_id AND shift_id = p_shift_id AND shift_date = p_shift_date
  FOR UPDATE;

  IF v_row.status = 'claimed' AND v_row.lease_expires_at > now() THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'in_progress', 'attempts', v_row.attempts);
  END IF;

  IF v_row.status = 'succeeded' THEN
    IF NOT p_replace_existing THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'already_generated', 'attempts', v_row.attempts);
    END IF;
    UPDATE public.shift_summary_generation_claims
       SET status = 'claimed', claim_token = v_token, attempts = 1, claimed_by = p_claimed_by, claimed_at = now(),
           lease_expires_at = v_lease, completed_at = NULL, last_error = NULL, updated_at = now()
     WHERE tenant_id = p_tenant_id AND shift_id = p_shift_id AND shift_date = p_shift_date;
    RETURN jsonb_build_object('claimed', true, 'reason', 'claimed', 'claim_token', v_token, 'attempts', 1);
  END IF;

  -- status is 'failed', or 'claimed' with an expired lease (the previous owner died): retry rules apply.
  IF NOT p_ignore_retry_limits THEN
    IF v_row.attempts >= p_max_attempts THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'retry_exhausted', 'attempts', v_row.attempts,
                                'last_error', v_row.last_error);
    END IF;
    IF v_row.status = 'failed' AND v_row.completed_at IS NOT NULL
       AND v_row.completed_at + make_interval(secs => GREATEST(p_retry_after_seconds, 0)) > now() THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'backoff', 'attempts', v_row.attempts,
                                'last_error', v_row.last_error);
    END IF;
  END IF;

  UPDATE public.shift_summary_generation_claims
     SET status = 'claimed', claim_token = v_token, attempts = v_row.attempts + 1, claimed_by = p_claimed_by,
         claimed_at = now(), lease_expires_at = v_lease, completed_at = NULL, updated_at = now()
   WHERE tenant_id = p_tenant_id AND shift_id = p_shift_id AND shift_date = p_shift_date;
  RETURN jsonb_build_object('claimed', true, 'reason', 'claimed', 'claim_token', v_token, 'attempts', v_row.attempts + 1);
END;
$function$;

-- True only while p_claim_token is still the live holder. The owner calls this immediately before writing the summary
-- and charging credits; a takeover (expired lease) rotates the token, so a superseded owner gets false and charges nothing.
CREATE OR REPLACE FUNCTION public.shift_summary_claim_owned(
  p_tenant_id uuid, p_shift_id uuid, p_shift_date date, p_claim_token uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.shift_summary_generation_claims
    WHERE tenant_id = p_tenant_id AND shift_id = p_shift_id AND shift_date = p_shift_date
      AND claim_token = p_claim_token AND status = 'claimed'
  );
$function$;

CREATE OR REPLACE FUNCTION public.complete_shift_summary_generation(
  p_tenant_id uuid, p_shift_id uuid, p_shift_date date, p_claim_token uuid,
  p_succeeded boolean, p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.shift_summary_generation_claims
     SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
         completed_at = now(),
         last_error = CASE WHEN p_succeeded THEN NULL ELSE LEFT(COALESCE(p_error, 'unknown error'), 500) END,
         updated_at = now()
   WHERE tenant_id = p_tenant_id AND shift_id = p_shift_id AND shift_date = p_shift_date
     AND claim_token = p_claim_token AND status = 'claimed';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$function$;

-- Server-side only: end-user roles must never mint or release claims.
REVOKE ALL ON FUNCTION public.claim_shift_summary_generation(uuid, uuid, date, text, integer, integer, integer, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.shift_summary_claim_owned(uuid, uuid, date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_shift_summary_generation(uuid, uuid, date, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_shift_summary_generation(uuid, uuid, date, text, integer, integer, integer, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.shift_summary_claim_owned(uuid, uuid, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_shift_summary_generation(uuid, uuid, date, uuid, boolean, text) TO service_role;
GRANT ALL ON public.shift_summary_generation_claims TO service_role;

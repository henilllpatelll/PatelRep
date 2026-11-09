-- =============================================================================
-- Migration 237: fence shift-summary finalization (issue #204 follow-up, PR #205 review)
-- =============================================================================
-- Migration 236 gave every generation a claim/lease, but the API still verified ownership in one call and then, in
-- separate calls, wrote the summary and debited credits. A lease could expire between those calls, a second worker could
-- claim, and both could persist and charge. Ownership was also checked by token + status only, never by lease expiry.
--
-- This migration moves the whole commit point into ONE database transaction that is fenced by the claim row:
--
--   finalize_shift_summary_generation()
--     1. locks the claim row (SELECT .. FOR UPDATE; claim/renew/complete take the same lock, so nothing can take the
--        claim over while this runs),
--     2. refuses unless the caller's token is the live holder AND status = 'claimed' AND lease_expires_at > now()
--        (explicit lease validity; a takeover rotates the token, an expired lease is never finalized),
--     3. upserts the summary, debits credits through deduct_ai_credits() (migration 217) exactly once, and marks the claim
--        succeeded -- all or nothing.
--   shift_summary_credit_charges: one row per claim_token (PRIMARY KEY). Even a replayed finalize cannot debit twice, and
--     the row is the audit trail of what each generation was charged.
--   renew_shift_summary_claim(): heartbeat that extends a LIVE lease so a long model call keeps its claim. It can never
--     revive an expired lease or a superseded token.
--   shift_summary_claim_valid(): read-only token + status + lease check.
--
-- Manual Regenerate semantics are unchanged: p_replace_existing = true upserts the same row in place, clears the prior
-- acknowledgment, and is charged again under its own (new) claim token. A plain Generate never overwrites a summary.
--
-- Additive only. Migration 236 is NOT edited (it is already applied to staging). Existing rows are not modified; no
-- backfill. Nothing here touches production credentials, AI provider configuration or feature flags.
-- Rollback: remove the four new functions and then the charges table; migration 236 objects keep working because the API
-- only calls the new functions once it is deployed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.shift_summary_credit_charges (
  claim_token uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shift_id    uuid        NOT NULL REFERENCES public.shifts(id)  ON DELETE CASCADE,
  shift_date  date        NOT NULL,
  credits     numeric     NOT NULL CHECK (credits >= 0),
  applied     boolean     NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.shift_summary_credit_charges IS
  'One row per shift-summary generation (claim_token) recording the AI credits debited for it. The primary key makes a second debit for the same generation impossible; applied = false means the monthly cap refused the debit.';

CREATE INDEX IF NOT EXISTS idx_shift_summary_credit_charges_occurrence
  ON public.shift_summary_credit_charges (tenant_id, shift_id, shift_date);

ALTER TABLE public.shift_summary_credit_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shift_summary_credit_charges FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.shift_summary_claim_valid(
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
      AND claim_token = p_claim_token AND status = 'claimed' AND lease_expires_at > now()
  );
$function$;

CREATE OR REPLACE FUNCTION public.renew_shift_summary_claim(
  p_tenant_id uuid, p_shift_id uuid, p_shift_date date, p_claim_token uuid, p_lease_seconds integer DEFAULT 300
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
     SET lease_expires_at = now() + make_interval(secs => GREATEST(p_lease_seconds, 1)),
         updated_at = now()
   WHERE tenant_id = p_tenant_id AND shift_id = p_shift_id AND shift_date = p_shift_date
     AND claim_token = p_claim_token AND status = 'claimed' AND lease_expires_at > now();
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_shift_summary_generation(
  p_tenant_id        uuid,
  p_shift_id         uuid,
  p_shift_date       date,
  p_claim_token      uuid,
  p_summary          jsonb,
  p_credits          numeric,
  p_replace_existing boolean DEFAULT false,
  p_base_fee_cents   numeric DEFAULT 9900
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_claim   public.shift_summary_generation_claims%ROWTYPE;
  v_summary public.shift_summaries%ROWTYPE;
  v_applied boolean := true;
  v_charged integer;
BEGIN
  -- The fence: every claim/renew/complete/finalize serialises on this row lock.
  SELECT * INTO v_claim FROM public.shift_summary_generation_claims
  WHERE tenant_id = p_tenant_id AND shift_id = p_shift_id AND shift_date = p_shift_date
  FOR UPDATE;

  IF NOT FOUND OR v_claim.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object('finalized', false, 'reason', 'claim_lost');
  END IF;
  IF v_claim.status = 'succeeded' THEN
    RETURN jsonb_build_object('finalized', false, 'reason', 'already_finalized');
  END IF;
  IF v_claim.status <> 'claimed' THEN
    RETURN jsonb_build_object('finalized', false, 'reason', 'claim_lost');
  END IF;
  IF v_claim.lease_expires_at <= now() THEN
    RETURN jsonb_build_object('finalized', false, 'reason', 'lease_expired');
  END IF;

  IF NOT p_replace_existing AND EXISTS (
    SELECT 1 FROM public.shift_summaries
    WHERE tenant_id = p_tenant_id AND shift_id = p_shift_id AND shift_date = p_shift_date
  ) THEN
    RETURN jsonb_build_object('finalized', false, 'reason', 'already_generated');
  END IF;

  INSERT INTO public.shift_summaries
    (tenant_id, shift_id, shift_date, department_id, summary_text, stats, handoff_data, generated_at, updated_at)
  VALUES
    (p_tenant_id, p_shift_id, p_shift_date, (p_summary->>'department_id')::uuid, p_summary->>'summary_text',
     COALESCE(p_summary->'stats', '{}'::jsonb), COALESCE(p_summary->'handoff_data', '{}'::jsonb),
     COALESCE((p_summary->>'generated_at')::timestamptz, now()), now())
  ON CONFLICT (tenant_id, shift_id, shift_date) DO UPDATE SET
    department_id = EXCLUDED.department_id,
    summary_text  = EXCLUDED.summary_text,
    stats         = EXCLUDED.stats,
    handoff_data  = EXCLUDED.handoff_data,
    generated_at  = EXCLUDED.generated_at,
    updated_at    = now(),
    acknowledged_by = CASE WHEN p_replace_existing THEN NULL ELSE public.shift_summaries.acknowledged_by END,
    acknowledged_at = CASE WHEN p_replace_existing THEN NULL ELSE public.shift_summaries.acknowledged_at END
  RETURNING * INTO v_summary;

  -- Idempotent debit: the PRIMARY KEY on claim_token admits one charge per generation.
  INSERT INTO public.shift_summary_credit_charges (claim_token, tenant_id, shift_id, shift_date, credits, applied)
  VALUES (p_claim_token, p_tenant_id, p_shift_id, p_shift_date, GREATEST(COALESCE(p_credits, 0), 0), false)
  ON CONFLICT (claim_token) DO NOTHING;
  GET DIAGNOSTICS v_charged = ROW_COUNT;
  IF v_charged = 1 AND COALESCE(p_credits, 0) > 0 THEN
    v_applied := public.deduct_ai_credits(p_tenant_id, p_credits, p_base_fee_cents);
  END IF;
  IF v_charged = 1 THEN
    UPDATE public.shift_summary_credit_charges SET applied = v_applied WHERE claim_token = p_claim_token;
  END IF;

  UPDATE public.shift_summary_generation_claims
     SET status = 'succeeded', completed_at = now(), last_error = NULL, updated_at = now()
   WHERE tenant_id = p_tenant_id AND shift_id = p_shift_id AND shift_date = p_shift_date;

  RETURN jsonb_build_object('finalized', true, 'reason', 'finalized', 'charged', v_applied,
                            'summary', to_jsonb(v_summary));
END;
$function$;

REVOKE ALL ON FUNCTION public.shift_summary_claim_valid(uuid, uuid, date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_shift_summary_claim(uuid, uuid, date, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_shift_summary_generation(uuid, uuid, date, uuid, jsonb, numeric, boolean, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_summary_claim_valid(uuid, uuid, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_shift_summary_claim(uuid, uuid, date, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_shift_summary_generation(uuid, uuid, date, uuid, jsonb, numeric, boolean, numeric) TO service_role;
GRANT ALL ON public.shift_summary_credit_charges TO service_role;

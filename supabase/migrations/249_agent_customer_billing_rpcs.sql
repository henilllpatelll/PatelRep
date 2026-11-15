-- =============================================================================
-- Migration 249: Agent Harness H4 -- customer billing RPCs and the H3 dispatch guard
-- =============================================================================
-- Additive only: new functions and one new trigger on agent_model_attempts. No H3 function is replaced.
-- Every function is SECURITY INVOKER with an empty search_path, executable only by service_role, and runs as ONE
-- transaction. Amounts cross the API boundary as decimal TEXT.
--
-- Customer-billed paid call (customer_billing_mode = 'enforced'):
--   agent_billing_attempt_reserve   H3 reserve + customer hold in ONE transaction. If the customer cannot cover the
--                                   conservatively quoted exposure, the provider reservation is released in that same
--                                   transaction (nothing is left reserved, a denial event is written).
--   agent_billing_attempt_dispatch  re-checks hold, active policy and consent immediately before the H3 dispatch
--                                   marker; on refusal releases hold + provider reservation together.
--   agent_billing_attempt_settle    H3 settle + customer charge (settled), hold release (released) or
--                                   awaiting_reconciliation (uncertain / unreconciled -- no invented charge).
--   trigger agent_model_attempts_customer_hold_guard refuses ANY reserved -> dispatched transition without a live
--                                   hold while enforced, so calling the bare H3 dispatch RPC cannot bypass billing.
--
-- Lock order (extends H3's run -> attempt -> counters): run -> attempt -> provider counters -> hold -> credit_ledger.
-- The legacy deduct_ai_credits() locks only credit_ledger, so neither path can deadlock the other. The reconciler takes
-- attempt locks with SKIP LOCKED and never waits while holding a hold or ledger lock.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Internal helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent__billing_mode()
RETURNS text LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT COALESCE((SELECT customer_billing_mode FROM public.agent_customer_billing_controls WHERE id = 1), 'disabled');
$function$;

CREATE OR REPLACE FUNCTION public.agent__billing_event(
  p_tenant_id uuid, p_event_type text, p_attempt_id uuid, p_hold_id uuid, p_charge_id uuid, p_policy_id uuid,
  p_authorization_id uuid, p_credits numeric, p_amount_usd numeric, p_reason text, p_actor_kind text, p_actor_ref text,
  p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS void LANGUAGE sql VOLATILE SET search_path = ''
AS $function$
  INSERT INTO public.agent_customer_billing_events (tenant_id, event_type, attempt_id, hold_id, charge_id, policy_id,
    authorization_id, credits, amount_usd, reason_code, actor_kind, actor_ref, detail)
  VALUES (p_tenant_id, p_event_type, p_attempt_id, p_hold_id, p_charge_id, p_policy_id, p_authorization_id, p_credits,
    p_amount_usd, p_reason, p_actor_kind, p_actor_ref, COALESCE(p_detail, '{}'::jsonb));
$function$;

-- The approved, in-window policy for a hotel (NULL when missing, unapproved or expired: billing fails closed).
CREATE OR REPLACE FUNCTION public.agent__active_pricing_policy(p_tenant_id uuid)
RETURNS public.agent_customer_pricing_policies LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT * FROM public.agent_customer_pricing_policies
   WHERE tenant_id = p_tenant_id AND approved_at IS NOT NULL AND effective_from <= now()
     AND (effective_to IS NULL OR effective_to > now())
   ORDER BY policy_version DESC LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.agent__current_overage_authorization(p_tenant_id uuid)
RETURNS public.agent_customer_overage_authorizations LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT * FROM public.agent_customer_overage_authorizations WHERE tenant_id = p_tenant_id
   ORDER BY version DESC LIMIT 1;
$function$;

-- Customer credits for a provider cost under a policy. Mirrors services/agent_billing/pricing.py quote_credits():
-- ceil(cost * markup / usd_per_credit) to 0.0001 credits, never below the policy minimum.
CREATE OR REPLACE FUNCTION public.agent__customer_quote(p_cost_usd numeric, p_policy public.agent_customer_pricing_policies)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT CASE WHEN p_cost_usd IS NULL OR p_cost_usd < 0 THEN NULL
    ELSE greatest(ceil(p_cost_usd * p_policy.markup_multiplier / p_policy.usd_per_credit * 10000) / 10000,
                  p_policy.minimum_credits_per_operation) END;
$function$;

-- The hotel's open credit_ledger row, created (like the API's get_or_create_current_period_ledger) when the month just
-- rolled over, then locked. NULL when there is no subscription row.
CREATE OR REPLACE FUNCTION public.agent__open_ledger_locked(p_tenant_id uuid)
RETURNS public.credit_ledger LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
DECLARE
  v_ledger public.credit_ledger%ROWTYPE;
  v_start  date := date_trunc('month', CURRENT_DATE)::date;
BEGIN
  SELECT * INTO v_ledger FROM public.credit_ledger
   WHERE tenant_id = p_tenant_id AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE FOR UPDATE;
  IF FOUND THEN
    RETURN v_ledger;
  END IF;
  INSERT INTO public.credit_ledger (tenant_id, period_start, period_end, credits_included)
  SELECT p_tenant_id, v_start, (v_start + interval '1 month' - interval '1 day')::date, s.credits_included
    FROM public.subscriptions s WHERE s.tenant_id = p_tenant_id
  ON CONFLICT (tenant_id, period_start) DO NOTHING;
  SELECT * INTO v_ledger FROM public.credit_ledger
   WHERE tenant_id = p_tenant_id AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE FOR UPDATE;
  RETURN v_ledger;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__hold_json(p_h public.agent_customer_credit_holds)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT CASE WHEN p_h.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', p_h.id, 'tenant_id', p_h.tenant_id, 'attempt_id', p_h.attempt_id, 'period_start', p_h.period_start,
    'pricing_policy_id', p_h.pricing_policy_id, 'authorization_id', p_h.authorization_id,
    'held_credits', p_h.held_credits::text, 'held_overage_credits', p_h.held_overage_credits::text,
    'state', p_h.state, 'close_reason', p_h.close_reason) END;
$function$;

-- Release an open hold: its credits leave the ledger's held columns (allowed on a finalized ledger: they are H4's own).
CREATE OR REPLACE FUNCTION public.agent__customer_hold_release(
  p_h public.agent_customer_credit_holds, p_reason text, p_actor_kind text, p_actor_ref text
)
RETURNS public.agent_customer_credit_holds LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
DECLARE
  v_h public.agent_customer_credit_holds%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.credit_ledger WHERE id = p_h.ledger_id FOR UPDATE;
  UPDATE public.credit_ledger
     SET agent_held_credits = agent_held_credits - p_h.held_credits,
         agent_held_overage_credits = agent_held_overage_credits - p_h.held_overage_credits
   WHERE id = p_h.ledger_id;
  UPDATE public.agent_customer_credit_holds SET state = 'released', close_reason = p_reason, closed_at = now()
   WHERE id = p_h.id RETURNING * INTO v_h;
  PERFORM public.agent__billing_event(v_h.tenant_id, 'hold_released', v_h.attempt_id, v_h.id, NULL,
                                      v_h.pricing_policy_id, v_h.authorization_id, v_h.held_credits, NULL, p_reason,
                                      p_actor_kind, p_actor_ref);
  RETURN v_h;
END;
$function$;

-- Create the pre-dispatch hold for a freshly reserved attempt. The caller holds the attempt row lock.
CREATE OR REPLACE FUNCTION public.agent__customer_hold_create(p_a public.agent_model_attempts, p_actor_ref text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
DECLARE
  v_policy    public.agent_customer_pricing_policies%ROWTYPE;
  v_auth      public.agent_customer_overage_authorizations%ROWTYPE;
  v_sub       public.subscriptions%ROWTYPE;
  v_ledger    public.credit_ledger%ROWTYPE;
  v_h         public.agent_customer_credit_holds%ROWTYPE;
  v_credits   numeric;
  v_included  numeric;
  v_remaining numeric;
  v_incl      numeric;
  v_over      numeric;
  v_reason    text;
BEGIN
  v_policy := public.agent__active_pricing_policy(p_a.tenant_id);
  IF v_policy.id IS NULL THEN
    v_reason := 'pricing_policy_missing';
  END IF;
  IF v_reason IS NULL THEN
    SELECT * INTO v_sub FROM public.subscriptions WHERE tenant_id = p_a.tenant_id;
    IF NOT FOUND THEN
      v_reason := 'subscription_missing';
    ELSIF v_sub.plan_status NOT IN ('active', 'trialing') THEN
      v_reason := 'subscription_not_billable';
    END IF;
  END IF;
  IF v_reason IS NULL THEN
    v_ledger := public.agent__open_ledger_locked(p_a.tenant_id);
    IF v_ledger.id IS NULL OR v_ledger.is_finalized THEN
      v_reason := 'no_open_ledger';
    END IF;
  END IF;
  IF v_reason IS NULL THEN
    v_included := v_ledger.credits_included + v_ledger.credits_purchased;
    IF v_included <> v_policy.included_credits THEN
      v_reason := 'pricing_policy_ledger_mismatch';
    END IF;
  END IF;
  IF v_reason IS NULL THEN
    v_credits := public.agent__customer_quote(p_a.reserved_usd, v_policy);
    IF v_credits IS NULL OR v_credits <= 0 THEN
      v_reason := 'quote_unavailable';
    END IF;
  END IF;
  IF v_reason IS NULL THEN
    v_remaining := greatest(0, v_included - v_ledger.credits_used
                               - (v_ledger.agent_held_credits - v_ledger.agent_held_overage_credits));
    v_incl := least(v_credits, v_remaining);
    v_over := v_credits - v_incl;
    IF v_over > 0 THEN
      v_auth := public.agent__current_overage_authorization(p_a.tenant_id);
      IF v_auth.id IS NULL OR v_auth.state <> 'authorized' THEN
        v_reason := 'overage_not_authorized';
      ELSIF v_auth.pricing_policy_id <> v_policy.id THEN
        v_reason := 'overage_authorization_stale_policy';
      ELSIF v_ledger.agent_overage_credits + v_ledger.agent_held_overage_credits + v_over > v_auth.authorized_limit_credits THEN
        v_reason := 'overage_limit_reached';
      ELSIF v_ledger.agent_overage_usd + (v_ledger.agent_held_overage_credits + v_over) * v_policy.usd_per_credit
            > v_policy.hard_cap_usd THEN
        v_reason := 'hard_cap_reached';
      ELSIF COALESCE(v_sub.cap_cents, 0) > 0
            AND v_ledger.overage_cost_cents + (v_ledger.agent_held_overage_credits + v_over) * v_policy.usd_per_credit * 100
                > v_sub.cap_cents - v_sub.base_fee_cents THEN
        v_reason := 'subscription_spend_cap_reached';
      END IF;
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    PERFORM public.agent__billing_event(p_a.tenant_id, 'hold_denied', p_a.id, NULL, NULL, v_policy.id, v_auth.id,
                                        v_credits, NULL, v_reason, 'worker', p_actor_ref);
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;

  INSERT INTO public.agent_customer_credit_holds (tenant_id, attempt_id, ledger_id, period_start, pricing_policy_id,
    authorization_id, held_credits, held_overage_credits)
  VALUES (p_a.tenant_id, p_a.id, v_ledger.id, v_ledger.period_start, v_policy.id,
          CASE WHEN v_over > 0 THEN v_auth.id END, v_credits, v_over)
  RETURNING * INTO v_h;
  UPDATE public.credit_ledger
     SET agent_held_credits = agent_held_credits + v_credits,
         agent_held_overage_credits = agent_held_overage_credits + v_over
   WHERE id = v_ledger.id;
  PERFORM public.agent__billing_event(p_a.tenant_id, 'hold_created', p_a.id, v_h.id, NULL, v_policy.id, v_h.authorization_id,
                                      v_credits, NULL, NULL, 'worker', p_actor_ref,
                                      jsonb_build_object('overage_credits', v_over::text,
                                                         'policy_version', v_policy.policy_version));
  RETURN jsonb_build_object('ok', true, 'hold', public.agent__hold_json(v_h));
END;
$function$;

-- Turn a settled attempt's hold into exactly one immutable charge. The caller holds the attempt and hold row locks.
CREATE OR REPLACE FUNCTION public.agent__customer_convert(
  p_h public.agent_customer_credit_holds, p_a public.agent_model_attempts, p_actor_kind text, p_actor_ref text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
DECLARE
  v_policy    public.agent_customer_pricing_policies%ROWTYPE;
  v_ledger    public.credit_ledger%ROWTYPE;
  v_charge_id uuid;
  v_credits   numeric;
  v_charged   numeric;
  v_uncharged numeric;
  v_incl      numeric;
  v_over      numeric;
  v_over_usd  numeric;
  v_applied   boolean;
BEGIN
  SELECT * INTO v_policy FROM public.agent_customer_pricing_policies WHERE id = p_h.pricing_policy_id;
  v_credits := public.agent__customer_quote(p_a.settled_usd, v_policy);
  v_charged := least(v_credits, p_h.held_credits);          -- never above what the customer authorized
  v_uncharged := v_credits - v_charged;                        -- an overrun is PatelRep's expense, recorded
  v_incl := least(v_charged, p_h.held_credits - p_h.held_overage_credits);
  v_over := v_charged - v_incl;
  v_over_usd := v_over * v_policy.usd_per_credit;

  SELECT * INTO v_ledger FROM public.credit_ledger WHERE id = p_h.ledger_id FOR UPDATE;
  v_applied := NOT v_ledger.is_finalized;
  UPDATE public.credit_ledger
     SET agent_held_credits = agent_held_credits - p_h.held_credits,
         agent_held_overage_credits = agent_held_overage_credits - p_h.held_overage_credits,
         credits_used = credits_used + CASE WHEN v_applied THEN v_charged ELSE 0 END,
         agent_credits_used = agent_credits_used + CASE WHEN v_applied THEN v_charged ELSE 0 END,
         agent_overage_credits = agent_overage_credits + CASE WHEN v_applied THEN v_over ELSE 0 END,
         agent_overage_usd = agent_overage_usd + CASE WHEN v_applied THEN v_over_usd ELSE 0 END
   WHERE id = v_ledger.id;

  INSERT INTO public.agent_customer_credit_charges (tenant_id, kind, attempt_id, hold_id, ledger_id, period_start,
    pricing_policy_id, policy_version, usd_per_credit, markup_multiplier, minimum_credits_per_operation,
    provider_cost_usd, provider_schedule_version, credits, included_credits, overage_credits, overage_usd,
    uncharged_overrun_credits, ledger_applied, late, actor_kind, actor_ref)
  VALUES (p_h.tenant_id, 'charge', p_a.id, p_h.id, v_ledger.id, v_ledger.period_start, v_policy.id,
    v_policy.policy_version, v_policy.usd_per_credit, v_policy.markup_multiplier, v_policy.minimum_credits_per_operation,
    p_a.settled_usd, p_a.schedule_version, v_charged, v_incl, v_over, v_over_usd, v_uncharged, v_applied, NOT v_applied,
    CASE WHEN p_actor_kind = 'operator' THEN 'operator' WHEN p_actor_kind = 'reconciler' THEN 'reconciler' ELSE 'worker' END,
    p_actor_ref)
  RETURNING id INTO v_charge_id;

  UPDATE public.agent_customer_credit_holds SET state = 'converted', close_reason = 'charged', closed_at = now()
   WHERE id = p_h.id;
  PERFORM public.agent__billing_event(p_h.tenant_id, 'charge_recorded', p_a.id, p_h.id, v_charge_id, v_policy.id,
                                      p_h.authorization_id, v_charged, v_over_usd, CASE WHEN v_applied THEN NULL ELSE 'late_period_finalized' END,
                                      p_actor_kind, p_actor_ref,
                                      jsonb_build_object('overage_credits', v_over::text, 'provider_cost_usd', p_a.settled_usd::text));
  IF v_uncharged > 0 THEN
    PERFORM public.agent__billing_event(p_h.tenant_id, 'charge_capped_at_hold', p_a.id, p_h.id, v_charge_id, v_policy.id,
                                        NULL, v_uncharged, NULL, 'provider_overrun_absorbed', p_actor_kind, p_actor_ref);
  END IF;
  RETURN jsonb_build_object('status', 'charged', 'charge_id', v_charge_id, 'credits', v_charged::text,
                            'overage_credits', v_over::text, 'late', NOT v_applied);
END;
$function$;

-- Bring an attempt's hold in line with the attempt's provider state. Idempotent. With p_skip_locked the attempt lock is
-- taken with SKIP LOCKED (reconciler) and a busy attempt is reported instead of waited on.
CREATE OR REPLACE FUNCTION public.agent__customer_settle_attempt(
  p_attempt_id uuid, p_actor_kind text, p_actor_ref text, p_skip_locked boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
DECLARE
  v_a public.agent_model_attempts%ROWTYPE;
  v_h public.agent_customer_credit_holds%ROWTYPE;
BEGIN
  IF p_skip_locked THEN
    SELECT * INTO v_a FROM public.agent_model_attempts WHERE id = p_attempt_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'busy');
    END IF;
  ELSE
    SELECT * INTO v_a FROM public.agent_model_attempts WHERE id = p_attempt_id FOR UPDATE;
  END IF;
  SELECT * INTO v_h FROM public.agent_customer_credit_holds WHERE attempt_id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_hold');
  END IF;
  IF v_h.state IN ('converted', 'released') THEN
    RETURN jsonb_build_object('status', v_h.state, 'replayed', true);
  END IF;
  IF v_a.state = 'settled' THEN
    RETURN public.agent__customer_convert(v_h, v_a, p_actor_kind, p_actor_ref);
  ELSIF v_a.state = 'released' THEN
    PERFORM public.agent__customer_hold_release(v_h, 'provider_released', p_actor_kind, p_actor_ref);
    RETURN jsonb_build_object('status', 'released');
  ELSIF v_a.state IN ('uncertain', 'unreconciled') THEN
    IF v_h.state = 'held' THEN
      UPDATE public.agent_customer_credit_holds SET state = 'awaiting_reconciliation' WHERE id = v_h.id;
      PERFORM public.agent__billing_event(v_h.tenant_id, 'hold_awaiting_reconciliation', v_a.id, v_h.id, NULL,
                                          v_h.pricing_policy_id, NULL, v_h.held_credits, NULL, v_a.state,
                                          p_actor_kind, p_actor_ref);
    END IF;
    RETURN jsonb_build_object('status', 'awaiting_reconciliation');
  END IF;
  RETURN jsonb_build_object('status', 'open', 'attempt_state', v_a.state);
END;
$function$;

-- -----------------------------------------------------------------------------
-- Dispatch guard on the H3 table: while enforced, no attempt reaches the network without a live hold
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent__guard_attempt_customer_hold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF OLD.state = 'reserved' AND NEW.state = 'dispatched' AND public.agent__billing_mode() = 'enforced'
     AND NOT EXISTS (SELECT 1 FROM public.agent_customer_credit_holds WHERE attempt_id = NEW.id AND state = 'held') THEN
    RAISE EXCEPTION 'customer_billing_hold_required' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_model_attempts_customer_hold_guard ON public.agent_model_attempts;
CREATE TRIGGER agent_model_attempts_customer_hold_guard BEFORE UPDATE OF state ON public.agent_model_attempts
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_attempt_customer_hold();

-- -----------------------------------------------------------------------------
-- Worker wrappers (same parameters as the H3 RPCs)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_billing_attempt_reserve(
  p_run_id uuid, p_fencing_token bigint, p_worker text, p_step_id uuid, p_logical_call_key text,
  p_attempt_number integer, p_provider text, p_model text, p_schedule_version text, p_max_input_tokens integer,
  p_max_output_tokens integer, p_exposure_usd numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_res   jsonb;
  v_a     public.agent_model_attempts%ROWTYPE;
  v_h     public.agent_customer_credit_holds%ROWTYPE;
  v_hold  jsonb;
BEGIN
  v_res := public.agent_model_attempt_reserve(p_run_id, p_fencing_token, p_worker, p_step_id, p_logical_call_key,
                                              p_attempt_number, p_provider, p_model, p_schedule_version,
                                              p_max_input_tokens, p_max_output_tokens, p_exposure_usd);
  IF public.agent__billing_mode() <> 'enforced' OR NOT COALESCE((v_res ->> 'ok')::boolean, false) THEN
    RETURN v_res || jsonb_build_object('customer_billing', public.agent__billing_mode());
  END IF;

  SELECT * INTO v_a FROM public.agent_model_attempts WHERE id = (v_res -> 'attempt' ->> 'id')::uuid FOR UPDATE;
  SELECT * INTO v_h FROM public.agent_customer_credit_holds WHERE attempt_id = v_a.id;
  IF FOUND THEN
    RETURN v_res || jsonb_build_object('customer_billing', 'enforced', 'customer_hold', public.agent__hold_json(v_h));
  END IF;
  IF v_a.state <> 'reserved' THEN
    -- A replay of an attempt that already left 'reserved' without a hold (created while billing was disabled).
    RETURN v_res || jsonb_build_object('customer_billing', 'enforced', 'customer_hold', NULL);
  END IF;

  v_hold := public.agent__customer_hold_create(v_a, p_worker);
  IF NOT (v_hold ->> 'ok')::boolean THEN
    PERFORM public.agent__model_release(v_a, 'customer_' || (v_hold ->> 'reason'), 'worker', p_worker);
    RETURN jsonb_build_object('ok', false, 'denied', true, 'released', true, 'customer_billing', 'enforced',
                              'reason', 'customer_' || (v_hold ->> 'reason'));
  END IF;
  RETURN v_res || jsonb_build_object('customer_billing', 'enforced', 'customer_hold', v_hold -> 'hold');
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_billing_attempt_dispatch(
  p_attempt_id uuid, p_run_id uuid, p_fencing_token bigint, p_worker text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_a      public.agent_model_attempts%ROWTYPE;
  v_h      public.agent_customer_credit_holds%ROWTYPE;
  v_policy public.agent_customer_pricing_policies%ROWTYPE;
  v_auth   public.agent_customer_overage_authorizations%ROWTYPE;
  v_ledger public.credit_ledger%ROWTYPE;
  v_res    jsonb;
  v_reason text;
BEGIN
  IF public.agent__billing_mode() <> 'enforced' THEN
    RETURN public.agent_model_attempt_dispatch(p_attempt_id, p_run_id, p_fencing_token, p_worker);
  END IF;
  PERFORM public.agent__owned_run(p_run_id, p_fencing_token, p_worker);  -- run lock first (H3 order)
  SELECT * INTO v_a FROM public.agent_model_attempts WHERE id = p_attempt_id AND run_id = p_run_id FOR UPDATE;
  IF FOUND AND v_a.state = 'reserved' AND v_a.fencing_token = p_fencing_token AND v_a.worker_id = p_worker THEN
    SELECT * INTO v_h FROM public.agent_customer_credit_holds WHERE attempt_id = v_a.id FOR UPDATE;
    IF NOT FOUND OR v_h.state <> 'held' THEN
      v_reason := 'customer_hold_missing';
    ELSE
      v_policy := public.agent__active_pricing_policy(v_a.tenant_id);
      IF v_policy.id IS DISTINCT FROM v_h.pricing_policy_id THEN
        v_reason := 'customer_pricing_policy_changed';
      ELSIF v_h.held_overage_credits > 0 THEN
        SELECT * INTO v_ledger FROM public.credit_ledger WHERE id = v_h.ledger_id FOR UPDATE;
        v_auth := public.agent__current_overage_authorization(v_a.tenant_id);
        IF v_auth.id IS NULL OR v_auth.state <> 'authorized' THEN
          v_reason := 'customer_overage_authorization_revoked';
        ELSIF v_auth.pricing_policy_id <> v_policy.id THEN
          v_reason := 'customer_overage_authorization_stale_policy';
        ELSIF v_ledger.agent_overage_credits + v_ledger.agent_held_overage_credits > v_auth.authorized_limit_credits THEN
          v_reason := 'customer_overage_limit_reached';
        END IF;
      END IF;
    END IF;
    IF v_reason IS NOT NULL THEN
      IF v_h.id IS NOT NULL AND v_h.state = 'held' THEN
        PERFORM public.agent__customer_hold_release(v_h, v_reason, 'worker', p_worker);
      END IF;
      v_a := public.agent__model_release(v_a, v_reason, 'worker', p_worker);
      PERFORM public.agent__model_event(v_a.tenant_id, v_a.run_id, v_a.id, 'dispatch_refused', NULL, v_reason,
                                        'worker', p_worker);
      RETURN jsonb_build_object('ok', false, 'reason', v_reason, 'released', true,
                                'attempt', public.agent__model_attempt_json(v_a));
    END IF;
  END IF;
  v_res := public.agent_model_attempt_dispatch(p_attempt_id, p_run_id, p_fencing_token, p_worker);
  IF COALESCE((v_res ->> 'released')::boolean, false) THEN
    SELECT * INTO v_h FROM public.agent_customer_credit_holds WHERE attempt_id = p_attempt_id FOR UPDATE;
    IF FOUND AND v_h.state = 'held' THEN
      PERFORM public.agent__customer_hold_release(v_h, COALESCE(v_res ->> 'reason', 'dispatch_refused'), 'worker', p_worker);
    END IF;
  END IF;
  RETURN v_res;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_billing_attempt_release(p_attempt_id uuid, p_fencing_token bigint, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.agent_model_attempt_release(p_attempt_id, p_fencing_token, p_reason);
  IF COALESCE((v_res ->> 'ok')::boolean, false) THEN
    v_res := v_res || jsonb_build_object('customer', public.agent__customer_settle_attempt(p_attempt_id, 'worker', 'release'));
  END IF;
  RETURN v_res;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_billing_attempt_settle(
  p_attempt_id uuid, p_fencing_token bigint, p_outcome text, p_cost_usd numeric, p_usage_status text, p_usage jsonb,
  p_cost_status text, p_cost_cause text, p_cost_tier text, p_reported_model text, p_provider_request_id text,
  p_provider_response_id text, p_error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.agent_model_attempt_settle(p_attempt_id, p_fencing_token, p_outcome, p_cost_usd, p_usage_status,
                                             p_usage, p_cost_status, p_cost_cause, p_cost_tier, p_reported_model,
                                             p_provider_request_id, p_provider_response_id, p_error_code);
  IF COALESCE((v_res ->> 'ok')::boolean, false) OR v_res ->> 'reason' = 'already_settled' THEN
    v_res := v_res || jsonb_build_object('customer',
      public.agent__customer_settle_attempt(p_attempt_id, 'worker', COALESCE(v_res -> 'attempt' ->> 'worker_id', 'worker')));
  END IF;
  RETURN v_res;
END;
$function$;

-- -----------------------------------------------------------------------------
-- Reconciliation (bounded, idempotent, dry-run capable, metadata only)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_customer_billing_reconcile(
  p_limit integer DEFAULT 100, p_dry_run boolean DEFAULT true, p_actor text DEFAULT 'reconciler'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_limit     integer := least(greatest(COALESCE(p_limit, 100), 1), 500);
  v_actor     text := CASE WHEN p_actor ~ '^[A-Za-z0-9._:@-]{1,100}$' THEN p_actor ELSE 'reconciler' END;
  r           record;
  v_out       jsonb;
  v_status    text;
  v_counts    jsonb := '{}'::jsonb;
  v_examined  integer := 0;
  v_drift     jsonb;
  v_awaiting  jsonb;
  v_unbilled  integer;
  v_stale     integer;
  v_mismatch  integer;
BEGIN
  -- 1. Holds whose provider attempt reached a state the hold has not followed yet (crash between H3 settle and H4,
  --    an H3 operator reconciliation, a direct H3 settle, or a recovered attempt).
  FOR r IN
    SELECT h.attempt_id, h.state AS hold_state, a.state AS attempt_state
      FROM public.agent_customer_credit_holds h JOIN public.agent_model_attempts a ON a.id = h.attempt_id
     WHERE h.state IN ('held', 'awaiting_reconciliation')
       AND (a.state IN ('settled', 'released') OR (h.state = 'held' AND a.state IN ('uncertain', 'unreconciled')))
     ORDER BY h.created_at
     LIMIT v_limit
  LOOP
    v_examined := v_examined + 1;
    IF p_dry_run THEN
      v_status := 'would_' || CASE r.attempt_state WHEN 'settled' THEN 'charge' WHEN 'released' THEN 'release'
                                                   ELSE 'await_reconciliation' END;
    ELSE
      v_out := public.agent__customer_settle_attempt(r.attempt_id, 'reconciler', v_actor, true);
      v_status := v_out ->> 'status';
    END IF;
    v_counts := jsonb_set(v_counts, ARRAY[v_status], to_jsonb(COALESCE((v_counts ->> v_status)::integer, 0) + 1));
  END LOOP;

  -- 2. Evidence that is missing: left unresolved, surfaced for an operator. Never converted into a charge.
  SELECT jsonb_build_object('count', count(*), 'credits', COALESCE(sum(h.held_credits), 0)::text)
    INTO v_awaiting
    FROM public.agent_customer_credit_holds h
   WHERE h.state = 'awaiting_reconciliation';

  SELECT count(*) INTO v_stale FROM public.agent_customer_credit_holds h
    JOIN public.agent_model_attempts a ON a.id = h.attempt_id
   WHERE h.state = 'held' AND a.state IN ('reserved', 'dispatched') AND a.reserved_at < now() - interval '1 hour';

  SELECT count(*) INTO v_mismatch FROM public.agent_customer_credit_holds h
    JOIN public.agent_model_attempts a ON a.id = h.attempt_id
   WHERE h.state = 'held' AND a.state = 'reserved'
     AND h.pricing_policy_id IS DISTINCT FROM (public.agent__active_pricing_policy(h.tenant_id)).id;

  -- Settled attempts that have neither a hold nor a charge: billed to nobody (created while billing was disabled).
  SELECT count(*) INTO v_unbilled FROM public.agent_model_attempts a
   WHERE a.state = 'settled' AND a.reserved_at > now() - interval '62 days'
     AND NOT EXISTS (SELECT 1 FROM public.agent_customer_credit_holds h WHERE h.attempt_id = a.id);

  -- 3. Aggregate integrity: the ledger breakdown must equal the journal and the open holds exactly.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('tenant_id', d.tenant_id, 'ledger_id', d.id, 'period_start', d.period_start,
                                               'kind', d.kind)), '[]'::jsonb)
    INTO v_drift
    FROM (
      SELECT l.id, l.tenant_id, l.period_start,
             CASE WHEN l.agent_credits_used <> COALESCE(j.credits, 0) THEN 'agent_credits_mismatch'
                  WHEN l.agent_overage_credits <> COALESCE(j.overage, 0) THEN 'agent_overage_mismatch'
                  WHEN l.agent_overage_usd <> COALESCE(j.overage_usd, 0) THEN 'agent_overage_usd_mismatch'
                  WHEN l.agent_held_credits <> COALESCE(o.held, 0) THEN 'held_credits_mismatch'
                  WHEN l.agent_held_overage_credits <> COALESCE(o.held_over, 0) THEN 'held_overage_mismatch' END AS kind
        FROM public.credit_ledger l
        LEFT JOIN (SELECT ledger_id, sum(credits) AS credits, sum(overage_credits) AS overage, sum(overage_usd) AS overage_usd
                     FROM public.agent_customer_credit_charges WHERE ledger_applied GROUP BY ledger_id) j ON j.ledger_id = l.id
        LEFT JOIN (SELECT ledger_id, sum(held_credits) AS held, sum(held_overage_credits) AS held_over
                     FROM public.agent_customer_credit_holds WHERE state IN ('held', 'awaiting_reconciliation')
                    GROUP BY ledger_id) o ON o.ledger_id = l.id
       WHERE l.agent_credits_used <> 0 OR l.agent_held_credits <> 0 OR j.ledger_id IS NOT NULL OR o.ledger_id IS NOT NULL
       LIMIT 1000
    ) d WHERE d.kind IS NOT NULL;

  IF NOT p_dry_run THEN
    PERFORM public.agent__billing_event(NULL, 'reconciliation_run', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                                        'reconciler', v_actor,
                                        jsonb_build_object('examined', v_examined, 'outcomes', v_counts));
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'dry_run', p_dry_run, 'examined', v_examined, 'outcomes', v_counts,
    'operator_action_required', jsonb_build_object(
      'awaiting_provider_reconciliation', v_awaiting,
      'stale_open_attempts', v_stale,
      'pricing_policy_mismatch', v_mismatch,
      'aggregate_drift', v_drift),
    'settled_attempts_without_customer_hold', v_unbilled);
END;
$function$;

-- -----------------------------------------------------------------------------
-- Operator: compensating adjustment (reduces a charge; never edits it). Two-person.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_customer_charge_adjust(
  p_tenant_id uuid, p_charge_id uuid, p_reduce_credits numeric, p_operator text, p_approver text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_c        public.agent_customer_credit_charges%ROWTYPE;
  v_ledger   public.credit_ledger%ROWTYPE;
  v_prior    numeric;
  v_prior_ov numeric;
  v_over     numeric;
  v_incl     numeric;
  v_id       uuid;
  v_applied  boolean;
BEGIN
  IF p_operator IS NULL OR p_operator !~ '^[A-Za-z0-9._:@-]{1,100}$' OR p_approver IS NULL
     OR p_approver !~ '^[A-Za-z0-9._:@-]{1,100}$' OR p_approver = p_operator
     OR p_reason IS NULL OR p_reason !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'two_person_approval_required');
  END IF;
  IF p_reduce_credits IS NULL OR p_reduce_credits <= 0 OR p_reduce_credits <> round(p_reduce_credits, 4) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;
  SELECT * INTO v_c FROM public.agent_customer_credit_charges
   WHERE id = p_charge_id AND tenant_id = p_tenant_id AND kind = 'charge' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  SELECT COALESCE(-sum(credits), 0), COALESCE(-sum(overage_credits), 0) INTO v_prior, v_prior_ov
    FROM public.agent_customer_credit_charges WHERE adjusts_charge_id = v_c.id;
  IF v_prior + p_reduce_credits > v_c.credits THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'exceeds_original_charge');
  END IF;
  v_over := least(p_reduce_credits, v_c.overage_credits - v_prior_ov);  -- customer-favourable: overage first
  v_incl := p_reduce_credits - v_over;
  SELECT * INTO v_ledger FROM public.credit_ledger WHERE id = v_c.ledger_id FOR UPDATE;
  v_applied := v_c.ledger_applied AND NOT v_ledger.is_finalized;
  IF v_applied THEN
    UPDATE public.credit_ledger
       SET credits_used = credits_used - p_reduce_credits, agent_credits_used = agent_credits_used - p_reduce_credits,
           agent_overage_credits = agent_overage_credits - v_over,
           agent_overage_usd = agent_overage_usd - v_over * v_c.usd_per_credit
     WHERE id = v_ledger.id;
  END IF;
  INSERT INTO public.agent_customer_credit_charges (tenant_id, kind, adjusts_charge_id, ledger_id, period_start,
    pricing_policy_id, policy_version, usd_per_credit, markup_multiplier, minimum_credits_per_operation, credits,
    included_credits, overage_credits, overage_usd, ledger_applied, late, reason_code, actor_kind, actor_ref, approved_by)
  VALUES (p_tenant_id, 'adjustment', v_c.id, v_c.ledger_id, v_c.period_start, v_c.pricing_policy_id, v_c.policy_version,
    v_c.usd_per_credit, v_c.markup_multiplier, v_c.minimum_credits_per_operation, -p_reduce_credits, -v_incl, -v_over,
    -(v_over * v_c.usd_per_credit), v_applied, NOT v_applied, p_reason, 'operator', p_operator, p_approver)
  RETURNING id INTO v_id;
  PERFORM public.agent__billing_event(p_tenant_id, 'charge_adjusted', v_c.attempt_id, NULL, v_id, v_c.pricing_policy_id,
                                      NULL, -p_reduce_credits, -(v_over * v_c.usd_per_credit), p_reason, 'operator',
                                      p_operator, jsonb_build_object('approved_by', p_approver, 'adjusts', v_c.id));
  RETURN jsonb_build_object('ok', true, 'adjustment_id', v_id, 'credits', (-p_reduce_credits)::text,
                            'overage_credits', (-v_over)::text, 'ledger_applied', v_applied);
END;
$function$;

-- -----------------------------------------------------------------------------
-- Operator: controls and pricing policies
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_customer_billing_controls_set(
  p_mode text, p_stripe_trueup_enabled boolean, p_operator text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_row public.agent_customer_billing_controls%ROWTYPE;
BEGIN
  IF p_mode NOT IN ('disabled', 'enforced') OR p_stripe_trueup_enabled IS NULL
     OR (p_stripe_trueup_enabled AND p_mode <> 'enforced')
     OR p_operator IS NULL OR p_operator !~ '^[A-Za-z0-9._:@-]{1,100}$'
     OR (p_reason IS NOT NULL AND p_reason !~ '^[a-z][a-z0-9_]{0,63}$') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  UPDATE public.agent_customer_billing_controls
     SET customer_billing_mode = p_mode, stripe_trueup_enabled = p_stripe_trueup_enabled, reason_code = p_reason,
         updated_by = p_operator, updated_at = now()
   WHERE id = 1 RETURNING * INTO v_row;
  PERFORM public.agent__billing_event(NULL, 'controls_changed', NULL, NULL, NULL, NULL, NULL, NULL, NULL, p_reason,
                                      'operator', p_operator,
                                      jsonb_build_object('mode', p_mode, 'stripe_trueup_enabled', p_stripe_trueup_enabled));
  RETURN jsonb_build_object('ok', true, 'mode', v_row.customer_billing_mode,
                            'stripe_trueup_enabled', v_row.stripe_trueup_enabled);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_customer_pricing_policy_propose(
  p_tenant_id uuid, p_included_credits numeric, p_usd_per_credit numeric, p_markup_multiplier numeric,
  p_minimum_credits numeric, p_hard_cap_usd numeric, p_terms_version text, p_operator text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_row     public.agent_customer_pricing_policies%ROWTYPE;
  v_version integer;
BEGIN
  IF p_operator IS NULL OR p_operator !~ '^[A-Za-z0-9._:@-]{1,100}$'
     OR p_terms_version IS NULL OR p_terms_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
     OR (p_reason IS NOT NULL AND p_reason !~ '^[a-z][a-z0-9_]{0,63}$')
     OR p_included_credits IS NULL OR p_included_credits < 0 OR p_included_credits <> round(p_included_credits, 4)
     OR p_usd_per_credit IS NULL OR p_usd_per_credit <= 0 OR p_usd_per_credit <> round(p_usd_per_credit, 6)
     OR p_markup_multiplier IS NULL OR p_markup_multiplier <= 0 OR p_markup_multiplier > 100
     OR p_markup_multiplier <> round(p_markup_multiplier, 4)
     OR p_minimum_credits IS NULL OR p_minimum_credits < 0 OR p_minimum_credits <> round(p_minimum_credits, 4)
     OR p_hard_cap_usd IS NULL OR p_hard_cap_usd <= 0 OR p_hard_cap_usd <> round(p_hard_cap_usd, 2) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  -- Agent and legacy usage share credit_ledger, whose overage columns and the legacy cap price a credit at 2 cents
  -- (migration 014/020). A different per-credit price would make one balance mean two amounts: refused until the
  -- product owner decides a migration (docs/agent-harness/customer-billing.md, open decisions).
  IF p_usd_per_credit <> 0.02 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'usd_per_credit_must_match_legacy_credit_price');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tenant_not_found');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agent_pricing_policy:' || p_tenant_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.agent_customer_pricing_policies
              WHERE tenant_id = p_tenant_id AND approved_at IS NULL AND effective_to IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'proposal_pending');
  END IF;
  SELECT COALESCE(max(policy_version), 0) + 1 INTO v_version FROM public.agent_customer_pricing_policies
   WHERE tenant_id = p_tenant_id;
  INSERT INTO public.agent_customer_pricing_policies (tenant_id, policy_version, included_credits, usd_per_credit,
    markup_multiplier, minimum_credits_per_operation, hard_cap_usd, terms_version, reason_code, created_by)
  VALUES (p_tenant_id, v_version, p_included_credits, p_usd_per_credit, p_markup_multiplier, p_minimum_credits,
          p_hard_cap_usd, p_terms_version, p_reason, p_operator)
  RETURNING * INTO v_row;
  PERFORM public.agent__billing_event(p_tenant_id, 'pricing_policy_proposed', NULL, NULL, NULL, v_row.id, NULL, NULL,
                                      NULL, p_reason, 'operator', p_operator,
                                      jsonb_build_object('policy_version', v_version));
  RETURN jsonb_build_object('ok', true, 'policy_id', v_row.id, 'policy_version', v_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_customer_pricing_policy_approve(
  p_tenant_id uuid, p_policy_id uuid, p_approver text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_row public.agent_customer_pricing_policies%ROWTYPE;
BEGIN
  IF p_approver IS NULL OR p_approver !~ '^[A-Za-z0-9._:@-]{1,100}$'
     OR (p_reason IS NOT NULL AND p_reason !~ '^[a-z][a-z0-9_]{0,63}$') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agent_pricing_policy:' || p_tenant_id::text, 0));
  SELECT * INTO v_row FROM public.agent_customer_pricing_policies
   WHERE id = p_policy_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_row.approved_at IS NOT NULL OR v_row.effective_to IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending');
  END IF;
  IF v_row.created_by = p_approver THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'approver_must_differ_from_proposer');
  END IF;
  UPDATE public.agent_customer_pricing_policies SET effective_to = now(), retired_by = p_approver
   WHERE tenant_id = p_tenant_id AND approved_at IS NOT NULL AND effective_to IS NULL;
  UPDATE public.agent_customer_pricing_policies SET approved_by = p_approver, approved_at = now(), effective_from = now()
   WHERE id = v_row.id RETURNING * INTO v_row;
  PERFORM public.agent__billing_event(p_tenant_id, 'pricing_policy_approved', NULL, NULL, NULL, v_row.id, NULL, NULL,
                                      NULL, p_reason, 'operator', p_approver,
                                      jsonb_build_object('policy_version', v_row.policy_version));
  RETURN jsonb_build_object('ok', true, 'policy_id', v_row.id, 'policy_version', v_row.policy_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_customer_pricing_policy_retire(p_tenant_id uuid, p_operator text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF p_operator IS NULL OR p_operator !~ '^[A-Za-z0-9._:@-]{1,100}$'
     OR p_reason IS NULL OR p_reason !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agent_pricing_policy:' || p_tenant_id::text, 0));
  UPDATE public.agent_customer_pricing_policies SET effective_to = now(), retired_by = p_operator
   WHERE tenant_id = p_tenant_id AND effective_to IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public.agent__billing_event(p_tenant_id, 'pricing_policy_retired', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                                      p_reason, 'operator', p_operator, jsonb_build_object('closed', v_n));
  RETURN jsonb_build_object('ok', true, 'closed', v_n);
END;
$function$;

-- -----------------------------------------------------------------------------
-- Customer (GM) consent. The API derives tenant and user from the verified token; the database re-verifies that the
-- user is an active GM of exactly that hotel. Both RPCs lock the open ledger row, so they serialise with holds and with
-- the dispatch re-check.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent__is_active_gm(p_tenant_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p_user_id AND r.tenant_id = p_tenant_id
                   AND r.role = 'gm' AND r.is_active)
     AND EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = p_user_id AND p.tenant_id = p_tenant_id AND p.is_active);
$function$;

CREATE OR REPLACE FUNCTION public.agent_customer_overage_authorize(
  p_tenant_id uuid, p_user_id uuid, p_limit_credits numeric, p_expected_policy_id uuid, p_terms_version text,
  p_expected_max_exposure_usd numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_policy   public.agent_customer_pricing_policies%ROWTYPE;
  v_prev     public.agent_customer_overage_authorizations%ROWTYPE;
  v_row      public.agent_customer_overage_authorizations%ROWTYPE;
  v_exposure numeric;
BEGIN
  IF NOT public.agent__is_active_gm(p_tenant_id, p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;
  IF p_limit_credits IS NULL OR p_limit_credits <= 0 OR p_limit_credits <> trunc(p_limit_credits)
     OR p_limit_credits > 10000000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_limit');
  END IF;
  PERFORM 1 FROM public.credit_ledger
   WHERE tenant_id = p_tenant_id AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('agent_overage:' || p_tenant_id::text, 0));
  v_policy := public.agent__active_pricing_policy(p_tenant_id);
  IF v_policy.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pricing_policy_missing');
  END IF;
  IF v_policy.id IS DISTINCT FROM p_expected_policy_id OR v_policy.terms_version IS DISTINCT FROM p_terms_version THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'terms_changed');
  END IF;
  v_exposure := ceil(p_limit_credits * v_policy.usd_per_credit * 100) / 100;
  IF p_expected_max_exposure_usd IS DISTINCT FROM v_exposure THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'exposure_not_acknowledged', 'max_exposure_usd', v_exposure::text);
  END IF;
  IF v_exposure > v_policy.hard_cap_usd THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'exceeds_hard_cap', 'hard_cap_usd', v_policy.hard_cap_usd::text);
  END IF;
  v_prev := public.agent__current_overage_authorization(p_tenant_id);
  INSERT INTO public.agent_customer_overage_authorizations (tenant_id, version, state, authorized_limit_credits,
    max_exposure_usd, pricing_policy_id, terms_version, actor_user_id, actor_role)
  VALUES (p_tenant_id, COALESCE(v_prev.version, 0) + 1, 'authorized', p_limit_credits, v_exposure, v_policy.id,
          v_policy.terms_version, p_user_id, 'gm')
  RETURNING * INTO v_row;
  PERFORM public.agent__billing_event(p_tenant_id, 'overage_authorized', NULL, NULL, NULL, v_policy.id, v_row.id,
                                      p_limit_credits, v_exposure, NULL, 'customer', p_user_id::text,
                                      jsonb_build_object('version', v_row.version, 'terms_version', v_policy.terms_version));
  RETURN jsonb_build_object('ok', true, 'authorization_id', v_row.id, 'version', v_row.version,
                            'authorized_limit_credits', v_row.authorized_limit_credits::text,
                            'max_exposure_usd', v_row.max_exposure_usd::text, 'created_at', v_row.created_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_customer_overage_revoke(p_tenant_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_prev public.agent_customer_overage_authorizations%ROWTYPE;
  v_row  public.agent_customer_overage_authorizations%ROWTYPE;
BEGIN
  IF NOT public.agent__is_active_gm(p_tenant_id, p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;
  PERFORM 1 FROM public.credit_ledger
   WHERE tenant_id = p_tenant_id AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('agent_overage:' || p_tenant_id::text, 0));
  v_prev := public.agent__current_overage_authorization(p_tenant_id);
  IF v_prev.id IS NULL OR v_prev.state = 'revoked' THEN
    RETURN jsonb_build_object('ok', true, 'already_off', true);
  END IF;
  INSERT INTO public.agent_customer_overage_authorizations (tenant_id, version, state, pricing_policy_id,
    terms_version, actor_user_id, actor_role)
  VALUES (p_tenant_id, v_prev.version + 1, 'revoked', v_prev.pricing_policy_id, v_prev.terms_version, p_user_id, 'gm')
  RETURNING * INTO v_row;
  PERFORM public.agent__billing_event(p_tenant_id, 'overage_revoked', NULL, NULL, NULL, v_prev.pricing_policy_id,
                                      v_row.id, NULL, NULL, NULL, 'customer', p_user_id::text,
                                      jsonb_build_object('version', v_row.version));
  RETURN jsonb_build_object('ok', true, 'authorization_id', v_row.id, 'version', v_row.version,
                            'created_at', v_row.created_at);
END;
$function$;

-- -----------------------------------------------------------------------------
-- Customer-facing reads (tenant-scoped; the API passes the verified hotel id)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_customer_billing_summary(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_policy  public.agent_customer_pricing_policies%ROWTYPE;
  v_auth    public.agent_customer_overage_authorizations%ROWTYPE;
  v_ledger  public.credit_ledger%ROWTYPE;
  v_pending numeric;
BEGIN
  v_policy := public.agent__active_pricing_policy(p_tenant_id);
  v_auth := public.agent__current_overage_authorization(p_tenant_id);
  SELECT * INTO v_ledger FROM public.credit_ledger
   WHERE tenant_id = p_tenant_id AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE;
  SELECT COALESCE(sum(held_credits), 0) INTO v_pending FROM public.agent_customer_credit_holds
   WHERE tenant_id = p_tenant_id AND state = 'awaiting_reconciliation';
  RETURN jsonb_build_object(
    'customer_billing_mode', public.agent__billing_mode(),
    'policy', CASE WHEN v_policy.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_policy.id, 'version', v_policy.policy_version, 'included_credits', v_policy.included_credits::text,
      'usd_per_credit', v_policy.usd_per_credit::text, 'hard_cap_usd', v_policy.hard_cap_usd::text,
      'terms_version', v_policy.terms_version, 'effective_from', v_policy.effective_from) END,
    'authorization', CASE WHEN v_auth.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_auth.id, 'version', v_auth.version, 'state', v_auth.state,
      'authorized_limit_credits', v_auth.authorized_limit_credits::text, 'max_exposure_usd', v_auth.max_exposure_usd::text,
      'pricing_policy_id', v_auth.pricing_policy_id, 'terms_version', v_auth.terms_version,
      'created_at', v_auth.created_at, 'current_policy', v_auth.pricing_policy_id IS NOT DISTINCT FROM v_policy.id) END,
    'ledger', CASE WHEN v_ledger.id IS NULL THEN NULL ELSE jsonb_build_object(
      'period_start', v_ledger.period_start, 'period_end', v_ledger.period_end, 'is_finalized', v_ledger.is_finalized,
      'credits_included', (v_ledger.credits_included + v_ledger.credits_purchased)::text,
      'credits_used', v_ledger.credits_used::text, 'agent_credits_used', v_ledger.agent_credits_used::text,
      'overage_credits', v_ledger.overage_credits::text, 'overage_cost_cents', v_ledger.overage_cost_cents::text,
      'agent_overage_credits', v_ledger.agent_overage_credits::text, 'agent_overage_usd', v_ledger.agent_overage_usd::text,
      'agent_held_credits', v_ledger.agent_held_credits::text,
      'agent_held_overage_credits', v_ledger.agent_held_overage_credits::text) END,
    'pending_reconciliation_credits', v_pending::text);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_customer_billing_history(p_tenant_id uuid, p_limit integer DEFAULT 12)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(p ORDER BY p ->> 'period_start' DESC), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'period_start', l.period_start, 'period_end', l.period_end, 'is_finalized', l.is_finalized,
      'credits_included', (l.credits_included + l.credits_purchased)::text, 'credits_used', l.credits_used::text,
      'agent_credits_used', l.agent_credits_used::text, 'overage_credits', l.overage_credits::text,
      'overage_cost_cents', l.overage_cost_cents::text, 'agent_overage_credits', l.agent_overage_credits::text,
      'agent_overage_usd', l.agent_overage_usd::text, 'legacy_invoice_item_recorded', l.stripe_invoice_item_id IS NOT NULL,
      'adjustment_credits', COALESCE((SELECT sum(c.credits) FROM public.agent_customer_credit_charges c
                                       WHERE c.ledger_id = l.id AND c.kind = 'adjustment'), 0)::text,
      'late_charge_credits', COALESCE((SELECT sum(c.credits) FROM public.agent_customer_credit_charges c
                                        WHERE c.ledger_id = l.id AND c.late), 0)::text,
      'pending_reconciliation_credits', COALESCE((SELECT sum(h.held_credits) FROM public.agent_customer_credit_holds h
                                                   WHERE h.ledger_id = l.id AND h.state = 'awaiting_reconciliation'), 0)::text,
      'operations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', o.id, 'sequence', o.sequence, 'state', o.state, 'amount_cents', o.amount_cents,
          'overage_credits', o.overage_credits::text, 'invoice_status', o.invoice_status,
          'hosted_invoice_url', CASE WHEN o.stripe_invoice_id IS NOT NULL THEN o.hosted_invoice_url END,
          'has_invoice', o.stripe_invoice_id IS NOT NULL, 'updated_at', o.updated_at) ORDER BY o.sequence)
        FROM public.agent_billing_operations o WHERE o.tenant_id = l.tenant_id AND o.period_start = l.period_start), '[]'::jsonb)
    ) AS p
    FROM public.credit_ledger l WHERE l.tenant_id = p_tenant_id
    ORDER BY l.period_start DESC LIMIT least(greatest(COALESCE(p_limit, 12), 1), 36)
  ) s;
$function$;

-- -----------------------------------------------------------------------------
-- Stripe true-up outbox
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent__billing_op_json(p_o public.agent_billing_operations)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', p_o.id, 'tenant_id', p_o.tenant_id, 'period_start', p_o.period_start, 'period_end', p_o.period_end,
    'sequence', p_o.sequence, 'charge_source', p_o.charge_source, 'calculation_version', p_o.calculation_version,
    'amount_cents', p_o.amount_cents, 'currency', p_o.currency, 'overage_credits', p_o.overage_credits::text,
    'overage_usd_exact', p_o.overage_usd_exact::text, 'charge_count', p_o.charge_count,
    'calculation_digest', p_o.calculation_digest, 'stripe_customer_id', p_o.stripe_customer_id,
    'stripe_subscription_id', p_o.stripe_subscription_id, 'state', p_o.state,
    'stripe_invoice_item_id', p_o.stripe_invoice_item_id, 'stripe_invoice_id', p_o.stripe_invoice_id,
    'invoice_status', p_o.invoice_status, 'submit_attempts', p_o.submit_attempts, 'last_error_code', p_o.last_error_code,
    'last_event_created', p_o.last_event_created, 'manual_reason', p_o.manual_reason, 'created_at', p_o.created_at,
    'updated_at', p_o.updated_at);
$function$;

CREATE OR REPLACE FUNCTION public.agent__billing_op_event(
  p_o public.agent_billing_operations, p_event text, p_from text, p_reason text, p_actor_kind text, p_actor_ref text,
  p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS void LANGUAGE sql VOLATILE SET search_path = ''
AS $function$
  INSERT INTO public.agent_billing_operation_events (tenant_id, operation_id, event_type, from_state, to_state,
    reason_code, actor_kind, actor_ref, detail)
  VALUES (p_o.tenant_id, p_o.id, p_event, p_from, p_o.state, p_reason, p_actor_kind, p_actor_ref,
          COALESCE(p_detail, '{}'::jsonb));
$function$;

-- Periods that ended (with a grace window) and still have charges not assigned to any Stripe operation.
CREATE OR REPLACE FUNCTION public.agent_billing_periods_due(p_limit integer DEFAULT 50, p_grace_days integer DEFAULT 1)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('tenant_id', t.tenant_id, 'period_start', t.period_start)), '[]'::jsonb)
    FROM (SELECT DISTINCT c.tenant_id, c.period_start
            FROM public.agent_customer_credit_charges c JOIN public.credit_ledger l ON l.id = c.ledger_id
           WHERE c.billing_operation_id IS NULL
             AND l.period_end < CURRENT_DATE - greatest(COALESCE(p_grace_days, 1), 1)
           ORDER BY c.period_start, c.tenant_id
           LIMIT least(greatest(COALESCE(p_limit, 50), 1), 500)) t;
$function$;

CREATE OR REPLACE FUNCTION public.agent_billing_operation_prepare(
  p_tenant_id uuid, p_period_start date, p_actor text, p_grace_days integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_ledger    public.credit_ledger%ROWTYPE;
  v_sub       public.subscriptions%ROWTYPE;
  v_o         public.agent_billing_operations%ROWTYPE;
  v_ids       uuid[];
  v_credits   numeric;
  v_usd       numeric;
  v_digest    text;
  v_cents     bigint;
  v_seq       integer;
  v_state     text := 'prepared';
  v_manual    text;
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^[A-Za-z0-9._:@-]{1,100}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agent_billing_op:' || p_tenant_id::text || ':' || p_period_start::text, 0));
  SELECT * INTO v_ledger FROM public.credit_ledger WHERE tenant_id = p_tenant_id AND period_start = p_period_start;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_ledger');
  END IF;
  IF v_ledger.period_end >= CURRENT_DATE - greatest(COALESCE(p_grace_days, 1), 1) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'period_not_ended');
  END IF;
  SELECT array_agg(id ORDER BY id), COALESCE(sum(overage_credits), 0), COALESCE(sum(overage_usd), 0),
         encode(sha256(convert_to(COALESCE(string_agg(id::text || ':' || overage_usd::text, ',' ORDER BY id), ''), 'UTF8')), 'hex')
    INTO v_ids, v_credits, v_usd, v_digest
    FROM (SELECT id, overage_credits, overage_usd FROM public.agent_customer_credit_charges
           WHERE tenant_id = p_tenant_id AND period_start = p_period_start AND billing_operation_id IS NULL
           FOR UPDATE) c;
  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'status', 'nothing_new');
  END IF;
  v_cents := round(v_usd * 100)::bigint;   -- half away from zero, on the period total (never per call)
  SELECT * INTO v_sub FROM public.subscriptions WHERE tenant_id = p_tenant_id;
  IF v_cents = 0 THEN
    v_state := 'nothing_to_bill';
  ELSIF v_cents < 0 THEN
    v_state := 'manual_intervention'; v_manual := 'net_credit_requires_operator';
  ELSIF v_sub.stripe_customer_id IS NULL OR v_sub.stripe_customer_id !~ '^cus_[A-Za-z0-9]{1,250}$' THEN
    v_state := 'manual_intervention'; v_manual := 'stripe_customer_missing';
  ELSIF v_sub.plan_status <> 'active' OR v_sub.stripe_subscription_id IS NULL
        OR v_sub.stripe_subscription_id !~ '^sub_[A-Za-z0-9]{1,250}$' THEN
    v_state := 'manual_intervention'; v_manual := 'subscription_not_active';
  END IF;
  SELECT COALESCE(max(sequence), 0) + 1 INTO v_seq FROM public.agent_billing_operations
   WHERE tenant_id = p_tenant_id AND period_start = p_period_start;
  INSERT INTO public.agent_billing_operations (tenant_id, period_start, period_end, sequence, amount_cents,
    overage_credits, overage_usd_exact, charge_count, calculation_digest, stripe_customer_id, stripe_subscription_id,
    state, manual_reason, created_by)
  VALUES (p_tenant_id, p_period_start, v_ledger.period_end, v_seq, v_cents, v_credits, v_usd, cardinality(v_ids), v_digest,
          CASE WHEN v_sub.stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,250}$' THEN v_sub.stripe_customer_id END,
          CASE WHEN v_sub.stripe_subscription_id ~ '^sub_[A-Za-z0-9]{1,250}$' THEN v_sub.stripe_subscription_id END,
          v_state, v_manual, p_actor)
  RETURNING * INTO v_o;
  UPDATE public.agent_customer_credit_charges SET billing_operation_id = v_o.id WHERE id = ANY (v_ids);
  PERFORM public.agent__billing_op_event(v_o, 'prepared', NULL, v_manual, 'worker', p_actor,
                                         jsonb_build_object('charge_count', cardinality(v_ids)));
  RETURN jsonb_build_object('ok', true, 'status', 'created', 'operation', public.agent__billing_op_json(v_o));
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_billing_operation_claim(p_operation_id uuid, p_actor text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_o    public.agent_billing_operations%ROWTYPE;
  v_from text;
BEGIN
  IF NOT COALESCE((SELECT stripe_trueup_enabled AND customer_billing_mode = 'enforced'
                     FROM public.agent_customer_billing_controls WHERE id = 1), false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stripe_trueup_disabled');
  END IF;
  SELECT * INTO v_o FROM public.agent_billing_operations WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  v_from := v_o.state;
  IF v_o.state = 'submitting' AND v_o.updated_at < now() - interval '10 minutes' THEN
    -- A worker died between claim and outcome: the request may or may not have reached Stripe.
    UPDATE public.agent_billing_operations SET state = 'ambiguous', last_error_code = 'claim_expired'
     WHERE id = v_o.id RETURNING * INTO v_o;
    PERFORM public.agent__billing_op_event(v_o, 'claim_expired', v_from, 'claim_expired', 'worker', p_actor);
    RETURN jsonb_build_object('ok', false, 'reason', 'reconcile_first', 'operation', public.agent__billing_op_json(v_o));
  END IF;
  IF v_o.state = 'ambiguous' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reconcile_first', 'operation', public.agent__billing_op_json(v_o));
  END IF;
  IF v_o.state <> 'prepared' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_claimable', 'state', v_o.state);
  END IF;
  IF v_o.submit_attempts >= 10 THEN
    UPDATE public.agent_billing_operations SET state = 'manual_intervention', manual_reason = 'submit_attempts_exhausted'
     WHERE id = v_o.id RETURNING * INTO v_o;
    PERFORM public.agent__billing_op_event(v_o, 'manual_required', v_from, 'submit_attempts_exhausted', 'worker', p_actor);
    RETURN jsonb_build_object('ok', false, 'reason', 'submit_attempts_exhausted');
  END IF;
  UPDATE public.agent_billing_operations SET state = 'submitting', submit_attempts = submit_attempts + 1
   WHERE id = v_o.id RETURNING * INTO v_o;
  PERFORM public.agent__billing_op_event(v_o, 'claimed', v_from, NULL, 'worker', p_actor);
  RETURN jsonb_build_object('ok', true, 'operation', public.agent__billing_op_json(v_o));
END;
$function$;

-- Record an externally observed outcome. Every Stripe-derived fact passes the customer check; a mismatch never applies.
CREATE OR REPLACE FUNCTION public.agent_billing_operation_record(
  p_operation_id uuid, p_outcome text, p_actor_kind text, p_actor_ref text, p_stripe_customer_id text,
  p_invoice_item_id text, p_invoice_id text, p_invoice_status text, p_hosted_invoice_url text, p_livemode boolean,
  p_error_code text, p_event_created bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_o      public.agent_billing_operations%ROWTYPE;
  v_from   text;
  v_state  text;
  v_err    text := CASE WHEN p_error_code ~ '^[a-z][a-z0-9_]{0,63}$' THEN p_error_code END;
  v_url    text := CASE WHEN length(p_hosted_invoice_url) <= 600
                             AND p_hosted_invoice_url ~ '^https://[A-Za-z0-9.-]+\.stripe\.com/[A-Za-z0-9/_.~?=&%-]+$'
                        THEN p_hosted_invoice_url END;
BEGIN
  IF p_actor_kind NOT IN ('worker', 'webhook', 'reconciler', 'operator')
     OR p_actor_ref IS NULL OR p_actor_ref !~ '^[A-Za-z0-9._:@-]{1,100}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  SELECT * INTO v_o FROM public.agent_billing_operations WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  v_from := v_o.state;

  IF p_outcome IN ('item_created', 'invoice_status') THEN
    IF COALESCE(p_livemode, true) THEN
      UPDATE public.agent_billing_operations SET state = 'manual_intervention', manual_reason = 'livemode_refused'
       WHERE id = v_o.id AND state NOT IN ('paid', 'void', 'nothing_to_bill') RETURNING * INTO v_o;
      IF FOUND THEN
        PERFORM public.agent__billing_op_event(v_o, 'manual_required', v_from, 'livemode_refused', p_actor_kind, p_actor_ref);
      END IF;
      RETURN jsonb_build_object('ok', false, 'reason', 'livemode_refused');
    END IF;
    IF p_stripe_customer_id IS DISTINCT FROM v_o.stripe_customer_id THEN
      IF v_o.state NOT IN ('paid', 'void', 'nothing_to_bill') THEN
        UPDATE public.agent_billing_operations SET state = 'manual_intervention', manual_reason = 'customer_mismatch'
         WHERE id = v_o.id RETURNING * INTO v_o;
        PERFORM public.agent__billing_op_event(v_o, 'manual_required', v_from, 'customer_mismatch', p_actor_kind, p_actor_ref);
      END IF;
      RETURN jsonb_build_object('ok', false, 'reason', 'customer_mismatch');
    END IF;
  END IF;

  IF p_outcome = 'item_created' THEN
    IF p_invoice_item_id IS NULL OR p_invoice_item_id !~ '^ii_[A-Za-z0-9]{1,250}$' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
    END IF;
    IF v_o.stripe_invoice_item_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', v_o.stripe_invoice_item_id = p_invoice_item_id, 'replayed', true,
                                'reason', CASE WHEN v_o.stripe_invoice_item_id <> p_invoice_item_id THEN 'item_conflict' END,
                                'operation', public.agent__billing_op_json(v_o));
    END IF;
    IF v_o.state NOT IN ('submitting', 'ambiguous', 'manual_intervention') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'illegal_transition', 'state', v_o.state);
    END IF;
    UPDATE public.agent_billing_operations
       SET state = 'item_created', stripe_invoice_item_id = p_invoice_item_id, last_error_code = NULL,
           last_confirmed_at = now(), manual_reason = NULL
     WHERE id = v_o.id RETURNING * INTO v_o;
    PERFORM public.agent__billing_op_event(v_o, 'item_recorded', v_from, NULL, p_actor_kind, p_actor_ref);
    RETURN jsonb_build_object('ok', true, 'operation', public.agent__billing_op_json(v_o));

  ELSIF p_outcome = 'absent' THEN
    IF v_o.state NOT IN ('submitting', 'ambiguous') OR v_o.stripe_invoice_item_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'illegal_transition', 'state', v_o.state);
    END IF;
    UPDATE public.agent_billing_operations SET state = 'prepared', last_error_code = COALESCE(v_err, 'confirmed_absent')
     WHERE id = v_o.id RETURNING * INTO v_o;
    PERFORM public.agent__billing_op_event(v_o, 'confirmed_absent', v_from, v_err, p_actor_kind, p_actor_ref);
    RETURN jsonb_build_object('ok', true, 'operation', public.agent__billing_op_json(v_o));

  ELSIF p_outcome IN ('ambiguous', 'rejected') THEN
    IF v_o.state <> 'submitting' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'illegal_transition', 'state', v_o.state);
    END IF;
    UPDATE public.agent_billing_operations
       SET state = CASE p_outcome WHEN 'ambiguous' THEN 'ambiguous' ELSE 'manual_intervention' END,
           manual_reason = CASE p_outcome WHEN 'rejected' THEN COALESCE(v_err, 'stripe_rejected') END,
           last_error_code = COALESCE(v_err, p_outcome)
     WHERE id = v_o.id RETURNING * INTO v_o;
    PERFORM public.agent__billing_op_event(v_o, p_outcome, v_from, v_err, p_actor_kind, p_actor_ref);
    RETURN jsonb_build_object('ok', true, 'operation', public.agent__billing_op_json(v_o));

  ELSIF p_outcome = 'invoice_status' THEN
    IF v_o.stripe_invoice_item_id IS NULL OR p_invoice_id IS NULL OR p_invoice_id !~ '^in_[A-Za-z0-9]{1,250}$'
       OR p_invoice_status NOT IN ('draft', 'open', 'paid', 'void', 'uncollectible', 'payment_failed') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
    END IF;
    IF v_o.stripe_invoice_id IS NOT NULL AND v_o.stripe_invoice_id <> p_invoice_id THEN
      UPDATE public.agent_billing_operations SET state = 'manual_intervention', manual_reason = 'invoice_conflict'
       WHERE id = v_o.id AND state NOT IN ('paid', 'void') RETURNING * INTO v_o;
      IF FOUND THEN
        PERFORM public.agent__billing_op_event(v_o, 'manual_required', v_from, 'invoice_conflict', p_actor_kind, p_actor_ref);
      END IF;
      RETURN jsonb_build_object('ok', false, 'reason', 'invoice_conflict');
    END IF;
    IF v_o.state IN ('paid', 'void') THEN
      RETURN jsonb_build_object('ok', true, 'ignored', 'final', 'operation', public.agent__billing_op_json(v_o));
    END IF;
    IF p_event_created IS NOT NULL AND v_o.last_event_created IS NOT NULL AND p_event_created < v_o.last_event_created THEN
      RETURN jsonb_build_object('ok', true, 'ignored', 'stale_event', 'operation', public.agent__billing_op_json(v_o));
    END IF;
    v_state := CASE p_invoice_status WHEN 'paid' THEN 'paid' WHEN 'void' THEN 'void'
                 WHEN 'uncollectible' THEN 'uncollectible' WHEN 'payment_failed' THEN 'payment_failed' ELSE 'invoiced' END;
    IF v_o.state = 'manual_intervention' AND v_o.manual_reason IN ('customer_mismatch', 'livemode_refused', 'invoice_conflict') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'operator_hold', 'operation', public.agent__billing_op_json(v_o));
    END IF;
    UPDATE public.agent_billing_operations
       SET state = v_state, stripe_invoice_id = p_invoice_id,
           invoice_status = CASE WHEN p_invoice_status = 'payment_failed' THEN 'open' ELSE p_invoice_status END,
           hosted_invoice_url = COALESCE(v_url, hosted_invoice_url),
           last_event_created = COALESCE(greatest(p_event_created, last_event_created), p_event_created, last_event_created),
           last_confirmed_at = now(), manual_reason = CASE WHEN v_state = 'manual_intervention' THEN manual_reason END
     WHERE id = v_o.id RETURNING * INTO v_o;
    PERFORM public.agent__billing_op_event(v_o, 'invoice_' || p_invoice_status, v_from, NULL, p_actor_kind, p_actor_ref);
    RETURN jsonb_build_object('ok', true, 'operation', public.agent__billing_op_json(v_o));

  ELSIF p_outcome = 'manual' THEN
    IF p_actor_kind NOT IN ('operator', 'reconciler') OR v_err IS NULL OR v_o.state IN ('paid', 'void', 'nothing_to_bill') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'illegal_transition', 'state', v_o.state);
    END IF;
    UPDATE public.agent_billing_operations SET state = 'manual_intervention', manual_reason = v_err
     WHERE id = v_o.id RETURNING * INTO v_o;
    PERFORM public.agent__billing_op_event(v_o, 'manual_required', v_from, v_err, p_actor_kind, p_actor_ref);
    RETURN jsonb_build_object('ok', true, 'operation', public.agent__billing_op_json(v_o));

  ELSIF p_outcome = 'resolve_retry' THEN
    -- Operator confirmed (with Stripe evidence) that no item exists and the charge should be submitted again.
    IF p_actor_kind <> 'operator' OR v_o.state <> 'manual_intervention' OR v_o.stripe_invoice_item_id IS NOT NULL
       OR v_err IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'illegal_transition', 'state', v_o.state);
    END IF;
    UPDATE public.agent_billing_operations SET state = 'prepared', manual_reason = NULL, resolved_by = p_actor_ref,
           resolved_at = now(), submit_attempts = 0
     WHERE id = v_o.id RETURNING * INTO v_o;
    PERFORM public.agent__billing_op_event(v_o, 'operator_resolved', v_from, v_err, p_actor_kind, p_actor_ref);
    RETURN jsonb_build_object('ok', true, 'operation', public.agent__billing_op_json(v_o));
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'invalid_outcome');
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_billing_operations_due(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(public.agent__billing_op_json(o) ORDER BY o.updated_at), '[]'::jsonb)
    FROM (SELECT * FROM public.agent_billing_operations
           WHERE state IN ('prepared', 'ambiguous', 'item_created', 'invoiced', 'payment_failed', 'uncollectible')
              OR (state = 'submitting' AND updated_at < now() - interval '10 minutes')
           ORDER BY updated_at LIMIT least(greatest(COALESCE(p_limit, 50), 1), 500)) o;
$function$;

CREATE OR REPLACE FUNCTION public.agent_billing_operations_find(p_invoice_item_ids text[], p_invoice_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(public.agent__billing_op_json(o)), '[]'::jsonb)
    FROM public.agent_billing_operations o
   WHERE (p_invoice_item_ids IS NOT NULL AND o.stripe_invoice_item_id = ANY (p_invoice_item_ids))
      OR (p_invoice_id IS NOT NULL AND o.stripe_invoice_id = p_invoice_id);
$function$;

-- -----------------------------------------------------------------------------
-- Privileges: service role only
-- -----------------------------------------------------------------------------
DO $grants$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.agent__billing_mode()',
    'public.agent__billing_event(uuid, text, uuid, uuid, uuid, uuid, uuid, numeric, numeric, text, text, text, jsonb)',
    'public.agent__active_pricing_policy(uuid)',
    'public.agent__current_overage_authorization(uuid)',
    'public.agent__customer_quote(numeric, public.agent_customer_pricing_policies)',
    'public.agent__open_ledger_locked(uuid)',
    'public.agent__hold_json(public.agent_customer_credit_holds)',
    'public.agent__customer_hold_release(public.agent_customer_credit_holds, text, text, text)',
    'public.agent__customer_hold_create(public.agent_model_attempts, text)',
    'public.agent__customer_convert(public.agent_customer_credit_holds, public.agent_model_attempts, text, text)',
    'public.agent__customer_settle_attempt(uuid, text, text, boolean)',
    'public.agent__guard_attempt_customer_hold()',
    'public.agent__is_active_gm(uuid, uuid)',
    'public.agent__billing_op_json(public.agent_billing_operations)',
    'public.agent__billing_op_event(public.agent_billing_operations, text, text, text, text, text, jsonb)',
    'public.agent_billing_attempt_reserve(uuid, bigint, text, uuid, text, integer, text, text, text, integer, integer, numeric)',
    'public.agent_billing_attempt_dispatch(uuid, uuid, bigint, text)',
    'public.agent_billing_attempt_release(uuid, bigint, text)',
    'public.agent_billing_attempt_settle(uuid, bigint, text, numeric, text, jsonb, text, text, text, text, text, text, text)',
    'public.agent_customer_billing_reconcile(integer, boolean, text)',
    'public.agent_customer_charge_adjust(uuid, uuid, numeric, text, text, text)',
    'public.agent_customer_billing_controls_set(text, boolean, text, text)',
    'public.agent_customer_pricing_policy_propose(uuid, numeric, numeric, numeric, numeric, numeric, text, text, text)',
    'public.agent_customer_pricing_policy_approve(uuid, uuid, text, text)',
    'public.agent_customer_pricing_policy_retire(uuid, text, text)',
    'public.agent_customer_overage_authorize(uuid, uuid, numeric, uuid, text, numeric)',
    'public.agent_customer_overage_revoke(uuid, uuid)',
    'public.agent_customer_billing_summary(uuid)',
    'public.agent_customer_billing_history(uuid, integer)',
    'public.agent_billing_periods_due(integer, integer)',
    'public.agent_billing_operation_prepare(uuid, date, text, integer)',
    'public.agent_billing_operation_claim(uuid, text)',
    'public.agent_billing_operation_record(uuid, text, text, text, text, text, text, text, text, boolean, text, bigint)',
    'public.agent_billing_operations_due(integer)',
    'public.agent_billing_operations_find(text[], text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$grants$;

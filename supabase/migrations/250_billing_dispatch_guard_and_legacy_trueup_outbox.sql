-- =============================================================================
-- Migration 250: H4 hardening -- full customer-authorization dispatch guard + durable legacy true-up outbox
-- =============================================================================
-- Additive only (new tables, new functions, CREATE OR REPLACE of two H4-owned functions from migration 249).
-- No H3 function is replaced; no existing table, column, constraint or row is changed or removed.
--
-- PART A -- dispatch guard.
--   Migration 249's trigger agent_model_attempts_customer_hold_guard only required that SOME 'held' hold existed.
--   Calling the bare H3 RPC agent_model_attempt_dispatch could therefore dispatch a held attempt after the GM revoked
--   overage consent, after the pricing policy was superseded or retired, or after the consent was narrowed below the
--   overage already held. agent__customer_dispatch_refusal() is now the single definition of "this hold may still be
--   dispatched"; the trigger enforces it for EVERY writer (bare H3 RPC, raw UPDATE) while billing is enforced, and the
--   H4 wrapper uses the same function so both paths agree exactly. With billing disabled the trigger is a no-op (exact
--   H3 behaviour).
--   Serialisation: policy approve/retire hold the per-hotel 'agent_pricing_policy:' advisory lock exclusively until
--   commit; the check takes it SHARED. Overage authorize/revoke lock the open credit_ledger row; the check locks the
--   hold's ledger row. A change that commits while a dispatch waits is therefore always seen. Policy validity is
--   checked on the policy row itself (never superseded, never closed), not by comparing transaction start times.
--
-- PART B -- legacy monthly true-up outbox (billing_trueup_operations).
--   The legacy true-up created the Stripe invoice item first and recorded it second, protected only by Stripe's
--   idempotency key. A failed record write followed by a retry after Stripe pruned the key (>= 24h; the cron fires on
--   days 1-3) created a second invoice item for the same month. Now, as in the H4 outbox:
--     * one operation row per hotel-month, ever (UNIQUE (tenant_id, period_start)), created and the ledger finalized in
--       ONE transaction BEFORE any Stripe call; its id is the permanent operation identity, the Stripe idempotency key
--       and the invoice item metadata value;
--     * the worker searches the customer's invoice items for that identity (and for unlinked items in the legacy
--       format) before every create; an ambiguous outcome is reconciled, never retried blind; anything unproven stops
--       in manual_intervention;
--     * already-finalized periods are never touched (no operation is created for them), so historical invoices and
--       items are never rebilled or modified;
--     * a cancellation records the period in manual_intervention ('cancellation_policy_pending') and never submits.
--   Amounts use the same arithmetic as services/agent_billing/pricing.py legacy_overage_cents (pricing unchanged).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PART A: one definition of a dispatchable hold
-- -----------------------------------------------------------------------------
-- Returns NULL when the hold may be dispatched, else the refusal reason. The caller holds the attempt row lock.
CREATE OR REPLACE FUNCTION public.agent__customer_dispatch_refusal(p_h public.agent_customer_credit_holds)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $function$
DECLARE
  v_policy public.agent_customer_pricing_policies%ROWTYPE;
  v_auth   public.agent_customer_overage_authorizations%ROWTYPE;
  v_ledger public.credit_ledger%ROWTYPE;
BEGIN
  IF p_h.id IS NULL OR p_h.state <> 'held' THEN
    RETURN 'customer_hold_missing';
  END IF;
  -- Wait for any policy approval/retirement in flight for this hotel (they hold this lock exclusively).
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('agent_pricing_policy:' || p_h.tenant_id::text, 0));
  SELECT * INTO v_policy FROM public.agent_customer_pricing_policies
   WHERE id = p_h.pricing_policy_id AND tenant_id = p_h.tenant_id;
  IF NOT FOUND OR v_policy.approved_at IS NULL OR v_policy.effective_from > clock_timestamp()
     OR (v_policy.effective_to IS NOT NULL AND v_policy.effective_to <= clock_timestamp())
     OR EXISTS (SELECT 1 FROM public.agent_customer_pricing_policies p
                 WHERE p.tenant_id = p_h.tenant_id AND p.approved_at IS NOT NULL
                   AND p.policy_version > v_policy.policy_version) THEN
    RETURN 'customer_pricing_policy_changed';
  END IF;
  IF p_h.held_overage_credits > 0 THEN
    -- Wait for any overage authorize/revoke in flight (they lock the open ledger row, then this advisory lock).
    SELECT * INTO v_ledger FROM public.credit_ledger WHERE id = p_h.ledger_id FOR UPDATE;
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('agent_overage:' || p_h.tenant_id::text, 0));
    v_auth := public.agent__current_overage_authorization(p_h.tenant_id);
    IF v_auth.id IS NULL OR v_auth.state <> 'authorized' THEN
      RETURN 'customer_overage_authorization_revoked';
    ELSIF v_auth.pricing_policy_id IS DISTINCT FROM p_h.pricing_policy_id THEN
      RETURN 'customer_overage_authorization_stale_policy';
    ELSIF v_ledger.id IS NULL
          OR v_ledger.agent_overage_credits + v_ledger.agent_held_overage_credits > v_auth.authorized_limit_credits THEN
      RETURN 'customer_overage_limit_reached';
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

-- The trigger now enforces the full authorization check, not only the existence of a hold.
CREATE OR REPLACE FUNCTION public.agent__guard_attempt_customer_hold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_h      public.agent_customer_credit_holds%ROWTYPE;
  v_reason text;
BEGIN
  IF OLD.state = 'reserved' AND NEW.state = 'dispatched' AND public.agent__billing_mode() = 'enforced' THEN
    SELECT * INTO v_h FROM public.agent_customer_credit_holds WHERE attempt_id = NEW.id FOR UPDATE;
    IF NOT FOUND OR v_h.state <> 'held' THEN
      RAISE EXCEPTION 'customer_billing_hold_required' USING ERRCODE = 'P0001';
    END IF;
    v_reason := public.agent__customer_dispatch_refusal(v_h);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION 'customer_billing_authorization_invalid: %', v_reason USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- The H4 wrapper: same contract as migration 249, now using the shared check (so it refuses -- and releases hold and
-- provider reservation together -- in exactly the cases the trigger would refuse).
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
    v_reason := public.agent__customer_dispatch_refusal(v_h);
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

-- -----------------------------------------------------------------------------
-- PART B: legacy true-up outbox
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_trueup_operations (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ledger_id                uuid          NOT NULL REFERENCES public.credit_ledger(id) ON DELETE CASCADE,
  period_start             date          NOT NULL,
  period_end               date          NOT NULL,
  source                   text          NOT NULL CHECK (source IN ('period_end', 'cancellation')),
  calculation_version      text          NOT NULL DEFAULT 'legacy-trueup-v1'
                             CHECK (calculation_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  amount_cents             bigint        NOT NULL CHECK (amount_cents >= 0),
  overage_credits          numeric(14,4) NOT NULL,
  currency                 text          NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  stripe_customer_id       text          CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,250}$'),
  state                    text          NOT NULL DEFAULT 'prepared' CHECK (state IN (
                             'prepared', 'submitting', 'ambiguous', 'item_created', 'invoiced', 'paid',
                             'payment_failed', 'void', 'uncollectible', 'nothing_to_bill', 'manual_intervention')),
  stripe_invoice_item_id   text          CHECK (stripe_invoice_item_id ~ '^ii_[A-Za-z0-9]{1,250}$'),
  stripe_invoice_id        text          CHECK (stripe_invoice_id ~ '^in_[A-Za-z0-9]{1,250}$'),
  invoice_status           text          CHECK (invoice_status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
  livemode                 boolean,
  submit_attempts          integer       NOT NULL DEFAULT 0 CHECK (submit_attempts BETWEEN 0 AND 20),
  last_error_code          text          CHECK (last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  last_event_created       bigint,
  last_confirmed_at        timestamptz,
  manual_reason            text          CHECK (manual_reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  resolved_by              text          CHECK (resolved_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  resolved_at              timestamptz,
  created_by               text          NOT NULL CHECK (created_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  created_at               timestamptz   NOT NULL DEFAULT now(),
  updated_at               timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT billing_trueup_operations_period_key UNIQUE (tenant_id, period_start),
  CONSTRAINT billing_trueup_operations_ledger_key UNIQUE (ledger_id),
  CONSTRAINT billing_trueup_operations_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT billing_trueup_operations_item_key UNIQUE (stripe_invoice_item_id),
  CONSTRAINT billing_trueup_operations_window CHECK (period_end >= period_start),
  CONSTRAINT billing_trueup_operations_item_shape CHECK (
    state NOT IN ('item_created', 'invoiced', 'paid', 'payment_failed', 'void', 'uncollectible')
    OR stripe_invoice_item_id IS NOT NULL),
  CONSTRAINT billing_trueup_operations_invoice_shape CHECK (
    state NOT IN ('invoiced', 'paid', 'payment_failed', 'void', 'uncollectible') OR stripe_invoice_id IS NOT NULL),
  CONSTRAINT billing_trueup_operations_nothing_shape CHECK (state <> 'nothing_to_bill' OR amount_cents = 0),
  CONSTRAINT billing_trueup_operations_manual_shape CHECK (state <> 'manual_intervention' OR manual_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS billing_trueup_operations_due_idx ON public.billing_trueup_operations (state, updated_at)
  WHERE state IN ('prepared', 'submitting', 'ambiguous', 'item_created', 'invoiced', 'payment_failed', 'uncollectible');
CREATE INDEX IF NOT EXISTS billing_trueup_operations_invoice_idx ON public.billing_trueup_operations (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

COMMENT ON TABLE public.billing_trueup_operations IS
  'Legacy monthly AI-credit true-up outbox (migration 250). One row per hotel-month, ever. The row id is the permanent operation identity: Stripe idempotency key and invoice item metadata, so a retry after Stripe prunes idempotency keys finds the existing item instead of creating a second one.';

CREATE OR REPLACE FUNCTION public.billing__guard_trueup_operation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_identity text[] := ARRAY['id', 'tenant_id', 'ledger_id', 'period_start', 'period_end', 'source',
                             'calculation_version', 'amount_cents', 'overage_credits', 'currency', 'stripe_customer_id',
                             'created_by', 'created_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'billing true-up operations are financial history and are never removed' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('prepared', 'nothing_to_bill', 'manual_intervention') OR NEW.stripe_invoice_item_id IS NOT NULL
       OR NEW.stripe_invoice_id IS NOT NULL OR NEW.submit_attempts <> 0 THEN
      RAISE EXCEPTION 'a billing true-up operation is born before any Stripe object exists' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF (SELECT jsonb_object_agg(k, to_jsonb(NEW) -> k) FROM unnest(v_identity) k)
     IS DISTINCT FROM (SELECT jsonb_object_agg(k, to_jsonb(OLD) -> k) FROM unnest(v_identity) k) THEN
    RAISE EXCEPTION 'billing true-up operation amount and identity are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.stripe_invoice_item_id IS NOT NULL AND NEW.stripe_invoice_item_id IS DISTINCT FROM OLD.stripe_invoice_item_id THEN
    RAISE EXCEPTION 'a recorded Stripe invoice item id never changes' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.stripe_invoice_id IS NOT NULL AND NEW.stripe_invoice_id IS DISTINCT FROM OLD.stripe_invoice_id THEN
    RAISE EXCEPTION 'a recorded Stripe invoice id never changes' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.livemode IS NOT NULL AND NEW.livemode IS DISTINCT FROM OLD.livemode THEN
    RAISE EXCEPTION 'a recorded Stripe mode never changes' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.state IN ('paid', 'void', 'nothing_to_bill') AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'billing true-up operation % is final', OLD.state USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS billing_trueup_operations_guard ON public.billing_trueup_operations;
CREATE TRIGGER billing_trueup_operations_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.billing_trueup_operations FOR EACH ROW EXECUTE FUNCTION public.billing__guard_trueup_operation();

CREATE TABLE IF NOT EXISTS public.billing_trueup_operation_events (
  id             bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      uuid          NOT NULL,
  operation_id   uuid          NOT NULL,
  event_type     text          NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  from_state     text,
  to_state       text,
  reason_code    text          CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  actor_kind     text          NOT NULL CHECK (actor_kind IN ('worker', 'webhook', 'reconciler', 'operator')),
  actor_ref      text          CHECK (actor_ref ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  detail         jsonb         NOT NULL DEFAULT '{}'::jsonb
                   CHECK (jsonb_typeof(detail) = 'object' AND pg_column_size(detail) <= 1024),
  created_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT billing_trueup_operation_events_operation_fk FOREIGN KEY (operation_id, tenant_id)
    REFERENCES public.billing_trueup_operations (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS billing_trueup_operation_events_op_idx ON public.billing_trueup_operation_events (operation_id, id);

DROP TRIGGER IF EXISTS billing_trueup_operation_events_immutable ON public.billing_trueup_operation_events;
CREATE TRIGGER billing_trueup_operation_events_immutable BEFORE UPDATE OR DELETE ON public.billing_trueup_operation_events
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_tool_immutable();

ALTER TABLE public.billing_trueup_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_trueup_operation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_trueup_operations, public.billing_trueup_operation_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.billing_trueup_operations TO service_role;
GRANT SELECT, INSERT ON public.billing_trueup_operation_events TO service_role;

-- ---- helpers ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing__trueup_json(p_o public.billing_trueup_operations)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', p_o.id, 'tenant_id', p_o.tenant_id, 'period_start', p_o.period_start, 'period_end', p_o.period_end,
    'source', p_o.source, 'calculation_version', p_o.calculation_version, 'amount_cents', p_o.amount_cents,
    'currency', p_o.currency, 'overage_credits', p_o.overage_credits::text, 'stripe_customer_id', p_o.stripe_customer_id,
    'state', p_o.state, 'stripe_invoice_item_id', p_o.stripe_invoice_item_id, 'stripe_invoice_id', p_o.stripe_invoice_id,
    'invoice_status', p_o.invoice_status, 'livemode', p_o.livemode, 'submit_attempts', p_o.submit_attempts,
    'last_error_code', p_o.last_error_code, 'manual_reason', p_o.manual_reason, 'created_at', p_o.created_at,
    'updated_at', p_o.updated_at);
$function$;

CREATE OR REPLACE FUNCTION public.billing__trueup_event(
  p_o public.billing_trueup_operations, p_event text, p_from text, p_reason text, p_actor_kind text, p_actor_ref text,
  p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS void LANGUAGE sql VOLATILE SET search_path = ''
AS $function$
  INSERT INTO public.billing_trueup_operation_events (tenant_id, operation_id, event_type, from_state, to_state,
    reason_code, actor_kind, actor_ref, detail)
  VALUES (p_o.tenant_id, p_o.id, p_event, p_from, p_o.state, p_reason, p_actor_kind, p_actor_ref,
          COALESCE(p_detail, '{}'::jsonb));
$function$;

-- Legacy true-up amount in whole cents. Same arithmetic as services/agent_billing/pricing.py legacy_overage_cents():
-- all overage minus the consented agent overage (billed by H4), legacy spend cap applied, rounded half up once.
CREATE OR REPLACE FUNCTION public.billing__legacy_overage_cents(
  p_overage_cost_cents numeric, p_agent_overage_credits numeric, p_cap_cents integer, p_base_fee_cents integer
)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $function$
DECLARE
  v_total numeric := COALESCE(p_overage_cost_cents, 0);
  v_agent numeric := least(COALESCE(p_agent_overage_credits, 0) * 0.02 * 100, COALESCE(p_overage_cost_cents, 0));
  v_cents numeric;
BEGIN
  v_cents := greatest(0, v_total - v_agent);
  IF COALESCE(p_cap_cents, 0) <> 0 THEN
    v_cents := greatest(0, least(v_cents, (p_cap_cents - COALESCE(p_base_fee_cents, 9900)) - v_agent));
  END IF;
  RETURN floor(v_cents + 0.5)::bigint;
END;
$function$;

-- ---- prepare: decide the month's amount and freeze the ledger in one transaction --------------------------------
CREATE OR REPLACE FUNCTION public.billing_trueup_prepare(
  p_tenant_id uuid, p_period_start date, p_source text, p_actor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_ledger public.credit_ledger%ROWTYPE;
  v_sub    public.subscriptions%ROWTYPE;
  v_o      public.billing_trueup_operations%ROWTYPE;
  v_cents  bigint;
  v_over   numeric;
  v_state  text;
  v_manual text;
BEGIN
  IF p_source NOT IN ('period_end', 'cancellation') OR p_actor IS NULL OR p_actor !~ '^[A-Za-z0-9._:@-]{1,100}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  SELECT * INTO v_ledger FROM public.credit_ledger
   WHERE tenant_id = p_tenant_id AND period_start = p_period_start FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'status', 'no_ledger');
  END IF;
  SELECT * INTO v_o FROM public.billing_trueup_operations WHERE tenant_id = p_tenant_id AND period_start = p_period_start;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'status', 'exists', 'operation', public.billing__trueup_json(v_o));
  END IF;
  IF v_ledger.is_finalized THEN
    -- Finalized before the outbox existed (or by an operator): its Stripe outcome is history. Never rebilled.
    RETURN jsonb_build_object('ok', true, 'status', 'already_finalized');
  END IF;
  IF p_source = 'period_end' AND CURRENT_DATE <= v_ledger.period_end THEN
    RETURN jsonb_build_object('ok', true, 'status', 'period_not_yet_ended');
  END IF;
  SELECT * INTO v_sub FROM public.subscriptions WHERE tenant_id = p_tenant_id;
  IF p_source = 'period_end' AND v_sub.plan_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'skipped_inactive');
  END IF;
  IF v_sub.stripe_customer_id IS NULL OR v_sub.stripe_customer_id !~ '^cus_[A-Za-z0-9]{1,250}$' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'skipped_no_stripe_customer');
  END IF;

  v_cents := public.billing__legacy_overage_cents(v_ledger.overage_cost_cents, v_ledger.agent_overage_credits,
                                                  v_sub.cap_cents, v_sub.base_fee_cents);
  v_over := greatest(0, COALESCE(v_ledger.overage_credits, 0) - v_ledger.agent_overage_credits);

  IF p_source = 'cancellation' THEN
    IF v_cents = 0 THEN
      RETURN jsonb_build_object('ok', true, 'status', 'nothing_to_bill_at_cancellation');
    END IF;
    -- No commercial policy for mid-period cancellation billing is approved: record it for review, never submit.
    v_state := 'manual_intervention'; v_manual := 'cancellation_policy_pending';
  ELSIF v_ledger.stripe_invoice_item_id IS NOT NULL
        OR (v_ledger.stripe_invoice_id IS NOT NULL AND v_ledger.stripe_invoice_id LIKE 'ii\_%') THEN
    -- An item is already recorded on an open ledger: inconsistent history. Freeze and require an operator.
    v_state := 'manual_intervention'; v_manual := 'ledger_has_invoice_item';
  ELSIF v_cents = 0 THEN
    v_state := 'nothing_to_bill';
  ELSE
    v_state := 'prepared';
  END IF;

  INSERT INTO public.billing_trueup_operations (tenant_id, ledger_id, period_start, period_end, source, amount_cents,
    overage_credits, stripe_customer_id, state, manual_reason, created_by)
  VALUES (p_tenant_id, v_ledger.id, v_ledger.period_start, v_ledger.period_end, p_source, v_cents, v_over,
          v_sub.stripe_customer_id, v_state, v_manual, p_actor)
  RETURNING * INTO v_o;
  IF p_source = 'period_end' THEN
    -- Same transaction as the operation: usage stops accruing to this period (increment_credits_used skips finalized
    -- ledgers), so the amount above is final, and a crash after this point can never lose the operation.
    UPDATE public.credit_ledger SET is_finalized = true, finalized_at = now() WHERE id = v_ledger.id;
  END IF;
  PERFORM public.billing__trueup_event(v_o, 'prepared', NULL, v_manual, 'worker', p_actor,
                                       jsonb_build_object('amount_cents', v_cents, 'source', p_source));
  RETURN jsonb_build_object('ok', true, 'status', 'created', 'operation', public.billing__trueup_json(v_o));
END;
$function$;

CREATE OR REPLACE FUNCTION public.billing_trueup_claim(p_operation_id uuid, p_actor text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_o    public.billing_trueup_operations%ROWTYPE;
  v_from text;
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^[A-Za-z0-9._:@-]{1,100}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  SELECT * INTO v_o FROM public.billing_trueup_operations WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  v_from := v_o.state;
  IF v_o.state = 'submitting' AND v_o.updated_at < now() - interval '10 minutes' THEN
    UPDATE public.billing_trueup_operations SET state = 'ambiguous', last_error_code = 'claim_expired'
     WHERE id = v_o.id RETURNING * INTO v_o;
    PERFORM public.billing__trueup_event(v_o, 'claim_expired', v_from, 'claim_expired', 'worker', p_actor);
    RETURN jsonb_build_object('ok', false, 'reason', 'reconcile_first', 'operation', public.billing__trueup_json(v_o));
  END IF;
  IF v_o.state = 'ambiguous' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reconcile_first', 'operation', public.billing__trueup_json(v_o));
  END IF;
  IF v_o.state <> 'prepared' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_claimable', 'state', v_o.state);
  END IF;
  IF v_o.submit_attempts >= 10 THEN
    UPDATE public.billing_trueup_operations SET state = 'manual_intervention', manual_reason = 'submit_attempts_exhausted'
     WHERE id = v_o.id RETURNING * INTO v_o;
    PERFORM public.billing__trueup_event(v_o, 'manual_required', v_from, 'submit_attempts_exhausted', 'worker', p_actor);
    RETURN jsonb_build_object('ok', false, 'reason', 'submit_attempts_exhausted');
  END IF;
  UPDATE public.billing_trueup_operations SET state = 'submitting', submit_attempts = submit_attempts + 1
   WHERE id = v_o.id RETURNING * INTO v_o;
  PERFORM public.billing__trueup_event(v_o, 'claimed', v_from, NULL, 'worker', p_actor);
  RETURN jsonb_build_object('ok', true, 'operation', public.billing__trueup_json(v_o));
END;
$function$;

-- Record an externally observed Stripe outcome. Customer-checked; a mismatch never applies. The ledger's legacy columns
-- (stripe_invoice_item_id / stripe_invoice_id) are stamped in the same transaction as the operation.
CREATE OR REPLACE FUNCTION public.billing_trueup_record(
  p_operation_id uuid, p_outcome text, p_actor_kind text, p_actor_ref text, p_stripe_customer_id text,
  p_invoice_item_id text, p_invoice_id text, p_invoice_status text, p_livemode boolean, p_error_code text,
  p_event_created bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_o     public.billing_trueup_operations%ROWTYPE;
  v_from  text;
  v_state text;
  v_err   text := CASE WHEN p_error_code ~ '^[a-z][a-z0-9_]{0,63}$' THEN p_error_code END;
BEGIN
  IF p_actor_kind NOT IN ('worker', 'webhook', 'reconciler', 'operator')
     OR p_actor_ref IS NULL OR p_actor_ref !~ '^[A-Za-z0-9._:@-]{1,100}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  SELECT * INTO v_o FROM public.billing_trueup_operations WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  v_from := v_o.state;

  IF p_outcome IN ('item_created', 'invoice_status') THEN
    IF p_stripe_customer_id IS DISTINCT FROM v_o.stripe_customer_id
       OR p_livemode IS NULL OR (v_o.livemode IS NOT NULL AND p_livemode IS DISTINCT FROM v_o.livemode) THEN
      IF v_o.state NOT IN ('paid', 'void', 'nothing_to_bill') THEN
        UPDATE public.billing_trueup_operations SET state = 'manual_intervention',
               manual_reason = CASE WHEN p_stripe_customer_id IS DISTINCT FROM v_o.stripe_customer_id
                                    THEN 'customer_mismatch' ELSE 'livemode_mismatch' END
         WHERE id = v_o.id RETURNING * INTO v_o;
        PERFORM public.billing__trueup_event(v_o, 'manual_required', v_from, v_o.manual_reason, p_actor_kind, p_actor_ref);
      END IF;
      RETURN jsonb_build_object('ok', false, 'reason', 'customer_or_mode_mismatch');
    END IF;
  END IF;

  IF p_outcome = 'item_created' THEN
    IF p_invoice_item_id IS NULL OR p_invoice_item_id !~ '^ii_[A-Za-z0-9]{1,250}$' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
    END IF;
    IF v_o.stripe_invoice_item_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', v_o.stripe_invoice_item_id = p_invoice_item_id, 'replayed', true,
                                'reason', CASE WHEN v_o.stripe_invoice_item_id <> p_invoice_item_id THEN 'item_conflict' END,
                                'operation', public.billing__trueup_json(v_o));
    END IF;
    IF v_o.state NOT IN ('submitting', 'ambiguous', 'manual_intervention')
       OR (v_o.state = 'manual_intervention' AND (p_actor_kind <> 'operator' OR v_o.source = 'cancellation')) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'illegal_transition', 'state', v_o.state);
    END IF;
    UPDATE public.billing_trueup_operations
       SET state = 'item_created', stripe_invoice_item_id = p_invoice_item_id, livemode = p_livemode,
           last_error_code = NULL, last_confirmed_at = now(), manual_reason = NULL,
           resolved_by = CASE WHEN v_from = 'manual_intervention' THEN p_actor_ref ELSE resolved_by END,
           resolved_at = CASE WHEN v_from = 'manual_intervention' THEN now() ELSE resolved_at END
     WHERE id = v_o.id RETURNING * INTO v_o;
    UPDATE public.credit_ledger SET stripe_invoice_item_id = p_invoice_item_id
     WHERE id = v_o.ledger_id AND stripe_invoice_item_id IS NULL;
    PERFORM public.billing__trueup_event(v_o, 'item_recorded', v_from, NULL, p_actor_kind, p_actor_ref);
    RETURN jsonb_build_object('ok', true, 'operation', public.billing__trueup_json(v_o));

  ELSIF p_outcome = 'absent' THEN
    IF v_o.state NOT IN ('submitting', 'ambiguous') OR v_o.stripe_invoice_item_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'illegal_transition', 'state', v_o.state);
    END IF;
    UPDATE public.billing_trueup_operations SET state = 'prepared', last_error_code = COALESCE(v_err, 'confirmed_absent')
     WHERE id = v_o.id RETURNING * INTO v_o;
    PERFORM public.billing__trueup_event(v_o, 'confirmed_absent', v_from, v_err, p_actor_kind, p_actor_ref);
    RETURN jsonb_build_object('ok', true, 'operation', public.billing__trueup_json(v_o));

  ELSIF p_outcome IN ('ambiguous', 'rejected') THEN
    IF v_o.state <> 'submitting' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'illegal_transition', 'state', v_o.state);
    END IF;
    UPDATE public.billing_trueup_operations
       SET state = CASE p_outcome WHEN 'ambiguous' THEN 'ambiguous' ELSE 'manual_intervention' END,
           manual_reason = CASE p_outcome WHEN 'rejected' THEN COALESCE(v_err, 'stripe_rejected') END,
           last_error_code = COALESCE(v_err, p_outcome)
     WHERE id = v_o.id RETURNING * INTO v_o;
    PERFORM public.billing__trueup_event(v_o, p_outcome, v_from, v_err, p_actor_kind, p_actor_ref);
    RETURN jsonb_build_object('ok', true, 'operation', public.billing__trueup_json(v_o));

  ELSIF p_outcome = 'invoice_status' THEN
    IF v_o.stripe_invoice_item_id IS NULL OR p_invoice_id IS NULL OR p_invoice_id !~ '^in_[A-Za-z0-9]{1,250}$'
       OR p_invoice_status NOT IN ('draft', 'open', 'paid', 'void', 'uncollectible', 'payment_failed') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
    END IF;
    IF v_o.stripe_invoice_id IS NOT NULL AND v_o.stripe_invoice_id <> p_invoice_id THEN
      UPDATE public.billing_trueup_operations SET state = 'manual_intervention', manual_reason = 'invoice_conflict'
       WHERE id = v_o.id AND state NOT IN ('paid', 'void') RETURNING * INTO v_o;
      IF FOUND THEN
        PERFORM public.billing__trueup_event(v_o, 'manual_required', v_from, 'invoice_conflict', p_actor_kind, p_actor_ref);
      END IF;
      RETURN jsonb_build_object('ok', false, 'reason', 'invoice_conflict');
    END IF;
    IF v_o.state IN ('paid', 'void') THEN
      RETURN jsonb_build_object('ok', true, 'ignored', 'final', 'operation', public.billing__trueup_json(v_o));
    END IF;
    IF v_o.state = 'manual_intervention' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'operator_hold', 'operation', public.billing__trueup_json(v_o));
    END IF;
    IF p_event_created IS NOT NULL AND v_o.last_event_created IS NOT NULL AND p_event_created < v_o.last_event_created THEN
      RETURN jsonb_build_object('ok', true, 'ignored', 'stale_event', 'operation', public.billing__trueup_json(v_o));
    END IF;
    v_state := CASE p_invoice_status WHEN 'paid' THEN 'paid' WHEN 'void' THEN 'void'
                 WHEN 'uncollectible' THEN 'uncollectible' WHEN 'payment_failed' THEN 'payment_failed' ELSE 'invoiced' END;
    UPDATE public.billing_trueup_operations
       SET state = v_state, stripe_invoice_id = p_invoice_id,
           invoice_status = CASE WHEN p_invoice_status = 'payment_failed' THEN 'open' ELSE p_invoice_status END,
           last_event_created = COALESCE(greatest(p_event_created, last_event_created), p_event_created, last_event_created),
           last_confirmed_at = now()
     WHERE id = v_o.id RETURNING * INTO v_o;
    UPDATE public.credit_ledger SET stripe_invoice_id = p_invoice_id
     WHERE id = v_o.ledger_id AND stripe_invoice_id IS DISTINCT FROM p_invoice_id;
    PERFORM public.billing__trueup_event(v_o, 'invoice_' || p_invoice_status, v_from, NULL, p_actor_kind, p_actor_ref);
    RETURN jsonb_build_object('ok', true, 'operation', public.billing__trueup_json(v_o));

  ELSIF p_outcome = 'manual' THEN
    IF p_actor_kind NOT IN ('operator', 'reconciler') OR v_err IS NULL OR v_o.state IN ('paid', 'void', 'nothing_to_bill') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'illegal_transition', 'state', v_o.state);
    END IF;
    UPDATE public.billing_trueup_operations SET state = 'manual_intervention', manual_reason = v_err
     WHERE id = v_o.id RETURNING * INTO v_o;
    PERFORM public.billing__trueup_event(v_o, 'manual_required', v_from, v_err, p_actor_kind, p_actor_ref);
    RETURN jsonb_build_object('ok', true, 'operation', public.billing__trueup_json(v_o));

  ELSIF p_outcome = 'resolve_retry' THEN
    -- Operator confirmed with Stripe evidence that no item exists for this period. Never for a cancellation.
    IF p_actor_kind <> 'operator' OR v_o.state <> 'manual_intervention' OR v_o.stripe_invoice_item_id IS NOT NULL
       OR v_err IS NULL OR v_o.source <> 'period_end' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'illegal_transition', 'state', v_o.state);
    END IF;
    UPDATE public.billing_trueup_operations SET state = 'prepared', manual_reason = NULL, resolved_by = p_actor_ref,
           resolved_at = now(), submit_attempts = 0
     WHERE id = v_o.id RETURNING * INTO v_o;
    PERFORM public.billing__trueup_event(v_o, 'operator_resolved', v_from, v_err, p_actor_kind, p_actor_ref);
    RETURN jsonb_build_object('ok', true, 'operation', public.billing__trueup_json(v_o));
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'invalid_outcome');
END;
$function$;

CREATE OR REPLACE FUNCTION public.billing_trueup_due(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(public.billing__trueup_json(o) ORDER BY o.updated_at), '[]'::jsonb)
    FROM (SELECT * FROM public.billing_trueup_operations
           WHERE state IN ('prepared', 'ambiguous', 'item_created', 'invoiced', 'payment_failed', 'uncollectible')
              OR (state = 'submitting' AND updated_at < now() - interval '10 minutes')
           ORDER BY updated_at LIMIT least(greatest(COALESCE(p_limit, 50), 1), 500)) o;
$function$;

CREATE OR REPLACE FUNCTION public.billing_trueup_find(p_invoice_item_ids text[], p_invoice_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(public.billing__trueup_json(o)), '[]'::jsonb)
    FROM public.billing_trueup_operations o
   WHERE (p_invoice_item_ids IS NOT NULL AND o.stripe_invoice_item_id = ANY (p_invoice_item_ids))
      OR (p_invoice_id IS NOT NULL AND o.stripe_invoice_id = p_invoice_id);
$function$;

-- Every invoice item id this hotel's billing history already accounts for (legacy columns, including pre-H4 rows that
-- stored the item id in stripe_invoice_id, the legacy outbox and the H4 outbox). An unlabelled legacy-format item NOT in
-- this set is unexplained evidence of a possible earlier charge and stops the true-up for review.
CREATE OR REPLACE FUNCTION public.billing_trueup_known_item_ids(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(DISTINCT i), '[]'::jsonb) FROM (
    SELECT stripe_invoice_item_id AS i FROM public.credit_ledger
     WHERE tenant_id = p_tenant_id AND stripe_invoice_item_id IS NOT NULL
    UNION SELECT stripe_invoice_id FROM public.credit_ledger
     WHERE tenant_id = p_tenant_id AND stripe_invoice_id LIKE 'ii\_%'
    UNION SELECT stripe_invoice_item_id FROM public.billing_trueup_operations
     WHERE tenant_id = p_tenant_id AND stripe_invoice_item_id IS NOT NULL
    UNION SELECT stripe_invoice_item_id FROM public.agent_billing_operations
     WHERE tenant_id = p_tenant_id AND stripe_invoice_item_id IS NOT NULL
  ) s;
$function$;

-- -----------------------------------------------------------------------------
-- Privileges: service role only
-- -----------------------------------------------------------------------------
DO $grants$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.agent__customer_dispatch_refusal(public.agent_customer_credit_holds)',
    'public.agent__guard_attempt_customer_hold()',
    'public.agent_billing_attempt_dispatch(uuid, uuid, bigint, text)',
    'public.billing__guard_trueup_operation()',
    'public.billing__trueup_json(public.billing_trueup_operations)',
    'public.billing__trueup_event(public.billing_trueup_operations, text, text, text, text, text, jsonb)',
    'public.billing__legacy_overage_cents(numeric, numeric, integer, integer)',
    'public.billing_trueup_prepare(uuid, date, text, text)',
    'public.billing_trueup_claim(uuid, text)',
    'public.billing_trueup_record(uuid, text, text, text, text, text, text, text, boolean, text, bigint)',
    'public.billing_trueup_due(integer)',
    'public.billing_trueup_find(text[], text)',
    'public.billing_trueup_known_item_ids(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$grants$;

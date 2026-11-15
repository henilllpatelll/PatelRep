-- =============================================================================
-- Migration 248: Agent Harness H4 -- customer billing schema (default disabled)
-- =============================================================================
-- Additive only: new tables, triggers, grants, and new nullable/defaulted columns on credit_ledger. No existing row,
-- column, function or constraint is changed. Nothing here bills anyone: the customer-billing mode starts 'disabled',
-- Stripe true-up starts disabled, and no pricing policy or overage authorization exists for any hotel.
--
-- FOUR FINANCIAL CONCEPTS, KEPT SEPARATE (see docs/agent-harness/customer-billing.md):
--   1. provider expense (USD)      agent_model_attempts / agent_model_spend_events (H3, unchanged)
--   2. customer credits            credit_ledger (shared legacy + agent total) + agent_customer_credit_charges journal
--   3. customer overage (USD)      the overage share of agent charges, only under an explicit GM authorization
--   4. Stripe outcomes             agent_billing_operations (durable outbox) -- invoice items vs invoices kept distinct
--
--   agent_customer_billing_controls        single row: customer-billing mode + Stripe true-up switch (both OFF)
--   agent_customer_pricing_policies        versioned, two-person approved, immutable pricing per hotel
--   agent_customer_overage_authorizations  append-only, versioned GM consent records (OFF unless a row says so)
--   agent_customer_credit_holds            pre-dispatch customer-credit holds, one per H3 attempt
--   agent_customer_credit_charges          immutable charge / adjustment journal (one charge per attempt)
--   agent_customer_billing_events          append-only audit trail
--   agent_billing_operations               Stripe true-up outbox / state machine
--   agent_billing_operation_events         append-only outbox history
--
-- credit_ledger keeps credits_used as the single customer-facing total. New columns record which part of it came from
-- agent charges, the consented agent overage, and open holds -- they are breakdowns of the same balance, never a
-- second balance. Money is exact numeric; credits use 4 decimal places like credits_used (migration 020).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Controls (single row; default OFF)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_customer_billing_controls (
  id                     smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  customer_billing_mode  text        NOT NULL DEFAULT 'disabled' CHECK (customer_billing_mode IN ('disabled', 'enforced')),
  stripe_trueup_enabled  boolean     NOT NULL DEFAULT false,
  reason_code            text        CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  updated_by             text        NOT NULL CHECK (updated_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_customer_billing_controls_trueup_needs_billing CHECK (
    NOT stripe_trueup_enabled OR customer_billing_mode = 'enforced')
);
INSERT INTO public.agent_customer_billing_controls (id, customer_billing_mode, stripe_trueup_enabled, reason_code, updated_by)
VALUES (1, 'disabled', false, 'h4_default_off', 'migration_248')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.agent_customer_billing_controls IS
  'H4 customer billing switches (single row). disabled = H3 behaviour unchanged, no customer holds or charges. enforced = every H3 provider dispatch requires a customer-credit hold (trigger agent_model_attempts_customer_hold_guard). Stripe true-up additionally needs this flag AND process gates.';

-- -----------------------------------------------------------------------------
-- Pricing policies (versioned; proposed by one operator, approved by a different one; immutable once approved)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_customer_pricing_policies (
  id                        uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  policy_version            integer       NOT NULL CHECK (policy_version >= 1),
  included_credits          numeric(12,4) NOT NULL CHECK (included_credits >= 0),
  usd_per_credit            numeric(12,6) NOT NULL CHECK (usd_per_credit > 0),
  markup_multiplier         numeric(8,4)  NOT NULL CHECK (markup_multiplier > 0 AND markup_multiplier <= 100),
  minimum_credits_per_operation numeric(12,4) NOT NULL CHECK (minimum_credits_per_operation >= 0),
  hard_cap_usd              numeric(12,2) NOT NULL CHECK (hard_cap_usd > 0),
  currency                  text          NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  terms_version             text          NOT NULL CHECK (terms_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  reason_code               text          CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_by                text          NOT NULL CHECK (created_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  created_at                timestamptz   NOT NULL DEFAULT now(),
  approved_by               text          CHECK (approved_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  approved_at               timestamptz,
  effective_from            timestamptz,
  effective_to              timestamptz,
  retired_by                text          CHECK (retired_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  CONSTRAINT agent_customer_pricing_policies_version_key UNIQUE (tenant_id, policy_version),
  CONSTRAINT agent_customer_pricing_policies_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT agent_customer_pricing_policies_approval_shape CHECK (
    (approved_by IS NULL) = (approved_at IS NULL) AND (approved_at IS NULL) = (effective_from IS NULL)
    AND (approved_by IS NULL OR approved_by <> created_by)),
  CONSTRAINT agent_customer_pricing_policies_window CHECK (
    effective_to IS NULL OR (effective_from IS NOT NULL AND effective_to >= effective_from)),
  CONSTRAINT agent_customer_pricing_policies_retire_shape CHECK ((effective_to IS NULL) = (retired_by IS NULL))
);

-- At most one approved, open-ended policy per hotel.
CREATE UNIQUE INDEX IF NOT EXISTS agent_customer_pricing_policies_one_open
  ON public.agent_customer_pricing_policies (tenant_id) WHERE approved_at IS NOT NULL AND effective_to IS NULL;
-- At most one proposal awaiting approval per hotel.
CREATE UNIQUE INDEX IF NOT EXISTS agent_customer_pricing_policies_one_pending
  ON public.agent_customer_pricing_policies (tenant_id) WHERE approved_at IS NULL AND effective_to IS NULL;

COMMENT ON TABLE public.agent_customer_pricing_policies IS
  'H4 versioned customer pricing for agent AI usage. Approved rows are immutable except closing effective_to once; charges snapshot the exact policy id and rates, so a later policy never reprices an earlier period.';

CREATE OR REPLACE FUNCTION public.agent__guard_pricing_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN
      RETURN OLD;  -- tenant deletion cascade
    END IF;
    RAISE EXCEPTION 'pricing policies are financial history and are never removed' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.approved_at IS NOT NULL OR NEW.effective_to IS NOT NULL THEN
      RAISE EXCEPTION 'a pricing policy is born unapproved' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  -- Allowed updates: approve once (unapproved -> approved), close once (effective_to/retired_by), nothing else.
  IF (to_jsonb(NEW) - 'approved_by' - 'approved_at' - 'effective_from' - 'effective_to' - 'retired_by')
     IS DISTINCT FROM (to_jsonb(OLD) - 'approved_by' - 'approved_at' - 'effective_from' - 'effective_to' - 'retired_by') THEN
    RAISE EXCEPTION 'pricing policy terms are immutable; propose a new version' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.approved_at IS NOT NULL AND (NEW.approved_at, NEW.approved_by, NEW.effective_from)
       IS DISTINCT FROM (OLD.approved_at, OLD.approved_by, OLD.effective_from) THEN
    RAISE EXCEPTION 'a pricing policy is approved only once' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.effective_to IS NOT NULL AND (NEW.effective_to, NEW.retired_by) IS DISTINCT FROM (OLD.effective_to, OLD.retired_by) THEN
    RAISE EXCEPTION 'a pricing policy is closed only once' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_customer_pricing_policies_guard ON public.agent_customer_pricing_policies;
CREATE TRIGGER agent_customer_pricing_policies_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.agent_customer_pricing_policies FOR EACH ROW EXECUTE FUNCTION public.agent__guard_pricing_policy();

-- -----------------------------------------------------------------------------
-- Overage authorizations (append-only consent history; the latest version is the current state)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_customer_overage_authorizations (
  id                        uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  version                   integer       NOT NULL CHECK (version >= 1),
  state                     text          NOT NULL CHECK (state IN ('authorized', 'revoked')),
  authorized_limit_credits  numeric(12,4) CHECK (authorized_limit_credits > 0),
  max_exposure_usd          numeric(12,2) CHECK (max_exposure_usd > 0),
  pricing_policy_id         uuid          NOT NULL,
  terms_version             text          NOT NULL CHECK (terms_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  actor_user_id             uuid          NOT NULL,
  actor_role                text          NOT NULL CHECK (actor_role = 'gm'),
  created_at                timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT agent_customer_overage_authorizations_version_key UNIQUE (tenant_id, version),
  CONSTRAINT agent_customer_overage_authorizations_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT agent_customer_overage_authorizations_policy_fk FOREIGN KEY (pricing_policy_id, tenant_id)
    REFERENCES public.agent_customer_pricing_policies (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_customer_overage_authorizations_shape CHECK (
    (state = 'authorized' AND authorized_limit_credits IS NOT NULL AND max_exposure_usd IS NOT NULL)
    OR (state = 'revoked' AND authorized_limit_credits IS NULL AND max_exposure_usd IS NULL))
);

COMMENT ON TABLE public.agent_customer_overage_authorizations IS
  'H4 GM consent to bill agent overage. Absent row or latest row revoked = overage OFF. Never inferred from a spend cap, plan, or settings visit. Append-only.';

-- -----------------------------------------------------------------------------
-- credit_ledger breakdown columns (the same balance, split; never a second balance)
-- -----------------------------------------------------------------------------
ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS agent_credits_used          numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_overage_credits       numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_overage_usd           numeric(14,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_held_credits          numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_held_overage_credits  numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_invoice_item_id      text;

ALTER TABLE public.credit_ledger
  ADD CONSTRAINT credit_ledger_agent_breakdown_nonnegative CHECK (
    agent_credits_used >= 0 AND agent_overage_credits >= 0 AND agent_overage_usd >= 0
    AND agent_held_credits >= 0 AND agent_held_overage_credits >= 0),
  ADD CONSTRAINT credit_ledger_agent_breakdown_nested CHECK (
    agent_overage_credits <= agent_credits_used AND agent_held_overage_credits <= agent_held_credits),
  ADD CONSTRAINT credit_ledger_stripe_invoice_item_shape CHECK (
    stripe_invoice_item_id IS NULL OR stripe_invoice_item_id ~ '^ii_[A-Za-z0-9]{1,250}$');

COMMENT ON COLUMN public.credit_ledger.agent_credits_used IS
  'H4: part of credits_used that came from agent charges (legacy usage = credits_used - agent_credits_used). Written only by H4 RPCs together with credits_used.';
COMMENT ON COLUMN public.credit_ledger.agent_overage_credits IS
  'H4: consented agent overage credits in this period. Billed by the H4 Stripe outbox; the legacy true-up excludes them.';
COMMENT ON COLUMN public.credit_ledger.agent_overage_usd IS
  'H4: exact USD of agent overage at each charge''s snapshotted rate (rounded to cents only on the Stripe operation).';
COMMENT ON COLUMN public.credit_ledger.agent_held_credits IS
  'H4: open pre-dispatch customer-credit holds (exposure, not usage).';
COMMENT ON COLUMN public.credit_ledger.stripe_invoice_item_id IS
  'Stripe invoice ITEM id (ii_...) created by the legacy true-up. Distinct from stripe_invoice_id, which must hold an invoice id (in_...).';

-- -----------------------------------------------------------------------------
-- Customer credit holds (one per H3 attempt; created in the same transaction as the provider reservation)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_customer_credit_holds (
  id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid          NOT NULL,
  attempt_id             uuid          NOT NULL,
  ledger_id              uuid          NOT NULL REFERENCES public.credit_ledger(id) ON DELETE CASCADE,
  period_start           date          NOT NULL,
  pricing_policy_id      uuid          NOT NULL,
  authorization_id       uuid,
  held_credits           numeric(12,4) NOT NULL CHECK (held_credits > 0),
  held_overage_credits   numeric(12,4) NOT NULL CHECK (held_overage_credits >= 0),
  state                  text          NOT NULL DEFAULT 'held' CHECK (state IN (
                           'held', 'awaiting_reconciliation', 'converted', 'released')),
  close_reason           text          CHECK (close_reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at             timestamptz   NOT NULL DEFAULT now(),
  closed_at              timestamptz,
  CONSTRAINT agent_customer_credit_holds_attempt_key UNIQUE (attempt_id),
  CONSTRAINT agent_customer_credit_holds_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT agent_customer_credit_holds_attempt_fk FOREIGN KEY (attempt_id, tenant_id)
    REFERENCES public.agent_model_attempts (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_customer_credit_holds_policy_fk FOREIGN KEY (pricing_policy_id, tenant_id)
    REFERENCES public.agent_customer_pricing_policies (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_customer_credit_holds_authorization_fk FOREIGN KEY (authorization_id, tenant_id)
    REFERENCES public.agent_customer_overage_authorizations (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_customer_credit_holds_overage_shape CHECK (
    held_overage_credits <= held_credits AND (held_overage_credits = 0 OR authorization_id IS NOT NULL)),
  CONSTRAINT agent_customer_credit_holds_closed_shape CHECK (
    (state IN ('converted', 'released')) = (closed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS agent_customer_credit_holds_open_idx ON public.agent_customer_credit_holds (state, created_at)
  WHERE state IN ('held', 'awaiting_reconciliation');
CREATE INDEX IF NOT EXISTS agent_customer_credit_holds_ledger_idx ON public.agent_customer_credit_holds (ledger_id);
CREATE INDEX IF NOT EXISTS agent_customer_credit_holds_policy_idx ON public.agent_customer_credit_holds (pricing_policy_id);
CREATE INDEX IF NOT EXISTS agent_customer_credit_holds_auth_idx ON public.agent_customer_credit_holds (authorization_id);

CREATE OR REPLACE FUNCTION public.agent__guard_credit_hold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'customer credit holds are financial history and are never removed' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'held' OR NEW.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'a customer credit hold is born held' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'state' - 'close_reason' - 'closed_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'state' - 'close_reason' - 'closed_at') THEN
    RAISE EXCEPTION 'customer credit hold identity and amounts are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.state IN ('converted', 'released') THEN
    RAISE EXCEPTION 'customer credit hold is final' USING ERRCODE = 'P0001';
  END IF;
  IF NOT ((OLD.state, NEW.state) IN (('held', 'awaiting_reconciliation'), ('held', 'converted'), ('held', 'released'),
                                     ('awaiting_reconciliation', 'converted'), ('awaiting_reconciliation', 'released'))) THEN
    RAISE EXCEPTION 'illegal customer credit hold transition % -> %', OLD.state, NEW.state USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_customer_credit_holds_guard ON public.agent_customer_credit_holds;
CREATE TRIGGER agent_customer_credit_holds_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.agent_customer_credit_holds FOR EACH ROW EXECUTE FUNCTION public.agent__guard_credit_hold();

-- -----------------------------------------------------------------------------
-- Stripe true-up outbox
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_billing_operations (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_start             date          NOT NULL,
  period_end               date          NOT NULL,
  sequence                 integer       NOT NULL CHECK (sequence >= 1),
  charge_source            text          NOT NULL DEFAULT 'agent_overage' CHECK (charge_source = 'agent_overage'),
  calculation_version      text          NOT NULL DEFAULT 'h4-agent-overage-v1'
                             CHECK (calculation_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  amount_cents             bigint        NOT NULL,
  currency                 text          NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  overage_credits          numeric(14,4) NOT NULL,
  overage_usd_exact        numeric(16,6) NOT NULL,
  charge_count             integer       NOT NULL CHECK (charge_count >= 0),
  calculation_digest       text          NOT NULL CHECK (calculation_digest ~ '^[0-9a-f]{64}$'),
  stripe_customer_id       text          CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,250}$'),
  stripe_subscription_id   text          CHECK (stripe_subscription_id ~ '^sub_[A-Za-z0-9]{1,250}$'),
  state                    text          NOT NULL DEFAULT 'prepared' CHECK (state IN (
                             'prepared', 'submitting', 'ambiguous', 'item_created', 'invoiced', 'paid',
                             'payment_failed', 'void', 'uncollectible', 'nothing_to_bill', 'manual_intervention')),
  stripe_invoice_item_id   text          CHECK (stripe_invoice_item_id ~ '^ii_[A-Za-z0-9]{1,250}$'),
  stripe_invoice_id        text          CHECK (stripe_invoice_id ~ '^in_[A-Za-z0-9]{1,250}$'),
  invoice_status           text          CHECK (invoice_status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
  hosted_invoice_url       text          CHECK (length(hosted_invoice_url) <= 600
                             AND hosted_invoice_url ~ '^https://[A-Za-z0-9.-]+\.stripe\.com/[A-Za-z0-9/_.~?=&%-]+$'),
  livemode                 boolean       NOT NULL DEFAULT false CHECK (livemode = false),
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
  CONSTRAINT agent_billing_operations_period_key UNIQUE (tenant_id, period_start, sequence),
  CONSTRAINT agent_billing_operations_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT agent_billing_operations_item_key UNIQUE (stripe_invoice_item_id),
  CONSTRAINT agent_billing_operations_window CHECK (period_end >= period_start),
  CONSTRAINT agent_billing_operations_item_shape CHECK (
    state NOT IN ('item_created', 'invoiced', 'paid', 'payment_failed', 'void', 'uncollectible')
    OR stripe_invoice_item_id IS NOT NULL),
  CONSTRAINT agent_billing_operations_invoice_shape CHECK (
    state NOT IN ('invoiced', 'paid', 'payment_failed', 'void', 'uncollectible') OR stripe_invoice_id IS NOT NULL),
  CONSTRAINT agent_billing_operations_nothing_shape CHECK (state <> 'nothing_to_bill' OR amount_cents = 0),
  CONSTRAINT agent_billing_operations_manual_shape CHECK (state <> 'manual_intervention' OR manual_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS agent_billing_operations_due_idx ON public.agent_billing_operations (state, updated_at)
  WHERE state IN ('prepared', 'ambiguous', 'item_created', 'invoiced', 'payment_failed');
CREATE INDEX IF NOT EXISTS agent_billing_operations_invoice_idx ON public.agent_billing_operations (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

COMMENT ON TABLE public.agent_billing_operations IS
  'H4 Stripe true-up outbox. The row id is the durable identity (and Stripe idempotency key), so a retry long after Stripe prunes idempotency keys still cannot double-bill: an existing item is found by metadata before any re-create. livemode is constrained false in H4.';

CREATE OR REPLACE FUNCTION public.agent__guard_billing_operation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_identity text[] := ARRAY['id', 'tenant_id', 'period_start', 'period_end', 'sequence', 'charge_source',
                             'calculation_version', 'amount_cents', 'currency', 'overage_credits', 'overage_usd_exact',
                             'charge_count', 'calculation_digest', 'created_by', 'created_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'billing operations are financial history and are never removed' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('prepared', 'nothing_to_bill', 'manual_intervention') OR NEW.stripe_invoice_item_id IS NOT NULL
       OR NEW.stripe_invoice_id IS NOT NULL THEN
      RAISE EXCEPTION 'a billing operation is born before any Stripe object exists' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF (SELECT jsonb_object_agg(k, to_jsonb(NEW) -> k) FROM unnest(v_identity) k)
     IS DISTINCT FROM (SELECT jsonb_object_agg(k, to_jsonb(OLD) -> k) FROM unnest(v_identity) k) THEN
    RAISE EXCEPTION 'billing operation amount and identity are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.stripe_invoice_item_id IS NOT NULL AND NEW.stripe_invoice_item_id IS DISTINCT FROM OLD.stripe_invoice_item_id THEN
    RAISE EXCEPTION 'a recorded Stripe invoice item id never changes' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.stripe_invoice_id IS NOT NULL AND NEW.stripe_invoice_id IS DISTINCT FROM OLD.stripe_invoice_id THEN
    RAISE EXCEPTION 'a recorded Stripe invoice id never changes' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.state IN ('paid', 'void', 'nothing_to_bill') AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'billing operation % is final', OLD.state USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_billing_operations_guard ON public.agent_billing_operations;
CREATE TRIGGER agent_billing_operations_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.agent_billing_operations FOR EACH ROW EXECUTE FUNCTION public.agent__guard_billing_operation();

-- -----------------------------------------------------------------------------
-- Charge / adjustment journal (immutable; billing_operation_id is assigned exactly once)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_customer_credit_charges (
  id                          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid          NOT NULL,
  kind                        text          NOT NULL CHECK (kind IN ('charge', 'adjustment')),
  attempt_id                  uuid,
  hold_id                     uuid,
  adjusts_charge_id           uuid,
  ledger_id                   uuid          NOT NULL REFERENCES public.credit_ledger(id) ON DELETE CASCADE,
  period_start                date          NOT NULL,
  pricing_policy_id           uuid          NOT NULL,
  policy_version              integer       NOT NULL,
  usd_per_credit              numeric(12,6) NOT NULL CHECK (usd_per_credit > 0),
  markup_multiplier           numeric(8,4)  NOT NULL CHECK (markup_multiplier > 0),
  minimum_credits_per_operation numeric(12,4) NOT NULL CHECK (minimum_credits_per_operation >= 0),
  provider_cost_usd           numeric(20,8) CHECK (provider_cost_usd >= 0),
  provider_schedule_version   text,
  credits                     numeric(12,4) NOT NULL,
  included_credits            numeric(12,4) NOT NULL,
  overage_credits             numeric(12,4) NOT NULL,
  overage_usd                 numeric(14,6) NOT NULL,
  uncharged_overrun_credits   numeric(12,4) NOT NULL DEFAULT 0 CHECK (uncharged_overrun_credits >= 0),
  ledger_applied              boolean       NOT NULL,
  late                        boolean       NOT NULL DEFAULT false,
  billing_operation_id        uuid,
  reason_code                 text          CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  actor_kind                  text          NOT NULL CHECK (actor_kind IN ('worker', 'reconciler', 'operator')),
  actor_ref                   text          NOT NULL CHECK (actor_ref ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  approved_by                 text          CHECK (approved_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  created_at                  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT agent_customer_credit_charges_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT agent_customer_credit_charges_attempt_fk FOREIGN KEY (attempt_id, tenant_id)
    REFERENCES public.agent_model_attempts (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_customer_credit_charges_hold_fk FOREIGN KEY (hold_id, tenant_id)
    REFERENCES public.agent_customer_credit_holds (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_customer_credit_charges_adjusts_fk FOREIGN KEY (adjusts_charge_id, tenant_id)
    REFERENCES public.agent_customer_credit_charges (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_customer_credit_charges_policy_fk FOREIGN KEY (pricing_policy_id, tenant_id)
    REFERENCES public.agent_customer_pricing_policies (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_customer_credit_charges_operation_fk FOREIGN KEY (billing_operation_id, tenant_id)
    REFERENCES public.agent_billing_operations (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_customer_credit_charges_kind_shape CHECK (
    (kind = 'charge' AND attempt_id IS NOT NULL AND hold_id IS NOT NULL AND adjusts_charge_id IS NULL
       AND provider_cost_usd IS NOT NULL AND credits >= 0 AND included_credits >= 0 AND overage_credits >= 0
       AND overage_usd >= 0 AND approved_by IS NULL)
    OR (kind = 'adjustment' AND attempt_id IS NULL AND hold_id IS NULL AND adjusts_charge_id IS NOT NULL
       AND credits < 0 AND included_credits <= 0 AND overage_credits <= 0 AND overage_usd <= 0
       AND uncharged_overrun_credits = 0 AND actor_kind = 'operator' AND approved_by IS NOT NULL
       AND approved_by <> actor_ref)),
  CONSTRAINT agent_customer_credit_charges_split CHECK (credits = included_credits + overage_credits)
);

-- The durable "charged exactly once" identity per provider attempt.
CREATE UNIQUE INDEX IF NOT EXISTS agent_customer_credit_charges_one_per_attempt
  ON public.agent_customer_credit_charges (attempt_id) WHERE kind = 'charge';
CREATE INDEX IF NOT EXISTS agent_customer_credit_charges_period_idx
  ON public.agent_customer_credit_charges (tenant_id, period_start, created_at);
CREATE INDEX IF NOT EXISTS agent_customer_credit_charges_unbilled_idx
  ON public.agent_customer_credit_charges (tenant_id, period_start) WHERE billing_operation_id IS NULL;
CREATE INDEX IF NOT EXISTS agent_customer_credit_charges_ledger_idx ON public.agent_customer_credit_charges (ledger_id);
CREATE INDEX IF NOT EXISTS agent_customer_credit_charges_hold_idx ON public.agent_customer_credit_charges (hold_id);
CREATE INDEX IF NOT EXISTS agent_customer_credit_charges_adjusts_idx ON public.agent_customer_credit_charges (adjusts_charge_id);
CREATE INDEX IF NOT EXISTS agent_customer_credit_charges_policy_idx ON public.agent_customer_credit_charges (pricing_policy_id);
CREATE INDEX IF NOT EXISTS agent_customer_credit_charges_operation_idx ON public.agent_customer_credit_charges (billing_operation_id);

CREATE OR REPLACE FUNCTION public.agent__guard_credit_charge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'customer charges are immutable; record a compensating adjustment' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.billing_operation_id IS NOT NULL THEN
      RAISE EXCEPTION 'a charge is born unbilled' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.billing_operation_id IS NOT NULL OR NEW.billing_operation_id IS NULL
     OR (to_jsonb(NEW) - 'billing_operation_id') IS DISTINCT FROM (to_jsonb(OLD) - 'billing_operation_id') THEN
    RAISE EXCEPTION 'customer charges are immutable; record a compensating adjustment' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_customer_credit_charges_guard ON public.agent_customer_credit_charges;
CREATE TRIGGER agent_customer_credit_charges_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.agent_customer_credit_charges FOR EACH ROW EXECUTE FUNCTION public.agent__guard_credit_charge();

-- -----------------------------------------------------------------------------
-- Append-only audit trails
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_customer_billing_events (
  id           bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid          REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type   text          NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  attempt_id   uuid,
  hold_id      uuid,
  charge_id    uuid,
  policy_id    uuid,
  authorization_id uuid,
  credits      numeric(14,4),
  amount_usd   numeric(16,6),
  reason_code  text          CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  actor_kind   text          NOT NULL CHECK (actor_kind IN ('worker', 'reconciler', 'operator', 'customer', 'system')),
  actor_ref    text          CHECK (actor_ref ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  detail       jsonb         NOT NULL DEFAULT '{}'::jsonb
                 CHECK (jsonb_typeof(detail) = 'object' AND pg_column_size(detail) <= 1024),
  created_at   timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_customer_billing_events_tenant_idx ON public.agent_customer_billing_events (tenant_id, id);

CREATE TABLE IF NOT EXISTS public.agent_billing_operation_events (
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
  CONSTRAINT agent_billing_operation_events_operation_fk FOREIGN KEY (operation_id, tenant_id)
    REFERENCES public.agent_billing_operations (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_billing_operation_events_op_idx ON public.agent_billing_operation_events (operation_id, id);

-- Consent history is append-only for every writer, the service role included (tenant deletion still cascades).
CREATE OR REPLACE FUNCTION public.agent__guard_overage_authorization()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'overage authorizations are append-only; record a new version' USING ERRCODE = 'P0001';
END;
$function$;

DROP TRIGGER IF EXISTS agent_customer_overage_authorizations_guard ON public.agent_customer_overage_authorizations;
CREATE TRIGGER agent_customer_overage_authorizations_guard BEFORE UPDATE OR DELETE
  ON public.agent_customer_overage_authorizations FOR EACH ROW EXECUTE FUNCTION public.agent__guard_overage_authorization();

DROP TRIGGER IF EXISTS agent_customer_billing_events_immutable ON public.agent_customer_billing_events;
CREATE TRIGGER agent_customer_billing_events_immutable BEFORE UPDATE OR DELETE ON public.agent_customer_billing_events
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_tool_immutable();
DROP TRIGGER IF EXISTS agent_billing_operation_events_immutable ON public.agent_billing_operation_events;
CREATE TRIGGER agent_billing_operation_events_immutable BEFORE UPDATE OR DELETE ON public.agent_billing_operation_events
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_tool_immutable();

-- -----------------------------------------------------------------------------
-- RLS and privileges: backend service role only (the GM reads through the API, which scopes by verified hotel)
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_customer_billing_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_customer_pricing_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_customer_overage_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_customer_credit_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_customer_credit_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_customer_billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_billing_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_billing_operation_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agent_customer_billing_controls, public.agent_customer_pricing_policies,
              public.agent_customer_overage_authorizations, public.agent_customer_credit_holds,
              public.agent_customer_credit_charges, public.agent_customer_billing_events,
              public.agent_billing_operations, public.agent_billing_operation_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agent_customer_billing_controls, public.agent_customer_pricing_policies,
                                public.agent_customer_credit_holds, public.agent_customer_credit_charges,
                                public.agent_billing_operations TO service_role;
GRANT SELECT, INSERT ON public.agent_customer_overage_authorizations, public.agent_customer_billing_events,
                        public.agent_billing_operation_events TO service_role;

REVOKE ALL ON FUNCTION public.agent__guard_pricing_policy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__guard_credit_hold() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__guard_credit_charge() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__guard_billing_operation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__guard_overage_authorization() FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- Migration 014: Billing — Subscriptions & Credit Ledger
-- Stripe subscription state and usage-based AI credit accounting
-- =============================================================================

-- ---------------------------------------------------------------------------
-- subscriptions
-- Mirrors Stripe subscription state for each hotel. Kept in sync by the
-- Stripe webhook Edge Function. Single source of truth for access control.
-- ---------------------------------------------------------------------------
CREATE TABLE subscriptions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID        NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_customer_id      TEXT        NOT NULL UNIQUE,
  stripe_subscription_id  TEXT        UNIQUE,              -- NULL during trial before sub created
  plan_status             TEXT        NOT NULL DEFAULT 'trialing' CHECK (plan_status IN (
                            'trialing',   -- within trial period
                            'active',     -- paid and current
                            'past_due',   -- payment failed, grace period
                            'cancelled',  -- subscription ended
                            'paused'      -- manually paused by admin
                          )),
  trial_end               TIMESTAMPTZ,
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  base_fee_cents          INT         NOT NULL DEFAULT 9900,   -- $99.00/month base
  credits_included        INT         NOT NULL DEFAULT 5000,   -- AI credits included in plan
  room_count_at_billing   INT,                               -- snapshot for per-room fee calc
  cap_cents               INT,                               -- monthly spend cap in cents (optional)
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE subscriptions IS 'Stripe subscription state mirror. Updated by Stripe webhook Edge Function.';
COMMENT ON COLUMN subscriptions.base_fee_cents IS 'Monthly base fee in cents, e.g. 9900 = $99.00.';
COMMENT ON COLUMN subscriptions.credits_included IS 'AI credits bundled in the subscription plan per billing period.';
COMMENT ON COLUMN subscriptions.cap_cents IS 'Optional hard monthly spend cap. NULL = no cap.';

-- ---------------------------------------------------------------------------
-- credit_ledger
-- Monthly AI credit usage accounting. One row per tenant per billing month.
-- The overage columns are computed/generated columns — no manual updates.
-- Overage is billed at $0.02 per credit ($2 per 100 credits).
-- ---------------------------------------------------------------------------
CREATE TABLE credit_ledger (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_start        DATE        NOT NULL,
  period_end          DATE        NOT NULL,
  credits_included    INT         NOT NULL DEFAULT 5000,
  credits_used        INT         NOT NULL DEFAULT 0,
  credits_purchased   INT         NOT NULL DEFAULT 0,      -- add-on credit pack purchases

  -- Generated computed columns (read-only; automatically computed by PostgreSQL)
  overage_credits     INT         GENERATED ALWAYS AS (
                        GREATEST(0, credits_used - credits_included - credits_purchased)
                      ) STORED,
  overage_cost_cents  INT         GENERATED ALWAYS AS (
                        GREATEST(0, credits_used - credits_included - credits_purchased) * 2
                      ) STORED,

  stripe_invoice_id   TEXT,                               -- Stripe invoice ID once billed
  is_finalized        BOOLEAN     NOT NULL DEFAULT FALSE,  -- true after period ends and invoiced
  finalized_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, period_start)
);

COMMENT ON TABLE credit_ledger IS 'Monthly AI credit usage accounting. Overage billed at 2 cents/credit ($2 per 100 credits).';
COMMENT ON COLUMN credit_ledger.credits_used IS 'Incremented atomically via increment_credits_used() function after each AI call.';
COMMENT ON COLUMN credit_ledger.overage_credits IS 'Computed: MAX(0, used - included - purchased). Automatically maintained by PostgreSQL.';
COMMENT ON COLUMN credit_ledger.overage_cost_cents IS 'Computed: overage_credits * 2 cents. Represents billable overage amount.';
COMMENT ON COLUMN credit_ledger.is_finalized IS 'Set to TRUE by billing job at end of period before generating Stripe invoice.';

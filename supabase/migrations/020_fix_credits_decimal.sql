-- =============================================================================
-- Migration 020: Fix Fractional AI Credits — Change credits_used to NUMERIC
-- =============================================================================
-- BUG-003: increment_credits_used() cast p_credits to INT before adding it,
-- silently truncating fractional costs (e.g. 0.5 → 0, 0.25 → 0). This caused
-- billing to undercount usage for room_prediction (0.5) and failure_prediction
-- (0.25) interaction types.
--
-- Fix: Change credits_used from INT to NUMERIC(10,4) so fractional values
-- accumulate correctly, then recreate the function without the erroneous cast.
--
-- The GENERATED ALWAYS AS computed columns (overage_credits, overage_cost_cents)
-- reference credits_used, so they must be dropped and recreated around the
-- column type change. PostgreSQL does not allow ALTER COLUMN TYPE on a column
-- that is referenced by a generated column.
--
-- Existing data: NUMERIC is a widening type change from INT — all existing
-- integer values are preserved exactly with no data loss.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Drop the generated columns that reference credits_used.
-- These are STORED generated columns so they carry no user data — their
-- values are always recomputable from the base columns.
-- ---------------------------------------------------------------------------
ALTER TABLE credit_ledger
  DROP COLUMN overage_credits,
  DROP COLUMN overage_cost_cents;

-- ---------------------------------------------------------------------------
-- Step 2: Change credits_used from INT to NUMERIC(10,4).
-- Four decimal places matches the smallest credit unit in use (0.0001).
-- Existing integer rows are automatically widened — no USING clause needed.
-- ---------------------------------------------------------------------------
ALTER TABLE credit_ledger
  ALTER COLUMN credits_used TYPE NUMERIC(10,4);

-- Update the column default so new rows start at 0.0000 (not the integer 0,
-- which is valid either way, but explicit typing keeps it consistent).
ALTER TABLE credit_ledger
  ALTER COLUMN credits_used SET DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Step 3: Recreate the generated computed columns with identical logic.
-- The expressions are unchanged; they now operate on NUMERIC(10,4) inputs.
-- overage_credits: how many credits exceeded the plan allowance
-- overage_cost_cents: billed overage at $0.02/credit (2 cents per credit)
-- ---------------------------------------------------------------------------
ALTER TABLE credit_ledger
  ADD COLUMN overage_credits NUMERIC(10,4) GENERATED ALWAYS AS (
    GREATEST(0, credits_used - credits_included - credits_purchased)
  ) STORED,
  ADD COLUMN overage_cost_cents NUMERIC(10,4) GENERATED ALWAYS AS (
    GREATEST(0, credits_used - credits_included - credits_purchased) * 2
  ) STORED;

-- ---------------------------------------------------------------------------
-- Step 4: Recreate increment_credits_used without the erroneous ::int cast.
-- p_credits is declared DECIMAL — passing it straight to the SET expression
-- preserves the full fractional value.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_credits_used(
  p_hotel_id uuid,
  p_credits  decimal
)
RETURNS void
LANGUAGE sql AS $$
  UPDATE credit_ledger
  SET credits_used = credits_used + p_credits
  WHERE
    tenant_id    = p_hotel_id
    AND period_start <= CURRENT_DATE
    AND period_end   >= CURRENT_DATE
    AND is_finalized = FALSE;
$$;

COMMENT ON FUNCTION increment_credits_used IS
  'Atomically adds credits (including fractional values) to the active billing period ledger. Call after every successful AI interaction.';

-- ---------------------------------------------------------------------------
-- Step 5: Refresh column comments to reflect the new type.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN credit_ledger.credits_used IS
  'Cumulative AI credits consumed this period. NUMERIC(10,4) to preserve fractional costs (e.g. 0.5 for room_prediction, 0.25 for failure_prediction). Incremented atomically via increment_credits_used().';

COMMENT ON COLUMN credit_ledger.overage_credits IS
  'Computed: GREATEST(0, credits_used - credits_included - credits_purchased). NUMERIC(10,4) to match credits_used precision. Automatically maintained by PostgreSQL.';

COMMENT ON COLUMN credit_ledger.overage_cost_cents IS
  'Computed: overage_credits * 2 cents ($0.02/credit). NUMERIC(10,4) — round to nearest cent at invoice time. Automatically maintained by PostgreSQL.';

COMMIT;

-- =============================================================================
-- Migration 217: atomic, cap-aware AI credit deduction
-- =============================================================================
-- The API used to check the hotel's cap with one read (credit_ledger.overage_cost_cents) and then add the
-- call's credits with a separate increment_credits_used() call. Requests that overlapped all read the same
-- "under the cap" figure and all were billed, so a burst could push a hotel arbitrarily far past its cap.
--
-- deduct_ai_credits() does the check and the increment in ONE UPDATE. Concurrent callers queue on the
-- ledger row's lock, and each re-evaluates the cap against the row the previous one committed, so the
-- ledger can pass the cap by at most the cost of the single call that crossed it, whatever the concurrency.
--
-- The cap rule is exactly the one the API applies (middleware/credits.py _raise_if_cap_reached): when the
-- subscription has a positive cap_cents, a deduction is refused once overage_cost_cents has reached
-- cap_cents - base fee. No cap (no subscription row, NULL or 0) means no limit.
--
-- Additive only: increment_credits_used() is left untouched (the API falls back to it, with a warning,
-- until this function exists). Nothing historical is edited.
--
-- Returns TRUE when the credits were added, FALSE when refused (at the cap, or no open ledger row).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.deduct_ai_credits(
  p_hotel_id       uuid,
  p_credits        numeric,
  p_base_fee_cents numeric DEFAULT 9900
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $function$
  WITH applied AS (
    UPDATE credit_ledger cl
    SET credits_used = cl.credits_used + p_credits
    WHERE cl.tenant_id = p_hotel_id
      AND cl.period_start <= CURRENT_DATE
      AND cl.period_end   >= CURRENT_DATE
      AND cl.is_finalized = FALSE
      AND NOT EXISTS (
        SELECT 1
        FROM subscriptions s
        WHERE s.tenant_id = p_hotel_id
          AND COALESCE(s.cap_cents, 0) > 0
          AND cl.overage_cost_cents >= s.cap_cents - p_base_fee_cents
      )
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM applied);
$function$;

COMMENT ON FUNCTION public.deduct_ai_credits(uuid, numeric, numeric) IS
  'Atomically adds AI credits to the open billing-period ledger unless the hotel has reached its monthly cap. Returns false when refused. Check and increment are one statement, so concurrent calls cannot all pass a stale cap check.';

-- Only the API (service role) may spend a hotel's credits.
REVOKE ALL ON FUNCTION public.deduct_ai_credits(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_ai_credits(uuid, numeric, numeric) TO service_role;

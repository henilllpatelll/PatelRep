-- =============================================================================
-- Migration 062: Add cancelled status to late_checkout_requests
-- Allows Opera imports to cancel pending requests instead of leaving
-- stale pending rows after the morning HK Details / Task Sheet reset.
-- =============================================================================

ALTER TABLE late_checkout_requests
  DROP CONSTRAINT IF EXISTS late_checkout_requests_status_check;

ALTER TABLE late_checkout_requests
  ADD CONSTRAINT late_checkout_requests_status_check
  CHECK (status IN ('pending', 'approved', 'denied', 'cancelled'));

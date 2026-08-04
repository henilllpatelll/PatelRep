-- Phase 16: Stripe webhook event deduplication (BILLING-09).
-- Stripe explicitly documents that webhook endpoints "might occasionally
-- receive the same event more than once" (docs.stripe.com/webhooks/signatures).
-- Insert-or-skip on event_id at the top of POST /webhooks/stripe before any
-- handler runs, so a retried delivery is a no-op.
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id     TEXT        PRIMARY KEY,
  event_type   TEXT        NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.stripe_webhook_events IS
  'One row per processed Stripe event.id. No RLS — service-role only, mirrors cron_health (migration 068) convention. Never queried by anon/authenticated roles via PostgREST.';

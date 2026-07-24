-- Phase 5 foundation: guest_phone, GM-configured ADR, retention flagging, delivery-event table.

ALTER TABLE public.guest_requests ADD COLUMN IF NOT EXISTS guest_phone TEXT;

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS average_daily_rate_cents INTEGER;
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_average_daily_rate_cents_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_average_daily_rate_cents_check CHECK (average_daily_rate_cents IS NULL OR average_daily_rate_cents BETWEEN 0 AND 10000000);

ALTER TABLE public.lost_found_items ADD COLUMN IF NOT EXISTS disposition_flagged_at TIMESTAMPTZ;

UPDATE public.lost_found_items SET retention_due_at = created_at + INTERVAL '90 days' WHERE retention_due_at IS NULL;

CREATE TABLE IF NOT EXISTS public.guest_message_delivery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  guest_message_id UUID NOT NULL REFERENCES public.guest_messages(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'undelivered', 'failed', 'opted_out')),
  provider_message_id TEXT,
  error_code TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guest_message_delivery_events_message
  ON public.guest_message_delivery_events (tenant_id, guest_message_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guest_message_delivery_events_provider
  ON public.guest_message_delivery_events (provider_message_id);
DROP TRIGGER IF EXISTS guest_message_delivery_events_immutable ON public.guest_message_delivery_events;
CREATE TRIGGER guest_message_delivery_events_immutable
  BEFORE UPDATE OR DELETE ON public.guest_message_delivery_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_guest_recovery_mutation();
ALTER TABLE public.guest_message_delivery_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_guest_message_delivery_events" ON public.guest_message_delivery_events;
CREATE POLICY "tenant_guest_message_delivery_events" ON public.guest_message_delivery_events
  FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_guest_messages_outbound_recipient
  ON public.guest_messages (recipient, created_at DESC) WHERE direction = 'outbound';
CREATE INDEX IF NOT EXISTS idx_lost_found_retention_due
  ON public.lost_found_items (tenant_id, status, retention_due_at);

-- ROLLBACK:
-- DROP TABLE public.guest_message_delivery_events;
-- ALTER TABLE public.guest_requests DROP COLUMN guest_phone;
-- ALTER TABLE public.tenants DROP COLUMN average_daily_rate_cents;
-- ALTER TABLE public.lost_found_items DROP COLUMN disposition_flagged_at;
-- DROP INDEX IF EXISTS idx_guest_message_delivery_events_message;
-- DROP INDEX IF EXISTS idx_guest_message_delivery_events_provider;
-- DROP INDEX IF EXISTS idx_guest_messages_outbound_recipient;
-- DROP INDEX IF EXISTS idx_lost_found_retention_due;
-- Note: the retention_due_at backfill above is intentionally NOT rolled back — the column
-- pre-exists from migration 072 and the backfilled values are correct data, not schema.

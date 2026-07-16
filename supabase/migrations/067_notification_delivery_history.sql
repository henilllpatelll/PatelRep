-- Phase 1: Preserve a delivery outcome for every operational notification.
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'push', 'email', 'sms')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'delivered', 'failed')),
  provider_message_id TEXT,
  failure_reason TEXT,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notification
  ON public.notification_deliveries (tenant_id, notification_id, created_at DESC);

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_notification_delivery_read" ON public.notification_deliveries
  FOR SELECT
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

COMMENT ON TABLE public.notification_deliveries IS
  'Append-only delivery outcomes for in-app and future provider notifications.';

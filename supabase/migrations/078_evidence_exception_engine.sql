-- Phase 2: GM-owned exception actions and idempotent, truthful evidence reminders.

CREATE TABLE IF NOT EXISTS public.evidence_exception_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  exception_kind TEXT NOT NULL CHECK (exception_kind IN ('document', 'acknowledgement', 'evidence')),
  reference_id UUID NOT NULL,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('open', 'deferred', 'escalated', 'resolved')) DEFAULT 'open',
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason_code TEXT NOT NULL,
  reason_note TEXT NOT NULL,
  escalation_level INTEGER NOT NULL DEFAULT 0 CHECK (escalation_level >= 0),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, exception_kind, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_exception_actions_queue
  ON public.evidence_exception_actions (tenant_id, lifecycle_state, owner_id, updated_at DESC);

ALTER TABLE public.evidence_exception_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_evidence_exception_actions" ON public.evidence_exception_actions
  FOR ALL
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- A queued delivery has not been delivered. Provider workers alone may later set
-- it to delivered or failed; a repeated cron invocation keeps the same key.
ALTER TABLE public.notification_deliveries
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.notification_deliveries
  ALTER COLUMN delivered_at DROP NOT NULL,
  ALTER COLUMN delivered_at DROP DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_deliveries_idempotency
  ON public.notification_deliveries (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.queue_evidence_reminder_delivery(
  p_tenant_id UUID,
  p_recipient_id UUID,
  p_assignment_id UUID,
  p_state TEXT,
  p_channel TEXT,
  p_idempotency_key TEXT,
  p_retry_failed BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (outcome TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery public.notification_deliveries;
  v_notification_id UUID;
BEGIN
  SELECT * INTO v_delivery
  FROM public.notification_deliveries
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_delivery.status = 'failed' AND p_retry_failed THEN
      UPDATE public.notification_deliveries
      SET status = 'queued', failure_reason = NULL, provider_message_id = NULL,
          delivered_at = NULL, created_at = now()
      WHERE id = v_delivery.id;
      RETURN QUERY SELECT 'retry_queued'::TEXT;
    ELSE
      RETURN QUERY SELECT 'duplicate'::TEXT;
    END IF;
    RETURN;
  END IF;

  INSERT INTO public.notifications (tenant_id, user_id, type, title, body, data)
  VALUES (
    p_tenant_id, p_recipient_id, 'evidence_reminder',
    'Document acknowledgement required',
    format('A controlled document acknowledgement is %s.', replace(p_state, '_', ' ')),
    jsonb_build_object('assignment_id', p_assignment_id, 'reminder_key', p_idempotency_key)
  ) RETURNING id INTO v_notification_id;

  INSERT INTO public.notification_deliveries (
    tenant_id, notification_id, user_id, channel, status, idempotency_key, delivered_at
  ) VALUES (
    p_tenant_id, v_notification_id, p_recipient_id, p_channel, 'queued', p_idempotency_key, NULL
  );
  RETURN QUERY SELECT 'queued'::TEXT;
END;
$$;

INSERT INTO public.cron_health (job_name) VALUES ('evidence.reminders')
ON CONFLICT (job_name) DO NOTHING;

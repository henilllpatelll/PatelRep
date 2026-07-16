-- Phase 5: auditable guest recovery, accessibility operations, custody, and ROI.

ALTER TABLE public.guest_requests
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'service' CHECK (category IN ('service', 'housekeeping', 'maintenance', 'accessibility', 'other')),
  ADD COLUMN IF NOT EXISTS guest_impact TEXT NOT NULL DEFAULT 'standard' CHECK (guest_impact IN ('low', 'standard', 'high')),
  ADD COLUMN IF NOT EXISTS sla_minutes INTEGER NOT NULL DEFAULT 240 CHECK (sla_minutes BETWEEN 1 AND 10080),
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guest_contacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_preference TEXT CHECK (contact_preference IN ('sms', 'call', 'email', 'in_person', 'none')),
  ADD COLUMN IF NOT EXISTS contact_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_opted_out_at TIMESTAMPTZ;

ALTER TABLE public.guest_requests DROP CONSTRAINT IF EXISTS guest_requests_status_check;
ALTER TABLE public.guest_requests ADD CONSTRAINT guest_requests_status_check CHECK (status IN ('open', 'acknowledged', 'dispatched', 'arrived', 'guest_contacted', 'resolved', 'verified', 'reopened', 'cancelled'));

CREATE TABLE public.guest_request_sla_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  category TEXT CHECK (category IN ('service', 'housekeeping', 'maintenance', 'accessibility', 'other')),
  priority TEXT CHECK (priority IN ('normal', 'urgent')),
  guest_impact TEXT CHECK (guest_impact IN ('low', 'standard', 'high')),
  sla_minutes INTEGER NOT NULL CHECK (sla_minutes BETWEEN 1 AND 10080),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (category IS NOT NULL OR priority IS NOT NULL OR guest_impact IS NOT NULL)
);

CREATE TABLE public.guest_request_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  guest_request_id UUID NOT NULL REFERENCES public.guest_requests(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'acknowledged', 'dispatched', 'arrived', 'guest_contacted', 'resolved', 'verified', 'reopened', 'cancelled', 'note')),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'sms', 'automation', 'guest')),
  detail TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.guest_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  guest_request_id UUID NOT NULL REFERENCES public.guest_requests(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  channel TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'email')),
  body TEXT NOT NULL,
  recipient TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'queued' CHECK (delivery_status IN ('received', 'queued', 'sent', 'delivered', 'failed', 'opted_out')),
  provider_message_id TEXT,
  failure_reason TEXT,
  excluded_from_ai BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.guest_recovery_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  guest_request_id UUID NOT NULL REFERENCES public.guest_requests(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL CHECK (action_type IN ('apology', 'amenity', 'discount', 'refund', 'points', 'other')),
  description TEXT NOT NULL,
  compensation_amount NUMERIC(12,2) CHECK (compensation_amount >= 0),
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.accessible_room_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  feature_code TEXT NOT NULL,
  description TEXT,
  operational_status TEXT NOT NULL DEFAULT 'operational' CHECK (operational_status IN ('operational', 'out_of_service', 'inspection_due')),
  guidance TEXT,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, room_id, feature_code)
);

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS accessible_feature_id UUID REFERENCES public.accessible_room_features(id) ON DELETE SET NULL;

ALTER TABLE public.lost_found_items
  ADD COLUMN IF NOT EXISTS tag_identifier TEXT,
  ADD COLUMN IF NOT EXISTS storage_location TEXT,
  ADD COLUMN IF NOT EXISTS retention_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS release_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS release_verification_method TEXT,
  ADD COLUMN IF NOT EXISTS disposition_approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE public.lost_found_custody_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lost_found_item_id UUID NOT NULL REFERENCES public.lost_found_items(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('intake', 'moved', 'released', 'disposition')),
  storage_location TEXT,
  recipient_name TEXT,
  verification_method TEXT,
  disposition TEXT CHECK (disposition IN ('claimed', 'donated', 'discarded')),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_guest_requests_recovery_queue ON public.guest_requests (tenant_id, status, due_at);
CREATE INDEX idx_guest_request_events_history ON public.guest_request_events (tenant_id, guest_request_id, created_at DESC);
CREATE INDEX idx_guest_messages_request ON public.guest_messages (tenant_id, guest_request_id, created_at DESC);
CREATE INDEX idx_lost_found_custody_history ON public.lost_found_custody_events (tenant_id, lost_found_item_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.reject_guest_recovery_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Guest recovery and custody events are append-only.'; END; $$;
CREATE TRIGGER guest_request_events_immutable BEFORE UPDATE OR DELETE ON public.guest_request_events FOR EACH ROW EXECUTE FUNCTION public.reject_guest_recovery_mutation();
CREATE TRIGGER guest_messages_immutable BEFORE UPDATE OR DELETE ON public.guest_messages FOR EACH ROW EXECUTE FUNCTION public.reject_guest_recovery_mutation();
CREATE TRIGGER guest_recovery_actions_immutable BEFORE UPDATE OR DELETE ON public.guest_recovery_actions FOR EACH ROW EXECUTE FUNCTION public.reject_guest_recovery_mutation();
CREATE TRIGGER lost_found_custody_events_immutable BEFORE UPDATE OR DELETE ON public.lost_found_custody_events FOR EACH ROW EXECUTE FUNCTION public.reject_guest_recovery_mutation();

ALTER TABLE public.guest_request_sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_recovery_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accessible_room_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lost_found_custody_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_guest_request_sla_policies" ON public.guest_request_sla_policies FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_guest_request_events" ON public.guest_request_events FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_guest_messages" ON public.guest_messages FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_guest_recovery_actions" ON public.guest_recovery_actions FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_accessible_room_features" ON public.accessible_room_features FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_lost_found_custody_events" ON public.lost_found_custody_events FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

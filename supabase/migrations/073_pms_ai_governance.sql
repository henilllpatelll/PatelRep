-- Phase 6: recoverable PMS conflicts and human-authorized AI recommendation loops.

CREATE TABLE public.integration_sync_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('opera')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('reservation', 'room_status')),
  external_id TEXT NOT NULL,
  local_entity_id UUID,
  local_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  remote_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved_local_wins', 'resolved_remote_wins')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE public.integration_sync_conflict_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conflict_id UUID NOT NULL REFERENCES public.integration_sync_conflicts(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('detected', 'resolved_local_wins', 'resolved_remote_wins')),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_model_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('copilot_fast_path', 'failure_prediction', 'room_readiness', 'sop_rag')),
  model_name TEXT NOT NULL,
  fallback_model_name TEXT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, purpose)
);

CREATE TABLE public.ai_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('failure_prediction', 'room_readiness', 'copilot')),
  source_id UUID,
  recommendation_type TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  suggested_action TEXT NOT NULL CHECK (suggested_action IN ('create_work_order', 'notify_supervisor', 'request_inspection', 'adjust_room_assignment')),
  action_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'authorized', 'executed', 'outcome_recorded', 'rejected', 'overridden')),
  authorization_note TEXT,
  authorized_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  authorized_at TIMESTAMPTZ,
  executed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  executed_at TIMESTAMPTZ,
  outcome TEXT CHECK (outcome IN ('prevented_failure', 'resolved', 'false_positive', 'no_action_needed', 'other')),
  outcome_detail TEXT,
  outcome_recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  outcome_recorded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_recommendation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  recommendation_id UUID NOT NULL REFERENCES public.ai_recommendations(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'authorized', 'executed', 'outcome_recorded', 'rejected', 'overridden')),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_integration_sync_conflicts_open ON public.integration_sync_conflicts (tenant_id, status, detected_at DESC);
CREATE UNIQUE INDEX idx_integration_sync_conflicts_one_open ON public.integration_sync_conflicts (tenant_id, provider, entity_type, external_id) WHERE status = 'open';
CREATE INDEX idx_ai_recommendations_queue ON public.ai_recommendations (tenant_id, status, created_at DESC);
CREATE INDEX idx_ai_recommendation_events_history ON public.ai_recommendation_events (tenant_id, recommendation_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.reject_phase_six_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'PMS conflict and AI recommendation events are append-only.'; END; $$;
CREATE TRIGGER integration_sync_conflict_events_immutable BEFORE UPDATE OR DELETE ON public.integration_sync_conflict_events FOR EACH ROW EXECUTE FUNCTION public.reject_phase_six_event_mutation();
CREATE TRIGGER ai_recommendation_events_immutable BEFORE UPDATE OR DELETE ON public.ai_recommendation_events FOR EACH ROW EXECUTE FUNCTION public.reject_phase_six_event_mutation();

ALTER TABLE public.integration_sync_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_sync_conflict_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_model_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_recommendation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_integration_sync_conflicts" ON public.integration_sync_conflicts FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_integration_sync_conflict_events" ON public.integration_sync_conflict_events FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_ai_model_routes" ON public.ai_model_routes FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_ai_recommendations" ON public.ai_recommendations FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_ai_recommendation_events" ON public.ai_recommendation_events FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

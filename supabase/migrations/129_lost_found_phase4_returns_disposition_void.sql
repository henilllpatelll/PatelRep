-- Lost & Found Phase 4: return lifecycle (pickup/shipping), disposition eligibility guards,
-- and a non-destructive Void Record correction path.
-- All additions are nullable/default-safe; no existing status enum values change meaning.

ALTER TABLE public.lost_found_items
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS disposed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.lost_found_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.lost_found_items(id) ON DELETE CASCADE,
  claim_id UUID NOT NULL REFERENCES public.lost_found_claims(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'pickup' CHECK (method IN ('pickup', 'shipping', 'other')),
  status TEXT NOT NULL DEFAULT 'awaiting_details' CHECK (status IN (
    'awaiting_details', 'ready_for_pickup', 'shipping_preparation', 'shipped', 'completed', 'cancelled'
  )),
  recipient_name TEXT,
  pickup_location TEXT,
  pickup_notes TEXT,
  pickup_verification_method_required TEXT,
  pickup_ready_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  shipping_name TEXT,
  shipping_address_line1 TEXT,
  shipping_address_line2 TEXT,
  shipping_city TEXT,
  shipping_region TEXT,
  shipping_postal_code TEXT,
  shipping_country TEXT,
  carrier TEXT CHECK (carrier IS NULL OR carrier IN ('fedex', 'ups', 'usps', 'dhl', 'local_courier', 'other')),
  tracking_number TEXT,
  shipping_paid_by TEXT CHECK (shipping_paid_by IS NULL OR shipping_paid_by IN ('hotel', 'guest', 'other')),
  shipping_cost_cents INTEGER CHECK (shipping_cost_cents IS NULL OR shipping_cost_cents >= 0),
  shipped_at TIMESTAMPTZ,
  verification_method TEXT,
  verification_notes TEXT,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancellation_reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.lost_found_return_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  return_id UUID NOT NULL REFERENCES public.lost_found_returns(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'started', 'method_changed', 'pickup_details_set', 'ready_for_pickup',
    'shipping_details_set', 'shipped', 'completed', 'cancelled'
  )),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Concurrency guard: only one active (non-terminal) return per item, mirroring the
-- Phase 3 one-confirmed-claim-per-item index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lost_found_one_active_return_per_item
  ON public.lost_found_returns (tenant_id, item_id)
  WHERE status NOT IN ('completed', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_lost_found_returns_tenant_status_created
  ON public.lost_found_returns (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lost_found_returns_tenant_item
  ON public.lost_found_returns (tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_lost_found_returns_tenant_claim
  ON public.lost_found_returns (tenant_id, claim_id);
CREATE INDEX IF NOT EXISTS idx_lost_found_return_events_history
  ON public.lost_found_return_events (tenant_id, return_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lost_found_items_voided
  ON public.lost_found_items (tenant_id, voided_at);

ALTER TABLE public.lost_found_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lost_found_return_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_lost_found_returns" ON public.lost_found_returns FOR ALL
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_lost_found_return_events" ON public.lost_found_return_events FOR ALL
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Phase 10: hotel-scoped vendor operations. This intentionally records service
-- engagements, not purchasing, accounts payable, or a vendor marketplace.

CREATE TABLE IF NOT EXISTS public.engineering_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trades TEXT[] NOT NULL DEFAULT '{}',
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  emergency_phone TEXT,
  offers_24h_service BOOLEAN NOT NULL DEFAULT FALSE,
  insurance_expires_at DATE,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT engineering_vendors_name_per_tenant UNIQUE (tenant_id, name),
  CONSTRAINT engineering_vendors_trades_limit CHECK (cardinality(trades) <= 8)
);

CREATE INDEX IF NOT EXISTS engineering_vendors_directory_idx
  ON public.engineering_vendors (tenant_id, is_active, name);

CREATE TABLE IF NOT EXISTS public.work_order_vendor_engagements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES public.engineering_vendors(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'accepted', 'en_route', 'on_site', 'completed', 'cancelled')),
  service_type TEXT NOT NULL DEFAULT 'standard' CHECK (service_type IN ('standard', 'emergency')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  expected_arrival_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  quote_amount NUMERIC(10,2) CHECK (quote_amount IS NULL OR quote_amount >= 0),
  invoice_amount NUMERIC(10,2) CHECK (invoice_amount IS NULL OR invoice_amount >= 0),
  reference_number TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (accepted_at IS NULL OR accepted_at >= requested_at),
  CHECK (arrived_at IS NULL OR arrived_at >= requested_at),
  CHECK (completed_at IS NULL OR arrived_at IS NULL OR completed_at >= arrived_at)
);

CREATE INDEX IF NOT EXISTS work_order_vendor_engagements_work_order_idx
  ON public.work_order_vendor_engagements (tenant_id, work_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS work_order_vendor_engagements_vendor_idx
  ON public.work_order_vendor_engagements (tenant_id, vendor_id, completed_at DESC);

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS vendor_cost NUMERIC(10,2);
COMMENT ON COLUMN public.work_orders.vendor_cost IS
  'Sum of final invoice amounts across this work order vendor engagements. NULL means no invoice data.';

CREATE OR REPLACE FUNCTION public.refresh_work_order_vendor_cost(p_work_order_id UUID, p_tenant_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_vendor_cost NUMERIC(10,2); v_labor NUMERIC(10,2); v_parts NUMERIC(10,2);
BEGIN
  SELECT SUM(invoice_amount) INTO v_vendor_cost
  FROM public.work_order_vendor_engagements
  WHERE work_order_id = p_work_order_id AND tenant_id = p_tenant_id AND invoice_amount IS NOT NULL;
  SELECT labor_cost, parts_cost INTO v_labor, v_parts
  FROM public.work_orders WHERE id = p_work_order_id AND tenant_id = p_tenant_id FOR UPDATE;
  UPDATE public.work_orders
  SET vendor_cost = v_vendor_cost,
      total_cost = CASE WHEN v_labor IS NULL AND v_parts IS NULL AND v_vendor_cost IS NULL THEN NULL
                        ELSE COALESCE(v_labor, 0) + COALESCE(v_parts, 0) + COALESCE(v_vendor_cost, 0) END,
      updated_at = now()
  WHERE id = p_work_order_id AND tenant_id = p_tenant_id;
END; $$;
REVOKE ALL ON FUNCTION public.refresh_work_order_vendor_cost(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_work_order_vendor_cost(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_work_order_vendor_cost()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_work_order_vendor_cost(OLD.work_order_id, OLD.tenant_id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_work_order_vendor_cost(NEW.work_order_id, NEW.tenant_id);
  RETURN NEW;
END; $$;
CREATE TRIGGER work_order_vendor_cost_sync
AFTER INSERT OR UPDATE OF invoice_amount OR DELETE ON public.work_order_vendor_engagements
FOR EACH ROW EXECUTE FUNCTION public.sync_work_order_vendor_cost();

-- Keep the historical vendor_name snapshot. New completion records can link to
-- a managed vendor without erasing what historic imports recorded.
ALTER TABLE public.pm_completion_records
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES public.engineering_vendors(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS pm_completion_records_vendor_idx
  ON public.pm_completion_records (tenant_id, vendor_id, completed_at DESC);

ALTER TABLE public.engineering_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_vendor_engagements ENABLE ROW LEVEL SECURITY;
CREATE POLICY engineering_vendors_tenant_access ON public.engineering_vendors
  FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY work_order_vendor_engagements_tenant_access ON public.work_order_vendor_engagements
  FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

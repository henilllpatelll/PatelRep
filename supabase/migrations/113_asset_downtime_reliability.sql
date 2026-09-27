-- Phase 8: explicit asset downtime. A work order may exist without taking an
-- asset out of service, so reliability metrics must never infer this data.

CREATE TABLE public.asset_downtime_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  work_order_id UUID REFERENCES public.work_orders(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  restored_at TIMESTAMPTZ,
  downtime_minutes INTEGER,
  downtime_type TEXT NOT NULL DEFAULT 'unplanned'
    CHECK (downtime_type IN ('unplanned', 'planned')),
  impact_level TEXT NOT NULL DEFAULT 'out_of_service'
    CHECK (impact_level IN ('degraded', 'out_of_service')),
  reason_code TEXT,
  notes TEXT,
  started_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  restored_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (restored_at IS NULL OR restored_at >= started_at),
  CHECK ((restored_at IS NULL AND downtime_minutes IS NULL)
      OR (restored_at IS NOT NULL AND downtime_minutes IS NOT NULL))
);

-- One active period is the source of operational availability. The partial
-- unique index also closes the race where two callers see no active row.
CREATE UNIQUE INDEX asset_downtime_periods_one_active_per_asset
  ON public.asset_downtime_periods (asset_id) WHERE restored_at IS NULL;
CREATE INDEX asset_downtime_periods_asset_history
  ON public.asset_downtime_periods (tenant_id, asset_id, started_at DESC);
CREATE INDEX asset_downtime_periods_active
  ON public.asset_downtime_periods (tenant_id, asset_id, started_at DESC)
  WHERE restored_at IS NULL;
CREATE INDEX asset_downtime_periods_work_order
  ON public.asset_downtime_periods (tenant_id, work_order_id)
  WHERE work_order_id IS NOT NULL;

ALTER TABLE public.asset_downtime_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_downtime_periods_tenant_access ON public.asset_downtime_periods
  FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE FUNCTION public.start_asset_downtime(
  p_asset_id UUID,
  p_tenant_id UUID,
  p_work_order_id UUID DEFAULT NULL,
  p_downtime_type TEXT DEFAULT 'unplanned',
  p_impact_level TEXT DEFAULT 'out_of_service',
  p_reason_code TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_started_by UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_period public.asset_downtime_periods%ROWTYPE;
  v_work_order_asset_id UUID;
BEGIN
  -- Locking the asset serializes normal starts; the partial unique index is
  -- still the final authority under an insert race.
  PERFORM 1 FROM public.assets
    WHERE id = p_asset_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_downtime_type NOT IN ('unplanned', 'planned')
     OR p_impact_level NOT IN ('degraded', 'out_of_service') THEN
    RAISE EXCEPTION 'Invalid downtime values' USING ERRCODE = '22023';
  END IF;
  IF p_work_order_id IS NOT NULL THEN
    SELECT asset_id INTO v_work_order_asset_id FROM public.work_orders
      WHERE id = p_work_order_id AND tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Work order not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_work_order_asset_id IS DISTINCT FROM p_asset_id THEN
      RAISE EXCEPTION 'Work order must be linked to this asset' USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT * INTO v_period FROM public.asset_downtime_periods
    WHERE tenant_id = p_tenant_id AND asset_id = p_asset_id AND restored_at IS NULL
    FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('created', false, 'period', to_jsonb(v_period));
  END IF;
  BEGIN
    INSERT INTO public.asset_downtime_periods (
      tenant_id, asset_id, work_order_id, downtime_type, impact_level,
      reason_code, notes, started_by
    ) VALUES (
      p_tenant_id, p_asset_id, p_work_order_id, p_downtime_type, p_impact_level,
      p_reason_code, p_notes, p_started_by
    ) RETURNING * INTO v_period;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_period FROM public.asset_downtime_periods
      WHERE tenant_id = p_tenant_id AND asset_id = p_asset_id AND restored_at IS NULL;
    RETURN jsonb_build_object('created', false, 'period', to_jsonb(v_period));
  END;
  RETURN jsonb_build_object('created', true, 'period', to_jsonb(v_period));
END;
$$;

CREATE FUNCTION public.restore_asset_downtime(
  p_asset_id UUID,
  p_downtime_id UUID,
  p_tenant_id UUID,
  p_restored_by UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_period public.asset_downtime_periods%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT * INTO v_period FROM public.asset_downtime_periods
    WHERE id = p_downtime_id AND asset_id = p_asset_id AND tenant_id = p_tenant_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Downtime period not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_period.restored_at IS NOT NULL THEN
    RETURN jsonb_build_object('restored', false, 'period', to_jsonb(v_period));
  END IF;
  UPDATE public.asset_downtime_periods SET
    restored_at = v_now,
    restored_by = p_restored_by,
    notes = COALESCE(p_notes, notes),
    downtime_minutes = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_now - started_at)) / 60))::INTEGER,
    updated_at = v_now
    WHERE id = p_downtime_id
    RETURNING * INTO v_period;
  RETURN jsonb_build_object('restored', true, 'period', to_jsonb(v_period));
END;
$$;

COMMENT ON TABLE public.asset_downtime_periods IS
  'Explicit planned/unplanned equipment unavailability. Does not represent room downtime or generic work orders.';

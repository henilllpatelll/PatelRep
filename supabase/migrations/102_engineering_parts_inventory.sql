-- =============================================================================
-- Migration 102: Engineering Spare-Parts Inventory
-- InvenTree-derived (MIT) item/location/stock/transaction model, scoped to
-- engineering spare parts only. housekeeping_supply_pars (migration 071)
-- already covers linen/chemical/amenity par-level tracking — this table set
-- fills the separate, still-open gap: work_orders.parts_used was a free-text
-- field with no structured stock behind it, so nothing decremented on
-- consumption and there was no low-stock signal for spares.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- engineering_part_locations
-- Tree of stock locations (e.g. "Building A -> Engineering Shop -> Shelf 3").
-- is_structural mirrors InvenTree: an organizational node that holds no stock
-- of its own, only children.
-- ---------------------------------------------------------------------------
CREATE TABLE public.engineering_part_locations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_id     UUID        REFERENCES public.engineering_part_locations(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  is_structural BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, parent_id, name)
);

COMMENT ON TABLE public.engineering_part_locations IS 'Tree of spare-parts stock locations. is_structural = organizational node only, holds no stock directly.';

-- ---------------------------------------------------------------------------
-- engineering_parts
-- The part definition (not a physical quantity — see engineering_part_stock).
-- minimum_stock/maximum_stock drive the low-stock signal computed at read
-- time by the API (no stored alert row, matching the housekeeping_supply_pars
-- pattern of computing alerts on read rather than writing notifications per
-- transaction).
-- ---------------------------------------------------------------------------
CREATE TABLE public.engineering_parts (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name               TEXT        NOT NULL,
  sku                TEXT,
  category           TEXT,
  unit               TEXT        NOT NULL DEFAULT 'each',
  minimum_stock      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  maximum_stock      NUMERIC(12,2) CHECK (maximum_stock IS NULL OR maximum_stock >= minimum_stock),
  default_location_id UUID       REFERENCES public.engineering_part_locations(id) ON DELETE SET NULL,
  is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

COMMENT ON TABLE public.engineering_parts IS 'Spare-part definitions for engineering work orders. Physical on-hand quantity lives in engineering_part_stock.';
COMMENT ON COLUMN public.engineering_parts.minimum_stock IS 'Below this total on-hand (summed across locations), the part is flagged low-stock on read.';

-- ---------------------------------------------------------------------------
-- engineering_part_stock
-- Current on-hand quantity of one part at one location. Total on-hand for a
-- part = SUM(quantity) across its rows.
-- ---------------------------------------------------------------------------
CREATE TABLE public.engineering_part_stock (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  part_id     UUID        NOT NULL REFERENCES public.engineering_parts(id) ON DELETE CASCADE,
  location_id UUID        NOT NULL REFERENCES public.engineering_part_locations(id) ON DELETE CASCADE,
  quantity    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (part_id, location_id)
);

COMMENT ON TABLE public.engineering_part_stock IS 'Current on-hand quantity per part per location. Mutated only through engineering_part_transactions.';

-- ---------------------------------------------------------------------------
-- engineering_part_transactions
-- Immutable audit log of every stock movement (InvenTree's StockItemTracking
-- pattern): add / remove / count / transfer. work_order_id links consumption
-- to the work order that used the part. transfer writes two paired rows
-- (source remove + destination add) sharing transfer_group_id.
-- ---------------------------------------------------------------------------
CREATE TABLE public.engineering_part_transactions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  part_id            UUID        NOT NULL REFERENCES public.engineering_parts(id) ON DELETE RESTRICT,
  location_id        UUID        NOT NULL REFERENCES public.engineering_part_locations(id) ON DELETE RESTRICT,
  transaction_type   TEXT        NOT NULL CHECK (transaction_type IN ('add', 'remove', 'count', 'transfer')),
  quantity_delta     NUMERIC(12,2) NOT NULL,
  resulting_quantity NUMERIC(12,2) NOT NULL CHECK (resulting_quantity >= 0),
  transfer_group_id  UUID,
  work_order_id      UUID        REFERENCES public.work_orders(id) ON DELETE SET NULL,
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.engineering_part_transactions IS 'Append-only stock movement audit log. Never updated or deleted — see engineering_part_transactions_immutable trigger.';
COMMENT ON COLUMN public.engineering_part_transactions.work_order_id IS 'Set when a part was consumed closing a work order, so WO cost/history can show parts used.';

CREATE INDEX idx_engineering_part_locations_tree ON public.engineering_part_locations (tenant_id, parent_id);
CREATE INDEX idx_engineering_part_stock_part ON public.engineering_part_stock (tenant_id, part_id);
CREATE INDEX idx_engineering_part_transactions_part ON public.engineering_part_transactions (tenant_id, part_id, created_at DESC);
CREATE INDEX idx_engineering_part_transactions_wo ON public.engineering_part_transactions (work_order_id) WHERE work_order_id IS NOT NULL;

-- Reuse the append-only guard already defined for operational-program records
-- (migration 071) instead of duplicating the same trigger function.
CREATE TRIGGER engineering_part_transactions_immutable
  BEFORE UPDATE OR DELETE ON public.engineering_part_transactions
  FOR EACH ROW EXECUTE FUNCTION public.reject_operational_program_mutation();

ALTER TABLE public.engineering_part_locations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engineering_parts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engineering_part_stock       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engineering_part_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_engineering_part_locations" ON public.engineering_part_locations FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_engineering_parts" ON public.engineering_parts FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_engineering_part_stock" ON public.engineering_part_stock FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_engineering_part_transactions" ON public.engineering_part_transactions FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

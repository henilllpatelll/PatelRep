-- =============================================================================
-- Migration 110: Work Order Console Panel — Zone, Snooze, Checklist
-- Adds the schema behind the redesigned Engineering > Work Orders > Console
-- detail panel: a mechanical-zone label on assets, a snooze timestamp on
-- work orders, and a per-category checklist (template + per-WO instance,
-- mirroring the cleaning_checklist_templates/room_clean_sessions snapshot
-- pattern from migration 054 — templates stay editable without rewriting
-- history already captured on in-flight work orders).
-- =============================================================================

ALTER TABLE public.assets
  ADD COLUMN zone TEXT;

COMMENT ON COLUMN public.assets.zone IS 'Free-text mechanical/service zone label (e.g. "HVAC zone B"), used to group related assets/rooms on shared equipment for duplicate-work-order detection. NULL = not zoned.';

ALTER TABLE public.work_orders
  ADD COLUMN snoozed_until TIMESTAMPTZ;

COMMENT ON COLUMN public.work_orders.snoozed_until IS 'When set and in the future, the console panel shows the WO as snoozed. Purely a display hint on this panel — does not affect queue sort, AI triage, or SLA-breach styling elsewhere.';

-- ---------------------------------------------------------------------------
-- work_order_checklist_templates / _template_items
-- Per-tenant, per-category default checklist. Seeded below for hvac,
-- plumbing, and electrical; other categories simply have no template and
-- a work order starts with an empty (manually-built) checklist.
-- ---------------------------------------------------------------------------
CREATE TABLE public.work_order_checklist_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  category    TEXT        NOT NULL CHECK (category IN (
                'plumbing', 'electrical', 'hvac', 'furniture', 'appliance',
                'structural', 'safety', 'doors_locks', 'painting', 'general'
              )),
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, category)
);

COMMENT ON TABLE public.work_order_checklist_templates IS 'One default checklist template per tenant per WO category. Editing this never rewrites items already snapshotted onto in-flight work orders.';

CREATE TABLE public.work_order_checklist_template_items (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_id         UUID        NOT NULL REFERENCES public.work_order_checklist_templates(id) ON DELETE CASCADE,
  label               TEXT        NOT NULL,
  estimated_minutes   INT         CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
  sort_order          INT         NOT NULL DEFAULT 0
);

CREATE INDEX idx_wo_checklist_template_items ON public.work_order_checklist_template_items (template_id, sort_order);

-- ---------------------------------------------------------------------------
-- work_order_checklist_items
-- Per-work-order checklist instance. Snapshotted from the matching template
-- at WO creation time (application code); can also be hand-added per WO.
-- ---------------------------------------------------------------------------
CREATE TABLE public.work_order_checklist_items (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  work_order_id       UUID        NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  label               TEXT        NOT NULL,
  estimated_minutes   INT         CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
  is_done             BOOLEAN     NOT NULL DEFAULT FALSE,
  done_by             UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  done_at             TIMESTAMPTZ,
  sort_order          INT         NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.work_order_checklist_items IS 'Per-work-order checklist steps. Seeded from work_order_checklist_templates by category at WO creation; editable per WO thereafter.';

CREATE INDEX idx_wo_checklist_items_wo ON public.work_order_checklist_items (work_order_id, sort_order);

ALTER TABLE public.work_order_checklist_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_checklist_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_checklist_items          ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped access; fine-grained RBAC (who may toggle/add items) is
-- enforced in the API layer via require_role, matching the engineering
-- spare-parts tables (migration 102) rather than duplicating role checks
-- in RLS.
CREATE POLICY "tenant_wo_checklist_templates" ON public.work_order_checklist_templates
  FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_wo_checklist_template_items" ON public.work_order_checklist_template_items
  FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_wo_checklist_items" ON public.work_order_checklist_items
  FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- Seed default templates for every existing tenant (hvac / plumbing /
-- electrical only — the mockup's worked example is HVAC; the other two
-- are the next-most-common reactive-maintenance categories). The API
-- lazily seeds the same defaults for tenants created later, mirroring how
-- migration 054 handles cleaning_checklist_templates.
-- ---------------------------------------------------------------------------
WITH defaults(category, label, estimated_minutes, sort_order) AS (
  VALUES
    ('hvac', 'Confirm setpoint and thermostat calibration', 10, 1),
    ('hvac', 'Check belt tension and coil temps',            20, 2),
    ('hvac', 'Offer guest a fan or move if unresolved',      10, 3),
    ('plumbing', 'Confirm leak/clog location and shut-off valve', 10, 1),
    ('plumbing', 'Inspect fixture and supply line condition',     20, 2),
    ('plumbing', 'Test water flow and check for further leaks',   10, 3),
    ('electrical', 'Confirm breaker/outlet and de-energize before work', 10, 1),
    ('electrical', 'Inspect wiring, fixture, or device condition',       20, 2),
    ('electrical', 'Test power restored and log affected circuit',      10, 3)
),
tpl AS (
  INSERT INTO public.work_order_checklist_templates (tenant_id, category)
  SELECT t.id, d.category
  FROM public.tenants t
  CROSS JOIN (SELECT DISTINCT category FROM defaults) d
  ON CONFLICT (tenant_id, category) DO NOTHING
  RETURNING id, tenant_id, category
)
INSERT INTO public.work_order_checklist_template_items (tenant_id, template_id, label, estimated_minutes, sort_order)
SELECT tpl.tenant_id, tpl.id, d.label, d.estimated_minutes, d.sort_order
FROM tpl
JOIN defaults d ON d.category = tpl.category;

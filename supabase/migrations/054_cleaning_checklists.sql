-- Migration 054: Supervisor-managed cleaning checklist templates
-- One template per tenant per clean type (DEP / FULL / LIGHT / DEFAULT).
-- Items are snapshotted into room_clean_sessions.checklist when a clean starts,
-- so editing a template never rewrites history.

CREATE TABLE IF NOT EXISTS cleaning_checklist_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  clean_type  text        NOT NULL CHECK (clean_type IN ('DEP', 'FULL', 'LIGHT', 'DEFAULT')),
  name        text        NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, clean_type)
);

CREATE TABLE IF NOT EXISTS cleaning_checklist_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id uuid        NOT NULL REFERENCES cleaning_checklist_templates(id) ON DELETE CASCADE,
  section     text        NOT NULL DEFAULT 'General',
  label       text        NOT NULL,
  is_required boolean     NOT NULL DEFAULT false,
  sort_order  int         NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS cct_tenant_idx ON cleaning_checklist_templates (tenant_id);
CREATE INDEX IF NOT EXISTS cci_tenant_idx ON cleaning_checklist_items (tenant_id);
CREATE INDEX IF NOT EXISTS cci_template_idx ON cleaning_checklist_items (template_id, sort_order);

ALTER TABLE cleaning_checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_read" ON cleaning_checklist_templates
  FOR SELECT USING (tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'))::uuid);
CREATE POLICY "supervisor_write" ON cleaning_checklist_templates
  FOR ALL USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'))::uuid
    AND ((SELECT auth.jwt()) ->> 'user_role') IN ('gm', 'housekeeping_supervisor')
  );

CREATE POLICY "tenant_read" ON cleaning_checklist_items
  FOR SELECT USING (tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'))::uuid);
CREATE POLICY "supervisor_write" ON cleaning_checklist_items
  FOR ALL USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'))::uuid
    AND ((SELECT auth.jwt()) ->> 'user_role') IN ('gm', 'housekeeping_supervisor')
  );

-- Seed default templates for every existing tenant.
-- (The API lazily seeds the same defaults for tenants created later.)
WITH defaults(clean_type, tpl_name, section, label, is_required, sort_order) AS (
  VALUES
    ('DEP', 'Departure Clean',    'Bedroom',  'Strip beds and remove used linens', true,  1),
    ('DEP', 'Departure Clean',    'Bedroom',  'Make beds with fresh linens',       true,  2),
    ('DEP', 'Departure Clean',    'Bathroom', 'Clean and sanitize bathroom',       true,  3),
    ('DEP', 'Departure Clean',    'Bathroom', 'Replace towels and bath amenities', true,  4),
    ('DEP', 'Departure Clean',    'General',  'Vacuum floors including under bed', false, 5),
    ('DEP', 'Departure Clean',    'General',  'Dust surfaces and check HVAC',      false, 6),
    ('DEP', 'Departure Clean',    'General',  'Empty trash and reline bins',       false, 7),
    ('DEP', 'Departure Clean',    'General',  'Check drawers and safe for guest items', false, 8),
    ('DEP', 'Departure Clean',    'General',  'Final walkthrough and set thermostat',   false, 9),
    ('FULL', 'Full Linen Change', 'Bedroom',  'Change bed linens',                 true,  1),
    ('FULL', 'Full Linen Change', 'Bathroom', 'Clean and sanitize bathroom',       true,  2),
    ('FULL', 'Full Linen Change', 'Bathroom', 'Replace towels',                    false, 3),
    ('FULL', 'Full Linen Change', 'General',  'Restock amenities',                 false, 4),
    ('FULL', 'Full Linen Change', 'General',  'Vacuum floors',                     false, 5),
    ('FULL', 'Full Linen Change', 'General',  'Empty trash',                       false, 6),
    ('LIGHT', 'Light Service',    'General',  'Empty trash',                       false, 1),
    ('LIGHT', 'Light Service',    'Bathroom', 'Replace used towels',               false, 2),
    ('LIGHT', 'Light Service',    'Bedroom',  'Tidy bed and surfaces',             false, 3),
    ('LIGHT', 'Light Service',    'General',  'Restock amenities',                 false, 4),
    ('DEFAULT', 'Standard Clean', 'Bedroom',  'Make beds with fresh linens',       true,  1),
    ('DEFAULT', 'Standard Clean', 'Bathroom', 'Clean and sanitize bathroom',       true,  2),
    ('DEFAULT', 'Standard Clean', 'Bathroom', 'Replace towels',                    false, 3),
    ('DEFAULT', 'Standard Clean', 'General',  'Vacuum floors',                     false, 4),
    ('DEFAULT', 'Standard Clean', 'General',  'Restock amenities',                 false, 5),
    ('DEFAULT', 'Standard Clean', 'General',  'Empty trash',                       false, 6)
),
tpl AS (
  INSERT INTO cleaning_checklist_templates (tenant_id, clean_type, name)
  SELECT t.id, d.clean_type, d.tpl_name
  FROM tenants t
  CROSS JOIN (SELECT DISTINCT clean_type, tpl_name FROM defaults) d
  ON CONFLICT (tenant_id, clean_type) DO NOTHING
  RETURNING id, tenant_id, clean_type
)
INSERT INTO cleaning_checklist_items (tenant_id, template_id, section, label, is_required, sort_order)
SELECT tpl.tenant_id, tpl.id, d.section, d.label, d.is_required, d.sort_order
FROM tpl
JOIN defaults d ON d.clean_type = tpl.clean_type;

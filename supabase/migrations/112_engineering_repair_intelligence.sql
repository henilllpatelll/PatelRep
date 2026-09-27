-- Phase 7: structured problem -> cause -> resolution repair intelligence.
-- Codes are stable references; nullable fields keep historical work orders valid.

CREATE TABLE public.engineering_repair_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  code_type TEXT NOT NULL CHECK (code_type IN ('problem', 'cause', 'resolution')),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  engineering_category TEXT CHECK (engineering_category IN (
    'plumbing', 'electrical', 'hvac', 'furniture', 'appliance', 'structural',
    'safety', 'doors_locks', 'painting', 'general'
  )),
  asset_category_id UUID REFERENCES public.asset_categories(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code_type, code)
);

CREATE UNIQUE INDEX engineering_repair_codes_global_code_unique
  ON public.engineering_repair_codes (code_type, code)
  WHERE tenant_id IS NULL;
CREATE INDEX engineering_repair_codes_available
  ON public.engineering_repair_codes (code_type, engineering_category, is_active, sort_order);

COMMENT ON TABLE public.engineering_repair_codes IS
  'Global defaults plus future tenant-specific problem, cause, and resolution codes. Global codes have tenant_id NULL.';

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS problem_code_id UUID REFERENCES public.engineering_repair_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cause_code_id UUID REFERENCES public.engineering_repair_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_code_id UUID REFERENCES public.engineering_repair_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS problem_other_text TEXT,
  ADD COLUMN IF NOT EXISTS cause_other_text TEXT,
  ADD COLUMN IF NOT EXISTS resolution_other_text TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verification_result TEXT CHECK (verification_result IN ('passed', 'failed', 'follow_up_required')),
  ADD COLUMN IF NOT EXISTS verification_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_work_orders_problem_code
  ON public.work_orders (tenant_id, problem_code_id) WHERE problem_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_cause_code
  ON public.work_orders (tenant_id, cause_code_id) WHERE cause_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_resolution_code
  ON public.work_orders (tenant_id, resolution_code_id) WHERE resolution_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_asset_completed
  ON public.work_orders (tenant_id, asset_id, completed_at DESC) WHERE asset_id IS NOT NULL;

CREATE TABLE public.work_order_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  child_work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('repeat_failure', 'follow_up', 'duplicate', 'related')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (parent_work_order_id <> child_work_order_id),
  UNIQUE (parent_work_order_id, child_work_order_id, relationship_type)
);

CREATE INDEX work_order_relationships_parent_idx
  ON public.work_order_relationships (tenant_id, parent_work_order_id, relationship_type);
CREATE INDEX work_order_relationships_child_idx
  ON public.work_order_relationships (tenant_id, child_work_order_id, relationship_type);

ALTER TABLE public.engineering_repair_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY engineering_repair_codes_read ON public.engineering_repair_codes
  FOR SELECT USING (tenant_id IS NULL OR tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY engineering_repair_codes_tenant_write ON public.engineering_repair_codes
  FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY work_order_relationships_tenant_access ON public.work_order_relationships
  FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

WITH codes(code_type, code, label, engineering_category, sort_order) AS (
  VALUES
    ('problem','no_cooling','No cooling','hvac',10), ('problem','no_heat','No heat','hvac',20), ('problem','unit_not_running','Unit not running','hvac',30), ('problem','weak_airflow','Weak airflow','hvac',40), ('problem','water_leak','Water leak','hvac',50), ('problem','unusual_noise','Unusual noise','hvac',60), ('problem','thermostat_issue','Thermostat issue','hvac',70), ('problem','bad_odor','Bad odor','hvac',80), ('problem','short_cycling','Short cycling','hvac',90), ('problem','other_hvac','Other','hvac',999),
    ('cause','dirty_filter','Dirty filter','hvac',10), ('cause','failed_capacitor','Failed capacitor','hvac',20), ('cause','failed_fan_motor','Failed fan motor','hvac',30), ('cause','compressor_failure','Compressor failure','hvac',40), ('cause','thermostat_failure','Thermostat failure','hvac',50), ('cause','refrigerant_low','Refrigerant leak / low refrigerant','hvac',60), ('cause','blocked_condensate_drain','Blocked condensate drain','hvac',70), ('cause','loose_electrical_connection','Loose electrical connection','hvac',80), ('cause','frozen_coil','Frozen coil','hvac',90), ('cause','control_board_failure','Control board failure','hvac',100), ('cause','other_hvac','Other','hvac',999),
    ('problem','leak','Leak','plumbing',10), ('problem','clog','Clog','plumbing',20), ('problem','no_hot_water','No hot water','plumbing',30), ('problem','low_pressure','Low pressure','plumbing',40), ('problem','running_toilet','Running toilet','plumbing',50), ('problem','faucet_issue','Faucet issue','plumbing',60), ('problem','other_plumbing','Other','plumbing',999),
    ('cause','failed_seal','Failed seal','plumbing',10), ('cause','blocked_drain','Blocked drain','plumbing',20), ('cause','loose_fitting','Loose fitting','plumbing',30), ('cause','failed_cartridge','Failed cartridge','plumbing',40), ('cause','supply_line_failure','Supply line failure','plumbing',50), ('cause','other_plumbing','Other','plumbing',999),
    ('problem','no_power','No power','electrical',10), ('problem','outlet_issue','Outlet issue','electrical',20), ('problem','light_not_working','Light not working','electrical',30), ('problem','breaker_tripping','Breaker tripping','electrical',40), ('problem','burning_smell','Burning smell','electrical',50), ('problem','other_electrical','Other','electrical',999),
    ('cause','tripped_breaker','Tripped breaker','electrical',10), ('cause','failed_fixture','Failed fixture','electrical',20), ('cause','damaged_wiring','Damaged wiring','electrical',30), ('cause','loose_connection','Loose connection','electrical',40), ('cause','other_electrical','Other','electrical',999),
    ('problem','damaged_furniture','Damaged furniture','furniture',10), ('problem','loose_hardware','Loose hardware','furniture',20), ('problem','drawer_or_hinge_issue','Drawer or hinge issue','furniture',30), ('problem','other_furniture','Other','furniture',999),
    ('cause','worn_hardware','Worn hardware','furniture',10), ('cause','broken_component','Broken component','furniture',20), ('cause','loose_fastener','Loose fastener','furniture',30), ('cause','other_furniture','Other','furniture',999),
    ('problem','not_operating','Not operating','appliance',10), ('problem','temperature_issue','Temperature issue','appliance',20), ('problem','leak','Leak','appliance',30), ('problem','unusual_noise','Unusual noise','appliance',40), ('problem','other_appliance','Other','appliance',999),
    ('cause','failed_component','Failed component','appliance',10), ('cause','blocked_filter','Blocked filter','appliance',20), ('cause','power_issue','Power issue','appliance',30), ('cause','other_appliance','Other','appliance',999),
    ('problem','wall_or_ceiling_damage','Wall or ceiling damage','structural',10), ('problem','floor_damage','Floor damage','structural',20), ('problem','water_damage','Water damage','structural',30), ('problem','other_structural','Other','structural',999),
    ('cause','impact_damage','Impact damage','structural',10), ('cause','moisture_damage','Moisture damage','structural',20), ('cause','material_failure','Material failure','structural',30), ('cause','other_structural','Other','structural',999),
    ('problem','safety_hazard','Safety hazard','safety',10), ('problem','emergency_equipment_issue','Emergency equipment issue','safety',20), ('problem','trip_hazard','Trip hazard','safety',30), ('problem','other_safety','Other','safety',999),
    ('cause','missing_guard','Missing guard','safety',10), ('cause','damaged_equipment','Damaged equipment','safety',20), ('cause','code_noncompliance','Code noncompliance','safety',30), ('cause','other_safety','Other','safety',999),
    ('problem','key_not_working','Guest key not working','doors_locks',10), ('problem','lock_not_responding','Lock not responding','doors_locks',20), ('problem','will_not_latch','Door will not latch','doors_locks',30), ('problem','deadbolt_issue','Deadbolt issue','doors_locks',40), ('problem','battery_low','Battery low','doors_locks',50), ('problem','other_doors_locks','Other','doors_locks',999),
    ('cause','low_battery','Low battery','doors_locks',10), ('cause','misaligned_strike','Misaligned strike','doors_locks',20), ('cause','failed_lock_motor','Failed lock motor','doors_locks',30), ('cause','key_encoding_issue','Key encoding issue','doors_locks',40), ('cause','other_doors_locks','Other','doors_locks',999),
    ('problem','paint_damage','Paint damage','painting',10), ('problem','peeling_paint','Peeling paint','painting',20), ('problem','stain','Stain','painting',30), ('problem','other_painting','Other','painting',999),
    ('cause','moisture','Moisture','painting',10), ('cause','surface_damage','Surface damage','painting',20), ('cause','poor_adhesion','Poor adhesion','painting',30), ('cause','other_painting','Other','painting',999),
    ('problem','general_repair_needed','General repair needed','general',10), ('problem','other_general','Other','general',999),
    ('cause','wear_and_tear','Wear and tear','general',10), ('cause','installation_issue','Installation issue','general',20), ('cause','other_general','Other','general',999),
    ('cause','unknown','Unknown',NULL,900), ('cause','no_fault_found','No fault found',NULL,910), ('cause','vendor_diagnosis_pending','Vendor diagnosis pending',NULL,920), ('cause','other','Other',NULL,999),
    ('resolution','cleaned','Cleaned',NULL,10), ('resolution','adjusted','Adjusted',NULL,20), ('resolution','reset_system','Reset system',NULL,30), ('resolution','tightened','Tightened',NULL,40), ('resolution','repaired','Repaired',NULL,50), ('resolution','replaced_component','Replaced component',NULL,60), ('resolution','cleared_obstruction','Cleared obstruction',NULL,70), ('resolution','rewired','Rewired',NULL,80), ('resolution','vendor_service','Vendor service',NULL,90), ('resolution','temporary_repair','Temporary repair',NULL,100), ('resolution','no_repair_required','No repair required',NULL,110), ('resolution','replaced_equipment','Replaced equipment',NULL,120), ('resolution','other','Other',NULL,999)
)
INSERT INTO public.engineering_repair_codes (tenant_id, code_type, code, label, engineering_category, sort_order)
SELECT NULL, code_type, code, label, engineering_category, sort_order FROM codes
ON CONFLICT DO NOTHING;

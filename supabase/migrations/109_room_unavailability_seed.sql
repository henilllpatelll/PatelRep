-- Seed tenant-customizable defaults and preserve existing OOO rooms without
-- inventing an ETA, owner, or linked work order.
INSERT INTO public.room_unavailability_reasons (tenant_id, code, label, sort_order)
SELECT t.id, defaults.code, defaults.label, defaults.sort_order
FROM public.tenants t
CROSS JOIN (VALUES
  ('HVAC', 'HVAC', 10), ('PLUMBING', 'Plumbing', 20), ('ELECTRICAL', 'Electrical', 30),
  ('WATER_DAMAGE', 'Water damage', 40), ('SAFETY', 'Safety', 50), ('PEST', 'Pest', 60),
  ('FURNITURE_FIXTURE', 'Furniture / fixture', 70), ('RENOVATION', 'Renovation', 80),
  ('OTHER', 'Other', 90), ('LEGACY_UNKNOWN', 'Unknown / legacy', 999)
) AS defaults(code, label, sort_order)
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO public.room_unavailability_periods (tenant_id, room_id, reason_code, reason_label, started_at, source)
SELECT rs.tenant_id, rs.room_id, 'LEGACY_UNKNOWN', 'Unknown / legacy', COALESCE(rs.updated_at, now()), 'LEGACY'
FROM public.room_status rs
WHERE rs.status = 'OOO'
  AND NOT EXISTS (
    SELECT 1 FROM public.room_unavailability_periods p WHERE p.room_id = rs.room_id AND p.status = 'ACTIVE'
  );

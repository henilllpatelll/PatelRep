-- =============================================================================
-- Migration 060: Task Engine Pilot Mock Seed
-- Mock data for a single OPERA Cloud-style pilot hotel.
-- Do not use for real OPERA Cloud automation; this only seeds local/pilot
-- execution data that can be overwritten safely by onboarding flows.
-- =============================================================================

INSERT INTO tenants (
  id,
  name,
  slug,
  address,
  city,
  state,
  zip,
  phone,
  room_count,
  timezone,
  is_active
)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'PatelRep Pilot OPERA Cloud Hotel',
  'patelrep-pilot-opera-cloud',
  '100 Pilot Lobby Drive',
  'Irving',
  'TX',
  '75039',
  '214-555-0199',
  4,
  'America/Chicago',
  TRUE
)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      room_count = EXCLUDED.room_count,
      timezone = EXCLUDED.timezone,
      updated_at = NOW();

INSERT INTO departments (id, tenant_id, name, code, color)
VALUES
  ('21111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Housekeeping', 'housekeeping', '#2F5D50'),
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Maintenance', 'maintenance', '#8A5A1F'),
  ('23333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Front Desk', 'front_desk', '#2F6F95'),
  ('24444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'Manager', 'manager', '#5A4C8D'),
  ('25555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'System', 'system', '#4B5563')
ON CONFLICT (tenant_id, code) DO UPDATE
  SET name = EXCLUDED.name,
      color = EXCLUDED.color;

INSERT INTO room_types (
  id,
  tenant_id,
  name,
  code,
  base_clean_minutes,
  stayover_minutes,
  max_occupancy
)
VALUES
  ('51111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'King', 'KING', 32, 18, 2),
  ('52222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Double Queen', 'DQQ', 36, 22, 4),
  ('53333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'King Suite', 'KS', 45, 28, 4)
ON CONFLICT (tenant_id, code) DO UPDATE
  SET name = EXCLUDED.name,
      base_clean_minutes = EXCLUDED.base_clean_minutes,
      stayover_minutes = EXCLUDED.stayover_minutes;

INSERT INTO rooms (
  id,
  tenant_id,
  room_number,
  floor,
  room_type_id,
  is_active,
  opera_room_id,
  opera_status,
  patelrep_status,
  occupancy_status,
  arrival_departure_context,
  due_time,
  open_issues,
  mismatch_flag
)
VALUES
  (
    '41111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    '101',
    1,
    '51111111-1111-4111-8111-111111111111',
    TRUE,
    'OPERA-101',
    'VD',
    'DIRTY',
    'departed',
    '{"departure":"2026-06-14T11:00:00-05:00"}'::jsonb,
    '2026-06-14T14:00:00-05:00',
    '[]'::jsonb,
    FALSE
  ),
  (
    '42222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    '102',
    1,
    '52222222-2222-4222-8222-222222222222',
    TRUE,
    'OPERA-102',
    'OC',
    'PICKUP',
    'occupied',
    '{"stayover":true}'::jsonb,
    '2026-06-14T16:00:00-05:00',
    '[{"category":"linen","summary":"Extra towels requested"}]'::jsonb,
    FALSE
  ),
  (
    '43333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    '214',
    2,
    '53333333-3333-4333-8333-333333333333',
    TRUE,
    'OPERA-214',
    'VC',
    'DIRTY',
    'vacant',
    '{"arrival":"2026-06-14T15:00:00-05:00"}'::jsonb,
    '2026-06-14T13:30:00-05:00',
    '[{"category":"room_status","summary":"OPERA says clean, PatelRep says dirty"}]'::jsonb,
    TRUE
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
    '305',
    3,
    '52222222-2222-4222-8222-222222222222',
    TRUE,
    'OPERA-305',
    'OOO',
    'OOO',
    'out_of_order',
    '{}'::jsonb,
    NULL,
    '[{"category":"hvac","summary":"PTAC not cooling"}]'::jsonb,
    FALSE
  )
ON CONFLICT (tenant_id, room_number) DO UPDATE
  SET opera_status = EXCLUDED.opera_status,
      patelrep_status = EXCLUDED.patelrep_status,
      occupancy_status = EXCLUDED.occupancy_status,
      arrival_departure_context = EXCLUDED.arrival_departure_context,
      due_time = EXCLUDED.due_time,
      open_issues = EXCLUDED.open_issues,
      mismatch_flag = EXCLUDED.mismatch_flag,
      notes = 'Task-engine pilot mock room';

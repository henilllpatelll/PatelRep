-- Phase 3: Dual-role / schedule-based switching
-- Allows GMs to schedule staff members to act as a higher role on specific days of the week.
-- Example: housekeeper acts as housekeeping_supervisor every Monday and Tuesday.

CREATE TABLE IF NOT EXISTS staff_role_schedules (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL,
  override_role text       NOT NULL CHECK (override_role IN ('housekeeping_supervisor', 'chief_engineer')),
  days_of_week int[]       NOT NULL,  -- 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  start_date   date,                  -- NULL = no start bound
  end_date     date,                  -- NULL = never expires
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS srs_lookup_idx
  ON staff_role_schedules (hotel_id, user_id, is_active);

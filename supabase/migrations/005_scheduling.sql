-- =============================================================================
-- Migration 005: Scheduling — Shifts & Shift Assignments
-- Defines shift templates and links staff to specific work dates
-- =============================================================================

-- ---------------------------------------------------------------------------
-- shifts
-- Reusable shift templates defining department, time window, and name.
-- Examples: "Morning HK" 07:00-15:00, "Evening HK" 15:00-23:00
-- ---------------------------------------------------------------------------
CREATE TABLE shifts (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,                          -- e.g. "Morning", "Evening", "Night"
  department_id UUID    NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  start_time    TIME    NOT NULL,                          -- wall clock start, e.g. 07:00:00
  end_time      TIME    NOT NULL,                          -- wall clock end, e.g. 15:00:00
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE shifts IS 'Reusable shift templates per department. Assigned to staff on specific work dates via shift_assignments.';
COMMENT ON COLUMN shifts.start_time IS 'Shift start time in hotel local time (use tenant timezone for display).';
COMMENT ON COLUMN shifts.end_time IS 'Shift end time. Night shifts crossing midnight: end_time < start_time.';

-- ---------------------------------------------------------------------------
-- shift_assignments
-- Links a specific staff member to a shift on a specific calendar date.
-- Tracks clock-in/out for actual vs. scheduled hours.
-- ---------------------------------------------------------------------------
CREATE TABLE shift_assignments (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shift_id        UUID    NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  work_date       DATE    NOT NULL,
  is_on_shift     BOOLEAN NOT NULL DEFAULT FALSE,          -- true once clocked in
  clocked_in_at   TIMESTAMPTZ,
  clocked_out_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, shift_id, work_date)
);

COMMENT ON TABLE shift_assignments IS 'Staff scheduled to a specific shift on a specific date. Records actual clock-in/out times.';
COMMENT ON COLUMN shift_assignments.is_on_shift IS 'Set to TRUE when staff clocks in. Enables real-time "who is working now" queries.';

-- ---------------------------------------------------------------------------
-- Deferred FK: room_assignments.shift_id now has its target table
-- ---------------------------------------------------------------------------
ALTER TABLE room_assignments
  ADD CONSTRAINT fk_room_assignments_shift
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;

-- =============================================================================
-- Migration 004: Rooms, Room Status & Assignment
-- Room type catalog, physical rooms, live status board, and history log
-- =============================================================================

-- ---------------------------------------------------------------------------
-- room_types
-- Defines the cleaning time standards and physical attributes for each
-- category of room. Used by AI assignment engine for time estimates.
-- ---------------------------------------------------------------------------
CREATE TABLE room_types (
  id                   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                 TEXT    NOT NULL,                   -- e.g. "King Suite"
  code                 TEXT    NOT NULL,                   -- e.g. "KS"
  base_clean_minutes   INT     NOT NULL DEFAULT 30,        -- checkout clean time in minutes
  stayover_minutes     INT     NOT NULL DEFAULT 20,        -- stayover refresh time in minutes
  sqft                 INT,
  max_occupancy        INT     NOT NULL DEFAULT 2,
  amenities            JSONB   DEFAULT '[]',               -- array of amenity strings
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

COMMENT ON TABLE room_types IS 'Room type catalog. Cleaning time standards used by AI scheduling engine.';
COMMENT ON COLUMN room_types.base_clean_minutes IS 'Expected minutes to clean a checked-out room of this type.';
COMMENT ON COLUMN room_types.stayover_minutes IS 'Expected minutes for a stayover refresh of this room type.';
COMMENT ON COLUMN room_types.amenities IS 'JSON array of amenity strings, e.g. ["Jacuzzi","Kitchenette"].';

-- ---------------------------------------------------------------------------
-- rooms
-- The physical inventory of guest rooms for a property.
-- ---------------------------------------------------------------------------
CREATE TABLE rooms (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  room_number    TEXT    NOT NULL,
  floor          INT     NOT NULL,
  room_type_id   UUID    NOT NULL REFERENCES room_types(id),
  building       TEXT,                                     -- for multi-building properties
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  notes          TEXT,
  opera_room_id  TEXT,                                     -- Opera PMS room identifier for sync
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, room_number)
);

COMMENT ON TABLE rooms IS 'Physical room inventory for a hotel property.';
COMMENT ON COLUMN rooms.opera_room_id IS 'Corresponding room identifier in Opera PMS for two-way sync.';
COMMENT ON COLUMN rooms.building IS 'Building name/letter for multi-building hotel properties.';

-- ---------------------------------------------------------------------------
-- room_status
-- Live housekeeping status board. One row per room; updated in real-time
-- via Opera webhooks, staff app actions, and AI predictions.
-- ---------------------------------------------------------------------------
CREATE TABLE room_status (
  room_id               UUID        PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status                TEXT        NOT NULL DEFAULT 'DIRTY' CHECK (status IN (
                          'DIRTY',        -- needs cleaning
                          'IN_PROGRESS',  -- housekeeper currently cleaning
                          'CLEAN',        -- cleaned, awaiting inspection
                          'INSPECTED',    -- passed inspection, ready for guest
                          'OOO',          -- out of order (maintenance)
                          'PICKUP'        -- quick pickup requested
                        )),
  assigned_to           UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  room_type_category    TEXT,        -- "Checkout", "Stayover", "VIP", "Early Checkin"
  guest_name            TEXT,
  vip_flag              BOOLEAN     NOT NULL DEFAULT FALSE,
  checkin_time          TIMESTAMPTZ,
  checkout_time         TIMESTAMPTZ,
  dnd_flag              BOOLEAN     NOT NULL DEFAULT FALSE,   -- Do Not Disturb
  do_not_service        BOOLEAN     NOT NULL DEFAULT FALSE,   -- Guest declined housekeeping
  priority              INT         NOT NULL DEFAULT 5,       -- 1 (highest) to 10 (lowest)
  risk_level            TEXT        CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  predicted_ready_at    TIMESTAMPTZ,                         -- AI ETA for room ready
  last_cleaned_at       TIMESTAMPTZ,
  last_inspected_at     TIMESTAMPTZ,
  last_inspected_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  notes                 TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE room_status IS 'Live room status board. One row per room. Updated via webhooks, app, and AI.';
COMMENT ON COLUMN room_status.priority IS '1 = highest priority (e.g. VIP early check-in), 10 = lowest. Drives AI sort order.';
COMMENT ON COLUMN room_status.risk_level IS 'AI-computed risk that room will not be ready before guest check-in.';
COMMENT ON COLUMN room_status.predicted_ready_at IS 'AI-predicted timestamp when room will be inspected and ready.';
COMMENT ON COLUMN room_status.do_not_service IS 'Guest has explicitly declined housekeeping service for this stay.';

-- ---------------------------------------------------------------------------
-- room_status_history
-- Append-only audit log of every status transition. Source of truth for
-- operational analytics and AI model training.
-- ---------------------------------------------------------------------------
CREATE TABLE room_status_history (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_status   TEXT,                                       -- NULL for initial status set
  to_status     TEXT        NOT NULL,
  changed_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  change_source TEXT        NOT NULL DEFAULT 'app' CHECK (change_source IN (
                  'app',            -- staff mobile/web app
                  'opera_webhook',  -- inbound Opera PMS webhook
                  'opera_poll',     -- scheduled Opera API poll
                  'system'          -- automated system action
                )),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE room_status_history IS 'Immutable audit log of room status transitions. Used for analytics and AI training.';
COMMENT ON COLUMN room_status_history.change_source IS 'Origin of the status change: app, opera_webhook, opera_poll, or system.';

-- ---------------------------------------------------------------------------
-- room_assignments
-- Tracks which housekeeper is assigned to clean which room on a given date.
-- AI-generated assignments are flagged for performance analysis.
-- ---------------------------------------------------------------------------
CREATE TABLE room_assignments (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  room_id         UUID    NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  assigned_to     UUID    NOT NULL REFERENCES auth.users(id),
  assigned_by     UUID    NOT NULL REFERENCES auth.users(id),
  -- shift_id is UUID without FK here; FK added in migration 005 after shifts table exists
  shift_id        UUID,
  assignment_date DATE    NOT NULL DEFAULT CURRENT_DATE,
  is_ai_suggested BOOLEAN NOT NULL DEFAULT FALSE,           -- true = AI recommended, not manually set
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, assignment_date)                         -- one assignment per room per day
);

COMMENT ON TABLE room_assignments IS 'Daily room-to-housekeeper assignments. AI-suggested flag tracks recommendation acceptance rate.';
COMMENT ON COLUMN room_assignments.is_ai_suggested IS 'True when AI generated the assignment; false when manually assigned by supervisor.';
COMMENT ON COLUMN room_assignments.shift_id IS 'References shifts(id). FK added after migration 005 creates the shifts table.';

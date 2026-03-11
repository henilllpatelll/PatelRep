-- =============================================================================
-- Migration 011: Guest Requests, Lost & Found, Opera Reservations
-- Guest-facing request tracking, item management, and PMS reservation sync
-- =============================================================================

-- ---------------------------------------------------------------------------
-- guest_requests
-- Tracks service requests originating from guests (via front desk, QR code,
-- or future guest portal). Linked to a task for staff fulfillment.
-- ---------------------------------------------------------------------------
CREATE TABLE guest_requests (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_number    SERIAL,                                -- human-readable sequential number
  title             TEXT        NOT NULL,
  description       TEXT,
  room_id           UUID        REFERENCES rooms(id) ON DELETE SET NULL,
  guest_name        TEXT,
  task_id           UUID        REFERENCES tasks(id) ON DELETE SET NULL,  -- linked fulfillment task
  status            TEXT        NOT NULL DEFAULT 'open' CHECK (status IN (
                      'open',
                      'in_progress',
                      'resolved',
                      'escalated'
                    )),
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  satisfaction_score INT        CHECK (satisfaction_score BETWEEN 1 AND 5),  -- post-resolution survey
  created_by        UUID        NOT NULL REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE guest_requests IS 'Guest service requests. Linked to tasks for staff fulfillment tracking.';
COMMENT ON COLUMN guest_requests.satisfaction_score IS '1–5 satisfaction rating collected after request resolution.';
COMMENT ON COLUMN guest_requests.task_id IS 'Associated fulfillment task created when request is assigned to staff.';

-- ---------------------------------------------------------------------------
-- lost_found_items
-- Lost and found item registry. Items are logged by housekeeping, status
-- tracked through unclaimed → claimed/donated/discarded lifecycle.
-- ---------------------------------------------------------------------------
CREATE TABLE lost_found_items (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_number     SERIAL,
  description     TEXT        NOT NULL,
  room_id         UUID        REFERENCES rooms(id) ON DELETE SET NULL,
  location_found  TEXT,                              -- "Lobby", "Pool area", "Room 305", etc.
  found_by        UUID        NOT NULL REFERENCES auth.users(id),
  found_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  photo_url       TEXT,                              -- Supabase Storage public URL
  status          TEXT        NOT NULL DEFAULT 'unclaimed' CHECK (status IN (
                    'unclaimed',
                    'claimed',
                    'donated',
                    'discarded'
                  )),
  claimed_by_name TEXT,                              -- guest name at time of claim
  claimed_at      TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE lost_found_items IS 'Lost and found item registry. Tracks full lifecycle from discovery to disposition.';
COMMENT ON COLUMN lost_found_items.photo_url IS 'Supabase Storage public URL for item photo, used for guest identification.';

-- ---------------------------------------------------------------------------
-- opera_reservations
-- Snapshot of reservation data synced from Oracle Opera / OHIP.
-- Updated via webhook or scheduled poll. Drives room status priority and
-- AI check-in timeline predictions.
-- ---------------------------------------------------------------------------
CREATE TABLE opera_reservations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opera_reservation_id  TEXT        NOT NULL,              -- Opera's own reservation ID
  room_id               UUID        REFERENCES rooms(id) ON DELETE SET NULL,
  room_number_opera     TEXT,                              -- Opera room number (may differ from our rooms table)
  guest_name            TEXT,
  guest_email           TEXT,
  guest_profile_id      TEXT,                             -- Opera guest profile ID
  vip_code              TEXT,                             -- Opera VIP code (e.g. "VIP1", "VIP3")
  special_requests      TEXT,
  preferences           JSONB       DEFAULT '{}',          -- structured guest preferences
  arrival_date          DATE,
  arrival_time          TIME,
  departure_date        DATE,
  departure_time        TIME,
  status                TEXT,                             -- Opera reservation status string
  adults                INT         DEFAULT 1,
  children              INT         DEFAULT 0,
  rate_code             TEXT,                             -- Opera rate plan code
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- last sync timestamp
  UNIQUE (tenant_id, opera_reservation_id)
);

COMMENT ON TABLE opera_reservations IS 'Opera PMS reservation data synced via OHIP webhooks or scheduled polls.';
COMMENT ON COLUMN opera_reservations.opera_reservation_id IS 'Opera confirmation number. Unique per tenant.';
COMMENT ON COLUMN opera_reservations.vip_code IS 'Opera VIP classification code. Used to set vip_flag on room_status.';
COMMENT ON COLUMN opera_reservations.preferences IS 'Structured guest preferences JSON from Opera guest profile.';

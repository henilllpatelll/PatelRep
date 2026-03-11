-- =============================================================================
-- Migration 013: AI Systems
-- AI interaction audit log, room readiness predictions, housekeeper speed
-- profiles, and push notification queue
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ai_interactions
-- Immutable audit log of every AI call made on behalf of a tenant.
-- Used for usage-based billing (credits), debugging, and model performance
-- analysis. Every Edge Function AI call must insert a row here.
-- ---------------------------------------------------------------------------
CREATE TABLE ai_interactions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           UUID        REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL for system-triggered
  interaction_type  TEXT        NOT NULL CHECK (interaction_type IN (
                      'task_creation',          -- NL → structured task
                      'room_prediction',        -- check-in readiness ETA
                      'sop_query',              -- RAG document search
                      'failure_prediction',     -- asset failure analysis
                      'shift_summary',          -- end-of-shift AI report
                      'gm_insight',             -- GM dashboard AI insight
                      'assignment_suggestion',  -- AI room assignment recommendation
                      'onboarding_assistant'    -- setup wizard AI guidance
                    )),
  model_used        TEXT        NOT NULL,             -- e.g. "gpt-4o", "gpt-4o-mini"
  prompt_tokens     INT,
  completion_tokens INT,
  credits_charged   DECIMAL(5,2) NOT NULL DEFAULT 1,  -- credits deducted from tenant ledger
  latency_ms        INT,                              -- end-to-end latency in milliseconds
  success           BOOLEAN     NOT NULL DEFAULT TRUE,
  error_message     TEXT,                             -- populated on failure
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai_interactions IS 'Immutable AI usage audit log. Every AI Edge Function call must insert a row for billing.';
COMMENT ON COLUMN ai_interactions.credits_charged IS 'Credits deducted from credit_ledger.credits_used for this interaction.';
COMMENT ON COLUMN ai_interactions.interaction_type IS 'AI feature category used for usage analytics and per-feature cost analysis.';

-- ---------------------------------------------------------------------------
-- room_readiness_predictions
-- One row per room with the latest AI-computed check-in readiness ETA.
-- Updated by the room prediction Edge Function triggered on assignment or
-- status changes. Used by front desk and GM dashboard.
-- ---------------------------------------------------------------------------
CREATE TABLE room_readiness_predictions (
  room_id                   UUID        PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  tenant_id                 UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  housekeeper_id            UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  predicted_ready_at        TIMESTAMPTZ,
  confidence_score          DECIMAL(3,2),               -- 0.00–1.00 prediction confidence
  risk_level                TEXT        CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  checkin_time              TIMESTAMPTZ,                -- expected guest arrival time
  minutes_to_checkin        INT,                        -- computed: checkin_time - NOW()
  rooms_remaining_for_hk    INT,                        -- rooms assigned before this one
  avg_speed_rooms_per_hr    DECIMAL(4,2),               -- housekeeper's rolling average speed
  risk_factors              TEXT[],                     -- contributing risk factor strings
  last_calculated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE room_readiness_predictions IS 'Latest AI check-in readiness predictions per room. Upserted on status/assignment changes.';
COMMENT ON COLUMN room_readiness_predictions.confidence_score IS '0.00–1.00 prediction confidence. <0.50 shown with uncertainty indicator in UI.';
COMMENT ON COLUMN room_readiness_predictions.avg_speed_rooms_per_hr IS 'Housekeeper rolling average speed computed from housekeeper_profiles.';

-- ---------------------------------------------------------------------------
-- housekeeper_profiles
-- Per-housekeeper, per-room-type speed profiles. Updated after each room
-- completion using exponential moving average. Drives AI time estimates.
-- ---------------------------------------------------------------------------
CREATE TABLE housekeeper_profiles (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  room_type_id      UUID        NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  avg_clean_minutes DECIMAL(5,2),                        -- exponential moving average
  completion_count  INT         NOT NULL DEFAULT 0,      -- number of rooms completed (for EMA weight)
  last_updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, room_type_id)
);

COMMENT ON TABLE housekeeper_profiles IS 'Per-housekeeper speed profiles by room type. Used by AI prediction engine for ETA calculation.';
COMMENT ON COLUMN housekeeper_profiles.avg_clean_minutes IS 'Exponential moving average cleaning time. Updated after each room completion.';
COMMENT ON COLUMN housekeeper_profiles.completion_count IS 'Total completions used to weight the EMA (more completions = more confident estimate).';

-- ---------------------------------------------------------------------------
-- notifications
-- Push and in-app notification queue. The notification Edge Function reads
-- rows with push_sent = FALSE and sends via Expo Push API, then marks sent.
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type             TEXT        NOT NULL,               -- e.g. "task_assigned", "room_risk_high"
  title            TEXT        NOT NULL,
  body             TEXT        NOT NULL,
  data             JSONB       DEFAULT '{}',            -- arbitrary payload for deep-linking
  is_read          BOOLEAN     NOT NULL DEFAULT FALSE,
  push_sent        BOOLEAN     NOT NULL DEFAULT FALSE,
  push_sent_at     TIMESTAMPTZ,
  expo_push_ticket TEXT,                               -- Expo push receipt ID for delivery confirmation
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE notifications IS 'In-app and push notification queue. Push worker polls for push_sent = FALSE rows.';
COMMENT ON COLUMN notifications.expo_push_ticket IS 'Expo push notification receipt ticket ID. Used for delivery status polling.';
COMMENT ON COLUMN notifications.data IS 'Arbitrary JSON payload included in push notification for app deep-linking.';

-- =============================================================================
-- Migration 008: Assets & Preventive Maintenance
-- Asset registry, PM schedules, failure predictions, and deferred WO FKs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- asset_categories
-- Classifies assets for PM scheduling and failure analysis.
-- Default PM interval drives pm_schedules generation on asset creation.
-- ---------------------------------------------------------------------------
CREATE TABLE asset_categories (
  id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                    TEXT    NOT NULL,               -- e.g. "HVAC", "Plumbing"
  code                    TEXT    NOT NULL,               -- e.g. "HVAC", "PLMB"
  default_pm_interval_days INT,                           -- NULL = no automatic PM
  UNIQUE (tenant_id, code)
);

COMMENT ON TABLE asset_categories IS 'Asset classification for PM scheduling. Default interval used when creating PM schedules.';
COMMENT ON COLUMN asset_categories.default_pm_interval_days IS 'Default PM frequency in days. NULL means no automatic PM schedule.';

-- ---------------------------------------------------------------------------
-- assets
-- Physical assets tracked for maintenance. Includes lifecycle metadata,
-- AI-computed failure risk score, and replacement cost for ROI analysis.
-- ---------------------------------------------------------------------------
CREATE TABLE assets (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                      TEXT        NOT NULL,
  asset_tag                 TEXT,                        -- physical barcode/QR label
  category_id               UUID        NOT NULL REFERENCES asset_categories(id),
  room_id                   UUID        REFERENCES rooms(id) ON DELETE SET NULL,
  location_text             TEXT,                        -- free-text for non-room locations

  -- Manufacturer & model
  manufacturer              TEXT,
  model                     TEXT,
  serial_number             TEXT,

  -- Lifecycle dates
  purchase_date             DATE,
  warranty_expires          DATE,
  installation_date         DATE,
  expected_lifespan_years   INT,
  replacement_cost          DECIMAL(10,2),               -- current replacement cost in USD

  notes                     TEXT,
  is_active                 BOOLEAN     NOT NULL DEFAULT TRUE,

  -- AI failure risk (updated by Edge Function on each work order completion)
  failure_risk_score        INT         DEFAULT 0 CHECK (failure_risk_score BETWEEN 0 AND 100),
  failure_risk_updated_at   TIMESTAMPTZ,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE assets IS 'Hotel asset registry. Tracks lifecycle, maintenance history, and AI failure risk.';
COMMENT ON COLUMN assets.failure_risk_score IS 'AI-computed 0–100 risk score. >70 triggers failure prediction alert.';
COMMENT ON COLUMN assets.asset_tag IS 'Physical barcode or QR code label on the asset for mobile scanning.';

-- ---------------------------------------------------------------------------
-- pm_schedules
-- Preventive maintenance schedules linked to specific assets.
-- Scheduled jobs (pg_cron) check next_due_at and generate work orders.
-- ---------------------------------------------------------------------------
CREATE TABLE pm_schedules (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id            UUID        NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  name                TEXT        NOT NULL,               -- e.g. "Quarterly HVAC Filter Change"
  description         TEXT,
  interval_type       TEXT        NOT NULL CHECK (interval_type IN (
                        'daily',
                        'weekly',
                        'monthly',
                        'quarterly',
                        'annual',
                        'custom'
                      )),
  interval_days       INT,                               -- used when interval_type = 'custom'
  estimated_minutes   INT         NOT NULL DEFAULT 30,
  assigned_to_role    TEXT,                              -- default role to assign generated WOs to
  last_completed_at   TIMESTAMPTZ,
  next_due_at         TIMESTAMPTZ NOT NULL,
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE pm_schedules IS 'Preventive maintenance schedules. pg_cron job checks next_due_at to auto-generate work orders.';
COMMENT ON COLUMN pm_schedules.interval_days IS 'Custom interval in days when interval_type is "custom".';
COMMENT ON COLUMN pm_schedules.assigned_to_role IS 'Role slug for auto-assignment of generated work orders (e.g. "engineer").';

-- ---------------------------------------------------------------------------
-- failure_predictions
-- AI-generated asset failure analysis snapshots. New predictions are
-- inserted; old ones are retained for trend analysis.
-- ---------------------------------------------------------------------------
CREATE TABLE failure_predictions (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id                  UUID        NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  risk_score                INT         NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  predicted_failure_window  TEXT,                       -- e.g. "within 30 days"
  failure_indicators        TEXT[],                     -- array of contributing factors
  estimated_repair_cost     DECIMAL(10,2),
  estimated_replace_cost    DECIMAL(10,2),
  recommendation            TEXT        NOT NULL,       -- "Schedule PM", "Replace asset", etc.
  ai_reasoning              TEXT,                       -- full AI chain-of-thought (for debugging)
  generated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_acknowledged           BOOLEAN     NOT NULL DEFAULT FALSE,
  acknowledged_by           UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at           TIMESTAMPTZ
);

COMMENT ON TABLE failure_predictions IS 'AI asset failure predictions. Multiple predictions per asset retained for trend analysis.';
COMMENT ON COLUMN failure_predictions.ai_reasoning IS 'Full AI reasoning chain stored for auditability and model improvement.';
COMMENT ON COLUMN failure_predictions.predicted_failure_window IS 'Human-readable window estimate, e.g. "within 30 days" or "3–6 months".';

-- ---------------------------------------------------------------------------
-- Deferred FK constraints on work_orders
-- Now that assets and pm_schedules exist we can add the foreign keys that
-- were intentionally omitted in migration 007.
-- ---------------------------------------------------------------------------
ALTER TABLE work_orders
  ADD CONSTRAINT fk_work_orders_asset
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL;

ALTER TABLE work_orders
  ADD CONSTRAINT fk_work_orders_pm_schedule
  FOREIGN KEY (pm_schedule_id) REFERENCES pm_schedules(id) ON DELETE SET NULL;

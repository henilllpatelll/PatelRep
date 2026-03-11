# PatelRep — Database Schema

All tables live in a single Supabase PostgreSQL schema (`public`). Every table has `tenant_id UUID NOT NULL REFERENCES tenants(id)` for RLS-based multi-tenant isolation. Timestamps are `TIMESTAMPTZ` with timezone. UUIDs use `gen_random_uuid()` default.

---

## 1. Tenants & Groups

```sql
-- Hotel properties (one row per property)
CREATE TABLE tenants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,                        -- "Austin Marriott Downtown"
  slug              TEXT UNIQUE NOT NULL,                 -- "austin-marriott-downtown"
  address           TEXT,
  city              TEXT,
  state             TEXT DEFAULT 'TX',
  zip               TEXT,
  phone             TEXT,
  room_count        INT NOT NULL DEFAULT 0,               -- Used for pricing cap calculation
  timezone          TEXT NOT NULL DEFAULT 'America/Chicago',
  logo_url          TEXT,                                 -- Supabase Storage URL
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  trial_ends_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Multi-property billing groups (v1: billing only, not operational)
CREATE TABLE tenant_groups (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  owner_user_id     UUID NOT NULL REFERENCES auth.users(id),
  stripe_customer_id TEXT,
  group_discount_pct DECIMAL(5,2) DEFAULT 0,             -- e.g. 10.00 = 10% discount
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Link properties to a group
CREATE TABLE tenant_group_memberships (
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  group_id          UUID NOT NULL REFERENCES tenant_groups(id),
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, group_id)
);

-- Opera Cloud integration credentials per tenant (encrypted)
CREATE TABLE opera_credentials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL UNIQUE REFERENCES tenants(id),
  access_token      TEXT,                                -- Encrypted at rest (Supabase Vault)
  refresh_token     TEXT,                               -- Encrypted at rest
  token_expires_at  TIMESTAMPTZ,
  ohip_base_url     TEXT,                               -- "https://[tenant].ohip.oracle.com"
  hotel_id_opera    TEXT,                               -- Opera's internal hotel identifier
  is_connected      BOOLEAN NOT NULL DEFAULT FALSE,
  last_sync_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 2. Users & Roles

```sql
-- Extended user profiles (extends Supabase auth.users)
CREATE TABLE user_profiles (
  id                UUID PRIMARY KEY REFERENCES auth.users(id),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  full_name         TEXT NOT NULL,
  preferred_name    TEXT,                               -- "Maria" vs "Maria Garcia"
  phone             TEXT,
  employee_id       TEXT,                               -- Hotel's internal employee ID
  language_pref     TEXT NOT NULL DEFAULT 'en',        -- 'en' or 'es'
  avatar_url        TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  hire_date         DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Departments within a hotel
CREATE TABLE departments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  name              TEXT NOT NULL,                      -- "Housekeeping", "Engineering", "Front Desk"
  code              TEXT NOT NULL,                      -- "HK", "ENG", "FD", "MGMT"
  color             TEXT NOT NULL DEFAULT '#4B5563',    -- Hex color for UI
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

-- Role assignments (user can have different roles at different properties)
CREATE TABLE user_roles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  role              TEXT NOT NULL CHECK (role IN (
                      'gm',                             -- General Manager
                      'housekeeping_supervisor',
                      'chief_engineer',
                      'front_desk',
                      'housekeeper',
                      'engineer'
                    )),
  department_id     UUID REFERENCES departments(id),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tenant_id, role)
);

-- Staff invitations (pending)
CREATE TABLE staff_invitations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  email             TEXT NOT NULL,
  role              TEXT NOT NULL,
  department_id     UUID REFERENCES departments(id),
  invited_by        UUID NOT NULL REFERENCES auth.users(id),
  token             TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::TEXT,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  accepted_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 3. Rooms

```sql
-- Room type templates (King Suite, Standard Double, etc.)
CREATE TABLE room_types (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  name              TEXT NOT NULL,                      -- "King Suite", "Standard Double"
  code              TEXT NOT NULL,                      -- "KS", "SD"
  base_clean_minutes INT NOT NULL DEFAULT 30,           -- Default cleaning time in minutes
  stayover_minutes  INT NOT NULL DEFAULT 20,            -- Stayover (occupied) service time
  sqft              INT,
  max_occupancy     INT NOT NULL DEFAULT 2,
  amenities         JSONB DEFAULT '[]',                 -- ["minibar", "jacuzzi", "balcony"]
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

-- Individual rooms
CREATE TABLE rooms (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  room_number       TEXT NOT NULL,                      -- "412", "1205A"
  floor             INT NOT NULL,
  room_type_id      UUID NOT NULL REFERENCES room_types(id),
  building          TEXT,                               -- For multi-building properties
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  notes             TEXT,                               -- Permanent notes ("corner room, extra noise")
  opera_room_id     TEXT,                               -- Opera Cloud's room identifier
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, room_number)
);

-- Current room status (one row per room, updated in place)
CREATE TABLE room_status (
  room_id           UUID PRIMARY KEY REFERENCES rooms(id),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  status            TEXT NOT NULL DEFAULT 'DIRTY' CHECK (status IN (
                      'DIRTY',       -- Needs cleaning
                      'IN_PROGRESS', -- Being cleaned
                      'CLEAN',       -- Cleaned, awaiting inspection
                      'INSPECTED',   -- Inspected and approved, ready for guest
                      'OOO',         -- Out of Order
                      'PICKUP'       -- Quick tidy (stayover)
                    )),
  assigned_to       UUID REFERENCES auth.users(id),     -- Current housekeeper
  room_type         TEXT,                               -- Checkout / Stayover / VIP / Early Checkin
  guest_name        TEXT,                               -- From Opera Cloud (current/arriving guest)
  vip_flag          BOOLEAN NOT NULL DEFAULT FALSE,
  checkin_time      TIMESTAMPTZ,                        -- Expected arrival time
  checkout_time     TIMESTAMPTZ,                        -- Departure time
  dnd_flag          BOOLEAN NOT NULL DEFAULT FALSE,
  do_not_service    BOOLEAN NOT NULL DEFAULT FALSE,
  priority          INT NOT NULL DEFAULT 5,             -- 1=highest, 10=lowest (AI-calculated)
  risk_level        TEXT CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', NULL)),
  predicted_ready_at TIMESTAMPTZ,                       -- AI prediction
  last_cleaned_at   TIMESTAMPTZ,
  last_inspected_at TIMESTAMPTZ,
  last_inspected_by UUID REFERENCES auth.users(id),
  notes             TEXT,                               -- Shift-specific notes
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Full status change audit trail
CREATE TABLE room_status_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id           UUID NOT NULL REFERENCES rooms(id),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  from_status       TEXT,
  to_status         TEXT NOT NULL,
  changed_by        UUID REFERENCES auth.users(id),     -- NULL = system/Opera sync
  change_source     TEXT NOT NULL DEFAULT 'app'         -- 'app', 'opera_webhook', 'opera_poll', 'system'
                    CHECK (change_source IN ('app', 'opera_webhook', 'opera_poll', 'system')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Daily room assignments (housekeeper → room → date)
CREATE TABLE room_assignments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  room_id           UUID NOT NULL REFERENCES rooms(id),
  assigned_to       UUID NOT NULL REFERENCES auth.users(id),
  assigned_by       UUID NOT NULL REFERENCES auth.users(id),   -- Supervisor who approved
  shift_id          UUID REFERENCES shifts(id),
  assignment_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  is_ai_suggested   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, assignment_date)
);
```

---

## 4. Scheduling

```sql
-- Shift definitions (Morning 7am-3pm, Evening 3pm-11pm, etc.)
CREATE TABLE shifts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  name              TEXT NOT NULL,                      -- "Morning", "Evening", "Night"
  department_id     UUID NOT NULL REFERENCES departments(id),
  start_time        TIME NOT NULL,                      -- 07:00:00
  end_time          TIME NOT NULL,                      -- 15:00:00
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Staff scheduled to work on specific dates
CREATE TABLE shift_assignments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  user_id           UUID NOT NULL REFERENCES auth.users(id),
  shift_id          UUID NOT NULL REFERENCES shifts(id),
  work_date         DATE NOT NULL,
  is_on_shift       BOOLEAN NOT NULL DEFAULT FALSE,     -- Staff clocks in/out
  clocked_in_at     TIMESTAMPTZ,
  clocked_out_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, shift_id, work_date)
);
```

---

## 5. Tasks

```sql
-- All operational tasks (housekeeping tasks, guest requests, internal)
CREATE TABLE tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  task_number       SERIAL,                             -- Human-readable: T-1042
  title             TEXT NOT NULL,
  description       TEXT,
  original_nl_input TEXT,                               -- Raw natural language that created this task
  task_type         TEXT NOT NULL CHECK (task_type IN (
                      'housekeeping',
                      'engineering',
                      'guest_request',
                      'lost_found',
                      'general'
                    )),
  priority          TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'normal', 'low')),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                      'open',
                      'in_progress',
                      'completed',
                      'cancelled',
                      'escalated'
                    )),
  room_id           UUID REFERENCES rooms(id),
  location_text     TEXT,                               -- Free text location if not a room
  department_id     UUID REFERENCES departments(id),
  assigned_to       UUID REFERENCES auth.users(id),
  assigned_by       UUID REFERENCES auth.users(id),
  created_by        UUID NOT NULL REFERENCES auth.users(id),
  is_ai_created     BOOLEAN NOT NULL DEFAULT FALSE,
  is_ai_assigned    BOOLEAN NOT NULL DEFAULT FALSE,
  sla_minutes       INT NOT NULL DEFAULT 240,           -- 60=urgent, 240=normal, 480=low
  due_at            TIMESTAMPTZ,                        -- Calculated from created_at + sla_minutes (or check-in time for housekeeping)
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  escalated_at      TIMESTAMPTZ,
  escalation_reason TEXT,
  ai_confidence     DECIMAL(3,2),                       -- 0.00-1.00, from task parsing model
  tags              TEXT[] DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Task activity log
CREATE TABLE task_comments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  user_id           UUID NOT NULL REFERENCES auth.users(id),
  comment           TEXT NOT NULL,
  is_system         BOOLEAN NOT NULL DEFAULT FALSE,     -- System-generated comment (status change, escalation)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 6. Work Orders (Engineering)

```sql
-- Engineering work orders
CREATE TABLE work_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  work_order_number SERIAL,                             -- Human-readable: WO-5021
  title             TEXT NOT NULL,
  description       TEXT,
  original_nl_input TEXT,
  category          TEXT NOT NULL CHECK (category IN (
                      'plumbing', 'electrical', 'hvac', 'furniture',
                      'appliance', 'structural', 'safety', 'general'
                    )),
  priority          TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'normal', 'low')),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                      'open', 'in_progress', 'on_hold', 'completed', 'cancelled'
                    )),
  room_id           UUID REFERENCES rooms(id),
  location_text     TEXT,
  asset_id          UUID REFERENCES assets(id),         -- Link to specific asset if applicable
  assigned_to       UUID REFERENCES auth.users(id),
  created_by        UUID NOT NULL REFERENCES auth.users(id),
  is_ai_created     BOOLEAN NOT NULL DEFAULT FALSE,
  is_pm_generated   BOOLEAN NOT NULL DEFAULT FALSE,     -- TRUE if auto-generated from PM schedule
  pm_schedule_id    UUID REFERENCES pm_schedules(id),
  sla_minutes       INT NOT NULL DEFAULT 240,
  due_at            TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  parts_used        TEXT,                               -- Free text for MVP (no parts inventory)
  labor_hours       DECIMAL(4,2),                       -- Hours spent
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Photos attached to work orders
CREATE TABLE work_order_photos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id     UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  uploaded_by       UUID NOT NULL REFERENCES auth.users(id),
  storage_path      TEXT NOT NULL,                      -- Supabase Storage path
  photo_type        TEXT NOT NULL DEFAULT 'progress' CHECK (photo_type IN ('before', 'after', 'progress')),
  caption           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Work order activity log
CREATE TABLE work_order_comments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id     UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  user_id           UUID NOT NULL REFERENCES auth.users(id),
  comment           TEXT NOT NULL,
  is_system         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 7. Assets & Preventive Maintenance

```sql
-- Asset categories
CREATE TABLE asset_categories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  name              TEXT NOT NULL,                      -- "HVAC Unit", "Ice Machine", "Elevator"
  code              TEXT NOT NULL,                      -- "HVAC", "ICE", "ELEV"
  default_pm_interval_days INT,                         -- Default PM frequency
  UNIQUE (tenant_id, code)
);

-- Individual assets (equipment)
CREATE TABLE assets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  name              TEXT NOT NULL,                      -- "HVAC Unit - Room 412"
  asset_tag         TEXT,                               -- Hotel's internal asset number
  category_id       UUID NOT NULL REFERENCES asset_categories(id),
  room_id           UUID REFERENCES rooms(id),          -- NULL for non-room assets (pool pump)
  location_text     TEXT,                               -- "Pool Equipment Room", "Roof Level 5"
  manufacturer      TEXT,
  model             TEXT,
  serial_number     TEXT,
  purchase_date     DATE,
  warranty_expires  DATE,
  installation_date DATE,
  expected_lifespan_years INT,
  replacement_cost  DECIMAL(10,2),
  notes             TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  failure_risk_score INT DEFAULT 0 CHECK (failure_risk_score BETWEEN 0 AND 100),
  failure_risk_updated_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Preventive maintenance schedule definitions
CREATE TABLE pm_schedules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  asset_id          UUID NOT NULL REFERENCES assets(id),
  name              TEXT NOT NULL,                      -- "Monthly HVAC Filter Change"
  description       TEXT,
  interval_type     TEXT NOT NULL CHECK (interval_type IN ('daily', 'weekly', 'monthly', 'quarterly', 'annual', 'custom')),
  interval_days     INT,                                -- For 'custom' type
  estimated_minutes INT NOT NULL DEFAULT 30,
  assigned_to_role  TEXT,                               -- Default assignee role
  last_completed_at TIMESTAMPTZ,
  next_due_at       TIMESTAMPTZ NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AI failure predictions per asset
CREATE TABLE failure_predictions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  asset_id          UUID NOT NULL REFERENCES assets(id),
  risk_score        INT NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  predicted_failure_window TEXT,                        -- "next 30 days", "next 90 days"
  failure_indicators TEXT[],                            -- ["3 failures in 60 days", "PM overdue 45 days"]
  estimated_repair_cost DECIMAL(10,2),
  estimated_replace_cost DECIMAL(10,2),
  recommendation    TEXT NOT NULL,                      -- "Schedule replacement before peak season"
  ai_reasoning      TEXT,                               -- Claude's reasoning (for transparency)
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_acknowledged   BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_by   UUID REFERENCES auth.users(id),
  acknowledged_at   TIMESTAMPTZ
);
```

---

## 8. Inspections

```sql
-- Inspection checklist templates per hotel (customizable)
CREATE TABLE inspection_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  name              TEXT NOT NULL DEFAULT 'Standard Room Inspection',
  room_type_id      UUID REFERENCES room_types(id),     -- NULL = applies to all room types
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Checklist items within a template
CREATE TABLE inspection_template_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id       UUID NOT NULL REFERENCES inspection_templates(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  section           TEXT NOT NULL,                      -- "Bathroom", "Sleeping Area", "General"
  description       TEXT NOT NULL,                      -- "Toilet clean and flushing properly"
  is_required       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order        INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Completed inspections
CREATE TABLE inspections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  room_id           UUID NOT NULL REFERENCES rooms(id),
  template_id       UUID NOT NULL REFERENCES inspection_templates(id),
  inspected_by      UUID NOT NULL REFERENCES auth.users(id),
  overall_result    TEXT NOT NULL CHECK (overall_result IN ('passed', 'failed', 'conditional')),
  notes             TEXT,
  completed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-item results for an inspection
CREATE TABLE inspection_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id     UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  template_item_id  UUID NOT NULL REFERENCES inspection_template_items(id),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  result            TEXT NOT NULL CHECK (result IN ('pass', 'fail', 'na')),
  note              TEXT,
  photo_url         TEXT
);
```

---

## 9. SOP Library (RAG)

```sql
-- Uploaded SOP documents
CREATE TABLE sop_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  title             TEXT NOT NULL,
  description       TEXT,
  category          TEXT,                               -- "Housekeeping", "Guest Services", "Safety"
  storage_path      TEXT NOT NULL,                      -- Supabase Storage path (PDF)
  file_size_bytes   INT,
  page_count        INT,
  indexing_status   TEXT NOT NULL DEFAULT 'pending' CHECK (indexing_status IN (
                      'pending', 'processing', 'indexed', 'failed'
                    )),
  chunk_count       INT DEFAULT 0,
  indexed_at        TIMESTAMPTZ,
  uploaded_by       UUID NOT NULL REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Text chunks from SOP documents with vector embeddings
CREATE TABLE sop_chunks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       UUID NOT NULL REFERENCES sop_documents(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  chunk_index       INT NOT NULL,
  content           TEXT NOT NULL,
  token_count       INT,
  page_number       INT,
  embedding         VECTOR(1536),                       -- OpenAI text-embedding-3-small
  metadata          JSONB DEFAULT '{}',                 -- {"section": "VIP Protocol", "page": 12}
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast similarity search
CREATE INDEX sop_chunks_embedding_idx ON sop_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Index for tenant-scoped queries
CREATE INDEX sop_chunks_tenant_idx ON sop_chunks (tenant_id);
```

---

## 10. Guest Requests & Front Desk

```sql
-- Guest service requests
CREATE TABLE guest_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  request_number    SERIAL,                             -- GR-1042
  title             TEXT NOT NULL,
  description       TEXT,
  room_id           UUID REFERENCES rooms(id),
  guest_name        TEXT,                               -- From Opera or manually entered
  task_id           UUID REFERENCES tasks(id),          -- Linked task (auto-created on request)
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                      'open', 'in_progress', 'resolved', 'escalated'
                    )),
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID REFERENCES auth.users(id),
  satisfaction_score INT CHECK (satisfaction_score BETWEEN 1 AND 5),
  created_by        UUID NOT NULL REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lost & found items
CREATE TABLE lost_found_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  item_number       SERIAL,                             -- LF-0201
  description       TEXT NOT NULL,
  room_id           UUID REFERENCES rooms(id),
  location_found    TEXT,
  found_by          UUID NOT NULL REFERENCES auth.users(id),
  found_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  photo_url         TEXT,                               -- Supabase Storage
  status            TEXT NOT NULL DEFAULT 'unclaimed' CHECK (status IN (
                      'unclaimed', 'claimed', 'donated', 'discarded'
                    )),
  claimed_by_name   TEXT,
  claimed_at        TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Opera Cloud reservation cache (synced from PMS)
CREATE TABLE opera_reservations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  opera_reservation_id TEXT NOT NULL,
  room_id           UUID REFERENCES rooms(id),
  room_number_opera TEXT,
  guest_name        TEXT,
  guest_email       TEXT,
  guest_profile_id  TEXT,                               -- Opera guest profile ID
  vip_code          TEXT,                               -- e.g. "VIP1", "VIP2"
  special_requests  TEXT,
  preferences       JSONB DEFAULT '{}',
  arrival_date      DATE,
  arrival_time      TIME,
  departure_date    DATE,
  departure_time    TIME,
  status            TEXT,                               -- "RESERVED", "CHECKED_IN", "CHECKED_OUT"
  adults            INT DEFAULT 1,
  children          INT DEFAULT 0,
  rate_code         TEXT,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, opera_reservation_id)
);
```

---

## 11. Logbook

```sql
-- Manual shift notes by department
CREATE TABLE logbook_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  department_id     UUID NOT NULL REFERENCES departments(id),
  shift_id          UUID REFERENCES shifts(id),
  entry_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  content           TEXT NOT NULL,
  is_ai_generated   BOOLEAN NOT NULL DEFAULT FALSE,
  author_id         UUID REFERENCES auth.users(id),     -- NULL if AI-generated
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AI-generated shift summaries
CREATE TABLE shift_summaries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  shift_id          UUID NOT NULL REFERENCES shifts(id),
  shift_date        DATE NOT NULL,
  department_id     UUID NOT NULL REFERENCES departments(id),
  summary_text      TEXT NOT NULL,                      -- AI-generated narrative
  stats             JSONB NOT NULL DEFAULT '{}',        -- {"rooms_cleaned": 45, "sla_compliance": 0.94}
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 12. AI & Notifications

```sql
-- Log of all AI interactions (for credit metering and debugging)
CREATE TABLE ai_interactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  user_id           UUID REFERENCES auth.users(id),
  interaction_type  TEXT NOT NULL CHECK (interaction_type IN (
                      'task_creation',
                      'room_prediction',
                      'sop_query',
                      'failure_prediction',
                      'shift_summary',
                      'gm_insight',
                      'assignment_suggestion',
                      'onboarding_assistant'
                    )),
  model_used        TEXT NOT NULL,                      -- "gpt-4o-mini", "claude-3-5-sonnet"
  prompt_tokens     INT,
  completion_tokens INT,
  credits_charged   DECIMAL(5,2) NOT NULL DEFAULT 1,
  latency_ms        INT,
  success           BOOLEAN NOT NULL DEFAULT TRUE,
  error_message     TEXT,
  request_payload   JSONB,                              -- Stored for debugging (stripped of PII)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Room readiness predictions (current state)
CREATE TABLE room_readiness_predictions (
  room_id               UUID PRIMARY KEY REFERENCES rooms(id),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  housekeeper_id        UUID REFERENCES auth.users(id),
  predicted_ready_at    TIMESTAMPTZ,
  confidence_score      DECIMAL(3,2),
  risk_level            TEXT CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  checkin_time          TIMESTAMPTZ,
  minutes_to_checkin    INT,                            -- Computed: checkin - now
  rooms_remaining_for_hk INT,                           -- Housekeeper's remaining workload
  avg_speed_rooms_per_hr DECIMAL(4,2),
  risk_factors          TEXT[],                         -- ["late_checkout", "vip_room", "overloaded_hk"]
  last_calculated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Housekeeper speed profiles (updated after each room completion)
CREATE TABLE housekeeper_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  room_type_id      UUID NOT NULL REFERENCES room_types(id),
  avg_clean_minutes DECIMAL(5,2),                       -- Rolling average
  completion_count  INT NOT NULL DEFAULT 0,
  last_updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, room_type_id)
);

-- Push notifications
CREATE TABLE notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  user_id           UUID NOT NULL REFERENCES auth.users(id),
  type              TEXT NOT NULL,                      -- "task_assigned", "sla_warning", "sla_breach", "risk_alert"
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  data              JSONB DEFAULT '{}',                 -- Deep link data
  is_read           BOOLEAN NOT NULL DEFAULT FALSE,
  push_sent         BOOLEAN NOT NULL DEFAULT FALSE,
  push_sent_at      TIMESTAMPTZ,
  expo_push_ticket  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 13. Billing

```sql
-- Stripe subscription data per tenant
CREATE TABLE subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL UNIQUE REFERENCES tenants(id),
  stripe_customer_id    TEXT NOT NULL UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  plan_status           TEXT NOT NULL DEFAULT 'trialing' CHECK (plan_status IN (
                          'trialing', 'active', 'past_due', 'cancelled', 'paused'
                        )),
  trial_end             TIMESTAMPTZ,
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  base_fee_cents        INT NOT NULL DEFAULT 9900,      -- $99.00
  credits_included      INT NOT NULL DEFAULT 5000,
  room_count_at_billing INT,
  cap_cents             INT,                            -- room_count × 250 cents
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Monthly credit tracking ledger (one row per tenant per billing period)
CREATE TABLE credit_ledger (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  credits_included  INT NOT NULL DEFAULT 5000,
  credits_used      INT NOT NULL DEFAULT 0,
  credits_purchased INT NOT NULL DEFAULT 0,
  overage_credits   INT GENERATED ALWAYS AS
                      (GREATEST(0, credits_used - credits_included - credits_purchased)) STORED,
  overage_cost_cents INT GENERATED ALWAYS AS
                      (GREATEST(0, credits_used - credits_included - credits_purchased) * 2) STORED,
  stripe_invoice_id TEXT,
  is_finalized      BOOLEAN NOT NULL DEFAULT FALSE,
  finalized_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, period_start)
);
```

---

## 14. Key Indexes

```sql
-- Performance indexes
CREATE INDEX tasks_tenant_status_idx ON tasks (tenant_id, status);
CREATE INDEX tasks_assigned_to_idx ON tasks (assigned_to, status);
CREATE INDEX tasks_room_id_idx ON tasks (room_id);
CREATE INDEX work_orders_tenant_status_idx ON work_orders (tenant_id, status);
CREATE INDEX work_orders_asset_id_idx ON work_orders (asset_id);
CREATE INDEX room_status_tenant_idx ON room_status (tenant_id, status);
CREATE INDEX room_status_assigned_idx ON room_status (assigned_to);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX ai_interactions_tenant_period_idx ON ai_interactions (tenant_id, created_at);
CREATE INDEX opera_reservations_arrival_idx ON opera_reservations (tenant_id, arrival_date);
CREATE INDEX shift_assignments_date_idx ON shift_assignments (tenant_id, work_date);
```

---

## 15. RLS Policies (Representative Examples)

```sql
-- Enable RLS on all tables
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
-- (repeat for all tables)

-- Universal tenant isolation policy (applied to all tables)
-- Staff sees only their hotel's data
CREATE POLICY "tenant_isolation" ON rooms
  FOR ALL USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
  );

-- Housekeeper sees only assigned rooms
CREATE POLICY "housekeeper_own_rooms" ON room_status
  FOR SELECT USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (
      (auth.jwt() ->> 'role') != 'housekeeper'
      OR assigned_to = auth.uid()
    )
  );

-- Group billing: group owner sees all their properties
CREATE POLICY "group_owner_all_properties" ON rooms
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_group_memberships
      WHERE group_id IN (
        SELECT id FROM tenant_groups WHERE owner_user_id = auth.uid()
      )
    )
  );
```

-- =============================================================================
-- Migration 009: Room Inspections
-- Configurable inspection checklists, inspection records, and per-item results
-- =============================================================================

-- ---------------------------------------------------------------------------
-- inspection_templates
-- Reusable checklist templates. One "default" template per tenant covers
-- all room types; specific templates can be created for suites, etc.
-- ---------------------------------------------------------------------------
CREATE TABLE inspection_templates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL DEFAULT 'Standard Room Inspection',
  room_type_id  UUID        REFERENCES room_types(id) ON DELETE SET NULL,   -- NULL = applies to all types
  is_default    BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE inspection_templates IS 'Reusable room inspection checklists. One default per tenant; room-type-specific overrides supported.';
COMMENT ON COLUMN inspection_templates.room_type_id IS 'NULL means this template applies to all room types. Specific templates override the default.';
COMMENT ON COLUMN inspection_templates.is_default IS 'Exactly one template per tenant should have is_default = TRUE.';

-- ---------------------------------------------------------------------------
-- inspection_template_items
-- Individual checklist line items within a template, grouped by section.
-- ---------------------------------------------------------------------------
CREATE TABLE inspection_template_items (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID        NOT NULL REFERENCES inspection_templates(id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  section     TEXT        NOT NULL,               -- e.g. "Bathroom", "Sleeping Area", "General"
  description TEXT        NOT NULL,               -- e.g. "Toilet cleaned and sanitized"
  is_required BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order  INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE inspection_template_items IS 'Individual checklist items within an inspection template, ordered by section and sort_order.';
COMMENT ON COLUMN inspection_template_items.section IS 'Section grouping within template, e.g. "Bathroom", "Sleeping Area", "General".';
COMMENT ON COLUMN inspection_template_items.sort_order IS 'Display order within a section. Lower numbers appear first.';

-- ---------------------------------------------------------------------------
-- inspections
-- A completed inspection of a single room by a supervisor. Triggers
-- room_status update via the on_inspection_complete trigger (migration 017).
-- ---------------------------------------------------------------------------
CREATE TABLE inspections (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  room_id         UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  template_id     UUID        NOT NULL REFERENCES inspection_templates(id),
  inspected_by    UUID        NOT NULL REFERENCES auth.users(id),
  overall_result  TEXT        NOT NULL CHECK (overall_result IN (
                    'passed',       -- room status → INSPECTED
                    'failed',       -- room status → DIRTY
                    'conditional'   -- passed with minor issues noted
                  )),
  notes           TEXT,
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE inspections IS 'Completed room inspections. INSERT triggers room_status update via handle_inspection_complete().';
COMMENT ON COLUMN inspections.overall_result IS 'passed → room INSPECTED, failed → room DIRTY, conditional → room INSPECTED with notes.';

-- ---------------------------------------------------------------------------
-- inspection_results
-- Per-item results for each inspection. One row per template item per inspection.
-- ---------------------------------------------------------------------------
CREATE TABLE inspection_results (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id    UUID    NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  template_item_id UUID    NOT NULL REFERENCES inspection_template_items(id),
  tenant_id        UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  result           TEXT    NOT NULL CHECK (result IN (
                     'pass',
                     'fail',
                     'na'           -- not applicable (e.g. no bathtub in room)
                   )),
  note             TEXT,
  photo_url        TEXT            -- Supabase Storage public URL for photo evidence
);

COMMENT ON TABLE inspection_results IS 'Per-item pass/fail/NA results for each inspection. Cascade-deleted with parent inspection.';
COMMENT ON COLUMN inspection_results.photo_url IS 'Supabase Storage public URL for photo evidence of a failed item.';

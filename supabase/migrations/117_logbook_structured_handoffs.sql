-- =============================================================================
-- Migration 117: Structured Logbook handoffs
-- Adds operational handoff structure without breaking legacy mobile creation.
-- =============================================================================

ALTER TABLE public.logbook_entries
  ADD COLUMN category TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN status TEXT NOT NULL DEFAULT 'informational',
  ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN follow_up_at TIMESTAMPTZ NULL,
  ADD COLUMN assigned_to UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN related_type TEXT NULL,
  ADD COLUMN related_id UUID NULL,
  ADD COLUMN resolved_at TIMESTAMPTZ NULL,
  ADD COLUMN resolved_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN edited_at TIMESTAMPTZ NULL,
  ADD COLUMN archived_at TIMESTAMPTZ NULL,
  ADD CONSTRAINT logbook_entries_category_check CHECK (category IN ('guest', 'room', 'maintenance', 'safety', 'general')),
  ADD CONSTRAINT logbook_entries_status_check CHECK (status IN ('informational', 'follow_up', 'resolved')),
  ADD CONSTRAINT logbook_entries_priority_check CHECK (priority IN ('normal', 'important')),
  ADD CONSTRAINT logbook_entries_related_item_check CHECK (
    (related_type IS NULL AND related_id IS NULL)
    OR (related_type IN ('room', 'task', 'work_order', 'guest_request') AND related_id IS NOT NULL)
  ),
  ADD CONSTRAINT logbook_entries_follow_up_data_check CHECK (
    status = 'follow_up' OR (follow_up_at IS NULL AND assigned_to IS NULL)
  );

CREATE INDEX idx_logbook_entries_tenant_shift_date
  ON public.logbook_entries (tenant_id, shift_id, entry_date DESC);
CREATE INDEX idx_logbook_entries_tenant_status_date
  ON public.logbook_entries (tenant_id, status, entry_date DESC);
CREATE INDEX idx_logbook_entries_tenant_department_date
  ON public.logbook_entries (tenant_id, department_id, entry_date DESC);
CREATE INDEX idx_logbook_entries_tenant_assignee_status
  ON public.logbook_entries (tenant_id, assigned_to, status)
  WHERE assigned_to IS NOT NULL;

COMMENT ON COLUMN public.logbook_entries.category IS 'Controlled handoff category; legacy entries default to general.';
COMMENT ON COLUMN public.logbook_entries.status IS 'informational, follow_up, or resolved.';
COMMENT ON COLUMN public.logbook_entries.priority IS 'Binary scanability marker: normal or important.';
COMMENT ON COLUMN public.logbook_entries.related_id IS 'Polymorphic related record; tenant/type validation is enforced in the API.';

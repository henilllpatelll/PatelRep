-- Phase 7: operational clarification around individual Logbook handoffs.
ALTER TABLE public.logbook_entries
  ADD COLUMN requires_acknowledgment BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN acknowledgment_version INTEGER NOT NULL DEFAULT 1
    CHECK (acknowledgment_version >= 1);

ALTER TABLE public.logbook_entry_events
  DROP CONSTRAINT IF EXISTS logbook_entry_events_event_type_check;
ALTER TABLE public.logbook_entry_events
  ADD CONSTRAINT logbook_entry_events_event_type_check CHECK (event_type IN (
    'created', 'edited', 'carried_forward', 'resolved', 'archived', 'reopened',
    'comment_added', 'acknowledgment_requested', 'acknowledgment_reset'
  ));

CREATE TABLE public.logbook_entry_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES public.logbook_entries(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  content TEXT NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at TIMESTAMPTZ NULL,
  deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE public.logbook_comment_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES public.logbook_entry_comments(id) ON DELETE CASCADE,
  mentioned_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (comment_id, mentioned_user_id)
);

CREATE TABLE public.logbook_entry_reads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES public.logbook_entries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entry_id, user_id)
);

CREATE TABLE public.logbook_entry_ack_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES public.logbook_entries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entry_id, user_id, version)
);

CREATE TABLE public.logbook_entry_acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES public.logbook_entries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entry_id, user_id, version)
);

CREATE INDEX idx_logbook_comments_entry_created ON public.logbook_entry_comments(entry_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_logbook_reads_tenant_entry ON public.logbook_entry_reads(tenant_id, entry_id);
CREATE INDEX idx_logbook_ack_targets_current ON public.logbook_entry_ack_targets(entry_id, version);
CREATE INDEX idx_logbook_acknowledgments_current ON public.logbook_entry_acknowledgments(entry_id, version);

ALTER TABLE public.logbook_entry_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_comment_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_entry_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_entry_ack_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_entry_acknowledgments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON public.logbook_entry_comments FOR ALL USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_isolation" ON public.logbook_comment_mentions FOR ALL USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_isolation" ON public.logbook_entry_reads FOR ALL USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_isolation" ON public.logbook_entry_ack_targets FOR ALL USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_isolation" ON public.logbook_entry_acknowledgments FOR ALL USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

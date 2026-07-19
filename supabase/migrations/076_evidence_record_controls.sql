-- Phase 2: make evidence links private, tenant-safe, and auditable.
-- Evidence file objects remain in the private evidence-files bucket; API clients receive
-- only a short-lived signed URL after the evidence row has been authorized.

ALTER TABLE public.evidence_records
  ADD CONSTRAINT evidence_records_related_entity_pair
    CHECK (
      (related_entity_type IS NULL AND related_entity_id IS NULL)
      OR (related_entity_type IS NOT NULL AND related_entity_id IS NOT NULL)
    ),
  ADD CONSTRAINT evidence_records_private_path_is_tenant_prefixed
    CHECK (storage_path IS NULL OR storage_path LIKE tenant_id::text || '/%');

CREATE OR REPLACE FUNCTION public.enforce_evidence_record_tenant_links()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.controlled_documents
    WHERE id = NEW.document_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Evidence document must belong to the evidence tenant' USING ERRCODE = '23503';
  END IF;

  IF NEW.assignment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.document_acknowledgements
    WHERE id = NEW.assignment_id
      AND tenant_id = NEW.tenant_id
      AND (NEW.document_id IS NULL OR document_id = NEW.document_id)
  ) THEN
    RAISE EXCEPTION 'Evidence assignment must belong to the evidence tenant and document' USING ERRCODE = '23503';
  END IF;

  IF NEW.related_entity_type = 'staff' AND NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = NEW.related_entity_id AND tenant_id = NEW.tenant_id AND is_active = TRUE
  ) THEN RAISE EXCEPTION 'Evidence staff link must belong to the evidence tenant' USING ERRCODE = '23503'; END IF;
  IF NEW.related_entity_type = 'task' AND NOT EXISTS (
    SELECT 1 FROM public.tasks WHERE id = NEW.related_entity_id AND tenant_id = NEW.tenant_id
  ) THEN RAISE EXCEPTION 'Evidence task link must belong to the evidence tenant' USING ERRCODE = '23503'; END IF;
  IF NEW.related_entity_type = 'asset' AND NOT EXISTS (
    SELECT 1 FROM public.assets WHERE id = NEW.related_entity_id AND tenant_id = NEW.tenant_id
  ) THEN RAISE EXCEPTION 'Evidence asset link must belong to the evidence tenant' USING ERRCODE = '23503'; END IF;
  IF NEW.related_entity_type = 'room' AND NOT EXISTS (
    SELECT 1 FROM public.rooms WHERE id = NEW.related_entity_id AND tenant_id = NEW.tenant_id
  ) THEN RAISE EXCEPTION 'Evidence room link must belong to the evidence tenant' USING ERRCODE = '23503'; END IF;
  IF NEW.related_entity_type = 'inspection' AND NOT EXISTS (
    SELECT 1 FROM public.inspections WHERE id = NEW.related_entity_id AND tenant_id = NEW.tenant_id
  ) THEN RAISE EXCEPTION 'Evidence inspection link must belong to the evidence tenant' USING ERRCODE = '23503'; END IF;
  IF NEW.related_entity_type = 'incident' AND NOT EXISTS (
    SELECT 1 FROM public.controlled_incidents WHERE id = NEW.related_entity_id AND tenant_id = NEW.tenant_id
  ) THEN RAISE EXCEPTION 'Evidence incident link must belong to the evidence tenant' USING ERRCODE = '23503'; END IF;
  IF NEW.related_entity_type = 'sop' AND NOT EXISTS (
    SELECT 1 FROM public.sop_documents WHERE id = NEW.related_entity_id AND tenant_id = NEW.tenant_id
  ) THEN RAISE EXCEPTION 'Evidence SOP link must belong to the evidence tenant' USING ERRCODE = '23503'; END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_records_require_same_tenant_links
BEFORE INSERT OR UPDATE OF tenant_id, document_id, assignment_id, related_entity_type, related_entity_id
ON public.evidence_records
FOR EACH ROW EXECUTE FUNCTION public.enforce_evidence_record_tenant_links();

-- Keep explicit RLS for the existing base table and bucket so later policy changes
-- cannot rely only on application-side `.eq("tenant_id", ...)` filters.
ALTER TABLE public.evidence_records ENABLE ROW LEVEL SECURITY;

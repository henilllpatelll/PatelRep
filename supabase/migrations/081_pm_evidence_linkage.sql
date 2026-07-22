-- Phase 4 slice 04-02 (D-06, G1): route PM completion photos/vendor certificates through the
-- existing Phase 2 evidence platform instead of raw JSONB URL strings.
--
-- Adds 'pm_completion' as a valid evidence_records.related_entity_type so a PM completion's
-- photos/certificate_attachments/checklist-item evidence can be linked (post-insert backfill,
-- since pm_completion_records is append-only and evidence_records is mutable) and validated for
-- tenant ownership by the same enforce_evidence_record_tenant_links() trigger that already
-- protects staff/task/asset/room/inspection/incident/sop links.

ALTER TABLE public.evidence_records
  DROP CONSTRAINT evidence_records_related_entity_type_check;

ALTER TABLE public.evidence_records
  ADD CONSTRAINT evidence_records_related_entity_type_check
    CHECK (related_entity_type IN (
      'staff', 'task', 'asset', 'room', 'inspection', 'incident', 'sop', 'pm_completion'
    ));

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
  IF NEW.related_entity_type = 'pm_completion' AND NOT EXISTS (
    SELECT 1 FROM public.pm_completion_records WHERE id = NEW.related_entity_id AND tenant_id = NEW.tenant_id
  ) THEN RAISE EXCEPTION 'Evidence pm_completion link must belong to the evidence tenant' USING ERRCODE = '23503'; END IF;

  RETURN NEW;
END;
$$;

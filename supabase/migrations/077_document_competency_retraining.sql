-- Phase 2: make controlled-document competency and retraining reconstructable.
-- Retraining is created only once the successor version is approved, so staff
-- are never assigned a draft procedure.

ALTER TABLE public.document_acknowledgements
  ADD COLUMN competency_method TEXT CHECK (competency_method IN ('observed', 'quiz')),
  ADD COLUMN competency_evaluated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN competency_evaluated_at TIMESTAMPTZ,
  ADD COLUMN competency_notes TEXT,
  ADD COLUMN assignment_type TEXT NOT NULL DEFAULT 'initial'
    CHECK (assignment_type IN ('initial', 'retraining')),
  ADD COLUMN retraining_from_assignment_id UUID
    REFERENCES public.document_acknowledgements(id) ON DELETE SET NULL;

UPDATE public.document_acknowledgements
SET competency_status = 'not_required'
WHERE competency_required = FALSE AND competency_status = 'pending';

ALTER TABLE public.document_acknowledgements
  ADD CONSTRAINT document_acknowledgements_competency_status_consistent
    CHECK (
      (competency_required = TRUE AND competency_status IN ('pending', 'observed', 'passed', 'failed'))
      OR (competency_required = FALSE AND competency_status = 'not_required')
    );

CREATE INDEX idx_document_acknowledgements_retraining
  ON public.document_acknowledgements (tenant_id, document_id, assignment_type);

CREATE OR REPLACE FUNCTION public.create_retraining_assignments_for_approved_document()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prior_assignment public.document_acknowledgements;
  v_retraining_id UUID;
BEGIN
  IF NEW.approval_state <> 'approved'
    OR OLD.approval_state = 'approved'
    OR NEW.supersedes_id IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_prior_assignment IN
    SELECT *
    FROM public.document_acknowledgements
    WHERE tenant_id = NEW.tenant_id
      AND document_id = NEW.supersedes_id
      AND competency_required = TRUE
  LOOP
    INSERT INTO public.document_acknowledgements (
      tenant_id, document_id, assigned_to, assigned_by, due_date,
      competency_required, competency_status, assignment_type,
      retraining_from_assignment_id
    ) VALUES (
      NEW.tenant_id, NEW.id, v_prior_assignment.assigned_to, NEW.approver_id,
      CURRENT_DATE + 30, TRUE, 'pending', 'retraining', v_prior_assignment.id
    )
    ON CONFLICT (tenant_id, document_id, assigned_to) DO NOTHING
    RETURNING id INTO v_retraining_id;

    IF v_retraining_id IS NOT NULL THEN
      INSERT INTO public.operational_audit_events (
        tenant_id, resource_type, resource_id, action, actor_id, actor_role,
        old_state, new_state, reason_code, reason_note, source
      ) VALUES (
        NEW.tenant_id, 'document_acknowledgement', v_retraining_id,
        'document_acknowledgement.retraining_assigned', NEW.approver_id, 'gm',
        jsonb_build_object('superseded_document_id', NEW.supersedes_id, 'source_assignment_id', v_prior_assignment.id),
        jsonb_build_object('document_id', NEW.id, 'assignment_type', 'retraining', 'due_date', CURRENT_DATE + 30),
        'retraining_after_supersession', NULL, 'api'
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER controlled_document_approved_creates_retraining
  AFTER UPDATE OF approval_state ON public.controlled_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.create_retraining_assignments_for_approved_document();

-- Phase 2: enforce a tenant-safe, traceable controlled-document lifecycle.
-- Forward-only: migration 069 remains the base evidence schema.

ALTER TABLE public.controlled_documents
  ADD CONSTRAINT controlled_documents_review_after_effective
    CHECK (review_date IS NULL OR effective_date IS NULL OR review_date >= effective_date),
  ADD CONSTRAINT controlled_documents_expiration_after_effective
    CHECK (expiration_date IS NULL OR effective_date IS NULL OR expiration_date >= effective_date),
  ADD CONSTRAINT controlled_documents_expiration_after_review
    CHECK (expiration_date IS NULL OR review_date IS NULL OR expiration_date >= review_date),
  ADD CONSTRAINT controlled_documents_approved_has_approver
    CHECK (approval_state <> 'approved' OR (approver_id IS NOT NULL AND approved_at IS NOT NULL));

CREATE OR REPLACE FUNCTION public.enforce_controlled_document_tenant_links()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE tenant_id = NEW.tenant_id AND user_id = NEW.owner_id AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Controlled document owner must be active at this property' USING ERRCODE = '23503';
  END IF;

  IF NEW.approver_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE tenant_id = NEW.tenant_id AND user_id = NEW.approver_id AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Controlled document approver must be active at this property' USING ERRCODE = '23503';
  END IF;

  IF NEW.owner_id IS NOT NULL AND NEW.approver_id IS NOT NULL AND NEW.owner_id = NEW.approver_id THEN
    RAISE EXCEPTION 'Controlled document owner cannot approve their own document' USING ERRCODE = '23514';
  END IF;

  IF NEW.source_sop_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sop_documents
    WHERE id = NEW.source_sop_document_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Source SOP document must belong to the controlled document tenant' USING ERRCODE = '23503';
  END IF;

  IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.controlled_documents
    WHERE id = NEW.supersedes_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Superseded controlled document must belong to the same tenant' USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER controlled_documents_require_same_tenant_links
BEFORE INSERT OR UPDATE OF tenant_id, owner_id, approver_id, source_sop_document_id, supersedes_id
ON public.controlled_documents
FOR EACH ROW EXECUTE FUNCTION public.enforce_controlled_document_tenant_links();

CREATE OR REPLACE FUNCTION public.supersede_controlled_document_with_audit(
  p_document_id UUID,
  p_tenant_id UUID,
  p_actor_id UUID,
  p_actor_role TEXT,
  p_reason_code TEXT,
  p_reason_note TEXT,
  p_source TEXT
)
RETURNS SETOF public.controlled_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous public.controlled_documents;
  v_successor public.controlled_documents;
BEGIN
  SELECT * INTO v_previous
  FROM public.controlled_documents
  WHERE id = p_document_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'controlled document not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_previous.approval_state <> 'approved' THEN
    RAISE EXCEPTION 'only an approved controlled document can be superseded' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.controlled_documents (
    tenant_id, title, document_type, version_number, approval_state, owner_id,
    created_by, effective_date, review_date, expiration_date, applicability,
    retention_class, source_sop_document_id, supersedes_id
  ) VALUES (
    p_tenant_id, v_previous.title, v_previous.document_type, v_previous.version_number + 1,
    'draft', v_previous.owner_id, p_actor_id, v_previous.effective_date,
    v_previous.review_date, v_previous.expiration_date, v_previous.applicability,
    v_previous.retention_class, v_previous.source_sop_document_id, v_previous.id
  ) RETURNING * INTO v_successor;

  UPDATE public.controlled_documents
  SET approval_state = 'superseded', superseded_at = now(), updated_at = now()
  WHERE id = v_previous.id AND tenant_id = p_tenant_id;

  INSERT INTO public.operational_audit_events (
    tenant_id, resource_type, resource_id, action, actor_id, actor_role,
    old_state, new_state, reason_code, reason_note, source
  ) VALUES (
    p_tenant_id, 'controlled_document', v_previous.id, 'controlled_document.superseded',
    p_actor_id, p_actor_role,
    jsonb_build_object('approval_state', v_previous.approval_state, 'version_number', v_previous.version_number),
    jsonb_build_object('successor_id', v_successor.id, 'version_number', v_successor.version_number),
    p_reason_code, p_reason_note, p_source
  );

  RETURN NEXT v_successor;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.supersede_controlled_document_with_audit(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.supersede_controlled_document_with_audit(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;

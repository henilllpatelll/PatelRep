-- Canonical property applicability contract for the evidence foundation.
-- Forward-only: future changes must be added in a new migration.

CREATE OR REPLACE FUNCTION public.evidence_json_array_uses_only(
  input_values JSONB,
  allowed_values TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_typeof(input_values) = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(input_values) AS item(value)
      WHERE NOT (item.value = ANY(allowed_values))
    );
$$;

ALTER TABLE public.property_applicability
  ADD CONSTRAINT property_applicability_facilities_canonical
    CHECK (public.evidence_json_array_uses_only(
      facilities, ARRAY['pool', 'spa', 'elevator', 'boiler', 'cooling_tower']
    )),
  ADD CONSTRAINT property_applicability_services_canonical
    CHECK (public.evidence_json_array_uses_only(services, ARRAY['breakfast'])),
  ADD CONSTRAINT property_applicability_brand_requirements_canonical
    CHECK (public.evidence_json_array_uses_only(
      brand_requirements, ARRAY['brand_standard', 'brand_safety', 'brand_training']
    ));

ALTER TABLE public.controlled_documents
  ADD CONSTRAINT controlled_documents_applicability_canonical
    CHECK (public.evidence_json_array_uses_only(
      applicability,
      ARRAY[
        'pool', 'spa', 'elevator', 'boiler', 'cooling_tower', 'breakfast',
        'brand_standard', 'brand_safety', 'brand_training'
      ]
    ));

CREATE OR REPLACE FUNCTION public.document_applicability_matches_property(
  document_applicability JSONB,
  property_facilities JSONB,
  property_services JSONB,
  property_brand_requirements JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(document_applicability, '[]'::jsonb) <@
    (COALESCE(property_facilities, '[]'::jsonb)
      || COALESCE(property_services, '[]'::jsonb)
      || COALESCE(property_brand_requirements, '[]'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.enforce_document_assignment_applicability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  document_applicability JSONB;
  configured_facilities JSONB;
  configured_services JSONB;
  configured_brand_requirements JSONB;
BEGIN
  SELECT applicability
  INTO document_applicability
  FROM public.controlled_documents
  WHERE id = NEW.document_id AND tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Controlled document must belong to the acknowledgement tenant'
      USING ERRCODE = '23503';
  END IF;

  SELECT facilities, services, brand_requirements
  INTO configured_facilities, configured_services, configured_brand_requirements
  FROM public.property_applicability
  WHERE tenant_id = NEW.tenant_id;

  IF NOT public.document_applicability_matches_property(
    document_applicability,
    configured_facilities,
    configured_services,
    configured_brand_requirements
  ) THEN
    RAISE EXCEPTION 'Controlled document is not applicable to this property'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER document_acknowledgements_require_applicable_document
BEFORE INSERT OR UPDATE OF tenant_id, document_id ON public.document_acknowledgements
FOR EACH ROW EXECUTE FUNCTION public.enforce_document_assignment_applicability();

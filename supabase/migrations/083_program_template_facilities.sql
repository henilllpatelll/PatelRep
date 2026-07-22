-- Phase 4 slice 4A (D-05, G5): extend the canonical property_applicability.facilities
-- allowlist so the domestic-water and backflow PM template families can be gated per
-- property, the same way pool_check is already gated on 'pool'. Forward-only, per
-- migration 074's own header — this does not loosen the constraint to arbitrary
-- strings, it only widens the explicit canonical allowlist.

ALTER TABLE public.property_applicability
  DROP CONSTRAINT property_applicability_facilities_canonical,
  ADD CONSTRAINT property_applicability_facilities_canonical
    CHECK (public.evidence_json_array_uses_only(
      facilities, ARRAY['pool', 'spa', 'elevator', 'boiler', 'cooling_tower', 'backflow', 'domestic_water']
    ));

-- controlled_documents.applicability shares the same facility vocabulary (migration 074) —
-- widen it in lockstep so a controlled document can also be scoped to backflow/domestic_water.
ALTER TABLE public.controlled_documents
  DROP CONSTRAINT controlled_documents_applicability_canonical,
  ADD CONSTRAINT controlled_documents_applicability_canonical
    CHECK (public.evidence_json_array_uses_only(
      applicability,
      ARRAY[
        'pool', 'spa', 'elevator', 'boiler', 'cooling_tower', 'backflow', 'domestic_water',
        'breakfast', 'brand_standard', 'brand_safety', 'brand_training'
      ]
    ));

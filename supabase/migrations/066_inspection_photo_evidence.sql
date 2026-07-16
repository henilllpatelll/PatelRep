-- Phase 1: Let properties require photo evidence when a checklist item fails.
ALTER TABLE public.inspection_template_items
  ADD COLUMN IF NOT EXISTS requires_photo_on_fail BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.inspection_template_items.requires_photo_on_fail IS
  'A failed result for this checklist item must include linked photo evidence.';

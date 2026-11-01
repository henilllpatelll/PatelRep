-- =============================================================================
-- Migration 231: Required flag for work-order checklist items
-- =============================================================================
-- Migration 110 gave every work-order checklist step the same weight, so nothing could be enforced at completion.
-- This adds an explicit per-item `is_required` flag to the per-work-order instance and to the template items it is
-- snapshotted from. Additive only: DEFAULT FALSE means every existing item (and every template item) stays optional,
-- so no in-flight or historical work order becomes un-completable. POST /work-orders/{id}/complete rejects a
-- completion only while an item with is_required = TRUE is still not done.
--
-- The API reads these rows with select("*") and treats a missing column as "optional", so it keeps working in the
-- window before this migration is applied.
-- =============================================================================

ALTER TABLE public.work_order_checklist_items
  ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.work_order_checklist_template_items
  ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.work_order_checklist_items.is_required IS 'TRUE = must be done before the work order can be completed (enforced by POST /work-orders/{id}/complete). Snapshotted from the template item at creation or set when a step is added by hand. Defaults to optional.';
COMMENT ON COLUMN public.work_order_checklist_template_items.is_required IS 'Copied onto work_order_checklist_items.is_required when a work order is created from this template. Defaults to optional.';

-- Completion readiness reads "required and not done" for one work order.
CREATE INDEX IF NOT EXISTS idx_wo_checklist_items_required_open
  ON public.work_order_checklist_items (work_order_id)
  WHERE is_required AND NOT is_done;

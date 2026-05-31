-- =============================================================================
-- Migration 049: Make inspection_results.template_item_id nullable
--
-- Root cause: updating a template deletes all its items then re-inserts them.
-- This fails with FK 23503 when existing inspection_results reference those items.
-- Fix: allow template_item_id to be NULL so item deletion doesn't cascade-block.
-- Historical inspection results are preserved; they just lose the item reference.
-- =============================================================================

ALTER TABLE inspection_results
  ALTER COLUMN template_item_id DROP NOT NULL;

ALTER TABLE inspection_results
  DROP CONSTRAINT IF EXISTS inspection_results_template_item_id_fkey;

ALTER TABLE inspection_results
  ADD CONSTRAINT inspection_results_template_item_id_fkey
    FOREIGN KEY (template_item_id)
    REFERENCES inspection_template_items(id)
    ON DELETE SET NULL;

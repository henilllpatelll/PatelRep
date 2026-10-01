-- Lost & Found Phase 2: operational intake classification and traceable storage moves.
-- All additions are nullable/default-safe so historic inventory remains valid.

ALTER TABLE public.lost_found_items
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS classification TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS distinguishing_details TEXT;

ALTER TABLE public.lost_found_custody_events
  ADD COLUMN IF NOT EXISTS previous_storage_location TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lost_found_items_category_check'
  ) THEN
    ALTER TABLE public.lost_found_items
      ADD CONSTRAINT lost_found_items_category_check CHECK (category IN (
        'electronics', 'clothing', 'jewelry', 'bags_luggage', 'keys',
        'wallets_cards', 'documents', 'medical', 'toiletries', 'accessories', 'other'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lost_found_items_classification_check'
  ) THEN
    ALTER TABLE public.lost_found_items
      ADD CONSTRAINT lost_found_items_classification_check
      CHECK (classification IN ('standard', 'high_value', 'sensitive'));
  END IF;
END $$;

-- Tags only need uniqueness while an item is actively held. Historic null and
-- blank records remain valid, and the API normalizes new tags to uppercase.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lost_found_active_tag_unique
  ON public.lost_found_items (tenant_id, lower(btrim(tag_identifier)))
  WHERE tag_identifier IS NOT NULL
    AND btrim(tag_identifier) <> ''
    AND status = 'unclaimed';

CREATE INDEX IF NOT EXISTS idx_lost_found_tenant_category_created
  ON public.lost_found_items (tenant_id, category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lost_found_tenant_storage
  ON public.lost_found_items (tenant_id, storage_location)
  WHERE storage_location IS NOT NULL;

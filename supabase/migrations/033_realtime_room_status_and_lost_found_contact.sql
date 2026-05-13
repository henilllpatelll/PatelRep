-- Make the production room board realtime and Lost & Found claim-contact
-- contracts explicit and idempotent.

-- Realtime should emit UPDATE payloads for tenant-filtered room_status
-- subscribers. FULL replica identity keeps both new and old row images
-- available to the replication stream and avoids filtered UPDATE blind spots.
ALTER TABLE room_status REPLICA IDENTITY FULL;
ALTER TABLE room_assignments REPLICA IDENTITY FULL;
ALTER TABLE work_orders REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'room_status'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE room_status;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'room_assignments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE room_assignments;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'work_orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE work_orders;
  END IF;
END $$;

ALTER TABLE lost_found_items
  ADD COLUMN IF NOT EXISTS claimed_by_contact TEXT;

COMMENT ON COLUMN lost_found_items.claimed_by_contact IS
  'Phone or email captured when a lost and found item is claimed.';

-- Supabase/PostgREST normally reloads schema after migrations, but this makes
-- the contract refresh explicit for environments that keep a warm schema cache.
NOTIFY pgrst, 'reload schema';

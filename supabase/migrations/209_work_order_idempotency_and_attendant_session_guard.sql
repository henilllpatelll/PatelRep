-- Migration 209: database-level guarantees for mobile replay safety.
-- Forward-only and additive. No existing column, policy or index is altered.
--
-- 1. work_orders.client_request_id: a client-generated UUID that makes
--    POST /work-orders safe to retry after a lost response. Nullable, so web and
--    older API clients that never send it are unaffected. Uniqueness is scoped
--    to (tenant, creator) so one user can never replay -- or probe for -- another
--    user's or another hotel's request id.
--
-- 2. room_clean_sessions one-active-session-per-attendant. Migration 055 already
--    guarantees one active session per room; the one-active-room-per-attendant
--    policy was only a read-then-insert check in the API. Two concurrent starts on
--    different rooms could both pass it.

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS client_request_id uuid NULL;

COMMENT ON COLUMN work_orders.client_request_id IS
  'Client-generated idempotency key for POST /work-orders (mobile offline replay). NULL for clients that do not send one.';

CREATE UNIQUE INDEX IF NOT EXISTS work_orders_client_request_uniq
  ON work_orders (tenant_id, created_by, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Before the attendant index can exist, any attendant that already holds more than
-- one active session (only reachable through the race this migration closes) keeps
-- the most recently started one; older ones are closed as abandoned, the same
-- outcome the API's stale-session release produces. Sessions are never deleted.
UPDATE room_clean_sessions AS s
   SET status = 'abandoned',
       ended_at = COALESCE(s.ended_at, now()),
       notes = COALESCE(s.notes || E'\n', '') || 'Superseded: duplicate active session (migration 209)'
 WHERE s.status = 'active'
   AND EXISTS (
     SELECT 1
       FROM room_clean_sessions n
      WHERE n.tenant_id = s.tenant_id
        AND n.housekeeper_id = s.housekeeper_id
        AND n.status = 'active'
        AND n.id <> s.id
        AND (n.started_at, n.id) > (s.started_at, s.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS rcs_one_active_per_attendant
  ON room_clean_sessions (tenant_id, housekeeper_id) WHERE status = 'active';

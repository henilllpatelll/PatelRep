-- Remove duplicate room_status_history rows written by the DB trigger.
-- The trigger fired first (earlier created_at); the Python layer wrote second
-- with the correct changed_by, notes, and change_source. We keep the later row.
DELETE FROM room_status_history h1
WHERE EXISTS (
  SELECT 1
  FROM room_status_history h2
  WHERE h2.room_id     = h1.room_id
    AND h2.tenant_id   = h1.tenant_id
    AND h2.from_status = h1.from_status
    AND h2.to_status   = h1.to_status
    AND h2.id         <> h1.id
    AND h2.created_at  > h1.created_at
    AND EXTRACT(EPOCH FROM (h2.created_at - h1.created_at)) < 5
);

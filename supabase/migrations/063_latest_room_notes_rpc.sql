-- Returns the single most-recent staff note per room, respecting the
-- stay_reset_at boundary set on DEP inspection. No date lower bound —
-- works for stays of any length (extended-stay rooms, long-term guests, etc.).
CREATE OR REPLACE FUNCTION get_latest_room_notes(
  p_tenant_id  text,
  p_room_ids   text[],
  p_activity_end timestamptz
)
RETURNS TABLE (
  room_id        text,
  notes          text,
  from_status    text,
  to_status      text,
  changed_by     text,
  change_source  text,
  created_at     timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (rsh.room_id::text)
    rsh.room_id::text,
    rsh.notes,
    rsh.from_status,
    rsh.to_status,
    rsh.changed_by::text,
    rsh.change_source,
    rsh.created_at
  FROM room_status_history rsh
  LEFT JOIN room_status rs
    ON rs.room_id   = rsh.room_id
   AND rs.tenant_id = rsh.tenant_id
  WHERE rsh.tenant_id::text        = p_tenant_id
    AND rsh.room_id::text          = ANY(p_room_ids)
    AND rsh.created_at             < p_activity_end
    AND (rs.stay_reset_at IS NULL OR rsh.created_at >= rs.stay_reset_at)
    AND rsh.changed_by             IS NOT NULL
    AND (rsh.change_source IS NULL OR rsh.change_source = 'app')
    AND rsh.from_status            IS NOT NULL
    AND rsh.from_status            = rsh.to_status
    AND rsh.notes                  IS NOT NULL
    AND rsh.notes                  <> ''
    AND rsh.notes NOT LIKE 'task_sheet_clean_type=%'
  ORDER BY rsh.room_id::text, rsh.created_at DESC
$$;

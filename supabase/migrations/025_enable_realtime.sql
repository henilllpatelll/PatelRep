-- Enable Supabase Realtime for housekeeping tables.
-- Without this, postgres_changes subscriptions connect silently but never
-- receive events — causing housekeeper devices to miss live updates.
ALTER PUBLICATION supabase_realtime ADD TABLE room_status;
ALTER PUBLICATION supabase_realtime ADD TABLE room_assignments;

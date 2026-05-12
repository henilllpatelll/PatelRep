-- Enable Supabase Realtime for engineering work orders.
-- Without this, postgres_changes subscriptions connect but never receive events.
ALTER PUBLICATION supabase_realtime ADD TABLE work_orders;

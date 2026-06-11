-- Migration 056: Lightweight housekeeper shift sessions
-- Presence only (powers the pace ring and "on shift" status).
-- Deliberately NOT linked to scheduling/payroll tables.

CREATE TABLE IF NOT EXISTS hk_shift_sessions (
  id             uuid        PRIMARY KEY,
  tenant_id      uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL,
  started_at     timestamptz NOT NULL,
  ended_at       timestamptz NULL,
  status         text        NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'on_break', 'ended')),
  on_break_since timestamptz NULL,
  break_seconds  int         NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One open shift per user
CREATE UNIQUE INDEX IF NOT EXISTS hss_one_open_per_user
  ON hk_shift_sessions (tenant_id, user_id) WHERE status != 'ended';

CREATE INDEX IF NOT EXISTS hss_user_started_idx
  ON hk_shift_sessions (tenant_id, user_id, started_at DESC);

ALTER TABLE hk_shift_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_read" ON hk_shift_sessions
  FOR SELECT USING (tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'))::uuid);
CREATE POLICY "owner_write" ON hk_shift_sessions
  FOR ALL USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'))::uuid
    AND user_id = (SELECT auth.uid())
  );

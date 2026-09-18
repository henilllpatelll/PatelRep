-- Opera Cloud SFTP scheduled-report ingestion: a parallel connection mode to the
-- existing OHIP API sync (services/opera/sync.py), for hotels whose Opera Cloud
-- subscription doesn't include OHIP API access. Opera's report scheduler drops a
-- "Delimited Data" export to an SFTP folder on a schedule; services/opera/report_ingest.py
-- polls it and upserts room_status the same way the OHIP path already does.

ALTER TABLE public.opera_credentials
  ADD COLUMN IF NOT EXISTS connection_mode TEXT NOT NULL DEFAULT 'api'
    CHECK (connection_mode IN ('api', 'sftp_report')),
  ADD COLUMN IF NOT EXISTS sftp_host TEXT,
  ADD COLUMN IF NOT EXISTS sftp_port INTEGER NOT NULL DEFAULT 22,
  ADD COLUMN IF NOT EXISTS sftp_username TEXT,
  ADD COLUMN IF NOT EXISTS sftp_password TEXT,
  ADD COLUMN IF NOT EXISTS sftp_private_key TEXT,
  ADD COLUMN IF NOT EXISTS sftp_host_key_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS sftp_remote_path TEXT NOT NULL DEFAULT '/',
  ADD COLUMN IF NOT EXISTS report_delimiter TEXT NOT NULL DEFAULT E'\t'
    CHECK (report_delimiter IN (E'\t', ',', '|')),
  ADD COLUMN IF NOT EXISTS report_column_mapping JSONB,
  ADD COLUMN IF NOT EXISTS report_type_filename_patterns JSONB;

ALTER TABLE public.opera_credentials
  ADD CONSTRAINT opera_sftp_credentials_present CHECK (
    connection_mode <> 'sftp_report'
    OR (sftp_host IS NOT NULL AND sftp_username IS NOT NULL
        AND (sftp_password IS NOT NULL OR sftp_private_key IS NOT NULL))
  );

COMMENT ON COLUMN public.opera_credentials.connection_mode IS
  'api = live OHIP token sync (services/opera/sync.py); sftp_report = batch report ingestion (services/opera/report_ingest.py). A hotel connects via one mode at a time, not both.';
COMMENT ON COLUMN public.opera_credentials.sftp_password IS 'pgcrypto/Fernet-encrypted (enc:v1: envelope), same pattern as access_token/refresh_token.';
COMMENT ON COLUMN public.opera_credentials.sftp_private_key IS 'pgcrypto/Fernet-encrypted PEM private key, alternative to sftp_password.';
COMMENT ON COLUMN public.opera_credentials.report_delimiter IS 'Opera''s "Delimited Data" export defaults to Tab; comma/pipe supported if the hotel configures the scheduled report differently.';
COMMENT ON COLUMN public.opera_credentials.report_column_mapping IS
  'Per-hotel override of DEFAULT_COLUMN_MAPPINGS in services/opera/report_columns.py. Real Opera BI Publisher header names are stable per report definition but vary by property/report choice.';
COMMENT ON COLUMN public.opera_credentials.report_type_filename_patterns IS
  'Per-hotel override of DEFAULT_FILENAME_PATTERNS. Opera names the delivered file "<configured-report-internal-name>_<jobid>.txt" (e.g. gibyroom_200160515.txt), so the default match is a prefix on the internal report name.';

-- Per-tenant processed-file log: idempotency gate for the SFTP ingester, and audit trail.
CREATE TABLE public.opera_report_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  report_type     TEXT NOT NULL CHECK (report_type IN ('arrivals', 'departures', 'in_house', 'room_status', 'unknown')),
  remote_filename TEXT NOT NULL,
  remote_mtime    TIMESTAMPTZ,
  file_size       BIGINT,
  checksum        TEXT,
  status          TEXT NOT NULL CHECK (status IN ('processed', 'failed', 'skipped')),
  rows_parsed     INTEGER NOT NULL DEFAULT 0,
  rows_upserted   INTEGER NOT NULL DEFAULT 0,
  error_detail    TEXT,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, remote_filename)
);

COMMENT ON TABLE public.opera_report_files IS
  'Idempotency + audit log for Opera SFTP report ingestion. A row with status=failed is retried on the next poll; processed/skipped are never retried.';

CREATE INDEX idx_opera_report_files_tenant ON public.opera_report_files (tenant_id, processed_at DESC);

ALTER TABLE public.opera_report_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_opera_report_files" ON public.opera_report_files
  FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- ROLLBACK:
-- DROP TABLE IF EXISTS public.opera_report_files;
-- ALTER TABLE public.opera_credentials DROP CONSTRAINT IF EXISTS opera_sftp_credentials_present;
-- ALTER TABLE public.opera_credentials
--   DROP COLUMN IF EXISTS connection_mode,
--   DROP COLUMN IF EXISTS sftp_host,
--   DROP COLUMN IF EXISTS sftp_port,
--   DROP COLUMN IF EXISTS sftp_username,
--   DROP COLUMN IF EXISTS sftp_password,
--   DROP COLUMN IF EXISTS sftp_private_key,
--   DROP COLUMN IF EXISTS sftp_host_key_fingerprint,
--   DROP COLUMN IF EXISTS sftp_remote_path,
--   DROP COLUMN IF EXISTS report_delimiter,
--   DROP COLUMN IF EXISTS report_column_mapping,
--   DROP COLUMN IF EXISTS report_type_filename_patterns;

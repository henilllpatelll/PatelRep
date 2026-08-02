-- =============================================================================
-- Migration 086: Backfill logbook_entries.entry_date to hotel-local time
-- Corrects LOGBOOK-01: entry_date previously defaulted to UTC CURRENT_DATE
-- (migration 012), which shifted evening hotel-local entries to the next
-- calendar day. The application now sets entry_date explicitly on insert in
-- the hotel's local timezone (routers/logbook.py), which is the authoritative
-- fix going forward. This migration recomputes entry_date for all existing
-- rows from created_at converted to each tenant's timezone, so historically
-- mis-dated evening entries reappear under their true local day.
-- Idempotent-safe: re-running this UPDATE is harmless.
-- =============================================================================

UPDATE public.logbook_entries le
SET entry_date = (le.created_at AT TIME ZONE COALESCE(t.timezone, 'America/Chicago'))::date
FROM public.tenants t
WHERE le.tenant_id = t.id;

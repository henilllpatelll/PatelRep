-- Migration 218: replay safety for the supervisor shift handoff.
-- Forward-only and additive. No existing column, policy, index or row is altered.
--
-- logbook_entries.client_request_id: a client-generated UUID that makes
-- POST /housekeeping/end-shift-summary safe to retry after a lost response, so a
-- timeout, a double tap or an app retry can never create a second logbook entry
-- (and so never a second round of GM notifications). Nullable: every existing row,
-- the web app and every other logbook writer never sends one and is unaffected.
-- Uniqueness is scoped to (tenant, author) so one person can never replay -- or probe
-- for -- another person's or another hotel's request id.

ALTER TABLE public.logbook_entries
  ADD COLUMN IF NOT EXISTS client_request_id uuid NULL;

COMMENT ON COLUMN public.logbook_entries.client_request_id IS
  'Client-generated idempotency key for POST /housekeeping/end-shift-summary (supervisor shift handoff). NULL for every other entry.';

CREATE UNIQUE INDEX IF NOT EXISTS logbook_entries_client_request_uniq
  ON public.logbook_entries (tenant_id, author_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

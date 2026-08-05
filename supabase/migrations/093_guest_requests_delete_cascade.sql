-- Fix: DELETE /guest-requests/{id} raises an FK violation (23503) and never succeeds
-- for ANY guest request, because create_guest_request() unconditionally writes one
-- guest_request_events row (event_type="created") at creation time, and that table's
-- guest_request_id FK was ON DELETE RESTRICT (migration 072) — so a guest_requests row
-- has a blocking child event from the instant it exists, before any real activity.
-- guest_messages and guest_recovery_actions share the identical RESTRICT + immutability
-- shape and would fail the same way once populated (a real guest_request with SMS
-- messages or a recorded recovery action).
--
-- This is the exact gap migration 087 explicitly flagged and deliberately deferred:
-- "The other three tables sharing reject_guest_recovery_mutation() (guest_request_events,
-- guest_messages, guest_recovery_actions) are untouched." Applying 087's same, already-
-- reviewed design decision here: history remains immutable to UPDATE (you cannot alter
-- a recorded event/message/recovery action), but deleting the entire parent guest_request
-- (matching delete_guest_request()'s existing intent in apps/api/routers/guest_requests.py,
-- which already deletes the linked task/task_comments and expects the DB to cascade the
-- rest) now cascades and removes that request's event/message/recovery-action trail
-- instead of being permanently stuck. Found live via e2e/20-verify-gm.spec.ts VERIFY-03
-- fixture teardown — see .wolf/buglog.json.

ALTER TABLE public.guest_request_events
  DROP CONSTRAINT guest_request_events_guest_request_id_fkey;
ALTER TABLE public.guest_request_events
  ADD CONSTRAINT guest_request_events_guest_request_id_fkey
  FOREIGN KEY (guest_request_id)
  REFERENCES public.guest_requests(id) ON DELETE CASCADE;

ALTER TABLE public.guest_messages
  DROP CONSTRAINT guest_messages_guest_request_id_fkey;
ALTER TABLE public.guest_messages
  ADD CONSTRAINT guest_messages_guest_request_id_fkey
  FOREIGN KEY (guest_request_id)
  REFERENCES public.guest_requests(id) ON DELETE CASCADE;

ALTER TABLE public.guest_recovery_actions
  DROP CONSTRAINT guest_recovery_actions_guest_request_id_fkey;
ALTER TABLE public.guest_recovery_actions
  ADD CONSTRAINT guest_recovery_actions_guest_request_id_fkey
  FOREIGN KEY (guest_request_id)
  REFERENCES public.guest_requests(id) ON DELETE CASCADE;

DROP TRIGGER IF EXISTS guest_request_events_immutable
  ON public.guest_request_events;
CREATE TRIGGER guest_request_events_immutable
  BEFORE UPDATE ON public.guest_request_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_guest_recovery_mutation();

DROP TRIGGER IF EXISTS guest_messages_immutable
  ON public.guest_messages;
CREATE TRIGGER guest_messages_immutable
  BEFORE UPDATE ON public.guest_messages
  FOR EACH ROW EXECUTE FUNCTION public.reject_guest_recovery_mutation();

DROP TRIGGER IF EXISTS guest_recovery_actions_immutable
  ON public.guest_recovery_actions;
CREATE TRIGGER guest_recovery_actions_immutable
  BEFORE UPDATE ON public.guest_recovery_actions
  FOR EACH ROW EXECUTE FUNCTION public.reject_guest_recovery_mutation();

-- ROLLBACK:
-- ALTER TABLE public.guest_request_events DROP CONSTRAINT guest_request_events_guest_request_id_fkey;
-- ALTER TABLE public.guest_request_events ADD CONSTRAINT guest_request_events_guest_request_id_fkey FOREIGN KEY (guest_request_id) REFERENCES public.guest_requests(id) ON DELETE RESTRICT;
-- ALTER TABLE public.guest_messages DROP CONSTRAINT guest_messages_guest_request_id_fkey;
-- ALTER TABLE public.guest_messages ADD CONSTRAINT guest_messages_guest_request_id_fkey FOREIGN KEY (guest_request_id) REFERENCES public.guest_requests(id) ON DELETE RESTRICT;
-- ALTER TABLE public.guest_recovery_actions DROP CONSTRAINT guest_recovery_actions_guest_request_id_fkey;
-- ALTER TABLE public.guest_recovery_actions ADD CONSTRAINT guest_recovery_actions_guest_request_id_fkey FOREIGN KEY (guest_request_id) REFERENCES public.guest_requests(id) ON DELETE RESTRICT;
-- DROP TRIGGER IF EXISTS guest_request_events_immutable ON public.guest_request_events;
-- CREATE TRIGGER guest_request_events_immutable BEFORE UPDATE OR DELETE ON public.guest_request_events FOR EACH ROW EXECUTE FUNCTION public.reject_guest_recovery_mutation();
-- DROP TRIGGER IF EXISTS guest_messages_immutable ON public.guest_messages;
-- CREATE TRIGGER guest_messages_immutable BEFORE UPDATE OR DELETE ON public.guest_messages FOR EACH ROW EXECUTE FUNCTION public.reject_guest_recovery_mutation();
-- DROP TRIGGER IF EXISTS guest_recovery_actions_immutable ON public.guest_recovery_actions;
-- CREATE TRIGGER guest_recovery_actions_immutable BEFORE UPDATE OR DELETE ON public.guest_recovery_actions FOR EACH ROW EXECUTE FUNCTION public.reject_guest_recovery_mutation();

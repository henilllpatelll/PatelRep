-- Fix LOSTFOUND-01: deleting a Lost & Found item with custody history raises an FK
-- violation, permanently stuck. lost_found_custody_events.lost_found_item_id was
-- ON DELETE RESTRICT (migration 072) and every item gets an `intake` custody event
-- at creation, so no item with history could ever be deleted.
--
-- Design decision (left to Claude's discretion by the requirement): custody events
-- remain immutable to UPDATE — you cannot alter recorded history — but deleting an
-- entire item to correct a mistaken record cascades and removes that item's custody
-- trail, matching the requirement's wording "permanently delete ... to correct a
-- mistaken record." Explicit child-row cleanup in the router was rejected because the
-- old BEFORE DELETE trigger would block it anyway; CASCADE + an UPDATE-only trigger is
-- the minimal correct fix. The other three tables sharing reject_guest_recovery_mutation()
-- (guest_request_events, guest_messages, guest_recovery_actions) are untouched.

ALTER TABLE public.lost_found_custody_events
  DROP CONSTRAINT lost_found_custody_events_lost_found_item_id_fkey;
ALTER TABLE public.lost_found_custody_events
  ADD CONSTRAINT lost_found_custody_events_lost_found_item_id_fkey
  FOREIGN KEY (lost_found_item_id)
  REFERENCES public.lost_found_items(id) ON DELETE CASCADE;

DROP TRIGGER IF EXISTS lost_found_custody_events_immutable
  ON public.lost_found_custody_events;
CREATE TRIGGER lost_found_custody_events_immutable
  BEFORE UPDATE ON public.lost_found_custody_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_guest_recovery_mutation();

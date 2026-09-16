-- =============================================================================
-- Migration 103: Guest request -> engineering work order bridge
-- Lets a guest-reported issue (e.g. AC not cooling) become a linked work order
-- with SLA tracking and completion notifications back to front desk, instead
-- of front desk and engineering keeping separate untracked records.
-- =============================================================================

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS guest_request_id UUID REFERENCES public.guest_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_guest_request
  ON public.work_orders (tenant_id, guest_request_id)
  WHERE guest_request_id IS NOT NULL;

COMMENT ON COLUMN public.work_orders.guest_request_id IS
  'Set when this work order was created via the guest-request bridge (POST /guest-requests/{id}/create-work-order). One active (non-cancelled) work order per guest request is enforced at the application layer, not by a DB constraint.';

-- Refresh PostgREST's schema cache so the new FK is immediately usable for a
-- reverse embed (guest_requests -> work_orders) without waiting on its poll interval.
NOTIFY pgrst, 'reload schema';

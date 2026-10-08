-- People redesign Phase 1: staff invitation lifecycle + meaningless role-schedule cleanup.
-- Forward-only and additive. Written/read only by the API (service role); the existing tenant
-- RLS policy on staff_invitations is unchanged.

ALTER TABLE public.staff_invitations
  ADD COLUMN IF NOT EXISTS full_name       TEXT,
  ADD COLUMN IF NOT EXISTS phone           TEXT,
  ADD COLUMN IF NOT EXISTS revoked_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS send_count      INTEGER NOT NULL DEFAULT 1 CHECK (send_count >= 0),
  ADD COLUMN IF NOT EXISTS delivery_status TEXT CHECK (delivery_status IS NULL OR delivery_status IN ('requested', 'failed', 'existing_account')),
  ADD COLUMN IF NOT EXISTS delivery_error  TEXT;

COMMENT ON COLUMN public.staff_invitations.revoked_at IS 'Set when a GM revokes the invitation (or it is superseded by a reissue). Revoked invitations can never be accepted.';
COMMENT ON COLUMN public.staff_invitations.delivery_status IS 'Outcome of the most recent email-provider request: requested, failed, or existing_account (provider cannot invite an already-registered address). A row is not proof of delivery.';

-- At most one live (not accepted, not revoked) invitation per hotel + email. Existing duplicates are
-- resolved first by revoking all but the newest, so the unique index can be created safely.
UPDATE public.staff_invitations s
   SET revoked_at = now()
 WHERE s.accepted_at IS NULL
   AND s.revoked_at IS NULL
   AND EXISTS (
     SELECT 1 FROM public.staff_invitations n
      WHERE n.tenant_id = s.tenant_id
        AND lower(n.email) = lower(s.email)
        AND n.accepted_at IS NULL
        AND n.revoked_at IS NULL
        AND (n.created_at, n.id) > (s.created_at, s.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_invitations_live_email
  ON public.staff_invitations (tenant_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Role schedules that "override" a person to the role they already hold are meaningless
-- (e.g. an engineer scheduled as engineer). Disable them; rows are kept for history.
UPDATE public.staff_role_schedules s
   SET is_active = false
 WHERE s.is_active = true
   AND EXISTS (
     SELECT 1 FROM public.user_roles r
      WHERE r.user_id = s.user_id
        AND r.tenant_id = s.hotel_id
        AND r.role = s.override_role
   );

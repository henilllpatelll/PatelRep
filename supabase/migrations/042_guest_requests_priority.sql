ALTER TABLE guest_requests
ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('normal', 'urgent'));

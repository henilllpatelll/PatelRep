# External Integrations

**Analysis Date:** 2026-03-12

## APIs & External Services

**AI/Language Models:**
- OpenAI GPT-4o-mini - Fast natural language → task parsing + function calling
  - SDK/Client: `openai` 1.35.0
  - Env var: `OPENAI_API_KEY`
  - Used in: `services/ai/task_parser.py`, `services/ai/sop_rag.py` (embedding generation)
  - Purpose: Real-time task suggestions, SOP document embeddings (500-char chunks)

- Anthropic Claude Sonnet 3.5 - Reasoning-heavy features
  - SDK/Client: `anthropic` 0.29.0
  - Env var: `ANTHROPIC_API_KEY`
  - Used in: `services/ai/sop_rag.py` (RAG answers), `services/ai/predictions.py` (room readiness), `services/ai/failure_predictions.py` (asset failure analysis)
  - Purpose: SOP question answering with pgvector similarity search, room ETA predictions, preventive maintenance risk scoring

**PMS Integration:**
- Oracle Opera Cloud (OHIP) - Property management system
  - Auth: OAuth 2.0 (client credentials + refresh token flow)
  - Config: `opera_oauth_client_id`, `opera_oauth_client_secret`, `opera_oauth_redirect_uri`, `opera_oauth_base_url`
  - Stored credentials: `opera_credentials` table (hotel_id, access_token, refresh_token, token_expires_at, ohip_base_url, is_connected)
  - Implementation: `services/opera/auth.py` (token refresh with 5-min buffer), `services/opera/sync.py` (90-day reservation pagination)
  - Webhook handlers: `services/opera/webhooks.py` (RESERVATION.CHECKED_OUT, CHECKED_IN, MODIFIED, ROOM_STATUS.DO_NOT_DISTURB, MAKE_UP_ROOM)
  - Webhook endpoint: `POST /v1/webhooks/opera` with HMAC-SHA256 signature validation
  - Push: `services/opera/sync.py` → `push_room_status_to_opera` (room status updates → OHIP)

**Payment Processing:**
- Stripe - Subscription billing + credit cap enforcement
  - SDK/Client: `stripe` 10.1.0 (backend), `stripe` 15.12.0 (frontend)
  - Auth: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  - Used in: `routers/billing.py` (subscription queries), `routers/webhooks.py` (webhook events)
  - Purpose: Monthly subscription + overage cap tracking (cap_cents field in subscriptions table)
  - Webhook endpoint: `POST /v1/webhooks/stripe` (implied in webhook router, not yet fully implemented)

## Data Storage

**Databases:**
- PostgreSQL 17 (via Supabase)
  - Connection: Supabase SDK with service role key (admin ops) + user JWT (RLS enforcement)
  - Client: `supabase` 2.5.0 Python SDK, `@supabase/supabase-js` 2.43.4 (web/mobile)
  - Multi-tenancy: Row-level security (RLS) on `tenant_id`, no schema-per-tenant
  - Extensions: `pgvector` (for SOP document embeddings)
  - Backup: Supabase managed (automatic daily backups)

**File Storage:**
- Supabase Storage - Document and photo uploads
  - Buckets:
    - `sop-documents` - PDF uploads for RAG (10 MiB limit, PDF only)
    - `work-order-photos` - Engineering work order attachments (10 MiB limit, JPEG/PNG/WebP)
  - Access: Private (RLS-gated via Supabase auth)
  - Implementation: Web/mobile upload via Supabase storage client

**Caching:**
- Supabase Realtime (WebSocket) - Live room status updates
  - Subscription channels: `rooms`, `room_status`, `room_assignments`, `predictions`
  - Debouncing: 500ms to prevent thrashing (see `RoomStatusBoard.tsx`)
  - Client-side state: Zustand `housekeepingStore` with lastSyncedAt tracking

## Authentication & Identity

**Auth Provider:**
- Supabase Auth - Magic link + password authentication
  - OAuth support: Magic link via email, password sign-up/sign-in
  - JWT: `HS256` signed with `SUPABASE_JWT_SECRET`
  - Custom claims: Injected via Supabase Auth hook (post-confirmation) → `hotel_id` + `role`
  - JWT expiry: 3600 seconds (1 hour)
  - Refresh token rotation: Enabled with 10-second reuse window
  - Implementation:
    - Backend: `middleware/auth.py` → `get_current_user()` decodes JWT and extracts claims
    - Web: `lib/supabase/client.ts` → Supabase JS client (browser auth), `@supabase/ssr` for server-side auth
    - Mobile: `lib/supabase.ts` → Expo Secure Store for token persistence
  - Admin operations: Service role key used for invite-by-email via `supabase.auth.admin.invite_user_by_email()`

## Monitoring & Observability

**Error Tracking:**
- Not detected - No Sentry, Bugsnag, or similar configured

**Logs:**
- Supabase built-in logging (API requests, auth events)
- Application logs: FastAPI lifespan startup/shutdown messages, exception handler (500 errors logged as JSON)
- Python logging: Configured in `services/ai/sop_rag.py` (logger = logging.getLogger(__name__))
- Mobile: No explicit logging framework detected

## CI/CD & Deployment

**Hosting:**
- API: Railway.app (container platform) — Docker image from `apps/api/Dockerfile`
- Web: Vercel (Next.js optimized)
- Mobile: Expo Application Services (EAS) — managed builds + OTA updates

**CI Pipeline:**
- GitHub Actions (`.github/workflows/deploy.yml`, `.github/workflows/mobile-build.yml`)
- **Lint (on every push):**
  - API: Ruff Python linter (`ruff check .`)
  - Web: ESLint + TypeScript type-check
- **Test (API only, after lint):**
  - Smoke tests: `pytest tests/smoke/` with full dependency mocking
  - Trigger: Manual seed of test env vars (SUPABASE_URL, ANTHROPIC_API_KEY, etc.)
- **Deploy (main branch, push only):**
  - API: Railway token-based deployment (if lint + test pass)
  - Web: Vercel token-based deployment (if lint passes)
  - Mobile: Separate `mobile-build.yml` (builds + submits to App Store/Google Play)

**Health Checks:**
- Railway: Health check endpoint at `GET /health` (checks DB connectivity, returns status + version)
- Restart policy: On failure, max 3 retries

## Environment Configuration

**Required env vars:**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Server-side admin key
- `SUPABASE_JWT_SECRET` - HS256 key for JWT validation
- `OPENAI_API_KEY` - GPT-4o-mini access
- `ANTHROPIC_API_KEY` - Claude Sonnet access
- `STRIPE_SECRET_KEY` - Stripe live/test key
- `STRIPE_WEBHOOK_SECRET` - Webhook signature validation

**Optional env vars:**
- `OPERA_OAUTH_CLIENT_ID` - Opera OHIP OAuth ID
- `OPERA_OAUTH_CLIENT_SECRET` - Opera OHIP OAuth secret
- `OPERA_OAUTH_REDIRECT_URI` - OAuth callback URI (default: `https://api.oracle.com`)
- `OPERA_OAUTH_BASE_URL` - Opera API base (default: `https://api.oracle.com`)
- `CRON_SECRET` - Internal cron job secret (default: `"dev-secret"`)
- `APP_ENV` - Environment name (default: `"development"`)
- `APP_URL` - Frontend URL for CORS (default: `http://localhost:3000`)
- `API_URL` - Backend URL (default: `http://localhost:8000`)

**Public env vars (client-side, web/mobile):**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase public project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key (for client-side auth)

**Secrets location:**
- Development: `.env` file (local, Git-ignored)
- Production: Railway/Vercel environment variables (managed via platform UI)
- `.env.example` provided in `apps/api/` for reference

## Webhooks & Callbacks

**Incoming:**
- `POST /v1/webhooks/opera` - Opera Cloud Business Events (RESERVATION.*, ROOM_STATUS.*)
  - Signature validation: HMAC-SHA256 with secret `CRON_SECRET:hotel_id`
  - Handlers: `services/opera/webhooks.py` (5 event types: checkout, checkin, modified, DND, make_up_room)

- `POST /v1/webhooks/stripe` - Stripe billing events
  - Signature validation: Stripe's X-Stripe-Signature header (not yet fully implemented)
  - Expected events: customer.subscription.updated, customer.subscription.deleted, invoice.payment_succeeded

**Outgoing:**
- Opera Cloud status push: `services/opera/sync.py` → `push_room_status_to_opera(hotel_id, room_id, status)`
  - Triggers: Room status transitions via `routers/rooms.py`
  - OAuth-authenticated OHIP requests

**Background Jobs:**
- Railway Cron (via Railway scheduler, not built-in):
  - `POST /v1/internal/opera/sync-reservations` - Cron job to sync all connected hotels' reservations every 30 minutes
  - `POST /v1/internal/predictions/run` - Asset failure prediction engine (scheduled)
  - Header validation: `X-Cron-Secret` matches `CRON_SECRET`

## Data Flow Summary

1. **Hotel Setup:** Guest Manager initiates onboarding → Magic link auth → Hotel + departments created → Supabase RLS context established
2. **Room Management:** Staff view/update room status → WebSocket Realtime broadcast → All clients sync housekeepingStore
3. **SOP Queries:** Staff ask question → OpenAI embedding → pgvector similarity search → Claude Sonnet RAG answer → logged to ai_interactions
4. **Room Predictions:** Background cron → Analyze room history + housekeeper profiles → Claude failure/ETA predictions → upsert room_readiness_predictions → NotificationPanel displays HIGH/MEDIUM risk
5. **Opera Sync:** Opera webhook fires (checkin/checkout) → idempotent upsert reservation → room status auto-updated → pushed back to Opera (two-way sync)
6. **Work Orders:** Asset failure prediction → Create work order → Engineer updates status → Stripe tracks AI credits used → Credit ledger enforced
7. **Billing:** Monthly subscription active → Credit pool replenished → Per-interaction cost deducted → Cap enforced at $2.50/room/month (via overage_cost_cents)

---

*Integration audit: 2026-03-12*

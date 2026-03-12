# Architecture

**Analysis Date:** 2026-03-12

## Pattern Overview

**Overall:** Modular multi-tier SaaS architecture with:
- **Frontend:** Next.js 14 (web dashboard) + React Native/Expo (mobile staff app)
- **Backend:** FastAPI REST API with AI orchestration and background jobs
- **Data:** Supabase PostgreSQL + pgvector (multi-tenant with RLS policies)
- **Authentication:** Supabase Auth with JWT custom claims injection (hotel_id + role)

**Key Characteristics:**
- Multi-tenant isolation via Row-Level Security (RLS) policies on every table with `tenant_id`
- JWT custom claims carry `hotel_id` and `role` for authorization
- Real-time capabilities via Supabase Realtime WebSocket subscriptions
- AI model routing: GPT-4o-mini for fast NL→task parsing, Claude Sonnet for RAG and complex predictions
- Offline-first mobile with Expo SQLite + sync queue (last-write-wins conflict resolution)
- Opera Cloud hybrid sync: webhooks for real-time events + 30-min polling for reports

## Layers

**Database (Supabase PostgreSQL 15):**
- Purpose: Multi-tenant data store with RLS enforcement, vector embeddings for RAG
- Location: Cloud-hosted Supabase (PostgreSQL 15 + pgvector extension)
- Contains: 13 migrations defining 30+ tables (tenants, users, rooms, tasks, work_orders, assets, inspections, sop_chunks, billing, etc.)
- Depends on: Extension: pgvector (for embeddings), RLS policies in auth schema
- Used by: All three client applications (web, mobile, API itself)

**API Gateway + Authentication (FastAPI):**
- Purpose: HTTP request routing, JWT validation, role-based access control, rate limiting
- Location: `apps/api/main.py` (app entrypoint) + `apps/api/middleware/auth.py`
- Contains:
  - Security headers middleware (CORS, CSP, X-Frame-Options)
  - JWT decoder validating Supabase tokens + extracting hotel_id/role claims
  - Role checker dependency (require_role) for endpoint protection
  - 17 routers with /v1 API prefix
- Depends on: Supabase JWT secret (from settings)
- Used by: Web frontend, mobile app, third-party integrations

**Business Logic Routers (FastAPI Routers):**
- Purpose: REST endpoints for domain operations (hotels, rooms, housekeeping, tasks, etc.)
- Location: `apps/api/routers/` (19 files + __init__.py)
- Contains:
  - `hotels.py`: Hotel CRUD + tenant setup + subscription initialization
  - `rooms.py`: Room status transitions (9 state machine), floor/type filtering, cleaning time tracking
  - `housekeeping.py`: Board state, task assignments, inspection workflows, AI auto-assign
  - `scheduling.py`: Shift CRUD, staff assignments, clock-in/out, roster queries
  - `sop.py`: Document upload, PDF indexing, RAG query interface
  - `assets.py`, `work_orders.py`, `tasks.py`, `ai_copilot.py`, etc.
- Depends on: Middleware (auth), Models (request/response schemas), Services (business logic)
- Used by: Client applications via REST calls

**Service Layer (Business Logic + AI Orchestration):**
- Purpose: Core business logic, external service integration, AI model orchestration
- Location: `apps/api/services/`
- Contains:
  - `ai/` (6 modules): SOP RAG (pdfplumber + OpenAI embedding + Claude retrieval), room readiness predictions, asset failure predictions, task parsing, shift summaries
  - `opera/` (3 modules): OAuth token management, reservation sync, webhook handlers
  - `billing/` (stub for Stripe integration)
- Depends on: Supabase client, OpenAI/Anthropic APIs, httpx for external requests
- Used by: Routers (via dependency injection or direct import)

**Web Frontend (Next.js 14):**
- Purpose: Manager/supervisor web dashboard (room board, staff management, engineering, reports, billing)
- Location: `apps/web/`
- Contains:
  - `app/` (App Router): Layout templates, page components, route handlers
  - `components/`: Feature-specific components (housekeeping, engineering, shared UI)
  - `lib/api/`: Typed API clients wrapping REST calls
  - `lib/hooks/`: Custom hooks (useAuth, useRole, useQuery wrappers)
  - `lib/supabase/`: Client and server Supabase instances
  - `stores/`: Zustand stores (authStore, hotelStore, housekeepingStore, engineeringStore)
- Depends on: API (FastAPI via fetch), Supabase (auth + realtime subscriptions)
- Used by: End users (managers/supervisors) in browser

**Mobile Frontend (React Native + Expo):**
- Purpose: Primary interface for housekeeping, engineering, front desk staff (tasks, room assignments, work orders)
- Location: `apps/mobile/`
- Contains:
  - `app/` (Expo Router): Route structure (_layout, auth screens, app tabs)
  - `components/`: Feature-specific screens (housekeeping, engineering, copilot, etc.)
  - `lib/`: Supabase client, API client, offline SQLite management, notifications
  - `lib/offline/`: Sync queue for offline-to-online reconciliation
  - `stores/`: Zustand app state
- Depends on: API (FastAPI), Supabase (realtime), Expo Push Service (notifications), SQLite (offline cache)
- Used by: Staff (housekeepers, engineers, front desk) on mobile devices

## Data Flow

**Room Status Sync (Real-time):**

1. **Mobile/Web client** displays room from local state
2. **Supabase Realtime subscription** listens to `rooms` table (filtered by hotel_id via RLS)
3. **API endpoint** (e.g., `POST /v1/housekeeping/rooms/{id}/status`) validates state transition
4. **Supabase RLS policy** ensures user's hotel_id matches room's tenant_id
5. **Database update** triggers: status change, timestamp update, history row insertion
6. **Realtime broadcast** sends change to all subscribed clients
7. **Mobile receives** update, persists to SQLite, reflects in UI

**SOP RAG Query (Synchronous):**

1. **Staff member** asks question via "Ask AI" in mobile/web
2. **Request** sent to `POST /v1/sop/query` with hotel_id, question text
3. **Service** (`sop_rag.py`):
   - Calls Supabase RPC `match_sop_chunks` (pgvector similarity search)
   - Retrieves top-5 chunks as context
   - Sends to Claude Sonnet with hotel SOPs + question
   - Parses response for SUGGESTED_TASKS JSON block
4. **Claude returns** step-by-step answer + extracted tasks
5. **API returns** answer + sources + suggested tasks to client
6. **Client displays** formatted answer, allows "Create Tasks" CTA

**Room Readiness Prediction (Background Job):**

1. **Railway Cron** triggers `POST /v1/internal/predictions/run` with CRON_SECRET header
2. **Endpoint** calls `run_all_hotel_predictions()` service
3. **Service** for each hotel:
   - Fetches all rooms + current assignments
   - Calls OpenAI to analyze room type + housekeeper history
   - Runs Claude Sonnet prompt: estimate clean time, assess risk factors
   - Upserts predictions to `room_readiness_predictions` table
   - Calls `notify_supervisors_high_risk()` for HIGH risk rooms (Supabase edge function → Expo Push)
4. **Prediction visible** in web dashboard PredictionPanel (with ETA, risk level)
5. **Supervisor alerted** via push notification on mobile

**Opera Cloud Reservation Sync (Hybrid):**

1. **Incoming webhook** from Opera: checkout, checkin, DND, make-up-room (processed immediately)
2. **HMAC validation** using Opera webhook secret (production only)
3. **Handler** (e.g., `checkin_handler`): Updates room special_requests, checkin_time, guest_name
4. **Scheduled sync** (every 30 min): `POST /v1/internal/opera/sync-reservations` cron job
5. **Service** (`sync.py`):
   - Gets OAuth token (5-min buffer, auto-refresh)
   - Requests 90-day reservations from OHIP API (paginated)
   - Maps Opera schema to PatelRep schema
   - Upserts to `reservations` table
   - Gracefully degraded if API fails (returns empty dict)
6. **Web dashboard** displays guest info, checkin time, VIP flag on room cards

**State Management:**

- **Web:** Zustand stores (authStore, hotelStore, housekeepingStore) manage client state
  - `authStore`: user, session, role, loading
  - `hotelStore`: current hotel, departments, staff list
  - `housekeepingStore`: rooms, assignments, predictions, filters
- **Mobile:** Zustand appStore + offline SQLite
  - SQLite mirrors `rooms`, `tasks`, `work_orders` for offline access
  - Sync queue tracks mutations (`[table]_[id]_[action]`)
  - On reconnect: Resolves conflicts with server-wins logic
- **Realtime:** Both platforms subscribe to table changes, update stores directly
  - Web: `supabase.on('postgres_changes', ...)` updates Zustand
  - Mobile: Same pattern + sync queue insertion

## Key Abstractions

**Hotel Tenant (Multi-tenancy):**
- Purpose: Represent a single hotel property with its own staff, rooms, settings
- Examples: `tenants` table, `user_roles` junction, RLS policies
- Pattern: Every table has `tenant_id` foreign key + RLS policy `(auth.jwt() ->> 'hotel_id')::uuid = tenant_id`

**Room State Machine (9 States):**
- Purpose: Enforce valid room status transitions
- Examples: `routers/rooms.py` `_validate_transition()`, status history logging
- Pattern: Enum states (VACANT, OCCUPIED, CLEAN, INSPECTED, DIRTY, DO_NOT_DISTURB, OUT_OF_ORDER, BLOCKED, IN_PROGRESS), validation before insert

**Role-Based Access Control (RBAC):**
- Purpose: Enforce function access based on user role
- Examples: `require_role('gm', 'housekeeping_supervisor')`, role extracted from JWT claims
- Pattern: FastAPI dependency injection for middleware check, stored in auth JWT + Supabase user metadata

**Realtime Subscription Manager:**
- Purpose: Live UI updates without polling
- Examples: Web `RoomStatusBoard` subscribes to rooms, mobile housekeeping tab subscribes
- Pattern: `supabase.channel()` listen for INSERT/UPDATE/DELETE, Zustand dispatch on change

**AI Model Dispatcher:**
- Purpose: Route NL requests to appropriate AI model
- Examples: GPT-4o-mini for task parsing, Claude Sonnet for RAG + predictions
- Pattern: Service layer (`services/ai/`) has separate modules per task, routers call appropriate service

**SOP RAG Pipeline:**
- Purpose: Index hotel SOPs as vector embeddings, retrieve via semantic search
- Examples: `sop_rag.py` chunks PDF → OpenAI embedding → pgvector store → query via RPC
- Pattern: Upload triggers background indexing, query uses Claude + context for grounding

**Offline Sync Queue (Mobile):**
- Purpose: Queue mutations when offline, sync when online
- Examples: `lib/offline/syncQueue.ts`, tracks `[table]_[id]_[action]` JSON
- Pattern: Mutation writes locally first, adds to queue, on reconnect: batch POST to `/v1/sync` endpoint (server-wins conflict)

## Entry Points

**API Entry:**
- Location: `apps/api/main.py`
- Triggers: FastAPI startup, typically via Railway container port 8080
- Responsibilities: CORS setup, middleware registration, health check, 17 router includes

**Web App Entry:**
- Location: `apps/web/app/layout.tsx`
- Triggers: Browser navigation to patelrep.com
- Responsibilities: Global layout, Providers wrapper (AuthListener), redirect logic in middleware.ts

**Web Onboarding:**
- Location: `apps/web/app/(dashboard)/onboarding/page.tsx`
- Triggers: Authenticated user with no hotel_id
- Responsibilities: 6-step hotel setup wizard (Hotel Profile → Rooms → Staff → Opera → SOPs → Done)

**Mobile App Entry:**
- Location: `apps/mobile/app/_layout.tsx` (Expo Router root)
- Triggers: App launch after Expo splash screen
- Responsibilities: Auth check, redirect to login or app tabs

**Internal Cron Endpoints:**
- Location: `apps/api/routers/internal.py`
- Triggers: Railway Cron Job HTTP POST with CRON_SECRET header
- Responsibilities:
  - `POST /internal/predictions/run`: Room readiness predictions
  - `POST /internal/opera/sync-reservations`: Reservation bulk sync
  - `POST /internal/assets/predict-failures`: Asset failure predictions

## Error Handling

**Strategy:** Graceful degradation with structured error responses

**Patterns:**

- **API errors:** Consistent JSON schema `{"error": {"code": "ERROR_CODE", "message": "..."}}`
- **Auth errors:** 401 for invalid token, 403 for insufficient role
- **External service failures:** Catch httpx exceptions (timeout, 401, 404), return empty dict (no-op)
- **Database RLS violations:** Supabase returns 4xx, API translates to 403
- **Mobile offline:** Queue mutations locally, retry on reconnect
- **Web realtime disconnect:** Store state, attempt reconnect with exponential backoff

Examples:
- `services/opera/sync.py` catches `httpx.TimeoutException` + `httpx.HTTPStatusError`, returns empty dict
- `middleware/auth.py` raises HTTPException(401) on token decode failure
- Mobile sync queue persists to SQLite on save failure, retries next sync

## Cross-Cutting Concerns

**Logging:** Print statements to stdout (Railway logs), logged with timestamps in FastAPI startup/shutdown

**Validation:**
- Pydantic models in `apps/api/models/requests.py` enforce schema
- FastAPI auto-validates request bodies
- Web forms use `react-hook-form` + Zod schema

**Authentication:**
- Supabase JWT issued on login (magic link or password)
- FastAPI middleware decodes JWT using supabase_jwt_secret
- Web middleware checks auth.getUser() on every request

**Authorization:**
- RLS policies on PostgreSQL tables enforce tenant_id isolation
- Role-based checks via require_role() dependency
- JWT claims carry hotel_id + role (injected by Supabase Auth Hook)

**Rate Limiting:**
- SlowAPI configured in main.py (limiter per IP by default)
- Limit handler returns RateLimitExceeded exception response

**i18n (Internationalization):**
- Web + Mobile: react-i18next with EN + ES locales
- Translation keys in `i18n/locales/en.json` and `es.json`
- useTranslation() hook provides t() function

---

*Architecture analysis: 2026-03-12*

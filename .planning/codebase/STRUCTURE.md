# Codebase Structure

**Analysis Date:** 2026-03-12

## Directory Layout

```
PatelRep/
├── spec/                          # 13 specification documents
│   ├── 00_overview.md
│   ├── 01_architecture.md
│   ├── 02_database_schema.md
│   ├── 03_api_endpoints.md
│   ├── ... (10 more)
├── supabase/                      # Database migrations + seed
│   ├── config.toml
│   ├── migrations/                # 018 SQL migration files (extensions → functions)
│   └── seed.sql
├── apps/
│   ├── api/                       # FastAPI backend (Python 3.12)
│   │   ├── main.py                # App entrypoint (FastAPI setup, router includes)
│   │   ├── requirements.txt        # Python dependencies
│   │   ├── Dockerfile             # Railway container config
│   │   ├── .env.example
│   │   ├── core/                  # Config + database clients
│   │   │   ├── config.py          # Settings (Pydantic)
│   │   │   └── database.py        # Supabase client factory
│   │   ├── middleware/            # Request processing
│   │   │   ├── auth.py            # JWT decode, CurrentUser, require_role()
│   │   │   └── credits.py         # AI credit metering (stub)
│   │   ├── models/                # Request/response Pydantic schemas
│   │   │   └── requests.py        # All input schemas (CreateHotel, InviteStaff, etc.)
│   │   ├── routers/               # 19 domain routers
│   │   │   ├── hotels.py          # POST/GET/PATCH hotels, billing status
│   │   │   ├── rooms.py           # Room CRUD, status transitions, import CSV
│   │   │   ├── housekeeping.py    # Board, assignments, inspections, AI auto-assign
│   │   │   ├── scheduling.py      # Shifts, staff assignments, clock-in/out
│   │   │   ├── tasks.py           # Task creation, completion, priority
│   │   │   ├── work_orders.py     # Work order CRUD, asset linking
│   │   │   ├── assets.py          # Asset registry, PM schedules
│   │   │   ├── sop.py             # SOP document CRUD, RAG query
│   │   │   ├── ai_copilot.py      # Copilot chat, insights
│   │   │   ├── integrations.py    # Opera OAuth flow, connect/disconnect
│   │   │   ├── webhooks.py        # Opera events, Stripe webhooks
│   │   │   ├── internal.py        # Cron endpoints (predict, sync, etc.)
│   │   │   ├── billing.py         # Subscription queries
│   │   │   ├── notifications.py   # Push notification management
│   │   │   ├── staff.py           # Staff invite, deactivation, profile
│   │   │   ├── auth.py            # Signup, login, password reset
│   │   │   ├── guest_requests.py
│   │   │   ├── logbook.py
│   │   │   ├── reports.py
│   │   │   ├── lost_found.py
│   │   │   ├── onboarding.py
│   │   │   └── __init__.py        # Router exports
│   │   ├── services/              # Business logic + external APIs
│   │   │   ├── ai/                # AI orchestration
│   │   │   │   ├── sop_rag.py     # PDF chunking, OpenAI embedding, Claude retrieval
│   │   │   │   ├── predictions.py # Room readiness analysis
│   │   │   │   ├── failure_predictions.py # Asset failure analysis
│   │   │   │   ├── task_parser.py # NL → task parsing (GPT-4o-mini)
│   │   │   │   ├── shift_summary.py # Daily shift summaries
│   │   │   │   ├── insights.py    # GM insights generation
│   │   │   │   └── __init__.py    # Exports all AI functions
│   │   │   ├── opera/             # PMS integration
│   │   │   │   ├── auth.py        # OAuth token refresh, credential storage
│   │   │   │   ├── sync.py        # Reservation sync, OHIP API calls
│   │   │   │   ├── webhooks.py    # Webhook handlers (checkout, checkin, DND)
│   │   │   │   └── __init__.py
│   │   │   ├── billing/           # Stripe integration (stub)
│   │   │   └── __init__.py
│   │   └── tests/
│   │       └── smoke/             # Basic smoke tests
│   │
│   ├── web/                       # Next.js 14 dashboard (TypeScript)
│   │   ├── app/                   # App Router pages + layouts
│   │   │   ├── layout.tsx         # Root layout (Providers, global styles)
│   │   │   ├── (auth)/            # Public auth routes (no dashboard layout)
│   │   │   │   ├── login/page.tsx # Sign in + magic link + forgot password
│   │   │   │   └── _layout.tsx    # Auth layout (no header/sidebar)
│   │   │   ├── auth/              # Non-layout-grouped routes
│   │   │   │   ├── callback/page.tsx # Magic link exchange
│   │   │   │   └── reset-password/page.tsx # Password reset
│   │   │   └── (dashboard)/       # Protected dashboard routes
│   │   │       ├── layout.tsx     # Dashboard layout (Header, Sidebar)
│   │   │       ├── dashboard/page.tsx # GM dashboard (overview, stats)
│   │   │       ├── onboarding/page.tsx # 6-step hotel setup wizard
│   │   │       ├── housekeeping/  # Housekeeping feature pages
│   │   │       │   ├── page.tsx   # Room board + assignment sidebar
│   │   │       │   ├── assignments/page.tsx
│   │   │       │   ├── inspections/page.tsx
│   │   │       │   └── rooms/page.tsx
│   │   │       ├── scheduling/page.tsx # Weekly schedule calendar
│   │   │       ├── engineering/   # Engineering feature pages
│   │   │       │   ├── page.tsx
│   │   │       │   ├── assets/page.tsx
│   │   │       │   ├── predictions/page.tsx
│   │   │       │   └── pm-schedules/page.tsx
│   │   │       ├── sop/page.tsx   # SOP library + document upload
│   │   │       ├── settings/      # Hotel + integration settings
│   │   │       │   ├── page.tsx   # Hotel profile + departments
│   │   │       │   ├── integrations/page.tsx # Opera OAuth
│   │   │       │   └── billing/page.tsx
│   │   │       ├── staff/page.tsx # Staff list + invite modal
│   │   │       ├── tasks/page.tsx
│   │   │       ├── guest-requests/page.tsx
│   │   │       ├── logbook/page.tsx
│   │   │       ├── reports/page.tsx
│   │   │       ├── lost-found/page.tsx
│   │   │       ├── billing/page.tsx
│   │   │       └── error.tsx      # Error boundary
│   │   ├── error.tsx              # Global error page
│   │   ├── middleware.ts          # Auth redirect logic (login → onboarding → dashboard)
│   │   ├── components/            # Reusable components
│   │   │   ├── shared/            # Layout + auth components
│   │   │   │   ├── Header.tsx     # Top bar (user avatar, role badge)
│   │   │   │   ├── Sidebar.tsx    # Left nav (role-aware menu)
│   │   │   │   ├── Providers.tsx  # Context providers (AuthListener bootstraps stores)
│   │   │   │   └── ...
│   │   │   ├── housekeeping/      # Housekeeping-specific
│   │   │   │   ├── RoomCard.tsx   # Room status card (8-color system, VIP badge)
│   │   │   │   ├── RoomDetailDrawer.tsx # Slide-in with history + transitions
│   │   │   │   ├── RoomStatusBoard.tsx # Main board (realtime, debounced)
│   │   │   │   ├── AssignmentSidebar.tsx # HK workload + AI suggestions
│   │   │   │   ├── InspectionModal.tsx # Checklist UI
│   │   │   │   └── PredictionPanel.tsx # At-risk rooms panel
│   │   │   ├── engineering/       # Engineering-specific
│   │   │   │   └── ...
│   │   │   ├── ai/                # AI components
│   │   │   │   └── SOPQueryModal.tsx # RAG query UI
│   │   │   ├── dashboard/         # Dashboard-specific
│   │   │   └── ui/                # Shadcn/ui base components
│   │   ├── lib/                   # Utilities + clients
│   │   │   ├── api/               # API client layer (typed)
│   │   │   │   ├── client.ts      # Axios/fetch wrapper with auth headers
│   │   │   │   ├── hotels.ts      # hotelsApi.createHotel(), .getHotel(), etc.
│   │   │   │   ├── rooms.ts       # roomsApi.updateStatus(), .importCSV(), etc.
│   │   │   │   ├── housekeeping.ts # housekeepingApi.getBoard(), .submit Inspection(), etc.
│   │   │   │   ├── scheduling.ts  # schedulingApi.listShifts(), .clockIn(), etc.
│   │   │   │   ├── sop.ts         # sopApi.query(), .uploadDocument(), etc.
│   │   │   │   ├── integrations.ts # integrationsApi.connectOpera(), .syncOpera(), etc.
│   │   │   │   └── ...
│   │   │   ├── hooks/             # Custom React hooks
│   │   │   │   ├── useAuth.ts     # Bootstrap auth state, onAuthStateChange
│   │   │   │   ├── useRole.ts     # Role permission helpers (isGM, canAssignRooms)
│   │   │   │   └── ...
│   │   │   ├── supabase/
│   │   │   │   ├── client.ts      # Browser Supabase client (no service role key)
│   │   │   │   └── server.ts      # Server Supabase client (middleware only)
│   │   │   ├── utils/             # Helper functions
│   │   │   │   ├── roomStatus.ts  # STATUS_LABELS, STATUS_COLORS, getValidTransitions()
│   │   │   │   └── ...
│   │   ├── stores/                # Zustand state management
│   │   │   ├── authStore.ts       # user, session, role, isLoading
│   │   │   ├── hotelStore.ts      # current hotel, departments, staff
│   │   │   ├── housekeepingStore.ts # rooms, assignments, predictions, filters
│   │   │   └── engineeringStore.ts # assets, work orders, predictions
│   │   ├── i18n/
│   │   │   └── locales/           # Translation JSON files
│   │   │       ├── en.json        # English strings
│   │   │       └── es.json        # Spanish strings
│   │   ├── types/                 # TypeScript type definitions
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   ├── package.json
│   │   └── .env.example
│   │
│   └── mobile/                    # React Native + Expo (TypeScript)
│       ├── app/                   # Expo Router structure
│       │   ├── _layout.tsx        # Root layout (AuthListener, tab nav)
│       │   ├── (auth)/            # Auth routes (login, signup, forgot password)
│       │   ├── (app)/             # Protected app tabs
│       │   │   ├── my-rooms/      # HK assigned rooms list
│       │   │   ├── tasks/         # Task list + creation
│       │   │   ├── work-orders/   # Work order list + creation
│       │   │   ├── copilot/       # AI assistant chat
│       │   │   ├── profile/       # User profile + settings
│       │   │   └── notifications/ # Notification center
│       ├── components/            # Reusable components
│       │   ├── shared/            # Navigation, modals, common UI
│       │   ├── housekeeping/      # Housekeeping-specific screens
│       │   ├── engineering/       # Engineering-specific screens
│       │   └── copilot/           # Copilot chat UI
│       ├── lib/                   # Utilities + offline sync
│       │   ├── api/               # API client (same as web, mobile-typed)
│       │   ├── supabase.ts        # Mobile Supabase client instance
│       │   ├── offline/           # Offline + sync functionality
│       │   │   ├── database.ts    # Expo SQLite setup
│       │   │   └── syncQueue.ts   # Queue mutations, sync on reconnect
│       │   └── notifications.ts   # Expo Push integration
│       ├── stores/                # Zustand state
│       │   └── appStore.ts        # user, hotel, rooms, tasks, status
│       ├── i18n/
│       │   └── locales/           # EN + ES translations
│       ├── package.json
│       ├── app.json               # Expo config (plugins, schemes)
│       ├── eas.json               # EAS Build config
│       ├── tsconfig.json
│       └── .env.example
│
├── .github/
│   └── workflows/                 # GitHub Actions
│       ├── deploy.yml             # API + web deploy on main push
│       └── mobile-build.yml       # EAS mobile build
├── .planning/
│   └── codebase/                  # GSD codebase documentation
│       ├── ARCHITECTURE.md        # (This file)
│       ├── STRUCTURE.md           # Directory layout + file locations
│       ├── STACK.md               # Technology stack
│       ├── INTEGRATIONS.md        # External services
│       ├── CONVENTIONS.md         # Code style + patterns
│       ├── TESTING.md             # Test setup + patterns
│       └── CONCERNS.md            # Tech debt + issues
├── package.json                   # Workspace root (npm workspaces)
├── railway.toml                   # Railway deployment config
├── .gitignore
├── LAUNCH_GUIDE.md                # How to run locally + deploy
└── REMAINING_WORK.md              # Outstanding implementation tasks
```

## Directory Purposes

**spec/:**
- Purpose: Specification documents defining MVP requirements, architecture, schema, endpoints, deployment
- Contains: 13 markdown files (00_overview.md through 12_roadmap.md)
- Key files: `01_architecture.md` (system diagram), `02_database_schema.md` (table definitions), `03_api_endpoints.md` (endpoint specs)

**supabase/:**
- Purpose: Database version control and seed data
- Contains: 18 SQL migration files (incremental schema changes), config.toml (Supabase project settings)
- Key files:
  - `migrations/001_extensions.sql` – Install pgvector
  - `migrations/002_tenants.sql` – Tenant + subscription tables
  - `migrations/003_users_roles.sql` – Multi-tenant RBAC
  - `migrations/016_rls_policies.sql` – Row-level security policies
  - `migrations/017_functions.sql` – Postgres stored procedures (RPC endpoints)

**apps/api/:**
- Purpose: Backend REST API server
- Contains: Python 3.12 FastAPI application with routers, services, middleware, models
- Key files:
  - `main.py` – FastAPI app initialization (entry point)
  - `core/config.py` – Settings and configuration
  - `core/database.py` – Supabase client factory
  - `middleware/auth.py` – JWT validation and role checking
  - `routers/` – 19 domain-specific endpoint modules
  - `services/ai/` – AI orchestration (RAG, predictions, task parsing)
  - `services/opera/` – PMS integration

**apps/web/:**
- Purpose: Next.js 14 web dashboard for managers/supervisors
- Contains: TypeScript React components, API clients, state management, pages
- Key files:
  - `app/layout.tsx` – Root layout with Providers
  - `middleware.ts` – Auth redirect logic
  - `components/` – Feature-specific and shared UI components
  - `lib/api/` – Typed REST API clients
  - `lib/hooks/` – useAuth, useRole, custom query hooks
  - `stores/` – Zustand state management
  - `i18n/locales/` – EN + ES translations

**apps/mobile/:**
- Purpose: Expo React Native app for staff (iOS + Android)
- Contains: TypeScript React Native screens, offline sync, notifications
- Key files:
  - `app/_layout.tsx` – Expo Router root
  - `lib/offline/` – SQLite database + sync queue
  - `lib/notifications.ts` – Expo Push integration
  - `stores/appStore.ts` – Global state (user, hotel, rooms, tasks)

## Key File Locations

**Entry Points:**

- **API:** `apps/api/main.py` – FastAPI app startup, router includes, health endpoint
- **Web:** `apps/web/app/layout.tsx` – Root layout (Providers wrapper)
- **Web Auth Guard:** `apps/web/middleware.ts` – Redirects unauthenticated users to login, unshipped users to onboarding
- **Mobile:** `apps/mobile/app/_layout.tsx` – Expo Router root, auth check, tab navigation

**Configuration:**

- **API config:** `apps/api/core/config.py` (Pydantic Settings for API_KEY, Supabase URL, etc.)
- **Supabase schema:** `supabase/migrations/` (18 .sql files, incremental)
- **Web env:** `apps/web/.env.example` (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)
- **Mobile env:** `apps/mobile/.env.example` (EXPO_PUBLIC_SUPABASE_URL, etc.)

**Core Logic:**

- **Authentication:** `apps/api/middleware/auth.py` (JWT decode) + `apps/web/lib/hooks/useAuth.ts` (client-side state)
- **Multi-tenancy:** Supabase RLS policies in `supabase/migrations/016_rls_policies.sql`
- **Housekeeping board:** `apps/web/components/housekeeping/RoomStatusBoard.tsx` + `apps/web/stores/housekeepingStore.ts`
- **SOP RAG:** `apps/api/services/ai/sop_rag.py` (embedding + retrieval)
- **Opera sync:** `apps/api/services/opera/sync.py` (reservation fetch + map)

**Testing:**

- **API tests:** `apps/api/tests/smoke/` (basic integration tests)
- **Test config:** No Jest/pytest.ini files found (tests minimal)

## Naming Conventions

**Files:**

- **API routers:** `{domain}.py` (hotels.py, rooms.py, housekeeping.py) – kebab-case optional
- **Services:** `{feature}.py` in `services/{module}/` (sop_rag.py, predictions.py)
- **Web pages:** `{feature}/page.tsx` in `app/(dashboard)/{feature}/`
- **Web components:** `{ComponentName}.tsx` in `components/{domain}/` – PascalCase
- **Web utils:** `{utility}.ts` in `lib/utils/` – camelCase
- **Web stores:** `{featureName}Store.ts` – camelCase with "Store" suffix
- **Web API clients:** `{domain}Api.ts` or `{domain}.ts` in `lib/api/`

**Directories:**

- **API routers:** `apps/api/routers/` – each file is a single domain (hotels, rooms, etc.)
- **Services:** `apps/api/services/{integration}/` – grouped by integration (ai, opera, billing)
- **Web pages:** `apps/web/app/(dashboard)/{feature}/` – grouped by feature (housekeeping, engineering)
- **Web components:** `apps/web/components/{category}/` – categorized (shared, housekeeping, engineering, ui)
- **Mobile screens:** `apps/mobile/app/(app)/{feature}/` – grouped by feature (my-rooms, tasks, work-orders)

## Where to Add New Code

**New API Endpoint (e.g., guest request creation):**
- **Primary code:** `apps/api/routers/guest_requests.py` (if not already present, create it)
- **Models:** Add request schema to `apps/api/models/requests.py` (e.g., CreateGuestRequestRequest)
- **Service logic:** If complex, create `apps/api/services/guest_requests.py`
- **Tests:** Add test in `apps/api/tests/smoke/test_guest_requests.py`

**New Web Page (e.g., reports page):**
- **Implementation:** `apps/web/app/(dashboard)/reports/page.tsx`
- **API client:** Add methods to `apps/web/lib/api/reports.ts` (create this file if needed)
- **Components:** Create feature folder `apps/web/components/reports/` for ReportCard, ReportModal, etc.
- **State:** If needed, add to `apps/web/stores/housekeepingStore.ts` or create new store
- **i18n:** Add translation keys to `apps/web/i18n/locales/en.json` and `es.json`

**New Mobile Screen (e.g., engineering tasks):**
- **Screen:** `apps/mobile/app/(app)/engineering-tasks/page.tsx`
- **API client:** Add methods to `apps/mobile/lib/api/engineering.ts`
- **Components:** Create `apps/mobile/components/engineering/EngineeringTaskCard.tsx`, etc.
- **Offline sync:** If mutations, add table to SQLite schema in `apps/mobile/lib/offline/database.ts`
- **Notifications:** Wire up push in `apps/mobile/lib/notifications.ts` if needed

**New Shared Utility:**
- **Web helper:** `apps/web/lib/utils/{featureName}.ts`
- **Mobile helper:** `apps/mobile/lib/{featureName}.ts`
- **API helper:** `apps/api/services/{module}/{helper}.py` or `apps/api/core/{helper}.py` if cross-router

**New External Integration (e.g., Twilio for SMS):**
- **Service module:** `apps/api/services/twilio/` with auth.py, client.py, webhooks.py
- **Router:** Add `apps/api/routers/notifications.py` endpoint (or extend existing)
- **Config:** Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN to `apps/api/core/config.py`

## Special Directories

**supabase/migrations/:**
- Purpose: Version-controlled SQL schema changes
- Generated: No (manually written)
- Committed: Yes, all 18 files tracked in git
- Pattern: Sequential numbering (001_, 002_, ...), idempotent (CREATE OR REPLACE)

**apps/web/.next/ and apps/web/node_modules/:**
- Purpose: Build artifacts and dependencies
- Generated: Yes (.next from `next build`, node_modules from npm install)
- Committed: No (in .gitignore)

**apps/mobile/node_modules/ and .expo/:**
- Purpose: Expo dependencies and cache
- Generated: Yes
- Committed: No (.gitignore)

**.planning/codebase/:**
- Purpose: GSD codebase documentation (this directory)
- Generated: No (manually written by Claude)
- Committed: Yes (tracked in git for future reference)

**supabase/seed.sql:**
- Purpose: Optional seed data for local development
- Generated: No
- Committed: Yes (allows local `supabase db push --dry-run`)

---

*Structure analysis: 2026-03-12*

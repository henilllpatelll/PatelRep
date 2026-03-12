# Technology Stack

**Analysis Date:** 2026-03-12

## Languages

**Primary:**
- Python 3.12 - FastAPI backend (`apps/api/`)
- TypeScript 5.4+ - Next.js web frontend (`apps/web/`)
- TypeScript 5.4+ - React Native mobile app (`apps/mobile/`)
- JavaScript/JSX - React components across web and mobile

**Secondary:**
- SQL - PostgreSQL schema and migrations (`supabase/migrations/`)
- Bash - Deployment and build scripts

## Runtime

**Environment:**
- Python 3.12-slim (Docker image for API deployment)
- Node.js 20 (for web/mobile builds)
- Expo SDK 51 (mobile runtime via Expo managed service)

**Package Manager:**
- npm (workspaces: `apps/web`, `apps/mobile`, root)
- pip (Python dependency management)
- Lockfile: `package-lock.json` (npm), `requirements.txt` (pip, pinned versions)

## Frameworks

**Core:**
- FastAPI 0.111.0 - Backend API framework
- Next.js 14.2.4 - Web frontend (App Router)
- React 18.3.1 (web), 18.2.0 (mobile) - UI framework
- React Native 0.74.2 - Mobile framework
- Expo 51.0.0 - Managed React Native service

**State Management:**
- Zustand 4.5.2+ - Client-side state (web + mobile)
  - `stores/hotelStore.ts` - Hotel and multi-tenant context
  - `stores/housekeepingStore.ts` - Room/assignment/prediction state
  - `stores/authStore.ts` - Auth state (web)

**Data Fetching & Querying:**
- TanStack React Query 5.45.0 - Server state + caching (web)
- Supabase JS Client 2.43.4 - Real-time subscriptions (web + mobile)

**Testing:**
- pytest 8.2.2 - Python test runner (API)
- pytest-asyncio 0.23.7 - Async test support
- Vitest/Jest (web config not explicitly configured, using ESLint + TypeScript type-check)

**Build/Dev:**
- Vite (via Next.js) - Web bundler
- Babel 7.24.0 - Mobile transpiler
- Tailwind CSS 3.4.4 - Utility-first styling (web)
- PostCSS 8.4.38 - CSS processing
- TypeScript 5.5.2+ - Static typing
- ESLint 8.57.0 - Code linting (web)
- Ruff - Python linting (API)

## Key Dependencies

**Critical (Backend API):**
- fastapi 0.111.0 - REST framework
- uvicorn[standard] 0.30.1 - ASGI server (2 workers on Railway)
- pydantic 2.7.1 + pydantic-settings 2.3.0 - Data validation + config
- supabase 2.5.0 - PostgreSQL + auth client
- httpx 0.27.0 - Async HTTP for OAuth + webhooks
- python-jose[cryptography] 3.3.0 - JWT signing/validation
- slowapi 0.1.9 - Rate limiting

**Critical (AI/ML):**
- openai 1.35.0 - GPT-4o-mini for fast NL→task parsing
- anthropic 0.29.0 - Claude Sonnet 3.5 for reasoning (RAG, predictions)
- pdfplumber 0.11.1 - PDF ingestion for SOP documents

**Critical (Payments):**
- stripe 10.1.0 - Subscription + billing webhooks

**Critical (Frontend Web):**
- @supabase/supabase-js 2.43.4 - Real-time client
- @supabase/ssr 0.3.0 - Server-side auth helpers
- @tanstack/react-query 5.45.0 - Server state management
- zod 3.23.8 - Type-safe form validation
- react-hook-form 7.52.0 - Form state management
- recharts 2.12.7 - Charts/graphs for analytics
- stripe 15.12.0 - Stripe.js for payment UI

**Critical (Frontend Mobile):**
- @supabase/supabase-js 2.43.4 - Real-time client
- expo-sqlite 14.0.6 - Local offline database
- expo-notifications 0.28.8 - Push notifications (APNs + FCM)
- expo-secure-store 13.0.2 - Secure token storage
- @react-native-async-storage/async-storage 1.23.1 - Persistent store
- @react-native-community/netinfo 11.3.1 - Network status detection

**UI (Shared Web/Mobile):**
- lucide-react 0.395.0 - Icon library (web)
- @radix-ui/react-* - Accessible dialog, dropdown, select, tabs, toast, badge (web)
- react-i18next 14.1.2 - i18n (EN/ES) for web + mobile
- date-fns 3.6.0 - Date utilities (web)
- tailwind-merge 2.3.0 - Tailwind class merging
- clsx 2.1.1 - Conditional classnames

**Utilities:**
- python-multipart 0.0.9 - Form parsing
- pillow 10.3.0 - Image manipulation (Python)
- python-dateutil 2.9.0 - Date parsing helpers
- class-variance-authority 0.7.0 - Variant styling (web)
- @hookform/resolvers 3.6.0 - Hook Form validation adapters

## Configuration

**Environment:**
- Environment variables loaded via `core/config.py` (Pydantic Settings)
- Required vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Optional vars: `OPERA_OAUTH_*`, `CRON_SECRET`, `APP_ENV`, `APP_URL`, `API_URL`
- Web: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public anon key for client-side auth)
- Mobile: Same as web (via Expo environment config)
- `.env` files (development) — `.env.example` provided in `apps/api/`

**Build:**
- `apps/api/Dockerfile` - Python 3.12-slim, installs libpoppler-cpp-dev, runs uvicorn on port 8080
- `railway.toml` - Railway deployment config: dockerfile build, health check at `/health`, restart on failure
- `apps/web/tsconfig.json` - Strict TypeScript, Next.js plugin, `@/*` path alias
- `apps/mobile/tsconfig.json` - React Native TypeScript config
- `apps/web/next.config.js` (implicit) - Next.js 14 defaults

## Platform Requirements

**Development:**
- Python 3.12 (with pip)
- Node.js 20+ (with npm)
- Git
- Docker (optional, for API image testing)
- Expo CLI (for mobile dev)

**Production:**
- **API:** Railway.app container platform (or any Docker-compatible host)
  - Port: 8080 (hardcoded in Dockerfile)
  - 2 uvicorn workers (see Dockerfile CMD)
- **Web:** Vercel (Next.js optimized)
- **Mobile:** Expo Application Services (EAS) for build/distribution
- **Database:** Supabase (managed PostgreSQL 17 with pgvector extension)

---

*Stack analysis: 2026-03-12*

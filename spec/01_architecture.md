# PatelRep — Technical Architecture

## 1. System Architecture Diagram

```
                         ┌─────────────────────────────────────┐
                         │         Cloudflare (DNS + WAF)       │
                         └──────────────┬──────────────────────┘
                                        │
              ┌─────────────────────────┴──────────────────────────┐
              │                                                     │
   ┌──────────▼──────────┐                         ┌───────────────▼───────────┐
   │      Vercel          │                         │       Railway              │
   │  Next.js 14 App      │                         │   FastAPI (Python 3.12)   │
   │  patelrep.com        │◄───── REST / WS ───────►│   api.patelrep.com        │
   │  (Manager Web)       │                         │   + Background Workers    │
   └──────────────────────┘                         └───────────────┬───────────┘
                                                                    │
   ┌──────────────────────┐                                         │
   │  React Native (Expo) │                                         │
   │  iOS + Android       │◄───── REST / Supabase Realtime ────────►│
   │  (Staff Mobile App)  │                                         │
   └──────────────────────┘                                         │
                                                                    │
                         ┌──────────────────────────────────────────▼──────────┐
                         │                     SUPABASE                         │
                         │  ┌────────────────┐  ┌────────────────────────────┐ │
                         │  │  PostgreSQL 15  │  │   pgvector (embeddings)    │ │
                         │  │  + RLS policies │  │   SOP RAG store            │ │
                         │  └────────────────┘  └────────────────────────────┘ │
                         │  ┌────────────────┐  ┌────────────────────────────┐ │
                         │  │  Supabase Auth  │  │   Supabase Realtime        │ │
                         │  │  (JWT + magic   │  │   (room status, tasks,     │ │
                         │  │   link)         │  │    work orders)            │ │
                         │  └────────────────┘  └────────────────────────────┘ │
                         │  ┌────────────────┐                                  │
                         │  │ Supabase Storage│  (SOP PDFs, work order photos)  │
                         │  └────────────────┘                                  │
                         └─────────────────────────────────────────────────────┘
                                        │
              ┌─────────────────────────┼──────────────────────────┐
              │                         │                           │
   ┌──────────▼──────────┐  ┌───────────▼──────────┐  ┌───────────▼──────────┐
   │    OpenAI API        │  │   Anthropic API       │  │   Opera Cloud (OHIP)  │
   │  GPT-4o-mini         │  │  Claude Sonnet 3.5    │  │  Business Events      │
   │  (NL→task parsing,   │  │  (RAG, predictions,   │  │  Webhooks + REST API  │
   │   function calling)  │  │   insights, summaries)│  │  (PMS integration)    │
   │  text-embedding-3-sm │  │                       │  │                       │
   └──────────────────────┘  └──────────────────────┘  └──────────────────────┘
              │
   ┌──────────▼──────────┐  ┌──────────────────────┐
   │      Stripe          │  │   Expo Push Service   │
   │  Subscription API    │  │  (iOS APNs + Android  │
   │  + Invoicing         │  │   FCM push notifs)    │
   └──────────────────────┘  └──────────────────────┘
```

---

## 2. Component Descriptions

### 2.1 Vercel — Next.js 14 Web Dashboard
- **Purpose:** Manager/supervisor desktop web interface
- **Framework:** Next.js 14 with App Router
- **Usage:** GM dashboard, housekeeping room board, engineering management, reports, settings, onboarding, billing
- **Auth:** Supabase JS client (handles JWT cookie management)
- **Realtime:** Supabase JS realtime subscriptions (table change listeners)
- **Deployment:** Vercel auto-deploys on `main` branch push

### 2.2 Railway — FastAPI Backend
- **Purpose:** Core business logic API, AI orchestration, background jobs
- **Framework:** FastAPI (Python 3.12)
- **Key responsibilities:**
  - REST API for all client requests
  - AI model routing and orchestration (OpenAI + Anthropic)
  - Opera Cloud OAuth token management + webhook processing
  - SOP PDF ingestion pipeline (chunking + embedding)
  - Stripe billing + credit ledger management
  - Railway Cron Jobs trigger scheduled FastAPI endpoints
- **Deployment:** Railway auto-deploys on `main` branch push via GitHub Actions

### 2.3 React Native (Expo) — Mobile App
- **Purpose:** Primary interface for housekeeping, engineering, and front desk staff
- **Framework:** React Native 0.73 + Expo SDK 50
- **Platforms:** iOS (App Store) + Android (Play Store)
- **Key features:**
  - Full offline mode (Expo SQLite + background sync)
  - Expo Push Notifications (task assignments, SLA alerts)
  - i18n (English + Spanish via react-i18next)
  - Camera integration for work order photos
- **Distribution:** Expo Go (beta) → Expo EAS Build → App Store + Play Store

### 2.4 Supabase — Data Layer
- **PostgreSQL 15:** Primary database with RLS for multi-tenant isolation
- **pgvector:** Vector embeddings for SOP RAG (1536-dim OpenAI embeddings)
- **Supabase Auth:** JWT issuance, magic link, email/password
- **Supabase Realtime:** WebSocket-based table change broadcasting for live room boards
- **Supabase Storage:** SOP PDFs (private, RLS-protected), work order photos (presigned URLs)

### 2.5 AI Services
- **OpenAI GPT-4o-mini:** NL → structured task (function calling), quick interactions (<500ms)
- **OpenAI text-embedding-3-small:** Generate 1536-dim embeddings for SOP chunks
- **Claude Sonnet 3.5:** SOP RAG Q&A, room readiness prediction analysis, failure prediction, shift summaries, GM insights

### 2.6 External Services
- **Opera Cloud (OHIP):** PMS integration via OAuth 2.0 + Business Events webhooks
- **Stripe:** Subscription billing + internal credit ledger overage invoicing
- **Expo Push:** Push notifications to iOS (APNs) and Android (FCM)

---

## 3. Data Flow Patterns

### 3.1 Staff Creates Task via NL (Happy Path)
```
Staff types in mobile app
  → POST /ai/copilot/chat (FastAPI)
    → GPT-4o-mini function calling → structured task JSON
      → Validate + store in tasks table (Supabase)
        → AI auto-assignment algorithm runs
          → Assigned staff receives Expo push notification
            → Supabase Realtime broadcasts to all connected clients
              → Room board updates in real-time on web + mobile
```

### 3.2 Opera Cloud Checkout → Room Goes Dirty
```
Guest checks out in Opera PMS
  → Opera Business Events webhook → POST /webhooks/opera (FastAPI)
    → Parse RESERVATION.CHECKED_OUT event
      → UPDATE rooms SET status='DIRTY' (Supabase)
        → Supabase Realtime broadcasts
          → Room board updates instantly for supervisor
            → AI assignment algorithm considers room for next available housekeeper
```

### 3.3 Room Readiness Prediction (Scheduled)
```
Railway Cron Job → every 30 minutes
  → GET /internal/predictions/housekeeping (FastAPI)
    → Query: all dirty/in-progress rooms with check-in today
      → For each room: fetch housekeeper speed profile + workload + room type weight
        → Calculate predicted_completion_time
          → If predicted_completion > check_in_time - 30min: set risk_level='HIGH'
            → UPDATE room_readiness_predictions table
              → Supabase Realtime → GM dashboard risk panel updates
                → If HIGH risk: Expo push to supervisor
```

### 3.4 SOP RAG Query
```
Staff asks "How do I set up VIP turndown?" in copilot
  → POST /ai/copilot/chat (FastAPI)
    → Claude Sonnet determines: SOP retrieval needed
      → Generate query embedding (OpenAI text-embedding-3-small)
        → pgvector similarity search: top-5 SOP chunks (cosine similarity)
          → Claude Sonnet: generate answer from retrieved chunks
            → Extract procedure steps → generate task checklist
              → Return: answer text + "Create these tasks?" action button
                → If confirmed: POST /tasks (batch create)
```

---

## 4. Multi-Tenancy Architecture

- Every database table has `tenant_id UUID NOT NULL` column
- Supabase Row Level Security (RLS) enforces isolation at the database level
- FastAPI middleware validates JWT and injects `hotel_id` into request context
- No cross-tenant data leakage possible — enforced at DB layer, not just application layer

### RLS Policy Pattern
```sql
-- Staff see only their hotel's data
CREATE POLICY "tenant_isolation" ON rooms
  FOR ALL USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- GMs see all rooms for their hotel
-- Supervisors see their department's data only (enforced via user_roles table join)
```

---

## 5. Offline Architecture (Mobile)

```
Mobile App State:
  ┌─────────────────┐    ┌──────────────────────────────────┐
  │  Expo SQLite     │    │         Sync Engine               │
  │  (local cache)  │◄──►│  - Queue writes when offline      │
  │                 │    │  - Merge on reconnect             │
  │  - my_rooms     │    │  - Last-write-wins for status     │
  │  - my_tasks     │    │  - Conflict: server wins for      │
  │  - work_orders  │    │    assignment changes             │
  └─────────────────┘    └──────────────────────────────────┘
         ▲                              │
         │                             ▼
   Reads when offline           Supabase REST API
   (cached data)                (when online)
```

Offline capabilities:
- View assigned rooms (cached from last sync)
- Mark rooms as Clean (queued, syncs on reconnect)
- Add notes to tasks (queued)
- View work order queue (cached)
- Mark work orders complete (queued)

Blocked when offline (require connectivity):
- AI Copilot interactions
- Photo uploads
- Creating new tasks for other staff
- Viewing live room board

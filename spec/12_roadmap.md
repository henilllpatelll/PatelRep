# PatelRep — Development Roadmap

## Overview

- **Builder:** Solo founder + AI assistance (Claude/Cursor)
- **Timeline:** 3–4 months to MVP launch
- **Pilot:** 1 committed Texas hotel, 1-month free trial
- **Stack:** FastAPI + Next.js + React Native (Expo) + Supabase
- **Target launch:** ~Week 14 (end of Month 3 / start of Month 4)

---

## Month 1: Foundation & Core Infrastructure (Weeks 1–4)

### Week 1: Project Setup & Database

**Goal:** Everything runs locally. Can create a hotel and see rooms.

- [ ] Monorepo setup (`apps/api`, `apps/web`, `apps/mobile`, `supabase/`)
- [ ] Supabase project created (prod + local dev)
- [ ] All database migrations written and applied (full schema from spec)
- [ ] RLS policies implemented on all tables
- [ ] Custom JWT claims (hotel_id + role injection)
- [ ] FastAPI project scaffolded (routers, Pydantic models, middleware)
- [ ] Supabase Auth JWT verification middleware in FastAPI
- [ ] Health check endpoint: `GET /health`
- [ ] `.env` files configured for all apps
- [ ] GitHub repo + GitHub Actions workflow (lint + basic test)
- [ ] Railway service created, auto-deploy connected
- [ ] Vercel project created, auto-deploy connected

**Deliverable:** `supabase db push` works. FastAPI returns 200 on `/health`. RLS tests pass in Supabase Studio.

---

### Week 2: Authentication & Hotel Setup

**Goal:** A GM can sign up, create a hotel, and see an empty dashboard.

- [ ] Supabase Auth: magic link + email/password
- [ ] Next.js auth pages (login, magic link landing)
- [ ] React Native auth screen (login, magic link deep link)
- [ ] Hotel creation flow (POST /hotels)
- [ ] User profile creation on first login
- [ ] Role assignment on invite acceptance
- [ ] Staff invitation system (POST /invitations, email delivery)
- [ ] JWT token injection into all API requests (web + mobile)
- [ ] Multi-tenant test: two hotels, verify RLS isolation
- [ ] Basic Next.js shell layout (sidebar navigation, header, empty pages)

**Deliverable:** GM can sign up, create hotel, invite one staff member. Two hotels' data is completely isolated.

---

### Week 3: Room Management & Real-time

**Goal:** Rooms are visible on a board. Status changes appear instantly.

- [ ] Room types CRUD (POST/GET/PATCH /room-types)
- [ ] Rooms CRUD with room import (CSV parser)
- [ ] Room status management (GET/PATCH /rooms/{id}/status)
- [ ] Room status history tracking
- [ ] Status transition validation (DIRTY → IN_PROGRESS → CLEAN → INSPECTED)
- [ ] Supabase Realtime subscription on `room_status` table
- [ ] Next.js: Basic room board (grid layout, color-coded by status)
- [ ] React Native: "My Rooms" screen (FlatList, status cards)
- [ ] Expo offline cache (SQLite): room list cached locally
- [ ] Offline mode: mark room clean queued when offline, syncs on reconnect

**Deliverable:** Rooms board on web shows all rooms. Supervisor changes status → housekeeper's mobile updates instantly. Works offline.

---

### Week 4: Staff Management & Scheduling

**Goal:** GM can manage staff, shifts, and see who's on duty.

- [ ] Staff management (GET/POST/PATCH /staff)
- [ ] Role management (assign/change roles)
- [ ] Departments setup (Housekeeping, Engineering, Front Desk defaults)
- [ ] Shift definitions (Morning/Evening/Night per department)
- [ ] Shift assignments (schedule who works which days)
- [ ] Clock in/out (PATCH /schedules/assignments/{id}/clock-in)
- [ ] On-shift status display on room board ("Staff On Shift" card)
- [ ] i18n setup: react-i18next configured for EN and ES (both apps)
- [ ] Language toggle in mobile app (profile settings)
- [ ] Expo Push Notifications setup (register token, store in DB)
- [ ] Basic push notification sending (test: task assigned)

**Month 1 Milestone:** Core platform is live on Railway + Vercel. GM can onboard hotel, manage rooms and staff, see live room board. Mobile app works with offline mode. Supabase Realtime working.

---

## Month 2: Housekeeping Module + AI Core (Weeks 5–8)

### Week 5: Opera Cloud Integration

**Goal:** Hotel connects Opera Cloud. Rooms go Dirty automatically on checkout.

- [ ] Opera Cloud OAuth 2.0 flow (connect + callback + token storage in Supabase Vault)
- [ ] Token refresh logic (auto-refresh 5 min before expiry)
- [ ] Webhook handler (`POST /webhooks/opera`)
  - `RESERVATION.CHECKED_OUT` → DIRTY
  - `RESERVATION.CHECKED_IN` → update guest context
  - `ROOM_STATUS.DO_NOT_DISTURB` → dnd_flag
  - `ROOM_STATUS.MAKE_UP_ROOM` → create housekeeping task
- [ ] Business Events registration (subscribe to events after OAuth)
- [ ] Polling job (Railway cron every 30 min): fetch today's/tomorrow's reservations
- [ ] Opera reservation cache (`opera_reservations` table)
- [ ] Room board: show guest name, VIP flag, check-in time from Opera
- [ ] Integrations settings page (web): connect/disconnect/status/force sync
- [ ] Room import from Opera Cloud (onboarding wizard step)

**Deliverable:** Connect Opera Cloud from Settings. Check out a guest in Opera → room goes red/DIRTY in PatelRep within 5 seconds. VIP flag appears on room card.

---

### Week 6: Room Assignment + Inspection Workflow

**Goal:** Supervisor can assign rooms (manually + AI-suggested). Inspections work.

- [ ] Room assignment system (`POST /housekeeping/assignments`)
- [ ] AI auto-assign algorithm (workload balancing, floor proximity)
- [ ] `POST /housekeeping/ai-suggest-assignments` endpoint
- [ ] Web: Assignment sidebar with HK workload list
- [ ] Web: Drag-and-drop room card onto housekeeper
- [ ] Web: AI Suggest button → preview assignments → approve/modify
- [ ] Inspection template system (default checklist + custom items)
- [ ] Inspection submission (`POST /inspections`)
- [ ] Pass → room status = INSPECTED, notified on web board
- [ ] Fail → room status = DIRTY, push notification to housekeeper
- [ ] Mobile: Full inspection screen with checklist
- [ ] Housekeeper speed profile tracking (update on room completion)

**Deliverable:** Supervisor opens web board, clicks "AI Suggest", sees balanced assignments. Approves. Housekeepers see their rooms on mobile. Supervisor inspects → room turns green on board.

---

### Week 7: NL Task Creation + AI Copilot

**Goal:** Staff can say "Room 412 needs towels" and a task gets created.

- [ ] OpenAI GPT-4o-mini integration (NL → task parsing)
- [ ] Task creation function schema (structured JSON output)
- [ ] `POST /ai/copilot/chat` endpoint with intent detection
- [ ] `POST /tasks` with `use_ai: true` flow
- [ ] AI Copilot bubble component (web + mobile)
  - Floating action button
  - Chat overlay
  - Quick action chips (context-aware)
  - Task preview with confirm/edit
- [ ] Spanish NL input handling (LLM parses Spanish correctly)
- [ ] AI credit metering middleware (deduct credits per interaction)
- [ ] Credit ledger creation at billing period start
- [ ] Task routing to correct department by AI
- [ ] Auto-assignment after AI task creation
- [ ] Push notification to assigned staff

**Deliverable:** Staff types "La habitación 412 necesita toallas extra" → AI creates task in Spanish → routes to housekeeping → Maria gets a push notification → task appears on web board.

---

### Week 8: SOP Library + Room Readiness Predictions

**Goal:** Upload an SOP PDF, ask it questions, and get room risk predictions.

- [ ] SOP document upload (Supabase Storage + metadata)
- [ ] PDF parsing pipeline (pdfplumber: text extraction + chunking)
- [ ] OpenAI text-embedding-3-small: generate embeddings per chunk
- [ ] pgvector storage: `sop_chunks` table with IVFFlat index
- [ ] `POST /sop/query` endpoint (RAG pipeline with Claude Sonnet)
- [ ] SOP Q&A shows suggested tasks to create from procedure
- [ ] SOP library management page (web): upload, view, delete
- [ ] Room readiness prediction algorithm
  - Housekeeper speed profiles (per room type)
  - Workload calculation (rooms remaining ahead)
  - Risk level: HIGH/MEDIUM/LOW
  - Cold start: industry defaults → onboarding calibration → Opera bootstrap
- [ ] Railway cron job: `/internal/predictions/run` (every 30 min)
- [ ] Risk display: room cards show ETA + risk level
- [ ] AI Risk Alerts panel on GM dashboard
- [ ] Push notification to supervisor when room goes HIGH risk

**Month 2 Milestone:** Full Housekeeping module operational. Opera integration syncing. NL task creation works in EN + ES. SOP Q&A live. Room readiness predictions running every 30 minutes. Pilot hotel can do a full day of operations on PatelRep.

---

## Month 3: Engineering Module + Billing + Launch (Weeks 9–12)

### Week 9: Engineering Work Orders

**Goal:** Any staff creates a work order. Engineers claim it and complete it.

- [ ] Work order CRUD (`POST/GET/PATCH /work-orders`)
- [ ] Work order photo upload (Supabase Storage, before/after/progress)
- [ ] Photo compression (expo-image-manipulator, max 2MB)
- [ ] Engineer claim workflow (`POST /work-orders/{id}/claim`)
- [ ] Work order completion (`POST /work-orders/{id}/complete`)
- [ ] SLA tracking (due_at calculation based on priority)
- [ ] SLA breach detection in prediction cron job
- [ ] Escalation: push notification to supervisor at 75% SLA
- [ ] Escalation: push notification to GM at 100% SLA breach
- [ ] Web: Engineering work order queue (tabbed: Open/In Progress/Completed)
- [ ] Web: Work order detail with photos + activity log
- [ ] Mobile (Engineer): Work order queue screen
- [ ] Mobile (Engineer): Work order detail + photo upload + complete
- [ ] NL work order creation via AI Copilot (same flow as tasks)

**Deliverable:** Front Desk types "AC broken in 514 urgent" → WO created → Carlos (engineer) gets push notification → claims it on mobile → uploads before photo → marks complete with notes → supervisor notified.

---

### Week 10: PM Scheduling + Asset Failure Predictions

**Goal:** Set up PM schedules. AI predicts which assets will fail.

- [ ] Asset categories + asset register CRUD
- [ ] PM schedule definitions (interval, due dates, auto-generation)
- [ ] Railway cron: `/internal/pm/check-due` (daily 6am) — generates PM work orders
- [ ] Overdue PM alerts in GM risk panel
- [ ] Asset failure prediction pipeline (Claude Sonnet)
  - Work order history analysis (last 90 days per asset)
  - Failure risk score (0–100)
  - Recommendation generation
- [ ] Railway cron: `/internal/ai/failure-predictions` (nightly midnight)
- [ ] Web: Asset register page (list + risk scores)
- [ ] Web: Failure predictions panel (top 10 risks ranked by $ impact)
- [ ] Web: PM schedule management page
- [ ] Engineering module: link work orders to specific assets
- [ ] Mobile: Asset details + work order history

**Deliverable:** Chief Engineer registers HVAC units. PM schedules auto-generate monthly work orders. After 2 weeks of work order data: AI predicts "HVAC 5F has 74% failure risk, schedule inspection."

---

### Week 11: Billing + Logbook + Front Desk + Reports

**Goal:** Billing works, logbook is live, front desk can use the app.

- [ ] Stripe customer creation on hotel signup
- [ ] Stripe subscription activation (trial → paid flow)
- [ ] Monthly billing true-up cron job (Railway)
- [ ] Stripe webhook handler (payment failed → disable AI, etc.)
- [ ] Billing settings page (web): subscription status, credit usage, invoices
- [ ] Stripe Customer Portal link (self-service billing management)
- [ ] Credit usage widget on GM dashboard
- [ ] AI-generated shift summary (Claude Sonnet, at shift end)
- [ ] Manual logbook entry creation
- [ ] Logbook viewer (web + mobile): searchable, filterable by date/dept
- [ ] Front Desk module: task creation for any dept (NL + quick actions)
- [ ] Front Desk module: read-only room status view
- [ ] Guest request creation + tracking (separate from work orders)
- [ ] Lost & found log (simple: description, room, status)
- [ ] Guest profile view from Opera (VIP flag, preferences, read-only)
- [ ] Daily summary report (PDF auto-emailed to GM at 6am)
- [ ] Staff performance report (CSV export)

**Deliverable:** GM receives daily PDF summary every morning. Billing dashboard shows credit usage. Shift ends → AI generates handoff summary automatically. Front desk creates requests from web or mobile.

---

### Week 12: Polish, Onboarding Wizard, Testing & Launch Prep

**Goal:** New hotel can self-onboard in under 2 hours. App is App Store ready.

- [ ] Onboarding wizard (web): 6-step self-serve flow
  - Hotel profile → Room import → Staff invite → Opera connect → SOP upload → PM setup
- [ ] AI onboarding assistant (chat-guided setup in wizard sidebar)
- [ ] Onboarding completion tracking + progress display
- [ ] GM analytics dashboard: trend charts (Recharts)
  - 30-day SLA compliance line chart
  - Rooms/hr by housekeeper bar chart
  - AI credit usage trend
- [ ] ROI metrics: labor saved calculation (confirmed working)
- [ ] Maintenance cost & asset report (PDF)
- [ ] AI credit usage report (CSV)
- [ ] Mobile app: full UI polish pass (spacing, colors, edge cases)
- [ ] Web: responsive layout for tablet screens
- [ ] Expo EAS Build: production iOS + Android builds
- [ ] TestFlight submission (iOS beta)
- [ ] Play Store internal testing submission (Android)
- [ ] Manual smoke test: full end-to-end workflow with pilot hotel
- [ ] Fix all critical bugs from pilot feedback
- [ ] App Store submission (iOS) + Play Store submission (Android)
- [ ] Production deployment checklist (security headers, HTTPS, RLS verification)

**Month 3 / Launch Milestone:** Full MVP is live. Pilot hotel is operational. Both mobile apps submitted to stores. New hotel can self-onboard. Every spec feature is implemented and tested.

---

## Post-MVP: v2 Roadmap (Priority Order)

### High Priority (Months 4–5)
- [ ] **Voice input:** Whisper API integration for voice-to-task (housekeeping hands-free)
- [ ] **Multi-property portfolio dashboard:** Group owner sees aggregate KPIs
- [ ] **Parts/inventory tracking:** Link parts to work orders, stock alerts
- [ ] **SOC 2 Type II prep:** Start security audit process (6–12 months)

### Medium Priority (Months 5–7)
- [ ] **Additional PMS integrations:** Cloudbeds, Mews (using HTNG/PMS middleware)
- [ ] **Staff scheduling AI:** Shift recommendations based on occupancy forecast
- [ ] **Guest messaging integration:** Automatically message guest when room is ready (via Opera or direct SMS)
- [ ] **SMS escalations:** Twilio fallback for critical SLA breaches when push not acknowledged

### Growth Features (Months 7–12)
- [ ] **White-label mobile app:** Custom-branded app for hotel groups
- [ ] **Custom AI agents:** Hotel-specific AI trained on their SOPs and history
- [ ] **Predictive occupancy scheduling:** AI-recommended housekeeping staffing based on Opera occupancy forecast
- [ ] **Competitive benchmarking:** Compare SLA/efficiency against anonymized industry benchmarks
- [ ] **API access tier:** Enterprise customers can integrate PatelRep data into their own systems

---

## Weekly Sprint Template

Each week follows this structure:

```
Monday:    Plan the week. Review pilot hotel feedback. Define acceptance criteria.
Tue–Thu:   Build. Commit frequently. Deploy to Railway/Vercel on each push.
Friday:    Test the week's features end-to-end. Collect pilot hotel feedback.
           Update spec if decisions changed. Plan next week.
```

**Pilot feedback loop:** Schedule 30-min weekly check-in with pilot hotel GM to demo new features and collect feedback. Prioritize bugs over new features.

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Opera Cloud OHIP API approval delays | Medium | High | Start OHIP partner registration immediately. Build CSV import as fallback. |
| Solo developer burnout / scope creep | High | High | Strict weekly milestone cuts. Drop v2 features if behind. |
| Pilot hotel doesn't convert to paid | Medium | Medium | Parallel outreach to 3 backup hotels. Don't be dependent on one pilot. |
| AI costs exceed projections | Low | Medium | Rate limiting + cap enforcement built in from day 1. |
| App Store review rejection | Low | Low | Submit early (Week 11). Leave buffer for resubmission. |
| Supabase Realtime unreliability | Low | High | 30-second polling fallback if websocket disconnects. |

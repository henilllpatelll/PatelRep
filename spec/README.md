# PatelRep Technical Specification Index

Complete technical specification for PatelRep — AI Staff Copilot for independent hotels.

## Files

| File | Contents |
|---|---|
| `00_overview.md` | Product vision, positioning, target market, pricing, roles, KPIs |
| `01_architecture.md` | System architecture diagram, component descriptions, data flow patterns, offline architecture |
| `02_database_schema.md` | All PostgreSQL tables, RLS policies, indexes, relationships |
| `03_api_endpoints.md` | All FastAPI REST endpoints with request/response schemas |
| `04_frontend_web.md` | Next.js 14 structure, page components, state management, i18n |
| `05_frontend_mobile.md` | React Native + Expo structure, screens, offline mode, push notifications |
| `06_ai_integration.md` | Model routing matrix, all AI flows, prompts, pgvector RAG, credit metering |
| `07_deployment.md` | Railway + Vercel + Supabase + Expo EAS config, CI/CD, infra cost estimates |
| `08_security_compliance.md` | Auth, RLS, PCI DSS, GDPR/CCPA, input validation, secrets management |
| `09_opera_integration.md` | Opera Cloud OAuth flow, webhook handlers, polling, bidirectional sync |
| `10_billing_metering.md` | Stripe setup, credit ledger, monthly true-up, billing UI components |
| `11_wireframes.md` | Text wireframes for all key screens (web + mobile) |
| `12_roadmap.md` | 12-week development roadmap with weekly milestones, v2 backlog, risk register |

## Tech Stack Summary

| Layer | Technology |
|---|---|
| Web Dashboard | Next.js 14 (Vercel) |
| Mobile App | React Native + Expo SDK 51 (iOS + Android) |
| Backend API | FastAPI Python 3.12 (Railway) |
| Database | PostgreSQL 15 + pgvector (Supabase) |
| Auth | Supabase Auth (magic link + password) |
| Real-time | Supabase Realtime (WebSocket broadcasts) |
| File Storage | Supabase Storage |
| AI (fast/structured) | OpenAI GPT-4o-mini + text-embedding-3-small |
| AI (reasoning/RAG) | Anthropic Claude Sonnet 3.5 |
| PMS Integration | Opera Cloud OHIP (OAuth 2.0 + Business Events) |
| Billing | Stripe Subscription + internal credit ledger |
| Push Notifications | Expo Push (iOS APNs + Android FCM) |
| CI/CD | GitHub Actions → Railway + Vercel auto-deploy |

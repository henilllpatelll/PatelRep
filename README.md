# PatelRep

AI Staff Copilot SaaS for independent Texas hotels. Quore-style simplicity with AI-powered predictions — built for housekeepers and engineers on the floor.

**Pricing:** $99/mo base + $0.02/AI credit, cap $2.50/room/month

---

## Monorepo Structure

```
PatelRep/
├── apps/
│   ├── api/        FastAPI Python 3.12 — backend (Railway)
│   └── web/        Next.js 14 App Router — web dashboard (Railway)
├── supabase/
│   └── migrations/ 001–019.sql — full schema
├── spec/           14 spec files (source of truth)
└── docs/           Design specs and implementation plans
```

---

## Running Locally

**API (FastAPI):**
```bash
cd apps/api
pip install -r requirements.txt
uvicorn main:app --reload
```

**Web (Next.js):**
```bash
cd apps/web
npm install
npm run dev
```

---

## Deployed Infrastructure

| Service | Platform | URL |
|---------|----------|-----|
| API     | Railway  | https://api-production-18a4.up.railway.app |
| Web     | Railway  | https://patelrepweb-production.up.railway.app |
| DB      | Supabase | — |

---

## Further Reading

- [`CLAUDE.md`](./CLAUDE.md) — full project context, conventions, and AI session instructions
- [`spec/`](./spec/) — product requirements (source of truth)
- [`spec/07_deployment.md`](./spec/07_deployment.md) — infrastructure and deployment details

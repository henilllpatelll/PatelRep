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
npm ci
npm run dev
```

---

## Build and verification

This repository is a set of independent deployable apps. Run web commands from
`apps/web`; do not use root `--workspace` flags. The root, web, and mobile
lockfiles are intentional and must remain app-scoped.

```bash
# API smoke suite
cd apps/api && python -m pytest tests/smoke/ -q

# Web production checks
cd apps/web && npm ci
npm run lint
npm run type-check
npm run build
npx playwright test --config=playwright.phase0.config.ts
```

The scheduled `Deploy Health Check` workflow verifies the public `/login` route
and the API/database readiness response. A failed public smoke check is a failed
deployment, not a warning.

---

## Deployed Infrastructure

| Service | Platform | URL |
|---------|----------|-----|
| API     | Railway  | https://patelrep-web-production.up.railway.app |
| Web     | Railway  | https://patelrep-production.up.railway.app |
| DB      | Supabase | — |

---

## Further Reading

- [`CLAUDE.md`](./CLAUDE.md) — full project context, conventions, and AI session instructions
- [`spec/`](./spec/) — product requirements (source of truth)
- [`spec/07_deployment.md`](./spec/07_deployment.md) — infrastructure and deployment details

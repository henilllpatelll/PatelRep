# PatelRep

**More time for hospitality.** PatelRep is an intelligent hospitality operations and coordination platform connecting
hotel employees, managers, owners and their existing software. Its mission is to give everyone in hospitality their
time back. Product direction is set by the [Master Strategy](./docs/patelrep-strategy/README.md).

**Billing today:** $99/mo base + $0.02/AI credit, cap $2.50/room/month. One all-inclusive subscription is the intended
direction; its prices are not decided ([commercial strategy](./docs/patelrep-strategy/11-commercial-strategy.md)).

---

## Monorepo Structure

```
PatelRep/
├── apps/
│   ├── api/        FastAPI Python 3.12 — backend (Railway)
│   ├── web/        Next.js 16 App Router — web dashboard (Railway)
│   └── mobile/     Expo React Native — iOS and Android app (EAS builds)
├── supabase/
│   └── migrations/ — full schema history (including documented historical prefix collisions)
├── spec/           One historical feature spec (housekeeping phase 1 foundation)
└── docs/           Process, release, harness and strategy docs (Master Strategy: docs/patelrep-strategy/)
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
| API     | Railway  | https://noble-cooperation-production.up.railway.app |
| Web     | Railway  | https://patelrep-production-6f35.up.railway.app |
| DB      | Supabase | — |

---

## Further Reading

- [`CLAUDE.md`](./CLAUDE.md) — full project context, conventions, and AI session instructions
- [`docs/patelrep-strategy/`](./docs/patelrep-strategy/README.md) — Master Strategy: mission, product constitution, roadmap and standards
- [`spec/`](./spec/) — historical feature spec
- [`docs/RELEASE_PROCESS.md`](./docs/RELEASE_PROCESS.md) — release and deployment process
- [`docs/ENVIRONMENTS.md`](./docs/ENVIRONMENTS.md) — isolated development, staging, and production configuration

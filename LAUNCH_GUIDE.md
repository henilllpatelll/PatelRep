# PatelRep Launch Guide

## Phase 1 — Prerequisites

### Accounts you need
- **GitHub** — hosts the repo, CI/CD runs from it
- **Railway** — hosts the FastAPI backend
- **Vercel** — hosts the Next.js web app
- **Supabase** — database, auth, realtime, storage
- **Stripe** — billing ($99/mo subscriptions + credit overage)
- **OpenAI** — GPT-4o-mini (NL→task, onboarding AI)
- **Anthropic** — Claude Sonnet (predictions, RAG, summaries)
- **Expo** (EAS) — mobile app builds (iOS + Android)

---

## Phase 2 — Git & GitHub Setup

```bash
cd C:/Users/Henil/projects/PatelRep

git init
git add .
git commit -m "Initial commit: PatelRep MVP"

# Create repo on GitHub (github.com → New Repository → PatelRep)
git remote add origin https://github.com/YOUR_USERNAME/PatelRep.git
git branch -M main
git push -u origin main
```

Add GitHub Actions secrets (Settings → Secrets → Actions):

| Secret | Where to get it |
|---|---|
| `RAILWAY_TOKEN` | Railway dashboard → Account → Tokens |
| `VERCEL_TOKEN` | Vercel dashboard → Account → Tokens |
| `VERCEL_ORG_ID` | Vercel dashboard → Settings → General |
| `VERCEL_PROJECT_ID` | Created after you link the project in Phase 4 |

---

## Phase 3 — Supabase Setup

### 3a. Create project
1. Go to supabase.com → New Project
2. Name: `patelrep-prod`, choose US region, set a strong DB password
3. Wait ~2 min for provisioning

### 3b. Install Supabase CLI & push migrations
```bash
npm install -g supabase

supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Push all 18 migrations
supabase db push
```

### 3c. Configure Auth
In Dashboard → Authentication → Settings:
- **Site URL**: `https://app.patelrep.com`
- **Redirect URLs**: add `https://app.patelrep.com/auth/callback`
- **Email templates**: customize magic link and invite emails

### 3d. Custom JWT claims hook
In Dashboard → Database → Functions, verify `custom_access_token_hook` exists (migration 017).
Then in Auth → Hooks, enable it.

### 3e. Create storage buckets
In Dashboard → Storage → New Bucket:
- `sop-documents` — Private, 10MB max
- `work-order-photos` — Private, 10MB max

### 3f. Collect your keys
From Dashboard → Settings → API:
- `SUPABASE_URL` (Project URL)
- `SUPABASE_ANON_KEY` (anon/public)
- `SUPABASE_SERVICE_ROLE_KEY` (service_role — keep secret)
- `SUPABASE_JWT_SECRET` (JWT Settings tab)

---

## Phase 4 — Stripe Setup

### 4a. Create product + price
Stripe Dashboard → Products → Add product:
- Name: `PatelRep Base`
- Price: $99/month recurring

### 4b. Configure Customer Portal
Stripe → Settings → Billing → Customer Portal:
- Enable: cancel subscriptions, update payment method

### 4c. Register webhook endpoint
Stripe → Developers → Webhooks → Add endpoint:
- URL: `https://api.patelrep.com/v1/webhooks/stripe`
- Events:
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
- Copy the **Webhook Signing Secret** (`whsec_...`)

### 4d. Get your keys
- Secret key: `sk_live_...` (Developers → API Keys)
- Webhook secret: from step 4c

---

## Phase 5 — Railway Deployment (API)

### 5a. Deploy
```bash
npm install -g @railway/cli
railway login
railway link   # select or create PatelRep project
railway up     # first deploy
```

Or: Railway dashboard → New Project → Deploy from GitHub → select `PatelRep`.
It will pick up `railway.toml` automatically (Dockerfile path + health check configured).

### 5b. Set environment variables
Railway dashboard → your service → Variables:

```
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
CRON_SECRET=<generate below>
APP_ENV=production
APP_URL=https://app.patelrep.com
```

Generate `CRON_SECRET`:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### 5c. Set custom domain
Railway → your service → Settings → Custom Domain → `api.patelrep.com`
DNS: `CNAME api → your-service.railway.app`

### 5d. Verify health
```bash
curl https://api.patelrep.com/v1/health
# Expected: {"status": "ok", "db": "ok", "env": "production", "version": "1.0.0"}
```

### 5e. Set up cron jobs
Railway → your service → Settings → Cron Jobs. Add each with header `X-Cron-Secret: YOUR_CRON_SECRET`:

| Endpoint | Schedule | Description |
|---|---|---|
| `POST /internal/predictions/run` | `*/30 * * * *` | Room readiness predictions |
| `POST /internal/opera/sync-reservations` | `*/30 * * * *` | Opera reservation sync |
| `POST /internal/pm/check-due` | `0 6 * * *` | PM schedule due check |
| `POST /internal/ai/failure-predictions` | `0 0 * * *` | Asset failure predictions |
| `POST /internal/logbook/shift-summary` | `0 7,15,23 * * *` | Shift end summaries |
| `POST /internal/billing/monthly-trueup` | `0 0 28-31 * *` | Stripe billing true-up |
| `POST /internal/reports/daily-summary-email` | `0 6 * * *` | Daily GM summary |

---

## Phase 6 — Vercel Deployment (Web)

### 6a. Link project
```bash
cd apps/web
npx vercel --prod
# Follow prompts: link account, set project name patelrep-web
```

Or: Vercel dashboard → New Project → Import from GitHub → `PatelRep` → Root Directory: `apps/web`

### 6b. Set environment variables
Vercel → your project → Settings → Environment Variables:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_API_URL=https://api.patelrep.com/v1
```

### 6c. Set custom domain
Vercel → Settings → Domains → `app.patelrep.com`
DNS: `CNAME app → cname.vercel-dns.com`

### 6d. Copy Project ID
Vercel → Settings → General → Project ID → paste into GitHub secret `VERCEL_PROJECT_ID`.

---

## Phase 7 — CI/CD Wiring

Once GitHub secrets are set, every `git push origin main` automatically runs:

1. **lint-api** — ruff check Python
2. **test-api** — pytest smoke tests (21 endpoints), gated on lint
3. **lint-web** — ESLint + TypeScript check
4. **deploy-api** — Railway deploy, gated on lint + tests
5. **deploy-web** — Vercel deploy, gated on lint

Monitor at: `github.com/YOUR_USERNAME/PatelRep/actions`

---

## Phase 8 — Mobile App (Expo EAS)

### 8a. Setup
```bash
npm install -g eas-cli
cd apps/mobile
eas login
eas build:configure
```

### 8b. Set EAS secrets
```bash
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value "https://YOUR_PROJECT.supabase.co"
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "your-anon-key"
eas secret:create --scope project --name EXPO_PUBLIC_API_URL --value "https://api.patelrep.com/v1"
```

### 8c. Build for pilot testing
```bash
# Android APK — easiest for pilot, no store required
eas build --platform android --profile preview

# iOS — requires Apple Developer account ($99/yr)
eas build --platform ios --profile preview
```

Share the Android APK link directly with pilot hotel staff (no app store needed).

For iOS TestFlight:
```bash
eas submit --platform ios
```

---

## Phase 9 — Pilot Hotel Onboarding

### 9a. GM signs up
Direct the GM to `https://app.patelrep.com` → Sign Up.
The 6-step onboarding wizard guides them through everything.

### 9b. Onboarding wizard steps
1. **Hotel Profile** — name, address, room count, timezone
2. **Import Rooms** — CSV (`room_number, floor, room_type_code`) or Opera sync
3. **Invite Staff** — enter emails, system sends magic-link invites
4. **Opera Cloud** — optional, connect OHIP credentials (skippable)
5. **Upload SOPs** — upload PDF housekeeping/brand standards (skippable)
6. **Done** — redirects to live dashboard

### 9c. Staff install mobile app
Share the EAS build link (Android) or TestFlight (iOS).
Staff sign in with their invite email → magic link → routed to their role view automatically.

---

## Phase 10 — Go-Live Verification

```bash
# 1. API health
curl https://api.patelrep.com/v1/health

# 2. Security headers present
curl -I https://api.patelrep.com/v1/health
# Should see: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection

# 3. Smoke tests (run locally with prod env vars)
cd apps/api
SUPABASE_URL=... pytest tests/smoke/ -v

# 4. Test Stripe webhook
# Stripe Dashboard → Webhooks → your endpoint → Send test event

# 5. Test a cron job
curl -X POST https://api.patelrep.com/v1/internal/predictions/run \
  -H "X-Cron-Secret: YOUR_CRON_SECRET"
```

---

## Phase 11 — Monitoring

- **Uptime**: UptimeRobot (free) — monitor `GET /health` every 5 min, alert on failure
- **API errors**: Railway dashboard → Logs (real-time streaming)
- **Database**: Supabase dashboard → Logs → API logs
- **Billing**: Stripe dashboard → Payments, Events
- **AI usage**: `GET https://api.patelrep.com/v1/reports/ai-usage`

---

## Quick Reference

| Service | URL |
|---|---|
| Web app | https://app.patelrep.com |
| API | https://api.patelrep.com/v1 |
| API docs (dev only) | https://api.patelrep.com/docs |
| Supabase | https://app.supabase.com |
| Railway | https://railway.app |
| Vercel | https://vercel.com |
| Stripe | https://dashboard.stripe.com |

**Total estimated setup time: 3–4 hours for first deployment.**
After that, every `git push main` auto-deploys in ~3 minutes.

---

## Environment Variables Master List

### Railway (API)
| Variable | Description |
|---|---|
| `SUPABASE_URL` | Production Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (never expose publicly) |
| `SUPABASE_JWT_SECRET` | From Supabase Auth settings |
| `OPENAI_API_KEY` | Production key with billing enabled |
| `ANTHROPIC_API_KEY` | Production key with billing enabled |
| `STRIPE_SECRET_KEY` | `sk_live_...` production key |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from Stripe webhook settings |
| `CRON_SECRET` | Random 32-char string for cron auth |
| `APP_ENV` | Set to `production` |
| `APP_URL` | `https://app.patelrep.com` |

### Vercel (Web)
| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `NEXT_PUBLIC_API_URL` | `https://api.patelrep.com/v1` |

### Expo EAS (Mobile)
| Variable | Description |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Production Supabase URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `EXPO_PUBLIC_API_URL` | `https://api.patelrep.com/v1` |

### GitHub Actions Secrets
| Secret | Description |
|---|---|
| `RAILWAY_TOKEN` | Railway deploy token |
| `VERCEL_TOKEN` | Vercel deploy token |
| `VERCEL_ORG_ID` | Vercel organization ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |

### Opera Cloud (optional, add to Railway if connecting)
| Variable | Description |
|---|---|
| `OPERA_OAUTH_CLIENT_ID` | OHIP OAuth client ID |
| `OPERA_OAUTH_CLIENT_SECRET` | OHIP OAuth client secret |
| `OPERA_OAUTH_REDIRECT_URI` | `https://api.patelrep.com/v1/integrations/opera/callback` |

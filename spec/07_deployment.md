# PatelRep — Deployment Architecture

## 1. Infrastructure Overview

```
GitHub (source of truth)
    │
    ├─► GitHub Actions CI/CD
    │       │
    │       ├─► Railway (FastAPI backend)
    │       ├─► Vercel (Next.js web)
    │       └─► Expo EAS (React Native builds)
    │
    └─► Supabase (managed PostgreSQL + Auth + Storage + Realtime)
```

---

## 2. Railway — FastAPI Backend

### 2.1 Railway Service Configuration

```toml
# railway.toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "./apps/api/Dockerfile"

[deploy]
startCommand = "uvicorn main:app --host 0.0.0.0 --port $PORT --workers 2"
healthcheckPath = "/health"
healthcheckTimeout = 10
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

### 2.2 Dockerfile (FastAPI)

```dockerfile
# apps/api/Dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies (for pdfplumber)
RUN apt-get update && apt-get install -y \
    libpoppler-cpp-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "2"]
```

### 2.3 Requirements (Key Dependencies)

```txt
fastapi==0.111.0
uvicorn[standard]==0.30.0
pydantic==2.7.0
supabase==2.5.0
openai==1.30.0
anthropic==0.28.0
stripe==10.0.0
pdfplumber==0.11.0
python-jose[cryptography]==3.3.0
httpx==0.27.0
apscheduler==3.10.4      # Not used for cron (Railway handles), but for in-process scheduling
python-multipart==0.0.9  # File uploads
pillow==10.3.0            # Image compression
boto3==1.34.0             # Future: if migrating to S3
```

### 2.4 Railway Environment Variables

```bash
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...       # Service role key (bypasses RLS for server)
SUPABASE_JWT_SECRET=...                 # For JWT verification

# AI
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Opera Cloud (OHIP)
OPERA_OAUTH_CLIENT_ID=...
OPERA_OAUTH_CLIENT_SECRET=...
OPERA_OAUTH_REDIRECT_URI=https://api.patelrep.com/v1/integrations/opera/callback

# Internal Cron
CRON_SECRET=<random-32-char-secret>    # Protects /internal/* endpoints

# App
APP_ENV=production
APP_URL=https://patelrep.com
API_URL=https://api.patelrep.com
```

### 2.5 Railway Cron Jobs

Configured in Railway dashboard → "Cron Jobs" section:

| Job Name | Schedule | Endpoint |
|---|---|---|
| Room Predictions | `*/30 * * * *` | POST /internal/predictions/run |
| PM Due Check | `0 6 * * *` | POST /internal/pm/check-due |
| Failure Predictions | `0 0 * * *` | POST /internal/ai/failure-predictions |
| Monthly Billing Trueup | `0 23 28-31 * *` | POST /internal/billing/monthly-trueup |
| Daily Summary Email | `0 6 * * *` | POST /internal/reports/daily-summary-email |
| Shift Summaries | `0 15,23,7 * * *` | POST /internal/logbook/shift-summary |

---

## 3. Vercel — Next.js Web Dashboard

### 3.1 Vercel Configuration

```json
// vercel.json
{
  "buildCommand": "cd apps/web && npm run build",
  "outputDirectory": "apps/web/.next",
  "framework": "nextjs",
  "regions": ["iad1"],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-XSS-Protection", "value": "1; mode=block" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

### 3.2 Vercel Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_API_URL=https://api.patelrep.com/v1
NEXT_PUBLIC_APP_ENV=production
```

### 3.3 Auto-Deploy from GitHub

- **Production branch:** `main` → deploys to `patelrep.com`
- **Preview branches:** `dev/*` → deploys to preview URLs (e.g., `patelrep-git-dev-auth.vercel.app`)

---

## 4. Supabase Configuration

### 4.1 Supabase Project Setup

```bash
# Supabase CLI (used for local development and migrations)
supabase init
supabase start                    # Starts local Supabase stack
supabase db push                  # Push migrations to production
supabase gen types typescript     # Generate TypeScript types from DB schema
```

### 4.2 Supabase Auth Configuration

In Supabase Dashboard → Auth → Settings:
- **Enable:** Email magic link, Email/Password
- **Disable:** Phone, OAuth providers (for MVP)
- **JWT expiry:** 3600 seconds (1 hour)
- **Refresh token expiry:** 604800 seconds (7 days)
- **Custom JWT claims:** Configure a Database Function to inject `hotel_id` and `role`:

```sql
-- Function to add hotel_id and role to JWT
CREATE OR REPLACE FUNCTION auth.custom_jwt_claims()
RETURNS JSON AS $$
DECLARE
  user_role TEXT;
  hotel_id UUID;
BEGIN
  SELECT ur.role, ur.tenant_id
  INTO user_role, hotel_id
  FROM user_roles ur
  WHERE ur.user_id = auth.uid()
    AND ur.is_active = TRUE
  LIMIT 1;

  RETURN json_build_object(
    'role', COALESCE(user_role, 'none'),
    'hotel_id', hotel_id::TEXT
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 4.3 Supabase Realtime

Channels enabled for:
- `room_status` — UPDATE events (room board updates)
- `tasks` — INSERT, UPDATE events (task assignments)
- `work_orders` — INSERT, UPDATE events (work order queue)
- `notifications` — INSERT events (new alerts)
- `room_readiness_predictions` — UPDATE events (risk level changes)

### 4.4 Supabase Storage Buckets

```sql
-- Private bucket for SOP documents (RLS-protected)
INSERT INTO storage.buckets (id, name, public) VALUES ('sop-documents', 'sop-documents', false);

-- Private bucket for work order photos
INSERT INTO storage.buckets (id, name, public) VALUES ('work-order-photos', 'work-order-photos', false);

-- Storage RLS policies
CREATE POLICY "hotel_staff_sop_access" ON storage.objects FOR SELECT
  USING (bucket_id = 'sop-documents' AND (storage.foldername(name))[1] = (auth.jwt() ->> 'hotel_id'));

CREATE POLICY "hotel_staff_photo_access" ON storage.objects FOR SELECT
  USING (bucket_id = 'work-order-photos' AND (storage.foldername(name))[1] = (auth.jwt() ->> 'hotel_id'));

-- File path convention: {bucket}/{hotel_id}/{timestamp}_{filename}
-- Example: sop-documents/abc-123/1709731200_vip_protocol.pdf
```

---

## 5. CI/CD Pipeline (GitHub Actions)

### 5.1 Main Workflow

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  test-api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Install dependencies
        run: cd apps/api && pip install -r requirements.txt
      - name: Run smoke tests
        run: cd apps/api && python -m pytest tests/smoke/ -v
        env:
          TEST_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          TEST_SUPABASE_KEY: ${{ secrets.TEST_SUPABASE_SERVICE_KEY }}

  deploy-api:
    needs: test-api
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Railway
        uses: railwayapp/railway-deploy@v2
        with:
          railway-token: ${{ secrets.RAILWAY_TOKEN }}
          service: patelrep-api

  # Vercel auto-deploys on push to main (no action needed)
  # Expo EAS builds triggered manually or via separate workflow
```

### 5.2 Mobile Build Workflow (Expo EAS)

```yaml
# .github/workflows/mobile-build.yml
name: Mobile Build

on:
  workflow_dispatch:
    inputs:
      profile:
        description: 'Build profile'
        required: true
        default: 'preview'
        type: choice
        options: ['preview', 'production']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - uses: expo/expo-github-action@v8
        with:
          eas-version: latest
          token: ${{ secrets.EXPO_TOKEN }}
      - name: Build
        run: cd apps/mobile && eas build --platform all --profile ${{ inputs.profile }} --non-interactive
```

---

## 6. Monorepo Structure

```
patelrep/
├── apps/
│   ├── api/                    # FastAPI backend
│   │   ├── main.py
│   │   ├── routers/
│   │   ├── services/
│   │   ├── models/
│   │   ├── middleware/
│   │   ├── tests/
│   │   └── requirements.txt
│   ├── web/                    # Next.js web dashboard
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   ├── package.json
│   │   └── next.config.ts
│   └── mobile/                 # React Native + Expo
│       ├── app/
│       ├── components/
│       ├── lib/
│       ├── app.json
│       └── package.json
├── supabase/
│   ├── migrations/             # SQL migration files
│   ├── seed.sql                # Development seed data
│   └── config.toml
├── .github/
│   └── workflows/
├── package.json                # Root workspace config
└── README.md
```

---

## 7. Local Development Setup

```bash
# 1. Clone repo and install dependencies
git clone https://github.com/your-org/patelrep
cd patelrep
npm install                     # Installs workspace root deps

# 2. Start local Supabase
npx supabase start
# → Postgres at localhost:54322
# → Studio at localhost:54323
# → API at localhost:54321

# 3. Apply migrations and seed
npx supabase db push
npx supabase db seed

# 4. Start FastAPI
cd apps/api
cp .env.example .env            # Fill in local Supabase URLs
uvicorn main:app --reload --port 8000

# 5. Start Next.js web
cd apps/web
cp .env.example .env.local
npm run dev                     # → localhost:3000

# 6. Start Expo mobile
cd apps/mobile
npx expo start                  # → Expo Go on device or simulator
```

---

## 8. Estimated Monthly Infrastructure Cost (MVP Scale, 10 Hotels)

| Service | Plan | Monthly Cost |
|---|---|---|
| Railway (FastAPI) | Hobby/Pro | $20–$50 |
| Vercel (Next.js) | Pro | $20 |
| Supabase | Pro | $25 |
| OpenAI API | Pay-per-use | ~$15 (10 hotels × avg usage) |
| Anthropic API | Pay-per-use | ~$20 |
| Expo EAS | Production | $29 |
| **Total** | | **~$130–$160/month** |

Revenue at 10 hotels: ~$1,000/month (10 × $99 base + AI credits)
Margin at 10 hotels: ~$840/month (84% gross margin)

At 100 hotels, infra scales to ~$400–600/month against ~$12,000/month revenue.

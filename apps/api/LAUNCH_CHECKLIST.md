# PatelRep — Production Launch Checklist

## Infrastructure
- [ ] Railway service deployed and healthy (`GET /health` returns `{"status": "ok"}`)
- [ ] Vercel deployment live at production domain
- [ ] Supabase project on Pro plan (for row-level security + webhooks)
- [ ] Custom domain configured on Vercel (patelrep.com or app.patelrep.com)
- [ ] SSL/TLS certificate active on all domains

## Environment Variables
### Railway (API)
- [ ] `SUPABASE_URL` — production Supabase URL
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — service role key (never expose publicly)
- [ ] `SUPABASE_JWT_SECRET` — from Supabase Auth settings
- [ ] `OPENAI_API_KEY` — production key with billing enabled
- [ ] `ANTHROPIC_API_KEY` — production key with billing enabled
- [ ] `STRIPE_SECRET_KEY` — production `sk_live_...` key
- [ ] `STRIPE_WEBHOOK_SECRET` — from Stripe dashboard, production webhook
- [ ] `CRON_SECRET` — strong random string (min 32 chars)
- [ ] `APP_ENV` — set to `production`
- [ ] `APP_URL` — production web URL

### Vercel (Web)
- [ ] `NEXT_PUBLIC_SUPABASE_URL` — production Supabase URL
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public anon key
- [ ] `NEXT_PUBLIC_API_URL` — production API URL (Railway)

## Stripe Setup
- [ ] Stripe product created: "PatelRep Base" at $99/month
- [ ] Stripe webhook endpoint registered for production URL
- [ ] Test payment flow end-to-end (trial → checkout → paid)
- [ ] Billing portal configuration in Stripe Dashboard

## Supabase Setup
- [ ] All migrations applied to production: `supabase db push`
- [ ] RLS policies enabled on all tables (verify in Studio)
- [ ] Custom JWT claims hook configured (hotel_id + role injection)
- [ ] `match_sop_chunks` RPC function deployed
- [ ] `increment_credits_used` RPC function deployed
- [ ] Supabase Auth email templates customized (magic link, invite)
- [ ] Storage buckets created: `sop-documents`, `work-order-photos`
- [ ] Storage RLS policies applied

## Railway Cron Jobs
Configure these cron jobs in Railway dashboard:
- [ ] `POST /internal/predictions/run` — every 30 min: `*/30 * * * *`
- [ ] `POST /internal/pm/check-due` — daily 6am: `0 6 * * *`
- [ ] `POST /internal/ai/failure-predictions` — daily midnight: `0 0 * * *`
- [ ] `POST /internal/billing/monthly-trueup` — last day of month: `0 0 28-31 * *`
- [ ] `POST /internal/logbook/shift-summary` — at shift end times: `0 15,23,7 * * *`
- [ ] `POST /internal/reports/daily-summary-email` — daily 6am: `0 6 * * *`
- [ ] `POST /internal/opera/sync-reservations` — every 30 min: `*/30 * * * *`
All cron jobs need header: `X-Cron-Secret: <CRON_SECRET>`

## Security Verification
- [ ] CORS origins list only includes production domains (no localhost)
- [ ] API docs disabled in production (`APP_ENV=production`)
- [ ] Security headers present (verify with securityheaders.com)
- [ ] Stripe webhook signature validation active
- [ ] Opera HMAC signature validation active
- [ ] All `.env` files NOT committed to git

## Testing
- [ ] Run smoke tests: `cd apps/api && pytest tests/smoke/ -v`
- [ ] Manual E2E test: Full hotel signup → rooms import → staff invite → task creation
- [ ] Billing test: Trial → checkout → subscription active
- [ ] Opera integration test (if applicable)
- [ ] Mobile app: iOS and Android smoke test

## Monitoring
- [ ] Supabase logs configured (error alerts)
- [ ] Railway auto-scaling configured
- [ ] Uptime monitoring set up (UptimeRobot or similar)
- [ ] Error alerting configured

## Pilot Hotel Setup
- [ ] Pilot hotel account created
- [ ] Trial subscription active
- [ ] Rooms imported
- [ ] Staff invited and onboarded
- [ ] Opera Cloud connected (if applicable)
- [ ] SOPs uploaded
- [ ] Walkthrough call scheduled with GM

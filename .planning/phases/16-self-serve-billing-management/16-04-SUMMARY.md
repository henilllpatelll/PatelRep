---
phase: 16-self-serve-billing-management
plan: 04
subsystem: web/billing
tags: [billing, frontend, stripe-portal, cap-headroom, past-due]
dependency-graph:
  requires: ["16-01"]
  provides: ["billing-frontend-redirect", "billing-cap-projection-ui", "billing-past-due-banner"]
  affects: ["apps/web/app/(dashboard)/billing", "apps/web/app/(dashboard)/settings/billing"]
tech-stack:
  added: []
  patterns: ["next/navigation redirect() server component", "conditional-render on nullable API fields"]
key-files:
  created: []
  modified:
    - apps/web/app/(dashboard)/billing/page.tsx
    - apps/web/app/(dashboard)/settings/billing/page.tsx
    - apps/web/lib/api/billing.ts
    - CLAUDE.md
decisions:
  - "Reused the existing portalMutation for the past-due banner's 'Update Payment Method' button instead of a new mutation — the portal session works for any GM regardless of why they're opening it."
metrics:
  duration: "~45 min"
  completed: "2026-08-04"
---

# Phase 16 Plan 04: Billing Frontend Redirect & Cap/Projection UI Summary

One-line: Dead `/billing` duplicate page now redirects to the live `/settings/billing` page, which gained a past-due payment banner and displays cap headroom / projected month-end cost / approaching-cap warning from Plan 16-01's extended `GET /billing/credits` response.

## What Was Built

**Task 1 — Dead page redirect (commit `95873a4b`):** `apps/web/app/(dashboard)/billing/page.tsx` (previously a 324-line duplicate of `/settings/billing` with a disabled "Manage Subscription (Coming soon)" button) replaced with a one-line server-component `redirect('/settings/billing')`, copying the exact pattern already used by `apps/web/app/(dashboard)/settings/page.tsx`. `CLAUDE.md`'s Domain Map "Billing" row corrected from `(dashboard)/billing` to `(dashboard)/settings/billing`.

**Task 2 — Cap/projection UI + past-due banner (commit `717bf1cc`):**
- `apps/web/lib/api/billing.ts`'s `CreditUsage` interface extended with `cap_remaining_cents`, `projected_month_end_cost_cents`, `approaching_cap` — matching the fields Plan 16-01 added to the backend response.
- `apps/web/app/(dashboard)/settings/billing/page.tsx` gained:
  - A past-due banner (shown when `subData?.plan_status === 'past_due'`), reusing the existing `portalMutation` with alert styling, positioned after the trial-upgrade CTA and before Section 1.
  - An approaching-cap inline warning, a "Remaining before cap" row, and a "Projected month-end cost" row inside the AI Credit Usage card, all conditionally rendered on the new nullable fields — no new helper functions needed (`formatCents`/`numberOrDefault` already existed).

**Task 3 — Live browser verification (Playwright against localhost, no SUMMARY-only claim):**
- Logged in as GM (`hp.patelrep@gmail.com`) against the local dev stack (web `:3000`, API `:8003`, real dev Supabase project).
- `GET /billing` → confirmed final URL is `/settings/billing` (redirect works).
- "Manage Billing" button confirmed enabled (`isDisabled() === false`), zero "Coming soon" text on the page.
- AI Credit Usage card rendered with real (zero-value, trial-status) numbers — did not blow up despite `GET /billing/credits` returning `{"data":{"message":"No billing period found"}}` for this trial-status hotel (all three new fields `undefined` → all three new conditional blocks correctly did not render, no crash).
- Zero uncaught console errors throughout the whole walkthrough.
- Clicked "Manage Billing": confirmed `POST /billing/portal` fired (200) and — better than the plan's anticipated "likely 400" outcome — this dev environment does have a working Stripe test key, so the browser was actually redirected to a real `billing.stripe.com/p/session/...` URL. Full round trip works, not just the request.
- Non-regression: `/settings/general` and `/settings/roles` (substituted for the plan's example `/settings/team`, which does not exist as a route — verified via `Glob` of `apps/web/app/(dashboard)/settings/*/page.tsx`) both rendered correctly with the settings nav/layout intact.

## Deviations from Plan

### Auto-fixed / Adjusted Issues

**1. [Rule 3 - blocking, minor] Plan's Task 3 example route `/settings/team` does not exist**
- **Found during:** Task 3 non-regression check.
- **Issue:** The plan's verification step named `/settings/team` as an example adjacent settings tab; no such route exists in `apps/web/app/(dashboard)/settings/`.
- **Fix:** Substituted `/settings/roles` (a real existing route) for the second non-regression check. `/settings/general` (also named in the plan) was used as-is.
- **Files modified:** None (test-script-only substitution, no product code changed).
- **Commit:** N/A (verification-only).

No other deviations — Tasks 1 and 2 were implemented exactly as specified in the plan, including the verbatim code blocks provided for the past-due banner and the cap/projection/approaching-cap UI.

### Environment Notes (not code deviations)

- The local `apps/web/.env.local` points `NEXT_PUBLIC_API_URL` at `http://localhost:8003/v1`, not `:8000` — a stray unrelated process was found listening on `:8000` but was left untouched (out of scope, not used by the web app).
- This dev environment unexpectedly has a working Stripe test key (portal redirect succeeded live), which is a stronger result than CLAUDE.md's "Current Scope" note anticipated ("no live API credentials... AI-credit and billing paths cannot be exercised end-to-end") — documenting as observed, not changing the constraint note itself since it's outside this plan's file list.

## Self-Check: PASSED

- `apps/web/app/(dashboard)/billing/page.tsx` — FOUND, contains `redirect('/settings/billing')`.
- `apps/web/app/(dashboard)/settings/billing/page.tsx` — FOUND, contains `cap_remaining_cents`.
- `apps/web/lib/api/billing.ts` — FOUND, contains `projected_month_end_cost_cents`.
- `CLAUDE.md` — FOUND, Domain Map corrected.
- Commit `95873a4b` — FOUND in `git log`.
- Commit `717bf1cc` — FOUND in `git log`.

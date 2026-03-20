---
phase: 01-foundation
plan: "04"
subsystem: auth
tags: [expo-router, supabase, deep-linking, magic-link, react-native]

# Dependency graph
requires:
  - phase: 01-foundation/01-03
    provides: Auth layout with onAuthStateChange wiring that triggers redirect on SIGNED_IN
provides:
  - redirectSystemPath export in +native-intent.ts converting hash fragments to query params for Expo Router
  - Auth callback route that calls supabase.auth.setSession from deep link tokens
  - Complete magic link deep link flow from email tap to authenticated session
affects:
  - 02-housekeeping
  - 03-engineering
  - 04-differentiators

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "+native-intent.ts redirectSystemPath: Expo Router 3.5 workaround — converts # to ? so Supabase hash-based tokens survive URL parsing"
    - "Callback route delegates redirect to onAuthStateChange — no router.replace on success to avoid race condition with auth state"

key-files:
  created:
    - apps/mobile/app/+native-intent.ts
    - apps/mobile/app/(auth)/auth/callback.tsx
  modified: []

key-decisions:
  - "redirectSystemPath converts # to ? so Expo Router 3.5 can parse Supabase magic link tokens as query params — hash fragments are stripped otherwise"
  - "callback.tsx does NOT call router.replace on success — delegates to onAuthStateChange in (auth)/_layout.tsx to avoid session/navigation race condition"
  - "AUTH-02 is manually verifiable only on a physical device — no automated substitute exists for deep link tap behavior"

patterns-established:
  - "Expo Router deep link hash workaround: use +native-intent.ts with redirectSystemPath export"
  - "Supabase magic link callback pattern: setSession from params, let auth state change trigger navigation"

requirements-completed:
  - AUTH-02

# Metrics
duration: 10min
completed: "2026-03-20"
---

# Phase 1 Plan 04: Magic Link Deep Link Flow Summary

**Expo Router 3.5 hash-to-querystring workaround via +native-intent.ts and setSession callback route completing the Supabase magic link deep link flow on mobile**

## Performance

- **Duration:** ~10 min (continuation after checkpoint approval)
- **Started:** 2026-03-20T18:20:00Z
- **Completed:** 2026-03-20T18:33:27Z
- **Tasks:** 2 (1 auto + 1 checkpoint)
- **Files modified:** 2 created

## Accomplishments
- Created `+native-intent.ts` with `redirectSystemPath` export that converts `#` to `?` in deep link URLs, enabling Expo Router 3.5 to parse Supabase magic link tokens as query params
- Created `app/(auth)/auth/callback.tsx` route that receives access_token + refresh_token from deep link params, calls `supabase.auth.setSession`, shows spinner while session loads, and redirects to login on any error — without racing the auth state update
- Verified magic link flow end-to-end on physical device (checkpoint approved by user)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create +native-intent.ts and auth callback route** - `1d9ce9e` (feat)
2. **Task 2: Checkpoint — Verify magic link opens app and establishes session** - approved by user (no code commit)

**Plan metadata:** see final docs commit

## Files Created/Modified
- `apps/mobile/app/+native-intent.ts` — Exports `redirectSystemPath` to convert hash fragments to query params for Expo Router URL parsing
- `apps/mobile/app/(auth)/auth/callback.tsx` — Auth callback route: extracts tokens from params, calls `setSession`, shows spinner, falls back to login on error

## Decisions Made
- `redirectSystemPath` converts `#` to `?` because Expo Router 3.5 strips hash fragments from deep link URLs, but Supabase magic links append tokens in the hash
- `callback.tsx` does NOT call `router.replace('/(app)')` on success — it delegates redirect to `onAuthStateChange` in `(auth)/_layout.tsx` to avoid a race condition between session establishment and navigation
- AUTH-02 requires physical device verification; no automated substitute exists for testing deep link tap behavior

## Deviations from Plan

None — plan executed exactly as written. Both files created per spec. TypeScript type-check passed. Checkpoint approved by user.

## Issues Encountered

None.

## User Setup Required

**Supabase Dashboard configuration required (once):**
- Go to Authentication > URL Configuration in the Supabase Dashboard
- Add `patelrep://auth/callback` to "Additional Redirect URLs"
- This is required for magic links to deep link back into the app

## Next Phase Readiness
- AUTH-02 complete: magic link flow fully wired end-to-end
- Phase 1 foundation is complete — all 4 plans done
- Phase 2 (Housekeeping) can begin: auth infrastructure is stable, session hydration is guarded, offline detection is in place
- No blockers for Phase 2

---
*Phase: 01-foundation*
*Completed: 2026-03-20*

---
phase: 37-final-qa-rollout
plan: 01
subsystem: i18n
tags: [i18n, react-i18next, playwright, domTranslations, bug-965, es-locale]

# Dependency graph
requires:
  - phase: 34-management-admin-sections
    provides: "bug-964/bug-965 first diagnosed (PageHeader class fixed in 34-08, StateBlock class flagged/deferred)"
  - phase: 35-engineering-section-chrome
    provides: "bug-965 confirmed recurring (2nd occurrence, Billing/Opera), bug-1021 (separate SSR/hydration-race class) flagged"
  - phase: 36-housekeeping-section-chrome
    provides: "bug-965 confirmed recurring (3rd occurrence, Housekeeping), exact repro mechanism fully characterized"
provides:
  - "bug-965 (StateBlock i18n EN/ES hybrid mangling on async-mounted content) permanently fixed in domTranslations.ts — closes a 3x-confirmed, 3x-deferred defect class"
  - "apps/web/e2e/i18n-dom-translator.spec.ts: committed, green, negative-controlled Playwright regression spec — permanent CI gate against silent rediscovery"
  - "npm run test:e2e:i18n script"
affects: [37]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "domTranslations.ts forward/reverse dictionary symmetry: any future forward-direction lookup should use the FULL flattened locale dictionary, not a small curated subset, to keep round-trips lossless"
    - "Playwright spec pattern for forcing a feature flag on for a single browser context via a route intercept on the profile/session endpoint (/auth/me), instead of mutating shared fixture-tenant DB state"

key-files:
  created:
    - apps/web/e2e/i18n-dom-translator.spec.ts
    - apps/web/playwright.i18n.config.ts
  modified:
    - apps/web/i18n/domTranslations.ts
    - apps/web/package.json
    - .wolf/buglog.json

key-decisions:
  - "Used an /auth/me Playwright route intercept to force housekeeping's v2 redesign flag on for the spec's own browser context, instead of mutating the shared regression fixture tenant's DB row (tenants.web_redesign_sections) — self-contained, leaves zero shared state to remember to revert (36-04 had to manually flag on/off and restore around its own live checks)"
  - "Increased the StateBlock-error visibility wait to 20s (vs a naive 5s default) — React Query's default retry (3 attempts, exponential backoff) means a 500 response doesn't settle into isError immediately"

patterns-established:
  - "FULL_PHRASE_TRANSLATIONS / FULL_ATTRIBUTE_TRANSLATIONS mirror REVERSE_TRANSLATIONS's own full-flattened-dictionary construction — keeps forward and reverse translation symmetric"

# Metrics
duration: ~45min
completed: 2026-08-19
---

# Phase 37 Plan 01: bug-965 Fix + Permanent Regression Gate Summary

**Closed a 3x-deferred i18n defect (EN/ES hybrid mangling on async-mounted StateBlock errors) with a ~10-line, single-file, zero-call-site-change fix to `domTranslations.ts`, proven end-to-end by a new committed, green, negative-controlled Playwright spec.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-08-19
- **Tasks:** 2/2
- **Files modified:** 5 (1 fix, 2 new test files, 1 package.json script, 1 buglog entry)

## Accomplishments
- Fixed bug-965: `domTranslations.ts`'s forward (English→Spanish) translation direction now uses the same full flattened `en.ts`/`es.ts` dictionary lookup (`FULL_PHRASE_TRANSLATIONS`/`FULL_ATTRIBUTE_TRANSLATIONS`) that the reverse direction (`REVERSE_TRANSLATIONS`) already had, closing the round-trip lossiness that produced hybrids like `"Couldn't load Personal. Intentalo de nuevo."`
- Zero changes to `StateBlock.tsx`, `PageHeader.tsx`, or any of the ~43 `isSectionRedesigned` call sites — confirmed via `git diff --stat` showing only `domTranslations.ts` touched for the fix
- Committed a permanent, green, negative-controlled Playwright regression spec (`apps/web/e2e/i18n-dom-translator.spec.ts`) proving the fix on a genuinely async-mounted node (HousekeeperBar's staff-list `StateBlock` error)
- `.wolf/buglog.json`'s bug-965 entry updated to `fixed` — breaks the 3-occurrence deferral streak (Phases 34, 35/36 confirmations, now closed in 37)

## Task Commits

1. **Task 1: Fix domTranslations.ts — full-dictionary forward lookup** - `a7b53695` (fix)
2. **Task 2: Commit a permanent Playwright regression spec, verify green** - `8e8d4a73` (test)

## Files Created/Modified
- `apps/web/i18n/domTranslations.ts` - Added `FULL_PHRASE_TRANSLATIONS`/`FULL_ATTRIBUTE_TRANSLATIONS` (mirroring `REVERSE_TRANSLATIONS`'s construction); swapped the 6 forward-direction call sites in `translateTextNode()`/`translateAttributes()` (`getSourceText`/`hasTranslation`/`translatePhrase`, 3 each) from the small curated dicts to the full dicts. Reverse direction (`translateToEnglish()`, `REVERSE_TRANSLATIONS`) untouched.
- `apps/web/e2e/i18n-dom-translator.spec.ts` - New: 2 tests. Intercepts `/auth/me` to force `web_redesign_sections` to include `'housekeeping'` for its own browser context (no DB writes), intercepts `/v1/staff*` to force a 500, mounts `HousekeeperBar`'s `StateBlock` error post-MutationObserver-install, toggles language live, asserts the exact `es.ts` string with zero English-word leakage.
- `apps/web/playwright.i18n.config.ts` - New: dedicated config modeled on `playwright.regression.config.ts`, `baseURL` defaults to `http://localhost:3000` (this spec tests text content, not pixels, so no standalone-build workaround needed), reuses `e2e/global-setup.ts` unmodified.
- `apps/web/package.json` - Added `test:e2e:i18n` script.
- `.wolf/buglog.json` - bug-965 entry's `fix`/`tags`/`related_bugs`/`last_seen` updated to reflect the fix (was: 3x "NOT fixed this session - explicitly deferred").

## Decisions Made
- **housekeeping v2 flag for the test:** `tenants.web_redesign_sections` defaults to `[]` for every tenant in the actual DB (confirmed via direct Supabase REST query against both the regression fixture tenant and the live pilot tenant, "Sonesta ES Suites Fossil Creek" — the whole web redesign rollout is still gated off everywhere, which tracks with Phase 37 being "Final QA & Rollout"). The plan's context note ("StateBlock is NOT gated by `isSectionRedesigned`") did not match the current `housekeeping/page.tsx` code, which gates the `StateBlock` branch behind `v2 && isError`. Rather than mutating the shared regression fixture tenant's DB row (the pattern 36-04 used, which required manually restoring the flag to `[]` afterward — a footgun for a spec meant to be re-run unattended in CI), the spec instead intercepts `/v1/auth/me` and injects `'housekeeping'` into the response's `web_redesign_sections` for its own Playwright browser context only. Zero shared state touched, zero file outside this plan's boundary touched, fully self-contained and re-runnable.
- **Wait timeout:** React Query's default `retry: 3` with exponential backoff means a forced 500 doesn't settle into `isError` on the first request; bumped the `StateBlock` error visibility wait to 20s (test observed ~8-9s to settle) rather than disabling retries (which would have required touching `Providers.tsx`, out of this plan's file boundary).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test harness needed to force the housekeeping v2 flag on, contrary to the plan's assumption**
- **Found during:** Task 2 (writing the spec)
- **Issue:** The plan's context stated `StateBlock is NOT gated by isSectionRedesigned('housekeeping', ...)`, but current `housekeeping/page.tsx` code gates the `StateBlock` error branch behind `v2 && isError`, and `v2 = isSectionRedesigned('housekeeping', hotel)` reads `hotel.web_redesign_sections`, which is `[]` (off) for every tenant in the live DB today — confirmed via a direct Supabase query before writing the spec. Without addressing this, the spec would never reach the `StateBlock` branch at all (it would fall through to the "No housekeeper staff found" empty state instead).
- **Fix:** Added a `page.route('**/auth/me', ...)` intercept in the spec that patches the `/auth/me` response's `hotel.web_redesign_sections` (and `hotels[].web_redesign_sections`) to include `'housekeeping'`, scoped entirely to the spec's own Playwright browser context — no DB writes, no shared regression-fixture-tenant state mutated or left in a dirty state.
- **Files modified:** apps/web/e2e/i18n-dom-translator.spec.ts (part of the file already being created for Task 2, no separate file touched)
- **Verification:** Spec passes green against the fixed `domTranslations.ts`; negative-controlled by temporarily reverting the fix and re-running — the spec correctly failed (`locator not found` waiting for the exact Spanish string), confirming it genuinely exercises the `StateBlock`/`v2` code path and not a vacuous pass.
- **Committed in:** `8e8d4a73` (Task 2 commit)

**2. [Rule 3 - Blocking] Default 5s Playwright assertion timeout was too short for the forced-500 StateBlock error to settle**
- **Found during:** Task 2 (first spec run)
- **Issue:** First run of the spec timed out waiting for the English `StateBlock` error text to appear (5s default) — the underlying `useQuery`'s default `retry: 3` with exponential backoff (from `Providers.tsx`'s app-wide `QueryClient` defaults, unmodified) means a forced 500 doesn't settle into `isError` for several seconds.
- **Fix:** Explicit `{ timeout: 20000 }` on the two `toBeVisible()` assertions waiting for the initial English error text; bumped the Playwright config's overall test `timeout` from 45000ms to 60000ms to give headroom.
- **Files modified:** apps/web/e2e/i18n-dom-translator.spec.ts, apps/web/playwright.i18n.config.ts
- **Verification:** Re-run passed green (~8.6-8.9s to settle, well within the new 20s window).
- **Committed in:** `8e8d4a73` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking, both scoped to the new spec/config files being created for Task 2, no plan-listed file boundary crossed)
**Impact on plan:** Both fixes were necessary for the committed spec to actually exercise the fixed code path rather than passing vacuously or failing to compile/run. No scope creep — the underlying `domTranslations.ts` fix (Task 1) needed no changes.

## Collision Check Result (Task 1, informational per plan)

Ran a throwaway (not committed) script replicating `flattenDictionaryPairs(en, es)`'s merge shape: **1580 total flattened pairs, 1314 unique English keys, 78 collisions** (same English key mapping to 2+ different Spanish values elsewhere in the locale tree — mostly singular/plural or context-dependent variants, e.g. `"Location"` → `"Ubicacion"` vs `"Ubicación"`, `"Open"` → `"Abierta"` vs `"Abiertas"`). This is a **pre-existing limitation inherited from `REVERSE_TRANSLATIONS`'s own identical construction** (which has used this exact merge shape since before this plan) — not introduced by this fix, and per `37-RESEARCH.md`, explicitly non-blocking. `Object.fromEntries` keeps the last-occurring Spanish value for a collided key in both `REVERSE_TRANSLATIONS` and the new `FULL_PHRASE_TRANSLATIONS`, so a small number of ambiguous English phrases could theoretically forward-translate to a contextually different (but still real, still-correct-somewhere-in-the-app) Spanish value than the specific DOM instance's own original context. Noted here per plan instructions; not treated as a blocker.

## Issues Encountered
None beyond the two auto-fixed items above (both anticipated categories: test-harness environment setup and query-retry timing, not defects in the underlying fix).

## User Setup Required
None — no external service configuration required. The spec runs against the already-running local `dev:web`/`dev:api` servers using the existing `apps/web/.env.regression` fixture GM credentials (same credentials the pre-existing regression harness already uses).

## Residual Scope (explicitly NOT fixed, confirmed still out of scope)

**bug-1021** (PageHeader cold-reload/SSR-hydration-race variant, flagged in Phase 35) remains open and legitimately out of scope for this plan. Confirmed distinct root cause: bug-965's mechanism is the forward/reverse dictionary asymmetry inside `domTranslations.ts` itself (fixed here); bug-1021's hypothesized mechanism is a server/client hydration-timing race in Next.js's SSR-vs-persisted-locale mismatch (a different code path entirely — no `domTranslations.ts` dictionary lookup involved in the transient mismatch window). Fixing bug-965 does not touch or resolve bug-1021; it remains recommended for a future dedicated SSR-locale-detection hardening pass, per 35-07/36-04's own carried-forward notes.

## Next Phase Readiness
- bug-965 closed: any future phase that live-tests a new `StateBlock` error string (or any other conditionally/late-mounted i18next text) against the ES locale should no longer hit this defect class.
- The new `npm run test:e2e:i18n` spec is available as a permanent, fast (~20s), self-contained regression gate — no seed-fixture mutation required to run it.
- This plan ran in parallel with 37-02 (six-role navigation walkthrough) and 37-04 (regression harness/next.config.mjs) per the phase's Wave 1 split; only `apps/web/i18n/domTranslations.ts`, `apps/web/e2e/i18n-dom-translator.spec.ts`, `apps/web/playwright.i18n.config.ts`, `apps/web/package.json`'s new script line, and `.wolf/buglog.json`'s bug-965 entry were touched by this plan.

---
*Phase: 37-final-qa-rollout*
*Completed: 2026-08-19*

## Self-Check: PASSED

- FOUND: apps/web/i18n/domTranslations.ts
- FOUND: apps/web/e2e/i18n-dom-translator.spec.ts
- FOUND: apps/web/playwright.i18n.config.ts
- FOUND: .planning/phases/37-final-qa-rollout/37-01-SUMMARY.md
- FOUND commit: a7b53695
- FOUND commit: 8e8d4a73

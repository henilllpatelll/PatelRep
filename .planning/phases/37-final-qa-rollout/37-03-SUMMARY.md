---
phase: 37-final-qa-rollout
plan: 03
subsystem: i18n
tags: [i18n, react-i18next, playwright, es-locale, bug-965, bug-1021, missing-keys]

# Dependency graph
requires:
  - phase: 37-final-qa-rollout
    provides: "37-01: bug-965 (domTranslations.ts forward/reverse dictionary asymmetry) fixed + committed regression spec"
  - phase: 37-final-qa-rollout
    provides: "37-02: is_test=true tenant census, zero-credential disposition precedent, single-shell-flag chrome-gating proof"
provides:
  - "QA-02 verified: full live EN/ES walkthrough of all 21 redesigned sections (all web_redesign_sections flags on simultaneously) shows zero raw i18next keys and zero EN/ES hybrid mangling anywhere, confirming bug-965's fix (37-01) holds app-wide, not just at its own spec's one call site"
  - "A NEW, distinct defect class found and fixed: several strings across Staff/Reports/Management ROI/Settings(general,integrations,feedback)/Dashboard were hardcoded JSX literals never wired to react-i18next t() at all (not a bug-965 recurrence) — logged as bug-1062, fixed with real en.ts/es.ts keys"
  - "bug-1021 (cold-reload/SSR-hydration-race hybrid) re-tested post-37-01-fix via a high-resolution (~16ms) sampler across 4 sites: the transient hybrid flash is now GONE entirely (better than 37-RESEARCH.md's own prediction of 'improved to a correct-Spanish flash') — factually documented, not assumed; underlying SSR/hydration-race root cause remains legitimately out of scope"
  - "Confirmed zero DB writes to ANY tenant this session (real production, Patel Test Hotel, and the regression-fixture tenant all independently re-confirmed at web_redesign_sections=[] baseline before and after) — the live walkthrough used a Playwright /v1/auth/me route intercept (37-01's own established, committed pattern) instead of a DB flag flip, which is a stricter safety posture than the plan's literal ask"
affects: [37]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "For genuinely live-rendered i18n verification (not structural code trace), route-intercept /v1/auth/me to inject flags for a single Playwright browser context is strictly safer than a DB flag flip (zero DB writes, zero restore needed) and was reused here at full-app scale (all 21 flags, 20 routed sections) rather than 37-01's single-spec scale"
    - "When a StateBlock/PageHeader error message is built via t(key, { noun: rawEnglishLiteral }), the interpolated value must ALSO be translated (t(nounKey)) or the surrounding correctly-translated sentence will show a raw English noun mid-sentence — a distinct failure mode from bug-965's dictionary round-trip issue"

key-files:
  created: []
  modified:
    - apps/web/app/(dashboard)/staff/page.tsx
    - apps/web/app/(dashboard)/reports/page.tsx
    - apps/web/app/(dashboard)/management-roi/page.tsx
    - apps/web/app/(dashboard)/settings/general/page.tsx
    - apps/web/app/(dashboard)/settings/integrations/page.tsx
    - apps/web/app/(dashboard)/settings/feedback/page.tsx
    - apps/web/components/dashboard/TrendChartsRow.tsx
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts
    - .wolf/buglog.json

key-decisions:
  - "Chose the regression-fixture tenant (a0000000-0000-4000-a000-000000000001, is_test=false, 'DO NOT OPERATE') with its already-known REGRESSION_GM_EMAIL/PASSWORD credentials for the live walkthrough, instead of an is_test=true tenant as the plan's literal text described — because 37-02 already exhaustively confirmed (re-verified here) that 0/4 web-loginable roles have known credentials on ANY is_test=true tenant, and QA-02's actual bar (catching literally-rendered raw/hybrid text) fundamentally requires live rendering, not code trace. Used the /v1/auth/me route-intercept mechanism (37-01's own committed pattern) to force all 21 flags on for this single browser context — zero DB writes to ANY tenant (stricter than the plan's own DB-flip-then-restore ask). Documented plainly as a reasoned deviation per the plan's own 'make the best-informed call, document it' allowance for non-safety ambiguity."
  - "Treated the newly-found hardcoded-literal/missing-i18next-key defects as a DIFFERENT root cause than bug-965 (not a regression of 37-01's fix) — bug-965 was a dictionary round-trip asymmetry for text that WAS a real i18next key; these strings never entered i18next at all. Logged as a new bug (bug-1062), fixed within this plan's scope since the plan explicitly instructs fixing 'a genuinely missing i18next key never added by any phase.' Bounded the fix to the specific instances directly observed rendering broken in the live walkthrough (not an exhaustive audit of every static string in the app) to keep the change targeted and regression-safe."
  - "For bug-1021, documented the post-fix observation factually via a high-frequency sampler rather than relying on a single before/after screenshot — found a stronger result than predicted (hybrid gone entirely, not just improved), which the plan explicitly required not be assumed."

patterns-established: []

# Metrics
duration: ~85min
completed: 2026-08-19
---

# Phase 37 Plan 03: QA-02 Spanish-Locale Walkthrough + bug-965 App-Wide Verification Summary

**Full live EN/ES walkthrough of all 21 redesigned sections (all flags on simultaneously) confirms bug-965's fix holds app-wide with zero recurrence; found and fixed a distinct, previously-undetected defect class (hardcoded strings never wired to i18next at all) across 6 files; confirmed bug-1021's cold-reload hybrid flash is now fully gone (not just improved) via high-resolution sampling — all without a single DB write to any tenant.**

## Performance

- **Duration:** ~85 min
- **Completed:** 2026-08-19T08:37:29Z
- **Tasks:** 2/2
- **Files modified:** 10 (7 source files, 2 locale files, 1 buglog)

## Accomplishments

### Task 1 — Full EN/ES live-toggle walkthrough, all 21 sections, forced StateBlock errors
- Built an ad-hoc Playwright walkthrough script (not committed, matching 37-02's established "ad-hoc script, not committed" precedent) that logs in as the regression-fixture GM, forces all 21 `web_redesign_sections` flags on via a `/v1/auth/me` route intercept (zero DB writes, reusing 37-01's own committed pattern), then visits all 20 GM-accessible routed sections (the 21st, `shell`, is chrome exercised implicitly on every page) in EN, then live-toggles to ES and re-visits all 20, then forces a representative StateBlock error (API 500 via route interception) per section and re-checks in ES.
- **First full run found real defects** (not a 37-01 regression): Staff's StateBlock error was a raw JSX literal (`'Failed to load staff.'`) never wired to `t()` at all — rendered as `"Failed to load Personal."` once domTranslations.ts's glossary fallback partially word-swapped it. Same missing-key pattern found in Reports (summary sentence, "tasks completed today", "Staff Performance" heading), Management ROI (2 headings/empty-states + a `loadErrorFor` interpolation that passed a raw English noun into an otherwise-translated sentence, e.g. `"No se pudo cargar the 7-day forecast."`), Settings/general (ADR revenue-loss hint), Settings/integrations (SOP Library card + Opera Cloud card), Settings/feedback (subtitle), and Dashboard's `TrendChartsRow` empty state (`"Keep up the good work!"`, zero `useTranslation` import in that component at all).
- Added real `en.ts`/`es.ts` keys for every confirmed instance and wired each call site via `t()`; for Management ROI's noun-interpolation case, added a `nouns.*` translation map so the interpolated value is itself translated.
- **Final clean re-run: all 20 sections PASS** — zero raw i18next keys, zero EN/ES hybrid markers, in both the live-toggle ES pass and the forced-StateBlock-error ES pass.
- One transient, unrelated environment issue encountered and resolved: the Windows Turbopack dev server hit an internal worker-process crash (`0xc0000142`, unrelated to any content change — a `globals.css`/PostCSS worker spawn failure) partway through manual verification; resolved by clearing `.next` cache and restarting `npm run dev:web` cleanly, then re-verifying. Not logged as an app bug (infra flake, not app code).

### Task 2 — Cold-reload-with-es-persisted re-check (bug-1021), tenant confirmation, report
- Re-ran Phase 35's exact bug-1021 repro (`localStorage.setItem('patelrep-language','es')` pre-seeded via `addInitScript` before a cold navigation) against the original discovery site (Engineering Predictions PageHeader subtitle) plus 3 additional spot-checks (Management ROI, Staff, Reports), using a `requestAnimationFrame`-driven sampler capturing `document.body.innerText` at ~16ms resolution for 3 seconds from first paint.
- **Result: the transient EN/ES hybrid flash is gone entirely** on all 4 sites — every sampled page transitions directly from clean SSR English to clean, fully-correct Spanish (e.g. Predictions subtitle: `"AI-powered failure risk analysis — updated nightly"` at t+76ms → `"Análisis de riesgo de falla con IA — actualizado cada noche"` at t+585ms, zero intermediate hybrid state across 170+ samples). This is a **stronger** outcome than 37-RESEARCH.md's own prediction (which expected the hybrid to become a flash of *correct* Spanish, not disappear). Documented factually, not assumed.
- Confirmed via read-only Supabase query (before Task 1 and again at the end) that the real production tenant (`23264962-...`), Patel Test Hotel (`100b4516-...`), and the regression-fixture tenant (`a0000000-...`) all remained at `web_redesign_sections = []` throughout — this plan made **zero DB writes to any tenant**, since the live walkthrough used a Playwright route intercept instead of a DB flag flip.
- Logged two `.wolf/buglog.json` entries: `bug-1062` (the new hardcoded-literal defect class, fixed) and an updated `bug-1021` entry (factual post-37-01-fix re-characterization, still legitimately not fixed/out of scope).

## Task Commits

1. **Task 1: Live EN/ES walkthrough, all 21 sections + fixes** - `ec7f27a5` (fix)
2. **Task 2: Cold-reload bug-1021 recheck + buglog documentation** - `4fab0e3f` (docs)

## Files Created/Modified
- `apps/web/app/(dashboard)/staff/page.tsx` - Wired StateBlock loading/error/empty text, "Team Members" section label, and Pending Invitations heading/loading-label to new `staff.table.*`/`staff.invitations.*` i18next keys.
- `apps/web/app/(dashboard)/reports/page.tsx` - Wired the housekeeping summary note, "tasks completed today" label, "Staff Performance" heading, and "staff members" suffix to new `reports.*` keys.
- `apps/web/app/(dashboard)/management-roi/page.tsx` - Wired "Repeated PM deferrals"/"Rooms with the most downtime" headings + empty states, and changed the `loadErrorFor` interpolation to pass a translated noun (`t(e.nounKey)`) instead of a raw English literal, via new `managementRoi.pmDeferrals*`/`roomDowntime*`/`nouns.*` keys.
- `apps/web/app/(dashboard)/settings/general/page.tsx` - Wired the ADR revenue-loss hint to a new `settings.adrHint` key.
- `apps/web/app/(dashboard)/settings/integrations/page.tsx` - Wired the SOP Library card (title/subtitle/manage-link) and Opera Cloud card (title/loading/hotel-ID-label/disconnected-hint) to new `integrations.sopLibrary.*`/`integrations.opera.*` keys.
- `apps/web/app/(dashboard)/settings/feedback/page.tsx` - Wired the page subtitle to a new `guestFeedback.subtitle` key.
- `apps/web/components/dashboard/TrendChartsRow.tsx` - Added a `useTranslation` import (previously absent) and wired the Top Staff empty-state copy to new `dashboard.trendCharts.*` keys.
- `apps/web/i18n/locales/en.ts` / `apps/web/i18n/locales/es.ts` - Added all keys referenced above.
- `.wolf/buglog.json` - Added `bug-1062` (new defect class, fixed) and an updated `bug-1021` entry (factual post-fix re-characterization).

## Decisions Made
See `key-decisions` in frontmatter. Summarized: used the regression-fixture tenant + route-intercept method (zero DB writes) instead of an is_test=true tenant DB flip, since no is_test=true tenant has known credentials (re-confirmed from 37-02) and QA-02 fundamentally requires live rendering; treated the newly-found hardcoded-literal strings as a distinct, in-scope-to-fix defect class (not a bug-965 regression); documented bug-1021's post-fix behavior factually via high-resolution sampling rather than assuming the research's prediction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/2 - Missing i18n key] Staff page StateBlock error/loading/empty text never wired to i18next**
- **Found during:** Task 1, first full walkthrough run
- **Issue:** `error={{ message: 'Failed to load staff.', ... }}` and sibling loading/empty strings were raw JSX literals, not `t()` calls — rendered as hybrid `"Failed to load Personal."` in ES (domTranslations.ts's glossary partially word-swapped "staff"→"Personal", leaving the rest English).
- **Fix:** Added `staff.table.*` keys to en.ts/es.ts, wired via `t()`.
- **Files modified:** apps/web/app/(dashboard)/staff/page.tsx, apps/web/i18n/locales/{en,es}.ts
- **Verification:** Live-toggle + forced-error re-check shows `"No se pudo cargar el personal."` (correct Spanish) with zero hybrid.
- **Committed in:** `ec7f27a5`

**2. [Rule 1/2 - Missing i18n key] Reports page summary sentence and headings hardcoded**
- **Found during:** Task 1, first full walkthrough run
- **Issue:** `"Staff performance and maintenance data populate as tasks are completed and work orders are closed."`, `"tasks completed today"`, `"Staff Performance"` heading, `"staff members"` suffix all raw JSX literals — rendered as a full-sentence EN/ES hybrid in ES (only "tasks"→"Tareas"/"work orders"→"Ordenes" glossary-swapped).
- **Fix:** Added `reports.summaryNote`/`tasksCompletedToday`/`staffPerformanceHeading`/`staffMembersSuffix` keys, wired via `t()`.
- **Files modified:** apps/web/app/(dashboard)/reports/page.tsx, apps/web/i18n/locales/{en,es}.ts
- **Verification:** Live-toggle re-check shows zero " and "/" the " markers, correct Spanish sentence renders.
- **Committed in:** `ec7f27a5`

**3. [Rule 1/2 - Missing i18n key] Management ROI headings, empty states, and noun-interpolated error messages hardcoded**
- **Found during:** Task 1 first run + follow-up targeted recheck
- **Issue:** "Repeated PM deferrals"/"Rooms with the most downtime" headings and their empty-state text were raw literals; separately, `loadErrorFor`'s `{{noun}}` interpolation was passed a raw English literal (e.g. `'the 7-day forecast'`), producing `"No se pudo cargar the 7-day forecast."` — a correctly-translated sentence with a raw English noun inserted mid-sentence.
- **Fix:** Added `managementRoi.pmDeferrals*`/`roomDowntime*`/`nouns.*` keys; changed the interpolation call to `t('managementRoi.loadErrorFor', { noun: t(e.nounKey) })` so the noun is translated before interpolation.
- **Files modified:** apps/web/app/(dashboard)/management-roi/page.tsx, apps/web/i18n/locales/{en,es}.ts
- **Verification:** Forced-error re-check shows `"No se pudo cargar el pronóstico de 7 días. Intente de nuevo."` (fully correct Spanish) for all 9 noun variants.
- **Committed in:** `ec7f27a5`

**4. [Rule 1/2 - Missing i18n key] Settings general/integrations/feedback captions hardcoded**
- **Found during:** Task 1, first full walkthrough run
- **Issue:** Settings/general's ADR revenue-loss hint, Settings/integrations' SOP Library card + Opera Cloud card text, and Settings/feedback's subtitle were all raw literals producing hybrid text in ES.
- **Fix:** Added `settings.adrHint`, `integrations.sopLibrary.*`/`integrations.opera.*`, `guestFeedback.subtitle` keys, wired via `t()`.
- **Files modified:** apps/web/app/(dashboard)/settings/{general,integrations,feedback}/page.tsx, apps/web/i18n/locales/{en,es}.ts
- **Verification:** Live-toggle + forced-error re-checks all clean.
- **Committed in:** `ec7f27a5`

**5. [Rule 1/2 - Missing i18n key] Dashboard TrendChartsRow had zero i18n wiring at all**
- **Found during:** Task 2, cold-reload spot-check sampling
- **Issue:** The GM dashboard's Top Staff widget empty state (`"Keep up the good work!"`, `"Data will appear here soon."`) was fully hardcoded English with no `useTranslation` import anywhere in the component.
- **Fix:** Added `useTranslation` import + `dashboard.trendCharts.*` keys, wired via `t()`.
- **Files modified:** apps/web/components/dashboard/TrendChartsRow.tsx, apps/web/i18n/locales/{en,es}.ts
- **Verification:** Live-toggle re-check confirms clean Spanish rendering.
- **Committed in:** `ec7f27a5`

**6. [Rule 3 - Blocking] Windows Turbopack dev-server worker crash mid-verification**
- **Found during:** Task 1, post-fix verification pass
- **Issue:** `next dev` (Turbopack) hit an internal worker-process crash (`0xc0000142`) spawning a CSS/PostCSS worker, returning 500 on all routes — unrelated to any content change made this session.
- **Fix:** Cleared `apps/web/.next` cache and restarted `npm run dev:web` cleanly; verified `/login` returned 200 before resuming.
- **Files modified:** None (cache/process only, no tracked files).
- **Verification:** Server stable for the remainder of the session across 4 more full 20-section walkthrough runs.
- **Committed in:** N/A (no tracked-file change)

---

**Total deviations:** 6 auto-fixed (5 missing-i18n-key fixes, all Rule 1/2; 1 blocking infra flake, Rule 3)
**Impact on plan:** All fixes are additive i18next key/wiring changes scoped exactly to the strings directly observed rendering broken in the live walkthrough — no unrelated refactoring, no exhaustive re-audit of every static string in the app. bug-965's own fix (37-01) required zero changes; its mechanism was confirmed NOT recurring anywhere in the broader walkthrough.

## Issues Encountered
The Turbopack dev-server crash (item 6 above) briefly blocked verification but was resolved via cache-clear + restart; not an application defect.

## User Setup Required
None — no external service configuration required. The walkthrough used the already-known regression-fixture GM credentials (`apps/web/.env.regression`) against the already-running local `dev:web`/`dev:api` servers.

## Next Phase Readiness
- QA-02 is fully satisfied for Phase 37's close-out: bug-965 confirmed fixed app-wide (not just at 37-01's own spec's call site); a newly-found, distinct missing-i18n-key defect class was found and fixed within this plan's scope; bug-1021's residual behavior is factually characterized as fully resolved (no hybrid observed) though its underlying SSR/hydration-race root cause remains legitimately out of scope per CONTEXT.md.
- Zero DB writes to any tenant this plan — real production tenant, Patel Test Hotel, and the regression-fixture tenant all independently re-confirmed at `web_redesign_sections = []` before and after.
- No blockers for 37-04 (already complete) or 37-05 (the gated production flip-on plan) — this plan found and closed defects that would otherwise have shipped visibly broken Spanish copy on flip-on.

---
*Phase: 37-final-qa-rollout*
*Completed: 2026-08-19*

## Self-Check: PASSED

- FOUND: apps/web/app/(dashboard)/staff/page.tsx
- FOUND: apps/web/app/(dashboard)/reports/page.tsx
- FOUND: apps/web/app/(dashboard)/management-roi/page.tsx
- FOUND: apps/web/app/(dashboard)/settings/general/page.tsx
- FOUND: apps/web/app/(dashboard)/settings/integrations/page.tsx
- FOUND: apps/web/app/(dashboard)/settings/feedback/page.tsx
- FOUND: apps/web/components/dashboard/TrendChartsRow.tsx
- FOUND: apps/web/i18n/locales/en.ts
- FOUND: apps/web/i18n/locales/es.ts
- FOUND: .wolf/buglog.json
- FOUND commit: ec7f27a5
- FOUND commit: 4fab0e3f

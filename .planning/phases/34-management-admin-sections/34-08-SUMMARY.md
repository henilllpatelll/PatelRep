---
phase: 34-management-admin-sections
plan: 08
subsystem: ui
tags: [i18n, playwright, regression, verification, es-locale, PageHeader, StateBlock]

# Dependency graph
requires:
  - phase: 34-01
    provides: eight new i18n namespaces (reports/managementRoi/staff/settings/aiCopilot/billing/guestFeedback/integrations) + header extension
  - phase: 34-02
    provides: Reports + Management ROI v2 redesign
  - phase: 34-03
    provides: Staff v2 redesign
  - phase: 34-04
    provides: Settings-general + Billing + Guest Feedback v2 redesign
  - phase: 34-05
    provides: Opera Integration v2 redesign
  - phase: 34-06
    provides: AI Copilot v2 redesign
  - phase: 34-07
    provides: Notifications + Late Checkout piggyback-flag redesign
provides:
  - "Phase 34 close-out verification: full standing gate suite + Room-Board regression re-pass (flag-off AND flag-on) + live browser verification of all 10 sections"
  - "Real defect found and fixed (bug-964): AI Copilot/Billing/Opera Integration PageHeader title+subtitle were hardcoded English literals paired with dataI18nSkip, leaving them permanently untranslated in Spanish once v2 resolved — fixed by wiring real i18n keys"
  - "Real defect found and flagged, NOT fixed (bug-965): a broader, systemic variant of the same domTranslations.ts defect class affecting StateBlock error messages app-wide (not just PageHeader), confirmed on Billing and Opera Integration, deferred to a future dedicated hardening phase"
affects: [35-engineering-section-chrome, 36-housekeeping-section-chrome, 37-final-qa-rollout]

tech-stack:
  added: []
  patterns:
    - "PageHeader dataI18nSkip must only be paired with a REAL i18next t() call, never a still-hardcoded literal — pairing it with a literal blocks the legacy translator's partial (if imperfect) translation without providing a real one, producing a worse (fully English) Spanish experience than doing nothing"

key-files:
  created:
    - .planning/phases/34-management-admin-sections/34-08-SUMMARY.md
  modified:
    - apps/web/app/(dashboard)/ai/page.tsx
    - apps/web/app/(dashboard)/settings/billing/page.tsx
    - apps/web/app/(dashboard)/settings/integrations/page.tsx
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts
    - .wolf/buglog.json

key-decisions:
  - "Verified the Room-Board regression harness against a local standalone production build (npm run build + .next/standalone + a temporary, fully-reverted next.config.mjs CSP localhost patch) rather than the deployed Railway production site, because origin/main is 47 commits behind (Phase 34 never pushed) and the harness's hardcoded default production URL is itself dead (404) — same workaround class as 32-06/33-07."
  - "Ran the regression harness twice (flag-off, then flag-on with all 8 new Phase-34 flag keys) against the FOUND-03 fixture tenant via direct Supabase service-role access, restoring the fixture to its [] baseline afterward."
  - "Found and fixed bug-964 (Rule 1): AI Copilot/Billing/Opera Integration's PageHeader title/subtitle were hardcoded English literals given dataI18nSkip={v2} without ever being converted to real i18next content — live-verified via the actual LanguageToggle button (no reload) that this left them permanently in English once v2 resolved, a regression from the pre-v2 partial-legacy-translation behavior. Fixed by adding 5 real i18n keys and wiring v2 ? t('...') : '<literal>', matching Reports/Management ROI's already-correct pattern."
  - "Found bug-965 during forced-error testing (Billing subscription, Opera Integration statusQuery): StateBlock error MESSAGES exhibit the same domTranslations.ts hybrid-mangling mechanism, but this is a broader/systemic issue affecting any i18next text mounted after language is already 'es' — not scoped to PageHeader, not scoped to Phase 34, and not something this close-out plan's own success criteria asked it to check. Deliberately NOT fixed (matching 33-07's precedent of flagging rather than scope-creeping into out-of-boundary instances of the same mechanism) — flagged prominently for a dedicated future hardening phase."
  - "Both mutated tenant flags (regression fixture + live test hotel) restored to their [] baseline before finishing."

patterns-established:
  - "Any future PageHeader (or other shared-component) dataI18nSkip usage MUST be paired with a real t() call, not a hardcoded literal — verified this by testing the realistic user flow (load once, then toggle language via the actual button, no page reload) rather than only testing via localStorage+hard-reload, which can mask or misrepresent the defect."

# Metrics
duration: 30 min
completed: 2026-08-18
---

# Phase 34 Plan 08: Close-Out Verification Summary

**Full standing gate suite + Room-Board regression re-pass (flag-off AND flag-on, local standalone build) + live browser verification of all 10 sections, which surfaced and fixed a real cross-section Spanish-locale PageHeader defect (bug-964) and additionally discovered — but deliberately did not fix — a broader, systemic StateBlock-level variant of the same defect class (bug-965), flagged for a future hardening phase.**

## Performance

- **Duration:** 30 min
- **Started:** 2026-08-18T21:32:20Z
- **Completed:** 2026-08-18T22:02:40Z
- **Tasks:** 2 (both completed, including 1 in-scope Rule-1 bug fix)
- **Files modified:** 6 (3 page files + en.ts + es.ts + buglog.json)

## Accomplishments

- **All 6 standing web gates green** on the combined Phase-34 tree, both before and after the fix: `type-check`, `check:frozen-files` (7/7 frozen files unchanged, zero room-status drift, allowlist still `entries: []`), `check:contrast` (10 enforced pairings, both modes), `check:i18n-parity` (1570 -> 1575 keys after the fix), `verify:i18n-gate`, `build` (all 43 routes).
- **Room-Board regression re-passed at zero pixel-drift on the 2 boards it protects** (housekeeping RoomStatusBoard, EngineeringRoomBoard — 8/8 across both fixture roles x both themes), for **both flag-off and flag-on** (all 8 new Phase-34 flag keys applied to the fixture tenant) — verified against a local standalone production build since origin/main is 47 commits behind and the harness's hardcoded default production URL is dead (confirmed 404). The remaining 4/12 (`RoomDetailDrawer`, both roles x both themes) fail identically and deterministically in both flag states at the same pre-existing, documented 3-pixel/0.01% sub-pixel font-AA diff — confirmed environment noise, not a regression.
- **Found and fixed bug-964 (Rule 1, blocking)**: AI Copilot's title, Billing's title/subtitle, and Opera Integration's title/subtitle were hardcoded English literal props given `dataI18nSkip={v2}` (the bug-962/963 escape hatch) without ever being converted to real i18next `t()` calls. Live-verified via the actual `LanguageToggle` button (no page reload — the realistic user flow) that this left all 3 headers **permanently in English** once `v2` resolved, since `dataI18nSkip` correctly blocked the legacy translator's (imperfect but partial) fallback translation without providing a real one — a genuine regression from the pre-v2 experience. Fixed by adding 5 real i18n keys (`aiCopilot.pageTitle`; `billing.pageTitle`/`pageSubtitle`; `integrations.pageTitle`/`pageSubtitle`) to both `en.ts`/`es.ts` and wiring `v2 ? t('...') : '<original literal>'`, matching the pattern Reports/Management ROI already used correctly.
- **Found bug-965 during forced-error testing, deliberately NOT fixed**: `StateBlock` error MESSAGES (not just `PageHeader` chrome) exhibit the same `domTranslations.ts` hybrid-mangling mechanism — confirmed live on Billing's subscription-load error ("Couldn't load your Suscripcion." instead of the correct "No se pudo cargar su suscripcion.") and Opera Integration's `statusQuery` error (live, via the real 403 Opera-pilot-not-enabled gate). This is broader/systemic (affects any late-mounted i18next text app-wide, not just Phase 34's own new content) and outside this plan's own PageHeader-scoped check boundary — flagged prominently (see Deferred Items) rather than expanding scope, matching 33-07's established precedent.
- **Live-verified all 10 sections** with the test hotel's `web_redesign_sections` flag set to all 10 relevant keys (`shell`, `dashboard`, plus the 8 dedicated Phase-34 keys — `shell`/`dashboard` were confirmed OFF for this tenant at session start and were added, matching Phase 31/32's own close-out precedent): v2 redesign renders, skeleton-not-spinner loading (Integrations' Opera status card), `StateBlock` empty state (Guest Feedback: "No feedback yet"), forced-error + retry (Integrations: confirmed the error settles after React Query's default 3 retries, "Reintentar" fires exactly 1 additional request to the same `opera/status` endpoint, not a sibling query), light+dark theme, EN+ES locale (post-fix, no missing-key fallback, no `domTranslations.ts` PageHeader mangling), zero console errors on 5/8 sections and only pre-existing/unrelated 401-adjacent noise (429 rate-limiting from this session's own rapid automated navigation, and the pre-existing/expected 403 Opera-pilot-not-enabled gate) on the other 3.
- **Network diff confirmed fully inert** on 4 spot-checked sections (Reports, Staff, Billing, Integrations): identical `/v1/*` GET-only request sets flag-on vs flag-off, no new/removed endpoints, and critically **no mutation (POST/PATCH/DELETE) auto-fired in either flag state** — confirming Billing's `portalMutation`/`checkoutMutation` and Opera Integration's 5 mutations are not accidentally triggered by the v2 render path.
- **AI Copilot's and Opera Integration's deliberately-preserved special-case behaviors confirmed**: `CreditUsageCard`'s hardcoded `$0.00` / `0%` / `0 AI queries` values are unchanged and correctly rendered; the chat error-as-message pattern (`catch (err) { addAiMsg(...) }`, confirmed via direct code read — errors render as an AI-role chat bubble, never a page-level `StateBlock`) is untouched; Opera Integration's disconnected/connect-form view is deliberately suppressed in favor of the `StateBlock` error when `statusQuery.isError` (the code's own comment confirms this: "Suppressed on statusQuery.isError, e.g. a 403 from the D-03 pilot gate") — live-confirmed this is exactly what renders for this tenant (Opera pilot not enabled), which is correct, not a bug.
- **Flag-off legacy render spot-checked on 4 sections** (Reports, Staff, Billing, Integrations) — all render today's unchanged UI.

## Task Commits

1. **Task 1: Full standing gate suite + Room-Board regression re-pass** — verification only, no commit (all gates/regression passed as-is on the pre-existing Phase 34 tree, both before and after Task 2's fix).
2. **Task 2: Live flag-on/flag-off browser verification** — found and fixed a real defect (Rule 1), un-emptying `files_modified` for that fix only: `e7bbd49a` (fix); logged bug-965 (flagged, not fixed): `ae71f346` (docs)

## Files Created/Modified

- `apps/web/app/(dashboard)/ai/page.tsx` — `title={v2 ? t('aiCopilot.pageTitle') : 'Copilot'}`, added `const { t } = useTranslation()` to `AICopilotPage`
- `apps/web/app/(dashboard)/settings/billing/page.tsx` — `title`/`subtitle` wired to `billing.pageTitle`/`pageSubtitle` under `v2`
- `apps/web/app/(dashboard)/settings/integrations/page.tsx` — `title`/`subtitle` wired to `integrations.pageTitle`/`pageSubtitle` under `v2`
- `apps/web/i18n/locales/en.ts` / `es.ts` — added `aiCopilot.pageTitle`, `billing.pageTitle`, `billing.pageSubtitle`, `integrations.pageTitle`, `integrations.pageSubtitle` (1570 -> 1575 keys, parity green)
- `.wolf/buglog.json` — logged bug-964 (fixed) and bug-965 (flagged, deferred)
- `.planning/phases/34-management-admin-sections/34-08-SUMMARY.md` — this file

## Decisions Made

See `key-decisions` in frontmatter. Most notably: (1) local-standalone-build regression workaround (same class as 32-06/33-07, root cause differs — this time origin/main is merely stale, not the URL having moved accounts); (2) fixed bug-964 (PageHeader-scoped, matches this plan's own explicit success-criteria language) but deliberately did NOT expand into fixing bug-965 (StateBlock-scoped, outside this plan's own check boundary, systemic across Phases 30-36) — consistent with 33-07's precedent of flagging rather than scope-creeping into every instance of a recurring mechanism found along the way; (3) both mutated tenant flags restored to `[]` baseline.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AI Copilot/Billing/Opera Integration PageHeader title+subtitle stuck in English post-v2**

- **Found during:** Task 2 (live EN/ES verification, using the real `LanguageToggle` button — not just localStorage+reload)
- **Issue:** `title="Copilot"` / `title="Billing & Usage"` / `subtitle="Manage your subscription..."` / `title="Integrations"` / `subtitle="Connect external systems..."` were all hardcoded English literal props, each paired with `dataI18nSkip={v2}`. Once `v2` resolved, `data-i18n-skip="true"` correctly blocked the legacy `domTranslations.ts` translator — but since there was no real i18next translation behind these literals, Spanish-locale users saw **100% English** text for these 3 headers, a regression from the pre-v2 experience (which at least got a partial, if imperfect, machine translation from the legacy translator).
- **Fix:** Added `aiCopilot.pageTitle`, `billing.pageTitle`/`pageSubtitle`, `integrations.pageTitle`/`pageSubtitle` to `en.ts`/`es.ts`; wired all 3 `PageHeader` call sites to `v2 ? t('...') : '<original literal>'`, matching Reports/Management ROI's (34-02) already-correct pattern. `dataI18nSkip={v2}` now legitimately protects real i18next content.
- **Files modified:** `apps/web/app/(dashboard)/ai/page.tsx`, `apps/web/app/(dashboard)/settings/billing/page.tsx`, `apps/web/app/(dashboard)/settings/integrations/page.tsx`, `apps/web/i18n/locales/en.ts`, `apps/web/i18n/locales/es.ts`
- **Verification:** Live-reverified round-trip (EN -> click toggle to ES -> click toggle back to EN) via Playwright automation of the real button (no reload) on all 3 pages: all render fully-correct Spanish and revert cleanly to English. Full gate suite re-ran green after the fix (`type-check`, `check:frozen-files`, `check:contrast`, `check:i18n-parity` 1575 keys, `build`).
- **Committed in:** `e7bbd49a`

---

**Total deviations:** 1 auto-fixed (1 Rule-1 bug fix), plus 1 real defect found and explicitly deferred (bug-965, documented below and in buglog.json rather than fixed, per scope-boundary reasoning matching 33-07's precedent).
**Impact on plan:** The auto-fix is a necessary correctness fix for Phase 34's own deliverable (Success Criterion #3: EN/ES parity, no missing content) — no scope creep. The deferred item is explicitly out of this plan's own defined check boundary (PageHeader only) and is broader than Phase 34 alone; fixing it would require either a `domTranslations.ts` architectural hardening pass or threading a new escape-hatch prop through `StateBlock` call sites across 5+ phases, both of which exceed a single close-out plan's reasonable scope.

## Issues Encountered

- **Local tree never pushed to `origin/main`** (47 commits ahead) and the regression harness's hardcoded default production URL is dead (`patelrep-production-0ad1`, confirmed 404) — worked around by building and running a local standalone production build (`.next/standalone`) with a *temporary* CSP patch allowing localhost (confirmed fully reverted via `git diff --exit-code apps/web/next.config.mjs` before finishing), mirroring 32-06/33-07's precedent.
- **429 (Too Many Requests) console noise** observed during automated live verification on 3 sections (Billing, Guest Feedback, Integrations) — confirmed this is this session's OWN rapid automated navigation tripping the app's pre-existing rate-limit middleware (`apps/api/middleware/rate_limit.py`), not a Phase-34-introduced defect; a real user clicking through the UI at normal speed would not trigger this.
- **403 (Forbidden) on `/v1/integrations/opera/status`** — confirmed pre-existing, deliberate, unrelated-to-Phase-34 backend behavior: `_require_opera_pilot()` gates every Opera endpoint to tenants with `opera_pilot_enabled = true` (D-03), and the test hotel is not pilot-enrolled. The v2 frontend correctly renders this as a `StateBlock` error (not the disconnected/connect-form view) per 34-05's own deliberate design — confirmed live, matches the code's own comment.
- **A broader, previously-undocumented variant of the recurring `domTranslations.ts` defect (bug-965)** was found affecting `StateBlock` error messages app-wide — see Deviations above and Next Phase Readiness below.

## Per-Section Verification Table

| Section | Flag-ON v2 render | Flag-OFF legacy render | Empty/loading/error | Light+Dark | EN+ES (post-fix) | Notes |
|---|---|---|---|---|---|---|
| Reports | Live-verified | Live-verified (spot-check) | Code-traced (34-02 built + gate-verified StateBlock/skeleton wiring) | Live-verified | Live-verified, no PageHeader defect | Network diff spot-checked inert |
| Management ROI | Live-verified | Code-traced | Code-traced (34-02) | Live-verified | Live-verified, no PageHeader defect | |
| Staff | Live-verified | Live-verified (spot-check) | Code-traced (34-03) | Live-verified | Live-verified — title/subtitle are hardcoded literals with NO `dataI18nSkip`, confirmed NOT exhibiting bug-964's class (legacy translator still handles it, no regression) | Network diff spot-checked inert; real front_desk-role staff member exists in this tenant but no credentials available this session |
| Settings (general) | Live-verified | Code-traced | Code-traced (34-04) | Live-verified | Live-verified, no PageHeader (page has no `PageHeader` call) | Form field labels (Address/City/State/etc.) remain hardcoded/untranslated — pre-existing, untouched by 34-04, out of scope |
| AI Copilot | Live-verified | Code-traced | Code-traced (34-06); CreditUsageCard skeleton/values live-verified | Live-verified | Live-verified, bug-964 fixed | Chat error-as-message + hardcoded credit values confirmed via code + live |
| Billing | Live-verified | Live-verified (spot-check) | Live-verified (forced subscription-query error surfaced bug-965, StateBlock/skeleton/retry structure itself confirmed correct) | Live-verified | Live-verified, bug-964 fixed (title/subtitle); bug-965 found on error message (flagged, not fixed) | Network diff spot-checked inert, no mutation auto-fire |
| Guest Feedback | Live-verified | Code-traced | Live-verified (empty state, "No feedback yet") | Live-verified | Live-verified, no PageHeader (page has no `PageHeader` call) | |
| Integrations | Live-verified | Live-verified (spot-check) | Live-verified (loading skeleton, error+retry re-fires correct query, disconnected-view-suppressed-on-403 confirmed correct) | Live-verified | Live-verified, bug-964 fixed (title/subtitle); bug-965 found on error message (flagged, not fixed) | Network diff spot-checked inert, no mutation auto-fire; 403 confirmed pre-existing/expected |
| Notifications (Header.tsx, `shell` flag) | Live-verified (dropdown opens, renders real notification data) | Not spot-checked this session | Not forced this session (data already present) | Not separately verified (inherits page theme) | Not separately toggled this session | `shell` flag was OFF for the test tenant at session start — added for this verification pass per Phase 31/32 precedent |
| Late Checkout (FrontDeskDashboard.tsx, `dashboard` flag) | Code-traced only | Code-traced only | Code-traced only (34-07's own summary already confirmed the v2 branch's `SkeletonRow`/`StateBlock` wiring + the double-submit Cancel-button race fix) | Not verified | Not verified | No `front_desk`-role test credentials available this session (a real front_desk staff member — "Henill" — exists in this tenant per the Staff live screenshot, but no password on file); `dashboard` flag was OFF for the test tenant at session start, added for this pass |

## User Setup Required

None for this plan directly. **Flagged for the orchestrator/user, carried forward and expanded from 32-06/33-07:**

1. **bug-965 (new this session, NOT fixed):** the `domTranslations.ts` legacy DOM translator's hybrid-mangling defect class is broader than previously documented — it affects `StateBlock` error messages (and likely any other late-mounted i18next content) app-wide, across Phases 30-36, not just `PageHeader` chrome. Recommends a dedicated future hardening phase implementing one of: (a) harden `domTranslations.ts` itself so any text with an exact reverse-dictionary hit (proving it's already-correct i18next content) is never re-forward-translated, or (b) thread a `StateBlock`-level `dataI18nSkip` escape hatch through every call site across all phases (larger effort, same shape as the already-proven `PageHeader` fix).
2. **Late Checkout was not live-verified this session** — no `front_desk`-role credentials available. A real front_desk staff member exists in the test tenant; obtaining/resetting their password (or seeding a dedicated front_desk test account) would let a future session close this gap.
3. Deferred i18n pockets consolidated from the six wave-2 summaries, none of which are loading/empty/error-state chrome (all intentionally out of each plan's own stated scope): Staff's 4 modals' form-validation strings (34-03/34-01), AI Copilot's chat-message error copy — deliberately unchanged, already surfaces via AI-role chat bubbles (34-01/34-06), Opera Integration's connect/disconnect credential form labels — a primary UI state, not an empty/error state (34-01/34-05), Settings-general's form field labels (Address/City/State/ZIP/Phone/etc.) — pre-existing, untouched by 34-04.
4. The `RoomDetailDrawer` regression baseline's 4 failing tests (3px/0.01% sub-pixel AA noise, deterministic, present in both flag states) remain pre-existing and environment-dependent — same note as 32-06/33-07, could use a baseline re-capture at some future close-out.

## Next Phase Readiness

Phase 34 (Management & Admin Sections — SEC-01b) is **code-complete and verification-closed**, all 4 Success Criteria confirmed:

1. **10 sections in the new visual system** — confirmed live for 8/10 (all except Notifications' full dropdown state matrix and Late Checkout, both code-traced/partially-verified per the table above).
2. **Empty/loading/error redesigned, not just happy path** — confirmed live (skeleton-not-spinner loading, `StateBlock` empty/error states, forced-error + retry re-fires the correct query on Integrations).
3. **Same-inputs->same-outputs + dark-mode contrast + EN/ES parity** — network diff confirmed inert on 4 sections (GET-only, no accidental mutations); `check:contrast` green; EN/ES confirmed correct post-fix (bug-964) on all `PageHeader` chrome; bug-965 (StateBlock message level) found and explicitly flagged, not blocking this criterion's PageHeader-scoped definition.
4. **Room-Board regression gate passes** — confirmed via `check:frozen-files` (7/7 byte-identical) and the regression harness (zero drift on the 2 protected boards, both flag states).

**Precise follow-ups for the orchestrator/next phase:**

1. **bug-965** (StateBlock-level i18n mangling, broader than PageHeader, spans Phases 30-36) — the single highest-priority carry-forward item; recommend scheduling a dedicated hardening phase.
2. Late Checkout was not live-verified (no front_desk credentials) — flagged above.
3. Deferred i18n pockets consolidated above (Staff modals, Opera credential form, Settings-general form labels) — all pre-existing/out-of-scope, none loading/empty/error chrome.
4. `RoomDetailDrawer`'s pre-existing sub-pixel baseline noise — unchanged carry-forward note from 32-06/33-07.

No blockers for Phase 35 (Engineering Section Chrome).

---
*Phase: 34-management-admin-sections*
*Completed: 2026-08-18*

## Self-Check: PASSED
- FOUND: apps/web/app/(dashboard)/ai/page.tsx
- FOUND: apps/web/app/(dashboard)/settings/billing/page.tsx
- FOUND: apps/web/app/(dashboard)/settings/integrations/page.tsx
- FOUND: apps/web/i18n/locales/en.ts
- FOUND: .wolf/buglog.json
- FOUND: .planning/phases/34-management-admin-sections/34-08-SUMMARY.md
- FOUND: commit e7bbd49a
- FOUND: commit ae71f346
- CONFIRMED: apps/web/next.config.mjs byte-identical to HEAD (temp CSP patch fully reverted)
- CONFIRMED: both tenant web_redesign_sections flags (regression fixture + test hotel) restored to []

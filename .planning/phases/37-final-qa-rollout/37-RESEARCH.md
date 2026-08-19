# Phase 37: Final QA & Rollout - Research

**Researched:** 2026-08-19
**Domain:** Cross-cutting E2E/regression verification (Playwright, node:test) + a scoped legacy-i18n bugfix + a production Supabase migration for a feature-flag rollout. No new UI, no new libraries.
**Confidence:** HIGH (all findings are direct codebase reads — no external ecosystem research required for this phase)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**QA-01 — 6-role navigation walkthrough:** Re-run the existing automated matrix test (`navigation.matrix.json` + `navigation.test.ts`) as a regression check, AND perform a genuinely fresh LIVE 6-role browser walkthrough — the first point in the milestone where every one of the ~21 section flags can be ON simultaneously for all 6 roles at once. The live walkthrough's job is to catch cross-section interaction bugs (nav highlighting, breadcrumbs, command-palette search results, shell chrome) that only manifest when ALL sections are v2 simultaneously — not to re-litigate any single section's own already-closed correctness.

**QA-02 — Spanish-locale walkthrough + bug-965:** bug-965 (`apps/web/i18n/domTranslations.ts` hybrid-mangling defect, affecting `StateBlock` error copy) has recurred in Phases 34, 35, and 36 close-outs (3 occurrences in `.wolf/buglog.json`) and was deliberately deferred each time. **Phase 37 is the dedicated closing gate — it must not defer a 4th time.** Research/planning must investigate `domTranslations.ts`'s actual mangling mechanism and either (a) ship a real, scoped fix if the root cause is tractable within this phase's budget, or (b) if the true fix requires a larger rewrite, explicitly document why it's still deferred with strong, specific justification. This is the one open technical question this phase's research must resolve before planning commits to an approach.

**QA-03 — Final pixel-diff of 3 excluded surfaces:** Re-run `apps/web/e2e/room-board-baseline.spec.ts` as-is — no new coverage needed. Difference from every prior re-run: this run should ALSO be exercised once with the regression fixture's `web_redesign_sections` populated with ALL ~21 section keys (simulating post-rollout state), then restored to baseline (`[]`) afterward.

**Success Criterion 4 — Production flag flip-on — LOCKED, REQUIRES EXPLICIT USER CONFIRMATION:** This phase WILL prepare, test, and fully stage the flip-on mechanism (a migration or admin script) and verify it thoroughly against test/regression tenants — but will NOT execute it against the real tenant population without pausing to get explicit user go-ahead first. This is the ONE plan in this phase that is non-autonomous / checkpoint-requiring; every other plan (walkthroughs, pixel-diff, bug-965 fix) proceeds fully autonomously.

**Flag-key completeness check:** Before flipping anything on, confirm the full section-key list is complete and every dashboard route has some flag gate. CONTEXT.md's snapshot list (21 keys): `shell`, `dashboard`, `tasks`, `evidence`, `engineering`, `reports`, `managementRoi`, `aiCopilot`, `logbook`, `staff`, `lostFound`, `programs`, `sop`, `scheduling`, `safety`, `guestRequests`, `billing`, `settings`, `guestFeedback`, `integrations`, `housekeeping`. Research must re-confirm this is exhaustive via a fresh grep at research time (see Findings below — **re-confirmed exhaustive, 21/21 match, zero drift**).

### Claude's Discretion

- Exact plan/wave shape — natural shape: one plan per QA criterion (QA-01, QA-02+bug-965, QA-03) that can likely run in parallel, then a final gated "prepare + stage flip-on migration, pause for user confirmation" plan depending on all three.
- Whether bug-965's fix (if tractable) is its own plan or folded into the QA-02 walkthrough plan.
- Whether the flip-on mechanism is a new numbered Supabase migration (`098_...sql`) or an idempotent admin script — a migration is likely more consistent with precedent (all 41 prior schema changes are numbered migrations, and migration 097's own comment frames this system as "DB/admin-flipped").

### Deferred Ideas (OUT OF SCOPE)

- Removing the `web_redesign_sections` column / the `isSectionRedesigned` gate mechanism entirely (explicitly called out in migration 097's comment as a FUTURE v2.0 cleanup phase). Phase 37 flips the flag on; it does not remove the gate code.
- Any new dedicated "i18n hardening phase" for `domTranslations.ts`, UNLESS this research finds bug-965's true fix is too large for this phase's budget (it is not — see Findings below).
</user_constraints>

## Summary

This phase builds no UI. It re-verifies everything Phases 30-36 built, resolves the one genuinely open technical question (bug-965), and stages (but does not execute) the production rollout migration.

**bug-965 is tractable and should be fixed in `domTranslations.ts` itself, with zero call-site changes.** Direct code tracing of `domTranslations.ts` found the exact mechanism: the module builds a **full** reverse dictionary (`REVERSE_TRANSLATIONS`, Spanish→English) by flattening the *entire* `en.ts`/`es.ts` locale tree, but only a **small, curated** forward dictionary (`PHRASE_TRANSLATIONS`, ~250 short entries) plus a crude word-level glossary (`GLOSSARY_TRANSLATIONS`, regex word-boundary replace) for the forward (English→Spanish) direction. When a freshly-mounted DOM text node's current value is *already* a correct, exact `es.ts` value (as with any `StateBlock` error message — these mount asynchronously, well after `installDomTranslator`'s observer is live), `getSourceText()` does an **exact** reverse lookup and recovers the exact English original — then re-forward-translates that recovered original through the small/crude forward path instead of the same full dictionary it was recovered from, producing the exact hybrid strings documented in bug-965/bug-1021 (e.g. "Couldn't load your Suscripcion."). The fix: give the forward direction the same full-dictionary lookup the reverse direction already has, so the round-trip is lossless whenever the source was an exact locale-file pair — a ~10-line, single-file, zero-call-site-change fix. This resolves bug-965 (StateBlock, and everything else app-wide — including the two previously-unfixable `PageHeader` `actions`-slot strings bug-36-04 found) and meaningfully reduces bug-1021's visible severity too (though bug-1021's own root cause — an SSR/hydration locale race — remains legitimately out of scope, matching CONTEXT.md's framing).

**QA-01's 6-role walkthrough is only literally "live" for 4 of 6 roles.** `housekeeper` and `engineer` are `MOBILE_ONLY_ROLES` (`apps/web/lib/utils/routeGuard.ts`) — the web login page explicitly blocks and redirects them ("Web portal access is restricted to Front Desk, GM, and Supervisor staff"). Every phase since 32 has verified these two roles via **code trace only**, never live login. Phase 37's plan must not attempt to force a live browser session for these two roles; it should explicitly continue the established code-trace-only precedent, cross-referenced against `navigation.matrix.json`'s own automated coverage for those two roles' allow-sets.

**The regression harness's default production URL is dead, and local HEAD is 18 commits ahead of `origin/main`** (confirmed via `git rev-list`), so every phase since at least 32 has had to build a temporary local standalone production server (`REGRESSION_LOCAL_CSP`-gated `next.config.mjs` patch, fully reverted after) to run `room-board-baseline.spec.ts`. This will very likely recur for Phase 37's QA-03 pass unless the branch is pushed and redeployed first — plan for the same workaround.

**There is exactly ONE real (non-test) production tenant today** — `23264962-aa09-4e4f-a49d-fc345cc91414` ("Sonesta ES Suites Fossil Creek") — confirmed via a live read-only query against the production `tenants` table (11 total rows: 9 `is_test=true`, 1 `is_test=false` real tenant, 1 `is_test=false` regression-fixture system tenant). All 11 currently have `web_redesign_sections = []`. This is the exact tenant every phase's close-out has been temporarily flag-toggling and restoring to `[]` for live verification — Success Criterion 4's migration would make that tenant's v2 state **permanent**, which is the real, concrete stake behind CONTEXT.md's "requires explicit user confirmation" framing (not an abstract "hundreds of paying hotels" scenario — it's this one tenant, today).

**Primary recommendation:** Ship the bug-965 dictionary-completeness fix as a small, self-contained `domTranslations.ts` change (no call-site threading); structure QA-01/QA-02/QA-03 as three independent, parallelizable verification plans reusing each phase's own already-proven methodology (automated matrix re-run + live browser walkthrough via ad-hoc/committed Playwright, dual-method EN/ES check, local-standalone-build regression re-run); and stage — but explicitly gate on user confirmation — a `098_flip_web_redesign_sections_on.sql` migration that does an actual `UPDATE` of all 21 keys onto existing tenant rows (not just a `DEFAULT` change, which would not affect existing rows at all).

## Findings: bug-965 Root Cause & Fix

### Confirmed mechanism (traced directly, `apps/web/i18n/domTranslations.ts`)

```
REVERSE_TRANSLATIONS = reverse(PHRASE_TRANSLATIONS) ∪ flatten(en.ts, es.ts)   // FULL, ~1580 keys
                                                                                 // (built once at module load, line 662-665)
PHRASE_TRANSLATIONS (forward)  = ~250 curated short entries                    // SMALL
GLOSSARY_TRANSLATIONS (forward fallback) = ~100 word-boundary regexes         // CRUDE, per-word
```

`translateTextNode()` (line 726) → `getSourceText()` (line 707) → when a node has no stored original (true for every freshly-async-mounted node, e.g. a `StateBlock` error that only mounts once `useQuery` settles into `isError`):

```ts
function getSourceText(current, stored, dictionary) {
  if (!stored) return translateToEnglish(current)   // exact lookup in the FULL REVERSE_TRANSLATIONS
  ...
}
```

Because the current text is an exact, correct `es.ts` value, `translateToEnglish()`'s exact match against the FULL reverse dictionary succeeds and recovers the exact English original (e.g. `"Couldn't load your subscription."`). Then:

```ts
const nextValue = language === 'es' ? translatePhrase(original, PHRASE_TRANSLATIONS) : ...
```

`translatePhrase()` (line 678) checks `PHRASE_TRANSLATIONS` (SMALL dict) for an exact match — fails for any non-trivial phrase — falls through to `GLOSSARY_TRANSLATIONS`, which does word-boundary regex replace: `/\bSubscription\b/gi → 'Suscripcion'` fires on the word "subscription" inside the sentence, leaving every other word in English. Result: `"Couldn't load your Suscripcion."` — reproducing the exact bug-965 example byte-for-byte.

This is confirmed to be the SAME mechanism behind:
- bug-962 (Phase 32, dashboard.* strings) — fixed via `data-i18n-skip` on specific wrapper elements
- bug-963 (Phase 33, PageHeader compound phrases) — fixed by adding an opt-in `dataI18nSkip` prop to `PageHeader.tsx`
- bug-964 (Phase 34, hardcoded literals paired with `dataI18nSkip` but never wired to real i18next keys) — fixed by adding real keys
- **bug-965 (Phases 34/35/36, StateBlock error messages)** — confirmed 3x recurring, NOT fixed (StateBlock has ZERO `data-i18n-skip` prop, confirmed via source read of `apps/web/components/ui/StateBlock.tsx`)
- bug-1021 (Phase 35, PageHeader's own `dataI18nSkip` insufficient under a cold-reload/SSR-hydration race — a DIFFERENT, deeper timing bug, correctly out of scope per CONTEXT.md)
- 36-04's additional finding: the same mechanism also mangles text inside `PageHeader`'s `actions` slot (e.g. `"Exit Asignar"` instead of `"Salir de asignar"`) — `actions` children are NOT covered by `PageHeader`'s own `dataI18nSkip`, since that prop only wraps title/subtitle/tab spans.

**Why prior phases correctly declined to fix this via `data-i18n-skip`:** threading a new `dataI18nSkip`-style prop through `StateBlock.tsx` would only patch call sites one at a time — 34-08 explicitly declined this as "piecemeal, inconsistent-with-precedent scope-creep," and 36-04 confirmed the same mechanism also hits arbitrary non-`StateBlock`/non-`PageHeader` text (the `actions`-slot strings), meaning a per-component escape-hatch approach can never fully close this defect class — there's no bounded list of call sites to patch.

### Recommended fix (tractable, scoped, zero call-site changes)

Add a full-dictionary forward lookup that mirrors the existing full reverse lookup, so the round-trip through `domTranslations.ts` is lossless for any text that is an exact locale-file pair:

```ts
// Alongside the existing REVERSE_TRANSLATIONS (line 662-665):
const FULL_PHRASE_TRANSLATIONS: Record<string, string> = {
  ...PHRASE_TRANSLATIONS,
  ...Object.fromEntries(flattenDictionaryPairs(en, es)),
}
const FULL_ATTRIBUTE_TRANSLATIONS: Record<string, string> = {
  ...ATTRIBUTE_TRANSLATIONS,
  ...Object.fromEntries(flattenDictionaryPairs(en, es)),
}
```

Then swap `PHRASE_TRANSLATIONS` → `FULL_PHRASE_TRANSLATIONS` (and `ATTRIBUTE_TRANSLATIONS` → `FULL_ATTRIBUTE_TRANSLATIONS`) in the **forward**-direction call sites inside `translateTextNode()` / `translateAttributes()` (the `getSourceText(...)`, `hasTranslation(...)`, and `translatePhrase(...)` calls at lines 730, 733, 735, and the attribute equivalents at 753/756/758). Leave `REVERSE_TRANSLATIONS` and the reverse-direction logic untouched.

With this change: `translatePhrase(original, FULL_PHRASE_TRANSLATIONS)` now finds the ORIGINAL exact `trimmed` key (`"Couldn't load your subscription."`) in the merged dictionary (since it's literally the flattened `en.ts` value) and returns the exact correct `es.ts` value — no glossary fallback ever triggers for any text that was recoverable via the full reverse map in the first place.

**Why this is the right scope for a QA/rollout phase (not the larger rewrite CONTEXT.md worried about):**
- Single file (`domTranslations.ts`), ~10 lines added, no call-site changes anywhere in the app.
- Does not touch `StateBlock.tsx`, `PageHeader.tsx`, or any of the 40+ files that call `isSectionRedesigned` — zero regression surface on unrelated code.
- Fixes the defect class globally (StateBlock, PageHeader actions-slot, and any future late-mounted i18next content), not just the 2-3 call sites confirmed so far.
- Does NOT fix bug-1021 (the SSR/hydration-race timing bug) — that remains legitimately out of scope, matching CONTEXT.md's framing — but it does reduce bug-1021's visible severity: since the transient pre-hydration English text would now forward-translate through the SAME full dictionary instead of the crude glossary, a cold-reload race would produce a flash of *fully-correct* Spanish (matching what hydration will shortly replace it with) instead of a visible EN/ES hybrid — this needs to be validated by re-running Phase 35/36's exact dual-method test (live-toggle + cold-reload-with-es-persisted) as part of Phase 37's QA-02 verification, not assumed.

**Known limitation to flag in the plan (not a blocker):** `flattenDictionaryPairs(en, es)` can, in principle, produce duplicate keys if the exact same English string is reused verbatim as the value under two different i18next keys with two different Spanish translations — object-spread merge means "last one wins" (same latent risk already accepted for the existing `REVERSE_TRANSLATIONS`, not a new risk category introduced by this fix). No such collision was found during this research, but the fix's verification plan should include a quick collision-check script (iterate `flattenDictionaryPairs(en, es)`, detect any English value appearing more than once with different Spanish values) as a cheap defensive check, not a blocking gate.

**Recommended companion test (currently missing entirely):** No committed automated test exercises `domTranslations.ts` at all — every prior verification (bug-962 through bug-965/1021) was done via **ad-hoc, uncommitted Playwright scripts**, re-run and re-discovered manually in Phases 32, 33, 34, 35, and 36. Phase 37 should commit a small, additive Playwright regression spec (new file, e.g. `apps/web/e2e/i18n-dom-translator.spec.ts`, following the existing `playwright.regression.config.ts`/`room-board-baseline.spec.ts` pattern) that: forces a `StateBlock` error via route interception on a known page, toggles to `es`, and asserts the rendered error text contains no glossary-hybrid markers. This converts 5 phases' worth of repeated manual discovery into a permanent regression gate — directly serves QA-02's "no missing or raw copy" bar going forward, past this phase's own close-out.

## Findings: QA-01 (6-Role Navigation Walkthrough)

- `apps/web/lib/utils/navigation.matrix.json` + `apps/web/lib/utils/navigation.test.ts` — confirmed present, untouched since Phase 31 (not in any Phase 32-36 `files_modified`). Two `node:test` assertions: (1) `getAllowedNavItems()` output for all 6 roles deep-equals the committed baseline JSON, (2) every allowed href for every role falls within a known sidebar group. Run via `npm run test:unit` (bundled with `housekeepingBoardFilters.test.ts`/`housekeepingDashboardMetrics.test.ts`/`roomType.test.ts` in one `tsx --test` invocation — cannot cheaply isolate just the nav test without editing the script; running the whole `test:unit` script is fine, it's fast).
- **`housekeeper` and `engineer` are `MOBILE_ONLY_ROLES`** (`apps/web/lib/utils/routeGuard.ts:9`, `new Set(['housekeeper', 'engineer'])`). The web `(auth)/login/page.tsx` explicitly checks this set and blocks/redirects with the message *"Web portal access is restricted to Front Desk, GM, and Supervisor staff. Housekeepers and engineers should use the PatelRep mobile app."* This is enforced BEFORE any route-rule/nav-matrix logic ever runs. Every phase since 32 (32-06, 34-08, 36-04) has verified these two roles via **code trace only** against `HousekeeperDashboard.tsx`/`EngineerDashboard.tsx`/`HousekeeperMyRoomsView` — never a live login. Phase 37's QA-01 plan should state this explicitly rather than attempt (or appear to have skipped) a live session for these 2 of 6 roles. The navigation matrix's own automated test already covers their allow-sets (`housekeeper`: 3 hrefs, `engineer`: 9 hrefs) as a deterministic proxy for the parts of "6-role navigation" that can't be live-verified.
- **4 roles ARE live-loginable via web**: `gm`, `housekeeping_supervisor`, `front_desk`, `chief_engineer`. Test credentials: per 34-08's summary, a real `front_desk`-role staff member ("Henill") exists in the live test tenant but **no password was on file this session** — flagged as a carry-forward gap across 3 phases now (34-08, and implicitly unresolved since). Phase 37's QA-01 plan should either obtain/reset front_desk credentials before planning a live front_desk walkthrough, or explicitly fall back to code-trace + the automated matrix for front_desk (same disposition as the mobile-only roles), and should say so plainly rather than silently skip it a 4th time.
- The specific NEW thing QA-01 must catch that no single content phase's close-out ever exercised: cross-section interaction bugs visible only when ALL ~21 flags are on simultaneously for one session — nav highlighting/active-state across every section, breadcrumbs on every route, command-palette search results spanning all sections, shell chrome (Sidebar/Header) with every section's nav item present at once. This requires setting `web_redesign_sections` to the full 21-key array on a live test tenant (NOT the production real tenant `23264962-...` unless deliberately chosen, and NOT without restoring to `[]` afterward, per every prior phase's established discipline) and doing one full walkthrough per live-loginable role.

## Findings: QA-03 (Pixel-Diff of 3 Excluded Surfaces) & Flag-Key Completeness

- `apps/web/e2e/room-board-baseline.spec.ts` — confirmed current, covers exactly `RoomStatusBoard` (`/housekeeping`), `RoomDetailDrawer` (drawer on `/housekeeping`), and `EngineeringRoomBoard` (`/engineering/work-orders` → Room Board tab). 12 snapshots total (3 surfaces × 2 roles [gm, housekeeping_supervisor] × 2 themes), `maxDiffPixelRatio: 0` (byte-identical required). Confirmed clean 12/12 at every phase's close-out since Phase 30, most recently Phase 36 (36-04).
- `chromeMasks()` already includes the `[data-testid="page-header"]` mask added by Phase 35's close-out (35-07) — confirmed via source read, no harness edit needed for Phase 37.
- **Regression harness gotcha (will very likely recur):** `playwright.regression.config.ts`'s default `baseURL` is `https://patelrep-production-0ad1.up.railway.app` — this is the **dead, pre-migration** Railway URL (the account moved 2026-08-16; the correct current URL is `https://patelrep-production-4e7f.up.railway.app` per this project's CLAUDE.md). Confirmed via `git rev-list --left-right --count origin/main...HEAD` → local HEAD is **18 commits ahead of `origin/main`**, meaning even fixing the URL wouldn't help — the deployed Railway build is stale regardless. Every phase since at least 32 has worked around this identically: build a local standalone production server (`npm run build` + `.next/standalone`) with a temporary, env-gated `REGRESSION_LOCAL_CSP` patch to `next.config.mjs`'s CSP `connect-src` (allowing `localhost`), run the regression suite against `PLAYWRIGHT_BASE_URL=http://localhost:<port>`, then fully revert the patch (confirmed via `git diff --exit-code apps/web/next.config.mjs`). **Plan for the same workaround** — it is currently NOT present in the tree (grep for `REGRESSION_LOCAL_CSP` in `next.config.mjs` returns nothing), so it must be re-added and re-reverted, matching precedent exactly.
- **Flag-key completeness — RE-CONFIRMED EXHAUSTIVE, zero drift from CONTEXT.md's snapshot.** Fresh grep of every `isSectionRedesigned('<key>', ...)` call site across `apps/web` (43 call sites across dashboards, page routes, and shared components) yields exactly this set of 21 unique keys: `shell`, `dashboard`, `tasks`, `evidence`, `engineering`, `reports`, `managementRoi`, `aiCopilot`, `logbook`, `staff`, `lostFound`, `programs`, `sop`, `scheduling`, `safety`, `guestRequests`, `billing`, `settings`, `guestFeedback`, `integrations`, `housekeeping` — matches CONTEXT.md's list 1:1. Note `settings`/`billing`/`integrations`/`guestFeedback` don't appear as separate top-level items in `navigation.matrix.json` because they're subroutes nested under the single `/settings` nav item (`apps/web/lib/utils/navigation.ts:36-48` lists `/settings/general`, `/settings/billing`, `/settings/integrations`, `/settings/feedback`, etc. as one group) — this is expected, not a gap.
- **New test for this run only (per CONTEXT.md's decision):** populate the regression fixture tenant's `web_redesign_sections` with all 21 keys (via direct Supabase service-role UPDATE, matching the exact mechanism every close-out plan has already used), re-run `room-board-baseline.spec.ts` once more, then restore to `[]`. This proves the 3 excluded/frozen surfaces stay byte-identical even when every surrounding section is simultaneously v2, not just individually (which is all prior phases ever tested).

## Findings: Production Rollout Migration (Success Criterion 4)

### Local dev and production share ONE Supabase project — confirmed, no staging environment

Compared `SUPABASE_URL` between `apps/api/.env` and `apps/web/.env.local` via SHA-256 hash of the value (never printing the secret itself): **identical hash (`efe4dd316c46...`) in both files.** This confirms CONTEXT.md's assumption: there is no separate staging Supabase project. Any migration tested "locally" is tested against the exact same production database Railway's deployed API/web services also read from. `apps/web/.env.regression` does not itself set `SUPABASE_URL` (it only carries `REGRESSION_GM_EMAIL`/`REGRESSION_SUP_PASSWORD`-style fixture credentials, per `seed-regression-tenant.mjs`'s own env-loading comment) — it also resolves back to the same project via `apps/api/.env` fallback.

### Live tenant census (read-only query, run for this research, non-destructive)

Queried `tenants(id, name, is_test, web_redesign_sections)` directly (service-role, read-only `SELECT` via REST, same access pattern every close-out plan has already used for its own live verification):

| Count | is_test | Notes |
|---|---|---|
| 1 | `false` | `23264962-aa09-4e4f-a49d-fc345cc91414` — "Sonesta ES Suites Fossil Creek" — **the only real production tenant**, and the SAME tenant every Phase 32-36 close-out has used as its "live test hotel" (temporarily flag-toggled, always restored to `[]`) |
| 1 | `false` | `a0000000-0000-4000-a000-000000000001` — "REGRESSION FIXTURE — DO NOT OPERATE" — the FOUND-03 pixel-diff fixture, a system tenant, not a customer |
| 9 | `true` | assorted QA/dev/validation tenants (Lakeside Inn & Suites ×4, Sonesta ES Suites Fossil Creek ×2 dupes, Patel Test Hotel, a `Validation Tenant isoval-*`, Sonesta ES Suites) |

**All 11 tenants currently have `web_redesign_sections = []`** — confirms every phase's "restore to baseline" discipline has held with zero leakage into production state so far.

This materially changes the risk framing: Success Criterion 4's flip-on migration does not affect "every real, paying hotel tenant" in some abstract multi-tenant-at-scale sense — as of today it affects exactly **one** real tenant (plus, at the planner's discretion, however many of the 9 test tenants should also be flipped for QA/dogfooding consistency). CONTEXT.md's caution is still correct in kind (it IS a production write with no staging environment and no in-app opt-out) — this finding just gives the planner and the eventual user-confirmation step a concrete, small blast radius instead of an assumed-large one.

### Migration shape — important correction to CONTEXT.md's framing

CONTEXT.md's Claude's-Discretion section frames the flip-on mechanism as either "a migration...that sets `web_redesign_sections` to the full ~21-key list for all tenants, **or removes the gate default** so all tenants read as fully-redesigned." Tracing `isSectionRedesigned()` (`apps/web/lib/utils/redesignFlag.ts`) and migration 097's `DEFAULT '{}'` clause shows **the second option does not actually work for existing tenants**: `ALTER COLUMN ... SET DEFAULT` only changes the value new rows get on INSERT — it has zero effect on the 11 existing rows, which will keep reading `[]` forever unless explicitly `UPDATE`d. The migration MUST contain an explicit `UPDATE public.tenants SET web_redesign_sections = ARRAY[...21 keys...]` statement to actually flip any existing tenant. Updating the column `DEFAULT` too is a reasonable *addition* (so any tenant created after rollout also starts fully-redesigned rather than needing a manual flip), but it is not a substitute for the `UPDATE`.

Established idempotent-migration conventions in this repo (confirmed via `094_tenant_is_test_flag.sql`, `097_web_redesign_sections.sql`): `ADD COLUMN IF NOT EXISTS` guards, a `COMMENT ON COLUMN` documenting intent, and a trailing `-- ROLLBACK:` comment block (documented, not auto-executed) showing the exact reverse statement. For an `UPDATE`-shaped migration (no new column), the equivalent idempotent pattern is straightforward — repeating the same `UPDATE ... SET x = <same value>` is naturally idempotent (re-running produces the same end state), so no additional guard is strictly required, though a `WHERE NOT (web_redesign_sections @> ARRAY[...])` clause would make re-runs no-ops at the row level (skip already-migrated rows) and is more consistent with this project's general "safe to re-run" ethos (see `seed-regression-tenant.mjs`'s own "Safe to re-run" framing).

### Open question for the planner (not resolved by this research — genuine judgment call)

Should the flip-on `UPDATE` include the `is_test=true` tenants and the regression-fixture tenant, or exclude them?
- **Include everything:** simplest, matches "flip the flag on for all sections with no half-old/half-new state remaining" (Success Criterion 4's literal wording) most directly.
- **Exclude the regression fixture** (`a0000000-...`): the pixel-diff harness's whole methodology depends on being able to toggle this tenant's flags between `[]` and populated and diff against a `[]`-baseline snapshot set — if it's permanently flipped on, any *future* phase's ability to re-run a `[]`-baseline regression pass is lost (though per migration 097's own comment, the entire gate mechanism is slated for removal in a later v2.0 cleanup phase anyway, at which point this stops mattering).
- **Exclude other `is_test=true` tenants:** lower blast radius for this phase, but leaves QA/dogfooding tenants on the legacy UI going forward, which seems to work against the spirit of "rollout."

Flag this explicitly in the plan rather than silently picking one; the CONTEXT.md-locked user-confirmation checkpoint is exactly the right place to surface this choice.

## Common Pitfalls

### Pitfall 1: Trusting `origin/main` / the deployed Railway build for the regression pass
**What goes wrong:** `playwright.regression.config.ts`'s hardcoded default `baseURL` points at a dead/stale URL, and even a correct URL wouldn't help since Railway's deployed build lags local HEAD by (at minimum) 18 commits.
**Why it happens:** No phase since ~32 has pushed its work to `origin/main` before running close-out regression checks (planning-doc commits aside).
**How to avoid:** Always build+serve `.next/standalone` locally with the `REGRESSION_LOCAL_CSP`-gated CSP patch, run with `PLAYWRIGHT_BASE_URL=http://localhost:<port>`, and confirm the temp patch is fully reverted (`git diff --exit-code apps/web/next.config.mjs`) before finishing. This is the single most consistent pattern across 32-06/33-07/34-08/35-07/36-04.
**Warning signs:** Regression suite immediately 404s or times out against the default `baseURL`.

### Pitfall 2: Assuming `MOBILE_ONLY_ROLES` can be live-tested with a workaround
**What goes wrong:** Attempting to bypass `middleware.ts`/`routeGuard.ts` to force a `housekeeper`/`engineer` web session for QA-01's "live" walkthrough.
**Why it happens:** The phase's own framing ("live 6-role browser walkthrough") reads as if all 6 must be literally live.
**How to avoid:** Follow the established Phase 32/34/36 precedent exactly: code-trace `housekeeper`/`engineer` against their dashboard/view components + the automated nav matrix's coverage of their allow-sets. 36-04 explicitly assessed forging/bypassing auth for this as "unnecessarily risky against production auth data for a verification-only plan" and declined it — Phase 37 should do the same.
**Warning signs:** A plan task that tries to construct a JWT or manipulate `middleware.ts` just for this walkthrough.

### Pitfall 3: Treating the flip-on migration as low-stakes because it's "just a migration"
**What goes wrong:** Running the `UPDATE` against production tenants without the explicit user-confirmation checkpoint CONTEXT.md locks.
**Why it happens:** Every other action in Phases 30-36 has been fully autonomous; it's easy to default to the same posture here.
**How to avoid:** Structure this as its own final plan, explicitly marked non-autonomous, that stops after staging/dry-running the migration and asks the user before executing `UPDATE public.tenants SET web_redesign_sections = ...` for real. The dry run CAN be fully exercised against the regression-fixture and `is_test=true` tenants (already an established, safe pattern) without touching the one real tenant.
**Warning signs:** A plan/task list where the migration's `UPDATE` and its execution are in the same autonomous task as QA-01/02/03.

### Pitfall 4: Re-discovering bug-965 manually instead of fixing the dictionary gap
**What goes wrong:** Continuing the Phase 34/35/36 pattern of writing another ad-hoc, uncommitted Playwright script that finds and re-logs the same defect a 4th time without shipping the fix.
**Why it happens:** No committed regression test exists for `domTranslations.ts` at all — verification has always been manual, one-off, and disposable.
**How to avoid:** Ship the `FULL_PHRASE_TRANSLATIONS`/`FULL_ATTRIBUTE_TRANSLATIONS` fix (see Findings above) AND commit a small Playwright spec that codifies the check, so it's a permanent gate rather than institutional memory living only in `buglog.json`.
**Warning signs:** A close-out plan that logs a 4th bug-965 occurrence instead of a `fixed` disposition.

## Open Questions

1. **Should the flip-on migration include `is_test=true` tenants and/or the regression fixture?**
   - What we know: 9 test tenants + 1 system fixture + 1 real tenant, all currently `[]`.
   - What's unclear: whether "no half-old/half-new state remaining" (Success Criterion 4's wording) is meant to apply only to the real/production tenant population, or literally every row in the table.
   - Recommendation: surface this explicitly in the plan and resolve it at the same user-confirmation checkpoint as the real-tenant flip-on, rather than deciding silently.

2. **Does the bug-965 fix fully close the "no missing or raw copy" bar for QA-02, or does bug-1021's residual hydration-race flash still count as a violation?**
   - What we know: the dictionary fix should turn bug-1021's cold-reload flash from an EN/ES hybrid into a flash of *correct* Spanish (still transient, since the underlying SSR/hydration race is untouched).
   - What's unclear: whether a sub-second, fully-correct-Spanish flash before a byte-identical Spanish re-render (no hybrid, no English) still trips a strict reading of QA-02's bar, or whether QA-02's bar is specifically about incorrect/mixed-language content (which this fix does eliminate).
   - Recommendation: re-run Phase 35's exact bug-1021 repro (cold-reload with `es` pre-persisted, Predictions page subtitle) after applying the fix, and record the observed result plainly in the close-out summary — do not assume either way.

3. **Should Phase 37 push the branch to `origin/main` (triggering a real Railway deploy) before running QA-03's regression pass, instead of the local-standalone-build workaround?**
   - What we know: this would eliminate Pitfall 1 permanently and would also be a prerequisite for the real flip-on migration to matter in production (the migration only changes what flag *value* tenants have — the deployed code must already contain all 21 sections' redesigned UI for the flip to do anything for real users).
   - What's unclear: whether "push + deploy" is considered in-scope for this GSD phase or a separate ops action outside its boundary.
   - Recommendation: flag this prominently — Success Criterion 4 (the actual "rollout") is meaningless in production unless the code Railway is serving already matches what Phase 37 verified. The planner should make deploying the reviewed tree an explicit, visible pre-step of the gated flip-on task, not an implicit assumption.

## Sources

### Primary (HIGH confidence — direct codebase reads)
- `apps/web/i18n/domTranslations.ts` (full file, 810 lines) — bug-965 mechanism
- `apps/web/components/ui/StateBlock.tsx`, `apps/web/components/shared/PageHeader.tsx` — confirmed StateBlock has no `data-i18n-skip`, PageHeader's escape hatch shape
- `.wolf/buglog.json` — bug-962/963/964/965/1021 full entries
- `apps/web/lib/utils/redesignFlag.ts`, `redesignFlag.test.mjs`, `navigation.matrix.json`, `navigation.test.ts`, `navigation.ts` — flag mechanism + nav matrix
- `apps/web/lib/utils/routeGuard.ts`, `apps/web/app/(auth)/login/page.tsx` — `MOBILE_ONLY_ROLES` gate
- `apps/web/e2e/room-board-baseline.spec.ts`, `playwright.regression.config.ts`, `apps/web/e2e/fixtures/seed-regression-tenant.mjs` — QA-03 harness
- `supabase/migrations/094_tenant_is_test_flag.sql`, `097_web_redesign_sections.sql` — migration conventions
- `.planning/phases/34-management-admin-sections/34-08-SUMMARY.md`, `.planning/phases/35-engineering-section-chrome/35-07-SUMMARY.md`, `.planning/phases/36-housekeeping-section-chrome/36-04-SUMMARY.md` — full read, methodology precedent
- `.planning/ROADMAP.md` (NAV-05/06, SEC-01/01b, ENG-01, HSK-01, QA-01/02/03 sections)
- Fresh grep of all 43 `isSectionRedesigned('<key>', ...)` call sites across `apps/web` — 21 unique keys confirmed
- `git rev-list --left-right --count origin/main...HEAD` — confirmed local HEAD 18 commits ahead of origin/main
- SHA-256 comparison of `SUPABASE_URL` value between `apps/api/.env` and `apps/web/.env.local` (values never printed) — confirmed identical, same Supabase project
- Live read-only `SELECT id, name, is_test, web_redesign_sections FROM tenants` (service-role REST call, non-destructive) — 11-tenant census

### Secondary / Tertiary
None — this phase required no external library/ecosystem research; every finding is a direct trace of this codebase's own source and data.

## Metadata

**Confidence breakdown:**
- bug-965 root cause & fix design: HIGH — traced line-by-line against the actual source, mechanism matches all 5 documented bug occurrences exactly
- QA-01 methodology (role reachability, matrix coverage): HIGH — confirmed via `routeGuard.ts`/`login/page.tsx` source + 3 phases' consistent precedent
- QA-03 harness state & regression-URL gotcha: HIGH — confirmed via direct file reads + git/env checks
- Migration shape & tenant census: HIGH — confirmed via live read-only query and direct migration file reads; the `DEFAULT`-vs-`UPDATE` correction is a direct logical consequence of `isSectionRedesigned()`'s own read path, not speculation

**Research date:** 2026-08-19
**Valid until:** This research is tied to a specific point-in-time codebase/data snapshot (commit `1f8152b2`, 11-tenant census taken during this research). Re-verify the tenant census and flag-key grep at plan/execution time if more than a few days pass, since both are explicitly moving targets per CONTEXT.md.

---
phase: 34-management-admin-sections
plan: 04
subsystem: ui
tags: [react-query, i18n, StateBlock, Skeleton, PageHeader, next.js]

# Dependency graph
requires:
  - phase: 34-management-admin-sections
    provides: 34-01's frozen settings/billing/guestFeedback locale namespaces
provides:
  - "Settings-general (settings/general/page.tsx): flag-gated skeleton + StateBlock error+retry over a fetch that previously had zero loading/error UI"
  - "Billing (settings/billing/page.tsx): flag-gated isError/refetch + StateBlock error+retry on all 3 queries, auth-loading spinner folded into v2 skeleton, invoices empty state"
  - "Guest Feedback (settings/feedback/page.tsx): onRetry added to its existing StateBlock error, empty copy i18n'd"
affects: [34-08 close-out verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Genuinely new fetch loading/error UI gated entirely behind v2 && ... so the legacy branch's render path is unconditional and untouched (Settings-general pattern)"
    - "SkeletonCardV2 sibling component (v2-token Skeleton primitive) alongside the untouched legacy SkeletonCard, selected via a v2 ternary at each call site (matches 33-03/33-04's SkeletonCardV2 convention)"

key-files:
  created: []
  modified:
    - apps/web/app/(dashboard)/settings/general/page.tsx
    - apps/web/app/(dashboard)/settings/billing/page.tsx
    - apps/web/app/(dashboard)/settings/feedback/page.tsx

key-decisions:
  - "Settings-general: error StateBlock rendered as a banner above the form (not replacing it), so a failed initial fetch doesn't block a GM from still manually filling in/saving the profile — matches the 'form still usable' spirit of the prior silent-failure behavior"
  - "Billing: reused the file's existing per-query alias-naming convention (subLoading/creditLoading/invoicesLoading) when adding isError/refetch (subIsError/subRefetch, etc.) rather than inventing new names"
  - "Billing: wired billing.invoicesEmpty (a key 34-01 provisioned) to a new v2-only StateBlock empty state on the invoices table, since the legacy code rendered nothing (null) for the empty case"
  - "Guest Feedback: kept the exact legacy error object (message: 'Feedback could not load.', no onRetry key) byte-identical when v2 is off, only adding onRetry inside the v2 branch"

patterns-established:
  - "Pathspec-restricted commit (git commit -m '...' -- <path>) instead of git add + git commit, to avoid picking up sibling plans' already-staged files when multiple executor agents share one working tree/index"

# Metrics
duration: 20min
completed: 2026-08-18
---

# Phase 34 Plan 04: Settings-general + Billing + Guest Feedback Summary

**Flag-gated StateBlock/skeleton wiring on 3 settings sub-pages (`settings`, `billing`, `guestFeedback`), closing Settings-general's genuine zero-loading/error-UI gap, Billing's 3-query error/retry gap, and Guest Feedback's missing retry button — zero query/mutation changes, `settings/layout.tsx` untouched.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Settings-general (`settings/general/page.tsx`): reads `isSectionRedesigned('settings', hotel)` once; extended the `hotel-full` `useQuery` destructuring from `{ data: fullHotel }` to `{ data: fullHotel, isLoading, isError, refetch }` — a genuinely new capability, since the page previously had **no loading or error UI at all** (a failed fetch silently left the form on `react-hook-form` defaults forever). Under `v2`: shows a `HotelProfileSkeleton` (built from the shared `Skeleton` primitive) while `isLoading && !hydratedRef.current`, and a `StateBlock status="error"` banner (`settings.loadError`, `onRetry: refetch`) above the form when `isError` — the form itself stays rendered and editable even on fetch failure. Legacy branch (`v2` false) is gated by `v2 &&` short-circuits so it always takes the unconditional form-render path, byte-identical to before. Form title optionally reads `t('settings.pageTitle')` under `v2` (`'Hotel Profile'` literal preserved for `!v2`). Submission flow (`onSubmit` → `hotelsApi.update` → `toast.error`) completely untouched.
- Billing (`settings/billing/page.tsx`): reads `isSectionRedesigned('billing', hotel)` once. All 3 queries (`subData`/`creditData`/`invoicesData`) extended with `isError`/`refetch` aliases matching the file's existing naming convention (`subIsError`/`subRefetch`, etc.). Each section gains a `StateBlock status="error"` (`billing.subscriptionLoadError`/`creditsLoadError`/`invoicesLoadError`, each wired to its own query's `refetch()`) only under `v2`, only when that query's own `isError` is true — the `!v2` branch renders exactly as before (no error UI). Added a new `SkeletonCardV2` (built from the shared `Skeleton` primitive with `bg-surface-3`) selected via ternary alongside the legacy amber-bar `SkeletonCard` at all 3 loading sites, plus folded the raw `animate-spin` auth-loading guard into a `v2` skeleton (`Skeleton` + 2×`SkeletonCardV2`) while keeping the spinner unchanged for `!v2`. Invoices section additionally gains a `v2`-only `StateBlock status="empty"` (`billing.invoicesEmpty`) for the previously-silent `null`-render empty case (this key was confirmed provisioned by 34-01). `portalMutation`/`checkoutMutation` and their `portalError`/`checkoutError` inline error rendering left completely untouched. `dataI18nSkip={v2}` added to the `PageHeader` per Pitfall 1.
- Guest Feedback (`settings/feedback/page.tsx`): reads `isSectionRedesigned('guestFeedback', hotel)` once; extended the `useQuery` destructuring with `refetch`. The single `StateBlock`'s `error` object gains `onRetry: () => refetch()` under `v2` (message also switches to `t('guestFeedback.loadError')`); the `!v2` branch keeps the exact original static object (`{ message: 'Feedback could not load.' }`, no `onRetry` key) byte-identical. `empty.title`/`empty.body` similarly route through `t('guestFeedback.empty.title')`/`t('guestFeedback.empty.body')` under `v2`, hardcoded strings preserved for `!v2`. Spot-checked the surrounding `Card`/`Badge`/`notificationCopy()` chrome per the plan's step 5 — confirmed already CSS-var-token-clean (`text-ready`/`text-alert`/`text-ink3`), no changes needed.

## Task Commits

Each task was committed atomically, though two of the three landed commingled with sibling wave-2 plans' commits due to a shared git index across parallel executor processes (see Deviations):

1. **Task 1: Settings-general flag + loading/error UI** - `1eaded7a` (feat) — commingled with plan 34-05's `settings/integrations/page.tsx` commit; `settings/general/page.tsx`'s diff within that commit (40 lines, +38/-2) verified to be exactly this task's intended change and nothing else.
2. **Task 2: Billing flag + StateBlock error+retry** - `2e209376` (feat) — commingled with an unrelated sibling in-flight edit to `staff/page.tsx`; `settings/billing/page.tsx`'s diff within that commit (48 lines, +44/-13... net +48/-13 total in the 2-file commit) verified to be exactly this task's intended change.
3. **Task 3: Guest Feedback flag + onRetry** - `b7d21288` (feat) — clean, single-file commit (used a pathspec-restricted `git commit -- <path>` instead of a separate `git add`, which avoided the index-race that hit Tasks 1 and 2).

**Plan metadata:** commit created alongside this SUMMARY/STATE.md update (see final commit in the execution log).

## Files Created/Modified

- `apps/web/app/(dashboard)/settings/general/page.tsx` - Flag-gated skeleton + StateBlock error+retry over the hotel-profile fetch (net-new UI, gap closed)
- `apps/web/app/(dashboard)/settings/billing/page.tsx` - Flag-gated isError/refetch + StateBlock error+retry on all 3 queries; auth-loading spinner folded into v2 skeleton; invoices empty state
- `apps/web/app/(dashboard)/settings/feedback/page.tsx` - onRetry added to existing StateBlock error; empty copy i18n'd

## Locale Keys Consumed (read-only, from 34-01)

- `settings.pageTitle`, `settings.loadError`
- `billing.subscriptionLoadError`, `billing.creditsLoadError`, `billing.invoicesLoadError`, `billing.invoicesEmpty`
- `guestFeedback.loadError`, `guestFeedback.empty.title`, `guestFeedback.empty.body`

`npm run check:i18n-parity` confirmed 1570 keys (unchanged from 34-01's baseline) both before and after this plan — `en.ts`/`es.ts` were never edited.

## Decisions Made

- Settings-general's new error UI renders as a banner above the (still-editable) form rather than replacing it, preserving the "form stays usable" spirit of the prior silent-failure behavior while adding retry.
- Billing's invoices empty state was wired using the already-provisioned `billing.invoicesEmpty` key (confirmed added by 34-01), converting a previously-silent `null` render into a genuine v2 empty state.
- Guest Feedback's legacy error object was kept byte-identical (no `onRetry` key at all) when `v2` is off, rather than always including an inert `onRetry` — matches the plan's explicit "legacy exactly as today" requirement.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Git-index race with parallel sibling executors commingled Task 1's commit with plan 34-05**
- **Found during:** Task 1 (Settings-general), immediately after committing
- **Issue:** This plan runs alongside 5 parallel sibling plan-executors sharing one working tree/git index. `git add <settings/general/page.tsx>` picked up `settings/integrations/page.tsx`, which a sibling agent (34-05) had already staged concurrently; the resulting commit's message was mine (`feat(34-04): ...`) but the file set included both pages.
- **Fix:** Verified (via `git show --stat`) the `settings/general/page.tsx` diff within that commit was exactly this task's intended change (40 lines, +38/-2) and nothing else — no content corruption occurred, only commit-message/file-set attribution was affected. Attempted a `git reset --soft` + `git restore --staged` correction, but a concurrent sibling commit landed in the same window; reverting further was assessed as higher-risk than leaving the (content-correct) commingled commit in place, since concurrent resets against a shared ref risk discarding a sibling's genuine work. Left as-is.
- **Files affected:** `apps/web/app/(dashboard)/settings/general/page.tsx` (content correct; commit `1eaded7a` also contains 34-05's `settings/integrations/page.tsx` change, independently correct and unrelated)
- **Verification:** `git diff HEAD -- settings/general/page.tsx` is empty (matches HEAD); `grep isSectionRedesigned('settings'` present; `npx tsc --noEmit` clean for this file.
- **Committed in:** `1eaded7a`

**2. [Rule 3 - Blocking] Same class of git-index race commingled Task 2's commit with an unrelated staff/page.tsx edit**
- **Found during:** Task 2 (Billing), immediately after committing
- **Issue:** Identical mechanism — `git add <settings/billing/page.tsx>` picked up a concurrently-staged, unrelated in-flight edit to `apps/web/app/(dashboard)/staff/page.tsx` from a different sibling plan.
- **Fix:** Verified the billing diff within the commit was exactly this task's intended change (48 lines) and confirmed via `npx tsc --noEmit` that `settings/billing/page.tsx` has zero type errors. Switched strategy for Task 3 onward to a pathspec-restricted `git commit -m "..." -- <path>` (skips the separate `git add` step entirely), which produced a clean, single-file commit with no further incidents.
- **Files affected:** `apps/web/app/(dashboard)/settings/billing/page.tsx` (content correct; commit `2e209376` also contains an unrelated sibling's `staff/page.tsx` change)
- **Verification:** `git diff HEAD -- settings/billing/page.tsx` empty; `grep isSectionRedesigned('billing'` present; full gate suite (`type-check`, `check:frozen-files`, `check:contrast`, `check:i18n-parity`) all green with this content in the tree.
- **Committed in:** `2e209376`

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking, both a shared-git-index race between parallel plan-executor subagents, not a scope or content defect). **Impact on plan:** None on correctness — every line changed in both commingled commits was independently verified against its own plan's scope; only commit-message/file-set attribution was imperfect for 2 of 3 tasks. No content from a sibling plan was altered or lost. Task 3 avoided the issue entirely via a pathspec-restricted commit, a pattern future parallel-wave plans in this codebase should adopt.

## Issues Encountered

- A sibling plan's in-flight `staff/page.tsx` edit produced a transient `npm run type-check` failure (`Property 'v2' does not exist...`) between Task 2 and Task 3; confirmed out of this plan's `files_modified` scope, not fixed here, and confirmed resolved by the sibling on a subsequent re-run — final full-repo `type-check` is clean.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 3 pages (`settings/general`, `settings/billing`, `settings/feedback`) are flag-gated behind their own `settings`/`billing`/`guestFeedback` keys, StateBlock/skeleton-wired, with zero query/mutation/field changes and `settings/layout.tsx`/`settings/housekeeping/page.tsx` completely untouched.
- Deferred item for 34-08's close-out sweep: none specific to this plan's 3 files beyond the standard "flag not yet flipped on a live tenant for browser verification" carve-out already logged by prior Phase 33/34 wave-2 plans — same class, deferred to close-out per established convention.
- Ready for 34-08 (wave 3, close-out verification) once all wave-2 plans (34-02..34-07) land.

---
*Phase: 34-management-admin-sections*
*Completed: 2026-08-18*

## Self-Check: PASSED

- All 3 modified files confirmed present on disk.
- SUMMARY.md confirmed present on disk.
- All 3 task commit hashes (`1eaded7a`, `2e209376`, `b7d21288`) confirmed present in git history.

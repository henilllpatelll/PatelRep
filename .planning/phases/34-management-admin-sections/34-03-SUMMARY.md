---
phase: 34-management-admin-sections
plan: 03
subsystem: ui
tags: [react, i18n, state-block, staff, redesign-flag]

# Dependency graph
requires:
  - phase: 34-management-admin-sections
    provides: "34-01's staff.* locale namespace (staff.invitations.loadError, staff.editModal.schedulesLoadError, staff.editModal.rolesLoadError) in en.ts/es.ts, frozen read-only"
provides:
  - "Staff (staff/page.tsx) flag-gated on isSectionRedesigned('staff', hotel), v2-token-ified filter/search chrome and table row hover matching tasks/page.tsx's established conditional-token pattern"
  - "Pending Invitations StateBlock gains an error branch (previously loading-only) wired to invitationsQuery.refetch()"
  - "EditStaffModal's schedulesQuery gains a v2 Skeleton loading state (replacing bare 'Loading…' text) and error+retry wired to schedulesQuery.refetch()"
  - "EditStaffModal's customRolesQuery gains a v2 loading skeleton and error+retry wired to customRolesQuery.refetch() (previously had zero loading/error UI)"
affects: [34-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional v2-token className pattern: base classes unconditional, only the focus-ring/duration/easing suffix swaps via `v2 ? 'duration-fast ease-standard focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]' : '<legacy classes>'`, exactly matching tasks/page.tsx"
    - "Compact inline error+retry block (AlertTriangle + message + ghost Button) for sub-regions inside a modal where a full StateBlock's vertical footprint would be too large — distinct pattern from the page-level StateBlock used for full sections"

key-files:
  created: []
  modified:
    - "apps/web/app/(dashboard)/staff/page.tsx"

key-decisions:
  - "Main staff table's existing StateBlock loading/error/empty/retry wiring was left structurally untouched per plan instruction — no staff-specific main-table locale key was provisioned by 34-01, confirming the plan's own prediction, so its copy stays as today under both v2 and legacy"
  - "Did not restructure the Pending Invitations section's outer gate `(invitations.length > 0 || invitationsQuery.isLoading)` per explicit plan instruction, even though this means an error on the very first (empty-cache) invitations fetch is still invisible; a refetch failure with previously-cached invitations remains visible via the new StateBlock error branch"
  - "Used a compact inline error+retry block (not StateBlock) for schedulesQuery/customRolesQuery inside EditStaffModal, since these are small sub-regions of a modal, not full-page/full-section states — matches the plan's own suggested fallback for cases where 'StateBlock's default sizing doesn't fit this modal sub-region well'"

patterns-established:
  - "Sub-panel-scale query-state gaps inside a modal get a compact inline error block rather than the page-level StateBlock component"

# Metrics
duration: 35min
completed: 2026-08-18
---

# Phase 34 Plan 03: Staff Section Redesign Summary

**Staff (`staff/page.tsx`) flag-gated behind `isSectionRedesigned('staff', hotel)`, its ad-hoc filter/search chrome v2-token-ified to match `tasks/page.tsx`'s established pattern, and its three genuine query-state gaps (invitations error, EditStaffModal's schedulesQuery/customRolesQuery loading+error) closed.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-08-18T21:15:00Z
- **Completed:** 2026-08-18T21:50:00Z
- **Tasks:** 2
- **Files modified:** 1 (`apps/web/app/(dashboard)/staff/page.tsx`)

## Accomplishments
- `StaffPage` reads `isSectionRedesigned('staff', hotel)` once via `useHotelStore`; role/status filter selects, search input, and both tables' row-hover transitions v2-token-ified (`duration-fast ease-standard focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]`) while the legacy `focus:ring-amber-400` classes stay byte-identical when the flag is off
- Main staff table's pre-existing `StateBlock` wiring (loading/error/empty/retry on `staffQuery`) confirmed structurally untouched — no restructuring, no new locale key needed (34-01 intentionally scoped `staff.*` to only the invitations/editModal gaps, confirmed correct)
- Pending Invitations `StateBlock` extended from loading-only to `loading | error | null`, with a new `error` object wired to `invitationsQuery.refetch()` and `t('staff.invitations.loadError')`
- `EditStaffModal`'s `schedulesQuery` (previously a bare `<p>Loading…</p>` with zero error handling) gains a v2 `Skeleton`-based loading state (2 compact rows) and a compact inline error+retry block wired to `schedulesQuery.refetch()` and `t('staff.editModal.schedulesLoadError')`
- `EditStaffModal`'s `customRolesQuery` (previously zero loading or error UI at all) gains the same v2 skeleton + inline error+retry pattern wired to `customRolesQuery.refetch()` and `t('staff.editModal.rolesLoadError')`
- `v2` computed once in `StaffPage` and threaded as an explicit prop into `EditStaffModal`
- Legacy branch (`v2` false) confirmed byte-behaviorally identical throughout: filter/search classes unchanged, `schedulesQuery` still renders bare "Loading…" text with no error UI, `customRolesQuery` still has zero loading/error UI

## Task Commits

Each task was committed atomically — with one cross-plan git-index race documented below:

1. **Task 1: Flag + v2-token-ify main table/invitations chrome; close invitationsQuery's error gap** — `2e209376` *(shared with 34-04's own commit — see Deviations)*
2. **Task 2: EditStaffModal — schedulesQuery loading skeleton + error+retry; customRolesQuery loading + error+retry** — `ad0c94b4`

_Note: `ad0c94b4` also incidentally contains 15 lines of a concurrently-running sibling plan's `ai/page.tsx` staged work, swept in by the same git-index race — see Deviations._

## Files Created/Modified
- `apps/web/app/(dashboard)/staff/page.tsx` — flag read once; filter/search chrome + row-hover transitions v2-token-ified; invitations `StateBlock` gains error branch; `EditStaffModal`'s `schedulesQuery`/`customRolesQuery` gain v2 loading skeleton + error+retry; legacy branch unchanged

## Decisions Made
- Kept the main staff table's `StateBlock` copy exactly as today under both flag states, since 34-01 confirmed no staff-specific main-table locale key was provisioned (only invitations/editModal gaps were in scope) — matches the plan's own explicit prediction
- Left the Pending Invitations section's outer render gate (`invitations.length > 0 || invitationsQuery.isLoading`) untouched per the plan's explicit instruction not to restructure it, even though this means a first-load (empty-cache) invitations fetch failure stays invisible; a refetch failure on already-cached invitations is now visible via the new `StateBlock` error branch
- Used a compact inline `AlertTriangle` + message + ghost `Button` "Retry" block (not the page-level `StateBlock` component) for `schedulesQuery`/`customRolesQuery` inside `EditStaffModal`, since `StateBlock`'s default vertical footprint (`py-12`) is too large for these small modal sub-regions — the plan explicitly allowed this fallback

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Repaired a broken intermediate state caused by a cross-plan git-index race**
- **Found during:** Between Task 1 and Task 2, while attempting to split the single-file diff into two atomic per-task commits via `git add -p`
- **Issue:** This plan runs in parallel with five sibling plans sharing one git working tree/index. `git add -p` correctly staged Task 1's 10 hunks (flag read, chrome v2-tokenization, invitations error branch), but before this agent could run `git commit`, a concurrently-running sibling agent (34-04, Billing) executed its own `git commit` without path-scoping, which committed the *entire* index at that instant — including this plan's already-staged Task 1 hunks. That landed under commit `2e209376` ("feat(34-04): Billing flag + StateBlock error+retry on 3 queries"), which correctly and completely contains all of Task 1's intended `staff/page.tsx` changes, just under the wrong plan's commit message. This left the working tree in a genuinely broken intermediate state: the call site already passed `v2={v2}` to `EditStaffModal`, but `EditStaffModal`'s prop signature hadn't been updated yet (that was Task 2, still uncommitted at the time) — a real `TS2322` type error, confirmed via `tsc --noEmit`.
- **Fix:** Verified (via full diff review of `2e209376`) that Task 1's code was correctly and completely present, matching this plan's must_haves exactly — no rework needed. Re-applied Task 2's edits (EditStaffModal `v2` prop + `schedulesQuery`/`customRolesQuery` skeleton+error UI) on top of the new HEAD to restore a consistent, type-safe state. Did **not** amend, revert, or rewrite `2e209376` — per git safety policy and because the sibling agent may still have been mid-flight; rewriting shared history during a live multi-agent race risks corrupting other agents' work far more than accepting a mislabeled-but-correct commit.
- **Files modified:** `apps/web/app/(dashboard)/staff/page.tsx` (Task 2's edits, re-applied)
- **Verification:** `npx tsc --noEmit` clean (zero errors project-wide) after the fix; full gate suite (`type-check`, `build` all 43 routes, `check:frozen-files` 7/7, `check:contrast` 10 pairings both modes, `check:i18n-parity` 1570 keys) green
- **Committed in:** `ad0c94b4` (Task 2 commit)

**2. [Rule 3 - Blocking] A second git-index race swept a sibling's staged `ai/page.tsx` changes into this plan's Task 2 commit**
- **Found during:** Immediately after committing Task 2 (`git add "staff/page.tsx" && git commit`) — `git show --stat` on the resulting commit unexpectedly showed 2 files changed, not 1
- **Issue:** The same shared-index race recurred in the opposite direction: at the moment this agent ran `git commit`, a different concurrently-running sibling agent (owning `ai/page.tsx`, a different Phase 34 plan) had already run `git add` on its own file but had not yet committed. Since this agent's `git add` only staged `staff/page.tsx` but `git commit` commits the *entire* index, the sibling's already-staged `ai/page.tsx` hunks (15 lines) were swept into commit `ad0c94b4` alongside this plan's intended changes.
- **Fix:** Left as-is, by the same reasoning as Deviation 1 (symmetric case): the swept-in code is a legitimate, self-consistent partial edit from its rightful owner, not corrupted or truncated by the sweep. Rewriting `ad0c94b4` via reset/amend while sibling agents are actively racing on the same index carries materially higher risk of data loss than accepting the mislabeling. The rightful owner of `ai/page.tsx` can continue and commit its own remaining changes on top, exactly as this plan did after Deviation 1.
- **Files modified:** None beyond what Task 2 already intended (`ai/page.tsx`'s inclusion was incidental, not authored by this plan)
- **Verification:** Full-repo `tsc --noEmit` clean; `npm run build` green (43/43 routes) after the fact, confirming the incidental inclusion did not break anything
- **Committed in:** `ad0c94b4` (unavoidable — already committed by the time this was discovered)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - Blocking, both stemming from the same root cause: concurrent sibling agents sharing one git working tree/index without commit serialization)
**Impact on plan:** Zero impact on this plan's own code correctness — both deviations are coordination/attribution issues in git history, not defects in `staff/page.tsx`. Documented here (and independently by at least one sibling plan, `34-07`, which hit the same class of race) so the orchestrator/user is aware this is a systemic risk of the current parallel-execution setup, not a one-off fluke.

## Issues Encountered
- See Deviations above — both were git-index races from true parallel execution across 6 sibling plans sharing one repository, resolved without any code rework or history rewriting.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Staff section's flag-gating, chrome v2-tokenization, and all three identified query-state gaps are complete and gate-clean, ready for 34-08's close-out verification alongside the other wave-2 plans
- Flag key confirmed as `'staff'` for `isSectionRedesigned('staff', hotel)` toggling, consistent with the other Phase 34 section keys
- Flagged for the orchestrator: this session observed two independent cross-plan git-index races while running 6 parallel plans against one shared git index — a systemic coordination gap (not specific to this plan) worth addressing in a future session via git worktrees per parallel plan or serialized commit windows

---
*Phase: 34-management-admin-sections*
*Completed: 2026-08-18*

## Self-Check: PASSED
- FOUND: apps/web/app/(dashboard)/staff/page.tsx
- FOUND: .planning/phases/34-management-admin-sections/34-03-SUMMARY.md
- FOUND commit: 2e209376 (Task 1, shared with 34-04's commit — see Deviations)
- FOUND commit: ad0c94b4 (Task 2)

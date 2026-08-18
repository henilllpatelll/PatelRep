---
phase: 34-management-admin-sections
plan: 05
subsystem: ui
tags: [react-query, state-block, skeleton, i18n, opera-integration]

# Dependency graph
requires:
  - phase: 34-management-admin-sections
    provides: "34-01's frozen `integrations` i18n namespace (loadError, conflicts.loadError, conflicts.empty)"
provides:
  - "Opera Integration (settings/integrations/page.tsx) flag-gated on isSectionRedesigned('integrations', hotel)"
  - "statusQuery's raw loading bars/error+retry migrated to shared Skeleton/StateBlock with identical refetch wiring"
  - "conflictsQuery given its own minimal v2 loading/error state UI (Option A), scoped to the conflicts panel only"
affects: [34-08-close-out-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Like-for-like raw-markup-to-shared-component migration for an already-complete state machine (mirrors Phase 33's Programs page-level error migration precedent)"
    - "Primary UI state (disconnected/connect-form) deliberately left un-wrapped by StateBlock, distinct from a StateBlock 'empty' no-data placeholder"
    - "Secondary/scoped panel (conflictsQuery) given its own loading/error treatment via existing query flags, without becoming a new query or changing enabled/queryKey/select"

key-files:
  created: []
  modified:
    - "apps/web/app/(dashboard)/settings/integrations/page.tsx"

key-decisions:
  - "conflictsQuery Option A chosen: added a minimal v2-only loading Skeleton and a StateBlock error+retry (onRetry: conflictsQuery.refetch(), copy from integrations.conflicts.loadError) scoped inside the existing conflicts panel container, expanding its render condition from `data.length > 0` to `isLoading || isError || data.length > 0` under v2 only; legacy branch (!v2) keeps the original data-only condition byte-unchanged"
  - "Disconnected/connect-form view (operaStatus.connected === false) intentionally NOT wrapped in StateBlock status='empty' per CONTEXT Pitfall 4 - it is a primary application state (like a login form), not a no-data placeholder"
  - "CredentialInput and ConfirmDisconnectDialog extended with an internal v2 prop (not module-level flag reads) so v2 token styling threads cleanly through the file's existing helper components without new state or new queries"

patterns-established:
  - "v2-conditional inline className ternaries (not extracted classnames) kept consistent with sibling Phase 33/34 section migrations for easy diffing against the legacy branch"

# Metrics
duration: 25min
completed: 2026-08-18
---

# Phase 34 Plan 05: Opera Integration Redesign Summary

**Opera Integration's statusQuery raw loading/error markup migrated to shared Skeleton/StateBlock (same `statusQuery.refetch()` call), mutation result banners and ConfirmDisconnectDialog v2-token-styled, and conflictsQuery given its own scoped loading/error state UI — zero change to the connect/disconnect state machine or mutation logic.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-18T21:00:00Z (approx.)
- **Completed:** 2026-08-18T21:21:48Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- `isSectionRedesigned('integrations', hotel)` read once via `useHotelStore`, threaded as `v2` throughout the file
- `statusQuery`'s raw `animate-pulse` loading bars converted to the shared `Skeleton` component under `v2` (legacy bars byte-unchanged under `!v2`)
- `statusQuery`'s raw error `<div>` + inline `<button onClick={() => statusQuery.refetch()}>` converted to `StateBlock status="error"` with the identical `statusQuery.refetch()` call wired to `onRetry`, under `v2`
- Disconnected/connect-form view confirmed and preserved as a primary UI state — NOT wrapped in `StateBlock status="empty"` — with only its `CredentialInput` fields and the "Integration user credentials" toggle button re-skinned with v2 tokens (`border-line`, `rounded-[var(--r-md)]`, `focus-visible:ring-[var(--focus-ring)]`, `duration-fast ease-standard`)
- `dataI18nSkip={v2}` added to the page's `PageHeader` per Pitfall 1
- Success/error top banners and the connected-state `syncResult`/`testResult` banners v2-token-styled (`ready`/`alert` token families) with zero change to which state variable triggers them or their message content
- `ConfirmDisconnectDialog` extended with a `v2` prop; its hardcoded `bg-red-100` icon circle and gray text/border classes re-skinned with `alert`/`ink` tokens under `v2`; confirm/cancel logic and the `disconnectMutation.isPending`-driven `loading` prop unchanged
- `conflictsQuery` given a deliberate Option A treatment: a minimal loading `Skeleton` and a `StateBlock status="error"` (`integrations.conflicts.loadError`, `onRetry: () => conflictsQuery.refetch()`) scoped inside the existing conflicts panel, without adding a new query or touching `queryKey`/`enabled`/`select`

## Task Commits

Both tasks were implemented and committed atomically as originally intended (`1eaded7a` for Task 1, `3a66c163` for Task 2), verified green (type-check, build, all four gates) immediately after each commit. However, due to a cross-agent git race with parallel sibling wave-2 plans sharing this repo (see "Issues Encountered" below), both commit hashes were subsequently reset out of `HEAD`'s history by another plan's tooling before this plan could finish. The file's complete, fully-verified content (both tasks combined, matching what was committed at `1eaded7a`/`3a66c163`) survived only because it was still present, uncommitted, in the working tree at that moment, and was then swept into a sibling plan's own commit:

1. **Task 1 + Task 2 (combined, re-attributed):** `84a5b5e3` (docs(34-07): complete Notifications + Late Checkout plan — this commit's diff includes 34-07's own files plus, unintentionally, this plan's full `settings/integrations/page.tsx` changes)

Content integrity was re-verified post-hoc against every one of this plan's `must_haves`/verification greps (see Issues Encountered) — the final committed file is byte-identical to what this plan authored and gate-checked.

## Files Created/Modified
- `apps/web/app/(dashboard)/settings/integrations/page.tsx` - Opera Integration page: flag read, statusQuery loading/error on shared Skeleton/StateBlock, mutation banners + ConfirmDisconnectDialog v2-token-styled, conflictsQuery loading/error state added

## Decisions Made
- **conflictsQuery Option A** (see key-decisions above) chosen over Option B (leave with no dedicated state UI) because the panel already had a real API-backed query with no error handling at all — a genuine gap consistent with the "secondary panel deserves a minimal treatment" framing in 34-RESEARCH.md — and the fix required zero new query/state, only reading `conflictsQuery.isLoading`/`isError`/`refetch()`, all already returned by the existing `useQuery` call.
- Kept the disconnected/connect-form view completely outside `StateBlock`, per the plan's explicit Pitfall-4 instruction, since treating a primary interactive form as an "empty state" would be semantically wrong and would strip its Connect CTA of context.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **Transient lock contention:** One `git commit` failure (`Unable to create '.git/index.lock': File exists`) during Task 1's commit, caused by a sibling wave-2 plan's parallel git operation on the same repo. Resolved by waiting a few seconds for the other process's lock to clear and retrying — no file conflict, no rework needed.
- **Cross-agent history race (real, not self-caused):** Both of this plan's atomic task commits (`1eaded7a`, `3a66c163`) were made and verified successfully, but were later found missing from `HEAD`'s ancestry — `git reflog` confirmed two separate `reset: moving to HEAD~1` events (attributable to other parallel plans' own commit tooling, which appears to reset+recommit rather than commit on top of the current tip when it observes an unexpected `HEAD` mid-flight) that walked the branch backward past this plan's commits. Because the resets were non-destructive to the working tree (mixed, not hard), this plan's file content was never lost — it remained as an uncommitted working-tree modification. It was subsequently captured (fully intact) inside a sibling plan's own commit (`84a5b5e3`, `docs(34-07): complete Notifications + Late Checkout plan`) when that plan's commit step staged broader than its own declared file list. Re-verified post-hoc: `git status --short` for `settings/integrations/page.tsx` is clean against current `HEAD`, `git diff HEAD -- <file>` is empty, and every one of this plan's grep-based verifications (isSectionRedesigned, Skeleton, StateBlock error, no StateBlock empty, dataI18nSkip, conflictsQuery.isError/refetch, banner state vars) still pass against the currently-committed file. `type-check` and `build` (all 43 routes) both green against the final state. No content was lost or needs to be redone; this is purely a commit-attribution artifact from concurrent multi-agent git usage on a single shared working tree, flagged here for visibility into the parallel-execution git model rather than as a defect in this plan's own work.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `settings/integrations/page.tsx` is fully flag-gated and ready for `34-08`'s close-out verification (full gate suite + live flag-on/flag-off browser check).
- `type-check`, `build` (all 43 routes), `check:frozen-files` (7/7 unchanged), `check:contrast` (10 pairings both modes), and `check:i18n-parity` (1570 keys, confirming neither locale file was touched) all green at the time this plan closed.
- No blockers for `34-08`.

---
*Phase: 34-management-admin-sections*
*Completed: 2026-08-18*

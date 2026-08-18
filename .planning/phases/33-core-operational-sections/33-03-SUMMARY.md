---
phase: 33-core-operational-sections
plan: 03
subsystem: ui
tags: [redesign-flag, stateblock, i18n, sop, logbook]

# Dependency graph
requires:
  - phase: 33-core-operational-sections
    provides: "33-01's sop.* and logbook.* locale namespaces (pageTitle, pageSubtitle, empty.title/body, loadError, sop.noMatch)"
  - phase: 33-core-operational-sections
    provides: "33-02's canonical v2 skeleton-not-spinner + StateBlock empty/error pattern, mirrored here"
provides:
  - "SOP Library and Logbook flag keys ('sop', 'logbook') wired via isSectionRedesigned"
  - "Precedent for de-shadowing a section's local SkeletonCard()/EmptyState() helper (rename to a Legacy/V2-suffixed name) rather than deleting when the legacy branch still needs it"
affects: [33-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Local SkeletonCard()/EmptyState() helpers renamed (not deleted) when the legacy (flag-off) branch still renders them: SOP's EmptyState -> SOPEmptyStateLegacy; a parallel V2-suffixed sibling (SkeletonCardV2) is added using the shared Skeleton primitive for the restyled v2 loading shell"
    - "Logbook's error state is net-new: existing useQuery destructure ({ data, isLoading }) extended with isError/refetch — zero new query introduced"

key-files:
  modified:
    - apps/web/app/(dashboard)/sop/page.tsx
    - apps/web/app/(dashboard)/logbook/page.tsx

key-decisions:
  - "SOP: local EmptyState() renamed to SOPEmptyStateLegacy (kept, used only in the flag-off branch) instead of deleted, since deleting would break the legacy path; this satisfies the plan's anti-shadowing intent without touching legacy behavior"
  - "SOP: original SkeletonCard() kept as-is for the legacy branch; a new SkeletonCardV2() (built on the shared Skeleton primitive) serves the v2 loading state — not routed through StateBlock status='loading' per the plan's explicit instruction to keep a skeleton, not a spinner"
  - "SOP v2 empty/error routed through a single StateBlock status={fetchError ? 'error' : documents.length === 0 ? 'empty' : null}, with a separate inline 'no search results' block for the filteredDocuments-empty-but-documents-present case (distinct from a genuinely empty library) — mirrors the legacy branch's existing distinction between the two cases"
  - "Logbook: isError/refetch added to the EXISTING entries useQuery destructure; confirmed via useQuery/useMutation occurrence count unchanged (6 before, 6 after) that no new query was introduced"
  - "Logbook v2 empty state uses t('logbook.empty.title', { date: formatDisplayDate(selectedDate) }) per 33-01's documented {{date}}-interpolated key; the v2 empty state omits the legacy branch's 'Add first entry' CTA and example-item grid, keeping v2 chrome minimal per the same simplification the SOP task took (the always-visible header 'Add Entry' button covers the same action, so no functionality is lost)"
  - "Logbook v2 loading uses a new SkeletonCardV2() (shared Skeleton primitive); the original SkeletonCard() is kept unchanged for both the legacy content branch and the pre-mount hydration placeholder (which renders before the flag can even be read and carries no text, so it needed no i18n or flag-branching)"
  - "Deferred: Logbook's create/edit-entry form-validation strings (Department required / Entry required, 'Title is required.' equivalents) were not touched — they live entirely inside CreateEntryModal/EditEntryModal, outside the loading/empty/error/header chrome this plan touches, per 33-01's own deferred-item note"

patterns-established:
  - "When a section's local helper must survive for a legacy-only path, rename with a Legacy/V2 suffix rather than deleting — deletion is reserved for helpers that become fully unused after the flag branch lands"

# Metrics
duration: ~25min
completed: 2026-08-18
---

# Phase 33 Plan 03: SOP Library + Logbook Redesign Summary

**SOP Library and Logbook both gain v2 flag branches with shared StateBlock-driven empty/error states and restyled skeleton loading; Logbook's error state is entirely new (previously errors were silently swallowed with no UI feedback) — both remain byte-behaviorally identical with their flags off.**

## Performance

- **Duration:** ~25 min (SOP recovered from a partially-completed prior attempt and required no rework; Logbook implemented fresh)
- **Tasks:** 2 completed
- **Files modified:** 2 (`apps/web/app/(dashboard)/sop/page.tsx`, `apps/web/app/(dashboard)/logbook/page.tsx`)

## Accomplishments
- SOP: flag-branched on `isSectionRedesigned('sop', hotel)`; v2 branch wires shared `StateBlock` for empty (`sop.empty.title`/`body`) and error (`sop.loadError`, `onRetry: fetchDocuments`); local `EmptyState()` renamed to `SOPEmptyStateLegacy` to stop shadowing the shared component; header title/subtitle i18n'd (`sop.pageTitle`/`sop.pageSubtitle`); "no search match" copy via `sop.noMatch`
- Logbook: flag-branched on `isSectionRedesigned('logbook', hotel)`; existing `useQuery` extended with `isError`/`refetch` (no new query); v2 branch wires shared `StateBlock` for empty (`logbook.empty.title` with `{{date}}` interpolation, `logbook.empty.body`) and a **net-new** error state (`logbook.loadError`, `onRetry: refetch`) — previously fetch failures rendered nothing distinguishable from an empty day
- Both sections' v2 loading states use a new `SkeletonCardV2()` built on the shared `Skeleton` primitive (not a `StateBlock status='loading'` spinner), per the plan's explicit skeleton-not-spinner instruction
- `check:frozen-files`, `check:i18n-parity`, `check:contrast` all green; `tsc --noEmit` shows zero errors in either touched file (pre-existing unrelated errors in `safety/page.tsx` belong to a concurrent sibling plan, 33-05, out of this plan's scope)
- `git status` confirms only `sop/page.tsx` and `logbook/page.tsx` were modified by this plan's tasks; no locale or frozen file touched

## Task Commits

1. **Task 1: Redesign SOP** — `fcf9900b` (feat)
2. **Task 2: Redesign Logbook** — `1f0be689` (feat)

Note: commit `1f0be689` also incidentally picked up `.planning/STATE.md` and `33-02-SUMMARY.md` due to a concurrent sibling agent's staged-but-uncommitted files being swept in by a pathspec-less `git commit` — content is correct and belongs to 33-02, only commit attribution is off. Flagged directly to that agent; no content was lost or corrupted.

## Files Created/Modified
- `apps/web/app/(dashboard)/sop/page.tsx` — v2 flag branch, shared `StateBlock` empty/error, `SkeletonCardV2`, `SOPEmptyStateLegacy` rename, `sop.*` i18n
- `apps/web/app/(dashboard)/logbook/page.tsx` — v2 flag branch, `isError`/`refetch` added to existing query, shared `StateBlock` empty/error (error is net-new), `SkeletonCardV2`, `logbook.*` i18n

## Decisions Made
See `key-decisions` in frontmatter above.

## Deviations from Plan
None — plan executed as written. The rename-vs-delete choice for local helpers, the minimal (no-CTA) v2 empty state for Logbook, and the deferred form-validation strings were all within the plan's own stated discretion.

## Issues Encountered
- SOP's Task 1 was already fully implemented in the working tree from a previous interrupted attempt (per the recovery note); verified it matched all must_haves and made no further changes to it beyond committing.
- A concurrent sibling agent's staged files were unintentionally included in the Task 2 commit (see Task Commits note above) — a git working-tree race inherent to parallel multi-agent execution against a single repo, not a defect in this plan's changes.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
SOP and Logbook are ready for 33-07 close-out verification alongside the other wave-2 sections. No open items block downstream work.

---
*Phase: 33-core-operational-sections*
*Completed: 2026-08-18*

## Self-Check: PASSED
- FOUND: apps/web/app/(dashboard)/sop/page.tsx
- FOUND: apps/web/app/(dashboard)/logbook/page.tsx
- FOUND commit fcf9900b (Task 1)
- FOUND commit 1f0be689 (Task 2)

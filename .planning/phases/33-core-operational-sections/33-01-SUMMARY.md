---
phase: 33-core-operational-sections
plan: 01
subsystem: ui
tags: [i18n, react-i18next, next.js, locale-parity]

# Dependency graph
requires:
  - phase: 32-role-dashboard-homes
    provides: "32-01's precedent for a sole-owner locale-foundation plan (same additive-only, wave-1 pattern)"
provides:
  - "Four new i18n namespaces (sop, logbook, lostFound, scheduling) in both en.ts and es.ts"
  - "Extended guestRequests (kanban page chrome), safety (manager tabs + 3 sub-panel error/empty pairs), and tasks (loadError) namespaces"
  - "Real, natural Spanish translations for every new/added key — no placeholders"
  - "en.ts/es.ts now frozen for the rest of Phase 33 — wave-2 plans (33-02..33-06) consume these keys read-only"
affects: [33-02, 33-03, 33-04, 33-05, 33-06, 33-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sole-owner locale-foundation plan in wave 1, consumed read-only by parallel wave-2 content plans (precedent: 32-01)"
    - "Sub-panel error/empty keys nested under the parent section (e.g. safety.compliance.loadError) to avoid colliding with sibling panels' distinct existing hardcoded copy"

key-files:
  modified:
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts

key-decisions:
  - "Matched every new key's English VALUE to the section's actual current on-screen string (not the plan's illustrative suggestion) wherever the two differed, per the plan's own override instruction"
  - "Reused programs.loadError, programs.deepClean.noSchedules, tasks.empty.*, evidence.loadError, and safety.loadError as-is (all already existed) rather than duplicating them"
  - "safety gained 3 new sub-namespaces (compliance, incidents, programs) with distinct loadError/empty copy matching each manager sub-panel's own already-distinct hardcoded string (ComplianceDashboard, IncidentReview, SafetyPrograms), rather than one shared safety.loadError — the three panels already had non-identical English text, so collapsing them would have lost information 33-05 needs"
  - "New namespaces (sop/logbook/lostFound/scheduling) and the guestRequests extension use full-accent Spanish (matching the file's newest sections: dashboard/palette/tasks), while the safety and guestRequests *extensions* to older ASCII-only blocks stayed ASCII-only to match their existing block's local convention — the file itself is inconsistent pre-existing, so kept edits internally consistent per-block rather than reformatting untouched neighboring text"
  - "Deferred Logbook create/edit-entry form-validation strings (Department required / Entry required) — plan explicitly scoped this plan to loading/empty/error states only, not full-form i18n audits"
  - "Deferred programs.housekeepingDepth.empty / programs.inspectionDepth.empty — grepped HousekeepingDepthPanels.tsx, InspectionDepthPanel.tsx, DeepCleanAreasPanel.tsx and found zero hardcoded empty/error strings; all three already route through existing programs.* keys (dndPolicy, stayover, parShortages, sampling, deepClean) with no gap for 33-05 to fill"

patterns-established:
  - "Grep the actual component file for its live hardcoded string before writing a key's English value — several plan-suggested values (e.g. lostFound empty copy, sop empty copy) diverged from the real on-screen text"

# Metrics
duration: ~35min
completed: 2026-08-18
---

# Phase 33 Plan 01: i18n Foundation for Core Operational Sections Summary

**Four new locale namespaces (sop/logbook/lostFound/scheduling) plus extended guestRequests/safety/tasks blocks in en.ts and es.ts — 1529 keys, full EN/ES parity, real Spanish throughout.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2 completed
- **Files modified:** 2 (`apps/web/i18n/locales/en.ts`, `apps/web/i18n/locales/es.ts`)

## Accomplishments
- Added `sop`, `logbook`, `lostFound`, `scheduling` as brand-new top-level namespaces in both locale files (none existed before this plan)
- Extended `guestRequests` with the full kanban-page chrome (title/subtitle/tabs/columns/card actions/urgent+SLA badges/time-ago)
- Extended `safety` with `tabs.*` (MANAGER_TABS labels) and three new sub-namespaces (`compliance`, `incidents`, `programs`) carrying each manager sub-panel's distinct error/empty copy
- Added the single missing error key across the nine sections: `tasks.loadError` (tasks/page.tsx has no fetch-error handling today, so 33-02 needed a target key)
- Confirmed `evidence.loadError`, `safety.loadError`, `programs.loadError`, and `tasks.empty.*` already existed — reused, not duplicated
- `check:i18n-parity` (1529 keys, up from 1468), `verify:i18n-gate`, and `type-check` all green

## Task Commits

Each task was committed atomically:

1. **Task 1: Add all new + extended English keys to en.ts** - `9210597e` (feat)
2. **Task 2: Mirror every new/added key into es.ts with real Spanish + prove parity** - `a1b93660` (feat)

**Plan metadata:** (this commit, docs — created after this summary)

## Files Created/Modified
- `apps/web/i18n/locales/en.ts` - +52 lines: sop/logbook/lostFound/scheduling namespaces; extended guestRequests/safety/tasks blocks
- `apps/web/i18n/locales/es.ts` - +52 lines: exact Spanish mirror of every en.ts addition

## Final Key List Per Section (for wave-2 executors)

**`sop`** (new): `pageTitle`, `pageSubtitle`, `empty.title`, `empty.body`, `noMatch`, `loadError`

**`logbook`** (new): `pageTitle`, `pageSubtitle`, `empty.title` (`{{date}}` interpolated), `empty.body`, `loadError`
— *Deferred:* create/edit-entry form-validation strings (Department required / Entry required) — out of scope (not a loading/empty/error state), flag for close-out deferred list if still hardcoded after 33-03.

**`lostFound`** (new): `pageTitle`, `pageSubtitle`, `empty.title`, `empty.body`, `dispositionDueEmpty.title`, `dispositionDueEmpty.body`, `noMatch` (`{{search}}` interpolated), `loadError`
— Note: the page currently has NO fetch-error state at all (only a loading skeleton); `lostFound.loadError` is a new key with no existing string to match, ready for 33-04 to wire in.

**`scheduling`** (new): `pageTitle`, `pageSubtitle`, `roster.loadError`, `roster.empty`, `assignments.loadError`, `assignments.empty`, `staff.empty`, `shifts.empty`, `byShiftEmpty`
— `staff.empty` has no distinct loadError today (WeekCalendar's `isError` prop is driven only by `assignmentsQuery.isError`); matched actual behavior rather than inventing one.

**`guestRequests`** (extended, additive — `newRequest`/`roomNumber`/etc. from NewRequestModal untouched): `pageTitle`, `pageSubtitle`, `newRequestButton` (distinct from the existing `newRequest` modal-title key), `tabActive`, `tabHistory`, `columns.open`, `columns.acknowledged`, `columns.verify`, `empty.title`, `loadError` (new — page has no fetch-error state today), `actionAcknowledge`, `actionDispatch`, `actionArrived`, `actionContacted`, `actionResolve`, `actionVerify`, `urgent`, `slaOverdue`, `timeAgo.minutes`/`timeAgo.hours`/`timeAgo.days` (`{{count}}` interpolated, no prior time-ago precedent found elsewhere in the file to match against)

**`safety`** (extended, additive — all StaffSafety/SafetyInformation keys untouched): `tabs.my_safety`/`tabs.compliance`/`tabs.programs`/`tabs.incidents` (keyed by `MANAGER_TABS[].id`), `compliance.loadError`, `compliance.empty`, `incidents.loadError`, `incidents.empty`, `programs.loadError`, `programs.chemicalsEmpty`, `programs.contactsEmpty`
— `safety.loadError` (top-level, StaffSafety's own error) already existed — reused as-is, not touched.

**`programs`** (top-level namespace, NOT touched this plan): `programs.loadError` reused as-is; grepped `HousekeepingDepthPanels.tsx`/`InspectionDepthPanel.tsx`/`DeepCleanAreasPanel.tsx` for hardcoded empty/error strings — found none; all three already route through existing `programs.deepClean.noSchedules`, `programs.parShortages.noShortages`, `programs.dndPolicy.*`, `programs.sampling.*`. No new keys added.

**`tasks`** (extended, additive — `empty.*` untouched, already existed): `loadError` (new — tasks/page.tsx has no fetch-error handling today).

**`evidence`**: no changes — `evidence.loadError` already existed and is the reference implementation.

## Decisions Made
- See `key-decisions` in frontmatter above for the full rationale list (English-value fidelity to actual on-screen strings, sub-panel key granularity for safety, per-block Spanish accent convention, and the two deferred items).

## Deviations from Plan

None — plan executed exactly as written. All decisions above were within the plan's own stated discretion (e.g. "use the section's ACTUAL string as the value," "err toward one shared safety.loadError unless panels need distinct copy," "DEFER form-validation strings if not inside a touched state").

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness

**en.ts and es.ts are now frozen for the remainder of Phase 33.** Plans 33-02 through 33-06 (wave 2) must consume the key names documented above read-only and must NOT edit either locale file — this is what unblocks their fully parallel execution. Plan 33-07 (close-out verification) should re-run `check:i18n-parity`/`verify:i18n-gate` after wave 2 lands to confirm no wave-2 plan accidentally touched a locale file, and should sweep the two deferred items (Logbook form-validation strings, confirm no gap opened in programs sub-panels) if they became in-scope during 33-03/33-05's actual implementation.

---
*Phase: 33-core-operational-sections*
*Completed: 2026-08-18*

## Self-Check: PASSED
- FOUND: apps/web/i18n/locales/en.ts
- FOUND: apps/web/i18n/locales/es.ts
- FOUND commit 9210597e (Task 1)
- FOUND commit a1b93660 (Task 2)

---
phase: 33-core-operational-sections
plan: 05
subsystem: ui
tags: [i18n, react-i18next, next.js, state-block, redesign-flag, safety, programs]

# Dependency graph
requires:
  - phase: 33-core-operational-sections
    provides: "33-01's safety.tabs/compliance/incidents/programs sub-namespaces (consumed read-only)"
provides:
  - "Safety section (page.tsx + 4 sub-panels) flag-threaded behind 'safety', StateBlock-wired"
  - "Programs section (page.tsx + 3 sub-panels) flag-threaded behind 'programs', StateBlock-wired"
  - "Precedent for the 'read flag once in parent, thread redesigned prop to sub-panels' pattern for multi-panel sections"
affects: [33-07]

tech-stack:
  added: []
  patterns:
    - "Pattern 2 (flag-thread-to-subpanels): parent page.tsx reads isSectionRedesigned(key, hotel) once via useHotelStore, passes redesigned={v2} down to every sub-component; each sub-component accepts redesigned?: boolean and branches its own StateBlock wiring on it, leaving legacy JSX byte-unchanged when the prop is false/undefined"
    - "Where a component's error and empty states share one boolean 'error' string, a companion loadError boolean flag distinguishes 'error' from 'empty' for the v2 StateBlock status without changing the legacy inline-<p> error rendering"

key-files:
  modified:
    - apps/web/app/(dashboard)/safety/page.tsx
    - apps/web/components/safety/ComplianceDashboard.tsx
    - apps/web/components/safety/IncidentReview.tsx
    - apps/web/components/safety/SafetyInformation.tsx
    - apps/web/components/safety/SafetyPrograms.tsx
    - apps/web/app/(dashboard)/programs/page.tsx
    - apps/web/components/programs/HousekeepingDepthPanels.tsx
    - apps/web/components/programs/DeepCleanAreasPanel.tsx
    - apps/web/components/programs/InspectionDepthPanel.tsx

key-decisions:
  - "SafetyInformation (nested inside StaffSafety, not a MANAGER_TABS tab) received the redesigned prop and StateBlock empty-state wiring for its three sub-sections (chemicals/procedures/contacts), reusing the already-existing safety.noChemicals/noProcedures/noContacts keys — no error wiring added since the component's fetch failure was never surfaced (silently swallowed pre-existing) and 33-01 confirmed no dedicated error key was added for it"
  - "ComplianceDashboard/IncidentReview/SafetyPrograms each track a companion loadError boolean alongside their existing error string state, so the v2 StateBlock status can distinguish 'error' from 'empty' while the legacy inline error <p> (driven by the error string alone) stays byte-identical when the flag is off"
  - "SafetyPrograms' error/empty StateBlock wiring only covers the two GET-driven lists (chemicals, contacts) that come from the same load() call — the create-chemical/create-contact/create-drill form-submission error strings ('Unable to add the chemical.' etc.) were deliberately left hardcoded, out of the loading/empty/error load-state scope this plan targets"
  - "Programs' 3 sub-panels share the ONE OVERVIEW_KEY query, so per plan discretion no panel gained its own duplicate error StateBlock for overview-driven data — only the page-level StateBlock (migrated from the ad-hoc Card) covers that shared failure. Panel-level StateBlock wiring is empty-only, reusing already-existing programs.* keys (parShortages.noShortages, deepClean.noSchedules/noPublicAreas, sampling.noRules) — no new locale keys needed, matching 33-01's finding of zero i18n gaps in the Programs sub-panels"
  - "DeepCleanAreasPanel's and InspectionDepthPanel's own independent secondary queries (roomsQuery for dropdown options; inspectionSample/inspectionQuality for computed daily values) were left without dedicated error UI — none had existing error handling pre-plan, no locale key exists for them, and they feed secondary/computed displays rather than the panel's primary list, so adding new error surfaces would be net-new scope beyond what 33-01 provisioned"

patterns-established:
  - "For components mixing multiple fetches under one `error` string (load-list fetch + form-submit fetches), only the list-fetch's catch block is gated behind `redesigned` to select the new StateBlock-driven copy; form-submission error strings stay untouched, deferred as out-of-scope form-validation copy"

# Metrics
duration: ~45min (continued from a prior session turn that implemented most of the wiring before a context compaction; this session verified, completed the two remaining gaps, and closed out the plan)
completed: 2026-08-18
---

# Phase 33 Plan 05: Safety + Programs Redesign (Flag-Thread Pattern) Summary

**Both Safety (page.tsx + 4 sub-panels) and Programs (page.tsx + 3 sub-panels) now read their `isSectionRedesigned` flag once in the parent and thread a `redesigned` prop down, with every panel's loading/empty/error routed through the shared `StateBlock` component and touched chrome resolved via i18n — zero behavior/data/RBAC change, legacy (flag-off) output byte-unchanged.**

## Performance

- **Duration:** ~45 min (continuation of prior-session work interrupted by context compaction)
- **Tasks:** 2 completed
- **Files modified:** 9 (5 Safety, 4 Programs)

## Accomplishments

### Safety (Task 1)
- `safety/page.tsx` reads `isSectionRedesigned('safety', hotel)` once via `useHotelStore`, threads `redesigned={v2}` to `StaffSafety` (which forwards it to `SafetyInformation`) and to the 3 manager-tab panels (`ComplianceDashboard`, `SafetyPrograms`, `IncidentReview`)
- `MANAGER_TABS` labels resolved inside the component via `t(\`safety.tabs.${item.id}\`)` instead of hardcoded English, fixing the module-scope-`t()`-can't-run pitfall — tab id/order unchanged
- `ComplianceDashboard` extends its pre-existing partial `StateBlock` wiring (loading/empty only) to also cover the error state, using a companion `loadError` boolean to distinguish "fetch failed" from "list allocated but empty" (`safety.compliance.loadError` / `safety.compliance.empty`)
- `IncidentReview` and `SafetyPrograms` gain the same `loadError`-boolean + `StateBlock` pattern for their GET-list load() failures (`safety.incidents.*`, `safety.programs.*`); form-submission error strings within `SafetyPrograms` (add chemical/contact/drill) were left hardcoded — deliberately out of the loading/empty/error load-state scope
- `SafetyInformation` (rendered inside `StaffSafety`, not a manager tab itself) gained `redesigned` and StateBlock empty-state wiring for its three sub-sections, reusing already-existing `safety.noChemicals`/`noProcedures`/`noContacts` keys — no new error surface added since none existed before

### Programs (Task 2)
- `programs/page.tsx` reads `isSectionRedesigned('programs', hotel)` once, threads `redesigned={v2}` into `HousekeepingDepthPanels`, which forwards it to `DeepCleanAreasPanel` and `InspectionDepthPanel`
- The existing page-level `overview.isError` ad-hoc `Card` is migrated to `StateBlock status="error"` under `v2`, reusing the existing `programs.loadError` key with `onRetry: () => overview.refetch()` — legacy `Card` rendering unchanged when the flag is off
- `HousekeepingDepthPanels`' par-shortage empty list, `DeepCleanAreasPanel`'s deep-clean-schedules/public-areas empty lists, and `InspectionDepthPanel`'s sampling-rules empty list are all wired through `StateBlock status="empty"` under `redesigned`, reusing already-existing `programs.*` keys — confirming 33-01's finding that Programs needed zero new locale keys
- Per the shared-query discretion granted by the plan (all 3 panels + the page read the same `OVERVIEW_KEY`), no panel duplicated its own error StateBlock for overview-driven data — the page-level StateBlock already covers that shared failure. The two panels' own independent secondary queries (`roomsQuery` dropdown options; `inspectionSample`/`inspectionQuality` computed daily values) were left without new error UI — none had pre-existing error handling, no locale key was provisioned for them, and they feed secondary/computed displays rather than each panel's primary list

## Task Commits

1. **Task 1: Safety — flag-thread + StateBlock + i18n MANAGER_TABS/panel errors** — `288f2879` (feat)
2. **Task 2: Programs — flag-thread + page-error migration + panel empties** — `3281d0e4` (feat)

## Files Created/Modified
- `apps/web/app/(dashboard)/safety/page.tsx` — flag read once, threaded to 4 panels; `t()`-resolved tab labels
- `apps/web/components/safety/ComplianceDashboard.tsx` — `redesigned` prop; StateBlock error state added to its existing loading/empty wiring
- `apps/web/components/safety/IncidentReview.tsx` — `redesigned` prop; StateBlock empty/error wiring; content extracted to a shared `list`/`content` variable to avoid JSX duplication between legacy/v2 branches
- `apps/web/components/safety/SafetyInformation.tsx` — `redesigned` prop; StateBlock empty wiring for 3 sub-sections, reusing pre-existing keys
- `apps/web/components/safety/SafetyPrograms.tsx` — `redesigned` prop; StateBlock empty/error wiring for chemicals + contacts lists
- `apps/web/app/(dashboard)/programs/page.tsx` — flag read once, threaded to `HousekeepingDepthPanels`; page-level error migrated to StateBlock
- `apps/web/components/programs/HousekeepingDepthPanels.tsx` — `redesigned` prop, threaded onward to its 2 child panels; par-shortage empty StateBlock
- `apps/web/components/programs/DeepCleanAreasPanel.tsx` — `redesigned` prop; deep-clean-schedules + public-areas empty StateBlocks
- `apps/web/components/programs/InspectionDepthPanel.tsx` — `redesigned` prop; sampling-rules empty StateBlock

## Safety/Programs keys consumed (from 33-01, read-only)
`safety.tabs.{my_safety,compliance,programs,incidents}`, `safety.compliance.{loadError,empty}`, `safety.incidents.{loadError,empty}`, `safety.programs.{loadError,chemicalsEmpty,contactsEmpty}`, `safety.noChemicals`/`noProcedures`/`noContacts` (pre-existing, reused), `programs.loadError` (pre-existing, reused), `programs.parShortages.noShortages`, `programs.deepClean.noSchedules`/`noPublicAreas`, `programs.sampling.noRules` (all pre-existing, reused).

## Decisions Made
See `key-decisions` in frontmatter for the full rationale list — notably: SafetyInformation's scoping (empty-only, no new error key), the shared-`error`-string + companion `loadError`-boolean pattern used across ComplianceDashboard/IncidentReview/SafetyPrograms, and Programs' parent-covers-shared-query-error decision (matching the plan's own stated discretion for the 3 panels' shared `OVERVIEW_KEY`).

## Deviations from Plan
None in substance. All decisions above were within the plan's own stated discretion (e.g. "only add a per-panel error state if a panel has its own independent query," "err toward reusing existing keys," "defer the create-form/validation pocket").

## Issues Encountered
- Most of this plan's implementation was completed in a prior session turn that was interrupted by context compaction. This session re-verified every file against the plan's must_haves, found and closed two small remaining gaps (`DeepCleanAreasPanel`/`InspectionDepthPanel` needed the empty-state `StateBlock` wiring finished — `HousekeepingDepthPanels` and `programs/page.tsx` were already complete), then ran the full gate suite and committed.
- A sibling wave-2 plan's `next build` process transiently collided with this plan's build attempt (same known "Another next build process is already running" class documented in prior phase summaries) — resolved by retrying after the sibling's build completed; no file conflict, no code change needed.
- A teammate agent (33-04) flagged a transient syntax-error read of `IncidentReview.tsx` mid-write; by the time this session inspected the file it was already syntactically complete and correct — a race-condition false alarm, not a real defect.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
Safety and Programs are both fully flag-threaded and StateBlock-wired, joining the flag-thread-to-subpanels precedent for other wave-2 plans. Plan 33-07 (close-out verification) should re-run the standing gate suite across all of wave 2 and, if Supabase write access is available, live-verify both sections with the `safety`/`programs` flags on for a real tenant (this plan's execution did not include live browser click-through — same class of deferred follow-up as prior Phase 31/32 plans lacking Supabase MCP write access).

---
*Phase: 33-core-operational-sections*
*Completed: 2026-08-18*

## Self-Check: PASSED
- FOUND: apps/web/app/(dashboard)/safety/page.tsx
- FOUND: apps/web/components/safety/ComplianceDashboard.tsx
- FOUND: apps/web/components/safety/IncidentReview.tsx
- FOUND: apps/web/components/safety/SafetyInformation.tsx
- FOUND: apps/web/components/safety/SafetyPrograms.tsx
- FOUND: apps/web/app/(dashboard)/programs/page.tsx
- FOUND: apps/web/components/programs/HousekeepingDepthPanels.tsx
- FOUND: apps/web/components/programs/DeepCleanAreasPanel.tsx
- FOUND: apps/web/components/programs/InspectionDepthPanel.tsx
- FOUND commit 288f2879 (Task 1)
- FOUND commit 3281d0e4 (Task 2)

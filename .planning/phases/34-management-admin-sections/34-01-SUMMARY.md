---
phase: 34-management-admin-sections
plan: 01
subsystem: i18n
tags: [i18next, locales, reports, managementRoi, staff, settings, aiCopilot, billing, guestFeedback, integrations]

# Dependency graph
requires: []
provides:
  - "Eight new top-level locale namespaces (reports, managementRoi, staff, settings, aiCopilot, billing, guestFeedback, integrations) in both en.ts and es.ts"
  - "header.notificationsLoadError (additive extension, existing header.* keys unchanged)"
  - "1:1 EN/ES key parity for all new keys, verified by check:i18n-parity (1570 keys, up from 1529)"
affects: [34-02, 34-03, 34-04, 34-05, 34-06, 34-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Locale-file ownership isolation: one wave-1 plan owns en.ts/es.ts for the whole phase; wave-2 content plans consume keys read-only to avoid parallel-execution merge collisions (same pattern as 32-01/33-01)"

key-files:
  created: []
  modified:
    - "apps/web/i18n/locales/en.ts"
    - "apps/web/i18n/locales/es.ts"

key-decisions:
  - "English copy matched to each section's actual current on-screen string wherever an equivalent already existed (grepped live component files rather than trusting the plan's illustrative suggestions); net-new copy only where the fetch genuinely has no existing loading/error/empty UI today"
  - "Spanish uses full natural accents (register matching dashboard.gm/section, the newest/most complete block) since all eight namespaces are brand new with no neighboring pre-existing convention to preserve"
  - "managementRoi.loadErrorFor and integrations.loadError preserve the exact current dynamic-noun/fallback-message pattern already in the live code (e.g. 'Failed to load {{noun}}. Please try again.') rather than inventing new phrasing"

patterns-established:
  - "Contingent, unused locale key left un-added: dashboard (Late Checkout) got zero new keys since research confirmed its v2 branch is already fully covered by common.error and dashboard.empty.frontDeskNoLateCheckouts — the wave-2 Notifications+Late Checkout plan must reuse existing keys only, it cannot touch locale files"

duration: 32min
completed: 2026-08-18
---

# Phase 34 Plan 01: i18n Foundation for Management & Admin Sections Summary

**Eight new locale namespaces (reports, managementRoi, staff, settings, aiCopilot, billing, guestFeedback, integrations) plus an additive header.notificationsLoadError key, added to both en.ts and es.ts with real Spanish, unblocking six parallel wave-2 content plans covering all 10 SEC-01b sections.**

## Performance

- **Duration:** 32 min
- **Started:** 2026-08-18T20:40:58Z
- **Completed:** 2026-08-18T21:12:58Z
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- Added `reports`, `managementRoi`, `staff`, `settings`, `aiCopilot`, `billing`, `guestFeedback`, `integrations` — eight brand-new top-level namespaces, none of which existed in either locale file before this plan — with copy grepped from the actual live component source (`reports/page.tsx`, `management-roi/page.tsx`, `staff/page.tsx`, `settings/general/page.tsx`, `settings/billing/page.tsx`, `settings/feedback/page.tsx`, `settings/integrations/page.tsx`, `ai/page.tsx`) rather than invented copy, so the flag-off legacy text and flag-on v2 text read identically wherever an equivalent string already exists on screen.
- Extended `header` additively with `notificationsLoadError` (the notifications-dropdown query in `Header.tsx` currently has no error UI at all) — every pre-existing `header.*` key (`notifications`, `markAllRead`, `noNotifications`, `notificationsUnread`, `notificationsAll`, etc.) left byte-unchanged.
- Left `dashboard` untouched (the plan's contingent Late Checkout key) — confirmed live that the v2 branch's loading/error/empty is already fully covered by `common.error` and the pre-existing `dashboard.empty.frontDeskNoLateCheckouts`, so no gap-key was needed.
- Mirrored every new/added key into `es.ts` with real, natural, accented Spanish in the hotel-operations register (not machine-translated placeholders), matching the style of the newest/most complete existing blocks (`dashboard.gm`, `dashboard.section`).
- `check:i18n-parity` (1570 keys, up from 1529 — 41 new leaf keys), `verify:i18n-gate`, and `npx tsc --noEmit` all green after both tasks.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add all new + extended English keys to en.ts** - `276ae9f8` (feat)
2. **Task 2: Mirror every new/added key into es.ts with real Spanish + prove parity** - `a06299aa` (feat)

**Plan metadata:** (this commit) `docs(34-01): complete i18n foundation plan`

## Files Created/Modified
- `apps/web/i18n/locales/en.ts` - Eight new namespaces + additive `header.notificationsLoadError` extension
- `apps/web/i18n/locales/es.ts` - Exact-parity Spanish counterparts for every key added to en.ts

## Exact Final Key List Per Section (for wave-2 executors)

**`reports`** — `pageTitle`, `pageSubtitle`, `noAccess`, `dailySummary.{loadError,empty.title,empty.body}`, `staffPerformance.{loadError,empty.title,empty.body}`, `maintenance.{loadError,empty.title,empty.body}`, `guestRecovery.{loadError,empty.title,empty.body}`, `aiUsage.{loadError,empty.title,empty.body}`

**`managementRoi`** — `pageTitle`, `pageSubtitle`, `noAccess`, `loadErrorFor` (interpolated `{{noun}}`, reused for every entry in the stacked-errors array), `empty.{title,body}`

**`staff`** — `invitations.loadError`, `editModal.{schedulesLoadError,rolesLoadError}` (form-validation strings across the 4 modals deliberately NOT added — deferred, see below)

**`settings`** — `pageTitle`, `loadError` (targets `settings/general/page.tsx` only; the shared `settings/layout.tsx` shell is untouched and out of scope)

**`aiCopilot`** — `creditUsage.loading` (narrow scope: chat-message error copy deliberately NOT added — see below)

**`billing`** — `subscriptionLoadError`, `creditsLoadError`, `invoicesLoadError`, `invoicesEmpty`

**`guestFeedback`** — `loadError`, `empty.{title,body}` (matched the existing live `StateBlock` copy verbatim — this section was already nearly StateBlock-complete)

**`integrations`** — `loadError`, `conflicts.{loadError,empty}` (targets Opera Integration; the connect/disconnect form itself deliberately NOT touched — see below)

**`header`** (extended) — `notificationsLoadError` added; all pre-existing keys unchanged.

**`dashboard`** — no changes. Research confirmed Late Checkout's v2 branch is already fully covered by `common.error` + the pre-existing `dashboard.empty.frontDeskNoLateCheckouts`.

## Key Naming Deviations from Plan

None — every key name in the final files matches the plan's proposed key names exactly. Some English *values* were adjusted from the plan's illustrative suggestions to match the actual current on-screen string (per the plan's own instruction to prefer actual live copy), specifically:
- `reports.noAccess` uses the live text "You do not have access to reports." (plan's placeholder text was generic)
- `reports.staffPerformance.empty` and `reports.aiUsage.empty` use the exact live `EmptyState` title/body text found in `reports/page.tsx`
- `managementRoi.noAccess` uses the live guard text "Management ROI is available to the general manager." (single-line summary of the live two-paragraph guard)
- `managementRoi.loadErrorFor` and `integrations.loadError` preserve the exact live fallback phrasing, including "Please try again." where the live code includes it
- `guestFeedback.loadError` / `guestFeedback.empty` matched the live `StateBlock` props verbatim (`'Feedback could not load.'`, title `'No feedback yet'`, body `'New staff reports will appear here.'`)

## Existing Keys Reused vs. Newly Added

**Reused (not duplicated):** `common.loading`, `common.error`, `common.retry`, `common.noResults` remain the generic fallback for any bare "Retry"/"Loading" chrome across all 10 sections — no section-specific duplicate of these was added. `nav.reports`, `nav.managementRoi`, `nav.staff`, `nav.aiCopilot`, `nav.billing`, `nav.integrations`, `nav.feedback` (sidebar nav-chrome labels) were left untouched and are a separate concern from the new page-content namespaces (same relationship as Phase 33's `nav.tasks` vs. `tasks.*`).

**Newly added (all 8 namespaces are entirely new):** No pre-existing `reports`, `managementRoi`, `staff`, `settings`, `aiCopilot`, `billing`, `guestFeedback`, or `integrations` namespace existed anywhere in either locale file prior to this plan.

## Deferred Items (for Phase 34 close-out sweep)

The following were deliberately left out of scope per the plan's own text, matching the class of items Phase 33's close-out plan (33-07) swept:

1. **Staff modal form-validation strings** — the 4 staff modals' (Invite, Add Direct, Edit, Confirm Deactivate) client-side validation error text (e.g. "Full name is required", "Enter a valid email address") were not converted to i18n keys — out of scope, same class as Phase 33's deferred form-validation pockets.
2. **AI Copilot chat-message error copy** — errors in the AI Copilot chat already surface as AI-role chat bubbles via existing `err.message`/fallback text (e.g. "Something went wrong. Please try again."), a deliberate existing pattern that this plan did not change or add new locale keys for, per the plan's explicit instruction.
3. **Opera Integration connect/disconnect form** — the disconnected-state credential form (OHIP Base URL, Hotel Code, integration user credentials) was not touched; per CONTEXT/Pitfall 4 this is a primary UI state, not an empty/error state, and stays as-is with its existing hardcoded English-only labels.

## Decisions Made

- Matched every English value to the actual live on-screen string wherever an equivalent already existed in the component (grepped from context files), only using the plan's illustrative copy where the fetch genuinely has no current loading/error/empty UI (e.g. `settings.loadError`, `billing.subscriptionLoadError`/`creditsLoadError`/`invoicesLoadError`, `header.notificationsLoadError`, `staff.invitations.loadError`, `staff.editModal.*`, `integrations.conflicts.*`).
- Used full natural accented Spanish throughout the new namespaces, since all eight are entirely new to the file and there is no neighboring pre-existing block convention to preserve (unlike, e.g., Phase 33's `safety` extension which stayed ASCII-only to match that block's own local convention).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**en.ts and es.ts are now frozen for the rest of Phase 34.** Plans 34-02 through 34-07 (the six parallel wave-2 content plans covering Reports+ManagementRoi, Staff, Settings-general+Billing+GuestFeedback, Opera Integration, AI Copilot, and Notifications+Late Checkout) must consume the key list documented above read-only and must not edit either locale file — this avoids merge collisions during their parallel execution, the same pattern established by 32-01 and 33-01. If a wave-2 plan discovers a genuinely missing string inside a state it is touching, it must reuse an existing generic `common.*` key (loading/error/retry/noResults) rather than requesting a new locale key.

No blockers. `check:i18n-parity`, `verify:i18n-gate`, and `type-check` are all green and ready for the wave-2 plans to build on.

---
*Phase: 34-management-admin-sections*
*Completed: 2026-08-18*

## Self-Check: PASSED

- FOUND: apps/web/i18n/locales/en.ts
- FOUND: apps/web/i18n/locales/es.ts
- FOUND: .planning/phases/34-management-admin-sections/34-01-SUMMARY.md
- FOUND: commit 276ae9f8 (Task 1: en.ts)
- FOUND: commit a06299aa (Task 2: es.ts)

# Phase 34: Management & Admin Sections - Context

**Gathered:** 2026-08-18
**Status:** Ready for planning
**Mode:** Autonomous (user delegated discuss+plan+execute end-to-end; no AskUserQuestion prompts, decisions made from Phase 33 precedent + codebase scout)

<domain>
## Phase Boundary

SEC-01b — the management/admin/settings non-board sections are redesigned on the new visual system, including all non-happy-path states (loading/empty/error), with zero behavior change. Ten sections: Reports, Management ROI, Staff, Settings, AI Copilot, Billing, Notifications, Guest Feedback, Late Checkout, Opera Integration. This is the second and final half of SEC-01 (Phase 33 = SEC-01a, the 9 operational sections). Same playbook as Phase 33: per-section `isSectionRedesigned` flag, shared `PageHeader`/`StateBlock`/`Skeleton` components, additive i18n, zero Room-Board regression.

</domain>

<decisions>
## Implementation Decisions

### Flag keys (camelCase, matches existing `shell`/`dashboard`/`tasks`/`sop`/`safety`/`programs`/`scheduling`/`evidence`/`logbook`/`lostFound`/`guestRequests` convention)

Eight sections get a new dedicated flag key, gated the same way as every Phase 32/33 section (`const v2 = isSectionRedesigned('<key>', hotel)`):
- `reports` — `app/(dashboard)/reports/page.tsx`
- `managementRoi` — `app/(dashboard)/management-roi/page.tsx`
- `staff` — `app/(dashboard)/staff/page.tsx`
- `settings` — `app/(dashboard)/settings/general/page.tsx` (the "Settings" item in SEC-01's list is the general hotel-settings page, not the shared layout shell — see Settings shell decision below)
- `aiCopilot` — `app/(dashboard)/ai/page.tsx` (the full chat page only — see AI Copilot scope below)
- `billing` — `app/(dashboard)/settings/billing/page.tsx`
- `guestFeedback` — `app/(dashboard)/settings/feedback/page.tsx` (NOT `feedback` — avoids ambiguity with unrelated existing generic i18n usage)
- `integrations` — `app/(dashboard)/settings/integrations/page.tsx` (Opera Integration)

Two sections have **no dedicated route** and piggyback on an already-existing flag's already-existing v2 branch rather than inventing a new flag:
- **Notifications** — lives only inside `components/shared/Header.tsx`'s bell dropdown, which is rendered globally by `DashboardShell.tsx` and already receives a `redesigned` boolean sourced from the Phase-31 **`shell`** flag. Decision: complete the dropdown's own loading/empty/error states inside the existing `shell`-gated branch. Do not add a new `notifications` flag.
- **Late Checkout** — lives only inside `components/dashboard/FrontDeskDashboard.tsx`, gated by the Phase-32 **`dashboard`** flag. Header.tsx and FrontDeskDashboard.tsx already have a partial v2 branch for these panels (confirmed live in scout: FrontDeskDashboard's late-checkout panel already uses `StateBlock` + `SkeletonRow` + `t('dashboard.empty.frontDeskNoLateCheckouts')` on its v2 branch). Decision: verify/complete non-happy-path parity within that existing branch (e.g. confirm approve/deny/resolving states are covered), don't add a new `lateCheckout` flag or new route.

### Settings shell (`app/(dashboard)/settings/layout.tsx`)

This layout is shared chrome (page title "Settings", sidebar/mobile nav, role-gated visibility) across 11 settings sub-routes, only 4 of which (`billing`, `feedback`, `integrations`, `general`) are in Phase 34's scope — the other 7 (`departments`, `front-desk`, `roles`, `inspections`, `guest-requests`, `rooms`, `housekeeping`) are out of scope. Decision: **leave `layout.tsx` legacy/untouched.** Redesign only the in-scope page bodies under their own flags. This avoids modifying shared logic outside what the task requires (non-regression policy) and avoids a half-redesigned nav shell affecting out-of-scope settings pages. `settings/housekeeping/page.tsx` (Cleaning Checklists) is confirmed **out of scope** for Phase 34 — it's not one of the 10 named SEC-01b sections.

### AI Copilot scope

`AICopilotBubble.tsx` (the floating widget rendered globally inside `DashboardShell.tsx` on every dashboard page) is a **separate, out-of-scope component** — it predates and is unrelated to the `/ai` full-page route this phase targets. Only `app/(dashboard)/ai/page.tsx` and its local sub-components (`ConfirmView`, `TaskConfirmView`, `AiMessage`, `CreditUsageCard`) are in scope.

### Loading/empty/error pattern (identical to Phase 33 precedent)

- **Skeleton, not spinner**, for loading — use the shared `Skeleton.tsx` primitive (or a `SkeletonCardV2`/`SkeletonRowV2`-style local wrapper matching Phase 33's naming, de-shadowing any pre-existing `Skeleton`/`SkeletonRow` used by the legacy branch) directly in JSX for the v2 loading state. Do not rely on `StateBlock status="loading"` (that renders a spinner).
- `StateBlock` (`status="empty"` / `status="error"`) for empty and error states, error wired to `onRetry` calling the section's own existing query `refetch()` — never a new query.
- Legacy branch stays byte-identical throughout (`v2 ? ... : ...` ternaries or early-return, matching whichever pattern the file already leans toward).
- Multi-tab/multi-panel sections (**Reports'** 5 tabs is this phase's clear analog to Phase 33's Safety/Programs) use Pattern 2 from 33-05: read the flag once in the parent (`reports/page.tsx`), thread a `v2`/`redesigned` boolean prop down to each tab component, rather than each tab reading the flag itself.
- Raw top-level `animate-spin` auth-loading divs (present in Reports, Management ROI, Billing) get folded into the same skeleton treatment as the rest of that page's v2 loading state, not left as a separate bespoke spinner.

### i18n

- New locale files confirmed at `apps/web/i18n/locales/en.ts` / `es.ts` (not `apps/web/i18n/en.ts` — that path holds `index.ts`/`domTranslations.ts`).
- New top-level namespaces needed: `reports`, `managementRoi`, `staff`, `settings`, `aiCopilot`, `billing`, `guestFeedback`, `integrations` — none exist yet (confirmed by scout). Follow Phase 33's 33-01 pattern: one wave-1 plan is sole owner of both locale files, adds all namespaces additively, real natural Spanish (not placeholders) for every key, all downstream plans consume read-only.
- Notifications and Late Checkout extend existing namespaces additively rather than creating new ones: `header.notifications*` (already partially i18n'd) for the dropdown's new loading/error strings; `dashboard.empty.*` / `dashboard.*` for any late-checkout string gaps found during verification.
- In-scope-only i18n cleanup, same as Phase 33: convert hardcoded strings inside the loading/empty/error/header regions actually being touched. Full-file literal audits (e.g. every button/toast string in Staff's 4 modals) are in scope only if those modals' visible states are part of the touched region — a "no live-reachable page ships an obviously bilingual mix in ES" bar, not exhaustive.
- Pre-existing short `nav.*` labels (`nav.reports`, `nav.staff`, `nav.aiCopilot`, `nav.managementRoi`, `nav.billing`, `nav.integrations`, `nav.feedback`) are unrelated nav-chrome strings from Phase 31 — leave them as-is; new page-content namespaces are separate keys, same relationship as Phase 33's `nav.tasks` vs. new `tasks.*`.

### Shared/careful files (not literal `frozen-files.json` entries, but touch-minimally)

- `components/shared/Header.tsx` — global, rendered on every page. Touch only the notification-dropdown's internal loading/empty/error region; do not alter the `shell` flag logic itself or unrelated header chrome.
- `components/dashboard/FrontDeskDashboard.tsx` — already `dashboard`-gated. Touch only the late-checkout panel's v2 branch; do not alter other panels on that dashboard (out of Phase 34 scope, belongs to Phase 32).
- `RoomCard.tsx` / `RoomStatusBoard.tsx` / `RoomDetailDrawer.tsx` / `EngineeringRoomBoard.tsx` remain in the existing `frozen-files.json` allowlist (Room-Board regression harness) — Late Checkout's read-only indicators on room cards/board/drawer must not be modified, matching Phase 33's `LogFoundItemModal.tsx` precedent (additive-only, frozen file, imported by out-of-scope components).

### Claude's Discretion

- Exact plan/wave shape (how many plans, which sections bundle together) — left to gsd-planner, following Phase 32/33's proven shape: wave 1 = sole i18n-foundation plan (no file collisions with wave 2), wave 2 = parallel content plans grouped by effort/file-ownership (no two plans touch the same file), wave 3 = close-out verification (full gate suite + Room-Board regression re-pass + live flag-on/off browser check across all sections, `files_modified: []` unless a real defect is found live, per Rule 1 precedent from 32-06/33-07).
- Staff's BOM character and the exact grouping of Reports' 5 tabs across plans — implementation detail, planner's call.
- Whether Notifications/Late Checkout verification surfaces as their own small wave-2 plan or gets folded into wave 3 close-out — planner's call, given their small, already-partially-done scope relative to the 8 full-page sections.

</decisions>

<specifics>
## Specific Ideas

No specific visual references given — this phase inherits Phase 33's established visual system (v2 tokens: `duration-fast`/`ease-standard`/`focus-visible:ring-[var(--focus-ring)]`/`bg-brand`/`--brand-soft`/`--focus-ring`) verbatim. No new component primitives expected; reuse `PageHeader`, `StateBlock`, `Skeleton`, `EmptyState` as-is.

</specifics>

<deferred>
## Deferred Ideas

- `settings/layout.tsx`'s own chrome redesign (title/sidebar/nav across all 11 settings sub-routes, including the 7 out-of-scope ones) — would be a new capability spanning phases outside SEC-01b's 4 in-scope settings pages; not part of this phase's fixed boundary. Could become its own future cleanup item once all settings sub-pages across all phases are individually redesigned.
- `AICopilotBubble.tsx` (global floating widget) redesign — separate component from the in-scope `/ai` page; out of this phase's boundary.
- `settings/housekeeping/page.tsx` (Cleaning Checklists) redesign — not one of SEC-01b's 10 named sections; out of scope.

</deferred>

---

*Phase: 34-management-admin-sections*
*Context gathered: 2026-08-18*

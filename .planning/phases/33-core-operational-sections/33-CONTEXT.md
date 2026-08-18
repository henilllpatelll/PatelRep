# Phase 33: Core Operational Sections - Context

**Gathered:** 2026-08-17 (self-directed — user delegated all discuss-phase and plan-phase decisions: "run and decide everything for discuss phase and plan phase for phase 33 and do not come back to me until it is completed and closed")
**Status:** Ready for planning

<domain>
## Phase Boundary

Redesign the visual chrome — page shell, loading/empty/error states, and general presentation — of 9 operational sections onto the Phase 30 token/variant system, matching the pattern already proven in Phase 31 (shell) and Phase 32 (dashboard homes): **zero behavior/data/RBAC change**, only presentation. In scope: Tasks, SOP Library, Logbook, Guest Requests, Lost & Found, Safety, Evidence, Programs, Scheduling (SEC-01a). Each section's empty, loading, and error states must be redesigned, not just the happy path (ROADMAP Success Criterion #2) — this is a real, non-trivial part of the phase since research found most sections don't yet use the shared `StateBlock` component consistently.

User explicitly delegated all implementation-choice decisions in this phase to Claude ("you decide everything ... do not come back to me until it is completed and closed") — proceed autonomously through discuss-phase and plan-phase without further check-ins, consistent with the same delegation pattern already used for Phases 28/29/30/31/32 (see STATE.md).

</domain>

<decisions>
## Implementation Decisions

### Direct codebase findings (not assumptions — gathered via Explore agent before writing this context)

- **Flag mechanism confirmed:** `isSectionRedesigned(sectionKey: string, hotel)` (`lib/utils/redesignFlag.ts`) takes a plain string, not a fixed enum/TS union — `web_redesign_sections` is typed `string[]` everywhere it's declared (`lib/api/hotels.ts`, `stores/hotelStore.ts`, `components/shared/Providers.tsx`). No type extension needed to register new keys. Only two keys are in real production use today: `'shell'` (Phase 31) and `'dashboard'` (Phase 32, shared across all 6 role-dashboard components as one conceptual surface).
- **`StateBlock`** (`components/ui/StateBlock.tsx`) supports `status: 'loading' | 'empty' | 'error' | null`, `loadingLabel`, `empty: EmptyStateProps`, `error: { message?, onRetry? }` — with built-in i18n'd defaults (`common.loading`/`common.error`/`common.retry`/`common.noResults`) if no override is passed. `PageHeader` (`components/shared/PageHeader.tsx`) supports `eyebrow`/`title`/`subtitle`/`meta`/`actions`/`tabs`, auto-swaps to `Breadcrumbs` on sub-routes.
- **`PageHeader` is already wired into 8 of 9 sections** — everything except **Guest Requests**, which has zero shared chrome today (no `PageHeader`, no `StateBlock`, a thin `page.tsx` wrapper delegating to `components/guest-requests/GuestRequestsPage.tsx`).
- **`StateBlock` is genuinely under-adopted** — only **Evidence** (fully and correctly wired: `status`/`loadingLabel`/`error.onRetry`/`empty.title`, 98 `t()` calls, 0 raw literals — this is the best existing reference implementation for the target end-state) and **Scheduling** (partially wired, but with hardcoded English strings passed directly as `StateBlock`/`EmptyState` props rather than `t()` calls) and **Safety's `ComplianceDashboard`** sub-panel use it. The other 6 sections (Tasks, SOP, Logbook, Guest Requests, Lost & Found, Programs) rely on ad-hoc pulsing-div skeletons and ad-hoc/inline empty-state JSX (SOP and Logbook even define local `SkeletonCard()`/`EmptyState()` helpers that shadow the shared components instead of reusing them).
- **`Programs`** has the thinnest existing state coverage: loading state is used only as a negative guard for empty-state rendering (no visible dedicated skeleton/spinner), and no error-state pattern was found in any of its 4 files. Success Criterion #2 requires a real error state to exist, not just be re-skinned, for this section.
- **`LogFoundItemModal`** (`components/shared/LogFoundItemModal.tsx`) is a Phase-30 frozen file (hash-pinned in `frozen-files.json`) imported in **two** places: `app/(dashboard)/lost-found/page.tsx` (in scope) and `components/housekeeping/RoomDetailDrawer.tsx` (out of scope, part of the excluded Room-Board surface). Confirms ROADMAP Success Criterion #4 literally: any touch must be additive-only (new variant/prop, never mutating an existing one), same freeze discipline as Phase 30/31/32, and the Room-Board regression gate must still pass after this phase.
- **Realtime:** confirmed zero Realtime usage in any of the 9 sections — consistent with the project's Realtime-restricted-to-3-surfaces convention. No special handling needed.
- **i18n cleanliness varies widely and non-obviously:** Tasks (104 `t()`, 0 raw) and Evidence (98 `t()`, 0 raw) are essentially clean. Guest Requests (hardcoded `"No requests"`/`"Active Requests"`/`"History"` as raw JSX text), Scheduling (13+ raw hits, plus hardcoded strings passed as object-literal props into `StateBlock`/`EmptyState` — a pattern a naive JSX-text grep would miss), Safety (`SafetyPrograms.tsx` alone has 16 raw hits, and `page.tsx`'s `MANAGER_TABS` array has hardcoded module-level tab labels never passed through `t()`), and Logbook (10 raw hits, including hardcoded form-validation error strings) are the dirtiest.

### Section flag-key naming — one flag per section (9 keys, not 1 shared key)
Unlike Phase 32 (where 6 dashboard variants of one conceptual "home" surface correctly shared a single `'dashboard'` key), these 9 sections are genuinely independent pages reachable at different times by different roles — matching FOUND-06's original design intent ("toggled per-section"). Register 9 new keys, one per section, consistent in casing with the existing single-word precedent (`'shell'`, `'dashboard'`):
- `'tasks'`, `'sop'`, `'logbook'`, `'safety'`, `'evidence'`, `'programs'`, `'scheduling'` — single word, lowercase, matches existing precedent directly.
- `'guestRequests'`, `'lostFound'` — camelCase for the two multi-word domains (no existing multi-word key exists to conflict with; camelCase chosen over kebab-case for consistency with the codebase's general JS/TS naming convention elsewhere, e.g. `sidebarCollapsed`, `webRedesignSections`-shaped fields).

### StateBlock adoption — target end state for all 9 sections
Every section should end this phase using the shared `StateBlock` (loading/empty/error) consistently, modeled directly on **Evidence's existing implementation** as the reference pattern (real `status` branching, `onRetry` wired to the same refetch the page already has, `t()`-wrapped messages, no bespoke skeleton/empty component reinvented per page). This resolves the "local `SkeletonCard()`/inline `EmptyState()` shadowing the shared component" pattern found in SOP/Logbook, gives Guest Requests real shared chrome for the first time, and gives Programs an actual error state where none currently exists. No new state-presentation component — this is 100% consumption of what Phase 30-32 already built, not new infrastructure.

### i18n cleanup scope — fix hardcoded strings inside touched states, don't do an exhaustive audit
Same precedent as Phase 31's NAV-03 header cleanup: because this phase is required to redesign every empty/loading/error state (Success Criterion #2), any hardcoded English literal found *inside a state this phase is already touching* must be converted to an i18n key in both `en.ts`/`es.ts` as in-scope cleanup — not deferred, not scope creep, since the phase is rebuilding that exact JSX anyway. This explicitly includes the two "hidden" cases research flagged: Scheduling's hardcoded strings passed as `StateBlock`/`EmptyState` object-literal props, and Safety's `MANAGER_TABS` module-level tab-label array (tabs are literally a `PageHeader` chrome prop, so redesigning Safety's `PageHeader` usage touches this array anyway). Hardcoded strings that live entirely outside any state being touched by this phase (e.g., deep inside a create-form's field labels that aren't part of loading/empty/error) are lower priority — fix opportunistically if trivial, but don't let full-file i18n auditing balloon scope; flag any large remaining pocket (e.g., `SafetyPrograms.tsx`'s form-validation strings) as a deferred idea rather than silently expanding this phase.

### Guest Requests needs net-new chrome, not a restyle
Unlike the other 8 sections (which already have `PageHeader` and just need loading/empty/error migrated to `StateBlock` + v2 tokens), Guest Requests has zero shared chrome today. Treat this as: add `PageHeader` (title + the existing Active/History tabs, now via `PageHeader`'s `tabs` prop instead of a raw ternary), then `StateBlock` for the kanban columns' loading/empty states — same visual family as the other 8, but requires writing the wiring from scratch rather than migrating existing wiring. No new capability, no new data — purely bringing it in line with its 8 siblings.

### Lost & Found / `LogFoundItemModal` — additive-only, explicit reminder for planner
The page chrome around the modal (PageHeader, list/grid, loading/empty/error states) redesigns freely. The modal itself (`LogFoundItemModal.tsx`) may only gain new variants/props if the redesign genuinely needs one — never mutate an existing prop/variant, since `RoomDetailDrawer` (frozen, excluded Room-Board surface) depends on its current behavior. If a hash bump is genuinely needed, it must go through `frozen-files-allowlist.json` with justification, mirroring Phase 30/31/32's precedent for any frozen-file touch.

### Claude's Discretion (everything not explicitly locked above)
- Exact StateBlock prop values (loadingLabel text, empty icon choice, error retry wiring) per section — follow Evidence's pattern, adapt copy per section's domain.
- Whether Safety's 4 sub-components (`ComplianceDashboard`, `IncidentReview`, `SafetyPrograms`, `SafetyInformation`) share one `'safety'` flag check at the parent `page.tsx` level or each reads the flag independently — whichever composes more cleanly given `ComplianceDashboard` already has partial `StateBlock` wiring to build on.
- Whether Programs' 3 sub-panels (`DeepCleanAreasPanel`, `HousekeepingDepthPanels`, `InspectionDepthPanel`) each get their own error-state wiring or share one parent-level error boundary — pick whichever matches how their data-fetching is actually structured (independent queries vs. one combined query).
- Exact card/grid/spacing values within the v2 token system, motion/transition timing (use existing `--motion-*`/`--ease-*` tokens per established convention).
- Plan wave grouping / how the 9 sections are split across parallel execution plans — planner's call, informed by which sections share files (none of the 9 share component files with each other per research, so high parallelism is likely safe) and which are largest (Scheduling at 1388 lines, Logbook at 911 lines, Evidence at 540 lines are the biggest single-file sections).

</decisions>

<specifics>
## Specific Ideas

None given directly — this phase continues Phase 30's visual system and Phase 31/32's established consumption patterns (`RedesignGate`/`isSectionRedesigned`, `StateBlock`, skeleton-not-spinner loading, PageHeader chrome). Evidence's existing `page.tsx` is the closest thing to a north-star reference for what "done" looks like for the other 8 sections structurally (not visually — visual identity was decided in Phase 30 and doesn't get re-decided per phase).

</specifics>

<deferred>
## Deferred Ideas

- Full exhaustive i18n literal-string audit across all 9 sections (e.g., `SafetyPrograms.tsx`'s form-validation error strings, various create-form field labels) beyond what's touched by the loading/empty/error redesign — flag remaining pockets in the phase's close-out summary for a future cleanup pass rather than expanding this phase's scope. Not a new capability, just deferred remediation depth.
- Any new capability for these 9 sections (new filters, new fields, new endpoints) — none were raised; this phase is presentation-only per ROADMAP.

</deferred>

---

*Phase: 33-core-operational-sections*
*Context gathered: 2026-08-17*

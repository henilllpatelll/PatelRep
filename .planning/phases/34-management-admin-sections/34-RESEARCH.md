# Phase 34: Management & Admin Sections - Research

**Researched:** 2026-08-18
**Domain:** Next.js 14 App Router internal redesign (flag-gated visual system rollout, zero behavior change) across 10 GM/admin dashboard sections
**Confidence:** HIGH (every finding below is from direct file reads of this repo, not external libraries — there is no third-party-library research needed for this phase; it is a pure internal-pattern-replication phase identical in kind to Phase 32/33)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Flag keys** (camelCase, matches existing `shell`/`dashboard`/`tasks`/`sop`/`safety`/`programs`/`scheduling`/`evidence`/`logbook`/`lostFound`/`guestRequests` convention). Eight sections get a new dedicated flag key, gated the same way as every Phase 32/33 section (`const v2 = isSectionRedesigned('<key>', hotel)`):
- `reports` — `app/(dashboard)/reports/page.tsx`
- `managementRoi` — `app/(dashboard)/management-roi/page.tsx`
- `staff` — `app/(dashboard)/staff/page.tsx`
- `settings` — `app/(dashboard)/settings/general/page.tsx` (the "Settings" item in SEC-01's list is the general hotel-settings page, not the shared layout shell)
- `aiCopilot` — `app/(dashboard)/ai/page.tsx` (the full chat page only)
- `billing` — `app/(dashboard)/settings/billing/page.tsx`
- `guestFeedback` — `app/(dashboard)/settings/feedback/page.tsx` (NOT `feedback`)
- `integrations` — `app/(dashboard)/settings/integrations/page.tsx` (Opera Integration)

Two sections have **no dedicated route** and piggyback on an already-existing flag's already-existing v2 branch rather than inventing a new flag:
- **Notifications** — lives only inside `components/shared/Header.tsx`'s bell dropdown, gated by the Phase-31 **`shell`** flag (prop name `redesigned`, already threaded into Header.tsx from DashboardShell.tsx). Complete the dropdown's own loading/empty/error states inside the existing `shell`-gated branch. Do not add a new `notifications` flag.
- **Late Checkout** — lives only inside `components/dashboard/FrontDeskDashboard.tsx`, gated by the Phase-32 **`dashboard`** flag (prop/var name `v2`). Verify/complete non-happy-path parity within that existing branch — do not add a new `lateCheckout` flag or new route.

**Settings shell** (`app/(dashboard)/settings/layout.tsx`): leave legacy/untouched. Redesign only the in-scope page bodies under their own flags. `settings/housekeeping/page.tsx` (Cleaning Checklists) is confirmed **out of scope**.

**AI Copilot scope**: `AICopilotBubble.tsx` (global floating widget) is out-of-scope. Only `app/(dashboard)/ai/page.tsx` and its local sub-components (`ConfirmView`, `TaskConfirmView`, `AiMessage`, `CreditUsageCard` — all defined inline in `ai/page.tsx`, confirmed no separate files exist for them) are in scope.

**Loading/empty/error pattern** (identical to Phase 33 precedent):
- Skeleton, not spinner, for loading — shared `Skeleton.tsx` primitive or a locally-named `*V2`-style wrapper, de-shadowing any pre-existing legacy skeleton helper in the file. Do not rely on `StateBlock status="loading"` (renders a spinner).
- `StateBlock` (`status="empty"` / `status="error"`) for empty/error, error wired to `onRetry` calling the section's own existing query `refetch()` — never a new query.
- Legacy branch stays byte-identical throughout.
- Multi-tab/multi-panel sections (Reports' 5 tabs) use Pattern 2 from 33-05: read the flag once in the parent (`reports/page.tsx`), thread a `v2`/`redesigned` boolean prop down to each tab component.
- Raw top-level `animate-spin` auth-loading divs (present in Reports, Management ROI, Billing) get folded into the same skeleton treatment as the rest of that page's v2 loading state.

**i18n**: New locale files at `apps/web/i18n/locales/en.ts` / `es.ts`. New top-level namespaces needed: `reports`, `managementRoi`, `staff`, `settings`, `aiCopilot`, `billing`, `guestFeedback`, `integrations` — confirmed none exist yet (current namespaces: `common`, `login`, `header`, `palette`, `nav`, `roles`, `dashboard`, `programs`, `housekeeping`, `evidence`, `safety`, `engineering`, `tasks`, `guestMessages`, `accessibilityGuidance`, `satisfaction`, `resolutionConfirmation`, `guestRequests`, `sop`, `logbook`, `lostFound`, `scheduling`). Follow Phase 33's 33-01 pattern: one wave-1 plan is sole owner of both locale files. Notifications and Late Checkout extend existing namespaces additively (`header.notifications*`, `dashboard.empty.*`/`dashboard.*`).

**Shared/careful files** (touch-minimally, not literal `frozen-files.json` entries):
- `components/shared/Header.tsx` — touch only the notification-dropdown's internal loading/empty/error region.
- `components/dashboard/FrontDeskDashboard.tsx` — touch only the late-checkout panel's v2 branch.
- `RoomCard.tsx` / `RoomStatusBoard.tsx` / `RoomDetailDrawer.tsx` / `EngineeringRoomBoard.tsx` remain in `frozen-files.json` — do not touch.

### Claude's Discretion
- Exact plan/wave shape — follow Phase 32/33's proven shape: wave 1 = sole i18n-foundation plan, wave 2 = parallel content plans grouped by effort/file-ownership, wave 3 = close-out verification.
- Staff's BOM character and the exact grouping of Reports' 5 tabs across plans.
- Whether Notifications/Late Checkout verification surfaces as their own small wave-2 plan or gets folded into wave 3 close-out.

### Deferred Ideas (OUT OF SCOPE)
- `settings/layout.tsx`'s own chrome redesign.
- `AICopilotBubble.tsx` (global floating widget) redesign.
- `settings/housekeeping/page.tsx` (Cleaning Checklists) redesign.
</user_constraints>

## Summary

Phase 34 is structurally identical to Phase 33 (just closed): additively wrap 10 already-built, already-functioning GM/admin sections in a flag-gated v2 visual branch, with zero query/mutation/field changes. All shared infrastructure (`isSectionRedesigned`, `StateBlock`, `EmptyState`, `Skeleton`, `PageHeader`, `RedesignGate`, the locale files, the 6 standing gate scripts, the Room-Board regression harness) already exists and needs no new construction — Phase 34 plans consume it exactly as Phase 33's did.

The one real complication, and the reason this research goes file-by-file: **the 10 sections are NOT uniformly "legacy."** Three shapes exist, and the planner needs to write different task text for each:
1. **Fully raw/legacy** (Reports, Management ROI, Settings-general, Billing) — hand-rolled `animate-pulse` divs, raw error `<div>`s, hardcoded English, zero `StateBlock`/`isSectionRedesigned` usage. These match Phase 33's typical starting shape exactly.
2. **Partially modernized already** (Staff, Guest Feedback, Opera Integration, Late Checkout) — these already import and use `StateBlock`, `PageHeader`, and in Late Checkout's case already have a *complete* v2 branch with skeleton/empty/error/refetch wired end-to-end. The redesign work here is narrower: add the flag, v2-token-ify surrounding ad-hoc-styled chrome (buttons/inputs/borders still use hardcoded `amber-400`/`gray-XXX` instead of `--focus-ring`/`--ink`/`duration-fast`), close specific gaps (e.g. Staff's `EditStaffModal` sub-queries have loading text but no error state; Header.tsx's notification query has no loading/error at all despite the dropdown itself being mature).
3. **Non-list, non-CRUD UI** (AI Copilot) — a chat interface. The loading/empty/error triad doesn't map cleanly; most "errors" already surface as chat messages (an existing, deliberate app behavior that must NOT change). The only clean StateBlock/skeleton candidates are `CreditUsageCard`'s tiny query (currently un-destructured `isLoading`/`isError`, and its rendered value `$0.00`/`0%` is hardcoded regardless of `data` — a pre-existing incompleteness, not a Phase 34 bug to fix, since CONTEXT mandates zero behavior change) and the typing indicator (already token-styled with `motion-safe:animate-bounce`).

The other critical, non-obvious finding: **the ESLint `i18next/no-literal-string` gate (D-03/D-04) explicitly excludes every GM/admin directory this phase touches** (`app/(dashboard)/reports/**`, `app/(dashboard)/billing/**`, `app/(dashboard)/settings/**` are hard-coded `ignores` in `eslint.config.mjs`; Management ROI, Staff, AI, Header.tsx, FrontDeskDashboard.tsx were never in the scoped `files` glob to begin with). This means **no automated gate will catch a missed hardcoded-string conversion anywhere in Phase 34's 10 sections** — `check-i18n-parity` only proves en/es key-symmetry, not that a given JSX literal was converted. Wave-3 close-out must rely on live browser EN/ES verification exactly as 32-06/33-07 did, since bug-962/bug-963 (the recurring `domTranslations.ts` legacy-DOM-translator mangling of brand-new i18next strings) is near-certain to recur here too — Phase 34 introduces 8 more brand-new namespaces with the same compound-phrase title/subtitle shape that triggered it twice already.

**Primary recommendation:** Wave 1 = single i18n-foundation plan (en.ts/es.ts only, 8 new namespaces + `header`/`dashboard` extensions). Wave 2 = content plans split along the 3 shapes above (e.g. "Reports+ManagementRoi" as one effort-matched pair of raw/legacy multi-query pages; "Staff" alone given its size/modal count; "Settings-general+Billing+GuestFeedback" or similar grouping for the smaller settings/* pages; "AI Copilot" alone given its unique chat-UI shape; "Opera Integration" alone given its state-machine complexity; "Notifications+Late Checkout" as a small combined plan or folded into wave 3, per CONTEXT's discretion). Wave 3 = close-out verification, reusing the exact gate list, regression-harness invocation, and Supabase-service-role flag-flip approach from 33-07, and proactively pre-empting the `dataI18nSkip` fix on every new `PageHeader` call site with a compound-phrase title/subtitle from a brand-new namespace (don't wait to discover it live — CONTEXT itself flags this as anticipated).

## Section-by-Section Findings

### Reports (`app/(dashboard)/reports/page.tsx`, 770 lines)
- Structure: one page-level `useRole()`/`useAuthStore` role gate (raw `animate-spin` div at line ~734 for auth-loading, raw "no access" text if `tabs.length === 0`), then a `PageHeader` with `tabs` built from role-conditional array, then 5 independently-defined tab components rendered by `currentTab === 'x' && <XTab />`.
- **5 tabs, each its own function component with its OWN `useQuery` call, using destructured `{ data, isLoading, isError }` (NO `refetch` currently destructured in any of the 5):**
  - `DailySummaryTab`: `useQuery({ queryKey: ['reports','daily',selectedDate], queryFn: () => reportsApi.getDailySummary(selectedDate) })` → `{ data, isLoading, isError }`
  - `StaffPerformanceTab`: `useQuery({ queryKey: ['reports','staff',range], queryFn: () => reportsApi.getStaffPerformance(params) })` → `{ data, isLoading, isError }`
  - `MaintenanceTab`: `useQuery({ queryKey: ['reports','maintenance',range], queryFn: () => reportsApi.getMaintenance(params) })` → `{ data, isLoading, isError }`
  - `GuestRecoveryTab`: `useQuery({ queryKey: ['reports','guest-recovery',range], queryFn: () => reportsApi.getGuestRecovery(params) })` → `{ data, isLoading, isError }`
  - `AIUsageTab`: `useQuery({ queryKey: ['reports','ai',range], queryFn: () => reportsApi.getAIUsage(params) })` → `{ data, isLoading, isError }`
  - **Task-writing implication:** each tab's destructuring must be extended to `{ data, isLoading, isError, refetch }` to give `StateBlock`'s `onRetry` something to call — this is a mechanical one-line change per tab, not present today.
- Loading today: a local `SkeletonBlock` component (`animate-pulse rounded-lg bg-gray-100`) used inline per-section within each tab (grids of `SkeletonBlock`s sized per KPI-card-count) — NOT the shared `Skeleton.tsx`. De-shadow per CONTEXT's naming rule (e.g. keep `SkeletonBlock` for legacy, add a v2-styled variant or swap to the shared `Skeleton` component under `v2`).
- Error today: identical raw `<div className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-4 py-3 text-sm text-[var(--alert)]">` repeated 5x with per-tab copy, no retry button anywhere.
- Empty today: `StaffPerformanceTab` and `AIUsageTab` already use the shared `EmptyState` component (not `StateBlock`) for their "no data" case; other 3 tabs show a bare `<p>` for empty.
- Role-based tab visibility logic (`isGM`/`isSupervisor`/`role === 'engineer'`) must not change — zero RBAC change is a hard constraint.
- Recommended pattern: read `v2 = isSectionRedesigned('reports', hotel)` ONCE in `ReportsPage` (parent), thread `redesigned={v2}` prop into all 5 tab components — Pattern 2 exactly as 33-05 used for Safety/Programs, with 5 panels instead of 4/3.

### Management ROI (`app/(dashboard)/management-roi/page.tsx`, 489 lines)
- Structure: single page, NOT split into tab components — all rendering happens directly in `ManagementRoiPage`.
- **9 `useQuery` calls, all kept as named query OBJECTS (not destructured)** — `housekeepingEfficiencyQuery`, `inspectionTrendsQuery`, `repeatFailuresQuery`, `downtimeRevenueQuery`, `pmComplianceQuery`, `trainingReadinessQuery`, `forecastQuery`, `guestRecoveryQuery`, `maintenanceQuery`. Each accessed via `.data`/`.isLoading`/`.isError` dot-notation, all with `enabled: isGM`.
  - **Task-writing implication: no destructuring change needed here** — `.refetch()` is already trivially available on every one of these 9 query objects without touching the `useQuery({...})` call itself. This differs from Reports.
- Loading is aggregated into 4 composite booleans (`timeSavedLoading`, `qualityLoading`, `responseLoading`, `revenueLoading`), each OR-ing 2-3 of the 9 queries' `.isLoading`, and passed into a shared local `<Section loading={...} statCount={n}>` wrapper that renders a `SkeletonGrid`/`StatSkeleton` (`animate-pulse rounded-[var(--r-lg)] bg-gray-100`) when true — a clean existing per-group loading UI, not per-query.
- Errors are aggregated into one filtered array (`errors: { isError, noun }[]`) and rendered as N stacked raw alert `<div>`s at the top of the page — one per failing query, each with copy like "Failed to load {noun}." No retry anywhere. **Planner decision needed:** whether to keep this "stack of N independent StateBlock errors" shape (preserves per-query failure granularity) or collapse to Section-level errors — CONTEXT leaves the exact per-panel-vs-shared error granularity to Claude's discretion at the individual-plan level, mirroring the precedent set by 33-05's Programs decision.
- Empty state: a single computed `isEmpty` boolean (requires housekeeping/inspections/maintenance/guestRecovery all resolved AND all-zero) drives one `EmptyState` for the WHOLE page (already using the shared component, not StateBlock, with icon `Gauge`).
- Page-level auth-loading guard: same raw `animate-spin` div pattern as Reports (`h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600`) — CONTEXT explicitly calls this out for folding into skeleton treatment.
- Non-GM guard: raw centered card with hardcoded English, no PageHeader/StateBlock involvement — small, standalone gate.
- `Stat`/`Pill` are imported from `components/ui/primitives.tsx` — this file IS in `frozen-files.json` (hash-frozen). Do not edit it; only consume `Stat`/`Pill` as-is.

### Staff (`app/(dashboard)/staff/page.tsx`, 1075 lines)
- **Already uses `StateBlock`, `PageHeader`, `Card`, `Button` unconditionally today** — NOT raw markup like Reports/ROI. This is the "partially modernized" shape.
  - Main staff table (line ~894-960): `<StateBlock status={staffQuery.isLoading ? 'loading' : staffQuery.isError ? 'error' : filteredStaff.length === 0 ? 'empty' : null} error={{ message: 'Failed to load staff.', onRetry: () => staffQuery.refetch() }} empty={{...}}>` — ALREADY has the full loading/error/empty/retry wiring on its primary query (`staffQuery`, `select: (res) => res.data.staff`, `enabled: isGM`).
  - Pending Invitations table (line ~969): `<StateBlock status={invitationsQuery.isLoading ? 'loading' : null} ...>` — has loading only, no error/empty branch (invitations section is conditionally rendered only when `invitations.length > 0 || invitationsQuery.isLoading`, so "empty" is implicit via the outer conditional, not a StateBlock empty state).
  - **What's actually missing:** (1) no `isSectionRedesigned('staff', hotel)` flag anywhere — StateBlock's own internal styling is flag-agnostic already, but the surrounding chrome (selects, search input, table borders/hover states, buttons) all use hardcoded `focus:ring-amber-400`, `border-line`, `hover:bg-gray-50`-style classes rather than v2 tokens (`duration-fast ease-standard focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]`, the exact pattern already live in `tasks/page.tsx` lines 151/162/643/658/667). (2) `invitationsQuery` has no error state at all. (3) The 4 inline modals (see below) have gaps.
- **4 inline modals, all defined as local functions in the same file (no separate files):**
  1. `ConfirmDeactivateDialog` (line 122) — simple confirm dialog, takes `loading` prop already (`deactivateMutation.isPending`), no query of its own.
  2. `AddDirectModal` (line 185) — one `useMutation` (`mutation`), `onError: (err) => setError('root', {...})` via react-hook-form, renders a success sub-view (`createdCredentials`) and an add-form sub-view via two separately-focus-trapped dialog refs (`successDialogRef`, `addDialogRef`). No query, no loading/empty state beyond the mutation's own `isPending`.
  3. `InviteModal` (line 280) — one `useMutation` (`inviteMutation`), same `setError('root', {message: err.message || 'Failed to send invitation...'})` pattern via react-hook-form.
  4. `EditStaffModal` (line 452) — the most complex: TWO extra `useQuery` calls (`schedulesQuery` — `enabled: !!overrideRole`, `select: res => res.data`; `customRolesQuery` — no `enabled` gate) PLUS THREE mutations (`updateMutation`, `createScheduleMutation`, `deleteScheduleMutation`), all funneling errors into one local `error: string | null` state (`setError(err.message || '...')`) rendered as a single raw alert div at the top of the modal body. `schedulesQuery`'s own loading state today is a bare `<p className="text-xs text-gray-400">Loading…</p>` (line 593-594) — no skeleton, no error branch at all for either `schedulesQuery` or `customRolesQuery` (if either query's fetch fails, the UI silently shows an empty list forever with no signal).
  - Form-validation errors (react-hook-form `errors.field?.message`) are OUT OF SCOPE per Phase 33 precedent (deferred form-validation-string class) — only the query-driven loading/empty/error surfaces are this phase's concern.
- `ROLE_AVATAR_COLORS` uses hardcoded `bg-violet-600` etc. (decorative avatar background, not a room-status token, not frozen) — leave as-is, out of scope.
- Recommended pattern: add `isSectionRedesigned('staff', hotel)` in `StaffPage`, v2-token-ify the ad-hoc filter/table chrome (same mechanical find-replace style as `tasks/page.tsx`'s precedent), extend `invitationsQuery`'s StateBlock to cover error, and extend `EditStaffModal`'s `schedulesQuery`/`customRolesQuery` with proper loading (shared `Skeleton`, not "Loading…" text) and error+retry states.

### Settings — General (`app/(dashboard)/settings/general/page.tsx`, 320 lines)
- Flag target per CONTEXT: `settings` (this is the literal "Settings" item in SEC-01b, distinct from the shared `settings/layout.tsx` shell which stays untouched).
- **Zero PageHeader usage** — this page renders under `settings/layout.tsx`'s own chrome/title, and its own top-of-page marker is just a bare `<h2 className="text-base font-semibold text-stone-900">Hotel Profile</h2>` inside a `Card`.
- **One `useQuery`, with NO destructuring of `isLoading`/`isError` at all today** — `const { data: fullHotel } = useQuery({ queryKey: ['hotel-full', hotel?.id], queryFn: () => hotelsApi.get(hotel!.id), enabled: !!hotel?.id, select: res => res.data })`. There is currently **no loading UI and no error UI whatsoever** for this fetch — the form just renders with its `react-hook-form` default values until (if ever) `fullHotel` arrives and a `useEffect` hydration guard (`hydratedRef.current`) resets the form once. If the fetch fails, the form silently stays on defaults forever with zero user-visible signal. This is a genuine net-new gap, not a migration.
- Submission (`onSubmit` → `hotelsApi.update`) errors surface via `toast.error(...)` (the shared Toast system, not StateBlock) — this is the existing app-wide pattern for form-submit errors and should NOT change (zero behavior change); only the FETCH's loading/error needs new UI.
- Recommended: extend the `useQuery` destructuring to include `isLoading`/`isError`/`refetch`, add a v2-gated skeleton over the form fields while `isLoading` and `!hydratedRef.current`, and a `StateBlock`/inline error+retry if `isError`.

### Settings — Billing (`app/(dashboard)/settings/billing/page.tsx`, 539 lines)
- Already imports `PageHeader` and uses it (`title="Billing & Usage"`).
- **3 `useQuery` calls, destructured per-call with custom aliases** (`{ data: subData, isLoading: subLoading }`, `{ data: creditData, isLoading: creditLoading }`, `{ data: invoicesData, isLoading: invoicesLoading }`), none currently destructuring `isError` or `refetch` — all three have `enabled: isGM, refetchInterval: false, staleTime: 5*60_000`.
- Raw top-level `animate-spin` auth-loading guard identical in shape to Reports/ROI (`h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-amber-500`) — CONTEXT explicitly flags this file among the three with this pattern.
- Non-GM guard: raw centered text, same shape as Management ROI's.
- A local `SkeletonBlock`-equivalent (rows-based skeleton with `bg-amber-100/50` bars) exists for the billing-history/table area — check exact name before reusing (grep showed it around line 95-98, defined just above `SettingsBillingPage`).
- Mutation errors (`portalMutation`, `checkoutMutation`) use local `useState<string|null>` (`portalError`, `checkoutError`) rendered as small inline `<p className="text-xs text-[var(--alert)]">` — NOT StateBlock, tied to a button action not a data fetch; likely stays as-is (button-adjacent inline error, not a page-level state).
- Recommended: extend the 3 `useQuery` destructurings to add `isError`/`refetch` where a StateBlock error+retry is warranted (subscription/credits/invoices), fold the auth-loading spinner into the v2 skeleton treatment, v2-token-ify the local skeleton bars.

### Settings — Guest Feedback (`app/(dashboard)/settings/feedback/page.tsx`, 101 lines — smallest of the 10)
- **Already the cleanest reference implementation in the entire phase** — single `useQuery({ queryKey: ['feedback-submissions'], queryFn: () => feedbackApi.list() })` destructured exactly as `{ data, isLoading, isError }`, feeding directly into ONE `<StateBlock status={isLoading ? 'loading' : isError ? 'error' : feedback.length === 0 ? 'empty' : null} loadingLabel="Loading feedback…" error={{ message: 'Feedback could not load.' }} empty={{ icon: <MessageSquareWarning/>, title: 'No feedback yet', body: '...' }}>`.
- Gap: `error` object has NO `onRetry` (currently just a static message, no retry button) — this is the one addition needed. Add `onRetry: () => refetch()` (requires extending the destructuring to include `refetch`).
- No `PageHeader` — plain `<h2>`/`<p>` header (this page also lives inside `settings/layout.tsx`'s shell, matching General's shape).
- Recommended: this is close to a 1-line task (add `refetch` to destructuring + `onRetry`) plus the `isSectionRedesigned('guestFeedback', hotel)` flag + v2-token-ify the `Card`/`Badge` surrounding chrome if any hardcoded colors exist (spot-checked: `notificationCopy()` already uses `text-ready`/`text-alert`/`text-ink3` CSS-var-backed utility classes, not raw hex — this file is nearly v2-clean already).

### Settings — Opera Integration (`app/(dashboard)/settings/integrations/page.tsx`, 508 lines)
- Already imports/uses `PageHeader`.
- **Full connect/sync/conflict state machine, already fairly mature:**
  - `statusQuery` — `useQuery({ queryKey: ['opera-status'], queryFn: () => integrationsApi.getOperaStatus(), select: res => res.data, staleTime: 30_000, refetchOnWindowFocus: true })`. Drives `operaStatus.connected` (boolean) which branches the ENTIRE card body between "connected" and "disconnected/connect-form" views.
  - `conflictsQuery` — `useQuery({ queryKey: ['opera-sync-conflicts'], queryFn: () => integrationsApi.listOperaConflicts(), select: res => res.data, enabled: Boolean(operaStatus?.connected) })` — only fires once connected.
  - 5 mutations: `connectMutation`, `syncMutation`, `testMutation`, `disconnectMutation`, `resolveConflictMutation` — each with its own `onSuccess`/`onError`, feeding into local `useState` banners (`successBanner`, `errorBanner`, `syncResult`, `testResult`) rendered as raw `role="alert"` divs at the top of the page, NOT StateBlock (these are transient action-result banners, not data-fetch states — likely stay as local-state banners, just v2-token-ified).
  - `statusQuery` ALREADY has all three states wired, just as raw markup instead of `StateBlock`/shared `Skeleton`: loading → raw `animate-pulse` bars (line ~457-461); error → raw `<div>` with an inline `<button onClick={() => statusQuery.refetch()}>Retry</button>` (line ~465-473, **`refetch` already used**, no destructuring change needed since `statusQuery` is kept as a query object, not destructured); the "disconnected" state itself is the CONNECT FORM, not an "empty" state in the StateBlock sense — **do not StateBlock-empty-gate the connect form**, it's a real, primary application state (parallel to Opera Integration having no conceptual "no data" case — connected vs. disconnected are both meaningful, fully-rendered UI states).
  - `conflictsQuery`'s data (`conflictsQuery.data?.length`) is rendered conditionally (only shown when `> 0`) with no explicit loading/error UI of its own today — a real gap, though minor (conflicts are a secondary panel within the already-connected view).
  - A `ConfirmDisconnectDialog` local component (referenced near line 500, not fully read) takes a `loading` prop from `disconnectMutation.isPending`.
- Recommended: add `isSectionRedesigned('integrations', hotel)`, replace the raw skeleton bars with the shared `Skeleton` component and the raw error+retry div with `StateBlock status="error"` (still calling the same `statusQuery.refetch()`), v2-token-ify banners/buttons, and decide (planner's call) whether `conflictsQuery` gets its own small loading/error treatment given it's real but secondary.

### AI Copilot (`app/(dashboard)/ai/page.tsx`, 492 lines)
- Chat-UI shape, fundamentally different from the other 9 sections — confirmed CONTEXT's framing that `ConfirmView`, `TaskConfirmView`, `AiMessage`, `CreditUsageCard` are ALL local function components defined inline in this one file (no separate component files exist for any of them — verified via `find`).
- `PageHeader` already used (`eyebrow="Intelligence" title="Copilot"`).
- `CreditUsageCard` (line 204): `useQuery({ queryKey: ['ai-risk-alerts'], queryFn: () => aiApi.getRiskAlerts().then(r => r.data), refetchInterval: 60_000 })` — **destructures ONLY `{ data }`, no `isLoading`/`isError` at all.** Its rendered value is **hardcoded** (`$0.00` credit spend, `0%` of cap) regardless of what `data` contains — only the "X AI queries" count line actually reads `data`. This is a pre-existing incompleteness/stub, NOT something to "fix" under zero-behavior-change — but it IS a legitimate skeleton/error target (the query itself can fail or be pending) if the planner chooses to give this card its own loading/error treatment; flag for the planner rather than assume.
- Main chat flow: `messages` is local React state (not server data) persisted to `localStorage` per-user-per-day; `sendMessage()` catches API errors and turns them into an AI-role chat bubble (`addAiMsg(err instanceof ApiClientError ? err.message : 'Something went wrong...')`) — this is a deliberate, existing UX pattern (errors become conversation, not a page-level StateBlock) and must be preserved unchanged.
- A typing/loading indicator already exists (`loading &&` block ~line 397) using three `motion-safe:animate-bounce` dots with `bg-ai` (a CSS-var-backed utility class) and staggered `[animation-delay:Nms]` — already respects `prefers-reduced-motion` and already token-styled; likely needs only `duration-fast`/`ease-standard` token additions if any transition classes on its container are still hardcoded.
- `ConfirmView`/`TaskConfirmView` use `Button`'s own `loading` prop (already a frozen, universal, presumably-v2-ready primitive) for their "Confirm & Create" saving state — no bespoke loading UI to redesign there.
- Recommended: this section's "loading/empty/error" scope is narrower and different in kind from the other 9 — focus on (a) `isSectionRedesigned('aiCopilot', hotel)` flag + v2-token-ify the chat shell/composer chrome, (b) decide whether/how to give `CreditUsageCard`'s query a real loading/error state (currently none), (c) confirm the typing indicator and confirm-view components don't need behavior changes, just token additions.

### Notifications (`components/shared/Header.tsx`, piggybacks on `shell` flag)
- The `redesigned` prop (already threaded in from `DashboardShell.tsx` sourced off the `shell` flag) already gates chrome details throughout Header.tsx (`focus-visible:ring-[var(--focus-ring)]`, `duration-fast` transitions) — CONFIRMED this prop exists and is already wired for other parts of the header.
- **The notification dropdown content itself has NO loading/error state at all today.** Two `useQuery` calls: `unreadNotificationsData` query (`queryKey: ['notifications','unread']`, `refetchInterval: 60_000`) destructures ONLY `{ data }`; `notificationsData` query (`queryKey: ['notifications', notificationsTab]`) also destructures ONLY `{ data }`. Neither has `isLoading`/`isError`/`refetch` in scope anywhere in the file.
- The dropdown's "empty" case IS already handled and already i18n'd: `notifications.length === 0 ? <p>{t('header.noNotifications')}</p> : notifications.map(...)`.
- CONTEXT's note that `header.notifications*` is "already partially i18n'd" is confirmed: `header.notifications`, `header.notificationsUnread`, `header.notificationsAll`, `header.markAllRead`, `header.noNotifications` all already exist and are already used with `t()`.
- Recommended: extend the `notificationsData` query's destructuring to add `isLoading`/`isError`/`refetch`, add a shared-`Skeleton`-based loading state and a `StateBlock`/inline error+retry inside the dropdown's `max-h-[360px] overflow-y-auto` content area, gated by the existing `redesigned` prop — this is a small, surgical addition, not a rewrite.

### Late Checkout (`components/dashboard/FrontDeskDashboard.tsx`, piggybacks on `dashboard` flag)
- **CONFIRMED: CONTEXT's claim that this is already essentially complete.** The `dashboard`-flag-gated `v2` branch (line ~172 `const v2 = isSectionRedesigned('dashboard', hotel)`) already has, for the late-checkout panel specifically:
  - Query: `const { data: lateCheckoutsData, isLoading: lateCheckoutsLoading, isError: lateCheckoutsIsError, refetch: refetchLateCheckouts } = useQuery({ queryKey: [...], queryFn: () => lateCheckoutApi.list({ status: 'pending' }) })` — **already fully destructured including `refetch`.**
  - Loading: `[...Array(2)].map((_, i) => <SkeletonRow key={i} v2 />)` — a local `SkeletonRow` component (line 121) that already accepts a `v2` boolean prop and switches between legacy (`rounded-lg`) and v2 (`rounded-[var(--r-md)]`) styling — this is the exact "de-shadow the legacy skeleton, add a v2 variant" pattern CONTEXT describes, already built.
  - Error: `<StateBlock status="error" error={{ message: t('common.error'), onRetry: () => refetchLateCheckouts() }} />` — already using the shared `StateBlock` and already i18n'd via `common.error`.
  - Empty: `<StateBlock status="empty" empty={{ title: t('dashboard.empty.frontDeskNoLateCheckouts') }} />` — already using `StateBlock` and already i18n'd via the existing `dashboard.empty.*` namespace.
  - A `LateCheckoutRow` component (line 53) accepts a `v2` prop too, with `resolving` prop for the approve/deny in-flight state — CONTEXT asks to "confirm approve/deny/resolving states are covered"; this component exists and takes the right props, but the exact approve/deny button disabled/loading treatment during `resolving` was not read in full in this research pass and should be spot-checked by the executing plan (grep `resolving` usage inside `LateCheckoutRow`'s JSX body).
- Recommended: this is primarily a VERIFICATION task (confirm approve/deny mutation loading states render correctly, confirm no i18n gaps in the panel), not new construction — matches CONTEXT's framing exactly. Low risk to fold into wave-3 close-out rather than a dedicated wave-2 plan, given how little appears to be missing.

## Shared Infrastructure (already built, consume as-is)

| Component/util | Path | Notes |
|---|---|---|
| `isSectionRedesigned(sectionKey, hotel)` | `apps/web/lib/utils/redesignFlag.ts` | `hotel?.web_redesign_sections?.includes(sectionKey) ?? false`. `Hotel.web_redesign_sections?: string[]` on `stores/hotelStore.ts`. |
| `RedesignGate` | `apps/web/components/shared/RedesignGate.tsx` | Optional ternary wrapper `<RedesignGate section="x" v2={...} legacy={...}/>` — not used by any existing section (they all use inline `v2 ? ... : ...` instead), available if a plan prefers it. |
| `StateBlock` | `apps/web/components/ui/StateBlock.tsx` | `status: 'loading'\|'empty'\|'error'\|null`. `loading` renders a `Loader2` **spinner** (NOT a skeleton) — per CONTEXT, do not use `status="loading"` for the v2 loading state; only use `status="error"`/`status="empty"`. |
| `EmptyState` | `apps/web/components/ui/EmptyState.tsx` | `{ icon?, title, body?, action?, className? }` — used directly (not via StateBlock) in several places already (Staff Perf tab, AI Usage tab, Feedback page passes it through StateBlock's `empty` prop). |
| `Skeleton` | `apps/web/components/ui/Skeleton.tsx` | `variant: 'text'\|'card'\|'room-card'\|'circle'`, `bg-surface-3 animate-pulse` + `after:shimmer`. This is the shared component CONTEXT wants used (or a locally-wrapped equivalent) instead of each section's bespoke `animate-pulse` div. |
| `PageHeader` | `apps/web/components/shared/PageHeader.tsx` | Has an existing `dataI18nSkip` prop (page-level + per-tab) — an escape hatch for the recurring `domTranslations.ts` bug (see Pitfalls). |
| `Button.tsx`, `primitives.tsx` (`Stat`, `Pill`, `SectionLabel`, `AILabel`, `Mono`, `Bar`) | `apps/web/components/ui/` | **FROZEN** (sha256-hashed in `frozen-files.json`) — consume only, never edit. |

## Standing Gate Scripts (all run from `apps/web`)

| Command | What it checks | Relevance to Phase 34 |
|---|---|---|
| `npm run type-check` | `tsc --noEmit` | Standard. |
| `npm run check:frozen-files` | `scripts/check-frozen-files.mjs` — sha256 of `Button.tsx`, `primitives.tsx`, `RoomCard.tsx`, `LogFoundItemModal.tsx`, `RoomStatusBoard.tsx`, `RoomDetailDrawer.tsx`, `EngineeringRoomBoard.tsx` (must be byte-identical or allowlisted in `frozen-files-allowlist.json`, currently `entries: []`) + hard-frozen room-status CSS-var/tailwind values (no allowlist escape). Phase 34 should never touch any of these 7 files. |
| `npm run check:contrast` | `scripts/check-contrast.mjs` — WCAG AA on 5 ENFORCED new-token pairings (`--brand-ink`/`--brand`, `--ink`/`--ink-2` on `--surface-raised`/`--surface-overlay`) in both light/dark, parsed live from `globals.css`; room-status pairings are REPORT-ONLY (never fail). Writes `.planning/phases/30-.../CONTRAST.md`. Phase 34 doesn't need new tokens, so this should pass trivially unless a plan invents a new CSS var. |
| `npm run check:i18n-parity` | `scripts/check-i18n-parity.mjs` — TS-compiler-API flatten of `en.ts`/`es.ts` into dot-path key sets, diffs them. **Only proves key symmetry — does NOT prove a JSX literal was actually converted to `t()`.** |
| `npm run verify:i18n-gate` | `scripts/verify-i18n-gate.mjs` — self-test that ESLint's `i18next/no-literal-string` rule (see below) actually fires on floor-facing paths and stays exempt on `app/(dashboard)/reports/**`. Does not scan Phase-34 files itself. |
| `npm run build` | `next build` | Standard full build. |
| (no script — plain `npm run lint`) | `eslint.config.mjs`'s `i18next/no-literal-string` rule, scoped ONLY to `components/{housekeeping,engineering,programs}/**` + `app/(dashboard)/{housekeeping,engineering,tasks,programs}/**`, with `app/(dashboard)/reports/**`, `app/(dashboard)/billing/**`, `app/(dashboard)/settings/**` explicitly in its `ignores`. **None of Phase 34's 10 sections are inside this rule's scope at all** (Management ROI, Staff, AI, Header.tsx, FrontDeskDashboard.tsx were never in the `files` glob; Reports/Billing/Settings are explicitly excluded even though their neighbors are in-glob). This is a hard NEGATIVE finding — see Pitfalls. |

## Room-Board Regression Harness

- Config: `apps/web/playwright.regression.config.ts`. `testMatch: 'room-board-baseline.spec.ts'`, `globalSetup: './e2e/global-setup.ts'`, `maxDiffPixelRatio: 0` (byte-exact), `baseURL` defaults to `https://patelrep-production-0ad1.up.railway.app` (env override via `PLAYWRIGHT_BASE_URL`) but **as of Phase 33's close-out this hardcoded default URL was already dead (404)** because the local tree was ahead of `origin/main` (never pushed) — 33-07 worked around this by building and running a LOCAL standalone production build (`npm run build` + `.next/standalone` + a temporary, fully-reverted CSP-localhost patch to `next.config.mjs`) and pointing `PLAYWRIGHT_BASE_URL` at it. **Re-check this at Phase 34 execution time** — if the tree is still unpushed/ahead, repeat the same local-standalone-build workaround; if it's since been deployed, the default URL may work again.
- Invocation: `npx playwright test --config=playwright.regression.config.ts` (from `apps/web`).
- Flag flip for flag-ON regression run: **no Supabase MCP write access** in this environment — 33-07 used **direct Supabase service-role access** via `apps/api/.env`'s `SUPABASE_SERVICE_ROLE_KEY` (functionally equivalent to MCP) to flip the regression-fixture tenant's `web_redesign_sections` array, ran the harness, then **restored the fixture back to its permanent `[]` baseline** afterward. Same approach expected for Phase 34's wave-3 close-out.
- Protects exactly 2 real boards at true zero-drift (`RoomStatusBoard`, `EngineeringRoomBoard`); `RoomDetailDrawer` has a known, pre-existing, deterministic 3-pixel/0.01% sub-pixel font-AA diff on a frozen label, documented as expected noise by 32-06/33-07 — not a regression if it recurs identically.
- Fixture seeding script: `apps/web/e2e/fixtures/seed-regression-tenant.mjs` (`npm run seed:regression-fixture`) — exists, not read in depth this pass; only relevant if the fixture tenant needs re-seeding from scratch (unlikely — 33-07 reused the existing fixture).

## Common Pitfalls

### Pitfall 1: `domTranslations.ts` mangles brand-new compound-phrase i18next strings (bug-962, bug-963 — WILL likely recur in Phase 34)
**What goes wrong:** A page's `PageHeader` `title`/`subtitle`/tab `label` renders as a garbled EN/ES hybrid in Spanish locale even though the underlying `es.ts` value is 100% correct.
**Why it happens:** `apps/web/i18n/domTranslations.ts` is a legacy, page-wide `MutationObserver`-based DOM text translator that predates react-i18next. Its `getSourceText()` reverse-translates the CURRENT (already-correct) Spanish text back to a presumed English original via a flattened en/es reverse-map, then re-forward-translates that presumed original through a cruder word-level glossary regex before the observer re-processes a newly-mounted node. Exact-dictionary hits round-trip cleanly; brand-new COMPOUND phrases (anything not previously in the reverse-map, which by definition includes every string in Phase 34's 8 new namespaces) only partially match word-level glossary regexes, producing a hybrid.
**How to avoid:** `PageHeader.tsx` already has an additive, default-off `dataI18nSkip` prop (title/subtitle) and a per-`Tab` `dataI18nSkip` field, purpose-built for this exact bug by the bug-963 fix. Proactively set `dataI18nSkip={v2}` (or `true` where the whole header only renders in the v2 branch) on every new/changed `PageHeader` call site in Phase 34 rather than waiting to discover the mangling live in wave-3 close-out — CONTEXT itself flags this as "should be anticipated and specifically checked for."
**Warning signs:** A Spanish-locale page renders a title/subtitle/tab that's PART Spanish, part English (e.g. "Active Solicitudes" instead of "Solicitudes Activas") despite `check-i18n-parity` passing green (parity only proves the KEY exists in both files with SOME value, not that the DOM renders it uncorrupted).

### Pitfall 2: No automated i18n-literal-string gate covers any Phase-34 file
**What goes wrong:** A hardcoded English string ships inside a "v2" branch and nothing in CI catches it.
**Why it happens:** `eslint.config.mjs`'s `i18next/no-literal-string` rule only scopes to `components/{housekeeping,engineering,programs}/**` and `app/(dashboard)/{housekeeping,engineering,tasks,programs}/**`, with `reports/**`, `billing/**`, `settings/**` explicitly excluded even within that scope (D-03 GM/admin carve-out) — and Management ROI, Staff, AI, `Header.tsx`, `FrontDeskDashboard.tsx` were never inside the glob to begin with.
**How to avoid:** Treat manual `grep` for raw JSX text (title=/message=/subtitle=/aria-label= object-literal props and `>raw text<` between tags) inside each touched loading/empty/error region as a REQUIRED verify step per content plan (mirroring 33-01's approach of reading the actual current strings before keying them), and rely on live browser EN+ES verification at wave-3 close-out — do not assume `npm run lint`/`check:i18n-parity` passing means i18n coverage is complete for these files.
**Warning signs:** `npm run lint` and `check:i18n-parity` both green, but a live EN/ES toggle in the browser still shows English text somewhere in a "v2" region.

### Pitfall 3: Reports' 5 tabs need a destructuring change to get `refetch`; Management ROI's 9 queries don't
**What goes wrong:** A plan assumes uniform "just add `refetch` to the destructuring" across every section and either breaks Management ROI's existing `.data`/`.isLoading`/`.isError` dot-notation style unnecessarily, or forgets Reports actually needs the destructuring extended.
**Why it happens:** Reports' 5 tabs destructure `{ data, isLoading, isError }` (no `refetch` in scope) — needs to become `{ data, isLoading, isError, refetch }`. Management ROI keeps all 9 queries as named objects (`xQuery.data`, `.isLoading`, `.isError`) — `.refetch()` is already trivially callable with ZERO destructuring change. Staff/Billing mix both styles across different queries in the same file.
**How to avoid:** Check each query's actual current destructuring shape (documented per-section above) before writing the "wire onRetry" task step; don't write a blanket "add refetch to the destructuring" instruction that doesn't apply everywhere.

### Pitfall 4: Some "empty" states aren't StateBlock-empty candidates at all
**What goes wrong:** A plan tries to wrap Opera Integration's "disconnected" state (the connect form) in `StateBlock status="empty"`, semantically miscasting a real, primary application state as an empty-data placeholder.
**Why it happens:** StateBlock's `empty` status is designed for "the query succeeded but returned zero rows" (e.g. Staff's "no staff match filters"). Opera Integration's disconnected/connect-form view is not that — it's a fully-featured, always-present alternate UI state driven by `operaStatus.connected === false`, semantically parallel to a login form, not a "no results" placeholder. Similarly, AI Copilot has no meaningful "empty" state at the page level at all (a fresh chat with just the greeting message is not "empty data").
**How to avoid:** Reserve `StateBlock status="empty"` strictly for genuine no-data-returned cases (Staff's filtered table, Guest Feedback's zero-submissions case, Management ROI's all-metrics-are-zero case) — for connected/disconnected-style state machines (Opera Integration) or chat UIs (AI Copilot), style the existing branch/view directly under the `v2` flag instead of forcing it through StateBlock's three-state model.

### Pitfall 5: `frozen-files.json` and `primitives.tsx`/`Button.tsx` are consumed, not edited, across nearly every section
**What goes wrong:** A plan edits `Stat`, `Pill`, `SectionLabel`, or `Button` to add a v2-specific variant, tripping `check:frozen-files`.
**Why it happens:** Management ROI imports `Stat`/`Pill` from `components/ui/primitives.tsx` (frozen); Staff imports `Button`/`IconButton` from `components/ui/Button.tsx` (frozen); AI Copilot imports `AILabel`/`Mono`/`SectionLabel`/`Bar`/`Pill` from `primitives.tsx` too.
**How to avoid:** Any new v2 visual treatment for these primitives' call sites must be achieved via `className` overrides/wrapper elements at the CALL SITE, never by editing the frozen files themselves.

## Sources

### Primary (HIGH confidence — direct file reads this session, current repo state as of 2026-08-18)
- `apps/web/app/(dashboard)/reports/page.tsx` (full read, 770 lines)
- `apps/web/app/(dashboard)/management-roi/page.tsx` (full read, 489 lines)
- `apps/web/app/(dashboard)/staff/page.tsx` (targeted reads: imports/schema/1-120, 452-600, 680-980)
- `apps/web/app/(dashboard)/settings/general/page.tsx` (full read, 320 lines)
- `apps/web/app/(dashboard)/settings/billing/page.tsx` (targeted read: 95-225)
- `apps/web/app/(dashboard)/settings/feedback/page.tsx` (full read, 101 lines)
- `apps/web/app/(dashboard)/settings/integrations/page.tsx` (targeted reads: 100-320, 440-508)
- `apps/web/app/(dashboard)/ai/page.tsx` (targeted reads: 1-60, 195-355)
- `apps/web/components/shared/Header.tsx` (targeted reads: 1-50, 240-310)
- `apps/web/components/dashboard/FrontDeskDashboard.tsx` (grep + targeted confirmation of existing v2 branch)
- `apps/web/eslint.config.mjs` (full read — confirms D-03/D-04 scope exclusions)
- `apps/web/scripts/check-frozen-files.mjs`, `check-contrast.mjs`, `check-i18n-parity.mjs`, `verify-i18n-gate.mjs` (all full reads)
- `apps/web/frozen-files.json` (full read)
- `apps/web/playwright.regression.config.ts` (full read)
- `apps/web/lib/utils/redesignFlag.ts`, `components/shared/RedesignGate.tsx`, `components/ui/StateBlock.tsx`, `components/ui/EmptyState.tsx`, `components/ui/Skeleton.tsx`, `components/shared/PageHeader.tsx` (all full reads)
- `apps/web/i18n/locales/en.ts` top-level namespace enumeration (via TS compiler API, confirms absent namespaces)
- `.planning/phases/33-core-operational-sections/33-01-PLAN.md`, `33-05-PLAN.md`, `33-07-PLAN.md` (full reads — wave shape, i18n-foundation precedent, Pattern 2, close-out precedent)
- `.wolf/buglog.json` bug-962/bug-963 entries (full read — domTranslations.ts mechanism and fix)
- `.planning/phases/33-core-operational-sections/33-07-SUMMARY.md` (grep — regression-harness local-standalone-build workaround, Supabase service-role flag-flip approach)
- `.planning/STATE.md` (grep — phase 32/33 close-out precedent references)

### Secondary / Tertiary
None — this phase required no external library research; all findings are from direct repo inspection.

## Metadata

**Confidence breakdown:**
- Standard stack / architecture patterns: HIGH — this is pure internal-pattern replication of Phase 33's proven shape; no new libraries or patterns are introduced.
- Per-section current-state findings (query shapes, existing StateBlock/skeleton usage, exact gaps): HIGH — every claim is from a direct, current-session file read of this exact repo, not inference or training-data recall.
- Room-Board regression harness live-runnability (dead default URL, need for local-standalone-build workaround): MEDIUM — confirmed true as of Phase 33's close-out (2026-08-18), but git-ahead-of-origin status may have changed by Phase 34's execution time; re-verify at execution rather than assuming.
- Recurrence of the `domTranslations.ts` mangling bug in Phase 34: MEDIUM-HIGH — not yet observed in THIS phase (can't be, code doesn't exist yet), but it has now recurred in both of the two prior phases (32, 33) that added brand-new i18next namespaces with compound-phrase title/subtitle copy, which is exactly what Phase 34's 8 new namespaces will also do.

**Research date:** 2026-08-18
**Valid until:** Should stay valid through Phase 34's execution (this is an internal-pattern-replication phase with no external dependency drift risk) — re-verify only the two MEDIUM-confidence items above (regression harness URL reachability, and directly re-confirm current per-file states if execution is delayed and other phases touch these files first).

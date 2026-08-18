# Phase 35: Engineering Section Chrome - Research

**Researched:** 2026-08-18
**Domain:** Next.js 14 App Router page-chrome redesign around a frozen pixel-regression-protected component, within an established 5-phase (30-34) v2 token/pattern system
**Confidence:** HIGH (all findings from direct file reads of this repo; no external library research required — this phase is 100% internal-convention-following work)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Flag key:** One new flag, `engineering` (camelCase, matches existing `tasks`/`sop`/`safety`/.../`integrations`/`aiCopilot` convention — confirmed unused/unregistered anywhere in production code today, only appears as a negative-case string in `redesignFlag.test.mjs`). Unlike Phase 34's Settings sub-pages (which each got their own flag because they're independently-scoped SEC-01b items), Engineering is ONE requirement (ENG-01) covering all 4 pages as a single section — so all 4 pages read `isSectionRedesigned('engineering', hotel)` under the SAME flag, consistent with how Reports' 5 tabs shared one `reports` flag in Phase 34's 34-02.

**No shared layout.tsx — thread the flag per page:** Confirmed (scout): there is no `engineering/layout.tsx` (unlike `settings/layout.tsx`). Each of the 4 pages (`work-orders/page.tsx` 522 LOC, `assets/page.tsx` 1120 LOC, `pm-schedules/page.tsx` 967 LOC, `predictions/page.tsx` 849 LOC) already independently imports and renders its own `PageHeader`. Decision: each page reads the `engineering` flag itself (no new layout file introduced) and applies v2 treatment to its own `PageHeader`/chrome/states — same "read once, thread via ternary/early-return" pattern used throughout Phase 32-34, just applied 4 times instead of via one shared shell.

**EngineeringRoomBoard — chrome only, zero internal changes:** `EngineeringRoomBoard` renders only inside `work-orders/page.tsx`, as one of 3 tabs (`work-orders` / `room-board` / `archived`) on that single page, rendered completely bare (`{activeTab === 'room-board' ? <EngineeringRoomBoard /> : ...}`, no wrapping card/div today). It is content-hash-frozen in `apps/web/frozen-files.json` (`EngineeringRoomBoard.tsx`) — same class of file as Phase 30's other 3 frozen Room-Board files. Decision:
- The `PageHeader`/tab-bar chrome ABOVE `EngineeringRoomBoard` can be freely restyled with v2 tokens.
- `<EngineeringRoomBoard />` itself is NOT touched, NOT wrapped in a new StateBlock/Skeleton (it manages its own loading/empty/error internally, using its own already-i18n'd `engineering.roomBoard.*` keys — confirmed pre-existing), and its frozen hash must not change.
- The Room-Board pixel-regression harness (established Phase 30, re-run every close-out since) is the load-bearing safety net here — wave 3 close-out MUST re-run it, same as every prior phase, with extra attention since this phase's chrome sits directly adjacent to the frozen component for the first time (Phase 32-34 never rendered a frozen board on the same page).

**Loading/empty/error pattern (identical established convention):**
- None of the 4 pages currently use the shared `StateBlock`/`Skeleton`/`EmptyState` primitives — all use bespoke hand-rolled `animate-pulse` divs and inline `AlertTriangle`+retry blocks. Convert these to the shared primitives, same skeleton-not-spinner convention as Phase 32-34.
- Predictions page currently has NO explicit error UI (no `isError` destructured) — this is a genuine gap, add one wired to that query's own `refetch()`, not a new query (same "extend destructuring, wire onRetry to existing refetch" pattern as every prior phase).
- Work-orders' `room-board` tab is explicitly OUT of this treatment (see above — EngineeringRoomBoard owns its own states). The `work-orders` and `archived` tabs on that same page ARE in scope for the shared-primitive conversion.
- Modals (`CreateWorkOrderModal`, `BulkArchiveModal`, `WorkOrderDetailDrawer`, the inline assets create/edit modal, `PMCompletionModal`) get the same "close a genuine gap only, don't do a ground-up rewrite" treatment Phase 34 applied to Staff's 4 modals — visual v2-token polish plus fixing any modal-level query with literally no loading/error UI today; full redesign of every modal's internals is not required by this phase's goal (which names "PageHeader, tabs, and the ... pages," not modals specifically).

**i18n:**
- `engineering` namespace already exists and is substantial (`workOrderCard`, `workOrderDetail`, `createWorkOrder`, `workOrderList`, `roomBoard`, `failurePrediction`, `assetsPage`, `predictionsPage`, `workOrdersPage`) in both `en.ts`/`es.ts`, line-aligned (~357 lines, starting ~line 973) — confirming existing parity discipline. This phase EXTENDS it additively (new loading/empty/error copy for the now-shared-primitive states) rather than creating it fresh, unlike every Phase 34 section.
- **Naming inconsistency confirmed, decision made:** `pm-schedules/page.tsx` does NOT use an `engineering.pmSchedulesPage.*` namespace — it reuses a pre-existing `programs.pmSchedules.*` namespace (also line-aligned in both locale files) built for a Programs-section PM view. Decision: **keep reusing `programs.pmSchedules.*` for existing copy** (title, existing labels) — do NOT migrate/rename into a new `engineering.pmSchedulesPage.*` namespace. Only genuinely NEW copy this phase introduces for the pm-schedules page's states (if `programs.pmSchedules.*` doesn't already have a matching key) gets added under `programs.pmSchedules.*` additively.
- Every new empty/error/loading string introduced in this phase (for work-orders/archived-tab, assets, predictions) goes under the existing `engineering.*` namespace's relevant sub-key (extend `workOrdersPage`, `assetsPage`, `predictionsPage`) — single wave-1-owner-of-locale-files pattern from Phase 33/34 applies again: one plan is sole editor of `en.ts`/`es.ts` for this phase, all content plans consume read-only.

**Frozen/careful files:**
- `apps/web/components/engineering/EngineeringRoomBoard.tsx` — frozen (content-hash), zero changes, confirmed via `apps/web/frozen-files.json`.
- `RoomCard.tsx`/`RoomDetailDrawer.tsx` (used inside `EngineeringRoomBoard`) — also frozen from Phase 30, not directly touched by this phase but transitively relevant: any global token/theme change this phase might be tempted to make must not alter the CSS custom properties these components read (`--alert`/`--info`/`--ready`/etc. room-status colors), or the Room-Board pixel-diff harness fails.
- `WorkOrderDetailDrawer.tsx`, `CreateWorkOrderModal.tsx`, `BulkArchiveModal.tsx`, `PMCompletionModal.tsx`, `FailurePredictionSidebar.tsx` — not frozen, but treat with the same "touch only to close a genuine gap, don't rewrite" discipline as Phase 34's Staff modals.

**RBAC — zero behavior change:**
- Web-route gate (`ROLE_ROUTE_RULES`, `routeGuard.ts`): `/engineering` prefix allows `gm`/`engineer`/`chief_engineer`/`housekeeping_supervisor`, but `engineer` is also in `MOBILE_ONLY_ROLES` and is redirected off all non-public web routes before that rule is even consulted — so in practice only `gm`/`chief_engineer`/`housekeeping_supervisor` reach these pages on web today. Pre-existing, out of scope.
- Each page has its own local `isEngineer`/`canManage`/`canEdit` boolean (via `useRole()`) gating action-button visibility (Create/Archive/AI-Triage/Add). These per-page role checks are preserved EXACTLY — v2 treatment restyles the buttons/chrome, never changes which role sees which action.
- The `engineer` role's dead-on-web `isEngineer` checks are NOT to be "cleaned up" or removed by this phase.

**Sidebar tab navigation — out of scope:** Switching between work-orders/assets/pm-schedules/predictions happens via the Phase-31-redesigned sidebar `subNav`, NOT a `PageHeader` tabs prop (only `work-orders` itself uses `tabs`, for its own internal 3-way work-orders/room-board/archived split). Out of this phase's boundary. `MobileFloorNav.tsx` gap (assets/pm-schedules/predictions absent) is a deferred idea, not this phase's job.

### Claude's Discretion

- Exact plan/wave shape — left to gsd-planner. Given each of the 4 pages is independently substantial (500-1120 LOC) and none share a file, a natural shape mirrors Phase 34: wave 1 = i18n-foundation plan (extends `engineering.*`/`programs.pmSchedules.*` additively, sole owner of both locale files for this phase), wave 2 = up to 4 parallel content plans (one per page, or grouped by effort if some pages are small enough to bundle), wave 3 = close-out verification with EXTRA emphasis on the Room-Board regression re-pass given this phase renders chrome directly adjacent to the frozen board for the first time.
- Whether work-orders' 3-tab restyle (tab bar itself, not the room-board tab's content) is its own plan or bundled with the rest of work-orders' redesign — planner's call.
- Exact new i18n key names for the states being converted from bespoke markup to shared primitives — planner/implementer's call, following the existing `engineering.<page>Page.*` sub-key convention already established for 3 of the 4 pages.

### Deferred Ideas (OUT OF SCOPE)

- `MobileFloorNav.tsx`'s missing subNav entries for assets/pm-schedules/predictions (only work-orders present) — belongs to nav/mobile-shell work, not this chrome phase.
- Migrating `pm-schedules/page.tsx`'s copy from `programs.pmSchedules.*` into a new `engineering.pmSchedulesPage.*` namespace for naming consistency — deliberately not done this phase.
- Full ground-up redesign of Engineering's modals beyond gap-closing — out of this phase's boundary.
- bug-965 (from Phase 34's 34-08 close-out): `StateBlock` error messages are systemically vulnerable to the same `domTranslations.ts` EN/ES mangling as `PageHeader` — flagged for a dedicated future hardening phase, NOT this phase's job to fix app-wide, but this phase's own NEW `StateBlock` error usages should proactively apply whatever mitigation the future phase settles on if it lands first, or at minimum get live EN/ES verified at close-out.
</user_constraints>

## Summary

Phase 35 is a pure internal-convention-application phase: no new library, no new component primitive, no new visual system — it applies the exact `isSectionRedesigned('engineering', hotel)` flag-threading pattern, `StateBlock`/`Skeleton`/`EmptyState` shared-primitive conversion, and `PageHeader` v2-token restyle that Phases 32-34 already applied to 15+ other pages, to the 4 Engineering pages. The one genuinely novel risk in this phase — not present in any prior phase — is that this is the **first** phase where a v2-restyled `PageHeader`/tab-bar sits in the same full-page screenshot as a frozen, pixel-diff-protected component (`EngineeringRoomBoard`, captured via the Phase-30 regression harness at `/engineering/work-orders`, "Room Board" tab). The harness's `chromeMasks()` function currently masks only the Sidebar/Header shell landmarks (added in Phase 31) — it does NOT mask the in-page `PageHeader`/tab-bar region above `EngineeringRoomBoard`, because no prior phase has ever changed that region's pixels within a regression-covered screenshot (Housekeeping's `PageHeader` on `/housekeeping`, also unmasked in that harness, has simply never been touched by any phase 30-34 — Housekeeping chrome is Phase 36, not yet run). This means Phase 35's intentional, in-scope `PageHeader`/tab-bar restyle on `/engineering/work-orders` **will produce a nonzero pixel diff against the existing baseline** unless the close-out plan extends the harness's mask list (or otherwise scopes the diff) to exclude the newly-restyled chrome region — this is not optional cleanup, it is required for the close-out plan's own stated "Room-Board pixel-diff against the Phase-30 baseline must pass" success criterion to be achievable at all.

The second major finding is that error-state coverage across these 4 pages + their sub-components is much thinner than CONTEXT.md's summary suggested: it's not just Predictions that lacks `isError`. `work-orders/page.tsx`'s 5 parallel Kanban queries (open/escalated/in_progress/on_hold/completed) destructure `isLoading` only — zero `isError` anywhere in that 522-line file. `ArchivedWorkOrdersPanel.tsx` (rendered as the work-orders page's "Archived" tab, explicitly in scope) also destructures `isLoading` only. `FailurePredictionSidebar.tsx` and `WorkOrderDetailDrawer.tsx`'s main detail query likewise lack `isError`. Assets and PM-Schedules are the only two pages that already have `isError` wired (via a bespoke inline `AlertTriangle` block, retried via `queryClient.invalidateQueries`, not `.refetch()`). The planner should budget explicit tasks for adding `isError`/`refetch` destructuring — not just converting markup — to work-orders' 5 queries, `ArchivedWorkOrdersPanel`, and `predictions/page.tsx`.

**Primary recommendation:** Wave 1 = single i18n-foundation plan (sole editor of `en.ts`/`es.ts`, extends `engineering.workOrdersPage.*`/`assetsPage.*`/`predictionsPage.*` + `programs.pmSchedules.*` additively — assets and pm-schedules likely need zero or near-zero new keys since `loadError`/`retry`/`failedToLoad`/`noSchedules` already exist). Wave 2 = up to 4 parallel content plans, one per page/file-tree (work-orders touches `work-orders/page.tsx` + `ArchivedWorkOrdersPanel.tsx` + `FailurePredictionSidebar.tsx` + `WorkOrderDetailDrawer.tsx` + `CreateWorkOrderModal.tsx` + `BulkArchiveModal.tsx`; assets/pm-schedules/predictions are each single-file). Wave 3 = close-out verification, with an explicit extra task to inspect and (if needed) extend `apps/web/e2e/room-board-baseline.spec.ts`'s `chromeMasks()` before trusting a "pass" on the `EngineeringRoomBoard` regression test.

## Architecture Patterns

### Established flag-threading pattern (verbatim, reuse exactly)

```typescript
// Source: apps/web/app/(dashboard)/programs/page.tsx:31-32 (existing Phase-33 usage)
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'

const hotel = useHotelStore((s) => s.hotel)
const v2 = isSectionRedesigned('engineering', hotel)
```

```typescript
// apps/web/lib/utils/redesignFlag.ts — the flag function itself, unchanged by this phase
export function isSectionRedesigned(sectionKey: string, hotel: Hotel | null | undefined): boolean {
  return hotel?.web_redesign_sections?.includes(sectionKey) ?? false
}
```

Apply this once per page (4 times total — work-orders, assets, pm-schedules, predictions), matching the "no shared layout.tsx" decision. `redesignFlag.test.mjs` already has a negative-case assertion using `'engineering'` as a section key (`assert.equal(isSectionRedesigned('engineering', { web_redesign_sections: ['tasks'] }), false)` at line 14) — this is pre-existing test infrastructure, not something this phase needs to add, but confirms the key name is already anticipated.

### PageHeader component — shared, NOT frozen, has a known i18n footgun to avoid proactively

`apps/web/components/shared/PageHeader.tsx` (108 lines) takes `eyebrow`/`title`/`subtitle`/`meta`/`actions`/`tabs`/`className`/`dataI18nSkip`. All 4 Engineering pages already call it. Its `title`/`subtitle`/per-tab `label` render through `h1`/`p`/`span` elements that support an opt-in `data-i18n-skip="true"` attribute via the `dataI18nSkip` prop (page-level) and each `Tab`'s own `dataI18nSkip` field (per-tab override).

**This is directly relevant to bug-964 fixed in 34-08** (per the additional_context): a prior phase shipped new `PageHeader` title/subtitle content without `dataI18nSkip`, and the legacy `domTranslations.ts` DOM-text-translator mangled it because its word-level glossary has no whole-phrase entries for brand-new namespaces. Since `engineering.workOrdersPage.heading`/`assetsPage.heading`/`predictionsPage.heading` and `programs.pmSchedules.title` are **not new namespaces** (all pre-exist and are presumably already in the legacy translator's glossary, having shipped with the original un-redesigned pages), the risk is lower here than in a from-scratch section — but any genuinely NEW string this phase introduces into a `PageHeader` (e.g., a new tab label, if tab wording changes) should get `dataI18nSkip`/per-tab `dataI18nSkip` set proactively, and every `PageHeader` change should be spot-checked live in ES at close-out regardless.

`work-orders/page.tsx`'s existing `tabs` array (`work-orders`/`room-board`/`archived` — lines 389-393) does not currently set `dataI18nSkip` on any tab; it's an existing, not-new, i18n key set already presumably in the legacy glossary — verify live in ES rather than assume.

### Shared primitives — exact API, and the "skeleton not spinner" gotcha

```typescript
// apps/web/components/ui/StateBlock.tsx — status is 'loading' | 'empty' | 'error' | null
interface StateBlockProps {
  status?: 'loading' | 'empty' | 'error' | null
  loadingLabel?: string
  empty?: EmptyStateProps   // { icon?, title, body?, action? }
  error?: { message?: string; onRetry?: () => void }
  className?: string
  children?: ReactNode      // rendered when status is null/omitted
}
```

**Critical, non-obvious, repeatedly-confirmed-in-STATE.md pattern:** `StateBlock status="loading"` renders a spinning `Loader2` icon — but every closed Phase 32-34 plan explicitly avoided using it for loading states ("skeleton-not-spinner ... never a `StateBlock` spinner, per the locked decision" — verbatim from 32-02/32-03/32-04's STATE.md close-out entries). The actual convention is:
- **Loading state:** convert bespoke `animate-pulse` divs to the shared `Skeleton` component (`apps/web/components/ui/Skeleton.tsx`, variants `text`/`card`/`room-card`/`circle`) directly in page markup — do NOT wrap loading in `StateBlock status="loading"`.
- **Empty state:** use `StateBlock status="empty"` (which delegates to `EmptyState`) OR `EmptyState` directly, wired to existing/new `*.empty*`/`*.no*` keys.
- **Error state:** use `StateBlock status="error"`, wired to `error.message` (existing `loadError`/`failedToLoad` key) and `error.onRetry` (the query's existing retry mechanism — see below).

```typescript
// apps/web/components/ui/EmptyState.tsx
interface EmptyStateProps {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode   // accepts a full ReactNode — can hold custom buttons/links
}
```

**Rich empty-state content doesn't fit `EmptyState` cleanly.** Both `assets/page.tsx`'s (`emptyHeading`/`emptyHelp`/3 sample chips: HVAC/Laundry/Elevators) and `predictions/page.tsx`'s (`emptyHeading`/`emptyHelp`/"Go to Asset Register" link/`clearFilters` conditional/3 sample cards grid) empty states are considerably richer than `EmptyState`'s `icon`+`title`+`body`+single `action` shape. The planner should decide per-page whether to: (a) fold the richest content into the `action` slot as a custom `ReactNode`, or (b) keep the outer structure bespoke but swap only the icon-circle/title/body portion for `EmptyState`'s visual treatment, or (c) leave these two specific rich empty states bespoke (still valid — CONTEXT.md's mandate is "convert to shared primitives," but these two have materially more information architecture than the primitive's props accommodate). This is a genuine open question, not resolved by existing precedent (no prior phase hit an empty state this rich).

### Retry-callback wiring — two different existing patterns, preserve each as-is

- `assets/page.tsx` (line 928) and `pm-schedules/page.tsx` (line 665): retry via `() => queryClient.invalidateQueries({ queryKey: [...] })`.
- The established Phase 32-34 convention elsewhere in the codebase is `() => query.refetch()`.

Both are functionally equivalent as an `onRetry: () => void` callback for `StateBlock`'s `error` prop — no need to standardize one over the other; wire each page's existing retry mechanism into the new `StateBlock`, don't introduce a new one.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Loading skeleton rows/cards | New bespoke `animate-pulse` divs | `apps/web/components/ui/Skeleton.tsx` (`variant="text"\|"card"\|"room-card"\|"circle"`) | Already exists, already used site-wide since Phase 32; keeps shimmer/timing consistent |
| Empty-state layout | New icon-circle+title+body markup | `apps/web/components/ui/EmptyState.tsx` (or `StateBlock status="empty"`) | Same visual language as every other redesigned section |
| Error-state layout | New `AlertTriangle`+message+retry-button markup | `StateBlock status="error"` | Consistent AA-contrast-checked alert-soft/alert-line tokens, consistent retry button variant |
| Flag check | Any bespoke localStorage/props-drilling scheme | `isSectionRedesigned('engineering', hotel)` from `@/lib/utils/redesignFlag` + `useHotelStore` | Only implementation the CI flag test + every other section already relies on |

**Key insight:** every primitive this phase needs already exists and is already proven across 6+ prior phases (30-34) with zero library additions — this is strictly an application/wiring phase.

## Common Pitfalls

### Pitfall 1: Room-Board regression baseline will fail on an *intentional* chrome change unless masks are extended

**What goes wrong:** The Phase-30 regression harness (`apps/web/e2e/room-board-baseline.spec.ts`, run via `playwright.regression.config.ts`, `maxDiffPixelRatio: 0`) takes a **full-page** screenshot (`expect(page).toHaveScreenshot(...)`) of `/engineering/work-orders` after clicking the "Room Board" tab button — not a cropped screenshot of just the `EngineeringRoomBoard` component's bounding box. Its `chromeMasks()` helper (lines 57-77) currently masks only: the housekeeping date-nav span/buttons, the "Live · synced" badge text, `[title*="risk" i]` elements, and — since Phase 31 — the two shell landmarks `aside[aria-label="Main navigation"]` and `header`. It does **not** mask the in-page `PageHeader`/tab-bar region that sits directly above `EngineeringRoomBoard` on this exact route. Since this phase's own success criteria require restyling that `PageHeader`/tab-bar with v2 tokens, running the regression suite unmodified after implementation will show a nonzero pixel diff in that region — this is an *expected consequence of doing the phase correctly*, not a real regression, but it will look exactly like a failing gate unless anticipated.
**Why it happens:** No prior phase (31-34) ever changed pixels within any of the 3 baseline screenshots' capture area — Phase 31 changed Sidebar/Header (already masked), Phase 32-34 never touched `/housekeeping` or `/engineering/work-orders`'s in-page chrome.
**How to avoid:** The wave-3 close-out plan must, before trusting a pass/fail verdict from the regression suite: (1) inspect `chromeMasks()` and extend it with a stable selector covering the `PageHeader`+tab-bar region on `/engineering/work-orders` specifically (or a selector generic enough to reuse for Phase 36's Housekeeping chrome later) — e.g. add a `data-testid="page-header"` to the shared, non-frozen `PageHeader.tsx` (a one-line additive change, safe since it's not in `frozen-files.json`) and mask `page.locator('[data-testid="page-header"]')`; (2) after masking, re-run and confirm zero diff for the **content actually inside** `EngineeringRoomBoard` (the frozen component), not just that the test exits 0 — visually inspect the diff image if any residual mismatch appears. `apps/web/e2e/room-board-baseline.spec.ts` itself is NOT a frozen file (not listed in `frozen-files.json`), so editing its mask list is permitted.
**Warning signs:** `EngineeringRoomBoard — light/dark` test failures citing a diff percentage that visually (in the Playwright HTML report / diff image) is concentrated in the top portion of the page (where `PageHeader` renders) rather than inside the room-card grid — this is the "intentional chrome changed" signature, distinguishable from a real regression (diff inside the room cards themselves).

### Pitfall 2: Error-state gaps are broader than CONTEXT.md's summary implies — budget explicit tasks, don't assume "just predictions"

**What goes wrong:** Planning only a Predictions-page `isError` fix (as CONTEXT.md's discussion emphasized) under-scopes the work. Direct inspection found `isError` is **also absent** from: all 5 of `work-orders/page.tsx`'s parallel Kanban queries (`openQ`/`escalatedQ`/`progressQ`/`holdQ`/`completedQ` — none destructure it, only `.isLoading` is used per column), `ArchivedWorkOrdersPanel.tsx`'s single list query (`const { data, isLoading } = useQuery(...)`, no `isError`), `FailurePredictionSidebar.tsx`'s query, and `WorkOrderDetailDrawer.tsx`'s main detail-load query (`isLoading: detailLoading`/`refetch: refetchDetail` are destructured, but not `isError`).
**Why it happens:** These pages were all built before the `StateBlock`/error-state convention existed; only Assets and PM-Schedules happened to get error handling bolted on at some point (both already have `isError` + a bespoke inline `AlertTriangle` block + `failedToLoad`/`loadError` copy).
**How to avoid:** Treat "add `isError`+wire retry" as its own explicit sub-task per query touched, not an assumed side-effect of "convert to StateBlock." For work-orders' 5 parallel queries specifically, decide upfront whether each Kanban column gets its own independent error state (5 separate `StateBlock`s, matching the existing 5 separate loading skeletons) or one aggregate error banner for the whole board (simpler, but loses per-column granularity) — no existing precedent in this codebase for 5 simultaneous same-shape queries feeding one board, so this is a genuine open design decision for the planner.
**Warning signs:** A plan's must-haves list only mentions "predictions.tsx error state" and doesn't explicitly name work-orders/archived-panel/failure-prediction-sidebar/work-order-detail-drawer as also needing new `isError` destructuring.

### Pitfall 3: `PageHeader`'s legacy-DOM-translator vulnerability (bug-964/965 class) — proactively verify EN, not just avoid regressing ES

**What goes wrong:** Per 34-08's close-out (bug-964), `PageHeader` title/subtitle strings can get mangled by the page-wide `domTranslations.ts` `MutationObserver`-based legacy translator — the fix was an opt-in `data-i18n-skip="true"` attribute, not a systemic one. Per 34-08's bug-965 finding (deferred, unfixed), `StateBlock`'s error-message text is suspected to have the same class of vulnerability but has not yet been proven or fixed anywhere.
**Why it happens:** The legacy translator's word-level glossary only recognizes whole-phrase entries for namespaces that existed when the glossary was built; brand-new phrases get partially re-translated into English/Spanish hybrids.
**How to avoid:** Since Phase 35 reuses the pre-existing `engineering.*`/`programs.pmSchedules.*` namespaces (not brand-new, unlike every Phase 34 section), risk is lower than 34-08's scenario — but the *new* strings added this phase (new `loadError`/empty-state copy for work-orders/archived/predictions) ARE new to the glossary. Close-out must live-verify EN rendering (not just ES) isn't accidentally reverted by the legacy translator on any of this phase's new `PageHeader` or `StateBlock` content — per the phase's own additional_context instruction. If a `StateBlock` error message is found mangled, apply the same `data-i18n-skip` mitigation pattern used for `PageHeader` (StateBlock's error `<p>` doesn't currently expose a `dataI18nSkip` prop — would need a small additive change to `StateBlock.tsx`, itself not frozen).
**Warning signs:** A newly-added error/empty string renders correctly in isolation (e.g., in Storybook or unit test) but shows English/Spanish hybrid text when the full page mounts under `ES` locale in a real browser — the domTranslations.ts effect only manifests at the full-app DOM level.

### Pitfall 4: Two different i18n-namespace conventions on the same section — don't "fix" the pm-schedules inconsistency

**What goes wrong:** An implementer instinctively wants to move `pm-schedules/page.tsx`'s copy from `programs.pmSchedules.*` into a new `engineering.pmSchedulesPage.*` namespace to match the other 3 pages' naming convention.
**Why it happens:** The naming asymmetry (`engineering.workOrdersPage`/`assetsPage`/`predictionsPage` vs. `programs.pmSchedules`) looks like an oversight from a quick scan.
**How to avoid:** This is explicitly a locked decision (Deferred Ideas) — `programs.pmSchedules.*` is also used by the Programs section's own already-shipped (Phase 33-verified) PM view, sharing the exact same keys. Migrating risks breaking that unrelated, already-correct usage. Confirmed: `programs.pmSchedules.*` already has `failedToLoad`/`retry`/`noSchedules`/`noSchedulesHelp`/`createSchedule` — everything needed for a StateBlock conversion already exists with zero new keys required for this page's error/empty states.
**Warning signs:** A diff touching `programs.pmSchedules.*` key *names* (not just adding new keys) inside `pm-schedules/page.tsx`'s plan.

## Code Examples

### Existing per-page query shapes (exact, for precise "extend destructuring" tasks)

```typescript
// work-orders/page.tsx:276-292 — 5 parallel Kanban queries, NONE destructure isError
const queryOpts = (status: KanbanStatus) => ({
  queryKey: ['work-orders', status, isEngineer ? user?.id : null] as const,
  queryFn: () => engineeringApi.listWorkOrders({ status, assigned_to: isEngineer ? user?.id : undefined, per_page: 50 }),
  refetchInterval: 60_000,
  enabled: !!hotelId,
})
const openQ      = useQuery(queryOpts('open'))
const escalatedQ = useQuery(queryOpts('escalated'))
const progressQ  = useQuery(queryOpts('in_progress'))
const holdQ      = useQuery(queryOpts('on_hold'))
const completedQ = useQuery(queryOpts('completed'))
// columnLoading built from .isLoading only (lines 302-308) — no columnError equivalent exists
```

```typescript
// components/engineering/ArchivedWorkOrdersPanel.tsx:19-22 — no isError
const { data, isLoading } = useQuery({
  queryKey: ['work-orders', 'archived'],
  queryFn: () => engineeringApi.listWorkOrders({ archived: true, per_page: 100 }),
})
```

```typescript
// assets/page.tsx:807-811 — already has isError (retry via invalidateQueries, line 928)
const { data: assetsData, isLoading, isError } = useQuery({
  queryKey: ['assets'],
  queryFn: () => engineeringApi.listAssets(),
  select: (res) => res.data as Asset[],
})
```

```typescript
// pm-schedules/page.tsx:547-551 — already has isError (retry via invalidateQueries, line 665)
const { data: schedulesData, isLoading, isError } = useQuery({
  queryKey: ['pm-schedules'],
  queryFn: () => engineeringApi.listPMSchedules(),
  select: (res) => res.data as PMSchedule[],
})
```

```typescript
// predictions/page.tsx:401-405 — no isError, no refetch (the genuine gap CONTEXT.md names)
const { data: predictions, isLoading } = useQuery({
  queryKey: ['failure-predictions-history'],
  queryFn: () => engineeringApi.getFailurePredictionHistory(),
  select: (res) => res.data as FailurePrediction[],
})
```

### work-orders/page.tsx's 3-tab structure (exact JSX, for precise tab-bar restyle + EngineeringRoomBoard non-touch tasks)

```tsx
// work-orders/page.tsx:247, 385-483 (abbreviated)
const [activeTab, setActiveTab] = useState<'work-orders' | 'room-board' | 'archived'>('work-orders')
// ...
<PageHeader
  eyebrow="Engineering"
  title={t('engineering.workOrdersPage.heading')}
  subtitle={isEngineer ? t('engineering.workOrdersPage.subtitleEngineer') : t('engineering.workOrdersPage.subtitleAll')}
  tabs={[
    { label: t('engineering.workOrdersPage.tabWorkOrders'), active: activeTab === 'work-orders', onClick: () => setActiveTab('work-orders') },
    { label: t('engineering.workOrdersPage.tabRoomBoard'), active: activeTab === 'room-board', onClick: () => setActiveTab('room-board') },
    { label: t('engineering.workOrdersPage.tabArchived'), active: activeTab === 'archived', onClick: () => setActiveTab('archived') },
  ]}
  actions={activeTab === 'work-orders' && ( /* AI Triage / Archive / New Work Order buttons */ )}
/>
{activeTab === 'work-orders' ? (
  /* urgent alert banner, AI triage notice, 5-column Kanban grid */
) : activeTab === 'room-board' ? (
  <EngineeringRoomBoard />   {/* FROZEN — zero changes, no wrapper */}
) : (
  <ArchivedWorkOrdersPanel />  {/* IN SCOPE for state-primitive conversion */}
)}
```

`EngineeringRoomBoard` is imported at line 23 (`import { EngineeringRoomBoard } from '@/components/engineering/EngineeringRoomBoard'`) and rendered completely bare at line 480 with no wrapping `<div>`/card — any v2 restyle must not add a wrapper around this specific line, since that would change layout/spacing pixels the regression harness captures.

### frozen-files.json mechanism (confirms: no allowlist entry needed for this phase)

```jsonc
// apps/web/frozen-files.json — exact 7 sha256-hashed files, EngineeringRoomBoard.tsx is #7
{
  "files": {
    "apps/web/components/ui/Button.tsx": "038ac4...",
    "apps/web/components/ui/primitives.tsx": "6f5e11...",
    "apps/web/components/housekeeping/RoomCard.tsx": "e3d40f...",
    "apps/web/components/shared/LogFoundItemModal.tsx": "649c95...",
    "apps/web/components/housekeeping/RoomStatusBoard.tsx": "d7de5f...",
    "apps/web/components/housekeeping/RoomDetailDrawer.tsx": "a5f897...",
    "apps/web/components/engineering/EngineeringRoomBoard.tsx": "3239f0..."
  },
  "room_status_values": { /* --alert/--info/--ready/--progress/--caution/--blocked light+dark hex, no allowlist escape */ }
}
```

`apps/web/scripts/check-frozen-files.mjs` recomputes sha256 for exactly these 7 files (byte content, CRLF-normalized) and separately re-parses live `globals.css`/`tailwind.config.ts` room-status CSS-variable values against the manifest — it has no knowledge of, and does not scan, any Engineering page/`PageHeader`/`StateBlock` file. As long as this phase (a) never edits `EngineeringRoomBoard.tsx` and (b) never introduces a new/retinted room-status token, `check:frozen-files` passes with zero manifest or `frozen-files-allowlist.json` changes — confirmed by reading the script directly, not inferred.

### Room-Board regression harness — exact invocation, exact route/tab, exact fixtures

```typescript
// apps/web/e2e/room-board-baseline.spec.ts:126-134 — the ONLY test touching Engineering
test(`EngineeringRoomBoard — ${mode}`, async ({ page }) => {
  await gotoWithTheme(page, '/engineering/work-orders', mode)
  await page.getByRole('button', { name: 'Room Board' }).click()
  await page.getByText(FIXTURE_ROOM_NUMBERS.ooo, { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  await expect(page).toHaveScreenshot(`engineering-room-board-${role.key}-${mode}.png`, { mask: chromeMasks(page) })
})
```

Runs for 2 roles (`gm`, `supervisor`) x 2 themes (`light`, `dark`) = 4 assertions specifically for Engineering, out of 12 total in the file (3 surfaces x 2 roles x 2 modes). Existing baseline snapshot files already on disk: `apps/web/e2e/room-board-baseline.spec.ts-snapshots/engineering-room-board-{gm,supervisor}-{light,dark}-win32.png` (4 files, Windows-platform-suffixed — this project's CI has no Linux baseline snapshots for this suite, a pre-existing gap unrelated to this phase, but relevant since local verification runs on win32 and CI runs on Linux; do not assume a locally-passing regression run also passes in CI for this specific suite).

**Invocation (from the spec file's own header comment):**
```bash
# Regenerate the baseline (after a deliberate, reviewed change):
npx playwright test --config=playwright.regression.config.ts --update-snapshots
# Verify zero drift on the current tree:
npx playwright test --config=playwright.regression.config.ts
```
Run from `apps/web/`. Config: `playwright.regression.config.ts` — `testMatch: 'room-board-baseline.spec.ts'`, `maxDiffPixelRatio: 0`, `globalSetup: './e2e/global-setup.ts'` (throws loudly if `REGRESSION_GM_EMAIL/PASSWORD`/`REGRESSION_SUP_EMAIL/PASSWORD`/`PLAYWRIGHT_BASE_URL` env vars are missing — no silent skip), `baseURL` defaults to a hardcoded (currently-stale per 32-06's finding) production URL unless `PLAYWRIGHT_BASE_URL` is set. Per 32-06/33-07 precedent, prior close-outs ran this against a **local standalone production build** (`npm run build` + `.next/standalone`) with direct Supabase service-role access to toggle the fixture tenant's `web_redesign_sections`, not the deployed Railway site — the same approach should be used for Phase 35's close-out, following that exact precedent.

**Important:** the tab-click locator is `page.getByRole('button', { name: 'Room Board' })` — a hardcoded English accessible-name match. This should keep working as long as `engineering.workOrdersPage.tabRoomBoard`'s English value stays `'Room Board'`. Flag to implementers: do not rename that key's **value** without updating this test locator too, or the test will silently time out on `.click()` finding no match rather than fail meaningfully.

## State of the Art

| Old Approach (pre-Phase-35, all 4 pages) | Current/Target Approach (Phase 32-34 convention) | When Changed | Impact |
|---|---|---|---|
| Bespoke `animate-pulse` divs per page for loading | Shared `Skeleton` component (`variant="text"\|"card"\|"room-card"\|"circle"`) | Introduced Phase 30 (FOUND-01), applied progressively Phase 32-34 | Consistent shimmer timing/visual language; NOT `StateBlock status="loading"` (spinner) — locked "skeleton not spinner" decision |
| Inline `AlertTriangle` + hardcoded retry button for errors (Assets/PM-Schedules only; missing entirely elsewhere) | `StateBlock status="error"` with `error.message`/`error.onRetry` | Phase 32+ | AA-contrast-verified `--alert-soft`/`--alert-line` tokens; consistent retry button variant |
| Custom empty-state markup, ranging from a single `<p>` to rich multi-element layouts (Assets/Predictions) | `EmptyState`/`StateBlock status="empty"` where it fits; bespoke retained where richer than the primitive allows | Phase 32+ | Visual consistency where primitive fits; genuine open question where content is richer (see Pitfall/Common Pitfall note above) |
| No section-level redesign flag | `isSectionRedesigned('engineering', hotel)` via `useHotelStore`, threaded per-page (no shared layout exists for Engineering) | This phase (35) | Enables safe, reversible rollout matching every other section |
| Full-page regression screenshot's captured region includes only shell (masked) + page content (unmasked) — no page has ever changed page-content pixels within this harness before | Phase 35 is first to change page-content pixels (`PageHeader`/tab-bar) within a regression-covered route | This phase (35) | Requires extending `chromeMasks()` before the close-out gate can pass meaningfully — see Pitfall 1 |

**Deprecated/outdated:** None — no library or pattern in this domain is being replaced; this is purely propagating an already-current in-repo convention.

## Open Questions

1. **How should the 5 parallel work-orders Kanban queries' error states be structured — per-column or aggregate?**
   - What we know: All 5 queries (`openQ`/`escalatedQ`/`progressQ`/`holdQ`/`completedQ`) currently share the identical shape via a `queryOpts(status)` factory function and already render 5 independent per-column loading skeletons.
   - What's unclear: Whether the planner wants 5 independent `StateBlock status="error"` regions (one per `KanbanColumn`, matching existing per-column loading granularity) or a single aggregate error banner above the whole 5-column grid (simpler, matches the existing single `emergencyCount`/`urgentCount` alert banner pattern already in that JSX).
   - Recommendation: Per-column, for consistency with the existing per-column `columnLoading` pattern and because a genuine partial failure (e.g., one status query 500s while others succeed) is plausible and per-column error is more informative — but this is a judgment call, not blocked by missing information.

2. **Should `EmptyState`/`StateBlock`'s `action` slot absorb Assets/Predictions' rich multi-element empty states, or should those two specific empty states stay bespoke?**
   - What we know: `EmptyState`'s props (`icon`/`title`/`body`/single `action: ReactNode`) can technically hold anything via `action`, but Assets' empty state has 3 sample chips + Predictions' has a conditional "clear filters" link OR a "go to asset register" link + 3 sample cards — noticeably richer than every other empty state converted in Phase 32-34.
   - What's unclear: No prior phase encountered an empty state this information-dense, so there's no direct precedent to follow.
   - Recommendation: Fold the primary icon/title/body into the primitive for visual consistency (icon circle, title weight/size, body copy style match the rest of the app), pass the sample-chips/links block as the `action` ReactNode — preserves all existing information architecture while gaining the primitive's baseline visual consistency. Leave final call to planner/implementer.

3. **Exact selector/mechanism for extending `chromeMasks()` to cover the new `PageHeader`/tab-bar region on `/engineering/work-orders`.**
   - What we know: `PageHeader.tsx` (not frozen) currently has no `data-testid` or other stable, mask-friendly selector on its outer wrapper; `EngineeringRoomBoard.tsx` (frozen) cannot receive a new selector.
   - What's unclear: Whether the cleanest fix is (a) add `data-testid="page-header"` to `PageHeader.tsx`'s outer div (one-line additive change, reusable for Phase 36's Housekeeping chrome too, but is a change to a file used by ~20 other pages — low risk since it's purely an additive `data-*` attribute, not behavior/styling), or (b) mask by existing structural selectors (e.g. the `h1` + adjacent `button[]` group) without touching `PageHeader.tsx`, which is more surgical to the test file alone but more brittle to future markup changes.
   - Recommendation: Option (a) — add the `data-testid` to the shared component. It's the more durable fix (works for any future page using `PageHeader` near a regression-covered surface, including Phase 36) and the change itself carries essentially zero regression risk (an added `data-*` attribute cannot affect any existing test, styling, or the frozen-files hash of any of the 7 protected files, since `PageHeader.tsx` isn't one of them).

## Sources

### Primary (HIGH confidence — direct file reads of this repo, 2026-08-18)
- `apps/web/app/(dashboard)/engineering/work-orders/page.tsx` (full read, 522 lines) — flag/PageHeader/tab/query/error-state shapes
- `apps/web/app/(dashboard)/engineering/assets/page.tsx` (targeted reads, lines 1-127, 795-935) — query shape, existing isError/retry pattern, empty-state richness
- `apps/web/app/(dashboard)/engineering/pm-schedules/page.tsx` (targeted reads, lines 535-755) — query shape, namespace reuse confirmation
- `apps/web/app/(dashboard)/engineering/predictions/page.tsx` (targeted reads, lines 1-80, 390-460, 740-830) — confirmed missing isError/refetch
- `apps/web/components/engineering/ArchivedWorkOrdersPanel.tsx` (full read, 104 lines) — confirmed missing isError
- `apps/web/components/engineering/EngineeringRoomBoard.tsx` (partial read, lines 1-60) — confirmed frozen, self-contained query/i18n
- `apps/web/components/shared/PageHeader.tsx` (full read, 108 lines) — exact props, dataI18nSkip mechanism, no existing testid
- `apps/web/components/ui/StateBlock.tsx`, `EmptyState.tsx`, `Skeleton.tsx` (full reads) — exact primitive APIs
- `apps/web/lib/utils/redesignFlag.ts` + `redesignFlag.test.mjs` (grep) — exact flag mechanism, confirmed `'engineering'` key anticipated in tests
- `apps/web/frozen-files.json` (full read) — exact 7-file freeze manifest, confirmed EngineeringRoomBoard.tsx hash entry
- `apps/web/scripts/check-frozen-files.mjs` (partial read) — confirmed exact scan mechanism, no Engineering-page awareness
- `apps/web/e2e/room-board-baseline.spec.ts` (full read, 137 lines) — exact regression test route/locators/masks for EngineeringRoomBoard
- `apps/web/playwright.regression.config.ts` (full read) — exact invocation/config
- `apps/web/i18n/locales/en.ts` (targeted reads around engineering namespace, lines 973-1329, and pmSchedules, lines 210-300) — exact existing key inventory
- `apps/web/i18n/locales/es.ts` (grep for section headers) — confirmed line-for-line parity with en.ts
- `.planning/phases/35-engineering-section-chrome/35-CONTEXT.md` (full read) — locked decisions, discretion, deferred ideas
- `.planning/STATE.md` (targeted reads, lines 21-109) — Phase 30-34 close-out precedent for regression-harness re-run methodology, "skeleton not spinner" convention, i18n-mangling bug history (bug-962/963/964/965)

No Context7/WebSearch/WebFetch was used — this phase is 100% internal-repo-convention research with no external library/API surface to verify.

## Metadata

**Confidence breakdown:**
- Flag/architecture pattern: HIGH — directly copied from working, already-shipped Phase 33 code (`programs/page.tsx`)
- Query/error-state gap inventory: HIGH — every claim confirmed via direct grep/read of the actual page files, not inferred from CONTEXT.md's summary
- Regression-harness interaction risk (Pitfall 1): HIGH — confirmed by reading the actual test file's screenshot scope and mask list, not speculation
- i18n key inventory (what already exists vs. needs adding): HIGH — confirmed via direct line-range reads of en.ts, cross-checked against es.ts line alignment
- Rich empty-state handling (Open Question 2): MEDIUM — no direct precedent exists in this codebase to verify against, recommendation is reasoned but unverified by prior phase practice

**Research date:** 2026-08-18
**Valid until:** Should remain valid through Phase 35's full execution (this is a fast-moving in-repo state, but nothing here depends on external library versions — re-verify only if a sibling phase touches the same files concurrently)

# Phase 36: Housekeeping Section Chrome - Research

**Researched:** 2026-08-19
**Domain:** Next.js 14 App Router client-component chrome restyle around a frozen board component (identical domain to the just-completed Phase 35 "Engineering Section Chrome")
**Confidence:** HIGH — every pattern needed already exists in this exact codebase, exercised 5 times (Phases 31-35). This research is confirmation/line-number-pinning, not exploration.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Flag key:** One new flag, `housekeeping` (camelCase, matches `tasks`/`engineering`/`safety`/`sop`/`aiCopilot` convention — confirmed unused/unregistered anywhere in production code today via full-codebase grep of `isSectionRedesigned(`). Single flag for the single HSK-01 requirement, same as `engineering` covered all of ENG-01 under one flag in Phase 35.

**Scope: `housekeeping/page.tsx` only — sub-routes explicitly out of scope.** The `/housekeeping` route group also contains `assignments/page.tsx` (248 LOC), `inspections/page.tsx` (559 LOC), and `rooms/page.tsx` (861 LOC) — none touched by any prior phase. ROADMAP's HSK-01 success criteria name only "PageHeader, sync badge, date/shift controls, and the housekeeper 'my rooms' list" — all four live inside `housekeeping/page.tsx` alone. Do **not** touch `assignments/`, `inspections/`, or `rooms/` sub-pages this phase.

**No shared layout.tsx — flag threaded directly in the one page file.** There is no `housekeeping/layout.tsx`. `housekeeping/page.tsx` is a single client component file containing multiple named function components: `SyncBadge`, `HousekeeperBar` (assign-mode chip bar), `HousekeeperRoomItem` (my-rooms list row), `HousekeeperMyRoomsView` (housekeeper role's own page), `SupervisorHousekeepingPage` (gm/housekeeping_supervisor/front_desk board view), and the default-exported `HousekeepingPage` role router. The flag is read once inside the default-exported `HousekeepingPage` router (or threaded to both `HousekeeperMyRoomsView` and `SupervisorHousekeepingPage`, planner's call) — same "read once, thread via ternary/early-return" pattern used throughout Phase 31-35, applied within a single file instead of across multiple page files.

**RoomStatusBoard / RoomDetailDrawer / RoomCard — chrome only, zero internal changes.** All three are content-hash-frozen in `apps/web/frozen-files.json`. `<RoomStatusBoard />` (rendered bare inside `SupervisorHousekeepingPage`, wrapped only in a `Suspense` boundary with no fallback) is NOT touched, NOT given a new wrapping card/Skeleton, and its frozen hash must not change. `<RoomDetailDrawer />` is NOT touched. The Room-Board pixel-regression harness (established Phase 30, re-run every close-out since) is the load-bearing safety net — the close-out wave MUST re-run it.

**AssignmentSidebar and PredictionPanel — chrome components, IN scope for v2 restyle.** Neither is in `frozen-files.json`. Restyle both with v2 tokens and convert their loading/error states to shared primitives, same "close a genuine gap, don't rewrite" discipline as every prior phase's modal/sidebar work. `PredictionPanel`'s action-confirmation flows (reassign/escalate/acknowledge) are preserved exactly; visuals only.

**Loading/empty/error pattern (identical established convention):**
- `HousekeeperMyRoomsView`'s board query (`isLoading` destructured, no `isError`) has a genuine gap: no error UI at all today if the query fails. Add an error state wired to the existing query's own `refetch`, following the "extend destructuring, wire onRetry to existing refetch" pattern, not a new query.
- `HousekeeperMyRoomsView`'s loading state is a bespoke `animate-pulse` div list (3 skeleton rows) — convert to shared `Skeleton`. Its empty state (`myRooms.emptyTitle`/`emptySubtitle`) — convert to shared `EmptyState`.
- `HousekeeperBar`'s staff-list query (`useQuery` at line ~92, `isLoading` destructured only) — check for a matching `isError` gap during planning/implementation; if absent, close it the same way. **Confirmed during this research: yes, this is a genuine gap** — see Code Examples below.
- The role-loading guard in the default-exported `HousekeepingPage` (bespoke `animate-pulse` skeleton blocks while `isAuthLoading || !role`) — convert to shared `Skeleton` primitive.
- `PredictionPanel`'s own `isLoading` prop (passed from `SupervisorHousekeepingPage`'s `fetchPredictions`, which silently swallows fetch errors — "predictions are optional") — this silent-failure design is intentional and stays as-is; only convert its visual loading treatment to shared primitives, do not add new error UI where the code deliberately has none today.

### i18n
- `housekeeping.page.*` namespace already exists (`shifts`, `sync`, `assignBar`, `roomItem`, `myRooms`, `board`, `noAccess`) in both `en.ts`/`es.ts`, line-aligned at **line 732** (confirmed) — this phase EXTENDS it additively.
- New error copy should follow the existing `housekeeping.roomStatus.error.*` naming convention (`failedToLoad`/`retry`/`dismiss` at line 433-436, confirmed) for consistency.
- `housekeeping.assignmentSidebar.*` (line 460) and `housekeeping.predictionPanel.*` (line 489) already exist and carry most copy needed — extend additively only for genuinely new error/loading copy.
- Single wave-1-owner-of-locale-files pattern from Phase 33/34/35 applies.

### Frozen/careful files
- `apps/web/components/housekeeping/RoomCard.tsx`, `RoomStatusBoard.tsx`, `RoomDetailDrawer.tsx` — frozen (content-hash in `apps/web/frozen-files.json`), zero changes.
- `AssignmentSidebar.tsx`, `PredictionPanel.tsx` — not frozen, but touch only to close a genuine gap.
- Realtime subscription logic (`hk_my_rooms_realtime` channel in `HousekeeperMyRoomsView`, whatever `RoomStatusBoard` does internally) is NOT touched — only the `SyncBadge` chrome that visually surfaces "Live" status is redesigned.

### RBAC — zero behavior change
- `/housekeeping` prefix allows `gm`/`housekeeping_supervisor`/`housekeeper`/`front_desk` per `routeGuard.ts`, but `housekeeper` is in `MOBILE_ONLY_ROLES` and redirected off web before that rule is consulted — in practice only `gm`/`housekeeping_supervisor`/`front_desk` reach `SupervisorHousekeepingPage` on web; `HousekeeperMyRoomsView` is effectively unreachable on web in production. Pre-existing, out of scope, do not change — but still gets full v2 visual treatment per HSK-01's explicit naming of "my rooms" list.
- `canAssignRooms` (from `useRole()`) gates assign-mode toggle, `HousekeeperBar`, `AssignmentSidebar` visibility. Preserved exactly.
- The no-access branch (`role !== 'gm' && role !== 'housekeeping_supervisor' && role !== 'front_desk'`) — convert bespoke centered text to shared primitive, condition unchanged.

### Claude's Discretion
- Exact plan/wave shape — left to gsd-planner. Natural shape smaller than Phase 35 (1 file + 2 components, not 4 independent page files): likely 1 i18n+small-restyle combined plan, or a 2-plan split (chrome/board-view restyle + my-rooms/housekeeper-view restyle) plus a close-out verification wave.
- Whether the i18n extension is its own tiny plan or folded into wave 1 of restyle work.
- Exact new i18n key names, following the existing `housekeeping.<subarea>.*` sub-key convention.

### Deferred Ideas (OUT OF SCOPE)
- `housekeeping/assignments/page.tsx`, `housekeeping/inspections/page.tsx`, `housekeeping/rooms/page.tsx` — a genuine roadmap gap, belongs in its own future phase.
- `apps/web/app/(dashboard)/settings/housekeeping/page.tsx` (cleaning checklists settings) — separate route under Phase 34's `settings` flag territory.
- Whether `HousekeeperMyRoomsView`'s web-unreachability means it should eventually be deleted from the web bundle — out of scope, leave exactly as-is (same call Phase 35 made for `engineer`'s analogous dead-web-code finding).
</user_constraints>

## Summary

Phase 36 is a narrow, well-precedented "chrome" phase: one 791-line file (`apps/web/app/(dashboard)/housekeeping/page.tsx`) plus two small non-frozen components (`AssignmentSidebar.tsx`, 97 LOC; `PredictionPanel.tsx`, 563 LOC) get v2 visual tokens and shared-primitive loading/error/empty states, while three frozen board components render completely unchanged inside the new chrome. Every mechanical piece this phase needs — the flag-gate utility, the shared `StateBlock`/`Skeleton`/`EmptyState` primitives, the frozen-file manifest, the Room-Board regression harness (which **already runs against `/housekeeping` today**, confirmed below), the dark-mode contrast gate, and the i18n parity gate — was built in Phase 30 and has been exercised identically in Phases 31-35, most recently and most analogously in Phase 35 (Engineering Section Chrome, closed 2026-08-18).

The single most load-bearing finding of this research: **the Room-Board regression harness's `chromeMasks()` function in `apps/web/e2e/room-board-baseline.spec.ts` already contains a comment explicitly anticipating this phase** — Phase 35's Task 1 added `data-testid="page-header"` to the shared `PageHeader.tsx` component and masked it in the harness, and the harness's own inline comment (line 85-87) states: *"This mask is reusable as-is for Phase 36's Housekeeping chrome close-out too, since `/housekeeping` renders the same `PageHeader` above `RoomStatusBoard`/`RoomDetailDrawer`."* This means Phase 36's close-out plan does **not** need to repeat Phase 35's Task 1 (add data-testid + extend chromeMasks) — that precondition is already satisfied globally. The close-out plan only needs to *run* the regression suite, not modify the harness first, unless a new, not-yet-masked chrome element is introduced (unlikely given the UI-SPEC's "no new component primitives" scope note).

A second load-bearing finding: `room-board-baseline.spec.ts` **already has dedicated tests for `/housekeeping`** — `housekeeping RoomStatusBoard — {light,dark}` and `RoomDetailDrawer — {light,dark}`, run per-role (gm, supervisor) — meaning this phase's close-out is re-running an *existing* baseline test suite, not writing new regression coverage from scratch.

**Primary recommendation:** Follow the exact Phase 35 shape, scaled down: (1) a single small i18n-only plan that adds ~2-4 new leaf keys additively to the existing `housekeeping.page.myRooms`/`housekeeping.page.assignBar`/`housekeeping.assignmentSidebar`/`housekeeping.predictionPanel` sub-namespaces in both `en.ts`/`es.ts` (or fold this into wave 1 of a single combined plan, given how small the additive set is compared to Phase 33-35's from-scratch namespaces); (2) one or two content plans doing the v2 restyle + shared-primitive conversion across `housekeeping/page.tsx`, `AssignmentSidebar.tsx`, and `PredictionPanel.tsx`; (3) a close-out plan that runs (does not need to first modify) the standing gate suite plus the Room-Board regression harness (already covering `/housekeeping`) and live-verifies flag-on/flag-off, light/dark, EN/ES, and the bug-965-class StateBlock i18n-mangling check that Phase 35 flagged as still-open (see Common Pitfalls).

## Standard Stack

No new libraries. This phase reuses the exact stack already in `housekeeping/page.tsx`: `@tanstack/react-query` (`useQuery`/`useQueryClient`), `react-i18next` (`useTranslation`), `date-fns`, `lucide-react` icons, Zustand (`useHousekeepingStore`, `useAuthStore`, `useHotelStore`), Supabase JS client (`createClient` from `@/lib/supabase/client`) for the Realtime channel (untouched).

### Core (already imported, reused as-is)
| Library | Purpose | Where used |
|---------|---------|------------|
| `@tanstack/react-query` | `useQuery`/`useQueryClient`/`useMutation` for board data, staff list, predictions | Already present throughout the file |
| `react-i18next` | `useTranslation()` for all copy | Already present |
| `zustand` (via `useHousekeepingStore`/`useAuthStore`/`useHotelStore`) | Section state, auth-loading flag, hotel object for flag read | `useHotelStore` is net-new to this file (see Architecture Patterns) |

### Net-new imports required
| Import | Path | Purpose |
|--------|------|---------|
| `useHotelStore` | `@/stores/hotelStore` | Read `hotel` object to evaluate flag |
| `isSectionRedesigned` | `@/lib/utils/redesignFlag` | `isSectionRedesigned('housekeeping', hotel)` boolean |
| `StateBlock` | `@/components/ui/StateBlock` | Replaces bespoke loading/error markup |
| `Skeleton` | `@/components/ui/Skeleton` | Replaces bespoke `animate-pulse` divs |
| `EmptyState` | `@/components/ui/EmptyState` | Replaces bespoke centered-text empty states |

None of these five imports currently exist in `housekeeping/page.tsx`, `AssignmentSidebar.tsx`, or `PredictionPanel.tsx` (confirmed by full read of all three files) — this matches CONTEXT.md's note that `useHotelStore`/`isSectionRedesigned` will be "a net-new import, same pattern as every prior phase's first touch of a page."

**No installation needed** — all five are already in the codebase (Phase 30 primitives, existing Zustand stores).

## Architecture Patterns

### Pattern 1: Flag read + inline `v2` boolean threaded through existing JSX (not parallel component trees)

**What:** Every Phase 35 engineering page reads the flag once near the top of its content component and uses a single `v2` boolean threaded through ternaries inline in the existing JSX — it does NOT duplicate the whole render tree into a `LegacyPage`/`V2Page` pair.

**Confirmed pattern (from `apps/web/app/(dashboard)/engineering/predictions/page.tsx` lines 22-23, 386-387; identically in `work-orders/page.tsx`, `assets/page.tsx`, `pm-schedules/page.tsx`):**
```typescript
// Source: apps/web/app/(dashboard)/engineering/predictions/page.tsx:22-23,386-387
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
// ...
function PredictionsPageContent() {
  const { t } = useTranslation()
  const { isGM, role } = useRole()
  const hotel = useHotelStore((s) => s.hotel)
  const v2 = isSectionRedesigned('engineering', hotel)
  // ...v2 threaded inline through className ternaries / conditional StateBlock props below
}
```

**When to use in Phase 36:** Read `hotel`/`v2` once inside the default-exported `HousekeepingPage` router (or once each inside `HousekeeperMyRoomsView` and `SupervisorHousekeepingPage`, per CONTEXT.md's "planner's call") and thread it through `SyncBadge`, `HousekeeperBar`, `HousekeeperRoomItem`, and the two chrome components. Given the two role-specific views (`HousekeeperMyRoomsView`, `SupervisorHousekeepingPage`) are structurally very different pages sharing only the router, reading `v2` once per view (not once in the router and drilling it down through 3+ component boundaries) is likely cleaner — but this is explicitly left to the planner.

### Pattern 2: `StateBlock` status-driven render replacing bespoke loading/error/data branches

**What:** `StateBlock` (`apps/web/components/ui/StateBlock.tsx`) takes a `status: 'loading' | 'empty' | 'error' | null` prop and renders the matching sub-state, falling through to `children` when `status` is `null`/omitted.

```typescript
// Source: apps/web/components/ui/StateBlock.tsx (full file read)
interface StateBlockProps {
  status?: 'loading' | 'empty' | 'error' | null
  loadingLabel?: string
  empty?: EmptyStateProps        // { icon?, title, body?, action?, className? }
  error?: { message?: string; onRetry?: () => void }
  className?: string
  children?: ReactNode
}
```
Loading renders a centered `Loader2` spin + `loadingLabel ?? t('common.loading')`. Error renders an alert-toned icon circle + `error?.message ?? t('common.error')` + an optional outline "Retry" button wired to `error.onRetry`. Empty delegates straight to `<EmptyState {...empty}>`.

**Recommended usage for `HousekeeperMyRoomsView`'s board query** (mirrors the exact `isLoading`/`isError`/`refetch` extension pattern CONTEXT.md prescribes):
```typescript
const { data: boardData, isLoading, isError, refetch } = useQuery({
  queryKey: ['housekeeping-board', today],
  queryFn: () => housekeepingApi.getBoard(today, undefined, false),
  refetchInterval: 10_000,
})
// ...
<StateBlock
  status={isLoading ? 'loading' : isError ? 'error' : myRooms.length === 0 ? 'empty' : null}
  error={{ message: t('housekeeping.page.myRooms.loadError'), onRetry: refetch }}
  empty={{ title: t('housekeeping.page.myRooms.emptyTitle'), body: t('housekeeping.page.myRooms.emptySubtitle') }}
>
  {/* existing myRooms.map(...) list */}
</StateBlock>
```
Note: `refetchInterval: 10_000` means a background refetch failure sets `isError` even with stale data present — verify during implementation whether `isError` should gate on `data === undefined` too (React Query returns stale `data` alongside `isError` on a background refetch failure) to avoid flashing an error state over already-loaded rooms. This is an implementation-detail judgment call, not covered by CONTEXT.md.

### Pattern 3: `Skeleton` primitive for list/row loading states

```typescript
// Source: apps/web/components/ui/Skeleton.tsx (full file read)
interface SkeletonProps {
  className?: string
  variant?: 'text' | 'card' | 'room-card' | 'circle'
}
```
`variant="card"` (`h-32 w-full rounded-[var(--r-lg)]`) is the closest existing match for `HousekeeperMyRoomsView`'s current bespoke `h-20 bg-surface-3 rounded-[var(--r-lg)] animate-pulse` skeleton rows (3-row list) and the `HousekeepingPage` router's role-loading guard (`h-8`/`h-24`/`h-72` blocks) — pass `className` to override height (e.g. `className="h-20"`) since none of the 4 built-in variants match the exact heights used today.

### Pattern 4: Wave shape precedent from Phase 35 (directly analogous, scale down)

Phase 35's 7-plan shape (confirmed via plan front matter):
- **Plan 01** (wave 1, `depends_on: []`): sole owner of `en.ts`/`es.ts`, adds exactly 3 new leaf keys additively into 3 pre-existing namespaces, nothing else.
- **Plans 02-06** (wave 2, `depends_on: ["35-01"]`, run in parallel): one plan per page/component surface, each restyles + wires shared primitives, never touches locale files.
- **Plan 07** (wave 3, `depends_on: [all wave-2 plans]`): close-out — Task 1 (harness precondition, if needed), Task 2 (standing gate suite + regression re-pass), Task 3 (live browser verification).

For Phase 36 (1 file + 2 small components vs. Phase 35's 4 independent page files), CONTEXT.md's own discretion note suggests either:
- **2-plan + close-out** (3 total): wave 1 = i18n + `AssignmentSidebar.tsx`/`PredictionPanel.tsx` restyle (smaller surfaces, i18n owner), wave 2 = `housekeeping/page.tsx`'s two views (`HousekeeperMyRoomsView` + `SupervisorHousekeepingPage`) restyle, wave 3 = close-out. OR
- **1 combined content plan + close-out** (2 total): given the entire content surface is one file + 2 small components (≈1450 LOC combined vs. Phase 35's ~2500+ LOC across 4 pages + 6 components), a single wave-1 plan doing i18n + all restyling, then close-out.

Either shape is defensible; the planner should weigh whether `housekeeping/page.tsx`'s two very different views (assign-mode board vs. housekeeper mobile list) are independent enough to parallelize as separate plans (reducing single-plan risk/size) against the file-collision cost of two plans both editing the same 791-line file (only one can touch `page.tsx` at a time without a merge-conflict-prone split, unless the split is "wave 1 edits `page.tsx`'s two views is one plan," "wave 1b edits `AssignmentSidebar.tsx`/`PredictionPanel.tsx` is a separate plan, both depending only on an i18n plan" — since those are three separate files, this parallelizes cleanly).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Flag-gating a section | A new flag constant/config file | `isSectionRedesigned('housekeeping', hotel)` from `@/lib/utils/redesignFlag` (2-line existing utility, reads `hotel.web_redesign_sections` array) | Exact same mechanism as 20+ other gated files; zero new abstraction needed |
| Loading/error/empty state markup | New bespoke `animate-pulse` divs / centered-text blocks | `Skeleton`, `StateBlock`, `EmptyState` from `@/components/ui/*` | Established Phase 30 primitives, used by every content/chrome phase since (33/34/35); UI-SPEC.md explicitly says "No new component primitives expected" |
| Pixel-regression testing for the frozen board | A new Playwright spec for `/housekeeping` | `apps/web/e2e/room-board-baseline.spec.ts` — **already has `/housekeeping` tests** (`housekeeping RoomStatusBoard`, `RoomDetailDrawer`, both light/dark, both `gm`/`supervisor` roles) | Re-run existing suite; do not duplicate coverage |
| Masking the new PageHeader in the regression diff | A new `chromeMasks()` mask entry | Already present — `page.locator('[data-testid="page-header"]')` was added in Phase 35 with an explicit comment anticipating Phase 36's reuse | Confirmed by direct read of `room-board-baseline.spec.ts` lines 77-89 |

**Key insight:** This phase's "don't hand-roll" risk is near-zero because it is the 6th iteration of an identical pattern in this codebase. The main risk is *not noticing* that the regression harness already covers `/housekeeping` and already has the PageHeader mask, and wastefully re-deriving/re-adding either.

## Common Pitfalls

### Pitfall 1: Assuming the regression harness needs a Phase-35-style Task-1 precondition fix
**What goes wrong:** A close-out plan blindly copies Phase 35's Task 1 (add `data-testid`, extend `chromeMasks()`) as a "required first step," duplicating work that's already done.
**Why it happens:** Phase 35's plan and RESEARCH.md describe this as a phase-specific required precondition; a planner unfamiliar with the current state of `room-board-baseline.spec.ts` might assume every chrome phase needs its own version.
**How to avoid:** Confirmed by direct read (2026-08-19): `chromeMasks()` already includes `page.locator('[data-testid="page-header"]')` with an explicit comment stating it's "reusable as-is for Phase 36's Housekeeping chrome close-out too, since `/housekeeping` renders the same `PageHeader`." **No new mask or data-testid is needed** unless this phase introduces a genuinely new unmasked chrome element that shares the screenshot viewport (e.g., if `HousekeeperBar` or `AssignmentSidebar` ends up rendering visible text that varies between flag-on/flag-off in a way not already masked — unlikely given both are gated behind `assignmentMode && canAssignRooms`, which is `false` in the regression fixture's default state).
**Warning signs:** If the regression suite shows diffs concentrated in the `PageHeader`/date-nav/sync-badge region after this phase's restyle, that's expected — it should already be masked. A genuine regression would show diffs inside the room-card grid itself (frozen content) or inside the `RoomDetailDrawer`'s frozen internals.

### Pitfall 2: The bug-965-class StateBlock i18n-mangling risk (open, unresolved from Phase 35)
**What goes wrong:** Phase 35's close-out (35-07-PLAN.md Task 3) added an explicit live-verification step because `StateBlock`'s error copy is suspected (not yet proven either way for Engineering) to suffer the same `domTranslations.ts` EN/ES hybrid-mangling defect class as `PageHeader` (bug-965, itself deferred/unfixed app-wide). Since Phase 36 also introduces new `StateBlock` error strings (for `HousekeeperMyRoomsView`'s board query and possibly `HousekeeperBar`'s staff query), this same live-check must be repeated for Phase 36's new strings specifically.
**Why it happens:** The legacy DOM translator (`domTranslations.ts`, predates react-i18next) partially glossary-matches individual words in "recovered" original text and re-mangles already-correct Spanish into English/Spanish hybrids for certain component types.
**How to avoid:** Check whether Phase 35's close-out (35-07-SUMMARY.md, not yet read in this research pass — planner/executor should read it) recorded a pass/fail result for its 3 new StateBlock strings; if Phase 35 found StateBlock strings clean (not mangled), that's reassuring precedent but Phase 36's close-out should still independently verify its own new strings in the live app (toggle to ES, force an error state, visually inspect).
**Warning signs:** Spanish text with stray English words mixed in when viewing a `StateBlock` error message under the ES locale.

### Pitfall 3: React Query `isError` + stale `data` co-existing on background refetch failure
**What goes wrong:** `HousekeeperMyRoomsView`'s board query has `refetchInterval: 10_000` — if a background refetch fails after initial success, React Query sets `isError: true` while `data` still holds the last successful payload. A naive `status={isError ? 'error' : ...}` would flash a full error screen over already-rendered rooms on every transient background-poll failure, which is worse UX than the current "silently keep showing stale data" behavior.
**Why it happens:** `StateBlock`'s `status` prop is a simple discriminated union that doesn't distinguish "never loaded, error" from "loaded once, now erroring in background."
**How to avoid:** Gate the error branch on `isError && !boardData` (or equivalent "no data ever successfully loaded" check) rather than `isError` alone, so a background poll failure with existing data falls through to rendering the stale list instead of an error block. This is an implementation nuance not explicitly called out in CONTEXT.md — flag it for the planner/executor.
**Warning signs:** Error state flashing intermittently every ~10s in a live demo even though the initial load succeeded.

### Pitfall 4: Confusing `AssignmentSidebar`'s 11px label text with the UI-SPEC's typography cap
**What goes wrong:** `AssignmentSidebar.tsx` currently has `text-[11px] font-medium text-ink3` (line 68, 72) for its stat-tile labels ("Unassigned"/"Needs work") — the UI-SPEC.md's Typography section explicitly says the phase **dropped the 11px label/meta size** and **eliminated font-medium(500)**: "all micro-label/meta text (pills, chip bar, `assignBar` copy) now renders at 12px only" and "micro-label text (pills, chip bar) now folds into regular(400)." A naive restyle might leave `AssignmentSidebar`'s existing `text-[11px] font-medium` untouched since it "looks like a small pre-existing style," missing that it's explicitly in the UI-SPEC's declared scope (stat tiles are named directly in the Spacing Scale section: "`AssignmentSidebar` stat-tile internal padding").
**How to avoid:** Convert `AssignmentSidebar`'s stat-tile label text from `text-[11px] font-medium` to `text-xs font-normal` (12px/regular) per the UI-SPEC's Typography table ("Label / meta" role: 12px, regular 400).
**Warning signs:** A gsd-ui-checker or code-review pass flagging a 3rd font weight or a 5th font size in the diff.

## Code Examples

### `HousekeeperBar`'s staff-list query — confirmed `isError` gap (CONTEXT.md flagged this as "check during implementation"; confirmed here)

```typescript
// Source: apps/web/app/(dashboard)/housekeeping/page.tsx:92-95 (current state, read in full 2026-08-19)
const { data, isLoading } = useQuery({
  queryKey: ['staff-list'],
  queryFn: () => staffApi.list(),
})
```
No `isError` is destructured; on query failure, `housekeepers` resolves to an empty array (via `data?.data?.staff ?? []`) and the UI silently renders the existing `housekeepers.length === 0` branch — "No housekeeper staff found. Add staff" — which is **factually wrong copy** for a fetch failure (it implies zero staff exist, not that the fetch failed). This is a genuine, confirmed gap: **add `isError`/`refetch` and a distinct error branch** (per CONTEXT.md's proposed key `housekeeping.page.assignBar.loadError`: "Couldn't load staff. Try again.") rather than letting a fetch failure masquerade as the empty-staff state.

### `HousekeeperMyRoomsView`'s board query — confirmed `isError` gap

```typescript
// Source: apps/web/app/(dashboard)/housekeeping/page.tsx:475-479 (current state)
const { data: boardData, isLoading } = useQuery({
  queryKey: ['housekeeping-board', today],
  queryFn: () => housekeepingApi.getBoard(today, undefined, false),
  refetchInterval: 10_000,
})
```
Same gap: no `isError`, so a fetch failure silently renders the empty-state copy ("No rooms assigned to you today. Check with your supervisor.") instead of an error. Matches CONTEXT.md's UI-SPEC-approved new key `housekeeping.page.myRooms.loadError`: "Couldn't load your rooms. Try again."

### Exact i18n key locations for the new copy (line-pinned, both files line-aligned)

| Key path | en.ts line (existing namespace start) | es.ts line (existing namespace start) |
|---|---|---|
| `housekeeping.page.myRooms.*` (add `loadError` here) | 780 (`myRooms: {`) | 780 (confirmed line-aligned) |
| `housekeeping.page.assignBar.*` (add `loadError` here) | 746 (`assignBar: {`) | 746 (confirmed line-aligned) |
| `housekeeping.assignmentSidebar.*` (extend if any new copy needed) | 460 | 460 |
| `housekeeping.predictionPanel.*` (extend if any new copy needed) | 489 | 489 |
| `housekeeping.roomStatus.error.*` (style reference only, do not edit) | 433 (`failedToLoad`/`retry`/`dismiss`) | 433 |

## State of the Art

| Old Approach (pre-v2, current housekeeping/page.tsx) | Current v2 Approach (established Phase 30, applied Phases 31-35) | Impact |
|---|---|---|
| Bespoke `animate-pulse` divs for loading (3 different spots: role guard, staff chips, my-rooms list) | Shared `Skeleton` component (`variant="card"` + `className` height override) | Consistent shimmer treatment, less markup |
| Bespoke centered `<p>` text for empty/no-access states | Shared `EmptyState` component | Consistent icon/title/body/action layout |
| No error UI at all for 2 confirmed query gaps (my-rooms board, staff list) | `StateBlock status="error"` wired to the query's own `refetch` | Closes a real UX gap — currently a failed fetch is indistinguishable from "genuinely empty" |
| No flag-gating in this file at all | `isSectionRedesigned('housekeeping', hotel)` via net-new `useHotelStore` import | Enables safe, reversible rollout exactly like the other 20+ gated sections |

**Deprecated/outdated:** Nothing in this phase touches deprecated APIs — this is a pure UI-layer restyle of already-current-generation code (React Query v5-style `useQuery`/`useMutation`, Next.js 14 App Router client components).

## Open Questions

1. **Exact plan/wave split (2-plan vs. 3-plan shape)**
   - What we know: CONTEXT.md explicitly defers this to the planner; Phase 35's precedent (i18n-plan → parallel content plans → close-out) is directly analogous but was sized for 4 independent page files, not 1 file + 2 components.
   - What's unclear: Whether splitting `housekeeping/page.tsx`'s two views (`HousekeeperMyRoomsView` vs. `SupervisorHousekeepingPage`) into separate plans is worth the risk of both needing to touch the same 791-line file (only one plan can safely edit `page.tsx` unless they're sequenced, not parallelized) versus keeping it as one combined content plan.
   - Recommendation: Given only one file (`page.tsx`) contains 5 of the 6 things needing restyle (`SyncBadge`, `HousekeeperBar`, `HousekeeperRoomItem`, `HousekeeperMyRoomsView`, `SupervisorHousekeepingPage`, `HousekeepingPage` router — six, not five), and `AssignmentSidebar.tsx`/`PredictionPanel.tsx` are the only genuinely separate files, the cleanest split is: **wave 1** = i18n (sole owner of locale files, small) run either as its own tiny plan or folded into wave-1 content work; **wave 2** = ONE plan for all of `housekeeping/page.tsx` (since splitting it risks a same-file collision) run in parallel with a SECOND plan for `AssignmentSidebar.tsx` + `PredictionPanel.tsx` (two small, independent files); **wave 3** = close-out. This yields a 3-plan phase (vs. Phase 35's 7), consistent with CONTEXT.md's "narrower in scope than Phase 35" framing.

2. **Whether `PredictionPanel`'s existing 11.5px (`text-[11.5px]`) inline confirm-banner text needs to move to the UI-SPEC's declared 12px label size**
   - What we know: UI-SPEC.md's Typography table caps at 4 sizes (13/12/14/20px) and PredictionPanel has several `text-[11.5px]` instances (lines 207, 220, 233, 245, 449, 476) that don't cleanly map to any of the 4 declared sizes.
   - What's unclear: Whether `text-[11.5px]` was an intentional micro-adjustment the UI-SPEC's "Label / meta: 12px" role is meant to absorb (rounding 11.5→12), or whether it's out of this phase's declared typography scope entirely (the UI-SPEC's scope note only explicitly calls out "AssignmentSidebar/PredictionPanel body and label text" as in-scope, which would include these).
   - Recommendation: Treat all of `PredictionPanel`'s `text-[11.5px]`/`text-[11px]`/`text-[10.5px]`/`text-[10px]` instances as needing consolidation into the UI-SPEC's declared 12px "Label / meta" role during the restyle — the UI-SPEC's Dimension 4 BLOCK-resolution history (dropping the 11px size entirely) strongly implies these odd fractional sizes are meant to be eliminated, not preserved. Flag any ambiguous case for the gsd-ui-checker to catch in its Dimension 4 pass.

## Sources

### Primary (HIGH confidence — direct codebase reads, 2026-08-19)
- `apps/web/app/(dashboard)/housekeeping/page.tsx` — full 791-line read
- `apps/web/components/housekeeping/AssignmentSidebar.tsx` — full 97-line read
- `apps/web/components/housekeeping/PredictionPanel.tsx` — full 563-line read
- `apps/web/components/ui/StateBlock.tsx`, `Skeleton.tsx`, `EmptyState.tsx` — full reads
- `apps/web/components/shared/PageHeader.tsx` — full read (confirms `data-testid="page-header"` already present)
- `apps/web/lib/utils/redesignFlag.ts` — full read (2-line utility)
- `apps/web/frozen-files.json` — full read (confirms 7 frozen files incl. the 3 relevant to this phase)
- `apps/web/e2e/room-board-baseline.spec.ts` — full 149-line read (confirms `/housekeeping` already covered, PageHeader mask already present)
- `apps/web/i18n/locales/en.ts` lines 416-810 and `es.ts` (namespace headers) — confirms exact line numbers and line-alignment between locale files
- `apps/web/app/(dashboard)/engineering/predictions/page.tsx` — confirms exact flag-read pattern (`useHotelStore`, `isSectionRedesigned`)
- `apps/web/lib/hooks/useRole.ts` — confirms `canAssignRooms: boolean` in `RoleCapabilities`
- `.planning/phases/35-engineering-section-chrome/35-01-PLAN.md`, `35-07-PLAN.md` — full reads (i18n-plan and close-out-plan shape precedent)
- `.planning/phases/35-engineering-section-chrome/35-02-PLAN.md`, `35-06-PLAN.md` — front-matter reads (wave/depends_on shape confirmation)
- `apps/web/package.json` — confirms exact script names: `type-check`, `test:e2e:regression`, `check:i18n-parity`, `verify:i18n-gate`, `check:frozen-files`, `check:contrast`

### Secondary (MEDIUM confidence)
- None — all findings verified directly against the current codebase state.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, every import confirmed present/absent by direct file read
- Architecture: HIGH — flag pattern, StateBlock/Skeleton/EmptyState props, and wave-shape precedent all confirmed by direct read of live code and Phase 35's actual plan files
- Pitfalls: HIGH for Pitfalls 1/3/4 (confirmed by direct code/config read); MEDIUM for Pitfall 2 (bug-965-class risk is documented as *suspected but unresolved* even for Phase 35 — its actual resolution requires reading `35-07-SUMMARY.md`, which was not read in this pass; flagged as a planner/executor follow-up)

**Research date:** 2026-08-19
**Valid until:** Should remain valid through Phase 36's execution (no external dependency drift risk) — re-verify only if Phase 35's close-out (`35-07-SUMMARY.md`) is found to have left the regression harness or StateBlock in a different state than described here.

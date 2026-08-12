# Phase 26: Deep-Linked Alert Surfaces - Research

**Researched:** 2026-08-12
**Domain:** Next.js 16 App Router client-side deep-linking (query params → existing UI state), FastAPI select-column exposure
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Deviation from ROADMAP.md's "pure frontend, no new backend endpoints" framing**
- `GET /ai/risk-alerts` (`apps/api/routers/ai_copilot.py::get_risk_alerts`) currently selects `asset_risks = supabase.table("assets").select("name, failure_risk_score")...` — no `id`, so the frontend has no `asset_id` to link with for maintenance rows. `housekeeping_risks` already selects `"*, rooms(room_number)")` on `room_readiness_predictions`, which includes `room_id` — no backend change needed there.
- **Decision:** Make one minimal one-line backend change — add `"id"` to the existing `asset_risks` select (`"id, name, failure_risk_score"`). Not a new endpoint, not new business logic.

**Housekeeping deep link (AI-07)**
- Convention: `/housekeeping?room={room_id}` query param (mirrors existing `?tab=`/`?step=` convention on `/tasks` and `/onboarding`).
- Target component: `apps/web/components/housekeeping/RoomStatusBoard.tsx`, which already owns `selectedRoom` state and renders `RoomDetailDrawer` (confirmed at lines 331, 687-689) — GMs/supervisors always render this component (`SupervisorHousekeepingPage`), never the housekeeper's separate `HousekeeperMyRoomsView`, and `AIRiskAlertsPanel` only appears on the GM/manager dashboard, so this is the correct and only target.
- On read of `?room=`, find the matching room in the already-fetched room list (`useHousekeepingStore`'s `rooms`, which `RoomStatusBoard` consumes) and call the existing `setSelectedRoom(...)` — reuse the exact same state transition a manual card click already triggers. Do not build a second/parallel "highlighted room" visual system — opening the existing `RoomDetailDrawer` IS the "highlight." No new scroll-to/pulse-animation infrastructure.
- Not-found case: room simply isn't in the current tenant-scoped `rooms` array — no drawer opens, no error, no crash. Same tenant-scoping guarantee every other query already provides — no new guard code needed.
- Cleaning up the query param after consuming it (`router.replace` without the param) is Claude's discretion — not required for correctness.

**Engineering deep link (AI-08)**
- Convention: `/engineering/predictions?asset={asset_id}` query param.
- Target page: `apps/web/app/(dashboard)/engineering/predictions/page.tsx`. Each `PredictionCard` in the flat list IS the detail. "Opens the specific asset's failure-prediction detail" means: land on this page with the correct card visible, distinguished, and scrolled into view — not a new standalone page.
- Match by `prediction.asset_id === assetIdFromQuery` (confirmed `FailurePrediction.asset_id: string` exists in `apps/web/lib/api/engineering.ts`).
- Page defaults `statusFilter` to `'active'`. A deep-linked asset must always be reachable — when `?asset=` is present and its target isn't in the currently-filtered list, reset both `riskFilter` and `statusFilter` to `'all'` so the target becomes visible. Do this only when the target would otherwise be hidden, not unconditionally.
- Visually distinguish the target card (temporary ring/border) and scroll it into view on mount, using a `useRef` map keyed by prediction id — do not auto-expand `expandedId` (distinct, user-toggled affordance).
- Not-found case: `getFailurePredictionHistory()` is already tenant-scoped server-side, so a cross-tenant `asset_id` never appears in the returned list — no match, no scroll, no error, page renders normally.

**Shared conventions**
- Both links use plain Next.js navigation (`<a href>`, not `next/link`'s `<Link>`) — keep consistency with the existing two rows in `AIRiskAlertsPanel.tsx`.
- `RiskAlerts` TS interface (`apps/web/lib/api/ai.ts`) needs `id: string` added to `maintenance_risks` (the `housekeeping_risks` type already has `room_id: string`, no change needed there).

### Claude's Discretion
- Whether to strip the `?room=`/`?asset=` param from the URL after consuming it (`router.replace`) — either is acceptable; a lingering param is harmless since the effect is idempotent.
- Exact visual treatment for the engineering predictions page's "target card" highlight (ring color/duration) — should read as a clear, obviously-temporary highlight consistent with existing `--alert`/`--caution` CSS variables already used throughout this file, not a new color.
- Test approach: follow whatever test convention already exists for these specific files (check for existing frontend test coverage before deciding whether to add new tests, vs. relying on `type-check`/`lint`/manual browser verification).

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. Phase 27 (reassign/escalate/acknowledge actions) depends on this phase's links existing but is out of scope here.
</user_constraints>

## Summary

All five locked decisions in CONTEXT.md were verified directly against the live code and are implementable exactly as stated — no deviations needed. The backend change is genuinely a single-line select addition with no test to break (`test_ai_copilot_rbac.py` only asserts role-gating on `/ai/risk-alerts`, not response shape). The frontend work is two independent, mechanically similar changes, but each has one concrete implementation trap not spelled out in CONTEXT.md that the planner must handle correctly:

1. **Housekeeping side**: `RoomStatusBoard.tsx` reuses the identifier `rooms` for two *different* values in the same file — the raw Zustand store field (destructured as `allRooms`) and a locally filtered/derived `const rooms` (line 250, after `filterHousekeepingBoardRooms`). CONTEXT.md's phrase "the already-fetched room list (`useHousekeepingStore`'s `rooms`)" refers to the **store field** (`allRooms` locally), not the filtered local `rooms` — matching against the filtered list would make the deep link silently fail whenever an unrelated board filter (status chip, risk-only toggle, building filter) happens to be active. The planner must match against `allRooms` or the derived-but-unfiltered `displayRooms` (both defined before any filter is applied), never the local `const rooms`.

2. **Both sides — Suspense boundary**: This repo is on `next@16.3.0-preview.10` (App Router). Per the vendored official docs (`apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`), a Client Component that calls `useSearchParams()` **must** be wrapped in `<Suspense>` or the **production build fails** ("Missing Suspense boundary with useSearchParams"). Dev mode (`npm run dev:web`) will NOT surface this — routes render on-demand in dev and the bailout doesn't trigger — so a plain localhost walkthrough per CLAUDE.md's Self-Verification Policy will falsely appear to pass. The repo already has an established, working precedent for exactly this: `apps/web/app/(dashboard)/tasks/page.tsx` splits the page into a `TasksPageContent()` inner component (which calls `useSearchParams()`) and a default-export outer `TasksPage()` that wraps it in bare `<Suspense>` (no fallback prop). Both `RoomStatusBoard.tsx`'s consumer tree and `engineering/predictions/page.tsx` need the same split-and-wrap treatment. **`npm run build --workspace=@patelrep/web` must be run as part of verification, not just `npm run dev:web` + browser check**, to catch this class of error.

Additionally, `PredictionCard`'s outer element is `<Card>` (`apps/web/components/ui/Card.tsx`), a plain (non-`forwardRef`) function component that spreads `{...rest}` onto its own internal `<div>` — passing `ref={...}` directly to `<Card>` will trigger a React warning ("Function components cannot be given refs") and the ref will not attach. The scroll-into-view ref map must instead wrap a plain `<div ref={...}>` around the `<Card>` inside `PredictionCard`, not attempt to ref `Card` itself — this avoids touching the shared `Card` primitive (used broadly across the app) at all, honoring the non-regression policy.

**Primary recommendation:** Implement both links as described in CONTEXT.md, but (a) match the housekeeping deep link against `allRooms`/`displayRooms` (unfiltered), never the locally-filtered `rooms` const; (b) split both `RoomStatusBoard`'s search-param-reading logic and the entire `predictions/page.tsx` body into inner components wrapped in bare `<Suspense>` at their nearest page-level ancestor, mirroring `tasks/page.tsx` exactly; (c) implement the engineering scroll-ref as a wrapping `<div>` inside `PredictionCard`, not a ref on `<Card>`; (d) verify with a production build (`npm run build --workspace=@patelrep/web`), not just dev-mode browser testing, since the Suspense requirement is invisible in dev.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next/navigation (`useSearchParams`, `useRouter`) | next@16.3.0-preview.10 | Read `?room=`/`?asset=` query params in Client Components | Already the established pattern in this repo (`tasks/page.tsx`, `onboarding/page.tsx`) |
| React `useRef` | react@18.3.1 | Map of prediction-id → DOM node for scroll-into-view | Standard React pattern, no library needed |

### Supporting
None — no new dependencies required for this phase.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `<Suspense>` split-component pattern | `export const dynamic = 'force-dynamic'` on the page | Docs explicitly say this is legacy; current guidance prefers `connection()` in a Server Component — but these pages are already fully `'use client'` with no Server Component wrapper, so neither applies here. The Suspense-boundary split is the only available fix for a `'use client'` page. |
| Matching against `useSearchParams()` directly in `RoomStatusBoard.tsx` | Reading `?room=` in `housekeeping/page.tsx` (parent) and passing as a prop | CONTEXT.md explicitly locks the target component as `RoomStatusBoard.tsx` itself; a prop-drilling approach would still need the Suspense boundary at the page level either way, so no benefit — stick with the locked decision. |

No installation needed — nothing to add to `package.json`.

## Architecture Patterns

### Pattern 1: Query-param-driven state hydration via existing setter, gated on data readiness
**What:** Read a URL query param, wait for the relevant data collection to be populated (not empty/loading), find the match, call the *existing* state setter that a manual user action already uses.
**When to use:** Any deep-link into a client-side list/board pattern in this codebase.
**Example (housekeeping, illustrative — not exact production code):**
```tsx
// apps/web/components/housekeeping/RoomStatusBoard.tsx
'use client'
import { useSearchParams } from 'next/navigation'
// ... existing imports

export function RoomStatusBoard() {
  const searchParams = useSearchParams()
  // ... existing hooks, including `allRooms` from useHousekeepingStore and `displayRooms` (useMemo)

  useEffect(() => {
    const roomId = searchParams.get('room')
    if (!roomId || allRooms.length === 0) return
    const match = displayRooms.find((r: any) => r.room_id === roomId)
    if (match) setSelectedRoom(withLateCheckout(match))
    // no match => no-op, graceful (room deleted / cross-tenant / already cleaned off today's board)
  }, [searchParams, allRooms, displayRooms, withLateCheckout])
  // ...
}
```
**Critical:** `allRooms` (aliased from the store's `rooms` field) and `displayRooms` (its normalized `useMemo`, line ~236-239) are unfiltered by the board's UI filters (status chips, risk-only toggle, building filter). The locally-shadowed `const rooms` (line 250, `filterHousekeepingBoardRooms(...)`) is filtered and must NOT be used for the match — that would make the deep link silently fail depending on which filter chip a manager happened to have active.

### Pattern 2: Suspense-wrapped page split (established in this repo)
**What:** Move all logic that calls `useSearchParams()` into an inner `*Content` component; the default-exported page component wraps it in a bare `<Suspense>` (no fallback needed, matching `tasks/page.tsx`'s existing convention).
**When to use:** Any `'use client'` page/page-descendant that newly needs `useSearchParams()`.
**Example (source: `apps/web/app/(dashboard)/tasks/page.tsx` lines 517-738, already in the codebase):**
```tsx
function TasksPageContent() {
  const searchParams = useSearchParams()
  // ...all existing logic...
}

export default function TasksPage() {
  return (
    <Suspense>
      <TasksPageContent />
    </Suspense>
  )
}
```
**Applied to this phase:**
- `apps/web/app/(dashboard)/engineering/predictions/page.tsx`: rename current `PredictionsPage` body to `PredictionsPageContent`, add a new `export default function PredictionsPage() { return <Suspense><PredictionsPageContent /></Suspense> }`.
- `apps/web/app/(dashboard)/housekeeping/page.tsx`: `RoomStatusBoard` is nested inside `SupervisorHousekeepingPage` (itself nested inside the role-gated default export `HousekeepingPage`). The minimal-blast-radius fix is to wrap just the `<RoomStatusBoard />` usage at `housekeeping/page.tsx` line 741 in `<Suspense><RoomStatusBoard /></Suspense>` — this satisfies the Next.js requirement without touching `HousekeeperMyRoomsView` or any other sibling path, honoring the non-regression policy (those paths don't call `useSearchParams` and shouldn't be forced through a Suspense/CSR bailout).

### Pattern 3: Ref map for scroll-into-view without touching a shared non-forwardRef component
**What:** `Card` (`apps/web/components/ui/Card.tsx`) is a plain function component that does not use `React.forwardRef` — passing it a `ref` prop directly produces a React warning and the ref never attaches to the DOM node. Wrap a plain `<div ref={...}>` around `<Card>` inside `PredictionCard` instead.
**Example:**
```tsx
// inside PredictionCard, apps/web/app/(dashboard)/engineering/predictions/page.tsx
function PredictionCard({ prediction, cardRef, isDeepLinkTarget, ...rest }: PredictionCardProps & {
  cardRef?: (el: HTMLDivElement | null) => void
  isDeepLinkTarget?: boolean
}) {
  return (
    <div ref={cardRef}>
      <Card className={`... ${isDeepLinkTarget ? 'ring-2 ring-[var(--caution)] ring-offset-2' : ''}`}>
        {/* existing content unchanged */}
      </Card>
    </div>
  )
}
```
```tsx
// in PredictionsPageContent
const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})
const [highlightedId, setHighlightedId] = useState<string | null>(null)

useEffect(() => {
  const assetId = searchParams.get('asset')
  if (!assetId || !predictions) return
  const target = allPredictions.find((p) => p.asset_id === assetId)
  if (!target) return
  const isVisible = filtered.some((p) => p.id === target.id)
  if (!isVisible) {
    setRiskFilter('all')
    setStatusFilter('all')
  }
  setHighlightedId(target.id)
  // scroll after the (possibly filter-triggered) re-render puts the card in the DOM
  requestAnimationFrame(() => cardRefs.current[target.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  const timer = setTimeout(() => setHighlightedId(null), 3000)
  return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [searchParams, predictions])
```
Note: the effect must re-run/re-scroll after a filter reset causes `filtered` to change (the target card may not exist in the DOM yet on the same tick the filter state changes) — `requestAnimationFrame` or a small `setTimeout(0)` is the pragmatic fix; a cleaner alternative is a second `useEffect` keyed on `[filtered, highlightedId]` that performs only the scroll once the target id is confirmedly present in `filtered`.

### Anti-Patterns to Avoid
- **Don't add a second `expandedId`-like state for the highlight** — CONTEXT.md explicitly forbids conflating deep-link arrival with the user-toggled "show more reasoning" affordance (`expandedId`). Use a separate `highlightedId` (or boolean per-card) state.
- **Don't ref `<Card>` directly** — it isn't `forwardRef`-wrapped; wrap a plain `<div>` instead (see Pattern 3).
- **Don't match against the filtered `rooms` local variable in `RoomStatusBoard.tsx`** — use `allRooms`/`displayRooms` (see Pattern 1).
- **Don't skip the production build check** — `npm run dev:web` + browser walkthrough alone will NOT catch a missing Suspense boundary; the bug only surfaces in `npm run build --workspace=@patelrep/web`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reading/updating URL query params | Manual `window.location.search` parsing | `next/navigation`'s `useSearchParams()` / `useRouter()` | Already the codebase convention (`tasks/page.tsx`, `onboarding/page.tsx`); SSR/hydration-safe |
| "Is this room still valid for this tenant" check | New guard/error-boundary code | Existing tenant-scoped Supabase queries (`.eq("tenant_id", ...)` server-side on both `housekeeping-board` and `failure-predictions/history`) | Both endpoints already exclude cross-tenant/deleted rows before the frontend ever sees them — a "not found" is just an empty search result, not a special case to build |

**Key insight:** The "graceful not-found" success criterion (AI-07/AI-08 criterion 3) is already satisfied by existing backend tenant-scoping — this phase needs zero new error-handling code for that case, only a `.find()` that can legitimately return `undefined`.

## Common Pitfalls

### Pitfall 1: Suspense boundary invisible in dev mode
**What goes wrong:** Adding `useSearchParams()` to `RoomStatusBoard.tsx` or `predictions/page.tsx` without a `<Suspense>` wrapper appears to work perfectly under `npm run dev:web` — the feature "looks done" in a browser walkthrough.
**Why it happens:** Per official Next.js docs, dev-mode routes render on-demand and don't trigger the CSR-bailout/prerender path that requires Suspense; only `npm run build` (production) enforces it.
**How to avoid:** Run `npm run build --workspace=@patelrep/web` (the exact command in this repo's CLAUDE.md Railway build section) as part of verification, not just dev-server browser testing.
**Warning signs:** Build output containing "Missing Suspense boundary with useSearchParams" — this is a hard build failure, not a warning.

### Pitfall 2: Variable name collision (`rooms`) hides the wrong list
**What goes wrong:** `RoomStatusBoard.tsx` destructures the store's `rooms` field as `allRooms` (line 213) but then declares a *new*, differently-scoped `const rooms` (line 250) holding the filtered/floor-grouped list. Skimming for "the room list" and grabbing the nearest `rooms` identifier gets the wrong (filtered) one.
**Why it happens:** Natural variable-name reuse within a 746-line component; CONTEXT.md's own phrasing ("`useHousekeepingStore`'s `rooms`") is technically about the store field, not the local shadowed name.
**How to avoid:** Explicitly match against `allRooms` or `displayRooms` (both defined at lines 213 and 236-239, before any UI filter is applied).
**Warning signs:** Deep link works when "All" filter chip is active but silently fails to open the drawer whenever a status/risk/building filter is engaged.

### Pitfall 3: `ref` on a non-forwardRef component
**What goes wrong:** Passing `ref={...}` straight to `<Card>` to enable scroll-into-view produces `Warning: Function components cannot be given refs` in the console and the scroll never happens (ref stays `null`).
**Why it happens:** `apps/web/components/ui/Card.tsx` is a plain function component, not wrapped in `React.forwardRef`.
**How to avoid:** Wrap a plain `<div ref={...}>` around the existing `<Card>` element inside `PredictionCard` rather than modifying the shared `Card` primitive (which is used broadly across the app and shouldn't be touched for a single-page need, per the non-regression policy).
**Warning signs:** Console warning on any browser walkthrough of the predictions page after the change; `cardRefs.current[id]` staying `null`.

### Pitfall 4: Prediction history is capped at 50 rows
**What goes wrong:** `GET /failure-predictions/history` (`apps/api/routers/assets.py:85-99`) is `.order("generated_at", desc=True).limit(50)`. If the deep-linked asset's most recent prediction has aged out of the top 50 (unlikely in the 5-row dashboard-panel-to-history-page window, but possible with high prediction volume), `allPredictions.find(...)` returns `undefined` even though the asset and its prediction genuinely still exist and belong to the same tenant.
**Why it happens:** The history endpoint was designed as a bounded recent-history view, not an exhaustive index.
**How to avoid:** No code change needed — this degrades exactly like the "not found" case (page renders normally, no highlight, no error), which satisfies the success criterion as written. Worth noting in case a future bug report says "the link doesn't highlight" for an asset that's still real — it's expected given the 50-row cap, not a regression.
**Warning signs:** N/A for this phase — flagging as a known limitation, not a defect to fix.

## Code Examples

### Backend: one-line select change
```python
# apps/api/routers/ai_copilot.py, inside get_risk_alerts(), ~line 782-788
asset_risks = supabase.table("assets")\
    .select("id, name, failure_risk_score")\
    .eq("tenant_id", current_user.hotel_id)\
    .gte("failure_risk_score", 70)\
    .order("failure_risk_score", desc=True)\
    .limit(5)\
    .execute()
```

### Frontend type: add `id` to `maintenance_risks`
```typescript
// apps/web/lib/api/ai.ts, ~line 127-136
export interface RiskAlerts {
  housekeeping_risks: Array<{
    room_id: string
    risk_level: string
    predicted_ready_at: string
    rooms: { room_number: string }
  }>
  maintenance_risks: Array<{ id: string; name: string; failure_risk_score: number }>
  sla_breaches: Array<{ work_order_number: string; title: string; due_at: string }>
}
```

### AIRiskAlertsPanel.tsx: housekeeping link (existing element, change href)
```tsx
// apps/web/components/dashboard/AIRiskAlertsPanel.tsx, ~line 88-93
<a
  href={`/housekeeping?room=${r.room_id}`}
  className="text-xs text-[var(--caution)] hover:underline shrink-0"
>
  Reassign
</a>
```

### AIRiskAlertsPanel.tsx: maintenance link (new element — none exists today)
```tsx
// apps/web/components/dashboard/AIRiskAlertsPanel.tsx, ~line 126-140 (maintenance risks block)
{alerts?.maintenance_risks?.map((r, i) => (
  <div key={i} className="border-l-4 border-[var(--caution)] bg-surface/60 rounded-xl mb-2 p-3 flex items-start gap-3">
    <Zap size={16} className="text-[var(--caution)] mt-0.5 shrink-0" />
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className="text-sm text-ink2">
          {r.name} — {r.failure_risk_score}% failure risk
        </p>
        <span className="px-1.5 py-0.5 bg-[var(--caution-soft)] text-[var(--caution)] text-xs font-semibold rounded uppercase">
          MAINT
        </span>
      </div>
    </div>
    <a
      href={`/engineering/predictions?asset=${r.id}`}
      className="text-xs text-[var(--caution)] hover:underline shrink-0"
    >
      View
    </a>
  </div>
))}
```
(New `<a>` mirrors the exact styling of the SLA-breach row's existing "View" link at line 116-121, for visual consistency within the same panel.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `export const dynamic = 'force-dynamic'` to force dynamic rendering for pages needing search params | `connection()` from `next/server` in a Server Component | Documented as current guidance in the vendored Next.js 16 docs | Not applicable here — both target files are `'use client'` pages/components with no Server Component ancestor in this route segment, so the only available mechanism is the `<Suspense>` boundary split, which is also the pattern already used elsewhere in this codebase (`tasks/page.tsx`). No migration needed, just consistency. |

**Deprecated/outdated:** None relevant — `useSearchParams()` and `<Suspense>` boundary requirements have been stable since Next.js 13.4+ per the vendored docs' version history (introduced v13.0.0, Suspense requirement has been consistent since).

## Open Questions

1. **Should the housekeeping deep-link match use `displayRooms` (normalized) or raw `allRooms`?**
   - What we know: `displayRooms` = `allRooms.map(normalizeHousekeepingBoardRoom)` (line 236-239), unfiltered by UI filters either way.
   - What's unclear: Whether `RoomDetailDrawer` needs the normalized shape or tolerates the raw store shape — a manual click passes `visibleRoom` (built from the *filtered* `rooms`, normalized, with `withLateCheckout` applied and any `pendingCleanType` override in assignment mode).
   - Recommendation: Use `displayRooms.find(...)` (normalized, unfiltered) and apply `withLateCheckout(match)` before calling `setSelectedRoom`, for closest parity with the manual-click path minus the assignment-mode-only `pendingCleanType` override (which is irrelevant outside assignment mode — deep links land from the dashboard, not while assignment mode is active).

2. **Exact ring highlight color/duration for the engineering predictions card.**
   - What we know: CONTEXT.md leaves this to Claude's discretion, constrained to existing `--alert`/`--caution` CSS variables.
   - What's unclear: No existing "temporary highlight" pattern exists elsewhere in this codebase to copy exactly (searched for `ring-` + highlight patterns, found none matching this use case).
   - Recommendation: `ring-2 ring-[var(--caution)] ring-offset-2` for ~3 seconds (matches the panel's own `--caution` theming for maintenance/AI-alert rows), cleared via `setTimeout`. This is a UI-polish decision with no functional risk either way.

## Sources

### Primary (HIGH confidence)
- `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md` — official Next.js 16 docs (vendored copy in this repo's own installed `next` package, per `apps/web/AGENTS.md`'s explicit instruction to read this over training-data assumptions), confirms Suspense-boundary requirement and dev-vs-prod behavior difference.
- Direct reads of all files named in CONTEXT.md and this task's key-decisions list: `apps/api/routers/ai_copilot.py` (lines 768-796), `apps/web/lib/api/ai.ts` (lines 124-168), `apps/web/components/dashboard/AIRiskAlertsPanel.tsx` (full file), `apps/web/components/housekeeping/RoomStatusBoard.tsx` (full file), `apps/web/app/(dashboard)/housekeeping/page.tsx` (full file), `apps/web/app/(dashboard)/engineering/predictions/page.tsx` (full file), `apps/web/lib/api/engineering.ts` (FailurePrediction interface), `apps/web/components/ui/Card.tsx` (full file), `apps/api/routers/assets.py` (lines 67-99), `apps/api/tests/test_ai_copilot_rbac.py` (line 77), `apps/web/package.json` (scripts/deps), `apps/web/stores/housekeepingStore.ts` (rooms field).
- `apps/web/app/(dashboard)/tasks/page.tsx` — confirmed as the live, working precedent for the exact Suspense-split pattern this phase needs to replicate.

### Secondary (MEDIUM confidence)
None used — all findings verified directly against this repo's own code and its own vendored official docs.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; existing `next/navigation` usage confirmed live in three other files in this exact repo.
- Architecture: HIGH — the Suspense-split pattern is copied verbatim from working code already in this repo (`tasks/page.tsx`), not inferred from general Next.js knowledge.
- Pitfalls: HIGH — Suspense requirement confirmed via the repo's own vendored docs (not training-data recall, per `apps/web/AGENTS.md`'s explicit warning that this Next.js version may differ from training data); `Card` non-forwardRef issue confirmed by reading the actual component source; variable-name collision confirmed by reading the actual `RoomStatusBoard.tsx` source; 50-row cap confirmed by reading the actual backend endpoint.

**Research date:** 2026-08-12
**Valid until:** 30 days (stable — no fast-moving dependencies; revisit if `next` is upgraded past 16.3.0-preview or if `RoomStatusBoard.tsx`/`predictions/page.tsx` are substantially refactored before this phase executes)

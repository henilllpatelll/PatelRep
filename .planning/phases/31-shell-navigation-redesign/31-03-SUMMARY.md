---
phase: 31-shell-navigation-redesign
plan: 03
subsystem: api
tags: [fastapi, supabase, ilike, nextjs, useSearchParams, deep-link]

# Dependency graph
requires:
  - phase: 26-deep-linked-alert-surfaces
    provides: "the ?asset= scroll-into-view + transient-highlight pattern on predictions/page.tsx, mirrored here for ?focus="
provides:
  - "Optional q -> title ilike filter on GET /work-orders (both engineer and default query branches) and GET /guest-requests, tenant-scoped, no-op when absent"
  - "engineeringApi.listWorkOrders / guestRequestsApi.listRequests forward an optional q param"
  - "?focus=<id> deep-link convention on work-orders, guest-requests, and SOP list pages, each opening the record's existing detail surface (drawer or inline panel)"
affects: [31-04-command-palette-record-search]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "?focus=<id> deep-link: read once via useSearchParams inside a Suspense-wrapped client page, resolve against already-tenant-scoped loaded data, open the existing detail surface (drawer/inline panel) rather than build a new one, track applied focus id in a ref so it fires once per id instead of on every re-render"

key-files:
  created: []
  modified:
    - apps/api/routers/work_orders.py
    - apps/api/routers/guest_requests.py
    - apps/web/lib/api/engineering.ts
    - apps/web/lib/api/guest_requests.ts
    - "apps/web/app/(dashboard)/engineering/work-orders/page.tsx"
    - "apps/web/app/(dashboard)/guest-requests/page.tsx"
    - apps/web/components/guest-requests/GuestRequestsPage.tsx
    - "apps/web/app/(dashboard)/sop/page.tsx"
    - apps/api/tests/test_work_order_archive.py
    - apps/api/tests/smoke/test_tenant_isolation.py
    - apps/api/RBAC-MATRIX.md

key-decisions:
  - "list_work_orders has two query code paths (engineer two-query branch via _base(), default branch); both needed q -> ilike('title', ...) applied separately since they build independent Supabase query chains"
  - "Work orders: opened the existing WorkOrderDetailDrawer (selectedWO/drawerOpen state) on focus match, rather than adding a new highlight-only affordance, since the Kanban layout has no natural single scroll target"
  - "Guest requests: opened the existing GuestRequestDrawer (drawerRequest state) inside GuestRequestsPage.tsx; the thin app-router page.tsx wrapper gained the Suspense boundary useSearchParams requires"
  - "SOP: opened the existing inline right-side detail panel (selectedDoc state), resetting category filter to All and clearing the search box first if the target would otherwise be hidden"
  - "All three pages track the applied focus id in a useRef (not just a highlightedId/selectedX state) so the deep-link action fires exactly once per id value instead of re-triggering on every re-render, since the effect's other dependency (loaded record list) is a non-memoized array id in one case (work-orders) and would otherwise re-fire"

patterns-established:
  - "?focus=<id> convention for entities without a natural full-page detail route: resolve against tenant-scoped list data already in memory, open the existing local detail-view state, no-op silently (no error, no toast) when the id is absent or not found"

# Metrics
duration: ~35min
completed: 2026-08-14
---

# Phase 31 Plan 03: Work Orders / Guest Requests Search Backend + Deep-Link Scaffolding Summary

**Additive `q` → `ilike("title", ...)` param on the Work Orders and Guest Requests list endpoints (both work-order query branches), plus `?focus=<id>` deep-link handling on work-orders, guest-requests, and SOP list pages that opens each record's existing detail drawer/panel — the non-shell backend half of NAV-04's record search, ready for 31-04's command palette to consume.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-14
- **Tasks:** 3 (all `type="auto"`, none required a checkpoint)
- **Files modified:** 11 (7 plan-listed + 3 test-fixture call sites fixed as a Rule-3 blocking deviation + 1 regenerated RBAC matrix)

## Accomplishments
- `GET /work-orders` and `GET /guest-requests` accept an optional `q` that filters by title via case-insensitive `ilike`, fully tenant-scoped, byte-identical behavior when `q` is absent
- `engineeringApi.listWorkOrders` / `guestRequestsApi.listRequests` forward `q` through their existing `params` spread — no call-site changes needed elsewhere
- Work-orders, guest-requests, and SOP list pages all honor `?focus=<id>`, opening the record's real detail surface (drawer or inline panel), with a silent no-op fallback for missing/stale/cross-tenant ids
- `npm run check:frozen-files` passes with zero drift — no shell/frozen file was touched, confirming full parallel-safety with 31-01

## Task Commits

Each task was committed atomically:

1. **Task 1: Add optional q → title ilike to Work Orders and Guest Requests list endpoints** - `45a72a89` (feat)
2. **Task 2: Forward q in the engineering + guest-requests web clients** - `d99f6c73` (feat)
3. **Task 3: Add ?focus=<id> deep-link handling to work-orders, guest-requests, and SOP list pages** - `041ed69f` (feat)

_No separate plan-metadata commit was made for this response; STATE.md/SUMMARY.md are being committed by the team lead per their existing workflow._

## Files Created/Modified
- `apps/api/routers/work_orders.py` - `list_work_orders` gained `q: Optional[str] = Query(None)`; `_base()` (engineer branch) and the default branch each apply `.ilike("title", f"%{q}%")` when `q` is truthy
- `apps/api/routers/guest_requests.py` - `list_guest_requests` gained the same `q` → `ilike("title", ...)` filter
- `apps/web/lib/api/engineering.ts` - `listWorkOrders` params type widened with `q?: string`
- `apps/web/lib/api/guest_requests.ts` - `listRequests` params type widened with `q?: string`
- `apps/web/app/(dashboard)/engineering/work-orders/page.tsx` - split into `WorkOrdersPageContent` + `Suspense`-wrapped default export; `?focus=<id>` resolves against the combined data from all 5 Kanban-column queries and opens `WorkOrderDetailDrawer`
- `apps/web/app/(dashboard)/guest-requests/page.tsx` - added the `Suspense` boundary `useSearchParams` requires around `GuestRequestsPage`
- `apps/web/components/guest-requests/GuestRequestsPage.tsx` - `?focus=<id>` resolves against `allRequests` and opens `GuestRequestDrawer` via the existing `drawerRequest` state
- `apps/web/app/(dashboard)/sop/page.tsx` - split into `SOPLibraryPageContent` + `Suspense`-wrapped default export; `?focus=<id>` resets category/search filters if needed and opens the existing inline detail panel via `selectedDoc`
- `apps/api/tests/test_work_order_archive.py` / `apps/api/tests/smoke/test_tenant_isolation.py` - direct router-function-call unit tests updated to pass `q=None` (and `room_id=None` where a prior test omitted it) explicitly — see Deviations
- `apps/api/RBAC-MATRIX.md` - regenerated (line-number drift only from the new `q` parameter shifting subsequent lines; still 30 routers, 293 routes)

## Decisions Made
- Both `list_work_orders` query paths (the `engineer` role's `_base()`-built two-query merge, and the default single-query branch) each got their own `if q: query = query.ilike("title", f"%{q}%")` — they are structurally independent Supabase query chains, so the filter could not be added once and shared
- For each of the three list pages, opened the *existing* detail surface (drawer/inline panel) rather than adding a new highlight-only affordance, per the plan's explicit preference where "the existing local state makes it a small change" — this gives 31-04's palette a real "navigate to and see full detail" experience, not just a scroll-and-flash
- Used a `useRef`-tracked "applied focus id" guard on all three pages instead of relying solely on state, since work-orders' underlying data source (`Object.values(columnData).flat()`, later replaced with a `useMemo`'d `allWOs`) and guest-requests' `allRequests` are not stable references across every render — without the ref guard the effect could re-open the drawer on unrelated re-renders after the user closed it

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a self-introduced variable-shadowing bug in `work_orders.py`'s `_base()` before it was ever committed**
- **Found during:** Task 1, while adding the `ilike` filter to the `engineer` branch's `_base()` helper
- **Issue:** The helper's local query-builder variable was named `q`, identical to the new outer `q` search-string parameter; `if q: q = q.ilike("title", f"%{q}%")` would have silently referred to the local query object (always truthy) instead of the search string, making the filter a no-op / runtime error
- **Fix:** Renamed the local query-builder variable inside `_base()` to `query`, leaving the outer `q` parameter unambiguous
- **Files modified:** `apps/api/routers/work_orders.py`
- **Verification:** `python -m ast` parse check, then full pytest run confirmed `ilike("title"` filters actually execute against `q`, not the query object
- **Committed in:** `45a72a89` (Task 1 commit, never landed as a separate broken commit)

**2. [Rule 3 - Blocking] Fixed 5 pre-existing direct-router-call unit tests broken by the new `q` parameter**
- **Found during:** Task 1's own test run (`pytest tests/ -k "work_order or guest_request"`)
- **Issue:** `test_tenant_isolation.py::test_work_orders_list_returns_empty_for_hotel_a`, `test_guest_requests_list_returns_empty_for_hotel_a`, and 3 tests in `test_work_order_archive.py` call `list_work_orders`/`list_guest_requests` directly as Python coroutines (not through `TestClient`/FastAPI's request pipeline). Calling a FastAPI route function directly without every `Query(...)`-defaulted kwarg means the *unfilled* parameter resolves to the raw `Query(None)` `FieldInfo` sentinel object (truthy), not `None` — so the new `q` param's `if q:` branch fired unconditionally and called `.ilike(...)` on fake test-double query builders that don't implement it, raising `AttributeError`
- **Fix:** Added `q=None` explicitly to all 5 direct call sites (and `room_id=None`, which the tenant-isolation test had also been implicitly omitting via the same sentinel-is-truthy quirk, harmlessly, since that test only asserts an empty result set)
- **Files modified:** `apps/api/tests/test_work_order_archive.py`, `apps/api/tests/smoke/test_tenant_isolation.py`
- **Verification:** `pytest tests/ -k "work_order or guest_request"` — 66 passed, 0 failed (was 5 failed before the fix)
- **Committed in:** `45a72a89` (Task 1 commit)

**3. [Rule 3 - Blocking] Regenerated stale `RBAC-MATRIX.md`**
- **Found during:** Task 1's full-suite verification (`pytest tests/`)
- **Issue:** `test_rbac_matrix_contract.py`'s CI drift guard failed — the new `q` parameter shifted line numbers the matrix generator embeds for each route's inline-RBAC-comparison annotations (same drift class documented in every prior phase that touched a router: 27-02, 28-01/02, 29-03/04)
- **Fix:** Ran `python apps/api/scripts/generate_rbac_matrix.py` and committed the regenerated file (still 30 routers, 293 routes — no route/role change, line-number references only)
- **Files modified:** `apps/api/RBAC-MATRIX.md`
- **Verification:** `pytest tests/smoke/test_rbac_matrix_contract.py` — 3 passed
- **Committed in:** `45a72a89` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (1 bug caught pre-commit, 2 blocking test-infra fixes)
**Impact on plan:** All three were mechanical consequences of adding a genuinely new endpoint parameter to already-tested code paths; no scope creep, no behavior change beyond what the plan specified. Full suite after fixes: 637 passed, 3 pre-existing unrelated `test_management_roi.py` failures (documented baseline since Phase 06).

## Issues Encountered
None beyond the deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 31-04 (command-palette record search) can now call `engineeringApi.listWorkOrders({ q })` / `guestRequestsApi.listRequests({ q })` for real, tenant-scoped, title-filtered results, and link results to `/engineering/work-orders?focus=<id>`, `/guest-requests?focus=<id>`, `/sop?focus=<id>`, or `/housekeeping?room=<id>` (existing frozen path) — all four entities now have a working navigation target
- No blockers. `npm run check:frozen-files`, `npm run check:i18n-parity`, `npm run type-check`, and `npm run build` all pass clean; full API suite at 637/640 (3 pre-existing unrelated failures)
- Live authenticated browser click-through (real record ids resolving to an opened drawer/panel) was not performed in this session — no browser-automation tool was available to this executor. Verified instead via: production build succeeding for all three routes with no Suspense-boundary error, a running `next start` build returning clean 307 auth-redirects (no 500/crash) for all three `?focus=<bogus-id>` URLs, and direct code-path tracing confirming each effect mirrors the proven Phase-26 `?asset=` pattern exactly. Recommend a live spot-check during 31-04 execution once the palette produces real ids to click through.

---
*Phase: 31-shell-navigation-redesign*
*Completed: 2026-08-14*

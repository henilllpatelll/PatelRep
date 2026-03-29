# Bug Fix List — Playwright Audit (2026-03-28)

Three confirmed bugs found via full route audit. Two share one root cause.

---

## Bug 1 — /billing shows "Billing is only accessible to hotel GMs" for a GM

**Route:** `/billing`
**File:** `apps/web/app/(dashboard)/billing/page.tsx` line 82–88

### What's happening

`billing/page.tsx` checks `!isGM` immediately on render, with no loading guard:

```tsx
// current (broken)
if (!isGM) {
  return <p>Billing is only accessible to hotel GMs.</p>
}
```

`role` in `authStore` is not persisted (see `partialize` in `authStore.ts` line 40 — only `user` and `session` are saved). So on every hard page load, `role` starts as `null`. Meanwhile, `useAuth.ts` calls `setLoading(false)` before `Providers.tsx`'s `fetchProfile()` has finished fetching the role from `/auth/me`. This creates a race window where `isAuthLoading=false` but `role=null`, causing the guard to fire.

### Fix

Add an auth-loading guard before the `!isGM` check:

```tsx
// apps/web/app/(dashboard)/billing/page.tsx

export default function BillingPage() {
  const { isGM, role } = useRole()                                    // add role
  const isAuthLoading = useAuthStore((state) => state.isLoading)      // ADD THIS LINE

  // ... existing useQuery calls ...

  // Replace the current guard (line 82–88) with:
  if (isAuthLoading || !role) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-amber-500" />
      </div>
    )
  }

  if (!isGM) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Billing is only accessible to hotel GMs.</p>
      </div>
    )
  }
  // ... rest of page ...
```

`useAuthStore` is already imported in the file (used by the existing `useRole` call chain). Just add the selector.

---

## Bug 2 — /reports shows "You do not have access to reports" for a GM

**Route:** `/reports`
**File:** `apps/web/app/(dashboard)/reports/page.tsx` lines 601–646

### What's happening

Same root cause as Bug 1. `reports/page.tsx` DOES have an `isAuthLoading` guard (line 633), but the guard is not enough on its own. Because `setLoading(false)` is called by `useAuth.ts` before `fetchProfile()` sets role via the API, there's a brief window where `isAuthLoading=false` AND `role=null`. During that window `tabs.length === 0` (no role → no tabs) → shows "no access".

### Fix

```tsx
// apps/web/app/(dashboard)/reports/page.tsx

export default function ReportsPage() {
  const { role, isGM, isSupervisor } = useRole()
  const isAuthLoading = useAuthStore((state) => state.isLoading)
  const [activeTab, setActiveTab] = useState<TabId>('daily')

  // ... tab building logic (unchanged) ...

  // Replace the existing loading check (line 633–639) with:
  if (isAuthLoading || !role) {                    // <-- add || !role
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
      </div>
    )
  }

  if (tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-500">You do not have access to reports.</p>
      </div>
    )
  }
  // ... rest of page unchanged ...
```

The only change is `|| !role` on the loading condition. `role` is already destructured on line 601.

---

## Root-Cause Fix (optional, addresses both Bug 1 & 2 at the source)

The two bugs above are symptoms of the same problem: `role` is not persisted in the Zustand auth store, so every hard navigation starts with `role=null`.

**File:** `apps/web/stores/authStore.ts` line 40

```ts
// current
partialize: (state) => ({ user: state.user, session: state.session }),

// fix — also persist role so it survives page refreshes
partialize: (state) => ({ user: state.user, session: state.session, role: state.role }),
```

If you make this change, Bugs 1 & 2 resolve without touching the page files (role is immediately available after hydration). The `fetchProfile()` call in `Providers.tsx` still runs and will overwrite it with the freshest value from the API.

**Note:** If a user's role is changed in the database (e.g., housekeeper promoted to supervisor), they will see the stale role until their next login or token refresh. This is acceptable for a hotel ops tool where role changes are infrequent and users can be asked to log out/in.

---

## Bug 3 — /logbook throws 10 React hydration errors on load

**Route:** `/logbook`
**File:** `apps/web/app/(dashboard)/logbook/page.tsx`
**Errors:** React #418 (hydration mismatch), #423 (root switches to client render), #425 (text content mismatch)

### What's happening

The page renders conditionally based on `isSupervisor` (which depends on `role`). On the server, `role=null` → `isSupervisor=false` → the `<AISummaryPanel>` is not rendered. On the client, after Zustand hydrates and `fetchProfile()` runs, `role='gm'` → `isSupervisor=true` → React tries to reconcile a different DOM tree → hydration mismatch.

The `<AISummaryPanel>` is visible in the logbook screenshot, meaning the client renders it but the server didn't — classic hydration mismatch.

### Fix

Wrap the role-gated `<AISummaryPanel>` in a `mounted` guard to skip it during server render:

```tsx
// apps/web/app/(dashboard)/logbook/page.tsx

export default function LogbookPage() {
  const today = todayIso()
  const [selectedDate, setSelectedDate] = useState(today)
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [mounted, setMounted] = useState(false)          // ADD THIS
  const { isSupervisor } = useRole()

  useEffect(() => { setMounted(true) }, [])              // ADD THIS

  // ... rest of component ...

  // Then wherever <AISummaryPanel> is rendered, gate it:
  {mounted && isSupervisor && (                          // ADD mounted &&
    <AISummaryPanel shiftDate={selectedDate} isSupervisor={isSupervisor} />
  )}
```

This makes the server and client agree on the initial render (no panel), then on the client after mount, the panel appears if the user is a supervisor/GM. The `mounted` pattern is the standard Next.js fix for role/auth-dependent conditional rendering.

**Alternative fix (cleaner but wider change):** Apply the root-cause fix from Bug 1/2 (persist role in authStore). If role is available immediately from localStorage on hydration, server and client both see `role=null` at render time (server has no localStorage), so the mismatch still exists — **the `mounted` guard is still needed regardless**.

---

## Minor — /billing breadcrumb shows "PatelRep" instead of "Billing"

The header breadcrumb on the billing page shows "PatelRep" (the app name) instead of the section name "Billing". Check the layout or `DashboardHeader` component that receives the title prop for the billing route and ensure it passes `"Billing"` or reads the route segment correctly.

---

## Summary (original bugs — fixed in commit c70d10b)

| # | Route | Fix file | Change |
|---|-------|----------|--------|
| 1 | `/billing` | `billing/page.tsx` | Add `isAuthLoading \|\| !role` guard before `!isGM` check |
| 2 | `/reports` | `reports/page.tsx` | Add `\|\| !role` to existing loading condition |
| Root | Both | `authStore.ts` | Add `role` to `partialize` (optional but clean) |
| 3 | `/logbook` | `logbook/page.tsx` | Add `mounted` state, gate `<AISummaryPanel>` with `mounted &&` |
| Minor | `/billing` | DashboardHeader/layout | Pass correct page title "Billing" |

---

---

# Bug Audit — Playwright Morning Shift (2026-03-28)

Five new bugs found via full route walkthrough. All routes tested as GM role.

---

## Bug A — /billing shows "Page Error" (wrong file was patched)

**Route:** `/billing`
**File:** `apps/web/app/(dashboard)/settings/billing/page.tsx` line 141–147

### What's happening

The sidebar "Billing" link routes to `/settings/billing`, which is a **different file** from
`apps/web/app/(dashboard)/billing/page.tsx` (the file patched for Bug 1). The
`settings/billing/page.tsx` still has the bare `!isGM` guard with no auth-loading check — same
root cause as Bug 1. Additionally, the simpler `/billing` page runs both `useQuery` calls without
`enabled: isGM`, so they fire immediately before auth resolves and can throw to the error boundary.

### Fix

Apply the same guard to `settings/billing/page.tsx` and add `enabled: isGM` to both queries:

```tsx
// apps/web/app/(dashboard)/settings/billing/page.tsx

export default function SettingsBillingPage() {
  const { isGM, role } = useRole()
  const isAuthLoading = useAuthStore((state) => state.isLoading)   // ADD

  const { data: subData, isLoading: subLoading } = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () => billingApi.getSubscription(),
    select: (res) => res.data as Subscription,
    enabled: isGM,   // already present — keep
  })
  // ... same for credits and invoices queries ...

  // Replace bare !isGM guard (line 141) with:
  if (isAuthLoading || !role) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-amber-500" />
      </div>
    )
  }

  if (!isGM) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Billing is only accessible to hotel GMs.</p>
      </div>
    )
  }
```

Also add `import { useAuthStore } from '@/stores/authStore'` at the top.

---

## Bug B — Room detail panel shows stale status after status change action

**Route:** `/housekeeping` (Room Board)
**File:** `apps/web/app/(dashboard)/housekeeping/page.tsx` (room detail panel / status mutation)

### What's happening

After clicking "Mark In Progress" on a room, the panel's "CURRENT STATUS" badge continues to show
"DIRTY". The board filter counts (e.g. "In Progress 0") also don't update until a hard page reload.
The mutation succeeds (confirmed: after reload, Dirty 113 / In Progress 1), but the React Query
cache for the room board and the panel's local state are not invalidated after the mutation.

### Fix

In the mutation's `onSuccess` callback, call `queryClient.invalidateQueries` with the board query
key so the board re-fetches and the panel re-renders with fresh status. If the panel reads from
local state rather than the cache, reset local status state directly in `onSuccess` as well.

---

## Bug C — Logbook and Reports date shows tomorrow for US timezones

**Routes:** `/logbook`, `/reports`
**Files:**
- `apps/web/app/(dashboard)/logbook/page.tsx` — `todayIso()` helper (line ~26)
- `apps/web/app/(dashboard)/reports/page.tsx` — report date default

### What's happening

`todayIso()` is implemented as:
```ts
return new Date().toISOString().split('T')[0]
```
`toISOString()` always returns UTC. For users in US timezones (UTC-5 / UTC-6), any time after
6–7 PM local time returns the next calendar day. During testing at ~7:30 PM CT, both the logbook
and the report date showed **2026-03-29** while the local date was **2026-03-28**.

### Fix

Use local date components instead of ISO string:

```ts
// apps/web/app/(dashboard)/logbook/page.tsx

function todayIso(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const dd   = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
```

Apply the same pattern wherever the reports page computes its default date.

---

## Bug D — /scheduling fails to load ("Failed to load schedule. Try again.")

**Route:** `/scheduling`
**File:** `apps/web/app/(dashboard)/scheduling/page.tsx`

### What's happening

The scheduling page shows "Failed to load schedule. Try again." on every load. The API call to
the scheduling endpoint is returning an error. This may be a backend issue (endpoint not
implemented, table empty, or auth scope missing) or a query construction error on the frontend.

### Fix

1. Check the API response in the Network tab — identify the status code and error body.
2. If the backend endpoint `/v1/scheduling` is not yet implemented, add an empty-state fallback
   instead of surfacing the raw error.
3. If it's a frontend query error (bad params, wrong URL), fix the query construction in the
   scheduling API client.

---

## Bug E — Lost & Found stat cards show 0 despite items existing

**Route:** `/lost-found`
**File:** `apps/web/app/(dashboard)/lost-found/page.tsx`

### What's happening

The four stat cards (FOUND / CLAIMED / DONATED / DISCARDED) all display 0 even though at least
one item (an IPAD, ~16 hours old) is visible in the list. The item list and the stat counts appear
to be driven by separate queries or derived differently — one is working, the other is not.

### Fix

Check whether the stat cards use a separate summary/count API endpoint or derive counts from the
same list query. If separate, confirm the count endpoint is returning data. If derived, verify the
status field value on the IPAD item matches the expected enum values (`found`, `claimed`, etc.) —
a casing or value mismatch would cause it to be excluded from all count buckets while still
appearing in the "All" list.

---

## Summary (new bugs — unfixed)

| # | Route | Fix file | Severity |
|---|-------|----------|----------|
| A | `/billing` (`/settings/billing`) | `settings/billing/page.tsx` | High — page crash for GM |
| B | `/housekeeping` room panel | room board mutation `onSuccess` | Medium — stale UI |
| C | `/logbook`, `/reports` | `logbook/page.tsx`, `reports/page.tsx` | Medium — wrong date shown |
| D | `/scheduling` | `scheduling/page.tsx` + API | High — full page failure |
| E | `/lost-found` | `lost-found/page.tsx` | Low — counter mismatch |

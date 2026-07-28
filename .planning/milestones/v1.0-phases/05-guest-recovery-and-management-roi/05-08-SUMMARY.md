---
phase: 05-guest-recovery-and-management-roi
plan: 08
subsystem: ui
tags: [nextjs, react-query, lost-and-found, rbac, retention, disposition]

# Dependency graph
requires:
  - phase: 05-guest-recovery-and-management-roi
    provides: "05-04: POST/GET /lost-found retention_due_at + disposition_due filter, POST /lost-found/{id}/custody-events with front_desk/housekeeping_supervisor/gm role gate (D-10, D-11, D-12)"
provides:
  - "Retention countdown ('Retention ends in X') and a derived 'Due for disposition' caution Pill on every unclaimed lost & found item card (D-10)"
  - "'Due for disposition' one-click filter chip using GET /lost-found?disposition_due=true, with 05-UI-SPEC.md empty-state copy verbatim (D-11)"
  - "Inline, per-item Custody history disclosure listing all lost_found_custody_events chronologically"
  - "Manager-gated (gm, housekeeping_supervisor, front_desk) Approve Disposition confirm flow that writes an append-only 'disposition' custody event (D-11, D-12)"
  - "isDispositionDue(item, now?) shared predicate exported from apps/web/lib/api/lost_found.ts"
affects: [05-09, 05-10, 05-11, 05-12, lost-found, management-roi]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Derived-flag Pill kept structurally separate from the status enum (STATUS_TONE/STATUS_LABELS untouched) so a disposition-due item still reads as 'Unclaimed' until a human acts on it"
    - "Per-item disclosure components (CustodyHistory) run their own scoped useQuery with enabled:<expanded> so custody history is fetched on demand, not eagerly for every card"

key-files:
  created: []
  modified:
    - apps/web/lib/api/lost_found.ts
    - "apps/web/app/(dashboard)/lost-found/page.tsx"

key-decisions:
  - "recordCustodyEvent's payload type was widened from Omit<LostFoundCustodyEvent, 'id'|'created_at'> to an explicit optional-field shape, matching the plan's fix for a disposition-only call being blocked by the old Omit-derived type"
  - "The Approve Disposition button is never hard-gated on isDispositionDue(item) — a manager may legitimately dispose of an item before its retention date with a documented reason; the caution styling only signals urgency"
  - "Retention/caution UI is gated on item.status === 'unclaimed' at the render site, mirroring isDispositionDue's own internal status check, so claimed/donated/discarded cards never show a retention line"

patterns-established: []

requirements-completed: [D-10, D-11, D-12]

# Metrics
duration: ~20 min active
completed: 2026-07-24
---

# Phase 5 Plan 08: Lost & Found Retention and Disposition UI Summary

**Surfaced the retention/custody workflow that existed only in the database since migration 072/084: a retention countdown, a manager review-queue filter, inline custody history, and a role-gated Approve Disposition confirm flow on `lost-found/page.tsx`.**

## Performance

- **Duration:** ~20 min active work
- **Started:** 2026-07-24T19:22:00-05:00 (approx, first Read call)
- **Completed:** 2026-07-24T19:41:44-05:00 (Task 3 commit)
- **Tasks:** 3 (all auto)
- **Files modified:** 2

## Accomplishments
- `apps/web/lib/api/lost_found.ts` now exposes `disposition_flagged_at`, `disposition_approved_by`, `release_verified_at`, `release_verification_method` on `LostFoundItem`; a `disposition_due` filter param on `listItems`; a widened `recordCustodyEvent` payload type; and a shared `isDispositionDue(item, now?)` predicate (D-10).
- Unclaimed item cards show a `Retention ends in X` line (Clock icon, `text-ink3`), or a `<Pill tone="caution">Due for disposition</Pill>` next to the status pill once retention has expired; `tag_identifier` renders in `font-mono` per the UI-SPEC numeric-identifier rule.
- A `Due for disposition` filter chip drives `GET /lost-found?disposition_due=true` via `queryKey: ['lost-found', dispositionDueOnly]`; the empty state renders the UI-SPEC's exact copy ("Nothing due for disposition" / "Items flagged after their 90-day retention period passes will show up here for manager review.").
- A new `CustodyHistory({ itemId })` disclosure component, embedded in every item card, lazily fetches and lists `intake`/`moved`/`released`/`disposition` events chronologically with their recorded metadata (storage location, recipient, verification method, disposition, note).
- `canApproveDisposition` mirrors the API's exact 403 role set (`gm`, `housekeeping_supervisor`, `front_desk` — D-12, including `front_desk` deliberately per the locked decision). The `Approve Disposition` button opens a cloned inline-confirm overlay (donated/discarded choice, optional note, `useModalFocusTrap`, verbatim UI-SPEC copy) whose mutation posts `event_type: 'disposition'` and invalidates both the item list and custody-history queries.
- `STATUS_TONE`/`STATUS_LABELS` remain untouched (still exactly the 4 real enum keys) — the disposition-due flag stays a derived, separately-rendered `Pill`, never conflated with `status`.
- No bulk, timer, or `useEffect`-driven disposal path exists anywhere in the file — verified by the plan's negative acceptance criteria (no `setInterval`, no `useEffect`, no "bulk"/"dispose all" strings).
- Full verification suite green: `npm run type-check`, `npm run lint`, and `npm run build` (with locally-supplied placeholder Supabase env vars — see Issues Encountered) all pass; `/lost-found` prerenders cleanly in the production build.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend the lost & found client with retention and disposition fields** - `17b12340` (feat)
2. **Task 2: Retention countdown, disposition-due filter, and custody history on the item card** - `a32fd863` (feat)
3. **Task 3: Manager-gated disposition approval with a permanent-record confirmation** - `3d8604cf` (feat)

## Files Created/Modified
- `apps/web/lib/api/lost_found.ts` - retention/disposition fields on `LostFoundItem`, `disposition_due` filter param, widened `recordCustodyEvent` payload type, exported `isDispositionDue()`
- `apps/web/app/(dashboard)/lost-found/page.tsx` - `dispositionDueOnly` filter chip + query, per-item retention line / caution flag / `tag_identifier`, new `CustodyHistory` component, `canApproveDisposition` role gate, disposition confirm overlay, `approveDisposition` mutation

## Decisions Made
See `key-decisions` in frontmatter. Summary: widened the custody-event payload type to unblock disposition-only calls; the Approve Disposition control stays visible (not hard-gated) once an item is unclaimed regardless of retention date, since managers may document an early disposition; retention/caution UI is scoped to `status === 'unclaimed'` at every render site.

## Deviations from Plan

None - plan executed exactly as written. The plan's own `read_first` guidance (interfaces, existing patterns to clone, exact role set from `apps/api/routers/lost_found.py`) matched the actual codebase state exactly, so no Rule 1-3 fixes were needed.

## Issues Encountered
- **Fresh worktree had no installed dependencies.** `node_modules` did not exist at either the repo root or `apps/web/` in this worktree (unlike the prior discarded attempt's environment). Ran `npm install` at the repo root and again inside `apps/web/` to restore `tsc`/`eslint`/`next` and all type declarations before any verification command would run. This is a worktree-provisioning artifact, not a defect in this plan's code.
- **`npm run build` requires Supabase env vars that are intentionally absent locally** (per project CLAUDE.md: "No live API credentials in the local environment"). `Sidebar.tsx` → `useAuth()` → `createClient()` throws at prerender time for every `(dashboard)` page without `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`, failing unrelated pages (`/reports`, `/billing`) before ever reaching `/lost-found`. Supplied placeholder values (`https://placeholder.supabase.co` / `placeholder-anon-key`, not committed anywhere) as inline env vars for the build command only, which let the full production build complete and confirmed `/lost-found` prerenders without error. This is a pre-existing environment condition affecting every web plan in this worktree, not something introduced by this plan — flagging per project instructions.
- **Live authenticated browser verification (the plan's `<verification>` "Live localhost... as GM" step) was not performed.** Per CLAUDE.md's "Current Scope" section, there is no local `.env` with real Supabase credentials, so an authenticated GM session cannot be established against a locally running dev server in this worktree. All other verification (type-check, lint, production build, exhaustive grep against every plan acceptance criterion) passed. This mirrors the same environment constraint flagged in `05-04-SUMMARY.md`.

## User Setup Required
None - no external service configuration required. This plan surfaces existing backend endpoints (05-04) with no new environment variables or dashboard configuration.

## Next Phase Readiness
- Lost & found retention/disposition UI is fully wired: retention countdown, review-queue filter, custody history, and role-gated disposition approval are all live in code and pass automated verification.
- Live authenticated GM verification against a real Supabase-backed dev server remains outstanding (blocked on the same missing-local-credentials constraint noted throughout this worktree's Phase 5 work) — recommend a single manual pass across `05-05` through `05-12`'s new UI once real credentials are available, rather than per-plan.
- No blockers for downstream Phase 5 plans (05-09 through 05-12); this plan's files (`lib/api/lost_found.ts`, `lost-found/page.tsx`) are not touched by any other in-flight plan in this wave.

## Self-Check: PASSED

- `apps/web/lib/api/lost_found.ts` — FOUND, contains `disposition_due`, `disposition_flagged_at`, `export function isDispositionDue`
- `apps/web/app/(dashboard)/lost-found/page.tsx` — FOUND, contains `dispositionDueOnly`, `Nothing due for disposition`, `function CustodyHistory`, `Approve Disposition`, `event_type: 'disposition'`
- Commit `17b12340` (Task 1) — FOUND
- Commit `a32fd863` (Task 2) — FOUND
- Commit `3d8604cf` (Task 3) — FOUND

---
*Phase: 05-guest-recovery-and-management-roi*
*Completed: 2026-07-24*

---
phase: 15-work-order-bulk-archive
plan: 02
subsystem: web
tags: [nextjs, react-query, i18n, work-orders, engineering]

requires: ["15-01"]
provides:
  - "engineeringApi.bulkArchiveWorkOrders / bulkArchiveWorkOrdersByAge / bulkUnarchiveWorkOrders client methods"
  - "listWorkOrders accepts an archived boolean param"
  - "BulkArchiveModal — checkbox-select + age-based archive picker"
  - "ArchivedWorkOrdersPanel — archived-list view with per-row Restore"
  - "Third 'Archived' tab + manager-only 'Archive...' action on the Work Orders page"
affects: []

tech-stack:
  added: []
  patterns:
    - "Bulk-action modal fetches an open-ended page and filters client-side to the two archivable statuses, rather than adding a combined multi-status backend filter — matches the plan's low-frequency, small-dataset guidance"
    - "['work-orders', 'archived'] query key is a prefix match under the page's existing ['work-orders'] Realtime invalidation, so no new subscription code was needed for the Archived tab to live-update"

key-files:
  created:
    - apps/web/components/engineering/BulkArchiveModal.tsx
    - apps/web/components/engineering/ArchivedWorkOrdersPanel.tsx
  modified:
    - apps/web/lib/api/engineering.ts
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts
    - apps/web/app/(dashboard)/engineering/work-orders/page.tsx

key-decisions:
  - "Archive... button uses Button variant='outline' (a real, pre-existing non-primary variant) rather than inventing a new one, per the plan's explicit instruction to check Button's exported variants first"
  - "activeTab ternary changed to a 3-way if/else-if/else (work-orders / room-board / archived) rather than nested nested ternary soup, keeping each branch readable"
  - "FailurePredictionSidebar's existing activeTab === 'work-orders' condition was left completely untouched — confirmed it already correctly excludes the new 'archived' tab with zero code changes needed"

patterns-established:
  - "Manager-only bulk-mutation modal pattern (BulkArchiveModal): checkbox multi-select + a secondary single-field bulk-criteria control (age cutoff) in the same modal, each with its own useMutation and inline ApiClientError-derived error text"

duration: ~50min
completed: 2026-08-03
---

# Phase 15 Plan 02: Work-Order Bulk-Archive Frontend Summary

**Extended the engineering API client with three bulk-archive endpoints, built a checkbox/age-based BulkArchiveModal and a restore-capable ArchivedWorkOrdersPanel, and wired both into a new third "Archived" tab plus a manager-only "Archive..." action on the Work Orders page — all backed by Plan 15-01's already-tested API contract.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 3 (all executed and committed individually, exactly as planned)
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- `engineeringApi.listWorkOrders` accepts an `archived` boolean param; three new typed methods (`bulkArchiveWorkOrders`, `bulkArchiveWorkOrdersByAge`, `bulkUnarchiveWorkOrders`) added, matching the existing method style.
- `BulkArchiveModal`: fetches open-ended work orders, filters client-side to `completed`/`cancelled`, lets a manager multi-select via checkbox and archive in one call, or specify an age cutoff and archive all completed work orders older than N days — both paths surface inline `ApiClientError`-derived error text and call `onArchived()` + `onClose()` on success.
- `ArchivedWorkOrdersPanel`: flat list of archived work orders (`archived: true` query) with a per-row manager-gated Restore button that calls `bulkUnarchiveWorkOrders` and invalidates `['work-orders']`.
- Work Orders page gained a third `PageHeader` tab ("Archived") rendering `ArchivedWorkOrdersPanel`, and a manager-only "Archive..." action button (next to "New Work Order") opening `BulkArchiveModal`.
- All new user-facing strings (19 keys) added to both `en.ts` and `es.ts` at parity, including CLDR `_one`/`_other` plural pairs for selected-count and success-count copy.
- Existing Kanban (5 columns), AI triage, Create Work Order modal, and Room Board tab are unmodified — confirmed via diff review and full type-check/lint passes.

## Task Commits

1. **Task 1: Extend engineering.ts API client** - `0544505e` (feat)
2. **Task 2: Locale keys + BulkArchiveModal + ArchivedWorkOrdersPanel** - `61d3c4a8` (feat)
3. **Task 3: Wire Archived tab + Archive action into work-orders page** - `ef077e50` (feat)

## Files Created/Modified
- `apps/web/lib/api/engineering.ts` - `archived` param on `listWorkOrders`; three new bulk-archive/unarchive methods
- `apps/web/components/engineering/BulkArchiveModal.tsx` - new — checkbox-select + age-cutoff archive picker
- `apps/web/components/engineering/ArchivedWorkOrdersPanel.tsx` - new — archived-list view with Restore
- `apps/web/i18n/locales/en.ts` / `es.ts` - 19 new `workOrdersPage.archive*`/`tabArchived`/`archivedPanel*` keys at EN/ES parity
- `apps/web/app/(dashboard)/engineering/work-orders/page.tsx` - third tab, action button, modal render, 3-way content branch

## Decisions Made
- Followed the plan's implementation verbatim for all three tasks; no deviations from the specified component contracts, props, or wiring.
- Used `Button variant="outline"` for "Archive..." (confirmed against `components/ui/Button.tsx`'s real exported variants before choosing, per the plan's explicit instruction not to invent a new one).

## Deviations from Plan

None — plan executed exactly as written for all three tasks' code content. One process note below regarding environment/tooling constraints encountered during Task 3's live-verification step.

### Environment / Tooling Notes (not code deviations)

**1. Migration 089 apply step is outside this executor's tool access.** The plan's Task 3 instructs applying `supabase/migrations/089_work_order_archive.sql` via the Supabase MCP tool (`mcp__plugin_supabase_supabase__apply_migration`). This executor (a named subagent in a multi-agent session) does not have that MCP tool in its available toolset — confirmed via `npx supabase migration list --linked`, which still shows `089` as local-only against the remote project at time of writing. Flagged to the team-lead/orchestrator via SendMessage with the exact SQL, mirroring the established 06-02 precedent (blocker resolved by the orchestrator applying it directly). This does not block plan closure — matches 15-01-SUMMARY.md's own explicit precedent of leaving migration 089 unapplied and flagging it as a pre-requisite for exercising 15-02 against real data, not a blocker on 15-02's code development.

**2. Two stale dev servers found and restarted (Rule 3 - blocking issue, auto-fixed).** Both `npm run dev:web` (:3000) and `npm run dev:api` (:8003) were running long-lived processes that predated this session's commits:
   - Web: `/login` 500'd with a `TurbopackInternalError` (stale compiled chunk referencing a crashed child worker process) while other routes compiled fine — restarting `npm run dev:web` cleanly fixed it (`/login` now 200).
   - API: the running uvicorn `--reload` process (started 2026-08-02, predating Plan 15-01's 2026-08-03 commits) had not picked up the new bulk-archive routes — `POST /work-orders/bulk-archive-by-age` and `/bulk-unarchive` both returned `405 Method Not Allowed` (FastAPI's signature for "no route registered for this method+path"). Restarting `npm run dev:api` fixed this; both routes now return the correct 400/422 responses documented below. This matches the previously-documented stale-dev-server gotcha pattern (06-05, 13-01, 13-02).

**3. Live verification performed via authenticated API calls, not a browser, since no Playwright/browser tool is available to this subagent.** Authenticated against the real dev Supabase project (`hp.patelrep@gmail.com`, GM, Sonesta ES Suites Fossil Creek) via the Supabase Auth REST API, then called the local API (`:8003`) directly with the resulting JWT:
   - `GET /work-orders?archived=true&per_page=5` → **200** (archived filter param accepted and routed correctly).
   - `POST /work-orders/bulk-archive-by-age {"older_than_days": 3650}` → **400**, `{"error":{"code":"42703", ...}}` — Postgres "column does not exist" for `archived_at`, the exact and only expected failure mode given migration 089 is not yet applied to the remote schema. This positively confirms the endpoint is registered, authenticated, RBAC-passed, and reaches the DB layer correctly; the sole remaining gap is the pending schema migration, not application code.
   - `POST /work-orders/bulk-unarchive {"work_order_ids": ["00000000-...-000000000000"]}` → **422** with a `UUID version 4 expected` validation error — confirms the endpoint's Pydantic request-model validation is wired correctly.
   - No completed/cancelled work orders currently exist for this tenant, so a full archive→list→restore round trip with real data could not be exercised even after a migration apply; this is a pre-existing data-availability gap, not a code gap.
   - Full browser click-through (opening the Archived tab, opening BulkArchiveModal, checking a box, clicking Archive, watching the Kanban/Realtime board update, restoring) was **not** performed — no browser/Playwright tool is available to this subagent. `npm run type-check` and `npm run lint` (both zero errors/warnings across every new/changed file) are the verification evidence for this plan; the plan's own live-browser-walkthrough checklist item remains open pending either a browser-capable agent or human verification.

**Total deviations:** 0 code deviations. 3 environment/tooling notes (1 external dependency flagged, 2 stale-process restarts auto-fixed, 1 verification-method limitation documented).
**Impact on plan:** All planned code exists exactly as specified and is confirmed reachable/correctly-wired via direct API testing. The only remaining gap before full production-parity confidence is (a) migration 089 landing on the remote project, and (b) an actual browser-driven walkthrough — both flagged as follow-up, matching 15-01's own precedent for migration deployment being handled outside the plan-execution loop.

## Issues Encountered
See Environment/Tooling Notes above. No code-level bugs found or fixed in this plan's own files.

## User Setup Required
- **Migration 089 must be applied to the remote Supabase project** before the archive/restore flow can be exercised against real data (`ALTER TABLE work_orders ADD COLUMN archived_at TIMESTAMPTZ, ADD COLUMN archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL; CREATE INDEX idx_work_orders_archived_at ON work_orders (tenant_id, archived_at) WHERE archived_at IS NOT NULL;`). Flagged to the team-lead during this session; not yet confirmed applied at time of writing.
- A full authenticated browser walkthrough (GM/engineer archiving and restoring a real work order, verifying Realtime board updates, and confirming non-manager roles don't see the "Archive..." button) is still outstanding and should be run once the migration is applied and a browser-capable agent or human is available.

## Next Phase Readiness
- All three of Plan 15-02's tasks are code-complete, committed, type-checked, and linted clean.
- Phase 15 (Work-Order Bulk-Archive) has no further plans — both 15-01 (backend) and 15-02 (frontend) are now implemented. The phase's closure should be gated on the migration-apply + live-browser-walkthrough follow-ups noted above before being marked fully verified.

---
*Phase: 15-work-order-bulk-archive*
*Completed: 2026-08-03*

## Self-Check: PASSED

- FOUND: apps/web/lib/api/engineering.ts
- FOUND: apps/web/i18n/locales/en.ts
- FOUND: apps/web/i18n/locales/es.ts
- FOUND: apps/web/components/engineering/BulkArchiveModal.tsx
- FOUND: apps/web/components/engineering/ArchivedWorkOrdersPanel.tsx
- FOUND: apps/web/app/(dashboard)/engineering/work-orders/page.tsx
- FOUND: commit 0544505e
- FOUND: commit 61d3c4a8
- FOUND: commit ef077e50

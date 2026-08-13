---
phase: 28-batch-actions
plan: 04
subsystem: web
tags: [nextjs, react-query, i18n, asset-failure-predictions, batch, rbac]

# Dependency graph
requires:
  - phase: 28-batch-actions
    plan: 02
    provides: "POST /assets/failure-predictions/batch-acknowledge and its final response shape"
  - phase: 28-batch-actions
    plan: 03
    provides: "predictionPanel-adjacent i18n namespace convention and inline contextual action bar pattern, reused here for the card-based predictions page"
provides:
  - "engineeringApi.batchAcknowledgeFailurePredictions — typed API client method"
  - "PredictionCard checkbox multi-select + PredictionsPageContent inline contextual batch action bar"
  - "engineering.predictionsPage.* batch i18n keys (en.ts/es.ts, at parity)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline contextual action bar (not modal), adapted from 28-03's PredictionPanel pattern to a card grid: selection state + confirm sub-state live at the page level (PredictionsPageContent), scoped to the currently-rendered (riskFilter/statusFilter-filtered) list"
    - "Checkbox rendered on PredictionCard only when the identical single-item Acknowledge gate is true (canManage && !prediction.is_acknowledged) — chief_engineer (canAuthorize only, not canManage) never gets a checkbox by construction, matching the LOCKED AI-11 scope correction"

key-files:
  created: []
  modified:
    - apps/web/lib/api/engineering.ts
    - apps/web/app/(dashboard)/engineering/predictions/page.tsx
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts

key-decisions:
  - "Selection state (Set<string>) and a batchConfirming boolean live at PredictionsPageContent level, not per-card, since selection spans multiple PredictionCard instances rendered from the filtered list"
  - "Select-all scoped strictly to actionableIds = filtered.filter(!is_acknowledged).map(id) when canManage — never a separate hotel-wide fetch, matching CONTEXT.md's 'scoped to the currently-rendered list' rule and 28-03's identical decision for room-readiness"
  - "No HIGH-only restriction added (LOCKED) — the checkbox gate is exactly canManage && !prediction.is_acknowledged, same as the pre-existing single-item Acknowledge button, with no risk-level filter layered on top"
  - "Per-prediction result summary is a compact list keyed by prediction_id with one of three inline outcomes (acknowledged / not_found / error+detail) plus a succeeded/failed count line — not a single toast, not N toasts"

patterns-established: []

# Metrics
duration: ~35min
completed: 2026-08-13
---

# Phase 28 Plan 04: Asset Failure-Prediction Batch Acknowledge Frontend Summary

**Checkbox multi-select on actionable (canManage && unacknowledged) asset-failure prediction cards plus an inline contextual action bar in `predictions/page.tsx`, wired to a new typed API client method, letting an engineer/GM batch-acknowledge failure predictions and see a per-prediction outcome — not a modal, not a single toast. Last plan in Phase 28.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 completed (2 code tasks + 1 live-verification task)
- **Files modified:** 4

## Accomplishments

- `engineeringApi.batchAcknowledgeFailurePredictions(predictionIds)` added to `apps/web/lib/api/engineering.ts`, typed against Plan 28-02's exact final response shape (`BatchAcknowledgePredictionResult` discriminated union on `action`: `acknowledged` | `not_found` | `error`, `{ data: { results, succeeded, failed } }`)
- `PredictionCard` gained a checkbox rendered only when `canManage && !prediction.is_acknowledged` — the identical gate the pre-existing single-item Acknowledge button already uses (page.tsx:293 pre-plan), so `chief_engineer` (who has `canAuthorize` but not `canManage`) never gets a checkbox by construction, and no new HIGH-only restriction was added (LOCKED)
- `PredictionsPageContent` gained `Set<string>` selection state, an inline contextual action bar (rendered once `selected.size >= 1`, above the predictions list, not a modal) with selected count, select-all/deselect-all scoped to `actionableIds` (the currently-rendered `!is_acknowledged` cards only), and a Batch acknowledge button
- Confirm step (`batchConfirming` boolean) shows `confirmBatchAcknowledge` with the count plus Cancel (reusing `common.cancel`) / confirm; confirm fires a `useMutation` calling `batchAcknowledgeFailurePredictions([...selected])`, invalidating both `['failure-predictions-history']` and `['failure-predictions']` on success (same keys as the existing single-item `acknowledgeMutation`)
- Per-prediction result summary renders from `data.results` as a compact list (acknowledged / not found / error+detail per row) plus a `batchResultSummary` succeeded/failed count line, dismissible; selection and confirm state clear on success
- 7 new `engineering.predictionsPage.*` i18n keys added to `en.ts`/`es.ts` at confirmed parity (`batchAcknowledge`, `selectAll`, `deselectAll`, `selectedCount`, `confirmBatchAcknowledge`, `batchResultSummary`, `resultNotFound`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add batch API client method + EN/ES i18n keys** - `127f4a51` (feat)
2. **Task 2: Add checkbox selection + contextual action bar to page.tsx** - `07b0ae52` (feat)
3. **Task 3: Live self-verification on localhost** - no code changes (verification only)

## Live Verification (Task 3)

**Environment fix (Rule 3, blocking, no code change):** neither the web dev server nor the API dev server were running at task start. `netstat` showed nothing listening on the API's actual configured port (`:8003`, per `apps/web/.env.local`'s `NEXT_PUBLIC_API_URL`) — an unrelated process was squatting on `:8000` (a different, non-PatelRep application, confirmed by its `/openapi.json` listing `/api/scanner`, `/api/trade`, etc. — left untouched). Web was already running on `:3001`. Started `npm run dev:api` (which binds `:8003` per `package.json`'s `dev:api` script); `GET /openapi.json` then correctly listed `/v1/assets/failure-predictions/batch-acknowledge` (and 28-01/28-03's room-readiness batch routes).

**Full live click-through succeeded** (this tenant had exactly 1 actionable — unacknowledged, manager-visible — prediction at test time, a `Rooftop HVAC Unit A - QA Verification` fixture used for live testing in prior phases): logged in as the GM test account, navigated to `/engineering/predictions`, confirmed exactly 1 checkbox rendered (matching the 1 unacknowledged card; the 2 already-acknowledged cards had none), selected it, confirmed the action bar showed "1 selected", clicked Batch acknowledge, confirmed the inline confirm step ("Acknowledge 1 predictions?"), confirmed, and verified:
- Exactly one network call to `POST http://localhost:8003/v1/assets/failure-predictions/batch-acknowledge` with body `{"prediction_ids":["522d304b-ca29-49c8-9b41-3172a5452b36"]}`
- Per-prediction result summary rendered: "1 acknowledged, 0 need attention" with an "Acknowledged — 522d304b-..." row
- Checkbox count dropped to 0 after the query refetch (item now acknowledged, `statusFilter` defaulting to `active` hid it from the list; stats row updated Active Alerts 1→0, Acknowledged 0→1)
- Selection cleared (0 checkboxes checked) after refresh
- Zero console errors throughout

Screenshots captured during the run confirmed the confirm-step and result-summary states visually match the plan's intent (inline card, not modal). Test artifacts (script + screenshots) were created outside the repo tree and removed after verification.

**chief_engineer batch-UI-absence:** verified by code inspection only (no second local test account exists, same accepted deferral pattern as 27-03/28-03) — the checkbox's gate (`canManage && !prediction.is_acknowledged`) is identical to the pre-existing single-item Acknowledge button's gate, and `canManage = isGM || role === 'engineer'` excludes `chief_engineer` (who only has `canAuthorize = isGM || role === 'chief_engineer'`) by construction; backed by 28-02's automated `chief_engineer`-403 test on the backend route this UI calls.

Non-regression: the existing single-card Acknowledge / Create Work Order / Authorize AI action buttons, `canAuthorize` path, risk/status filters, and the deep-link highlight behavior were not restructured — only a sibling checkbox and the page-level selection/action-bar block were added. `npm run type-check` and `npm run lint` both pass clean with zero errors across all four changed files.

## Files Created/Modified

- `apps/web/lib/api/engineering.ts` - `batchAcknowledgeFailurePredictions` method + `BatchAcknowledgePredictionResult` discriminated union type
- `apps/web/app/(dashboard)/engineering/predictions/page.tsx` - checkbox on `PredictionCard`, selection/batchConfirming/batchResult state + inline action bar + per-prediction result list on `PredictionsPageContent`
- `apps/web/i18n/locales/en.ts` / `es.ts` - 7 new `engineering.predictionsPage.*` batch keys, confirmed parity

## Decisions Made

- Select-all/deselect-all scoped strictly to `filtered.filter(!is_acknowledged).map(id)` (the currently-rendered actionable set under whatever risk/status filter is active), never a separate unfiltered fetch — matches CONTEXT.md's explicit instruction and 28-03's identical decision for room-readiness.
- Reused the existing `common.cancel` i18n key for the confirm step's Cancel button rather than adding a new engineering-scoped key, since a generic cancel string already exists and is used the same way elsewhere in the app.
- Checkbox `aria-label` uses the asset name (mirroring 28-03's `PredictionRow` pattern of a per-row descriptive label) rather than a count-based string, since a per-checkbox label describing "N selected" would be semantically wrong for an individual control.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Started both dev servers; identified and left alone an unrelated process squatting on the API's `:8000`**
- **Found during:** Task 3 live verification
- **Issue:** Neither dev server was running. A `netstat` check of `:8000` found a *different, unrelated application* listening there (an already-running non-PatelRep service whose `/openapi.json` exposed `/api/scanner`, `/api/trade`, etc.) — not a stale PatelRep process. The actual PatelRep API dev server binds `:8003` per `package.json`'s `dev:api` script and `apps/web/.env.local`'s `NEXT_PUBLIC_API_URL`, and nothing was listening there.
- **Fix:** Left the unrelated `:8000` process untouched (out of scope, not a PatelRep artifact) and started `npm run dev:api`, which correctly bound `:8003`.
- **Verification:** `GET :8003/openapi.json` listed the new batch-acknowledge route; the full live click-through against it succeeded end-to-end.
- **Committed in:** N/A (environment-only, no code change)

---

**Total deviations:** 1 auto-fixed (blocking/environment, no code change)
**Impact on plan:** None on shipped code.

## Issues Encountered

None beyond the one documented environment deviation above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 28 (all 4 plans: 28-01, 28-02, 28-03, 28-04) is now code-complete. Phase-level verify/close is a separate remaining step.
- No blockers.

---
*Phase: 28-batch-actions*
*Completed: 2026-08-13*

## Self-Check: PASSED

Verified `apps/web/lib/api/engineering.ts`, `apps/web/app/(dashboard)/engineering/predictions/page.tsx`, `apps/web/i18n/locales/en.ts`, and `apps/web/i18n/locales/es.ts` exist with the expected content. Both task commit hashes (`127f4a51`, `07b0ae52`) confirmed present in `git log`.

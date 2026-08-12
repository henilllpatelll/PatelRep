---
phase: 26-deep-linked-alert-surfaces
verified: 2026-08-12T00:00:00Z
status: passed
score: 8/8 must-haves verified
---

# Phase 26: Deep-Linked Alert Surfaces Verification Report

**Phase Goal:** Every row in the dashboard's AI Risk Alerts panel is a working link to the exact room or asset it describes, closing both the "generic link" gap (housekeeping) and the "no link at all" gap (maintenance).
**Verified:** 2026-08-12
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `GET /ai/risk-alerts` returns `id` on every `maintenance_risks` entry | ✓ VERIFIED | `apps/api/routers/ai_copilot.py:782-788` selects `"id, name, failure_risk_score"` on `assets`. New test `test_risk_alerts_asset_select_includes_id` (`apps/api/tests/test_ai_copilot_rbac.py:118-135`) asserts both the response shape and the actual `select_calls` content — re-ran `pytest tests/` myself: 571 passed. |
| 2 | AIRiskAlertsPanel housekeeping row links to `/housekeeping?room={id}` | ✓ VERIFIED | `apps/web/components/dashboard/AIRiskAlertsPanel.tsx:88-93` — `href={`/housekeeping?room=${r.room_id}`}` (was a bare `/housekeeping` link before this phase). |
| 3 | AIRiskAlertsPanel maintenance row links to `/engineering/predictions?asset={id}` (previously no link at all) | ✓ VERIFIED | `apps/web/components/dashboard/AIRiskAlertsPanel.tsx:126-146` — new "View" `<a>` element added, `href={`/engineering/predictions?asset=${r.id}`}`, styled to match the SLA-breach row's existing View link. `RiskAlerts.maintenance_risks` type in `apps/web/lib/api/ai.ts:134` updated to `Array<{ id: string; name: string; failure_risk_score: number }>`. |
| 4 | RoomStatusBoard opens the correct room's drawer via `?room=`, matching against the unfiltered list (not the UI-filtered list) | ✓ VERIFIED | `apps/web/components/housekeeping/RoomStatusBoard.tsx:5` imports `useSearchParams`; effect at lines 335-343 matches `roomId` against `displayRooms` (the normalized-but-unfiltered list, line 238-240) — not the locally-shadowed, filter-applied `rooms` (line ~253) — and calls `setSelectedRoom(withLateCheckout(match))`. Matches the plan's explicit "never match against the filtered `rooms`" instruction exactly. |
| 5 | Engineering predictions page resolves `?asset=`, resets filters only when needed, scrolls + highlights | ✓ VERIFIED | `apps/web/app/(dashboard)/engineering/predictions/page.tsx` — `PredictionsPageContent` (line 361) reads `searchParams.get('asset')`, matches against `allPredictions`, calls `setRiskFilter('all')`/`setStatusFilter('all')` only when `!isVisible` under current filters, sets `highlightedId` (clears after 3s), and a second effect (lines 452-456) scrolls the ref'd card into view once present in `filtered`. `PredictionCard` gained `cardRef`/`isHighlighted` props applied via a wrapping `<div ref={cardRef}>` (line 176) since `Card` is not `forwardRef`. |
| 6 | Both Suspense boundaries in place; `npm run build` (from `apps/web`) actually succeeds | ✓ VERIFIED | `apps/web/app/(dashboard)/housekeeping/page.tsx:741-743` wraps `<RoomStatusBoard />` in `<Suspense>`; `apps/web/app/(dashboard)/engineering/predictions/page.tsx:678-682` wraps `<PredictionsPageContent />` in `<Suspense>` inside the new default-export `PredictionsPage`. Re-ran `npm run build` myself from `apps/web` (Next.js 16.3.0-preview.10 / Turbopack) — **build succeeded**, "Compiled successfully", both `/housekeeping` and `/engineering/predictions` listed as `○ (Static)` with no "Missing Suspense boundary with useSearchParams" error. |
| 7 | Full `apps/api` test suite still passes at the expected baseline | ✓ VERIFIED | Re-ran `cd apps/api && python -m pytest tests/ -q` myself: **571 passed, 3 failed**. The 3 failures are all in `tests/test_management_roi.py` (`test_roi_downtime_revenue_uses_tenant_adr`, `test_roi_housekeeping_efficiency_pairs_in_progress_to_clean`, `test_roi_pm_compliance_reads_pm_deferrals_table`) — pre-existing, unrelated to this phase's files, matches the documented baseline exactly. |
| 8 | `apps/web` type-check and lint both pass | ✓ VERIFIED | Re-ran `npm run type-check` (tsc --noEmit) myself: clean, no errors. Re-ran `npm run lint` (eslint .) myself: clean, no errors/warnings. |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/routers/ai_copilot.py` | `asset_risks` select includes `id` | ✓ VERIFIED | Line 783: `.select("id, name, failure_risk_score")` |
| `apps/api/tests/smoke/fake_supabase.py` | `FakeDB.select_calls` captures per-table select args | ✓ VERIFIED | Line 43: `self.select_calls = []`; line 67-70: `FakeQuery.select()` appends `(table_name, args)` |
| `apps/api/tests/test_ai_copilot_rbac.py` | New test asserting `id` selected + present in response | ✓ VERIFIED | `test_risk_alerts_asset_select_includes_id` at line 119, asserts both response shape and `select_calls` content |
| `apps/web/lib/api/ai.ts` | `RiskAlerts.maintenance_risks` has `id: string` | ✓ VERIFIED | Line 134: `Array<{ id: string; name: string; failure_risk_score: number }>` |
| `apps/web/components/dashboard/AIRiskAlertsPanel.tsx` | Housekeeping row → `/housekeeping?room=`; new maintenance row → `/engineering/predictions?asset=` | ✓ VERIFIED | Lines 88-93 and 126-146 |
| `apps/web/components/housekeeping/RoomStatusBoard.tsx` | Reads `?room=` via `useSearchParams`, matches unfiltered list, opens drawer | ✓ VERIFIED | Lines 5, 212, 335-343 |
| `apps/web/app/(dashboard)/housekeeping/page.tsx` | `RoomStatusBoard` wrapped in `<Suspense>`, minimal blast radius | ✓ VERIFIED | Lines 741-743; `HousekeeperMyRoomsView` and role-gated default export untouched |
| `apps/web/app/(dashboard)/engineering/predictions/page.tsx` | Content/Page Suspense split, `PredictionsPageContent`, highlight/scroll | ✓ VERIFIED | Lines 361 (`PredictionsPageContent`), 678-682 (`PredictionsPage` default export) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `ai_copilot.py::get_risk_alerts` | `apps/web/lib/api/ai.ts RiskAlerts.maintenance_risks` | `id` field added to select matches frontend type | ✓ WIRED | Backend selects `id`; frontend type declares `id: string`; test proves the select-string content, not just row echo |
| `AIRiskAlertsPanel.tsx` (housekeeping row) | `RoomStatusBoard.tsx` | full-page nav → `useSearchParams().get('room')` → `displayRooms.find` → `setSelectedRoom` → `RoomDetailDrawer` | ✓ WIRED | Confirmed by direct code read of both ends; SUMMARY documents a live browser walkthrough with a real `room_id` and filter-active scenario |
| `AIRiskAlertsPanel.tsx` (maintenance row) | `engineering/predictions/page.tsx` | full-page nav → `useSearchParams().get('asset')` → `allPredictions.find` → `setHighlightedId` + `scrollIntoView` | ✓ WIRED | Confirmed by direct code read of both ends; SUMMARY documents a live browser walkthrough with a real `asset_id` and filter-reset scenario |
| `RiskAlerts.maintenance_risks[].id` | `AIRiskAlertsPanel.tsx r.id` | typed field flows into the View link href | ✓ WIRED | `href={`/engineering/predictions?asset=${r.id}`}` at line 140; type-check passes (would fail if `r.id` didn't exist on the typed response) |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|-----------------|
| AI-07 (housekeeping row → specific room detail, not generic link) | ✓ SATISFIED (code) | None — `.planning/REQUIREMENTS.md` checkbox still shows `[ ]`/"Pending" (doc-lag, not a code gap; see note below) |
| AI-08 (maintenance row → specific asset failure-prediction detail) | ✓ SATISFIED (code) | None — same doc-lag as AI-07 |

### Anti-Patterns Found

None. Grepped `AIRiskAlertsPanel.tsx`, `RoomStatusBoard.tsx`, `housekeeping/page.tsx`, and `engineering/predictions/page.tsx` for `TODO|FIXME|XXX|HACK|PLACEHOLDER` and empty-handler patterns — no matches. No stub returns, no empty click handlers, no console-log-only implementations in the touched surfaces.

### Documentation State Note (non-blocking)

`.planning/ROADMAP.md` line 93 still shows `- [ ] **Phase 26: ...**` (unchecked) and `.planning/REQUIREMENTS.md` lines 16-17/50-51 still show AI-07/AI-08 as `[ ]`/"Pending", despite both 26-01-SUMMARY.md and 26-02-SUMMARY.md documenting completed, committed work and this verification confirming the goal is achieved in code. This is a bookkeeping gap in the planning docs, not a gap in the shipped feature — flagging so the orchestrator can flip these checkboxes when closing the phase.

### Human Verification Required

None required beyond what 26-02-SUMMARY.md already documents as completed. The SUMMARY records a live authenticated browser walkthrough (login, both destination routes with real `room_id`/`asset_id` values, filter-active edge cases via `history.pushState`+`popstate`, stale/invalid-id graceful degradation, and non-regression checks on manual room-card clicks and prediction-card action buttons) performed during execution. All claims in that walkthrough are consistent with the code actually present (verified above), and the `npm run build`/`type-check`/`lint`/`pytest` commands were independently re-run by this verification pass with matching results — no discrepancy found between SUMMARY claims and actual code/test behavior.

One optional follow-up for a human: the live tenant used during 26-02 execution had 0 `housekeeping_risks`/`maintenance_risks` rows at verification time (only SLA-breach alerts), so the panel's actual `<a>` elements for these two row types were not clicked end-to-end from the live dashboard UI itself — only the destination pages were hit directly via the exact URL templates the code constructs, and via type-check (which would fail if `r.room_id`/`r.id` were wrong). This is a data-seeding gap in the pilot tenant, not a code gap; it does not block phase closure.

### Gaps Summary

No gaps found. All 8 must-have truths across both plans (26-01 backend, 26-02 frontend) are verified against the actual codebase — not just SUMMARY claims. Independently re-ran (rather than trusted) all four verification commands the plans specify: `pytest tests/` (571 passed / 3 pre-existing unrelated failures, matching documented baseline), `npm run type-check` (clean), `npm run lint` (clean), and `npm run build` (succeeded, both `/housekeeping` and `/engineering/predictions` routes compiled with no missing-Suspense-boundary error). Commit hashes cited in both SUMMARY.md files (`69a4934a`, `f06acced`, `88d6c4a1`, `90dc3158`, `46906c0f`) all exist in `git log`. The only non-blocking item is planning-doc bookkeeping (ROADMAP.md/REQUIREMENTS.md checkboxes not yet flipped), which does not affect goal achievement.

---

_Verified: 2026-08-12_
_Verifier: Claude (gsd-verifier, filling in as general-purpose agent)_

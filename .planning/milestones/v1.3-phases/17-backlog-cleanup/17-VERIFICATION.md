---
phase: 17-backlog-cleanup
verified: 2026-08-04T12:15:00Z
status: passed
score: 5/5 must-haves verified
---

# Phase 17: Backlog Cleanup Verification Report

**Phase Goal:** Clear the small, independent items carried forward from the v1.2 milestone audit — UX rough edges across Staff, Scheduling, Opera, Management ROI, Guest Requests, and Room History; the `ai_interactions` CHECK-constraint bug (deferred 4x prior); and the supervisor-in-assignment-picker product decision.
**Verified:** 2026-08-04T12:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Context Note on Execution History

This phase's 8 plans ran as fully-parallel agents sharing one git working tree, with two confirmed `git add`/`git commit` races (17-02's `scheduling.py` fix landed inside commit `ee6dedbe`, titled for 17-05; 17-05's own drawer changes share that same commit). Both incidents are documented in 17-02-SUMMARY.md and 17-05-SUMMARY.md. This verification does not trust either SUMMARY's self-report — every truth below was checked directly against the current file contents on disk (`git log`/`grep`/`Read`), not against commit attribution or narrative claims.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Staff display names never render blank; fallback shown when name data missing | VERIFIED | `apps/api/routers/staff.py:136` uses `profile.get("full_name") or ""`. `apps/web/lib/utils/avatar.ts` exports null-safe `getInitials` + new `getDisplayName(name, fallback='Unnamed Staff')`. All 3 duplicate local `getInitials` functions removed from `staff/page.tsx`, `scheduling/page.tsx`, `housekeeping/page.tsx` — all 3 now import and use the shared `getDisplayName` at every full_name render/split/search site. `npm run type-check` passes with zero errors. |
| 2 | Shift-template dropdowns show no duplicate/leftover entries | VERIFIED | `apps/api/routers/scheduling.py::create_shift()` (lines 79-92) does a pre-insert `ilike` existence check scoped to `tenant_id`+`department_id`+`is_active=True`, raising `HTTPException(409, "... already exists ...")` before insert. Code confirmed present and correct on disk regardless of the misattributed commit; full pytest suite green (549/551, 2 pre-existing unrelated failures — see below). |
| 3a | Opera connection failures show specific error, not generic | VERIFIED | `apps/web/app/(dashboard)/settings/integrations/page.tsx:465-469` — `statusQuery.isError` block now renders `(statusQuery.error as any)?.message \|\| 'Failed to load Opera status.'`, matching the pattern of the other 4 mutation error blocks in the same file. |
| 3b | Management ROI page no longer leaks internal formula string | VERIFIED | `apps/api/services/guest_recovery/contracts.py:322` — `"definition"` field is now `"Average minutes spent cleaning each occupied room, based on completed clean sessions."` (plain prose, no `=`/snake_case). `apps/api/tests/test_management_roi.py:222-224` locks in the prose assertion and the absence of the old formula string. |
| 4a | Guest Request drawer includes status-advance actions, not just view | VERIFIED | `GuestRequestDrawer.tsx` Props interface gained `onAdvance`/`isUpdating` (lines 24-25), destructured (line 52), and renders the same per-status button chain (Acknowledge/Dispatch/Arrived/Contacted/Resolve/Verify, lines 178-203) as the kanban card, calling `onAdvance(request.id, nextStatus)`. `GuestRequestsPage.tsx` passes `onAdvance={handleAdvance}` / `isUpdating={updateMutation.isPending}` into both the card (line 253) and the drawer (line 278) — same mutation, same query-invalidation path, confirmed by direct read of both call sites (not just one). |
| 4b | Room History populates with actual room history data | VERIFIED | `apps/api/routers/housekeeping.py` — `import_hk_details()`'s bulk-import loop now batch pre-fetches `prior_status_map` (lines 1949-1970) and only stamps `stay_reset_at` `if resolved_status == "INSPECTED" and prior_status_map.get(room_id) != "INSPECTED"` (line 1996-1997), narrowing the over-aggressive trigger. `apps/api/routers/rooms.py::get_room_history()` (lines 1004-1046) now batch-fetches `user_profiles` by `changed_by` ids and merges `actor_name`/`user_profiles` onto each history row, matching `RoomDetailDrawer.tsx`'s read contract. Diagnostic finding (CONFIRMED) and forward-looking-only fix explicitly documented in 17-06-SUMMARY.md; 3 new targeted tests (2 in `test_housekeeping_assignments.py`, 1 in `test_webhooks_and_transitions.py`) all pass. |
| 5a | Logging AI interaction with `general`/other rejected values succeeds instead of 400/500ing | VERIFIED (code) / PENDING (deploy) | `supabase/migrations/091_ai_interactions_widen_interaction_type.sql` exists, additive-only, widens the CHECK constraint to all 14 real values including `general`, `work_order_creation`, `guest_request_creation`, `task_assignment`, `housekeeping_briefing` — confirmed these exact 5 values are the ones actually used by live `log_ai_interaction(interaction_type=...)` call sites in `ai_copilot.py`. **Not yet applied to the remote Supabase project** — matches this milestone's established convention (086/087/089/090 all deployed as a separate step). This is a known, explicitly-flagged non-blocking follow-up, not a code gap. |
| 5b | Supervisors appear as assignable staff in the housekeeper room-assignment picker | VERIFIED | Main board picker (`housekeeping/page.tsx:98`) already correct. Inspection re-assign picker (`inspections/page.tsx:170`) now filters `s.role === 'housekeeper' \|\| s.role === 'housekeeping_supervisor'`, mirroring the main board exactly. `tasks/page.tsx:240` confirmed untouched (explicit, documented scope exclusion — task assignment is a separate feature). |

**Score:** 5/5 (all ROADMAP success criteria satisfied at the code level; DATA-01's remote-DB deployment is a separately-tracked, explicitly non-blocking follow-up matching established project convention, not a code gap)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/routers/staff.py` | Null-safe `full_name` serialization | VERIFIED | `profile.get("full_name") or ""` present |
| `apps/web/lib/utils/avatar.ts` | Null-safe `getInitials` + new `getDisplayName` | VERIFIED | Both exported, single source of truth |
| `apps/web/app/(dashboard)/{staff,scheduling,housekeeping}/page.tsx` | Duplicate `getInitials` removed, `getDisplayName` used everywhere | VERIFIED | Zero local `function getInitials` definitions remain; all full_name render/split/search sites wrapped |
| `apps/api/routers/scheduling.py` | Pre-insert 409 duplicate-shift guard | VERIFIED | Lines 79-92 |
| `apps/web/app/(dashboard)/settings/integrations/page.tsx` | Real status-fetch error surfaced | VERIFIED | Lines 465-469 |
| `apps/api/services/guest_recovery/contracts.py` | Plain-language `definition` string | VERIFIED | Line 322 |
| `apps/api/tests/test_management_roi.py` | Regression assertion locking in prose | VERIFIED | Lines 222-224 |
| `apps/web/components/guest-requests/GuestRequestDrawer.tsx` | `onAdvance` prop + status-advance buttons | VERIFIED | Lines 24-25, 52, 178-203 |
| `apps/web/components/guest-requests/GuestRequestsPage.tsx` | Drawer wired with `handleAdvance`/`updateMutation.isPending` | VERIFIED | Lines 278-279 |
| `apps/api/routers/rooms.py` | `get_room_history()` actor attribution | VERIFIED | Lines 1004-1046 |
| `apps/api/routers/housekeeping.py` | Narrowed `stay_reset_at` stamp condition | VERIFIED | Lines 1949-1997 |
| `supabase/migrations/091_ai_interactions_widen_interaction_type.sql` | Widened CHECK constraint, 14 values | VERIFIED (file) / NOT YET APPLIED (remote) | Additive-only, matches used values exactly |
| `apps/web/app/(dashboard)/housekeeping/inspections/page.tsx` | Supervisor included in re-assign picker filter | VERIFIED | Line 170 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `staff/page.tsx`, `scheduling/page.tsx`, `housekeeping/page.tsx` | `lib/utils/avatar.ts` | `import { getInitials, getDisplayName }` | WIRED | All 3 files import and use both functions |
| `create_shift()` | `supabase.table("shifts")` | Pre-insert existence check → 409 | WIRED | Confirmed present regardless of commit misattribution |
| `GuestRequestDrawer.tsx` | `GuestRequestsPage.tsx` handleAdvance/updateMutation | `onAdvance` prop | WIRED | Same mutation/invalidation path as the card, confirmed via both render call sites |
| `import_hk_details()` | `room_status.stay_reset_at` | Conditional stamp on genuine transition only | WIRED | `prior_status_map` batch pre-fetch confirmed |
| `get_room_history()` | `user_profiles` | Batch fetch + merge (`actor_name`) | WIRED | Confirmed in `rooms.py` |
| `inspections/page.tsx` housekeepers filter | `GET /staff` response | Role filter widened | WIRED | Matches `housekeeping/page.tsx`'s already-correct pattern |
| Migration 091 | Remote Supabase `ai_interactions` table | `apply_migration` (orchestrator/human step) | NOT YET APPLIED | Explicitly flagged, non-blocking, matches convention (086/087/089/090) |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|-----------------|
| UX-01 | SATISFIED | None |
| UX-02 | SATISFIED | None |
| UX-03 | SATISFIED | None |
| UX-04 | SATISFIED | None |
| UX-05 | SATISFIED | None |
| UX-06 | SATISFIED | None (fix is forward-looking only per 17-06-SUMMARY.md — pre-existing mis-stamped rows not retroactively repaired, explicitly out of scope) |
| DATA-01 | SATISFIED (code) | Migration 091 not yet applied to remote DB — separately tracked deploy step, matches established convention, not a code gap |
| STAFF-01 | SATISFIED | None |

Note: `.planning/REQUIREMENTS.md` checkboxes for these 8 requirements are still shown as unchecked/"Pending" in the tracking table — this is a documentation-sync gap in REQUIREMENTS.md itself, not a code gap (all 8 requirements' underlying code is verified present and correct above).

### Anti-Patterns Found

None. Scanned all 10 files touched across the 8 plans for TODO/FIXME/XXX/HACK/PLACEHOLDER/"coming soon" patterns — zero hits (the only `placeholder` matches are legitimate HTML input `placeholder` attributes, unrelated to stub code).

### Regression Check

- `npm run type-check` (apps/web): **zero errors.**
- `cd apps/api && pytest tests/ -q`: **549 passed, 2 failed.** The 2 failures (`test_roi_downtime_revenue_uses_tenant_adr`, `test_roi_housekeeping_efficiency_pairs_in_progress_to_clean`) are pre-existing, documented in `.planning/phases/17-backlog-cleanup/deferred-items.md` as deliberate TDD red-phase tests from an unrelated Phase 5 plan (commits `cf545a0e`/`22fb775d`), independently reconfirmed present by both 17-02's and 17-04's own verification runs and by this verification's own fresh run. Not a Phase 17 regression.
- Targeted new tests from 17-06 (`test_housekeeping_assignments.py`, `test_webhooks_and_transitions.py`, filtered to stay_reset/history/actor): 8/8 passed.

### Human Verification Required

Per the task context, the following were already flagged by executors as open, non-blocking follow-ups (no browser tool available in the sandboxed execution environment for 17-01, 17-04, 17-05, 17-08):

1. **Staff/Scheduling/Housekeeping pages — live NULL-name fallback render**
   **Test:** With dev servers running, open Staff, Scheduling, and Housekeeping pages as GM/supervisor; if a staff row has NULL `full_name`, confirm "Unnamed Staff" renders with no console error.
   **Expected:** Visible fallback text, no crash.
   **Why human:** No browser tool was available to the executing agents; code-level null-safety is verified via type-check + grep, but the actual DOM render was not click-through verified.

2. **Guest Request drawer — status-advance button click-through**
   **Test:** Open a guest request's drawer at each status in the chain, click the shown action button, confirm the kanban board reflects the new status.
   **Expected:** Status advances, board updates.
   **Why human:** Same tooling gap; code mirrors the already-proven kanban-card pattern exactly (same mutation, same props), but end-to-end click-through was not performed.

3. **Inspections re-assign picker — supervisor selection end-to-end**
   **Test:** Fail an inspection, open the re-assign drawer, select a `housekeeping_supervisor`, submit, confirm success.
   **Expected:** Re-assign succeeds (backend `_ensure_housekeeper()` already accepts both roles).
   **Why human:** Same tooling gap; this is a one-line mirror of an already-verified-working pattern.

4. **Migration 091 — remote deployment**
   **Test:** Apply `supabase/migrations/091_ai_interactions_widen_interaction_type.sql` to the remote Supabase project via `apply_migration` or CLI, then verify via `pg_get_constraintdef` that all 14 values are present, and confirm a live `general`-intent AI Copilot interaction no longer 400/500s.
   **Expected:** Constraint updated; live logging succeeds.
   **Why human:** Requires Supabase MCP/CLI access not available to the sandboxed plan executors — this is an orchestrator/human deployment step, explicitly flagged as pending by the phase's own convention (matches 086/087/089/090).

### Gaps Summary

No code-level gaps found. All 5 ROADMAP success criteria are satisfied by code present on disk, verified independently of SUMMARY self-reports and independently of the two documented git-attribution races (the misattributed code was located and confirmed correct regardless of which commit it landed in). Full type-check is clean; the API test suite shows only 2 pre-existing, documented, unrelated failures with zero Phase 17 regressions. The single open item — migration 091's application to the remote Supabase project — is an explicitly-flagged, non-blocking deployment step following this milestone's established convention (four prior migrations in this same milestone followed the identical write-now/apply-separately pattern), not a gap in the phase's own work.

---
*Verified: 2026-08-04T12:15:00Z*
*Verifier: Claude (gsd-verifier)*

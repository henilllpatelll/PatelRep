---
phase: 38-engineering-work-order-labor-and-cost-capture
plan: 05
subsystem: testing
tags: [pytest, playwright, e2e, work-orders, staff, inventory]

requires:
  - phase: 38-01
    provides: "migration 104 (hourly_rate, unit_cost, labor_cost/parts_cost/total_cost columns)"
  - phase: 38-02
    provides: "cost computation in complete_work_order"
  - phase: 38-03
    provides: "unit_cost/hourly_rate write + RBAC"
  - phase: 38-04
    provides: "web UI for cost display and rate/cost inputs"
provides:
  - "Full backend test suite verified green (705/708, 3 pre-existing unrelated failures)"
  - "Live golden-path browser verification: unit_cost -> hourly_rate -> WO completion -> cost display"
  - "Non-regression spot-check of 5 adjacent flows (WO claim, hold/resume, cancel, PM completion, staff role edit, stock adjustment)"
affects: []

tech-stack:
  added: []
  patterns: ["playwright-cli driven browser verification as the CLAUDE.md Self-Verification Policy fallback when the Chrome extension (mcp__claude-in-chrome__*) is not connected"]

key-files:
  created: []
  modified: []

key-decisions:
  - "Chrome extension (mcp__claude-in-chrome__*) was not connected in this environment, so live browser verification used playwright-cli (already installed at node_modules/.bin/playwright, driven via `npx playwright-cli`) instead — an explicitly allowed alternative per CLAUDE.md's Self-Verification Policy ('Playwright or the playwright-cli skill')."
  - "Verified the golden path with the GM's own account holding an hourly_rate (rather than a second non-gm test account) to get a fully-populated (non-partial) total_cost in one pass; the partial-cost/NULL-fallback path was already covered by 38-02's 7 unit tests, so browser verification focused on the happy path + the RBAC-absence check via direct code read (plan's explicitly allowed alternative)."
  - "hourly_rate non-leak to non-GM roles was verified by re-reading apps/api/routers/staff.py's list_staff (the `if current_user.role == \"gm\": entry[\"hourly_rate\"] = ...` gate makes the key structurally absent, not just null, for every other role) rather than creating a second test account — this is the plan's own documented fallback method."
  - "An apparent 'Access restricted' / isGM-false flash on /staff page load was investigated (JWT decode, localStorage authStore, network requests, list_staff.py source) and confirmed to be a harmless first-render race in useRole's effectiveRole resolution (re-fetched fresh each session via GET /v1/staff/me/effective-role), not a Phase 38 regression — a second snapshot after the fetch resolves always shows the correct gm-gated content. Not fixed, since it predates this phase and isn't in scope."

patterns-established: []

duration: 40min
completed: 2026-09-16
---

# Phase 38 Plan 05: Full-Suite + Live Golden-Path Verification Summary

**Verified the entire labor+cost capture feature end-to-end on live dev servers: GM sets a part's $15.00 unit_cost and own $35.00 hourly_rate, completes a work order with 2 labor hours + that part consumed, and the WO detail drawer renders "Labor: $70.00 · Parts: $15.00 · Total: $85.00" — with zero console errors, zero failed network requests, and zero regressions in 5 adjacent engineering/staff flows.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-09-16
- **Tasks:** 3/3 completed
- **Files modified:** 0 (verification-only plan)

## Accomplishments

### Task 1: Full backend test suite
- `cd apps/api && python -m pytest tests/ -q` → **705 passed, 3 failed**.
- The 3 failures are `test_management_roi.py::test_roi_downtime_revenue_uses_tenant_adr`, `test_roi_housekeeping_efficiency_pairs_in_progress_to_clean`, `test_roi_pm_compliance_reads_pm_deferrals_table` — confirmed pre-existing and unrelated to Phase 38 (already documented as pre-existing in this project's memory from before this phase started; no file touched by Plans 01-04 overlaps `management_roi.py` or its tests).
- Zero regressions from Plans 01-04's changes to `complete_work_order`, `list_staff`, `update_staff`, or the parts CRUD.

### Task 2: Live golden-path verification via browser
Chrome extension (`mcp__claude-in-chrome__*`) was not connected in this environment (`tabs_context_mcp` returned "Browser extension is not connected"). Fell back to `playwright-cli` per CLAUDE.md's explicit alternative ("Playwright or the `playwright-cli` skill") — confirmed installed at `node_modules/.bin/playwright`, driven via `npx playwright-cli`.

Started both dev servers (API on 8003 after confirming no stale `uvicorn`/`multiprocessing` python.exe processes per the plan's Windows gotcha note; web already running on 3000). Confirmed `GET localhost:8003/openapi.json` returns PatelRep-shaped paths, and `apps/web/.env.local`'s `NEXT_PUBLIC_API_URL` points at 8003. Confirmed `apps/api/.env`'s `SUPABASE_URL` matches the `oacnwalhcpqdabivweki` project migration 104 was applied to.

Logged in via the project's GM test account (`reference_test_account.md` in memory) against `localhost:3000/login` — worked directly since it authenticates against the same Supabase project as local `.env`.

1. **Parts unit_cost**: Engineering → Work Orders → Parts tab → created part "HVAC Filter (Phase38 verify)" with `unit_cost=15.00`. Persisted and displayed as "$15.00 per unit" immediately.
2. **Staff hourly_rate**: Staff page → edited two staff members (Elisa, Miguel) and the GM's own row, setting `hourly_rate` (20.00, 22.50, 35.00 respectively) via the "Hourly rate" field added in Plan 38-04. All saved with 200 responses; reopening each edit modal showed the saved value persisted.
3. **hourly_rate visible to GM**: `GET /v1/staff` response body for the GM session included `"hourly_rate":20.0` for Elisa and correctly `"hourly_rate":null` for staff with none on file (never defaulted to 0).
4. **hourly_rate absent for non-GM**: verified via direct code read of `apps/api/routers/staff.py`'s `list_staff` (the plan's own documented alternative to creating a second account) — the `hourly_rate` key is only ever added to the response dict inside `if current_user.role == "gm":`, so it is structurally absent (not null, not omitted-by-serializer — never assigned) for every other role.
5. **WO completion with labor + parts**: created WO-147 ("Phase38 cost verify - lobby AC"), claimed it as GM, added 10 units of stock for the new part (needed since the part was created with zero stock), then completed the WO with `labor_hours=2` and the part consumed via the parts-consumed picker added in Plan 38-04.
6. **Cost line renders correctly**: `POST .../complete` response confirmed `"labor_cost":70.0,"parts_cost":15.0,"total_cost":85.0"` (2h × $35/hr = $70; 1 unit × $15/unit = $15; $70+$15 = $85 — matches CONTEXT.md's formula exactly). Reopening the completed WO's detail drawer rendered **"Labor: $70.00 · Parts: $15.00 · Total: $85.00"**, exactly matching the API response.
7. Checked console and network requests throughout this entire sequence: **zero console errors, zero 4xx/5xx responses** from any Phase 38 endpoint.

### Task 3: Non-regression spot-check of adjacent engineering flows
All 5 spot-checks completed successfully with 200 responses and no console errors:
1. **WO claim**: claimed WO-80 (a different, pre-existing E2E-test work order) — `POST .../claim` → 200.
2. **WO hold/resume**: put WO-80 on hold with a required reason ("Awaiting parts") — `POST .../transition` → 200; resumed it back to in_progress — `POST .../transition` → 200.
3. **WO cancel**: cancelled WO-75 (a different pre-existing WO) with a required reason ("Duplicate") — `POST .../transition` → 200.
4. **PM completion**: completed an overdue PM schedule ("Rooftop HVAC Unit A - QA Verification — HVAC Filter Check - QA") via the separate PM completion modal (`labor_minutes=1`, checklist item marked "Passed") — `POST /v1/assets/pm-schedules/{id}/complete` → 200; schedule correctly dropped off the overdue list afterward.
5. **Staff role edit (non-hourly_rate)**: changed Claudia's role from Housekeeper → Front Desk (`PATCH /v1/staff/{id}` → 200, confirmed persisted in the list), then reverted back to Housekeeper (`PATCH` → 200, confirmed reverted) — leaves test data in its original state.
6. **Stock adjustment** (also exercised as a byproduct of Task 2 step 5, not a separate action): added 10 units of the new part via the pre-existing "Adjust stock" form (`POST /v1/inventory/parts/{id}/transactions` → 200) — unaffected by Plan 38-03/38-04's addition of the `unit_cost` field to the part-creation form.

## Task Commits
This plan performed no file changes — verification only, no commits beyond this SUMMARY.md and STATE.md update.

## Files Created/Modified
None (test-fixture data was created live in the Supabase dev project — one new engineering part, one new work order, three staff hourly_rate values, one PM completion — left in place per this repo's established convention of not deleting live-verification fixtures from the shared dev project, matching prior phases' "Engineering Shop (verification test)" location and WO-144 already present before this session).

## Decisions Made
See `key-decisions` in frontmatter above.

## Deviations from Plan
### Auto-fixed Issues
None — no code was broken or fixed during this plan; it is verification-only.

### Notable adaptations (not deviations from intent, but from the plan's literal steps)
1. Used `playwright-cli` instead of the `mcp__claude-in-chrome__*` Chrome extension tools, since the extension was not connected in this environment — both are explicitly named as acceptable in CLAUDE.md's Self-Verification Policy.
2. Verified the fully-populated cost case (GM's own hourly_rate set) rather than relying on Miguel's assigned_to rate, since claiming a WO in this codebase's model assigns it to the claiming user (no separate "assign to X" control exists on an unclaimed WO) — set the GM's own rate to get a clean non-partial total_cost through the browser, while the partial/NULL-fallback logic remained covered by Plan 38-02's existing unit tests.
3. Verified the hourly_rate non-leak-to-non-GM requirement via direct source read of `list_staff` rather than creating a second live account — this is the plan's own explicitly documented fallback ("If creating a second account isn't practical... this can instead be verified by re-reading apps/api/routers/staff.py's list_staff implementation").

## Issues Encountered
- Two work-order-creation attempts failed client-side validation before the "Other location" field was filled in (required); resolved by filling it — not a bug, just a required-field miss on first attempt.
- One part-consumption completion would have failed with an insufficient-stock error, since the newly created part had zero stock; resolved by adding 10 units via the Adjust Stock form before completing — this is the pre-flight stock check (Plan 38-02) working as designed, not a defect.
- An apparent "Access restricted" render flash on `/staff` page load, investigated fully (see key-decisions) and confirmed to be a pre-existing, harmless first-render race unrelated to Phase 38 — not fixed, out of scope.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
Phase 38 is complete. All 5 plans (01-05) executed, verified, and committed. The labor+cost capture feature (ranked #7 in `.planning/research/oss-ecosystem-landscape.md`'s Output-3 opportunity list) is live end-to-end: parts have a purchasable unit_cost, staff have a GM-managed hourly_rate, and completed work orders show a computed labor+parts+total cost — closing the "Parts + labor + cost on WO close" P0 gap from the OSS ecosystem research, on top of the parts-consumption work already shipped in the prior OSS build phase.

---
*Phase: 38-engineering-work-order-labor-and-cost-capture*
*Completed: 2026-09-16*

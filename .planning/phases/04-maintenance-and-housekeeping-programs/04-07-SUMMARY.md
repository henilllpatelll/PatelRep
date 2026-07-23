---
phase: 04-maintenance-and-housekeeping-programs
plan: 07
subsystem: web
tags: [housekeeping, dnd-welfare, deep-clean, public-areas, par-alerts, stayover, inspection-sampling, react-query, rbac]

# Dependency graph
requires:
  - phase: 04-06
    provides: "GET /programs/deep-clean-schedules, GET /programs/public-areas, GET /programs/inspection-sample, deepened GET /programs/inspection-quality"
provides:
  - "Complete housekeeping typed API clients in apps/web/lib/api/programs.ts (deep-clean, public-area, sampling, quality)"
  - "The full 4B housekeeping program depth UI on (dashboard)/programs: deep-clean + public areas, DND welfare timing/escalation policy config, passive par-alert badges, stayover rule, inspection sampling + quality trends"
  - "Confirmed (not rebuilt) DND welfare escalation cron already reads dnd_welfare_policies per-tenant with duplicate prevention"
affects: [04-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Multiple components sharing one React Query key (['operational-programs']) for a single overview fetch across independently-mounted panels -- no prop drilling, no duplicate network calls"
    - "Client-side manager gating computed as isSupervisor || canViewEngineering (useRole) to exactly mirror apps/api/routers/programs.py's MANAGER_ROLES tuple (gm, housekeeping_supervisor, engineer, chief_engineer), with a narrower isSupervisor-only gate on forms whose routes use the stricter require_role(gm, housekeeping_supervisor)"

key-files:
  created:
    - apps/web/components/programs/HousekeepingDepthPanels.tsx
    - apps/web/components/programs/DeepCleanAreasPanel.tsx
    - apps/web/components/programs/InspectionDepthPanel.tsx
  modified:
    - apps/web/lib/api/programs.ts
    - apps/web/app/(dashboard)/programs/page.tsx

key-decisions:
  - "Split the depth UI across 3 files instead of the single HousekeepingDepthPanels.tsx the plan's must_haves artifact spec described, because a single-file implementation hit 586 lines -- over CLAUDE.md's hard 500-line-per-file limit, which the workflow's CLAUDE.md-enforcement rule requires taking precedence over the plan. HousekeepingDepthPanels.tsx (245 lines, still comfortably over the plan's 150-line minimum) now composes DeepCleanAreasPanel.tsx (233 lines) and InspectionDepthPanel.tsx (175 lines) as siblings; all three share the 'operational-programs' React Query key so no extra network calls were introduced by the split."
  - "DND welfare cron confirmed already correct, not rebuilt: apps/api/routers/internal.py escalations/check (lines 615-669) reads dnd_welfare_policies.threshold_hours/escalation_roles per tenant and dedupes via an existing dnd_welfare_events row plus a same-day 'Welfare check' task check. The existing should_create_dnd_escalation unit test (test_operational_programs.py) already covers threshold + dedup, so no test or cron code changed for this plan."
  - "Removed the old inline DND/stayover/supply-par sections from ProgramsPage rather than duplicating them alongside the new depth panels -- HousekeepingDepthPanels.tsx is a superset (adds escalation_instructions, opt_out_allowed toggle, and the detailed passive par-alert badge list the old page only summarized as a count)."
  - "Deep-clean room targeting and the inspection-sampling room-type dropdown both reuse the existing roomsApi.list() client (GET /rooms, any authenticated role) rather than adding a new rooms endpoint scoped to this plan -- kept the API surface change limited to apps/api/routers/programs.py's existing routes, none of which needed modification."
  - "Worktree had neither apps/web/node_modules nor apps/api/.env (same gap 04-05 and 04-06 independently documented). Ran npm install at the repo root and in apps/web; created a local, gitignored apps/api/.env with dummy, non-functional Supabase values -- sufficient for the FakeDB-backed pytest suite, not sufficient for a live browser walkthrough (documented at the Task 3 checkpoint; the orchestrator's browser verification ran against the real dev servers after merging this branch onto main)."
  - "Worktree branch predated 04-01 through 04-06 landing on local main (same gap every prior 04-* plan in this phase independently documented). Fast-forward merged local main (ec683795) into this branch before starting -- clean fast-forward, no divergent local commits."

requirements-completed: [HK-01, HK-04, HK-05, HK-06, G12]

# Metrics
duration: "~50 min"
completed: "2026-07-23"
---

# Phase 4 Plan 07: Housekeeping Program Depth UI + DND Policy Verification Summary

Completed Slice 4B: the full housekeeping program depth UI (deep-clean schedules, public areas, DND welfare timing + a documented escalation policy, passive par-alert badges, stayover linen rule, inspection sampling + quality trends) shipped on `(dashboard)/programs`, backed by a now-complete typed API client set, with the pre-existing DND welfare escalation cron confirmed (not rebuilt) to already read the per-property policy correctly.

## Performance

- **Duration:** ~50 min
- **Tasks:** 2 auto tasks + 1 checkpoint (human-verify, approved by orchestrator via live browser test)
- **Files modified:** 5 (1 created-in-place extension, 4 new/modified web files)

## Accomplishments

- `apps/web/lib/api/programs.ts` now has every HK typed client the depth UI needs: `listDeepCleanSchedules`, `createDeepCleanSchedule`, `completeDeepClean`, `listPublicAreas`, `createPublicArea`, `inspectionSample`, `inspectionQuality`, `upsertSamplingRule` — closing gap G12.
- Confirmed (read-only, no code change needed) that `apps/api/routers/internal.py`'s `escalations/check` cron already reads `dnd_welfare_policies.threshold_hours`/`escalation_roles` per tenant and writes one immutable `dnd_welfare_events` row per DND window, deduped via an existing-event check plus a same-day "Welfare check" task check.
- Built the full 4B depth UI: deep-clean schedule list/create/complete + public-area list/create (`DeepCleanAreasPanel.tsx`), DND welfare policy config + stayover rule + passive par-alert badges + supply-par upsert (`HousekeepingDepthPanels.tsx`), and inspection sampling-rule config + today's rule-driven sample + quality trends by item/room-type/employee (`InspectionDepthPanel.tsx`).
- Live browser-verified end-to-end by the orchestrator (see Checkpoint Verification below): approved.

## Task Commits

Each task was committed atomically:

1. **Task 1: Complete the housekeeping typed clients + confirm DND policy → cron read path** — `829e11ee` (feat)
2. **Task 2: Build the housekeeping program depth UI** — `6ba1065a` (feat)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `apps/web/lib/api/programs.ts` — added `PublicArea`, `DeepCleanSchedule`, `DeepCleanOccurrence`, `InspectionSamplingRule`, `InspectionSampleResponse`, `InspectionQualityResponse` types + payload types; extended `ProgramOverview` with `public_areas` and richer nested shapes; added the 8 new client methods.
- `apps/web/components/programs/HousekeepingDepthPanels.tsx` (245 lines) — composes the DND welfare policy form (threshold + escalation-role multi-select + escalation-instructions textarea, the documented policy), the stayover linen rule form, the passive par-shortage badge list, the supply-par upsert form, and renders `DeepCleanAreasPanel`/`InspectionDepthPanel` as siblings.
- `apps/web/components/programs/DeepCleanAreasPanel.tsx` (233 lines) — deep-clean schedule list (target, interval, next-due) + create form (room/public-area target via a room picker sourced from `roomsApi.list()`) + "Mark complete" action; public-area list + create form.
- `apps/web/components/programs/InspectionDepthPanel.tsx` (175 lines) — inspection sampling-rule list + create form (room-type/experience-band/risk-level/sample-percent), today's rule-driven sample count, and the quality-trends view (by item/room-type/employee, pass-rate where available).
- `apps/web/app/(dashboard)/programs/page.tsx` — removed the old inline DND/stayover/supply-par sections (superseded by the new components, not duplicated); now renders `<HousekeepingDepthPanels />` below the existing templates section.

## Decisions Made

See `key-decisions` in the frontmatter above (500-line file split under CLAUDE.md; DND cron confirmed correct with no changes; old page sections removed rather than duplicated; reused existing `roomsApi.list()`; worktree environment gaps).

## Deviations from Plan

### Auto-fixed Issues

**1. [CLAUDE.md enforcement — file-size limit] Split HousekeepingDepthPanels.tsx into 3 files**
- **Found during:** Task 2, after the initial single-file implementation reached 586 lines.
- **Issue:** The project's `CLAUDE.md` mandates "Keep files under 500 lines" as a hard constraint that takes precedence over plan defaults. The plan's artifact spec asked for one `HousekeepingDepthPanels.tsx` file covering every panel, which produced a 586-line file.
- **Fix:** Extracted the deep-clean/public-area panel into `DeepCleanAreasPanel.tsx` and the inspection sampling/quality panel into `InspectionDepthPanel.tsx`, leaving `HousekeepingDepthPanels.tsx` as a 245-line composer holding the DND policy, stayover rule, and par-alert/supply sections. All three files share the `['operational-programs']` React Query key, so the split introduced no duplicate network calls. `HousekeepingDepthPanels.tsx` still exceeds the plan's 150-line minimum artifact requirement.
- **Files modified:** `apps/web/components/programs/HousekeepingDepthPanels.tsx`, `apps/web/components/programs/DeepCleanAreasPanel.tsx` (new), `apps/web/components/programs/InspectionDepthPanel.tsx` (new).
- **Verification:** `npm run type-check && npm run lint` clean after the split; live browser test (below) exercised all three components' golden paths.
- **Committed in:** `6ba1065a` (Task 2 commit — the split happened before the single commit, so no separate "before/after" commit pair exists).

**2. [Rule 1 — bug caught during self-authoring, fixed before commit] Rules-of-Hooks violation in first draft**
- **Found during:** Task 2, immediately after writing the first draft of `HousekeepingDepthPanels.tsx`.
- **Issue:** An early `if (!isManager) return null` was placed before several `useState`/`useMutation` calls, meaning those hooks would be skipped on non-manager renders — a React Rules-of-Hooks violation.
- **Fix:** Moved the early-return gate to immediately before the final JSX `return`, after every hook in the component (and in the two split-out sibling files, which inherited the same pattern from the start).
- **Files modified:** `apps/web/components/programs/HousekeepingDepthPanels.tsx` (fixed before its first commit; never landed broken).
- **Verification:** `npm run type-check` clean; component renders correctly for both manager and non-manager roles in the live browser test.

---

**Total deviations:** 2 (1 CLAUDE.md file-size enforcement, 1 self-caught pre-commit bug fix)
**Impact on plan:** Neither changed scope or behavior — the file split is a structural reorganization only (same panels, same data flow), and the hooks fix was caught and corrected before any commit landed. No functional deviation from the plan's intent.

### Environment / Tooling Gaps (worktree base-state, not a plan gap)

**Node modules + Python env, same class of gap 04-05 documented:** the worktree had no `apps/web/node_modules` and no `apps/api/.env`. Ran `npm install` at the repo root and again in `apps/web`; created a local, gitignored `apps/api/.env` with dummy, non-functional Supabase values (sufficient for the FakeDB-backed pytest suite, which never makes a real network call). This dummy `.env` is **not** sufficient for a live browser walkthrough — flagged explicitly at the Task 3 checkpoint. The orchestrator's browser verification ran against the real dev servers after merging this branch onto local `main` (which already had a working `.env`).

**Worktree predated 04-01 through 04-06 landing on local main:** same recovery every prior 04-* plan in this phase independently documented. `git merge --ff-only main` (268f7474 → ec683795) before starting any 04-07 work — clean fast-forward, no divergent local commits.

## TDD Gate Compliance

Not applicable — neither task in this plan was marked `tdd="true"`. The plan's Task 1(b) asked to "add/confirm" a unit test covering DND threshold + dedup; the existing `test_dnd_policy_only_creates_one_escalation_per_active_dnd_window` test (added in an earlier phase-04 plan) already covered exactly this, so no new test was authored and no RED/GREEN cycle applies.

## Checkpoint Verification (Task 3 — human-verify, orchestrator-performed)

The orchestrator merged this branch onto local `main` and ran a live Playwright browser test against the real dev servers (localhost:3000 + localhost:8003), per the project's mandatory Self-Verification Policy. **Result: APPROVED.**

What was verified end-to-end as the GM test account on `/programs`:
1. Page loads clean, zero console errors throughout the session.
2. Created a public area ("Rooftop Pool Deck - QA") via the form — 200, appeared in the list immediately.
3. Deep-clean schedule creation: the frontend payload was confirmed correct via network inspection (`{target_type, public_area_id, interval_days, next_due_on}` matches the schema exactly), but the POST failed due to a **pre-existing, unrelated server bug** (bug-484, below) — not a defect in this plan's work. The orchestrator seeded a schedule directly via DB to unblock verification; it rendered correctly with the right recurrence text, and "Mark complete" on it succeeded cleanly (200, no console errors).
4. DND welfare policy: set `threshold_hours=4` with escalation instructions, saved with no errors; reload confirmed both values persisted.
5. Stayover linen rule: saved with no errors.
6. Supply par: added "Bath towels - QA" (`on_hand=10`, `par_level=50`) — the passive shortage badge appeared correctly ("Bath towels - QA — 10/50 on hand · short 40"), with no cron/notification row created (matches the CONTEXT passive-badge decision).
7. Inspection sampling rules + quality trends: rendered real data (2 recent inspections, by-item/room-type/employee breakdowns all present).

### Bug found during verification (pre-existing, NOT introduced by this plan — logged, not fixed)

**bug-484** (`.wolf/buglog.json`): `POST /v1/programs/deep-clean-schedules` (and `POST /v1/programs/public-areas`, same pattern) return 500 whenever the request has a `date` field, because `create_deep_clean_schedule` (`apps/api/routers/programs.py:288-296`) builds the insert dict with `**request.model_dump()` — no `mode="json"` — so `CreateDeepCleanScheduleRequest.next_due_on` (a Python `date`) cannot be JSON-serialized by the Supabase client. Confirmed via git blame to predate phase 04 (introduced 2026-07-16, commit `fea45b29`) — the same systemic anti-pattern as bug-478 (a UUID case in a different router). Out of scope for this plan/phase; the frontend payload built by `DeepCleanAreasPanel.tsx` is confirmed correct. Not fixed here per the orchestrator's explicit instruction (pre-existing, unrelated, out of phase scope).

### Non-blocking observation (not a defect, matches 04-06's own spec)

Inspection quality trends' room-type and employee breakdowns render raw UUIDs instead of resolved display names. This exactly matches `04-06-PLAN.md`'s own contract (`{key, count, pass_rate/fail_rate}` where `key` = `room_type_id`/`employee_id`) — a pre-existing API-shape gap from 04-06, not something this plan's UI got wrong. Worth a future polish pass (resolve `room_type_id`→name and `employee_id`→display name server-side or client-side), not a defect blocking this plan's closure.

## Known Stubs

None — every panel renders real data from the `/programs/overview`, `/programs/inspection-sample`, and `/programs/inspection-quality` endpoints; empty-state messages ("No deep-clean schedules have been added yet.", "No rooms assigned yet today.", etc.) are legitimate empty states, not hardcoded placeholders.

## Threat Flags

None — every surface touched matches this plan's own `<threat_model>` (T-04-22 through T-04-25): all mutation routes already require the management role set server-side (unchanged by this plan), every read/write is tenant-scoped via the existing `/programs` routes, the DND welfare escalation remains append-only and duplicate-prevented (confirmed, not modified), and the par-alert badge remains a passive advisory surface with no automated action (T-04-25, accepted disposition, matches CONTEXT decision).

## Next Phase Readiness

- The full 4B housekeeping program depth surface is live and verified: deep-clean/public-area management, DND welfare policy configuration, passive par alerts, stayover rules, and inspection sampling/quality all render and mutate correctly against the tenant-scoped API.
- `04-08` (4C — bilingual enforcement) can now wire the `programs` i18n namespace over this plan's intentionally plain-English strings (deliberately structured to not block that follow-up: no strings embedded in a way that would require restructuring for `t()` wrapping).
- **Follow-up items for a future plan (not blockers for this plan's closure):** fix bug-484 (`request.model_dump(mode="json")` in `create_deep_clean_schedule`/`create_public_area`, matching the pattern already used correctly in `assets.py`'s `complete_pm_schedule`); resolve raw UUID labels in the quality-trends by-room-type/by-employee breakdowns to display names.

## Self-Check: PASSED

- FOUND: `apps/web/lib/api/programs.ts` contains `listDeepCleanSchedules`, `createDeepCleanSchedule`, `completeDeepClean`, `listPublicAreas`, `createPublicArea`, `inspectionSample`, `inspectionQuality`, `upsertSamplingRule`
- FOUND: `apps/web/components/programs/HousekeepingDepthPanels.tsx` (245 lines)
- FOUND: `apps/web/components/programs/DeepCleanAreasPanel.tsx` (233 lines)
- FOUND: `apps/web/components/programs/InspectionDepthPanel.tsx` (175 lines)
- FOUND: `apps/web/app/(dashboard)/programs/page.tsx` renders `<HousekeepingDepthPanels />`
- FOUND: commit `829e11ee` (Task 1)
- FOUND: commit `6ba1065a` (Task 2)
- VERIFIED: `cd apps/web && npm run type-check && npm run lint` clean
- VERIFIED: `cd apps/api && python -m pytest tests/ -q` → 337 passed (unchanged — no API code modified this plan)
- VERIFIED: DND dedup unit test (`test_dnd_policy_only_creates_one_escalation_per_active_dnd_window`) passes
- VERIFIED: Task 3 checkpoint approved by orchestrator via live browser test against real dev servers (see Checkpoint Verification above)

---
*Phase: 04-maintenance-and-housekeeping-programs*
*Completed: 2026-07-23*

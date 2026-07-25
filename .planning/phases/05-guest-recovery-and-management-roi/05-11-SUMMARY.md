---
phase: 05-guest-recovery-and-management-roi
plan: 11
subsystem: web
tags: [nextjs, react-query, settings, sla-policy, accessibility, rbac]

# Dependency graph
requires:
  - phase: 05-guest-recovery-and-management-roi
    provides: "guestRequestsApi.listSlaPolicies/createSlaPolicy/deleteSlaPolicy/listAccessibleRoomFeatures/upsertAccessibleRoomFeature typed client methods (05-07); SLA policy CRUD + room-status-aware accessibility API (05-05)"
provides:
  - "settings/guest-requests/page.tsx — SLA rule list/create/delete UI, nav-linked for gm + housekeeping_supervisor (D-13)"
  - "settings/rooms/page.tsx Accessibility Features tab — accessible-room feature list/add/edit UI (D-14)"
  - "components/settings/SlaPolicyForm.tsx — SlaPolicyCard / SlaPolicyFormCard reusable pair"
affects: [guest-recovery-settings-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SLA policy settings page clones settings/inspections' role-gate + toast + empty-state shape exactly, per plan interfaces contract"
    - "Accessibility tab strip added above an existing settings table without a new route, reusing the page's existing allRooms memo instead of a second query"
    - "Manager-write / any-authenticated-read split reused on the web side: SLA list query has no canManage gate, only the create/delete controls do"

key-files:
  created:
    - apps/web/components/settings/SlaPolicyForm.tsx
    - apps/web/app/(dashboard)/settings/guest-requests/page.tsx
  modified:
    - apps/web/app/(dashboard)/settings/layout.tsx
    - apps/web/app/(dashboard)/settings/rooms/page.tsx

key-decisions:
  - "Accessibility tab's intro paragraph is not paired with a redundant h2 'Accessibility Features' heading — the tab strip label already serves that role, and the plan's grep acceptance criterion requires the exact string to appear exactly once in the file (the tab button text), so no separate heading duplicates it."
  - "SlaPolicyFormCard is create-only (no edit/update) matching the plan's scope — API only exposes list/create/delete for SLA policies, no PATCH/PUT."
  - "Accessible-room feature 'edit' reuses the same upsert form pre-filled with the existing row's room_id + feature_code, per the plan's note that the API's PUT is upsert-keyed and needs no separate update endpoint."
  - "Created a dummy apps/web/.env.local (gitignored, uncommitted) to unblock `next build`'s static-page prerender step, which needs a Supabase URL/key even for pages unrelated to this plan (/reports, /ai) — same documented no-live-credentials constraint as prior Phase 5 plans' worktrees."

requirements-completed: [D-13, D-14]

# Metrics
duration: ~35 min active work (3 tasks) + one-time worktree dependency install
completed: 2026-07-24
---

# Phase 5 Plan 11: Guest Recovery Settings UI (SLA Rules + Accessibility Features Tab) Summary

**Two previously API-only Phase 5 configuration tables are now reachable from Settings: a new Settings > Guest Requests page for SLA rule CRUD, and an Accessibility Features tab on the existing Settings > Rooms page — both cloning the exact list/create/delete and tab-strip patterns from `settings/inspections` and `GuestRequestsPage.tsx` per the UI-SPEC contract.**

## Performance

- **Duration:** ~35 min active work across 3 tasks, plus a one-time `npm install --legacy-peer-deps` in `apps/web` (this worktree checkout had no `node_modules`)
- **Started:** 2026-07-24 (worktree base corrected to `e6913538`, first commit `5820e12d`)
- **Completed:** 2026-07-24 (last commit `9a00bd29`)
- **Tasks:** 3 (all auto)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `components/settings/SlaPolicyForm.tsx`: `SlaPolicyCard` (read-only rule row rendering `Any` for null dimensions, mono `sla_minutes`, delete icon gated by `canManage`) and `SlaPolicyFormCard` (category/priority/guest-impact selects, bounded `1–10080` minutes input, and an inline hint + disabled save button blocking the all-wildcard case client-side so the API's 422 is unreachable through the UI).
- `settings/guest-requests/page.tsx`: full SLA rule list/create/delete page cloning `settings/inspections/page.tsx`'s role gate, toast (3-second auto-dismiss, `role="alert"`), and empty-state `Card` shape. Read is open to any authenticated staff (`enabled: !!hotel?.id`, not gated on `canManage`); write controls (`New SLA Rule` button, delete icon) render only for `gm`/`housekeeping_supervisor`. Delete uses `DeleteConfirmDialog` with the exact UI-SPEC copy. Error toasts derive their message from the caught `ApiClientError`, so the API's 409 duplicate-combination detail reaches the user verbatim rather than a generic string.
- `settings/layout.tsx`: added the `Guest Requests` nav entry to the `Configuration` group directly after `Inspections`, `roles: ['gm', 'housekeeping_supervisor']` matching the API's `SLA_POLICY_ROLES` exactly; imported `MessageSquare` alongside the existing `MessageSquareWarning`.
- `settings/rooms/page.tsx`: added a `Rooms | Accessibility Features` tab strip above the existing content (cloned from `GuestRequestsPage.tsx`'s tab pattern); the entire pre-existing rooms table/filter chrome is now wrapped in `{activeTab === 'rooms' && (...)}` with zero internal changes. The new Accessibility tab reuses the page's existing `allRooms` memo for the room picker (no second `roomsApi` call — verified unchanged call count), lists `accessible_room_features` rows with a status `Pill` (`operational`→ready, `out_of_service`→alert, `inspection_due`→caution) and `formatDistanceToNow` for `last_verified_at`, and an add/edit form gated to `{gm, housekeeping_supervisor, engineer}` matching the API's `PUT` write gate exactly. Editing an existing row pre-fills the same upsert form (same room + feature code), per the plan's note that the API is upsert-keyed with no separate update endpoint.

## Task Commits

Each task was committed atomically:

1. **Task 1: SlaPolicyForm components** — `5820e12d` (feat)
2. **Task 2: Settings > Guest Requests page and its navigation entry** — `34207f48` (feat)
3. **Task 3: Accessibility Features tab on Settings > Rooms** — `9a00bd29` (feat)

## Files Created/Modified

- `apps/web/components/settings/SlaPolicyForm.tsx` — `SlaPolicyCard`, `SlaPolicyFormCard`, `SlaPolicyFormValues`, `EMPTY_SLA_POLICY_FORM`
- `apps/web/app/(dashboard)/settings/guest-requests/page.tsx` — `GuestRequestsSettingsPage` (new route)
- `apps/web/app/(dashboard)/settings/layout.tsx` — `Guest Requests` nav entry, `MessageSquare` import added
- `apps/web/app/(dashboard)/settings/rooms/page.tsx` — tab strip, `activeTab` state, Accessibility Features tab content (query, add/edit form, table), existing Rooms tab content wrapped unchanged

## Decisions Made

See `key-decisions` in frontmatter. Summary: no redundant heading duplicating the tab-strip label on the Accessibility tab (keeps the plan's exact-count grep criterion honest); SLA form is create-only per the API's actual surface; accessible-room-feature "edit" is the same upsert form pre-filled; a gitignored dummy `apps/web/.env.local` was created to let `next build`'s prerender step complete in this credential-free worktree.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed web app dependencies in this fresh worktree checkout**
- **Found during:** Task 1, before `npm run type-check` could run
- **Issue:** This worktree's `apps/web/node_modules` did not exist, so `npm run type-check`/`lint`/`build` would all fail on missing-module errors unrelated to this plan's code.
- **Fix:** Ran `npm install --legacy-peer-deps` (plain `npm install` hits the pre-existing `@hookform/resolvers`/`valibot` peer-dependency conflict noted by the prior wave's executor). Reverted the resulting `package-lock.json` diff (metadata-only churn from the legacy-peer-deps resolver) since it introduced no real dependency changes.
- **Files modified:** none committed (node_modules gitignored; lockfile diff reverted).
- **Verification:** `npm run type-check`, `npm run lint`, `npm run build` all exit 0 after the install.
- **Committed in:** N/A — install-only.

**2. [Rule 3 - Blocking] Created a gitignored `apps/web/.env.local` with dummy Supabase values**
- **Found during:** Task 2, running the plan's full `type-check && lint && build` verification.
- **Issue:** `next build`'s static-page prerender step fails on `/reports` and `/ai` (unrelated pages) with `@supabase/ssr: Your project's URL and API key are required` because this worktree has no `apps/web/.env.local` — the documented no-live-credentials constraint. This blocked verifying the build succeeded at all, including for the pages this plan actually changed.
- **Fix:** Wrote `apps/web/.env.local` with dummy, non-live values (`NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co`, etc.), matching the same pattern the API-side plans (05-02, 05-05) used for `apps/api/.env`. Gitignored, never staged.
- **Files modified:** `apps/web/.env.local` (untracked, not committed).
- **Verification:** `npm run build` completes and lists `/settings/guest-requests` and `/settings/rooms` as prerendered static routes.
- **Committed in:** N/A — gitignored by design.

**3. [Rule 1 - Bug] Removed a duplicate 'Accessibility Features' heading on the new tab**
- **Found during:** Task 3, acceptance-criteria self-check (`grep -c 'Accessibility Features'` must return exactly `1`).
- **Issue:** The initial draft rendered both the tab-strip button text and a page-local `<h2>Accessibility Features</h2>` heading, producing 2 occurrences and failing the plan's exact-count grep criterion.
- **Fix:** Removed the redundant `<h2>` (the tab label already communicates the section), keeping only the intro paragraph beneath it.
- **Files modified:** `apps/web/app/(dashboard)/settings/rooms/page.tsx`.
- **Verification:** `grep -c 'Accessibility Features'` now returns `1`; type-check/lint/build all still pass.
- **Committed in:** `9a00bd29` (bundled into the task's single commit, caught before commit).

**4. [Rule 3 - Blocking] Reverted `next-env.d.ts` and `package-lock.json` churn after each build/install**
- **Found during:** Tasks 1–3, after every `npm run build`.
- **Issue:** `next build` rewrites `apps/web/next-env.d.ts`'s two `.next/dev/types/...` reference paths to `.next/types/...` as a build-time side effect (the file's own header says "should not be edited"); `npm install` similarly perturbed `package-lock.json` metadata with no real dependency change.
- **Fix:** `git checkout -- apps/web/next-env.d.ts` / `git checkout -- apps/web/package-lock.json` after each verification run, before staging task files.
- **Files modified:** none (reverted, not committed).
- **Verification:** `git status --short` shows no residual diff on either file after each task's commit.
- **Committed in:** N/A — reverted, not committed.

---

**Total deviations:** 4 auto-fixed (3 blocking, 1 bug)
**Impact on plan:** No scope creep, no plan-code behavior changes beyond the heading fix, no secrets involved.

## Issues Encountered

None beyond the four deviations above, all resolved within the task they occurred in.

## Live Verification Note

Per CLAUDE.md's Self-Verification Policy, full browser click-through against a running `npm run dev:web` + `npm run dev:api` pair was **not performed** in this worktree — this worktree has no `apps/api/.env` or Python `.venv` configured (the codebase's documented no-live-credentials constraint), so there is no backing API to exercise these pages against with real data. All three tasks' grep-based acceptance criteria pass, `npm run type-check`, `npm run lint`, and `npm run build` are all clean (the production build lists both `/settings/guest-requests` and `/settings/rooms` as successfully prerendered static routes), and every page/component was built directly against the typed `guestRequestsApi` client methods and `SlaPolicy`/`AccessibleRoomFeature` interfaces that 05-07 already delivered and 05-05's API already implements. This mirrors the same documented limitation noted in 05-05's and 05-07's summaries for this phase. The plan's `<verification>` section's live-localhost walkthrough (create/list/duplicate-409/delete an SLA rule; add/edit an accessibility feature) should be the first thing exercised once live credentials are available.

## User Setup Required

None new. This plan makes no API or infrastructure changes — it only wires existing 05-05/05-07 API surfaces into new web UI.

## Next Phase Readiness

- D-13 (SLA rule CRUD reachable by a human) and D-14 (accessible-room features managed from a Rooms tab, not a new page) are both implemented, nav-linked, and role-gated to match the API exactly.
- The 240-minute SLA default is now overridable through the UI without a direct API call.
- No blockers for downstream Phase 5 plans. The one open item is the live-browser verification gap noted above, consistent with this phase's existing no-credentials constraint.

## Known Stubs

None. Both new surfaces are wired to real API calls via the typed `guestRequestsApi` client (no hardcoded empty arrays, no placeholder-only components).

## Threat Flags

None. All new UI surface area (SLA rule writes, accessible-room feature writes) was already anticipated and dispositioned in this plan's `<threat_model>` (T-05-11-01 through T-05-11-07); no undocumented network endpoint, auth path, or schema change was introduced — every write calls an existing 05-05 API endpoint through the existing 05-07 typed client.

## Self-Check: PASSED

- `apps/web/components/settings/SlaPolicyForm.tsx` — FOUND
- `apps/web/app/(dashboard)/settings/guest-requests/page.tsx` — FOUND
- `apps/web/app/(dashboard)/settings/layout.tsx` — FOUND
- `apps/web/app/(dashboard)/settings/rooms/page.tsx` — FOUND
- Commit `5820e12d` (Task 1) — FOUND
- Commit `34207f48` (Task 2) — FOUND
- Commit `9a00bd29` (Task 3) — FOUND

---
*Phase: 05-guest-recovery-and-management-roi*
*Completed: 2026-07-24*

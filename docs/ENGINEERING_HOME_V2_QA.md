# Engineering Home V2 - Phase 7 QA report

Scope: verification and defect correction for PR #198 (draft). No product code changed in Phase 7. No defect was found
that the checks below could detect; the remaining gaps are verification gaps (section 9), not known bugs.

## A. Environment

| Item | Value |
|---|---|
| Repository / branch | `henilllpatelll/PatelRep`, `feat/mobile-engineering-home-v2` (worktree `PatelRep-enghome`) |
| Base | `ec6bca00` (main, includes #194 non-destructive staging) |
| Tested head | `eae9798b` (Phase 6). The Phase 7 commit adds only this file. |
| Diff vs main | 59 files, all under `apps/mobile` plus `docs/`. **No `apps/api`, migration, workflow or RBAC change.** |
| Test runner | Windows 11, Node via `apps/mobile`, Jest (jest-expo), TypeScript, ESLint; Python 3.13 venv with CI's dummy env for API tests |
| API / database | None. Jest mocks the API layer; API tests use the repo's fake Supabase. The local `apps/api/.env` points at production Supabase and was **not used**. |
| Device / emulator | **None used.** Android SDK and AVDs exist locally, but no dev client was built and no non-production backend is available (section 9). |
| Browser harness | Expo web (react-native-web) in Chromium 390x844, throwaway route with `api.get` replaced by seeded data, deleted before commit. This renders the real components; it is **not** a native device and does not apply OS font scaling. |

## B. Coverage matrix

Two layers per row. **Auto** = Jest/pytest (the full suites below pass; "existing suite" means it passes but its assertions
were not re-reviewed in Phase 7). **Live/device** = real API on a real or emulated device. Live/device is BLOCKED for every row.
Render = also seen in the browser harness (screenshots kept outside the repo).

### Technician Home (role `engineer`)

| # | Feature | Role rule | Source | Auto reference | Auto | Render | Live/device |
|---|---|---|---|---|---|---|---|
| T1 | Personalized header, role label | engineer | auth store | EngineerHome.test.tsx | PASS | seen (EN, ES, long name) | BLOCKED |
| T2 | Hotel identity | engineer | `useSettingsIdentity` | EngineerHome.test.tsx | PASS | not seeded in harness | BLOCKED |
| T3 | Notifications bell/badge | engineer | unread count | EngineerHome.test.tsx, NotificationsScreen.test.tsx | PASS | bell seen | BLOCKED |
| T4 | Connection/sync status | engineer | `resolveSyncStatus` | homeReliability.test.ts, EngineerHome.test.tsx | PASS | synced/offline/error text seen | BLOCKED |
| T5 | My Jobs (exact, summary-first) | engineer | `/work-orders/summary` | homeReliability.test.ts (count/destination parity) | PASS | seen | BLOCKED |
| T6 | Urgent (deduped queue) | engineer | active queue | homeReliability.test.ts | PASS | 1 normal, 4 emergency-heavy | BLOCKED |
| T7 | PM Due (hotel day) | engineer | `/assets/pm-schedules` | homeReliability.test.ts (DST, 3 zones) | PASS | seen | BLOCKED |
| T8 | Continue Repair | engineer | queue | homeFocus.test.ts, EngineerHome.test.tsx | PASS | seen | BLOCKED |
| T9 | Start Next Job | engineer | queue | homeFocus.test.ts | PASS | not seeded | BLOCKED |
| T10 | Resume PM Inspection | engineer | saved drafts | homeFocus.test.ts, pmSyncItems.test.ts | PASS | not seeded | BLOCKED |
| T11 | View Available Work | engineer | queue | homeNavigation.test.ts | PASS | seen | BLOCKED |
| T12 | Needs Attention (order, dedupe) | engineer | queue + PM + drafts | homeReliability.test.ts (shuffle determinism) | PASS | seen | BLOCKED |
| T13 | Report Issue entry | engineer | route | homeRoutesExist.test.ts, ReportIssueScreen.test.tsx | PASS | button seen | BLOCKED |
| T14 | Scan Asset entry | engineer | route | homeRoutesExist.test.ts, AssetScan.test.tsx | PASS | button seen | BLOCKED |
| T15 | Room Status entry | engineer | route | homeRoutesExist.test.ts | PASS | button seen | BLOCKED |
| T16 | Empty state only after authoritative success | engineer | all sources | EngineerHome.test.tsx (all-clear withheld on failed queue/PM) | PASS | seen | BLOCKED |
| T17 | Error state, per-source retry, no all-clear | engineer | all sources | EngineerHome.test.tsx | PASS | seen (queue and PM) | BLOCKED |
| T18 | Offline state, saved copy | engineer | offline cache | useEngineeringHome.test.tsx | PASS | seen | BLOCKED |

### Chief Engineer Home (role `chief_engineer`)

| # | Feature | Source | Auto reference | Auto | Render | Live/device |
|---|---|---|---|---|---|---|
| C1 | Management header | auth | ChiefEngineerHome.test.tsx | PASS | seen (EN, ES) | BLOCKED |
| C2 | Needs Owner | `counts.needs_owner` | chiefHomeNavigation.test.ts, homeReliability.test.ts | PASS | seen | BLOCKED |
| C3 | In Progress | `counts.in_progress` | homeReliability.test.ts | PASS | seen | BLOCKED |
| C4 | On Hold | `counts.on_hold` | homeReliability.test.ts | PASS | seen | BLOCKED |
| C5 | Property Priorities (rank) | `needs_attention` | chiefHomeModel.test.ts | PASS | seen | BLOCKED |
| C6 | Emergency work | `needs_attention` | chiefHomeModel.test.ts | PASS | seen (emergency scenario) | BLOCKED |
| C7 | Assignment-required work | `needs_owner` | ChiefEngineerHome.test.tsx | PASS | seen | BLOCKED |
| C8 | Room downtime | `rooms_down` | chiefHomeModel.test.ts | PASS | seen | BLOCKED |
| C9 | PM oversight | `pm_oversight` | ChiefEngineerHome.test.tsx | PASS | seen | BLOCKED |
| C10 | Team Workload (no invented availability) | `technicians` | ChiefEngineerHome.test.tsx, TeamOverview.test.tsx | PASS | seen | BLOCKED |
| C11 | Assign Work | Available view | chiefHomeNavigation.test.ts | PASS | button seen | BLOCKED |
| C12 | Team Overview | `/team` | chiefHomeNavigation.test.ts | PASS | not seeded | BLOCKED |
| C13 | PM Planning, Assets | routes | chiefHomeNavigation.test.ts | PASS | not seeded | BLOCKED |
| C14 | Notifications, Engineering Sync | store, sync summary | ChiefEngineerHome.test.tsx | PASS | seen | BLOCKED |
| C15 | No technician-only controls on chief Home | roles.ts | ChiefEngineerHome.test.tsx ("offers no technician-only work order action") | PASS | none shown | BLOCKED |
| C16 | Empty / error / offline ("Assigning needs a connection") | overview | ChiefEngineerHome.test.tsx | PASS | seen | BLOCKED |

### Connected and cross-cutting workflows

| # | Workflow | Auto reference | Auto | Live/device |
|---|---|---|---|---|
| S1 | Work-order detail, claim | WorkOrderDetail.test.tsx, claim.test.tsx (existing suites) | PASS | BLOCKED |
| S2 | Start / hold / resume / complete repair | WorkOrderDetail.test.tsx, offlineActions.test.ts; API `test_work_order_transitions.py` | PASS | BLOCKED |
| S3 | Report issue (validation, retry, duplicate guard) | reportIssue.test.ts, useReportIssue.test.tsx, ReportIssueScreen.test.tsx | PASS | BLOCKED |
| S4 | Assign / reassign (wrong hotel or role, other hotel's order, role gate) | ChiefEngineerHome.test.tsx; API `test_work_order_assign.py` (the 409 stale-assignee path is in the endpoint; its test was not individually re-read) | PASS | BLOCKED |
| S5 | Asset scan, unknown code, manual lookup, details | AssetScan.test.tsx, assetLookup.test.ts, AssetDetail.test.tsx | PASS | BLOCKED (camera) |
| S6 | PM draft create/resume, completion queue | pmDraftStore.test.ts, usePmInspectionOffline.test.tsx, PmInspection.test.tsx | PASS | BLOCKED |
| S7 | Room details / room impact | EngineeringRoomDetail.test.tsx, ChiefEngineerHome.test.tsx; API `test_work_order_room_out_of_order.py` exists but was NOT run or re-read in Phase 7, so the no-auto-release rule is unverified here | PASS (UI only) | BLOCKED |
| S8 | Attention and card navigation, destinations exist | homeNavigation.test.ts, homeRoutesExist.test.ts, homeNavigate.test.ts | PASS | BLOCKED |
| S9 | Back behavior, double-tap lock | homeNavigate.test.ts, WorkOrdersNavigation.test.tsx | PASS | BLOCKED (hardware back) |
| S10 | Sync recovery, Home line vs Engineering Sync | EngineeringSync.test.tsx, homeReliability.test.ts | PASS | BLOCKED |
| S11 | Server RBAC for team/assign/transition | API `test_engineering_team.py`, `test_work_order_assign.py`, `test_work_order_transitions.py` | PASS | BLOCKED (live tokens) |
| S12 | Cross-tenant rejection | `test_another_hotels_manager_sees_only_their_own_hotel`, `test_another_hotels_order_is_not_found`, `test_transition_rejects_work_order_from_different_tenant` | PASS | BLOCKED |
| S13 | Account/hotel switch isolation (drafts, queue, cache) | pmDraftStore.test.ts, accountSwitchIsolation.test.ts, useEngineeringHome.test.tsx | PASS | BLOCKED |
| S14 | Offline queue, drafts, no silent discard | offlineStore.test.ts, pmSyncRunner.test.ts, useWorkQueueOffline.test.tsx | PASS | BLOCKED |
| S15 | Realtime burst, resume refresh, late-answer drop | useWorkOrderRealtime.test.tsx, useRefreshOnResume.test.tsx, useEngineeringHome.test.tsx | PASS | BLOCKED |
| S16 | Metric label / value / destination parity | homeReliability.test.ts; static re-check in section D | PASS | BLOCKED |
| S17 | EN/ES parity, plural keys, no raw keys | chiefHomeI18n.test.ts, pluralKeys.test.ts, CI "EN/ES i18n Parity"; ES seen in browser | PASS | BLOCKED |
| S18 | Request budget / perf | engineeringHomeRequests.test.tsx | PASS | NOT RUN (no timing harness) |
| S19 | Large text, small phone, landscape, keyboard, dark sheets | none | NOT RUN | BLOCKED |
| S20 | Android hardware back from each sheet | none | NOT RUN | BLOCKED |

**Totals (54 rows).** Auto layer: 52 PASS, 0 FAIL, 2 NOT RUN (S19, S20). Live/device layer: 0 PASS, 53 BLOCKED, 1 NOT RUN (S18).
Technician 18, Chief 16, shared 20.

## C. Automated testing (all on head `eae9798b`)

| Command | Result |
|---|---|
| `npx tsc --noEmit` (apps/mobile) | pass, no errors |
| `npm run lint` (apps/mobile) | pass, no output |
| `npx jest` (apps/mobile, full) | **459 suites, 10,449 tests passed**, 0 failed |
| `npx jest __tests__/perf/engineeringHomeRequests.test.tsx` | 12 passed, table in section G |
| `pytest` on `test_engineering_team`, `test_work_order_assign`, `test_work_order_transitions`, `test_pm_mobile_reads`, `test_pm_management`, `test_pm_schedules`, `test_work_order_list_queue`, `test_work_order_stats`, `test_work_order_idempotency` | **139 passed**, 2 library deprecation warnings |

Limitations: API tests run against the repo's fake Supabase, not a database. Jest noise (an auth-refresh stack in a log) did
not fail anything. In this worktree Jest resolved `node_modules` through a sibling worktree path (`PatelRep-pmassets`);
CI's clean install is the authoritative run (section H).

## D. Metric and destination parity (static re-check against the API)

| Count | Server definition | Destination | Match |
|---|---|---|---|
| Needs Owner | unassigned and status open/escalated (`engineering_team.py:263`) | Work `available`: `unassigned=true`, open/escalated (`workQueue.ts`) | yes |
| In Progress | assigned and in_progress (`:264`) | Work `team` + `in_progress`: assigned to others | yes, **assumes a chief holds no assignments** (doc 13.2) |
| On Hold | all on_hold | Work `waiting`, no assignment filter | yes |
| Urgent (technician) | queue emergency/urgent, any active status | Work `all` + `urgent` | yes |
| My Jobs | `total - waiting` from summary | Work `mine` + `actionable` (excludes on hold) | yes |

## E. Security

- `GET /engineering/team/overview` and `/technicians`: `require_role("chief_engineer","gm")`; tests prove other roles are refused and another hotel's manager sees only their hotel.
- `POST /work-orders/{id}/assign`: chief_engineer/gm only; target must be an active engineer **of the same tenant**; another hotel's order is 404; stale assignee is 409.
- Repair transitions: `engineer`/`gm` only. A chief is refused by the server, so the missing chief buttons are not the only control.
- This PR adds **no** endpoint, RBAC or schema change. Tenant scope in `engineering_team.py` is via `current_user.hotel_id`.
- Client isolation: queue, drafts and cache are keyed `tenant:user`; `setUser` clears the previous person's rooms, tasks, work-order cache and in-memory reads on a user or hotel change (`stores/appStore.ts`). Logout takes the same path.
- Not done: live negative tests with real expired/foreign tokens (BLOCKED, no non-production environment used).

## F. Offline, sync and realtime

Covered by Jest as listed in S13-S15: offline open shows the saved copy and never "synced" or "all clear"; failed or
unreadable queues withhold the all-clear; one trailing reload per 1.5 s realtime burst; focus within 1 s does not refetch;
late answers for an old user, hotel or role are dropped. Not exercised on a device: real connectivity loss during a
submit, reconnect storms, background/foreground on hardware.

## G. Performance

Method: `engineeringHomeRequests.test.tsx` counts API reads per scenario (mocked network, no timings). The Phase 5 baseline
is in `ENGINEERING_HOME_V2.md` 13.9. Phase 7 re-measurement on `eae9798b`:

| Scenario | Technician work/PM/summary | Chief overview |
|---|---|---|
| Initial open | 1 / 1 / 1 | 1 |
| 10 realtime events in one burst | 1 / 1 / 1 | 1 |
| 3 focus events in 1 s | 0 / 0 / 0 | 0 |
| Focus + realtime | 1 / 1 / 1 | 1 |
| Local mutation + realtime echo | 1 / 1 / 1 | 1 |

Identical to the Phase 5 "after" column: no regression. Not measured: payload bytes, time to data, frame rate, memory.
No timing numbers are claimed.

## H. Visual QA (browser harness, not a device)

Both roles rendered in: normal, emergency-heavy, empty, offline, error, long names/long descriptions, Spanish + dark,
and a 22 px root font on 360x640. Observed: no clipped text or overlapping controls, long titles truncate with an ellipsis on
the card and wrap in the list, counts and labels are correct for each scenario, errors show retry and `-` instead of zeros,
offline chief shows "Assigning needs a connection". react-native-web ignores OS font scale, so real large-text behavior is
unverified. Safe areas, keyboard avoidance, bottom-sheet scrolling and the tab bar are not present in the harness.

## I. Defects

None found in Phase 7. No P0/P1/P2/P3 defects reproduced; no regression test added.
Known, previously documented, unchanged: the 700 ms navigation lock exists on Home only (P3); Room Impact shows the
aggregate only because no per-room read exists (scope gap, not a defect); chief In Progress parity relies on a chief
holding no assignments.

## J. GitHub

Before this commit, PR #198 head `eae9798b` had 29/29 checks green including CI Gate, Mobile Jest/Lint/Type-check, Database
Migration Gate, Test/API and Staging Gate. Checks for the final pushed SHA are recorded in the PR after the push; old
results are not reused. Staging is non-destructive on this branch (`staging-candidate.yml` comment: never reset or wiped;
#194). No staging or production operation was run by hand.

## K. Blockers and Phase 8 readiness

1. **Native device/emulator pass not done** (S19, S20, camera, hardware back, keyboard, real font scale, dark sheets). Unblock: build a dev client or use Expo Go-compatible SDK on an AVD (`Pixel_8` exists) and walk both roles.
2. **No live-API pass** for any workflow. Unblock: an isolated non-production hotel with seeded engineer and chief accounts. The local `.env` is production and must not be used.
3. **Live negative-authorization and offline-reconnect tests** need the same environment.

**NOT READY - BLOCKERS REMAIN.** No defect is known; the blockers are verification the brief requires and this session
could not perform. Not production approval.

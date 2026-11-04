# Engineering More V2 — redesign contract

Source of truth for the **More** tab redesign for the `engineer` and `chief_engineer` mobile logins. All eight phases ship on one branch (`feat/engineering-more-v2`) through **one** pull request, `feat(mobile): Engineering More V2 — complete UX redesign`. Do not open per-phase PRs; do not merge until all phases are complete, tested and approved.

Phases 1–8 are complete in code. §1–§7 describe the Phase 1 contract as originally written; later sections record what each phase changed and §12 is the final Phase 8 audit. Where an earlier section is superseded, §12 wins.

## 1. Existing vs. target architecture

| | Today (rendered) | Target (V2 contract, Phase 1) |
|---|---|---|
| Source | `lib/engineering/moreMenu.ts` | same file; `MORE_CATALOG` is the single declaration |
| Layout | 3 sections: Operations, Account, Management | 5 groups: Account, Engineering tools, Notifications & sync, Help & support, Management |
| API | `getEngineeringMoreSections(role)` | unchanged, plus `getEngineeringMoreGroups(role)`, `isMoreItemAvailable(role, key)` |
| Screen | `app/(app)/more/index.tsx` (SettingsScreen rows) | replaced in Phase 2 |

`getEngineeringMoreSections` output (sections, rows, order) is pinned by a test so the current screen cannot drift before Phase 2 replaces it. Both views are derived from the catalog; there is no second menu system.

Bottom tabs stay **Home | Work | PM | Assets | More** (`ENGINEER_TABS` in `lib/navigation/roleTabs.ts`, shared by both roles). Pinned by tests.

## 2. Engineer vs. Chief Engineer

| Capability | engineer | chief_engineer | Server guard |
|---|---|---|---|
| All rows in groups Account, Tools, Notifications & sync, Help & support | yes | yes | authenticated user (each screen reads only the caller's own data) |
| Team Overview (workload, attention, Assign Technician) | no | yes | `engineering_team.py` `require_role(*TEAM_ROLES)` |

Team Overview is **one** row. Technician workload and assignment actions live inside the Team screen and its Assign Technician sheet, so they are not separate More rows (no duplicate navigation paths). PM and room oversight stay in the PM tab and Rooms.

Roles come from `user.effective_role ?? user.role`. Visibility = `roles` list + optional `guard` predicate that mirrors the server rule (`canManageTeam`). `isMoreItemAvailable` re-checks at press time; hiding a row is never the only control. The destination screens (`team/index.tsx` redirects to More; `engineering-sync` redirects non-engineering roles) and the API still enforce independently.

## 3. Destination / route matrix

| Key | Group | Destination | Kind | Roles | Badge |
|---|---|---|---|---|---|
| profile | Account | `/(app)/profile/personal` | route | both | — |
| settings | Account | `/(app)/profile` | route | both | — |
| security | Account | `/(app)/profile/security` | route | both | — |
| signOut | Account | `SignOutSheet` (unsynced-work guard) | action, destructive | both | — |
| rooms | Tools | `/(app)/room-status` (EngineeringRoomBoard for engineering roles) | route | both | — |
| sop | Tools | `/(app)/sop` | route | both | — |
| schedule | Tools | `/(app)/scheduling` (My Schedule) | route | both | — |
| notifications | Notifications & sync | `/(app)/notifications` | route | both | `unread` |
| notificationSettings | Notifications & sync | `/(app)/profile/notifications` | route | both | — |
| sync | Notifications & sync | `/(app)/engineering-sync` (Sync Center) | route, sync entry | both | `sync` (bound Phase 4) |
| help | Help & support | `/(app)/profile/help` | route | both | — |
| faq | Help & support | `/(app)/profile/faq` | route | both | — |
| report | Help & support | `/(app)/profile/report` | route | both | — |
| myReports | Help & support | `/(app)/profile/my-reports` | route | both | — |
| diagnostics | Help & support | `/(app)/profile/diagnostics` | route | both | — |
| contactSupervisor | Help & support | `ContactSheet` | action | both | — |
| team | Management | `/(app)/team` | route | chief_engineer | — |

Every href is verified by a test against a real file under `app/(app)` that is also registered in `HIDDEN_APP_ROUTES` / tab routes. No existing route is renamed, so all deep links keep working. No two rows share a destination.

## 4. Screen and bottom-sheet inventory (reused, not rebuilt)

Rooms + room detail (`room-status`), SOP library/detail (`sop`), My Schedule (`scheduling`), Notification inbox (`notifications`) and preferences (`profile/notifications`), Engineering Sync Center (`engineering-sync`) and pending-action / conflict handling (`components/settings/SyncChangesSheet`), Profile + photo editing (`profile/personal`, `PhotoActionsSheet`, `EditFieldSheet`), Security + devices (`profile/security`, `profile/devices`), Help + reporting (`profile/help|faq|report|my-reports|diagnostics`, `ContactSheet`, `DiagnosticsSheet`), Team Overview + Assign Technician (`team`, `useAssignTechnician`), Sign Out (`security/SignOutSheet`, `UnsyncedChangesSheet`).

Bottom sheets use the existing `BottomSheet` (`components/housekeeping/roomDetail/BottomSheet`).

## 5. Reused components and extension points

Reused: `SettingsScreen`, `SettingsSection`, `SettingsRow`, `SignOutSheet`, `ContactSheet`, `BottomSheet`, `useTheme`. Small extension expected in Phase 2: a More-specific identity card and live-status row. An Engineering-specific component is justified only for the identity card and the sync summary; everything else stays shared.

## 6. Role and API permission boundaries

- No new endpoints, tables or migrations in Phase 1.
- Other roles (housekeeper, inspector, supervisor, front desk, GM) get `[]` from both menu functions, and their tab sets are pinned by tests. Shared Settings screens are not modified.
- The `more/index` route exists for every role (tabs are declared once); non-engineering roles are redirected Home.

## 7. Known implementation gaps (Phase 1 snapshot — see §12 for the final state)

1. `contactSupervisor` is an action that Phase 2 binds to `ContactSheet` on the More screen; the current screen does not render V2 groups yet, so it is not user-visible.
2. `sync` badge has no data source wired yet (Phase 4).
3. No `.eslintrc` applies to `apps/mobile`, so `eslint` reports every file as ignored (pre-existing; not changed here).
4. My Schedule is the all-employee `scheduling` screen; Phase 4 adds only an engineering back control and subtitle.

## 8. Phase plan (Phases 2–8; all done, see §8a–§8d and §12)

2. New More hub screen (done): header with bell + settings, identity card with live connection row, Management (chief only), Engineering tools, Account & support, Sign out. Layout comes from `getEngineeringMoreHub(role)` (catalog `hub` slots + `subtitleKey`); Security, notification settings, FAQ, report, my reports, diagnostics and Contact Supervisor are reached through Settings/Help and are not hub rows (`contactSupervisor` is still unbound).
3. Account / security entry polish and sign-out confirmation flow.
4. Live Sync Center summary + `sync` badge (Phase 3 done: status from `syncStatusModel.ts` over the engineering queues; Sync Center ordered Needs attention → Waiting → Drafts → Recent with issue and discard sheets).
5. Notifications entry and preferences surface.
6. Support: help, report, my reports, diagnostics, contact.
7. Chief Engineer management entry polish.
8. Accessibility, i18n sweep, dark mode, final regression.

(Phase boundaries beyond Phase 1 were set by each phase's prompt; the list above is the original plan and numbering may differ from what shipped.)

## 8a. Phase 4 — Engineering Tools (done)

Audit result: Rooms (`EngineeringRoomBoard` + room detail), SOP library/detail and My Schedule (with availability, time off, requests, offers) already implemented search, server-driven filters, cached/offline notices, error-vs-empty states and role scoping. Nothing was rebuilt. Confirmed gaps fixed:

| Gap | Fix |
|---|---|
| Rooms board had no back control (opened from More/Home/notification) | Back button: `router.back()`, else `replace("/(app)/more")`. Title/subtitle now "Rooms" / "Property rooms and maintenance status" |
| My Schedule had no back control or subtitle | Engineering roles only: back (same fallback to More) and "Your shifts and availability". Other roles render exactly as before |
| SOP Library back fell back to Home; heading "Procedures" | Engineering roles: fallback More, heading "SOPs & Procedures". Other roles unchanged |

Reused unchanged: `RoomFilterSheet`, `RoomAvailabilitySheet`, `RoomReleaseSheet`, `SwapRequestSheet`, `ScreenFrame` (child screens already back to `/(app)/scheduling`), SOP cache banner and Ask-about-SOP (no hotel-level AI switch exists in the mobile app; behavior and voice gating are untouched). Bottom sheets: room filters, room availability (create/ETA), room release, swap request.

Back-stack: no screen hardcodes More; every back uses navigation history first. Tabs are unchanged. Tests: `EngineeringTools.test.tsx`, extended `EngineeringRoomBoard.test.tsx`.

Deferred / not done: My Schedule still uses built-in English weekday/month abbreviations (shared with all roles); no emulator or device run was performed; Engineer vs Chief Engineer share the same three tools (Team Overview is the only difference).

## 8b. Phase 5 — Chief Engineer management (done)

Audit result: the management experience already existed and was reused, not rebuilt. More → **Management → Team Overview** (`team` row, `chief_engineer` only, hub slot after the identity card, before Engineering Tools) opens `/(app)/team`. Engineers get no Management section and `team/index.tsx` / `team/[userId].tsx` redirect any non-manager to More; the API (`engineering_team.py` `require_role(*TEAM_ROLES)`, `POST /work-orders/{id}/assign` chief_engineer + gm) refuses them independently.

**Team Overview** (`GET /engineering/team/overview`, tenant-scoped on the server; client cache scoped `tenant:user:team`): header "Team Overview" + back; count tiles (open, overdue, on hold, plus emergency / unassigned / PM overdue only when non-zero or unknown; an unknown figure shows "—", never 0); Needs attention (emergency-unassigned, urgent-overdue, escalated, on-hold rows → real work order, with Assign/Reassign); **Assign unassigned work** link; Team workload (one card per technician → `/(app)/team/[userId]`); PM and rooms (PM overdue + repeat-defect rows → PM schedule / asset, Rooms Out of order → Room Board). Truncation, stale-data banner, error-with-Retry and empty states are handled; nothing is sampled or invented.

**Workload definitions** (plain counts from the server, labelled as such): active = open/escalated/in-progress/on-hold orders assigned to the person; urgent, on hold, overdue are subsets of that. No shift, clock-in, availability, utilisation or "overloaded" labels exist because no such data exists for engineers. Tiles are not summed (they overlap). The Unassigned tile counts every unassigned active order; the new link opens **Available Work**, which is only open + escalated unassigned orders (the same route Home's Assign Work uses), so the two numbers can legitimately differ.

**Technician detail**: reuses `team/[userId]` (that person's active orders via the work-order API, priority-sorted, each with Reassign and a link to the order). No personal contact data is shown.

**Assign Technician sheet** (`AssignTechnicianSheet`, shared by Team, Technician, Work queue, Work-order detail and Chief Home): lists only server-listed assignable engineers with open/urgent/on-hold counts, name search, radio rows (selected state in text/a11y, current assignee disabled), "Reassign" wording and optional note only when the order already has an owner; confirm is disabled offline, while sending (ref-guarded against double taps) and when the pick is the current assignee. Success is shown only after `POST /work-orders/{id}/assign` accepts, sending `expected_assigned_to`.

Phase 5 fixes: (1) after a **409 conflict** the sheet now reads the order, shows the real current assignee, keeps the manager's pick (dropping it only if that person now owns the job) and retries against the fresh `expected_assigned_to` — previously it re-sent the stale value and could never succeed; (2) after **403 / closed / not found** Confirm stays disabled (no repeated forbidden mutation; `isRetryable`); (3) Team Overview gains the Assign-unassigned-work entry.

**Offline**: assignment is online-only (no queue exists, none was invented). Offline shows "No connection. Assignment was not made."; nothing is queued, so the Sync Center is unaffected.

**Navigation**: More → Team → technician → order, More → Team → attention row → order, Team → Assign/Reassign sheet (stays on Team), Team → Assign unassigned work → Work (Available), Team → PM schedule, Team → Room Board; back uses navigation history. Routes unchanged, so deep links are unchanged.

Not done: no emulator or device run; no GM entry in Engineering More (GM has its own Home); an actionable count badge on the Management row was not added (the overview call is not cheap enough to run from More).

Remaining at the time: Phases 6–8 (all now done).

## 8c. Phase 6 — Notifications, Settings, Profile & Security (done)

Audit result: almost everything already existed and was reused unchanged. Confirmed gaps fixed are listed first.

| Gap | Fix |
|---|---|
| **Schedule Updates hidden** — `profile/notifications.tsx` filtered server categories by an icon table that lacked `schedule`, although `notify.py` `CATEGORIES` lists it for all staff and en/es copy existed | Table moved to `lib/notifications/categories.ts` with `schedule` (calendar icon). `notificationCategories.test.ts` parses `notify.py` and fails if any backend category lacks an icon or en/es copy. Unknown future keys are still not shown as switches (their meaning is unknown) |
| Inbox had no back control and was titled "Alerts" | Engineering roles only: back (`router.back()`, else `replace("/(app)/more")`) and title "Notifications" / "Notificaciones". Other roles render exactly as before |
| Inbox overwrote the exact unread count with the length of one capped page (20) | A full page never lowers the stored exact count; header and chip use `max(stored, page)` when the page is full. Marking an already-read row no longer decrements |

**Notification contract.** One inbox (`notifications/index.tsx`), one count (`appStore.unreadCount`, written by `useUnreadBadge` polling `/notifications/unread-count`; the More bell and Home read the same value, no second counter or request). The bell shows no badge at 0 and never prints a zero; it caps at `99+`; its label announces the count. Filters Unread / All and day grouping are unchanged. Actions: open, mark read, mark all read (all server-backed).

**Deep links.** `resolveNotificationTarget` matches the payload `url` against a closed list (work order, Engineering room, schedule, task); ids must be UUIDs and the role must own the screen. Verified against producers: `wo_assignment`, `pm_due`, `pm_corrective_work_order`, `wo_verification_required` → `/(app)/work-orders/{id}`; `room_availability_changed` → `/(app)/room-status/{id}`; `schedule_*` → scheduling. `wo_reassigned` deliberately carries no link (the previous owner may no longer have access). No link → plain text, never Home. Destinations re-read the record as the signed-in person: work-order detail shows a forbidden/unavailable state with back, room detail shows "not found". Opening a notification never marks work done.

**Preferences.** Server-backed (`GET/PUT /notifications/preferences`), optimistic with per-switch coalescing, rollback to the last confirmed value, Retry, cached list when offline, switches disabled offline. Phone permission is read from the OS (granted / quiet / not requested / denied / unavailable) and is explained separately from the account switches; Open Device Settings is offered only after a denial.

**Settings / Profile / Security (audited, unchanged).** More → Settings opens `/(app)/profile`; the identity card opens `profile/personal` (photo via `PhotoActionsSheet`, display name via `EditFieldSheet`; name, email, role and property are hotel-managed and read-only; a confirmed save updates the store so More and Profile agree without restart). Security: biometric app lock (OS challenge before it shows enabled; same proof to disable), lock timeout (0/1/5/15/30 min, coerced on load), change password, Your devices. **Devices/sessions:** Supabase offers no per-user session list to the app, so the screen shows only this phone and the one real capability, "Sign out other devices" (confirm sheet, busy guard, offline disabled, error text, this phone stays signed in). No other devices are invented. Sign out from More still uses `SignOutSheet` + `UnsyncedChangesSheet`, unchanged.

**Role/account safety.** No API, schema or permission change. Preferences, profile and sessions are scoped to the signed-in user server-side; chief_engineer and engineer see the same screens; other roles' Settings and inbox are unchanged (pinned by tests).

Not done / deferred: no emulator, simulator or device run; no staging run of the preference API; `asset_risk_high` carries `asset_id` but no `url`, so it has no link (a new link kind would be a separate change); Settings back falls back to Profile (not More) on a cold start; the Settings notification screen keeps its existing "Notifications" title (no new subtitle); no per-device session list is possible with Supabase Auth.

Remaining at the time: Phases 7–8 (both now done).

## 8d. Phase 7 — Help & Support, problem reporting, diagnostics, drawers (done)

Audit result: Help, FAQ, Report a Problem, My Reports, Contact Supervisor and Diagnostics were already shared, working and well-guarded (server-confirmed success, ref-guarded double submit, per-person draft kept on every failure, offline message, 429 handling, allowlisted diagnostics, hotel-managed contacts only). They were reused. Confirmed gaps fixed:

| Gap | Fix |
|---|---|
| Engineering had only 2 role questions and a flat list | 21 dedicated questions in 5 topics (`ENGINEERING_FAQS`, `faqTopicsForRole`): Work Orders, Preventive Maintenance, Rooms & Assets, Offline & Sync, Account & Notifications. The two older questions and the general ones are kept and carry a topic. Other roles keep their one flat list unchanged |
| Sync answers opened the Settings sync screen | `resolveFaqAction`: engineer / chief_engineer go to `/(app)/engineering-sync`; everyone else is unchanged |
| Help had no topic entry | Engineering roles see Quick help (one row per topic that has questions, plus All questions), Get assistance (Report a Problem, Contact Supervisor), Your support (My Reports), Troubleshooting (Diagnostics). Other roles render the old layout |
| Diagnostics had no recovery path | Open Sync Center (Offline & Sync for other roles), Check connection, Report a Problem |
| Report a Problem could be mistaken for a maintenance ticket | Engineering roles see a note with a button to Report an Issue (`/(app)/work-orders/new`) |

**Architecture.** `lib/support/faq.ts` is the single registry: `topic` is optional metadata used only for engineering roles; text lives in `help.faq.items.<id>`, `help.faq.topics.<topic>`. `profile/faq?topic=<topic>` shows one topic with an "All topics" button; an unknown topic shows every topic and says so. FAQ is expand/collapse in place (no per-question route; `accessibilityState.expanded`; one open at a time). There is no FAQ search and none was added. Tests assert that every question, topic and action label exists in en and es and that every action route is a real file.

**Report a Problem / My Reports / Contact.** Unchanged contracts: `POST` problem report with `clientRequestId`, areas come from `areasForRole`, no attachment control (the endpoint takes none), diagnostics are opt-in and previewed, no offline queue exists (offline keeps the draft and says nothing was sent), the success screen shows the server id's first 8 characters and links to My Reports. My Reports shows the server `status` as words (unknown statuses are printed verbatim, none are invented) and rows open a detail sheet, so the chevron is truthful. Contact Supervisor lists the hotel's own staff and business line only; no personal numbers, none hardcoded, "none added" state when empty.

**Diagnostics boundary.** Fields are the explicit allowlist `DIAGNOSTIC_KEYS` (app version, build, platform, OS, role, language, online, last confirmed sync, pending, failed, sync status). Never included: tokens, passwords, tenant or user ids, guest data, queue payloads. Nothing is collected until a support screen is open and nothing is sent unless the person previews and shares (or ticks the report box). Check connection only reads the phone's network state, changes no app state and sends nothing; it reports the phone's connection, not the server's. Tested.

**Offline troubleshooting.** FAQ answers link only to the Sync Center, Work, PM, Assets, Rooms, Report an Issue, notification settings and profile. No answer tells anyone to clear data or reinstall while changes may be waiting (the sign-out answer says the opposite). They describe the refused / waiting / draft model the Sync Center already implements; no new queue or retry logic.

**Final screen inventory (More tab, both roles).** More hub; Profile (`profile/personal`); Settings (`profile`); Security (`profile/security`, `profile/devices`); Notifications inbox and preferences; Sync Center (`engineering-sync`); Help (`profile/help`), FAQ, Report a Problem, My Reports, Diagnostics; Rooms, SOPs, My Schedule; Team Overview + technician detail (chief_engineer only).

**Final bottom-sheet inventory (audited, all reused).** SignOutSheet + UnsyncedChangesSheet (sign out; says changes stay on the phone); SyncChangesSheet issue sheets (Keep Change / Discard Change, Keep Notice / Dismiss Notice, dismiss-all-claims, PM discard; Phase 3 wording intact) and sync result; RoomFilterSheet, RoomAvailabilitySheet, RoomReleaseSheet; SwapRequestSheet; AssignTechnicianSheet (also Reassign); PhotoActionsSheet (Remove photo has its own confirmation); EditFieldSheet (preferred name); LockTimeoutSheet; SimpleConfirmSheet (Sign out other devices); ContactSheet; DiagnosticsSheet (preview before share); report discard sheet and report detail sheet. Each uses the shared `BottomSheet`, which was not changed. Destructive wording stays distinct: Sign out (this phone), Sign out other devices (revokes sessions), Discard Change (deletes the saved local change), Dismiss Notice (hides a notice, work order unchanged), Remove photo, Discard draft. Added in Phase 7: none (a new sheet would have duplicated an existing one).

**Not done / deferred.** No emulator, simulator or device run and no staging run (tests are Jest only; Spanish and dark mode are covered by string and theme-token tests, not by eye). No FAQ search. No attachment upload or report reply thread (backend has neither). `signOut.unsyncedTitle` still reads "change(s)" (shared string, pre-existing). Contact Supervisor shows the hotel's staff list, which may not name a Chief Engineer for every hotel. The shared `help.rows.contact` / sheet title say "Contact Your Supervisor" while the engineering row says "Contact Supervisor".

**Phase 8 verification (planned in Phase 7; results in §12).** Full mobile jest + `tsc`; a device pass in English and Spanish, light and dark, with large text, over: More → Help → each topic → an action; Report a Problem failed / offline / success on a test tenant (not production); Diagnostics → Sync Center; Contact sheet; back-stack from every nested screen; unsynced-work protection on sign-out; the expo-router hidden-route bounce noted for other branches.

## 9. Intentionally excluded

Fake destinations or mock APIs; a bottom-tab change; new database tables; a rewrite of notifications; redesign of Rooms, SOP or Scheduling; changes to deployment/staging configuration.

## 10. Testing requirements

`__tests__/lib/engineering/moreMenu.test.ts` (catalog, role visibility, route files, i18n en/es, tab protection), `__tests__/screens/EngineeringMore.test.tsx` (rendered behavior, sign-out sheet, redirect), `__tests__/lib/roleTabs.test.ts`. Run from `apps/mobile`: `npx tsc --noEmit`, `npx jest <paths>`.

## 11. Single-PR strategy

One branch off latest `origin/main`, one commit per phase, one draft PR. Every phase pushes to the same branch; the PR is never merged by automation.

## 12. Phase 8 — final integration audit (2026-11-04)

**Repository state audited:** PR #199 (draft, base `main`), branch `feat/engineering-more-v2`, head `3c916ca2` before this docs commit, 0 commits behind `origin/main`, working tree clean, mergeable. Seven code commits (Phases 1–7) on one branch; no second PR. Diff vs main: 43 files, mobile + this doc only. No API, migration, workflow, dependency or lockfile changes.

**Final architecture.** One catalog (`lib/engineering/moreMenu.ts`) drives the More hub via `getEngineeringMoreHub(role)`; tabs stay Home | Work | PM | Assets | More. Engineer hierarchy: More → notifications bell, Settings, profile card with live sync row → Engineering Tools (Rooms, SOPs & Procedures, My Schedule) → Account & Support (Settings & Preferences, Help & Support) → Sign Out. Chief Engineer adds Management → Team Overview → technician → work order / Assign Technician / PM / Rooms. Screens and sheets are inventoried in §4 and §8a–§8d. Reused: SettingsScreen/Section/Row, BottomSheet, SignOutSheet, ContactSheet, AssignTechnicianSheet. New: MoreHeader, MoreIdentityCard, sync issue/discard sheets, `syncStatusModel`.

**Server dependencies / authorization.** No new endpoints. Team Overview and assignment are enforced server-side (`require_role` in `engineering_team.py`; assign endpoint chief_engineer + gm); the UI hides entries but is never the only control. Other roles get `[]` menus and unchanged tabs (pinned by tests).

**Static audit results.**
- Hardcoded Back targets: none; every Back uses navigation history first, then falls back to More (engineering) or the previous default (other roles).
- Debug code, TODO/FIXME, console.log, secrets in added lines: none found.
- i18n: en and es both have 9,980 keys, none missing either way; every static `t()` key in changed files exists.
- Offline/sync invariants (no silent deletion, rejection never shown as success, discard scoped to one record, sign-out keeps unsynced work, conflicts reviewable) are covered by the Phase 3/5/7 tests and the full suite.

**Test results (worktree `PatelRep-engmore`, `apps/mobile`):** `npx tsc --noEmit` exit 0; `npx eslint .` exit 0; `npx jest` — 466 suites / 10,589 tests passed (full suite). GitHub CI on `3c916ca2`: all 29 checks passed, including CI Gate, Staging Gate, Mobile / Jest, Lint, Type-check, EN/ES i18n Parity, Dark-Mode Contrast Gate and Security Scan.

**Defects.** No code defects were found in this audit, so no code changed in Phase 8.

**Not verified — manual validation required.** No emulator, simulator, Expo Go or device run was performed in any phase. Unverified visually: small/large iPhone and Android layout, safe-area and keyboard behaviour of every sheet, large-text clipping, reduced motion, VoiceOver/TalkBack order, real light/dark appearance, Spanish wrapping, offline→online recovery on a device, photo permission flow, biometric prompt, push permission states. No real-device mutation was run against staging. Open item from other branches: the expo-router hidden-route bounce to /home (reproduced on clean main, native unverified); confirm More → each child → Back on a device.

**Deferred / known limitations:** see the "Not done" paragraphs in §8a–§8d.

**Merge readiness.** Automated checks: ready. Manual device pass: outstanding. This document does not authorize merging or any production action.

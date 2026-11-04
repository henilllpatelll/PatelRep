# Engineering More V2 — redesign contract

Source of truth for the **More** tab redesign for the `engineer` and `chief_engineer` mobile logins. All eight phases ship on one branch (`feat/engineering-more-v2`) through **one** pull request, `feat(mobile): Engineering More V2 — complete UX redesign`. Do not open per-phase PRs; do not merge until all phases are complete, tested and approved.

Phase 1 (this document's first version) establishes the navigation contract. It renders nothing new.

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

## 7. Known implementation gaps

1. `contactSupervisor` is an action that Phase 2 binds to `ContactSheet` on the More screen; the current screen does not render V2 groups yet, so it is not user-visible.
2. `sync` badge has no data source wired yet (Phase 4).
3. No `.eslintrc` applies to `apps/mobile`, so `eslint` reports every file as ignored (pre-existing; not changed here).
4. My Schedule is the all-employee `scheduling` screen; there is no engineering-specific schedule view.

## 8. Planned changes (Phases 2–8)

2. New More screen: identity card, grouped rows from `getEngineeringMoreGroups`, bind actions.
3. Account / security entry polish and sign-out confirmation flow.
4. Live Sync Center summary + `sync` badge.
5. Notifications entry and preferences surface.
6. Support: help, report, my reports, diagnostics, contact.
7. Chief Engineer management entry polish.
8. Accessibility, i18n sweep, dark mode, final regression.

(Phase boundaries beyond Phase 1 are provisional and will be set by each phase's prompt.)

## 9. Intentionally excluded

Fake destinations or mock APIs; a bottom-tab change; new database tables; a rewrite of notifications; redesign of Rooms, SOP or Scheduling; changes to deployment/staging configuration.

## 10. Testing requirements

`__tests__/lib/engineering/moreMenu.test.ts` (catalog, role visibility, route files, i18n en/es, tab protection), `__tests__/screens/EngineeringMore.test.tsx` (rendered behavior, sign-out sheet, redirect), `__tests__/lib/roleTabs.test.ts`. Run from `apps/mobile`: `npx tsc --noEmit`, `npx jest <paths>`.

## 11. Single-PR strategy

One branch off latest `origin/main`, one commit per phase, one draft PR. Every phase pushes to the same branch; the PR is never merged by automation.

# Team Scheduling - device QA checklist

Living checklist for PR #185 (supervisor Team Scheduling and shift coverage). It records what has **actually been exercised
on a device**, and is committed so the record survives sessions. Nothing here is marked passed until a person ran it.

Related: [TEAM_SCHEDULING.md](TEAM_SCHEDULING.md) (design), [TEAM_SCHEDULING_STAGING_BUILD.md](TEAM_SCHEDULING_STAGING_BUILD.md)
(how to get a staging-only Android build), [TEAM_SCHEDULING_STAGING_SMOKE.md](TEAM_SCHEDULING_STAGING_SMOKE.md) (the seven
mandatory end-to-end scenarios).

## Rules

1. Only a **staging** build against the **staging** backend and synthetic users. Never production data, never a production
   account. The mobile app has no environment indicator, so confirm `/health` reports `environment: staging`, the launcher
   printed "Staging configuration OK", and you signed in with a `*@patelrep.test` fixture account, before starting.
2. Cell values: `NR` not run (default) / `P` pass / `F` fail / `B` blocked (say why) / `NA` not applicable (say why).
   A cell becomes `P` only after the check was performed on a device; a Jest test, a browser harness run or "the code looks
   right" never counts. Browser harness runs may be noted in the log but do not change a device cell.
3. Every `P`, `F` and `B` needs a line in the **Result log** (date, tester, device + OS, build id, API SHA from `/health`).
4. A failure is a bug to fix or a documented limitation; do not reword the check to make it pass.
5. Re-run the affected rows after any change to the PR head; results are tied to the build id, not to the PR.

## 0. Known navigation problems to resolve before device QA (found on Expo web, 2026-10-29)

Investigated in a browser against the real `(app)` navigator (fake session, mocked API, nothing contacted outside localhost).
**These were reproduced on clean `origin/main` (`f74a3563`), so they are not caused by PR #185**, but all 12 scheduling
routes are affected. Native behaviour is **not verified**: the code path is platform-independent, so assume it applies until a
device proves otherwise. Earlier phases' "browser-checked" results rendered screens through a temporary harness route
*outside* this navigator, so they never exercised this.

1. **Hidden routes bounce to `/home` (blocker if it also happens on a device).** Every route declared with
   `options={{ href: null }}` in `app/(app)/_layout.tsx` (all of `HIDDEN_APP_ROUTES`: the 12 scheduling routes, `profile/*`,
   `notifications`, `my-rooms/[roomId]`, `work-orders/[woId]`, ...) is replaced by `/home` the moment it is focused, both on
   an in-app push (Profile > Personal Information lands on `/home`) and on a hard load. Visible tabs are unaffected.
   Cause (read from `expo-router@58.0.28`, `standard-navigation/useVisibleTabsWithRedirect.js`): `href: null` now means
   `hidden: true`, and a focused hidden tab triggers `router.replace` to the first visible tab ("new redirect behavior",
   documented upstream only as a TODO). The app moved to SDK 58 in #184 (merged 2026-10-28), so this may be new with that
   upgrade. Tested fix direction (web only, throwaway, reverted): hide the tab button by style (`tabBarItemStyle:
   { display: "none" }`) instead of `href: null`; every hidden route then stays reachable in-app and on a hard load. Not
   applied: it is an app-wide change to a shared layout that needs native verification and a decision.
2. **Back from a secondary screen goes to Home, not to where you came from.** `Tabs` is used with the default
   `backBehavior` (`firstRoute`), so header back and browser back from Team Schedule > Templates both end on `/home`.
   Setting `backBehavior="history"` (web, throwaway, reverted) made back return to the opener. It changes hardware-back
   behaviour for every role, so it is a product decision, not a fix to slip into this PR.
3. With problems 1 and 2 worked around temporarily, a scripted battery passed 35/35 on web: all 12 URLs hard-load and render,
   a housekeeper opening a supervisor route is redirected to `/home`, `/team-schedule/coverage` without `gapId` goes to
   `/team-schedule`, `page.reload()` on a deep link is stable, header back after a hard load falls back to a sensible screen.
   This is browser evidence on mocked data. It is **not** a device pass and no cell below was changed because of it.

Reproduce: from a worktree with `apps/mobile/app.json` `web.output` temporarily `"single"`, run Metro with
`EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:1 EXPO_PUBLIC_SUPABASE_ANON_KEY=dummy EXPO_PUBLIC_API_URL=http://127.0.0.1:1/v1
npx expo start --web --port 8099 --clear`, seed a Supabase session in `localStorage` (`sb-127-auth-token`, JWT claims
`user_role` and `hotel_id`) and mock `/rest/v1/*` and `/v1/*` at the network layer, then hard-load `/profile/personal`. Use
`--clear` when switching worktrees: they share one `node_modules`, and Metro's cached `require.context` output otherwise
serves the other tree's `app/` directory.

## Environment record (fill in per session)

| Field | Value |
| --- | --- |
| Tester | |
| Device(s) / Android version | |
| Build id (EAS) / commit SHA | |
| Staging API SHA (`/health`) | |
| Test accounts used | |
| Locale / theme at start | |

## 1. Screen matrix

Columns: **Load** normal data, **Empty** no data, **Err** API failure shows a recoverable message, **Off** offline (writes
blocked and explained, cached read behaviour as designed), **ES** Spanish with no raw keys / clipped text, **Dark**,
**TB** TalkBack (focus order, labels, roles, announcements), **A+** system font at the largest size (no clipped or
overlapping text, actions still reachable).

Employee routes (any role with a schedule; entry Profile > My Schedule, or a notification):

| Route | Screen | Load | Empty | Err | Off | ES | Dark | TB | A+ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/(app)/scheduling` | My Schedule (week, shift highlight from a link) | NR | NR | NR | NR | NR | NR | NR | NR |
| `/(app)/scheduling/availability` | My Availability | NR | NR | NR | NR | NR | NR | NR | NR |
| `/(app)/scheduling/time-off` | Time Off | NR | NR | NR | NR | NR | NR | NR | NR |
| `/(app)/scheduling/requests` | My Requests (swaps and time off) | NR | NR | NR | NR | NR | NR | NR | NR |
| `/(app)/scheduling/offers` | My Offers (cover offers, open shifts) | NR | NR | NR | NR | NR | NR | NR | NR |

Supervisor routes (housekeeping supervisor; entry Today > team card; non-supervisors must be redirected home):

| Route | Screen | Load | Empty | Err | Off | ES | Dark | TB | A+ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/(app)/team-schedule` | Team Schedule (Today / Week, filters, draft bar) | NR | NR | NR | NR | NR | NR | NR | NR |
| `/(app)/team-schedule/templates` | Shift templates | NR | NR | NR | NR | NR | NR | NR | NR |
| `/(app)/team-schedule/coverage?gapId` | Find Coverage | NR | NR | NR | NR | NR | NR | NR | NR |
| `/(app)/team-schedule/open-shifts` | Open Shifts | NR | NR | NR | NR | NR | NR | NR | NR |
| `/(app)/team-schedule/availability` | Team Availability | NR | NR | NR | NR | NR | NR | NR | NR |
| `/(app)/team-schedule/requests` | Requests inbox (time off, swaps) | NR | NR | NR | NR | NR | NR | NR | NR |
| `/(app)/team-schedule/forecast` | Staffing forecast | NR | NR | NR | NR | NR | NR | NR | NR |

Route-specific checks (record in the log; each is also a pass/fail line):

- **My Schedule**: opened from a notification it lands on the right week and highlights the shift; a shift that no longer
  exists says so and shows nothing else; an overnight shift shows both dates correctly.
- **Team Schedule**: Today/Week switch keeps the date; filter sheet applies and clears; "Needs cover" attention rows open Find
  Coverage; a staged change shows in the draft bar and **not** on an employee phone; "Apply immediately" shows its warning.
- **Templates**: create, edit, archive; archiving never changes an existing shift.
- **Find Coverage**: eligible list, warnings (rest, overtime, availability unknown), offer, "Record that they accepted",
  lost race (someone else filled it) shows the current state.
- **Open Shifts**: post as claimable, claim from an employee phone, approve/decline claim.
- **Requests inbox**: approve shows the impact on existing shifts and never edits them; deny needs a reason; swap approval is
  atomic (both shifts change or neither).
- **Forecast**: future days read "unknown", never "sufficient"; a short day opens the day sheet with a path to add a shift.

## 2. Sheets and modals

Each is opened from the screen shown, on a device, in light/dark and EN/ES, with the keyboard up where it has inputs.
Checks: opens, scrolls to the **top** (not the end), close by button and system back, keyboard does not hide the primary
action, focus lands inside the sheet and returns on close, no content under the gesture bar.

| Sheet | Opened from | Open | Keyboard | Back/close | ES | Dark | TB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Shift detail | Team Schedule shift | NR | NR | NR | NR | NR | NR |
| Shift form (add / edit / copy, recurring) | Shift detail, Add | NR | NR | NR | NR | NR | NR |
| Employee picker | Shift form | NR | NR | NR | NR | NR | NR |
| Shift review | Shift form | NR | NR | NR | NR | NR | NR |
| Call-out | Shift detail | NR | NR | NR | NR | NR | NR |
| Coverage offer / waive / post | Find Coverage, Open Shifts | NR | NR | NR | NR | NR | NR |
| Filter | Team Schedule | NR | NR | NR | NR | NR | NR |
| Template form | Templates | NR | NR | NR | NR | NR | NR |
| Publish review | Draft bar | NR | NR | NR | NR | NR | NR |
| Publication history | Draft bar | NR | NR | NR | NR | NR | NR |
| Forecast day | Forecast | NR | NR | NR | NR | NR | NR |
| Request decision | Requests inbox | NR | NR | NR | NR | NR | NR |
| Swap request | My Schedule | NR | NR | NR | NR | NR | NR |
| Time-off / availability editors | Time Off, My Availability | NR | NR | NR | NR | NR | NR |

## 3. Navigation

| Check | Result |
| --- | --- |
| **Gate (section 0.1): a hidden route stays on screen on a device** - open Profile > Personal Information and Today > Team Schedule; neither may jump back to Home. Nothing below is meaningful until this passes | NR |
| Every entry point reaches its route: Profile > My Schedule, Today team card, Team Schedule header links (Templates, Requests, Forecast, Availability, Open Shifts), attention rows | NR |
| System back from each of the 12 routes returns to the screen that opened it (not to the first tab) | NR |
| Header back arrow behaves the same as system back | NR |
| Back after a cold start into a deep link (no history) falls back to a sensible screen, never exits the app silently | NR |
| Notification tap while the app is closed / backgrounded / foregrounded opens the right route and week | NR |
| Notification tap for something the person can no longer see shows an explicit "gone" state | NR |
| A non-supervisor opening a supervisor route (link or notification) is redirected, with no flash of content | NR |
| Sign-out then sign-in as another user shows no previous user's schedule (screens re-key on user) | NR |
| Rotating / split-screen / background for several minutes then resume keeps position or reloads cleanly | NR |
| Tab bar visible where expected; hidden-route screens do not add tabs | NR |

## 4. Cross-cutting

| Area | Check | Result |
| --- | --- | --- |
| Loading | Skeletons/spinners appear, never a blank screen; no layout jump when data arrives | NR |
| Loading | Pull-to-refresh on every list screen (not a WebSocket screen) | NR |
| Errors | API 5xx and timeout: message names what failed, offers Retry, keeps the last good data visible | NR |
| Errors | 409 conflicts (stale version, schedule conflict, already filled): reload prompt, no silent overwrite | NR |
| Errors | Uncertain save (response lost): retry does not duplicate | NR |
| Offline | Airplane mode: read-only banner, writes disabled with a reason; reconnect recovers without restart | NR |
| Accessibility | TalkBack reads each control with a name and role; status is not conveyed by colour alone | NR |
| Accessibility | Touch targets at least 48dp on every action in the sheets | NR |
| Accessibility | Largest font size and bold text: no clipped actions in any sheet | NR |
| Accessibility | Focus moves into a sheet on open and back to the trigger on close; errors are announced | NR |
| Spanish | Whole flow in ES: no raw keys, no English leftovers, plurals right ("1 turno / 2 turnos"), dates and times localized | NR |
| Spanish | Long Spanish strings do not clip buttons or badges | NR |
| Dark mode | Every screen and sheet: text contrast readable, no white flashes on open, status colours distinguishable | NR |
| Dark mode | Switching theme while a sheet is open re-themes it | NR |
| Time | Overnight shift and the DST weekend show correct dates/hours; hotel time zone is used, not the phone's | NR |
| Notifications | Permission denied: in-app message still arrives; token revoked: no crash | NR |

## 5. Result log

Newest first. One line per `P`/`F`/`B`.

| Date | Tester | Device / OS | Build id | Item | Result | Notes / issue link |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

## 6. Known limits (not defects unless behaviour differs)

- Future-day staffing demand is unknown by design; the forecast says so.
- Mobile Team Schedule is supervisor-only.
- Push is "accepted by Expo", not proof of delivery; the in-app inbox is the reliable channel.
- Email is not used.

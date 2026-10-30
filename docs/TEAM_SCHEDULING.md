# Team Scheduling & Shift Coverage

How the supervisor's Team Schedule and the employee's My Schedule work, which rules the server enforces, how notifications
are produced, and how to verify and roll the feature out. Scope: `apps/mobile/app/(app)/team-schedule/**`,
`apps/mobile/app/(app)/scheduling/**`, `apps/mobile/{components,lib}/scheduling/**`, and the `/v1/schedules*` routes in
`apps/api` (`routers/scheduling*.py`). Migrations: `225` to `229`.

## 1. What it is

| Who | Where | What they do |
|---|---|---|
| Housekeeping supervisor | Team Schedule (from Supervisor Today) | Today overview, weekly schedule, add / edit / copy / cancel shifts (single and recurring), shift templates, record a call-out, find and offer coverage, post open shifts, team availability, requests and approvals, staffing forecast, draft review and publish, publication history |
| Any employee | My Schedule | Their published week (opens on the right week from a notification), availability, time-off requests, shift swaps, shift offers, open-shift claims, request history |
| GM | API only | Same manager routes as the supervisor, unrestricted by department. There is no GM mobile screen in this feature. |
| Engineer / chief engineer | API only | Managers (engineer) are scoped to the ENG department; no mobile Team Schedule |

Mobile entry to Team Schedule is limited to `housekeeping_supervisor` (`lib/scheduling/teamScheduleAccess.ts`). The API
is the authority: every route is authenticated, and 71 of the 76 scheduling routes are `require_role`-gated. The other five
(`GET /schedules/shifts`, `GET /schedules/assignments`, `GET /schedules/assignments/my-schedule`, `PATCH .../clock-in`,
`PATCH .../clock-out`) predate this feature and check scope inline: employees only ever read their own published shifts.

## 2. Data model (migrations)

- **225** `team_scheduling_foundation`: `shift_assignments` carries its own snapshot (name, times, UTC `starts_at/ends_at`,
  `publication_state`), so editing or archiving a template never rewrites history. Per-person overlap is refused by a
  trigger (SQLSTATE `23P01`). Templates are archived (`archived_at`), never deleted.
- **226** `coverage_recovery`: `absence_records`, `coverage_gaps`, `coverage_offers`, `coverage_claims`, and
  `fill_coverage_gap()`, which writes the replacement shift, fills the gap, covers the absence and settles the other
  offers and claims in one transaction (`CV001` stale, `CV002` closed, `CV003` missing).
- **227** `availability_time_off_swaps`: `employee_availability`, `time_off_requests`, `shift_swap_requests`;
  `replace_weekly_availability()`, `approve_shift_swap()` (atomic two-way exchange, `SW001`-`SW010`); an approved-leave
  guard on `shift_assignments` (`TO001`).
- **228** `schedule_publishing`: `schedule_revisions` / `_changes` / `_events` (draft -> published, one open draft per
  department), `publish_schedule_revision()` (atomic, `SR001`-`SR010`), the `schedule_notifications` outbox,
  `claim_schedule_notifications()`, and `notifications.dedupe_key`. The plain unique `(user_id, shift_id, work_date)` became a
  partial unique index that ignores `cancelled` rows (a published cancellation keeps its row so absence and swap history is
  not cascade-deleted); the overlap trigger already ignores `cancelled` rows, so a cancelled shift never blocks or conflicts.
- **229** `schedule_notification_triggers` (final audit): request-workflow notifications written in the same transaction as
  the change (section 8); `claim_schedule_notifications()` closes a delivery that keeps crashing the worker instead of
  re-claiming it for ever; `record_absence_with_gap()` and `create_coverage_offer()` replace write-then-compensate sequences
  with single transactions.

All migrations are forward-only and additive (228 loosens one constraint, marked destructive-reviewed with a rollback plan).
None repairs, edits or back-fills migration history.

## 3. Attendance is separate

Attendance is `hk_shift_sessions` and nothing else. A scheduled shift is a plan, not proof of attendance, and a missing
clock-in is never a call-out: absences are only created when a supervisor records one. Room assignments (Assignments,
Room Board) are independent of scheduling; a call-out does not move rooms and a replacement does not inherit them. The
shared housekeeping roster is read, not changed.

## 4. Call-outs and coverage

Record a call-out (`POST /schedules/absences`) -> one absence and one open gap, created in one database transaction. The
original shift row is never rewritten. Then:

- **Find coverage** ranks eligible people deterministically: overlap and approved leave block; outside-hours, marked
  unavailable and pending leave warn; no submitted availability is `unknown`, never "available".
- **Offer** (`create_coverage_offer`) is a question, not a shift: the employee is not scheduled until they accept and the
  server confirms. **Direct assign**, **accepted offer** and **approved claim** all run the same atomic fill.
- A gap `offered` with no live offer left still behaves as open for every action (reopening is a convenience write).
- Nothing reassigns rooms automatically.

## 5. Availability, time off, swaps

- Availability is evidence, not permission. Nothing submitted is `unknown`. Saving never edits a published shift; clashes
  are returned as a warning.
- Time off `pending -> approved | denied | cancelled`. Approval records a decision and blocks new or moved shifts in that
  window; it never deletes or moves an existing shift (the drawer lists the shifts that still need a decision).
- Swaps `proposed -> accepted -> approved`: coworker acceptance changes nothing; `approve_shift_swap()` exchanges both shifts
  in one transaction or neither. Employees see only their own requests; anything else is a 404.

## 6. Staffing forecast (deterministic, not AI)

Demand comes from existing room workload and the existing housekeeping cleaning-time rules; capacity comes from scheduled
shift minutes minus approved leave and call-outs. Limits shown to the supervisor, not hidden:

- No PMS demand source exists for future days, so future days are **Unknown** (scheduled labour is shown, never "sufficient").
- Rooms without a duration estimate make demand a lower bound: it can prove "short", never "sufficient".
- No break policy exists, so capacity is paid shift minutes (breaks are a what-if only).
- Inspection and public-area work have no duration standards and are not counted.
- Nothing in the forecast or its recommendations is labelled AI.

## 7. Draft and publish

By default, planning changes are staged in the department's one open **draft revision**; employees cannot see a draft (it
is not in `shift_assignments`). **Publish** (`publish_schedule_revision`) applies cancels, edits, then creates in one
transaction, re-checking every shift's version, attendance, leave and overlap; any failure rolls the whole revision back.
Published revisions are immutable; a correction is a new revision. A retried publish replays by idempotency key. Call-outs
and "Apply immediately" bypass the draft by design.

## 8. Notifications

Three separate steps, never conflated:

1. **Intent** - a `schedule_notifications` row, always written **by the database inside the transaction of the business
   change**: publication (228) and time off / swaps / offers / claims (229 triggers). A rolled-back change leaves no
   message; a committed change cannot lose its message to a crash; the dedupe key `<event>:<id>:<user>` makes replays no-ops.
   The one exception is the **open-shift announcement**, whose audience is computed in Python. It is sent best effort when the
   shift is posted; the 5-minute notification job then re-announces any still-open claimable posting 2-90 minutes old that has
   no announcement rows (`reconcile_open_shift_announcements`), so a lost announcement is recovered within about five minutes.
   After 90 minutes the Open Shifts screen is the source of truth. A manager-recorded offer acceptance tells the person who
   made the offer "A shift offer was accepted" (the copy deliberately does not claim the employee did it in the app).
2. **Inbox** - the `schedule.notifications` job (APScheduler, every 5 minutes, production only; also drained right after a
   publish) claims due rows (`FOR UPDATE SKIP LOCKED`), creates the in-app `notifications` row once, and marks the intent
   `sent`. `sent` means **readable in the app**.
3. **Push** - an extra through the existing Expo path. Recorded as `accepted` (Expo took it; **not** proof of delivery),
   `failed`, `no_device`, `opted_out`. `DeviceNotRegistered` revokes that install. Email is not used.

Failures retry with bounded backoff (5 attempts), then stay `failed` for a manager to retry; a delivery that kills the worker
is closed as `abandoned_after_crash` after the 5th attempt. Payloads hold ids and a date only: leave reasons, call-out notes
and decision text never reach a phone. Tapping a notification opens My Schedule on the affected week and highlights the
shift, or the offer / request itself; if it is gone the screen says so and shows nothing else.

## 9. Feature flags and configuration

- There is **no feature flag** for Team Scheduling, by decision. Most of what changed cannot be flagged: migrations 225-229
  and the stricter rules on the existing `/schedules/*` endpoints apply as soon as the API deploys (and are covered by the
  Database Migration Gate). The new mobile surfaces are gated by role (supervisor for Team Schedule) and by shipping a mobile
  build; nothing in CI publishes an `eas update`, so an over-the-air release is a deliberate manual step. Mobile has no
  flag consumer, and the existing tenant flag registry (`docs/FEATURE_FLAGS.md`) is API-side only, so a per-hotel switch would
  need new client code. Residual risk: once a build with these screens is released, every hotel on it sees them; the only
  off-switches are not releasing the build and `cron_scheduler_enabled` for notification delivery. Release the API first.
- Required for notification delivery in production: `APP_ENV=production`, `cron_scheduler_enabled` not switched off,
  `CRON_SECRET` set (the in-process scheduler calls the cron handlers with it). Push additionally needs working Expo push
  devices; without them in-app delivery still works.
- No new environment variables were introduced.

## 10. Verification

Automated in CI: API unit/smoke suites, `tests/integration/test_*schedul*`, `test_coverage_fill`, `test_availability_swaps`,
`test_schedule_publishing`, `test_schedule_notification_triggers` and `test_schedule_scenarios` against the migrated database
(**Database Migration Gate**), the RBAC matrix and the bare-role guard. **Not run in CI:** mobile Jest, mobile `tsc` and
mobile ESLint (the EN/ES parity and contrast gates are web scripts). Run them locally before release:
`cd apps/mobile && npx jest --maxWorkers=1`, `npm run type-check`, `npm run lint`.

Staging smoke (human, with a real device and a test hotel, never production data):

1. Supervisor: create a shift, review the draft, publish; the employee sees it only after publishing.
2. Edit a published shift from two phones; the second save is refused with a reload prompt.
3. Record a call-out, offer to an eligible person; they accept; the supervisor sees "Covered"; rooms unchanged.
4. Employee submits time off; supervisor approves; an existing shift stays visible as a conflict.
5. Swap two shifts end to end; both employees see the exchange only after approval.
6. Publish a schedule for a future week; tap the notification on the employee phone; it opens that week with the shift
   highlighted. Repeat with an overnight shift.
7. Kill the push token (or revoke notifications): the in-app message still arrives.

## 11. Production rollout prerequisites

- Merge only after a human review of PR #185 and green CI Gate, Staging Gate and Database Migration Gate on the final SHA.
- Migrations 225-229 apply in order via the normal release path; do not run `supabase migration repair`.
- Ship the API before (or with) the mobile build; older mobile builds ignore the new routes.
- Confirm `cron_health` shows `schedule.notifications` running every 5 minutes after the release.
- Post-release: repeat staging steps 1, 3 and 6 on a test hotel.

## 12. Recovery and rollback

Each migration states its rollback plan in its header. Published shifts and delivered messages are ordinary rows and remain
valid if later objects are removed. Disabling delivery without a deploy: set `cron_scheduler_enabled` off (intents queue and
are delivered when it is re-enabled). Draft revisions can be discarded by a manager at any time; a published revision is
corrected with a new one, never edited.

## 13. Known limitations

- Real-device behaviour of the new screens has **not** been verified; coverage is Jest component tests with the real screens
  plus a browser harness in earlier phases. Run the staging smoke on a device before release.
- When a manager records an offer acceptance for an employee, the employee gets no separate message (they already agreed);
  the offerer, if they recorded it themselves, receives a neutral "accepted" message about their own action.
- Mobile Team Schedule is supervisor-only; GM / engineering managers have API access but no mobile screens.
- Open-shift announcements are best effort at post time and reconciled within about five minutes (section 8).
- Future-day staffing demand is unknown by design (section 6).
- `routers/scheduling.py` is ~820 lines, above the repository's 500-line guideline; extraction was judged riskier than the
  benefit for this release.
- Push delivery is never confirmed beyond "accepted by Expo".
- Performance numbers are in the PR #185 QA matrix; they come from one isolated Postgres on a developer machine, not from production hardware.

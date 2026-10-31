# Team Scheduling - staging smoke scenarios

The seven scenarios in [TEAM_SCHEDULING.md](TEAM_SCHEDULING.md) section 10, made executable. They are **mandatory before
release** and are run by a person with a real Android build from [TEAM_SCHEDULING_STAGING_BUILD.md](TEAM_SCHEDULING_STAGING_BUILD.md).
Status of every scenario today: **NOT RUN**. Record outcomes in the result log of
[TEAM_SCHEDULING_DEVICE_QA.md](TEAM_SCHEDULING_DEVICE_QA.md); a scenario is passed only when its "Verified by" evidence exists.

## Ground rules

- Staging only, synthetic users only. Production is never used. The mobile app has no environment indicator, so before each
  session confirm `/health` says `staging` and that you are signed in with a `*@patelrep.test` fixture account; otherwise stop.
- The staging database is **rebuilt for every eligible PR candidate** (`Staging Candidate`). Before starting, read
  `GET <staging API>/health` and confirm its SHA equals the PR #185 head you are testing; read it again at the end. If it
  changed, any result in between is void (the data may have been wiped) and the run is repeated.
- Evidence is collected from the real client (screen recording or screenshots with the clock visible) **and** from a staging
  server-side read, so that "the screen said so" and "the system recorded it" agree. Server reads use staging credentials
  held by the person running the test; none are stored in the repository.

## Prerequisites (verify, do not assume)

| Need | Why | Status |
| --- | --- | --- |
| Android build from `staging-dev`, installed on a real device (and a second device or emulator for scenarios 2, 3 and 5) | all scenarios | NR |
| Staging anon key in `STAGING_SUPABASE_ANON_KEY` and `npm run check:staging-env` passing | the app talks to staging only | NR |
| Seeded accounts exist: `staging-housekeeping-supervisor@patelrep.test` (supervisor), `staging-housekeeper@patelrep.test`, `staging-gm@patelrep.test` (`seed-staging-tenant.mjs`) | roles | NR |
| **Two synthetic housekeepers** in the Housekeeping department: `staging-housekeeper@patelrep.test` and `staging-housekeeper-2@patelrep.test`, both seeded by the trusted Staging Candidate (scenarios 3 and 5 need two) | seed + `staging-fixture-users.mjs` | NR |
| Both housekeepers have the Housekeeping department and appear in the supervisor's roster | eligibility for coverage and schedule visibility | NR |
| Staging `CRON_SECRET`, to trigger `POST /v1/internal/schedule/notifications` with header `X-Cron-Secret` | the in-process scheduler is disabled in staging (`CRON_SCHEDULER_ENABLED=false`), so the 5-minute delivery job never runs by itself. Publishing drains the outbox immediately; every other event (time off, swap, offer, claim) is delivered only when this endpoint is called | NR |
| Push registered: each device signed in once with notifications allowed, so a `push_devices` row exists | scenarios 6 and 7 | NR |
| A way to read staging rows (`schedule_notifications`, `notifications`, `shift_assignments`, `schedule_revisions`) | server-side evidence | NR |

The week used for scenarios 1 and 6 must be in the future (past dates are refused) and must not contain real data; staging
has none, but name it in the log.

## Scenarios

### 1. Create, review, publish; employees see it only after publishing
- **Actors**: supervisor (device A), housekeeper (device B).
- **Steps**: supervisor adds a shift for the housekeeper next week (planning mode left on the default draft), opens the draft
  bar, reviews, publishes. Housekeeper opens My Schedule for that week before and after.
- **Expect**: before publishing the housekeeper sees nothing for that shift; the draft bar shows the staged change; after
  publishing the shift appears and the housekeeper has an in-app message.
- **Verified by**: B's screen recording across the publish; `schedule_revisions` row `published` with one change; no
  `shift_assignments` row until publish; `schedule_notifications` row for the housekeeper `sent`.

### 2. Two phones edit one published shift; the second save is refused
- **Actors**: supervisor on device A and the same supervisor (or the GM) on device B.
- **Steps**: both open the same published shift, A saves a change, B then saves a different change without reloading.
- **Expect**: B's save is refused with a reload prompt (version conflict), nothing is overwritten, B's reload shows A's value.
- **Verified by**: B's screen; the shift row's `version` incremented exactly once and holds A's value; no second write.

### 3. Call-out, offer, accept, covered
- **Actors**: supervisor (A), absent housekeeper, replacement housekeeper (B). Needs the second housekeeper.
- **Steps**: supervisor records a call-out on a published shift, opens Find Coverage, offers it to the replacement. The
  replacement accepts in My Offers. Supervisor refreshes.
- **Expect**: the supervisor sees "Covered"; the original shift row is untouched and the replacement has a new shift; no
  rooms or room assignments changed.
- **Verified by**: screens of both; `coverage_gaps` filled, an offer `accepted`, a **new** `shift_assignments` row for the
  replacement and the original unchanged; `room_assignments` row count unchanged.

### 4. Time off approved over an existing shift
- **Actors**: housekeeper (B), supervisor (A).
- **Steps**: housekeeper requests time off covering a published shift; supervisor opens Requests and approves.
- **Expect**: the approval screen lists the shift as affected; after approval the shift is still on the schedule and is shown
  as a conflict, not deleted or cancelled; the housekeeper is told the decision.
- **Verified by**: screens; `time_off_requests` approved; the shift row unchanged; the decision message present after calling
  the notifications endpoint once.

### 5. Swap two shifts end to end
- **Actors**: two housekeepers (B, C), supervisor (A). Needs the second housekeeper.
- **Steps**: B proposes a swap with C, C accepts, supervisor approves. Both look at My Schedule before and after.
- **Expect**: neither schedule changes until the supervisor approves; then both change at once; if either side is edited
  between acceptance and approval the approval is refused cleanly.
- **Verified by**: recordings of B and C across the approval; both `shift_assignments` rows swapped in one commit; the swap
  request `approved`.

### 6. Publish a future week; the notification opens that week with the shift highlighted (also overnight)
- **Actors**: supervisor (A), housekeeper (B) with the app closed.
- **Steps**: publish a schedule for a week at least two weeks ahead; with the app closed on B, tap the push (or the in-app
  message if push is not delivered). Repeat with an overnight shift (for example 22:00-06:00).
- **Expect**: My Schedule opens on that week and highlights the shift; for the overnight shift both days are correct; a shift
  deleted before tapping shows the "gone" state only.
- **Verified by**: B's screen recording of the tap and landing; the notification payload holds ids and a date only (no
  reasons or notes); the push record says `accepted` (Expo took it; this is not proof of delivery, so the on-screen result is
  the evidence).

### 7. Push unavailable; in-app message still arrives
- **Actors**: housekeeper (B).
- **Steps**: on B, revoke the notification permission in Android settings (or remove the app's push token), then supervisor
  publishes a change affecting B.
- **Expect**: no push; the in-app inbox shows the message and the schedule is correct; nothing is reported as failed to the
  supervisor beyond the delivery state.
- **Verified by**: B's inbox screenshot; `notifications` row present once (no duplicate on a second delivery run); the intent
  `sent` and the push record `opted_out` or `no_device`.

## Outcome table

| # | Scenario | Result | Date / build | Evidence link |
| --- | --- | --- | --- | --- |
| 1 | Publish visibility | NR | | |
| 2 | Concurrent edit refused | NR | | |
| 3 | Call-out to covered | NR | | |
| 4 | Time off conflict | NR | | |
| 5 | Swap | NR | | |
| 6 | Notification deep link (incl. overnight) | NR | | |
| 7 | Push unavailable | NR | | |

Release readiness requires all seven `P` on the final PR head, plus repeating 1, 3 and 6 after the production release
(TEAM_SCHEDULING.md section 11) on a test hotel.
